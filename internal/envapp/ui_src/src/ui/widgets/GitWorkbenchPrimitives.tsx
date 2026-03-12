import { For, Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { gitChangeLabel, gitChangeTone, gitToneBadgeClass, gitToneDotClass, gitToneSurfaceClass, type GitChromeTone } from './GitChrome';

export interface GitSectionProps {
  label: string;
  description?: JSX.Element;
  aside?: JSX.Element;
  tone?: GitChromeTone;
  class?: string;
  bodyClass?: string;
  children?: JSX.Element;
}

export function GitSection(props: GitSectionProps) {
  return (
    <section class={cn('rounded-md border border-border/65 bg-card px-3 py-2.5', gitToneSurfaceClass(props.tone), props.class)}>
      <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5">
        <div class="min-w-0 space-y-1">
          <div class="flex items-center gap-2">
            <span class={cn('h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.04)]', gitToneDotClass(props.tone))} aria-hidden="true" />
            <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">{props.label}</div>
          </div>
          <Show when={props.description}>
            <div class="pl-4 text-xs leading-relaxed text-muted-foreground">{props.description}</div>
          </Show>
        </div>
        <Show when={props.aside}>
          <div class="flex min-w-fit max-w-full flex-wrap items-center justify-end gap-1.5 text-right text-[10px] font-medium leading-5 text-muted-foreground">{props.aside}</div>
        </Show>
      </div>

      <Show when={props.children}>
        <div class={cn('mt-2.5 pl-4', props.bodyClass)}>{props.children}</div>
      </Show>
    </section>
  );
}

export interface GitLabelBlockProps {
  label: string;
  tone?: GitChromeTone;
  meta?: JSX.Element;
  class?: string;
  bodyClass?: string;
  children?: JSX.Element;
}

export function GitLabelBlock(props: GitLabelBlockProps) {
  return (
    <div class={cn('space-y-1', props.class)}>
      <div class="flex flex-wrap items-center gap-2">
        <span class={cn('h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.04)]', gitToneDotClass(props.tone))} aria-hidden="true" />
        <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">{props.label}</div>
        <Show when={props.meta}>
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">{props.meta}</div>
        </Show>
      </div>
      <Show when={props.children}>
        <div class={cn('space-y-1 pl-4', props.bodyClass)}>{props.children}</div>
      </Show>
    </div>
  );
}

export interface GitStatItem {
  label: string;
  value: JSX.Element;
  hint?: JSX.Element;
}

export interface GitStatStripProps {
  items: GitStatItem[];
  columnsClass?: string;
  class?: string;
}

export function GitStatStrip(props: GitStatStripProps) {
  return (
    <div class={cn('grid gap-1 rounded-md bg-muted/[0.12] p-1 text-[11px]', props.columnsClass || 'grid-cols-2 lg:grid-cols-4', props.class)}>
      <For each={props.items}>
        {(item) => (
          <div class="rounded-md border border-border/45 bg-background/72 px-2.5 py-2 transition-shadow duration-150 hover:shadow-sm">
            <div class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">{item.label}</div>
            <div class="mt-1 text-xs font-semibold tracking-tight text-foreground">{item.value}</div>
            <Show when={item.hint}>
              <div class="mt-1 text-[10px] text-muted-foreground">{item.hint}</div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

export interface GitSubtleNoteProps {
  class?: string;
  children: JSX.Element;
}

export function GitSubtleNote(props: GitSubtleNoteProps) {
  return <div class={cn('rounded-md border border-border/45 bg-muted/[0.16] px-2.5 py-2 text-xs leading-relaxed text-muted-foreground', props.class)}>{props.children}</div>;
}

export const GIT_CHANGED_FILES_TABLE_CLASS = 'w-full text-[11px] leading-[1.1rem]';
export const GIT_CHANGED_FILES_HEAD_CLASS = 'sticky top-0 z-10 bg-muted/30 backdrop-blur';
export const GIT_CHANGED_FILES_HEADER_ROW_CLASS = 'border-b border-border/60 text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground';
export const GIT_CHANGED_FILES_HEADER_CELL_CLASS = 'px-2.5 py-1.5 font-medium';
export const GIT_CHANGED_FILES_CELL_CLASS = 'px-2.5 py-1.5 align-top';
export const GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS = 'sticky right-0 z-20 border-l border-border/50 bg-muted/30 px-2.5 py-1.5 text-right font-medium';
export const GIT_CHANGED_FILES_SECONDARY_PATH_CLASS = 'mt-px truncate text-[10px] leading-3.5 text-muted-foreground';
export const GIT_CHANGED_FILES_ACTION_BUTTON_CLASS = 'h-6 min-w-[5rem] justify-center rounded-sm px-2 text-[10px]';

export function gitChangedFilesRowClass(active: boolean): string {
  return active
    ? 'group border-b border-border/45 bg-muted/40 last:border-b-0'
    : 'group border-b border-border/45 bg-transparent hover:bg-muted/20 last:border-b-0';
}

export function gitChangedFilesStickyCellClass(active: boolean): string {
  return active
    ? 'sticky right-0 z-10 border-l border-border/45 bg-muted/40 px-2.5 py-1.5 text-right align-top shadow-[-1px_0_0_rgba(0,0,0,0.03)]'
    : 'sticky right-0 z-10 border-l border-border/45 bg-card px-2.5 py-1.5 text-right align-top shadow-[-1px_0_0_rgba(0,0,0,0.03)] group-hover:bg-muted/20';
}

export interface GitMetaPillProps {
  tone?: GitChromeTone;
  children: JSX.Element;
  class?: string;
}

export function GitMetaPill(props: GitMetaPillProps) {
  return (
    <span class={cn('inline-flex max-w-full items-center rounded px-2 py-0.5 text-[10px] font-medium tracking-[0.04em]', gitToneBadgeClass(props.tone), props.class)}>
      <span class="truncate">{props.children}</span>
    </span>
  );
}

export interface GitChangeStatusPillProps {
  change?: string | null;
  class?: string;
}

export function GitChangeStatusPill(props: GitChangeStatusPillProps) {
  return (
    <GitMetaPill tone={gitChangeTone(props.change ?? undefined)} class={cn('whitespace-nowrap', props.class)}>
      {gitChangeLabel(props.change ?? undefined)}
    </GitMetaPill>
  );
}

export interface GitPrimaryTitleProps {
  class?: string;
  children: JSX.Element;
}

export function GitPrimaryTitle(props: GitPrimaryTitleProps) {
  return <div class={cn('text-[13px] font-bold leading-5 tracking-tight text-foreground', props.class)}>{props.children}</div>;
}

export interface GitChangeMetricsProps {
  additions?: number | null;
  deletions?: number | null;
  class?: string;
}

export function GitChangeMetrics(props: GitChangeMetricsProps) {
  const additions = Number(props.additions ?? 0);
  const deletions = Number(props.deletions ?? 0);

  return (
    <span class={cn('inline-flex items-center gap-1.5 font-medium tabular-nums', props.class)}>
      <span class="text-success">+{additions}</span>
      <span class="text-muted-foreground/65">/</span>
      <span class="text-error">-{deletions}</span>
    </span>
  );
}
