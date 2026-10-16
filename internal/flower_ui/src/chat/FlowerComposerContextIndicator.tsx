import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';
import { SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';
import { ChevronRight, X } from 'lucide-solid';
import type { FlowerContextSourceRow } from './flowerContextPresentation';

import type { FlowerContextUsage, FlowerModelContext } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { buildFlowerComposerContextIndicatorView, buildFlowerContextWindow, buildFlowerContextComposition, flowerRequestOutputSample, formatContextAmount } from './flowerContextPresentation';

export function FlowerComposerContextIndicator(props: {
  usage?: FlowerContextUsage;
  modelContext?: FlowerModelContext | null;
  placement?: 'above-end' | 'below-start';
  copy: FlowerSurfaceCopy;
}) {
  const labels = () => props.copy.chat.contextIndicator;
  const view = createMemo(() => buildFlowerComposerContextIndicatorView(props.usage ?? {}, props.copy));
  const contextWindow = createMemo(() => buildFlowerContextWindow(props.usage ?? {}));
  const requestOutput = createMemo(() => flowerRequestOutputSample(props.usage ?? {}));
  const threshold = createMemo(() => (props.usage?.estimate ?? props.usage?.confirmed)?.threshold_tokens);
  const composition = createMemo(() => buildFlowerContextComposition(props.usage ?? {}));
  const disclosures = new Map<string, HTMLElement>();
  const expanded = new Set<string>();
  const categories = createMemo(() => {
    const focused = [...disclosures.values()].find(element => element === document.activeElement);
    return { rows: new Map(composition()?.rows.map(row => [row.key, row])), focused };
  });
  createEffect(() => {
    const focused = categories().focused;
    // DOM moves temporarily blur a focused disclosure. Restore it after the
    // keyed rows settle so keyboard events still reach the panel.
    if (focused) queueMicrotask(() => {
      if (document.activeElement === document.body) {
        (focused.isConnected ? focused : trigger)?.focus({ preventScroll: true });
      }
    });
  });
  const percent = (share: number) => labels().percent(Math.round(share * 10) / 10);
  const SourceRow = (rowProps: { row: FlowerContextSourceRow }) => <>
    <i class="flower-context-swatch" aria-hidden="true" />
    <span class="flower-model-context-category-label">
      <span class="flower-model-context-label">{labels().sourceLabels[rowProps.row.key]}</span>
      <Show when={rowProps.row.items.length > 1 || (rowProps.row.items.length > 0 && rowProps.row.key.endsWith('_tools'))}>
        <ChevronRight class="flower-context-chevron" aria-hidden="true" />
      </Show>
    </span>
    <Show when={composition()?.showTokenAmounts}><span class="flower-model-context-amount" title={labels().estimated + ': ≈' + labels().tokens(String(rowProps.row.tokens))}>≈{formatContextAmount(rowProps.row.tokens)}</span></Show>
    <span class="flower-model-context-share">{percent(rowProps.row.share)}</span>
    <div class="flower-model-context-track" aria-hidden="true"><span class="flower-model-context-fill" style={{ width: rowProps.row.share + '%' }} /></div>
  </>;
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelDismiss = () => { clearTimeout(dismissTimer); };
  onCleanup(cancelDismiss);
  let container: HTMLDivElement | undefined;
  let panel: HTMLDivElement | undefined;
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const containsFocus = () => !!(container?.contains(document.activeElement) || panel?.contains(document.activeElement));
  const close = () => { trigger?.focus({ preventScroll: true }); setTooltipOpen(false); };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && tooltipOpen()) { event.stopPropagation(); event.preventDefault(); close(); }
  };
  createEffect(() => {
    if (!tooltipOpen() || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPosition({ x: props.placement === 'below-start' ? rect.left : rect.right - 368,
      y: props.placement === 'below-start' ? rect.bottom + 8 : rect.top - (panel?.offsetHeight || 500) - 8 });
  });
  let trigger: HTMLDivElement | undefined;
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  onMount(() => {
    setAnchor(trigger);
    const dismiss = (event: PointerEvent) => { if (container && !container.contains(event.target as Node) && !panel?.contains(event.target as Node)) setTooltipOpen(false); };
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
      onPointerEnter={() => { cancelDismiss(); setTooltipOpen(true); }}
      onPointerLeave={() => {
        if (!containsFocus()) dismissTimer = setTimeout(() => setTooltipOpen(false), 150);
      }}
      onFocusIn={() => { cancelDismiss(); setTooltipOpen(true); }}
      onFocusOut={() => {
        queueMicrotask(() => { if (!containsFocus()) setTooltipOpen(false); });
      }}
      onKeyDown={escape}
    >
      <div
        ref={trigger}
        class="flower-composer-context-progress"
        role="progressbar"
        aria-label={view().ariaLabel}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={view().progressValue ?? undefined}
        aria-valuetext={view().ariaValueText}
        aria-describedby={tooltipOpen() ? tooltipID : undefined}
        aria-controls={tooltipID}
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
      <SurfaceFloatingLayer owner={anchor()} position={position()} estimatedSize={{ width: 368, height: 500 }} class="flower-context-panel-layer" data-flower-floating-layer="true">
      <div
        ref={panel}
        onKeyDown={escape}
        onPointerEnter={cancelDismiss}
        onPointerLeave={() => { if (!containsFocus()) dismissTimer = setTimeout(() => setTooltipOpen(false), 150); }}
        onFocusOut={() => queueMicrotask(() => { if (!containsFocus()) setTooltipOpen(false); })}
        id={tooltipID}
        role="region"
        tabIndex={-1}
        aria-label={labels().label}
        class="flower-composer-context-tooltip"
        data-open={tooltipOpen() ? 'true' : undefined}
        aria-hidden={tooltipOpen() ? undefined : 'true'}
      >
        <div class="flower-context-heading">
          <span>{labels().label}</span>
          <button type="button" class="flower-context-close" aria-label={labels().close} onClick={close}><X size={14} aria-hidden="true" /></button>
          <span class="flower-context-total" title={contextWindow() ? `${labels().tokens(String(contextWindow()!.input))} / ${labels().tokens(String(contextWindow()!.capacity))}` : undefined}>
            <Show when={contextWindow()}>{(window) => <>
              <Show when={window().estimated}><span title={labels().estimated} aria-label={labels().estimated}>≈ </span></Show>
              {formatContextAmount(window().input)}<span class="flower-context-capacity"> / {formatContextAmount(window().capacity)}</span>
              {' '}
            </>}</Show>
            <span class="flower-context-ratio">{contextWindow() ? `(${view().ratioValue})` : view().ratioValue}</span>
          </span>
        </div>
        <div class="flower-context-stacked-bar flower-context-window-bar" aria-hidden="true">
          <Show when={contextWindow()} fallback={<span data-category="input" style={{ width: `${view().progressValue ?? 0}%` }} />}>
            {(window) => <For each={window().segments}>{(segment) => <span data-category={segment.key} style={{ width: `${segment.share}%` }} />}</For>}
          </Show>
        </div>
        <Show when={contextWindow()}>{(window) =>
          <div class="flower-context-window-legend">
            <For each={window().segments}>{(segment) =>
              <div class="flower-context-window-stat" data-category={segment.key} title={`${labels()[segment.key]}: ${labels().tokens(String(segment.tokens))} (${percent(segment.share)})`}>
                <span class="flower-context-stat-label"><i class="flower-context-swatch" aria-hidden="true" /><span>{labels()[segment.key]}</span></span>
                <span class="flower-context-stat-value">{formatContextAmount(segment.tokens)}</span>
              </div>
            }</For>
          </div>
        }</Show>
        <div class="flower-context-shared-space">{labels().sharedSpace}</div>
        <div class="flower-context-budget-facts">
          <div><span>{labels().compactThreshold}</span><strong>{threshold() ? formatContextAmount(threshold()!) : labels().unavailable}</strong></div>
          <div><span>{labels().requestOutputLimit}</span><strong>{requestOutput()?.output_control === 'server' ? labels().serverManaged
            : requestOutput()?.output_control === 'client' && requestOutput()?.request_output_tokens
              ? formatContextAmount(requestOutput()!.request_output_tokens!) : labels().unavailable}</strong></div>
        </div>
        <Show when={composition()}>
          <div class="flower-context-categories flower-context-composition" role="group" aria-label={labels().composition} data-token-amounts={composition()?.showTokenAmounts ? 'true' : 'false'}>
            <div class="flower-context-heading">
              <span>{labels().composition}</span>
              <span class="flower-context-estimate" title={!composition()?.showTokenAmounts ? labels().relativeHint : composition()?.historical ? labels().historicalHint : labels().compositionHint}>{composition()?.historical ? labels().historical : composition()?.showTokenAmounts ? labels().proportionalEstimate : labels().textShare}</span>
            </div>
            <For each={[...categories().rows.keys()]}>{(key) => {
              const row = () => categories().rows.get(key)!;
              const description = () => [labels().sourceLabels[key], composition()?.historical ? labels().historical : composition()?.showTokenAmounts ? labels().estimated : labels().textShare, ...(composition()?.showTokenAmounts ? ['≈' + labels().tokens(String(row().tokens))] : []), percent(row().share)].join(' · ');
              return <Show when={row().items.length > 1 || (row().items.length > 0 && key.endsWith('_tools'))} fallback={
                <div class="flower-context-composition-row" data-category={key} aria-label={description()}><SourceRow row={row()} /></div>
              }>
                <details class="flower-model-context-details" data-category={key} open={expanded.has(key)}
                  onToggle={(event) => { if (event.currentTarget.open) expanded.add(key); else expanded.delete(key); }}>
                  <summary ref={element => { disclosures.set(key, element); }} class="flower-context-composition-row flower-model-context-disclosure" aria-label={description()}>
                    <SourceRow row={row()} />
                  </summary>
                  <div class="flower-model-context-distribution" role="group" aria-label={labels().sourceLabels[key]}>
                    <For each={row().items}>{(item) => <div class="flower-model-context-row" data-source-key={item.key}>
                      <i class="flower-context-swatch" aria-hidden="true" />
                      <span class="flower-model-context-label" title={item.label}>{item.category ? labels().categoryLabels[item.category] : labels().sectionLabels[item.key] ?? item.label ?? labels().sourceLabels[key]}</span>
                      <Show when={composition()?.showTokenAmounts}><span class="flower-model-context-amount" title={labels().estimated + ': ≈' + labels().tokens(String(item.tokens))}>≈{formatContextAmount(item.tokens)}</span></Show>
                      <span class="flower-model-context-share">{percent(item.share)}</span>
                      <div class="flower-model-context-track" aria-hidden="true"><span class="flower-model-context-fill" style={{ width: item.share + '%' }} /></div>
                    </div>}</For>
                  </div>
                </details>
              </Show>;
            }}</For>
          </div>
        </Show>
        <Show when={!composition() && contextWindow()}>
          <div class="flower-context-composition-unavailable">{labels().composition}<span>{labels().distributionUnavailable}</span></div>
        </Show>
        <div class="flower-context-cache-stats">
          <div title={view().recentCacheHitLabel}>
            <span>{labels().recentCacheHitShortLabel}</span>
            <strong>{view().recentCacheHitValue}</strong>
          </div>
          <div title={view().cacheHitLabel}>
            <span>{labels().cacheHitShortLabel}</span>
            <strong>{view().cacheHitValue}</strong>
          </div>
        </div>
        <Show when={view().warning}>
          <div class="flower-composer-context-warning">{view().warning}</div>
        </Show>
      </div>
      </SurfaceFloatingLayer>
    </div>
  );
}
