import type { Component, JSX } from 'solid-js';
import { Show, createMemo } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, Check } from '@floegence/floe-webapp-core/icons';

import type { FlowerAutoSaveCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';

export const FlowerSubSectionHeader: Component<{
  title: string;
  description?: string;
  actions?: JSX.Element;
}> = (props) => (
  <div class="flex min-w-0 items-start justify-between gap-3">
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-foreground">{props.title}</h3>
      <Show when={props.description}>
        <p class="mt-1 text-xs leading-5 text-muted-foreground">{props.description}</p>
      </Show>
    </div>
    <Show when={props.actions}>
      <div class="flex flex-shrink-0 items-center gap-2">{props.actions}</div>
    </Show>
  </div>
);

export const FlowerFieldLabel: Component<{ children: JSX.Element; hint?: string }> = (props) => (
  <label class="mb-1.5 flex min-w-0 items-center justify-between gap-2">
    <span class="text-xs font-medium text-muted-foreground">{props.children}</span>
    <Show when={props.hint}>
      <span class="truncate text-[11px] text-muted-foreground/70">{props.hint}</span>
    </Show>
  </label>
);

export const FlowerSettingsPill: Component<{ children: JSX.Element; tone?: 'default' | 'success' | 'warning' }> = (props) => (
  <span
    class={cn(
      'inline-flex min-w-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
      props.tone === 'success' && 'border-success/30 bg-success/10 text-success',
      props.tone === 'warning' && 'border-warning/40 bg-warning/10 text-warning',
      (!props.tone || props.tone === 'default') && 'border-border/70 bg-muted/30 text-muted-foreground',
    )}
  >
    {props.children}
  </span>
);

export const FlowerCapabilityTag: Component<{ children: JSX.Element; active?: boolean }> = (props) => (
  <span
    class={cn(
      'inline-flex min-w-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
      props.active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
    )}
  >
    <span class={cn('h-1.5 w-1.5 rounded-full', props.active ? 'bg-primary' : 'bg-muted-foreground/40')} />
    {props.children}
  </span>
);

export const FlowerCodeBadge: Component<{ children: JSX.Element }> = (props) => (
  <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{props.children}</code>
);

export const FlowerAutoSaveIndicator: Component<{
  dirty: boolean;
  copy?: FlowerAutoSaveCopy;
  saving?: boolean;
  error?: string;
  savedAt?: number | null;
}> = (props) => {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.settings.autoSave;
  const label = createMemo(() => {
    if (props.saving) return copy().saving;
    if (props.error) return copy().saveFailed;
    if (props.dirty) return copy().unsaved;
    if (props.savedAt) return copy().saved;
    return copy().ready;
  });
  const tone = createMemo<'default' | 'success' | 'warning'>(() => {
    if (props.error) return 'warning';
    if (props.dirty || props.saving) return 'default';
    return 'success';
  });

  return (
    <FlowerSettingsPill tone={tone()}>
      <span class="inline-flex min-w-0 items-center gap-1.5">
        <Show when={props.error} fallback={<Check class="h-3 w-3" />}>
          <AlertTriangle class="h-3 w-3" />
        </Show>
        {label()}
      </span>
    </FlowerSettingsPill>
  );
};
