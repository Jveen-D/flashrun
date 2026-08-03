import React, { useMemo, useState } from 'react';
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore, Command } from '../store';
import { Play, Square, TerminalSquare, Plus, Settings2, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CommandConfigModal } from './CommandConfigModal';
import { useCommandRunner } from '../hooks/useCommandRunner';

interface SortableCommandCardProps {
  command: Command;
  onEdit: (command: Command, event: React.MouseEvent) => void;
  onRun: (command: Command) => void;
  onStop: (command: Command) => void;
  onRestart: (command: Command) => void;
  onSetDefault: (command: Command) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function SortableCommandCard({
  command,
  onEdit,
  onRun,
  onStop,
  onRestart,
  onSetDefault,
  t,
}: SortableCommandCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: command.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  };
  const isRunning = command.status === 'running';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex min-h-[144px] flex-col rounded-xl p-3.5 will-change-transform transition-[background-color,border-color,box-shadow,transform] duration-150 ${
        isDragging
          ? 'z-20 scale-[1.015] cursor-grabbing shadow-2xl ring-2 ring-blue-400/60'
          : ''
      } ${
        isRunning
          ? 'border border-blue-200/80 bg-blue-50/75 shadow-sm dark:border-blue-500/25 dark:bg-blue-500/10'
          : 'border border-slate-200/80 bg-white/85 hover:border-slate-300 hover:bg-white dark:border-slate-700/60 dark:bg-slate-900/40 dark:hover:border-slate-600 dark:hover:bg-slate-800/55'
      }`}
    >
      <div className="mb-auto flex items-start justify-between gap-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing touch-none select-none text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-300 transition-colors text-sm"
              title={t('拖拽排序')}
            >
              ⋮⋮
            </button>
            <span className="truncate text-base font-semibold tracking-tight text-slate-800 transition-colors dark:text-slate-200">
              {command.label}
            </span>
            {command.isDefault && (
              <span className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400">
                {t('默认启动')}
              </span>
            )}
          </div>
          <p className="truncate font-mono text-[11px] text-slate-500 opacity-75 dark:text-slate-400" title={command.cmd}>
            $ {command.cmd}
          </p>
        </div>

        <button
          onClick={(event) => onEdit(command, event)}
          className="shrink-0 rounded-md border border-transparent p-1.5 text-slate-400 opacity-0 transition-[opacity,color,background-color,border-color] group-hover:opacity-100 hover:border-slate-200/80 hover:bg-white hover:text-slate-600 dark:text-slate-500 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          title={t('编辑配置')}
        >
          <Settings2 size={15} />
        </button>
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-slate-200/80 pt-3.5 transition-colors dark:border-slate-700/60">
        <button
          type="button"
          onClick={() => onSetDefault(command)}
          disabled={command.isDefault}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
            command.isDefault
              ? 'cursor-default border-emerald-200 bg-emerald-50/80 text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400'
              : 'border-slate-200 bg-slate-50/90 text-slate-600 hover:border-emerald-300 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:border-emerald-500/40 dark:hover:text-emerald-400'
          }`}
          title={command.isDefault ? t('默认启动') : t('设为默认启动')}
        >
          <Sparkles size={13} />
          <span>{command.isDefault ? t('默认启动') : t('设为默认启动')}</span>
        </button>

        <div className="flex items-center gap-1.5">
          {isRunning ? (
            <>
              <button
                onClick={() => onRestart(command)}
                className="flex items-center gap-1.5 rounded-md border border-yellow-200 bg-yellow-50 px-2.5 py-1 text-[11px] font-medium text-yellow-600 transition-colors hover:bg-yellow-100 dark:border-yellow-500/20 dark:bg-yellow-500/10 dark:text-yellow-500 dark:hover:bg-yellow-500/20"
                title={t('重启')}
              >
                <RefreshCw size={13} />
                <span>{t('重启')}</span>
              </button>
              <button
                onClick={() => onStop(command)}
                className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-500 dark:hover:bg-red-500/20"
                title={t('停止')}
              >
                <Square size={13} className="fill-current" />
                <span>{t('停止')}</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => onRun(command)}
              className="flex items-center space-x-1.5 rounded-md border border-blue-500 bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-500"
              title={t('运行')}
            >
              <Play size={14} className="fill-current" />
              <span>{t('运行')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const ActionGrid: React.FC = () => {
  const { projects, activeProjectId, addCommand, updateCommand, reorderCommands } = useStore();
  const { runCommand, stopCommand, restartCommand } = useCommandRunner();

  const { t } = useTranslation();
  const [editingCommand, setEditingCommand] = useState<Command | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 2,
      },
    }),
  );

  const commandIds = useMemo(
    () => activeProject?.commands.map((command) => command.id) ?? [],
    [activeProject?.commands],
  );

  if (!activeProject) {
    return null;
  }

  const handleRun = async (command: Command) => {
    try {
      await runCommand(activeProject.id, command.id);
    } catch (error) {
      console.error(error);
      alert(t('运行命令失败：{{error}}', { error: String(error) }));
    }
  };

  const handleStop = async (command: Command) => {
    try {
      await stopCommand(activeProject.id, command.id);
    } catch (error) {
      console.error(error);
      alert(t('停止进程失败：{{error}}', { error: String(error) }));
    }
  };

  const handleRestart = async (command: Command) => {
    try {
      await restartCommand(activeProject.id, command.id);
    } catch (error) {
      console.error(error);
      alert(t('重启进程失败：{{error}}', { error: String(error) }));
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = activeProject.commands.findIndex((command) => command.id === active.id);
    const newIndex = activeProject.commands.findIndex((command) => command.id === over.id);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const nextCommands = arrayMove(activeProject.commands, oldIndex, newIndex);
    reorderCommands(activeProject.id, nextCommands.map((command) => command.id));
  };

  const handleSetDefault = (command: Command) => {
    if (command.isDefault) {
      return;
    }

    updateCommand(activeProject.id, command.id, { isDefault: true });
  };

  const handleCreateSubmit = (values: { label: string; cmd: string; isDefault: boolean }) => {
    addCommand(activeProject.id, values.label, values.cmd, { isDefault: values.isDefault });
    setIsCreateOpen(false);
  };

  const handleEditSubmit = (values: { label: string; cmd: string; isDefault: boolean }) => {
    if (!editingCommand) {
      return;
    }

    updateCommand(activeProject.id, editingCommand.id, {
      label: values.label,
      cmd: values.cmd,
      isDefault: values.isDefault,
    });
    setEditingCommand(null);
  };

  return (
    <>
      <div className="p-4">
        <div className="mb-4 flex items-end justify-between gap-4 border-b border-slate-200/80 pb-3 transition-colors dark:border-slate-800/70">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
              <TerminalSquare size={17} className="text-blue-500" />
              {t('Console Commands')}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
              {t('拖动左上角把手可排序；任意命令都可一键设为默认启动。')}
            </p>
          </div>
          <div className="shrink-0 rounded-md border border-slate-200/80 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-400">
            {activeProject.commands.length} {t('条命令')}
          </div>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={commandIds} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {activeProject.commands.map((command) => (
                <SortableCommandCard
                  key={command.id}
                  command={command}
                  onEdit={(nextCommand, event) => {
                    event.stopPropagation();
                    setEditingCommand(nextCommand);
                  }}
                  onRun={handleRun}
                  onStop={handleStop}
                  onRestart={handleRestart}
                  onSetDefault={handleSetDefault}
                  t={t}
                />
              ))}

              <button
                onClick={() => setIsCreateOpen(true)}
                className="group flex min-h-[144px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300/90 bg-slate-50/70 p-4 text-slate-500 transition-all hover:border-blue-400 hover:bg-white hover:text-blue-500 dark:border-slate-700 dark:bg-slate-800/20 dark:hover:border-blue-500/50 dark:hover:bg-slate-800/40 dark:hover:text-blue-400"
              >
                <Plus size={22} className="mb-2 transition-transform group-hover:scale-110" />
                <span className="text-sm font-medium tracking-wide">{t('添加自定义命令')}</span>
              </button>
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <CommandConfigModal
        open={isCreateOpen}
        mode="create"
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreateSubmit}
      />
      <CommandConfigModal
        open={Boolean(editingCommand)}
        mode="edit"
        initialCommand={editingCommand}
        onClose={() => setEditingCommand(null)}
        onSubmit={handleEditSubmit}
      />
    </>
  );
};
