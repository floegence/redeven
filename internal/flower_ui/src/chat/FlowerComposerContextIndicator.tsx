import { Show, createMemo, createUniqueId } from 'solid-js';

import type { FlowerContextUsage } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { buildFlowerComposerContextIndicatorView } from './flowerContextPresentation';

export function FlowerComposerContextIndicator(props: {
  usage: FlowerContextUsage;
  copy: FlowerSurfaceCopy;
}) {
  const view = createMemo(() => buildFlowerComposerContextIndicatorView(props.usage, props.copy));
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
    >
      <div
        class="flower-composer-context-progress"
        role="progressbar"
        aria-label={view().ariaLabel}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={view().progressValue ?? undefined}
        aria-valuetext={view().ariaValueText}
        aria-describedby={tooltipID}
        tabIndex={0}
        style={progressStyle()}
      >
        <span class="flower-composer-context-percent">{view().percentLabel}</span>
      </div>
      <div id={tooltipID} role="tooltip" class="flower-composer-context-tooltip">
        <div class="flower-composer-context-tooltip-title">{view().tooltipTitle}</div>
        <div class="flower-composer-context-tooltip-row">
          <span>{view().usedLabel}</span>
          <strong>{view().usedValue}</strong>
        </div>
        <div class="flower-composer-context-tooltip-row">
          <span>{view().ratioLabel}</span>
          <strong>{view().ratioValue}</strong>
        </div>
        <Show when={view().thresholdValue}>
          {(threshold) => (
            <div class="flower-composer-context-tooltip-row">
              <span>{view().thresholdLabel}</span>
              <strong>{threshold()}</strong>
            </div>
          )}
        </Show>
        <Show when={view().safeLimitValue}>
          {(safeLimit) => (
            <div class="flower-composer-context-tooltip-row">
              <span>{view().safeLimitLabel}</span>
              <strong>{safeLimit()}</strong>
            </div>
          )}
        </Show>
        <div class="flower-composer-context-tooltip-row">
          <span>{view().statusLabel}</span>
          <strong>{view().statusValue}</strong>
        </div>
      </div>
    </div>
  );
}
