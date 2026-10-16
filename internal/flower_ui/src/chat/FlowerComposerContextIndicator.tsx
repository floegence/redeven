import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';
import { ChevronRight } from 'lucide-solid';

import type { FlowerContextUsage, FlowerModelContext } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { buildFlowerComposerContextIndicatorView, buildFlowerContextWindow, buildFlowerContextComposition, buildFlowerModelContextDistribution, formatContextAmount } from './flowerContextPresentation';

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
  const distribution = createMemo(() => buildFlowerModelContextDistribution(props.modelContext?.snapshot.sections ?? []));
  const sections = createMemo(() => new Map(distribution().rows.map(section => [section.key, {
    ...section, label: labels().sectionLabels[section.key] ?? section.title,
  }])));
  let loadedContextDisclosure: HTMLElement | undefined;
  const categories = createMemo(() => {
    const focused = loadedContextDisclosure;
    const restoreFocus = focused && focused === document.activeElement;
    const rows = new Map(composition()?.rows.map(row => [row.key, row]));
    if (sections().size > 0 && !rows.has('model_context_tokens')) {
      rows.set('model_context_tokens', { key: 'model_context_tokens', tokens: 0, share: 0 });
    }
    return { rows, focused: restoreFocus ? focused : null };
  });
  createEffect(() => {
    const focused = categories().focused;
    if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
  });
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
  const LoadedContext = (category: { tokens?: number; share?: number }) => (
    <details class="flower-model-context-details" data-category="model_context_tokens" open={factsExpanded()} onToggle={(event) => setFactsExpanded(event.currentTarget.open)}>
      <summary ref={loadedContextDisclosure} class="flower-context-composition-row flower-model-context-disclosure"
        aria-label={[labels().categoryLabels.model_context_tokens, category.tokens === undefined ? labels().unavailable : labels().estimated + ' ' + labels().tokens(String(category.tokens)), category.share === undefined ? '' : percent(category.share)].filter(Boolean).join(' · ')}>
        <i class="flower-context-swatch" aria-hidden="true" />
        <span class="flower-model-context-category-label">
          <span class="flower-model-context-label">{labels().categoryLabels.model_context_tokens}</span>
          <ChevronRight class="flower-context-chevron" aria-hidden="true" />
          <span class="flower-model-context-status" role="img" aria-label={factStatus()} title={factStatus()} data-used={props.modelContext?.used_at ? 'true' : undefined} />
        </span>
        <span class="flower-model-context-amount" title={category.tokens === undefined ? labels().unavailable : labels().tokens(String(category.tokens))}>{category.tokens === undefined ? labels().unknownPercent : '≈' + formatContextAmount(category.tokens)}</span>
        <span class="flower-model-context-share">{category.share === undefined ? labels().unknownPercent : percent(category.share)}</span>
      </summary>
      <Show when={factsExpanded()}>
        <div class="flower-model-context-distribution" role="group" aria-label={labels().textShare}>
          <div class="flower-model-context-current-heading">
            <span>{labels().currentContents}</span>
            <span class="flower-model-context-unit">{labels().characters(formatContextAmount(distribution().total))}</span>
          </div>
          <p class="flower-model-context-hint">{labels().currentContentsHint}</p>
          <For each={[...sections().keys()]}>{(key) => {
            const section = () => sections().get(key)!;
            const description = () => [section().label, labels().characters(String(section().characters)), percent(section().share)].join(' · ');
            return (
              <div class="flower-model-context-row" data-category={key} aria-label={description()} title={description()}>
                <i class="flower-context-swatch" aria-hidden="true" />
                <span class="flower-model-context-label">{section().label}</span>
                <span class="flower-model-context-amount">{formatContextAmount(section().characters)}</span>
                <span class="flower-model-context-share">{percent(section().share)}</span>
                <div class="flower-model-context-track" aria-hidden="true">
                  <span class="flower-model-context-fill" style={{ width: section().share + '%' }} />
                </div>
              </div>
            );
          }}</For>
        </div>
      </Show>
    </details>
  );
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
        <Show when={categories().rows.size > 0}>
          <div class="flower-context-categories" classList={{ 'flower-context-composition': !!composition() }} role="group" aria-label={labels().composition}>
            <Show when={composition()}>{(breakdown) => <>
              <div class="flower-context-heading">
                <span>{labels().composition}</span>
                <span class="flower-context-estimate" title={labels().compositionHint}>{labels().estimated}</span>
              </div>
              <div class="flower-context-stacked-bar flower-context-composition-bar" aria-hidden="true">
                <For each={breakdown().rows}>{(row) => <span data-category={row.key} style={{ width: row.share + '%' }} />}</For>
              </div>
            </>}</Show>
            <For each={[...categories().rows.keys()]}>{(key) => {
              const row = () => categories().rows.get(key)!;
              return <Show when={key === 'model_context_tokens' && sections().size > 0} fallback={
                <div class="flower-context-composition-row" data-category={key}
                  aria-label={[labels().categoryLabels[key], labels().estimated, labels().tokens(String(row().tokens)), percent(row().share)].join(' · ')}
                  title={labels().categoryLabels[key] + ' · ' + labels().estimated + ' ' + labels().tokens(String(row().tokens))}>
                  <i class="flower-context-swatch" aria-hidden="true" />
                  <span class="flower-model-context-label">{labels().categoryLabels[key]}</span>
                  <span class="flower-model-context-amount">≈{formatContextAmount(row().tokens)}</span>
                  <span class="flower-model-context-share">{percent(row().share)}</span>
                </div>
              }>
                <LoadedContext tokens={composition() ? row().tokens : undefined} share={composition() ? row().share : undefined} />
              </Show>;
            }}</For>
          </div>
        </Show>
        <Show when={!composition() && contextWindow()}>
          <div class="flower-context-composition-unavailable">{labels().composition}<span>{labels().unavailable}</span></div>
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
