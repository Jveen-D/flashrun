import { expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
import { sendSessionInput } from '../src/utils/sessionInput';

it('forwards raw controls and blank lines in order, without line buffering or echo', async () => {
  let finish!: () => void;
  invoke.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
  const first = sendSessionInput(1, '\x1b[A');
  const second = sendSessionInput(1, '\r');
  const third = sendSessionInput(1, '\x03');
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(invoke).toHaveBeenCalledWith('send_input', { pid: 1, data: '\x1b[A' });
  finish(); await Promise.all([first, second, third]);
  expect(invoke.mock.calls.map(([, args]) => args.data)).toEqual(['\x1b[A', '\r', '\x03']);
});
