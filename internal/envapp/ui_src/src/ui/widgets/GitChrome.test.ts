import { describe, expect, it } from 'vitest';

import {
  gitBranchTone,
  gitChangeTone,
  gitCompareTone,
  gitSubviewTone,
  gitToneAccentColor,
  gitToneActionButtonClass,
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

  it('keeps git chrome surfaces with tone-specific accent borders and subtle status emphasis', () => {
    expect(gitToneBadgeClass('warning')).toContain('bg-warning/12');
    expect(gitToneBadgeClass('warning')).toContain('text-warning');
    expect(gitToneBadgeClass('warning')).toContain('border-warning/20');
    expect(gitToneBadgeClass('brand')).toContain('bg-primary/[0.08]');
    expect(gitToneBadgeClass('brand')).toContain('text-primary');
    expect(gitToneBadgeClass('brand')).toContain('border-primary/20');

    expect(gitToneSurfaceClass('brand')).toContain('border-l-[3px]');
    expect(gitToneSurfaceClass('brand')).toContain('border-l-primary/60');
    expect(gitToneSurfaceClass('brand')).toContain('bg-primary/[0.06]');
    expect(gitToneSurfaceClass('warning')).toContain('border-l-warning/60');
    expect(gitToneSurfaceClass('warning')).toContain('bg-warning/[0.06]');
    expect(gitToneSurfaceClass('neutral')).toContain('bg-muted/[0.16]');

    expect(gitToneInsetClass('violet')).toContain('bg-background/70');
    expect(gitToneInsetClass('violet')).toContain('border border-border/30');
    expect(gitToneInsetClass('warning')).toContain('bg-background/70');

    expect(gitToneAccentColor('info')).toBe('text-sky-500');
    expect(gitToneAccentColor('brand')).toBe('text-primary');
    expect(gitToneAccentColor('neutral')).toBe('text-muted-foreground');
  });

  it('uses one quiet selection style for selectable git items', () => {
    expect(gitToneSelectableCardClass('brand', true)).toContain('bg-background/92');
    expect(gitToneSelectableCardClass('brand', true)).toContain('shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.06)]');
    expect(gitToneSelectableCardClass('brand', true)).toContain('border-l-[2px]');
    expect(gitToneSelectableCardClass('brand', true)).toContain('border-l-primary');
    expect(gitToneSelectableCardClass('brand', true)).not.toContain('border-transparent');
    expect(gitToneSelectableCardClass('brand', true)).not.toContain('ring-indigo-500/[0.10]');
    expect(gitToneSelectableCardClass('brand', true)).toContain('cursor-pointer');
    expect(gitToneSelectableCardClass('brand', true)).toContain('min-h-[38px]');
    expect(gitToneSelectableCardClass('brand', true)).toContain('focus-visible:ring-2');

    expect(gitToneSelectableCardClass('info', false)).toContain('hover:bg-background/72');
    expect(gitToneSelectableCardClass('info', false)).toContain('hover:shadow-sm');
    expect(gitToneSelectableCardClass('info', false)).not.toContain('hover:bg-sky-500/[0.04]');
    expect(gitToneSelectableCardClass('info', false)).toContain('cursor-pointer');
    expect(gitToneSelectableCardClass('neutral', false)).not.toContain('border-transparent');
    expect(gitToneSelectableCardClass('neutral', false)).not.toContain('hover:-translate-y-px');
  });

  it('uses rounded action buttons for git toolbar actions', () => {
    expect(gitToneActionButtonClass()).toContain('bg-background/72');
    expect(gitToneActionButtonClass()).toContain('hover:bg-background');
    expect(gitToneActionButtonClass()).toContain('text-muted-foreground');
    expect(gitToneActionButtonClass()).toContain('rounded-lg');
  });
});
