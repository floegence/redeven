import type { GitBranchSummary, GitWorkspaceSection } from '../protocol/redeven_v1';
import type { GitWorkbenchSubview } from '../utils/gitWorkbench';

export type GitChromeTone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'danger' | 'violet';

function normalizeTone(tone: GitChromeTone | undefined): GitChromeTone {
  return tone || 'neutral';
}

export function gitToneBadgeClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'info':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300';
    case 'brand':
      return 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300';
    case 'success':
      return 'border-success/30 bg-success/10 text-success';
    case 'warning':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'danger':
      return 'border-error/30 bg-error/10 text-error';
    case 'violet':
      return 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300';
    case 'neutral':
    default:
      return 'border-border/60 bg-background/80 text-foreground/85';
  }
}

export function gitToneSurfaceClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'info':
      return 'border-sky-500/20 bg-sky-500/[0.05]';
    case 'brand':
      return 'border-indigo-500/20 bg-indigo-500/[0.05]';
    case 'success':
      return 'border-success/20 bg-success/[0.06]';
    case 'warning':
      return 'border-warning/20 bg-warning/[0.06]';
    case 'danger':
      return 'border-error/20 bg-error/[0.06]';
    case 'violet':
      return 'border-violet-500/20 bg-violet-500/[0.05]';
    case 'neutral':
    default:
      return 'border-border/70 bg-muted/15';
  }
}

export function gitToneInsetClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'info':
      return 'border-sky-500/15 bg-background/80';
    case 'brand':
      return 'border-indigo-500/15 bg-background/80';
    case 'success':
      return 'border-success/15 bg-background/80';
    case 'warning':
      return 'border-warning/15 bg-background/80';
    case 'danger':
      return 'border-error/15 bg-background/80';
    case 'violet':
      return 'border-violet-500/15 bg-background/80';
    case 'neutral':
    default:
      return 'border-border/60 bg-background/70';
  }
}

export function gitToneSelectableCardClass(tone: GitChromeTone | undefined, active: boolean): string {
  if (active) {
    switch (normalizeTone(tone)) {
      case 'info':
        return 'border-sky-500/35 bg-sky-500/[0.08] text-foreground shadow-sm';
      case 'brand':
        return 'border-indigo-500/35 bg-indigo-500/[0.08] text-foreground shadow-sm';
      case 'success':
        return 'border-success/35 bg-success/[0.08] text-foreground shadow-sm';
      case 'warning':
        return 'border-warning/35 bg-warning/[0.08] text-foreground shadow-sm';
      case 'danger':
        return 'border-error/35 bg-error/[0.08] text-foreground shadow-sm';
      case 'violet':
        return 'border-violet-500/35 bg-violet-500/[0.08] text-foreground shadow-sm';
      case 'neutral':
      default:
        return 'border-border bg-background text-foreground shadow-sm';
    }
  }

  switch (normalizeTone(tone)) {
    case 'info':
      return 'border-sky-500/10 bg-background/70 text-foreground hover:border-sky-500/25 hover:bg-sky-500/[0.04]';
    case 'brand':
      return 'border-indigo-500/10 bg-background/70 text-foreground hover:border-indigo-500/25 hover:bg-indigo-500/[0.04]';
    case 'success':
      return 'border-success/10 bg-background/70 text-foreground hover:border-success/25 hover:bg-success/[0.04]';
    case 'warning':
      return 'border-warning/10 bg-background/70 text-foreground hover:border-warning/25 hover:bg-warning/[0.04]';
    case 'danger':
      return 'border-error/10 bg-background/70 text-foreground hover:border-error/25 hover:bg-error/[0.04]';
    case 'violet':
      return 'border-violet-500/10 bg-background/70 text-foreground hover:border-violet-500/25 hover:bg-violet-500/[0.04]';
    case 'neutral':
    default:
      return 'border-border/50 bg-background/60 text-foreground hover:border-border hover:bg-background';
  }
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

export function gitBranchTone(branch: GitBranchSummary | null | undefined): GitChromeTone {
  if (branch?.current) return 'brand';
  if (branch?.kind === 'remote') return 'violet';
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
