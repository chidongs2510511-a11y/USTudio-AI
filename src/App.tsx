import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import type {
  AliasMode,
  AlignmentWarning,
  AnalysisSettings,
  AudioAnalysisResult,
  LyricLanguage,
  LyricSyllableToken,
  MusicSection,
  PronunciationDictEntry,
  ProposedNoteEdit,
  TimeSignature,
  TuningAuditIssue,
  TuningStyle,
  UstNote,
  UstProjectFile,
} from './types/ust';
import { TopBar } from './components/TopBar';
import { LeftSidebar } from './components/LeftSidebar';
import { TimelineWaveform, type MonitorMode } from './components/TimelineWaveform';
import { PianoRoll } from './components/PianoRoll';
import { RightInspector } from './components/RightInspector';
import {
  DictionaryModal,
  OverwriteConfirmModal,
  SelfReviewModal,
  UstExportModal,
} from './components/Modals';
import {
  SECTION_CATEGORY_META,
  createDefaultSections,
  midiToFreq,
} from './utils/musicTheory';
import {
  fixOverlappingAndInvalidNotes,
  parseUstContent,
  validateUstProject,
} from './utils/ustExporter';

interface HistorySnapshot {
  notes: UstNote[];
  sections: MusicSection[];
}

const DEFAULT_SETTINGS: AnalysisSettings = {
  vocalIsolation: true,
  sensitivity: 0.65,
  quantizeGrid: '1/16',
  minNoteDurationMs: 85,
  timeSignature: '4/4',
  manualBpm: null,
};

export default function App() {
  const [projectName, setProjectName] = useState('Untitled UST Project');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AudioAnalysisResult | null>(null);
  const [analysisSettings, setAnalysisSettings] = useState<AnalysisSettings>(DEFAULT_SETTINGS);

  const [bpm, setBpm] = useState(120);
  const [timeSignature, setTimeSignature] = useState<TimeSignature>('4/4');
  const [durationSec, setDurationSec] = useState(96);
  const [sections, setSections] = useState<MusicSection[]>(() => createDefaultSections(96));
  const [hasUserEditedSections, setHasUserEditedSections] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>('sec-2');

  const [notes, setNotes] = useState<UstNote[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [clipboardNotes, setClipboardNotes] = useState<UstNote[]>([]);

  // Undo/Redo stacks
  const [historyPast, setHistoryPast] = useState<HistorySnapshot[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistorySnapshot[]>([]);

  // Lyrics & Phonetics state
  const [language, setLanguage] = useState<LyricLanguage>('ko');
  const [aliasMode, setAliasMode] = useState<AliasMode>('CV');
  const [tuningStyle, setTuningStyle] = useState<TuningStyle>('pro');
  const [rawLyrics, setRawLyrics] = useState('');
  const [syllables, setSyllables] = useState<LyricSyllableToken[]>([]);
  const [customDictionary, setCustomDictionary] = useState<PronunciationDictEntry[]>([]);
  const [alignmentWarnings, setAlignmentWarnings] = useState<AlignmentWarning[]>([]);
  const [phoneticNotice, setPhoneticNotice] = useState<string | null>(null);

  // Timeline / Piano Roll viewport
  const [pxPerSec, setPxPerSec] = useState(72);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [loopSection, setLoopSection] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [monitorMode, setMonitorMode] = useState<MonitorMode>('mix');

  // Async loading & modals & notifications
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConvertingLyrics, setIsConvertingLyrics] = useState(false);
  const [isAligning, setIsAligning] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isDictionaryOpen, setIsDictionaryOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [overwriteConfirm, setOverwriteConfirm] = useState<{
    action: 'analyze' | 'align';
    protectedCount: number;
  } | null>(null);
  const [selfReviewData, setSelfReviewData] = useState<{
    isOpen: boolean;
    summary: string;
    issues: TuningAuditIssue[];
    diffs: ProposedNoteEdit[];
    correctedNotes: UstNote[];
  } | null>(null);
  const [toast, setToast] = useState<{ type: 'error' | 'info'; text: string } | null>(null);

  // Web Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartCtxTimeRef = useRef(0);
  const playStartOffsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastMetroBeatRef = useRef<number>(-1);

  const showToast = useCallback((type: 'error' | 'info', text: string) => {
    setToast({ type, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Computed beat/bar grid when no audio is analyzed yet
  const effectiveBeats = useMemo(() => {
    if (
      analysisResult?.beats &&
      analysisResult.beats.length > 0 &&
      Math.abs(analysisResult.detectedBpm - bpm) < 0.2
    ) {
      return analysisResult.beats;
    }
    const step = 60 / Math.max(40, bpm);
    const out: number[] = [];
    for (let t = 0; t < durationSec; t += step) {
      out.push(Number(t.toFixed(4)));
    }
    return out;
  }, [analysisResult, bpm, durationSec]);

  const effectiveBars = useMemo(() => {
    if (
      analysisResult?.bars &&
      analysisResult.bars.length > 0 &&
      Math.abs(analysisResult.detectedBpm - bpm) < 0.2 &&
      analysisResult.timeSignature === timeSignature
    ) {
      return analysisResult.bars;
    }
    const beatsPerBar = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;
    return effectiveBeats.filter((_, idx) => idx % beatsPerBar === 0);
  }, [analysisResult, bpm, timeSignature, effectiveBeats]);

  const validationIssues = useMemo(
    () => validateUstProject(notes, bpm, sections),
    [notes, bpm, sections]
  );

  // History helpers
  const commitHistorySnapshot = useCallback(() => {
    setHistoryPast((prev) => [
      ...prev.slice(-39),
      {
        notes: notes.map((n) => ({ ...n })),
        sections: sections.map((s) => ({ ...s })),
      },
    ]);
    setHistoryFuture([]);
  }, [notes, sections]);

  const handleChangeNotes = useCallback(
    (nextNotes: UstNote[], recordHistory = true) => {
      if (recordHistory) {
        commitHistorySnapshot();
      }
      setNotes(nextNotes);
    },
    [commitHistorySnapshot]
  );

  const handleUndo = useCallback(() => {
    if (historyPast.length === 0) return;
    const previous = historyPast[historyPast.length - 1];
    setHistoryFuture((f) => [
      {
        notes: notes.map((n) => ({ ...n })),
        sections: sections.map((s) => ({ ...s })),
      },
      ...f.slice(0, 39),
    ]);
    setHistoryPast((p) => p.slice(0, -1));
    setNotes(previous.notes);
    setSections(previous.sections);
  }, [historyPast, notes, sections]);

  const handleRedo = useCallback(() => {
    if (historyFuture.length === 0) return;
    const next = historyFuture[0];
    setHistoryPast((p) => [
      ...p.slice(-39),
      {
        notes: notes.map((n) => ({ ...n })),
        sections: sections.map((s) => ({ ...s })),
      },
    ]);
    setHistoryFuture((f) => f.slice(1));
    setNotes(next.notes);
    setSections(next.sections);
  }, [historyFuture, notes, sections]);

  // Web Audio playback engine (plays ONLY uploaded reference audio + optional metronome click)
  const stopAudioEngine = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const triggerMetronomeClick = useCallback((isDownbeat: boolean) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = isDownbeat ? 1100 : 780;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.045);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  }, []);

  const startPlaybackFrom = useCallback(
    async (startSec: number) => {
      if (!audioBuffer) return;
      stopAudioEngine();

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      if (monitorMode === 'mix') {
        source.connect(ctx.destination);
      } else if (monitorMode === 'vocal' && audioBuffer.numberOfChannels >= 2) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 120;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3800;
        const splitter = ctx.createChannelSplitter(2);
        const merger = ctx.createGain();
        merger.gain.value = 0.6;
        source.connect(splitter);
        splitter.connect(merger, 0);
        splitter.connect(merger, 1);
        merger.connect(hp);
        hp.connect(lp);
        lp.connect(ctx.destination);
      } else if (monitorMode === 'inst' && audioBuffer.numberOfChannels >= 2) {
        const splitter = ctx.createChannelSplitter(2);
        const inv = ctx.createGain();
        inv.gain.value = -1;
        const sum = ctx.createGain();
        sum.gain.value = 0.7;
        source.connect(splitter);
        splitter.connect(sum, 0);
        splitter.connect(inv, 1);
        inv.connect(sum);
        sum.connect(ctx.destination);
      } else {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 120;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3600;
        source.connect(hp);
        hp.connect(lp);
        lp.connect(ctx.destination);
      }

      const clampedStart = Math.max(0, Math.min(audioBuffer.duration - 0.05, startSec));
      playStartCtxTimeRef.current = ctx.currentTime;
      playStartOffsetRef.current = clampedStart;
      lastMetroBeatRef.current = Math.floor((clampedStart * bpm) / 60);

      source.start(0, clampedStart);
      sourceNodeRef.current = source;
      setIsPlaying(true);

      const loopSecObj = loopSection
        ? sections.find((s) => s.id === selectedSectionId) || null
        : null;

      const tick = () => {
        const current =
          playStartOffsetRef.current + (ctx.currentTime - playStartCtxTimeRef.current);

        if (loopSecObj && current >= loopSecObj.endSec) {
          startPlaybackFrom(loopSecObj.startSec);
          return;
        }

        if (current >= audioBuffer.duration) {
          setPlayheadSec(0);
          stopAudioEngine();
          return;
        }

        if (metronomeEnabled) {
          const beatIdx = Math.floor((current * bpm) / 60);
          if (beatIdx > lastMetroBeatRef.current) {
            lastMetroBeatRef.current = beatIdx;
            const beatsPerBar = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;
            triggerMetronomeClick(beatIdx % beatsPerBar === 0);
          }
        }

        setPlayheadSec(current);
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [
      audioBuffer,
      bpm,
      loopSection,
      metronomeEnabled,
      monitorMode,
      sections,
      selectedSectionId,
      stopAudioEngine,
      timeSignature,
      triggerMetronomeClick,
    ]
  );

  const handleTogglePlay = useCallback(() => {
    if (!audioBuffer) return;
    if (isPlaying) {
      stopAudioEngine();
    } else {
      startPlaybackFrom(playheadSec);
    }
  }, [audioBuffer, isPlaying, playheadSec, startPlaybackFrom, stopAudioEngine]);

  const handleStop = useCallback(() => {
    stopAudioEngine();
    setPlayheadSec(0);
  }, [stopAudioEngine]);

  const handleSeek = useCallback(
    (sec: number) => {
      setPlayheadSec(sec);
      if (isPlaying) {
        startPlaybackFrom(sec);
      }
    },
    [isPlaying, startPlaybackFrom]
  );

  useEffect(() => {
    if (isPlaying) {
      startPlaybackFrom(playheadSec);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorMode, loopSection, metronomeEnabled]);

  useEffect(() => {
    return () => stopAudioEngine();
  }, [stopAudioEngine]);

  // Handle Audio File Upload & Browser Decode
  const handleAudioFileSelect = async (file: File) => {
    stopAudioEngine();
    setAudioFile(file);
    setPlayheadSec(0);
    if (projectName === 'Untitled UST Project') {
      const baseName = file.name.replace(/\.[^.]+$/, '');
      setProjectName(baseName || 'Untitled UST Project');
    }

    try {
      const arrayBuf = await file.arrayBuffer();
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const decoded = await audioCtxRef.current.decodeAudioData(arrayBuf.slice(0));
      setAudioBuffer(decoded);
      setDurationSec(Number(decoded.duration.toFixed(3)));
      if (!hasUserEditedSections) {
        setSections(createDefaultSections(decoded.duration));
      }
      showToast(
        'info',
        `${file.name} 로드 완료 (${decoded.duration.toFixed(1)}초). '음원 멜로디 분석 실행'을 클릭하세요.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `오디오 디코딩 실패: ${msg}`);
    }
  };

  // Run Server DSP Audio Analysis (FFmpeg + YIN F0 + Spectral Flux BPM)
  const executeAudioAnalysis = async (preserveManualEdits: boolean) => {
    if (!audioFile) {
      showToast('error', '먼저 분석할 MP3 또는 WAV 음원 파일을 업로드하세요.');
      return;
    }

    setIsAnalyzing(true);
    try {
      const form = new FormData();
      form.append('audio', audioFile);
      form.append('settings', JSON.stringify(analysisSettings));
      if (hasUserEditedSections) {
        form.append('existingSections', JSON.stringify(sections));
      }

      const res = await fetch('/api/analyze-audio', {
        method: 'POST',
        body: form,
      });

      const data = (await res.json()) as AudioAnalysisResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || '서버 오디오 분석 오류');
      }

      commitHistorySnapshot();
      setAnalysisResult(data);
      setDurationSec(data.durationSec);
      setBpm(data.detectedBpm);
      setTimeSignature(data.timeSignature);

      if (!hasUserEditedSections && data.suggestedSections.length > 0) {
        setSections(data.suggestedSections);
        setSelectedSectionId(
          data.suggestedSections[1]?.id || data.suggestedSections[0]?.id || null
        );
      }

      if (preserveManualEdits) {
        const protectedNotes = notes.filter((n) => n.userModified);
        const nonOverlappingFresh = data.notes.filter(
          (fn) =>
            !protectedNotes.some(
              (pn) => fn.startSec < pn.endSec - 0.01 && fn.endSec > pn.startSec + 0.01
            )
        );
        const merged = [...protectedNotes, ...nonOverlappingFresh].sort(
          (a, b) => a.startSec - b.startSec
        );
        setNotes(merged);
        showToast(
          'info',
          `음원 분석 완료: 수동 수정 음표 ${protectedNotes.length}개 보호 후 총 ${merged.length}개 음표 반영`
        );
      } else {
        setNotes(data.notes);
        showToast(
          'info',
          `음원 분석 완료: ${data.detectedBpm.toFixed(1)} BPM, ${data.notes.length}개 음표 추출됨`
        );
      }
      setSelectedNoteIds([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', msg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRunAudioAnalysis = () => {
    if (!audioFile) {
      showToast('error', '먼저 분석할 MP3 또는 WAV 음원 파일을 업로드하세요.');
      return;
    }
    const protectedCount = notes.filter((n) => n.userModified).length;
    if (protectedCount > 0) {
      setOverwriteConfirm({ action: 'analyze', protectedCount });
      return;
    }
    void executeAudioAnalysis(false);
  };

  // Convert Lyrics to Syllables & Multilingual Phonetics
  const handleConvertLyrics = async (): Promise<LyricSyllableToken[] | null> => {
    if (!rawLyrics.trim()) {
      showToast('error', '변환할 가사를 입력하세요.');
      return null;
    }

    setIsConvertingLyrics(true);
    setPhoneticNotice(null);
    try {
      const res = await fetch('/api/ai/lyrics-phonetics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawLyrics,
          language,
          aliasMode,
          customDictionary,
        }),
      });
      const data = (await res.json()) as {
        tokens?: LyricSyllableToken[];
        usedGemini?: boolean;
        warning?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || '가사 발음 변환 실패');
      }
      const nextTokens = data.tokens || [];
      setSyllables(nextTokens);
      if (data.warning) {
        setPhoneticNotice(data.warning);
      }
      showToast('info', `가사 ${nextTokens.length}음절 및 발음 변환 완료`);
      return nextTokens;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', msg);
      return null;
    } finally {
      setIsConvertingLyrics(false);
    }
  };

  // Section-Aware AI Note + Lyric Alignment
  const executeAlignLyrics = async (preserveManualEdits: boolean) => {
    let activeTokens = syllables;
    if (activeTokens.length === 0 && rawLyrics.trim()) {
      const converted = await handleConvertLyrics();
      if (converted) activeTokens = converted;
    }

    if (notes.length === 0) {
      showToast('error', '먼저 음원을 분석하거나 피아노 롤에 음표를 생성하세요.');
      return;
    }

    setIsAligning(true);
    try {
      const res = await fetch('/api/ai/align-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes,
          sections,
          syllables: activeTokens,
          language,
          aliasMode,
          tuningStyle,
          preserveManualEdits,
        }),
      });

      const data = (await res.json()) as {
        notes?: UstNote[];
        warnings?: AlignmentWarning[];
        usedGemini?: boolean;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || '음표 배치 실패');
      }

      commitHistorySnapshot();
      setNotes(data.notes || []);
      setAlignmentWarnings(data.warnings || []);
      showToast(
        'info',
        preserveManualEdits
          ? '수동 편집 음표를 보호하며 전문 조교 배치를 완료했습니다.'
          : '구간 구조 및 가사 음절에 맞춰 전체 음표 조교를 재적용했습니다.'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', msg);
    } finally {
      setIsAligning(false);
    }
  };

  const handleAlignLyrics = () => {
    if (notes.length === 0) {
      showToast('error', '먼저 음원을 분석하거나 피아노 롤에 음표를 생성하세요.');
      return;
    }
    const protectedCount = notes.filter((n) => n.userModified).length;
    if (protectedCount > 0) {
      setOverwriteConfirm({ action: 'align', protectedCount });
      return;
    }
    void executeAlignLyrics(true);
  };

  // AI Self-Review & Proposed Correction Approval
  const handleRunSelfReview = async () => {
    if (notes.length === 0) {
      showToast('error', '검수할 음표가 없습니다.');
      return;
    }
    setIsAuditing(true);
    try {
      const res = await fetch('/api/ai/tuning-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes,
          sections,
          syllables,
          language,
          aliasMode,
          tuningStyle,
          bpm,
          applyAutoFix: true,
          preserveManualEdits: true,
        }),
      });

      const data = (await res.json()) as {
        issues?: TuningAuditIssue[];
        correctedNotes?: UstNote[];
        proposedDiffs?: ProposedNoteEdit[];
        reviewSummary?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'AI 자체 조교 검수 실패');
      }

      setSelfReviewData({
        isOpen: true,
        summary: data.reviewSummary || 'AI 자체 조교 검수가 완료되었습니다.',
        issues: data.issues || [],
        diffs: data.proposedDiffs || [],
        correctedNotes: data.correctedNotes || notes,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', msg);
    } finally {
      setIsAuditing(false);
    }
  };

  const handleApproveSelfReview = () => {
    if (!selfReviewData) return;
    commitHistorySnapshot();
    setNotes(selfReviewData.correctedNotes);
    setSelfReviewData(null);
    showToast('info', 'AI 보정안이 승인되어 피아노 롤 및 UST에 반영되었습니다.');
  };

  // TopBar Combined AI Analysis Action
  const handleRunTopAiAnalysis = async () => {
    if (!audioFile) {
      showToast('error', '왼쪽 패널에서 MP3/WAV 음원을 먼저 업로드하세요.');
      return;
    }
    handleRunAudioAnalysis();
  };

  // Syllable Split & Merge Handlers
  const handleSplitSyllable = (id: string) => {
    const idx = syllables.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const tok = syllables[idx];
    const chars = Array.from(tok.text.trim());
    let first: LyricSyllableToken;
    let second: LyricSyllableToken;

    if (chars.length >= 2) {
      const half = Math.ceil(chars.length / 2);
      const t1 = chars.slice(0, half).join('');
      const t2 = chars.slice(half).join('');
      const pHalf = Math.ceil(tok.pronunciation.length / 2);
      const p1 = tok.pronunciation.slice(0, pHalf) || t1;
      const p2 = tok.pronunciation.slice(pHalf) || t2;
      first = { ...tok, text: t1, pronunciation: p1, alias: p1 };
      second = {
        ...tok,
        id: `${tok.id}-sp-${Date.now()}`,
        text: t2,
        pronunciation: p2,
        alias: aliasMode === 'VCV' ? `- ${p2}` : p2,
      };
    } else {
      first = tok;
      second = {
        ...tok,
        id: `${tok.id}-sp-${Date.now()}`,
        text: '-',
        pronunciation: '-',
        alias: aliasMode === 'VCV' ? '- -' : '-',
      };
    }

    const next = [...syllables];
    next.splice(idx, 1, first, second);
    setSyllables(next);
  };

  const handleMergeSyllableWithNext = (id: string) => {
    const idx = syllables.findIndex((s) => s.id === id);
    if (idx < 0 || idx >= syllables.length - 1) return;
    const cur = syllables[idx];
    const nxt = syllables[idx + 1];
    const mergedText = nxt.text === '-' ? cur.text : `${cur.text}${nxt.text}`;
    const mergedPron =
      nxt.pronunciation === '-'
        ? cur.pronunciation
        : `${cur.pronunciation}${nxt.pronunciation}`;
    const mergedAlias =
      nxt.alias === '-' || nxt.alias === '- -' ? cur.alias : `${cur.alias}${nxt.alias}`;

    const merged: LyricSyllableToken = {
      ...cur,
      text: mergedText,
      pronunciation: mergedPron,
      alias: mergedAlias,
    };
    const next = [...syllables];
    next.splice(idx, 2, merged);
    setSyllables(next);
  };

  // Section Management Handlers (User overrides prioritized)
  const handleUpdateSection = (sectionId: string, patch: Partial<MusicSection>) => {
    commitHistorySnapshot();
    setHasUserEditedSections(true);
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, ...patch } : s))
    );
  };

  const handleResizeBoundary = useCallback(
    (leftId: string, rightId: string | null, newTimeSec: number) => {
      setHasUserEditedSections(true);
      setSections((prev) => {
        const left = prev.find((s) => s.id === leftId);
        if (!left) return prev;
        const right = rightId ? prev.find((s) => s.id === rightId) : null;
        const minLeftEnd = left.startSec + 0.5;
        const maxLeftEnd = right ? right.endSec - 0.5 : Math.max(durationSec, newTimeSec);
        const clamped = Number(
          Math.max(minLeftEnd, Math.min(maxLeftEnd, newTimeSec)).toFixed(2)
        );
        return prev.map((s) => {
          if (s.id === leftId) return { ...s, endSec: clamped };
          if (right && s.id === right.id) return { ...s, startSec: clamped };
          return s;
        });
      });
    },
    [durationSec]
  );

  const handleAddSection = () => {
    commitHistorySnapshot();
    setHasUserEditedSections(true);
    const last = sections[sections.length - 1];
    const startSec = last ? last.endSec : 0;
    const endSec = Number((startSec + 10).toFixed(2));
    if (endSec > durationSec) {
      setDurationSec(endSec);
    }
    const newSec: MusicSection = {
      id: `sec-${Date.now()}`,
      name: `SECTION ${sections.length + 1}`,
      category: 'verse',
      startSec,
      endSec,
      color: SECTION_CATEGORY_META.verse.color,
      allowVocals: true,
    };
    setSections([...sections, newSec]);
    setSelectedSectionId(newSec.id);
  };

  const handleSplitSection = (sectionId: string) => {
    const idx = sections.findIndex((s) => s.id === sectionId);
    if (idx < 0) return;
    const target = sections[idx];
    if (target.endSec - target.startSec < 1.0) return;
    commitHistorySnapshot();
    setHasUserEditedSections(true);

    const splitAt =
      playheadSec > target.startSec + 0.4 && playheadSec < target.endSec - 0.4
        ? Number(playheadSec.toFixed(2))
        : Number(((target.startSec + target.endSec) / 2).toFixed(2));

    const first: MusicSection = { ...target, endSec: splitAt };
    const second: MusicSection = {
      ...target,
      id: `sec-${Date.now()}`,
      name: `${target.name} B`,
      startSec: splitAt,
    };

    const next = [...sections];
    next.splice(idx, 1, first, second);
    setSections(next);
    setSelectedSectionId(second.id);
  };

  const handleMergeWithNext = (sectionId: string) => {
    const idx = sections.findIndex((s) => s.id === sectionId);
    if (idx < 0 || idx >= sections.length - 1) return;
    commitHistorySnapshot();
    setHasUserEditedSections(true);
    const merged: MusicSection = {
      ...sections[idx],
      endSec: sections[idx + 1].endSec,
    };
    const next = [...sections];
    next.splice(idx, 2, merged);
    setSections(next);
  };

  const handleDeleteSection = (sectionId: string) => {
    if (sections.length <= 1) return;
    commitHistorySnapshot();
    setHasUserEditedSections(true);
    const next = sections.filter((s) => s.id !== sectionId);
    setSections(next);
    if (selectedSectionId === sectionId) {
      setSelectedSectionId(next[0]?.id || null);
    }
  };

  const handleResetSections = () => {
    commitHistorySnapshot();
    setHasUserEditedSections(false);
    const fresh = createDefaultSections(durationSec);
    setSections(fresh);
    setSelectedSectionId(fresh[1]?.id || fresh[0]?.id || null);
  };

  // Note Inspector, Phrase & Clipboard Handlers
  const handleUpdateNote = (noteId: string, patch: Partial<UstNote>) => {
    commitHistorySnapshot();
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id !== noteId) return n;
        const merged = { ...n, ...patch };
        if (patch.midi !== undefined) {
          merged.frequencyHz = Number(midiToFreq(patch.midi).toFixed(2));
        }
        return merged;
      })
    );
  };

  const handleRestoreOriginalNote = (noteId: string) => {
    const target = notes.find((n) => n.id === noteId);
    if (!target) return;
    commitHistorySnapshot();
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id !== noteId) return n;
        const restoredMidi = n.originalMidi ?? n.midi;
        return {
          ...n,
          midi: restoredMidi,
          startSec: n.originalStartSec ?? n.startSec,
          endSec: n.originalEndSec ?? n.endSec,
          frequencyHz: Number(midiToFreq(restoredMidi).toFixed(2)),
          userModified: false,
        };
      })
    );
    showToast('info', '원본 분석 음정 및 타이밍으로 복원했습니다.');
  };

  const handleDeleteSelectedNotes = useCallback(() => {
    if (selectedNoteIds.length === 0) return;
    commitHistorySnapshot();
    const delSet = new Set(selectedNoteIds);
    setNotes((prev) => prev.filter((n) => !delSet.has(n.id)));
    setSelectedNoteIds([]);
  }, [commitHistorySnapshot, selectedNoteIds]);

  const handleDuplicateSelectedNotes = useCallback(() => {
    if (selectedNoteIds.length === 0) return;
    const sel = notes
      .filter((n) => selectedNoteIds.includes(n.id))
      .sort((a, b) => a.startSec - b.startSec);
    if (sel.length === 0) return;
    const minStart = sel[0].startSec;
    const maxEnd = Math.max(...sel.map((n) => n.endSec));
    const offset = maxEnd - minStart + 0.05;

    commitHistorySnapshot();
    const clones = sel.map((n, idx) => ({
      ...n,
      id: `note-dup-${Date.now()}-${idx}`,
      startSec: Number((n.startSec + offset).toFixed(4)),
      endSec: Number((n.endSec + offset).toFixed(4)),
      userModified: true,
    }));
    setNotes((prev) => [...prev, ...clones]);
    setSelectedNoteIds(clones.map((c) => c.id));
  }, [commitHistorySnapshot, notes, selectedNoteIds]);

  const handleSplitNote = (noteId: string) => {
    const target = notes.find((n) => n.id === noteId);
    if (!target || target.endSec - target.startSec < 0.08) return;
    commitHistorySnapshot();
    const mid = Number(((target.startSec + target.endSec) / 2).toFixed(4));
    const left: UstNote = { ...target, endSec: mid, userModified: true };
    const right: UstNote = {
      ...target,
      id: `${target.id}-split-${Date.now()}`,
      startSec: mid,
      lyric: '-',
      pronunciation: '-',
      alias: aliasMode === 'VCV' ? '- -' : '-',
      userModified: true,
    };
    setNotes((prev) => prev.flatMap((n) => (n.id === noteId ? [left, right] : [n])));
    setSelectedNoteIds([left.id, right.id]);
  };

  const handleMergeWithNextNote = (noteId: string) => {
    const sorted = [...notes].sort((a, b) => a.startSec - b.startSec);
    const idx = sorted.findIndex((n) => n.id === noteId);
    if (idx < 0 || idx >= sorted.length - 1) return;
    const cur = sorted[idx];
    const nxt = sorted[idx + 1];
    commitHistorySnapshot();
    const merged: UstNote = {
      ...cur,
      endSec: Math.max(cur.endSec, nxt.endSec),
      userModified: true,
    };
    const nextList = sorted.filter((n) => n.id !== nxt.id).map((n) => (n.id === cur.id ? merged : n));
    setNotes(nextList);
    setSelectedNoteIds([merged.id]);
  };

  const handleShiftLyrics = (direction: 'left' | 'right') => {
    if (selectedNoteIds.length === 0) return;
    const sorted = [...notes].sort((a, b) => a.startSec - b.startSec);
    const anchorIdx = sorted.findIndex((n) => selectedNoteIds.includes(n.id));
    if (anchorIdx < 0) return;

    commitHistorySnapshot();
    const startIdx = direction === 'left' ? Math.max(0, anchorIdx - 1) : anchorIdx;
    const cloned = sorted.map((n) => ({ ...n }));

    if (direction === 'left') {
      for (let i = startIdx; i < cloned.length - 1; i++) {
        cloned[i].lyric = cloned[i + 1].lyric;
        cloned[i].pronunciation = cloned[i + 1].pronunciation;
        cloned[i].alias = cloned[i + 1].alias;
        cloned[i].phonemeError = cloned[i + 1].phonemeError;
        cloned[i].userModified = true;
      }
      const last = cloned[cloned.length - 1];
      last.lyric = '-';
      last.pronunciation = '-';
      last.alias = aliasMode === 'VCV' ? '- -' : '-';
      last.phonemeError = undefined;
      last.userModified = true;
    } else {
      for (let i = cloned.length - 1; i > startIdx; i--) {
        cloned[i].lyric = cloned[i - 1].lyric;
        cloned[i].pronunciation = cloned[i - 1].pronunciation;
        cloned[i].alias = cloned[i - 1].alias;
        cloned[i].phonemeError = cloned[i - 1].phonemeError;
        cloned[i].userModified = true;
      }
      const first = cloned[startIdx];
      first.lyric = '-';
      first.pronunciation = '-';
      first.alias = aliasMode === 'VCV' ? '- -' : '-';
      first.phonemeError = undefined;
      first.userModified = true;
    }

    setNotes(cloned);
  };

  const handleSelectPhrase = () => {
    if (selectedNoteIds.length === 0) return;
    const sorted = [...notes].sort((a, b) => a.startSec - b.startSec);
    const anchor = sorted.find((n) => selectedNoteIds.includes(n.id));
    if (!anchor) return;

    if (anchor.phraseId) {
      const samePhrase = sorted.filter((n) => n.phraseId === anchor.phraseId).map((n) => n.id);
      if (samePhrase.length > 0) {
        setSelectedNoteIds(samePhrase);
        return;
      }
    }

    const idx = sorted.findIndex((n) => n.id === anchor.id);
    let left = idx;
    while (left > 0 && sorted[left].startSec - sorted[left - 1].endSec < 0.35) {
      left--;
    }
    let right = idx;
    while (right < sorted.length - 1 && sorted[right + 1].startSec - sorted[right].endSec < 0.35) {
      right++;
    }
    setSelectedNoteIds(sorted.slice(left, right + 1).map((n) => n.id));
  };

  // Global Keyboard Shortcuts (Undo, Redo, Copy, Paste, Delete, Spacebar Play)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          const copied = notes.filter((n) => selectedNoteIds.includes(n.id));
          setClipboardNotes(copied);
          showToast('info', `${copied.length}개 음표 복사됨`);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboardNotes.length > 0) {
          e.preventDefault();
          const sorted = [...clipboardNotes].sort((a, b) => a.startSec - b.startSec);
          const baseStart = sorted[0].startSec;
          commitHistorySnapshot();
          const pasted = sorted.map((n, idx) => {
            const rel = n.startSec - baseStart;
            const dur = n.endSec - n.startSec;
            const ns = Number((playheadSec + rel).toFixed(4));
            return {
              ...n,
              id: `note-paste-${Date.now()}-${idx}`,
              startSec: ns,
              endSec: Number((ns + dur).toFixed(4)),
              userModified: true,
            };
          });
          setNotes((prev) => [...prev, ...pasted]);
          setSelectedNoteIds(pasted.map((p) => p.id));
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNoteIds.length > 0) {
          e.preventDefault();
          handleDeleteSelectedNotes();
        }
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    clipboardNotes,
    commitHistorySnapshot,
    handleDeleteSelectedNotes,
    handleRedo,
    handleTogglePlay,
    handleUndo,
    notes,
    playheadSec,
    selectedNoteIds,
    showToast,
  ]);

  // Project Save / Load / New (.ustproj.json and .ust round-trip)
  const handleNewProject = () => {
    stopAudioEngine();
    setProjectName('Untitled UST Project');
    setAudioFile(null);
    setAudioBuffer(null);
    setAnalysisResult(null);
    setBpm(120);
    setDurationSec(96);
    setSections(createDefaultSections(96));
    setHasUserEditedSections(false);
    setNotes([]);
    setSelectedNoteIds([]);
    setRawLyrics('');
    setSyllables([]);
    setAlignmentWarnings([]);
    setHistoryPast([]);
    setHistoryFuture([]);
    setPlayheadSec(0);
    showToast('info', '새 프로젝트가 초기화되었습니다.');
  };

  const handleSaveProject = () => {
    const project: UstProjectFile = {
      version: '1.1.0',
      name: projectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      audioFileName: audioFile?.name || null,
      durationSec,
      bpm,
      timeSignature,
      language,
      aliasMode,
      tuningStyle,
      rawLyrics,
      syllables,
      customDictionary,
      sections,
      notes,
      analysisSettings,
    };

    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (projectName || 'project').replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    a.download = `${safeName}.ustproj.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('info', `${safeName}.ustproj.json 저장 완료`);
  };

  const handleLoadProject = async (file: File) => {
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.ust')) {
        const parsed = parseUstContent(text);
        if (parsed.notes.length === 0) {
          throw new Error('.ust 파일에서 불러올 수 있는 음표가 없습니다.');
        }
        commitHistorySnapshot();
        setProjectName(parsed.projectName || file.name.replace(/\.ust$/i, ''));
        setBpm(parsed.bpm);
        setDurationSec(parsed.durationSec);
        const defaultSecs = createDefaultSections(parsed.durationSec);
        setSections(defaultSecs);
        setHasUserEditedSections(false);
        setSelectedSectionId(defaultSecs[1]?.id || defaultSecs[0]?.id || null);
        setNotes(parsed.notes);
        setSelectedNoteIds([]);
        showToast(
          'info',
          `UST 파일 불러오기 완료 (${parsed.notes.length}개 음표, ${parsed.bpm} BPM, 조교 정보 유지됨)`
        );
        return;
      }

      const data = JSON.parse(text) as UstProjectFile;
      if (!data || !Array.isArray(data.notes) || !Array.isArray(data.sections)) {
        throw new Error('올바른 .ustproj.json 또는 .ust 파일이 아닙니다.');
      }
      commitHistorySnapshot();
      setProjectName(data.name || 'Loaded Project');
      setDurationSec(data.durationSec || 96);
      setBpm(data.bpm || 120);
      setTimeSignature(data.timeSignature || '4/4');
      setLanguage(data.language || 'ko');
      setAliasMode(data.aliasMode || 'CV');
      if (data.tuningStyle) setTuningStyle(data.tuningStyle);
      setRawLyrics(data.rawLyrics || '');
      setSyllables(data.syllables || []);
      setCustomDictionary(data.customDictionary || []);
      setSections(data.sections);
      setHasUserEditedSections(true);
      setNotes(data.notes);
      setSelectedNoteIds([]);
      if (data.analysisSettings) setAnalysisSettings(data.analysisSettings);
      showToast(
        'info',
        `프로젝트 불러오기 완료 (${data.notes.length}개 음표). 원음 재생이 필요하면 음원 파일을 다시 연결하세요.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `파일 불러오기 실패: ${msg}`);
    }
  };

  // Dictionary application
  const handleApplyDictionary = () => {
    commitHistorySnapshot();
    const applyToItem = <
      T extends { text?: string; lyric?: string; pronunciation: string; alias: string },
    >(
      item: T
    ): T => {
      const key = (item.text ?? item.lyric ?? '').trim().toLowerCase();
      const hit = customDictionary.find(
        (d) =>
          (d.language === 'all' || d.language === language) &&
          d.source.trim().toLowerCase() === key
      );
      if (!hit) return item;
      return {
        ...item,
        pronunciation: hit.pronunciation,
        alias: hit.alias || hit.pronunciation,
      };
    };

    setSyllables((prev) => prev.map((s) => applyToItem(s)));
    setNotes((prev) => prev.map((n) => applyToItem(n)));
    showToast('info', '발음 사전 규칙을 현재 음절과 음표에 적용했습니다.');
  };

  const selectedNotes = useMemo(
    () => notes.filter((n) => selectedNoteIds.includes(n.id)),
    [notes, selectedNoteIds]
  );

  const selectedSection = useMemo(
    () => sections.find((s) => s.id === selectedSectionId) || null,
    [sections, selectedSectionId]
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0B0D14] text-slate-100 overflow-hidden">
      {/* Top Bar */}
      <TopBar
        projectName={projectName}
        onProjectNameChange={setProjectName}
        onNewProject={handleNewProject}
        onSaveProject={handleSaveProject}
        onLoadProject={handleLoadProject}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={historyPast.length > 0}
        canRedo={historyFuture.length > 0}
        onRunAiAnalysis={handleRunTopAiAnalysis}
        isAnalyzing={isAnalyzing}
        hasAudio={Boolean(audioFile)}
        onOpenExport={() => setIsExportOpen(true)}
      />

      {/* Main 3-Column DAW Workspace */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <LeftSidebar
          audioFile={audioFile}
          analysisResult={analysisResult}
          analysisSettings={analysisSettings}
          isAnalyzing={isAnalyzing}
          onAudioFileSelect={handleAudioFileSelect}
          onUpdateSettings={(patch) => {
            setAnalysisSettings((prev) => ({ ...prev, ...patch }));
            if (patch.timeSignature) setTimeSignature(patch.timeSignature);
            if (patch.manualBpm) setBpm(patch.manualBpm);
          }}
          onRunAudioAnalysis={handleRunAudioAnalysis}
          language={language}
          aliasMode={aliasMode}
          tuningStyle={tuningStyle}
          rawLyrics={rawLyrics}
          syllables={syllables}
          notes={notes}
          alignmentWarnings={alignmentWarnings}
          isConvertingLyrics={isConvertingLyrics}
          isAligning={isAligning}
          isAuditing={isAuditing}
          phoneticNotice={phoneticNotice}
          onLanguageChange={setLanguage}
          onAliasModeChange={setAliasMode}
          onTuningStyleChange={setTuningStyle}
          onRawLyricsChange={setRawLyrics}
          onConvertLyrics={handleConvertLyrics}
          onAlignLyrics={handleAlignLyrics}
          onRunSelfReview={handleRunSelfReview}
          onUpdateSyllable={(id, patch) =>
            setSyllables((prev) =>
              prev.map((t) =>
                t.id === id ? { ...t, ...patch, phonemeError: undefined } : t
              )
            )
          }
          onSplitSyllable={handleSplitSyllable}
          onMergeSyllableWithNext={handleMergeSyllableWithNext}
          onOpenDictionary={() => setIsDictionaryOpen(true)}
        />

        {/* Center: Upper Timeline + Lower Piano Roll */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <TimelineWaveform
            durationSec={durationSec}
            bpm={bpm}
            timeSignature={timeSignature}
            bars={effectiveBars}
            beats={effectiveBeats}
            waveform={analysisResult?.waveform || []}
            sections={sections}
            selectedSectionId={selectedSectionId}
            playheadSec={playheadSec}
            isPlaying={isPlaying}
            hasAudio={Boolean(audioBuffer)}
            loopSection={loopSection}
            metronomeEnabled={metronomeEnabled}
            monitorMode={monitorMode}
            pxPerSec={pxPerSec}
            scrollLeft={scrollLeft}
            snapEnabled={snapEnabled}
            onScrollLeftChange={setScrollLeft}
            onZoomChange={setPxPerSec}
            onTogglePlay={handleTogglePlay}
            onStop={handleStop}
            onSeek={handleSeek}
            onToggleLoopSection={() => setLoopSection((v) => !v)}
            onToggleMetronome={() => setMetronomeEnabled((v) => !v)}
            onMonitorModeChange={setMonitorMode}
            onToggleSnap={() => setSnapEnabled((v) => !v)}
            onSelectSection={setSelectedSectionId}
            onUpdateSection={handleUpdateSection}
            onResizeBoundary={handleResizeBoundary}
            onAddSection={handleAddSection}
            onSplitSection={handleSplitSection}
            onMergeWithNext={handleMergeWithNext}
            onDeleteSection={handleDeleteSection}
            onResetSections={handleResetSections}
          />

          <PianoRoll
            notes={notes}
            sections={sections}
            selectedNoteIds={selectedNoteIds}
            bpm={bpm}
            durationSec={durationSec}
            playheadSec={playheadSec}
            bars={effectiveBars}
            beats={effectiveBeats}
            pxPerSec={pxPerSec}
            scrollLeft={scrollLeft}
            snapEnabled={snapEnabled}
            quantizeGrid={analysisSettings.quantizeGrid}
            onScrollLeftChange={setScrollLeft}
            onSelectNotes={setSelectedNoteIds}
            onChangeNotes={handleChangeNotes}
            onCommitHistorySnapshot={commitHistorySnapshot}
            onZoomChange={setPxPerSec}
            onQuantizeGridChange={(grid) =>
              setAnalysisSettings((prev) => ({ ...prev, quantizeGrid: grid }))
            }
            onToggleSnap={() => setSnapEnabled((v) => !v)}
            onSelectPhrase={handleSelectPhrase}
            onShiftLyrics={handleShiftLyrics}
            onSplitSelectedNote={() => {
              if (selectedNoteIds.length === 1) handleSplitNote(selectedNoteIds[0]);
            }}
            onMergeSelectedWithNext={() => {
              if (selectedNoteIds.length === 1) handleMergeWithNextNote(selectedNoteIds[0]);
            }}
          />
        </main>

        {/* Right Inspector */}
        <RightInspector
          selectedNotes={selectedNotes}
          selectedSection={selectedSection}
          allNotes={notes}
          bpm={bpm}
          durationSec={durationSec}
          validationIssues={validationIssues}
          onUpdateNote={handleUpdateNote}
          onRestoreOriginalNote={handleRestoreOriginalNote}
          onDeleteSelectedNotes={handleDeleteSelectedNotes}
          onDuplicateSelectedNotes={handleDuplicateSelectedNotes}
          onSplitNote={handleSplitNote}
          onMergeWithNextNote={handleMergeWithNextNote}
          onShiftLyrics={handleShiftLyrics}
          onSelectPhrase={handleSelectPhrase}
          onUpdateSection={handleUpdateSection}
          onOpenExport={() => setIsExportOpen(true)}
        />
      </div>

      {/* Modals */}
      <DictionaryModal
        isOpen={isDictionaryOpen}
        onClose={() => setIsDictionaryOpen(false)}
        entries={customDictionary}
        onAddEntry={(entry) =>
          setCustomDictionary((prev) => [
            ...prev,
            { ...entry, id: `dict-${Date.now()}` },
          ])
        }
        onDeleteEntry={(id) =>
          setCustomDictionary((prev) => prev.filter((e) => e.id !== id))
        }
        onApplyToCurrent={handleApplyDictionary}
      />

      <UstExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        projectName={projectName}
        bpm={bpm}
        timeSignature={timeSignature}
        notes={notes}
        sections={sections}
        onFixIssues={() => {
          commitHistorySnapshot();
          setNotes((prev) => fixOverlappingAndInvalidNotes(prev, bpm));
          showToast('info', '겹친 음표와 빈 가사를 자동 정리했습니다.');
        }}
      />

      <OverwriteConfirmModal
        isOpen={Boolean(overwriteConfirm)}
        protectedCount={overwriteConfirm?.protectedCount || 0}
        actionLabel={
          overwriteConfirm?.action === 'analyze' ? '음원 멜로디 재분석' : 'AI 자동 조교 실행'
        }
        onPreserveAndRun={() => {
          const action = overwriteConfirm?.action;
          setOverwriteConfirm(null);
          if (action === 'analyze') void executeAudioAnalysis(true);
          else if (action === 'align') void executeAlignLyrics(true);
        }}
        onOverwriteAll={() => {
          const action = overwriteConfirm?.action;
          setOverwriteConfirm(null);
          if (action === 'analyze') void executeAudioAnalysis(false);
          else if (action === 'align') void executeAlignLyrics(false);
        }}
        onCancel={() => setOverwriteConfirm(null)}
      />

      <SelfReviewModal
        isOpen={Boolean(selfReviewData?.isOpen)}
        onClose={() => setSelfReviewData(null)}
        summary={selfReviewData?.summary || ''}
        issues={selfReviewData?.issues || []}
        diffs={selfReviewData?.diffs || []}
        onApproveAndApply={handleApproveSelfReview}
      />

      {/* Non-blocking Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 max-w-md px-4 py-3 rounded-lg border shadow-xl flex items-center gap-2.5 text-xs ${
            toast.type === 'error'
              ? 'bg-rose-950/95 border-rose-700/70 text-rose-100'
              : 'bg-[#171D2E] border-violet-500/50 text-slate-100'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-violet-400 shrink-0" />
          )}
          <span className="flex-1 leading-relaxed">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
