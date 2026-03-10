import { For, Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { gitToneDotClass, gitToneSurfaceClass, type GitChromeTone } from './GitChrome';

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
    <section class={cn('rounded-md p-2 sm:p-2.5', gitToneSurfaceClass(props.tone), props.class)}>
      <div class="flex flex-wrap items-start justify-between gap-1.5">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class={cn('h-1.5 w-1.5 shrink-0 rounded-full', gitToneDotClass(props.tone))} aria-hidden="true" />
            <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{props.label}</div>
          </div>
          <Show when={props.description}>
            <div class="ml-[calc(0.375rem+6px)] mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{props.description}</div>
          </Show>
        </div>
        <Show when={props.aside}>
          <div class="shrink-0 text-[10px] font-medium text-muted-foreground">{props.aside}</div>
        </Show>
      </div>

      <Show when={props.children}>
        <div class={cn('mt-1.5', props.bodyClass)}>{props.children}</div>
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
    <div class={cn('grid gap-0.5 rounded-md bg-muted/[0.12] p-0.5 text-[11px]', props.columnsClass || 'grid-cols-2 lg:grid-cols-4', props.class)}>
      <For each={props.items}>
        {(item) => (
          <div class="rounded bg-background/70 px-2 py-1.5 transition-shadow duration-150 hover:shadow-sm">
            <div class="text-[10px] text-muted-foreground/75">{item.label}</div>
            <div class="mt-0.5 text-[11px] font-medium tracking-tight text-foreground">{item.value}</div>
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
  return <div class={cn('rounded border-l-2 border-muted-foreground/20 bg-background/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground', props.class)}>{props.children}</div>;
}
