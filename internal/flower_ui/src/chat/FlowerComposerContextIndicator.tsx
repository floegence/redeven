import { Show, createMemo, createSignal, createUniqueId } from 'solid-js';

import type { FlowerContextUsage } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { buildFlowerComposerContextIndicatorView } from './flowerContextPresentation';

export function FlowerComposerContextIndicator(props: {
  usage: FlowerContextUsage;
  copy: FlowerSurfaceCopy;
}) {
  const view = createMemo(() => buildFlowerComposerContextIndicatorView(props.usage, props.copy));
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
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
      class="flower-composer-context-indicator"
      data-context-pressure={view().tone}
      data-context-ratio={dataRatio()}
      onPointerEnter={() => setTooltipOpen(true)}
      onPointerLeave={() => setTooltipOpen(false)}
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
        onBlur={() => setTooltipOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setTooltipOpen(false);
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setTooltipOpen((open) => !open);
          }
        }}
      />
      <div
        id={tooltipID}
        role="tooltip"
        class="flower-composer-context-tooltip"
        data-open={tooltipOpen() ? 'true' : undefined}
        aria-hidden={tooltipOpen() ? undefined : 'true'}
      >
        <div class="flower-composer-context-tooltip-row">
          <span>{view().ariaLabel}</span>
          <strong>{view().ratioValue}</strong>
        </div>
        <div class="flower-composer-context-tooltip-row">
          <span>{view().cacheHitLabel}</span>
          <strong>{view().cacheHitValue}</strong>
        </div>
        <Show when={view().warning}>
          <div class="flower-composer-context-warning">{view().warning}</div>
        </Show>
      </div>
    </div>
  );
}
