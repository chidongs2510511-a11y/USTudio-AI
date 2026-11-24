import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  FileAudio,
  Languages,
  Merge,
  ShieldCheck,
  Sliders,
  Sparkles,
  Split,
  Upload,
  Wand2,
} from 'lucide-react';
import type {
  AliasMode,
  AlignmentWarning,
  AnalysisSettings,
  AudioAnalysisResult,
  LyricLanguage,
  LyricSyllableToken,
  QuantizeGrid,
  TimeSignature,
  TuningStyle,
  UstNote,
} from '../types/ust';

interface LeftSidebarProps {
  audioFile: File | null;
  analysisResult: AudioAnalysisResult | null;
  analysisSettings: AnalysisSettings;
  isAnalyzing: boolean;
  onAudioFileSelect: (file: File) => void;
  onUpdateSettings: (patch: Partial<AnalysisSettings>) => void;
  onRunAudioAnalysis: () => void;

  language: LyricLanguage;
  aliasMode: AliasMode;
  tuningStyle: TuningStyle;
  rawLyrics: string;
  syllables: LyricSyllableToken[];
  notes: UstNote[];
  alignmentWarnings: AlignmentWarning[];
  isConvertingLyrics: boolean;
  isAligning: boolean;
  isAuditing: boolean;
  phoneticNotice: string | null;
  onLanguageChange: (lang: LyricLanguage) => void;
  onAliasModeChange: (mode: AliasMode) => void;
  onTuningStyleChange: (style: TuningStyle) => void;
  onRawLyricsChange: (text: string) => void;
  onConvertLyrics: () => void;
  onAlignLyrics: () => void;
  onRunSelfReview: () => void;
  onUpdateSyllable: (id: string, patch: Partial<LyricSyllableToken>) => void;
  onSplitSyllable: (id: string) => void;
  onMergeSyllableWithNext: (id: string) => void;
  onOpenDictionary: () => void;
}

const LANGUAGE_OPTIONS: Array<{ value: LyricLanguage; label: string }> = [
  { value: 'ko', label: '한국어 (Korean)' },
  { value: 'ja', label: '일본어 (日本語)' },
  { value: 'en', label: '영어 (English)' },
  { value: 'zh-CN', label: '중국어 간체 (简体中文)' },
  { value: 'zh-TW', label: '중국어 번체 (繁體中文)' },
  { value: 'es', label: '스페인어 (Español)' },
];

const TUNING_STYLE_OPTIONS: Array<{ value: TuningStyle; label: string; desc: string }> = [
  { value: 'pro', label: '전문가 조교', desc: '발음·타이밍·프레이즈·피치곡선·비브라토 종합 보정' },
  { value: 'natural', label: '자연스러운 조교', desc: '발음 연결과 부드러운 타이밍 중심' },
  { value: 'detailed', label: '섬세한 조교', desc: '자음/모음 PreUtterance·Overlap 미세 조정' },
  { value: 'accurate', label: '정확한 조교', desc: '원곡 멜로디와 리듬을 최대한 그대로 유지' },
];

const QUICK_TAGS = [
  '[VERSE 1]',
  '[PRE-CHORUS 1]',
  '[CHORUS 1]',
  '[VERSE 2]',
  '[CHORUS 2]',
  '[BRIDGE]',
  '[FINAL CHORUS]',
];

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  audioFile,
  analysisResult,
  analysisSettings,
  isAnalyzing,
  onAudioFileSelect,
  onUpdateSettings,
  onRunAudioAnalysis,
  language,
  aliasMode,
  tuningStyle,
  rawLyrics,
  syllables,
  notes,
  alignmentWarnings,
  isConvertingLyrics,
  isAligning,
  isAuditing,
  phoneticNotice,
  onLanguageChange,
  onAliasModeChange,
  onTuningStyleChange,
  onRawLyricsChange,
  onConvertLyrics,
  onAlignLyrics,
  onRunSelfReview,
  onUpdateSyllable,
  onSplitSyllable,
  onMergeSyllableWithNext,
  onOpenDictionary,
}) => {
  const [activeTab, setActiveTab] = useState<'audio' | 'lyrics'>('audio');
  const [isDragging, setIsDragging] = useState(false);
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onAudioFileSelect(f);
  };

  const activeStyleDesc =
    TUNING_STYLE_OPTIONS.find((s) => s.value === tuningStyle)?.desc || '';

  return (
    <aside className="w-80 xl:w-[348px] shrink-0 bg-[#121622] border-r border-slate-800/80 flex flex-col h-full overflow-hidden">
      {/* Segmented Tabs */}
      <div className="p-2 border-b border-slate-800/80 grid grid-cols-2 gap-1 bg-[#0E121D]">
        <button
          type="button"
          onClick={() => setActiveTab('audio')}
          className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'audio'
              ? 'bg-[#1B2236] text-white border border-slate-700/80'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5 text-blue-400" />
          <span>음원 · 분석</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('lyrics')}
          className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'lyrics'
              ? 'bg-[#1B2236] text-white border border-slate-700/80'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Languages className="w-3.5 h-3.5 text-violet-400" />
          <span>가사 · 조교</span>
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {activeTab === 'audio' ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">참조 음원 업로드</span>
                <span className="text-[11px] text-slate-500">MP3 / WAV / FLAC</span>
              </div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => audioInputRef.current?.click()}
                className={`border border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-violet-500 bg-violet-500/10'
                    : 'border-slate-700/90 bg-[#0B0D14] hover:border-slate-600'
                }`}
              >
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onAudioFileSelect(f);
                    e.target.value = '';
                  }}
                />
                {audioFile ? (
                  <div className="space-y-1">
                    <FileAudio className="w-5 h-5 text-blue-400 mx-auto" />
                    <div className="text-xs font-medium text-slate-200 truncate px-2">
                      {audioFile.name}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500">
                      {(audioFile.size / (1024 * 1024)).toFixed(2)} MB · 클릭하여 변경
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Upload className="w-5 h-5 text-slate-400 mx-auto" />
                    <div className="text-xs font-medium text-slate-300">
                      오디오 파일을 드래그하거나 클릭하세요
                    </div>
                    <div className="text-[11px] text-slate-500">
                      최대 40MB · MP3, WAV 지원
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3.5 pt-2 border-t border-slate-800/80">
              <span className="block text-xs font-semibold text-slate-200">오디오 분석 설정</span>

              <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                <span>보컬 대역 분리 후 F0 추출</span>
                <input
                  type="checkbox"
                  checked={analysisSettings.vocalIsolation}
                  onChange={(e) => onUpdateSettings({ vocalIsolation: e.target.checked })}
                  className="accent-violet-500"
                />
              </label>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>음정(YIN) 감지 민감도</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {Math.round(analysisSettings.sensitivity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.15}
                  max={0.95}
                  step={0.05}
                  value={analysisSettings.sensitivity}
                  onChange={(e) => onUpdateSettings({ sensitivity: Number(e.target.value) })}
                  className="w-full accent-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">스냅 / 퀀타이즈</label>
                  <select
                    value={analysisSettings.quantizeGrid}
                    onChange={(e) =>
                      onUpdateSettings({ quantizeGrid: e.target.value as QuantizeGrid })
                    }
                    className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200"
                  >
                    <option value="1/32">1/32 박자</option>
                    <option value="1/16">1/16 박자</option>
                    <option value="1/8">1/8 박자</option>
                    <option value="1/4">1/4 박자</option>
                    <option value="none">자유 타이밍</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">박자 (Meter)</label>
                  <select
                    value={analysisSettings.timeSignature}
                    onChange={(e) =>
                      onUpdateSettings({ timeSignature: e.target.value as TimeSignature })
                    }
                    className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200"
                  >
                    <option value="4/4">4/4</option>
                    <option value="3/4">3/4</option>
                    <option value="6/8">6/8</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    최소 음표 길이 (ms)
                  </label>
                  <input
                    type="number"
                    min={40}
                    max={300}
                    step={5}
                    value={analysisSettings.minNoteDurationMs}
                    onChange={(e) =>
                      onUpdateSettings({
                        minNoteDurationMs: Math.max(40, Math.min(300, Number(e.target.value) || 85)),
                      })
                    }
                    className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1.5 text-xs font-mono tabular-nums text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    수동 BPM (비우면 자동)
                  </label>
                  <input
                    type="number"
                    min={40}
                    max={240}
                    placeholder="자동 분석"
                    value={analysisSettings.manualBpm ?? ''}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      onUpdateSettings({
                        manualBpm: val ? Math.max(40, Math.min(240, Number(val))) : null,
                      });
                    }}
                    className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1.5 text-xs font-mono tabular-nums text-slate-200"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={onRunAudioAnalysis}
                disabled={!audioFile || isAnalyzing}
                className="w-full py-2 px-3 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:pointer-events-none text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isAnalyzing ? '신호 처리 및 F0 추출 중...' : '음원 멜로디 분석 실행'}</span>
              </button>
            </div>

            {analysisResult && (
              <div className="pt-3 border-t border-slate-800/80 space-y-2">
                <span className="block text-xs font-semibold text-slate-200">분석 결과</span>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs bg-[#0B0D14] border border-slate-800/80 rounded-md p-3">
                  <div className="text-slate-400">감지 BPM</div>
                  <div className="text-right font-mono tabular-nums text-blue-300 font-medium">
                    {analysisResult.detectedBpm.toFixed(1)} ({Math.round(analysisResult.bpmConfidence * 100)}%)
                  </div>
                  <div className="text-slate-400">음원 길이</div>
                  <div className="text-right font-mono tabular-nums text-slate-200">
                    {analysisResult.durationSec.toFixed(2)}s
                  </div>
                  <div className="text-slate-400">감지 마디 수</div>
                  <div className="text-right font-mono tabular-nums text-slate-200">
                    {analysisResult.bars.length} bars
                  </div>
                  <div className="text-slate-400">추출 음표 수</div>
                  <div className="text-right font-mono tabular-nums text-violet-300 font-medium">
                    {analysisResult.notes.length} notes
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Language & Alias Mode */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  가사 언어
                </label>
                <select
                  value={language}
                  onChange={(e) => onLanguageChange(e.target.value as LyricLanguage)}
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200"
                >
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  UTAU 발음 표기
                </label>
                <select
                  value={aliasMode}
                  onChange={(e) => onAliasModeChange(e.target.value as AliasMode)}
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200"
                >
                  <option value="CV">CV (단독음)</option>
                  <option value="VCV">VCV (연속음)</option>
                  <option value="CVVC">CVVC (표준 연결)</option>
                  <option value="Romaji">Romaji / Phonetic</option>
                </select>
              </div>
            </div>

            {/* AI Tuning Style */}
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">
                AI 조교 스타일
              </label>
              <select
                value={tuningStyle}
                onChange={(e) => onTuningStyleChange(e.target.value as TuningStyle)}
                className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200"
              >
                {TUNING_STYLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500">{activeStyleDesc}</p>
            </div>

            {/* Lyrics Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200">가사 입력</label>
                <button
                  type="button"
                  onClick={onOpenDictionary}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
                >
                  <BookOpen className="w-3 h-3" />
                  <span>발음 사전</span>
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {QUICK_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      onRawLyricsChange(
                        rawLyrics.trim() ? `${rawLyrics.trimEnd()}\n${tag}\n` : `${tag}\n`
                      )
                    }
                    className="px-1.5 py-0.5 text-[10px] font-mono bg-[#0B0D14] hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded"
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <textarea
                value={rawLyrics}
                onChange={(e) => onRawLyricsChange(e.target.value)}
                rows={5}
                placeholder={`예시:\n[VERSE 1]\n별빛이 내리는 밤에\n[CHORUS 1]\n너의 이름을 불러봐`}
                className="w-full bg-[#0B0D14] border border-slate-800 focus:border-violet-500 focus:outline-none rounded-md p-2.5 text-xs text-slate-100 leading-relaxed resize-y"
              />
            </div>

            {/* Convert, Auto-Align, & Self-Review Actions */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onConvertLyrics}
                  disabled={!rawLyrics.trim() || isConvertingLyrics}
                  className="py-2 px-2.5 rounded-md bg-[#1B2236] hover:bg-[#232C45] border border-slate-700 disabled:opacity-40 text-xs font-medium text-slate-100 inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Languages className="w-3.5 h-3.5 text-blue-400" />
                  <span>{isConvertingLyrics ? '변환 중...' : '음절·발음 변환'}</span>
                </button>
                <button
                  type="button"
                  onClick={onAlignLyrics}
                  disabled={isAligning}
                  className="py-2 px-2.5 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>{isAligning ? '조교 중...' : '자동 조교 실행'}</span>
                </button>
              </div>
              <button
                type="button"
                onClick={onRunSelfReview}
                disabled={notes.length === 0 || isAuditing}
                className="w-full py-1.5 px-3 rounded-md bg-[#161B2B] hover:bg-slate-800 border border-blue-500/40 disabled:opacity-40 text-xs font-medium text-blue-200 inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                <span>{isAuditing ? 'AI 자체 검수 중...' : 'AI 자체 검수 및 보정안 확인'}</span>
              </button>
            </div>

            {phoneticNotice && (
              <div className="p-2.5 rounded-md bg-amber-950/40 border border-amber-800/50 text-[11px] text-amber-200">
                {phoneticNotice}
              </div>
            )}

            {alignmentWarnings.length > 0 && (
              <div className="space-y-1.5">
                {alignmentWarnings.map((w, idx) => (
                  <div
                    key={`${w.sectionId}-${idx}`}
                    className={`p-2.5 rounded-md border text-[11px] flex items-start gap-2 ${
                      w.type === 'deficit'
                        ? 'bg-rose-950/35 border-rose-800/50 text-rose-200'
                        : w.type === 'surplus'
                        ? 'bg-amber-950/35 border-amber-800/50 text-amber-200'
                        : 'bg-slate-900/70 border-slate-800 text-slate-300'
                    }`}
                  >
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{w.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Interactive Syllable Token Editor (Split / Merge / Inline Edit) */}
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  음절 및 발음 ({syllables.length})
                </span>
                <span className="text-[11px] text-slate-500">분리 · 합치기 · 수정</span>
              </div>

              {syllables.length === 0 ? (
                <div className="p-3 rounded-md bg-[#0B0D14] border border-slate-800/80 text-[11px] text-slate-500">
                  가사를 입력하고 &lsquo;음절·발음 변환&rsquo;을 누르면 언어별 음절 분리와 표준 UTAU 발음이 표시됩니다.
                </div>
              ) : (
                <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                  {syllables.map((tok, i) => {
                    const isEditing = editingTokenId === tok.id;
                    return (
                      <div
                        key={tok.id}
                        className={`bg-[#0B0D14] border rounded px-2.5 py-1.5 text-xs ${
                          tok.phonemeError ? 'border-rose-600/70' : 'border-slate-800/80'
                        }`}
                      >
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <div className="grid grid-cols-3 gap-1.5">
                              <input
                                type="text"
                                value={tok.text}
                                onChange={(e) =>
                                  onUpdateSyllable(tok.id, { text: e.target.value })
                                }
                                placeholder="음절"
                                className="bg-[#121622] border border-slate-700 rounded px-1.5 py-1 text-xs text-white"
                              />
                              <input
                                type="text"
                                value={tok.pronunciation}
                                onChange={(e) =>
                                  onUpdateSyllable(tok.id, { pronunciation: e.target.value })
                                }
                                placeholder="발음"
                                className="bg-[#121622] border border-slate-700 rounded px-1.5 py-1 text-xs font-mono text-blue-200"
                              />
                              <input
                                type="text"
                                value={tok.alias}
                                onChange={(e) =>
                                  onUpdateSyllable(tok.id, { alias: e.target.value })
                                }
                                placeholder="Alias"
                                className="bg-[#121622] border border-slate-700 rounded px-1.5 py-1 text-xs font-mono text-violet-200"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditingTokenId(null)}
                              className="text-[11px] text-blue-400 hover:text-blue-300"
                            >
                              완료
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <div
                              onClick={() => setEditingTokenId(tok.id)}
                              className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                            >
                              <span className="text-[10px] font-mono tabular-nums text-slate-500 w-4">
                                {i + 1}
                              </span>
                              <span className="font-medium text-slate-100 truncate">
                                {tok.text}
                              </span>
                              <span className="font-mono text-[11px] text-blue-300 truncate">
                                {tok.pronunciation}
                              </span>
                              <span className="font-mono text-[11px] text-violet-300 truncate">
                                {tok.alias}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => onSplitSyllable(tok.id)}
                                title="음절 분리"
                                className="p-1 text-slate-500 hover:text-slate-200"
                              >
                                <Split className="w-3 h-3" />
                              </button>
                              {i < syllables.length - 1 && (
                                <button
                                  type="button"
                                  onClick={() => onMergeSyllableWithNext(tok.id)}
                                  title="다음 음절과 합치기"
                                  className="p-1 text-slate-500 hover:text-slate-200"
                                >
                                  <Merge className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {tok.phonemeError && (
                          <div className="mt-1 text-[10px] text-rose-300">
                            {tok.phonemeError}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Live Tuning Preview Strip */}
            {notes.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                <span className="block text-xs font-semibold text-slate-200">
                  조교 결과 실시간 미리보기 ({notes.length}음표)
                </span>
                <div className="bg-[#0B0D14] border border-slate-800/80 rounded-md p-2 max-h-28 overflow-y-auto flex flex-wrap gap-1.5 text-[11px]">
                  {notes.slice(0, 60).map((n) => (
                    <span
                      key={n.id}
                      className={`px-1.5 py-0.5 rounded border font-mono ${
                        n.phonemeError
                          ? 'border-rose-600/70 text-rose-200 bg-rose-950/30'
                          : n.userModified
                          ? 'border-blue-500/50 text-blue-100 bg-blue-950/30'
                          : 'border-slate-800 text-slate-300 bg-[#121622]'
                      }`}
                      title={`시작 ${n.startSec.toFixed(2)}s · Pre ${n.preUtterance || 0}ms`}
                    >
                      {n.lyric}
                      <span className="text-slate-500 ml-1">({n.alias})</span>
                    </span>
                  ))}
                  {notes.length > 60 && (
                    <span className="text-slate-500 self-center">
                      +{notes.length - 60}개 더 있음
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
