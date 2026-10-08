import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { OutputBuffer } from './terminal';

type ShellSession = {
  id: string; pid: number | null; closed: boolean; exited: boolean;
  output: OutputBuffer; ready: Promise<void>; unlisten: UnlistenFn[];
};
// Sessions belong to persisted tabs, not React views or layout/StrictMode mounts.
const sessions = new Map<string, ShellSession>();
export function ensureShellSession(id: string, workingDir: string, rows: number, cols: number) {
  const existing = sessions.get(id);
  if (existing) return existing;
  const session: ShellSession = { id, pid: null, closed: false, exited: false, output: new OutputBuffer(), ready: Promise.resolve(), unlisten: [] };
  sessions.set(id, session);
  session.ready = (async () => {
    try {
      session.unlisten.push(await listen<string>(`shell-out-${id}`, ({ payload }) => {
        if (!session.closed) session.output.append(payload);
      }));
      session.unlisten.push(await listen<number>(`shell-exit-${id}`, () => {
        session.exited = true;
        session.pid = null;
        session.output.append('\r\n[FlashRun] Shell exited. Open a new terminal to continue.\r\n');
      }));
      if (session.closed) return;
      const pid = await invoke<number>('create_shell_session', { sessionId: id, workingDir, rows, cols });
      if (!session.exited) session.pid = pid;
    } catch (error) {
      if (!session.closed) session.output.append(`\r\n[FlashRun] ${String(error)}\r\n`);
    }
  })();
  return session;
}
export async function closeShellSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  session.closed = true;
  await session.ready;
  try {
    if (session.pid !== null) await invoke('kill_command', { pid: session.pid });
  } catch (error) {
    session.closed = false;
    throw error;
  }
  sessions.delete(id);
  session.unlisten.splice(0).forEach((unlisten) => unlisten());
  session.output.clear();
}
export function reconcileShellSessions(validIds: Set<string>) {
  return Promise.all([...sessions.keys()].filter((id) => !validIds.has(id)).map(closeShellSession));
}
