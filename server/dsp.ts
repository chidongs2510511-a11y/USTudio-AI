import type {
  AnalysisSettings,
  MusicSection,
  QuantizeGrid,
  SectionCategory,
  TimeSignature,
  UstNote,
  WaveformPeak,
} from '../src/types/ust.ts';

export interface WavData {
  sampleRate: number;
  channels: number;
  samples: Float32Array;
  durationSec: number;
}

export function parseWavPcm16(buffer: Buffer): WavData {
  if (buffer.length < 44) {
    throw new Error('Invalid WAV buffer: too small.');
  }
  const riff = buffer.toString('ascii', 0, 4);
  const wave = buffer.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Invalid WAV header.');
  }

  let offset = 12;
  let sampleRate = 22050;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = Math.min(chunkSize, buffer.length - dataOffset);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || dataSize <= 0) {
    throw new Error('WAV data chunk not found.');
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalFrames = Math.floor(dataSize / (bytesPerSample * channels));
  const samples = new Float32Array(totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const bytePos = dataOffset + (i * channels + ch) * bytesPerSample;
      if (bytePos + 1 < buffer.length) {
        sum += buffer.readInt16LE(bytePos) / 32768;
      }
    }
    samples[i] = sum / channels;
  }

  return {
    sampleRate,
    channels,
    samples,
    durationSec: totalFrames / sampleRate,
  };
}

function fftMagnitude(real: Float32Array, imag: Float32Array): Float32Array {
  const n = real.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = real[i + j];
        const uIm = imag[i + j];
        const vRe = real[i + j + half] * wRe - imag[i + j + half] * wIm;
        const vIm = real[i + j + half] * wIm + imag[i + j + half] * wRe;
        real[i + j] = uRe + vRe;
        imag[i + j] = uIm + vIm;
        real[i + j + half] = uRe - vRe;
        imag[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }

  const halfN = n >> 1;
  const mag = new Float32Array(halfN);
  for (let i = 0; i < halfN; i++) {
    mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  }
  return mag;
}

export function computeSpectralFlux(
  samples: Float32Array,
  sampleRate: number,
  fftSize = 1024,
  hopSize = 256
): { flux: Float32Array; frameRate: number; rms: Float32Array } {
  const numFrames = Math.max(1, Math.floor((samples.length - fftSize) / hopSize));
  const flux = new Float32Array(numFrames);
  const rms = new Float32Array(numFrames);

  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  let prevMag: Float32Array = new Float32Array(fftSize >> 1);
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    let energySum = 0;
    for (let i = 0; i < fftSize; i++) {
      const s = samples[start + i] ?? 0;
      energySum += s * s;
      real[i] = s * hann[i];
      imag[i] = 0;
    }
    rms[f] = Math.sqrt(energySum / fftSize);
    const mag = fftMagnitude(real, imag);

    let frameFlux = 0;
    for (let k = 1; k < mag.length; k++) {
      const diff = Math.log1p(10 * mag[k]) - Math.log1p(10 * prevMag[k]);
      if (diff > 0) {
        frameFlux += diff;
      }
    }
    flux[f] = frameFlux;
    prevMag = mag;
  }

  // Adaptive local mean subtraction for clean onset peaks
  const meanWin = 8;
  const cleanFlux = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - meanWin); j <= Math.min(numFrames - 1, i + meanWin); j++) {
      sum += flux[j];
      count++;
    }
    cleanFlux[i] = Math.max(0, flux[i] - (sum / count) * 1.05);
  }

  return {
    flux: cleanFlux,
    frameRate: sampleRate / hopSize,
    rms,
  };
}

export function estimateBpmAndBeats(
  flux: Float32Array,
  frameRate: number,
  durationSec: number,
  timeSignature: TimeSignature,
  manualBpm: number | null
): { bpm: number; confidence: number; beats: number[]; bars: number[] } {
  let bestBpm = manualBpm && manualBpm >= 40 && manualBpm <= 240 ? manualBpm : 120;
  let confidence = manualBpm ? 1.0 : 0.5;

  if (!manualBpm && flux.length > frameRate * 3) {
    const minBpm = 66;
    const maxBpm = 186;
    const scores: { bpm: number; score: number }[] = [];

    for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
      const lagFrames = (60 / bpm) * frameRate;
      const lagInt = Math.round(lagFrames);
      if (lagInt >= flux.length / 2) continue;

      let acf = 0;
      let norm = 0;
      for (let i = 0; i < flux.length - lagInt * 2; i++) {
        acf += flux[i] * (flux[i + lagInt] + 0.5 * flux[i + lagInt * 2]);
        norm += flux[i] * flux[i];
      }
      // Subtle prior favoring common vocal tempos 85-150 BPM to prevent half/double-time drift
      const prior = Math.exp(-0.5 * Math.pow((bpm - 118) / 38, 2));
      const score = norm > 1e-6 ? (acf / norm) * (0.82 + 0.18 * prior) : 0;
      scores.push({ bpm, score });
    }

    if (scores.length > 0) {
      scores.sort((a, b) => b.score - a.score);
      bestBpm = Math.round(scores[0].bpm * 10) / 10;
      const topScore = scores[0].score;
      const medianScore = scores[Math.floor(scores.length / 2)].score || 0.001;
      confidence = Math.min(0.99, Math.max(0.35, topScore / (topScore + medianScore)));
    }
  }

  // Find optimal phase offset for beat 0 within the first beat period
  const beatPeriodSec = 60 / bestBpm;
  const beatPeriodFrames = beatPeriodSec * frameRate;
  let bestPhaseFrames = 0;
  let bestPhaseScore = -1;

  const steps = Math.max(8, Math.round(beatPeriodFrames));
  for (let p = 0; p < steps; p++) {
    let score = 0;
    for (let k = p; k < flux.length; k += beatPeriodFrames) {
      const idx = Math.round(k);
      if (idx < flux.length) {
        score += flux[idx];
      }
    }
    if (score > bestPhaseScore) {
      bestPhaseScore = score;
      bestPhaseFrames = p;
    }
  }

  const firstBeatSec = bestPhaseFrames / frameRate;
  const beats: number[] = [];
  for (let t = firstBeatSec; t < durationSec; t += beatPeriodSec) {
    beats.push(Number(t.toFixed(4)));
  }

  const beatsPerBar = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;
  const bars: number[] = [];
  for (let i = 0; i < beats.length; i += beatsPerBar) {
    bars.push(beats[i]);
  }

  return { bpm: bestBpm, confidence, beats, bars };
}

export interface PitchFrame {
  timeSec: number;
  freqHz: number;
  midi: number;
  confidence: number;
  rms: number;
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Real YIN Pitch Detection (de Cheveigne & Kawahara 2002)
 */
export function detectYinPitchFrames(
  samples: Float32Array,
  sampleRate: number,
  sensitivity: number
): PitchFrame[] {
  const windowSize = 1024;
  const hopSize = 512;
  const minFreq = 82; // E2
  const maxFreq = 1050; // C6
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(Math.floor(windowSize / 2), Math.floor(sampleRate / minFreq));

  // Higher sensitivity -> accepts slightly noisier voicing threshold
  const yinThreshold = 0.12 + sensitivity * 0.14;

  const numFrames = Math.max(0, Math.floor((samples.length - windowSize) / hopSize));
  const rawFrames: PitchFrame[] = [];

  // Compute global 15th-percentile RMS to establish noise gate
  const frameRms = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    let sumSq = 0;
    for (let i = 0; i < windowSize; i++) {
      const s = samples[start + i];
      sumSq += s * s;
    }
    frameRms[f] = Math.sqrt(sumSq / windowSize);
  }

  const sortedRms = Array.from(frameRms).sort((a, b) => a - b);
  const p95Rms = sortedRms[Math.floor(sortedRms.length * 0.95)] || 0.1;
  const energyGate = Math.max(0.004, p95Rms * (0.14 - sensitivity * 0.08));

  const diff = new Float32Array(tauMax + 1);
  const cmndf = new Float32Array(tauMax + 1);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    const timeSec = (start + windowSize / 2) / sampleRate;
    const rms = frameRms[f];

    if (rms < energyGate) {
      rawFrames.push({ timeSec, freqHz: 0, midi: 0, confidence: 0, rms });
      continue;
    }

    diff.fill(0);
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < tauMax; j++) {
        const delta = samples[start + j] - samples[start + j + tau];
        sum += delta * delta;
      }
      diff[tau] = sum;
    }

    cmndf[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      runningSum += diff[tau];
      cmndf[tau] = runningSum > 1e-9 ? (diff[tau] * tau) / runningSum : 1;
    }

    let tauEstimate = -1;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (cmndf[tau] < yinThreshold) {
        while (tau + 1 < tauMax && cmndf[tau + 1] < cmndf[tau]) {
          tau++;
        }
        tauEstimate = tau;
        break;
      }
    }

    // Fallback global minimum if strong periodic peak exists near threshold
    if (tauEstimate === -1) {
      let minVal = 1;
      let minTau = -1;
      for (let tau = tauMin; tau < tauMax; tau++) {
        if (cmndf[tau] < minVal) {
          minVal = cmndf[tau];
          minTau = tau;
        }
      }
      if (minVal < yinThreshold * 1.25) {
        tauEstimate = minTau;
      }
    }

    if (tauEstimate > 0) {
      // Parabolic interpolation
      let betterTau = tauEstimate;
      if (tauEstimate > 1 && tauEstimate < tauMax - 1) {
        const s0 = cmndf[tauEstimate - 1];
        const s1 = cmndf[tauEstimate];
        const s2 = cmndf[tauEstimate + 1];
        const denom = 2 * (2 * s1 - s2 - s0);
        if (Math.abs(denom) > 1e-6) {
          betterTau = tauEstimate + (s2 - s0) / denom;
        }
      }
      const freqHz = sampleRate / betterTau;
      const midi = freqToMidi(freqHz);
      const confidence = Math.max(0, Math.min(1, 1 - cmndf[tauEstimate]));
      if (midi >= 33 && midi <= 96) {
        rawFrames.push({ timeSec, freqHz, midi, confidence, rms });
        continue;
      }
    }

    rawFrames.push({ timeSec, freqHz: 0, midi: 0, confidence: 0, rms });
  }

  // 3-frame median filter on voiced MIDI values to stabilize octave glitches
  const smoothed = rawFrames.map((frame, i) => {
    if (frame.midi <= 0) return frame;
    const neighbors = [
      rawFrames[i - 1]?.midi || 0,
      frame.midi,
      rawFrames[i + 1]?.midi || 0,
    ].filter((m) => m > 0);
    if (neighbors.length === 3) {
      neighbors.sort((a, b) => a - b);
      const med = neighbors[1];
      return {
        ...frame,
        midi: med,
        freqHz: midiToFreq(med),
      };
    }
    return frame;
  });

  return smoothed;
}

function quantizeTime(timeSec: number, bpm: number, grid: QuantizeGrid): number {
  if (grid === 'none' || bpm <= 0) return timeSec;
  const beatSec = 60 / bpm;
  const stepSec =
    grid === '1/32'
      ? beatSec / 8
      : grid === '1/16'
      ? beatSec / 4
      : grid === '1/8'
      ? beatSec / 2
      : beatSec;
  return Math.round(timeSec / stepSec) * stepSec;
}

export function segmentF0ToNotes(
  frames: PitchFrame[],
  flux: Float32Array,
  fluxFrameRate: number,
  bpm: number,
  settings: AnalysisSettings
): UstNote[] {
  if (frames.length === 0) return [];

  const frameDt = frames.length > 1 ? frames[1].timeSec - frames[0].timeSec : 0.0232;
  const minFrames = Math.max(2, Math.round((settings.minNoteDurationMs / 1000) / frameDt));

  // Precompute flux peaks
  const fluxMean = flux.reduce((acc, v) => acc + v, 0) / Math.max(1, flux.length);
  const fluxPeakThreshold = fluxMean * (2.6 - settings.sensitivity * 0.9);

  interface RawSeg {
    startIdx: number;
    endIdx: number;
    midis: number[];
    confs: number[];
  }

  const segments: RawSeg[] = [];
  let current: RawSeg | null = null;
  let unvoicedGap = 0;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.midi <= 0) {
      unvoicedGap++;
      if (current && unvoicedGap >= 2) {
        segments.push(current);
        current = null;
      }
      continue;
    }

    unvoicedGap = 0;
    const fluxIdx = Math.min(flux.length - 1, Math.round(f.timeSec * fluxFrameRate));
    const isStrongOnset =
      fluxIdx > 1 &&
      fluxIdx < flux.length - 1 &&
      flux[fluxIdx] > fluxPeakThreshold &&
      flux[fluxIdx] >= flux[fluxIdx - 1] &&
      flux[fluxIdx] >= flux[fluxIdx + 1];

    if (!current) {
      current = {
        startIdx: i,
        endIdx: i,
        midis: [f.midi],
        confs: [f.confidence],
      };
      continue;
    }

    // Running median MIDI of current segment
    const sortedM = [...current.midis].sort((a, b) => a - b);
    const curMidi = sortedM[Math.floor(sortedM.length / 2)];
    const pitchDiff = Math.abs(f.midi - curMidi);
    const segLen = i - current.startIdx;

    if (pitchDiff >= 0.72 || (isStrongOnset && segLen >= minFrames)) {
      segments.push(current);
      current = {
        startIdx: i,
        endIdx: i,
        midis: [f.midi],
        confs: [f.confidence],
      };
    } else {
      current.endIdx = i;
      current.midis.push(f.midi);
      current.confs.push(f.confidence);
    }
  }
  if (current) {
    segments.push(current);
  }

  const notes: UstNote[] = [];
  const stepSec =
    settings.quantizeGrid === '1/32'
      ? 60 / bpm / 8
      : settings.quantizeGrid === '1/16'
      ? 60 / bpm / 4
      : settings.quantizeGrid === '1/8'
      ? 60 / bpm / 2
      : settings.quantizeGrid === '1/4'
      ? 60 / bpm
      : 0.08;

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    const len = seg.endIdx - seg.startIdx + 1;
    if (len < minFrames) continue;

    const sortedM = [...seg.midis].sort((a, b) => a - b);
    const medianMidi = Math.round(sortedM[Math.floor(sortedM.length / 2)]);
    const avgConf = seg.confs.reduce((a, b) => a + b, 0) / seg.confs.length;

    let startSec = frames[seg.startIdx].timeSec - frameDt * 0.5;
    let endSec = frames[seg.endIdx].timeSec + frameDt * 0.5;

    if (settings.quantizeGrid !== 'none') {
      startSec = quantizeTime(startSec, bpm, settings.quantizeGrid);
      endSec = quantizeTime(endSec, bpm, settings.quantizeGrid);
      if (endSec <= startSec) {
        endSec = startSec + stepSec;
      }
    }

    startSec = Math.max(0, Number(startSec.toFixed(4)));
    endSec = Math.max(startSec + 0.05, Number(endSec.toFixed(4)));

    // Prevent overlap with previous note
    if (notes.length > 0) {
      const prev = notes[notes.length - 1];
      if (startSec < prev.endSec) {
        if (prev.endSec - startSec < 0.12 && startSec - prev.startSec >= 0.06) {
          prev.endSec = startSec;
        } else {
          startSec = prev.endSec;
          if (endSec <= startSec) {
            endSec = Number((startSec + Math.max(0.06, stepSec)).toFixed(4));
          }
        }
      }
    }

    const clampedMidi = Math.max(36, Math.min(96, medianMidi));
    const prevNote = notes[notes.length - 1];
    const phraseId =
      prevNote && startSec - prevNote.endSec <= 0.35
        ? prevNote.phraseId || 'phrase-1'
        : `phrase-${notes.length + 1}`;

    notes.push({
      id: `note-${notes.length + 1}-${Math.round(startSec * 1000)}`,
      startSec,
      endSec,
      midi: clampedMidi,
      lyric: 'la',
      pronunciation: 'la',
      alias: 'la',
      frequencyHz: Number(midiToFreq(clampedMidi).toFixed(2)),
      confidence: Number(avgConf.toFixed(2)),
      phraseId,
      originalMidi: clampedMidi,
      originalStartSec: startSec,
      originalEndSec: endSec,
      velocity: 100,
      intensity: 100,
      modulation: 0,
      preUtterance: 0,
      voiceOverlap: 0,
      flags: '',
      envelope: '0,5,35,0,100,100,0',
      pbs: '-25;0',
      pbw: '50',
      pby: '0',
    });
  }

  return notes;
}

export function computeWaveformPeaks(
  mixSamples: Float32Array,
  vocalSamples: Float32Array,
  buckets = 1000
): WaveformPeak[] {
  const total = mixSamples.length;
  if (total === 0) return [];
  const actualBuckets = Math.min(buckets, total);
  const blockSize = Math.floor(total / actualBuckets);
  const peaks: WaveformPeak[] = [];

  for (let b = 0; b < actualBuckets; b++) {
    const start = b * blockSize;
    const end = b === actualBuckets - 1 ? total : start + blockSize;
    let min = 1;
    let max = -1;
    let vocalSumSq = 0;

    for (let i = start; i < end; i++) {
      const s = mixSamples[i];
      if (s < min) min = s;
      if (s > max) max = s;
      const v = vocalSamples[i] ?? s;
      vocalSumSq += v * v;
    }

    const vocalRms = Math.sqrt(vocalSumSq / Math.max(1, end - start));
    peaks.push({
      min: Number(min.toFixed(4)),
      max: Number(max.toFixed(4)),
      vocalEnergy: Number(Math.min(1, vocalRms * 3.2).toFixed(4)),
    });
  }

  return peaks;
}

const SECTION_COLORS: Record<SectionCategory, string> = {
  intro: '#475569',
  verse: '#3B82F6',
  'pre-chorus': '#6366F1',
  chorus: '#8B5CF6',
  interlude: '#64748B',
  bridge: '#0EA5E9',
  'final-chorus': '#A855F7',
  outro: '#334155',
};

export function suggestSectionsFromAudio(
  durationSec: number,
  bars: number[],
  vocalSamples: Float32Array,
  sampleRate: number
): MusicSection[] {
  if (durationSec <= 0) return [];

  const template: {
    name: string;
    category: SectionCategory;
    weight: number;
    allowVocals: boolean;
    repeatGroup?: string;
  }[] =
    durationSec < 45
      ? [
          { name: 'INTRO', category: 'intro', weight: 0.14, allowVocals: false },
          { name: 'VERSE 1', category: 'verse', weight: 0.32, allowVocals: true },
          { name: 'CHORUS 1', category: 'chorus', weight: 0.40, allowVocals: true, repeatGroup: 'chorus' },
          { name: 'OUTRO', category: 'outro', weight: 0.14, allowVocals: false },
        ]
      : durationSec < 110
      ? [
          { name: 'INTRO', category: 'intro', weight: 0.08, allowVocals: false },
          { name: 'VERSE 1', category: 'verse', weight: 0.20, allowVocals: true },
          { name: 'PRE-CHORUS 1', category: 'pre-chorus', weight: 0.14, allowVocals: true },
          { name: 'CHORUS 1', category: 'chorus', weight: 0.24, allowVocals: true, repeatGroup: 'chorus' },
          { name: 'INTERLUDE', category: 'interlude', weight: 0.08, allowVocals: false },
          { name: 'CHORUS 2', category: 'chorus', weight: 0.18, allowVocals: true, repeatGroup: 'chorus' },
          { name: 'OUTRO', category: 'outro', weight: 0.08, allowVocals: false },
        ]
      : [
          { name: 'INTRO', category: 'intro', weight: 0.06, allowVocals: false },
          { name: 'VERSE 1', category: 'verse', weight: 0.12, allowVocals: true },
          { name: 'PRE-CHORUS 1', category: 'pre-chorus', weight: 0.08, allowVocals: true },
          { name: 'CHORUS 1', category: 'chorus', weight: 0.13, allowVocals: true, repeatGroup: 'chorus' },
          { name: 'INTERLUDE', category: 'interlude', weight: 0.06, allowVocals: false },
          { name: 'VERSE 2', category: 'verse', weight: 0.12, allowVocals: true },
          { name: 'PRE-CHORUS 2', category: 'pre-chorus', weight: 0.08, allowVocals: true },
          { name: 'CHORUS 2', category: 'chorus', weight: 0.12, allowVocals: true, repeatGroup: 'chorus' },
          { name: 'BRIDGE', category: 'bridge', weight: 0.08, allowVocals: true },
          { name: 'FINAL CHORUS', category: 'final-chorus', weight: 0.10, allowVocals: true, repeatGroup: 'chorus' },
          { name: 'OUTRO', category: 'outro', weight: 0.05, allowVocals: false },
        ];

  const snapToBar = (targetSec: number) => {
    if (bars.length < 2) return targetSec;
    let nearest = bars[0];
    let minD = Math.abs(targetSec - nearest);
    for (const b of bars) {
      const d = Math.abs(targetSec - b);
      if (d < minD) {
        minD = d;
        nearest = b;
      }
    }
    return nearest;
  };

  // Detect if intro actually has very low vocal RMS, adjust intro boundary gently
  const sections: MusicSection[] = [];
  let cursor = 0;

  for (let i = 0; i < template.length; i++) {
    const item = template[i];
    const isLast = i === template.length - 1;
    let endSec = isLast ? durationSec : snapToBar(cursor + durationSec * item.weight);

    // Ensure strictly increasing boundaries
    if (!isLast && endSec <= cursor + 1.0) {
      endSec = Math.min(durationSec, cursor + durationSec * item.weight);
    }
    if (isLast) {
      endSec = durationSec;
    }

    // Check vocal energy inside section for info (not overriding user defaults)
    const startIdx = Math.floor(cursor * sampleRate);
    const endIdx = Math.min(vocalSamples.length, Math.floor(endSec * sampleRate));
    let sumSq = 0;
    for (let s = startIdx; s < endIdx; s += 16) {
      sumSq += vocalSamples[s] * vocalSamples[s];
    }
    const rms = Math.sqrt(sumSq / Math.max(1, (endIdx - startIdx) / 16));
    void rms;

    sections.push({
      id: `sec-${i + 1}`,
      name: item.name,
      category: item.category,
      startSec: Number(cursor.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      color: SECTION_COLORS[item.category],
      allowVocals: item.allowVocals,
      repeatGroup: item.repeatGroup,
    });

    cursor = endSec;
  }

  return sections;
}
