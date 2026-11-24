import type { MusicSection, QuantizeGrid, SectionCategory, TimeSignature } from '../types/ust';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)));
  const octave = Math.floor(clamped / 12) - 1;
  return `${NOTE_NAMES[clamped % 12]}${octave}`;
}

export function isBlackKey(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function secToTicks(sec: number, bpm: number): number {
  return Math.round((sec * bpm / 60) * 480);
}

export function ticksToSec(ticks: number, bpm: number): number {
  return (ticks / 480) * (60 / bpm);
}

export function formatTimecode(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function formatBarBeat(sec: number, bpm: number, timeSignature: TimeSignature): string {
  const beatsPerBar = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;
  const totalBeats = Math.max(0, (sec * bpm) / 60);
  const bar = Math.floor(totalBeats / beatsPerBar) + 1;
  const beat = Math.floor(totalBeats % beatsPerBar) + 1;
  return `${String(bar).padStart(3, '0')}:${String(beat).padStart(2, '0')}`;
}

export function snapSecToGrid(sec: number, bpm: number, grid: QuantizeGrid): number {
  if (grid === 'none' || bpm <= 0) return Math.max(0, Number(sec.toFixed(4)));
  const beatSec = 60 / bpm;
  const stepSec =
    grid === '1/32'
      ? beatSec / 8
      : grid === '1/16'
      ? beatSec / 4
      : grid === '1/8'
      ? beatSec / 2
      : beatSec;
  return Math.max(0, Number((Math.round(sec / stepSec) * stepSec).toFixed(4)));
}

export function getGridStepSec(bpm: number, grid: QuantizeGrid): number {
  const beatSec = 60 / Math.max(40, bpm);
  if (grid === '1/4') return beatSec;
  if (grid === '1/8') return beatSec / 2;
  if (grid === '1/16') return beatSec / 4;
  if (grid === '1/32') return beatSec / 8;
  return beatSec / 4;
}

export const SECTION_CATEGORY_META: Record<
  SectionCategory,
  { label: string; color: string; defaultAllowVocals: boolean }
> = {
  intro: { label: 'INTRO', color: '#475569', defaultAllowVocals: false },
  verse: { label: 'VERSE', color: '#3B82F6', defaultAllowVocals: true },
  'pre-chorus': { label: 'PRE-CHORUS', color: '#6366F1', defaultAllowVocals: true },
  chorus: { label: 'CHORUS', color: '#8B5CF6', defaultAllowVocals: true },
  interlude: { label: 'INTERLUDE', color: '#64748B', defaultAllowVocals: false },
  bridge: { label: 'BRIDGE', color: '#0EA5E9', defaultAllowVocals: true },
  'final-chorus': { label: 'FINAL CHORUS', color: '#A855F7', defaultAllowVocals: true },
  outro: { label: 'OUTRO', color: '#334155', defaultAllowVocals: false },
};

export function createDefaultSections(durationSec = 96): MusicSection[] {
  const defs: Array<{
    name: string;
    category: SectionCategory;
    ratio: number;
    allowVocals: boolean;
    repeatGroup?: string;
  }> = [
    { name: 'INTRO', category: 'intro', ratio: 0.06, allowVocals: false },
    { name: 'VERSE 1', category: 'verse', ratio: 0.12, allowVocals: true },
    { name: 'PRE-CHORUS 1', category: 'pre-chorus', ratio: 0.08, allowVocals: true },
    { name: 'CHORUS 1', category: 'chorus', ratio: 0.13, allowVocals: true, repeatGroup: 'chorus' },
    { name: 'INTERLUDE', category: 'interlude', ratio: 0.06, allowVocals: false },
    { name: 'VERSE 2', category: 'verse', ratio: 0.12, allowVocals: true },
    { name: 'PRE-CHORUS 2', category: 'pre-chorus', ratio: 0.08, allowVocals: true },
    { name: 'CHORUS 2', category: 'chorus', ratio: 0.12, allowVocals: true, repeatGroup: 'chorus' },
    { name: 'BRIDGE', category: 'bridge', ratio: 0.08, allowVocals: true },
    { name: 'FINAL CHORUS', category: 'final-chorus', ratio: 0.10, allowVocals: true, repeatGroup: 'chorus' },
    { name: 'OUTRO', category: 'outro', ratio: 0.05, allowVocals: false },
  ];

  let cursor = 0;
  return defs.map((d, idx) => {
    const startSec = Number(cursor.toFixed(2));
    const endSec =
      idx === defs.length - 1
        ? Number(durationSec.toFixed(2))
        : Number((cursor + durationSec * d.ratio).toFixed(2));
    cursor = endSec;
    return {
      id: `sec-${idx + 1}`,
      name: d.name,
      category: d.category,
      startSec,
      endSec,
      color: SECTION_CATEGORY_META[d.category].color,
      allowVocals: d.allowVocals,
      repeatGroup: d.repeatGroup,
    };
  });
}
