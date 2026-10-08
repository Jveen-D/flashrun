import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { TERMINAL_FIT_EVENT, getCommandOutput } from './utils/terminal';
import { ensureShellSession } from './utils/shellSessions';
import { sendSessionInput } from './utils/sessionInput';
import 'xterm/css/xterm.css';

interface Props {
  className?: string; workingDir: string; sessionId?: string; projectId: string;
  commandId?: string; pid?: number | null; active: boolean;
}
export default function TerminalWindow({ className = '', workingDir, sessionId, projectId, commandId, pid, active }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const pidRef = useRef(pid);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const activeRef = useRef(active);
  pidRef.current = pid;
  activeRef.current = active;
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let frame = 0;
    const term = new Terminal({
      theme: { background: '#0B1120', foreground: '#d7dee9', cursor: '#60a5fa' },
      fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize: 12, lineHeight: 1.45,
      scrollback: 3000, cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((event, uri) => {
      if ((event.ctrlKey || event.metaKey) && /^https?:\/\//i.test(uri)) void openUrl(uri).catch(console.error);
    }));
    term.open(container.current);
    termRef.current = term;
    const shell = commandId ? undefined : ensureShellSession(sessionId!, workingDir, term.rows, term.cols);
    const output = commandId ? getCommandOutput(projectId, commandId) : shell!.output;
    const targetPid = () => commandId ? pidRef.current : shell?.pid;
    const fitTerminal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || !activeRef.current || !container.current?.clientHeight) return;
        fit.fit();
        const target = targetPid();
        if (target != null) void invoke('resize_session', { pid: target, rows: term.rows, cols: term.cols }).catch(console.warn);
      });
    };
    fitRef.current = fitTerminal;
    void shell?.ready.then(() => { if (!disposed) fitTerminal(); });
    // PTY handles echo, passwords, history and control characters.
    const input = term.onData((data) => {
      const target = targetPid();
      if (target != null) void sendSessionInput(target, data).catch(console.warn);
    });
    const unsubscribe = output.subscribe((data) => { if (!disposed) term.write(data); });
    const observer = new ResizeObserver(fitTerminal);
    observer.observe(container.current);
    window.addEventListener(TERMINAL_FIT_EVENT, fitTerminal);
    fitTerminal();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener(TERMINAL_FIT_EVENT, fitTerminal);
      unsubscribe();
      input.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [commandId, projectId, sessionId, workingDir]);
  useEffect(() => { if (active) { fitRef.current?.(); termRef.current?.focus(); } }, [active, pid]);
  return <div className={`h-full w-full bg-[#0B1120] p-1 ${className}`} onMouseDown={() => termRef.current?.focus()}>
    <div ref={container} className="h-full w-full" />
  </div>;
}
