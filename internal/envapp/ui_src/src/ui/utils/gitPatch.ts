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
  const lines = String(patchText ?? '').replace(/\r\n?/g, '\n').split('\n');
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
  if (!line) return '';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'chat-tool-apply-patch-line-add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'chat-tool-apply-patch-line-del';
  if (line.startsWith('@@') || line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
    return 'chat-tool-apply-patch-line-meta';
  }
  return '';
}

export function gitPatchRenderedLineClass(line: GitPatchRenderedLine): string {
  switch (line.kind) {
    case 'add':
      return 'chat-tool-apply-patch-detail-line-add';
    case 'del':
      return 'chat-tool-apply-patch-detail-line-del';
    case 'meta':
      return 'chat-tool-apply-patch-detail-line-meta';
    case 'context':
    default:
      return '';
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
      return 'chat-tool-apply-patch-change-added';
    case 'deleted':
      return 'chat-tool-apply-patch-change-deleted';
    case 'renamed':
      return 'chat-tool-apply-patch-change-renamed';
    case 'copied':
    case 'modified':
    default:
      return 'chat-tool-apply-patch-change-modified';
  }
}

export function gitChangeDotClass(change: string | undefined): string {
  switch (String(change ?? '').trim()) {
    case 'added':
      return 'chat-tool-apply-patch-dot-added';
    case 'deleted':
      return 'chat-tool-apply-patch-dot-deleted';
    case 'renamed':
      return 'chat-tool-apply-patch-dot-renamed';
    case 'copied':
    case 'modified':
    default:
      return 'chat-tool-apply-patch-dot-modified';
  }
}

export function gitFileDisplayName(pathValue: string | undefined): string {
  const fullPath = String(pathValue ?? '').trim();
  if (!fullPath) return '(unknown)';
  const lastSlash = fullPath.lastIndexOf('/');
  return lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath;
}
