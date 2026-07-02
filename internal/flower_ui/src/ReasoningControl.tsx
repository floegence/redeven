import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ChevronDown, Refresh } from '@floegence/floe-webapp-core/icons';

import type {
  FlowerReasoningCapability,
  FlowerReasoningLevel,
  FlowerReasoningSelection,
} from './contracts/flowerSurfaceContracts';
import {
  effectiveFlowerReasoningSelection,
  flowerReasoningLevelLabel,
  normalizeFlowerReasoningLevel,
  normalizeFlowerReasoningSelection,
  reasoningCapabilitySupportsControl,
} from './reasoning';

export type FlowerReasoningControlProps = Readonly<{
  capability?: FlowerReasoningCapability | null;
  selection?: FlowerReasoningSelection | null;
  label?: string;
  compact?: boolean;
  variant?: 'full' | 'badge' | 'segment';
  readOnly?: boolean;
  resettable?: boolean;
  resetLabel?: string;
  onChange?: (selection: FlowerReasoningSelection | undefined) => void;
}>;

const LEVEL_ORDER: readonly FlowerReasoningLevel[] = ['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function uniqueReasoningLevels(levels: readonly FlowerReasoningLevel[]): readonly FlowerReasoningLevel[] {
  const seen = new Set<FlowerReasoningLevel>();
  const out: FlowerReasoningLevel[] = [];
  for (const level of LEVEL_ORDER) {
    if (levels.includes(level) && !seen.has(level)) {
      seen.add(level);
      out.push(level);
    }
  }
  return out;
}

function capabilityLevels(capability: FlowerReasoningCapability): readonly FlowerReasoningLevel[] {
  const levels = (capability.supported_levels ?? [])
    .map(normalizeFlowerReasoningLevel)
    .filter((level): level is FlowerReasoningLevel => Boolean(level));
  if (capability.disable_supported) levels.push('off');
  if (capability.default_level || capability.default_enabled !== undefined) levels.push('default');
  return uniqueReasoningLevels(levels);
}

function badgeReasoningLevelLabel(level: FlowerReasoningLevel | string | null | undefined): string {
  return normalizeFlowerReasoningLevel(level) === 'default' ? 'On' : flowerReasoningLevelLabel(level);
}

function budgetPlaceholder(capability: FlowerReasoningCapability): string {
  if (capability.min_budget_tokens && capability.max_budget_tokens) {
    return `${capability.min_budget_tokens}-${capability.max_budget_tokens}`;
  }
  if (capability.min_budget_tokens) return `>= ${capability.min_budget_tokens}`;
  if (capability.max_budget_tokens) return `<= ${capability.max_budget_tokens}`;
  return 'tokens';
}

function clampBudget(capability: FlowerReasoningCapability, raw: unknown): number | undefined {
  const value = Math.floor(Number(raw));
  if (!Number.isSafeInteger(value) || value <= 0) return undefined;
  const min = Math.max(0, Math.floor(Number(capability.min_budget_tokens ?? 0)));
  const max = Math.max(0, Math.floor(Number(capability.max_budget_tokens ?? 0)));
  if (min > 0 && value < min) return min;
  if (max > 0 && value > max) return max;
  return value;
}

export function FlowerReasoningControl(props: FlowerReasoningControlProps) {
  let rootRef: HTMLDivElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  const [menuOpen, setMenuOpen] = createSignal(false);
  const capability = createMemo(() => props.capability ?? null);
  const visible = createMemo(() => reasoningCapabilitySupportsControl(capability()));
  const effectiveSelection = createMemo(() => effectiveFlowerReasoningSelection(capability(), props.selection));
  const levels = createMemo(() => {
    const cap = capability();
    return cap ? capabilityLevels(cap) : [];
  });
  const badgeLevels = createMemo(() => {
    const cap = capability();
    return cap ? capabilityLevels(cap) : [];
  });
  const supportsBudget = createMemo(() => {
    const cap = capability();
    return Boolean(cap?.budget_shape || cap?.min_budget_tokens || cap?.max_budget_tokens);
  });
  const selectedLevel = createMemo(() => effectiveSelection()?.level ?? 'default');
  const selectedBudget = createMemo(() => effectiveSelection()?.budget_tokens);
  const interactive = createMemo(() => !props.readOnly && typeof props.onChange === 'function');
  const label = createMemo(() => props.label ?? 'Reasoning');
  const badgeMode = createMemo(() => props.variant === 'badge');
  const segmentMode = createMemo(() => props.variant === 'segment');
  const menuVariant = createMemo(() => badgeMode() || segmentMode());
  const chipText = createMemo(() => {
    const cap = capability();
    if (!cap) return '';
    if (cap.kind === 'always_on') return 'Always on';
    const selection = effectiveSelection();
    if (supportsBudget() && selection?.budget_tokens) return `${selection.budget_tokens} tokens`;
    if (supportsBudget()) return 'Budget';
    const level = selection?.level ?? cap.default_level ?? 'default';
    return menuVariant() ? badgeReasoningLevelLabel(level) : flowerReasoningLevelLabel(level);
  });
  const menuEnabled = createMemo(() => interactive() && (menuVariant() ? badgeLevels().length > 1 || supportsBudget() : levels().length > 1 || supportsBudget()));
  const emitLevel = (level: FlowerReasoningLevel) => {
    const current = normalizeFlowerReasoningSelection(props.selection) ?? {};
    props.onChange?.({
      level,
      ...(level === 'off' ? {} : { budget_tokens: current.budget_tokens }),
    });
    if (menuVariant()) setMenuOpen(false);
  };
  const emitBudget = (raw: unknown) => {
    const cap = capability();
    if (!cap) return;
    const current = normalizeFlowerReasoningSelection(props.selection) ?? {};
    const budget = clampBudget(cap, raw);
    props.onChange?.({
      ...current,
      level: current.level === 'off' ? 'default' : current.level,
      ...(budget ? { budget_tokens: budget } : {}),
    });
  };
  const focusableMenuItems = () => Array.from(menuRef?.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button:not(:disabled), input:not(:disabled)') ?? []);
  const focusItem = (delta: number) => {
    const items = focusableMenuItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement | HTMLInputElement);
    items[(current + delta + items.length) % items.length]?.focus();
  };
  createEffect(() => {
    if (!menuOpen()) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef && event.target instanceof Node && rootRef.contains(event.target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (!menuRef || !(event.target instanceof Node) || !menuRef.contains(event.target)) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusItem(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusItem(-1);
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (rootRef && event.target instanceof Node && rootRef.contains(event.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    });
  });

  return (
    <Show when={visible()}>
      <div
        ref={rootRef}
        class={cn(
          'flower-reasoning-control',
          props.compact && 'flower-reasoning-control-compact',
          badgeMode() && 'flower-reasoning-control-badge',
          segmentMode() && 'flower-reasoning-control-segment',
        )}
      >
        <Show
          when={menuVariant()}
          fallback={(
            <>
              <span class="flower-reasoning-label">{label()}</span>
              <Show
                when={menuEnabled()}
                fallback={<span class="flower-reasoning-chip">{chipText()}</span>}
              >
                <div class="flower-reasoning-actions">
                  <Show when={props.resettable}>
                    <button
                      type="button"
                      class="flower-reasoning-reset"
                      title={props.resetLabel ?? 'Reset reasoning'}
                      aria-label={props.resetLabel ?? 'Reset reasoning'}
                      onClick={() => props.onChange?.(undefined)}
                    >
                      <Refresh class="h-3 w-3" />
                    </button>
                  </Show>
                  <Show when={levels().length > 1}>
                    <div class="flower-reasoning-segmented" role="group" aria-label={label()}>
                      <For each={levels()}>
                        {(level) => (
                          <button
                            type="button"
                            class={cn('flower-reasoning-segment', selectedLevel() === level && 'flower-reasoning-segment-active')}
                            aria-pressed={selectedLevel() === level}
                            onClick={() => emitLevel(level)}
                          >
                            {flowerReasoningLevelLabel(level)}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={supportsBudget() && selectedLevel() !== 'off'}>
                    <input
                      class="flower-reasoning-budget"
                      type="number"
                      min={capability()?.min_budget_tokens}
                      max={capability()?.max_budget_tokens}
                      value={selectedBudget() ?? ''}
                      placeholder={budgetPlaceholder(capability()!)}
                      onChange={(event) => emitBudget(event.currentTarget.value)}
                      aria-label={`${label()} budget tokens`}
                    />
                  </Show>
                </div>
              </Show>
            </>
          )}
        >
          <Show
            when={menuEnabled()}
            fallback={<span class={segmentMode() ? 'flower-reasoning-segment-static' : 'flower-reasoning-chip'}>{chipText()}</span>}
          >
            <button
              type="button"
              class={cn(
                segmentMode() ? 'flower-reasoning-segment-button' : 'flower-reasoning-badge-button',
                menuOpen() && (segmentMode() ? 'flower-reasoning-segment-button-open' : 'flower-reasoning-badge-button-open'),
              )}
              aria-haspopup="menu"
              aria-expanded={menuOpen()}
              aria-label={`${label()}: ${chipText()}`}
              title={`${label()}: ${chipText()}`}
              onClick={() => {
                const next = !menuOpen();
                setMenuOpen(next);
                if (next) queueMicrotask(() => focusableMenuItems()[0]?.focus());
              }}
            >
              <span>{chipText()}</span>
              <ChevronDown class="flower-reasoning-badge-icon" />
            </button>
            <Show when={menuOpen()}>
              <div ref={menuRef} class={cn('flower-reasoning-menu', segmentMode() && 'flower-reasoning-menu-segment')} role="menu" aria-label={label()}>
                <Show when={badgeLevels().length > 1}>
                  <For each={badgeLevels()}>
                    {(level) => (
                      <button
                        type="button"
                        role="menuitemradio"
                        class={cn('flower-reasoning-menu-item', selectedLevel() === level && 'flower-reasoning-menu-item-active')}
                        aria-checked={selectedLevel() === level}
                        onClick={() => emitLevel(level)}
                      >
                        {badgeReasoningLevelLabel(level)}
                      </button>
                    )}
                  </For>
                </Show>
                <Show when={supportsBudget() && selectedLevel() !== 'off'}>
                  <input
                    class="flower-reasoning-menu-budget"
                    type="number"
                    min={capability()?.min_budget_tokens}
                    max={capability()?.max_budget_tokens}
                    value={selectedBudget() ?? ''}
                    placeholder={budgetPlaceholder(capability()!)}
                    onChange={(event) => emitBudget(event.currentTarget.value)}
                    aria-label={`${label()} budget tokens`}
                  />
                </Show>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </Show>
  );
}
