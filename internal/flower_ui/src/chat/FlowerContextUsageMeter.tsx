import { Show, createMemo } from 'solid-js';

import type { FlowerContextUsage } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { buildFlowerContextMeterView } from './flowerContextPresentation';

export function FlowerContextUsageMeter(props: {
  usage: FlowerContextUsage;
  copy: FlowerSurfaceCopy;
}) {
  const view = createMemo(() => buildFlowerContextMeterView(props.usage, props.copy));
  const hasRatio = createMemo(() => view().progressValue !== null);
  const dataRatio = createMemo(() => {
    const ratio = view().ratio;
    return ratio === null ? 'unknown' : ratio.toFixed(4);
  });
  return (
    <div
      class="flower-context-usage-meter"
      data-context-pressure={view().tone}
      data-context-ratio={dataRatio()}
      title={view().title}
    >
      <div class="flower-context-usage-meter-copy">
        <span class="flower-context-usage-meter-label">{view().label}</span>
        <Show
          when={hasRatio()}
          fallback={<span class="flower-context-usage-meter-percent">{view().pressureLabel}</span>}
        >
          <span class="flower-context-usage-meter-percent">{view().percentLabel}</span>
        </Show>
        <Show when={hasRatio()}>
          <span class="flower-context-usage-meter-detail">{view().detailLabel}</span>
          <span class="flower-context-usage-meter-pressure">{view().pressureLabel}</span>
        </Show>
      </div>
      <Show when={hasRatio()}>
        <div
          class="flower-context-usage-meter-track"
          role="progressbar"
          aria-label={view().title}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={view().progressValue ?? undefined}
        >
          <span class="flower-context-usage-meter-fill" style={{ width: `${view().progressValue ?? 0}%` }} />
        </div>
      </Show>
    </div>
  );
}
