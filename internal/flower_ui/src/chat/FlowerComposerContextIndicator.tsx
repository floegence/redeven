import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';
import { SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';
import { ChevronRight, X } from 'lucide-solid';
import type { FlowerContextSourceRow } from './flowerContextPresentation';

import type { FlowerContextUsage, FlowerModelContext } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { buildFlowerComposerContextIndicatorView, buildFlowerContextWindow, buildFlowerContextComposition, formatContextAmount } from './flowerContextPresentation';

export function FlowerComposerContextIndicator(props: {
  usage?: FlowerContextUsage;
  modelContext?: FlowerModelContext | null;
  placement?: 'above-end' | 'below-start';
  copy: FlowerSurfaceCopy;
}) {
  const labels = () => props.copy.chat.contextIndicator;
  const view = createMemo(() => buildFlowerComposerContextIndicatorView(props.usage ?? {}, props.copy));
  const contextWindow = createMemo(() => buildFlowerContextWindow(props.usage ?? {}));
  const composition = createMemo(() => buildFlowerContextComposition(props.usage ?? {}));
  const disclosures = new Map<string, HTMLElement>();
  const expanded = new Set<string>();
  const categories = createMemo(() => {
    const focused = [...disclosures.values()].find(element => element === document.activeElement || element.parentElement?.contains(document.activeElement));
    return { rows: new Map(composition()?.rows.map(row => [row.key, row])), focused };
  });
  createEffect(() => {
    const focused = categories().focused;
    // DOM moves temporarily blur a focused disclosure. Restore it after the
    // keyed rows settle so keyboard events still reach the panel.
    if (focused) queueMicrotask(() => {
      if (document.activeElement === document.body) {
        (focused.isConnected && composition()?.rows.some(row => disclosures.get(row.key) === focused) ? focused : trigger)?.focus({ preventScroll: true });
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
    <Show when={composition()}><span class="flower-model-context-amount" title={labels().characters(String(rowProps.row.characters))}>{labels().characters(formatContextAmount(rowProps.row.characters))}</span></Show>
    <span class="flower-model-context-share">{percent(rowProps.row.share)}</span>
    <div class="flower-model-context-track" aria-hidden="true"><span class="flower-model-context-fill" style={{ width: rowProps.row.share + '%' }} /></div>
  </>;
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelDismiss = () => { clearTimeout(dismissTimer); };
  onCleanup(cancelDismiss);
  let container: HTMLDivElement | undefined;
  let panel: HTMLDivElement | undefined;
  const [layout, setLayout] = createSignal({ position: { x: 0, y: 0 }, size: { width: 320, height: 420 } });
  const containsFocus = () => !!(container?.contains(document.activeElement) || panel?.contains(document.activeElement));
  const containsPointer = () => !!(container?.matches(':hover') || panel?.matches(':hover'));
  const scheduleDismiss = () => {
    cancelDismiss();
    dismissTimer = setTimeout(() => {
      if (!containsFocus() && !containsPointer()) setTooltipOpen(false);
    }, 150);
  };
  const handleFocusOut = () => queueMicrotask(() => {
    if (!containsFocus() && (document.activeElement !== document.body || !containsPointer())) setTooltipOpen(false);
  });
  const close = () => { cancelDismiss(); trigger?.focus({ preventScroll: true }); setTooltipOpen(false); };
  const activate = () => {
    trigger?.focus({ preventScroll: true });
    setTooltipOpen(true);
    requestAnimationFrame(() => {
      void Promise.allSettled(panel?.getAnimations?.().map(animation => animation.finished) ?? []).then(() => {
        if (tooltipOpen() && document.activeElement === trigger) panel?.focus({ preventScroll: true });
      });
    });
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && tooltipOpen()) { event.stopPropagation(); event.preventDefault(); close(); }
  };
  let trigger: HTMLDivElement | undefined;
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  createEffect(() => {
    if (!tooltipOpen() || !trigger || !panel) return;
    const placement = props.placement;
    const measure = () => {
      const rect = trigger!.getBoundingClientRect();
      const { width, height } = panel!.getBoundingClientRect();
      setLayout({ size: { width, height }, position: {
        x: placement === 'below-start' ? rect.left : rect.right - width,
        y: placement === 'below-start' ? rect.bottom + 8 : rect.top - height - 8,
      } });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(panel);
    observer?.observe(trigger);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    onCleanup(() => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    });
  });
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
      onPointerLeave={scheduleDismiss}
      onFocusIn={() => { cancelDismiss(); setTooltipOpen(true); }}
      onFocusOut={handleFocusOut}
      on:keydown={escape}
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
        aria-haspopup="dialog"
        tabIndex={0}
        style={progressStyle()}
        onFocus={() => setTooltipOpen(true)}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (tooltipOpen()) close(); else activate();
          }
        }}
      />
      <SurfaceFloatingLayer owner={anchor()} position={layout().position} estimatedSize={layout().size} class="flower-context-panel-layer" data-flower-floating-layer="true">
      <div
        ref={panel}
        on:keydown={escape}
        onPointerEnter={cancelDismiss}
        onPointerLeave={scheduleDismiss}
        onPointerDown={cancelDismiss}
        onClick={(event) => {
          event.stopPropagation();
          if (tooltipOpen() && panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
        }}
        onFocusIn={cancelDismiss}
        onFocusOut={handleFocusOut}
        id={tooltipID}
        role="dialog"
        aria-modal="false"
        tabIndex={-1}
        aria-label={labels().label}
        class="flower-composer-context-tooltip"
        data-open={tooltipOpen() ? 'true' : undefined}
        aria-hidden={tooltipOpen() ? undefined : 'true'}
      >
        <div class="flower-context-heading">
          <span>{labels().label}</span>
          <span class="flower-context-total" title={contextWindow() ? labels().input + ' · = ' + labels().tokens(String(contextWindow()!.input)) : labels().input}>
            <Show when={contextWindow()} fallback={<span>{labels().unknownPercent}</span>}>{(window) => <>
              <span title={labels().measured + ' · ' + labels().lastRequest} aria-label={labels().measured + ' · ' + labels().lastRequest}>= </span>
              {formatContextAmount(window().input)}
              <Show when={window().capacity}>{(capacity) => <span class="flower-context-capacity"> / {formatContextAmount(capacity())}</span>}</Show>
              <Show when={window().capacity}><span class="flower-context-ratio"> ({view().ratioValue})</span></Show>
            </>}</Show>
          </span>
          <button type="button" class="flower-context-close" aria-label={labels().close} onClick={close}><X size={14} aria-hidden="true" /></button>
        </div>
        <div class="flower-context-stacked-bar flower-context-window-bar" aria-hidden="true">
          <span data-category="input" style={{ width: (contextWindow()?.share ?? 0) + '%' }} />
        </div>
        <Show when={contextWindow()}><div class="flower-context-window-legend"><span>{labels().input}</span></div></Show>
        <Show when={composition()}>
          <div class="flower-context-categories flower-context-composition" role="group" aria-label={labels().composition} title={labels().compositionHint}>
            <div class="flower-context-composition-heading"><span>{labels().composition}</span><span>{labels().characters(formatContextAmount(composition()!.total))}</span></div>
            <For each={[...categories().rows.keys()]}>{(key) => {
              const row = () => categories().rows.get(key)!;
              const description = () => [labels().sourceLabels[key], labels().characters(String(row().characters)), percent(row().share)].join(' · ');
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
                      <Show when={composition()}><span class="flower-model-context-amount" title={labels().characters(String(item.characters))}>{labels().characters(formatContextAmount(item.characters))}</span></Show>
                      <span class="flower-model-context-share">{percent(item.share)}</span>
                      <div class="flower-model-context-track" aria-hidden="true"><span class="flower-model-context-fill" style={{ width: item.share + '%' }} /></div>
                    </div>}</For>
                  </div>
                </details>
              </Show>;
            }}</For>
          </div>
        </Show>
        <Show when={!composition() && props.usage?.confirmed}>
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
