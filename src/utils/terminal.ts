export const TERMINAL_FIT_EVENT = 'flashrun:terminal-fit';
export const TERMINAL_OUTPUT_EVENT = 'terminal-out';
export const COMMAND_STATUS_EVENT = 'command-status';

export interface TerminalOutputPayload {
  projectId: string;
  commandId: string;
  projectName: string;
  commandLabel: string;
  data: string;
}

export interface CommandStatusPayload {
  projectId: string;
  commandId: string;
  projectName: string;
  commandLabel: string;
  pid: number;
  status: 'started' | 'exited';
  exitCode: number | null;
}

const MAX_BUFFERED_OUTPUT_LENGTH = 2_000_000;
const outputBuffers = new Map<string, { chunks: string[]; length: number }>();
const outputSubscribers = new Map<string, Set<(data: string) => void>>();

export function appendTerminalOutput(payload: TerminalOutputPayload) {
  const buffer = outputBuffers.get(payload.projectId) ?? { chunks: [], length: 0 };
  buffer.chunks.push(payload.data);
  buffer.length += payload.data.length;

  while (buffer.length > MAX_BUFFERED_OUTPUT_LENGTH && buffer.chunks.length > 1) {
    const removed = buffer.chunks.shift();
    buffer.length -= removed?.length ?? 0;
  }

  outputBuffers.set(payload.projectId, buffer);
  outputSubscribers.get(payload.projectId)?.forEach((subscriber) => subscriber(payload.data));
}

export function subscribeTerminalOutput(projectId: string, subscriber: (data: string) => void) {
  const subscribers = outputSubscribers.get(projectId) ?? new Set<(data: string) => void>();
  subscribers.add(subscriber);
  outputSubscribers.set(projectId, subscribers);

  outputBuffers.get(projectId)?.chunks.forEach((chunk) => subscriber(chunk));

  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) {
      outputSubscribers.delete(projectId);
    }
  };
}

export function requestTerminalFit() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(TERMINAL_FIT_EVENT));
}
