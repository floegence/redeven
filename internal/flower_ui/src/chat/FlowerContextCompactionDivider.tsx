import { Clock } from '@floegence/floe-webapp-core/icons';
import { Show, createMemo } from 'solid-js';

import type { FlowerTimelineDecoration } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { compactionDividerDetail, compactionDividerLabel } from './flowerContextPresentation';

export function FlowerContextCompactionDivider(props: {
  decoration: FlowerTimelineDecoration;
  copy: FlowerSurfaceCopy;
}) {
  const compaction = createMemo(() => props.decoration.compaction);
  const detail = createMemo(() => compactionDividerDetail(compaction(), props.copy));
  return (
    <div
      class="flower-compaction-divider"
      data-flower-decoration-id={props.decoration.decoration_id}
      data-flower-compaction-status={compaction().status}
    >
      <div class="flower-compaction-divider-rule" aria-hidden="true" />
      <div class="flower-compaction-divider-pill">
        <Clock class="h-3.5 w-3.5" />
        <span class="flower-compaction-divider-label">{compactionDividerLabel(compaction(), props.copy)}</span>
        <Show when={detail()}>
          {(value) => <span class="flower-compaction-divider-detail">{value()}</span>}
        </Show>
      </div>
      <div class="flower-compaction-divider-rule" aria-hidden="true" />
    </div>
  );
}
