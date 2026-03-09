import { For, Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { gitToneSurfaceClass, type GitChromeTone } from './GitChrome';

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
    <section class={cn('rounded-lg p-2 sm:p-2.5', gitToneSurfaceClass(props.tone), props.class)}>
      <div class="flex flex-wrap items-start justify-between gap-1.5">
        <div class="min-w-0 flex-1">
          <div class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">{props.label}</div>
          <Show when={props.description}>
            <div class="mt-0.5 text-[11px] leading-5 text-muted-foreground">{props.description}</div>
          </Show>
        </div>
        <Show when={props.aside}>
          <div class="shrink-0 text-[10px] font-medium text-muted-foreground">{props.aside}</div>
        </Show>
      </div>

      <Show when={props.children}>
        <div class={cn('mt-2', props.bodyClass)}>{props.children}</div>
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
    <div class={cn('grid gap-px overflow-hidden rounded-lg border border-border/35 bg-border/25 text-[11px]', props.columnsClass || 'grid-cols-2 lg:grid-cols-4', props.class)}>
      <For each={props.items}>
        {(item) => (
          <div class="bg-background/75 px-2.5 py-2">
            <div class="text-muted-foreground/75">{item.label}</div>
            <div class="mt-0.5 text-[11.5px] font-medium text-foreground">{item.value}</div>
            <Show when={item.hint}>
              <div class="mt-0.5 text-[10px] text-muted-foreground">{item.hint}</div>
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
  return <div class={cn('rounded-md bg-muted/20 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground', props.class)}>{props.children}</div>;
}
