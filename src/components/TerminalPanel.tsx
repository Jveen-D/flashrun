import React, { useCallback, useEffect, useMemo } from 'react';
import { Plus, X } from 'lucide-react';

import TerminalWindow from '../TerminalWindow';
import { useStore } from '../store';
import { useTranslation } from 'react-i18next';
import { requestTerminalFit } from '../utils/terminal';


interface TerminalPanelProps {
  className?: string;
  onClose?: () => void;
  activeProjectId?: string | null;
  isOpen?: boolean;
}

const TerminalPanel: React.FC<TerminalPanelProps> = ({
  className = '',
  onClose,
  activeProjectId,
  isOpen = false,
}) => {

  const { projects, projectTerminals, addTerminalTab, closeTerminalTab, setActiveTerminalTab, activeCommandByProject } = useStore();
  const { t } = useTranslation();
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const workingDir = activeProject?.path ?? '.';
  const terminalState = activeProjectId ? projectTerminals[activeProjectId] : undefined;

  const currentRunningCommand = useMemo(() => {
    if (!activeProject || !activeProjectId) {
      return null;
    }

    const activeCommandId = activeCommandByProject[activeProjectId];
    return activeProject.commands.find((command) => command.id === activeCommandId && command.status === 'running')
      ?? activeProject.commands.find((command) => command.status === 'running')
      ?? null;
  }, [activeCommandByProject, activeProject, activeProjectId]);

  const terminalTitle = currentRunningCommand && activeProject
    ? t('Terminal - {{project}} : {{command}}', {
      project: activeProject.name,
      command: currentRunningCommand.label,
    })
    : t('Terminal - Idle');

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

  useEffect(() => {
    if (!isOpen || !terminalState?.activeTabId) {
      return;
    }

    requestTerminalFit();
    const timer = window.setTimeout(() => requestTerminalFit(), 60);
    return () => window.clearTimeout(timer);
  }, [isOpen, terminalState?.activeTabId]);

  if (!terminalState) {

    return null;
  }

  return (
    <div className={`flex h-full w-full flex-col overflow-hidden rounded-t-md border border-slate-200/70 border-b-0 bg-white transition-colors dark:border-slate-800/60 dark:bg-[#0B1120] ${className}`}>
      <div className="flex h-7 shrink-0 select-none items-center gap-2 border-b border-slate-200/80 bg-slate-100/90 px-2 dark:border-slate-800/70 dark:bg-[#0E1628]">
        <div className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-500">
          {terminalTitle}
        </div>

        <div className="flex h-full max-w-[68%] shrink-0 items-center gap-0.5 overflow-x-auto no-scrollbar">
          {terminalState.tabs.map((tab) => {
            const isActive = terminalState.activeTabId === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTerminalTab(activeProjectId!, tab.id)}
                className={`group relative flex h-[22px] shrink-0 items-center gap-1 rounded-sm border border-transparent px-2 text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'border-slate-300/80 bg-white text-slate-700 dark:border-slate-700/70 dark:bg-[#111827] dark:text-slate-100'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-white/30 hover:text-slate-700 dark:hover:bg-slate-800/30 dark:hover:text-slate-200'
                }`}
              >
                <span>{tab.title}</span>
                {terminalState.tabs.length > 1 && isActive && (
                  <span
                    onClick={(event) => handleCloseTab(tab.id, event)}
                    className="ml-0.5 cursor-pointer rounded p-0.5 opacity-50 transition-all hover:bg-slate-300 hover:opacity-100 dark:hover:bg-slate-700"
                  >
                    <X size={9} />
                  </span>
                )}
              </button>
            );
          })}

          <button
            onClick={addTab}
            className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-slate-200/60 hover:text-blue-500 dark:hover:bg-slate-800/45 dark:hover:text-blue-400"
            title={t('新建终端')}
          >
            <Plus size={11} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {terminalState.tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: terminalState.activeTabId === tab.id ? 'flex' : 'none' }}
          >
            <TerminalWindow
              key={`${activeProjectId}-${tab.id}`}
              className="h-full w-full"
              sessionId={tab.id}
              projectId={activeProjectId}
              projectName={activeProject?.name}
              workingDir={workingDir}
              active={isOpen && terminalState.activeTabId === tab.id}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default TerminalPanel;
