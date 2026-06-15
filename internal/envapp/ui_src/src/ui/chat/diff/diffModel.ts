import { diffLines, type Change } from 'diff';

import type { CodeDiffRenderModel, UnifiedDiffLine } from '../types';

export const EMPTY_CODE_DIFF_RENDER_MODEL: CodeDiffRenderModel = {
  unifiedLines: [],
  stats: {
    added: 0,
    removed: 0,
  },
};

function splitChangeLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function resolveUnifiedLineType(change: Change): UnifiedDiffLine['type'] {
  if (change.added) return 'added';
  if (change.removed) return 'removed';
  return 'context';
}

function displayLineContent(value: string): string {
  return value === '' ? ' ' : value;
}

export function computeCodeDiffModel(oldCode: string, newCode: string): CodeDiffRenderModel {
  const changes = diffLines(oldCode, newCode);

  const unifiedLines: UnifiedDiffLine[] = [];
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let added = 0;
  let removed = 0;

  for (const change of changes) {
    const type = resolveUnifiedLineType(change);
    const lines = splitChangeLines(change.value);

    if (type === 'added') added += lines.length;
    if (type === 'removed') removed += lines.length;

    for (const rawLine of lines) {
      const content = displayLineContent(rawLine);

      if (type === 'added') {
        newLineNumber += 1;
        unifiedLines.push({
          type,
          sign: '+',
          lineNumber: newLineNumber,
          content,
        });
        continue;
      }

      if (type === 'removed') {
        oldLineNumber += 1;
        unifiedLines.push({
          type,
          sign: '-',
          lineNumber: oldLineNumber,
          content,
        });
        continue;
      }

      oldLineNumber += 1;
      newLineNumber += 1;
      unifiedLines.push({
        type: 'context',
        sign: ' ',
        lineNumber: oldLineNumber,
        content,
      });
    }
  }

  return {
    unifiedLines,
    stats: {
      added,
      removed,
    },
  };
}
