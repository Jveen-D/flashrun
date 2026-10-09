import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: {} }) }));
vi.mock('../src/components/WindowTitleBar', () => ({ WindowTitleBar: () => 'WINDOW_CONTROLS' }));
vi.mock('../src/components/Sidebar', () => ({ Sidebar: () => 'PROJECT_SIDEBAR' }));
vi.mock('../src/components/TopBar', () => ({ TopBar: () => 'PROJECT_TOOLBAR' }));
vi.mock('../src/components/ActionGrid', () => ({ ActionGrid: () => 'PROJECT_COMMANDS' }));
vi.mock('../src/components/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../src/store', () => ({
  useStore: () => ({
    projects: [{ id: 'project', name: 'Example', commands: [] }],
    activeProjectId: 'project',
    activeCommandByProject: {},
    globalSettings: { theme: 'light', language: 'en' },
    hydrated: true,
    isTerminalOpen: false,
    projectTerminals: {},
  }),
  flushPersistence: vi.fn(),
  retryPersistence: vi.fn(),
}));

describe('main layout', () => {
  it('keeps window controls and the full project workspace when the terminal is hidden', async () => {
    const { default: App } = await import('../src/App');
    const html = renderToStaticMarkup(createElement(App));
    for (const marker of ['WINDOW_CONTROLS', 'PROJECT_SIDEBAR', 'PROJECT_TOOLBAR', 'PROJECT_COMMANDS']) {
      expect(html).toContain(marker);
    }
  });
});
