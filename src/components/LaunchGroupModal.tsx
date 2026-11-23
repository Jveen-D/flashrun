import { useEffect, useState } from 'react';
import { Check, Layers, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore, type LaunchGroup, type LaunchGroupItem } from '../store';

interface LaunchGroupModalProps {
  open: boolean;
  initialGroup?: LaunchGroup | null;
  onClose: () => void;
  onSubmit: (values: { name: string; items: LaunchGroupItem[] }) => void;
  onDelete?: () => void;
}

export function LaunchGroupModal({
  open,
  initialGroup,
  onClose,
  onSubmit,
  onDelete,
}: LaunchGroupModalProps) {
  const { t } = useTranslation();
  const projects = useStore((state) => state.projects);
  const [name, setName] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return undefined;
    setName(initialGroup?.name ?? '');
    setSelectedKeys(new Set(
      (initialGroup?.items ?? []).map((item) => `${item.projectId}::${item.commandId}`),
    ));

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [initialGroup, onClose, open]);

  if (!open) return null;

  const toggleKey = (key: string) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedItems: LaunchGroupItem[] = projects.flatMap((project) => (
    project.commands
      .filter((command) => selectedKeys.has(`${project.id}::${command.id}`))
      .map((command) => ({ projectId: project.id, commandId: command.id }))
  ));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !selectedItems.length) return;
    onSubmit({ name: trimmed, items: selectedItems });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px] dark:bg-black/70"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl dark:border-slate-700/70 dark:bg-slate-900/95">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200/80 bg-slate-50/90 px-5 py-4 dark:border-slate-800/80 dark:bg-slate-950/50">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <Layers size={18} className="text-blue-500" />
              {initialGroup ? t('编辑启动组') : t('新建启动组')}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('组合跨项目多条命令，一键批量启动或停止联调服务。')}
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

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {t('启动组名称')}
              </label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('例如：全栈联调 / 前后端开发环境')}
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {t('选择包含的命令')}
              </div>
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{project.name}</div>
                  {project.commands.length === 0 ? (
                    <div className="text-xs text-slate-400">{t('暂无命令')}</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {project.commands.map((command) => {
                        const key = `${project.id}::${command.id}`;
                        const checked = selectedKeys.has(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => toggleKey(key)}
                            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                              checked
                                ? 'border-blue-500 bg-blue-600 text-white'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                            }`}
                          >
                            {checked && <Check size={11} />}
                            <span>{command.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200/80 bg-slate-50/90 px-5 py-3.5 dark:border-slate-800/80 dark:bg-slate-950/50">
            <div>
              {initialGroup && onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                >
                  <Trash2 size={13} />
                  <span>{t('删除启动组')}</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-200/80 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {t('取消')}
              </button>
              <button
                type="submit"
                disabled={!name.trim() || selectedItems.length === 0}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {initialGroup ? t('保存修改') : t('创建启动组')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
