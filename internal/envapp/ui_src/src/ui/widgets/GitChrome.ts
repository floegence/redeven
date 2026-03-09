import type { GitBranchSummary, GitWorkspaceSection } from '../protocol/redeven_v1';
import type { GitWorkbenchSubview } from '../utils/gitWorkbench';

export type GitChromeTone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'danger' | 'violet';

function normalizeTone(tone: GitChromeTone | undefined): GitChromeTone {
  return tone || 'neutral';
}

const badgeBaseClass = 'border-border/50 bg-background/85 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]';
const surfaceBaseClass = 'border border-border/45 bg-background/80 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]';
const insetBaseClass = 'border border-border/35 bg-muted/20 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]';

export function gitToneBadgeClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'success':
      return `${badgeBaseClass} text-success`;
    case 'warning':
      return `${badgeBaseClass} text-warning`;
    case 'danger':
      return `${badgeBaseClass} text-error`;
    case 'brand':
    case 'violet':
    case 'info':
      return `${badgeBaseClass} text-foreground/85`;
    case 'neutral':
    default:
      return `${badgeBaseClass} text-muted-foreground`;
  }
}

export function gitToneSurfaceClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'success':
      return `${surfaceBaseClass} ring-1 ring-inset ring-success/6`;
    case 'warning':
      return `${surfaceBaseClass} ring-1 ring-inset ring-warning/6`;
    case 'danger':
      return `${surfaceBaseClass} ring-1 ring-inset ring-error/6`;
    case 'info':
    case 'brand':
    case 'violet':
    case 'neutral':
    default:
      return `${surfaceBaseClass} ring-1 ring-inset ring-border/20`;
  }
}

export function gitToneInsetClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'success':
      return `${insetBaseClass} ring-1 ring-inset ring-success/6`;
    case 'warning':
      return `${insetBaseClass} ring-1 ring-inset ring-warning/6`;
    case 'danger':
      return `${insetBaseClass} ring-1 ring-inset ring-error/6`;
    case 'info':
    case 'brand':
    case 'violet':
    case 'neutral':
    default:
      return `${insetBaseClass} ring-1 ring-inset ring-border/15`;
  }
}

export function gitToneSelectableCardClass(_tone: GitChromeTone | undefined, active: boolean): string {
  const interactiveBase = 'cursor-pointer min-h-[42px] select-none transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1';

  if (active) {
    return `${interactiveBase} border-border bg-background text-foreground shadow-sm`;
  }

  return `${interactiveBase} border-border/40 bg-background/60 text-foreground hover:border-border/55 hover:bg-muted/40`;
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
