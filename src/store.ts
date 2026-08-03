import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import {
  type ShortcutDefinition,
  getDefaultTerminalShortcut,
  sanitizeShortcutDefinition,
} from './utils/shortcuts';

export interface Command {
  id: string;
  label: string;
  cmd: string;
  status: 'idle' | 'running';
  pid: number | null;
  isDefault: boolean;
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
  terminalToggleShortcut: ShortcutDefinition;
  compactMode: boolean;
  compactModeAutoHide: boolean;
  compactPeekHeight: number;
  compactTriggerBandDebug: boolean;
}

export interface TerminalTabItem {
  id: string;
  title: string;
}

export interface ProjectTerminalState {
  tabs: TerminalTabItem[];
  activeTabId: string | null;
}

export interface AddProjectResult {
  status: 'added' | 'exists';
  projectId: string;
}

interface UiPreferences {
  isTerminalOpen: boolean;
  terminalHeight: number;
  isSidebarExpanded: boolean;
  sidebarWidth: number;
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
  terminalToggleShortcut: getDefaultTerminalShortcut(),
  compactMode: false,
  compactModeAutoHide: true,
  compactPeekHeight: 4,
  compactTriggerBandDebug: false,
};

const MIN_TERMINAL_HEIGHT = 150;
const MAX_TERMINAL_HEIGHT = 800;
const DEFAULT_TERMINAL_HEIGHT = 340;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 252;
const MIN_COMPACT_PEEK_HEIGHT = 2;
const MAX_COMPACT_PEEK_HEIGHT = 5;
let persistQueue: Promise<void> = Promise.resolve();
let isPersisting = false;
let needsPersist = false;

function createDefaultTerminalTab(title = 'Terminal 1'): TerminalTabItem {
  return {
    id: nanoid(),
    title,
  };
}

function normalizeTerminalTabs(tabs: TerminalTabItem[]): TerminalTabItem[] {
  return tabs.map((tab, index) => ({
    ...tab,
    title: `Terminal ${index + 1}`,
  }));
}

function createDefaultProjectTerminalState(): ProjectTerminalState {
  const defaultTab = createDefaultTerminalTab();
  return {
    tabs: [defaultTab],
    activeTabId: defaultTab.id,
  };
}

function clampTerminalHeight(height: number | null | undefined): number {
  const normalized = typeof height === 'number' && Number.isFinite(height)
    ? height
    : DEFAULT_TERMINAL_HEIGHT;

  return Math.max(MIN_TERMINAL_HEIGHT, Math.min(MAX_TERMINAL_HEIGHT, normalized));
}

function clampSidebarWidth(width: number | null | undefined): number {
  const normalized = typeof width === 'number' && Number.isFinite(width)
    ? Math.round(width)
    : DEFAULT_SIDEBAR_WIDTH;

  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, normalized));
}

function clampCompactPeekHeight(height: number | null | undefined): number {
  const normalized = typeof height === 'number' && Number.isFinite(height)
    ? Math.round(height)
    : DEFAULT_SETTINGS.compactPeekHeight;

  return Math.max(MIN_COMPACT_PEEK_HEIGHT, Math.min(MAX_COMPACT_PEEK_HEIGHT, normalized));
}

function sanitizeCommand(command: Partial<Command> | null | undefined): Command | null {
  const label = typeof command?.label === 'string' ? command.label.trim() : '';
  const cmd = typeof command?.cmd === 'string' ? command.cmd.trim() : '';

  if (!label || !cmd) {
    return null;
  }

  return {
    id: typeof command?.id === 'string' && command.id ? command.id : nanoid(),
    label,
    cmd,
    status: 'idle',
    pid: null,
    isDefault: Boolean(command?.isDefault),
  };
}

function ensureSingleDefaultCommand(commands: Command[]): Command[] {
  if (!commands.length) {
    return commands;
  }

  let defaultIndex = commands.findIndex((command) => command.isDefault);
  if (defaultIndex < 0) {
    defaultIndex = 0;
  }

  return commands.map((command, index) => ({
    ...command,
    isDefault: index === defaultIndex,
  }));
}

function sanitizeCommands(commands: Array<Partial<Command>> | null | undefined): Command[] {
  let defaultFound = false;

  const sanitizedCommands = (Array.isArray(commands) ? commands : [])
    .map((command) => sanitizeCommand(command))
    .filter((command): command is Command => Boolean(command))
    .map((command) => {
      const isDefault = command.isDefault && !defaultFound;
      if (isDefault) {
        defaultFound = true;
      }

      return {
        ...command,
        isDefault,
      };
    });

  return ensureSingleDefaultCommand(sanitizedCommands);
}

function sanitizeProject(project: Partial<Project> | null | undefined): Project | null {
  const name = typeof project?.name === 'string' ? project.name.trim() : '';
  const path = typeof project?.path === 'string' ? project.path.trim() : '';
  const manager = typeof project?.manager === 'string' && project.manager.trim() ? project.manager.trim() : 'npm';

  if (!name || !path) {
    return null;
  }

  return {
    id: typeof project?.id === 'string' && project.id ? project.id : nanoid(),
    name,
    path,
    manager,
    commands: sanitizeCommands(project?.commands as Array<Partial<Command>> | undefined),
    defaultEditor: project?.defaultEditor,
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

function sanitizeProjects(projects: Array<Partial<Project>> | null | undefined): Project[] {
  return serializeProjects(
    (Array.isArray(projects) ? projects : [])
      .map((project) => sanitizeProject(project))
      .filter((project): project is Project => Boolean(project)),
  );
}

function normalizeProjectPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const isWindowsPath = /^[a-z]:(?:\/|$)/i.test(normalized) || normalized.startsWith('//');
  return isWindowsPath ? normalized.toLocaleLowerCase('en-US') : normalized;
}

export function areProjectPathsEqual(leftPath: string, rightPath: string): boolean {
  return normalizeProjectPath(leftPath) === normalizeProjectPath(rightPath);
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

function sanitizeProjectTerminalState(state?: Partial<ProjectTerminalState> | null): ProjectTerminalState {
  const tabs = Array.isArray(state?.tabs)
    ? normalizeTerminalTabs(state.tabs.filter((tab): tab is TerminalTabItem => (
      typeof tab?.id === 'string'
      && tab.id.length > 0
      && typeof tab?.title === 'string'
      && tab.title.length > 0
    )))
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
    sidebarWidth: clampSidebarWidth(uiPreferences?.sidebarWidth),
    projectTerminals: sanitizeProjectTerminals(uiPreferences?.projectTerminals, projects),
  };
}

function sanitizeGlobalSettings(settings: Partial<GlobalSettings> | null | undefined): GlobalSettings {
  return {
    defaultEditor: settings?.defaultEditor ?? DEFAULT_SETTINGS.defaultEditor,
    theme: settings?.theme ?? DEFAULT_SETTINGS.theme,
    language: settings?.language ?? DEFAULT_SETTINGS.language,
    terminalToggleShortcut: sanitizeShortcutDefinition(settings?.terminalToggleShortcut),
    compactMode: settings?.compactMode ?? DEFAULT_SETTINGS.compactMode,
    compactModeAutoHide: settings?.compactModeAutoHide ?? DEFAULT_SETTINGS.compactModeAutoHide,
    compactPeekHeight: clampCompactPeekHeight(settings?.compactPeekHeight),
    compactTriggerBandDebug: settings?.compactTriggerBandDebug ?? DEFAULT_SETTINGS.compactTriggerBandDebug,
  };
}

function sanitizePersistedState(state: Partial<PersistedState> | null | undefined): PersistedState {
  const projects = sanitizeProjects(state?.projects);

  return {
    projects,
    activeProjectId: sanitizeActiveProjectId(state?.activeProjectId, projects),
    settings: sanitizeGlobalSettings(state?.settings),
    uiPreferences: sanitizeUiPreferences(state?.uiPreferences, projects),
  };
}

function buildUiPreferencesSnapshot(params: {
  isTerminalOpen: boolean;
  terminalHeight: number;
  isSidebarExpanded: boolean;
  sidebarWidth: number;
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

function createActiveCommandMap(projects: Project[]): Record<string, string | null> {
  return projects.reduce<Record<string, string | null>>((result, project) => {
    result[project.id] = null;
    return result;
  }, {});
}

function resolvePreferredRunningCommandId(commands: Command[], preferredCommandId: string | null | undefined) {
  if (preferredCommandId && commands.some((command) => command.id === preferredCommandId && command.status === 'running')) {
    return preferredCommandId;
  }

  return [...commands].reverse().find((command) => command.status === 'running')?.id ?? null;
}

function buildInitialCommands(manager: string, scripts: Record<string, string>): Command[] {
  const scriptEntries = Object.entries(scripts);
  const defaultLabel = scriptEntries.find(([key]) => key === 'dev')?.[0] ?? scriptEntries[0]?.[0] ?? null;

  return scriptEntries.map(([key]) => ({
    id: nanoid(),
    label: key,
    cmd: `${manager} run ${key}`,
    status: 'idle' as const,
    pid: null,
    isDefault: key === defaultLabel,
  }));
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
  activeCommandByProject: Record<string, string | null>;

  hydrate: () => Promise<void>;
  addProject: (path: string, manager: string, scripts: Record<string, string>) => AddProjectResult;
  updateProjectManager: (projectId: string, newManager: string) => void;
  setActiveProject: (id: string) => void;
  removeProject: (id: string) => void;
  reorderProjects: (orderedProjectIds: string[]) => void;

  addCommand: (projectId: string, label: string, cmd: string, options?: { isDefault?: boolean }) => void;
  updateCommand: (projectId: string, commandId: string, updates: Partial<Command>) => void;
  removeCommand: (projectId: string, commandId: string) => void;
  reorderCommands: (projectId: string, orderedCommandIds: string[]) => void;

  updateGlobalSettings: (settings: Partial<GlobalSettings>) => void;

  isTerminalOpen: boolean;
  terminalHeight: number;
  isSidebarExpanded: boolean;
  sidebarWidth: number;
  projectTerminals: Record<string, ProjectTerminalState>;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setTerminalHeight: (height: number) => void;
  setSidebarExpanded: (expanded: boolean) => void;
  setSidebarWidth: (width: number) => void;
  addTerminalTab: (projectId: string) => void;
  closeTerminalTab: (projectId: string, tabId: string) => void;
  setActiveTerminalTab: (projectId: string, tabId: string) => void;
  setProjectActiveCommand: (projectId: string, commandId: string | null) => void;
  syncProjectActiveCommand: (projectId: string) => void;
}

export const useStore = create<StoreState>((set) => ({
  projects: [],
  activeProjectId: null,
  globalSettings: DEFAULT_SETTINGS,
  hydrated: false,
  activeCommandByProject: {},
  isTerminalOpen: false,
  terminalHeight: DEFAULT_TERMINAL_HEIGHT,
  isSidebarExpanded: true,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  projectTerminals: {},

  hydrate: async () => {
    try {
      const persistedState = await loadPersistedState();

      set({
        projects: persistedState.projects,
        activeProjectId: persistedState.activeProjectId,
        globalSettings: persistedState.settings,
        hydrated: true,
        activeCommandByProject: createActiveCommandMap(persistedState.projects),
        isTerminalOpen: persistedState.uiPreferences.isTerminalOpen,
        terminalHeight: persistedState.uiPreferences.terminalHeight,
        isSidebarExpanded: persistedState.uiPreferences.isSidebarExpanded,
        sidebarWidth: persistedState.uiPreferences.sidebarWidth,
        projectTerminals: persistedState.uiPreferences.projectTerminals,
      });
    } catch (error) {
      console.error('Failed to hydrate FlashRun config:', error);
      set({
        projects: [],
        activeProjectId: null,
        globalSettings: DEFAULT_SETTINGS,
        hydrated: true,
        activeCommandByProject: {},
        isTerminalOpen: false,
        terminalHeight: DEFAULT_TERMINAL_HEIGHT,
        isSidebarExpanded: true,
        sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
        projectTerminals: {},
      });
    }
  },

  addProject: (path, manager, scripts) => {
    const projectId = nanoid();
    let result: AddProjectResult = { status: 'added', projectId };

    set((state) => {
      const name = path.split(/[/\\]/).filter(Boolean).pop() || 'Unnamed Project';
      const existingProject = state.projects.find((project) => areProjectPathsEqual(project.path, path));
      if (existingProject) {
        result = { status: 'exists', projectId: existingProject.id };
        return state;
      }

      const newProject: Project = {
        id: projectId,
        name,
        path,
        manager,
        commands: buildInitialCommands(manager, scripts),
      };
      const projects = [...state.projects, newProject];
      const activeProjectId = state.activeProjectId || newProject.id;
      const projectTerminals = {
        ...state.projectTerminals,
        [newProject.id]: createDefaultProjectTerminalState(),
      };
      const activeCommandByProject = {
        ...state.activeCommandByProject,
        [newProject.id]: null,
      };

      void persistProjects(projects);
      void persistActiveProject(activeProjectId);
      void persistUiPreferences(buildUiPreferencesSnapshot({
        isTerminalOpen: state.isTerminalOpen,
        terminalHeight: state.terminalHeight,
        isSidebarExpanded: state.isSidebarExpanded,
        sidebarWidth: state.sidebarWidth,
        projectTerminals,
      }, projects));

      return { projects, activeProjectId, projectTerminals, activeCommandByProject };
    });

    return result;
  },

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

    const activeCommandByProject = { ...state.activeCommandByProject };
    delete activeCommandByProject[id];

    void persistProjects(projects);
    void persistActiveProject(activeProjectId);
    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      sidebarWidth: state.sidebarWidth,
      projectTerminals,
    }, projects));

    return {
      projects,
      activeProjectId,
      projectTerminals,
      activeCommandByProject,
    };
  }),

  reorderProjects: (orderedProjectIds) => set((state) => {
    const projectMap = new Map(state.projects.map((project) => [project.id, project]));
    const orderedProjects = orderedProjectIds
      .map((projectId) => projectMap.get(projectId))
      .filter((project): project is Project => Boolean(project));
    const orderedIdSet = new Set(orderedProjectIds);
    const projects = [
      ...orderedProjects,
      ...state.projects.filter((project) => !orderedIdSet.has(project.id)),
    ];

    void persistProjects(projects);
    return { projects };
  }),

  addCommand: (projectId, label, cmd, options) => set((state) => {
    const projects = state.projects.map((project) => {
      if (project.id !== projectId) {
        return project;
      }

      const nextCommand: Command = {
        id: nanoid(),
        label,
        cmd,
        status: 'idle',
        pid: null,
        isDefault: Boolean(options?.isDefault),
      };

      const nextCommands = options?.isDefault
        ? [...project.commands.map((command) => ({ ...command, isDefault: false })), nextCommand]
        : [...project.commands, nextCommand];

      return {
        ...project,
        commands: ensureSingleDefaultCommand(nextCommands),
      };
    });

    void persistProjects(projects);
    return { projects };
  }),

  updateCommand: (projectId, commandId, updates) => set((state) => {
    const projects = state.projects.map((project) => {
      if (project.id !== projectId) {
        return project;
      }

      const clearOtherDefaults = updates.isDefault === true;
      const nextCommands = project.commands.map((command) => {
        if (command.id === commandId) {
          return {
            ...command,
            ...updates,
            isDefault: updates.isDefault ?? command.isDefault,
          };
        }

        if (clearOtherDefaults) {
          return {
            ...command,
            isDefault: false,
          };
        }

        return command;
      });

      return {
        ...project,
        commands: ensureSingleDefaultCommand(nextCommands),
      };
    });

    if (!('status' in updates) && !('pid' in updates)) {
      void persistProjects(projects);
    }

    return { projects };
  }),

  removeCommand: (projectId, commandId) => set((state) => {
    const projects = state.projects.map((project) => {
      if (project.id !== projectId) {
        return project;
      }

      return {
        ...project,
        commands: ensureSingleDefaultCommand(project.commands.filter((command) => command.id !== commandId)),
      };
    });

    const nextProject = projects.find((project) => project.id === projectId);
    const activeCommandByProject = {
      ...state.activeCommandByProject,
      [projectId]: resolvePreferredRunningCommandId(nextProject?.commands ?? [], state.activeCommandByProject[projectId]),
    };

    void persistProjects(projects);
    return { projects, activeCommandByProject };
  }),

  reorderCommands: (projectId, orderedCommandIds) => set((state) => {
    const projects = state.projects.map((project) => {
      if (project.id !== projectId) {
        return project;
      }

      const commandMap = new Map(project.commands.map((command) => [command.id, command]));
      const ordered = orderedCommandIds
        .map((commandId) => commandMap.get(commandId))
        .filter((command): command is Command => Boolean(command));
      const orderedIdSet = new Set(orderedCommandIds);
      const rest = project.commands.filter((command) => !orderedIdSet.has(command.id));

      return {
        ...project,
        commands: [...ordered, ...rest],
      };
    });

    void persistProjects(projects);
    return { projects };
  }),

  updateGlobalSettings: (settings) => set((state) => {
    const globalSettings = sanitizeGlobalSettings({
      ...state.globalSettings,
      ...settings,
    });
    void persistSettings(globalSettings);
    return { globalSettings };
  }),

  setTerminalOpen: (open) => set((state) => {
    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: open,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      sidebarWidth: state.sidebarWidth,
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
      sidebarWidth: state.sidebarWidth,
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
      sidebarWidth: state.sidebarWidth,
      projectTerminals: state.projectTerminals,
    }, state.projects));

    return { terminalHeight };
  }),

  setSidebarExpanded: (expanded) => set((state) => {
    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: expanded,
      sidebarWidth: state.sidebarWidth,
      projectTerminals: state.projectTerminals,
    }, state.projects));

    return { isSidebarExpanded: expanded };
  }),

  setSidebarWidth: (width) => set((state) => {
    const sidebarWidth = clampSidebarWidth(width);
    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      sidebarWidth,
      projectTerminals: state.projectTerminals,
    }, state.projects));

    return { sidebarWidth };
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
        tabs: normalizeTerminalTabs([...terminalState.tabs, newTab]),
        activeTabId: newTab.id,
      },
    };

    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      sidebarWidth: state.sidebarWidth,
      projectTerminals,
    }, state.projects));

    return { projectTerminals };
  }),

  closeTerminalTab: (projectId, tabId) => set((state) => {
    const terminalState = sanitizeProjectTerminalState(state.projectTerminals[projectId]);
    if (terminalState.tabs.length <= 1) {
      return state;
    }

    const closedTabIndex = terminalState.tabs.findIndex((tab) => tab.id === tabId);
    const tabs = normalizeTerminalTabs(terminalState.tabs.filter((tab) => tab.id !== tabId));
    if (tabs.length === terminalState.tabs.length) {
      return state;
    }

    const activeTabId = terminalState.activeTabId === tabId
      ? tabs[Math.min(Math.max(closedTabIndex, 0), tabs.length - 1)]?.id ?? tabs[0]?.id ?? null
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
      sidebarWidth: state.sidebarWidth,
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
      sidebarWidth: state.sidebarWidth,
      projectTerminals,
    }, state.projects));

    return { projectTerminals };
  }),

  setProjectActiveCommand: (projectId, commandId) => set((state) => ({
    activeCommandByProject: {
      ...state.activeCommandByProject,
      [projectId]: commandId,
    },
  })),

  syncProjectActiveCommand: (projectId) => set((state) => {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      return state;
    }

    return {
      activeCommandByProject: {
        ...state.activeCommandByProject,
        [projectId]: resolvePreferredRunningCommandId(project.commands, state.activeCommandByProject[projectId]),
      },
    };
  }),
}));
