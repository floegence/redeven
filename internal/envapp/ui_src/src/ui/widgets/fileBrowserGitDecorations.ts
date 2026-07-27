import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type {
  GitListWorkspaceChangesResponse,
  GitListWorkspacePathStatusesResponse,
  GitWorkspaceChange,
  GitWorkspaceSection,
} from '../protocol/redeven_v1';

export type FileBrowserGitDecorationKind = 'added' | 'modified';

export type FileBrowserGitDecorationIndex = {
  repoRootPath: string;
  decorations: Map<string, NonNullable<FileItem['decoration']>>;
  fileChanges: Map<string, GitWorkspaceChange[]>;
  directoryChanges: Map<string, GitWorkspaceChange[]>;
};

const ADDED_DECORATION: NonNullable<FileItem['decoration']> = {
  badge: {
    label: 'A',
    tone: 'success',
  },
  nameTone: 'success',
};

const MODIFIED_DECORATION: NonNullable<FileItem['decoration']> = {
  badge: {
    label: 'M',
    tone: 'info',
  },
  nameTone: 'info',
};

function decorationForKind(kind: FileBrowserGitDecorationKind): NonNullable<FileItem['decoration']> {
  return kind === 'added' ? ADDED_DECORATION : MODIFIED_DECORATION;
}

function mergeDecorationKind(
  current: FileBrowserGitDecorationKind | undefined,
  next: FileBrowserGitDecorationKind,
): FileBrowserGitDecorationKind {
  if (current === 'modified' || next === 'modified') return 'modified';
  return 'added';
}

function normalizeRepoRootPath(repoRootPath: string): string {
  const raw = String(repoRootPath ?? '');
  if (!raw) return '';
  if (raw === '/') return '/';
  return raw.endsWith('/') ? raw.replace(/\/+$/, '') || '/' : raw;
}

function absoluteGitPath(repoRootPath: string, path: string | null | undefined): string {
  const raw = String(path ?? '');
  if (!raw) return '';
  if (raw.startsWith('/')) return normalizeRepoRootPath(raw);
  return `${repoRootPath === '/' ? '' : repoRootPath}/${raw}`;
}

function parentGitPath(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return path.slice(0, lastSlash) || '/';
}

function isPathInsideRepo(path: string, repoRootPath: string): boolean {
  return path === repoRootPath || path.startsWith(`${repoRootPath === '/' ? '' : repoRootPath}/`);
}

function addAggregatedDirectoryDecorations(
  decorations: Map<string, FileBrowserGitDecorationKind>,
  repoRootPath: string,
  changedPath: string,
  kind: FileBrowserGitDecorationKind,
): void {
  let cursor = parentGitPath(changedPath);
  while (isPathInsideRepo(cursor, repoRootPath)) {
    decorations.set(cursor, mergeDecorationKind(decorations.get(cursor), kind));
    if (cursor === repoRootPath) break;
    const parent = parentGitPath(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function addDecorationPath(
  decorations: Map<string, FileBrowserGitDecorationKind>,
  repoRootPath: string,
  changedPath: string,
  kind: FileBrowserGitDecorationKind,
  options: { decorateSelf: boolean; aggregateParents: boolean },
): void {
  const normalizedPath = changedPath;
  if (!isPathInsideRepo(normalizedPath, repoRootPath)) return;
  if (options.decorateSelf) {
    decorations.set(normalizedPath, mergeDecorationKind(decorations.get(normalizedPath), kind));
  }
  if (options.aggregateParents && normalizedPath !== repoRootPath) {
    addAggregatedDirectoryDecorations(decorations, repoRootPath, normalizedPath, kind);
  }
}

function isDirectoryChange(change: GitWorkspaceChange): boolean {
  return String(change.entryKind ?? '').trim() === 'directory';
}

function isValidWorkspaceSection(value: unknown): value is GitWorkspaceSection {
  return value === 'staged' || value === 'unstaged' || value === 'untracked' || value === 'conflicted';
}

function changeWithSection(change: GitWorkspaceChange, section: GitWorkspaceSection): GitWorkspaceChange {
  return isValidWorkspaceSection(change.section)
    ? change
    : { ...change, section };
}

function decorationKindForChange(
  change: GitWorkspaceChange,
  section: GitWorkspaceSection,
): FileBrowserGitDecorationKind {
  const changeType = String(change.changeType ?? '').trim().toLowerCase();
  const changeSection = String(change.section ?? section ?? '').trim().toLowerCase();
  if (isDirectoryChange(change)) {
    if (changeSection === 'conflicted' || change.containsUnstaged || change.containsConflicted || change.containsStaged) return 'modified';
    if (change.containsUntracked) return 'added';
  }
  if (changeType === 'added' || changeType === 'untracked' || changeSection === 'untracked') {
    return 'added';
  }
  return 'modified';
}

function primarySectionForPathStatus(change: GitWorkspaceChange): GitWorkspaceSection {
  if (isValidWorkspaceSection(change.section)) return change.section;
  if (change.containsUnstaged) return 'unstaged';
  if (change.containsUntracked) return 'untracked';
  if (change.containsConflicted) return 'conflicted';
  return 'staged';
}

function changeDirectoryPath(change: GitWorkspaceChange): string {
  return String(change.directoryPath ?? change.displayPath ?? change.path ?? '');
}

function changeMutationPaths(change: GitWorkspaceChange): string[] {
  const explicitPaths = Array.isArray(change.mutationPaths) ? change.mutationPaths : [];
  return Array.from(new Set([
    ...explicitPaths,
    change.path,
    change.newPath,
    change.oldPath,
  ]
    .map((path) => String(path ?? ''))
    .filter((path) => path.length > 0)));
}

function addWorkspaceChangeDecorations(
  decorations: Map<string, FileBrowserGitDecorationKind>,
  fileChanges: Map<string, GitWorkspaceChange[]>,
  directoryChanges: Map<string, GitWorkspaceChange[]>,
  repoRootPath: string,
  change: GitWorkspaceChange,
  section: GitWorkspaceSection,
): void {
  const indexedChange = changeWithSection(change, section);
  const kind = decorationKindForChange(change, section);
  if (isDirectoryChange(change)) {
    const directoryPath = absoluteGitPath(repoRootPath, changeDirectoryPath(change));
    if (directoryPath) {
      addDecorationPath(decorations, repoRootPath, directoryPath, kind, {
        decorateSelf: true,
        aggregateParents: true,
      });
      addDirectoryChange(directoryChanges, repoRootPath, directoryPath, indexedChange);
    }
  }

  for (const mutationPath of changeMutationPaths(change)) {
    const absolutePath = absoluteGitPath(repoRootPath, mutationPath);
    if (!absolutePath) continue;
    if (!isPathInsideRepo(absolutePath, repoRootPath)) continue;
    addDecorationPath(decorations, repoRootPath, absolutePath, kind, {
      decorateSelf: !isDirectoryChange(change),
      aggregateParents: true,
    });
    if (!isDirectoryChange(change)) {
      addFileChange(fileChanges, absolutePath, indexedChange);
    }
    addDirectoryChange(directoryChanges, repoRootPath, absolutePath, indexedChange);
  }
}

function changeIdentity(change: GitWorkspaceChange): string {
  return [
    String(change.section ?? ''),
    String(change.entryKind ?? ''),
    String(change.changeType ?? ''),
    String(change.path ?? ''),
    String(change.oldPath ?? ''),
    String(change.newPath ?? ''),
    String(change.directoryPath ?? ''),
  ].join('\u0000');
}

function addChangeToMap(
  map: Map<string, GitWorkspaceChange[]>,
  path: string,
  change: GitWorkspaceChange,
): void {
  const key = path;
  const current = map.get(key) ?? [];
  const identity = changeIdentity(change);
  if (current.some((item) => changeIdentity(item) === identity)) return;
  map.set(key, [...current, change]);
}

function addFileChange(
  fileChanges: Map<string, GitWorkspaceChange[]>,
  absolutePath: string,
  change: GitWorkspaceChange,
): void {
  addChangeToMap(fileChanges, absolutePath, change);
}

function addDirectoryChange(
  directoryChanges: Map<string, GitWorkspaceChange[]>,
  repoRootPath: string,
  changedPath: string,
  change: GitWorkspaceChange,
): void {
  let cursor = isDirectoryChange(change) && changedPath !== repoRootPath
    ? changedPath
    : parentGitPath(changedPath);
  while (isPathInsideRepo(cursor, repoRootPath)) {
    addChangeToMap(directoryChanges, cursor, change);
    if (cursor === repoRootPath) break;
    const parent = parentGitPath(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

export function buildFileBrowserGitDecorationIndex(
  repoRootPath: string,
  workspace: GitListWorkspaceChangesResponse | null | undefined,
): FileBrowserGitDecorationIndex | null {
  const normalizedRepoRootPath = normalizeRepoRootPath(repoRootPath || workspace?.repoRootPath || '');
  if (!normalizedRepoRootPath) return null;

  const kinds = new Map<string, FileBrowserGitDecorationKind>();
  const fileChanges = new Map<string, GitWorkspaceChange[]>();
  const directoryChanges = new Map<string, GitWorkspaceChange[]>();
  const sections: GitWorkspaceSection[] = ['staged', 'unstaged', 'untracked', 'conflicted'];
  for (const section of sections) {
    for (const change of workspace?.[section] ?? []) {
      addWorkspaceChangeDecorations(kinds, fileChanges, directoryChanges, normalizedRepoRootPath, change, section);
    }
  }

  const decorations = new Map<string, NonNullable<FileItem['decoration']>>();
  for (const [path, kind] of kinds) {
    decorations.set(path, decorationForKind(kind));
  }
  return {
    repoRootPath: normalizedRepoRootPath,
    decorations,
    fileChanges,
    directoryChanges,
  };
}

export function buildFileBrowserGitPathStatusIndex(
  repoRootPath: string,
  response: GitListWorkspacePathStatusesResponse | null | undefined,
): FileBrowserGitDecorationIndex | null {
  const normalizedRepoRootPath = normalizeRepoRootPath(repoRootPath || response?.repoRootPath || '');
  if (!normalizedRepoRootPath) return null;

  const kinds = new Map<string, FileBrowserGitDecorationKind>();
  const fileChanges = new Map<string, GitWorkspaceChange[]>();
  const directoryChanges = new Map<string, GitWorkspaceChange[]>();
  for (const change of response?.items ?? []) {
    addWorkspaceChangeDecorations(
      kinds,
      fileChanges,
      directoryChanges,
      normalizedRepoRootPath,
      change,
      primarySectionForPathStatus(change),
    );
  }

  const decorations = new Map<string, NonNullable<FileItem['decoration']>>();
  for (const [path, kind] of kinds) decorations.set(path, decorationForKind(kind));
  return { repoRootPath: normalizedRepoRootPath, decorations, fileChanges, directoryChanges };
}

export function applyFileBrowserGitDecorations(
  items: FileItem[],
  index: FileBrowserGitDecorationIndex | null | undefined,
): FileItem[] {
  if (!index || index.decorations.size === 0) return items;

  let changed = false;
  const nextItems = items.map((item) => {
    const nextChildren = item.children
      ? applyFileBrowserGitDecorations(item.children, index)
      : undefined;
    const nextDecoration = index.decorations.get(item.path);
    const childrenChanged = Boolean(nextChildren && nextChildren !== item.children);
    if (!nextDecoration && !childrenChanged) return item;
    changed = true;
    return {
      ...item,
      ...(nextDecoration ? { decoration: nextDecoration } : {}),
      ...(nextChildren ? { children: nextChildren } : {}),
    };
  });

  return changed ? nextItems : items;
}
