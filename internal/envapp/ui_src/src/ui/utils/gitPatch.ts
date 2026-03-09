import { hasMeaningfulGitPatchText, normalizeGitPatchText } from './gitPatchText';

export type GitPatchRenderedLineKind = 'add' | 'del' | 'context' | 'meta';

export type GitPatchRenderedLine = {
  key: string;
  text: string;
  oldLine: number | null;
  newLine: number | null;
  kind: GitPatchRenderedLineKind;
};

export const GIT_PATCH_PREVIEW_LINES = 220;

export function parseGitPatchRenderedLines(patchText: string): GitPatchRenderedLine[] {
  if (!hasMeaningfulGitPatchText(patchText)) {
    return [];
  }
  const lines = normalizeGitPatchText(patchText).split('\n');
  const rendered: GitPatchRenderedLine[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;
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
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      rendered.push({ key: `${index}:del`, text: line, oldLine: oldLineNumber, newLine: null, kind: 'del' });
      oldLineNumber += 1;
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

  return rendered;
}

export function formatGitPatchLineNumber(value: number | null): string {
  if (!Number.isFinite(value)) return '';
  return String(value);
}

export function gitPatchPreviewLineClass(line: string): string {
  if (!line) return 'text-foreground';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-success';
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-error';
  if (line.startsWith('@@') || line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
    return 'text-muted-foreground/85';
  }
  return 'text-foreground';
}

export function gitPatchRenderedLineClass(line: GitPatchRenderedLine): string {
  switch (line.kind) {
    case 'add':
      return 'bg-success/10';
    case 'del':
      return 'bg-error/[0.10]';
    case 'meta':
      return 'bg-muted/55';
    case 'context':
    default:
      return 'bg-background/92';
  }
}

export function gitChangeLabel(change: string | undefined): string {
  switch (String(change ?? '').trim()) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'copied':
      return 'Copied';
    case 'modified':
    default:
      return 'Updated';
  }
}

export function gitChangeClass(change: string | undefined): string {
  switch (String(change ?? '').trim()) {
    case 'added':
      return 'bg-success/12 text-success';
    case 'deleted':
      return 'bg-error/12 text-error';
    case 'renamed':
      return 'bg-violet-500/[0.10] text-violet-700 dark:text-violet-300';
    case 'copied':
      return 'bg-primary/[0.10] text-primary';
    case 'modified':
    default:
      return 'bg-sky-500/[0.10] text-sky-700 dark:text-sky-300';
  }
}

export function gitChangeDotClass(change: string | undefined): string {
  switch (String(change ?? '').trim()) {
    case 'added':
      return 'bg-success';
    case 'deleted':
      return 'bg-error';
    case 'renamed':
      return 'bg-violet-500';
    case 'copied':
      return 'bg-primary';
    case 'modified':
    default:
      return 'bg-sky-500';
  }
}

export function gitFileDisplayName(pathValue: string | undefined): string {
  const fullPath = String(pathValue ?? '').trim();
  if (!fullPath) return '(unknown)';
  const lastSlash = fullPath.lastIndexOf('/');
  return lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath;
}
