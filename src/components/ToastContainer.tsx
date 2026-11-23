import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToastStore, type ToastVariant } from '../utils/toast';

const VARIANT_STYLES: Record<ToastVariant, string> = {
  info: 'border-slate-200/90 bg-white/95 text-slate-700 dark:border-slate-700/80 dark:bg-slate-900/95 dark:text-slate-200',
  success: 'border-emerald-200/90 bg-emerald-50/95 text-emerald-800 dark:border-emerald-500/35 dark:bg-slate-900/95 dark:text-emerald-300',
  warning: 'border-amber-200/90 bg-amber-50/95 text-amber-800 dark:border-amber-500/35 dark:bg-slate-900/95 dark:text-amber-300',
  error: 'border-rose-200/90 bg-rose-50/95 text-rose-800 dark:border-rose-500/35 dark:bg-slate-900/95 dark:text-rose-300',
};

const VARIANT_ICONS: Record<ToastVariant, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

export function ToastContainer() {
  const { t } = useTranslation();
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (!toasts.length) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((item) => {
        const Icon = VARIANT_ICONS[item.variant];
        return (
          <div
            key={item.id}
            role={item.variant === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg backdrop-blur transition-all ${VARIANT_STYLES[item.variant]}`}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-5">
              {item.message}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              aria-label={t('关闭')}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
