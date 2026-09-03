import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import 'xterm/css/xterm.css';
import { WebLinksAddon } from 'xterm-addon-web-links';
import {
  TERMINAL_FIT_EVENT,
  subscribeTerminalOutput,
} from './utils/terminal';

interface TerminalWindowProps {
  className?: string;
  workingDir?: string;
  sessionId?: string;
  projectId?: string | null;
  projectName?: string | null;
  active?: boolean;
}

const TerminalWindow: React.FC<TerminalWindowProps> = ({
  className = '',
  workingDir,
  sessionId,
  projectId,
  projectName,
  active = false,
}) => {

  const resolvedDir = workingDir ?? '.';
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const shellPidRef = useRef<number | null>(null);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    const term = new Terminal({
      theme: {
        background: 'transparent',
        foreground: '#d7dee9',
        cursor: '#60a5fa',
        cursorAccent: '#1e293b',
      },
      fontFamily: '"Cascadia Mono", Consolas, "Segoe UI Symbol", "Microsoft YaHei UI", "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.45,
      convertEol: true,

      allowTransparency: true,
      cursorBlink: true,
      scrollback: 5000,
      disableStdin: false,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const webLinksAddon = new WebLinksAddon((event: MouseEvent, uri: string) => {
      if (event.ctrlKey || event.metaKey) {
        openUrl(uri).catch(console.error);
      }
    });
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);
    const fitTerminal = () => {
      requestAnimationFrame(() => fitAddonRef.current?.fit());
    };

    fitAddon.fit();

    termRef.current = term;

    fitAddonRef.current = fitAddon;

    let shellPid: number | null = null;

    invoke<number>('create_shell_session', {
      sessionId: sessionId ?? 'default',
      workingDir: resolvedDir,
      projectName: projectName ?? null,
    }).then((pid) => {
      shellPid = pid;
      shellPidRef.current = pid;
      term.writeln('\x1b[34m[FlashRun]\x1b[0m Shell ready. Type commands below.\r');
    }).catch((error) => {
      term.writeln(`\x1b[31m[FlashRun] Shell init failed: ${error}\x1b[0m\r`);
    });

    const shellUnlistenPromise = listen<string>(
      `shell-out-${sessionId ?? 'default'}`,
      (event) => {
        termRef.current?.write(event.payload);
      },
    );

    const unsubscribeCommandOutput = projectId
      ? subscribeTerminalOutput(projectId, (data) => termRef.current?.write(data))
      : () => {};

    let inputBuf = '';

    const dataDispose = term.onData((data) => {
      const code = data.charCodeAt(0);

      if (data === '\r') {
        term.write('\r\n');
        const line = inputBuf;
        inputBuf = '';
        if (shellPid != null && line.trim().length > 0) {
          invoke('send_input', { pid: shellPid, data: `${line}\n` }).catch(console.warn);
        }
        return;
      }

      if (data === '\x7f' || data === '\b') {
        if (inputBuf.length > 0) {
          inputBuf = inputBuf.slice(0, -1);
          term.write('\b \b');
        }
        return;
      }

      if (data === '\x03') {
        if (shellPid != null) {
          invoke('send_input', { pid: shellPid, data: '\x03' }).catch(console.warn);
        }
        term.write('^C\r\n');
        inputBuf = '';
        return;
      }

      if (data === '\x0c') {
        term.clear();
        inputBuf = '';
        return;
      }

      if (code < 0x20 && data !== '\t') {
        return;
      }

      inputBuf += data;
      term.write(data);
    });

    window.addEventListener('resize', fitTerminal);
    window.addEventListener(TERMINAL_FIT_EVENT, fitTerminal as EventListener);

    const observer = new ResizeObserver(() => {
      fitTerminal();
    });
    observer.observe(terminalRef.current);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fitTerminal);
      window.removeEventListener(TERMINAL_FIT_EVENT, fitTerminal as EventListener);
      dataDispose.dispose();
      shellUnlistenPromise.then((unlisten) => unlisten());
      unsubscribeCommandOutput();
      if (shellPid != null) {
        invoke('kill_command', { pid: shellPid }).catch(() => {});
      }
      term.dispose();
    };
  }, [projectId, projectName, resolvedDir, sessionId]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        termRef.current?.focus();
        window.requestAnimationFrame(() => fitAddonRef.current?.fit());
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [active]);

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden ${className}`}
      onMouseDown={() => termRef.current?.focus()}
    >
      <div className="flex-1 overflow-hidden bg-[#fbfcfe] p-0 dark:bg-[#0B1120]">
        <div ref={terminalRef} className="h-full w-full" />
      </div>
    </div>
  );
};

export default TerminalWindow;
