import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleStop,
  FolderKanban,
  FolderOpen,
  Layers,
  Play,
  Search,
  Settings,
  Square,
  SquareTerminal,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { useCommandRunner } from '../hooks/useCommandRunner';
import { EDITOR_LABEL_MAP } from '../utils/editors';
import { toast } from '../utils/toast';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onToggleTerminal: () => void;
}

interface PaletteAction {
  id: string;
  category: string;
  title: string;
  subtitle?: string;
  badge?: string;
  icon: typeof Play;
  keywords: string;
  run: () => void | Promise<void>;
}

export function CommandPalette({
  open,
  onClose,
  onOpenSettings,
  onToggleTerminal,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const projects = useStore((state) => state.projects);
  const launchGroups = useStore((state) => state.launchGroups);
  const activeProjectId = useStore((state) => state.activeProjectId);
  const globalDefaultEditor = useStore((state) => state.globalSettings.defaultEditor);
  const setActiveProject = useStore((state) => state.setActiveProject);
  const {
    runCommand,
    stopCommand,
    stopAllCommands,
    runLaunchGroup,
    stopLaunchGroup,
  } = useCommandRunner();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const actions = useMemo<PaletteAction[]>(() => {
    const items: PaletteAction[] = [];

    const trimmed = query.trim();
    const portMatch = /^(?::|port\s+)?(\d{2,5})$/i.exec(trimmed);
    if (portMatch) {
      const port = Number(portMatch[1]);
      if (port >= 1 && port <= 65535) {
        items.push({
          id: `port-${port}`,
          category: t('快捷操作'),
          title: t('检查并释放 TCP 端口 {{port}}', { port }),
          subtitle: t('列出监听进程并确认后终止'),
          icon: CircleStop,
          keywords: `port ${port} :${port}`,
          run: async () => {
            try {
              const expected = await invoke<Array<{ pid: number; name: string }>>('inspect_port', { port, protocol: 'tcp' });
              if (!expected.length) {
                toast.info(t('端口 {{port}} 当前未被占用。', { port }));
                return;
              }
              const processList = expected.map((p) => `${p.name} (PID ${p.pid})`).join('\n');
              const approved = await confirm(
                t('{{protocol}} {{port}}\n{{processes}}\n\n终止这些进程？未保存的工作可能丢失。', {
                  protocol: 'TCP',
                  port,
                  processes: processList,
                }),
                { title: t('释放端口'), kind: 'warning' },
              );
              if (!approved) return;
              const result = await invoke<{ port: number; killedPids: number[] }>('terminate_port', {
                port,
                protocol: 'tcp',
                expected,
              });
              toast.success(t('端口 {{port}} 已终止 {{count}} 个进程。', { port, count: result.killedPids.length }));
            } catch (error) {
              toast.error(t('终止端口失败：{{error}}', { error: String(error) }));
            }
          },
        });
      }
    }

    for (const group of launchGroups) {
      const runningInGroup = group.items.filter((item) => {
        const proj = projects.find((p) => p.id === item.projectId);
        return proj?.commands.some((c) => c.id === item.commandId && c.status === 'running');
      }).length;
      const isRunning = runningInGroup > 0;
      items.push({
        id: `group-${group.id}`,
        category: t('启动组'),
        title: isRunning ? t('停止启动组：{{name}}', { name: group.name }) : t('启动分组：{{name}}', { name: group.name }),
        subtitle: `${runningInGroup}/${group.items.length}`,
        badge: isRunning ? t('运行中') : t('启动组'),
        icon: Layers,
        keywords: `${group.name} group launch`,
        run: async () => {
          try {
            if (isRunning) {
              await stopLaunchGroup(group.id);
            } else {
              await runLaunchGroup(group.id);
            }
          } catch (error) {
            toast.error(String(error));
          }
        },
      });
    }

    for (const project of projects) {
      items.push({
        id: `project-${project.id}`,
        category: t('切换项目'),
        title: project.name,
        subtitle: project.path,
        badge: project.manager.toUpperCase(),
        icon: FolderKanban,
        keywords: `${project.name} ${project.path} ${project.manager}`,
        run: () => setActiveProject(project.id),
      });

      for (const command of project.commands) {
        const isRunning = command.status === 'running';
        items.push({
          id: `cmd-${project.id}-${command.id}`,
          category: t('运行 / 停止命令'),
          title: `${project.name} / ${command.label}`,
          subtitle: command.cwd ? `${command.cwd} · $ ${command.cmd}` : `$ ${command.cmd}`,
          badge: isRunning ? t('停止') : t('运行'),
          icon: isRunning ? Square : Play,
          keywords: `${project.name} ${command.label} ${command.cmd} ${command.cwd ?? ''}`,
          run: async () => {
            try {
              if (isRunning) {
                await stopCommand(project.id, command.id);
              } else {
                await runCommand(project.id, command.id);
              }
            } catch (error) {
              toast.error(String(error));
            }
          },
        });
      }
    }

    const activeProject = projects.find((project) => project.id === activeProjectId);
    if (activeProject) {
      const editorKey = activeProject.defaultEditor ?? globalDefaultEditor;
      const editorLabel = EDITOR_LABEL_MAP[editorKey] || editorKey;
      items.push({
        id: 'action-open-editor',
        category: t('快捷操作'),
        title: t('在 {{editor}} 中打开', { editor: editorLabel }),
        subtitle: activeProject.name,
        icon: FolderOpen,
        keywords: `editor open ${editorLabel} ${activeProject.name}`,
        run: async () => {
          try {
            await invoke('open_in_editor', { path: activeProject.path, editorKey });
          } catch (error) {
            toast.error(String(error));
          }
        },
      });
    }

    const totalRunning = projects.reduce(
      (sum, project) => sum + project.commands.filter((c) => c.status === 'running').length,
      0,
    );
    if (totalRunning > 0) {
      items.push({
        id: 'action-stop-all',
        category: t('快捷操作'),
        title: t('停止全部运行中服务 ({{count}})', { count: totalRunning }),
        icon: Square,
        keywords: 'stop all kill services',
        run: async () => {
          try {
            await stopAllCommands();
            toast.info(t('已停止全部运行中服务。'));
          } catch (error) {
            toast.error(String(error));
          }
        },
      });
    }

    items.push(
      {
        id: 'action-toggle-terminal',
        category: t('快捷操作'),
        title: t('切换底部终端面板'),
        icon: SquareTerminal,
        keywords: 'terminal toggle shell',
        run: onToggleTerminal,
      },
      {
        id: 'action-open-settings',
        category: t('快捷操作'),
        title: t('打开全局设置'),
        icon: Settings,
        keywords: 'settings preferences config',
        run: onOpenSettings,
      },
    );

    if (!trimmed) {
      return items.slice(0, 30);
    }

    const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    return items
      .filter((item) => {
        const haystack = `${item.title} ${item.subtitle ?? ''} ${item.category} ${item.keywords}`.toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 30);
  }, [
    activeProjectId,
    globalDefaultEditor,
    launchGroups,
    onOpenSettings,
    onToggleTerminal,
    projects,
    query,
    runCommand,
    runLaunchGroup,
    setActiveProject,
    stopAllCommands,
    stopCommand,
    stopLaunchGroup,
    t,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) {
    return null;
  }

  const clampedIndex = Math.min(selectedIndex, Math.max(0, actions.length - 1));

  const executeSelected = (action?: PaletteAction) => {
    if (!action) return;
    onClose();
    void action.run();
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center bg-black/35 px-4 pt-20 backdrop-blur-[2px] dark:bg-black/65"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[65vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-2xl dark:border-slate-700/80 dark:bg-slate-900/95">
        <div className="flex items-center gap-2.5 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800">
          <Search size={16} className="shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((current) => (actions.length ? (current + 1) % actions.length : 0));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((current) => (actions.length ? (current - 1 + actions.length) % actions.length : 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                executeSelected(actions[clampedIndex]);
              }
            }}
            placeholder={t('搜索项目、命令、启动组，或输入 :3000 查杀端口...')}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            ESC
          </kbd>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {actions.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              {t('未找到匹配项')}
            </div>
          ) : (
            actions.map((action, index) => {
              const Icon = action.icon;
              const isSelected = index === clampedIndex;
              return (
                <button
                  key={action.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => executeSelected(action)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <Icon size={15} className={`shrink-0 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{action.title}</div>
                    {action.subtitle && (
                      <div className={`truncate font-mono text-[11px] ${isSelected ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'}`}>
                        {action.subtitle}
                      </div>
                    )}
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    isSelected
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}>
                    {action.badge ?? action.category}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
