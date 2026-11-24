import type {
  AliasMode,
  LyricLanguage,
  LyricSyllableToken,
  PronunciationDictEntry,
  TuningStyle,
  UstNote,
} from '../src/types/ust.ts';

// Hangul Jamo tables
const CHO = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's',
  'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
];
const JUNG = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa',
  'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
];
const JONG = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'l',
  'l', 'l', 'l', 'l', 'l', 'l', 'm', 'p', 'p', 't',
  't', 'ng', 't', 't', 'k', 't', 'p', 't',
];

// Preceding vowel code for VCV Korean/Japanese/Romaji UTAU
const JONG_VCV_PREV = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'l',
  'l', 'l', 'l', 'l', 'l', 'l', 'm', 'p', 'p', 't',
  't', 'ng', 't', 't', 'k', 't', 'p', 't',
];

const JONG_TO_CHO_LIAISON: Record<number, number> = {
  1: 0,  // ㄱ -> ㄱ
  2: 1,  // ㄲ -> ㄲ
  4: 2,  // ㄴ -> ㄴ
  7: 3,  // ㄷ -> ㄷ
  8: 5,  // ㄹ -> ㄹ
  16: 6, // ㅁ -> ㅁ
  17: 7, // ㅂ -> ㅂ
  19: 9, // ㅅ -> ㅅ
  20: 10,// ㅆ -> ㅆ
  22: 12,// ㅈ -> ㅈ
  23: 14,// ㅊ -> ㅊ
  24: 15,// ㅋ -> ㅋ
  25: 16,// ㅌ -> ㅌ
  26: 17,// ㅍ -> ㅍ
};

function isHangulSyllable(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3;
}

function decomposeHangul(ch: string): [number, number, number] {
  const code = ch.charCodeAt(0) - 0xac00;
  const cho = Math.floor(code / 588);
  const jung = Math.floor((code % 588) / 28);
  const jong = code % 28;
  return [cho, jung, jong];
}

function composeHangul(cho: number, jung: number, jong: number): string {
  return String.fromCharCode(0xac00 + cho * 588 + jung * 28 + jong);
}

export function koreanLineToTokens(
  line: string,
  lineIndex: number,
  aliasMode: AliasMode,
  sectionHint?: string
): LyricSyllableToken[] {
  const tokens: LyricSyllableToken[] = [];
  const words = line.trim().split(/\s+/).filter(Boolean);
  let prevVowel = '-';

  for (const word of words) {
    const chars = Array.from(word).filter((c) => isHangulSyllable(c) || /[a-zA-Z0-9]/.test(c));
    // Apply basic Korean liaison rule across adjacent Hangul syllables in the same word
    const adjusted: { display: string; sung: string; cho: number; jung: number; jong: number; raw?: string }[] = [];

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (!isHangulSyllable(ch)) {
        adjusted.push({ display: ch, sung: ch, cho: -1, jung: -1, jong: -1, raw: ch });
        continue;
      }
      const [cho, jung, jong] = decomposeHangul(ch);
      adjusted.push({ display: ch, sung: ch, cho, jung, jong });
    }

    for (let i = 0; i < adjusted.length - 1; i++) {
      const cur = adjusted[i];
      const next = adjusted[i + 1];
      if (cur.cho >= 0 && next.cho === 11 && cur.jong > 0 && JONG_TO_CHO_LIAISON[cur.jong] !== undefined) {
        // Liaison: move final consonant to next syllable's silent initial ㅇ
        next.cho = JONG_TO_CHO_LIAISON[cur.jong];
        cur.jong = 0;
        cur.sung = composeHangul(cur.cho, cur.jung, cur.jong);
        next.sung = composeHangul(next.cho, next.jung, next.jong);
      }
    }

    for (let i = 0; i < adjusted.length; i++) {
      const item = adjusted[i];
      if (item.raw) {
        const rom = item.raw.toLowerCase();
        tokens.push({
          id: `syl-${lineIndex}-${tokens.length}`,
          text: item.display,
          pronunciation: rom,
          alias: aliasMode === 'VCV' ? `${prevVowel} ${rom}` : rom,
          sectionHint,
          lineIndex,
          wordGroup: word,
        });
        prevVowel = 'a';
        continue;
      }

      const rom = `${CHO[item.cho]}${JUNG[item.jung]}${JONG[item.jong]}`;
      let alias = item.sung;
      if (aliasMode === 'VCV') {
        alias = `${prevVowel} ${item.sung}`;
      } else if (aliasMode === 'CVVC') {
        const prevInitial = prevVowel === '-' ? '-' : prevVowel;
        alias = item.jong > 0 ? `${prevInitial} ${item.sung}` : `${prevInitial} ${item.sung}`.trim();
      } else if (aliasMode === 'Romaji') {
        alias = rom;
      }

      tokens.push({
        id: `syl-${lineIndex}-${tokens.length}`,
        text: item.display,
        pronunciation: rom,
        alias,
        sectionHint,
        lineIndex,
        wordGroup: word,
      });

      prevVowel = JONG_VCV_PREV[item.jong] || JUNG[item.jung].slice(-1) || 'a';
      if (prevVowel === 'i' || prevVowel === 'u' || prevVowel === 'e' || prevVowel === 'o' || prevVowel === 'a') {
        // keep
      } else {
        prevVowel = JUNG[item.jung];
      }
    }
    prevVowel = '-';
  }

  return tokens;
}

const KANA_TO_ROMAJI: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'wo', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo',
  てぃ: 'ti', でぃ: 'di', うぃ: 'wi', うぇ: 'we',
  っ: 'q',
};

function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30a1-\u30f6]/g, (m) =>
    String.fromCharCode(m.charCodeAt(0) - 0x60)
  );
}

export function japaneseKanaToTokens(
  line: string,
  lineIndex: number,
  aliasMode: AliasMode,
  sectionHint?: string
): LyricSyllableToken[] {
  const tokens: LyricSyllableToken[] = [];
  const smallYoon = new Set(['ゃ', 'ゅ', 'ょ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ']);
  const words = line.trim().split(/\s+/).filter(Boolean);

  for (const word of words) {
    const hira = katakanaToHiragana(word);
    const rawChars = Array.from(word);
    const hiraChars = Array.from(hira);
    let prevVowel = '-';

    for (let i = 0; i < hiraChars.length; i++) {
      let moraHira = hiraChars[i];
      let moraDisp = rawChars[i];

      if (i + 1 < hiraChars.length && smallYoon.has(hiraChars[i + 1])) {
        moraHira += hiraChars[i + 1];
        moraDisp += rawChars[i + 1];
        i++;
      }

      if (moraHira === 'ー') {
        const vowel = prevVowel !== '-' ? prevVowel : 'a';
        const kanaVowel =
          vowel === 'a' ? 'あ' : vowel === 'i' ? 'い' : vowel === 'u' ? 'う' : vowel === 'e' ? 'え' : 'お';
        tokens.push({
          id: `syl-${lineIndex}-${tokens.length}`,
          text: moraDisp,
          pronunciation: vowel,
          alias:
            aliasMode === 'VCV'
              ? `${prevVowel} ${kanaVowel}`
              : aliasMode === 'Romaji'
              ? vowel
              : kanaVowel,
          sectionHint,
          lineIndex,
          wordGroup: word,
        });
        prevVowel = vowel;
        continue;
      }

      const romaji = KANA_TO_ROMAJI[moraHira];
      if (!romaji) {
        // Non-kana (e.g. Kanji fallback before Gemini resolution)
        if (/[\u4e00-\u9faf\u3400-\u4dbfa-zA-Z]/.test(moraDisp)) {
          tokens.push({
            id: `syl-${lineIndex}-${tokens.length}`,
            text: moraDisp,
            pronunciation: moraDisp,
            alias: moraDisp,
            sectionHint,
            lineIndex,
            wordGroup: word,
          });
        }
        continue;
      }

      let alias = moraHira;
      if (aliasMode === 'VCV') {
        alias = `${prevVowel} ${moraHira}`;
      } else if (aliasMode === 'CVVC') {
        alias = prevVowel === '-' ? `- ${moraHira}` : moraHira;
      } else if (aliasMode === 'Romaji') {
        alias = romaji;
      }

      tokens.push({
        id: `syl-${lineIndex}-${tokens.length}`,
        text: moraDisp,
        pronunciation: romaji,
        alias,
        sectionHint,
        lineIndex,
        wordGroup: word,
      });

      const lastChar = romaji.slice(-1);
      prevVowel = ['a', 'i', 'u', 'e', 'o', 'n'].includes(lastChar) ? lastChar : 'a';
    }
  }
  return tokens;
}

export function spanishLineToTokens(
  line: string,
  lineIndex: number,
  aliasMode: AliasMode,
  sectionHint?: string
): LyricSyllableToken[] {
  const tokens: LyricSyllableToken[] = [];
  const words = line
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);

  const isVowel = (c: string) => /[aeiouáéíóúü]/.test(c);
  const isStrongVowel = (c: string) => /[aeoáéóíú]/.test(c);
  const inseparableOnsets = new Set([
    'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'tr', 'ch', 'll', 'rr',
  ]);

  for (const word of words) {
    const syllables: string[] = [];
    let current = '';
    const chars = Array.from(word);

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      current += ch;

      if (isVowel(ch)) {
        // Check vowel hiatus vs diphthong
        const next = chars[i + 1];
        if (next && isVowel(next)) {
          if (isStrongVowel(ch) && isStrongVowel(next)) {
            syllables.push(current);
            current = '';
          }
          continue;
        }

        // Look ahead at consonants between this vowel and the next vowel
        let cons = '';
        let j = i + 1;
        while (j < chars.length && !isVowel(chars[j])) {
          cons += chars[j];
          j++;
        }

        if (j >= chars.length) {
          // Trailing consonants stay with last syllable
          current += cons;
          syllables.push(current);
          current = '';
          break;
        }

        if (cons.length === 0) {
          syllables.push(current);
          current = '';
        } else if (cons.length === 1) {
          syllables.push(current);
          current = '';
        } else if (cons.length === 2) {
          if (inseparableOnsets.has(cons)) {
            syllables.push(current);
            current = '';
          } else {
            current += cons[0];
            i += 1;
            syllables.push(current);
            current = '';
          }
        } else {
          // 3+ consonants
          const lastTwo = cons.slice(-2);
          const splitIdx = inseparableOnsets.has(lastTwo) ? cons.length - 2 : cons.length - 1;
          current += cons.slice(0, splitIdx);
          i += splitIdx;
          syllables.push(current);
          current = '';
        }
      }
    }
    if (current) {
      if (syllables.length > 0 && !Array.from(current).some(isVowel)) {
        syllables[syllables.length - 1] += current;
      } else {
        syllables.push(current);
      }
    }

    let prevVowel = '-';
    for (const syl of syllables) {
      const norm = syl
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ñ/g, 'ny')
        .replace(/j/g, 'h')
        .replace(/ll/g, 'y')
        .replace(/qu/g, 'k');
      const vMatch = norm.match(/[aeiou](?!.*[aeiou])/);
      const alias = aliasMode === 'VCV' ? `${prevVowel} ${norm}` : norm;
      tokens.push({
        id: `syl-${lineIndex}-${tokens.length}`,
        text: syl,
        pronunciation: norm,
        alias,
        sectionHint,
        lineIndex,
        wordGroup: word,
      });
      prevVowel = vMatch ? vMatch[0] : 'a';
    }
  }
  return tokens;
}

export function englishFallbackToTokens(
  line: string,
  lineIndex: number,
  aliasMode: AliasMode,
  sectionHint?: string
): LyricSyllableToken[] {
  const tokens: LyricSyllableToken[] = [];
  const words = line
    .replace(/[^a-zA-Z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const word of words) {
    const clean = word.toLowerCase().replace(/'/g, '');
    // Basic vowel-group syllabification fallback
    const parts = clean
      .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
      .replace(/^y/, '')
      .match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*(?=[aeiouy]|$))?/g);

    const syls = parts && parts.length > 0 ? parts : [clean];
    let prevVowel = '-';
    for (let idx = 0; idx < syls.length; idx++) {
      const syl = syls[idx];
      const disp = idx === 0 && syls.length === 1 ? word : syl;
      const alias = aliasMode === 'VCV' ? `${prevVowel} ${syl}` : syl;
      tokens.push({
        id: `syl-${lineIndex}-${tokens.length}`,
        text: disp,
        pronunciation: syl,
        alias,
        sectionHint,
        lineIndex,
        wordGroup: word,
      });
      const vMatch = syl.match(/[aeiou]/);
      prevVowel = vMatch ? vMatch[0] : 'a';
    }
  }
  return tokens;
}

export function chineseFallbackToTokens(
  line: string,
  lineIndex: number,
  aliasMode: AliasMode,
  sectionHint?: string
): LyricSyllableToken[] {
  const tokens: LyricSyllableToken[] = [];
  const chars = Array.from(line).filter((c) => /[\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]/.test(c));
  for (const ch of chars) {
    tokens.push({
      id: `syl-${lineIndex}-${tokens.length}`,
      text: ch,
      pronunciation: ch,
      alias: aliasMode === 'VCV' ? `- ${ch}` : ch,
      sectionHint,
      lineIndex,
      wordGroup: ch,
    });
  }
  return tokens;
}

export function deterministicSyllabify(
  rawLyrics: string,
  language: LyricLanguage,
  aliasMode: AliasMode,
  customDictionary: PronunciationDictEntry[]
): LyricSyllableToken[] {
  const lines = rawLyrics.split(/\r?\n/);
  const allTokens: LyricSyllableToken[] = [];
  let currentSectionHint: string | undefined;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const trimmed = lines[lineIdx].trim();
    if (!trimmed) continue;

    // Check section tag e.g. [VERSE 1] or [CHORUS 1]
    const secMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (secMatch) {
      currentSectionHint = secMatch[1].trim().toUpperCase();
      continue;
    }

    let lineTokens: LyricSyllableToken[] = [];
    if (language === 'ko') {
      lineTokens = koreanLineToTokens(trimmed, lineIdx, aliasMode, currentSectionHint);
    } else if (language === 'ja') {
      lineTokens = japaneseKanaToTokens(trimmed, lineIdx, aliasMode, currentSectionHint);
    } else if (language === 'es') {
      lineTokens = spanishLineToTokens(trimmed, lineIdx, aliasMode, currentSectionHint);
    } else if (language === 'zh-CN' || language === 'zh-TW') {
      lineTokens = chineseFallbackToTokens(trimmed, lineIdx, aliasMode, currentSectionHint);
    } else {
      lineTokens = englishFallbackToTokens(trimmed, lineIdx, aliasMode, currentSectionHint);
    }

    for (const tok of lineTokens) {
      allTokens.push(applyCustomDict(tok, language, customDictionary));
    }
  }

  return allTokens;
}

export function validateSyllablePhoneme(
  token: Pick<LyricSyllableToken, 'text' | 'pronunciation' | 'alias'>,
  language: LyricLanguage
): string | undefined {
  const pron = (token.pronunciation || '').trim();
  const alias = (token.alias || '').trim();
  if (!pron || !alias) {
    return '발음 또는 UTAU Alias가 비어 있습니다.';
  }
  if (/[\r\n=\[\]]/.test(alias)) {
    return 'Alias에 UST 예약 문자(=, [, ])가 포함되어 있습니다.';
  }
  if (language === 'ja' && /[\u4e00-\u9faf\u3400-\u4dbf]/.test(alias)) {
    return '일본어 한자가 히라가나/로마지로 변환되지 않았습니다.';
  }
  if ((language === 'zh-CN' || language === 'zh-TW') && /[\u4e00-\u9fff\u3400-\u4dbf]/.test(pron)) {
    return '중국어 한자가 병음(Pinyin)으로 변환되지 않았습니다.';
  }
  return undefined;
}

export function applyCustomDict(
  token: LyricSyllableToken,
  language: LyricLanguage,
  dict: PronunciationDictEntry[]
): LyricSyllableToken {
  const match = dict.find(
    (entry) =>
      (entry.language === 'all' || entry.language === language) &&
      entry.source.trim().toLowerCase() === token.text.trim().toLowerCase()
  );
  const updated = match
    ? {
        ...token,
        pronunciation: match.pronunciation,
        alias: match.alias || match.pronunciation,
      }
    : token;
  return {
    ...updated,
    phonemeError: validateSyllablePhoneme(updated, language),
  };
}

/**
 * Professional UTAU timing, Mode2 pitch transition, and vibrato tuning
 * Applies distinct consonant/vowel timing for fast vs. slow/legato passages
 */
export function applyProfessionalNoteTuning(
  notes: UstNote[],
  aliasMode: AliasMode,
  tuningStyle: TuningStyle = 'pro',
  preserveManualEdits = true
): UstNote[] {
  const sorted = [...notes].sort((a, b) => a.startSec - b.startSec);

  return sorted.map((note, idx) => {
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const isConnectedPrev = Boolean(prev && note.startSec - prev.endSec <= 0.08);
    const phraseId =
      prev && note.startSec - prev.endSec <= 0.35
        ? prev.phraseId || `phrase-${idx}`
        : `phrase-${idx + 1}`;

    if (preserveManualEdits && note.userModified) {
      return { ...note, phraseId };
    }

    const durSec = note.endSec - note.startSec;
    const isFast = durSec < 0.22;
    const isLong = durSec >= 0.58;
    const isSlur = note.lyric === '-' || note.alias === '-';

    // Accurate mode: preserve original timing cleanly with minimal transition alteration
    if (tuningStyle === 'accurate') {
      return {
        ...note,
        phraseId,
        preUtterance: 0,
        voiceOverlap: 0,
        envelope: '0,5,35,0,100,100,0',
        pbs: '-20;0',
        pbw: '40',
        pby: '0',
        vbr: '',
      };
    }

    // Consonant/vowel PreUtterance & VoiceOverlap based on style and speed
    const basePre =
      tuningStyle === 'detailed' || tuningStyle === 'pro'
        ? isSlur
          ? 8
          : isFast
          ? 24
          : aliasMode === 'VCV' || aliasMode === 'CVVC'
          ? 48
          : 36
        : isFast
        ? 28
        : 35;

    const voiceOverlap = isConnectedPrev
      ? isSlur
        ? 38
        : isFast
        ? tuningStyle === 'detailed'
          ? 12
          : 16
        : aliasMode === 'VCV'
        ? 42
        : 28
      : 0;

    // Envelope shaping
    const envelope =
      tuningStyle === 'detailed' || tuningStyle === 'pro'
        ? isFast
          ? '0,3,22,0,100,100,0'
          : isLong
          ? '0,12,45,0,100,100,0'
          : '0,6,35,0,100,100,0'
        : '0,6,35,0,100,100,0';

    // Mode2 pitch bend smoothing
    let pbs = '-25;0';
    let pbw = '50';
    let pby = '0';
    if (prev && isConnectedPrev && prev.midi !== note.midi) {
      const semiDiff = (prev.midi - note.midi) * 10;
      const clampedDiff = Math.max(-120, Math.min(120, semiDiff));
      const glideMs =
        tuningStyle === 'natural'
          ? isFast
            ? 30
            : 65
          : tuningStyle === 'detailed'
          ? isFast
            ? 25
            : 55
          : isFast
          ? 35
          : 80;
      pbs = `-${Math.round(glideMs / 2)};${clampedDiff}`;
      pbw = `${glideMs}`;
      pby = '0';
    } else if (tuningStyle === 'pro' && !isConnectedPrev && !isFast) {
      // Subtle expressive scoop (shakuri) at phrase start
      pbs = '-30;-12';
      pbw = '65';
      pby = '0';
    }

    // Vibrato applied in 'pro' mode on sustained notes >= 580ms
    const vbr =
      tuningStyle === 'pro' && isLong && !isFast
        ? '65,165,34,22,25,0,0,0'
        : note.vbr || '';

    return {
      ...note,
      phraseId,
      preUtterance: basePre,
      voiceOverlap,
      envelope,
      pbs,
      pbw,
      pby,
      vbr,
    };
  });
}


