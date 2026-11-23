import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Trash2, X } from 'lucide-react';
import type { Command } from '../store';
import { useTranslation } from 'react-i18next';

export interface CommandFormValues {
  label: string;
  cmd: string;
  isDefault: boolean;
  cwd?: string;
  envFile?: string;
  env?: Record<string, string>;
}

interface CommandConfigModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialCommand?: Command | null;
  onClose: () => void;
  onSubmit: (values: CommandFormValues) => void;
  onDelete?: () => void;
}

function serializeEnvText(env?: Record<string, string>): string {
  if (!env) return '';
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function parseEnvText(text: string): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (key) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function CommandConfigModal({
  open,
  mode,
  initialCommand,
  onClose,
  onSubmit,
  onDelete,
}: CommandConfigModalProps) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [cmd, setCmd] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [cwd, setCwd] = useState('');
  const [envFile, setEnvFile] = useState('');
  const [envText, setEnvText] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setLabel(initialCommand?.label ?? '');
    setCmd(initialCommand?.cmd ?? '');
    setIsDefault(Boolean(initialCommand?.isDefault));
    setCwd(initialCommand?.cwd ?? '');
    setEnvFile(initialCommand?.envFile ?? '');
    setEnvText(serializeEnvText(initialCommand?.env));
    setShowAdvanced(Boolean(
      initialCommand?.cwd
      || initialCommand?.envFile
      || (initialCommand?.env && Object.keys(initialCommand.env).length > 0),
    ));
  }, [initialCommand, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

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
      cwd: cwd.trim() || undefined,
      envFile: envFile.trim() || undefined,
      env: parseEnvText(envText),
    });
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px] dark:bg-black/70"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl dark:border-slate-700/70 dark:bg-slate-900/95">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200/80 bg-slate-50/90 px-5 py-4 dark:border-slate-800/80 dark:bg-slate-950/50">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              {mode === 'create' ? t('新增命令配置') : t('编辑命令配置')}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {t('可配置命令名称、执行语句、工作目录与环境变量。')}
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

        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto bg-white/90 p-5 dark:bg-slate-900/90">
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
              rows={3}
              placeholder={t('例如：pnpm run dev')}
              className="w-full resize-none rounded-xl border border-slate-200/80 bg-white/90 px-3.5 py-2.5 font-mono text-sm leading-6 text-slate-800 outline-none transition-[border-color,box-shadow,background-color] focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700/80 dark:bg-slate-950/80 dark:text-slate-100"
            />
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/40">
            <button
              type="button"
              onClick={() => setShowAdvanced((value) => !value)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            >
              <span>{t('高级选项（工作目录与环境变量）')}</span>
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {showAdvanced && (
              <div className="space-y-3 border-t border-slate-200/80 px-4 py-3.5 dark:border-slate-800">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {t('子目录 (cwd)')}
                    </label>
                    <input
                      value={cwd}
                      onChange={(event) => setCwd(event.target.value)}
                      placeholder={t('例如：apps/web')}
                      className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 font-mono text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700/80 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {t('.env 文件路径')}
                    </label>
                    <input
                      value={envFile}
                      onChange={(event) => setEnvFile(event.target.value)}
                      placeholder={t('例如：.env.local')}
                      className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 font-mono text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700/80 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {t('自定义环境变量（每行一条 KEY=VALUE）')}
                  </label>
                  <textarea
                    value={envText}
                    onChange={(event) => setEnvText(event.target.value)}
                    rows={3}
                    placeholder={'PORT=3001\nNODE_ENV=development'}
                    className="w-full resize-none rounded-lg border border-slate-200/80 bg-white px-3 py-2 font-mono text-xs leading-5 text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700/80 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsDefault((value) => !value)}
            className={`w-full rounded-xl border px-4 py-3.5 text-left transition-[border-color,background-color] ${
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
              <div className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${isDefault ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}>
                <div className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${isDefault ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </div>
          </button>

          <div className="flex items-center justify-between gap-2 border-t border-slate-200/80 pt-4 dark:border-slate-800/80">
            <div>
              {mode === 'edit' && onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
                >
                  <Trash2 size={14} />
                  <span>{t('删除命令')}</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
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
          </div>
        </form>
      </div>
    </div>
  );
}
