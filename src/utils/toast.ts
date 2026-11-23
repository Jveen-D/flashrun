import { create } from 'zustand';
import { nanoid } from 'nanoid';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (variant: ToastVariant, message: string, durationMs?: number) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (variant, message, durationMs) => {
    const id = nanoid();
    const timeout = durationMs ?? (variant === 'error' || variant === 'warning' ? 5000 : 3200);

    set((state) => ({
      toasts: [...state.toasts.slice(-4), { id, variant, message }],
    }));

    if (timeout > 0) {
      const handle = setTimeout(() => {
        timers.delete(id);
        set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
      }, timeout);
      timers.set(id, handle);
    }

    return id;
  },
  dismiss: (id) => {
    const handle = timers.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
  },
  clear: () => {
    for (const handle of timers.values()) {
      clearTimeout(handle);
    }
    timers.clear();
    set({ toasts: [] });
  },
}));

export const toast = {
  info: (message: string, durationMs?: number) => useToastStore.getState().push('info', message, durationMs),
  success: (message: string, durationMs?: number) => useToastStore.getState().push('success', message, durationMs),
  warning: (message: string, durationMs?: number) => useToastStore.getState().push('warning', message, durationMs),
  error: (message: string, durationMs?: number) => useToastStore.getState().push('error', message, durationMs),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};
