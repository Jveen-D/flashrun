import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import {
  type ShortcutDefinition,
  getDefaultTerminalShortcut,
  sanitizeShortcutDefinition,
} from './utils/shortcuts';
import { commandOutputKey } from './utils/terminal';
import { remapProjectPath, type FlashRunConfigExport } from './utils/configTransfer';

export interface CommandRuntimeInfo {
  startedAt: number | null;
  lastExitCode: number | null;
  lastDurationMs: number | null;
  detectedUrls: string[];
  portConflict: number | null;
}

export type ProjectTerminalView =
  | { mode: 'shell' }
  | { mode: 'command'; commandId: string };

export type EditorKey = 'code' | 'cursor' | 'zed' | 'codebuddy' | 'antigravity';

const VALID_EDITORS = new Set<EditorKey>(['code', 'cursor', 'zed', 'codebuddy', 'antigravity']);
export const JS_PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;

export function isJsPackageManager(manager: string): boolean {
  return (JS_PACKAGE_MANAGERS as readonly string[]).includes(manager);
}

export interface DetectedCommand {
  label: string;
  cmd: string;
}

export interface ProjectInfoPayload {
  manager: string;
  scripts: Record<string, string>;
  commands?: DetectedCommand[];
}

export interface Command {
  id: string;
  label: string;
  cmd: string;
  status: 'idle' | 'running';
  pid: number | null;
  isDefault: boolean;
  cwd?: string;
  env?: Record<string, string>;
  envFile?: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  manager: string;
  commands: Command[];
  defaultEditor?: EditorKey;
}

export interface LaunchGroupItem {
  projectId: string;
  commandId: string;
}

export interface LaunchGroup {
  id: string;
  name: string;
  items: LaunchGroupItem[];
}

export interface GlobalSettings {
  defaultEditor: EditorKey;
  defaultShell: string;
  theme: 'dark' | 'light' | 'system';
  language: 'zh' | 'en';
  terminalToggleShortcut: ShortcutDefinition;
  minimizeToTrayOnClose: boolean;
  globalWindowShortcut: ShortcutDefinition | null;
}

export interface WindowStatePreference {
  width: number;
  height: number;
  maximized: boolean;
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
  windowState?: WindowStatePreference;
}

interface PersistedState {
  projects: Project[];
  launchGroups: LaunchGroup[];
  activeProjectId: string | null;
  settings: GlobalSettings;
  uiPreferences: UiPreferences;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  defaultEditor: 'code',
  defaultShell: 'auto',
  theme: 'system',
  language: 'zh',
  terminalToggleShortcut: getDefaultTerminalShortcut(),
  minimizeToTrayOnClose: false,
  globalWindowShortcut: null,
};

const MIN_TERMINAL_HEIGHT = 150;
const MAX_TERMINAL_HEIGHT = 800;
const DEFAULT_TERMINAL_HEIGHT = 340;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 252;
let persistQueue: Promise<void> = Promise.resolve();
let isPersisting = false;
let needsPersist = false;
let persistenceAllowed = false;
let hydratePromise: Promise<void> | null = null;

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

function sanitizeEnvRecord(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const trimmedKey = key.trim();
    if (trimmedKey && typeof value === 'string') {
      result[trimmedKey] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeCommand(command: Partial<Command> | null | undefined): Command | null {
  const label = typeof command?.label === 'string' ? command.label.trim() : '';
  const cmd = typeof command?.cmd === 'string' ? command.cmd.trim() : '';

  if (!label || !cmd) {
    return null;
  }

  const cwd = typeof command?.cwd === 'string' && command.cwd.trim() ? command.cwd.trim() : undefined;
  const envFile = typeof command?.envFile === 'string' && command.envFile.trim() ? command.envFile.trim() : undefined;
  const env = sanitizeEnvRecord(command?.env);

  return {
    id: typeof command?.id === 'string' && command.id ? command.id : nanoid(),
    label,
    cmd,
    status: 'idle',
    pid: null,
    isDefault: Boolean(command?.isDefault),
    ...(cwd ? { cwd } : {}),
    ...(envFile ? { envFile } : {}),
    ...(env ? { env } : {}),
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

function sanitizeEditorKey(editor: unknown): EditorKey | undefined {
  return typeof editor === 'string' && VALID_EDITORS.has(editor as EditorKey)
    ? (editor as EditorKey)
    : undefined;
}

function sanitizeProject(project: Partial<Project> | null | undefined): Project | null {
  const name = typeof project?.name === 'string' ? project.name.trim() : '';
  const path = typeof project?.path === 'string' ? project.path.trim() : '';
  const manager = typeof project?.manager === 'string' && project.manager.trim() ? project.manager.trim() : 'npm';

  if (!name || !path) {
    return null;
  }

  const defaultEditor = sanitizeEditorKey(project?.defaultEditor);

  return {
    id: typeof project?.id === 'string' && project.id ? project.id : nanoid(),
    name,
    path,
    manager,
    commands: sanitizeCommands(project?.commands as Array<Partial<Command>> | undefined),
    ...(defaultEditor ? { defaultEditor } : {}),
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

function sanitizeWindowState(
  value: Partial<WindowStatePreference> | null | undefined,
): WindowStatePreference | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const width = typeof value.width === 'number' && Number.isFinite(value.width)
    ? Math.max(860, Math.min(4096, Math.round(value.width)))
    : null;
  const height = typeof value.height === 'number' && Number.isFinite(value.height)
    ? Math.max(560, Math.min(2400, Math.round(value.height)))
    : null;
  if (width === null || height === null) {
    return undefined;
  }
  return {
    width,
    height,
    maximized: Boolean(value.maximized),
  };
}

function sanitizeUiPreferences(uiPreferences: Partial<UiPreferences> | null | undefined, projects: Project[]): UiPreferences {
  const windowState = sanitizeWindowState(uiPreferences?.windowState);
  return {
    isTerminalOpen: Boolean(uiPreferences?.isTerminalOpen),
    terminalHeight: clampTerminalHeight(uiPreferences?.terminalHeight),
    isSidebarExpanded: uiPreferences?.isSidebarExpanded ?? true,
    sidebarWidth: clampSidebarWidth(uiPreferences?.sidebarWidth),
    projectTerminals: sanitizeProjectTerminals(uiPreferences?.projectTerminals, projects),
    ...(windowState ? { windowState } : {}),
  };
}

function sanitizeGlobalSettings(settings: Partial<GlobalSettings> | null | undefined): GlobalSettings {
  const defaultShell = typeof settings?.defaultShell === 'string' && settings.defaultShell.trim()
    ? settings.defaultShell.trim()
    : DEFAULT_SETTINGS.defaultShell;
  const globalWindowShortcut = settings?.globalWindowShortcut
    ? sanitizeShortcutDefinition(settings.globalWindowShortcut)
    : null;
  return {
    defaultEditor: settings?.defaultEditor ?? DEFAULT_SETTINGS.defaultEditor,
    defaultShell,
    theme: settings?.theme ?? DEFAULT_SETTINGS.theme,
    language: settings?.language ?? DEFAULT_SETTINGS.language,
    terminalToggleShortcut: sanitizeShortcutDefinition(settings?.terminalToggleShortcut),
    minimizeToTrayOnClose: Boolean(settings?.minimizeToTrayOnClose),
    globalWindowShortcut,
  };
}

function sanitizeLaunchGroups(
  groups: Array<Partial<LaunchGroup>> | null | undefined,
  projects: Project[],
): LaunchGroup[] {
  const validCommandKeys = new Set(
    projects.flatMap((project) => project.commands.map((command) => commandOutputKey(project.id, command.id))),
  );

  return (Array.isArray(groups) ? groups : [])
    .map((group) => {
      const name = typeof group?.name === 'string' ? group.name.trim() : '';
      if (!name) return null;
      const seen = new Set<string>();
      const items = (Array.isArray(group?.items) ? group.items : [])
        .filter((item): item is LaunchGroupItem => (
          typeof item?.projectId === 'string'
          && typeof item?.commandId === 'string'
          && validCommandKeys.has(commandOutputKey(item.projectId, item.commandId))
        ))
        .filter((item) => {
          const key = commandOutputKey(item.projectId, item.commandId);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      if (!items.length) return null;
      return {
        id: typeof group?.id === 'string' && group.id ? group.id : nanoid(),
        name,
        items,
      };
    })
    .filter((group): group is LaunchGroup => Boolean(group));
}

function sanitizePersistedState(state: Partial<PersistedState> | null | undefined): PersistedState {
  const projects = sanitizeProjects(state?.projects);

  return {
    projects,
    launchGroups: sanitizeLaunchGroups(state?.launchGroups, projects),
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
  windowState?: WindowStatePreference;
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

function buildDetectedCommands(
  manager: string,
  scripts: Record<string, string>,
  detectedCommands?: DetectedCommand[],
): DetectedCommand[] {
  if (Array.isArray(detectedCommands) && detectedCommands.length > 0) {
    return detectedCommands
      .map((item) => ({
        label: item.label.trim(),
        cmd: item.cmd.trim(),
      }))
      .filter((item) => item.label.length > 0 && item.cmd.length > 0);
  }

  return Object.keys(scripts).map((key) => ({
    label: key,
    cmd: `${manager} run ${key}`,
  }));
}

function buildInitialCommands(
  manager: string,
  scripts: Record<string, string>,
  detectedCommands?: DetectedCommand[],
): Command[] {
  const entries = buildDetectedCommands(manager, scripts, detectedCommands);
  const defaultLabel = entries.find((item) => item.label === 'dev')?.label
    ?? entries.find((item) => item.label === 'run')?.label
    ?? entries[0]?.label
    ?? null;

  return entries.map((item) => ({
    id: nanoid(),
    label: item.label,
    cmd: item.cmd,
    status: 'idle' as const,
    pid: null,
    isDefault: item.label === defaultLabel,
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let persistedStateCache: PersistedState = sanitizePersistedState(undefined);

async function loadPersistedState(): Promise<PersistedState> {
  const persistedState = await invoke<Partial<PersistedState> | null>('load_app_config');
  persistedStateCache = sanitizePersistedState(persistedState);
  return persistedStateCache;
}

function enqueuePersist(buildNextState: (state: PersistedState) => PersistedState) {
  if (!persistenceAllowed) return Promise.resolve();
  persistedStateCache = sanitizePersistedState(buildNextState(persistedStateCache));
  needsPersist = true;

  if (isPersisting) {
    return persistQueue;
  }

  isPersisting = true;
  persistQueue = (async () => {
    while (needsPersist) {
      // Coalesce resize/drag updates; close waits for this queue before exiting.
      await new Promise((resolve) => setTimeout(resolve, 100));
      needsPersist = false;

      try {
        await invoke('save_app_config', { config: persistedStateCache });
        useStore.setState({ persistenceError: null });
      } catch (error) {
        console.error('Failed to persist FlashRun config:', error);
        needsPersist = true;
        useStore.setState({ persistenceError: String(error) });
        break;
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

async function persistLaunchGroups(launchGroups: LaunchGroup[]) {
  await enqueuePersist((state) => sanitizePersistedState({
    ...state,
    launchGroups,
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
    uiPreferences: {
      ...uiPreferences,
      windowState: uiPreferences.windowState ?? state.uiPreferences.windowState,
    },
  }));
}

export async function flushPersistence() {
  await persistQueue;
  if (needsPersist || useStore.getState().persistenceError) throw new Error('配置尚未保存，请重试保存后再退出。');
}

export async function retryPersistence() {
  await enqueuePersist((state) => state);
  await flushPersistence();
}

interface StoreState {
  projects: Project[];
  launchGroups: LaunchGroup[];
  activeProjectId: string | null;
  globalSettings: GlobalSettings;
  hydrated: boolean;
  hydrationError: string | null;
  persistenceError: string | null;
  activeCommandByProject: Record<string, string | null>;
  commandRuntimeByKey: Record<string, CommandRuntimeInfo>;
  terminalViewByProject: Record<string, ProjectTerminalView>;

  hydrate: () => Promise<void>;
  addProject: (
    path: string,
    manager: string,
    scripts: Record<string, string>,
    detectedCommands?: DetectedCommand[],
  ) => AddProjectResult;
  updateProject: (
    projectId: string,
    updates: { name?: string; defaultEditor?: EditorKey | null },
  ) => void;
  syncProjectCommands: (
    projectId: string,
    manager: string,
    scripts: Record<string, string>,
    detectedCommands?: DetectedCommand[],
  ) => { added: number };
  updateProjectManager: (projectId: string, newManager: string) => void;
  setActiveProject: (id: string) => void;
  removeProject: (id: string) => void;
  reorderProjects: (orderedProjectIds: string[]) => void;

  addCommand: (
    projectId: string,
    label: string,
    cmd: string,
    options?: {
      isDefault?: boolean;
      cwd?: string;
      env?: Record<string, string>;
      envFile?: string;
    },
  ) => void;
  updateCommand: (projectId: string, commandId: string, updates: Partial<Command>) => void;
  removeCommand: (projectId: string, commandId: string) => void;
  reorderCommands: (projectId: string, orderedCommandIds: string[]) => void;

  addLaunchGroup: (name: string, items: LaunchGroupItem[]) => string | null;
  updateLaunchGroup: (id: string, updates: { name?: string; items?: LaunchGroupItem[] }) => void;
  removeLaunchGroup: (id: string) => void;

  importConfigBundle: (
    bundle: FlashRunConfigExport,
    options: {
      mode: 'merge' | 'replace';
      fromPrefix?: string;
      toPrefix?: string;
      includeSettings?: boolean;
    },
  ) => { addedProjects: number; addedGroups: number };

  updateGlobalSettings: (settings: Partial<GlobalSettings>) => void;

  isTerminalOpen: boolean;
  terminalHeight: number;
  isSidebarExpanded: boolean;
  sidebarWidth: number;
  projectTerminals: Record<string, ProjectTerminalState>;
  windowState?: WindowStatePreference;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setTerminalHeight: (height: number) => void;
  setSidebarExpanded: (expanded: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setWindowState: (windowState: WindowStatePreference) => void;
  addTerminalTab: (projectId: string) => void;
  closeTerminalTab: (projectId: string, tabId: string) => void;
  setActiveTerminalTab: (projectId: string, tabId: string) => void;
  setProjectActiveCommand: (projectId: string, commandId: string | null) => void;
  syncProjectActiveCommand: (projectId: string) => void;
  setProjectTerminalView: (projectId: string, view: ProjectTerminalView) => void;
  markCommandStarted: (projectId: string, commandId: string) => void;
  markCommandExited: (projectId: string, commandId: string, exitCode: number | null) => void;
  recordCommandOutputInsights: (
    projectId: string,
    commandId: string,
    detectedUrls: string[],
    portConflict: number | null,
  ) => void;
  clearCommandPortConflict: (projectId: string, commandId: string) => void;
}

export const useStore = create<StoreState>((set) => ({
  projects: [],
  launchGroups: [],
  activeProjectId: null,
  globalSettings: DEFAULT_SETTINGS,
  hydrated: false,
  hydrationError: null,
  persistenceError: null,
  activeCommandByProject: {},
  commandRuntimeByKey: {},
  terminalViewByProject: {},
  isTerminalOpen: false,
  terminalHeight: DEFAULT_TERMINAL_HEIGHT,
  isSidebarExpanded: true,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  projectTerminals: {},
  windowState: undefined,

  hydrate: async () => {
    if (hydratePromise) return hydratePromise;
    persistenceAllowed = false;
    hydratePromise = (async () => {
    try {
      const persistedState = await loadPersistedState();

      set({
        projects: persistedState.projects,
        launchGroups: persistedState.launchGroups,
        activeProjectId: persistedState.activeProjectId,
        globalSettings: persistedState.settings,
        hydrated: true,
        hydrationError: null,
        activeCommandByProject: createActiveCommandMap(persistedState.projects),
        isTerminalOpen: persistedState.uiPreferences.isTerminalOpen,
        terminalHeight: persistedState.uiPreferences.terminalHeight,
        isSidebarExpanded: persistedState.uiPreferences.isSidebarExpanded,
        sidebarWidth: persistedState.uiPreferences.sidebarWidth,
        projectTerminals: persistedState.uiPreferences.projectTerminals,
        windowState: persistedState.uiPreferences.windowState,
      });
      persistenceAllowed = true;
    } catch (error) {
      console.error('Failed to hydrate FlashRun config:', error);
      set({
        projects: [],
        launchGroups: [],
        activeProjectId: null,
        globalSettings: DEFAULT_SETTINGS,
        hydrated: false,
        hydrationError: String(error),
        activeCommandByProject: {},
        isTerminalOpen: false,
        terminalHeight: DEFAULT_TERMINAL_HEIGHT,
        isSidebarExpanded: true,
        sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
        projectTerminals: {},
      });
    }
    })();
    try { await hydratePromise; } finally { hydratePromise = null; }
  },

  addProject: (path, manager, scripts, detectedCommands) => {
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
        commands: buildInitialCommands(manager, scripts, detectedCommands),
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

  updateProject: (projectId, updates) => set((state) => {
    let changed = false;
    const projects = state.projects.map((project) => {
      if (project.id !== projectId) {
        return project;
      }

      const nextProject: Project = { ...project };
      if (typeof updates.name === 'string') {
        const trimmed = updates.name.trim();
        if (trimmed && trimmed !== project.name) {
          nextProject.name = trimmed;
          changed = true;
        }
      }

      if ('defaultEditor' in updates) {
        const nextEditor = updates.defaultEditor === null ? undefined : sanitizeEditorKey(updates.defaultEditor);
        if (nextEditor !== project.defaultEditor) {
          if (nextEditor) {
            nextProject.defaultEditor = nextEditor;
          } else {
            delete nextProject.defaultEditor;
          }
          changed = true;
        }
      }

      return nextProject;
    });

    if (!changed) {
      return state;
    }

    void persistProjects(projects);
    return { projects };
  }),

  syncProjectCommands: (projectId, manager, scripts, detectedCommands) => {
    let added = 0;

    set((state) => {
      const target = state.projects.find((project) => project.id === projectId);
      if (!target) {
        return state;
      }

      const effectiveManager = isJsPackageManager(target.manager) ? target.manager : manager;
      const incoming = isJsPackageManager(effectiveManager) && Object.keys(scripts).length > 0
        ? Object.keys(scripts).map((key) => ({ label: key, cmd: `${effectiveManager} run ${key}` }))
        : buildDetectedCommands(effectiveManager, scripts, detectedCommands);

      const existingLabels = new Set(target.commands.map((command) => command.label.toLowerCase()));
      const newCommands: Command[] = [];
      for (const item of incoming) {
        const key = item.label.toLowerCase();
        if (!existingLabels.has(key)) {
          existingLabels.add(key);
          newCommands.push({
            id: nanoid(),
            label: item.label,
            cmd: item.cmd,
            status: 'idle',
            pid: null,
            isDefault: false,
          });
        }
      }

      added = newCommands.length;
      if (added === 0) {
        return state;
      }

      const projects = state.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }
        return {
          ...project,
          commands: ensureSingleDefaultCommand([...project.commands, ...newCommands]),
        };
      });

      void persistProjects(projects);
      return { projects };
    });

    return { added };
  },

  updateProjectManager: (projectId, newManager) => set((state) => {
    const projects = state.projects.map((project) => {
      if (project.id !== projectId) {
        return project;
      }

      const oldManager = project.manager;
      const shouldRewriteCommands = isJsPackageManager(oldManager) && isJsPackageManager(newManager);
      const regex = shouldRewriteCommands ? new RegExp(`^${escapeRegExp(oldManager)}\\b`) : null;
      return {
        ...project,
        manager: newManager,
        commands: regex
          ? project.commands.map((command) => ({ ...command, cmd: command.cmd.replace(regex, newManager) }))
          : project.commands,
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

    const terminalViewByProject = { ...state.terminalViewByProject };
    delete terminalViewByProject[id];

    const removedProject = state.projects.find((project) => project.id === id);
    const commandRuntimeByKey = { ...state.commandRuntimeByKey };
    if (removedProject) {
      for (const command of removedProject.commands) {
        delete commandRuntimeByKey[commandOutputKey(id, command.id)];
      }
    }

    const launchGroups = sanitizeLaunchGroups(state.launchGroups, projects);

    void persistProjects(projects);
    void persistLaunchGroups(launchGroups);
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
      launchGroups,
      activeProjectId,
      projectTerminals,
      activeCommandByProject,
      terminalViewByProject,
      commandRuntimeByKey,
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

      const cwd = typeof options?.cwd === 'string' && options.cwd.trim() ? options.cwd.trim() : undefined;
      const envFile = typeof options?.envFile === 'string' && options.envFile.trim() ? options.envFile.trim() : undefined;
      const env = sanitizeEnvRecord(options?.env);

      const nextCommand: Command = {
        id: nanoid(),
        label,
        cmd,
        status: 'idle',
        pid: null,
        isDefault: Boolean(options?.isDefault),
        ...(cwd ? { cwd } : {}),
        ...(envFile ? { envFile } : {}),
        ...(env ? { env } : {}),
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

    const commandRuntimeByKey = { ...state.commandRuntimeByKey };
    delete commandRuntimeByKey[commandOutputKey(projectId, commandId)];

    const currentView = state.terminalViewByProject[projectId];
    const terminalViewByProject = currentView?.mode === 'command' && currentView.commandId === commandId
      ? { ...state.terminalViewByProject, [projectId]: { mode: 'shell' as const } }
      : state.terminalViewByProject;

    const launchGroups = sanitizeLaunchGroups(state.launchGroups, projects);

    void persistProjects(projects);
    void persistLaunchGroups(launchGroups);
    return { projects, launchGroups, activeCommandByProject, commandRuntimeByKey, terminalViewByProject };
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

  addLaunchGroup: (name, items) => {
    let createdId: string | null = null;
    set((state) => {
      const candidate: LaunchGroup = {
        id: nanoid(),
        name: name.trim(),
        items,
      };
      const sanitized = sanitizeLaunchGroups([candidate], state.projects);
      if (!sanitized.length) {
        return state;
      }
      createdId = sanitized[0].id;
      const launchGroups = [...state.launchGroups, sanitized[0]];
      void persistLaunchGroups(launchGroups);
      return { launchGroups };
    });
    return createdId;
  },

  updateLaunchGroup: (id, updates) => set((state) => {
    const next = state.launchGroups.map((group) => (
      group.id === id
        ? {
          ...group,
          name: updates.name !== undefined ? updates.name : group.name,
          items: updates.items !== undefined ? updates.items : group.items,
        }
        : group
    ));
    const launchGroups = sanitizeLaunchGroups(next, state.projects);
    void persistLaunchGroups(launchGroups);
    return { launchGroups };
  }),

  removeLaunchGroup: (id) => set((state) => {
    const launchGroups = state.launchGroups.filter((group) => group.id !== id);
    void persistLaunchGroups(launchGroups);
    return { launchGroups };
  }),

  importConfigBundle: (bundle, options) => {
    let addedProjects = 0;
    let addedGroups = 0;

    set((state) => {
      const remappedIncomingProjects = sanitizeProjects(
        bundle.projects.map((project) => ({
          ...project,
          path: remapProjectPath(project.path, {
            fromPrefix: options.fromPrefix,
            toPrefix: options.toPrefix,
          }),
        })),
      );

      let projects: Project[];
      let launchGroups: LaunchGroup[];

      if (options.mode === 'replace') {
        projects = remappedIncomingProjects;
        addedProjects = projects.length;
        launchGroups = sanitizeLaunchGroups(bundle.launchGroups, projects);
        addedGroups = launchGroups.length;
      } else {
        const nextProjects = [...state.projects];
        const idRemap = new Map<string, string>();
        for (const incoming of remappedIncomingProjects) {
          const existing = nextProjects.find((p) => areProjectPathsEqual(p.path, incoming.path));
          if (existing) {
            idRemap.set(incoming.id, existing.id);
            continue;
          }
          const collision = nextProjects.some((p) => p.id === incoming.id);
          const nextId = collision ? nanoid() : incoming.id;
          idRemap.set(incoming.id, nextId);
          nextProjects.push({ ...incoming, id: nextId });
          addedProjects += 1;
        }
        projects = nextProjects;

        const existingGroupNames = new Set(state.launchGroups.map((g) => g.name.toLowerCase()));
        const remappedGroups = bundle.launchGroups.map((group) => ({
          ...group,
          id: nanoid(),
          items: group.items.map((item) => ({
            projectId: idRemap.get(item.projectId) ?? item.projectId,
            commandId: item.commandId,
          })),
        }));
        const validNewGroups = sanitizeLaunchGroups(remappedGroups, projects)
          .filter((group) => !existingGroupNames.has(group.name.toLowerCase()));
        addedGroups = validNewGroups.length;
        launchGroups = [...state.launchGroups, ...validNewGroups];
      }

      const activeProjectId = sanitizeActiveProjectId(state.activeProjectId, projects);
      const projectTerminals = sanitizeProjectTerminals(state.projectTerminals, projects);
      const globalSettings = options.includeSettings && bundle.settings
        ? sanitizeGlobalSettings({ ...state.globalSettings, ...bundle.settings })
        : state.globalSettings;

      void persistProjects(projects);
      void persistLaunchGroups(launchGroups);
      void persistActiveProject(activeProjectId);
      void persistSettings(globalSettings);
      void persistUiPreferences(buildUiPreferencesSnapshot({
        isTerminalOpen: state.isTerminalOpen,
        terminalHeight: state.terminalHeight,
        isSidebarExpanded: state.isSidebarExpanded,
        sidebarWidth: state.sidebarWidth,
        projectTerminals,
      }, projects));

      return {
        projects,
        launchGroups,
        activeProjectId,
        projectTerminals,
        globalSettings,
      };
    });

    return { addedProjects, addedGroups };
  },

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

  setWindowState: (nextWindowState) => set((state) => {
    const sanitized = sanitizeWindowState(nextWindowState);
    if (!sanitized) {
      return state;
    }

    if (
      state.windowState
      && state.windowState.width === sanitized.width
      && state.windowState.height === sanitized.height
      && state.windowState.maximized === sanitized.maximized
    ) {
      return state;
    }

    void persistUiPreferences(buildUiPreferencesSnapshot({
      isTerminalOpen: state.isTerminalOpen,
      terminalHeight: state.terminalHeight,
      isSidebarExpanded: state.isSidebarExpanded,
      sidebarWidth: state.sidebarWidth,
      projectTerminals: state.projectTerminals,
      windowState: sanitized,
    }, state.projects));

    return { windowState: sanitized };
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

    const closedTabIndex = terminalState.tabs.findIndex((tab) => tab.id === tabId);
    const remaining = terminalState.tabs.filter((tab) => tab.id !== tabId);
    if (remaining.length === terminalState.tabs.length) {
      return state;
    }
    const tabs = normalizeTerminalTabs(remaining.length ? remaining : [createDefaultTerminalTab()]);

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
    ...(commandId
      ? {
        terminalViewByProject: {
          ...state.terminalViewByProject,
          [projectId]: { mode: 'command' as const, commandId },
        },
      }
      : {}),
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

  setProjectTerminalView: (projectId, view) => set((state) => ({
    terminalViewByProject: {
      ...state.terminalViewByProject,
      [projectId]: view,
    },
  })),

  markCommandStarted: (projectId, commandId) => set((state) => {
    const key = commandOutputKey(projectId, commandId);
    return {
      commandRuntimeByKey: {
        ...state.commandRuntimeByKey,
        [key]: {
          startedAt: Date.now(),
          lastExitCode: null,
          lastDurationMs: null,
          detectedUrls: [],
          portConflict: null,
        },
      },
    };
  }),

  markCommandExited: (projectId, commandId, exitCode) => set((state) => {
    const key = commandOutputKey(projectId, commandId);
    const existing = state.commandRuntimeByKey[key];
    const startedAt = existing?.startedAt ?? null;
    const lastDurationMs = startedAt !== null ? Math.max(0, Date.now() - startedAt) : (existing?.lastDurationMs ?? null);
    return {
      commandRuntimeByKey: {
        ...state.commandRuntimeByKey,
        [key]: {
          startedAt: null,
          lastExitCode: exitCode,
          lastDurationMs,
          detectedUrls: existing?.detectedUrls ?? [],
          portConflict: existing?.portConflict ?? null,
        },
      },
    };
  }),

  recordCommandOutputInsights: (projectId, commandId, detectedUrls, portConflict) => set((state) => {
    const key = commandOutputKey(projectId, commandId);
    const existing = state.commandRuntimeByKey[key] ?? {
      startedAt: null,
      lastExitCode: null,
      lastDurationMs: null,
      detectedUrls: [],
      portConflict: null,
    };

    const urlsChanged = detectedUrls.length !== existing.detectedUrls.length
      || detectedUrls.some((url, index) => url !== existing.detectedUrls[index]);
    const nextConflict = portConflict ?? existing.portConflict;
    const conflictChanged = nextConflict !== existing.portConflict;

    if (!urlsChanged && !conflictChanged) {
      return state;
    }

    return {
      commandRuntimeByKey: {
        ...state.commandRuntimeByKey,
        [key]: {
          ...existing,
          detectedUrls: urlsChanged ? detectedUrls : existing.detectedUrls,
          portConflict: nextConflict,
        },
      },
    };
  }),

  clearCommandPortConflict: (projectId, commandId) => set((state) => {
    const key = commandOutputKey(projectId, commandId);
    const existing = state.commandRuntimeByKey[key];
    if (!existing || existing.portConflict === null) {
      return state;
    }

    return {
      commandRuntimeByKey: {
        ...state.commandRuntimeByKey,
        [key]: {
          ...existing,
          portConflict: null,
        },
      },
    };
  }),
}));
