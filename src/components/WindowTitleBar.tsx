import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, PanelLeftClose, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isMacPlatform } from '../utils/shortcuts';

interface WindowTitleBarProps {
  onToggleCompactMode: () => void;
}

export const WindowTitleBar: React.FC<WindowTitleBarProps> = ({ onToggleCompactMode }) => {
  const { t } = useTranslation();
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const isMac = useMemo(() => isMacPlatform(), []);
  const [isMaximized, setIsMaximized] = useState(false);

  const syncMaximizedState = useCallback(() => {
    void appWindow.isMaximized().then(setIsMaximized).catch(() => {});
  }, [appWindow]);

  useEffect(() => {
    syncMaximizedState();
    window.addEventListener('resize', syncMaximizedState);
    return () => window.removeEventListener('resize', syncMaximizedState);
  }, [syncMaximizedState]);

  const handleStartDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    void appWindow.startDragging().catch(() => {});
  };

  const handleToggleMaximize = () => {
    void appWindow.toggleMaximize().then(syncMaximizedState).catch(() => {});
  };

  const titleContent = (
    <div className={`min-w-0 flex items-center gap-1.5 text-slate-400 dark:text-slate-500 ${isMac ? 'justify-center text-center' : ''}`}>
      <span className="text-[11px] font-bold tracking-[0.24em] uppercase text-slate-700 dark:text-slate-200">
        FlashRun
      </span>
      <span className="truncate text-[11px] opacity-75">{t('项目快捷启动台')}</span>
    </div>
  );

  const compactButton = (
    <button
      type="button"
      onClick={onToggleCompactMode}
      className={`flex h-7 items-center gap-1.5 rounded-md border border-slate-200/80 bg-slate-100/85 text-slate-600 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white ${
        isMac ? 'px-2.5' : 'px-3'
      }`}
      title={t('进入精简模式')}
    >
      <PanelLeftClose size={14} />
      <span className="text-xs font-semibold">{t('精简模式')}</span>
    </button>
  );


  const renderMacControls = (hidden = false) => (
    <div className={`flex shrink-0 items-center gap-2.5 ${hidden ? 'invisible pointer-events-none' : ''}`} aria-hidden={hidden}>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void appWindow.close().catch(() => {})}
          className="group flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#ff5f57] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)] transition-transform hover:scale-105"
          title={t('关闭窗口')}
        >
          <X size={8} strokeWidth={2.4} className="text-black/60 opacity-0 transition-opacity group-hover:opacity-90" />
          <span className="sr-only">{t('关闭窗口')}</span>
        </button>

        <button
          type="button"
          onClick={() => void appWindow.minimize().catch(() => {})}
          className="group flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#ffbd2e] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)] transition-transform hover:scale-105"
          title={t('最小化窗口')}
        >
          <Minus size={8} strokeWidth={2.4} className="text-black/60 opacity-0 transition-opacity group-hover:opacity-90" />
          <span className="sr-only">{t('最小化窗口')}</span>
        </button>

        <button
          type="button"
          onClick={handleToggleMaximize}
          className="group flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#28c840] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)] transition-transform hover:scale-105"
          title={isMaximized ? t('还原窗口') : t('最大化窗口')}
        >
          <Square size={7} strokeWidth={2.4} className="text-black/60 opacity-0 transition-opacity group-hover:opacity-90" />
          <span className="sr-only">{isMaximized ? t('还原窗口') : t('最大化窗口')}</span>
        </button>
      </div>

      {compactButton}
    </div>
  );

  const windowsControls = (
    <div className="flex shrink-0 items-center gap-1.5">
      {compactButton}

      <button
        type="button"
        onClick={() => void appWindow.minimize().catch(() => {})}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-slate-500 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
        title={t('最小化窗口')}
      >
        <Minus size={14} />
      </button>

      <button
        type="button"
        onClick={handleToggleMaximize}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-slate-500 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
        title={isMaximized ? t('还原窗口') : t('最大化窗口')}
      >
        <Square size={12} />
      </button>

      <button
        type="button"
        onClick={() => void appWindow.close().catch(() => {})}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-slate-500 transition-colors hover:border-rose-500 hover:bg-rose-500 hover:text-white dark:text-slate-400"
        title={t('关闭窗口')}
      >
        <X size={14} />
      </button>
    </div>
  );


  if (isMac) {
    return (
      <div className="grid h-9 shrink-0 select-none grid-cols-[auto,1fr,auto] items-center gap-2.5 border-b border-slate-200/80 bg-slate-50/90 px-2.5 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/70">
        {renderMacControls()}

        <div
          className="min-w-0 h-full flex items-center justify-center cursor-move"
          onMouseDown={handleStartDrag}
          onDoubleClick={handleToggleMaximize}
        >
          {titleContent}
        </div>

        {renderMacControls(true)}
      </div>
    );
  }

  return (
    <div className="flex h-9 shrink-0 select-none items-center justify-between gap-2.5 border-b border-slate-200/80 bg-slate-50/90 pl-3 pr-1.5 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/70">

      <div
        className="flex-1 min-w-0 h-full flex items-center cursor-move"
        onMouseDown={handleStartDrag}
        onDoubleClick={handleToggleMaximize}
      >
        {titleContent}
      </div>

      {windowsControls}
    </div>
  );
};
