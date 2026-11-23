import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
beforeEach(() => { vi.resetModules(); mocks.invoke.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('configuration protection', () => {
  it('drops retired display preferences while preserving projects and terminal tabs', async () => {
    mocks.invoke.mockResolvedValue({
      projects: [{ id: 'project', name: 'Example', path: '/example', manager: 'npm', commands: [] }],
      activeProjectId: 'project',
      settings: { theme: 'light', language: 'en', defaultEditor: 'code', compactMode: true, compactModeAutoHide: true, compactPeekHeight: 4, compactTriggerBandDebug: true },
      uiPreferences: { isTerminalOpen: false, isSidebarExpanded: true, sidebarWidth: 220, terminalHeight: 240, projectTerminals: { project: { tabs: [{ id: 'shell', title: 'Terminal 1' }], activeTabId: 'shell' } } },
    });
    const { useStore, flushPersistence } = await import('../src/store');
    await useStore.getState().hydrate();
    const state = useStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.globalSettings).toEqual({ defaultEditor: 'code', theme: 'light', language: 'en', terminalToggleShortcut: expect.any(Object) });
    expect(state.activeProjectId).toBe('project');
    expect(state.projectTerminals.project.activeTabId).toBe('shell');
    state.setTerminalOpen(true);
    await flushPersistence();
    expect(mocks.invoke).toHaveBeenLastCalledWith('save_app_config', {
      config: expect.objectContaining({
        settings: state.globalSettings,
        uiPreferences: expect.objectContaining({ isTerminalOpen: true, sidebarWidth: 220, projectTerminals: state.projectTerminals }),
      }),
    });
  });
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
  it('supports project rename, per-project editor override, and incremental script sync', async () => {
    mocks.invoke.mockResolvedValue(null);
    const { useStore, flushPersistence } = await import('../src/store');
    await useStore.getState().hydrate();
    const { projectId } = useStore.getState().addProject('/workspace/demo', 'pnpm', { dev: 'vite' });

    useStore.getState().updateProject(projectId, { name: 'Demo App', defaultEditor: 'cursor' });
    let project = useStore.getState().projects.find((item) => item.id === projectId)!;
    expect(project.name).toBe('Demo App');
    expect(project.defaultEditor).toBe('cursor');

    useStore.getState().updateProject(projectId, { defaultEditor: null });
    project = useStore.getState().projects.find((item) => item.id === projectId)!;
    expect(project.defaultEditor).toBeUndefined();

    // Edit existing command, then sync scripts: existing command must be preserved while new scripts are added.
    useStore.getState().updateCommand(projectId, project.commands[0].id, { cmd: 'pnpm run dev --host' });
    const syncResult = useStore.getState().syncProjectCommands(projectId, 'pnpm', { dev: 'vite', build: 'vite build' });
    expect(syncResult.added).toBe(1);
    project = useStore.getState().projects.find((item) => item.id === projectId)!;
    expect(project.commands.map((c) => [c.label, c.cmd])).toEqual([
      ['dev', 'pnpm run dev --host'],
      ['build', 'pnpm run build'],
    ]);

    const { projectId: cargoProjectId } = useStore.getState().addProject('/workspace/rust-app', 'cargo', {}, [
      { label: 'run', cmd: 'cargo run' },
      { label: 'test', cmd: 'cargo test' },
    ]);
    const cargoProject = useStore.getState().projects.find((item) => item.id === cargoProjectId)!;
    expect(cargoProject.manager).toBe('cargo');
    expect(cargoProject.commands[0].isDefault).toBe(true);
    expect(cargoProject.commands.map((c) => c.cmd)).toEqual(['cargo run', 'cargo test']);
    await flushPersistence();
  });
});
