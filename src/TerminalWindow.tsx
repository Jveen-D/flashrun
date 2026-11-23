import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Terminal, type ITheme } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { SearchAddon } from 'xterm-addon-search';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { TERMINAL_FIT_EVENT, getCommandOutput, setLastTerminalSize, type OutputBuffer } from './utils/terminal';
import { ensureShellSession } from './utils/shellSessions';
import { sendSessionInput } from './utils/sessionInput';
import { stripAnsi } from './utils/logInsights';
import 'xterm/css/xterm.css';

export interface TerminalWindowHandle {
  searchNext: (query: string) => boolean;
  searchPrevious: (query: string) => boolean;
  clearSearch: () => void;
  clear: () => void;
  scrollToBottom: () => void;
  focus: () => void;
  getPlainText: () => string;
}

interface Props {
  className?: string;
  workingDir: string;
  sessionId?: string;
  projectId: string;
  commandId?: string;
  pid?: number | null;
  active: boolean;
  themeMode?: 'dark' | 'light';
  onRequestSearch?: () => void;
}

const DARK_TERMINAL_THEME: ITheme = {
  background: '#0B1120',
  foreground: '#d7dee9',
  cursor: '#60a5fa',
  selectionBackground: 'rgba(96, 165, 250, 0.30)',
  black: '#1e293b',
  red: '#f87171',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e2e8f0',
  brightBlack: '#64748b',
  brightRed: '#fca5a5',
  brightGreen: '#6ee7b7',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f8fafc',
};

const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#F8FAFC',
  foreground: '#1e293b',
  cursor: '#2563eb',
  selectionBackground: 'rgba(37, 99, 235, 0.20)',
  black: '#0f172a',
  red: '#dc2626',
  green: '#059669',
  yellow: '#b45309',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#475569',
  brightBlack: '#64748b',
  brightRed: '#ef4444',
  brightGreen: '#10b981',
  brightYellow: '#d97706',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#0f172a',
};

const TerminalWindow = forwardRef<TerminalWindowHandle, Props>(function TerminalWindow(
  {
    className = '',
    workingDir,
    sessionId,
    projectId,
    commandId,
    pid,
    active,
    themeMode = 'dark',
    onRequestSearch,
  },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const pidRef = useRef(pid);
  const termRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const outputRef = useRef<OutputBuffer | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const activeRef = useRef(active);
  const themeModeRef = useRef(themeMode);
  const onRequestSearchRef = useRef(onRequestSearch);

  pidRef.current = pid;
  activeRef.current = active;
  themeModeRef.current = themeMode;
  onRequestSearchRef.current = onRequestSearch;

  useImperativeHandle(ref, () => ({
    searchNext: (query: string) => {
      if (!query || !searchAddonRef.current) return false;
      return searchAddonRef.current.findNext(query, { caseSensitive: false, incremental: false });
    },
    searchPrevious: (query: string) => {
      if (!query || !searchAddonRef.current) return false;
      return searchAddonRef.current.findPrevious(query, { caseSensitive: false });
    },
    clearSearch: () => {
      searchAddonRef.current?.clearDecorations();
    },
    clear: () => {
      outputRef.current?.clear();
      termRef.current?.clear();
      termRef.current?.reset();
    },
    scrollToBottom: () => {
      termRef.current?.scrollToBottom();
    },
    focus: () => {
      termRef.current?.focus();
    },
    getPlainText: () => stripAnsi(outputRef.current?.snapshot() ?? ''),
  }), []);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let frame = 0;

    const term = new Terminal({
      theme: themeModeRef.current === 'light' ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME,
      fontFamily: '"Cascadia Mono", Consolas, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.45,
      scrollback: 3000,
      cursorBlink: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon((event, uri) => {
      if ((event.ctrlKey || event.metaKey) && /^https?:\/\//i.test(uri)) {
        void openUrl(uri).catch(console.error);
      }
    }));

    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown'
        && (event.ctrlKey || event.metaKey)
        && !event.altKey
        && !event.shiftKey
        && event.code === 'KeyF'
      ) {
        event.preventDefault();
        onRequestSearchRef.current?.();
        return false;
      }
      return true;
    });

    term.open(container.current);
    termRef.current = term;
    searchAddonRef.current = search;

    const shell = commandId ? undefined : ensureShellSession(sessionId!, workingDir, term.rows, term.cols);
    const output = commandId ? getCommandOutput(projectId, commandId) : shell!.output;
    outputRef.current = output;

    const targetPid = () => (commandId ? pidRef.current : shell?.pid);
    const fitTerminal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || !activeRef.current || !container.current?.clientHeight) return;
        fit.fit();
        setLastTerminalSize(term.rows, term.cols);
        const target = targetPid();
        if (target != null) {
          void invoke('resize_session', { pid: target, rows: term.rows, cols: term.cols }).catch(console.warn);
        }
      });
    };
    fitRef.current = fitTerminal;
    void shell?.ready.then(() => { if (!disposed) fitTerminal(); });

    // PTY handles echo, passwords, history and control characters.
    const input = term.onData((data) => {
      const target = targetPid();
      if (target != null) void sendSessionInput(target, data).catch(console.warn);
    });
    const unsubscribe = output.subscribe((data) => {
      if (!disposed) term.write(data);
    });
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
      searchAddonRef.current = null;
      outputRef.current = null;
      fitRef.current = null;
    };
  }, [commandId, projectId, sessionId, workingDir]);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = themeMode === 'light' ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
    }
  }, [themeMode]);

  useEffect(() => {
    if (active) {
      fitRef.current?.();
      termRef.current?.focus();
    }
  }, [active, pid]);

  return (
    <div
      className={`h-full w-full p-1 transition-colors ${themeMode === 'light' ? 'bg-slate-50' : 'bg-[#0B1120]'} ${className}`}
      onMouseDown={() => termRef.current?.focus()}
    >
      <div ref={container} className="h-full w-full" />
    </div>
  );
});

export default TerminalWindow;
