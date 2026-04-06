import {
  parseGitPatchRenderedLines,
  type GitPatchRenderedLine,
} from '../utils/gitPatch';
import {
  hasMeaningfulGitPatchText,
  normalizeGitPatchText,
} from '../utils/gitPatchText';
import type { CodexFileChange } from './types';

export type CodexRenderableFileChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed';

export type CodexRenderableFilePatch = Readonly<{
  path: string;
  movePath?: string;
  changeKind: CodexRenderableFileChangeKind;
  patchText: string;
  renderedLines: readonly GitPatchRenderedLine[];
  additions: number;
  deletions: number;
}>;

function normalizeCodexFileChangeKind(
  value: string | null | undefined,
): CodexRenderableFileChangeKind {
  const normalized = String(value ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'add':
    case 'added':
    case 'create':
    case 'created':
    case 'new':
    case 'newfile':
    case 'new_file':
    case 'new file':
      return 'added';
    case 'delete':
    case 'deleted':
    case 'remove':
    case 'removed':
      return 'deleted';
    case 'rename':
    case 'renamed':
    case 'move':
    case 'moved':
      return 'renamed';
    default:
      return 'modified';
  }
}

export function codexFileChangeKindLabel(
  kind: CodexRenderableFileChangeKind,
): string {
  switch (kind) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'modified':
    default:
      return 'Modified';
  }
}

function patchSidePath(
  pathValue: string,
  side: 'a' | 'b',
): string {
  const trimmed = pathValue.trim();
  if (!trimmed) return '/dev/null';
  return `${side}/${trimmed}`;
}

function splitPlainTextLines(text: string): string[] {
  const normalized = normalizeGitPatchText(text);
  if (!normalized) return [];
  const withoutTrailingNewline = normalized.endsWith('\n')
    ? normalized.slice(0, -1)
    : normalized;
  if (!withoutTrailingNewline) return [];
  return withoutTrailingNewline.split('\n');
}

function isPatchMarkerLine(line: string): boolean {
  return (
    line.startsWith('diff --git ') ||
    line.startsWith('@@') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('+') ||
    line.startsWith('-') ||
    line.startsWith(' ') ||
    line.startsWith('\\ No newline at end of file')
  );
}

function looksLikeStructuredPatch(text: string): boolean {
  const lines = normalizeGitPatchText(text)
    .split('\n')
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return false;
  return lines.every(isPatchMarkerLine);
}

function buildSyntheticPatchHeaders(
  pathValue: string,
  movePath: string,
  changeKind: CodexRenderableFileChangeKind,
): string[] {
  const oldPath = changeKind === 'added'
    ? '/dev/null'
    : patchSidePath(pathValue, 'a');
  const nextPathValue = changeKind === 'renamed' && movePath
    ? movePath
    : pathValue;
  const newPath = changeKind === 'deleted'
    ? '/dev/null'
    : patchSidePath(nextPathValue, 'b');
  const diffIdentity = nextPathValue || pathValue;
  const diffHeaderPath = diffIdentity ? patchSidePath(diffIdentity, 'a') : 'a/(unknown)';
  const diffHeaderNextPath = diffIdentity ? patchSidePath(diffIdentity, 'b') : 'b/(unknown)';

  const headers = [`diff --git ${diffHeaderPath} ${diffHeaderNextPath}`];

  if (changeKind === 'added') {
    headers.push('new file mode 100644');
  } else if (changeKind === 'deleted') {
    headers.push('deleted file mode 100644');
  } else if (changeKind === 'renamed' && movePath) {
    headers.push(`rename from ${pathValue}`);
    headers.push(`rename to ${movePath}`);
  }

  headers.push(`--- ${oldPath}`);
  headers.push(`+++ ${newPath}`);
  return headers;
}

function buildSyntheticPatchBody(
  diffText: string,
  changeKind: CodexRenderableFileChangeKind,
): string[] {
  const lines = splitPlainTextLines(diffText);
  if (lines.length === 0) return [];

  switch (changeKind) {
    case 'added':
      return [
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line) => `+${line}`),
      ];
    case 'deleted':
      return [
        `@@ -1,${lines.length} +0,0 @@`,
        ...lines.map((line) => `-${line}`),
      ];
    case 'renamed':
    case 'modified':
    default:
      return [
        `@@ -1,${lines.length} +1,${lines.length} @@`,
        ...lines.map((line) => ` ${line}`),
      ];
  }
}

function buildCodexFilePatchText(
  change: CodexFileChange,
  changeKind: CodexRenderableFileChangeKind,
): string {
  const pathValue = String(change.path ?? '').trim();
  const movePath = String(change.move_path ?? '').trim();
  const diffText = normalizeGitPatchText(change.diff);
  const headers = buildSyntheticPatchHeaders(pathValue, movePath, changeKind);

  if (!hasMeaningfulGitPatchText(diffText)) {
    return headers.join('\n');
  }
  if (diffText.includes('diff --git ')) {
    return diffText;
  }
  if (looksLikeStructuredPatch(diffText)) {
    return [...headers, diffText].join('\n');
  }
  return [
    ...headers,
    ...buildSyntheticPatchBody(diffText, changeKind),
  ].join('\n');
}

function countPatchMetrics(
  renderedLines: readonly GitPatchRenderedLine[],
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of renderedLines) {
    if (line.kind === 'add') {
      additions += 1;
    } else if (line.kind === 'del') {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

export function buildCodexRenderableFilePatch(
  change: CodexFileChange,
): CodexRenderableFilePatch {
  const pathValue = String(change.path ?? '').trim() || 'Untitled change';
  const movePath = String(change.move_path ?? '').trim();
  const changeKind = normalizeCodexFileChangeKind(change.kind);
  const patchText = buildCodexFilePatchText(change, changeKind);
  const renderedLines = parseGitPatchRenderedLines(patchText);
  const metrics = countPatchMetrics(renderedLines);

  return {
    path: pathValue,
    movePath: movePath || undefined,
    changeKind,
    patchText,
    renderedLines,
    additions: metrics.additions,
    deletions: metrics.deletions,
  };
}
