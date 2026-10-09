import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from '@tauri-apps/api/window';
import type { Event, EventCallback } from '@tauri-apps/api/event';
import capabilities from '../src-tauri/capabilities/default.json';
import { guardWindowClose, requestWindowClose } from '../src/utils/windowClose';

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));

function fixture() {
  // Run the installed SDK's real close/onCloseRequested/destroy implementation.
  // Only IPC and event transport are simulated; no native window or process runs.
  const appWindow = Object.create(Window.prototype) as Window;
  Object.defineProperty(appWindow, 'label', { value: 'main' });
  let callback: EventCallback<unknown>;
  const remove = vi.fn();
  vi.spyOn(appWindow, 'listen').mockImplementation(async (_event, handler) => {
    callback = handler as EventCallback<unknown>;
    return remove;
  });
  return {
    appWindow, remove,
    dispatch: () => callback({ event: 'tauri://close-requested', id: 1, payload: null } as Event<unknown>),
  };
}

beforeEach(() => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: ipc.invoke } });
  ipc.invoke.mockReset().mockImplementation(async (command: string) => {
    const permission = `core:window:allow-${command.split('|')[1]}`;
    if (!capabilities.permissions.includes(permission)) throw new Error(`${command} not allowed`);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('window close using the Tauri SDK', () => {
  it('reproduces the old missing-destroy permission even with no sessions', async () => {
    const { appWindow, dispatch } = fixture();
    ipc.invoke.mockImplementation(async (command: string) => {
      if (command === 'plugin:window|destroy') throw new Error('window.destroy not allowed');
    });
    await appWindow.onCloseRequested(() => {});
    await expect(dispatch()).rejects.toThrow('window.destroy not allowed');
  });

  it('waits for saving, then destroys once without recursively requesting close', async () => {
    const { appWindow, dispatch, remove } = fixture();
    let finishSave!: () => void;
    const flush = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    const report = vi.fn();
    const dispose = guardWindowClose(appWindow, flush, report);
    await requestWindowClose(appWindow, report);
    const first = dispatch();
    await dispatch(); // A second click while saving must not start another close.
    expect(flush).toHaveBeenCalledTimes(1);
    expect(ipc.invoke.mock.calls.map(([command]) => command)).toEqual(['plugin:window|close']);
    finishSave();
    await first;
    expect(ipc.invoke.mock.calls.map(([command]) => command)).toEqual(['plugin:window|close', 'plugin:window|destroy']);
    expect(report).not.toHaveBeenCalled();
    dispose();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('keeps the window on save failure and closes after saving succeeds on retry', async () => {
    const { appWindow, dispatch } = fixture();
    const flush = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const report = vi.fn();
    const confirmDiscard = vi.fn(() => false);
    const dispose = guardWindowClose(appWindow, flush, report, confirmDiscard);
    await dispatch();
    expect(ipc.invoke).not.toHaveBeenCalled();
    expect(confirmDiscard).toHaveBeenCalledWith(new Error('disk full'));
    expect(report).not.toHaveBeenCalled();
    await dispatch();
    expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('plugin:window|destroy', { label: 'main' }, undefined);
    dispose();
  });

  it('allows exit after persistent save failure only with explicit discard confirmation', async () => {
    const { appWindow, dispatch } = fixture();
    const flush = vi.fn().mockRejectedValue(new Error('disk full'));
    const confirmDiscard = vi.fn(() => true);
    const dispose = guardWindowClose(appWindow, flush, vi.fn(), confirmDiscard);
    await dispatch();
    expect(confirmDiscard).toHaveBeenCalledExactlyOnceWith(new Error('disk full'));
    expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('plugin:window|destroy', { label: 'main' }, undefined);
    dispose();
  });

  it('reports a destroy failure and permits a later retry', async () => {
    const { appWindow, dispatch } = fixture();
    ipc.invoke.mockRejectedValueOnce(new Error('destroy failed')).mockResolvedValue(undefined);
    const report = vi.fn();
    const dispose = guardWindowClose(appWindow, async () => {}, report);
    await dispatch();
    expect(report).toHaveBeenCalledWith(new Error('destroy failed'));
    await dispatch();
    expect(ipc.invoke).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('does not destroy from a disposed listener after an in-flight save', async () => {
    const { appWindow, dispatch, remove } = fixture();
    let finishSave!: () => void;
    const dispose = guardWindowClose(appWindow, () => new Promise<void>((resolve) => { finishSave = resolve; }), vi.fn());
    const closing = dispatch();
    dispose(); // Also exercises disposal before asynchronous registration resolves.
    finishSave();
    await closing;
    expect(ipc.invoke).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('surfaces close-request and listener-registration errors', async () => {
    const { appWindow } = fixture();
    const report = vi.fn();
    ipc.invoke.mockRejectedValueOnce(new Error('close failed'));
    await requestWindowClose(appWindow, report);
    expect(report).toHaveBeenCalledWith(new Error('close failed'));
    vi.spyOn(appWindow, 'onCloseRequested').mockRejectedValueOnce(new Error('listen failed'));
    const dispose = guardWindowClose(appWindow, async () => {}, report);
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(new Error('listen failed')));
    dispose();
  });
});
