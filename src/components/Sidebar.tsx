import React from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { areProjectPathsEqual, useStore } from '../store';
import { useTranslation } from 'react-i18next';
import { FolderKanban, GripVertical, PanelLeft, PanelLeftClose, Play, Plus, Settings, Square } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import logoUrl from '../assets/logo.jpg';
import { useCommandRunner } from '../hooks/useCommandRunner';

interface SidebarProps {
  onOpenSettings: () => void;
  compactMode: boolean;
  onToggleCompactMode: () => void;
  onCompactDragStateChange?: (dragging: boolean) => void;
}

const COLLAPSED_SIDEBAR_WIDTH = 68;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 420;

const projectNameClampStyle: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

function clampSidebarWidth(width: number) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)));
}

interface SortableProjectItemProps {
  id: string;
  onClick: () => void;
  dragLabel: string;
  expanded: boolean;
  children: React.ReactNode;
}

function SortableProjectItem({ id, onClick, dragLabel, expanded, children }: SortableProjectItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`group relative flex w-full cursor-pointer items-center justify-center ${isDragging ? 'z-30 opacity-70' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onClick}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        onClick={(event) => event.stopPropagation()}
        className={`absolute z-30 flex h-5 w-5 cursor-grab items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-white hover:text-slate-600 group-hover:opacity-100 active:cursor-grabbing dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300 ${expanded ? 'right-1 top-1' : 'bottom-0 left-0'}`}
        title={dragLabel}
      >
        <GripVertical size={12} />
      </button>
      {children}
    </div>
  );
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings, compactMode, onToggleCompactMode, onCompactDragStateChange }) => {
  const {
    projects,
    activeProjectId,
    setActiveProject,
    addProject,
    isSidebarExpanded,
    setSidebarExpanded,
    sidebarWidth,
    setSidebarWidth,
    reorderProjects,
  } = useStore();
  const { runDefaultCommand, stopCommand } = useCommandRunner();
  const { t } = useTranslation();
  const asideRef = React.useRef<HTMLElement | null>(null);
  const appWindow = React.useMemo(() => getCurrentWindow(), []);
  const [isResizing, setIsResizing] = React.useState(false);
  const [liveSidebarWidth, setLiveSidebarWidth] = React.useState(sidebarWidth);
  const effectiveExpanded = compactMode || isSidebarExpanded;
  const renderedSidebarWidth = `${effectiveExpanded ? liveSidebarWidth : COLLAPSED_SIDEBAR_WIDTH}px`;
  const projectIds = React.useMemo(() => projects.map((project) => project.id), [projects]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  React.useEffect(() => {
    if (!isResizing) {
      setLiveSidebarWidth(sidebarWidth);
    }
  }, [isResizing, sidebarWidth]);

  React.useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (compactMode || !effectiveExpanded) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsResizing(true);

    const asideLeft = asideRef.current?.getBoundingClientRect().left ?? 0;
    let nextWidth = liveSidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      nextWidth = clampSidebarWidth(moveEvent.clientX - asideLeft);
      setLiveSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setSidebarWidth(nextWidth);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleAddProject = async () => {
    try {
      const path = await open({
        directory: true,
        multiple: false,
      });
      if (typeof path === 'string') {
        const existingProject = projects.find((project) => areProjectPathsEqual(project.path, path));
        if (existingProject) {
          setActiveProject(existingProject.id);
          alert(t('项目“{{project}}”已接入，无需重复添加。', { project: existingProject.name }));
          return;
        }

        const projectInfo = await invoke<{ manager: string; scripts: Record<string, string> }>('parse_project_info', { path });
        const result = addProject(path, projectInfo.manager, projectInfo.scripts);
        if (result.status === 'exists') {
          const concurrentProject = useStore.getState().projects.find((project) => project.id === result.projectId);
          setActiveProject(result.projectId);
          alert(t('项目“{{project}}”已接入，无需重复添加。', {
            project: concurrentProject?.name ?? path,
          }));
        }
      }
    } catch (error) {
      console.error('Failed to add project:', error);
      alert(error);
    }
  };

  const handleProjectDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = projectIds.indexOf(String(active.id));
    const newIndex = projectIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    reorderProjects(arrayMove(projectIds, oldIndex, newIndex));
  };

  const handleCompactDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!compactMode || event.button !== 0) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button')) {
      return;
    }

    onCompactDragStateChange?.(true);
    void appWindow.startDragging().catch(() => {});
  };

  return (
    <aside
      ref={asideRef}
      className={`relative z-10 flex h-full shrink-0 select-none flex-col overflow-hidden border-r border-slate-200/80 bg-slate-100/90 py-3 backdrop-blur-sm ${isResizing ? '' : 'transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]'} dark:border-slate-800/80 dark:bg-[#0D1423]/95`}
      style={{ width: renderedSidebarWidth }}
    >
      <div
        className={`mb-4 flex w-full items-center shrink-0 transition-all duration-300 ${compactMode ? 'cursor-move' : ''} ${effectiveExpanded ? 'justify-between px-4' : 'flex-col justify-center gap-3 px-0'}`}
        onMouseDown={handleCompactDragStart}
      >
        <div className={`flex items-center ${!effectiveExpanded && 'justify-center'}`}>
          <img
            src={logoUrl}
            alt="Logo"
            className="h-8 w-8 shrink-0 rounded-lg border border-slate-200/80 object-cover shadow-sm dark:border-slate-700/60"
          />
          <span className={`overflow-hidden whitespace-nowrap text-lg font-bold tracking-tight text-slate-800 transition-all duration-300 dark:text-white ${effectiveExpanded ? 'ml-2.5 w-auto opacity-100' : 'ml-0 w-0 opacity-0'}`}>
            {t('FlashRun')}
          </span>
        </div>

        <button
          onClick={compactMode ? onToggleCompactMode : () => setSidebarExpanded(!isSidebarExpanded)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-400 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-700 dark:text-slate-500 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-white"
          title={compactMode ? t('退出精简模式') : effectiveExpanded ? t('收起侧边栏') : t('展开侧边栏')}
        >
          {compactMode ? <PanelLeft size={18} /> : effectiveExpanded ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>
      </div>

      <div className={`mb-3 shrink-0 transition-all duration-300 ${effectiveExpanded ? 'px-4' : 'px-3'}`}>
        <div className="h-px w-full rounded-full bg-slate-200/90 dark:bg-slate-800/90" />
      </div>

      <div className={`flex w-full flex-1 flex-col space-y-1.5 overflow-y-auto no-scrollbar pb-4 transition-all duration-300 ${effectiveExpanded ? 'px-3' : 'items-center px-2'}`}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleProjectDragEnd}>
          <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
          {projects.map((project) => {
          const isActive = project.id === activeProjectId;
          const isRunning = project.commands.some((command) => command.status === 'running');
          const defaultCommand = project.commands.find((command) => command.isDefault);
          const isDefaultRunning = defaultCommand?.status === 'running';

          const handleDefaultAction = (event: React.MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            if (!defaultCommand) {
              return;
            }

            const action = isDefaultRunning
              ? stopCommand(project.id, defaultCommand.id)
              : runDefaultCommand(project.id);

            void action.catch((error) => {
              console.error(error);
              alert(t(isDefaultRunning ? '停止进程失败：{{error}}' : '运行命令失败：{{error}}', {
                error: String(error),
              }));
            });
          };

          return (
            <SortableProjectItem
              key={project.id}
              id={project.id}
              onClick={() => setActiveProject(project.id)}
              dragLabel={t('拖拽排序')}
              expanded={effectiveExpanded}
            >
              <div className={`absolute -left-2 top-1/2 z-10 w-1 -translate-y-1/2 rounded-r-md transition-all duration-300 ${
                isActive
                  ? isRunning
                    ? 'h-9 bg-emerald-500'
                    : 'h-7 bg-blue-600 dark:bg-blue-400'
                  : isRunning
                    ? 'h-5 bg-emerald-400/90 opacity-90 group-hover:h-7'
                    : 'h-0 bg-blue-500/70 opacity-60 group-hover:h-4'
              }`} />

              <div className={`flex w-full items-center rounded-xl border transition-all duration-200 ${effectiveExpanded ? 'p-2' : 'justify-center p-1'} ${
                isActive
                  ? isRunning
                    ? 'border-emerald-200/80 bg-emerald-50/80 shadow-sm dark:border-emerald-500/20 dark:bg-emerald-500/10'
                    : 'border-blue-200/80 bg-blue-50/80 shadow-sm dark:border-blue-500/25 dark:bg-blue-500/10'
                  : isRunning
                    ? 'border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/10 hover:bg-emerald-50 dark:hover:bg-emerald-500/15'
                    : 'border-transparent bg-transparent hover:border-slate-200/80 hover:bg-white/70 dark:hover:border-slate-700/60 dark:hover:bg-slate-900/60'
              }`}>
                <div
                  className={`relative flex shrink-0 items-center justify-center transition-all duration-200 ${effectiveExpanded ? 'h-9 w-9' : 'h-10 w-10'} ${
                    isActive
                      ? 'rounded-lg bg-blue-600 text-white shadow-sm dark:bg-blue-500'
                      : isRunning
                        ? 'rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300'
                        : 'rounded-lg bg-slate-200/90 text-slate-500 group-hover:bg-white group-hover:text-blue-500 dark:bg-slate-800/90 dark:text-slate-400 dark:group-hover:bg-slate-800 dark:group-hover:text-blue-400'
                  }`}
                >
                  <FolderKanban size={effectiveExpanded ? 18 : 20} strokeWidth={isActive ? 2.4 : 2} />

                  {!effectiveExpanded && defaultCommand && (
                    <button
                      type="button"
                      onClick={handleDefaultAction}
                      className={`absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full text-white shadow-sm transition-all ${
                        isDefaultRunning
                          ? 'scale-100 bg-rose-500 opacity-100 hover:bg-rose-400'
                          : 'scale-90 bg-emerald-500 opacity-0 group-hover:scale-100 group-hover:opacity-100 hover:bg-emerald-400'
                      }`}
                      title={isDefaultRunning ? t('停止默认启动命令') : t('运行默认启动命令')}
                    >
                      {isDefaultRunning ? <Square size={8} className="fill-current" /> : <Play size={9} className="ml-[1px] fill-current" />}
                    </button>
                  )}

                  {isRunning && (
                    <span className="absolute -right-1 -top-1 z-20 flex h-3.5 w-3.5 items-center justify-center">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    </span>
                  )}
                </div>

                <div className={`min-w-0 flex-col justify-center overflow-hidden transition-all duration-300 ${
                  effectiveExpanded ? 'ml-3 flex flex-1 opacity-100' : 'ml-0 w-0 opacity-0'
                }`}>
                  <div
                    className={`break-words whitespace-normal text-sm font-semibold leading-5 transition-colors ${
                      isActive
                        ? 'text-slate-800 dark:text-white'
                        : isRunning
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-slate-600 group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-slate-100'
                    }`}
                    style={projectNameClampStyle}
                    title={project.name}
                  >
                    {project.name}
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {project.manager}
                  </div>
                </div>

                {effectiveExpanded && defaultCommand && (
                  <button
                    type="button"
                    onClick={handleDefaultAction}
                    className={`ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-all ${
                      isDefaultRunning
                        ? 'border-rose-500 bg-rose-500 text-white hover:bg-rose-400'
                        : 'scale-95 border-emerald-200 bg-white text-emerald-600 opacity-0 group-hover:scale-100 group-hover:opacity-100 hover:bg-emerald-50 dark:border-emerald-500/25 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-emerald-500/10'
                    }`}
                    title={isDefaultRunning ? t('停止默认启动命令') : t('运行默认启动命令')}
                  >
                    {isDefaultRunning ? <Square size={12} className="fill-current" /> : <Play size={12} className="ml-[1px] fill-current" />}
                  </button>
                )}
              </div>

              {!effectiveExpanded && (
                <div className="pointer-events-none absolute left-[60px] top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-all origin-left scale-95 group-hover:scale-100 group-hover:opacity-100 dark:border-slate-800 dark:bg-black/95">
                  {project.name}
                  {defaultCommand ? ` · ${isDefaultRunning ? t('默认启动运行中') : t('可一键运行默认启动')}` : ''}
                </div>
              )}
            </SortableProjectItem>
          );
        })}
          </SortableContext>
        </DndContext>

        <div className="relative mt-2 flex w-full justify-center pt-2">
          <button
            onClick={handleAddProject}
            className={`group flex w-full items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/80 text-emerald-600 transition-all duration-300 hover:border-emerald-400 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-800/25 dark:text-emerald-500 dark:hover:border-emerald-500/40 dark:hover:bg-emerald-500/10 ${effectiveExpanded ? 'p-2' : 'justify-center p-1'}`}
            title={!effectiveExpanded ? t('接入新项目') : undefined}
          >
            <div className={`flex shrink-0 items-center justify-center rounded-lg bg-slate-200/90 shadow-sm transition-colors group-hover:bg-emerald-500 group-hover:text-white dark:bg-slate-800 ${effectiveExpanded ? 'h-9 w-9' : 'h-10 w-10'}`}>
              <Plus size={effectiveExpanded ? 18 : 20} strokeWidth={2.5} />
            </div>
            <span className={`overflow-hidden whitespace-nowrap text-sm font-semibold text-slate-500 transition-all group-hover:text-emerald-600 dark:text-slate-400 dark:group-hover:text-emerald-400 ${effectiveExpanded ? 'ml-3 w-auto opacity-100' : 'ml-0 w-0 opacity-0'}`}>{t('接入新项目')}</span>
          </button>
        </div>
      </div>

      <div className={`mt-auto w-full shrink-0 border-t border-slate-200/80 pt-4 transition-all dark:border-slate-800/80 ${effectiveExpanded ? 'px-4' : 'flex justify-center px-2'}`}>
        <button
          onClick={onOpenSettings}
          className={`group flex w-full items-center rounded-xl border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-white ${effectiveExpanded ? 'p-2' : 'justify-center p-2 leading-none'}`}
          title={!effectiveExpanded ? t('全局设置') : undefined}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200/90 transition-colors group-hover:bg-slate-300 dark:bg-slate-800/70 dark:group-hover:bg-slate-700">
            <Settings size={17} className="transition-transform duration-300 group-hover:rotate-45" />
          </div>
          <span className={`overflow-hidden whitespace-nowrap text-sm font-semibold transition-all ${effectiveExpanded ? 'ml-3 opacity-100' : 'ml-0 w-0 opacity-0'}`}>{t('全局设置')}</span>
        </button>
      </div>

      {!compactMode && effectiveExpanded && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('拖拽调整侧边栏宽度')}
          onMouseDown={handleResizeStart}
          className="group absolute inset-y-0 right-0 z-20 flex w-3 cursor-col-resize items-center justify-center"
          title={t('拖拽调整侧边栏宽度')}
        >
          <div className={`h-full w-px transition-colors ${isResizing ? 'bg-blue-500/80 dark:bg-blue-400/80' : 'bg-slate-200/90 group-hover:bg-blue-400 dark:bg-slate-700/90 dark:group-hover:bg-blue-500'}`} />
        </div>
      )}
    </aside>
  );
};
