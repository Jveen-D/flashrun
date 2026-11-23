import type { GlobalSettings, LaunchGroup, Project } from '../store';

export interface FlashRunConfigExport {
  format: 'flashrun-export';
  version: 1;
  exportedAt: string;
  projects: Project[];
  launchGroups: LaunchGroup[];
  settings?: Partial<GlobalSettings>;
}

export interface RemapPathOptions {
  fromPrefix?: string;
  toPrefix?: string;
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function remapProjectPath(path: string, options?: RemapPathOptions): string {
  const from = options?.fromPrefix?.trim();
  const to = options?.toPrefix?.trim();
  if (!from || !to) {
    return path;
  }

  const normalizedPath = normalizeSlashes(path);
  const normalizedFrom = normalizeSlashes(from);
  const normalizedTo = normalizeSlashes(to);
  if (!normalizedFrom) {
    return path;
  }

  const isWindowsPrefix = /^[a-z]:(?:\/|$)/i.test(normalizedFrom);
  const matches = isWindowsPrefix
    ? normalizedPath.toLocaleLowerCase('en-US') === normalizedFrom.toLocaleLowerCase('en-US')
      || normalizedPath.toLocaleLowerCase('en-US').startsWith(`${normalizedFrom.toLocaleLowerCase('en-US')}/`)
    : normalizedPath === normalizedFrom || normalizedPath.startsWith(`${normalizedFrom}/`);

  if (!matches) {
    return path;
  }

  const suffix = normalizedPath.slice(normalizedFrom.length);
  const joined = `${normalizedTo}${suffix}`;
  const preferBackslash = to.includes('\\') && !to.includes('/');
  return preferBackslash ? joined.replace(/\//g, '\\') : joined;
}

export function buildConfigExportBundle(params: {
  projects: Project[];
  launchGroups: LaunchGroup[];
  settings: GlobalSettings;
  includeSettings?: boolean;
}): FlashRunConfigExport {
  const cleanProjects: Project[] = params.projects.map((project) => ({
    ...project,
    commands: project.commands.map((command) => ({
      ...command,
      status: 'idle',
      pid: null,
    })),
  }));

  return {
    format: 'flashrun-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: cleanProjects,
    launchGroups: params.launchGroups,
    ...(params.includeSettings ? { settings: params.settings } : {}),
  };
}

export function parseConfigImportBundle(rawJson: string): FlashRunConfigExport {
  const parsed: unknown = JSON.parse(rawJson);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('配置文件根节点必须是 JSON 对象。');
  }

  const candidate = parsed as Partial<FlashRunConfigExport>;
  if (!Array.isArray(candidate.projects)) {
    throw new Error('配置文件缺少有效的 projects 列表。');
  }

  return {
    format: 'flashrun-export',
    version: 1,
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : new Date().toISOString(),
    projects: candidate.projects,
    launchGroups: Array.isArray(candidate.launchGroups) ? candidate.launchGroups : [],
    ...(candidate.settings && typeof candidate.settings === 'object' ? { settings: candidate.settings } : {}),
  };
}
