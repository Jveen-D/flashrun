import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';
import { FolderKanban } from 'lucide-react';

import { Sidebar } from './components/Sidebar';
import { WindowTitleBar } from './components/WindowTitleBar';
import { TopBar } from './components/TopBar';
import { ActionGrid } from './components/ActionGrid';
import { SettingsModal } from './components/SettingsModal';

import { useStore } from './store';
import { useTranslation } from 'react-i18next';
import { eventMatchesShortcut } from './utils/shortcuts';
import {
  appendTerminalOutput,
  COMMAND_STATUS_EVENT,
  TERMINAL_OUTPUT_EVENT,
  requestTerminalFit,
  type CommandStatusPayload,
  type TerminalOutputPayload,
} from './utils/terminal';
import './App.css';

// ── Constants ──────────────────────────────────────────────────────
const ANIMATION_DURATION = 200;
const HIDE_DELAY_MS = 400;
const SUMMON_EDGE_BAND_PX = 12;
const SUMMON_POLL_INTERVAL_MS = 100;
const DOCK_SETTLE_DELAY_MS = 200;
const DOCK_THRESHOLD_PX = 20;

// ── Types ──────────────────────────────────────────────────────────
type WindowPoint = { x: number; y: number };

type CompactWindowLayout = {
  previousPosition: WindowPoint | null;
  previousSize: { width: number; height: number } | null;
  wasMaximized: boolean;
  compactPosition: WindowPoint | null;
};

/**
 * Compact auto-hide state machine:
 *
 *   VISIBLE  ──(mouseleave + delay)──►  HIDING  ──(animation done)──►  HIDDEN
 *      ▲                                                                  │
 *      │                     REVEALING  ◄──(summon edge hit)──────────────┘
 *      └──(animation done)───┘
 */
type CompactPhase = 'VISIBLE' | 'HIDING' | 'HIDDEN' | 'REVEALING';

const TerminalPanel = lazy(() => import('./components/TerminalPanel'));

function shouldIgnoreShortcutEvent(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) {
    return false;
  }

  if (element.closest('[data-shortcut-recorder="true"]')) {
    return true;
  }

  if (element.closest('.xterm')) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  return tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || Boolean(element.closest('[contenteditable="true"]'));
}

function App() {
  const {
    projects,
    activeProjectId,
    globalSettings,
    updateGlobalSettings,
    hydrate,
    hydrated,
    isTerminalOpen,
    terminalHeight,
    setTerminalOpen,
    setTerminalHeight,
    toggleTerminal,
    activeCommandByProject,
    sidebarWidth,
  } = useStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const [mountedTerminalProjectIds, setMountedTerminalProjectIds] = useState<string[]>([]);
  const [compactModePreview, setCompactModePreview] = useState<boolean | null>(null);
  const [isCompactDockedState, setIsCompactDockedState] = useState(true);
  const isDragging = useRef(false);

  // ── Compact state machine refs ─────────────────────────────────
  const compactRef = useRef<{
    phase: CompactPhase;
    previousPosition: WindowPoint | null;
    previousSize: { width: number; height: number } | null;
    wasMaximized: boolean;
    visibleX: number | null;
    visibleY: number | null;
    dockedToTop: boolean;
    animationToken: number;
    animationFrame: number;
  }>({
    phase: 'VISIBLE',
    previousPosition: null,
    previousSize: null,
    wasMaximized: false,
    visibleX: null,
    visibleY: null,
    dockedToTop: true,
    animationToken: 0,
    animationFrame: 0,
  });
  const hideTimerRef = useRef<number | null>(null);
  const dragSettleTimerRef = useRef<number | null>(null);
  const isProgrammaticMove = useRef(0);
  const isUserDragging = useRef(false);
  const compactToggleToken = useRef(0);
  const pendingAutoHide = useRef(false);

  const { t, i18n } = useTranslation();
  const appWindow = useMemo(() => getCurrentWindow(), []);

  // ── Derived values ─────────────────────────────────────────────
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const currentRunningCommand = activeProject && activeProjectId
    ? activeProject.commands.find((command) => command.id === activeCommandByProject[activeProjectId] && command.status === 'running')
      ?? activeProject.commands.find((command) => command.status === 'running')
      ?? null
    : null;
  const terminalTitle = currentRunningCommand && activeProject
    ? t('Terminal - {{project}} : {{command}}', {
      project: activeProject.name,
      command: currentRunningCommand.label,
    })
    : t('Terminal - Idle');
  const actualCompactMode = globalSettings.compactMode;
  const compactMode = compactModePreview ?? actualCompactMode;
  const terminalVisible = !compactMode && isTerminalOpen;
  const compactWindowWidth = sidebarWidth;
  const compactTriggerBandHeight = Math.max(globalSettings.compactPeekHeight, 2) + SUMMON_EDGE_BAND_PX;
  const showCompactTriggerBandDebug = compactMode
    && globalSettings.compactTriggerBandDebug
    && isCompactDockedState;

  const renderedTerminalProjectIds = useMemo(() => {
    if (!hydrated || compactMode) {
      return [] as string[];
    }

    if (!activeProjectId) {
      return mountedTerminalProjectIds;
    }

    return mountedTerminalProjectIds.includes(activeProjectId)
      ? mountedTerminalProjectIds
      : [...mountedTerminalProjectIds, activeProjectId];
  }, [activeProjectId, compactMode, hydrated, mountedTerminalProjectIds]);
  const shouldRenderTerminalPanel = renderedTerminalProjectIds.length > 0;

  const toggleTerminalWithFit = useCallback(() => {
    toggleTerminal();
    window.setTimeout(() => requestTerminalFit(), 40);
  }, [toggleTerminal]);

  // ── Helpers ────────────────────────────────────────────────────
  const resolveMonitor = useCallback(async (cursor?: WindowPoint) => {
    const monitors = await availableMonitors();
    if (!monitors.length) return null;

    // 优先用传入的坐标点匹配显示器
    const findMonitorAt = (point: WindowPoint) =>
      monitors.find((m) => (
        point.x >= m.position.x
        && point.x < m.position.x + m.size.width
        && point.y >= m.position.y
        && point.y < m.position.y + m.size.height
      ));

    if (cursor) {
      const found = findMonitorAt(cursor);
      if (found) return found;
    }

    // 没有 cursor 时，根据窗口当前位置来判断所在屏幕
    try {
      const [pos, size] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize()]);
      const centerX = pos.x + Math.round(size.width / 2);
      const centerY = pos.y + Math.round(size.height / 2);
      const found = findMonitorAt({ x: centerX, y: centerY });
      if (found) return found;

      // 窗口中心可能在屏幕外（隐藏状态），用窗口左上角 X + 工作区 Y 重试
      for (const m of monitors) {
        if (pos.x >= m.position.x && pos.x < m.position.x + m.size.width) {
          return m;
        }
      }
    } catch {
      // ignore
    }

    return monitors[0] ?? null;
  }, [appWindow]);

  const cancelAnimation = useCallback(() => {
    const s = compactRef.current;
    s.animationToken += 1;
    if (s.animationFrame) {
      window.cancelAnimationFrame(s.animationFrame);
      s.animationFrame = 0;
    }
  }, []);

  const withProgrammaticMove = useCallback(async <T,>(op: () => Promise<T>) => {
    isProgrammaticMove.current += 1;
    try {
      return await op();
    } finally {
      isProgrammaticMove.current = Math.max(0, isProgrammaticMove.current - 1);
    }
  }, []);

  // ── Animated position transition ───────────────────────────────
  const animateTo = useCallback(async (targetX: number, targetY: number) => {
    cancelAnimation();
    const s = compactRef.current;
    const token = s.animationToken + 1;
    s.animationToken = token;

    let startX = targetX;
    let startY = targetY;
    try {
      const pos = await appWindow.outerPosition();
      startX = pos.x;
      startY = pos.y;
    } catch {
      await appWindow.setPosition(new PhysicalPosition(targetX, targetY));
      return;
    }

    const startTime = performance.now();
    await new Promise<void>((resolve) => {
      const step = (ts: number) => {
        if (compactRef.current.animationToken !== token) { resolve(); return; }
        const p = Math.min(1, (ts - startTime) / ANIMATION_DURATION);
        const e = 1 - (1 - p) ** 3;
        const nx = Math.round(startX + (targetX - startX) * e);
        const ny = Math.round(startY + (targetY - startY) * e);
        void appWindow.setPosition(new PhysicalPosition(nx, ny));
        if (p < 1) {
          compactRef.current.animationFrame = window.requestAnimationFrame(step);
        } else {
          compactRef.current.animationFrame = 0;
          resolve();
        }
      };
      compactRef.current.animationFrame = window.requestAnimationFrame(step);
    });
  }, [appWindow, cancelAnimation]);

  // ── Enter compact mode (resize & dock) ─────────────────────────
  const applyCompactLayout = useCallback(async (options?: { cancelled?: () => boolean }) => {
    cancelAnimation();
    if (options?.cancelled?.()) return;

    const layout = await withProgrammaticMove(() => invoke<CompactWindowLayout>('enter_compact_mode', {
      compactWidth: compactWindowWidth,
    }));
    if (options?.cancelled?.()) return;

    const s = compactRef.current;
    s.previousPosition = layout.previousPosition;
    s.previousSize = layout.previousSize;
    s.wasMaximized = layout.wasMaximized;
    // 使用 Rust 端返回的实际 compact 位置，避免竞态读取中间状态
    s.visibleX = layout.compactPosition?.x ?? null;
    s.visibleY = layout.compactPosition?.y ?? null;
    s.dockedToTop = true;
    setIsCompactDockedState(true);
    s.phase = 'VISIBLE';
  }, [cancelAnimation, compactWindowWidth, withProgrammaticMove]);

  // ── Compute visible position (clamped to work area) ────────────
  const computeVisiblePosition = useCallback(async (cursor?: WindowPoint) => {
    const monitor = await resolveMonitor(cursor);
    if (!monitor) return null;

    const [size, pos] = await Promise.all([appWindow.outerSize(), appWindow.outerPosition()]);
    const s = compactRef.current;
    const baseX = s.visibleX ?? pos.x;
    const baseY = s.visibleY ?? pos.y;
    const wa = monitor.workArea;
    const maxX = wa.position.x + wa.size.width - size.width;
    const maxY = wa.position.y + wa.size.height - size.height;
    const x = Math.min(Math.max(baseX, wa.position.x), Math.max(wa.position.x, maxX));
    const y = s.dockedToTop
      ? wa.position.y
      : Math.min(Math.max(baseY, wa.position.y), Math.max(wa.position.y, maxY));
    return { x, y };
  }, [appWindow, resolveMonitor]);

  const isCursorInsideCompactWindow = useCallback(async () => {
    try {
      const [cursor, pos, size] = await Promise.all([
        invoke<WindowPoint>('get_cursor_position'),
        appWindow.outerPosition(),
        appWindow.outerSize(),
      ]);
      return cursor.x >= pos.x
        && cursor.x <= pos.x + size.width
        && cursor.y >= pos.y
        && cursor.y <= pos.y + size.height;
    } catch {
      return true;
    }
  }, [appWindow]);

  // ── Hide (slide up off-screen, keep peek pixels visible) ───────
  const compactHide = useCallback(async () => {
    const s = compactRef.current;
    if (s.phase === 'HIDDEN' || s.phase === 'HIDING' || !s.dockedToTop) return;
    s.phase = 'HIDING';

    const monitor = await resolveMonitor();
    if (!monitor) { s.phase = 'VISIBLE'; return; }

    const [outerSize, outerPos] = await Promise.all([appWindow.outerSize(), appWindow.outerPosition()]);
    const wa = monitor.workArea;
    // 保留 compactPeekHeight 像素的物理高度在工作区顶部可见，方便鼠标碰触后唤出
    const peekPx = Math.max(globalSettings.compactPeekHeight, 2);
    const hiddenY = wa.position.y - outerSize.height + peekPx;
    const baseX = s.visibleX ?? outerPos.x;
    const maxX = wa.position.x + wa.size.width - outerSize.width;
    const x = Math.min(Math.max(baseX, wa.position.x), Math.max(wa.position.x, maxX));

    await withProgrammaticMove(() => animateTo(x, hiddenY));
    if (compactRef.current.phase === 'HIDING') {
      compactRef.current.phase = 'HIDDEN';
    }
  }, [animateTo, appWindow, globalSettings.compactPeekHeight, resolveMonitor, withProgrammaticMove]);

  // ── Reveal (slide down to visible position) ────────────────────
  const compactReveal = useCallback(async () => {
    const s = compactRef.current;
    if (s.phase === 'VISIBLE' || s.phase === 'REVEALING') return;
    s.phase = 'REVEALING';

    const visible = await computeVisiblePosition();
    if (!visible) { s.phase = 'HIDDEN'; return; }

    s.visibleX = visible.x;
    s.visibleY = visible.y;
    await withProgrammaticMove(() => animateTo(visible.x, visible.y));
    if (compactRef.current.phase === 'REVEALING') {
      compactRef.current.phase = 'VISIBLE';
      if (
        globalSettings.compactModeAutoHide
        && compactRef.current.dockedToTop
        && !isUserDragging.current
        && isProgrammaticMove.current === 0
      ) {
        void isCursorInsideCompactWindow().then((inside) => {
          if (
            !inside
            && compactRef.current.phase === 'VISIBLE'
            && compactRef.current.dockedToTop
            && !isUserDragging.current
            && isProgrammaticMove.current === 0
          ) {
            if (hideTimerRef.current !== null) {
              window.clearTimeout(hideTimerRef.current);
            }
            hideTimerRef.current = window.setTimeout(() => {
              hideTimerRef.current = null;
              if (!isUserDragging.current && isProgrammaticMove.current === 0) {
                void compactHide();
              }
            }, HIDE_DELAY_MS);
          }
        });
      }
    }
  }, [animateTo, compactHide, computeVisiblePosition, globalSettings.compactModeAutoHide, isCursorInsideCompactWindow, withProgrammaticMove]);

  // ── Clear hide timer ───────────────────────────────────────────
  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  // ── Schedule hide after delay ──────────────────────────────────
  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (!isUserDragging.current && isProgrammaticMove.current === 0) {
        void compactHide();
      }
    }, HIDE_DELAY_MS);
  }, [clearHideTimer, compactHide]);

  // ── Sync dock state after user drag ────────────────────────────
  const syncDockAfterDrag = useCallback(async () => {
    if (!actualCompactMode) return;
    const [monitor, pos, size] = await Promise.all([
      resolveMonitor(),
      appWindow.outerPosition(),
      appWindow.outerSize(),
    ]);
    if (!monitor) return;

    const wa = monitor.workArea;
    const s = compactRef.current;
    const maxX = wa.position.x + wa.size.width - size.width;
    const maxY = wa.position.y + wa.size.height - size.height;
    const targetX = Math.min(Math.max(pos.x, wa.position.x), Math.max(wa.position.x, maxX));
    const shouldDockToTop = Math.abs(pos.y - wa.position.y) <= DOCK_THRESHOLD_PX;
    const targetY = shouldDockToTop
      ? wa.position.y
      : Math.min(Math.max(pos.y, wa.position.y), Math.max(wa.position.y, maxY));

    s.visibleX = targetX;
    s.visibleY = targetY;
    s.dockedToTop = shouldDockToTop;
    setIsCompactDockedState(shouldDockToTop);
    s.phase = 'VISIBLE';

    if (pos.x !== targetX || pos.y !== targetY) {
      await withProgrammaticMove(() => animateTo(targetX, targetY));
    }

    if (globalSettings.compactModeAutoHide && shouldDockToTop) {
      scheduleHide();
    }
  }, [actualCompactMode, animateTo, appWindow, globalSettings.compactModeAutoHide, resolveMonitor, scheduleHide, withProgrammaticMove]);

  const scheduleDockSettle = useCallback(() => {
    if (dragSettleTimerRef.current !== null) {
      window.clearTimeout(dragSettleTimerRef.current);
    }
    dragSettleTimerRef.current = window.setTimeout(() => {
      dragSettleTimerRef.current = null;
      isUserDragging.current = false;
      void syncDockAfterDrag();
    }, DOCK_SETTLE_DELAY_MS);
  }, [syncDockAfterDrag]);

  // ── Mouse event handlers ───────────────────────────────────────
  const handleMouseEnter = useCallback(() => {
    clearHideTimer();
    const s = compactRef.current;
    if (s.phase === 'HIDDEN' || s.phase === 'HIDING') {
      void compactReveal();
    }
  }, [clearHideTimer, compactReveal]);

  const handleMouseLeave = useCallback(() => {
    if (
      !compactMode
      || !globalSettings.compactModeAutoHide
      || isSettingsOpen
      || isUserDragging.current
      || isProgrammaticMove.current > 0
      || !compactRef.current.dockedToTop
    ) {
      return;
    }
    const s = compactRef.current;
    if (s.phase === 'VISIBLE') {
      scheduleHide();
    }
  }, [compactMode, globalSettings.compactModeAutoHide, isSettingsOpen, scheduleHide]);

  // ── Effects ────────────────────────────────────────────────────
  useEffect(() => { void hydrate(); }, [hydrate]);

  useEffect(() => {
    if (compactModePreview === null || compactModePreview !== actualCompactMode) return;
    setCompactModePreview(null);
  }, [actualCompactMode, compactModePreview]);

  useEffect(() => {
    if (!hydrated || compactMode || !activeProjectId) return;
    setMountedTerminalProjectIds((current) => {
      return current.includes(activeProjectId) ? current : [...current, activeProjectId];
    });
  }, [activeProjectId, compactMode, hydrated]);

  useEffect(() => {
    const availableIds = new Set(projects.map((p) => p.id));
    setMountedTerminalProjectIds((current) => current.filter((id) => availableIds.has(id)));
  }, [projects]);

  useEffect(() => { i18n.changeLanguage(globalSettings.language || 'zh'); }, [globalSettings.language, i18n]);

  useEffect(() => {
    const root = document.documentElement;
    if (globalSettings.theme === 'system') {
      root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
    } else {
      root.classList.toggle('dark', globalSettings.theme === 'dark');
    }
  }, [globalSettings.theme]);

  // ── Apply / exit compact mode ──────────────────────────────────
  useLayoutEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    const apply = async () => {
      const s = compactRef.current;
      if (actualCompactMode) {
        if (s.previousPosition && s.previousSize) {
          if (s.visibleX == null || s.visibleY == null) {
            const pos = await appWindow.outerPosition();
            s.visibleX = pos.x;
            s.visibleY = pos.y;
          }
          return;
        }
        await applyCompactLayout({ cancelled: () => cancelled });
        return;
      }

      cancelAnimation();
      await withProgrammaticMove(() => invoke('exit_compact_mode', {
        layout: {
          previousPosition: s.previousPosition,
          previousSize: s.previousSize,
          wasMaximized: s.wasMaximized,
        },
      }));

      s.previousPosition = null;
      s.previousSize = null;
      s.wasMaximized = false;
      s.visibleX = null;
      s.visibleY = null;
      s.dockedToTop = true;
      setIsCompactDockedState(true);
      s.phase = 'VISIBLE';
      requestTerminalFit();
    };

    void apply();
    return () => { cancelled = true; };
  }, [actualCompactMode, appWindow, applyCompactLayout, cancelAnimation, hydrated, withProgrammaticMove]);

  // ── Auto-hide after entering compact mode ──────────────────────
  useEffect(() => {
    if (!hydrated || !actualCompactMode || !globalSettings.compactModeAutoHide || !pendingAutoHide.current) return;
    // 延迟执行自动隐藏，确保布局已完成
    const timer = window.setTimeout(() => {
      if (pendingAutoHide.current) {
        pendingAutoHide.current = false;
        void compactHide();
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [actualCompactMode, globalSettings.compactModeAutoHide, hydrated, compactHide]);

  // ── Listen for user drag (onMoved) ─────────────────────────────
  useEffect(() => {
    if (!hydrated || !actualCompactMode) return;

    const unlistenPromise = appWindow.onMoved((event) => {
      if (isProgrammaticMove.current > 0) return;
      const s = compactRef.current;
      if (s.phase === 'HIDDEN') return;

      clearHideTimer();
      s.visibleX = event.payload.x;
      s.visibleY = event.payload.y;
      isUserDragging.current = true;
      scheduleDockSettle();
    });

    return () => {
      if (dragSettleTimerRef.current !== null) {
        window.clearTimeout(dragSettleTimerRef.current);
        dragSettleTimerRef.current = null;
      }
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [actualCompactMode, appWindow, clearHideTimer, hydrated, scheduleDockSettle]);

  // ── Summon watcher: poll cursor when HIDDEN to detect edge ─────
  useEffect(() => {
    if (!hydrated || !actualCompactMode || !globalSettings.compactModeAutoHide) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || isProgrammaticMove.current > 0 || isUserDragging.current) return;
      const s = compactRef.current;
      if (s.phase !== 'HIDDEN') return;

      try {
        const [cursor, size] = await Promise.all([
          invoke<WindowPoint>('get_cursor_position'),
          appWindow.outerSize(),
        ]);
        if (cancelled || isProgrammaticMove.current > 0) return;

        const monitor = await resolveMonitor(cursor);
        if (!monitor || cancelled) return;

        // 使用精简窗口记住的可见横向位置来计算顶部感应区，避免隐藏态坐标造成误判
        const wa = monitor.workArea;
        const peekPx = Math.max(globalSettings.compactPeekHeight, 2);
        const maxBandLeft = wa.position.x + wa.size.width - size.width;
        const bandLeft = Math.min(
          Math.max(s.visibleX ?? wa.position.x, wa.position.x),
          Math.max(wa.position.x, maxBandLeft),
        );
        const bandRight = bandLeft + size.width;
        const inBand = cursor.y >= wa.position.y
          && cursor.y <= wa.position.y + peekPx + SUMMON_EDGE_BAND_PX
          && cursor.x >= bandLeft
          && cursor.x <= bandRight;

        if (inBand) {
          void compactReveal();
        }
      } catch {
        // ignore
      }
    };

    const id = window.setInterval(() => { void poll(); }, SUMMON_POLL_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [actualCompactMode, compactReveal, globalSettings.compactModeAutoHide, globalSettings.compactPeekHeight, hydrated, resolveMonitor]);

  // ── Cleanup timers on compact mode off ─────────────────────────
  useEffect(() => {
    if (!globalSettings.compactMode) {
      clearHideTimer();
      if (dragSettleTimerRef.current !== null) {
        window.clearTimeout(dragSettleTimerRef.current);
        dragSettleTimerRef.current = null;
      }
    }
    if (globalSettings.compactMode) {
      if (isSettingsOpen) setIsSettingsOpen(false);
      if (isTerminalOpen) setTerminalOpen(false);
    }
  }, [clearHideTimer, globalSettings.compactMode, isSettingsOpen, isTerminalOpen, setTerminalOpen]);

  // ── Cleanup on unmount ─────────────────────────────────────────
  useEffect(() => () => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    if (dragSettleTimerRef.current !== null) window.clearTimeout(dragSettleTimerRef.current);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void appWindow.setTitle(terminalTitle).catch((err) => console.warn('Failed to update window title:', err));
  }, [appWindow, hydrated, terminalTitle]);

  useEffect(() => {
    if (!hydrated) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcutEvent(event.target)) return;
      if (!eventMatchesShortcut(event, globalSettings.terminalToggleShortcut)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      toggleTerminalWithFit();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [globalSettings.terminalToggleShortcut, hydrated, toggleTerminalWithFit]);

  useEffect(() => {
    const unlistenPromise = listen<TerminalOutputPayload>(TERMINAL_OUTPUT_EVENT, (event) => {
      appendTerminalOutput(event.payload);
    });
    return () => { unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<CommandStatusPayload>(COMMAND_STATUS_EVENT, (event) => {
      const state = useStore.getState();
      const project = state.projects.find((item) => item.id === event.payload.projectId);
      const command = project?.commands.find((item) => item.id === event.payload.commandId);
      if (!command) return;

      if (event.payload.status === 'started') {
        if (command.status !== 'running' || (command.pid && command.pid !== event.payload.pid)) return;
        state.updateCommand(event.payload.projectId, event.payload.commandId, {
          status: 'running',
          pid: event.payload.pid,
        });
        return;
      }

      if (command.pid !== event.payload.pid) return;
      state.updateCommand(event.payload.projectId, event.payload.commandId, { status: 'idle', pid: null });
      state.syncProjectActiveCommand(event.payload.projectId);
      requestTerminalFit();
    });
    return () => { unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  useEffect(() => {
    if (!terminalVisible) return;
    requestTerminalFit();
    const timer = window.setTimeout(() => requestTerminalFit(), 120);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, terminalHeight, terminalVisible]);

  // ── Terminal drag handler ──────────────────────────────────────
  const handleDragStart = (event: React.MouseEvent) => {
    event.preventDefault();
    isDragging.current = true;
    setIsDraggingState(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      setTerminalHeight(window.innerHeight - moveEvent.clientY);
    };
    const handleMouseUp = () => {
      isDragging.current = false;
      setIsDraggingState(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      requestTerminalFit();
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // ── Compact drag state from Sidebar ────────────────────────────
  const handleCompactDragStateChange = useCallback((dragging: boolean) => {
    if (!dragging) return;
    isUserDragging.current = true;
    clearHideTimer();
    scheduleDockSettle();
  }, [clearHideTimer, scheduleDockSettle]);

  // ── Toggle compact mode ────────────────────────────────────────
  const handleToggleCompactMode = () => {
    const next = !actualCompactMode;
    if (next) {
      const token = compactToggleToken.current + 1;
      compactToggleToken.current = token;
      pendingAutoHide.current = globalSettings.compactModeAutoHide;
      setCompactModePreview(true);
      setIsSettingsOpen(false);
      setTerminalOpen(false);
      void applyCompactLayout({ cancelled: () => compactToggleToken.current !== token })
        .catch((error) => {
          console.warn('Failed to apply compact layout:', error);
          if (compactToggleToken.current === token) {
            pendingAutoHide.current = false;
            setCompactModePreview(null);
          }
        })
        .finally(() => {
          if (compactToggleToken.current !== token) return;
          updateGlobalSettings({ compactMode: true });
        });
      return;
    }

    compactToggleToken.current += 1;
    pendingAutoHide.current = false;
    setCompactModePreview(false);
    updateGlobalSettings({ compactMode: false });
  };

  const handleOpenSettings = () => {
    if (actualCompactMode) updateGlobalSettings({ compactMode: false });
    setIsSettingsOpen(true);
  };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div
      className="relative flex h-screen w-full flex-col overflow-hidden bg-slate-100/80 font-sans text-slate-800 transition-colors duration-300 dark:bg-[#0A0F1A] dark:text-slate-300"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {showCompactTriggerBandDebug && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-40 border border-amber-400/80 bg-amber-400/15 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)]"
            style={{ height: `${compactTriggerBandHeight}px` }}
          />
          <div className="pointer-events-none absolute left-2 top-2 z-50 rounded-md border border-amber-400/80 bg-amber-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-300">
            {t('顶部触发带调试')}
          </div>
        </>
      )}

      {!compactMode && <WindowTitleBar onToggleCompactMode={handleToggleCompactMode} />}

      <div className="flex min-h-0 flex-1 overflow-hidden bg-slate-100/60 dark:bg-[#0B1120]">
        <Sidebar
          onOpenSettings={handleOpenSettings}
          compactMode={compactMode}
          onToggleCompactMode={handleToggleCompactMode}
          onCompactDragStateChange={handleCompactDragStateChange}
        />

        {!compactMode && (
          <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-slate-50/70 dark:bg-[#0B1120]">
            {activeProject ? (
              <>
                <TopBar
                  isTerminalOpen={isTerminalOpen}
                  onTerminalToggle={toggleTerminalWithFit}
                />

                <div className="w-full flex-1 overflow-y-auto no-scrollbar bg-slate-50/40 dark:bg-[#0B1120]">
                  <ActionGrid />
                </div>

                {shouldRenderTerminalPanel && (
                  <div
                    className={`relative shrink-0 overflow-hidden ${isDraggingState ? '' : 'transition-[height,opacity] duration-200'}`}
                    style={{
                      height: terminalVisible ? terminalHeight : 0,
                      opacity: terminalVisible ? 1 : 0,
                    }}
                    aria-hidden={!terminalVisible}
                  >
                    <div
                      onMouseDown={handleDragStart}
                      className={`group absolute -top-1 left-0 z-30 flex h-2 w-full items-center justify-center ${terminalVisible ? 'cursor-ns-resize' : 'pointer-events-none opacity-0'}`}
                      title={t('拖拽调整终端高度')}
                    >
                      <div className="h-[3px] w-10 rounded-full bg-slate-300/90 transition-colors group-hover:bg-blue-400 dark:bg-slate-700/90 dark:group-hover:bg-blue-500" />
                    </div>

                    <div className={`relative h-full w-full ${terminalVisible ? '' : 'pointer-events-none'}`}>
                      {renderedTerminalProjectIds.map((projectId) => {
                        const isCurrentProject = projectId === activeProjectId;
                        return (
                          <div
                            key={projectId}
                            className={`absolute inset-0 ${isCurrentProject ? 'z-10 opacity-100' : 'pointer-events-none opacity-0'}`}
                            aria-hidden={!isCurrentProject}
                          >
                            <Suspense fallback={<div className="h-full w-full bg-white dark:bg-[#0B1120]" />}>
                              <TerminalPanel
                                className="h-full w-full"
                                onClose={() => setTerminalOpen(false)}
                                activeProjectId={projectId}
                                isOpen={terminalVisible && isCurrentProject}
                              />
                            </Suspense>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6">
                <div className="flex w-full max-w-md flex-col items-center rounded-2xl border border-slate-200/80 bg-white/80 px-8 py-10 text-center shadow-sm dark:border-slate-800/70 dark:bg-slate-900/70">
                  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-100 text-slate-500 dark:border-slate-700/70 dark:bg-slate-800/80 dark:text-slate-300">
                    <FolderKanban size={24} />
                  </div>
                  <h2 className="mb-2 text-xl font-semibold text-slate-800 dark:text-slate-100">{t('Welcome to FlashRun')}</h2>
                  <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{t('点击左侧 + 号添加你的第一个项目接入空间吧！')}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!compactMode && (
        <SettingsModal
          open={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onToggleCompactMode={handleToggleCompactMode}
        />
      )}
    </div>
  );
}

export default App;
