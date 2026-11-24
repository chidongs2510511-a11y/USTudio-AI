export type LyricLanguage = 'ko' | 'en' | 'ja' | 'zh-CN' | 'zh-TW' | 'es';

export type AliasMode = 'CV' | 'VCV' | 'CVVC' | 'Romaji';

export type QuantizeGrid = '1/32' | '1/16' | '1/8' | '1/4' | 'none';

export type TimeSignature = '4/4' | '3/4' | '6/8';

export type SectionCategory =
  | 'intro'
  | 'verse'
  | 'pre-chorus'
  | 'chorus'
  | 'interlude'
  | 'bridge'
  | 'final-chorus'
  | 'outro';

export interface MusicSection {
  id: string;
  name: string;
  category: SectionCategory;
  startSec: number;
  endSec: number;
  color: string;
  allowVocals: boolean;
  repeatGroup?: string;
}

export interface UstNote {
  id: string;
  startSec: number;
  endSec: number;
  midi: number; // 24..107 (60 = C4)
  lyric: string; // Display syllable (e.g. "가", "桜", "love")
  pronunciation: string; // Converted phonetic / reading (e.g. "ga", "sa", "ma3")
  alias: string; // Standard UTAU Lyric= field (e.g. "가", "a か", "ka")
  frequencyHz?: number;
  confidence?: number;
  sectionId?: string;
  phraseId?: string;
  userModified?: boolean; // Protects manual edits from AI overwrite
  phonemeError?: string; // Pronunciation / conversion failure warning
  originalMidi?: number; // Original DSP pitch for comparison
  originalStartSec?: number; // Original DSP start time
  originalEndSec?: number; // Original DSP end time
  velocity: number; // 0..200 (default 100)
  intensity: number; // 0..200 (default 100)
  modulation: number; // 0..200 (default 0)
  preUtterance?: number; // ms
  voiceOverlap?: number; // ms
  flags?: string;
  envelope?: string; // e.g. "0,5,35,0,100,100,0"
  pbs?: string; // Mode2 pitch bend start e.g. "-25;0"
  pbw?: string; // Mode2 pitch bend widths e.g. "50"
  pby?: string; // Mode2 pitch bend Y offsets e.g. "0"
  vbr?: string; // UTAU vibrato e.g. "65,160,35,20,20,0,0,0"
}

export interface LyricSyllableToken {
  id: string;
  text: string;
  pronunciation: string;
  alias: string;
  sectionHint?: string;
  lineIndex: number;
  wordGroup?: string;
  customDurationScale?: number;
  phonemeError?: string;
}

export interface PronunciationDictEntry {
  id: string;
  source: string;
  language: LyricLanguage | 'all';
  pronunciation: string;
  alias: string;
}

export interface AnalysisSettings {
  vocalIsolation: boolean;
  sensitivity: number; // 0.1..1.0
  quantizeGrid: QuantizeGrid;
  minNoteDurationMs: number;
  timeSignature: TimeSignature;
  manualBpm: number | null;
}

export interface WaveformPeak {
  min: number;
  max: number;
  vocalEnergy: number;
}

export interface AudioAnalysisResult {
  durationSec: number;
  sampleRate: number;
  channels: number;
  detectedBpm: number;
  bpmConfidence: number;
  timeSignature: TimeSignature;
  beats: number[];
  bars: number[];
  waveform: WaveformPeak[];
  notes: UstNote[];
  suggestedSections: MusicSection[];
  vocalSeparationApplied: boolean;
  separationMethod: 'mid-side-bandpass' | 'formant-bandpass' | 'none';
}

export interface AlignmentWarning {
  sectionId: string;
  sectionName: string;
  type: 'deficit' | 'surplus' | 'skipped-instrumental';
  syllableCount: number;
  noteCount: number;
  message: string;
}

export type TuningStyle = 'natural' | 'accurate' | 'detailed' | 'pro';

export interface ProposedNoteEdit {
  noteId: string;
  label: string;
  beforeSummary: string;
  afterSummary: string;
  reason: string;
}

export interface TuningAuditIssue {
  id: string;
  category:
    | 'count-mismatch'
    | 'syllable-order'
    | 'phoneme-error'
    | 'timing-mismatch'
    | 'chorus-mismatch'
    | 'missing-lyric';
  severity: 'error' | 'warning';
  noteId?: string;
  sectionId?: string;
  message: string;
  autoFixable: boolean;
}

export interface UstValidationIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  noteId?: string;
  message: string;
  fixable?: boolean;
}

export interface UstProjectFile {
  version: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  audioFileName: string | null;
  durationSec: number;
  bpm: number;
  timeSignature: TimeSignature;
  language: LyricLanguage;
  aliasMode: AliasMode;
  tuningStyle?: TuningStyle;
  rawLyrics: string;
  syllables: LyricSyllableToken[];
  customDictionary: PronunciationDictEntry[];
  sections: MusicSection[];
  notes: UstNote[];
  analysisSettings: AnalysisSettings;
}
