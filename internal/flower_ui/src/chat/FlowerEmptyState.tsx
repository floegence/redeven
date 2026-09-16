import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Code, FolderOpen, GitBranch, Sparkles } from '@floegence/floe-webapp-core/icons';

import type { FlowerEmptyStateCopy } from '../copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../copy';
import { FlowerSoftAuraIcon } from '../icons/FlowerSoftAuraIcon';

type FlowerEmptySuggestion = Readonly<{
  copy: FlowerEmptyStateCopy['suggestions'][number];
  prompt: string;
  icon: Component<{ class?: string }>;
}>;

const SUGGESTION_ICONS: readonly Component<{ class?: string }>[] = [FolderOpen, GitBranch, Code, Sparkles];

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
  onSuggestionClick: (prompt: string) => void;
}>;

export const FlowerHeroBadge: Component<{ class?: string }> = (props) => (
  <span class={cn('flower-empty-hero-badge mb-5 inline-flex h-20 w-20 items-center justify-center', props.class)}>
    <FlowerSoftAuraIcon
      class="redeven-flower-soft-aura-lg h-16 w-16"
    />
  </span>
);

export const FlowerEmptyState: Component<FlowerEmptyStateProps> = (props) => {
  const copy = () => props.copy ?? DEFAULT_FLOWER_SURFACE_COPY.emptyState;
  const suggestionsVisible = () => props.showSuggestions ?? true;

  return (
    <div
      class="flower-empty-state"
      data-flower-empty-suggestions={suggestionsVisible() ? 'visible' : 'hidden'}
    >
      <div class="flower-empty-hero">
        <FlowerHeroBadge />
        <h2 class="mb-3 text-xl font-semibold text-foreground">{copy().title}</h2>
        <p class="text-sm leading-relaxed text-muted-foreground">{copy().description}</p>
      </div>

      <Show when={suggestionsVisible()}>
        <div class="flower-empty-suggestions">
          <For each={suggestionRows(copy())}>
            {(item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  onClick={() => props.onSuggestionClick(item.prompt)}
                  disabled={props.disabled}
                  class={cn(
                    'flower-empty-suggestion group flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors duration-[120ms]',
                    'hover:bg-accent',
                    'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card',
                  )}
                >
                  <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon class="h-5 w-5 text-primary" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="mb-0.5 text-sm font-medium text-foreground">{item.copy.title}</div>
                    <div class="text-xs leading-relaxed text-muted-foreground">{item.copy.description}</div>
                  </div>
                </button>
              );
            }}
          </For>
        </div>
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
