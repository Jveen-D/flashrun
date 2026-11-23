import { useEffect, useState } from 'react';
import { Boxes, Check, LoaderCircle, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { Project } from '../store';
import { toast } from '../utils/toast';

export interface WorkspacePackage {
  name: string;
  relativePath: string;
  manager: string;
  scripts: Record<string, string>;
}

interface WorkspaceImportModalProps {
  open: boolean;
  project: Project;
  onClose: () => void;
  onImport: (items: Array<{ label: string; cmd: string; cwd: string }>) => void;
}

export function WorkspaceImportModal({ open, project, onClose, onImport }: WorkspaceImportModalProps) {
  const { t } = useTranslation();
  const [packages, setPackages] = useState<WorkspacePackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setSelected({});
    void invoke<WorkspacePackage[]>('detect_workspace_packages', { path: project.path })
      .then((result) => {
        if (!cancelled) {
          setPackages(result);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to detect workspace packages:', error);
          toast.error(t('扫描 Monorepo 子包失败：{{error}}', { error: String(error) }));
          setPackages([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open, project.path, t]);

  if (!open) {
    return null;
  }

  const toggleItem = (key: string) => {
    setSelected((current) => ({ ...current, [key]: !current[key] }));
  };

  const selectedItems = packages.flatMap((pkg) => (
    Object.keys(pkg.scripts)
      .filter((script) => selected[`${pkg.relativePath}::${script}`])
      .map((script) => ({
        label: `${pkg.name}:${script}`,
        cmd: `${pkg.manager} run ${script}`,
        cwd: pkg.relativePath,
      }))
  ));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px] dark:bg-black/70"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl dark:border-slate-700/70 dark:bg-slate-900/95">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200/80 bg-slate-50/90 px-5 py-4 dark:border-slate-800/80 dark:bg-slate-950/50">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <Boxes size={18} className="text-blue-500" />
              {t('Monorepo 子包脚本导入')}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('自动识别 pnpm-workspace.yaml 或 package.json workspaces，导入时自动填充子目录 cwd。')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 dark:hover:bg-slate-900 dark:hover:text-white"
            title={t('关闭')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <LoaderCircle size={16} className="animate-spin" />
              <span>{t('正在扫描子包...')}</span>
            </div>
          ) : packages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {t('未检测到 Monorepo 子包（支持 pnpm-workspace.yaml 与 package.json workspaces）。')}
            </div>
          ) : (
            <div className="space-y-4">
              {packages.map((pkg) => (
                <div
                  key={pkg.relativePath}
                  className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/50"
                >
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{pkg.name}</div>
                    <span className="rounded bg-slate-200/80 px-2 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      {pkg.relativePath}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(pkg.scripts).map(([script, body]) => {
                      const key = `${pkg.relativePath}::${script}`;
                      const checked = Boolean(selected[key]);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleItem(key)}
                          title={body}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors ${
                            checked
                              ? 'border-blue-500 bg-blue-600 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                          }`}
                        >
                          {checked && <Check size={12} />}
                          <span>{script}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-slate-200/80 bg-slate-50/90 px-5 py-3.5 dark:border-slate-800/80 dark:bg-slate-950/50">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('已选择 {{count}} 条命令', { count: selectedItems.length })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200/80 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t('取消')}
            </button>
            <button
              type="button"
              disabled={selectedItems.length === 0}
              onClick={() => {
                onImport(selectedItems);
                onClose();
              }}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('导入所选脚本')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
