export const TERMINAL_FIT_EVENT = 'flashrun:terminal-fit';
export const TERMINAL_OUTPUT_EVENT = 'terminal-out';
export const COMMAND_STATUS_EVENT = 'command-status';

export interface TerminalOutputPayload {
  projectId: string; commandId: string; projectName: string; commandLabel: string; data: string;
}
export interface CommandStatusPayload {
  projectId: string; commandId: string; projectName: string; commandLabel: string;
  /** Opaque backend session handle, not an OS PID. */
  pid: number; status: 'started' | 'exited'; exitCode: number | null;
}

// Bound both characters and chunks; small writes must not allocate millions of objects.
export class OutputBuffer {
  private chunks: string[];
  private head = 0;
  private count = 0;
  private length = 0;
  private subscribers = new Set<(data: string) => void>();
  constructor(private maxLength = 1_000_000, private maxChunks = 1024) {
    if (maxLength < 1 || maxChunks < 1) throw new Error('Invalid buffer capacity');
    this.chunks = new Array(maxChunks);
  }
  append(data: string) {
    if (!data) return;
    const retained = data.slice(-this.maxLength);
    while (this.count && (this.count === this.maxChunks || this.length + retained.length > this.maxLength)) {
      this.length -= this.chunks[this.head].length;
      this.chunks[this.head] = '';
      this.head = (this.head + 1) % this.maxChunks;
      this.count--;
    }
    this.chunks[(this.head + this.count) % this.maxChunks] = retained;
    this.count++;
    this.length += retained.length;
    this.subscribers.forEach((subscriber) => subscriber(data));
  }
  snapshot() {
    return Array.from({ length: this.count }, (_, i) => this.chunks[(this.head + i) % this.maxChunks]).join('');
  }
  subscribe(subscriber: (data: string) => void) {
    this.subscribers.add(subscriber);
    subscriber(this.snapshot());
    return () => { this.subscribers.delete(subscriber); };
  }
  clear() { this.chunks.fill(''); this.head = 0; this.count = 0; this.length = 0; }
}
const commandBuffers = new Map<string, OutputBuffer>();
export const commandOutputKey = (projectId: string, commandId: string) => JSON.stringify([projectId, commandId]);
export function getCommandOutput(projectId: string, commandId: string) {
  const key = commandOutputKey(projectId, commandId);
  let buffer = commandBuffers.get(key);
  if (!buffer) { buffer = new OutputBuffer(); commandBuffers.set(key, buffer); }
  return buffer;
}
export function appendTerminalOutput(payload: TerminalOutputPayload) {
  getCommandOutput(payload.projectId, payload.commandId).append(payload.data);
}
export function pruneCommandOutput(validKeys: Set<string>) {
  for (const key of commandBuffers.keys()) if (!validKeys.has(key)) commandBuffers.delete(key);
}
export function requestTerminalFit() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TERMINAL_FIT_EVENT));
}
