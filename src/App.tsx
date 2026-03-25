import { useState, useEffect, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ActionGrid } from "./components/ActionGrid";
import { CustomSelect } from "./components/CustomSelect";
import TerminalPanel from "./components/TerminalPanel";
import { useStore } from "./store";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./App.css";


function App() {
  const { projects, activeProjectId, globalSettings, updateGlobalSettings, hydrate } = useStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(340);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const { t, i18n } = useTranslation();
  
  const activeProject = projects.find(p => p.id === activeProjectId);
  const isAnyRunning = activeProject?.commands.some(c => c.status === 'running');
  // 有任务跑时自动展开，用户也可通过 TopBar 按钮切换
  const terminalVisible = isAnyRunning || isTerminalOpen;

  useEffect(() => { hydrate(); }, []);

  useEffect(() => {
    i18n.changeLanguage(globalSettings.language || "zh");
  }, [globalSettings.language, i18n]);

  useEffect(() => {
    const root = document.documentElement;
    if (globalSettings.theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.toggle('dark', systemTheme === 'dark');
    } else {
      root.classList.toggle('dark', globalSettings.theme === 'dark');
    }
  }, [globalSettings.theme]);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = terminalHeight;
    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartY.current - ev.clientY;
      setTerminalHeight(Math.min(700, Math.max(180, dragStartHeight.current + delta)));
    };
    const handleMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="h-screen w-screen flex bg-slate-50 dark:bg-[#0B0F19] font-sans overflow-hidden text-slate-800 dark:text-slate-300 transition-colors duration-300">
      {/* 极窄侧边栏 */}
      <Sidebar onOpenSettings={() => setIsSettingsOpen(true)} />
      
      {/* 主面板内容区 */}
      <div className="flex-1 flex flex-col relative w-full h-full overflow-hidden">
        {activeProject ? (
          <>
            <TopBar isTerminalOpen={isTerminalOpen} onTerminalToggle={() => setIsTerminalOpen(v => !v)} />
            
            <div className="flex-1 overflow-y-auto w-full no-scrollbar" style={{ paddingBottom: terminalVisible ? terminalHeight : 0 }}>
              <ActionGrid />
            </div>

            {/* 底部终端面板 */}
            {terminalVisible && (
              <div
                className="relative shrink-0 transition-all duration-300"
                style={{ height: terminalHeight }}
              >
                {/* 拖拽调整高度手柄 */}
                <div
                  onMouseDown={handleDragStart}
                  className="absolute -top-1 left-0 w-full h-2 cursor-ns-resize z-30 flex items-center justify-center group"
                  title="拖拽调整终端高度"
                >
                  <div className="w-12 h-1 bg-slate-300 dark:bg-slate-700 rounded-full group-hover:bg-blue-400 dark:group-hover:bg-blue-500 transition-colors" />
                </div>

                <TerminalPanel
                  key={activeProjectId}
                  className="h-full w-full"
                  onClose={() => setIsTerminalOpen(false)}
                  activeProjectId={activeProjectId}
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 dark:text-slate-500">
            <div className="w-16 h-16 bg-slate-200 dark:bg-slate-800/50 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
              <span className="text-3xl">👻</span>
            </div>
            <h2 className="text-2xl font-bold mb-2 text-slate-800 dark:text-slate-300">{t('Welcome to FlashRun')}</h2>
            <p className="text-sm">{t('点击左侧 + 号添加你的第一个项目接入空间吧！')}</p>
          </div>
        )}
      </div>

      {/* Settings Modal (Editor settings) */}
      {isSettingsOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 w-96 rounded-2xl shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 rounded-t-2xl">
              <h3 className="font-bold text-lg text-slate-800 dark:text-white">{t('全局设置')}</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('默认代码编辑器')}</label>
                <p className="text-xs text-slate-500 mb-4">{t('当在 TopBar 点击“打开”时，系统将通过此关联唤起对应应用解析该项目目录。')}</p>
                <CustomSelect 
                  value={globalSettings.defaultEditor}
                  onChange={(val) => updateGlobalSettings({ defaultEditor: val as any })}
                  options={[
                    { label: "Visual Studio Code (code)", value: "code" },
                    { label: "Cursor (cursor)", value: "cursor" },
                    { label: "Codebuddy", value: "codebuddy" },
                    { label: "Antigravity Internal", value: "antigravity" }
                  ]}
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('主题')}</label>
                  <CustomSelect 
                    value={globalSettings.theme}
                    onChange={(val) => updateGlobalSettings({ theme: val as any })}
                    options={[
                      { label: t("跟随系统"), value: "system" },
                      { label: t("浅色模式"), value: "light" },
                      { label: t("深色模式"), value: "dark" }
                    ]}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('语言')}</label>
                  <CustomSelect 
                    value={globalSettings.language}
                    onChange={(val) => updateGlobalSettings({ language: val as any })}
                    options={[
                      { label: "中文", value: "zh" },
                      { label: "English", value: "en" }
                    ]}
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex justify-end rounded-b-2xl">
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium text-sm transition-colors shadow-lg shadow-blue-600/20"
              >
                {t('完成')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
