import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AliasMode,
  AlignmentWarning,
  LyricLanguage,
  LyricSyllableToken,
  MusicSection,
  PronunciationDictEntry,
  ProposedNoteEdit,
  TuningAuditIssue,
  TuningStyle,
  UstNote,
} from '../src/types/ust.ts';
import {
  applyCustomDict,
  applyProfessionalNoteTuning,
  deterministicSyllabify,
  validateSyllablePhoneme,
} from './phonetics.ts';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const LANGUAGE_LABELS: Record<LyricLanguage, string> = {
  ko: 'Korean (한국어)',
  en: 'English',
  ja: 'Japanese (日本語)',
  'zh-CN': 'Chinese Simplified (简体中文)',
  'zh-TW': 'Chinese Traditional (繁體中文)',
  es: 'Spanish (Español)',
};

export async function convertLyricsWithGemini(params: {
  rawLyrics: string;
  language: LyricLanguage;
  aliasMode: AliasMode;
  customDictionary: PronunciationDictEntry[];
}): Promise<{
  tokens: LyricSyllableToken[];
  usedGemini: boolean;
  warning?: string;
}> {
  const { rawLyrics, language, aliasMode, customDictionary } = params;
  if (!rawLyrics.trim()) {
    return { tokens: [], usedGemini: false };
  }

  const ai = getGeminiClient();
  if (!ai) {
    const fallback = deterministicSyllabify(rawLyrics, language, aliasMode, customDictionary);
    return {
      tokens: fallback,
      usedGemini: false,
      warning: 'GEMINI_API_KEY가 설정되지 않아 내장 규칙 기반 발음 변환기를 사용했습니다.',
    };
  }

  const lines = rawLyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const systemInstruction = `You are an expert UTAU singing-voice phonetic preparation engine.
Your job is ONLY to split lyrics into singable syllables/morae and produce clean, standard UTAU-compatible pronunciations and aliases WITHOUT assuming proprietary voicebank-only suffixes.
Rules:
1. Preserve section header tags like [INTRO], [VERSE 1], [CHORUS 1], etc., by attaching sectionHint to the following tokens until the next tag.
2. For Japanese: convert ALL Kanji into singable Hiragana morae (splitting small ゃ/ゅ/ょ with the preceding kana, keeping っ and ん as separate morae, expanding ー to vowel). For CV, alias is Hiragana mora ("さ"). For VCV, alias is "<prev_vowel> <hiragana>" ("- さ", "a く"). For CVVC, alias uses clean CV/VC transitions ("- さ", "a k", "く"). For Romaji, alias is romaji ("sa", "ku").
3. For Korean: split into Hangul syllables applying natural singing liaison (연음) and coda handling (받침) in pronunciation/alias (e.g. "음악이" -> text "음","악","이", pronunciation "eu","ma","gi", CV alias "음","마","기", VCV "- 음","eu 마","a 기", CVVC "- 음","eu m","ma").
4. For English: split multi-syllable words accurately into singable syllables handling consonant clusters and word linking (e.g. "stand up" -> "stan","dup") with clear phonetic pronunciation and standard UTAU alias.
5. For Chinese (Simplified or Traditional): split per character, put Pinyin WITH tone number in pronunciation (e.g. "ni3", "hao3") and clean standard Pinyin without tone number in alias (or VCV "- ni", "i hao") so standard voicebanks can open it.
6. For Spanish: split by Spanish syllabification rules (handling diphthongs, hiatus, and vowel linking) and provide clean singable phonetic alias.`;

  const prompt = `Language: ${LANGUAGE_LABELS[language]}
UTAU Alias Mode: ${aliasMode}

Lyrics lines:
${lines.map((l, idx) => `${idx}: ${l}`).join('\n')}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tokens: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING, description: 'Original syllable/character for display' },
                  pronunciation: { type: Type.STRING, description: 'Readable phonetic/romaji/pinyin reading' },
                  alias: { type: Type.STRING, description: 'UTAU Lyric= alias formatted for requested aliasMode' },
                  sectionHint: { type: Type.STRING, description: 'Uppercase section name if preceded by [TAG], else empty string' },
                  lineIndex: { type: Type.INTEGER, description: '0-based index of the input line' },
                  wordGroup: { type: Type.STRING, description: 'Parent word for grouping' },
                },
                required: ['text', 'pronunciation', 'alias', 'lineIndex'],
              },
            },
          },
          required: ['tokens'],
        },
      },
    });

    const rawJson = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawJson) as {
      tokens?: Array<{
        text: string;
        pronunciation: string;
        alias: string;
        sectionHint?: string;
        lineIndex?: number;
        wordGroup?: string;
      }>;
    };

    if (!parsed.tokens || parsed.tokens.length === 0) {
      throw new Error('Gemini returned empty syllable list.');
    }

    const tokens: LyricSyllableToken[] = parsed.tokens.map((t, idx) => {
      const base: LyricSyllableToken = {
        id: `syl-ai-${idx}-${Date.now()}`,
        text: t.text || 'la',
        pronunciation: t.pronunciation || t.text || 'la',
        alias: t.alias || t.pronunciation || t.text || 'la',
        sectionHint: t.sectionHint ? t.sectionHint.replace(/^\[|\]$/g, '').toUpperCase() : undefined,
        lineIndex: typeof t.lineIndex === 'number' ? t.lineIndex : 0,
        wordGroup: t.wordGroup || t.text,
      };
      return applyCustomDict(base, language, customDictionary);
    });

    return { tokens, usedGemini: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fallback = deterministicSyllabify(rawLyrics, language, aliasMode, customDictionary);
    return {
      tokens: fallback,
      usedGemini: false,
      warning: `Gemini 발음 변환 중 오류가 발생하여 규칙 기반 변환으로 대체했습니다: ${message}`,
    };
  }
}

/**
 * Proportionally split long notes when syllables exceed notes in a section
 */
function expandNotesForExtraSyllables(
  secNotes: UstNote[],
  targetCount: number,
  preserveManualEdits: boolean
): UstNote[] {
  const working = secNotes.map((n) => ({ ...n }));
  let safety = 0;

  while (working.length < targetCount && safety < 120) {
    safety++;
    // Find longest splittable note (skip protected manual notes if preserveManualEdits is true)
    let bestIdx = -1;
    let bestDur = 0;
    for (let i = 0; i < working.length; i++) {
      if (preserveManualEdits && working[i].userModified) continue;
      const dur = working[i].endSec - working[i].startSec;
      if (dur >= 0.16 && dur > bestDur) {
        bestDur = dur;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;

    const target = working[bestIdx];
    const mid = Number(((target.startSec + target.endSec) / 2).toFixed(4));
    const left: UstNote = { ...target, endSec: mid };
    const right: UstNote = {
      ...target,
      id: `${target.id}-sub${safety}`,
      startSec: mid,
    };
    working.splice(bestIdx, 1, left, right);
  }

  return working;
}

export async function alignLyricsToNotesWithSections(params: {
  notes: UstNote[];
  sections: MusicSection[];
  syllables: LyricSyllableToken[];
  language: LyricLanguage;
  aliasMode: AliasMode;
  tuningStyle?: TuningStyle;
  preserveManualEdits?: boolean;
}): Promise<{
  notes: UstNote[];
  warnings: AlignmentWarning[];
  usedGemini: boolean;
}> {
  const {
    notes,
    sections,
    syllables,
    language,
    aliasMode,
    tuningStyle = 'pro',
    preserveManualEdits = true,
  } = params;
  const warnings: AlignmentWarning[] = [];

  const sortedSections = [...sections].sort((a, b) => a.startSec - b.startSec);
  const sortedNotes = [...notes].sort((a, b) => a.startSec - b.startSec);

  if (sortedNotes.length === 0) {
    return {
      notes: [],
      warnings: [
        {
          sectionId: 'global',
          sectionName: '전체',
          type: 'deficit',
          syllableCount: syllables.length,
          noteCount: 0,
          message: '배치할 분석된 음표가 없습니다. 먼저 음원을 분석하거나 피아노 롤에 음표를 추가하세요.',
        },
      ],
      usedGemini: false,
    };
  }

  const findSectionForTime = (t: number): MusicSection | undefined => {
    return sortedSections.find((s) => t >= s.startSec - 0.02 && t < s.endSec + 0.02);
  };

  const vocalNotes: UstNote[] = [];
  const skippedBySection = new Map<string, number>();

  for (const n of sortedNotes) {
    const mid = (n.startSec + n.endSec) / 2;
    const sec = findSectionForTime(mid);
    if (sec && !sec.allowVocals) {
      if (preserveManualEdits && n.userModified) {
        vocalNotes.push({ ...n, sectionId: sec.id });
      } else {
        skippedBySection.set(sec.id, (skippedBySection.get(sec.id) || 0) + 1);
      }
      continue;
    }
    vocalNotes.push({
      ...n,
      sectionId: sec?.id,
    });
  }

  for (const [secId, count] of skippedBySection.entries()) {
    const sec = sortedSections.find((s) => s.id === secId);
    if (sec) {
      warnings.push({
        sectionId: sec.id,
        sectionName: sec.name,
        type: 'skipped-instrumental',
        syllableCount: 0,
        noteCount: count,
        message: `${sec.name} 구간은 보컬 미허용(반주 구간) 설정이므로 감지된 ${count}개 음표를 보컬 트랙에서 제외했습니다.`,
      });
    }
  }

  if (syllables.length === 0) {
    return { notes: vocalNotes, warnings, usedGemini: false };
  }

  const hasSectionHints = syllables.some((s) => Boolean(s.sectionHint));
  const vocalSections = sortedSections.filter((s) => s.allowVocals);

  const sectionNotesMap = new Map<string, UstNote[]>();
  for (const sec of vocalSections) {
    sectionNotesMap.set(sec.id, []);
  }
  const unassignedNotes: UstNote[] = [];

  for (const n of vocalNotes) {
    if (n.sectionId && sectionNotesMap.has(n.sectionId)) {
      sectionNotesMap.get(n.sectionId)!.push(n);
    } else {
      unassignedNotes.push(n);
    }
  }

  const sectionTokenBuckets = new Map<string, LyricSyllableToken[]>();
  for (const sec of vocalSections) {
    sectionTokenBuckets.set(sec.id, []);
  }

  if (hasSectionHints) {
    const unmatchedTokens: LyricSyllableToken[] = [];
    for (const tok of syllables) {
      if (!tok.sectionHint) {
        unmatchedTokens.push(tok);
        continue;
      }
      const hint = tok.sectionHint.toUpperCase();
      const targetSec =
        vocalSections.find((s) => s.name.toUpperCase() === hint) ||
        vocalSections.find((s) => s.name.toUpperCase().includes(hint) || hint.includes(s.name.toUpperCase()));
      if (targetSec) {
        sectionTokenBuckets.get(targetSec.id)!.push(tok);
      } else {
        unmatchedTokens.push(tok);
      }
    }
    if (unmatchedTokens.length > 0 && vocalSections.length > 0) {
      const firstEmpty = vocalSections.find((s) => (sectionTokenBuckets.get(s.id)?.length || 0) === 0) || vocalSections[0];
      sectionTokenBuckets.get(firstEmpty.id)!.push(...unmatchedTokens);
    }

    const chorusSource = vocalSections.find(
      (s) => s.repeatGroup === 'chorus' && (sectionTokenBuckets.get(s.id)?.length || 0) > 0
    );
    if (chorusSource) {
      const sourceTokens = sectionTokenBuckets.get(chorusSource.id)!;
      for (const sec of vocalSections) {
        if (sec.repeatGroup === 'chorus' && (sectionTokenBuckets.get(sec.id)?.length || 0) === 0) {
          sectionTokenBuckets.set(
            sec.id,
            sourceTokens.map((t, idx) => ({ ...t, id: `${t.id}-rep-${sec.id}-${idx}` }))
          );
        }
      }
    }
  } else {
    let cursor = 0;
    const totalVocalNotes = vocalNotes.length;
    if (totalVocalNotes > 0) {
      for (let i = 0; i < vocalSections.length; i++) {
        const sec = vocalSections[i];
        const secNotes = sectionNotesMap.get(sec.id) || [];
        if (i === vocalSections.length - 1) {
          sectionTokenBuckets.set(sec.id, syllables.slice(cursor));
        } else {
          const share = Math.round((secNotes.length / totalVocalNotes) * syllables.length);
          const slice = syllables.slice(cursor, cursor + share);
          sectionTokenBuckets.set(sec.id, slice);
          cursor += share;
        }
      }
    }
  }

  const alignedNotes: UstNote[] = [];
  let usedGemini = false;
  const ai = getGeminiClient();

  // Optional Gemini phrasing review for sections with minor imbalance
  const imbalancedSections = vocalSections.filter((s) => {
    const nc = (sectionNotesMap.get(s.id) || []).length;
    const tc = (sectionTokenBuckets.get(s.id) || []).length;
    return nc > 0 && tc > 0 && Math.abs(nc - tc) <= 8 && nc !== tc;
  });

  if (ai && imbalancedSections.length > 0 && imbalancedSections.length <= 4) {
    try {
      const summary = imbalancedSections.map((s) => {
        const sn = sectionNotesMap.get(s.id) || [];
        const st = sectionTokenBuckets.get(s.id) || [];
        return {
          sectionId: s.id,
          sectionName: s.name,
          noteCount: sn.length,
          noteDurationsMs: sn.map((n) => Math.round((n.endSec - n.startSec) * 1000)),
          syllables: st.map((t) => t.text),
        };
      });

      const res = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Language: ${LANGUAGE_LABELS[language]}. Given these detected melody notes (with durations in ms) and lyric syllables per section, identify indices of long notes that should be split (when syllables > notes) or short ornamental notes that hold a slur '-' (when notes > syllables). Keep output concise JSON.`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sectionId: { type: Type.STRING },
                    splitNoteIndices: { type: Type.ARRAY, items: { type: Type.INTEGER } },
                    slurNoteIndices: { type: Type.ARRAY, items: { type: Type.INTEGER } },
                  },
                  required: ['sectionId'],
                },
              },
            },
          },
          systemInstruction: `Analyze note durations and lyric alignment only. Data: ${JSON.stringify(summary)}`,
        },
      });

      const parsed = JSON.parse((res.text ?? '{}').trim()) as {
        suggestions?: Array<{
          sectionId: string;
          splitNoteIndices?: number[];
          slurNoteIndices?: number[];
        }>;
      };

      if (parsed.suggestions && parsed.suggestions.length > 0) {
        usedGemini = true;
        for (const sug of parsed.suggestions) {
          const sn = sectionNotesMap.get(sug.sectionId);
          const st = sectionTokenBuckets.get(sug.sectionId);
          if (!sn || !st) continue;

          if (st.length > sn.length && sug.splitNoteIndices && sug.splitNoteIndices.length > 0) {
            const needed = st.length - sn.length;
            let splitsDone = 0;
            const expanded: UstNote[] = [];
            for (let i = 0; i < sn.length; i++) {
              const n = sn[i];
              const dur = n.endSec - n.startSec;
              if (
                splitsDone < needed &&
                !(preserveManualEdits && n.userModified) &&
                sug.splitNoteIndices.includes(i) &&
                dur >= 0.2
              ) {
                const mid = Number(((n.startSec + n.endSec) / 2).toFixed(4));
                expanded.push({ ...n, endSec: mid });
                expanded.push({ ...n, id: `${n.id}-sp`, startSec: mid });
                splitsDone++;
              } else {
                expanded.push(n);
              }
            }
            sectionNotesMap.set(sug.sectionId, expanded);
          }
        }
      }
    } catch {
      // Non-fatal fallback
    }
  }

  for (const sec of vocalSections) {
    let secNotes = sectionNotesMap.get(sec.id) || [];
    const secTokens = sectionTokenBuckets.get(sec.id) || [];

    if (secNotes.length === 0 && secTokens.length === 0) continue;

    if (secTokens.length === 0 && secNotes.length > 0) {
      warnings.push({
        sectionId: sec.id,
        sectionName: sec.name,
        type: 'surplus',
        syllableCount: 0,
        noteCount: secNotes.length,
        message: `${sec.name} 구간에 ${secNotes.length}개의 음표가 있으나 배정된 가사가 없습니다.`,
      });
      alignedNotes.push(...secNotes);
      continue;
    }

    if (secNotes.length === 0 && secTokens.length > 0) {
      warnings.push({
        sectionId: sec.id,
        sectionName: sec.name,
        type: 'deficit',
        syllableCount: secTokens.length,
        noteCount: 0,
        message: `${sec.name} 구간에 가사 ${secTokens.length}음절이 있으나 분석된 음표가 0개입니다.`,
      });
      continue;
    }

    // Automatically split sustained notes if syllables exceed notes
    const unprotectedNoteSlots = secNotes.filter(
      (n) => !(preserveManualEdits && n.userModified)
    ).length;

    if (secTokens.length > secNotes.length && unprotectedNoteSlots > 0) {
      secNotes = expandNotesForExtraSyllables(secNotes, secTokens.length, preserveManualEdits);
    }

    if (secTokens.length > secNotes.length) {
      warnings.push({
        sectionId: sec.id,
        sectionName: sec.name,
        type: 'deficit',
        syllableCount: secTokens.length,
        noteCount: secNotes.length,
        message: `${sec.name} 구간: 가사(${secTokens.length}음절)가 음표(${secNotes.length}개)보다 ${secTokens.length - secNotes.length}개 많아 일부 음절이 누락되었습니다.`,
      });
    } else if (secNotes.length > secTokens.length) {
      warnings.push({
        sectionId: sec.id,
        sectionName: sec.name,
        type: 'surplus',
        syllableCount: secTokens.length,
        noteCount: secNotes.length,
        message: `${sec.name} 구간: 음표(${secNotes.length}개)가 가사(${secTokens.length}음절)보다 ${secNotes.length - secTokens.length}개 많아 남는 음표를 연장음('-')으로 처리했습니다.`,
      });
    }

    let tokCursor = 0;
    for (let i = 0; i < secNotes.length; i++) {
      const note = secNotes[i];
      // Protect manually edited notes when preserveManualEdits is enabled
      if (preserveManualEdits && note.userModified) {
        alignedNotes.push(note);
        continue;
      }

      if (tokCursor < secTokens.length) {
        const tok = secTokens[tokCursor];
        tokCursor++;
        alignedNotes.push({
          ...note,
          lyric: tok.text,
          pronunciation: tok.pronunciation,
          alias: tok.alias,
          phonemeError: tok.phonemeError || validateSyllablePhoneme(tok, language),
        });
      } else {
        alignedNotes.push({
          ...note,
          lyric: '-',
          pronunciation: '-',
          alias: aliasMode === 'VCV' ? '- -' : '-',
          phonemeError: undefined,
        });
      }
    }
  }

  for (const n of unassignedNotes) {
    alignedNotes.push(n);
  }

  alignedNotes.sort((a, b) => a.startSec - b.startSec);
  const tunedNotes = applyProfessionalNoteTuning(
    alignedNotes,
    aliasMode,
    tuningStyle,
    preserveManualEdits
  );

  return { notes: tunedNotes, warnings, usedGemini };
}

export async function auditAndCorrectTuning(params: {
  notes: UstNote[];
  sections: MusicSection[];
  syllables: LyricSyllableToken[];
  language: LyricLanguage;
  aliasMode: AliasMode;
  tuningStyle?: TuningStyle;
  bpm: number;
  applyAutoFix: boolean;
  preserveManualEdits?: boolean;
}): Promise<{
  issues: TuningAuditIssue[];
  correctedNotes: UstNote[];
  proposedDiffs: ProposedNoteEdit[];
  reviewSummary: string;
  usedGemini: boolean;
}> {
  const {
    notes,
    sections,
    syllables,
    language,
    aliasMode,
    tuningStyle = 'pro',
    bpm,
    applyAutoFix,
    preserveManualEdits = true,
  } = params;

  const issues: TuningAuditIssue[] = [];
  let workingNotes = [...notes]
    .sort((a, b) => a.startSec - b.startSec)
    .map((n) => ({ ...n }));
  const sortedSections = [...sections].sort((a, b) => a.startSec - b.startSec);

  // 1. Check timing mismatches (overlaps, micro-notes, non-vocal sections)
  const minDurSec = Math.max(0.035, (60 / Math.max(40, bpm)) / 8);
  for (let i = 0; i < workingNotes.length; i++) {
    const cur = workingNotes[i];
    const dur = cur.endSec - cur.startSec;
    if (dur < 0.04) {
      issues.push({
        id: `timing-short-${cur.id}`,
        category: 'timing-mismatch',
        severity: 'warning',
        noteId: cur.id,
        message: `음표 '${cur.lyric}'의 길이가 너무 짧습니다(${Math.round(dur * 1000)}ms).`,
        autoFixable: true,
      });
      if (applyAutoFix && !(preserveManualEdits && cur.userModified)) {
        cur.endSec = Number((cur.startSec + minDurSec).toFixed(4));
      }
    }

    if (i < workingNotes.length - 1) {
      const next = workingNotes[i + 1];
      if (cur.endSec > next.startSec + 0.001) {
        issues.push({
          id: `timing-overlap-${cur.id}`,
          category: 'timing-mismatch',
          severity: 'error',
          noteId: cur.id,
          message: `'${cur.lyric}' 음표가 다음 음표('${next.lyric}')와 겹칩니다.`,
          autoFixable: true,
        });
        if (applyAutoFix && !(preserveManualEdits && cur.userModified)) {
          cur.endSec = Number(Math.max(cur.startSec + 0.04, next.startSec).toFixed(4));
        }
      }
    }

    const mid = (cur.startSec + cur.endSec) / 2;
    const sec = sortedSections.find((s) => mid >= s.startSec && mid < s.endSec);
    if (sec && !sec.allowVocals) {
      issues.push({
        id: `timing-nonvocal-${cur.id}`,
        category: 'timing-mismatch',
        severity: 'warning',
        noteId: cur.id,
        sectionId: sec.id,
        message: `'${cur.lyric}' 음표가 반주 전용 구간(${sec.name}) 안에 배치되어 있습니다.`,
        autoFixable: false,
      });
    }
  }

  // 2. Check missing lyrics, syllable order, and phoneme conversion errors
  for (let i = 0; i < workingNotes.length; i++) {
    const n = workingNotes[i];
    const isMissing = !n.lyric || !n.lyric.trim() || n.lyric === 'la';
    if (isMissing && syllables.length > 0) {
      issues.push({
        id: `missing-lyric-${n.id}`,
        category: 'missing-lyric',
        severity: 'warning',
        noteId: n.id,
        message: `${i + 1}번째 음표(${n.startSec.toFixed(2)}s)에 가사가 배정되지 않았습니다.`,
        autoFixable: true,
      });
    }

    if ((n.lyric === '-' || n.alias === '-') && i === 0) {
      issues.push({
        id: `order-leading-slur-${n.id}`,
        category: 'syllable-order',
        severity: 'warning',
        noteId: n.id,
        message: `첫 번째 음표가 연장음('-')으로 시작합니다. 시작 음절이 필요합니다.`,
        autoFixable: false,
      });
    }

    const pErr = validateSyllablePhoneme(
      { text: n.lyric, pronunciation: n.pronunciation, alias: n.alias },
      language
    );
    if (pErr) {
      n.phonemeError = pErr;
      issues.push({
        id: `phoneme-${n.id}`,
        category: 'phoneme-error',
        severity: 'error',
        noteId: n.id,
        message: `음표 '${n.lyric}' 발음 오류: ${pErr}`,
        autoFixable: true,
      });
    } else {
      n.phonemeError = undefined;
    }
  }

  // 3. Check repeated chorus lyric consistency
  const chorusSections = sortedSections.filter(
    (s) => s.allowVocals && s.repeatGroup === 'chorus'
  );
  if (chorusSections.length >= 2) {
    const getSecLyrics = (sec: MusicSection) =>
      workingNotes
        .filter((n) => {
          const mid = (n.startSec + n.endSec) / 2;
          return mid >= sec.startSec && mid < sec.endSec;
        })
        .map((n) => n.lyric)
        .filter((l) => l && l !== '-' && l !== 'la');

    const baseLyrics = getSecLyrics(chorusSections[0]);
    for (let c = 1; c < chorusSections.length; c++) {
      const targetSec = chorusSections[c];
      const targetNotes = workingNotes.filter((n) => {
        const mid = (n.startSec + n.endSec) / 2;
        return mid >= targetSec.startSec && mid < targetSec.endSec;
      });
      const targetLyrics = getSecLyrics(targetSec);
      if (
        baseLyrics.length > 0 &&
        (targetLyrics.length === 0 || targetLyrics.join('') !== baseLyrics.join(''))
      ) {
        issues.push({
          id: `chorus-mismatch-${targetSec.id}`,
          category: 'chorus-mismatch',
          severity: 'warning',
          sectionId: targetSec.id,
          message: `반복 후렴구 '${targetSec.name}'의 가사가 '${chorusSections[0].name}'와 일치하지 않습니다.`,
          autoFixable: true,
        });

        if (applyAutoFix) {
          const baseNotes = workingNotes.filter((n) => {
            const mid = (n.startSec + n.endSec) / 2;
            return mid >= chorusSections[0].startSec && mid < chorusSections[0].endSec;
          });
          for (let k = 0; k < targetNotes.length && k < baseNotes.length; k++) {
            if (preserveManualEdits && targetNotes[k].userModified) continue;
            targetNotes[k].lyric = baseNotes[k].lyric;
            targetNotes[k].pronunciation = baseNotes[k].pronunciation;
            targetNotes[k].alias = baseNotes[k].alias;
            targetNotes[k].phonemeError = baseNotes[k].phonemeError;
          }
        }
      }
    }
  }

  // 4. Count mismatch check across vocal notes vs syllables
  const vocalNoteCount = workingNotes.filter((n) => {
    const mid = (n.startSec + n.endSec) / 2;
    const sec = sortedSections.find((s) => mid >= s.startSec && mid < s.endSec);
    return !sec || sec.allowVocals;
  }).length;

  if (syllables.length > 0 && vocalNoteCount !== syllables.length) {
    issues.push({
      id: 'global-count-mismatch',
      category: 'count-mismatch',
      severity: 'warning',
      message: `전체 보컬 음표(${vocalNoteCount}개)와 가사 음절(${syllables.length}개) 개수가 다릅니다.`,
      autoFixable: true,
    });
  }

  // 5. Use Gemini to repair phoneme conversion errors if requested
  let usedGemini = false;
  const ai = getGeminiClient();
  const errorNotes = workingNotes.filter((n) => Boolean(n.phonemeError));

  if (applyAutoFix && ai && errorNotes.length > 0) {
    try {
      const resp = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Convert these untranslated singing syllables for ${LANGUAGE_LABELS[language]} into UTAU ${aliasMode} pronunciation & alias:\n${errorNotes
          .map((n) => `${n.id}: ${n.lyric}`)
          .join('\n')}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              fixed: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    pronunciation: { type: Type.STRING },
                    alias: { type: Type.STRING },
                  },
                  required: ['id', 'pronunciation', 'alias'],
                },
              },
            },
          },
        },
      });
      const parsed = JSON.parse((resp.text ?? '{}').trim()) as {
        fixed?: Array<{ id: string; pronunciation: string; alias: string }>;
      };
      if (parsed.fixed) {
        usedGemini = true;
        for (const f of parsed.fixed) {
          const target = workingNotes.find((n) => n.id === f.id);
          if (target && !(preserveManualEdits && target.userModified)) {
            target.pronunciation = f.pronunciation;
            target.alias = f.alias;
            target.phonemeError = validateSyllablePhoneme(
              { text: target.lyric, pronunciation: target.pronunciation, alias: target.alias },
              language
            );
          }
        }
      }
    } catch {
      // ignore non-fatal Gemini error
    }
  }

  const tunedProposed = applyAutoFix
    ? applyProfessionalNoteTuning(workingNotes, aliasMode, tuningStyle, preserveManualEdits)
    : workingNotes;

  const proposedDiffs: ProposedNoteEdit[] = [];
  const origMap = new Map(notes.map((n) => [n.id, n]));
  for (const cur of tunedProposed) {
    const orig = origMap.get(cur.id);
    if (!orig) continue;
    const changes: string[] = [];
    if (orig.alias !== cur.alias || orig.pronunciation !== cur.pronunciation) {
      changes.push(`발음: ${orig.alias} → ${cur.alias}`);
    }
    if (Math.abs(orig.endSec - cur.endSec) > 0.002) {
      changes.push(`종료: ${orig.endSec.toFixed(2)}s → ${cur.endSec.toFixed(2)}s`);
    }
    if (
      (orig.preUtterance || 0) !== (cur.preUtterance || 0) ||
      (orig.voiceOverlap || 0) !== (cur.voiceOverlap || 0)
    ) {
      changes.push(
        `Pre/Ovl: ${orig.preUtterance || 0}/${orig.voiceOverlap || 0}ms → ${cur.preUtterance || 0}/${cur.voiceOverlap || 0}ms`
      );
    }
    if ((orig.vbr || '') !== (cur.vbr || '')) {
      changes.push(`VBR: ${cur.vbr ? '추가' : '제거'}`);
    }
    if (changes.length > 0) {
      proposedDiffs.push({
        noteId: cur.id,
        label: `${cur.lyric} (${cur.startSec.toFixed(2)}s)`,
        beforeSummary: `${orig.alias} · Pre ${orig.preUtterance || 0}ms`,
        afterSummary: changes.join(' · '),
        reason: cur.phonemeError ? '발음 오류 해결' : `${tuningStyle} 스타일 조교 및 연결 보정`,
      });
    }
  }

  const reviewSummary =
    issues.length === 0
      ? '가사 연결, 언어별 발음, 프레이즈 타이밍 및 음표 겹침 검수 결과 이상이 없습니다.'
      : `총 ${issues.length}건의 검수 항목이 발견되었으며 ${proposedDiffs.length}개 음표에 대한 보정안을 생성했습니다.`;

  return {
    issues,
    correctedNotes: tunedProposed,
    proposedDiffs,
    reviewSummary,
    usedGemini,
  };
}
