import React, { useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from 'react-i18next';
import { FolderKanban, Plus, Settings, PanelLeftClose, PanelLeft } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import logoUrl from '../assets/logo.jpg';

interface SidebarProps {
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings }) => {
  const { projects, activeProjectId, setActiveProject, addProject } = useStore();
  const [isExpanded, setIsExpanded] = useState(true);
  const { t } = useTranslation();

  const handleAddProject = async () => {
    try {
      const path = await open({
        directory: true,
        multiple: false,
      });
      if (typeof path === 'string') {
        const projectInfo = await invoke<{ manager: string, scripts: Record<string, string> }>("parse_project_info", { path });
        addProject(path, projectInfo.manager, projectInfo.scripts);
      }
    } catch (error) {
      console.error("Failed to add project:", error);
      alert(error); 
    }
  };

  return (
    <aside className={`${isExpanded ? 'w-[260px]' : 'w-16'} h-screen bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col py-4 shrink-0 overflow-hidden select-none z-10 relative transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]`}>
      {/* 顶部 Logo 与 开关按钮 */}
      <div className={`w-full flex items-center mb-5 shrink-0 transition-all duration-300 ${isExpanded ? 'px-5 justify-between' : 'px-0 justify-center flex-col gap-4'}`}>
        <div className={`flex items-center ${!isExpanded && 'justify-center'}`}>
          <img 
            src={logoUrl} 
            alt="Logo" 
            className="w-9 h-9 rounded-xl shadow-[0_0_15px_rgba(0,0,0,0.1)] dark:shadow-[0_0_15px_rgba(255,255,255,0.1)] shrink-0 object-cover border border-slate-200 dark:border-slate-700/50" 
          />
          <span className={`font-extrabold text-xl tracking-tight text-slate-800 dark:text-white overflow-hidden transition-all duration-300 whitespace-nowrap ${isExpanded ? 'w-auto opacity-100 ml-3' : 'w-0 opacity-0 ml-0'}`}>
            {t('FlashRun')}
          </span>
        </div>
        
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className={`text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-white transition-colors shrink-0 ${isExpanded ? '' : ''}`}
          title={isExpanded ? t("收起侧边栏") : t("展开侧边栏")}
        >
          {isExpanded ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
        </button>
      </div>

      <div className={`mb-4 shrink-0 transition-all duration-300 ${isExpanded ? 'px-5' : 'px-3'}`}>
        <div className="h-px bg-slate-200 dark:bg-slate-800 rounded-full w-full" />
      </div>

      {/* 项目列表 */}
      <div className={`flex-1 w-full overflow-y-auto no-scrollbar flex flex-col space-y-1.5 pb-4 transition-all duration-300 ${isExpanded ? 'px-3' : 'px-2 items-center'}`}>
        {projects.map((project) => {
          const isActive = project.id === activeProjectId;
          const isRunning = project.commands.some(c => c.status === 'running');

          return (
            <div key={project.id} className="relative group cursor-pointer w-full flex items-center justify-center" onClick={() => setActiveProject(project.id)}>
              
              {/* Discord-style Active Pill */}
              <div className={`absolute -left-3 top-1/2 -translate-y-1/2 w-1.5 bg-blue-600 dark:bg-white rounded-r-md transition-all duration-300 z-10 ${
                isActive ? 'h-8' : 'h-0 group-hover:h-5 opacity-50'
              }`} />

              {/* Row Container */}
              <div className={`w-full flex items-center rounded-xl transition-all duration-200 border ${isExpanded ? 'p-2' : 'p-1 justify-center'} ${
                isActive 
                  ? 'bg-blue-50 dark:bg-blue-600/10 border-blue-200 dark:border-blue-500/30 shadow-sm' 
                  : 'bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:border-slate-200 dark:hover:border-slate-700/50'
              }`}>
                {/* Icon */}
                <div
                  className={`shrink-0 flex items-center justify-center transition-all duration-200 relative ${isExpanded ? 'w-10 h-10' : 'w-11 h-11'} ${
                    isActive 
                      ? 'rounded-xl bg-blue-500 dark:bg-blue-600 text-white shadow-lg shadow-blue-200 dark:shadow-blue-900/50' 
                      : 'rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 group-hover:text-blue-500 dark:group-hover:text-blue-400 group-hover:bg-blue-50 dark:group-hover:bg-slate-700/80'
                  }`}
                >
                  <FolderKanban size={isExpanded ? 20 : 22} strokeWidth={isActive ? 2.5 : 2} />
                  
                  {/* 呼吸灯特效 (右上角) */}
                  {isRunning && (
                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 z-20 items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                  )}
                </div>

                {/* Text - 只在展开时显示 */}
                <div className={`flex flex-col justify-center overflow-hidden transition-all duration-300 whitespace-nowrap ${
                  isExpanded ? 'ml-3 flex-1 min-w-0 opacity-100' : 'w-0 opacity-0 ml-0'
                }`}>
                  <div className={`text-sm font-bold truncate transition-colors ${
                    isActive ? 'text-slate-800 dark:text-white' : 'text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100'
                  }`}>
                    {project.name}
                  </div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate font-mono mt-0.5 uppercase tracking-wider font-semibold">
                    {project.manager}
                  </div>
                </div>
              </div>

              {/* Tooltip (收起大小时的悬浮提示) */}
              {!isExpanded && (
                <div className="absolute left-[60px] top-1/2 -translate-y-1/2 ml-2 px-3 py-1.5 bg-slate-800 dark:bg-black/95 text-white font-semibold text-xs rounded-lg shadow-xl opacity-0 hover:opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-all origin-left scale-95 group-hover:scale-100 border border-slate-700 dark:border-slate-800">
                  {project.name}
                </div>
              )}
            </div>
          );
        })}

        {/* 添加按钮 */}
        <div className={`w-full mt-2 pt-2 relative group flex justify-center ${isExpanded ? '' : ''}`}>
          <button
            onClick={handleAddProject}
            className={`w-full flex items-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 text-emerald-600 dark:text-emerald-500 group hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:border-emerald-400 dark:hover:border-emerald-500/40 transition-all duration-300 ${isExpanded ? 'p-2' : 'p-1 justify-center'}`}
            title={!isExpanded ? t("接入新项目") : undefined}
          >
            <div className={`shrink-0 flex items-center justify-center bg-slate-200 dark:bg-slate-800 rounded-xl group-hover:bg-emerald-500 group-hover:text-white transition-colors shadow-sm ${isExpanded ? 'w-10 h-10' : 'w-11 h-11'}`}>
              <Plus size={isExpanded ? 20 : 22} strokeWidth={2.5} />
            </div>
            <span className={`font-bold text-sm text-slate-500 dark:text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-all overflow-hidden whitespace-nowrap ${isExpanded ? 'ml-3 w-auto opacity-100' : 'w-0 opacity-0 ml-0'}`}>{t('接入新项目')}</span>
          </button>
        </div>
      </div>

      {/* 底部设置区 */}
      <div className={`w-full shrink-0 pt-4 border-t border-slate-200 dark:border-slate-800 mt-auto transition-all ${isExpanded ? 'px-4' : 'px-2 flex justify-center'}`}>
        <button 
          onClick={onOpenSettings}
          className={`w-full flex items-center rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors group ${isExpanded ? 'p-2' : 'p-2 justify-center leading-none'}`}
          title={!isExpanded ? t("全局设置") : undefined}
        >
          <div className="w-9 h-9 shrink-0 flex items-center justify-center bg-slate-200 dark:bg-slate-800/50 rounded-lg group-hover:bg-slate-300 dark:group-hover:bg-slate-700 transition-colors">
            <Settings size={18} className="group-hover:rotate-45 transition-transform duration-300" />
          </div>
          <span className={`font-semibold text-sm transition-all overflow-hidden whitespace-nowrap ${isExpanded ? 'ml-3 opacity-100' : 'w-0 opacity-0 ml-0'}`}>{t('全局设置')}</span>
        </button>
      </div>
    </aside>
  );
};
