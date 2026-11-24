import type { MusicSection, TimeSignature, UstNote, UstValidationIssue } from '../types/ust';
import { secToTicks } from './musicTheory';

export interface UstExportOptions {
  projectName: string;
  bpm: number;
  timeSignature: TimeSignature;
  notes: UstNote[];
  sections: MusicSection[];
  lyricField: 'alias' | 'pronunciation' | 'lyric';
  includeMode2: boolean;
  defaultFlags: string;
}

export function validateUstProject(
  notes: UstNote[],
  bpm: number,
  sections: MusicSection[]
): UstValidationIssue[] {
  const issues: UstValidationIssue[] = [];

  if (notes.length === 0) {
    issues.push({
      id: 'empty-notes',
      severity: 'error',
      message: '내보낼 음표가 0개입니다. 음원을 분석하거나 피아노 롤에 음표를 추가하세요.',
    });
    return issues;
  }

  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) {
    issues.push({
      id: 'invalid-bpm',
      severity: 'error',
      message: `유효하지 않은 BPM 값(${bpm})입니다. 30~300 범위로 설정하세요.`,
    });
  }

  const sorted = [...notes].sort((a, b) => a.startSec - b.startSec);

  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    const startTick = secToTicks(n.startSec, bpm);
    const endTick = secToTicks(n.endSec, bpm);
    const lenTicks = endTick - startTick;

    if (lenTicks <= 0) {
      issues.push({
        id: `zero-len-${n.id}`,
        severity: 'error',
        noteId: n.id,
        fixable: true,
        message: `${i + 1}번째 음표(${n.lyric})의 길이가 0 ticks 이하입니다.`,
      });
    } else if (lenTicks < 60) {
      issues.push({
        id: `short-len-${n.id}`,
        severity: 'warning',
        noteId: n.id,
        message: `${i + 1}번째 음표(${n.lyric})의 길이가 매우 짧습니다(${lenTicks} ticks). UTAU 발음이 끊길 수 있습니다.`,
      });
    }

    if (n.midi < 24 || n.midi > 107) {
      issues.push({
        id: `range-${n.id}`,
        severity: 'warning',
        noteId: n.id,
        message: `${i + 1}번째 음표(${n.lyric})의 음정(MIDI ${n.midi})이 일반 보컬 범위(C1~B7)를 벗어났습니다.`,
      });
    }

    const rawText = (n.alias || n.lyric || '').trim();
    if (!rawText) {
      issues.push({
        id: `empty-lyric-${n.id}`,
        severity: 'error',
        noteId: n.id,
        fixable: true,
        message: `${i + 1}번째 음표에 가사 또는 발음(alias)이 비어 있습니다.`,
      });
    } else if (/[\r\n=\[\]]/.test(rawText)) {
      issues.push({
        id: `invalid-char-${n.id}`,
        severity: 'error',
        noteId: n.id,
        fixable: true,
        message: `${i + 1}번째 음표의 발음('${rawText}')에 UST 예약 문자(=, [, ])가 포함되어 있습니다.`,
      });
    }

    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      const nextStartTick = secToTicks(next.startSec, bpm);
      if (endTick > nextStartTick) {
        issues.push({
          id: `overlap-${n.id}`,
          severity: 'error',
          noteId: n.id,
          fixable: true,
          message: `${i + 1}번째 음표(${n.lyric})와 ${i + 2}번째 음표(${next.lyric})가 ${endTick - nextStartTick} ticks 겹칩니다.`,
        });
      }
    }

    // Warn if note sits in an instrumental-only section
    const mid = (n.startSec + n.endSec) / 2;
    const sec = sections.find((s) => mid >= s.startSec && mid < s.endSec);
    if (sec && !sec.allowVocals) {
      issues.push({
        id: `inst-sec-${n.id}`,
        severity: 'info',
        noteId: n.id,
        message: `음표(${n.lyric})가 보컬 미허용 구간(${sec.name}) 내부에 위치해 있습니다.`,
      });
    }
  }

  return issues;
}

export function fixOverlappingAndInvalidNotes(notes: UstNote[], bpm: number): UstNote[] {
  const sorted = [...notes]
    .sort((a, b) => a.startSec - b.startSec)
    .map((n) => {
      const sanitizedLyric = (n.lyric || 'la').replace(/[\r\n=\[\]]/g, '').trim() || 'la';
      const sanitizedPron = (n.pronunciation || sanitizedLyric).replace(/[\r\n=\[\]]/g, '').trim() || sanitizedLyric;
      const sanitizedAlias = (n.alias || sanitizedPron).replace(/[\r\n=\[\]]/g, '').trim() || sanitizedPron;
      return {
        ...n,
        lyric: sanitizedLyric,
        pronunciation: sanitizedPron,
        alias: sanitizedAlias,
      };
    });

  const minSec = (60 / Math.max(40, bpm)) / 8; // 1/32 note min

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur.endSec - cur.startSec < minSec) {
      cur.endSec = Number((cur.startSec + minSec).toFixed(4));
    }
    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      if (cur.endSec > next.startSec) {
        const trimmedEnd = Number(next.startSec.toFixed(4));
        if (trimmedEnd - cur.startSec >= 0.04) {
          cur.endSec = trimmedEnd;
        } else {
          next.startSec = Number((cur.startSec + minSec).toFixed(4));
          if (next.endSec <= next.startSec) {
            next.endSec = Number((next.startSec + minSec).toFixed(4));
          }
          cur.endSec = next.startSec;
        }
      }
    }
  }

  return sorted;
}

export function generateUstContent(options: UstExportOptions): string {
  const {
    projectName,
    bpm,
    notes,
    lyricField,
    includeMode2,
    defaultFlags,
  } = options;

  const safeProjectName = (projectName || 'AI_UST_Project')
    .replace(/[\r\n]/g, ' ')
    .trim();

  const lines: string[] = [
    '[#VERSION]',
    'UST Version1.2',
    '[#SETTING]',
    `Tempo=${bpm.toFixed(2)}`,
    'Tracks=1',
    `ProjectName=${safeProjectName}`,
    'VoiceDir=%VOICE%',
    'OutFile=',
    `CacheDir=${safeProjectName.replace(/\s+/g, '_')}.cache`,
    'Tool1=wavtool.exe',
    'Tool2=resampler.exe',
    `Mode2=${includeMode2 ? 'True' : 'False'}`,
    `Flags=${defaultFlags || ''}`,
  ];

  const sorted = fixOverlappingAndInvalidNotes(notes, bpm);
  let cursorTick = 0;
  let blockIndex = 0;

  const pushBlock = (fields: Record<string, string | number>) => {
    lines.push(`[#${String(blockIndex).padStart(4, '0')}]`);
    for (const [k, v] of Object.entries(fields)) {
      lines.push(`${k}=${v}`);
    }
    blockIndex++;
  };

  for (const note of sorted) {
    const startTick = Math.max(cursorTick, secToTicks(note.startSec, bpm));
    const endTick = Math.max(startTick + 30, secToTicks(note.endSec, bpm));
    const restTicks = startTick - cursorTick;

    if (restTicks > 0) {
      pushBlock({
        Length: restTicks,
        Lyric: 'R',
        NoteNum: 60,
        PreUtterance: '',
      });
    }

    const chosenText =
      (lyricField === 'alias'
        ? note.alias
        : lyricField === 'pronunciation'
        ? note.pronunciation
        : note.lyric) || note.lyric || 'la';

    const cleanText = chosenText.replace(/[\r\n=\[\]]/g, '').trim() || 'la';

    const noteBlock: Record<string, string | number> = {
      Length: endTick - startTick,
      Lyric: cleanText,
      NoteNum: Math.max(24, Math.min(107, Math.round(note.midi))),
      PreUtterance: note.preUtterance ? String(note.preUtterance) : '',
      VoiceOverlap: note.voiceOverlap ? String(note.voiceOverlap) : '',
      Intensity: Math.round(note.intensity ?? 100),
      Modulation: Math.round(note.modulation ?? 0),
      Velocity: Math.round(note.velocity ?? 100),
      Envelope: note.envelope || '0,5,35,0,100,100,0',
    };

    if (note.flags && note.flags.trim()) {
      noteBlock.Flags = note.flags.trim();
    }

    if (includeMode2) {
      noteBlock.PBS = note.pbs || '-25;0';
      noteBlock.PBW = note.pbw || '50';
      noteBlock.PBY = note.pby || '0';
      if (note.vbr && note.vbr.trim()) {
        noteBlock.VBR = note.vbr.trim();
      }
    }

    pushBlock(noteBlock);
    cursorTick = endTick;
  }

  lines.push('[#TRACKEND]');
  return lines.join('\r\n') + '\r\n';
}

export interface ParsedUstProject {
  projectName: string;
  bpm: number;
  notes: UstNote[];
  durationSec: number;
}

export function parseUstContent(ustText: string): ParsedUstProject {
  const lines = ustText.split(/\r?\n/);
  let currentSection = '';
  let bpm = 120;
  let projectName = 'Imported UST';

  interface RawBlock {
    index: number;
    fields: Record<string, string>;
  }

  const blocks: RawBlock[] = [];
  let activeBlock: RawBlock | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('[#') && line.endsWith(']')) {
      currentSection = line.slice(2, -1);
      if (/^\d+$/.test(currentSection)) {
        activeBlock = { index: Number.parseInt(currentSection, 10), fields: {} };
        blocks.push(activeBlock);
      } else {
        activeBlock = null;
      }
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();

    if (currentSection === 'SETTING') {
      if (key === 'Tempo') {
        const parsedBpm = Number.parseFloat(val);
        if (Number.isFinite(parsedBpm) && parsedBpm >= 30 && parsedBpm <= 300) {
          bpm = parsedBpm;
        }
      } else if (key === 'ProjectName' && val) {
        projectName = val;
      }
    } else if (activeBlock) {
      activeBlock.fields[key] = val;
    }
  }

  const notes: UstNote[] = [];
  let cursorSec = 0;
  let runningBpm = bpm;

  for (const block of blocks) {
    const f = block.fields;
    if (f.Tempo) {
      const nb = Number.parseFloat(f.Tempo);
      if (Number.isFinite(nb) && nb >= 30 && nb <= 300) {
        runningBpm = nb;
      }
    }

    const lengthTicks = Number.parseInt(f.Length || '480', 10);
    const safeTicks = Number.isFinite(lengthTicks) && lengthTicks > 0 ? lengthTicks : 480;
    const durSec = (safeTicks / 480) * (60 / runningBpm);
    const lyric = (f.Lyric || '').trim();

    if (lyric === 'R' || lyric === 'r' || !lyric) {
      cursorSec += durSec;
      continue;
    }

    const midi = Number.parseInt(f.NoteNum || '60', 10);
    const safeMidi = Number.isFinite(midi) ? Math.max(24, Math.min(107, midi)) : 60;
    const startSec = Number(cursorSec.toFixed(4));
    const endSec = Number((cursorSec + durSec).toFixed(4));

    notes.push({
      id: `ust-note-${block.index}-${Math.round(startSec * 1000)}`,
      startSec,
      endSec,
      midi: safeMidi,
      lyric,
      pronunciation: lyric,
      alias: lyric,
      frequencyHz: Number((440 * Math.pow(2, (safeMidi - 69) / 12)).toFixed(2)),
      originalMidi: safeMidi,
      originalStartSec: startSec,
      originalEndSec: endSec,
      velocity: Number.parseInt(f.Velocity || '100', 10) || 100,
      intensity: Number.parseInt(f.Intensity || '100', 10) || 100,
      modulation: Number.parseInt(f.Modulation || '0', 10) || 0,
      preUtterance: f.PreUtterance ? Number.parseFloat(f.PreUtterance) || 0 : 0,
      voiceOverlap: f.VoiceOverlap ? Number.parseFloat(f.VoiceOverlap) || 0 : 0,
      flags: f.Flags || '',
      envelope: f.Envelope || '0,5,35,0,100,100,0',
      pbs: f.PBS || '-25;0',
      pbw: f.PBW || '50',
      pby: f.PBY || '0',
      vbr: f.VBR || '',
      userModified: true,
    });

    cursorSec += durSec;
  }

  return {
    projectName,
    bpm,
    notes,
    durationSec: Math.max(30, Number((cursorSec + 4).toFixed(2))),
  };
}


