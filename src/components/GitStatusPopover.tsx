import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  ChevronDown,
  CloudDownload,
  Copy,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { toast } from '../utils/toast';

export interface GitChangedFile {
  status: string;
  path: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  dirty: boolean;
  changedCount: number;
  ahead: number;
  behind: number;
  lastCommit: string | null;
  changedFiles: GitChangedFile[];
  localBranches: string[];
}

interface GitStatusPopoverProps {
  projectPath: string;
}

function statusBadgeStyle(status: string): string {
  if (status.includes('?')) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
  }
  if (status.includes('D')) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
  }
  if (status.includes('A')) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
  }
  if (status.includes('R')) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
  }
  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
}

export const GitStatusPopover: React.FC<GitStatusPopoverProps> = ({ projectPath }) => {
  const { t } = useTranslation();
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [runningAction, setRunningAction] = useState<'fetch' | 'pull' | 'checkout' | null>(null);
  const [branchFilter, setBranchFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const loadGitStatus = useCallback(async (showFeedback = false) => {
    setIsRefreshing(true);
    try {
      const status = await invoke<GitStatus>('get_git_status', { path: projectPath });
      setGitStatus(status);
      if (showFeedback) {
        toast.info(t('Git 状态已刷新。'));
      }
    } catch (error) {
      setGitStatus(null);
      if (showFeedback) {
        toast.error(t('刷新 Git 状态失败：{{error}}', { error: String(error) }));
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [projectPath, t]);

  useEffect(() => {
    setIsOpen(false);
    setBranchFilter('');
    let cancelled = false;
    const sync = () => {
      void invoke<GitStatus>('get_git_status', { path: projectPath })
        .then((status) => {
          if (!cancelled) setGitStatus(status);
        })
        .catch(() => {
          if (!cancelled) setGitStatus(null);
        });
    };
    sync();
    window.addEventListener('focus', sync);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', sync);
    };
  }, [projectPath]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const filteredBranches = useMemo(() => {
    const branches = gitStatus?.localBranches ?? [];
    const keyword = branchFilter.trim().toLowerCase();
    if (!keyword) return branches;
    return branches.filter((branch) => branch.toLowerCase().includes(keyword));
  }, [branchFilter, gitStatus?.localBranches]);

  if (!gitStatus?.isRepo || !gitStatus.branch) {
    return null;
  }

  const handleCopyBranch = async () => {
    if (!gitStatus.branch) return;
    try {
      await navigator.clipboard.writeText(gitStatus.branch);
      toast.success(t('已复制分支名：{{branch}}', { branch: gitStatus.branch }));
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleSync = async (action: 'fetch' | 'pull') => {
    if (runningAction) return;
    setRunningAction(action);
    try {
      const output = await invoke<string>('git_sync_action', { path: projectPath, action });
      await loadGitStatus(false);
      toast.success(
        action === 'fetch'
          ? t('git fetch 已完成。')
          : output
            ? t('git pull 已完成：{{detail}}', { detail: output.split(/\r?\n/)[0] })
            : t('git pull 已完成。'),
      );
    } catch (error) {
      toast.error(t('git {{action}} 失败：{{error}}', { action, error: String(error) }));
    } finally {
      setRunningAction(null);
    }
  };

  const handleCheckout = async (branch: string) => {
    if (runningAction || branch === gitStatus.branch) return;
    setRunningAction('checkout');
    try {
      await invoke<string>('git_checkout_branch', { path: projectPath, branch });
      await loadGitStatus(false);
      toast.success(t('已切换到分支 {{branch}}。', { branch }));
    } catch (error) {
      toast.error(t('切换分支失败：{{error}}', { error: String(error) }));
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          const next = !isOpen;
          setIsOpen(next);
          if (next) {
            void loadGitStatus(false);
          }
        }}
        className={`flex max-w-44 items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium transition-colors ${
          gitStatus.dirty
            ? 'border-amber-300/90 bg-amber-50/90 text-amber-700 hover:bg-amber-100 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-300'
            : 'border-slate-300/75 bg-white/80 text-slate-600 hover:border-blue-300 hover:bg-white dark:border-slate-700/75 dark:bg-slate-800/75 dark:text-slate-300 dark:hover:border-blue-500/50'
        }`}
        title={t('查看 Git 状态、切换分支或拉取更新')}
      >
        <GitBranch size={10} className="shrink-0" />
        <span className="truncate">{gitStatus.branch}</span>
        {gitStatus.ahead > 0 && (
          <span className="inline-flex shrink-0 items-center text-[9px] text-blue-600 dark:text-blue-400">
            ↑{gitStatus.ahead}
          </span>
        )}
        {gitStatus.behind > 0 && (
          <span className="inline-flex shrink-0 items-center text-[9px] text-rose-600 dark:text-rose-400">
            ↓{gitStatus.behind}
          </span>
        )}
        {gitStatus.dirty && <span className="shrink-0 font-bold">*{gitStatus.changedCount}</span>}
        <ChevronDown size={10} className={`shrink-0 opacity-70 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 shadow-2xl backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/95">
          {/* Header */}
          <div className="border-b border-slate-200/80 bg-slate-50/90 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <GitBranch size={13} className="shrink-0 text-blue-500" />
                <span className="truncate font-mono text-xs font-semibold text-slate-800 dark:text-slate-100">
                  {gitStatus.branch}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleCopyBranch()}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                  title={t('复制分支名')}
                >
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  disabled={isRefreshing}
                  onClick={() => void loadGitStatus(true)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                  title={t('刷新 Git 状态')}
                >
                  <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
              <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                {gitStatus.ahead > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                    <ArrowUp size={10} />
                    {t('领先远程 {{count}} 个提交', { count: gitStatus.ahead })}
                  </span>
                )}
                {gitStatus.behind > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                    <ArrowDown size={10} />
                    {t('落后远程 {{count}} 个提交', { count: gitStatus.behind })}
                  </span>
                )}
              </div>
            )}

            {gitStatus.lastCommit && (
              <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <GitCommitHorizontal size={12} className="mt-0.5 shrink-0 opacity-75" />
                <span className="line-clamp-2 break-words leading-4">{gitStatus.lastCommit}</span>
              </div>
            )}
          </div>

          {/* Quick Sync Actions */}
          <div className="grid grid-cols-2 gap-2 border-b border-slate-200/80 p-2.5 dark:border-slate-800">
            <button
              type="button"
              disabled={runningAction !== null}
              onClick={() => void handleSync('fetch')}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:border-blue-500/50 dark:hover:text-blue-400"
            >
              {runningAction === 'fetch' ? <LoaderCircle size={12} className="animate-spin" /> : <CloudDownload size={12} />}
              <span>Git Fetch</span>
            </button>
            <button
              type="button"
              disabled={runningAction !== null}
              onClick={() => void handleSync('pull')}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-blue-500 bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60"
            >
              {runningAction === 'pull' ? <LoaderCircle size={12} className="animate-spin" /> : <ArrowDownToLine size={12} />}
              <span>Git Pull</span>
            </button>
          </div>

          {/* Local Branches */}
          {gitStatus.localBranches.length > 0 && (
            <div className="border-b border-slate-200/80 p-2.5 dark:border-slate-800">
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                <span>{t('切换本地分支')}</span>
                <span>{gitStatus.localBranches.length}</span>
              </div>
              {gitStatus.localBranches.length > 5 && (
                <input
                  value={branchFilter}
                  onChange={(event) => setBranchFilter(event.target.value)}
                  placeholder={t('筛选分支...')}
                  className="mb-1.5 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                />
              )}
              <div className="max-h-32 space-y-0.5 overflow-y-auto no-scrollbar">
                {filteredBranches.map((branch) => {
                  const isCurrent = branch === gitStatus.branch;
                  return (
                    <button
                      key={branch}
                      type="button"
                      disabled={runningAction !== null || isCurrent}
                      onClick={() => void handleCheckout(branch)}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left font-mono text-xs transition-colors ${
                        isCurrent
                          ? 'bg-blue-50 font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                      }`}
                    >
                      <span className="truncate">{branch}</span>
                      {isCurrent && <Check size={12} className="ml-2 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Working Tree Changes */}
          <div className="p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              <span className="flex items-center gap-1">
                <FileDiff size={11} />
                {t('工作区变更')}
              </span>
              <span>{gitStatus.changedCount}</span>
            </div>
            {gitStatus.changedCount === 0 ? (
              <div className="rounded-lg bg-emerald-50/80 px-2.5 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                {t('工作区干净，无未提交改动。')}
              </div>
            ) : (
              <div className="max-h-36 space-y-1 overflow-y-auto no-scrollbar">
                {gitStatus.changedFiles.map((file, index) => (
                  <div
                    key={`${file.status}-${file.path}-${index}`}
                    className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[11px] hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
                  >
                    <span className={`w-6 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[9px] font-bold ${statusBadgeStyle(file.status)}`}>
                      {file.status}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-slate-600 dark:text-slate-300" title={file.path}>
                      {file.path}
                    </span>
                  </div>
                ))}
                {gitStatus.changedCount > gitStatus.changedFiles.length && (
                  <div className="px-1.5 pt-1 text-[10px] text-slate-400">
                    {t('仅显示前 {{shown}} 项，共 {{total}} 处改动', {
                      shown: gitStatus.changedFiles.length,
                      total: gitStatus.changedCount,
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
