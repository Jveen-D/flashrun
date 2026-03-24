import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ActionGrid } from "./components/ActionGrid";
import { CustomSelect } from "./components/CustomSelect";
import TerminalWindow from "./TerminalWindow";
import { useStore } from "./store";
import { X } from "lucide-react";
import "./App.css";

function App() {
  const { projects, activeProjectId, globalSettings, updateGlobalSettings } = useStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  const activeProject = projects.find(p => p.id === activeProjectId);
  const isAnyRunning = activeProject?.commands.some(c => c.status === 'running');

  return (
    <div className="h-screen w-screen flex bg-[#0B0F19] font-sans overflow-hidden text-slate-300">
      {/* 极窄侧边栏 */}
      <Sidebar onOpenSettings={() => setIsSettingsOpen(true)} />
      
      {/* 主面板内容区 */}
      <div className="flex-1 flex flex-col relative w-full h-full overflow-hidden">
        {activeProject ? (
          <>
            <TopBar />
            
            <div className="flex-1 overflow-y-auto w-full no-scrollbar pb-[400px]">
              <ActionGrid />
            </div>

            {/* 底部终端抽屉区域 (由于 TerminalWindow 自身拥有背景和 Header，这里简化外层包裹) */}
            <div className={`absolute bottom-0 left-0 w-full transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] z-20 ${
              isAnyRunning ? 'translate-y-0 h-[340px]' : 'translate-y-[calc(100%-40px)] h-[340px]'
            }`}>
              {/* Header 占位符供收起时点击展开/折叠 */}
              {!isAnyRunning && (
                <div className="absolute top-0 w-full h-10 z-30 flex items-center px-4 bg-slate-900/80 backdrop-blur border-t border-slate-800 text-slate-500 cursor-not-allowed uppercase tracking-wider text-xs font-bold rounded-t-xl" title="Click 'Run' on any command to auto-open">
                  Console Output (Folded)
                </div>
              )}
              
              <TerminalWindow key={activeProjectId} className="h-full w-full" />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
            <div className="w-16 h-16 bg-slate-800/50 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
              <span className="text-3xl">👻</span>
            </div>
            <h2 className="text-2xl font-bold mb-2 text-slate-300">Welcome to FlashRun</h2>
            <p className="text-sm">点击左侧 "+" 号添加你的第一个项目接入空间吧！</p>
          </div>
        )}
      </div>

      {/* Settings Modal (Editor settings) */}
      {isSettingsOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-96 rounded-2xl shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-800/30 rounded-t-2xl">
              <h3 className="font-bold text-lg text-white">全局设置</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6">
              <label className="block text-sm font-semibold text-slate-300 mb-2">默认代码编辑器</label>
              <p className="text-xs text-slate-500 mb-4">当在 TopBar 点击“打开”时，系统将通过此关联唤起对应应用解析该项目目录。</p>
              
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

            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/50 flex justify-end rounded-b-2xl">
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium text-sm transition-colors shadow-lg shadow-blue-600/20"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
