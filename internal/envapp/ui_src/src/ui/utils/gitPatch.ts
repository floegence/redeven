import { hasMeaningfulGitPatchText, normalizeGitPatchText } from './gitPatchText';

export type GitPatchRenderedLineKind = 'add' | 'del' | 'context' | 'meta';

export type GitPatchRenderedLine = {
  key: string;
  text: string;
  oldLine: number | null;
  newLine: number | null;
  kind: GitPatchRenderedLineKind;
};

export type GitPatchRenderSnapshot = Readonly<{
  renderedLines: GitPatchRenderedLine[];
  additions: number;
  deletions: number;
}>;

export const GIT_PATCH_PREVIEW_LINES = 220;

const GIT_PATCH_RENDER_CACHE_LIMIT = 200;
const gitPatchRenderCache = new Map<string, GitPatchRenderSnapshot>();

function normalizeGitPatchCacheKey(patchText: string): string {
  return hasMeaningfulGitPatchText(patchText) ? normalizeGitPatchText(patchText) : '';
}

function pruneGitPatchRenderCache(): void {
  if (gitPatchRenderCache.size <= GIT_PATCH_RENDER_CACHE_LIMIT) return;
  const oldestKey = gitPatchRenderCache.keys().next().value;
  if (typeof oldestKey === 'string') {
    gitPatchRenderCache.delete(oldestKey);
  }
}

export function getGitPatchRenderSnapshot(patchText: string): GitPatchRenderSnapshot {
  const cacheKey = normalizeGitPatchCacheKey(patchText);
  if (!cacheKey) {
    return {
      renderedLines: [],
      additions: 0,
      deletions: 0,
    };
  }
  const cached = gitPatchRenderCache.get(cacheKey);
  if (cached) return cached;

  if (!hasMeaningfulGitPatchText(patchText)) {
    return {
      renderedLines: [],
      additions: 0,
      deletions: 0,
    };
  }
  const lines = cacheKey.split('\n');
  const rendered: GitPatchRenderedLine[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;
  let additions = 0;
  let deletions = 0;
  const hunkHeaderRE = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] ?? '');

    if (line.startsWith('@@')) {
      const match = line.match(hunkHeaderRE);
      if (match) {
        oldLineNumber = Number(match[1]);
        newLineNumber = Number(match[2]);
      }
      rendered.push({ key: `${index}:meta`, text: line, oldLine: null, newLine: null, kind: 'meta' });
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      rendered.push({ key: `${index}:add`, text: line, oldLine: null, newLine: newLineNumber, kind: 'add' });
      newLineNumber += 1;
      additions += 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      rendered.push({ key: `${index}:del`, text: line, oldLine: oldLineNumber, newLine: null, kind: 'del' });
      oldLineNumber += 1;
      deletions += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      rendered.push({ key: `${index}:ctx`, text: line, oldLine: oldLineNumber, newLine: newLineNumber, kind: 'context' });
      oldLineNumber += 1;
      newLineNumber += 1;
      continue;
    }

    rendered.push({ key: `${index}:meta-fallback`, text: line, oldLine: null, newLine: null, kind: 'meta' });
  }

  const snapshot: GitPatchRenderSnapshot = {
    renderedLines: rendered,
    additions,
    deletions,
  };
  gitPatchRenderCache.set(cacheKey, snapshot);
  pruneGitPatchRenderCache();
  return snapshot;
}

export function parseGitPatchRenderedLines(patchText: string): GitPatchRenderedLine[] {
  return getGitPatchRenderSnapshot(patchText).renderedLines;
}

export function summarizeGitPatchRenderedLines(patchText: string): Readonly<{
  additions: number;
  deletions: number;
}> {
  const snapshot = getGitPatchRenderSnapshot(patchText);
  return {
    additions: snapshot.additions,
    deletions: snapshot.deletions,
  };
}

export function formatGitPatchLineNumber(value: number | null): string {
  if (!Number.isFinite(value)) return '';
  return String(value);
}

export function gitPatchPreviewLineClass(line: string): string {
  if (!line) return 'text-foreground';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-emerald-700 dark:text-emerald-300';
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-red-700 dark:text-red-300';
  if (line.startsWith('@@') || line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
    return 'text-muted-foreground/85';
  }
  return 'text-foreground';
}

export function gitPatchRenderedLineClass(line: GitPatchRenderedLine): string {
  switch (line.kind) {
    case 'add':
      return 'border-l-[2px] border-l-emerald-600/45 bg-emerald-500/12 dark:border-l-success/60 dark:bg-success/10';
    case 'del':
      return 'border-l-[2px] border-l-red-600/45 bg-red-500/12 dark:border-l-error/60 dark:bg-error/10';
    case 'meta':
      return 'border-l-[2px] border-l-muted-foreground/30 bg-muted/55';
    case 'context':
    default:
      return 'border-l-[2px] border-l-transparent bg-background/92';
  }
}

export function gitFileDisplayName(pathValue: string | undefined): string {
  const fullPath = String(pathValue ?? '').trim();
  if (!fullPath) return '(unknown)';
  const lastSlash = fullPath.lastIndexOf('/');
  return lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath;
}
