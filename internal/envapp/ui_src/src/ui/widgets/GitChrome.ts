import type { GitBranchSummary, GitWorkspaceSection } from '../protocol/redeven_v1';
import type { GitWorkbenchSubview } from '../utils/gitWorkbench';

export type GitChromeTone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'danger' | 'violet';

function normalizeTone(tone: GitChromeTone | undefined): GitChromeTone {
  return tone || 'neutral';
}

const badgeBaseClass = 'shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]';
const surfaceBaseClass = 'bg-muted/[0.18] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]';
const insetBaseClass = 'bg-background/65 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]';

export function gitToneBadgeClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'info':
      return `${badgeBaseClass} border-sky-500/20 bg-sky-500/[0.05] text-sky-700 dark:text-sky-300`;
    case 'brand':
      return `${badgeBaseClass} border-primary/20 bg-primary/[0.06] text-primary`;
    case 'success':
      return `${badgeBaseClass} border-success/20 bg-success/10 text-success`;
    case 'warning':
      return `${badgeBaseClass} border-warning/20 bg-warning/10 text-warning`;
    case 'danger':
      return `${badgeBaseClass} border-error/20 bg-error/10 text-error`;
    case 'violet':
      return `${badgeBaseClass} border-violet-500/20 bg-violet-500/[0.05] text-violet-700 dark:text-violet-300`;
    case 'neutral':
    default:
      return `${badgeBaseClass} border-border/50 bg-background/85 text-muted-foreground`;
  }
}

export function gitToneDotClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'info':
      return 'bg-sky-500/75';
    case 'brand':
      return 'bg-primary/75';
    case 'success':
      return 'bg-success/75';
    case 'warning':
      return 'bg-warning/75';
    case 'danger':
      return 'bg-error/75';
    case 'violet':
      return 'bg-violet-500/75';
    case 'neutral':
    default:
      return 'bg-muted-foreground/35';
  }
}

export function gitToneSurfaceClass(_tone?: GitChromeTone): string {
  return surfaceBaseClass;
}

export function gitToneInsetClass(_tone?: GitChromeTone): string {
  return insetBaseClass;
}

export function gitToneSelectableCardClass(_tone: GitChromeTone | undefined, active: boolean): string {
  const interactiveBase = 'cursor-pointer min-h-[42px] select-none transition-[background-color,box-shadow,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1';

  if (active) {
    return `${interactiveBase} border-transparent bg-background text-foreground shadow-sm`;
  }

  return `${interactiveBase} border-transparent bg-transparent text-foreground hover:bg-background/70`;
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
