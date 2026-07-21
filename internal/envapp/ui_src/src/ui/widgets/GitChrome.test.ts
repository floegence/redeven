// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  gitBranchTone,
  gitChangeLabel,
  gitChangePathClass,
  gitChangeTone,
  gitCompareTone,
  gitSelectedChipClass,
  gitSelectedSecondaryTextClass,
  gitSubviewTone,
  gitToneAccentColor,
  gitToneActionButtonClass,
  gitToneBadgeClass,
  gitToneDotClass,
  gitToneHeaderActionButtonClass,
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
    expect(gitChangeTone('conflicted')).toBe('danger');
    expect(gitChangeTone('deleted')).toBe('danger');
    expect(gitChangeTone('renamed')).toBe('violet');
    expect(gitChangeTone('copied')).toBe('brand');
    expect(gitChangeTone('modified')).toBe('brand');

    expect(gitChangeLabel('added')).toBe('Added');
    expect(gitChangeLabel('conflicted')).toBe('Conflicted');
    expect(gitChangeLabel('modified')).toBe('Modified');
    expect(gitChangeLabel('unknown')).toBe('Unknown');

    expect(gitCompareTone(0, 0)).toBe('success');
    expect(gitCompareTone(2, 0)).toBe('brand');
    expect(gitCompareTone(0, 3)).toBe('warning');
    expect(gitCompareTone(1, 1)).toBe('warning');

    expect(gitBranchTone({ current: true, kind: 'local' } as any)).toBe('brand');
    expect(gitBranchTone({ current: false, kind: 'remote' } as any)).toBe('violet');
    expect(gitBranchTone({ current: false, kind: 'local' } as any)).toBe('violet');

    expect(gitChangePathClass('modified')).toBe('text-[var(--redeven-status-info-foreground)]');
    expect(gitChangePathClass('conflicted')).toBe('text-[var(--redeven-status-error-foreground)]');
    expect(gitChangePathClass('deleted')).toBe('text-[var(--redeven-status-error-foreground)]');
    expect(gitChangePathClass('added')).toBe('text-[var(--redeven-status-success-foreground)]');
    expect(gitChangePathClass('renamed')).toBe('text-[var(--redeven-categorical-6)]');
    expect(gitChangePathClass('copied')).toBe('text-primary');
  });

  it('keeps git chrome surfaces with tone-specific accent borders on transparent background', () => {
    expect(gitToneBadgeClass('info')).toContain('border-[var(--redeven-status-info-border)]');
    expect(gitToneBadgeClass('info')).toContain('bg-[var(--redeven-status-info-soft)]');
    expect(gitToneBadgeClass('info')).toContain('text-[var(--redeven-status-info-foreground)]');
    expect(gitToneBadgeClass('warning')).toContain('bg-warning/12');
    expect(gitToneBadgeClass('warning')).toContain('text-warning');
    expect(gitToneBadgeClass('warning')).toContain('border-warning/20');
    expect(gitToneBadgeClass('brand')).toContain('bg-primary/[0.08]');
    expect(gitToneBadgeClass('brand')).toContain('text-primary');
    expect(gitToneBadgeClass('brand')).toContain('border-primary/20');

    expect(gitToneDotClass('brand')).toContain('git-tone-dot');
    expect(gitToneDotClass('brand')).toContain('git-tone-dot--brand');
    expect(gitToneDotClass('neutral')).toContain('git-tone-dot');
    expect(gitToneDotClass('neutral')).toContain('git-tone-dot--neutral');
    expect(gitToneDotClass('warning')).toContain('git-tone-dot--warning');
    expect(gitToneDotClass('brand')).not.toContain('bg-blue-600/80');
    expect(gitToneDotClass('neutral')).not.toContain('bg-muted-foreground/55');

    expect(gitToneSurfaceClass('brand')).toContain('border-l-[3px]');
    expect(gitToneSurfaceClass('brand')).toContain('border-l-primary/60');
    expect(gitToneSurfaceClass('brand')).not.toContain('bg-');
    expect(gitToneSurfaceClass('warning')).toContain('border-l-warning/60');
    expect(gitToneSurfaceClass('warning')).not.toContain('bg-');
    expect(gitToneSurfaceClass('info')).not.toContain('bg-');
    expect(gitToneSurfaceClass('violet')).not.toContain('bg-');
    expect(gitToneSurfaceClass('neutral')).not.toContain('bg-');

    expect(gitToneInsetClass('violet')).toContain('redeven-surface-inset');
    expect(gitToneInsetClass('violet')).toContain('border');
    expect(gitToneInsetClass('warning')).toContain('redeven-surface-inset');

    expect(gitToneAccentColor('info')).toBe('text-[var(--redeven-status-info)]');
    expect(gitToneAccentColor('brand')).toBe('text-primary');
    expect(gitToneAccentColor('neutral')).toBe('text-muted-foreground');
  });

  it('uses a quiet git browser row selection surface for selectable items', () => {
    expect(gitToneSelectableCardClass('brand', true)).toContain('git-browser-selection-row');
    expect(gitToneSelectableCardClass('brand', true)).toContain('border-l-[2px]');
    expect(gitToneSelectableCardClass('brand', true)).not.toContain('git-browser-selection-surface');
    expect(gitToneSelectableCardClass('brand', true)).toContain('cursor-pointer');
    expect(gitToneSelectableCardClass('brand', true)).toContain('focus-visible:ring-2');

    expect(gitToneSelectableCardClass('info', false)).toContain('border-transparent');
    expect(gitToneSelectableCardClass('info', false)).toContain('bg-transparent');
    expect(gitToneSelectableCardClass('info', false)).toContain('hover:bg-muted/[0.18]');
    expect(gitToneSelectableCardClass('info', false)).toContain('hover:text-foreground');
    expect(gitToneSelectableCardClass('info', false)).toContain('cursor-pointer');
    expect(gitToneSelectableCardClass('neutral', false)).not.toContain('redeven-surface-control');
    expect(gitToneSelectableCardClass('neutral', false)).not.toContain('hover:-translate-y-px');
    expect(gitSelectedSecondaryTextClass(true)).toBe('git-browser-selection-secondary');
    expect(gitSelectedSecondaryTextClass(false)).toBe('text-muted-foreground');
    expect(gitSelectedChipClass(true)).toBe('git-browser-selection-chip');
    expect(gitSelectedChipClass(false)).toBe('');
  });

  it('uses rounded action buttons for git toolbar actions', () => {
    expect(gitToneActionButtonClass()).toContain('redeven-surface-control');
    expect(gitToneActionButtonClass()).toContain('redeven-surface-control--muted');
    expect(gitToneActionButtonClass()).toContain('text-muted-foreground');
    expect(gitToneActionButtonClass()).toContain('rounded-lg');

    expect(gitToneHeaderActionButtonClass()).toContain('bg-background/72');
    expect(gitToneHeaderActionButtonClass()).toContain('text-muted-foreground');
    expect(gitToneHeaderActionButtonClass()).toContain('rounded-lg');
    expect(gitToneHeaderActionButtonClass()).not.toContain('redeven-surface-control');
    expect(gitToneHeaderActionButtonClass()).not.toContain(' border ');
  });
});
