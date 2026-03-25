import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Trash2, Copy, ChevronDown } from 'lucide-react';
import 'xterm/css/xterm.css';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { useTranslation } from 'react-i18next';

interface TerminalWindowProps {
  className?: string;
  onClose?: () => void;
}

const TerminalWindow: React.FC<TerminalWindowProps> = ({ className = '', onClose }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (!terminalRef.current) return;

    // 1. 初始化 Xterm 实例 (背景设为透明)
    const term = new Terminal({
      theme: {
        background: 'transparent',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      convertEol: true,
      allowTransparency: true,
    });
    
    // 2. 添加相关 Addons
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const webLinksAddon = new WebLinksAddon((e: MouseEvent, uri: string) => {
      console.log("Terminal link clicked:", uri, "modifiers:", e.ctrlKey, e.metaKey);
      // 只有在按下 Ctrl (Win) 或 Cmd (Mac) 时才打开链接
      if (e.ctrlKey || e.metaKey) {
        openUrl(uri).catch((err: any) => console.error("打开链接失败:", err));
      }
    });
    term.loadAddon(webLinksAddon);
    
    // 3. 挂载到 DOM
    term.open(terminalRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln('\x1b[34m[FlashRun] \x1b[0m waiting for output...');

    // 4. 监听事件: 捕获 Promise 防止 StrictMode 的多次渲染导致卸载时抛错或遗漏
    const unlistenPromise = listen<string>('terminal-out', (event) => {
      if (termRef.current) {
        termRef.current.write(event.payload);
      }
    });

    // 5. 监听窗口大小改变（window resize + 父容器 resize 都要感知）
    const handleResize = () => {
      if (fitAddonRef.current) fitAddonRef.current.fit();
    };
    window.addEventListener('resize', handleResize);

    // 6. 用 ResizeObserver 监听终端容器自身的尺寸变化（拖拽调整高度时触发 refit）
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        // 用 rAF 延迟一帧，确保 DOM 已完成布局再 fit
        requestAnimationFrame(() => fitAddonRef.current?.fit());
      }
    });
    if (terminalRef.current) observer.observe(terminalRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      unlistenPromise.then(unlistenFn => unlistenFn());
      term.dispose();
    };
  }, []);

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (termRef.current) {
      termRef.current.clear();
      termRef.current.writeln('\x1b[34m[FlashRun] \x1b[0m buffer cleared.');
    }
  };

  const handleCopyAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (termRef.current) {
      termRef.current.selectAll();
      const selection = termRef.current.getSelection();
      termRef.current.clearSelection();
      try {
        await navigator.clipboard.writeText(selection);
      } catch (err) {
        console.error("Copy failed", err);
      }
    }
  };

  return (
    <div className={`flex flex-col w-full h-full bg-white/95 dark:bg-slate-950/80 backdrop-blur rounded-t-xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 border-b-0 transition-colors ${className}`}>
      {/* 终端专属 Header */}
      <div className="h-10 px-4 bg-slate-100/50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0 transition-colors">
        <div className="flex space-x-2 items-center">
          <div className="w-3 h-3 rounded-full bg-red-400 dark:bg-red-500 shadow-sm border border-red-500/20"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-400 dark:bg-yellow-500 shadow-sm border border-yellow-500/20"></div>
          <div className="w-3 h-3 rounded-full bg-green-400 dark:bg-green-500 shadow-sm border border-green-500/20"></div>
        </div>
        <div className="flex space-x-3 text-slate-500 dark:text-slate-400">
          <button onClick={handleCopyAll} className="hover:text-slate-900 dark:hover:text-white transition-colors p-1" title={t("复制所有输出")}>
            <Copy size={16} />
          </button>
          <button onClick={handleClear} className="hover:text-red-500 dark:hover:text-red-400 transition-colors p-1" title={t("清空日志")}>
            <Trash2 size={16} />
          </button>
          {onClose && (
            <button onClick={onClose} className="hover:text-blue-500 dark:hover:text-blue-400 transition-colors p-1" title={t("收起终端")}>
              <ChevronDown size={16} />
            </button>
          )}
        </div>
      </div>
      
      {/* 终端主体区 */}
      <div className="flex-1 p-3 overflow-hidden relative">
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  );
};

export default TerminalWindow;
