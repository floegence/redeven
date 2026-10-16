import { For, Show, createMemo, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';
import { ChevronRight } from 'lucide-solid';

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
  const [factsExpanded, setFactsExpanded] = createSignal(false);
  const sections = createMemo(() => new Map((props.modelContext?.snapshot.sections ?? []).map(section => [section.key, {
    ...section, label: labels().sectionLabels[section.key] ?? section.title,
  }])));
  const percent = (share: number) => labels().percent(Math.round(share * 10) / 10);
  const factStatus = createMemo(() => {
    const context = props.modelContext;
    if (!context) return '';
    return [
      `${labels().collected}: ${new Date(context.updated_at).toLocaleString()}`,
      context.used_at ? `${labels().used}: ${new Date(context.used_at).toLocaleString()}` : '',
      context.removed_keys.length ? `${labels().removed}: ${context.removed_keys.join(', ')}` : '',
    ].filter(Boolean).join('\n');
  });
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelDismiss = () => { clearTimeout(dismissTimer); };
  onCleanup(cancelDismiss);
  let container: HTMLDivElement | undefined;
  let trigger: HTMLDivElement | undefined;
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
      onPointerEnter={() => { cancelDismiss(); setTooltipOpen(true); }}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) dismissTimer = setTimeout(() => setTooltipOpen(false), 150);
      }}
      onFocusOut={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTooltipOpen(false); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && tooltipOpen()) {
          event.stopPropagation();
          trigger?.focus();
          setTooltipOpen(false);
        }
      }}
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
      <div
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
        <Show when={composition()}>{(breakdown) =>
          <div class="flower-context-composition" role="group" aria-label={labels().composition}>
            <div class="flower-context-heading">
              <span>{labels().composition}</span>
              <span class="flower-context-estimate" title={labels().compositionHint}>{labels().estimated}</span>
            </div>
            <div class="flower-context-stacked-bar flower-context-composition-bar" aria-hidden="true">
              <For each={breakdown().rows}>{(row) => <span data-category={row.key} style={{ width: row.share + '%' }} />}</For>
            </div>
            <For each={breakdown().rows}>{(row) =>
              <div class="flower-context-composition-row" data-category={row.key}
                aria-label={[labels().categoryLabels[row.key], labels().estimated, labels().tokens(String(row.tokens)), percent(row.share)].join(' · ')}
                title={labels().categoryLabels[row.key] + ' · ' + labels().estimated + ' ' + labels().tokens(String(row.tokens))}>
                <i class="flower-context-swatch" aria-hidden="true" />
                <span class="flower-model-context-label">{labels().categoryLabels[row.key]}</span>
                <span class="flower-model-context-amount">≈{formatContextAmount(row.tokens)}</span>
                <span class="flower-model-context-share">{percent(row.share)}</span>
              </div>
            }</For>
          </div>
        }</Show>
        <Show when={!composition() && contextWindow()}>
          <div class="flower-context-composition-unavailable">{labels().composition}<span>{labels().unavailable}</span></div>
        </Show>
        <Show when={sections().size > 0}>
          <details class="flower-model-context-details" onToggle={(event) => setFactsExpanded(event.currentTarget.open)}>
            <summary class="flower-model-context-disclosure">
              <ChevronRight class="flower-context-chevron" aria-hidden="true" />
              <span>{labels().runtimeFacts}</span>
              <span class="flower-model-context-status" role="img" aria-label={factStatus()} title={factStatus()} data-used={props.modelContext?.used_at ? 'true' : undefined} />
            </summary>
            <Show when={factsExpanded()}><For each={[...sections().keys()]}>{(key) => {
              const section = () => sections().get(key)!;
              const [expanded, setExpanded] = createSignal(false);
              return (
                <details data-category={key} onToggle={(event) => { event.stopPropagation(); setExpanded(event.currentTarget.open); }}>
                  <summary class="flower-model-context-row" title={section().title}>
                    <i class="flower-context-swatch" aria-hidden="true" />
                    <span class="flower-model-context-label">{section().label}</span>
                    <ChevronRight class="flower-context-chevron" aria-hidden="true" />
                  </summary>
                  <Show when={expanded()}><pre>{section().text}</pre></Show>
                </details>
              );
            }}</For></Show>
          </details>
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
    </div>
  );
}
