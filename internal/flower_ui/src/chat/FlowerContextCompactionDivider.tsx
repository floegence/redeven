import { Clock } from '@floegence/floe-webapp-core/icons';
import { Show, createMemo } from 'solid-js';

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
  return (
    <div
      class="flower-compaction-divider"
      data-flower-decoration-id={props.decoration.decoration_id}
      data-flower-compaction-status={compaction().status}
    >
      <div class="flower-compaction-divider-rule" aria-hidden="true" />
      <div class={running() ? 'flower-compaction-divider-pill flower-compaction-divider-pill-running' : 'flower-compaction-divider-pill'}>
        <Show when={running()} fallback={<Clock class="flower-compaction-divider-status-icon h-3.5 w-3.5" aria-hidden="true" />}>
          <FlowerContextCompactionRunningIcon />
        </Show>
        <span class="flower-compaction-divider-copy">
          <span class="flower-compaction-divider-label flower-compaction-divider-label-shimmer" data-text={label()}>{label()}</span>
          <Show when={detail()}>
            {(value) => <span class="flower-compaction-divider-detail">{value()}</span>}
          </Show>
        </span>
      </div>
      <div class="flower-compaction-divider-rule" aria-hidden="true" />
    </div>
  );
}
