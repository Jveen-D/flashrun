import React, { useState, useCallback } from 'react';
import { Plus, X, Terminal as TerminalIcon } from 'lucide-react';
import TerminalWindow from '../TerminalWindow';
import { nanoid } from 'nanoid';

interface TerminalTab {
  id: string;
  title: string;
}

interface TerminalPanelProps {
  className?: string;
  onClose?: () => void;
  activeProjectId?: string | null;
}

const TerminalPanel: React.FC<TerminalPanelProps> = ({ className = '', onClose, activeProjectId }) => {
  const [tabs, setTabs] = useState<TerminalTab[]>([{ id: nanoid(), title: 'Terminal 1' }]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);

  const addTab = useCallback(() => {
    const id = nanoid();
    const newTab: TerminalTab = { id, title: `Terminal ${tabs.length + 1}` };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
  }, [tabs.length]);

  const closeTab = useCallback((tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== tabId);
      if (remaining.length === 0) {
        // 关闭最后一个 tab 时关闭整个面板
        onClose?.();
        return prev;
      }
      if (activeTabId === tabId) {
        setActiveTabId(remaining[remaining.length - 1].id);
      }
      return remaining;
    });
  }, [activeTabId, onClose]);

  return (
    <div className={`flex flex-col w-full h-full bg-white/95 dark:bg-slate-950/80 backdrop-blur rounded-t-xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 border-b-0 transition-colors ${className}`}>
      {/* Tab Bar */}
      <div className="h-10 bg-slate-100/50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 flex items-center shrink-0 select-none">
        {/* 左侧 macOS 风格圆点 */}
        <div className="flex items-center space-x-1.5 px-3 shrink-0">
          {/* 关闭整个面板 */}
          <button
            onClick={onClose}
            className="w-3 h-3 rounded-full bg-red-400 dark:bg-red-500 hover:bg-red-500 dark:hover:bg-red-400 transition-colors flex items-center justify-center group"
            title="收起终端"
          >
            <span className="text-red-900 opacity-0 group-hover:opacity-100 text-[8px] leading-none font-bold">×</span>
          </button>
          <div className="w-3 h-3 rounded-full bg-yellow-400 dark:bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-400 dark:bg-green-500" />
        </div>

        {/* Tab 列表 */}
        <div className="flex-1 flex items-center overflow-x-auto no-scrollbar h-full">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex items-center gap-1.5 h-full px-3 text-xs font-medium shrink-0 border-r border-slate-200 dark:border-slate-800 transition-colors group relative ${
                activeTabId === tab.id
                  ? 'bg-white/80 dark:bg-slate-900 text-slate-800 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/40 dark:hover:bg-slate-800/40'
              }`}
            >
              <TerminalIcon size={11} className="shrink-0 opacity-70" />
              <span>{tab.title}</span>
              {tabs.length > 1 && (
                <span
                  onClick={(e) => closeTab(tab.id, e)}
                  className={`ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all cursor-pointer ${activeTabId === tab.id ? 'opacity-60' : ''}`}
                >
                  <X size={10} />
                </span>
              )}
              {/* 活跃 tab 底部指示条 */}
              {activeTabId === tab.id && (
                <span className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-500 rounded-t" />
              )}
            </button>
          ))}

          {/* 新增 Tab 按钮 */}
          <button
            onClick={addTab}
            className="flex items-center justify-center w-8 h-full text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-colors shrink-0"
            title="新建终端"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Terminal 内容区：所有 tab 渲染，通过 display 控制显示 */}
      <div className="flex-1 relative overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: activeTabId === tab.id ? 'flex' : 'none' }}
          >
            <TerminalWindow
              key={`${activeProjectId}-${tab.id}`}
              className="w-full h-full"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default TerminalPanel;
