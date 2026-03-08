import { describe, expect, it } from 'vitest';

import {
  gitBranchTone,
  gitChangeTone,
  gitCompareTone,
  gitSubviewTone,
  gitToneBadgeClass,
  gitToneSelectableCardClass,
  workspaceSectionTone,
} from './GitChrome';

describe('GitChrome semantic tone helpers', () => {
  it('maps git subviews and workspace sections to stable tones', () => {
    expect(gitSubviewTone('overview')).toBe('info');
    expect(gitSubviewTone('changes')).toBe('warning');
    expect(gitSubviewTone('branches')).toBe('violet');
    expect(gitSubviewTone('history')).toBe('brand');

    expect(workspaceSectionTone('staged')).toBe('success');
    expect(workspaceSectionTone('unstaged')).toBe('warning');
    expect(workspaceSectionTone('untracked')).toBe('info');
    expect(workspaceSectionTone('conflicted')).toBe('danger');
    expect(workspaceSectionTone('unknown')).toBe('neutral');
  });

  it('maps file changes, compare states, and branches to consistent tones', () => {
    expect(gitChangeTone('added')).toBe('success');
    expect(gitChangeTone('deleted')).toBe('danger');
    expect(gitChangeTone('renamed')).toBe('violet');
    expect(gitChangeTone('copied')).toBe('brand');
    expect(gitChangeTone('modified')).toBe('info');

    expect(gitCompareTone(0, 0)).toBe('success');
    expect(gitCompareTone(2, 0)).toBe('brand');
    expect(gitCompareTone(0, 3)).toBe('warning');
    expect(gitCompareTone(1, 1)).toBe('warning');

    expect(gitBranchTone({ current: true, kind: 'local' } as any)).toBe('brand');
    expect(gitBranchTone({ current: false, kind: 'remote' } as any)).toBe('violet');
    expect(gitBranchTone({ current: false, kind: 'local' } as any)).toBe('neutral');
  });

  it('returns tone-aware classes for badges and selectable cards', () => {
    expect(gitToneBadgeClass('warning')).toContain('bg-warning/10');
    expect(gitToneBadgeClass('brand')).toContain('text-indigo-700');
    expect(gitToneSelectableCardClass('brand', true)).toContain('bg-indigo-500/[0.08]');
    expect(gitToneSelectableCardClass('brand', true)).toContain('cursor-pointer');
    expect(gitToneSelectableCardClass('brand', true)).toContain('min-h-[42px]');
    expect(gitToneSelectableCardClass('brand', true)).toContain('focus-visible:ring-2');
    expect(gitToneSelectableCardClass('info', false)).toContain('hover:bg-sky-500/[0.04]');
    expect(gitToneSelectableCardClass('info', false)).toContain('cursor-pointer');
    expect(gitToneSelectableCardClass('info', false)).not.toContain('hover:-translate-y-px');
    expect(gitToneSelectableCardClass('neutral', false)).toContain('hover:bg-background');
    expect(gitToneSelectableCardClass('neutral', false)).not.toContain('hover:-translate-y-px');
  });
});
