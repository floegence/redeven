import { describe, expect, it } from 'vitest';

import {
  gitBranchTone,
  gitChangeTone,
  gitCompareTone,
  gitSubviewTone,
  gitToneBadgeClass,
  gitToneInsetClass,
  gitToneSelectableCardClass,
  gitToneSurfaceClass,
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

  it('keeps git chrome surfaces calm while preserving status emphasis', () => {
    expect(gitToneBadgeClass('warning')).toContain('border-warning/25');
    expect(gitToneBadgeClass('warning')).toContain('bg-warning/[0.06]');
    expect(gitToneBadgeClass('warning')).not.toContain('bg-warning/10');
    expect(gitToneBadgeClass('brand')).toContain('bg-background/90');
    expect(gitToneBadgeClass('brand')).toContain('text-indigo-700');

    expect(gitToneSurfaceClass('brand')).toContain('bg-gradient-to-b from-background via-background to-muted/[0.06]');
    expect(gitToneSurfaceClass('brand')).toContain('ring-indigo-500/[0.05]');
    expect(gitToneSurfaceClass('brand')).not.toContain('from-indigo-500/[0.06]');

    expect(gitToneInsetClass('violet')).toContain('bg-background/80');
    expect(gitToneInsetClass('violet')).toContain('ring-violet-500/[0.04]');
    expect(gitToneInsetClass('violet')).not.toContain('border-violet-500/15');
  });

  it('uses unified neutral card fills for selectable git items', () => {
    expect(gitToneSelectableCardClass('brand', true)).toContain('bg-background');
    expect(gitToneSelectableCardClass('brand', true)).toContain('ring-indigo-500/[0.10]');
    expect(gitToneSelectableCardClass('brand', true)).not.toContain('bg-indigo-500/[0.08]');
    expect(gitToneSelectableCardClass('brand', true)).toContain('cursor-pointer');
    expect(gitToneSelectableCardClass('brand', true)).toContain('min-h-[42px]');
    expect(gitToneSelectableCardClass('brand', true)).toContain('focus-visible:ring-2');

    expect(gitToneSelectableCardClass('info', false)).toContain('hover:bg-muted/35');
    expect(gitToneSelectableCardClass('info', false)).not.toContain('hover:bg-sky-500/[0.04]');
    expect(gitToneSelectableCardClass('info', false)).toContain('cursor-pointer');
    expect(gitToneSelectableCardClass('neutral', false)).toContain('hover:border-border/70');
    expect(gitToneSelectableCardClass('neutral', false)).not.toContain('hover:-translate-y-px');
  });
});
