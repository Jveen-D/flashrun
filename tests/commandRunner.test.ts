import { beforeEach, expect, it, vi } from 'vitest';
import type { Command } from '../src/store';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), state: {} as Record<string, unknown> }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('react', () => ({ useCallback: (fn: unknown) => fn }));
vi.mock('../src/store', () => ({ useStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state), { getState: () => mocks.state }) }));

beforeEach(() => {
  vi.resetModules(); mocks.invoke.mockReset();
  const command: Command = { id: 'command', cmd: 'test', label: 'test', status: 'idle', pid: null, isDefault: true };
  mocks.state = {
    projects: [{ id: 'project', name: 'project', path: '/test', commands: [command] }],
    updateCommand: (_project: string, _command: string, updates: Partial<Command>) => Object.assign(command, updates),
    setActiveProject: vi.fn(), setTerminalOpen: vi.fn(), setProjectActiveCommand: vi.fn(), syncProjectActiveCommand: vi.fn(),
  };
});

it('stop waits for the actual spawn result, rather than dropping a late PID after a timeout', async () => {
  let finish!: (pid: number) => void;
  mocks.invoke.mockImplementation((name) => name === 'run_command' ? new Promise<number>((resolve) => { finish = resolve; }) : Promise.resolve());
  const { useCommandRunner } = await import('../src/hooks/useCommandRunner');
  const runner = useCommandRunner();
  const start = runner.runCommand('project', 'command');
  const stop = runner.stopCommand('project', 'command');
  await Promise.resolve();
  expect(mocks.invoke.mock.calls.filter(([name]) => name === 'kill_command')).toHaveLength(0);
  finish(123);
  await Promise.all([start, stop]);
  expect(mocks.invoke).toHaveBeenCalledWith('kill_command', { pid: 123 });
});

it('deduplicates overlapping stop requests', async () => {
  mocks.invoke.mockResolvedValue(12);
  const { useCommandRunner } = await import('../src/hooks/useCommandRunner');
  const runner = useCommandRunner();
  await runner.runCommand('project', 'command');
  mocks.invoke.mockClear();
  await Promise.all([runner.stopCommand('project', 'command'), runner.stopCommand('project', 'command')]);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});

it('stops all running commands in a project before removal', async () => {
  const first: Command = { id: 'c1', cmd: 'dev', label: 'dev', status: 'running', pid: 101, isDefault: true };
  const second: Command = { id: 'c2', cmd: 'lint', label: 'lint', status: 'idle', pid: null, isDefault: false };
  const third: Command = { id: 'c3', cmd: 'watch', label: 'watch', status: 'running', pid: 202, isDefault: false };
  mocks.state.projects = [{ id: 'project', name: 'project', path: '/test', commands: [first, second, third] }];
  mocks.state.updateCommand = (_project: string, commandId: string, updates: Partial<Command>) => {
    const target = [first, second, third].find((item) => item.id === commandId);
    if (target) Object.assign(target, updates);
  };
  mocks.invoke.mockResolvedValue(undefined);

  const { useCommandRunner } = await import('../src/hooks/useCommandRunner');
  const runner = useCommandRunner();
  await runner.stopProjectCommands('project');

  expect(mocks.invoke).toHaveBeenCalledWith('kill_command', { pid: 101 });
  expect(mocks.invoke).toHaveBeenCalledWith('kill_command', { pid: 202 });
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
});
