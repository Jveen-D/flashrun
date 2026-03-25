import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import 'xterm/css/xterm.css';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { useStore } from './store';

interface TerminalWindowProps {
  className?: string;
}

const TerminalWindow: React.FC<TerminalWindowProps> = ({ className = '' }) => {
  const { projects, activeProjectId } = useStore();
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // 收集当前所有正在运行的命令 pid，用于 stdin 转发
  const activeProject = projects.find(p => p.id === activeProjectId);
  const runningPids = (activeProject?.commands ?? [])
    .filter(c => c.status === 'running' && c.pid != null)
    .map(c => c.pid as number);
  const runningPidsRef = useRef<number[]>(runningPids);

  useEffect(() => { runningPidsRef.current = runningPids; }, [runningPids]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: 'transparent',
        foreground: '#d4d4d4',
        cursor: '#60a5fa',
        cursorAccent: '#1e293b',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      convertEol: true,
      allowTransparency: true,
      cursorBlink: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const webLinksAddon = new WebLinksAddon((e: MouseEvent, uri: string) => {
      if (e.ctrlKey || e.metaKey) {
        openUrl(uri).catch((err: any) => console.error('打开链接失败:', err));
      }
    });
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln('\x1b[34m[FlashRun]\x1b[0m Terminal ready. Start a command to see output.');

    // 用户键盘输入处理：
    // 1. 如果有运行中的进程，将输入发送到进程 stdin
    // 2. 不管有没有进程，都本地回显（让字符出现在屏幕上）
    term.onData((data) => {
      const pids = runningPidsRef.current;
      if (pids.length > 0) {
        for (const pid of pids) {
          invoke('send_input', { pid, data }).catch((err) =>
            console.warn('send_input error:', err)
          );
        }
      } else {
        // 没有运行中的进程时，本地回显（方便用户看到自己在输入）
        term.write(data);
      }
    });

    const unlistenPromise = listen<string>('terminal-out', (event) => {
      if (termRef.current) termRef.current.write(event.payload);
    });

    const handleResize = () => {
      if (fitAddonRef.current) fitAddonRef.current.fit();
    };
    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => fitAddonRef.current?.fit());
    });
    if (terminalRef.current) observer.observe(terminalRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      unlistenPromise.then(fn => fn());
      term.dispose();
    };
  }, []);

  return (
    <div className={`flex flex-col w-full h-full overflow-hidden ${className}`}>
      <div className="flex-1 p-2 overflow-hidden">
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  );
};

export default TerminalWindow;
