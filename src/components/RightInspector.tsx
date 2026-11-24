import React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  Lock,
  Merge,
  Minus,
  Plus,
  RotateCcw,
  Scissors,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { MusicSection, UstNote, UstValidationIssue } from '../types/ust';
import { midiToFreq, midiToNoteName, secToTicks } from '../utils/musicTheory';

interface RightInspectorProps {
  selectedNotes: UstNote[];
  selectedSection: MusicSection | null;
  allNotes: UstNote[];
  bpm: number;
  durationSec: number;
  validationIssues: UstValidationIssue[];
  onUpdateNote: (noteId: string, patch: Partial<UstNote>) => void;
  onRestoreOriginalNote: (noteId: string) => void;
  onDeleteSelectedNotes: () => void;
  onDuplicateSelectedNotes: () => void;
  onSplitNote: (noteId: string) => void;
  onMergeWithNextNote: (noteId: string) => void;
  onShiftLyrics: (direction: 'left' | 'right') => void;
  onSelectPhrase: () => void;
  onUpdateSection: (sectionId: string, patch: Partial<MusicSection>) => void;
  onOpenExport: () => void;
}

export const RightInspector: React.FC<RightInspectorProps> = ({
  selectedNotes,
  selectedSection,
  allNotes,
  bpm,
  durationSec,
  validationIssues,
  onUpdateNote,
  onRestoreOriginalNote,
  onDeleteSelectedNotes,
  onDuplicateSelectedNotes,
  onSplitNote,
  onMergeWithNextNote,
  onShiftLyrics,
  onSelectPhrase,
  onUpdateSection,
  onOpenExport,
}) => {
  const primaryNote = selectedNotes.length === 1 ? selectedNotes[0] : null;
  const errorCount = validationIssues.filter((i) => i.severity === 'error').length;
  const warnCount = validationIssues.filter((i) => i.severity === 'warning').length;
  const lyricedCount = allNotes.filter((n) => n.lyric && n.lyric !== 'la' && n.lyric !== '-').length;
  const coveragePct = allNotes.length > 0 ? Math.round((lyricedCount / allNotes.length) * 100) : 0;

  // Parse VBR string "length,period,depth,in,out,phase,pitch,0"
  const parseVbr = (vbrStr?: string) => {
    const parts = (vbrStr || '').split(',').map((v) => Number.parseFloat(v));
    return {
      enabled: Boolean(vbrStr && vbrStr.trim()),
      length: Number.isFinite(parts[0]) ? parts[0] : 65,
      period: Number.isFinite(parts[1]) ? parts[1] : 165,
      depth: Number.isFinite(parts[2]) ? parts[2] : 34,
    };
  };

  return (
    <aside className="w-72 xl:w-80 shrink-0 bg-[#121622] border-l border-slate-800/80 flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-slate-300">
          조교 · 음표 인스펙터
        </h2>
        <span className="text-[11px] font-mono tabular-nums text-slate-500">
          {selectedNotes.length > 0
            ? `${selectedNotes.length}개 음표 선택`
            : selectedSection
            ? selectedSection.name
            : '선택 없음'}
        </span>
      </div>

      {primaryNote ? (
        <div className="p-4 space-y-4 border-b border-slate-800/80">
          {/* Quick Actions & Lock */}
          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() =>
                onUpdateNote(primaryNote.id, { userModified: !primaryNote.userModified })
              }
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                primaryNote.userModified
                  ? 'bg-blue-600/20 border-blue-500/50 text-blue-200'
                  : 'bg-[#0B0D14] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="AI 재분석 시 이 음표 보호"
            >
              {primaryNote.userModified ? (
                <>
                  <Lock className="w-3 h-3" />
                  <span>편집 보호됨</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3 h-3" />
                  <span>보호 해제</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={onSelectPhrase}
                title="같은 프레이즈 전체 선택"
                className="px-1.5 py-1 text-[10px] text-slate-300 hover:text-white hover:bg-slate-800 rounded"
              >
                프레이즈
              </button>
              <button
                type="button"
                onClick={onDuplicateSelectedNotes}
                title="음표 복제"
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onSplitNote(primaryNote.id)}
                title="음표 2분할"
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded"
              >
                <Scissors className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onMergeWithNextNote(primaryNote.id)}
                title="다음 음표와 연결/합치기"
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded"
              >
                <Merge className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onDeleteSelectedNotes}
                title="음표 삭제 (Delete)"
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {primaryNote.phonemeError && (
            <div className="p-2 rounded bg-rose-950/40 border border-rose-700/60 text-[11px] text-rose-200 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{primaryNote.phonemeError}</span>
            </div>
          )}

          {/* Pitch + Original Comparison */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-slate-400">
                음정 (Pitch / NoteNum)
              </label>
              {primaryNote.originalMidi !== undefined &&
                primaryNote.originalMidi !== primaryNote.midi && (
                  <button
                    type="button"
                    onClick={() => onRestoreOriginalNote(primaryNote.id)}
                    className="inline-flex items-center gap-1 text-[10px] text-amber-300 hover:text-amber-200"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>원본({midiToNoteName(primaryNote.originalMidi)}) 복원</span>
                  </button>
                )}
            </div>
            <div className="flex items-center justify-between bg-[#0B0D14] border border-slate-800 rounded-md px-2.5 py-2">
              <div>
                <div className="text-sm font-semibold font-mono text-violet-300 tabular-nums">
                  {midiToNoteName(primaryNote.midi)}
                  <span className="ml-2 text-xs text-slate-500">MIDI {primaryNote.midi}</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {midiToFreq(primaryNote.midi).toFixed(1)} Hz
                  {primaryNote.originalMidi !== undefined && (
                    <span className="ml-2 text-slate-600">
                      (원본 {midiToNoteName(primaryNote.originalMidi)})
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateNote(primaryNote.id, {
                      midi: Math.max(24, primaryNote.midi - 1),
                      userModified: true,
                    })
                  }
                  className="p-1 bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded"
                  title="반음 내리기"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateNote(primaryNote.id, {
                      midi: Math.min(107, primaryNote.midi + 1),
                      userModified: true,
                    })
                  }
                  className="p-1 bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded"
                  title="반음 올리기"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Lyric, Pronunciation, Alias + Shift Left/Right */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400">가사 · 발음 이동</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onShiftLyrics('left')}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0B0D14] border border-slate-800 hover:border-slate-700 text-[10px] text-slate-300"
                  title="선택 음표부터 가사를 앞 음표로 1칸 이동"
                >
                  <ArrowLeft className="w-3 h-3" />
                  <span>앞으로</span>
                </button>
                <button
                  type="button"
                  onClick={() => onShiftLyrics('right')}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0B0D14] border border-slate-800 hover:border-slate-700 text-[10px] text-slate-300"
                  title="선택 음표부터 가사를 뒤 음표로 1칸 밀기"
                >
                  <span>뒤로</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">가사 (Display Lyric)</label>
              <input
                type="text"
                value={primaryNote.lyric}
                onChange={(e) =>
                  onUpdateNote(primaryNote.id, { lyric: e.target.value, userModified: true })
                }
                className="w-full bg-[#0B0D14] border border-slate-800 focus:border-violet-500 focus:outline-none rounded-md px-2.5 py-1.5 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">발음 기호 (Phoneme)</label>
              <input
                type="text"
                value={primaryNote.pronunciation}
                onChange={(e) =>
                  onUpdateNote(primaryNote.id, {
                    pronunciation: e.target.value,
                    userModified: true,
                    phonemeError: undefined,
                  })
                }
                className="w-full bg-[#0B0D14] border border-slate-800 focus:border-blue-500 focus:outline-none rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-200"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">
                UTAU Alias (내보내기 Lyric=)
              </label>
              <input
                type="text"
                value={primaryNote.alias}
                onChange={(e) =>
                  onUpdateNote(primaryNote.id, {
                    alias: e.target.value,
                    userModified: true,
                    phonemeError: undefined,
                  })
                }
                className="w-full bg-[#0B0D14] border border-slate-800 focus:border-violet-500 focus:outline-none rounded-md px-2.5 py-1.5 text-xs font-mono text-violet-200"
              />
            </div>
          </div>

          {/* Timing */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-slate-400">타이밍 및 길이</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="block text-[10px] text-slate-500 mb-0.5">시작 (초)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={Number(primaryNote.startSec.toFixed(3))}
                  onChange={(e) => {
                    const val = Math.max(0, Number(e.target.value));
                    if (Number.isFinite(val)) {
                      onUpdateNote(primaryNote.id, {
                        startSec: val,
                        endSec: Math.max(val + 0.05, primaryNote.endSec),
                        userModified: true,
                      });
                    }
                  }}
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1 text-xs font-mono tabular-nums text-slate-200"
                />
              </div>
              <div>
                <span className="block text-[10px] text-slate-500 mb-0.5">종료 (초)</span>
                <input
                  type="number"
                  step="0.01"
                  min={primaryNote.startSec + 0.04}
                  value={Number(primaryNote.endSec.toFixed(3))}
                  onChange={(e) => {
                    const val = Math.max(primaryNote.startSec + 0.04, Number(e.target.value));
                    if (Number.isFinite(val)) {
                      onUpdateNote(primaryNote.id, { endSec: val, userModified: true });
                    }
                  }}
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1 text-xs font-mono tabular-nums text-slate-200"
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400 bg-[#0B0D14] border border-slate-800/70 rounded px-2.5 py-1">
              <span>{(primaryNote.endSec - primaryNote.startSec).toFixed(3)}s</span>
              <span>
                {Math.max(1, secToTicks(primaryNote.endSec - primaryNote.startSec, bpm))} ticks
              </span>
            </div>
          </div>

          {/* Consonant/Vowel Timing & Mode2 Pitch Curve & Vibrato */}
          <div className="space-y-2.5 pt-2 border-t border-slate-800/60">
            <span className="block text-[11px] font-semibold text-slate-300">
              발음 타이밍 · 피치 곡선 · 비브라토
            </span>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="block text-[10px] text-slate-500 mb-0.5">PreUtterance (ms)</span>
                <input
                  type="number"
                  value={primaryNote.preUtterance ?? 0}
                  onChange={(e) =>
                    onUpdateNote(primaryNote.id, {
                      preUtterance: Number(e.target.value) || 0,
                      userModified: true,
                    })
                  }
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1 text-xs font-mono tabular-nums text-slate-200"
                />
              </div>
              <div>
                <span className="block text-[10px] text-slate-500 mb-0.5">VoiceOverlap (ms)</span>
                <input
                  type="number"
                  value={primaryNote.voiceOverlap ?? 0}
                  onChange={(e) =>
                    onUpdateNote(primaryNote.id, {
                      voiceOverlap: Number(e.target.value) || 0,
                      userModified: true,
                    })
                  }
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1 text-xs font-mono tabular-nums text-slate-200"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <span className="block text-[10px] text-slate-500 mb-0.5">PBS</span>
                <input
                  type="text"
                  value={primaryNote.pbs || '-25;0'}
                  onChange={(e) =>
                    onUpdateNote(primaryNote.id, { pbs: e.target.value, userModified: true })
                  }
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-1.5 py-1 text-[11px] font-mono text-blue-200"
                />
              </div>
              <div>
                <span className="block text-[10px] text-slate-500 mb-0.5">PBW</span>
                <input
                  type="text"
                  value={primaryNote.pbw || '50'}
                  onChange={(e) =>
                    onUpdateNote(primaryNote.id, { pbw: e.target.value, userModified: true })
                  }
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-1.5 py-1 text-[11px] font-mono text-blue-200"
                />
              </div>
              <div>
                <span className="block text-[10px] text-slate-500 mb-0.5">PBY</span>
                <input
                  type="text"
                  value={primaryNote.pby || '0'}
                  onChange={(e) =>
                    onUpdateNote(primaryNote.id, { pby: e.target.value, userModified: true })
                  }
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-1.5 py-1 text-[11px] font-mono text-blue-200"
                />
              </div>
            </div>

            {/* Vibrato VBR Editor */}
            {(() => {
              const vbr = parseVbr(primaryNote.vbr);
              return (
                <div className="bg-[#0B0D14] border border-slate-800 rounded p-2 space-y-2">
                  <label className="flex items-center justify-between text-[11px] text-slate-300 cursor-pointer">
                    <span>비브라토 (VBR)</span>
                    <input
                      type="checkbox"
                      checked={vbr.enabled}
                      onChange={(e) =>
                        onUpdateNote(primaryNote.id, {
                          vbr: e.target.checked ? '65,165,34,22,25,0,0,0' : '',
                          userModified: true,
                        })
                      }
                      className="accent-violet-500"
                    />
                  </label>
                  {vbr.enabled && (
                    <div className="grid grid-cols-3 gap-1.5">
                      <div>
                        <span className="block text-[9px] text-slate-500">길이 %</span>
                        <input
                          type="number"
                          min={10}
                          max={100}
                          value={vbr.length}
                          onChange={(e) =>
                            onUpdateNote(primaryNote.id, {
                              vbr: `${Number(e.target.value) || 65},${vbr.period},${vbr.depth},22,25,0,0,0`,
                              userModified: true,
                            })
                          }
                          className="w-full bg-[#121622] border border-slate-700 rounded px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-slate-200"
                        />
                      </div>
                      <div>
                        <span className="block text-[9px] text-slate-500">주기 ms</span>
                        <input
                          type="number"
                          min={60}
                          max={350}
                          value={vbr.period}
                          onChange={(e) =>
                            onUpdateNote(primaryNote.id, {
                              vbr: `${vbr.length},${Number(e.target.value) || 165},${vbr.depth},22,25,0,0,0`,
                              userModified: true,
                            })
                          }
                          className="w-full bg-[#121622] border border-slate-700 rounded px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-slate-200"
                        />
                      </div>
                      <div>
                        <span className="block text-[9px] text-slate-500">깊이 cent</span>
                        <input
                          type="number"
                          min={5}
                          max={120}
                          value={vbr.depth}
                          onChange={(e) =>
                            onUpdateNote(primaryNote.id, {
                              vbr: `${vbr.length},${vbr.period},${Number(e.target.value) || 34},22,25,0,0,0`,
                              userModified: true,
                            })
                          }
                          className="w-full bg-[#121622] border border-slate-700 rounded px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-slate-200"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="block text-[10px] text-slate-500 mb-0.5">Velocity</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={primaryNote.velocity}
                  onChange={(e) =>
                    onUpdateNote(primaryNote.id, {
                      velocity: Math.max(0, Math.min(200, Number(e.target.value) || 100)),
                      userModified: true,
                    })
                  }
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1 text-xs font-mono tabular-nums text-slate-200"
                />
              </div>
              <div>
                <span className="block text-[10px] text-slate-500 mb-0.5">Intensity</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={primaryNote.intensity}
                  onChange={(e) =>
                    onUpdateNote(primaryNote.id, {
                      intensity: Math.max(0, Math.min(200, Number(e.target.value) || 100)),
                      userModified: true,
                    })
                  }
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1 text-xs font-mono tabular-nums text-slate-200"
                />
              </div>
              <div>
                <span className="block text-[10px] text-slate-500 mb-0.5">Modulation</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={primaryNote.modulation}
                  onChange={(e) =>
                    onUpdateNote(primaryNote.id, {
                      modulation: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
                      userModified: true,
                    })
                  }
                  className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1 text-xs font-mono tabular-nums text-slate-200"
                />
              </div>
            </div>
            <div>
              <span className="block text-[10px] text-slate-500 mb-0.5">Flags (선택)</span>
              <input
                type="text"
                value={primaryNote.flags || ''}
                onChange={(e) =>
                  onUpdateNote(primaryNote.id, { flags: e.target.value, userModified: true })
                }
                placeholder="예: g-3Y0H0"
                className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200"
              />
            </div>
          </div>
        </div>
      ) : selectedNotes.length > 1 ? (
        <div className="p-4 space-y-3 border-b border-slate-800/80">
          <div className="text-xs font-semibold text-slate-200">
            다중 음표 일괄 편집 ({selectedNotes.length}개)
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                for (const n of selectedNotes) {
                  onUpdateNote(n.id, { midi: Math.min(107, n.midi + 1), userModified: true });
                }
              }}
              className="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
            >
              +1 반음
            </button>
            <button
              type="button"
              onClick={() => {
                for (const n of selectedNotes) {
                  onUpdateNote(n.id, { midi: Math.max(24, n.midi - 1), userModified: true });
                }
              }}
              className="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
            >
              -1 반음
            </button>
            <button
              type="button"
              onClick={() => {
                for (const n of selectedNotes) {
                  onUpdateNote(n.id, {
                    vbr: n.vbr ? '' : '65,165,34,22,25,0,0,0',
                    userModified: true,
                  });
                }
              }}
              className="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
            >
              비브라토 토글
            </button>
            <button
              type="button"
              onClick={onDuplicateSelectedNotes}
              className="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
            >
              선택 복제
            </button>
            <button
              type="button"
              onClick={onDeleteSelectedNotes}
              className="px-2.5 py-1.5 text-xs bg-rose-950/70 hover:bg-rose-900/70 text-rose-200 border border-rose-800/50 rounded"
            >
              선택 삭제
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 border-b border-slate-800/80 text-xs text-slate-400">
          피아노 롤에서 음표를 클릭하거나 빈 공간을 드래그해 여러 음표를 선택하여 가사, 발음, 피치 곡선 및 비브라토를 편집하세요.
        </div>
      )}

      {selectedSection && (
        <div className="p-4 space-y-3 border-b border-slate-800/80">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">선택된 구간 정보</span>
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: selectedSection.color }}
            />
          </div>
          <div className="space-y-2">
            <div>
              <span className="block text-[10px] text-slate-500 mb-0.5">구간 이름</span>
              <input
                type="text"
                value={selectedSection.name}
                onChange={(e) => onUpdateSection(selectedSection.id, { name: e.target.value })}
                className="w-full bg-[#0B0D14] border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
              />
            </div>
            <label className="flex items-center justify-between gap-2 text-xs text-slate-300 cursor-pointer pt-1">
              <span>이 구간에 보컬 배치 허용</span>
              <input
                type="checkbox"
                checked={selectedSection.allowVocals}
                onChange={(e) =>
                  onUpdateSection(selectedSection.id, { allowVocals: e.target.checked })
                }
                className="accent-violet-500 rounded"
              />
            </label>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 flex justify-between">
              <span>{selectedSection.startSec.toFixed(2)}s</span>
              <span>~</span>
              <span>{selectedSection.endSec.toFixed(2)}s</span>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 space-y-3">
        <span className="block text-xs font-semibold text-slate-200">UST 출력 상태 요약</span>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between text-slate-400">
            <span>총 음표 수</span>
            <span className="font-mono tabular-nums text-slate-200">{allNotes.length}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>프로젝트 BPM</span>
            <span className="font-mono tabular-nums text-slate-200">{bpm.toFixed(1)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>전체 길이</span>
            <span className="font-mono tabular-nums text-slate-200">{durationSec.toFixed(2)}s</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>가사 배정률</span>
            <span className="font-mono tabular-nums text-slate-200">{coveragePct}%</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenExport}
          className="w-full mt-2 px-3 py-2 rounded-md border border-slate-800 bg-[#0B0D14] hover:border-slate-700 flex items-center justify-between text-xs transition-colors"
        >
          {errorCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-rose-400 font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              오류 {errorCount}건 · 경고 {warnCount}건
            </span>
          ) : warnCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              경고 {warnCount}건 확인
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              UST 내보내기 준비 완료
            </span>
          )}
          <span className="text-slate-400">검사</span>
        </button>
      </div>
    </aside>
  );
};
