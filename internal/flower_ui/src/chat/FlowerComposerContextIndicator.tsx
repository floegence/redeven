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
  const sections = createMemo(() => {
    const source = props.modelContext?.snapshot.sections ?? [];
    const sizes = source.map((section) => Array.from(section.text).length);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    return new Map(source.map((section, index) => [section.key, {
      ...section,
      label: props.copy.chat.contextIndicator.sectionLabels[section.key] ?? section.title,
      share: total > 0 ? (sizes[index]! / total) * 100 : 0,
    }]));
  });
  const factStatus = createMemo(() => {
    const context = props.modelContext;
    if (!context) return '';
    const labels = props.copy.chat.contextIndicator;
    return [
      `${labels.collected}: ${new Date(context.updated_at).toLocaleString()}`,
      context.used_at ? `${labels.used}: ${new Date(context.used_at).toLocaleString()}` : '',
      context.removed_keys.length ? `${labels.removed}: ${context.removed_keys.join(', ')}` : '',
    ].filter(Boolean).join('\n');
  });
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
        tabIndex={-1}
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
        <Show when={sections().size > 0}>
          <div class="flower-model-context-details" role="group" aria-label={props.copy.chat.contextIndicator.textShare}>
            <div class="flower-model-context-heading" title={props.copy.chat.contextIndicator.textShare}>
              <span>{props.copy.chat.contextIndicator.runtimeFacts}</span>
              <span class="flower-model-context-status" role="img" aria-label={factStatus()} title={factStatus()} data-used={props.modelContext?.used_at ? 'true' : undefined} />
            </div>
            <For each={[...sections().keys()]}>{(key) => {
              const section = () => sections().get(key)!;
              const [expanded, setExpanded] = createSignal(false);
              const share = () => props.copy.chat.contextIndicator.percent(Math.round(section().share * 10) / 10);
              return (
                <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
                  <summary
                    class="flower-model-context-row"
                    aria-label={`${section().label}: ${share()}, ${props.copy.chat.contextIndicator.textShare}`}
                    title={`${section().title}${props.modelContext?.changed_keys.includes(key) ? ` · ${props.copy.chat.contextIndicator.updated}` : ''}`}>
                    <span class="flower-model-context-label">{section().label}</span>
                    <span class="flower-model-context-bar" aria-hidden="true">
                      <span class="flower-model-context-fill" style={{ width: `${section().share}%` }} />
                    </span>
                    <span class="flower-model-context-share">{share()}</span>
                  </summary>
                  <Show when={expanded()}><pre>{section().text}</pre></Show>
                </details>
              );
            }}</For>
          </div>
        </Show>
        <Show when={view().warning}>
          <div class="flower-composer-context-warning">{view().warning}</div>
        </Show>
      </div>
    </div>
  );
}
