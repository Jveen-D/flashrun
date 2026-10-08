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
