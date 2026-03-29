import type { FsFileInfo } from '../protocol/redeven_v1/sdk/fs';

export type CodexFileSearchEntry = Readonly<{
  path: string;
  name: string;
  parent: string;
  is_image: boolean;
}>;

export type CodexFileIndexSnapshot = Readonly<{
  cwd: string;
  entries: CodexFileSearchEntry[];
  complete: boolean;
  scanned_dirs: number;
}>;

type ListDirectoryFn = (path: string) => Promise<ReadonlyArray<FsFileInfo>>;

const DEFAULT_SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  'vendor',
]);

const DEFAULT_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.avif',
  '.heic',
  '.heif',
]);

type QueueEntry = Readonly<{
  path: string;
  depth: number;
}>;

function dirname(path: string): string {
  const normalized = String(path ?? '').replaceAll('\\', '/');
  const trimmed = normalized.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  if (index <= 0) return '/';
  return trimmed.slice(0, index);
}

function basename(path: string): string {
  const normalized = String(path ?? '').replaceAll('\\', '/').replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  if (index < 0) return normalized;
  return normalized.slice(index + 1);
}

function pathDepth(path: string): number {
  return String(path ?? '').replaceAll('\\', '/').split('/').filter(Boolean).length;
}

function isImagePath(path: string): boolean {
  const normalized = String(path ?? '').trim().toLowerCase();
  for (const extension of DEFAULT_IMAGE_EXTENSIONS) {
    if (normalized.endsWith(extension)) return true;
  }
  return false;
}

function subsequenceScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  let score = 0;
  let cursor = 0;
  for (const char of needle) {
    const matchIndex = haystack.indexOf(char, cursor);
    if (matchIndex < 0) return -1;
    score += Math.max(1, 20 - (matchIndex - cursor));
    cursor = matchIndex + 1;
  }
  return score;
}

function rankEntry(entry: CodexFileSearchEntry, normalizedQuery: string): number {
  if (!normalizedQuery) {
    return 1000 - pathDepth(entry.path) * 10 - entry.path.length * 0.05;
  }
  const normalizedName = entry.name.toLowerCase();
  const normalizedPath = entry.path.toLowerCase();
  if (normalizedName === normalizedQuery) return 2000 - entry.path.length * 0.05;
  if (normalizedName.startsWith(normalizedQuery)) return 1600 - entry.name.length;
  const nameIndex = normalizedName.indexOf(normalizedQuery);
  if (nameIndex >= 0) return 1200 - nameIndex * 10 - entry.name.length * 0.05;
  const pathIndex = normalizedPath.indexOf(normalizedQuery);
  if (pathIndex >= 0) return 900 - pathIndex * 2 - entry.path.length * 0.02;
  const subsequence = subsequenceScore(normalizedPath, normalizedQuery);
  if (subsequence >= 0) return 500 + subsequence - entry.path.length * 0.01;
  return -1;
}

export function createCodexComposerFileIndex(args: {
  listDirectory: ListDirectoryFn;
  maxDirs?: number;
  maxFiles?: number;
  maxDepth?: number;
  skippedDirectoryNames?: ReadonlySet<string>;
}) {
  const maxDirs = Math.max(1, Number(args.maxDirs ?? 250) || 250);
  const maxFiles = Math.max(1, Number(args.maxFiles ?? 4000) || 4000);
  const maxDepth = Math.max(1, Number(args.maxDepth ?? 10) || 10);
  const skippedDirectoryNames = args.skippedDirectoryNames ?? DEFAULT_SKIPPED_DIRECTORIES;

  const snapshots = new Map<string, CodexFileIndexSnapshot>();
  const inflight = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let disposed = false;

  const notify = () => {
    if (disposed) return;
    for (const listener of listeners) {
      listener();
    }
  };

  const setSnapshot = (cwd: string, snapshot: CodexFileIndexSnapshot) => {
    snapshots.set(cwd, snapshot);
    notify();
  };

  const ensureIndexed = async (cwd: string): Promise<void> => {
    const normalizedCwd = String(cwd ?? '').trim();
    if (!normalizedCwd || disposed) return;
    if (inflight.has(normalizedCwd)) {
      await inflight.get(normalizedCwd);
      return;
    }
    if (!snapshots.has(normalizedCwd)) {
      setSnapshot(normalizedCwd, {
        cwd: normalizedCwd,
        entries: [],
        complete: false,
        scanned_dirs: 0,
      });
    }

    const crawl = (async () => {
      const discovered = new Map<string, CodexFileSearchEntry>();
      const queue: QueueEntry[] = [{ path: normalizedCwd, depth: 0 }];
      let scannedDirs = 0;

      while (queue.length > 0 && scannedDirs < maxDirs && discovered.size < maxFiles && !disposed) {
        const current = queue.shift()!;
        let entries: ReadonlyArray<FsFileInfo> = [];
        try {
          entries = await args.listDirectory(current.path);
        } catch {
          scannedDirs += 1;
          continue;
        }
        scannedDirs += 1;

        for (const entry of entries) {
          const entryPath = String(entry.path ?? '').trim();
          const entryName = String(entry.name ?? '').trim() || basename(entryPath);
          if (!entryPath || !entryName) continue;
          if (entry.isDirectory) {
            if (current.depth >= maxDepth) continue;
            if (skippedDirectoryNames.has(entryName)) continue;
            queue.push({ path: entryPath, depth: current.depth + 1 });
            continue;
          }
          if (discovered.size >= maxFiles) break;
          if (discovered.has(entryPath)) continue;
          discovered.set(entryPath, {
            path: entryPath,
            name: entryName,
            parent: dirname(entryPath),
            is_image: isImagePath(entryPath),
          });
        }

        setSnapshot(normalizedCwd, {
          cwd: normalizedCwd,
          entries: Array.from(discovered.values()),
          complete: false,
          scanned_dirs: scannedDirs,
        });
      }

      setSnapshot(normalizedCwd, {
        cwd: normalizedCwd,
        entries: Array.from(discovered.values()),
        complete: true,
        scanned_dirs: scannedDirs,
      });
    })();

    inflight.set(normalizedCwd, crawl);
    try {
      await crawl;
    } finally {
      inflight.delete(normalizedCwd);
    }
  };

  const query = (cwd: string, search: string, limit = 12): CodexFileSearchEntry[] => {
    const snapshot = snapshots.get(String(cwd ?? '').trim());
    if (!snapshot) return [];
    const normalizedQuery = String(search ?? '').trim().toLowerCase();
    return [...snapshot.entries]
      .map((entry) => ({ entry, score: rankEntry(entry, normalizedQuery) }))
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => {
        const scoreDelta = right.score - left.score;
        if (scoreDelta !== 0) return scoreDelta;
        const depthDelta = pathDepth(left.entry.path) - pathDepth(right.entry.path);
        if (depthDelta !== 0) return depthDelta;
        return left.entry.path.localeCompare(right.entry.path);
      })
      .slice(0, Math.max(1, limit))
      .map((entry) => entry.entry);
  };

  const getSnapshot = (cwd: string): CodexFileIndexSnapshot | null => snapshots.get(String(cwd ?? '').trim()) ?? null;

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const invalidate = (cwd?: string) => {
    const normalizedCwd = String(cwd ?? '').trim();
    if (!normalizedCwd) {
      snapshots.clear();
      notify();
      return;
    }
    if (!snapshots.delete(normalizedCwd)) return;
    notify();
  };

  const dispose = () => {
    disposed = true;
    listeners.clear();
    inflight.clear();
  };

  return {
    ensureIndexed,
    query,
    getSnapshot,
    subscribe,
    invalidate,
    dispose,
  };
}
