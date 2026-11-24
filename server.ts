import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AliasMode,
  AnalysisSettings,
  AudioAnalysisResult,
  LyricLanguage,
  LyricSyllableToken,
  MusicSection,
  PronunciationDictEntry,
  UstNote,
} from './src/types/ust.ts';
import {
  computeSpectralFlux,
  computeWaveformPeaks,
  detectYinPitchFrames,
  estimateBpmAndBeats,
  parseWavPcm16,
  segmentF0ToNotes,
  suggestSectionsFromAudio,
} from './server/dsp.ts';
import {
  alignLyricsToNotesWithSections,
  auditAndCorrectTuning,
  convertLyricsWithGemini,
} from './server/gemini.ts';

const execFileAsync = promisify(execFile);

const ALLOWED_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.webm']);
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

const uploadDir = path.join(os.tmpdir(), 'ai-ust-creator-uploads');

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (err) {
      cb(err as Error, uploadDir);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ALLOWED_EXTS.has(ext) ? ext : '.bin';
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isAudioMime = file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream';
    if (!ALLOWED_EXTS.has(ext) || !isAudioMime) {
      cb(new Error('MP3, WAV, OGG, FLAC, M4A 오디오 파일만 업로드할 수 있습니다.'));
      return;
    }
    cb(null, true);
  },
});

async function safeUnlink(filePath: string | null) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore cleanup error
  }
}

async function probeAudioChannels(inputPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=channels',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ]);
    const ch = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(ch) && ch > 0 ? ch : 1;
  } catch {
    return 1;
  }
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    const hasKey = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );
    res.json({
      ok: true,
      geminiConfigured: hasKey,
    });
  });

  app.post('/api/analyze-audio', upload.single('audio'), async (req, res) => {
    const uploadedPath = req.file?.path ? path.resolve(req.file.path) : null;
    if (!uploadedPath || !uploadedPath.startsWith(path.resolve(uploadDir) + path.sep)) {
      res.status(400).json({ error: '유효한 오디오 파일이 전달되지 않았습니다.' });
      return;
    }

    const jobId = crypto.randomUUID();
    const mixWavPath = path.join(uploadDir, `${jobId}-mix.wav`);
    const vocalWavPath = path.join(uploadDir, `${jobId}-vocal.wav`);

    try {
      const rawSettings = typeof req.body?.settings === 'string' ? JSON.parse(req.body.settings) : {};
      const settings: AnalysisSettings = {
        vocalIsolation: rawSettings.vocalIsolation !== false,
        sensitivity: Math.max(0.1, Math.min(1.0, Number(rawSettings.sensitivity) || 0.65)),
        quantizeGrid: ['1/32', '1/16', '1/8', '1/4', 'none'].includes(rawSettings.quantizeGrid)
          ? rawSettings.quantizeGrid
          : '1/16',
        minNoteDurationMs: Math.max(40, Math.min(400, Number(rawSettings.minNoteDurationMs) || 85)),
        timeSignature: ['4/4', '3/4', '6/8'].includes(rawSettings.timeSignature)
          ? rawSettings.timeSignature
          : '4/4',
        manualBpm:
          rawSettings.manualBpm && Number(rawSettings.manualBpm) >= 40 && Number(rawSettings.manualBpm) <= 240
            ? Number(rawSettings.manualBpm)
            : null,
      };

      const existingSections: MusicSection[] =
        typeof req.body?.existingSections === 'string'
          ? JSON.parse(req.body.existingSections)
          : [];

      const channels = await probeAudioChannels(uploadedPath);

      // 1) Decode full mix to mono 22050Hz 16-bit PCM WAV
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        uploadedPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '22050',
        '-acodec',
        'pcm_s16le',
        mixWavPath,
      ]);

      const mixBuffer = await fs.readFile(mixWavPath);
      const mixData = parseWavPcm16(mixBuffer);

      // 2) Extract vocal-isolated PCM if requested
      let vocalSamples = mixData.samples;
      let separationMethod: AudioAnalysisResult['separationMethod'] = 'none';

      if (settings.vocalIsolation) {
        const filterChain =
          channels >= 2
            ? 'pan=mono|c0=0.5*c0+0.5*c1,highpass=f=110,lowpass=f=3800'
            : 'highpass=f=120,lowpass=f=3600';
        separationMethod = channels >= 2 ? 'mid-side-bandpass' : 'formant-bandpass';

        await execFileAsync('ffmpeg', [
          '-y',
          '-i',
          uploadedPath,
          '-vn',
          '-af',
          filterChain,
          '-ar',
          '22050',
          '-acodec',
          'pcm_s16le',
          vocalWavPath,
        ]);

        const vocalBuffer = await fs.readFile(vocalWavPath);
        const vocalData = parseWavPcm16(vocalBuffer);
        vocalSamples = vocalData.samples;
      }

      // 3) Spectral flux + BPM & beat grid
      const { flux, frameRate } = computeSpectralFlux(mixData.samples, mixData.sampleRate);
      const tempo = estimateBpmAndBeats(
        flux,
        frameRate,
        mixData.durationSec,
        settings.timeSignature,
        settings.manualBpm
      );

      // 4) Vocal flux & YIN F0 pitch detection
      const vocalFluxInfo = computeSpectralFlux(vocalSamples, mixData.sampleRate);
      const pitchFrames = detectYinPitchFrames(
        vocalSamples,
        mixData.sampleRate,
        settings.sensitivity
      );

      let notes = segmentF0ToNotes(
        pitchFrames,
        vocalFluxInfo.flux,
        vocalFluxInfo.frameRate,
        tempo.bpm,
        settings
      );

      // 5) Suggest sections from track structure, OR prioritize user-defined sections
      const suggestedSections = suggestSectionsFromAudio(
        mixData.durationSec,
        tempo.bars,
        vocalSamples,
        mixData.sampleRate
      );

      const activeSections =
        Array.isArray(existingSections) && existingSections.length > 0
          ? existingSections
          : suggestedSections;

      // Respect user section vocal rules: filter out notes inside !allowVocals sections (e.g. INTRO, INTERLUDE)
      if (activeSections.length > 0) {
        const sortedSecs = [...activeSections].sort((a, b) => a.startSec - b.startSec);
        notes = notes
          .map((n) => {
            const mid = (n.startSec + n.endSec) / 2;
            const sec = sortedSecs.find((s) => mid >= s.startSec - 0.02 && mid < s.endSec + 0.02);
            return { ...n, sectionId: sec?.id, secAllowVocals: sec ? sec.allowVocals : true };
          })
          .filter((n) => n.secAllowVocals)
          .map(({ secAllowVocals: _ignored, ...rest }) => rest as UstNote);
      }

      const waveform = computeWaveformPeaks(mixData.samples, vocalSamples, 1000);

      const result: AudioAnalysisResult = {
        durationSec: Number(mixData.durationSec.toFixed(3)),
        sampleRate: mixData.sampleRate,
        channels,
        detectedBpm: tempo.bpm,
        bpmConfidence: Number(tempo.confidence.toFixed(2)),
        timeSignature: settings.timeSignature,
        beats: tempo.beats,
        bars: tempo.bars,
        waveform,
        notes,
        suggestedSections,
        vocalSeparationApplied: settings.vocalIsolation,
        separationMethod,
      };

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `음원 분석 실패: ${msg}` });
    } finally {
      await Promise.all([
        safeUnlink(uploadedPath),
        safeUnlink(mixWavPath),
        safeUnlink(vocalWavPath),
      ]);
    }
  });

  app.post('/api/ai/lyrics-phonetics', async (req, res) => {
    try {
      const { rawLyrics, language, aliasMode, customDictionary } = req.body as {
        rawLyrics?: string;
        language?: LyricLanguage;
        aliasMode?: AliasMode;
        customDictionary?: PronunciationDictEntry[];
      };

      if (typeof rawLyrics !== 'string') {
        res.status(400).json({ error: '가사 텍스트가 필요합니다.' });
        return;
      }

      const result = await convertLyricsWithGemini({
        rawLyrics,
        language: language || 'ko',
        aliasMode: aliasMode || 'CV',
        customDictionary: Array.isArray(customDictionary) ? customDictionary : [],
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `가사 음절/발음 변환 오류: ${msg}` });
    }
  });

  app.post('/api/ai/align-notes', async (req, res) => {
    try {
      const {
        notes,
        sections,
        syllables,
        language,
        aliasMode,
        tuningStyle,
        preserveManualEdits,
      } = req.body as {
        notes?: UstNote[];
        sections?: MusicSection[];
        syllables?: LyricSyllableToken[];
        language?: LyricLanguage;
        aliasMode?: AliasMode;
        tuningStyle?: 'natural' | 'accurate' | 'detailed' | 'pro';
        preserveManualEdits?: boolean;
      };

      const result = await alignLyricsToNotesWithSections({
        notes: Array.isArray(notes) ? notes : [],
        sections: Array.isArray(sections) ? sections : [],
        syllables: Array.isArray(syllables) ? syllables : [],
        language: language || 'ko',
        aliasMode: aliasMode || 'CV',
        tuningStyle: tuningStyle || 'pro',
        preserveManualEdits: preserveManualEdits !== false,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `음표-가사 배치 오류: ${msg}` });
    }
  });

  app.post('/api/ai/tuning-audit', async (req, res) => {
    try {
      const {
        notes,
        sections,
        syllables,
        language,
        aliasMode,
        tuningStyle,
        bpm,
        applyAutoFix,
        preserveManualEdits,
      } = req.body as {
        notes?: UstNote[];
        sections?: MusicSection[];
        syllables?: LyricSyllableToken[];
        language?: LyricLanguage;
        aliasMode?: AliasMode;
        tuningStyle?: 'natural' | 'accurate' | 'detailed' | 'pro';
        bpm?: number;
        applyAutoFix?: boolean;
        preserveManualEdits?: boolean;
      };

      const result = await auditAndCorrectTuning({
        notes: Array.isArray(notes) ? notes : [],
        sections: Array.isArray(sections) ? sections : [],
        syllables: Array.isArray(syllables) ? syllables : [],
        language: language || 'ko',
        aliasMode: aliasMode || 'CV',
        tuningStyle: tuningStyle || 'pro',
        bpm: Number(bpm) || 120,
        applyAutoFix: Boolean(applyAutoFix),
        preserveManualEdits: preserveManualEdits !== false,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `AI 조교 보정 오류: ${msg}` });
    }
  });

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`AI UST Creator server running on http://0.0.0.0:${port}`);
  });
}

createApp().catch((err) => {
  console.error('Failed to start AI UST Creator server:', err);
  process.exit(1);
});
