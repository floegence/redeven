import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { normalizePath, rewriteSubtreePaths } from './FileBrowserShared';

type DirectoryCacheEntry = {
  items: FileItem[];
  revision: number;
};

export type DirectoryCacheRead = Readonly<DirectoryCacheEntry>;

function pathHasPrefix(path: string, prefix: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedPrefix = normalizePath(prefix);
  return normalizedPath === normalizedPrefix
    || (normalizedPrefix === '/' ? normalizedPath.startsWith('/') : normalizedPath.startsWith(`${normalizedPrefix}/`));
}

/**
 * Session-only directory snapshots. Revisions are mutation watermarks: a
 * response that started before a local mutation cannot replace newer UI data.
 */
export class DirectorySnapshotCache {
  private readonly entries = new Map<string, DirectoryCacheEntry>();
  private readonly revisions = new Map<string, number>();

  read(path: string): DirectoryCacheRead | undefined {
    return this.entries.get(normalizePath(path));
  }

  revision(path: string): number {
    return this.revisions.get(normalizePath(path)) ?? 0;
  }

  acceptRemote(path: string, items: FileItem[], expectedRevision: number): DirectoryCacheRead | undefined {
    const normalizedPath = normalizePath(path);
    const revision = this.revision(normalizedPath);
    if (revision !== expectedRevision) {
      return this.entries.get(normalizedPath);
    }
    const entry = { items, revision };
    this.entries.set(normalizedPath, entry);
    return entry;
  }

  mutate(path: string, update: (items: FileItem[]) => FileItem[]): void {
    const normalizedPath = normalizePath(path);
    const revision = this.revision(normalizedPath) + 1;
    this.revisions.set(normalizedPath, revision);
    const current = this.entries.get(normalizedPath);
    if (current) {
      this.entries.set(normalizedPath, { items: update(current.items), revision });
    }
  }

  invalidatePrefix(prefix: string): void {
    const keys = new Set([...this.entries.keys(), ...this.revisions.keys()]);
    keys.add(normalizePath(prefix));
    for (const key of keys) {
      if (!pathHasPrefix(key, prefix)) continue;
      this.entries.delete(key);
      this.revisions.set(key, this.revision(key) + 1);
    }
  }

  rewritePrefix(fromPrefix: string, toPrefix: string): void {
    const normalizedFrom = normalizePath(fromPrefix);
    const normalizedTo = normalizePath(toPrefix);
    const moved = [...this.entries.entries()]
      .filter(([path]) => pathHasPrefix(path, normalizedFrom))
      .map(([path, entry]) => {
        const suffix = path === normalizedFrom ? '' : path.slice(normalizedFrom.length);
        const nextPath = normalizePath(`${normalizedTo}${suffix}`);
        return {
          oldPath: path,
          nextPath,
          items: entry.items.map((item) => rewriteSubtreePaths(item, normalizedFrom, normalizedTo)),
        };
      });

    this.invalidatePrefix(normalizedFrom);
    for (const item of moved) {
      const revision = this.revision(item.nextPath) + 1;
      this.revisions.set(item.nextPath, revision);
      this.entries.set(item.nextPath, { items: item.items, revision });
    }
  }
}
