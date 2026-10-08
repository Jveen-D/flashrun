import { invoke } from '@tauri-apps/api/core';

const pendingInput = new Map<number, Promise<void>>();

// Preserve keystroke/paste order even when IPC writes run on different threads.
export function sendSessionInput(pid: number, data: string): Promise<void> {
  const pending = (pendingInput.get(pid) ?? Promise.resolve()).catch(() => {}).then(() => invoke<void>('send_input', { pid, data }));
  pendingInput.set(pid, pending);
  return pending.finally(() => { if (pendingInput.get(pid) === pending) pendingInput.delete(pid); });
}
