import { For, Show, createMemo, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';

import type { FlowerContextUsage, FlowerModelContext } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { buildFlowerComposerContextIndicatorView } from './flowerContextPresentation';

export function FlowerComposerContextIndicator(props: {
  usage?: FlowerContextUsage;
  modelContext?: FlowerModelContext | null;
  placement?: 'above-end' | 'below-start';
  copy: FlowerSurfaceCopy;
}) {
  const view = createMemo(() => buildFlowerComposerContextIndicatorView(props.usage ?? {}, props.copy));
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  let container: HTMLDivElement | undefined;
  onMount(() => {
    const dismiss = (event: PointerEvent) => { if (container && !container.contains(event.target as Node)) setTooltipOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    onCleanup(() => document.removeEventListener('pointerdown', dismiss));
  });
  const tooltipID = `flower-composer-context-${createUniqueId()}`;
  const progressStyle = createMemo(() => ({
    '--flower-composer-context-progress': `${view().progressValue ?? 0}%`,
  }));
  const dataRatio = createMemo(() => {
    const ratio = view().ratio;
    return ratio === null ? 'unknown' : ratio.toFixed(4);
  });
  return (
    <div
      ref={container}
      class="flower-composer-context-indicator"
      data-context-pressure={view().tone}
      data-context-ratio={dataRatio()}
      data-context-placement={props.placement ?? 'above-end'}
      onPointerEnter={() => setTooltipOpen(true)}
      onPointerLeave={(event) => {
        if (!props.modelContext && !event.currentTarget.contains(document.activeElement)) setTooltipOpen(false);
      }}
      onFocusOut={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTooltipOpen(false); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && tooltipOpen()) {
          event.stopPropagation();
          setTooltipOpen(false);
        }
      }}
    >
      <div
        class="flower-composer-context-progress"
        role="progressbar"
        aria-label={view().ariaLabel}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={view().progressValue ?? undefined}
        aria-valuetext={view().ariaValueText}
        aria-describedby={tooltipOpen() ? tooltipID : undefined}
        tabIndex={0}
        style={progressStyle()}
        onFocus={() => setTooltipOpen(true)}
        onClick={() => setTooltipOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setTooltipOpen((open) => !open);
          }
        }}
      />
      <div
        id={tooltipID}
        role="region"
        aria-label={props.copy.chat.contextIndicator.label}
        class="flower-composer-context-tooltip"
        data-open={tooltipOpen() ? 'true' : undefined}
        aria-hidden={tooltipOpen() ? undefined : 'true'}
      >
        <div class="flower-composer-context-tooltip-row">
          <span>{view().ariaLabel}</span>
          <strong>{view().ratioValue}</strong>
        </div>
        <div class="flower-composer-context-tooltip-row">
          <span>{view().recentCacheHitLabel}</span>
          <strong>{view().recentCacheHitValue}</strong>
        </div>
        <div class="flower-composer-context-tooltip-row">
          <span>{view().cacheHitLabel}</span>
          <strong>{view().cacheHitValue}</strong>
        </div>
        <Show when={props.modelContext}>
          {(context) => (
            <div class="flower-model-context-details">
              <div class="flower-composer-context-tooltip-row">
                <span>{props.copy.chat.contextIndicator.runtimeFacts}</span>
                <strong>{context().used_at ? props.copy.chat.contextIndicator.used : props.copy.chat.contextIndicator.collected}</strong>
              </div>
              <div class="flower-model-context-time">{props.copy.chat.contextIndicator.collected}: {new Date(context().updated_at).toLocaleString()}</div>
              <Show when={context().used_at}><div class="flower-model-context-time">{props.copy.chat.contextIndicator.used}: {new Date(context().used_at!).toLocaleString()}</div></Show>
              <For each={context().snapshot.sections}>{(section) => (
                <details>
                  <summary>{section.title}<Show when={context().changed_keys.includes(section.key)}> · {props.copy.chat.contextIndicator.updated}</Show></summary>
                  <pre>{section.text}</pre>
                </details>
              )}</For>
              <Show when={context().removed_keys.length}><div>{props.copy.chat.contextIndicator.removed}: {context().removed_keys.join(', ')}</div></Show>
            </div>
          )}
        </Show>
        <Show when={view().warning}>
          <div class="flower-composer-context-warning">{view().warning}</div>
        </Show>
      </div>
    </div>
  );
}
