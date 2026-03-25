import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { load, Store } from '@tauri-apps/plugin-store';

export interface Command {
  id: string;
  label: string;
  cmd: string;
  status: 'idle' | 'running';
  pid: number | null;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  manager: string;
  commands: Command[];
  defaultEditor?: 'code' | 'cursor' | 'codebuddy' | 'antigravity';
}

export interface GlobalSettings {
  defaultEditor: 'code' | 'cursor' | 'codebuddy' | 'antigravity';
  theme: 'dark' | 'light' | 'system';
  language: 'zh' | 'en';
}

const DEFAULT_SETTINGS: GlobalSettings = {
  defaultEditor: 'code',
  theme: 'system',
  language: 'zh',
};

// 磁盘持久化单例
let diskStore: Store | null = null;

async function getDiskStore(): Promise<Store> {
  if (!diskStore) {
    diskStore = await load('flashrun-config.json', { autoSave: true, defaults: {} });
  }
  return diskStore;
}

// 把项目列表写入磁盘（只序列化纯数据，忽略运行态）
async function persistProjects(projects: Project[]) {
  const store = await getDiskStore();
  // 写入时将所有命令的运行状态重置为 idle（重启后重新初始化）
  const toSave = projects.map(p => ({
    ...p,
    commands: p.commands.map(c => ({ ...c, status: 'idle', pid: null })),
  }));
  await store.set('projects', toSave);
}

async function persistSettings(settings: GlobalSettings) {
  const store = await getDiskStore();
  await store.set('settings', settings);
}

interface StoreState {
  projects: Project[];
  activeProjectId: string | null;
  globalSettings: GlobalSettings;
  hydrated: boolean; // 是否已从磁盘加载完毕

  hydrate: () => Promise<void>;
  addProject: (path: string, manager: string, scripts: Record<string, string>) => void;
  updateProjectManager: (projectId: string, newManager: string) => void;
  setActiveProject: (id: string) => void;
  removeProject: (id: string) => void;

  addCommand: (projectId: string, label: string, cmd: string) => void;
  updateCommand: (projectId: string, commandId: string, updates: Partial<Command>) => void;
  removeCommand: (projectId: string, commandId: string) => void;

  updateGlobalSettings: (settings: Partial<GlobalSettings>) => void;

  // UI 状态 - 终端面板可见性
  isTerminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
}

export const useStore = create<StoreState>((set) => ({
  projects: [],
  activeProjectId: null,
  globalSettings: DEFAULT_SETTINGS,
  hydrated: false,
  isTerminalOpen: false,

  setTerminalOpen: (open) => set({ isTerminalOpen: open }),
  toggleTerminal: () => set((state) => ({ isTerminalOpen: !state.isTerminalOpen })),

  // 从磁盘读取持久化数据，在 App 初始化时调用一次
  hydrate: async () => {
    const store = await getDiskStore();
    const savedProjects = await store.get<Project[]>('projects');
    const savedSettings = await store.get<GlobalSettings>('settings');
    set({
      projects: savedProjects ?? [],
      activeProjectId: savedProjects?.[0]?.id ?? null,
      globalSettings: savedSettings ?? DEFAULT_SETTINGS,
      hydrated: true,
    });
  },

  addProject: (path, manager, scripts) => set((state) => {
    const name = path.split(/[/\\]/).filter(Boolean).pop() || 'Unnamed Project';
    if (state.projects.some(p => p.path === path)) return state;

    const initCommands = Object.entries(scripts).map(([key]) => ({
      id: nanoid(),
      label: key,
      cmd: `${manager} run ${key}`,
      status: 'idle' as const,
      pid: null,
    }));

    const newProject: Project = { id: nanoid(), name, path, manager, commands: initCommands };
    const projects = [...state.projects, newProject];
    persistProjects(projects);
    return { projects, activeProjectId: state.activeProjectId || newProject.id };
  }),

  updateProjectManager: (projectId, newManager) => set((state) => {
    const projects = state.projects.map(p => {
      if (p.id !== projectId) return p;
      const oldManager = p.manager;
      return {
        ...p,
        manager: newManager,
        commands: p.commands.map(cmd => {
          const regex = new RegExp(`^${oldManager}\\b`);
          return { ...cmd, cmd: cmd.cmd.replace(regex, newManager) };
        }),
      };
    });
    persistProjects(projects);
    return { projects };
  }),

  setActiveProject: (id) => set({ activeProjectId: id }),

  removeProject: (id) => set((state) => {
    const projects = state.projects.filter(p => p.id !== id);
    persistProjects(projects);
    return {
      projects,
      activeProjectId: state.activeProjectId === id
        ? (projects[0]?.id || null)
        : state.activeProjectId,
    };
  }),

  addCommand: (projectId, label, cmd) => set((state) => {
    const projects = state.projects.map(p =>
      p.id === projectId
        ? { ...p, commands: [...p.commands, { id: nanoid(), label, cmd, status: 'idle' as const, pid: null }] }
        : p
    );
    persistProjects(projects);
    return { projects };
  }),

  updateCommand: (projectId, commandId, updates) => set((state) => {
    const projects = state.projects.map(p =>
      p.id === projectId
        ? { ...p, commands: p.commands.map(c => c.id === commandId ? { ...c, ...updates } : c) }
        : p
    );
    // 运行状态变化不需要落盘（重启后统一 reset）
    if (!('status' in updates) && !('pid' in updates)) {
      persistProjects(projects);
    }
    return { projects };
  }),

  removeCommand: (projectId, commandId) => set((state) => {
    const projects = state.projects.map(p =>
      p.id === projectId
        ? { ...p, commands: p.commands.filter(c => c.id !== commandId) }
        : p
    );
    persistProjects(projects);
    return { projects };
  }),

  updateGlobalSettings: (settings) => set((state) => {
    const globalSettings = { ...state.globalSettings, ...settings };
    persistSettings(globalSettings);
    return { globalSettings };
  }),
}));
