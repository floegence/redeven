import type { GitBranchSummary, GitWorkspaceSection } from '../protocol/redeven_v1';
import type { GitWorkbenchSubview } from '../utils/gitWorkbench';

export type GitChromeTone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'danger' | 'violet';

function normalizeTone(tone: GitChromeTone | undefined): GitChromeTone {
  return tone || 'neutral';
}

export function gitToneBadgeClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'info':
      return 'border-sky-500/20 bg-background/90 text-sky-700 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] dark:text-sky-300';
    case 'brand':
      return 'border-indigo-500/20 bg-background/90 text-indigo-700 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] dark:text-indigo-300';
    case 'success':
      return 'border-success/20 bg-background/90 text-success shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]';
    case 'warning':
      return 'border-warning/25 bg-warning/[0.06] text-warning shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]';
    case 'danger':
      return 'border-error/25 bg-error/[0.06] text-error shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]';
    case 'violet':
      return 'border-violet-500/20 bg-background/90 text-violet-700 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] dark:text-violet-300';
    case 'neutral':
    default:
      return 'border-border/60 bg-background/90 text-foreground/85 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]';
  }
}

export function gitToneSurfaceClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'info':
      return 'border-border/70 bg-gradient-to-b from-background via-background to-muted/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ring-1 ring-inset ring-sky-500/[0.05]';
    case 'brand':
      return 'border-border/70 bg-gradient-to-b from-background via-background to-muted/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ring-1 ring-inset ring-indigo-500/[0.05]';
    case 'success':
      return 'border-border/70 bg-gradient-to-b from-background via-background to-muted/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ring-1 ring-inset ring-success/10';
    case 'warning':
      return 'border-border/70 bg-gradient-to-b from-background via-background to-muted/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ring-1 ring-inset ring-warning/10';
    case 'danger':
      return 'border-border/70 bg-gradient-to-b from-background via-background to-muted/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ring-1 ring-inset ring-error/10';
    case 'violet':
      return 'border-border/70 bg-gradient-to-b from-background via-background to-muted/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ring-1 ring-inset ring-violet-500/[0.05]';
    case 'neutral':
    default:
      return 'border-border/70 bg-gradient-to-b from-background via-background to-muted/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ring-1 ring-inset ring-border/35';
  }
}

export function gitToneInsetClass(tone?: GitChromeTone): string {
  switch (normalizeTone(tone)) {
    case 'info':
      return 'border-border/60 bg-background/80 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset] ring-1 ring-inset ring-sky-500/[0.04]';
    case 'brand':
      return 'border-border/60 bg-background/80 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset] ring-1 ring-inset ring-indigo-500/[0.04]';
    case 'success':
      return 'border-border/60 bg-background/80 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset] ring-1 ring-inset ring-success/8';
    case 'warning':
      return 'border-border/60 bg-background/80 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset] ring-1 ring-inset ring-warning/10';
    case 'danger':
      return 'border-border/60 bg-background/80 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset] ring-1 ring-inset ring-error/10';
    case 'violet':
      return 'border-border/60 bg-background/80 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset] ring-1 ring-inset ring-violet-500/[0.04]';
    case 'neutral':
    default:
      return 'border-border/60 bg-background/80 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset] ring-1 ring-inset ring-border/30';
  }
}

export function gitToneSelectableCardClass(tone: GitChromeTone | undefined, active: boolean): string {
  const interactiveBase = 'cursor-pointer min-h-[42px] select-none transition-[border-color,background-color,box-shadow] duration-150 active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1';

  if (active) {
    switch (normalizeTone(tone)) {
      case 'info':
        return `${interactiveBase} border-border bg-background text-foreground shadow-sm ring-1 ring-inset ring-sky-500/[0.10]`;
      case 'brand':
        return `${interactiveBase} border-border bg-background text-foreground shadow-sm ring-1 ring-inset ring-indigo-500/[0.10]`;
      case 'success':
        return `${interactiveBase} border-border bg-background text-foreground shadow-sm ring-1 ring-inset ring-success/12`;
      case 'warning':
        return `${interactiveBase} border-border bg-background text-foreground shadow-sm ring-1 ring-inset ring-warning/12`;
      case 'danger':
        return `${interactiveBase} border-border bg-background text-foreground shadow-sm ring-1 ring-inset ring-error/12`;
      case 'violet':
        return `${interactiveBase} border-border bg-background text-foreground shadow-sm ring-1 ring-inset ring-violet-500/[0.10]`;
      case 'neutral':
      default:
        return `${interactiveBase} border-border bg-background text-foreground shadow-sm ring-1 ring-inset ring-border/40`;
    }
  }

  return `${interactiveBase} border-border/50 bg-background/60 text-foreground hover:border-border/70 hover:bg-muted/35`;
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
