import { describe, expect, it } from 'vitest';

import {
  gitPatchPreviewLineClass,
  gitPatchRenderedLineClass,
  type GitPatchRenderedLine,
} from './gitPatch';

function renderedLine(kind: GitPatchRenderedLine['kind']): GitPatchRenderedLine {
  return {
    key: `${kind}-line`,
    kind,
    text: kind === 'add' ? '+value' : '-value',
    oldLine: kind === 'del' ? 1 : null,
    newLine: kind === 'add' ? 1 : null,
  };
}

describe('git patch semantic colors', () => {
  it('uses status aliases for added and deleted preview lines', () => {
    expect(gitPatchPreviewLineClass('+value')).toBe('text-[var(--redeven-status-success-foreground)]');
    expect(gitPatchPreviewLineClass('-value')).toBe('text-[var(--redeven-status-error-foreground)]');
  });

  it('uses status surfaces for rendered additions and deletions', () => {
    expect(gitPatchRenderedLineClass(renderedLine('add'))).toContain('bg-[var(--redeven-status-success-soft)]');
    expect(gitPatchRenderedLineClass(renderedLine('del'))).toContain('bg-[var(--redeven-status-error-soft)]');
  });
});
