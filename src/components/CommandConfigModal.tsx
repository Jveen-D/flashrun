import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Command } from '../store';
import { useTranslation } from 'react-i18next';

interface CommandConfigModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialCommand?: Command | null;
  onClose: () => void;
  onSubmit: (values: { label: string; cmd: string; isDefault: boolean }) => void;
}

export function CommandConfigModal({
  open,
  mode,
  initialCommand,
  onClose,
  onSubmit,
}: CommandConfigModalProps) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [cmd, setCmd] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setLabel(initialCommand?.label ?? '');
    setCmd(initialCommand?.cmd ?? '');
    setIsDefault(Boolean(initialCommand?.isDefault));
  }, [initialCommand, open]);

  if (!open) {
    return null;
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextLabel = label.trim();
    const nextCmd = cmd.trim();

    if (!nextLabel || !nextCmd) {
      return;
    }

    onSubmit({
      label: nextLabel,
      cmd: nextCmd,
      isDefault,
    });
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px] dark:bg-black/70">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl dark:border-slate-700/70 dark:bg-slate-900/95">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 bg-slate-50/90 px-5 py-4 dark:border-slate-800/80 dark:bg-slate-950/50">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              {mode === 'create' ? t('新增命令配置') : t('编辑命令配置')}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {t('可配置命令名称、执行语句与默认启动标记。')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-slate-400 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-white"
            title={t('关闭')}
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-white/90 p-5 dark:bg-slate-900/90">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              {t('命令名称')}
            </label>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t('例如：Dev / Build / Lint')}
              className="w-full rounded-xl border border-slate-200/80 bg-white/90 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-[border-color,box-shadow,background-color] focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700/80 dark:bg-slate-950/80 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              {t('执行命令')}
            </label>
            <textarea
              value={cmd}
              onChange={(event) => setCmd(event.target.value)}
              rows={4}
              placeholder={t('例如：pnpm run dev')}
              className="w-full resize-none rounded-xl border border-slate-200/80 bg-white/90 px-3.5 py-2.5 font-mono text-sm leading-6 text-slate-800 outline-none transition-[border-color,box-shadow,background-color] focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700/80 dark:bg-slate-950/80 dark:text-slate-100"
            />
          </div>

          <button
            type="button"
            onClick={() => setIsDefault((value) => !value)}
            className={`w-full rounded-xl border px-4 py-4 text-left transition-[border-color,background-color] ${
              isDefault
                ? 'border-emerald-200/90 bg-emerald-50/70 dark:border-emerald-500/35 dark:bg-emerald-500/10'
                : 'border-slate-200/80 bg-slate-50/80 hover:border-slate-300 hover:bg-white dark:border-slate-700/80 dark:bg-slate-950/50 dark:hover:border-slate-600 dark:hover:bg-slate-950'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('设为默认启动')}</div>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {t('每个项目仅允许一个默认启动命令，保存后会自动替换此前的默认项。')}
                </p>
              </div>
              <div className={`mt-0.5 flex h-6 w-11 items-center rounded-full px-0.5 transition-colors ${isDefault ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}>
                <div className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${isDefault ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </div>
          </button>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200/80 pt-4 dark:border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200/80 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700/80 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t('取消')}
            </button>
            <button
              type="submit"
              disabled={!label.trim() || !cmd.trim()}
              className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mode === 'create' ? t('创建命令') : t('保存修改')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

}
