import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Eraser,
  GitCompare,
  Magnet,
  Merge,
  MousePointer2,
  Pencil,
  Scissors,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  MusicSection,
  QuantizeGrid,
  UstNote,
} from '../types/ust';
import {
  getGridStepSec,
  isBlackKey,
  midiToFreq,
  midiToNoteName,
  snapSecToGrid,
} from '../utils/musicTheory';

export type PianoTool = 'select' | 'draw' | 'erase';

interface PianoRollProps {
  notes: UstNote[];
  sections: MusicSection[];
  selectedNoteIds: string[];
  bpm: number;
  durationSec: number;
  playheadSec: number;
  bars: number[];
  beats: number[];
  pxPerSec: number;
  scrollLeft: number;
  snapEnabled: boolean;
  quantizeGrid: QuantizeGrid;
  onScrollLeftChange: (scrollLeft: number) => void;
  onSelectNotes: (ids: string[]) => void;
  onChangeNotes: (notes: UstNote[], recordHistory?: boolean) => void;
  onCommitHistorySnapshot: () => void;
  onZoomChange: (pxPerSec: number) => void;
  onQuantizeGridChange: (grid: QuantizeGrid) => void;
  onToggleSnap: () => void;
  onSelectPhrase: () => void;
  onShiftLyrics: (direction: 'left' | 'right') => void;
  onSplitSelectedNote: () => void;
  onMergeSelectedWithNext: () => void;
}

const MIN_MIDI = 36; // C2
const MAX_MIDI = 96; // C7
const TOTAL_KEYS = MAX_MIDI - MIN_MIDI + 1;

interface MarqueeBox {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  additive: boolean;
  baseSelected: string[];
}

export const PianoRoll: React.FC<PianoRollProps> = ({
  notes,
  sections,
  selectedNoteIds,
  bpm,
  durationSec,
  playheadSec,
  bars,
  beats,
  pxPerSec,
  scrollLeft,
  snapEnabled,
  quantizeGrid,
  onScrollLeftChange,
  onSelectNotes,
  onChangeNotes,
  onCommitHistorySnapshot,
  onZoomChange,
  onQuantizeGridChange,
  onToggleSnap,
  onSelectPhrase,
  onShiftLyrics,
  onSplitSelectedNote,
  onMergeSelectedWithNext,
}) => {
  const [tool, setTool] = useState<PianoTool>('select');
  const [rowHeight, setRowHeight] = useState(20);
  const [showPitchOverlay, setShowPitchOverlay] = useState(true);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  const [inlineEdit, setInlineEdit] = useState<{
    noteId: string;
    x: number;
    y: number;
    lyric: string;
    pronunciation: string;
    alias: string;
  } | null>(null);

  const gridScrollRef = useRef<HTMLDivElement>(null);
  const keyScrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const dragRef = useRef<{
    mode: 'move' | 'resize' | 'draw' | 'marquee';
    startX: number;
    startY: number;
    originNotes: UstNote[];
    activeNoteId: string;
    drawStartSec?: number;
    drawMidi?: number;
  } | null>(null);

  const totalWidth = Math.max(800, Math.ceil(Math.max(durationSec, 30) * pxPerSec));
  const totalHeight = TOTAL_KEYS * rowHeight;

  // Initial scroll to C4 area on mount
  useEffect(() => {
    const el = gridScrollRef.current;
    if (el) {
      const c4Row = MAX_MIDI - 64;
      el.scrollTop = Math.max(0, c4Row * rowHeight - el.clientHeight / 2);
      if (keyScrollRef.current) {
        keyScrollRef.current.scrollTop = el.scrollTop;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync horizontal scroll from TimelineWaveform
  useEffect(() => {
    const el = gridScrollRef.current;
    if (el && Math.abs(el.scrollLeft - scrollLeft) > 1) {
      el.scrollLeft = scrollLeft;
    }
  }, [scrollLeft]);

  // Draw Piano Roll Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalWidth * dpr;
    canvas.height = totalHeight * dpr;
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${totalHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // 1. Key row backgrounds
    for (let midi = MAX_MIDI; midi >= MIN_MIDI; midi--) {
      const row = MAX_MIDI - midi;
      const y = row * rowHeight;
      const black = isBlackKey(midi);
      ctx.fillStyle = black ? '#0D101B' : '#121726';
      ctx.fillRect(0, y, totalWidth, rowHeight);

      ctx.strokeStyle =
        midi % 12 === 0 ? 'rgba(148, 163, 184, 0.22)' : 'rgba(148, 163, 184, 0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + rowHeight);
      ctx.lineTo(totalWidth, y + rowHeight);
      ctx.stroke();
    }

    // 2. Non-vocal section shading
    for (const sec of sections) {
      if (!sec.allowVocals) {
        const sx = sec.startSec * pxPerSec;
        const sw = (sec.endSec - sec.startSec) * pxPerSec;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.fillRect(sx, 0, sw, totalHeight);
      }
    }

    // 3. Sub-beat, Beat, and Bar vertical grid lines
    const subStepSec = getGridStepSec(bpm, quantizeGrid === 'none' ? '1/16' : quantizeGrid);
    const maxSec = totalWidth / pxPerSec;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)';
    ctx.lineWidth = 1;
    for (let t = 0; t < maxSec; t += subStepSec) {
      const x = t * pxPerSec;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalHeight);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    for (const b of beats) {
      const x = b * pxPerSec;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalHeight);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    for (const barSec of bars) {
      const x = barSec * pxPerSec;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalHeight);
      ctx.stroke();
    }

    // 4. Original Pitch / Timing Comparison Ghosts
    if (compareOriginal) {
      for (const note of notes) {
        if (
          note.originalMidi === undefined ||
          note.originalStartSec === undefined ||
          note.originalEndSec === undefined
        ) {
          continue;
        }
        if (note.originalMidi < MIN_MIDI || note.originalMidi > MAX_MIDI) continue;
        const ox = note.originalStartSec * pxPerSec;
        const ow = Math.max(8, (note.originalEndSec - note.originalStartSec) * pxPerSec);
        const oy = (MAX_MIDI - note.originalMidi) * rowHeight + 2;
        const oh = Math.max(6, rowHeight - 4);

        const changed =
          note.originalMidi !== note.midi ||
          Math.abs(note.originalStartSec - note.startSec) > 0.005 ||
          Math.abs(note.originalEndSec - note.endSec) > 0.005;

        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = changed ? 'rgba(251, 191, 36, 0.8)' : 'rgba(148, 163, 184, 0.35)';
        ctx.fillStyle = changed ? 'rgba(251, 191, 36, 0.12)' : 'rgba(148, 163, 184, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(ox, oy, ow, oh, 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // 5. Notes
    const selectedSet = new Set(selectedNoteIds);
    for (const note of notes) {
      if (note.midi < MIN_MIDI || note.midi > MAX_MIDI) continue;
      const x = note.startSec * pxPerSec;
      const w = Math.max(8, (note.endSec - note.startSec) * pxPerSec);
      const y = (MAX_MIDI - note.midi) * rowHeight + 1;
      const h = Math.max(8, rowHeight - 2);
      const isSelected = selectedSet.has(note.id);
      const hasError = Boolean(note.phonemeError);
      const isModified = Boolean(note.userModified);

      // Note fill
      const grad = ctx.createLinearGradient(x, y, x + w, y + h);
      if (hasError) {
        grad.addColorStop(0, isSelected ? '#BE123C' : '#9F1239');
        grad.addColorStop(1, isSelected ? '#E11D48' : '#881337');
      } else if (isSelected) {
        grad.addColorStop(0, '#7C3AED');
        grad.addColorStop(1, '#3B82F6');
      } else {
        grad.addColorStop(0, '#4F46E5');
        grad.addColorStop(1, '#2563EB');
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3);
      ctx.fill();

      // Border priority: selected > phonemeError > userModified > default
      ctx.strokeStyle = isSelected
        ? '#F8FAFC'
        : hasError
        ? '#FB7185'
        : isModified
        ? '#38BDF8'
        : 'rgba(191, 219, 254, 0.45)';
      ctx.lineWidth = isSelected || hasError ? 1.5 : 1;
      ctx.stroke();

      // Mode2 Pitch Bend (PBS/PBW/PBY) & Vibrato (VBR) Overlay
      if (showPitchOverlay && w > 18) {
        const noteDurMs = Math.max(20, (note.endSec - note.startSec) * 1000);
        const midY = y + h * 0.5;
        const pbsParts = (note.pbs || '-25;0').split(';').map((v) => Number.parseFloat(v));
        const startOffsetMs = Number.isFinite(pbsParts[0]) ? pbsParts[0] : -25;
        const startPitchTenths = Number.isFinite(pbsParts[1]) ? pbsParts[1] : 0;
        const pbwList = (note.pbw || '50')
          .split(',')
          .map((v) => Number.parseFloat(v))
          .filter((v) => Number.isFinite(v) && v > 0);
        const pbyList = (note.pby || '0')
          .split(',')
          .map((v) => Number.parseFloat(v));

        ctx.save();
        ctx.strokeStyle = isSelected ? 'rgba(248, 250, 252, 0.85)' : 'rgba(125, 211, 252, 0.72)';
        ctx.lineWidth = 1.25;
        ctx.beginPath();

        let curMs = Math.max(0, startOffsetMs);
        const startPx = x + (curMs / noteDurMs) * w;
        const scaleY = (rowHeight * 0.6) / 100; // 10 semitone-tenths per 0.6 rowHeight
        let curY = midY - startPitchTenths * scaleY;
        ctx.moveTo(startPx, curY);

        for (let k = 0; k < pbwList.length; k++) {
          curMs += pbwList[k];
          const nextX = Math.min(x + w, x + (curMs / noteDurMs) * w);
          const pyVal = Number.isFinite(pbyList[k]) ? pbyList[k] : 0;
          curY = midY - pyVal * scaleY;
          ctx.lineTo(nextX, curY);
        }

        // Vibrato tail if present
        if (note.vbr && note.vbr.trim()) {
          const vParts = note.vbr.split(',').map((v) => Number.parseFloat(v));
          const lenPct = Number.isFinite(vParts[0]) ? Math.max(10, Math.min(100, vParts[0])) : 65;
          const periodMs = Number.isFinite(vParts[1]) ? Math.max(60, vParts[1]) : 165;
          const depthCents = Number.isFinite(vParts[2]) ? Math.max(5, vParts[2]) : 34;
          const vbrStartX = x + w * (1 - lenPct / 100);
          ctx.lineTo(Math.max(startPx, vbrStartX), midY);

          const vbrWidth = x + w - vbrStartX;
          const cycles = Math.max(1, ((noteDurMs * (lenPct / 100)) / periodMs));
          const ampPx = Math.min(h * 0.36, (depthCents / 100) * rowHeight * 0.7);
          const steps = Math.max(12, Math.round(vbrWidth / 3));
          for (let s = 0; s <= steps; s++) {
            const frac = s / steps;
            const env = Math.min(1, frac * 4, (1 - frac) * 4);
            const vx = vbrStartX + frac * vbrWidth;
            const vy = midY + Math.sin(frac * cycles * Math.PI * 2) * ampPx * env;
            ctx.lineTo(vx, vy);
          }
        } else {
          ctx.lineTo(x + w - 2, midY);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Right resize handle indicator
      if (w > 14) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.fillRect(x + w - 4, y + 3, 2, h - 6);
      }

      // UserModified protection indicator (crisp sky dot in top-right)
      if (isModified && w > 16) {
        ctx.fillStyle = '#38BDF8';
        ctx.fillRect(x + w - 10, y + 3, 4, 4);
      }

      // Lyric + Alias label inside note
      if (w > 18) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 3, y, Math.max(0, w - 12), h);
        ctx.clip();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
        const label =
          note.alias && note.alias !== note.lyric
            ? `${note.lyric} [${note.alias}]`
            : note.pronunciation && note.pronunciation !== note.lyric
            ? `${note.lyric} (${note.pronunciation})`
            : note.lyric || 'la';
        ctx.fillText(label, x + 5, y + h * 0.72);
        ctx.restore();
      }
    }

    // 6. Marquee Multi-Selection Box
    if (marquee) {
      const mx = Math.min(marquee.startX, marquee.curX);
      const my = Math.min(marquee.startY, marquee.curY);
      const mw = Math.abs(marquee.curX - marquee.startX);
      const mh = Math.abs(marquee.curY - marquee.startY);
      ctx.save();
      ctx.fillStyle = 'rgba(139, 92, 246, 0.16)';
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.9)';
      ctx.lineWidth = 1;
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.restore();
    }

    // 7. Playhead
    const px = playheadSec * pxPerSec;
    ctx.strokeStyle = '#A78BFA';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, totalHeight);
    ctx.stroke();
  }, [
    totalWidth,
    totalHeight,
    rowHeight,
    pxPerSec,
    bpm,
    quantizeGrid,
    beats,
    bars,
    notes,
    sections,
    selectedNoteIds,
    playheadSec,
    showPitchOverlay,
    compareOriginal,
    marquee,
  ]);

  const hitTestNote = (x: number, y: number): { note: UstNote; edge: boolean } | null => {
    const midi = MAX_MIDI - Math.floor(y / rowHeight);
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.midi !== midi) continue;
      const nx = n.startSec * pxPerSec;
      const nw = Math.max(8, (n.endSec - n.startSec) * pxPerSec);
      if (x >= nx && x <= nx + nw) {
        return { note: n, edge: x >= nx + nw - 7 && nw > 12 };
      }
    }
    return null;
  };

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (inlineEdit) setInlineEdit(null);
    const { x, y } = getCanvasCoords(e);
    const hit = hitTestNote(x, y);
    const midi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, MAX_MIDI - Math.floor(y / rowHeight)));
    const rawSec = Math.max(0, x / pxPerSec);
    const sec = snapEnabled ? snapSecToGrid(rawSec, bpm, quantizeGrid) : rawSec;

    if (tool === 'erase') {
      if (hit) {
        onCommitHistorySnapshot();
        onChangeNotes(notes.filter((n) => n.id !== hit.note.id), false);
        onSelectNotes(selectedNoteIds.filter((id) => id !== hit.note.id));
      }
      return;
    }

    if (tool === 'draw' && !hit) {
      onCommitHistorySnapshot();
      const stepSec = getGridStepSec(bpm, quantizeGrid === 'none' ? '1/8' : quantizeGrid);
      const newNote: UstNote = {
        id: `note-${Date.now()}-${Math.round(Math.random() * 999)}`,
        startSec: sec,
        endSec: Number((sec + stepSec).toFixed(4)),
        midi,
        lyric: 'la',
        pronunciation: 'la',
        alias: 'la',
        frequencyHz: Number(midiToFreq(midi).toFixed(2)),
        velocity: 100,
        intensity: 100,
        modulation: 0,
        userModified: true,
      };
      const updated = [...notes, newNote];
      onChangeNotes(updated, false);
      onSelectNotes([newNote.id]);
      dragRef.current = {
        mode: 'draw',
        startX: e.clientX,
        startY: e.clientY,
        originNotes: updated,
        activeNoteId: newNote.id,
        drawStartSec: sec,
        drawMidi: midi,
      };
      return;
    }

    if (hit) {
      let nextSelected = selectedNoteIds;
      if (e.shiftKey) {
        nextSelected = selectedNoteIds.includes(hit.note.id)
          ? selectedNoteIds.filter((id) => id !== hit.note.id)
          : [...selectedNoteIds, hit.note.id];
        onSelectNotes(nextSelected);
      } else if (!selectedNoteIds.includes(hit.note.id)) {
        nextSelected = [hit.note.id];
        onSelectNotes(nextSelected);
      }

      onCommitHistorySnapshot();
      dragRef.current = {
        mode: hit.edge ? 'resize' : 'move',
        startX: e.clientX,
        startY: e.clientY,
        originNotes: notes.map((n) => ({ ...n })),
        activeNoteId: hit.note.id,
      };
    } else {
      // Start marquee box selection on empty grid in select mode
      const baseSelected = e.shiftKey ? [...selectedNoteIds] : [];
      if (!e.shiftKey) onSelectNotes([]);
      dragRef.current = {
        mode: 'marquee',
        startX: e.clientX,
        startY: e.clientY,
        originNotes: notes,
        activeNoteId: '',
      };
      setMarquee({
        startX: x,
        startY: y,
        curX: x,
        curY: y,
        additive: e.shiftKey,
        baseSelected,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      const { x, y } = getCanvasCoords(e);
      const hit = hitTestNote(x, y);
      if (e.currentTarget) {
        e.currentTarget.style.cursor =
          tool === 'erase'
            ? 'crosshair'
            : tool === 'draw' && !hit
            ? 'cell'
            : hit?.edge
            ? 'ew-resize'
            : hit
            ? 'grab'
            : 'crosshair';
      }
      return;
    }

    if (drag.mode === 'marquee') {
      const { x, y } = getCanvasCoords(e);
      setMarquee((prev) => (prev ? { ...prev, curX: x, curY: y } : null));
      return;
    }

    const dxSec = (e.clientX - drag.startX) / pxPerSec;
    const dyMidi = Math.round((drag.startY - e.clientY) / rowHeight);

    if (drag.mode === 'draw' && drag.drawStartSec !== undefined) {
      const rawEnd = Math.max(drag.drawStartSec + 0.06, drag.drawStartSec + dxSec);
      const snappedEnd = snapEnabled
        ? Math.max(drag.drawStartSec + 0.06, snapSecToGrid(rawEnd, bpm, quantizeGrid))
        : Number(rawEnd.toFixed(4));
      onChangeNotes(
        drag.originNotes.map((n) =>
          n.id === drag.activeNoteId ? { ...n, endSec: snappedEnd, userModified: true } : n
        ),
        false
      );
      return;
    }

    if (drag.mode === 'resize') {
      const origin = drag.originNotes.find((n) => n.id === drag.activeNoteId);
      if (!origin) return;
      const rawEnd = Math.max(origin.startSec + 0.05, origin.endSec + dxSec);
      const newEnd = snapEnabled
        ? Math.max(origin.startSec + 0.05, snapSecToGrid(rawEnd, bpm, quantizeGrid))
        : Number(rawEnd.toFixed(4));
      onChangeNotes(
        drag.originNotes.map((n) =>
          n.id === drag.activeNoteId ? { ...n, endSec: newEnd, userModified: true } : n
        ),
        false
      );
      return;
    }

    if (drag.mode === 'move') {
      const activeSet = new Set(
        selectedNoteIds.includes(drag.activeNoteId) ? selectedNoteIds : [drag.activeNoteId]
      );
      const anchor = drag.originNotes.find((n) => n.id === drag.activeNoteId);
      if (!anchor) return;
      const rawStart = Math.max(0, anchor.startSec + dxSec);
      const targetStart = snapEnabled
        ? snapSecToGrid(rawStart, bpm, quantizeGrid)
        : Number(rawStart.toFixed(4));
      const actualDeltaSec = targetStart - anchor.startSec;

      onChangeNotes(
        drag.originNotes.map((n) => {
          if (!activeSet.has(n.id)) return n;
          const dur = n.endSec - n.startSec;
          const ns = Math.max(0, Number((n.startSec + actualDeltaSec).toFixed(4)));
          const nm = Math.max(MIN_MIDI, Math.min(MAX_MIDI, n.midi + dyMidi));
          return {
            ...n,
            startSec: ns,
            endSec: Number((ns + dur).toFixed(4)),
            midi: nm,
            frequencyHz: Number(midiToFreq(nm).toFixed(2)),
            userModified: true,
          };
        }),
        false
      );
    }
  };

  const handleMouseUp = () => {
    if (dragRef.current?.mode === 'marquee' && marquee) {
      const minX = Math.min(marquee.startX, marquee.curX);
      const maxX = Math.max(marquee.startX, marquee.curX);
      const minY = Math.min(marquee.startY, marquee.curY);
      const maxY = Math.max(marquee.startY, marquee.curY);

      if (maxX - minX > 4 || maxY - minY > 4) {
        const hitIds = notes
          .filter((n) => {
            if (n.midi < MIN_MIDI || n.midi > MAX_MIDI) return false;
            const nx = n.startSec * pxPerSec;
            const nw = Math.max(8, (n.endSec - n.startSec) * pxPerSec);
            const ny = (MAX_MIDI - n.midi) * rowHeight + 1;
            const nh = Math.max(8, rowHeight - 2);
            return nx <= maxX && nx + nw >= minX && ny <= maxY && ny + nh >= minY;
          })
          .map((n) => n.id);

        if (marquee.additive) {
          const merged = Array.from(new Set([...marquee.baseSelected, ...hitIds]));
          onSelectNotes(merged);
        } else {
          onSelectNotes(hitIds);
        }
      }
      setMarquee(null);
    }
    dragRef.current = null;
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    const hit = hitTestNote(x, y);
    if (hit) {
      setInlineEdit({
        noteId: hit.note.id,
        x: hit.note.startSec * pxPerSec,
        y: (MAX_MIDI - hit.note.midi) * rowHeight,
        lyric: hit.note.lyric,
        pronunciation: hit.note.pronunciation,
        alias: hit.note.alias,
      });
      return;
    }

    const midi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, MAX_MIDI - Math.floor(y / rowHeight)));
    const rawSec = Math.max(0, x / pxPerSec);
    const sec = snapEnabled ? snapSecToGrid(rawSec, bpm, quantizeGrid) : rawSec;
    const stepSec = getGridStepSec(bpm, quantizeGrid === 'none' ? '1/8' : quantizeGrid);
    const newNote: UstNote = {
      id: `note-${Date.now()}-${Math.round(Math.random() * 999)}`,
      startSec: sec,
      endSec: Number((sec + stepSec).toFixed(4)),
      midi,
      lyric: 'la',
      pronunciation: 'la',
      alias: 'la',
      frequencyHz: Number(midiToFreq(midi).toFixed(2)),
      velocity: 100,
      intensity: 100,
      modulation: 0,
      userModified: true,
    };
    onChangeNotes([...notes, newNote], true);
    onSelectNotes([newNote.id]);
  };

  const handleGridWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      onZoomChange(Math.max(24, Math.min(360, Math.round(pxPerSec * factor))));
    }
  };

  const hasSelection = selectedNoteIds.length > 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#0B0D14] select-none overflow-hidden">
      {/* Piano Roll Tool Strip */}
      <div className="h-9 shrink-0 px-3 bg-[#101420] border-b border-slate-800/80 flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setTool('select')}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              tool === 'select'
                ? 'bg-violet-600 text-white'
                : 'bg-[#161B2B] text-slate-400 hover:text-slate-200'
            }`}
          >
            <MousePointer2 className="w-3.5 h-3.5" />
            <span>선택</span>
          </button>
          <button
            type="button"
            onClick={() => setTool('draw')}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              tool === 'draw'
                ? 'bg-blue-600 text-white'
                : 'bg-[#161B2B] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>추가</span>
          </button>
          <button
            type="button"
            onClick={() => setTool('erase')}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              tool === 'erase'
                ? 'bg-rose-600 text-white'
                : 'bg-[#161B2B] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eraser className="w-3.5 h-3.5" />
            <span>지우개</span>
          </button>

          <div className="h-4 w-px bg-slate-800 mx-0.5" />

          {/* Snap Toggle + Interval Selector */}
          <button
            type="button"
            onClick={onToggleSnap}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
              snapEnabled
                ? 'bg-blue-600/20 border-blue-500/50 text-blue-200'
                : 'bg-[#161B2B] border-slate-800 text-slate-400'
            }`}
            title="박자 격자 스냅 켜기/끄기"
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>스냅</span>
          </button>
          <select
            value={quantizeGrid}
            onChange={(e) => onQuantizeGridChange(e.target.value as QuantizeGrid)}
            className="bg-[#161B2B] border border-slate-800 rounded px-1.5 py-1 text-xs font-mono tabular-nums text-slate-200 shrink-0"
            title="스냅 간격"
          >
            <option value="1/4">1/4</option>
            <option value="1/8">1/8</option>
            <option value="1/16">1/16</option>
            <option value="1/32">1/32</option>
            <option value="none">Free</option>
          </select>

          <div className="h-4 w-px bg-slate-800 mx-0.5" />

          {/* Professional Overlays */}
          <button
            type="button"
            onClick={() => setShowPitchOverlay((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
              showPitchOverlay
                ? 'bg-violet-600/20 border-violet-500/50 text-violet-200'
                : 'bg-[#161B2B] border-slate-800 text-slate-400'
            }`}
            title="Mode2 피치 곡선 및 비브라토 표시"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>피치·VBR</span>
          </button>
          <button
            type="button"
            onClick={() => setCompareOriginal((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
              compareOriginal
                ? 'bg-amber-600/20 border-amber-500/50 text-amber-200'
                : 'bg-[#161B2B] border-slate-800 text-slate-400'
            }`}
            title="원본 추출 음정과 AI 보정 음정 비교"
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>원본 비교</span>
          </button>
        </div>

        {/* Phrase & Lyric Quick Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onSelectPhrase}
            disabled={!hasSelection}
            className="px-2 py-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 disabled:opacity-40 text-[11px] text-slate-300 whitespace-nowrap shrink-0"
            title="선택된 음표가 속한 프레이즈 전체 선택"
          >
            프레이즈 선택
          </button>
          <button
            type="button"
            onClick={() => onShiftLyrics('left')}
            disabled={!hasSelection}
            className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 disabled:opacity-40 text-[11px] text-slate-300 whitespace-nowrap shrink-0"
            title="가사 앞 음표로 1칸 이동"
          >
            <ArrowLeft className="w-3 h-3" />
            <span>가사</span>
          </button>
          <button
            type="button"
            onClick={() => onShiftLyrics('right')}
            disabled={!hasSelection}
            className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 disabled:opacity-40 text-[11px] text-slate-300 whitespace-nowrap shrink-0"
            title="가사 뒤 음표로 1칸 밀기"
          >
            <span>가사</span>
            <ArrowRight className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onSplitSelectedNote}
            disabled={selectedNoteIds.length !== 1}
            className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 disabled:opacity-40 text-[11px] text-slate-300 whitespace-nowrap shrink-0"
            title="선택 음표 2분할"
          >
            <Scissors className="w-3 h-3" />
            <span>분할</span>
          </button>
          <button
            type="button"
            onClick={onMergeSelectedWithNext}
            disabled={selectedNoteIds.length !== 1}
            className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 disabled:opacity-40 text-[11px] text-slate-300 whitespace-nowrap shrink-0"
            title="다음 음표와 연결/합치기"
          >
            <Merge className="w-3 h-3" />
            <span>연결</span>
          </button>

          <div className="h-4 w-px bg-slate-800 mx-0.5" />

          <button
            type="button"
            onClick={() => setRowHeight((h) => Math.max(12, h - 3))}
            className="p-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 text-slate-300 shrink-0"
            title="세로 축소"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setRowHeight((h) => Math.min(32, h + 3))}
            className="p-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 text-slate-300 shrink-0"
            title="세로 확대"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onZoomChange(Math.max(24, Math.round(pxPerSec * 0.8)))}
            className="px-1.5 py-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-400 shrink-0"
            title="가로 축소"
          >
            -
          </button>
          <span className="px-1.5 text-[11px] font-mono tabular-nums text-slate-300 shrink-0">
            {pxPerSec}px/s
          </span>
          <button
            type="button"
            onClick={() => onZoomChange(Math.min(360, Math.round(pxPerSec * 1.25)))}
            className="px-1.5 py-1 rounded bg-[#161B2B] hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-400 shrink-0"
            title="가로 확대"
          >
            +
          </button>
        </div>
      </div>

      {/* Piano Keyboard + Grid */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* Left Piano Keys */}
        <div
          ref={keyScrollRef}
          className="w-14 shrink-0 overflow-hidden bg-[#0E121D] border-r border-slate-800/80"
        >
          <div style={{ height: totalHeight }}>
            {Array.from({ length: TOTAL_KEYS }, (_, idx) => {
              const midi = MAX_MIDI - idx;
              const black = isBlackKey(midi);
              const isC = midi % 12 === 0;
              return (
                <div
                  key={midi}
                  style={{ height: rowHeight }}
                  className={`flex items-center justify-end pr-1.5 text-[10px] font-mono tabular-nums border-b ${
                    black
                      ? 'bg-[#090B11] text-slate-500 border-slate-900'
                      : 'bg-[#171C2B] text-slate-300 border-slate-800/70'
                  } ${isC ? 'font-semibold text-violet-300 border-b-slate-700' : ''}`}
                >
                  {isC || rowHeight >= 22 ? midiToNoteName(midi) : ''}
                </div>
              );
            })}
          </div>
        </div>

        {/* Scrollable Canvas Grid */}
        <div
          ref={gridScrollRef}
          onWheel={handleGridWheel}
          onScroll={(e) => {
            if (keyScrollRef.current) {
              keyScrollRef.current.scrollTop = e.currentTarget.scrollTop;
            }
            onScrollLeftChange(e.currentTarget.scrollLeft);
          }}
          className="flex-1 overflow-auto relative"
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={handleDoubleClick}
            className="block"
          />

          {/* Inline Quick Note Lyric/Alias Editor */}
          {inlineEdit && (
            <form
              style={{
                left: Math.max(8, inlineEdit.x),
                top: Math.max(8, inlineEdit.y - 4),
              }}
              onSubmit={(e) => {
                e.preventDefault();
                onChangeNotes(
                  notes.map((n) =>
                    n.id === inlineEdit.noteId
                      ? {
                          ...n,
                          lyric: inlineEdit.lyric || 'la',
                          pronunciation: inlineEdit.pronunciation || inlineEdit.lyric || 'la',
                          alias:
                            inlineEdit.alias ||
                            inlineEdit.pronunciation ||
                            inlineEdit.lyric ||
                            'la',
                          userModified: true,
                          phonemeError: undefined,
                        }
                      : n
                  ),
                  true
                );
                setInlineEdit(null);
              }}
              className="absolute z-20 bg-[#161B2B] border border-violet-500 rounded-md p-2 shadow-xl flex items-center gap-1.5"
            >
              <input
                autoFocus
                type="text"
                value={inlineEdit.lyric}
                onChange={(e) => setInlineEdit({ ...inlineEdit, lyric: e.target.value })}
                placeholder="가사"
                className="w-16 bg-[#0B0D14] border border-slate-700 rounded px-1.5 py-1 text-xs text-white"
              />
              <input
                type="text"
                value={inlineEdit.pronunciation}
                onChange={(e) =>
                  setInlineEdit({ ...inlineEdit, pronunciation: e.target.value })
                }
                placeholder="발음"
                className="w-16 bg-[#0B0D14] border border-slate-700 rounded px-1.5 py-1 text-xs font-mono text-blue-200"
              />
              <input
                type="text"
                value={inlineEdit.alias}
                onChange={(e) => setInlineEdit({ ...inlineEdit, alias: e.target.value })}
                placeholder="Alias"
                className="w-20 bg-[#0B0D14] border border-slate-700 rounded px-1.5 py-1 text-xs font-mono text-violet-200"
              />
              <button
                type="submit"
                className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white whitespace-nowrap shrink-0"
              >
                적용
              </button>
              <button
                type="button"
                onClick={() => setInlineEdit(null)}
                className="px-2 py-1 rounded bg-slate-800 text-xs text-slate-300 whitespace-nowrap shrink-0"
              >
                닫기
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
