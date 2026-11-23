import { describe, expect, it } from 'vitest';
import {
  buildConfigExportBundle,
  parseConfigImportBundle,
  remapProjectPath,
} from '../src/utils/configTransfer';
import { getDefaultTerminalShortcut } from '../src/utils/shortcuts';

describe('config transfer', () => {
  it('remaps project paths across Windows and macOS prefixes', () => {
    expect(
      remapProjectPath('C:\\Code\\flashrun', { fromPrefix: 'C:\\Code', toPrefix: '/Users/dev/Code' }),
    ).toBe('/Users/dev/Code/flashrun');

    expect(
      remapProjectPath('/Users/dev/Code/app', { fromPrefix: '/Users/dev/Code', toPrefix: 'D:\\Projects' }),
    ).toBe('D:\\Projects\\app');

    expect(
      remapProjectPath('C:\\Other\\repo', { fromPrefix: 'C:\\Code', toPrefix: '/Users/dev/Code' }),
    ).toBe('C:\\Other\\repo');
  });

  it('builds and parses sanitized export bundles without runtime PIDs', () => {
    const bundle = buildConfigExportBundle({
      projects: [{
        id: 'p1',
        name: 'Web',
        path: 'C:\\Code\\web',
        manager: 'pnpm',
        commands: [{ id: 'c1', label: 'dev', cmd: 'pnpm run dev', status: 'running', pid: 99, isDefault: true }],
      }],
      launchGroups: [{ id: 'g1', name: 'Dev', items: [{ projectId: 'p1', commandId: 'c1' }] }],
      settings: {
        defaultEditor: 'code',
        defaultShell: 'auto',
        theme: 'dark',
        language: 'zh',
        terminalToggleShortcut: getDefaultTerminalShortcut(),
        minimizeToTrayOnClose: false,
        globalWindowShortcut: null,
      },
      includeSettings: true,
    });

    const parsed = parseConfigImportBundle(JSON.stringify(bundle));
    expect(parsed.projects[0].commands[0].status).toBe('idle');
    expect(parsed.projects[0].commands[0].pid).toBeNull();
    expect(parsed.launchGroups).toHaveLength(1);
    expect(parsed.settings?.theme).toBe('dark');
  });
});
