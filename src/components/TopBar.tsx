import React from 'react';
import { useStore } from '../store';
import { FolderOpen, Folder } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import { CustomSelect } from './CustomSelect';

export const TopBar: React.FC = () => {
  const { projects, activeProjectId, globalSettings, updateProjectManager, updateGlobalSettings } = useStore();
  
  const activeProject = projects.find(p => p.id === activeProjectId);

  const handleOpenEditor = async () => {
    if (!activeProject) return;
    try {
      await invoke("open_in_editor", { 
        path: activeProject.path, 
        editorKey: globalSettings.defaultEditor 
      });
    } catch (e) {
      console.error("Failed to open editor:", e);
      alert(`无法唤起编辑器 ${globalSettings.defaultEditor}。请确保已将其加入到系统环境变量 PATH 中。`);
    }
  };

  if (!activeProject) {
    return <header className="h-14 border-b border-slate-800 bg-slate-900/50 backdrop-blur shrink-0" />;
  }

  const editorLabelMap: Record<string, string> = {
    'code': 'VS Code',
    'cursor': 'Cursor',
    'codebuddy': 'Codebuddy',
    'antigravity': 'Antigravity'
  };

  return (
    <header className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur shrink-0 z-10 shadow-sm relative gap-4">
      {/* 左右分栏：左侧必须具有 flex-1 和 min-w-0 才能正确 truncate() 隐藏溢出内容 */}
      <div className="flex items-center space-x-4 flex-1 min-w-0">
        <h1 className="text-lg font-bold text-white leading-tight flex items-center gap-3 shrink-0">
          {activeProject.name}
          <div className="relative group">
            <CustomSelect
              value={activeProject.manager}
              onChange={(val) => updateProjectManager(activeProject.id, val)}
              options={[
                { label: "NPM", value: "npm" },
                { label: "PNPM", value: "pnpm" },
                { label: "YARN", value: "yarn" },
                { label: "BUN", value: "bun" }
              ]}
              buttonClassName="flex items-center bg-slate-800 text-slate-300 hover:text-white text-[10px] uppercase font-bold border border-slate-700/80 rounded-full pl-3 pr-2 py-0.5 cursor-pointer hover:bg-slate-700/80 outline-none transition-colors"
              dropdownClassName="left-0 mt-2 z-50 min-w-[100px]"
            />
          </div>
        </h1>
        <div className="h-4 w-px bg-slate-700 shrink-0" />
        
        {/* 文件夹按钮与长路径自动截断 */}
        <div className="flex items-center min-w-0 flex-1">
          <button 
            onClick={() => openPath(activeProject.path).catch(err => console.error("打开文件夹失败:", err))}
            className="text-slate-500 hover:text-white mr-2 transition-colors shrink-0 p-1" 
            title="在系统资源管理器中打开此目录"
          >
            <Folder size={14} />
          </button>
          <p className="text-xs text-slate-400 font-mono truncate cursor-default" title={activeProject.path}>
            {activeProject.path}
          </p>
        </div>
      </div>

      <div className="flex items-center shrink-0">
        <div className="flex items-stretch bg-blue-600/10 border border-blue-500/40 rounded-lg shadow-sm group">
          <button 
            onClick={handleOpenEditor}
            className="flex items-center space-x-2 px-4 py-1.5 text-blue-400 bg-transparent hover:bg-blue-600 hover:text-white transition-colors font-semibold text-sm rounded-l-lg"
            title="一键起飞打开该项目"
          >
            <FolderOpen size={16} className="shrink-0" />
            <span className="whitespace-nowrap">在 {editorLabelMap[globalSettings.defaultEditor] || '编辑器'} 中打开</span>
          </button>
          <div className="w-px bg-blue-500/30 group-hover:bg-blue-500/80 transition-colors"></div>
          <div className="relative flex items-center px-1 text-blue-400 hover:text-white hover:bg-blue-600 transition-colors cursor-pointer group/arrow border-l border-transparent rounded-r-lg">
            <CustomSelect
              value={globalSettings.defaultEditor}
              onChange={(val) => updateGlobalSettings({ defaultEditor: val as any })}
              options={[
                { label: "VS Code", value: "code" },
                { label: "Cursor", value: "cursor" },
                { label: "Codebuddy", value: "codebuddy" },
                { label: "Antigravity", value: "antigravity" }
              ]}
              buttonClassName="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
              dropdownClassName="right-0 top-full mt-2 w-40"
              hideChevron={true}
            />
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-80 transition-transform group-hover/arrow:-translate-y-0.5"><path d="m6 9 6 6 6-6"/></svg>
          </div>
        </div>
      </div>
    </header>
  );
};
