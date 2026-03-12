import { describe, expect, it } from 'vitest';

import {
  gitBranchTone,
  gitChangePathClass,
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

    expect(gitChangePathClass('modified')).toBe('text-sky-700 dark:text-sky-300');
    expect(gitChangePathClass('deleted')).toBe('text-red-700 dark:text-red-300');
    expect(gitChangePathClass('added')).toBe('text-emerald-700 dark:text-emerald-300');
    expect(gitChangePathClass('renamed')).toBe('text-violet-700 dark:text-violet-300');
    expect(gitChangePathClass('copied')).toBe('text-primary');
  });

  it('keeps git chrome surfaces with tone-specific accent borders on transparent background', () => {
    expect(gitToneBadgeClass('warning')).toContain('bg-warning/12');
    expect(gitToneBadgeClass('warning')).toContain('text-warning');
    expect(gitToneBadgeClass('warning')).toContain('border-warning/20');
    expect(gitToneBadgeClass('brand')).toContain('bg-primary/[0.08]');
    expect(gitToneBadgeClass('brand')).toContain('text-primary');
    expect(gitToneBadgeClass('brand')).toContain('border-primary/20');

    expect(gitToneSurfaceClass('brand')).toContain('border-l-[3px]');
    expect(gitToneSurfaceClass('brand')).toContain('border-l-primary/60');
    expect(gitToneSurfaceClass('brand')).not.toContain('bg-');
    expect(gitToneSurfaceClass('warning')).toContain('border-l-warning/60');
    expect(gitToneSurfaceClass('warning')).not.toContain('bg-');
    expect(gitToneSurfaceClass('info')).not.toContain('bg-');
    expect(gitToneSurfaceClass('violet')).not.toContain('bg-');
    expect(gitToneSurfaceClass('neutral')).not.toContain('bg-');

    expect(gitToneInsetClass('violet')).toContain('bg-background/70');
    expect(gitToneInsetClass('violet')).toContain('border border-border/30');
    expect(gitToneInsetClass('warning')).toContain('bg-background/70');

    expect(gitToneAccentColor('info')).toBe('text-sky-500');
    expect(gitToneAccentColor('brand')).toBe('text-primary');
    expect(gitToneAccentColor('neutral')).toBe('text-muted-foreground');
  });

  it('uses a strong sidebar-accent selection style for selectable git items', () => {
    expect(gitToneSelectableCardClass('brand', true)).toContain('bg-sidebar-accent');
    expect(gitToneSelectableCardClass('brand', true)).toContain('text-sidebar-accent-foreground');
    expect(gitToneSelectableCardClass('brand', true)).toContain('border-sidebar-accent/80');
    expect(gitToneSelectableCardClass('brand', true)).toContain('shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_1px_2px_rgba(15,23,42,0.08)]');
    expect(gitToneSelectableCardClass('brand', true)).toContain('cursor-pointer');
    expect(gitToneSelectableCardClass('brand', true)).toContain('focus-visible:ring-2');

    expect(gitToneSelectableCardClass('info', false)).toContain('border-border/45');
    expect(gitToneSelectableCardClass('info', false)).toContain('hover:bg-sidebar-accent/70');
    expect(gitToneSelectableCardClass('info', false)).toContain('hover:text-sidebar-accent-foreground');
    expect(gitToneSelectableCardClass('info', false)).toContain('cursor-pointer');
    expect(gitToneSelectableCardClass('neutral', false)).toContain('hover:border-sidebar-accent/55');
    expect(gitToneSelectableCardClass('neutral', false)).not.toContain('hover:-translate-y-px');
  });

  it('uses rounded action buttons for git toolbar actions', () => {
    expect(gitToneActionButtonClass()).toContain('bg-background/72');
    expect(gitToneActionButtonClass()).toContain('hover:bg-background');
    expect(gitToneActionButtonClass()).toContain('text-muted-foreground');
    expect(gitToneActionButtonClass()).toContain('rounded-lg');
  });
});
