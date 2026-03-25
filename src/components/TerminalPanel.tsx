import React, { useCallback } from 'react';
import { Plus, X, Terminal as TerminalIcon } from 'lucide-react';
import TerminalWindow from '../TerminalWindow';
import { useStore } from '../store';

interface TerminalPanelProps {
  className?: string;
  onClose?: () => void;
  activeProjectId?: string | null;
}

const TerminalPanel: React.FC<TerminalPanelProps> = ({ className = '', onClose, activeProjectId }) => {
  const { projects, projectTerminals, addTerminalTab, closeTerminalTab, setActiveTerminalTab } = useStore();
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const workingDir = activeProject?.path ?? '.';
  const terminalState = activeProjectId ? projectTerminals[activeProjectId] : undefined;

  const addTab = useCallback(() => {
    if (!activeProjectId) {
      return;
    }
    addTerminalTab(activeProjectId);
  }, [activeProjectId, addTerminalTab]);

  const handleCloseTab = useCallback((tabId: string, event: React.MouseEvent) => {
    event.stopPropagation();

    if (!activeProjectId) {
      return;
    }

    if ((terminalState?.tabs.length ?? 0) <= 1) {
      onClose?.();
      return;
    }

    closeTerminalTab(activeProjectId, tabId);
  }, [activeProjectId, closeTerminalTab, onClose, terminalState?.tabs.length]);

  if (!terminalState) {
    return null;
  }

  return (
    <div className={`flex flex-col w-full h-full bg-white/95 dark:bg-slate-950/80 backdrop-blur rounded-t-xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 border-b-0 transition-colors ${className}`}>
      <div className="h-10 bg-slate-100/50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 flex items-center shrink-0 select-none">
        <div className="flex items-center space-x-1.5 px-3 shrink-0">
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

        <div className="flex-1 flex items-center overflow-x-auto no-scrollbar h-full">
          {terminalState.tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTerminalTab(activeProjectId!, tab.id)}
              className={`flex items-center gap-1.5 h-full px-3 text-xs font-medium shrink-0 border-r border-slate-200 dark:border-slate-800 transition-colors group relative ${
                terminalState.activeTabId === tab.id
                  ? 'bg-white/80 dark:bg-slate-900 text-slate-800 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/40 dark:hover:bg-slate-800/40'
              }`}
            >
              <TerminalIcon size={11} className="shrink-0 opacity-70" />
              <span>{tab.title}</span>
              {terminalState.tabs.length > 1 && (
                <span
                  onClick={(event) => handleCloseTab(tab.id, event)}
                  className={`ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all cursor-pointer ${terminalState.activeTabId === tab.id ? 'opacity-60' : ''}`}
                >
                  <X size={10} />
                </span>
              )}
              {terminalState.activeTabId === tab.id && (
                <span className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-500 rounded-t" />
              )}
            </button>
          ))}

          <button
            onClick={addTab}
            className="flex items-center justify-center w-8 h-full text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-colors shrink-0"
            title="新建终端"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {terminalState.tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: terminalState.activeTabId === tab.id ? 'flex' : 'none' }}
          >
            <TerminalWindow
              key={`${activeProjectId}-${tab.id}`}
              className="w-full h-full"
              sessionId={tab.id}
              workingDir={workingDir}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default TerminalPanel;
