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
  /** 用于创建 shell session 的工作目录 */
  workingDir?: string;
  /** 本标签页唯一 ID，用于区分 shell-out 事件 */
  sessionId?: string;
}

const TerminalWindow: React.FC<TerminalWindowProps> = ({
  className = '',
  workingDir,
  sessionId,
}) => {
  const { projects, activeProjectId } = useStore();
  const activeProject = projects.find(p => p.id === activeProjectId);
  const resolvedDir = workingDir ?? activeProject?.path ?? '.';

  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const shellPidRef = useRef<number | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // ── 1. 初始化 xterm ──────────────────────────────────────────
    const term = new Terminal({
      theme: {
        background: 'transparent',
        foreground: '#d4d4d4',
        cursor: '#60a5fa',
        cursorAccent: '#1e293b',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      convertEol: false,        // 关闭自动转换，我们手动处理换行
      allowTransparency: true,
      cursorBlink: true,
      scrollback: 5000,
      disableStdin: false,      // 确保允许输入
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const webLinksAddon = new WebLinksAddon((e: MouseEvent, uri: string) => {
      if (e.ctrlKey || e.metaKey) openUrl(uri).catch(console.error);
    });
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);
    fitAddon.fit();
    setTimeout(() => term.focus(), 50);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // ── 2. 启动持久化 shell session ──────────────────────────────
    let shellPid: number | null = null;

    invoke<number>('create_shell_session', {
      sessionId: sessionId ?? 'default',
      workingDir: resolvedDir,
    }).then((pid) => {
      shellPid = pid;
      shellPidRef.current = pid;
      term.writeln('\x1b[34m[FlashRun]\x1b[0m Shell ready. Type commands below.\r');
    }).catch((err) => {
      term.writeln(`\x1b[31m[FlashRun] Shell init failed: ${err}\x1b[0m\r`);
    });

    // ── 3. 监听 shell 输出 ────────────────────────────────────────
    const shellUnlistenPromise = listen<string>(
      `shell-out-${sessionId ?? 'default'}`,
      (event) => { if (termRef.current) termRef.current.write(event.payload); }
    );

    // ── 4. 监听 npm 脚本输出（global terminal-out 事件）──────────
    const npmUnlistenPromise = listen<string>('terminal-out', (event) => {
      if (termRef.current) termRef.current.write(event.payload);
    });

    // ── 5. 键盘输入：行缓冲 + 本地回显 ──────────────────────────
    let inputBuf = '';

    term.onData((data) => {
      const code = data.charCodeAt(0);

      // 回车：发送命令到 shell
      if (data === '\r') {
        term.write('\r\n');
        const line = inputBuf;
        inputBuf = '';
        if (shellPid != null && line.trim().length > 0) {
          invoke('send_input', { pid: shellPid, data: line + '\n' }).catch(console.warn);
        }
        return;
      }

      // Backspace (DEL or BS)
      if (data === '\x7f' || data === '\b') {
        if (inputBuf.length > 0) {
          inputBuf = inputBuf.slice(0, -1);
          term.write('\b \b');
        }
        return;
      }

      // Ctrl+C：发送 ETX 中断信号
      if (data === '\x03') {
        if (shellPid != null) {
          invoke('send_input', { pid: shellPid, data: '\x03' }).catch(console.warn);
        }
        term.write('^C\r\n');
        inputBuf = '';
        return;
      }

      // Ctrl+L：清屏
      if (data === '\x0c') {
        term.clear();
        inputBuf = '';
        return;
      }

      // 跳过不可打印控制字符（方向键等），只处理可打印字符
      if (code < 0x20 && data !== '\t') return;

      // 普通可打印字符 + Tab：本地回显
      inputBuf += data;
      term.write(data);
    });

    // ── 6. ResizeObserver 让 xterm 跟随容器尺寸 ──────────────────
    window.addEventListener('resize', () => fitAddonRef.current?.fit());
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => fitAddonRef.current?.fit());
    });
    if (terminalRef.current) observer.observe(terminalRef.current);

    return () => {
      observer.disconnect();
      shellUnlistenPromise.then(fn => fn());
      npmUnlistenPromise.then(fn => fn());
      // 关闭 shell session（kill）
      if (shellPid != null) {
        invoke('kill_command', { pid: shellPid }).catch(() => {});
      }
      term.dispose();
    };
  }, []);

  return (
    <div
      className={`flex flex-col w-full h-full overflow-hidden ${className}`}
      onClick={() => termRef.current?.focus()}
    >
      <div className="flex-1 overflow-hidden p-2">
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  );
};

export default TerminalWindow;
