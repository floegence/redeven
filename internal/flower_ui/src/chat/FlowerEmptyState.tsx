import type { Component, JSX } from 'solid-js';
import { For, Show, createSignal, createUniqueId } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Files, FolderOpen, Grid, MonitorPointer, Sparkles } from '@floegence/floe-webapp-core/icons';

import type { FlowerEmptyStateCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import { FlowerSoftAuraIcon } from '../icons/FlowerSoftAuraIcon';

type FlowerEmptySuggestion = Readonly<{
  copy: FlowerEmptyStateCopy['suggestions'][number];
  prompt: string;
  icon: Component<{ class?: string }>;
}>;

const SUGGESTION_ICONS: readonly Component<{ class?: string }>[] = [FolderOpen, MonitorPointer, Grid, Files];

function suggestionRows(copy: FlowerEmptyStateCopy): readonly FlowerEmptySuggestion[] {
  return copy.suggestions.map((item, index) => ({
    copy: item,
    prompt: item.prompt,
    icon: SUGGESTION_ICONS[index] ?? Sparkles,
  }));
}

export type FlowerEmptyStateProps = Readonly<{
  disabled?: boolean;
  copy?: FlowerEmptyStateCopy;
  showSuggestions?: boolean;
  workingDirectory?: JSX.Element;
  onSuggestionClick: (prompt: string) => void;
}>;

export const FlowerHeroBadge: Component<{ class?: string }> = (props) => (
  <span class={cn('flower-empty-hero-badge mb-5 inline-flex h-20 w-20 items-center justify-center', props.class)}>
    <FlowerSoftAuraIcon
      class="redeven-flower-soft-aura-lg h-16 w-16"
      iconClass="redeven-flower-icon-spin"
    />
  </span>
);

export const FlowerEmptyState: Component<FlowerEmptyStateProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.emptyState;
  const suggestionsVisible = () => props.showSuggestions ?? true;

  return (
    <div
      class="flower-empty-state"
      data-suggestions-expanded={expanded()}
      data-flower-empty-suggestions={suggestionsVisible() ? 'visible' : 'hidden'}
    >
      <div class="flower-empty-hero">
        <FlowerHeroBadge />
        <h2 class="mb-2 text-base font-medium text-foreground">{copy().title}</h2>
        <p class="flower-body-copy leading-[22px] text-muted-foreground">{copy().description}</p>
        {props.workingDirectory}
      </div>

      <Show when={suggestionsVisible()}>
        <p class="flower-empty-suggestion-label"><Sparkles class="h-3.5 w-3.5" />{copy().suggestionsLabel}</p>
        <div class="flower-empty-suggestions" role="group" aria-label={copy().suggestionsLabel}>
          <For each={suggestionRows(copy())}>
            {(item) => {
              const Icon = item.icon;
              const descriptionID = createUniqueId();
              return (
                <div
                  class={cn(
                    'flower-empty-suggestion group relative flex min-w-0 items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors duration-[120ms]',
                    !props.disabled && 'hover:bg-accent',
                    props.disabled && 'opacity-50',
                  )}
                >
                  <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon class="h-5 w-5 text-primary" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <button
                      type="button"
                      class="flower-empty-suggestion-action mb-0.5 block w-full min-w-0 cursor-pointer truncate text-left text-[length:var(--floe-type-control)] font-medium text-foreground disabled:cursor-not-allowed"
                      title={item.copy.title}
                      aria-describedby={descriptionID}
                      disabled={props.disabled}
                      onClick={() => props.onSuggestionClick(item.prompt)}
                    >{item.copy.title}</button>
                    <p id={descriptionID} class="text-xs leading-relaxed text-muted-foreground">{item.copy.description}</p>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
        <button type="button" class="flower-empty-expand" aria-expanded={expanded()} onClick={() => setExpanded(value => !value)}>{expanded() ? copy().fewerSuggestions : copy().moreSuggestions}</button>
      </Show>

      <div class="flower-empty-hint">
        <span class="flex items-center gap-1.5">
          <kbd class="rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
          <span>{copy().sendKeyLabel}</span>
        </span>
        <span class="flex items-center gap-1.5">
          <kbd class="rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">Shift+Enter</kbd>
          <span>{copy().newLineKeyLabel}</span>
        </span>
      </div>
    </div>
  );
};
