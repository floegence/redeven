import { cn } from '@floegence/floe-webapp-core';
import type { GitBranchSummary, GitWorkspaceSection } from '../protocol/redeven_v1';
import type { GitWorkbenchSubview } from '../utils/gitWorkbench';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';

export type GitChromeTone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'danger' | 'violet';

function normalizeTone(tone: GitChromeTone | undefined): GitChromeTone {
  return tone || 'neutral';
}

const badgeBaseClass = 'shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] border';
const insetBaseClass = cn(
  'border shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]',
  redevenSurfaceRoleClass('inset'),
);
const actionButtonBaseClass =
  cn(
    'cursor-pointer rounded-lg border text-muted-foreground shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition-[background-color,color,box-shadow] duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1',
    redevenSurfaceRoleClass('controlMuted'),
  );
const headerActionButtonBaseClass =
  'cursor-pointer rounded-lg bg-background/72 text-muted-foreground shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition-[background-color,color,box-shadow] duration-200 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1';

export function gitToneBadgeClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'info':
      return `${badgeBaseClass} border-blue-500/25 bg-blue-500/10 text-blue-700 dark:border-sky-500/20 dark:bg-sky-500/[0.08] dark:text-sky-300`;
    case 'brand':
      return `${badgeBaseClass} border-primary/20 bg-primary/[0.08] text-primary`;
    case 'success':
      return `${badgeBaseClass} border-success/20 bg-success/12 text-success`;
    case 'warning':
      return `${badgeBaseClass} border-warning/20 bg-warning/12 text-warning`;
    case 'danger':
      return `${badgeBaseClass} border-error/20 bg-error/12 text-error`;
    case 'violet':
      return `${badgeBaseClass} border-violet-500/20 bg-violet-500/[0.08] text-violet-700 dark:text-violet-300`;
    case 'neutral':
    default:
      return cn(badgeBaseClass, redevenSurfaceRoleClass('controlMuted'), 'text-muted-foreground');
  }
}

export function gitToneDotClass(tone?: GitChromeTone): string {
  const normalized = normalizeTone(tone);
  return cn('git-tone-dot', `git-tone-dot--${normalized}`);
}

export function gitToneSurfaceClass(tone?: GitChromeTone): string {
  const base = 'border-l-[3px]';
  switch (normalizeTone(tone)) {
    case 'info':
      return `${base} border-l-sky-500/60`;
    case 'brand':
      return `${base} border-l-primary/60`;
    case 'success':
      return `${base} border-l-success/60`;
    case 'warning':
      return `${base} border-l-warning/60`;
    case 'danger':
      return `${base} border-l-error/60`;
    case 'violet':
      return `${base} border-l-violet-500/60`;
    case 'neutral':
    default:
      return `${base} border-l-muted-foreground/25`;
  }
}

export function gitToneInsetClass(_tone?: GitChromeTone): string {
  return insetBaseClass;
}

export function gitToneAccentColor(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'info':
      return 'text-sky-500';
    case 'brand':
      return 'text-primary';
    case 'success':
      return 'text-success';
    case 'warning':
      return 'text-warning';
    case 'danger':
      return 'text-error';
    case 'violet':
      return 'text-violet-500';
    case 'neutral':
    default:
      return 'text-muted-foreground';
  }
}

export function gitChangePathClass(change: string | undefined): string {
  switch (String(change ?? '').trim()) {
    case 'added':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'conflicted':
    case 'deleted':
      return 'text-red-700 dark:text-red-300';
    case 'renamed':
      return 'text-violet-700 dark:text-violet-300';
    case 'copied':
      return 'text-primary';
    case 'modified':
    default:
      return 'text-blue-700 dark:text-sky-300';
  }
}

export function gitToneActionButtonClass(): string {
  return actionButtonBaseClass;
}

export function gitToneHeaderActionButtonClass(): string {
  return headerActionButtonBaseClass;
}

export function gitToneSelectableCardClass(_tone: GitChromeTone | undefined, active: boolean): string {
  const interactiveBase =
    'cursor-pointer select-none border transition-[background-color,border-color,box-shadow,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1';

  if (active) {
    return `${interactiveBase} git-browser-selection-surface`;
  }

  return cn(
    interactiveBase,
    redevenSurfaceRoleClass('control'),
    'bg-transparent text-foreground hover:border-sidebar-accent/55 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
  );
}

export function gitSelectedSecondaryTextClass(active: boolean): string {
  return active ? 'git-browser-selection-secondary' : 'text-muted-foreground';
}

export function gitSelectedChipClass(active: boolean): string {
  return active ? 'git-browser-selection-chip' : '';
}

export function gitSubviewTone(view: GitWorkbenchSubview): GitChromeTone {
  switch (view) {
    case 'changes':
      return 'warning';
    case 'branches':
      return 'violet';
    case 'history':
      return 'brand';
    case 'overview':
    default:
      return 'info';
  }
}

export function workspaceSectionTone(section: GitWorkspaceSection | string | undefined): GitChromeTone {
  switch (String(section ?? '').trim()) {
    case 'changes':
      return 'warning';
    case 'staged':
      return 'success';
    case 'unstaged':
      return 'warning';
    case 'untracked':
      return 'info';
    case 'conflicted':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function gitChangeTone(change: string | undefined): GitChromeTone {
  switch (String(change ?? '').trim()) {
    case 'added':
      return 'success';
    case 'conflicted':
    case 'deleted':
      return 'danger';
    case 'renamed':
      return 'violet';
    case 'copied':
      return 'brand';
    case 'modified':
    default:
      return 'info';
  }
}

export function gitChangeLabel(change: string | undefined): string {
  const normalized = String(change ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'added':
      return 'Added';
    case 'conflicted':
      return 'Conflicted';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'copied':
      return 'Copied';
    case 'modified':
      return 'Modified';
    default:
      return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Modified';
  }
}

export function gitBranchTone(branch: GitBranchSummary | null | undefined): GitChromeTone {
  if (branch?.current) return 'brand';
  if (branch?.kind === 'remote' || branch?.kind === 'local') return 'violet';
  return 'neutral';
}

export function gitCompareTone(ahead?: number, behind?: number): GitChromeTone {
  const aheadCount = Number(ahead ?? 0);
  const behindCount = Number(behind ?? 0);
  if (aheadCount <= 0 && behindCount <= 0) return 'success';
  if (aheadCount > 0 && behindCount > 0) return 'warning';
  if (aheadCount > 0) return 'brand';
  return 'warning';
}
