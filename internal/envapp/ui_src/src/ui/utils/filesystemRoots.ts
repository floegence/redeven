import type { FsPathContextResponse, FsRoot } from '../protocol/redeven_v1/sdk/fs';
import { isWithinAbsolutePath, normalizeAbsolutePath } from './askFlowerPath';

export type NormalizedFilesystemRoot = FsRoot & {
  pathAbs: string;
  label: string;
};

export type NormalizedFilesystemContext = {
  homePathAbs: string;
  defaultRootId: string;
  roots: NormalizedFilesystemRoot[];
};

export function normalizeFilesystemContext(resp: FsPathContextResponse | null | undefined): NormalizedFilesystemContext {
  const homePathAbs = normalizeAbsolutePath(String(resp?.homePathAbs || resp?.agentHomePathAbs || '').trim());
  const rawRoots = Array.isArray(resp?.roots) ? resp.roots : [];
  const roots: NormalizedFilesystemRoot[] = [];
  const seen = new Set<string>();

  for (const root of rawRoots) {
    const pathAbs = normalizeAbsolutePath(root?.pathAbs ?? '');
    if (!pathAbs || seen.has(pathAbs)) continue;
    seen.add(pathAbs);
    roots.push({
      ...root,
      id: String(root?.id || pathAbs),
      label: String(root?.label || root?.id || pathAbs),
      pathAbs,
      permissions: {
        read: Boolean(root?.permissions?.read ?? false),
        write: Boolean(root?.permissions?.write ?? false),
      },
    });
  }

  if (homePathAbs && !seen.has(homePathAbs)) {
    roots.push({
      id: 'home',
      label: 'Home',
      pathAbs: homePathAbs,
      kind: 'home',
      permissions: { read: true, write: true },
      system: true,
    });
  }

  roots.sort((a, b) => {
    const order = (kind: string) => (kind === 'home' ? 0 : kind === 'computer' ? 1 : 2);
    const byKind = order(a.kind) - order(b.kind);
    if (byKind !== 0) return byKind;
    return a.label.localeCompare(b.label);
  });

  return {
    homePathAbs,
    defaultRootId: String(resp?.defaultRootId || 'home'),
    roots,
  };
}

export function matchFilesystemRoot(pathAbs: string, roots: readonly NormalizedFilesystemRoot[]): NormalizedFilesystemRoot | null {
  const normalizedPath = normalizeAbsolutePath(pathAbs);
  if (!normalizedPath) return null;
  let best: NormalizedFilesystemRoot | null = null;
  for (const root of roots) {
    if (!isWithinAbsolutePath(normalizedPath, root.pathAbs)) continue;
    if (!best || root.pathAbs.length > best.pathAbs.length) {
      best = root;
    }
  }
  return best;
}

export function defaultFilesystemRoot(ctx: NormalizedFilesystemContext): NormalizedFilesystemRoot | null {
  return ctx.roots.find((root) => root.id === ctx.defaultRootId) ?? ctx.roots[0] ?? null;
}

export function defaultFilesystemPath(ctx: NormalizedFilesystemContext): string {
  return defaultFilesystemRoot(ctx)?.pathAbs || ctx.homePathAbs || '/';
}

export function formatFilesystemPath(pathAbs: string, homePathAbs?: string): string {
  const normalizedPath = normalizeAbsolutePath(pathAbs);
  if (!normalizedPath) return '';
  const home = normalizeAbsolutePath(homePathAbs ?? '');
  if (home && normalizedPath === home) return '~';
  if (home && isWithinAbsolutePath(normalizedPath, home)) {
    return `~/${normalizedPath.slice(home.length).replace(/^\/+/, '')}`;
  }
  return normalizedPath;
}

export function parseFilesystemPathInput(rawValue: string, homePathAbs?: string): string {
  const raw = String(rawValue ?? '').trim();
  if (!raw) return '';
  const home = normalizeAbsolutePath(homePathAbs ?? '');
  if (raw === '~') return home;
  if (raw.startsWith('~/')) {
    return home ? normalizeAbsolutePath(`${home}/${raw.slice(2)}`) : '';
  }
  return normalizeAbsolutePath(raw);
}
