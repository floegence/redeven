import { Clock } from '@floegence/floe-webapp-core/icons';
import { Show, createMemo, createSignal, createUniqueId } from 'solid-js';

import type { FlowerTimelineDecoration } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { compactionDividerDetail, compactionDividerLabel } from './flowerContextPresentation';

function FlowerContextCompactionRunningIcon() {
  return (
    <span class="flower-compaction-divider-running-icon" aria-hidden="true">
      <span class="flower-compaction-divider-running-square" />
      <span class="flower-compaction-divider-running-square" />
      <span class="flower-compaction-divider-running-square" />
      <span class="flower-compaction-divider-running-square" />
    </span>
  );
}

export function FlowerContextCompactionDivider(props: {
  decoration: FlowerTimelineDecoration;
  copy: FlowerSurfaceCopy;
}) {
  const compaction = createMemo(() => props.decoration.compaction);
  const detail = createMemo(() => compactionDividerDetail(compaction(), props.copy));
  const label = createMemo(() => compactionDividerLabel(compaction(), props.copy));
  const running = createMemo(() => compaction().status === 'compacting');
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  const tooltipID = `flower-compaction-divider-${createUniqueId()}`;
  const hasDetail = createMemo(() => detail().length > 0);
  return (
    <div
      class="flower-compaction-divider"
      data-flower-decoration-id={props.decoration.decoration_id}
      data-flower-compaction-status={compaction().status}
    >
      <div class="flower-compaction-divider-rule" aria-hidden="true" />
      <div
        class={running() ? 'flower-compaction-divider-pill flower-compaction-divider-pill-running' : 'flower-compaction-divider-pill'}
        aria-describedby={tooltipOpen() && hasDetail() ? tooltipID : undefined}
        onPointerEnter={() => setTooltipOpen(true)}
        onPointerLeave={() => setTooltipOpen(false)}
      >
        <Show when={running()} fallback={<Clock class="flower-compaction-divider-status-icon h-3.5 w-3.5" aria-hidden="true" />}>
          <FlowerContextCompactionRunningIcon />
        </Show>
        <span class="flower-compaction-divider-copy">
          <span class="flower-compaction-divider-label flower-compaction-divider-label-shimmer" data-text={label()}>{label()}</span>
        </span>
        <Show when={detail()}>
          {(value) => (
            <span
              id={tooltipID}
              role="tooltip"
              class="flower-compaction-divider-tooltip"
              data-open={tooltipOpen() ? 'true' : undefined}
              aria-hidden={tooltipOpen() ? undefined : 'true'}
            >
              {value()}
            </span>
          )}
        </Show>
      </div>
      <div class="flower-compaction-divider-rule" aria-hidden="true" />
    </div>
  );
}
