import React from 'react';
import { useStore } from '../store';
import { FolderOpen, Folder } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { CustomSelect } from './CustomSelect';
import { useTranslation } from 'react-i18next';

export const TopBar: React.FC = () => {
  const { projects, activeProjectId, globalSettings, updateProjectManager, updateGlobalSettings } = useStore();
  const { t } = useTranslation();
  
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
      alert(t("无法唤起编辑器 {{editor}}。请确保已将其加入到系统环境变量 PATH 中。", { editor: globalSettings.defaultEditor }));
    }
  };

  if (!activeProject) {
    return <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/50 backdrop-blur shrink-0" />;
  }

  const editorLabelMap: Record<string, string> = {
    'code': 'VS Code',
    'cursor': 'Cursor',
    'codebuddy': 'Codebuddy',
    'antigravity': 'Antigravity'
  };

  return (
    <header className="h-14 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 bg-white/80 dark:bg-slate-900/50 backdrop-blur shrink-0 z-10 shadow-sm relative gap-4 transition-colors">
      {/* 左右分栏：左侧必须具有 flex-1 和 min-w-0 才能正确 truncate() 隐藏溢出内容 */}
      <div className="flex items-center space-x-4 flex-1 min-w-0">
        <h1 className="text-lg font-bold text-slate-800 dark:text-white leading-tight flex items-center gap-3 shrink-0 transition-colors">
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
              buttonClassName="flex items-center bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-[10px] uppercase font-bold border border-slate-300 dark:border-slate-700/80 rounded-full pl-3 pr-2 py-0.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700/80 outline-none transition-colors"
              dropdownClassName="left-0 mt-2 z-50 min-w-[100px]"
            />
          </div>
        </h1>
        <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 shrink-0" />
        
        {/* 文件夹按钮与长路径自动截断 */}
        <div className="flex items-center min-w-0 flex-1">
          <button 
            onClick={() => revealItemInDir(activeProject.path).catch(err => console.error(t("打开文件夹失败:"), err))}
            className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-white mr-2 transition-colors shrink-0 p-1" 
            title={t("在系统资源管理器中打开此目录")}
          >
            <Folder size={14} />
          </button>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate cursor-default transition-colors" title={activeProject.path}>
            {activeProject.path}
          </p>
        </div>
      </div>

      <div className="flex items-center shrink-0">
        <div className="flex items-stretch bg-blue-50 dark:bg-blue-600/10 border border-blue-200 dark:border-blue-500/40 rounded-lg shadow-sm group transition-colors">
          <button 
            onClick={handleOpenEditor}
            className="flex items-center space-x-2 px-4 py-1.5 text-blue-600 dark:text-blue-400 bg-transparent hover:bg-blue-600 hover:text-white transition-colors font-semibold text-sm rounded-l-lg"
            title={t("一键起飞打开该项目")}
          >
            <FolderOpen size={16} className="shrink-0" />
            <span className="whitespace-nowrap">{t("在 {{editor}} 中打开", { editor: editorLabelMap[globalSettings.defaultEditor] || t("编辑器") })}</span>
          </button>
          <div className="w-px bg-blue-200 dark:bg-blue-500/30 group-hover:bg-blue-300 dark:group-hover:bg-blue-500/80 transition-colors"></div>
          <div className="relative flex items-center text-blue-600 dark:text-blue-400 hover:text-white hover:bg-blue-600 transition-colors rounded-r-lg">
            <CustomSelect
              value={globalSettings.defaultEditor}
              onChange={(val) => updateGlobalSettings({ defaultEditor: val as any })}
              options={[
                { label: "VS Code", value: "code" },
                { label: "Cursor", value: "cursor" },
                { label: "Codebuddy", value: "codebuddy" },
                { label: "Antigravity", value: "antigravity" }
              ]}
              buttonClassName="flex items-center justify-center px-2 py-1.5 cursor-pointer h-full rounded-r-lg text-inherit hover:text-inherit focus:outline-none"
              dropdownClassName="right-0 top-full mt-2 w-40"
            />
          </div>
        </div>
      </div>
    </header>
  );
};
