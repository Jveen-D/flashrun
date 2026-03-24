import { create } from 'zustand';
import { nanoid } from 'nanoid';

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

interface StoreState {
  projects: Project[];
  activeProjectId: string | null;
  globalSettings: GlobalSettings;
  
  addProject: (path: string, manager: string, scripts: Record<string, string>) => void;
  updateProjectManager: (projectId: string, newManager: string) => void;
  setActiveProject: (id: string) => void;
  removeProject: (id: string) => void;
  
  addCommand: (projectId: string, label: string, cmd: string) => void;
  updateCommand: (projectId: string, commandId: string, updates: Partial<Command>) => void;
  removeCommand: (projectId: string, commandId: string) => void;
  
  updateGlobalSettings: (settings: Partial<GlobalSettings>) => void;
}

export const useStore = create<StoreState>((set) => ({
  projects: [],
  activeProjectId: null,
  globalSettings: {
    defaultEditor: 'code',
    theme: 'system',
    language: 'zh',
  },

  addProject: (path, manager, scripts) => set((state) => {
    // 提取路径末尾作为项目名称
    const name = path.split(/[/\\]/).filter(Boolean).pop() || 'Unnamed Project';
    // 检查是否已经存在该路径的项目
    if (state.projects.some(p => p.path === path)) {
      return state;
    }

    const initCommands = Object.entries(scripts).map(([key, _]) => ({
      id: nanoid(),
      label: key,
      cmd: `${manager} run ${key}`,
      status: 'idle' as const,
      pid: null
    }));

    const newProject: Project = {
      id: nanoid(),
      name,
      path,
      manager,
      commands: initCommands
    };
    return {
      projects: [...state.projects, newProject],
      activeProjectId: state.activeProjectId || newProject.id
    };
  }),

  updateProjectManager: (projectId, newManager) => set((state) => ({
    projects: state.projects.map(p => {
      if (p.id !== projectId) return p;
      const oldManager = p.manager;
      return {
        ...p,
        manager: newManager,
        commands: p.commands.map(cmd => {
          // 只替换开头的包管理器名称，比如将 'npm run dev' 换成 'pnpm run dev'
          const regex = new RegExp(`^${oldManager}\\b`);
          return {
            ...cmd,
            cmd: cmd.cmd.replace(regex, newManager)
          };
        })
      };
    })
  })),

  setActiveProject: (id) => set({ activeProjectId: id }),

  removeProject: (id) => set((state) => ({
    projects: state.projects.filter(p => p.id !== id),
    activeProjectId: state.activeProjectId === id 
      ? (state.projects.find(p => p.id !== id)?.id || null) 
      : state.activeProjectId
  })),

  addCommand: (projectId, label, cmd) => set((state) => ({
    projects: state.projects.map(p => 
      p.id === projectId 
        ? { ...p, commands: [...p.commands, { id: nanoid(), label, cmd, status: 'idle', pid: null }] } 
        : p
    )
  })),

  updateCommand: (projectId, commandId, updates) => set((state) => ({
    projects: state.projects.map(p => 
      p.id === projectId 
        ? {
            ...p,
            commands: p.commands.map(c => c.id === commandId ? { ...c, ...updates } : c)
          }
        : p
    )
  })),

  removeCommand: (projectId, commandId) => set((state) => ({
    projects: state.projects.map(p => 
      p.id === projectId 
        ? { ...p, commands: p.commands.filter(c => c.id !== commandId) } 
        : p
    )
  })),

  updateGlobalSettings: (settings) => set((state) => ({
    globalSettings: { ...state.globalSettings, ...settings }
  }))
}));
