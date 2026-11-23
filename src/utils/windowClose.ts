import type { Window } from '@tauri-apps/api/window';

const reportCloseError = (error: unknown) => window.alert(String(error));
const confirmUnsavedExit = (error: unknown) => window.confirm(
  `配置尚未保存：${String(error)}\n\n是否仍要退出并放弃本次未保存的更改？取消后可重试保存。`,
);

export interface GuardWindowCloseOptions {
  shouldMinimizeToTray?: () => boolean;
  hideWindow?: () => Promise<void>;
}

export async function requestWindowClose(
  appWindow: Pick<Window, 'close'>,
  reportError: (error: unknown) => void = reportCloseError,
) {
  try {
    await appWindow.close();
  } catch (error) {
    reportError(error);
  }
}

export async function forceCloseWindow(
  appWindow: Pick<Window, 'destroy'>,
  flush: () => Promise<void>,
  reportError: (error: unknown) => void = reportCloseError,
  confirmDiscard: (error: unknown) => boolean | Promise<boolean> = confirmUnsavedExit,
) {
  try {
    try {
      await flush();
    } catch (error) {
      if (!await confirmDiscard(error)) return;
    }
    await appWindow.destroy();
  } catch (error) {
    reportError(error);
  }
}

export function guardWindowClose(
  appWindow: Pick<Window, 'onCloseRequested' | 'destroy'>,
  flush: () => Promise<void>,
  reportError: (error: unknown) => void = reportCloseError,
  confirmDiscard: (error: unknown) => boolean | Promise<boolean> = confirmUnsavedExit,
  options?: GuardWindowCloseOptions,
) {
  let disposed = false;
  let pending = false;
  let unlisten: (() => void) | undefined;
  const subscription = appWindow.onCloseRequested(async (event) => {
    // Own the final destroy so failures are caught here, not in the SDK's
    // automatic destroy after the callback. Never recursively request close.
    event.preventDefault();
    if (disposed || pending) return;
    pending = true;
    try {
      if (options?.shouldMinimizeToTray?.() && options.hideWindow) {
        try {
          await flush();
        } catch {
          // Persistence errors remain surfaced in the UI banner; still allow hiding.
        }
        if (!disposed) {
          await options.hideWindow();
        }
        return;
      }

      try {
        await flush();
      } catch (error) {
        // A permanent disk error must not trap the user in the application.
        // Keep all data unless the user explicitly chooses to exit unsaved.
        if (disposed || !await confirmDiscard(error)) return;
      }
      if (!disposed) await appWindow.destroy();
    } catch (error) {
      if (!disposed) reportError(error);
    } finally {
      pending = false;
    }
  });
  void subscription.then((removeListener) => {
    if (disposed) removeListener();
    else unlisten = removeListener;
  }).catch((error) => { if (!disposed) reportError(error); });
  return () => {
    disposed = true;
    unlisten?.();
  };
}
