import { invoke } from '@tauri-apps/api/core';
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
  defaultEditor?: 'code' | 'cursor' | 'zed' | 'codebuddy' | 'antigravity';
}

export interface GlobalSettings {
  defaultEditor: 'code' | 'cursor' | 'zed' | 'codebuddy' | 'antigravity';
  theme: 'dark' | 'light' | 'system';
  language: 'zh' | 'en';
}

export interface TerminalTabItem {
  id: string;
  title: string;
}

export interface ProjectTerminalState {
  tabs: TerminalTabItem[];
  activeTabId: string | null;
}

interface UiPreferences {
  isTerminalOpen: boolean;
  terminalHeight: number;
  isSidebarExpanded: boolean;
  projectTerminals: Record<string, ProjectTerminalState>;
}

interface PersistedState {
  projects: Project[];
  activeProjectId: string | null;
  settings: GlobalSettings;
  uiPreferences: UiPreferences;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  defaultEditor: 'code',
  theme: 'system',
  language: 'zh',
};

const MIN_TERMINAL_HEIGHT = 150;
const MAX_TERMINAL_HEIGHT = 800;
const DEFAULT_TERMINAL_HEIGHT = 340;
let persistQueue: Promise<void> = Promise.resolve();
let isPersisting = false;
let needsPersist = false;

function createDefaultTerminalTab(title = 'Terminal 1'): TerminalTabItem {
  return {
    id: nanoid(),
    title,
  };
}

function createDefaultProjectTerminalState(): ProjectTerminalState {
  const defaultTab = createDefaultTerminalTab();
  return {
    tabs: [defaultTab],
    activeTabId: defaultTab.id,
  };
}

function serializeProjects(projects: Project[]): Project[] {
  return projects.map((project) => ({
    ...project,
    commands: project.commands.map((command) => ({
      ...command,
      status: 'idle',
      pid: null,
    })),
  }));
}

function sanitizeActiveProjectId(activeProjectId: string | null | undefined, projects: Project[]): string | null {
  if (!projects.length) {
    return null;
  }

  if (activeProjectId && projects.some((project) => project.id === activeProjectId)) {
    return activeProjectId;
  }

  return projects[0]?.id ?? null;
}

function clampTerminalHeight(height: number | null | undefined): number {
  const normalized = typeof height === 'number' && Number.isFinite(height)
    ? height
    : DEFAULT_TERMINAL_HEIGHT;

  return Math.max(MIN_TERMINAL_HEIGHT, Math.min(MAX_TERMINAL_HEIGHT, normalized));
}

function sanitizeProjectTerminalState(state?: Partial<ProjectTerminalState> | null): ProjectTerminalState {
  const tabs = Array.isArray(state?.tabs)
    ? state.tabs.filter((tab): tab is TerminalTabItem => (
      typeof tab?.id === 'string'
      && tab.id.length > 0
      && typeof tab?.title === 'string'
      && tab.title.length > 0
    ))
    : [];

  if (!tabs.length) {
    return createDefaultProjectTerminalState();
  }

  const activeTabId = state?.activeTabId && tabs.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : tabs[0].id;

  return {
    tabs,
    activeTabId,
  };
}

function sanitizeProjectTerminals(
  projectTerminals: Record<string, ProjectTerminalState> | undefined,
  projects: Project[],
): Record<string, ProjectTerminalState> {
  return projects.reduce<Record<string, ProjectTerminalState>>((result, project) => {
    result[project.id] = sanitizeProjectTerminalState(projectTerminals?.[project.id]);
    return result;
  }, {});
}

function sanitizeUiPreferences(uiPreferences: Partial<UiPreferences> | null | undefined, projects: Project[]): UiPreferences {
  return {
    isTerminalOpen: Boolean(uiPreferences?.isTerminalOpen),
    terminalHeight: clampTerminalHeight(uiPreferences?.terminalHeight),
    isSidebarExpanded: uiPreferences?.isSidebarExpanded ?? true,
    projectTerminals: sanitizeProjectTerminals(uiPreferences?.projectTerminals, projects),
  };
}

function sanitizePersistedState(state: Partial<PersistedState> | null | undefined): PersistedState {
  const projects = serializeProjects(Array.isArray(state?.projects) ? state.projects : []);

  return {
    projects,
    activeProjectId: sanitizeActiveProjectId(state?.activeProjectId, projects),
    settings: { ...DEFAULT_SETTINGS, ...(state?.settings ?? {}) },
    uiPreferences: sanitizeUiPreferences(state?.uiPreferences, projects),
  };
}

function buildUiPreferencesSnapshot(params: {
  isTerminalOpen: boolean;
  terminalHeight: number;
  isSidebarExpanded: boolean;
  projectTerminals: Record<string, ProjectTerminalState>;
}, projects: Project[]): UiPreferences {
  return sanitizeUiPreferences(params, projects);
}

function getNextTerminalTitle(tabs: TerminalTabItem[]): string {
  const maxIndex = tabs.reduce((max, tab) => {
    const match = /^Terminal\s+(\d+)$/i.exec(tab.title);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `Terminal ${maxIndex + 1}`;
}

let persistedStateCache: PersistedState = sanitizePersistedState(undefined);

async function loadPersistedState(): Promise<PersistedState> {
  const persistedState = await invoke<Partial<PersistedState> | null>('load_app_config');
  persistedStateCache = sanitizePersistedState(persistedState);
  return persistedStateCache;
}

function enqueuePersist(buildNextState: (state: PersistedState) => PersistedState) {
  persistedStateCache = sanitizePersistedState(buildNextState(persistedStateCache));
  needsPersist = true;

  if (isPersisting) {
    return persistQueue;
  }

  isPersisting = true;
  persistQueue = (async () => {
    while (needsPersist) {
      needsPersist = false;

      try {
        await invoke('save_app_config', { config: persistedStateCache });
      } catch (error) {
        console.error('Failed to persist FlashRun config:', error);
      }
    }
  })().finally(() => {
    isPersisting = false;
  });

  return persistQueue;
}

async function persistProjects(projects: Project[]) {
  await enqueuePersist((state) => sanitizePersistedState({
    ...state,
    projects,
  }));
}

async function persistSettings(settings: GlobalSettings) {
  await enqueuePersist((state) => sanitizePersistedState({
    ...state,
    settings,
  }));
}

async function persistActiveProject(activeProjectId: string | null) {
  await enqueuePersist((state) => sanitizePersistedState({
    ...state,
    activeProjectId,
  }));
}

async function persistUiPreferences(uiPreferences: UiPreferences) {
  await enqueuePersist((state) => sanitizePersistedState({
    ...state,
    uiPreferences,
  }));
}

export async function flushPersistence() {
  await persistQueue;
}

interface StoreState {
  projects: Project[];
  activeProjectId: string | null;
  globalSettings: GlobalSettings;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  addProject: (path: string, manager: string, scripts: Record<string, string>) => void;
  updateProjectManager: (projectId: string, newManager: string) => void;
  setActiveProject: (id: string) => void;
  removeProject: (id: string) => void;

  addCommand: (projectId: string, label: string, cmd: string) => void;
  updateCommand: (projectId: string, commandId: string, updates: Partial<Command>) => void;
  removeCommand: (projectId: string, commandId: string) => void;

  updateGlobalSettings: (settings: Partial<GlobalSettings>) => void;

  isTerminalOpen: boolean;
  terminalHeight: number;
  isSidebarExpanded: boolean;
  projectTerminals: Record<string, ProjectTerminalState>;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setTerminalHeight: (height: number) => void;
  setSidebarExpanded: (expanded: boolean) => void;
  addTerminalTab: (projectId: string) => void;
  closeTerminalTab: (projectId: string, tabId: string) => void;
  setActiveTerminalTab: (projectId: string, tabId: string) => void;
}

export const useStore = create<StoreState>((set) => ({
  projects: [],
  activeProjectId: null,
  globalSettings: DEFAULT_SETTINGS,
  hydrated: false,
  isTerminalOpen: false,
  terminalHeight: DEFAULT_TERMINAL_HEIGHT,
  isSidebarExpanded: true,
  projectTerminals: {},

  hydrate: async () => {
    try {
      const persistedState = await loadPersistedState();

      set({
        projects: persistedState.projects,
        activeProjectId: persistedState.activeProjectId,
        globalSettings: persistedState.settings,
        hydrated: true,
        isTerminalOpen: persistedState.uiPreferences.isTerminalOpen,
        terminalHeight: persistedState.uiPreferences.terminalHeight,
        isSidebarExpanded: persistedState.uiPreferences.isSidebarExpanded,
        projectTerminals: persistedState.uiPreferences.projectTerminals,
      });
    } catch (error) {
      console.error('Failed to hydrate FlashRun config:', error);
      set({
        projects: [],
        activeProjectId: null,
        globalSettings: DEFAULT_SETTINGS,
        hydrated: true,
        isTerminalOpen: false,
        terminalHeight: DEFAULT_TERMINAL_HEIGHT,
        isSidebarExpanded: true,
        projectTerminals: {},
      });
    }
  },

  addProject: (path, manager, scripts) => set((state) => {
    const name = path.split(/[/\\]/).filter(Boolean).pop() || 'Unnamed Project';
    if (state.projects.some((project) => project.path === path)) {
      return state;
    }

    const initCommands = Object.entries(scripts).map(([key]) => ({
      id: nanoid(),
      label: key,
      cmd: `${manager} run ${key}`,
      status: 'idle' as const,
      pid: null,
    }));

    const newProject: Project = { id: nanoid(), name, path, manager, commands: initCommands };
    const projects = [...state.projects, newProject];
    const activeProjectId = state.activeProjectId || newProject.id;
    const projectTerminals = {
      ...state.projectTerminals,
      [newProject.id]: createDefaultProjectTerminalState(),
    };

    void persistProjects(projects);
    void persistActiveProject(activeProjectId);
    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      projectTerminals,
    }, projects));

    return { projects, activeProjectId, projectTerminals };
  }),

  updateProjectManager: (projectId, newManager) => set((state) => {
    const projects = state.projects.map((project) => {
      if (project.id !== projectId) {
        return project;
      }

      const oldManager = project.manager;
      return {
        ...project,
        manager: newManager,
        commands: project.commands.map((command) => {
          const regex = new RegExp(`^${oldManager}\\b`);
          return { ...command, cmd: command.cmd.replace(regex, newManager) };
        }),
      };
    });

    void persistProjects(projects);
    return { projects };
  }),

  setActiveProject: (id) => {
    void persistActiveProject(id);
    set({ activeProjectId: id });
  },

  removeProject: (id) => set((state) => {
    const projects = state.projects.filter((project) => project.id !== id);
    const activeProjectId = state.activeProjectId === id
      ? sanitizeActiveProjectId(null, projects)
      : sanitizeActiveProjectId(state.activeProjectId, projects);

    const nextProjectTerminals = { ...state.projectTerminals };
    delete nextProjectTerminals[id];
    const projectTerminals = sanitizeProjectTerminals(nextProjectTerminals, projects);

    void persistProjects(projects);
    void persistActiveProject(activeProjectId);
    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      projectTerminals,
    }, projects));

    return {
      projects,
      activeProjectId,
      projectTerminals,
    };
  }),

  addCommand: (projectId, label, cmd) => set((state) => {
    const projects = state.projects.map((project) =>
      project.id === projectId
        ? { ...project, commands: [...project.commands, { id: nanoid(), label, cmd, status: 'idle' as const, pid: null }] }
        : project,
    );

    void persistProjects(projects);
    return { projects };
  }),

  updateCommand: (projectId, commandId, updates) => set((state) => {
    const projects = state.projects.map((project) =>
      project.id === projectId
        ? { ...project, commands: project.commands.map((command) => (command.id === commandId ? { ...command, ...updates } : command)) }
        : project,
    );

    if (!('status' in updates) && !('pid' in updates)) {
      void persistProjects(projects);
    }

    return { projects };
  }),

  removeCommand: (projectId, commandId) => set((state) => {
    const projects = state.projects.map((project) =>
      project.id === projectId
        ? { ...project, commands: project.commands.filter((command) => command.id !== commandId) }
        : project,
    );

    void persistProjects(projects);
    return { projects };
  }),

  updateGlobalSettings: (settings) => set((state) => {
    const globalSettings = { ...state.globalSettings, ...settings };
    void persistSettings(globalSettings);
    return { globalSettings };
  }),

  setTerminalOpen: (open) => set((state) => {
    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: open,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      projectTerminals: state.projectTerminals,
    }, state.projects));

    return { isTerminalOpen: open };
  }),

  toggleTerminal: () => set((state) => {
    const isTerminalOpen = !state.isTerminalOpen;
    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      projectTerminals: state.projectTerminals,
    }, state.projects));

    return { isTerminalOpen };
  }),

  setTerminalHeight: (height) => set((state) => {
    const terminalHeight = clampTerminalHeight(height);
    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      projectTerminals: state.projectTerminals,
    }, state.projects));

    return { terminalHeight };
  }),

  setSidebarExpanded: (expanded) => set((state) => {
    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: expanded,
      projectTerminals: state.projectTerminals,
    }, state.projects));

    return { isSidebarExpanded: expanded };
  }),

  addTerminalTab: (projectId) => set((state) => {
    if (!state.projects.some((project) => project.id === projectId)) {
      return state;
    }

    const terminalState = sanitizeProjectTerminalState(state.projectTerminals[projectId]);
    const newTab: TerminalTabItem = {
      id: nanoid(),
      title: getNextTerminalTitle(terminalState.tabs),
    };
    const projectTerminals = {
      ...state.projectTerminals,
      [projectId]: {
        tabs: [...terminalState.tabs, newTab],
        activeTabId: newTab.id,
      },
    };

    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      projectTerminals,
    }, state.projects));

    return { projectTerminals };
  }),

  closeTerminalTab: (projectId, tabId) => set((state) => {
    const terminalState = sanitizeProjectTerminalState(state.projectTerminals[projectId]);
    if (terminalState.tabs.length <= 1) {
      return state;
    }

    const tabs = terminalState.tabs.filter((tab) => tab.id !== tabId);
    if (tabs.length === terminalState.tabs.length) {
      return state;
    }

    const activeTabId = terminalState.activeTabId === tabId
      ? tabs[tabs.length - 1]?.id ?? tabs[0]?.id ?? null
      : terminalState.activeTabId;

    const projectTerminals = {
      ...state.projectTerminals,
      [projectId]: {
        tabs,
        activeTabId,
      },
    };

    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      projectTerminals,
    }, state.projects));

    return { projectTerminals };
  }),

  setActiveTerminalTab: (projectId, tabId) => set((state) => {
    const terminalState = sanitizeProjectTerminalState(state.projectTerminals[projectId]);
    if (!terminalState.tabs.some((tab) => tab.id === tabId)) {
      return state;
    }

    const projectTerminals = {
      ...state.projectTerminals,
      [projectId]: {
        ...terminalState,
        activeTabId: tabId,
      },
    };

    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      projectTerminals,
    }, state.projects));

    return { projectTerminals };
  }),
}));
