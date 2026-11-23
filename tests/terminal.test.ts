import { describe, expect, it } from 'vitest';
import {
  OutputBuffer,
  appendTerminalOutput,
  clearCommandOutput,
  getCommandOutput,
  getLastTerminalSize,
  pruneCommandOutput,
  setLastTerminalSize,
} from '../src/utils/terminal';

describe('bounded terminal output', () => {
  it('bounds both tiny chunks and oversized writes, in chronological order', () => {
    const buffer = new OutputBuffer(10, 3);
    for (const data of ['a', 'b', 'c', 'd']) buffer.append(data);
    expect(buffer.snapshot()).toBe('bcd');
    buffer.append('0123456789012345');
    expect(buffer.snapshot()).toBe('6789012345');
    buffer.append('xy');
    expect(buffer.snapshot()).toBe('xy');
  });
  it('replays retained output when returning to a hidden view, without retaining its listener', () => {
    const buffer = new OutputBuffer();
    const first: string[] = [];
    const detach = buffer.subscribe((data) => first.push(data));
    buffer.append('before'); detach(); buffer.append('hidden');
    expect(first).toEqual(['', 'before']);
    const second: string[] = [];
    buffer.subscribe((data) => second.push(data));
    expect(second).toEqual(['beforehidden']);
  });
  it('separates commands in the same project and releases removed output', () => {
    const payload = { projectId: 'project', projectName: 'name', commandLabel: 'label' };
    appendTerminalOutput({ ...payload, commandId: 'a', data: 'AAA' });
    appendTerminalOutput({ ...payload, commandId: 'b', data: 'BBB' });
    expect(getCommandOutput('project', 'a').snapshot()).toBe('AAA');
    expect(getCommandOutput('project', 'b').snapshot()).toBe('BBB');
    pruneCommandOutput(new Set());
    expect(getCommandOutput('project', 'a').snapshot()).toBe('');
  });
  it('tracks valid terminal size and clears command output on demand', () => {
    setLastTerminalSize(40, 132);
    expect(getLastTerminalSize()).toEqual({ rows: 40, cols: 132 });
    setLastTerminalSize(0, 9999);
    expect(getLastTerminalSize()).toEqual({ rows: 40, cols: 132 });
    appendTerminalOutput({ projectId: 'p', commandId: 'c', projectName: 'n', commandLabel: 'l', data: 'hello' });
    clearCommandOutput('p', 'c');
    expect(getCommandOutput('p', 'c').snapshot()).toBe('');
  });
});
