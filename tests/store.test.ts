import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
beforeEach(() => { vi.resetModules(); mocks.invoke.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('configuration protection', () => {
  it('blocks autosave after failed hydration and permits a successful retry', async () => {
    mocks.invoke.mockRejectedValue(new Error('invalid JSON'));
    const { useStore } = await import('../src/store');
    await useStore.getState().hydrate();
    expect(useStore.getState().hydrated).toBe(false);
    expect(useStore.getState().hydrationError).toContain('invalid JSON');
    useStore.getState().updateGlobalSettings({ theme: 'light' });
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'save_app_config')).toHaveLength(0);
    mocks.invoke.mockResolvedValue(null);
    await useStore.getState().hydrate();
    expect(useStore.getState().hydrated).toBe(true);
    expect(useStore.getState().hydrationError).toBeNull();
  });
  it('surfaces write failures, prevents a successful flush, and retries the latest state', async () => {
    mocks.invoke.mockImplementation((command) => command === 'load_app_config' ? Promise.resolve(null) : Promise.reject(new Error('disk full')));
    const { useStore, flushPersistence, retryPersistence } = await import('../src/store');
    await useStore.getState().hydrate();
    useStore.getState().updateGlobalSettings({ theme: 'light' });
    await expect(flushPersistence()).rejects.toThrow();
    expect(useStore.getState().persistenceError).toContain('disk full');
    mocks.invoke.mockResolvedValue('config.json');
    await retryPersistence();
    expect(useStore.getState().persistenceError).toBeNull();
    expect(mocks.invoke).toHaveBeenLastCalledWith('save_app_config', expect.objectContaining({ config: expect.objectContaining({ settings: expect.objectContaining({ theme: 'light' }) }) }));
  });
  it('closing the last tab removes its identity instead of hiding a live session', async () => {
    mocks.invoke.mockResolvedValue(null);
    const { useStore, flushPersistence } = await import('../src/store');
    await useStore.getState().hydrate();
    const { projectId } = useStore.getState().addProject('/example', 'npm', { dev: 'dev' });
    const previous = useStore.getState().projectTerminals[projectId].tabs[0].id;
    useStore.getState().closeTerminalTab(projectId, previous);
    const tabs = useStore.getState().projectTerminals[projectId].tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).not.toBe(previous);
    await flushPersistence();
  });
});
