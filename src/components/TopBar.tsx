import React, { useRef } from 'react';
import {
  Download,
  FilePlus2,
  FolderOpen,
  Redo2,
  Save,
  Sparkles,
  Undo2,
} from 'lucide-react';

interface TopBarProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  onNewProject: () => void;
  onSaveProject: () => void;
  onLoadProject: (file: File) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onRunAiAnalysis: () => void;
  isAnalyzing: boolean;
  hasAudio: boolean;
  onOpenExport: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  projectName,
  onProjectNameChange,
  onNewProject,
  onSaveProject,
  onLoadProject,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onRunAiAnalysis,
  isAnalyzing,
  hasAudio,
  onOpenExport,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="h-13 shrink-0 bg-[#101420] border-b border-slate-800/80 px-4 flex items-center justify-between gap-4 select-none">
      {/* Left: Brand & Project Title */}
      <div className="flex items-center gap-4 min-w-0">
        <span className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
          AI UST Creator
        </span>
        <div className="h-4 w-px bg-slate-800 shrink-0" />
        <input
          type="text"
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          aria-label="프로젝트 이름"
          className="bg-[#161B2B] border border-slate-800 hover:border-slate-700 focus:border-violet-500 focus:outline-none rounded-md px-2.5 py-1 text-xs font-medium text-slate-200 w-44 sm:w-56 truncate"
          placeholder="Untitled UST Project"
        />
      </div>

      {/* Center/Right: DAW Toolbar Actions */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <button
          type="button"
          onClick={onNewProject}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/70 rounded-md transition-colors whitespace-nowrap shrink-0"
          title="새 프로젝트"
        >
          <FilePlus2 className="w-3.5 h-3.5 text-slate-400" />
          <span>새 프로젝트</span>
        </button>

        <button
          type="button"
          onClick={onSaveProject}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/70 rounded-md transition-colors whitespace-nowrap shrink-0"
          title="프로젝트 JSON 저장"
        >
          <Save className="w-3.5 h-3.5 text-slate-400" />
          <span>저장</span>
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/70 rounded-md transition-colors whitespace-nowrap shrink-0"
          title="프로젝트(.ustproj.json) 또는 UST(.ust) 불러오기"
        >
          <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
          <span>불러오기</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.ustproj.json,.ust"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onLoadProject(f);
            e.target.value = '';
          }}
        />

        <div className="h-4 w-px bg-slate-800 mx-1 shrink-0" />

        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/70 disabled:opacity-35 disabled:pointer-events-none rounded-md transition-colors whitespace-nowrap shrink-0"
          title="실행 취소 (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">실행 취소</span>
        </button>

        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/70 disabled:opacity-35 disabled:pointer-events-none rounded-md transition-colors whitespace-nowrap shrink-0"
          title="다시 실행 (Ctrl+Y)"
        >
          <Redo2 className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">다시 실행</span>
        </button>

        <div className="h-4 w-px bg-slate-800 mx-1 shrink-0" />

        <button
          type="button"
          onClick={onRunAiAnalysis}
          disabled={!hasAudio || isAnalyzing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-100 bg-blue-600/25 border border-blue-500/40 hover:bg-blue-600/40 disabled:opacity-40 disabled:pointer-events-none rounded-md transition-colors whitespace-nowrap shrink-0"
          title="음원 음정 분석 및 가사 자동 배치 실행"
        >
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          <span>{isAnalyzing ? '분석 중...' : 'AI 분석'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenExport}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>UST 내보내기</span>
        </button>
      </div>
    </header>
  );
};
