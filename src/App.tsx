import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FolderKanban } from 'lucide-react';

import { Sidebar } from './components/Sidebar';
import { WindowTitleBar } from './components/WindowTitleBar';
import { TopBar } from './components/TopBar';
import { ActionGrid } from './components/ActionGrid';
import { SettingsModal } from './components/SettingsModal';

import { flushPersistence, retryPersistence, useStore } from './store';
import { reconcileShellSessions } from './utils/shellSessions';
import { useTranslation } from 'react-i18next';
import { eventMatchesShortcut } from './utils/shortcuts';
import {
  appendTerminalOutput,
  commandOutputKey,
  pruneCommandOutput,
  COMMAND_STATUS_EVENT,
  TERMINAL_OUTPUT_EVENT,
  requestTerminalFit,
  type CommandStatusPayload,
  type TerminalOutputPayload,
} from './utils/terminal';
import './App.css';

const TerminalPanel = lazy(() => import('./components/TerminalPanel'));

function shouldIgnoreShortcutEvent(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) {
    return false;
  }

  if (element.closest('[data-shortcut-recorder="true"]')) {
    return true;
  }

  if (element.closest('.xterm')) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  return tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || Boolean(element.closest('[contenteditable="true"]'));
}

function App() {
  const {
    projects,
    activeProjectId,
    globalSettings,
    hydrate,
    hydrated,
    hydrationError,
    persistenceError,
    projectTerminals,
    isTerminalOpen,
    terminalHeight,
    setTerminalOpen,
    setTerminalHeight,
    toggleTerminal,
    activeCommandByProject,
  } = useStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const [mountedTerminalProjectIds, setMountedTerminalProjectIds] = useState<string[]>([]);
  const isDragging = useRef(false);

  const { t, i18n } = useTranslation();
  const appWindow = useMemo(() => getCurrentWindow(), []);

  // ── Derived values ─────────────────────────────────────────────
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const currentRunningCommand = activeProject && activeProjectId
    ? activeProject.commands.find((command) => command.id === activeCommandByProject[activeProjectId] && command.status === 'running')
      ?? activeProject.commands.find((command) => command.status === 'running')
      ?? null
    : null;
  const terminalTitle = currentRunningCommand && activeProject
    ? t('Terminal - {{project}} : {{command}}', {
      project: activeProject.name,
      command: currentRunningCommand.label,
    })
    : t('Terminal - Idle');
  const terminalVisible = isTerminalOpen;

  const renderedTerminalProjectIds = useMemo(() => {
    if (!hydrated) {
      return [] as string[];
    }

    if (!activeProjectId) {
      return mountedTerminalProjectIds;
    }

    return mountedTerminalProjectIds.includes(activeProjectId)
      ? mountedTerminalProjectIds
      : [...mountedTerminalProjectIds, activeProjectId];
  }, [activeProjectId, hydrated, mountedTerminalProjectIds]);
  const shouldRenderTerminalPanel = renderedTerminalProjectIds.length > 0;

  const toggleTerminalWithFit = useCallback(() => {
    toggleTerminal();
    window.setTimeout(() => requestTerminalFit(), 40);
  }, [toggleTerminal]);

  // ── Helpers ────────────────────────────────────────────────────
  useEffect(() => { void hydrate(); }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    void reconcileShellSessions(new Set(Object.values(projectTerminals).flatMap((state) => state.tabs.map((tab) => tab.id)))).catch(console.error);
    pruneCommandOutput(new Set(projects.flatMap((project) => project.commands.map((command) => commandOutputKey(project.id, command.id)))));
  }, [hydrated, projectTerminals, projects]);

  useEffect(() => {
    let closing = false;
    let disposed = false;
    const subscription = appWindow.onCloseRequested(async (event) => {
      if (closing) return;
      event.preventDefault();
      try {
        await flushPersistence();
        closing = true;
        await appWindow.close();
      } catch (error) { window.alert(String(error)); }
    });
    void subscription.then((unlisten) => { if (disposed) unlisten(); });
    return () => { disposed = true; void subscription.then((unlisten) => unlisten()); };
  }, [appWindow]);

  useEffect(() => {
    if (!hydrated || !activeProjectId) return;
    setMountedTerminalProjectIds((current) => {
      return current.includes(activeProjectId) ? current : [...current, activeProjectId];
    });
  }, [activeProjectId, hydrated]);

  useEffect(() => {
    const availableIds = new Set(projects.map((p) => p.id));
    setMountedTerminalProjectIds((current) => current.filter((id) => availableIds.has(id)));
  }, [projects]);

  useEffect(() => { i18n.changeLanguage(globalSettings.language || 'zh'); }, [globalSettings.language, i18n]);

  useEffect(() => {
    const root = document.documentElement;
    if (globalSettings.theme === 'system') {
      root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
    } else {
      root.classList.toggle('dark', globalSettings.theme === 'dark');
    }
  }, [globalSettings.theme]);

  useEffect(() => {
    if (!hydrated) return;
    void appWindow.setTitle(terminalTitle).catch((err) => console.warn('Failed to update window title:', err));
  }, [appWindow, hydrated, terminalTitle]);

  useEffect(() => {
    if (!hydrated) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcutEvent(event.target)) return;
      if (!eventMatchesShortcut(event, globalSettings.terminalToggleShortcut)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      toggleTerminalWithFit();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [globalSettings.terminalToggleShortcut, hydrated, toggleTerminalWithFit]);

  useEffect(() => {
    const unlistenPromise = listen<TerminalOutputPayload>(TERMINAL_OUTPUT_EVENT, (event) => {
      if (!useStore.getState().projects.some((project) => project.id === event.payload.projectId && project.commands.some((command) => command.id === event.payload.commandId))) return;
      appendTerminalOutput(event.payload);
    });
    return () => { unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<CommandStatusPayload>(COMMAND_STATUS_EVENT, (event) => {
      const state = useStore.getState();
      const project = state.projects.find((item) => item.id === event.payload.projectId);
      const command = project?.commands.find((item) => item.id === event.payload.commandId);
      if (!command) return;

      if (event.payload.status === 'started') {
        if (command.status !== 'running' || (command.pid && command.pid !== event.payload.pid)) return;
        state.updateCommand(event.payload.projectId, event.payload.commandId, {
          status: 'running',
          pid: event.payload.pid,
        });
        return;
      }

      if (command.pid !== event.payload.pid) return;
      state.updateCommand(event.payload.projectId, event.payload.commandId, { status: 'idle', pid: null });
      state.syncProjectActiveCommand(event.payload.projectId);
      requestTerminalFit();
    });
    return () => { unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  useEffect(() => {
    if (!terminalVisible) return;
    requestTerminalFit();
    const timer = window.setTimeout(() => requestTerminalFit(), 120);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, terminalHeight, terminalVisible]);

  // ── Terminal drag handler ──────────────────────────────────────
  const handleDragStart = (event: React.MouseEvent) => {
    event.preventDefault();
    isDragging.current = true;
    setIsDraggingState(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      setTerminalHeight(window.innerHeight - moveEvent.clientY);
    };
    const handleMouseUp = () => {
      isDragging.current = false;
      setIsDraggingState(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      requestTerminalFit();
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleOpenSettings = () => setIsSettingsOpen(true);

  return (
    <div
      className="relative flex h-screen w-full flex-col overflow-hidden bg-slate-100/80 font-sans text-slate-800 transition-colors duration-300 dark:bg-[#0A0F1A] dark:text-slate-300"
    >
      {hydrationError && <div role="alert" className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-slate-950 p-8 text-slate-100">
        <p>配置读取失败，原文件未被覆盖。请修复配置或从备份恢复后重试。</p>
        <pre className="max-w-full whitespace-pre-wrap text-sm">{hydrationError}</pre>
        <button className="rounded bg-blue-600 px-4 py-2" onClick={() => void hydrate()}>重试读取</button>
        <button onClick={() => void appWindow.close()}>退出</button>
      </div>}
      {persistenceError && <div role="alert" className="z-50 bg-amber-100 p-2 text-sm text-amber-950">
        配置未保存：{persistenceError}
        <button className="ml-2 underline" onClick={() => void retryPersistence().catch(console.error)}>重试保存</button>
      </div>}
      <WindowTitleBar />

      <div className="flex min-h-0 flex-1 overflow-hidden bg-slate-100/60 dark:bg-[#0B1120]">
        <Sidebar onOpenSettings={handleOpenSettings} />

        <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-slate-50/70 dark:bg-[#0B1120]">
          {activeProject ? (
            <>
              <TopBar
                isTerminalOpen={isTerminalOpen}
                onTerminalToggle={toggleTerminalWithFit}
              />

              <div className="w-full flex-1 overflow-y-auto no-scrollbar bg-slate-50/40 dark:bg-[#0B1120]">
                <ActionGrid />
              </div>

              {shouldRenderTerminalPanel && (
                <div
                  className={`relative shrink-0 overflow-hidden ${isDraggingState ? '' : 'transition-[height,opacity] duration-200'}`}
                  style={{
                    height: terminalVisible ? terminalHeight : 0,
                    opacity: terminalVisible ? 1 : 0,
                  }}
                  aria-hidden={!terminalVisible}
                >
                  <div
                    onMouseDown={handleDragStart}
                    className={`group absolute -top-1 left-0 z-30 flex h-2 w-full items-center justify-center ${terminalVisible ? 'cursor-ns-resize' : 'pointer-events-none opacity-0'}`}
                    title={t('拖拽调整终端高度')}
                  >
                    <div className="h-[3px] w-10 rounded-full bg-slate-300/90 transition-colors group-hover:bg-blue-400 dark:bg-slate-700/90 dark:group-hover:bg-blue-500" />
                  </div>

                  <div className={`relative h-full w-full ${terminalVisible ? '' : 'pointer-events-none'}`}>
                    {renderedTerminalProjectIds.map((projectId) => {
                      const isCurrentProject = projectId === activeProjectId;
                      return (
                        <div
                          key={projectId}
                          className={`absolute inset-0 ${isCurrentProject ? 'z-10 opacity-100' : 'pointer-events-none opacity-0'}`}
                          aria-hidden={!isCurrentProject}
                        >
                          <Suspense fallback={<div className="h-full w-full bg-white dark:bg-[#0B1120]" />}>
                            <TerminalPanel
                              className="h-full w-full"
                              onClose={() => setTerminalOpen(false)}
                              activeProjectId={projectId}
                              isOpen={terminalVisible && isCurrentProject}
                            />
                          </Suspense>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="flex w-full max-w-md flex-col items-center rounded-2xl border border-slate-200/80 bg-white/80 px-8 py-10 text-center shadow-sm dark:border-slate-800/70 dark:bg-slate-900/70">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-100 text-slate-500 dark:border-slate-700/70 dark:bg-slate-800/80 dark:text-slate-300">
                  <FolderKanban size={24} />
                </div>
                <h2 className="mb-2 text-xl font-semibold text-slate-800 dark:text-slate-100">{t('Welcome to FlashRun')}</h2>
                <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{t('点击左侧 + 号添加你的第一个项目接入空间吧！')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <SettingsModal
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}

export default App;
