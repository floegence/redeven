import { Clock } from '@floegence/floe-webapp-core/icons';
import { Show, createMemo, createSignal, createUniqueId } from 'solid-js';

import type { FlowerTimelineDecoration } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { compactionDividerDetail, compactionDividerLabel } from './flowerContextPresentation';

function FlowerContextCompactionRunningIcon() {
  return (
    <span class="flower-compaction-divider-running-clock" aria-hidden="true" />
  );
}

export function FlowerContextCompactionDivider(props: {
  decoration: Extract<FlowerTimelineDecoration, { kind: 'context_compaction' }>;
  copy: FlowerSurfaceCopy;
}) {
  const compaction = createMemo(() => props.decoration.compaction);
  const detail = createMemo(() => compactionDividerDetail(compaction(), props.copy));
  const label = createMemo(() => compactionDividerLabel(compaction(), props.copy));
  const running = createMemo(() => compaction().status === 'compacting');
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  const tooltipID = `flower-compaction-divider-${createUniqueId()}`;
  const hasDetail = createMemo(() => detail().length > 0);
  const openTooltip = () => {
    if (hasDetail()) setTooltipOpen(true);
  };
  const closeTooltip = () => setTooltipOpen(false);
  const toggleTooltip = () => {
    if (hasDetail()) setTooltipOpen((open) => !open);
  };
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
        role={hasDetail() ? 'button' : undefined}
        tabIndex={hasDetail() ? 0 : undefined}
        onPointerEnter={openTooltip}
        onPointerLeave={closeTooltip}
        onFocus={openTooltip}
        onBlur={closeTooltip}
        onClick={openTooltip}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            closeTooltip();
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleTooltip();
          }
        }}
      >
        <Show when={running()} fallback={<Clock class="flower-compaction-divider-status-icon h-3.5 w-3.5" aria-hidden="true" />}>
          <FlowerContextCompactionRunningIcon />
        </Show>
        <span class="flower-compaction-divider-copy">
          <span class="flower-compaction-divider-label flower-compaction-divider-label-shimmer" data-text={label()}>{label()}</span>
        </span>
        <Show when={tooltipOpen() && hasDetail()}>
          <span
            id={tooltipID}
            role="tooltip"
            class="flower-compaction-divider-tooltip"
            data-open="true"
          >
            {detail()}
          </span>
        </Show>
      </div>
      <div class="flower-compaction-divider-rule" aria-hidden="true" />
    </div>
  );
}
