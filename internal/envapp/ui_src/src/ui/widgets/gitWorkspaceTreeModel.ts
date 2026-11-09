import type { GitListWorkspacePageResponse, GitWorkspaceChange } from '../protocol/redeven_v1';
import { exactGitPath, isGitWorkspaceDirectoryEntry, workspaceDirectoryPath, workspaceEntryKey, type GitWorkspaceViewSection } from '../utils/gitWorkbench';

export type GitWorkspaceDirectoryLoader = (section: GitWorkspaceViewSection, directoryPath: string, offset?: number) => Promise<GitListWorkspacePageResponse | undefined>;
export interface GitWorkspaceTreeNode { key: string; path: string; label: string; directory: boolean; item?: GitWorkspaceChange; children: GitWorkspaceTreeNode[] }

/** Directory summaries are lazy boundaries; file inventories may also be flat. */
export function buildGitWorkspaceTree(items: readonly GitWorkspaceChange[], basePath = ''): GitWorkspaceTreeNode[] {
  const roots: GitWorkspaceTreeNode[] = [];
  const directories = new Map<string, GitWorkspaceTreeNode>();
  const ensureDirectory = (path: string): GitWorkspaceTreeNode => {
    const existing = directories.get(path);
    if (existing) return existing;
    const split = path.lastIndexOf('/');
    const parent = split < 0 ? '' : path.slice(0, split);
    const node: GitWorkspaceTreeNode = { key: `directory:${path}`, path, label: path.slice(split + 1), directory: true, children: [] };
    directories.set(path, node);
    (parent && parent !== basePath ? ensureDirectory(parent).children : roots).push(node);
    return node;
  };
  for (const item of items) {
    const path = isGitWorkspaceDirectoryEntry(item) ? workspaceDirectoryPath(item) : exactGitPath(item.newPath || item.path || item.oldPath || item.displayPath);
    if (!path || (basePath && !path.startsWith(`${basePath}/`))) continue;
    if (isGitWorkspaceDirectoryEntry(item)) { ensureDirectory(path).item = item; continue; }
    const split = path.lastIndexOf('/');
    const parent = split < 0 ? '' : path.slice(0, split);
    (parent && parent !== basePath ? ensureDirectory(parent).children : roots).push({ key: workspaceEntryKey(item), path, label: path.slice(split + 1), directory: false, item, children: [] });
  }
  const sort = (nodes: GitWorkspaceTreeNode[]) => { nodes.sort((a, b) => Number(b.directory) - Number(a.directory) || a.label.localeCompare(b.label)); nodes.forEach(node => sort(node.children)); };
  sort(roots);
  return roots;
}
