import { For, Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { gitToneBadgeClass, gitToneDotClass, gitToneSurfaceClass, type GitChromeTone } from './GitChrome';

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
            <span class={cn('h-1.5 w-1.5 shrink-0 rounded-full', gitToneDotClass(props.tone))} aria-hidden="true" />
            <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">{props.label}</div>
          </div>
          <Show when={props.description}>
            <div class="text-xs leading-relaxed text-muted-foreground">{props.description}</div>
          </Show>
        </div>
        <Show when={props.aside}>
          <div class="flex min-w-fit max-w-full flex-wrap items-center justify-end gap-1.5 text-right text-[10px] font-medium leading-5 text-muted-foreground">{props.aside}</div>
        </Show>
      </div>

      <Show when={props.children}>
        <div class={cn('mt-3', props.bodyClass)}>{props.children}</div>
      </Show>
    </section>
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
