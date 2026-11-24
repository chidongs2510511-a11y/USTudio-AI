import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type {
  LyricLanguage,
  MusicSection,
  PronunciationDictEntry,
  ProposedNoteEdit,
  TimeSignature,
  TuningAuditIssue,
  UstNote,
} from '../types/ust';
import {
  generateUstContent,
  validateUstProject,
} from '../utils/ustExporter';

interface DictionaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: PronunciationDictEntry[];
  onAddEntry: (entry: Omit<PronunciationDictEntry, 'id'>) => void;
  onDeleteEntry: (id: string) => void;
  onApplyToCurrent: () => void;
}

export const DictionaryModal: React.FC<DictionaryModalProps> = ({
  isOpen,
  onClose,
  entries,
  onAddEntry,
  onDeleteEntry,
  onApplyToCurrent,
}) => {
  const [source, setSource] = useState('');
  const [language, setLanguage] = useState<LyricLanguage | 'all'>('all');
  const [pronunciation, setPronunciation] = useState('');
  const [alias, setAlias] = useState('');

  if (!isOpen) return null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!source.trim() || !pronunciation.trim()) return;
    onAddEntry({
      source: source.trim(),
      language,
      pronunciation: pronunciation.trim(),
      alias: (alias || pronunciation).trim(),
    });
    setSource('');
    setPronunciation('');
    setAlias('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#121622] border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">사용자 정의 발음 사전</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              특정 단어나 음절의 발음 기호 및 표준 UTAU Alias를 수동 규칙으로 고정합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleAdd} className="p-4 border-b border-slate-800/80 grid grid-cols-12 gap-2">
          <input
            type="text"
            placeholder="원본 음절/단어"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="col-span-3 bg-[#0B0D14] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-100"
          />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as LyricLanguage | 'all')}
            className="col-span-2 bg-[#0B0D14] border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200"
          >
            <option value="all">전체</option>
            <option value="ko">한국어</option>
            <option value="ja">일본어</option>
            <option value="en">영어</option>
            <option value="zh-CN">중국어 간체</option>
            <option value="zh-TW">중국어 번체</option>
            <option value="es">스페인어</option>
          </select>
          <input
            type="text"
            placeholder="발음 기호"
            value={pronunciation}
            onChange={(e) => setPronunciation(e.target.value)}
            className="col-span-3 bg-[#0B0D14] border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-blue-200"
          />
          <input
            type="text"
            placeholder="UTAU Alias"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            className="col-span-2 bg-[#0B0D14] border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-violet-200"
          />
          <button
            type="submit"
            className="col-span-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded inline-flex items-center justify-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>추가</span>
          </button>
        </form>

        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {entries.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">
              등록된 사용자 발음 규칙이 없습니다. 위 입력창에서 자주 쓰는 발음을 추가하세요.
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between bg-[#0B0D14] border border-slate-800/80 rounded px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-4">
                  <span className="font-medium text-slate-100">{entry.source}</span>
                  <span className="text-slate-500 font-mono text-[11px]">{entry.language}</span>
                  <span className="text-blue-300 font-mono">{entry.pronunciation}</span>
                  <span className="text-violet-300 font-mono">{entry.alias}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteEntry(entry.id)}
                  className="p-1 text-slate-500 hover:text-rose-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between bg-[#0E121D]">
          <button
            type="button"
            onClick={() => {
              onApplyToCurrent();
              onClose();
            }}
            className="px-3.5 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white"
          >
            현재 음절·음표에 즉시 적용
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md border border-slate-700 text-xs text-slate-300 hover:text-white"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  bpm: number;
  timeSignature: TimeSignature;
  notes: UstNote[];
  sections: MusicSection[];
  onFixIssues: () => void;
}

export const UstExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  projectName,
  bpm,
  timeSignature,
  notes,
  sections,
  onFixIssues,
}) => {
  const [lyricField, setLyricField] = useState<'alias' | 'pronunciation' | 'lyric'>('alias');
  const [includeMode2, setIncludeMode2] = useState(true);
  const [defaultFlags, setDefaultFlags] = useState('');

  const issues = useMemo(
    () => validateUstProject(notes, bpm, sections),
    [notes, bpm, sections]
  );

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const hasFixable = issues.some((i) => i.fixable);

  const ustPreview = useMemo(() => {
    if (!isOpen || notes.length === 0) return '';
    return generateUstContent({
      projectName,
      bpm,
      timeSignature,
      notes,
      sections,
      lyricField,
      includeMode2,
      defaultFlags,
    });
  }, [isOpen, projectName, bpm, timeSignature, notes, sections, lyricField, includeMode2, defaultFlags]);

  if (!isOpen) return null;

  const handleDownload = () => {
    const content = generateUstContent({
      projectName,
      bpm,
      timeSignature,
      notes,
      sections,
      lyricField,
      includeMode2,
      defaultFlags,
    });
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (projectName || 'project').replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    a.download = `${safeName}.ust`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-[#121622] border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">UTAU 표준 UST 내보내기 및 사전 검사</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              480 PPQN 틱 규격 · 휴지음(R) 자동 삽입 · Mode2 피치/VBR · UTAU / OpenUtau 호환
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">오류 검사 결과</span>
              {hasFixable && (
                <button
                  type="button"
                  onClick={onFixIssues}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-600/25 border border-blue-500/40 hover:bg-blue-600/40 text-xs text-blue-200"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>겹침 및 빈 가사 자동 정리</span>
                </button>
              )}
            </div>

            {issues.length === 0 ? (
              <div className="p-3 rounded-md bg-emerald-950/30 border border-emerald-800/50 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>모든 음표와 타이밍, 가사 형식이 UTAU UST 표준 검사를 통과했습니다.</span>
              </div>
            ) : (
              <div className="max-h-36 overflow-y-auto space-y-1.5">
                {issues.map((issue) => (
                  <div
                    key={issue.id}
                    className={`p-2.5 rounded-md border text-xs flex items-start gap-2 ${
                      issue.severity === 'error'
                        ? 'bg-rose-950/35 border-rose-800/50 text-rose-200'
                        : issue.severity === 'warning'
                        ? 'bg-amber-950/35 border-amber-800/50 text-amber-200'
                        : 'bg-slate-900 border-slate-800 text-slate-300'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800/80">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                UST Lyric= 출력 기준
              </label>
              <select
                value={lyricField}
                onChange={(e) =>
                  setLyricField(e.target.value as 'alias' | 'pronunciation' | 'lyric')
                }
                className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200"
              >
                <option value="alias">UTAU Alias (권장)</option>
                <option value="pronunciation">발음 기호 (Pronunciation)</option>
                <option value="lyric">원본 가사 음절 (Display Lyric)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                전역 Flags (선택)
              </label>
              <input
                type="text"
                value={defaultFlags}
                onChange={(e) => setDefaultFlags(e.target.value)}
                placeholder="예: g0Y0H0"
                className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeMode2}
                  onChange={(e) => setIncludeMode2(e.target.checked)}
                  className="accent-violet-500"
                />
                <span>Mode2 피치·비브라토 포함</span>
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-slate-200">UST 파일 미리보기</span>
            <pre className="bg-[#0B0D14] border border-slate-800 rounded-md p-3 text-[11px] font-mono text-slate-300 max-h-56 overflow-auto leading-relaxed">
              {ustPreview || '; 내보낼 음표가 없습니다.'}
            </pre>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-800 bg-[#0E121D] flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            보컬 합성이나 음원 렌더링 없이 순수 .ust 프로젝트 파일만 생성됩니다.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-md border border-slate-700 text-xs text-slate-300 hover:text-white"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={notes.length === 0 || errorCount > 0}
              className="px-4 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:pointer-events-none text-xs font-semibold text-white inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>.ust 다운로드</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface OverwriteConfirmModalProps {
  isOpen: boolean;
  protectedCount: number;
  actionLabel: string;
  onPreserveAndRun: () => void;
  onOverwriteAll: () => void;
  onCancel: () => void;
}

export const OverwriteConfirmModal: React.FC<OverwriteConfirmModalProps> = ({
  isOpen,
  protectedCount,
  actionLabel,
  onPreserveAndRun,
  onOverwriteAll,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#121622] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-white">수동 편집 음표 보호 확인</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-slate-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs text-slate-300 leading-relaxed">
          <p>
            현재 사용자가 직접 수정하거나 고정한 음표 <strong className="text-white font-mono">{protectedCount}개</strong>가 있습니다.
          </p>
          <p className="text-slate-400">
            <span className="text-slate-200 font-medium">{actionLabel}</span> 실행 시 기존 수동 편집 내용을 보호할지, 전체를 새로 덮어쓸지 선택하세요.
          </p>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-800 bg-[#0E121D] flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md border border-slate-700 text-xs text-slate-300 hover:text-white"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onOverwriteAll}
            className="px-3 py-1.5 rounded-md bg-rose-950/70 hover:bg-rose-900/70 border border-rose-700/60 text-xs font-medium text-rose-200"
          >
            모두 덮어쓰기
          </button>
          <button
            type="button"
            onClick={onPreserveAndRun}
            className="px-3.5 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white"
          >
            수정 음표 보호 후 실행
          </button>
        </div>
      </div>
    </div>
  );
};

interface SelfReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: string;
  issues: TuningAuditIssue[];
  diffs: ProposedNoteEdit[];
  onApproveAndApply: () => void;
}

export const SelfReviewModal: React.FC<SelfReviewModalProps> = ({
  isOpen,
  onClose,
  summary,
  issues,
  diffs,
  onApproveAndApply,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#121622] border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">AI 자체 조교 검수 및 보정안 승인</h3>
              <p className="text-xs text-slate-400 mt-0.5">{summary}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-slate-200">
              검수 항목 ({issues.length}건)
            </span>
            {issues.length === 0 ? (
              <div className="p-3 rounded-md bg-emerald-950/30 border border-emerald-800/50 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>가사 연결, 발음 규칙, 프레이즈 타이밍 및 반복 후렴구가 모두 정상입니다.</span>
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1.5">
                {issues.map((issue) => (
                  <div
                    key={issue.id}
                    className={`p-2.5 rounded-md border text-xs flex items-start gap-2 ${
                      issue.severity === 'error'
                        ? 'bg-rose-950/35 border-rose-800/50 text-rose-200'
                        : 'bg-amber-950/35 border-amber-800/50 text-amber-200'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <span className="block text-xs font-semibold text-slate-200">
              AI 보정 제안 내역 ({diffs.length}개 음표)
            </span>
            {diffs.length === 0 ? (
              <div className="p-3 rounded-md bg-[#0B0D14] border border-slate-800 text-xs text-slate-400">
                추가로 수정할 보정 항목이 없습니다.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {diffs.map((d) => (
                  <div
                    key={d.noteId}
                    className="p-2.5 rounded-md bg-[#0B0D14] border border-slate-800/90 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-100">{d.label}</span>
                      <span className="text-[11px] text-blue-300">{d.reason}</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      이전: {d.beforeSummary}
                    </div>
                    <div className="text-[11px] font-mono text-violet-300">
                      수정안: {d.afterSummary}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-800 bg-[#0E121D] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md border border-slate-700 text-xs text-slate-300 hover:text-white"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={onApproveAndApply}
            disabled={diffs.length === 0}
            className="px-4 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white"
          >
            보정안 승인 및 UST 반영
          </button>
        </div>
      </div>
    </div>
  );
};
