import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Columns2,
  Magnet,
  Merge,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Scissors,
  Square,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  MusicSection,
  SectionCategory,
  TimeSignature,
  WaveformPeak,
} from '../types/ust';
import {
  SECTION_CATEGORY_META,
  formatBarBeat,
  formatTimecode,
} from '../utils/musicTheory';

export type MonitorMode = 'mix' | 'vocal' | 'inst';

interface TimelineWaveformProps {
  durationSec: number;
  bpm: number;
  timeSignature: TimeSignature;
  bars: number[];
  beats: number[];
  waveform: WaveformPeak[];
  sections: MusicSection[];
  selectedSectionId: string | null;
  playheadSec: number;
  isPlaying: boolean;
  hasAudio: boolean;
  loopSection: boolean;
  metronomeEnabled: boolean;
  monitorMode: MonitorMode;
  pxPerSec: number;
  scrollLeft: number;
  snapEnabled: boolean;
  onScrollLeftChange: (scrollLeft: number) => void;
  onZoomChange: (pxPerSec: number) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onSeek: (sec: number) => void;
  onToggleLoopSection: () => void;
  onToggleMetronome: () => void;
  onMonitorModeChange: (mode: MonitorMode) => void;
  onToggleSnap: () => void;
  onSelectSection: (sectionId: string) => void;
  onUpdateSection: (sectionId: string, patch: Partial<MusicSection>) => void;
  onResizeBoundary: (leftId: string, rightId: string | null, newTimeSec: number) => void;
  onAddSection: () => void;
  onSplitSection: (sectionId: string) => void;
  onMergeWithNext: (sectionId: string) => void;
  onDeleteSection: (sectionId: string) => void;
  onResetSections: () => void;
}

export const TimelineWaveform: React.FC<TimelineWaveformProps> = ({
  durationSec,
  bpm,
  timeSignature,
  bars,
  waveform,
  sections,
  selectedSectionId,
  playheadSec,
  isPlaying,
  hasAudio,
  loopSection,
  metronomeEnabled,
  monitorMode,
  pxPerSec,
  scrollLeft,
  snapEnabled,
  onScrollLeftChange,
  onZoomChange,
  onTogglePlay,
  onStop,
  onSeek,
  onToggleLoopSection,
  onToggleMetronome,
  onMonitorModeChange,
  onToggleSnap,
  onSelectSection,
  onUpdateSection,
  onResizeBoundary,
  onAddSection,
  onSplitSection,
  onMergeWithNext,
  onDeleteSection,
  onResetSections,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const [draggingBoundary, setDraggingBoundary] = useState<{
    leftId: string;
    rightId: string | null;
    startX: number;
    origTime: number;
  } | null>(null);

  const totalWidth = Math.max(800, Math.ceil(Math.max(durationSec, 30) * pxPerSec));
  const selectedSection = sections.find((s) => s.id === selectedSectionId) || null;
  const activePlayingSection = sections.find(
    (s) => playheadSec >= s.startSec && playheadSec < s.endSec
  );

  // Sync external scrollLeft into container
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el && Math.abs(el.scrollLeft - scrollLeft) > 1) {
      el.scrollLeft = scrollLeft;
    }
  }, [scrollLeft]);

  // Draw waveform + bar lines + playhead
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const height = 64;
    canvas.width = totalWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, totalWidth, height);

    // Background
    ctx.fillStyle = '#0D111C';
    ctx.fillRect(0, 0, totalWidth, height);

    // Center axis
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(totalWidth, height / 2);
    ctx.stroke();

    // Bar vertical lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    for (const b of bars) {
      const x = b * pxPerSec;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Waveform peaks
    if (waveform.length > 0 && durationSec > 0) {
      const stepPx = (durationSec * pxPerSec) / waveform.length;
      const midY = height / 2;

      for (let i = 0; i < waveform.length; i++) {
        const pk = waveform[i];
        const x = i * stepPx;
        const w = Math.max(1, stepPx - 0.3);
        const topY = midY - Math.max(0.02, Math.abs(pk.max)) * (midY - 4);
        const botY = midY + Math.max(0.02, Math.abs(pk.min)) * (midY - 4);

        // Mix waveform
        ctx.fillStyle = 'rgba(59, 130, 246, 0.45)';
        ctx.fillRect(x, topY, w, Math.max(1, botY - topY));

        // Vocal band contour overlay
        if (pk.vocalEnergy > 0.04) {
          const vh = pk.vocalEnergy * (midY - 6);
          ctx.fillStyle = 'rgba(139, 92, 246, 0.72)';
          ctx.fillRect(x, midY - vh, w, vh * 2);
        }
      }
    } else {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.font = '12px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('왼쪽 패널에서 음원(MP3, WAV)을 업로드하면 파형과 구간 타임라인이 표시됩니다.', 20, 36);
    }

    // Playhead
    const px = playheadSec * pxPerSec;
    ctx.strokeStyle = '#A78BFA';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
  }, [totalWidth, durationSec, pxPerSec, waveform, bars, playheadSec]);

  // Global mouse move/up for section boundary dragging
  useEffect(() => {
    if (!draggingBoundary) return;
    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - draggingBoundary.startX;
      const newTime = Math.max(0.2, draggingBoundary.origTime + dx / pxPerSec);
      onResizeBoundary(draggingBoundary.leftId, draggingBoundary.rightId, newTime);
    };
    const handleUp = () => setDraggingBoundary(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [draggingBoundary, pxPerSec, onResizeBoundary]);

  const handleRulerOrWaveClick = (e: React.MouseEvent<HTMLDivElement | HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const sec = Math.max(0, Math.min(durationSec || 120, x / pxPerSec));
    onSeek(sec);
  };

  return (
    <div className="bg-[#101420] border-b border-slate-800/80 flex flex-col shrink-0 select-none">
      {/* Transport Bar */}
      <div className="px-3 py-2 border-b border-slate-800/80 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!hasAudio}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white transition-colors"
            title="재생 / 일시정지 (Space)"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={onStop}
            disabled={!hasAudio}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-[#191E2E] hover:bg-slate-800 border border-slate-700/70 disabled:opacity-40 text-slate-200 transition-colors"
            title="정지 및 처음으로"
          >
            <Square className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onToggleLoopSection}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
              loopSection
                ? 'bg-violet-600/25 border-violet-500/60 text-violet-200'
                : 'bg-[#161B2B] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="선택한 구간 반복 재생"
          >
            <Repeat className="w-3.5 h-3.5" />
            <span>구간 반복</span>
          </button>

          <button
            type="button"
            onClick={onToggleMetronome}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
              metronomeEnabled
                ? 'bg-blue-600/25 border-blue-500/60 text-blue-200'
                : 'bg-[#161B2B] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="메트로놈 클릭"
          >
            <Bell className="w-3.5 h-3.5" />
            <span>메트로놈</span>
          </button>

          {/* Reference Audio Monitor Mode (Strictly filtering uploaded audio) */}
          <div className="hidden md:flex items-center bg-[#0B0D14] border border-slate-800 rounded-md p-0.5 ml-1">
            {(
              [
                { id: 'mix', label: '원본 믹스' },
                { id: 'vocal', label: '보컬 대역' },
                { id: 'inst', label: '반주 성분' },
              ] as Array<{ id: MonitorMode; label: string }>
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onMonitorModeChange(m.id)}
                className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                  monitorMode === m.id
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Timecode, Bar:Beat, BPM, Snap, Zoom */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 bg-[#0B0D14] border border-slate-800 rounded-md px-3 py-1 font-mono tabular-nums text-xs">
            <span className="text-slate-100 font-semibold">{formatTimecode(playheadSec)}</span>
            <span className="text-slate-700">|</span>
            <span className="text-blue-300">{formatBarBeat(playheadSec, bpm, timeSignature)}</span>
            <span className="text-slate-700">|</span>
            <span className="text-violet-300">{bpm.toFixed(1)} BPM</span>
          </div>

          <button
            type="button"
            onClick={onToggleSnap}
            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
              snapEnabled
                ? 'bg-blue-600/20 border-blue-500/50 text-blue-200'
                : 'bg-[#161B2B] border-slate-800 text-slate-400'
            }`}
            title="격자 스냅"
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>Snap</span>
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(25, Math.round(pxPerSec * 0.8)))}
              className="p-1.5 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 text-slate-300"
              title="축소"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(320, Math.round(pxPerSec * 1.25)))}
              className="p-1.5 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 text-slate-300"
              title="확대"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Synchronized Timeline Scroll Area (Left 56px offset aligns with PianoRoll Keyboard!) */}
      <div className="flex">
        <div className="w-14 shrink-0 bg-[#0E121D] border-r border-slate-800/80 flex flex-col justify-between py-2 px-1.5 text-[10px] font-medium text-slate-500">
          <span>마디</span>
          <span>파형</span>
          <span>구간</span>
        </div>

        <div
          ref={scrollContainerRef}
          onScroll={(e) => onScrollLeftChange(e.currentTarget.scrollLeft)}
          className="flex-1 overflow-x-auto overflow-y-hidden"
        >
          <div style={{ width: totalWidth }} className="relative">
            {/* 1. Bar Ruler */}
            <div
              onClick={handleRulerOrWaveClick}
              className="h-6 bg-[#0E121D] border-b border-slate-800/80 relative cursor-pointer"
            >
              {bars.map((barSec, idx) => (
                <div
                  key={`bar-${idx}`}
                  style={{ left: barSec * pxPerSec }}
                  className="absolute top-0 bottom-0 border-l border-slate-700/70 pl-1 text-[10px] font-mono tabular-nums text-slate-400 flex items-center"
                >
                  {idx + 1}
                </div>
              ))}
              {/* Playhead marker triangle */}
              <div
                style={{ left: playheadSec * pxPerSec - 5 }}
                className="absolute top-0 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-violet-400 pointer-events-none"
              />
            </div>

            {/* 2. Waveform Canvas */}
            <canvas
              ref={waveformCanvasRef}
              onClick={handleRulerOrWaveClick}
              className="block cursor-pointer border-b border-slate-800/80"
            />

            {/* 3. Suno-style Section Block Timeline */}
            <div className="h-12 bg-[#0B0D14] relative border-b border-slate-800/60">
              {sections.map((sec, idx) => {
                const left = sec.startSec * pxPerSec;
                const width = Math.max(24, (sec.endSec - sec.startSec) * pxPerSec);
                const isSelected = sec.id === selectedSectionId;
                const isActivePlaying = activePlayingSection?.id === sec.id && isPlaying;
                const nextSec = sections[idx + 1] || null;

                return (
                  <div
                    key={sec.id}
                    style={{
                      left,
                      width,
                      backgroundColor: `${sec.color}${isSelected ? '55' : '30'}`,
                      borderColor: isActivePlaying
                        ? '#A855F7'
                        : isSelected
                        ? '#E2E8F0'
                        : `${sec.color}99`,
                    }}
                    onClick={() => {
                      onSelectSection(sec.id);
                      onSeek(sec.startSec);
                    }}
                    className={`absolute top-1 bottom-1 rounded border flex flex-col justify-center px-2 cursor-pointer overflow-hidden transition-colors ${
                      isActivePlaying ? 'ring-1 ring-violet-400' : ''
                    }`}
                    title={`${sec.name} (${sec.startSec.toFixed(1)}s - ${sec.endSec.toFixed(1)}s)`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-semibold text-slate-100 truncate">
                        {sec.name}
                      </span>
                      {!sec.allowVocals && width > 70 && (
                        <span className="text-[9px] text-slate-400 whitespace-nowrap">
                          반주전용
                        </span>
                      )}
                    </div>
                    {width > 64 && (
                      <div className="text-[10px] font-mono tabular-nums text-slate-400 truncate">
                        {sec.startSec.toFixed(1)}s – {sec.endSec.toFixed(1)}s
                      </div>
                    )}

                    {/* Right Boundary Drag Handle */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setDraggingBoundary({
                          leftId: sec.id,
                          rightId: nextSec ? nextSec.id : null,
                          startX: e.clientX,
                          origTime: sec.endSec,
                        });
                      }}
                      className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/25"
                      title="드래그하여 구간 경계 조절"
                    />
                  </div>
                );
              })}

              {/* Playhead line on section track */}
              <div
                style={{ left: playheadSec * pxPerSec }}
                className="absolute top-0 bottom-0 w-[1.5px] bg-violet-400 pointer-events-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Section Editor Controls Strip */}
      <div className="px-3 py-1.5 bg-[#0E121D] flex items-center justify-between gap-2 flex-wrap text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          {selectedSection ? (
            <>
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: selectedSection.color }}
              />
              <input
                type="text"
                value={selectedSection.name}
                onChange={(e) =>
                  onUpdateSection(selectedSection.id, { name: e.target.value })
                }
                className="bg-[#161B2B] border border-slate-800 rounded px-2 py-1 text-xs font-medium text-slate-100 w-32"
              />
              <select
                value={selectedSection.category}
                onChange={(e) => {
                  const cat = e.target.value as SectionCategory;
                  onUpdateSection(selectedSection.id, {
                    category: cat,
                    color: SECTION_CATEGORY_META[cat].color,
                  });
                }}
                className="bg-[#161B2B] border border-slate-800 rounded px-2 py-1 text-xs text-slate-300"
              >
                {Object.entries(SECTION_CATEGORY_META).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1 font-mono text-[11px]">
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={Number(selectedSection.startSec.toFixed(2))}
                  onChange={(e) =>
                    onUpdateSection(selectedSection.id, {
                      startSec: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-16 bg-[#161B2B] border border-slate-800 rounded px-1.5 py-1 text-slate-200 tabular-nums"
                />
                <span className="text-slate-500">~</span>
                <input
                  type="number"
                  step="0.1"
                  min={selectedSection.startSec + 0.5}
                  value={Number(selectedSection.endSec.toFixed(2))}
                  onChange={(e) =>
                    onUpdateSection(selectedSection.id, {
                      endSec: Math.max(
                        selectedSection.startSec + 0.5,
                        Number(e.target.value) || selectedSection.startSec + 1
                      ),
                    })
                  }
                  className="w-16 bg-[#161B2B] border border-slate-800 rounded px-1.5 py-1 text-slate-200 tabular-nums"
                />
                <span className="text-slate-500">s</span>
              </div>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer ml-1">
                <input
                  type="checkbox"
                  checked={selectedSection.allowVocals}
                  onChange={(e) =>
                    onUpdateSection(selectedSection.id, { allowVocals: e.target.checked })
                  }
                  className="accent-violet-500"
                />
                <span>보컬 허용</span>
              </label>
            </>
          ) : (
            <span className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
              <Columns2 className="w-3.5 h-3.5" />
              구간 블록을 클릭하여 편집하거나 경계선을 드래그하여 길이를 조절하세요.
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onAddSection}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 whitespace-nowrap"
          >
            <Plus className="w-3 h-3" />
            <span>구간 추가</span>
          </button>
          <button
            type="button"
            disabled={!selectedSection}
            onClick={() => selectedSection && onSplitSection(selectedSection.id)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 disabled:opacity-40 text-[11px] text-slate-300 whitespace-nowrap"
          >
            <Scissors className="w-3 h-3" />
            <span>분할</span>
          </button>
          <button
            type="button"
            disabled={!selectedSection}
            onClick={() => selectedSection && onMergeWithNext(selectedSection.id)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 disabled:opacity-40 text-[11px] text-slate-300 whitespace-nowrap"
          >
            <Merge className="w-3 h-3" />
            <span>병합</span>
          </button>
          <button
            type="button"
            disabled={!selectedSection || sections.length <= 1}
            onClick={() => selectedSection && onDeleteSection(selectedSection.id)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#161B2B] hover:bg-rose-950/60 border border-slate-800 disabled:opacity-40 text-[11px] text-slate-300 hover:text-rose-200 whitespace-nowrap"
          >
            <Trash2 className="w-3 h-3" />
            <span>삭제</span>
          </button>
          <button
            type="button"
            onClick={onResetSections}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-400 hover:text-slate-200 whitespace-nowrap"
            title="11개 기본 곡 구조로 초기화"
          >
            <RotateCcw className="w-3 h-3" />
            <span>기본 구조</span>
          </button>
        </div>
      </div>
    </div>
  );
};
