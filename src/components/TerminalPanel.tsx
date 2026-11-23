import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import TerminalWindow, { type TerminalWindowHandle } from '../TerminalWindow';
import { CustomSelect } from './CustomSelect';
import { useStore } from '../store';
import { useCommandRunner } from '../hooks/useCommandRunner';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { commandOutputKey } from '../utils/terminal';
import { formatDisplayUrl, formatDuration } from '../utils/logInsights';
import { freeConflictingPortAndRestart } from '../utils/portConflict';
import { toast } from '../utils/toast';

interface Props {
  className?: string;
  onClose?: () => void;
  activeProjectId?: string | null;
  isOpen?: boolean;
}

const SHELL_OPTION_VALUE = '__shell__';

export default function TerminalPanel({ className = '', onClose, activeProjectId, isOpen = false }: Props) {
  const { t } = useTranslation();
  const projects = useStore((state) => state.projects);
  const terminals = useStore((state) => state.projectTerminals);
  const terminalViewByProject = useStore((state) => state.terminalViewByProject);
  const commandRuntimeByKey = useStore((state) => state.commandRuntimeByKey);
  const addTab = useStore((state) => state.addTerminalTab);
  const closeTab = useStore((state) => state.closeTerminalTab);
  const selectTab = useStore((state) => state.setActiveTerminalTab);
  const setProjectTerminalView = useStore((state) => state.setProjectTerminalView);
  const clearCommandPortConflict = useStore((state) => state.clearCommandPortConflict);
  const { runCommand, stopCommand, restartCommand } = useCommandRunner();
  const themeMode = useResolvedTheme();

  const [mountedShellIds, setMountedShellIds] = useState<string[]>([]);
  const [mountedCommandIds, setMountedCommandIds] = useState<string[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMiss, setSearchMiss] = useState(false);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const terminalHandlesRef = useRef<Map<string, TerminalWindowHandle>>(new Map());

  const project = projects.find((item) => item.id === activeProjectId);
  const terminalState = activeProjectId ? terminals[activeProjectId] : undefined;
  const view = activeProjectId ? terminalViewByProject[activeProjectId] : undefined;

  const activeCommand = useMemo(() => {
    if (!project || view?.mode !== 'command') return null;
    return project.commands.find((item) => item.id === view.commandId) ?? null;
  }, [project, view]);

  const activeShellTab = useMemo(() => {
    if (!terminalState) return null;
    return terminalState.tabs.find((tab) => tab.id === terminalState.activeTabId) ?? terminalState.tabs[0] ?? null;
  }, [terminalState]);

  const activePaneKey = activeCommand
    ? `command:${activeCommand.id}`
    : activeShellTab
      ? `shell:${activeShellTab.id}`
      : null;

  // Mount the active terminal lazily when the panel is open, then keep it alive across hide/show and tab switches.
  useEffect(() => {
    if (!isOpen) return;
    if (activeCommand) {
      setMountedCommandIds((current) => (current.includes(activeCommand.id) ? current : [...current, activeCommand.id]));
    } else if (activeShellTab) {
      setMountedShellIds((current) => (current.includes(activeShellTab.id) ? current : [...current, activeShellTab.id]));
    }
  }, [activeCommand, activeShellTab, isOpen]);

  // Prune unmounted entries when tabs or commands are removed.
  useEffect(() => {
    if (!terminalState) return;
    const validTabIds = new Set(terminalState.tabs.map((tab) => tab.id));
    setMountedShellIds((current) => current.filter((id) => validTabIds.has(id)));
  }, [terminalState]);

  useEffect(() => {
    if (!project) return;
    const validCommandIds = new Set(project.commands.map((command) => command.id));
    setMountedCommandIds((current) => current.filter((id) => validCommandIds.has(id)));
  }, [project]);

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
    setSearchMiss(false);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchMiss(false);
    if (activePaneKey) {
      const handle = terminalHandlesRef.current.get(activePaneKey);
      handle?.clearSearch();
      handle?.focus();
    }
  }, [activePaneKey]);

  const registerHandle = useCallback((paneKey: string) => (handle: TerminalWindowHandle | null) => {
    if (handle) {
      terminalHandlesRef.current.set(paneKey, handle);
    } else {
      terminalHandlesRef.current.delete(paneKey);
    }
  }, []);

  if (!project || !terminalState) return null;

  const activeRuntime = activeCommand
    ? commandRuntimeByKey[commandOutputKey(project.id, activeCommand.id)]
    : undefined;

  const activeHandle = activePaneKey ? terminalHandlesRef.current.get(activePaneKey) : undefined;

  const handleSearchNext = () => {
    if (!searchQuery.trim() || !activeHandle) return;
    const matched = activeHandle.searchNext(searchQuery);
    setSearchMiss(!matched);
  };

  const handleSearchPrev = () => {
    if (!searchQuery.trim() || !activeHandle) return;
    const matched = activeHandle.searchPrevious(searchQuery);
    setSearchMiss(!matched);
  };

  const handleCopyLogs = async () => {
    const text = activeHandle?.getPlainText() ?? '';
    if (!text.trim()) {
      toast.info(t('当前终端暂无可复制的输出。'));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('已复制终端输出到剪贴板。'));
    } catch (error) {
      console.error('Failed to copy logs:', error);
      toast.error(t('复制输出失败：{{error}}', { error: String(error) }));
    }
  };

  const handleExportLogs = async () => {
    const text = activeHandle?.getPlainText() ?? '';
    if (!text.trim()) {
      toast.info(t('当前终端暂无可导出的输出。'));
      return;
    }
    try {
      const safeName = `${project.name}-${activeCommand ? activeCommand.label : (activeShellTab?.title ?? 'shell')}`
        .replace(/[^a-zA-Z0-9._-]+/g, '-');
      const targetPath = await save({
        defaultPath: `${safeName}.log`,
        filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }],
      });
      if (!targetPath) return;
      await invoke('export_text_file', { path: targetPath, content: text });
      toast.success(t('日志已导出至 {{path}}', { path: targetPath }));
    } catch (error) {
      console.error('Failed to export logs:', error);
      toast.error(t('导出日志失败：{{error}}', { error: String(error) }));
    }
  };

  const handleClearTerminal = () => {
    activeHandle?.clear();
    activeHandle?.focus();
  };

  const handleScrollToBottom = () => {
    activeHandle?.scrollToBottom();
    activeHandle?.focus();
  };

  const handleResolveConflict = async () => {
    if (!activeCommand || !activeRuntime?.portConflict || isResolvingConflict) return;
    setIsResolvingConflict(true);
    try {
      await freeConflictingPortAndRestart({
        projectId: project.id,
        commandId: activeCommand.id,
        port: activeRuntime.portConflict,
        restart: restartCommand,
        t,
      });
    } finally {
      setIsResolvingConflict(false);
    }
  };

  const commandSelectOptions = [
    { label: t('独立终端 (Shell)'), value: SHELL_OPTION_VALUE },
    ...project.commands.map((command) => {
      const runtime = commandRuntimeByKey[commandOutputKey(project.id, command.id)];
      const suffix = command.status === 'running'
        ? ' ●'
        : runtime?.lastExitCode === 0
          ? ' ✓'
          : runtime?.lastExitCode !== null && runtime?.lastExitCode !== undefined
            ? ` ✗(${runtime.lastExitCode})`
            : '';
      return {
        label: `${command.label}${suffix}`,
        value: command.id,
      };
    }),
  ];

  const handleCommandSelect = (value: string) => {
    if (value === SHELL_OPTION_VALUE) {
      setProjectTerminalView(project.id, { mode: 'shell' });
    } else {
      setProjectTerminalView(project.id, { mode: 'command', commandId: value });
    }
  };

  return (
    <div className={`flex h-full flex-col border-t border-slate-200/90 bg-slate-50 dark:border-slate-800/80 dark:bg-[#0B1120] ${className}`}>
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-slate-200/80 bg-slate-100/95 px-2 text-xs text-slate-700 dark:border-slate-800/80 dark:bg-slate-900/95 dark:text-slate-200">
        <div className="shrink-0">
          <CustomSelect
            value={activeCommand?.id ?? SHELL_OPTION_VALUE}
            onChange={handleCommandSelect}
            options={commandSelectOptions}
            buttonClassName="flex h-6 max-w-44 items-center justify-between gap-1 rounded-md border border-slate-300/80 bg-white px-2 text-xs font-medium text-slate-700 transition-colors hover:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500/60"
            dropdownClassName="left-0 top-full mt-1 max-h-60 min-w-[180px] overflow-y-auto"
          />
        </div>

        <div className="h-4 w-px shrink-0 bg-slate-300/80 dark:bg-slate-700/80" />

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
          {terminalState.tabs.map((tab) => {
            const isTabActive = !activeCommand && activeShellTab?.id === tab.id;
            return (
              <div
                key={tab.id}
                className={`group flex shrink-0 items-center rounded-md border transition-colors ${
                  isTabActive
                    ? 'border-blue-500/70 bg-blue-600 text-white'
                    : 'border-transparent bg-slate-200/75 text-slate-600 hover:bg-slate-200 dark:bg-slate-800/90 dark:text-slate-300 dark:hover:bg-slate-700/80'
                }`}
              >
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium"
                  onClick={() => {
                    setProjectTerminalView(project.id, { mode: 'shell' });
                    selectTab(project.id, tab.id);
                  }}
                >
                  <TerminalIcon size={11} />
                  <span>{tab.title}</span>
                </button>
                <button
                  type="button"
                  aria-label={t('关闭 {{title}}', { title: tab.title })}
                  title={t('关闭终端标签')}
                  onClick={() => closeTab(project.id, tab.id)}
                  className={`mr-1 rounded p-0.5 transition-opacity ${
                    isTabActive ? 'opacity-80 hover:bg-white/20 hover:opacity-100' : 'opacity-50 hover:bg-slate-300/70 hover:opacity-100 dark:hover:bg-slate-600'
                  }`}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            aria-label={t('新建终端')}
            title={t('新建终端')}
            onClick={() => {
              setProjectTerminalView(project.id, { mode: 'shell' });
              addTab(project.id);
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <Plus size={13} />
          </button>

          {activeCommand && activeRuntime && (
            <div className="ml-1 flex shrink-0 items-center gap-1.5">
              {activeCommand.status === 'idle' && activeRuntime.lastExitCode !== null && (
                <span
                  className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                    activeRuntime.lastExitCode === 0
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                      : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                  }`}
                >
                  {activeRuntime.lastExitCode === 0 ? '✓ 0' : `✗ ${activeRuntime.lastExitCode}`}
                  {activeRuntime.lastDurationMs !== null ? ` · ${formatDuration(activeRuntime.lastDurationMs)}` : ''}
                </span>
              )}
              {activeRuntime.detectedUrls.slice(-1).map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => void openUrl(url).catch((error) => toast.error(String(error)))}
                  className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-blue-600 transition-colors hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25"
                  title={t('在浏览器中打开 {{url}}', { url })}
                >
                  <ExternalLink size={10} />
                  <span>{formatDisplayUrl(url)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {activeCommand && (
            <>
              {activeCommand.status === 'running' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void restartCommand(project.id, activeCommand.id).catch((error) => toast.error(t('重启进程失败：{{error}}', { error: String(error) })))}
                    title={t('重启')}
                    aria-label={t('重启')}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-amber-600 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-500/15"
                  >
                    <RefreshCw size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void stopCommand(project.id, activeCommand.id).catch((error) => toast.error(t('停止进程失败：{{error}}', { error: String(error) })))}
                    title={t('停止')}
                    aria-label={t('停止')}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-rose-600 transition-colors hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-500/15"
                  >
                    <Square size={11} className="fill-current" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void runCommand(project.id, activeCommand.id).catch((error) => toast.error(t('运行命令失败：{{error}}', { error: String(error) })))}
                  title={t('运行')}
                  aria-label={t('运行')}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-blue-600 transition-colors hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-500/15"
                >
                  <Play size={12} className="fill-current" />
                </button>
              )}
              <div className="mx-0.5 h-3.5 w-px bg-slate-300/80 dark:bg-slate-700/80" />
            </>
          )}

          <button
            type="button"
            onClick={() => (isSearchOpen ? closeSearch() : openSearch())}
            title={t('搜索日志 (Ctrl/Cmd + F)')}
            aria-label={t('搜索日志')}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
              isSearchOpen
                ? 'bg-blue-600 text-white'
                : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
            }`}
          >
            <Search size={12} />
          </button>
          <button
            type="button"
            onClick={() => void handleCopyLogs()}
            title={t('复制所有输出')}
            aria-label={t('复制所有输出')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            onClick={() => void handleExportLogs()}
            title={t('导出日志')}
            aria-label={t('导出日志')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <Download size={12} />
          </button>
          <button
            type="button"
            onClick={handleClearTerminal}
            title={t('清空日志')}
            aria-label={t('清空日志')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <Trash2 size={12} />
          </button>
          <button
            type="button"
            onClick={handleScrollToBottom}
            title={t('滚动到底部')}
            aria-label={t('滚动到底部')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <ArrowDownToLine size={12} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t('收起终端')}
            aria-label={t('收起终端')}
            className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {isSearchOpen && (
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-slate-200/80 bg-white/90 px-2.5 text-xs dark:border-slate-800/80 dark:bg-slate-900/90">
          <Search size={12} className="shrink-0 text-slate-400" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => {
              const next = event.target.value;
              setSearchQuery(next);
              setSearchMiss(false);
              if (!next) {
                activeHandle?.clearSearch();
              } else {
                const matched = activeHandle?.searchNext(next) ?? false;
                setSearchMiss(!matched);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeSearch();
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (event.shiftKey) {
                  handleSearchPrev();
                } else {
                  handleSearchNext();
                }
              }
            }}
            placeholder={t('输入关键词搜索终端日志...')}
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          {searchMiss && searchQuery.trim() && (
            <span className="shrink-0 text-[11px] text-rose-500">{t('无匹配项')}</span>
          )}
          <button
            type="button"
            onClick={handleSearchPrev}
            title={t('上一个匹配 (Shift + Enter)')}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            onClick={handleSearchNext}
            title={t('下一个匹配 (Enter)')}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ChevronDown size={13} />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            title={t('关闭')}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {activeCommand && activeRuntime?.portConflict && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-200/90 bg-amber-50/95 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200">
          <div className="flex min-w-0 items-center gap-1.5">
            <AlertTriangle size={13} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="truncate">
              {t('检测到端口 {{port}} 被占用，导致命令启动冲突。', { port: activeRuntime.portConflict })}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={isResolvingConflict}
              onClick={() => void handleResolveConflict()}
              className="rounded-md bg-amber-600 px-2.5 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-amber-500 disabled:opacity-60"
            >
              {t('释放端口并重启')}
            </button>
            <button
              type="button"
              onClick={() => clearCommandPortConflict(project.id, activeCommand.id)}
              className="rounded p-0.5 text-amber-700 hover:bg-amber-200/60 dark:text-amber-300 dark:hover:bg-amber-500/20"
              aria-label={t('关闭')}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {mountedCommandIds.map((commandId) => {
          const command = project.commands.find((item) => item.id === commandId);
          if (!command) return null;
          const paneKey = `command:${command.id}`;
          const isVisiblePane = activePaneKey === paneKey;
          return (
            <div
              key={paneKey}
              className={`absolute inset-0 ${isVisiblePane ? 'z-10 visible' : 'invisible pointer-events-none'}`}
              aria-hidden={!isVisiblePane}
            >
              <TerminalWindow
                ref={registerHandle(paneKey)}
                projectId={project.id}
                workingDir={project.path}
                commandId={command.id}
                pid={command.pid}
                active={isOpen && isVisiblePane}
                themeMode={themeMode}
                onRequestSearch={openSearch}
              />
            </div>
          );
        })}

        {mountedShellIds.map((tabId) => {
          const tab = terminalState.tabs.find((item) => item.id === tabId);
          if (!tab) return null;
          const paneKey = `shell:${tab.id}`;
          const isVisiblePane = activePaneKey === paneKey;
          return (
            <div
              key={paneKey}
              className={`absolute inset-0 ${isVisiblePane ? 'z-10 visible' : 'invisible pointer-events-none'}`}
              aria-hidden={!isVisiblePane}
            >
              <TerminalWindow
                ref={registerHandle(paneKey)}
                projectId={project.id}
                workingDir={project.path}
                sessionId={tab.id}
                active={isOpen && isVisiblePane}
                themeMode={themeMode}
                onRequestSearch={openSearch}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
