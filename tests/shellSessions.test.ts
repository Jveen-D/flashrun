import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));

beforeEach(() => { vi.resetModules(); mocks.invoke.mockReset(); mocks.listen.mockReset(); mocks.listen.mockImplementation(() => Promise.resolve(vi.fn())); });

describe('tab-owned PTY sessions', () => {
  it('reuses a session across layout changes / StrictMode remounts', async () => {
    mocks.invoke.mockResolvedValue(42);
    const { ensureShellSession, reconcileShellSessions } = await import('../src/utils/shellSessions');
    const first = ensureShellSession('tab', '/tmp', 24, 80);
    await first.ready;
    const second = ensureShellSession('tab', '/tmp', 24, 80);
    await reconcileShellSessions(new Set(['tab']));
    expect(first).toBe(second);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.listen).toHaveBeenCalledTimes(2);
    expect(mocks.listen.mock.invocationCallOrder[1]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[0]);
  });
  it('closes a session that finishes spawning after its tab was removed', async () => {
    let created!: (pid: number) => void;
    mocks.invoke.mockImplementation((command) => command === 'create_shell_session' ? new Promise<number>((resolve) => { created = resolve; }) : Promise.resolve());
    const { ensureShellSession, closeShellSession } = await import('../src/utils/shellSessions');
    const session = ensureShellSession('late', '/tmp', 24, 80);
    await vi.waitFor(() => expect(created).toBeTypeOf('function'));
    const close = closeShellSession('late');
    created(99);
    await close;
    expect(session.closed).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith('kill_command', { pid: 99 });
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'kill_command')).toHaveLength(1);
    for (const result of mocks.listen.mock.results) expect(await result.value).toHaveBeenCalledTimes(1);
  });
  it('never spawns a tab removed while its listener registration is pending', async () => {
    let finish!: (unlisten: () => void) => void;
    mocks.listen.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { ensureShellSession, closeShellSession } = await import('../src/utils/shellSessions');
    ensureShellSession('cancelled', '/tmp', 24, 80);
    const close = closeShellSession('cancelled');
    const unlisten = vi.fn(); finish(unlisten);
    await close;
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledOnce();
  });
  it('does not restore a dead PID when exit arrives before spawn response', async () => {
    let created!: (pid: number) => void;
    mocks.invoke.mockImplementation(() => new Promise<number>((resolve) => { created = resolve; }));
    const { ensureShellSession } = await import('../src/utils/shellSessions');
    const session = ensureShellSession('fast', '/tmp', 24, 80);
    await vi.waitFor(() => expect(created).toBeTypeOf('function'));
    mocks.listen.mock.calls[1][1]({ payload: 8 });
    created(8); await session.ready;
    expect(session.pid).toBeNull();
    expect(session.exited).toBe(true);
  });
});
