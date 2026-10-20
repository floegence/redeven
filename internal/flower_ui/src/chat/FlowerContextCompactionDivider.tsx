import { Clock } from '@floegence/floe-webapp-core/icons';
import { Button, SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';
import { Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';

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
  onRetry?: () => void;
  visible?: boolean;
}) {
  const visible = () => props.visible !== false;
  const compaction = createMemo(() => props.decoration.compaction);
  const detail = createMemo(() => compactionDividerDetail(compaction(), props.copy));
  const label = createMemo(() => compactionDividerLabel(compaction(), props.copy));
  const running = createMemo(() => compaction().status === 'compacting');
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  const tooltipID = `flower-compaction-divider-${createUniqueId()}`;
  const hasDetail = createMemo(() => detail().length > 0);
  createEffect(() => { if (!visible() || !hasDetail()) setTooltipOpen(false); });
  let container: HTMLDivElement | undefined;
  let trigger: HTMLDivElement | undefined;
  const [panel, setPanel] = createSignal<HTMLSpanElement>();
  const [owner, setOwner] = createSignal<HTMLElement>();
  const [layout, setLayout] = createSignal({ position: { x: 0, y: 0 }, size: { width: 320, height: 64 } });
  createEffect(() => {
    const tooltip = panel();
    if (!tooltipOpen() || !trigger || !tooltip) return;
    const measure = () => {
      const rect = trigger!.getBoundingClientRect();
      const { width, height } = tooltip.getBoundingClientRect();
      setLayout({ position: { x: rect.left + (rect.width - width) / 2, y: rect.top - height - 8 }, size: { width, height } });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(trigger);
    observer.observe(tooltip);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    onCleanup(() => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); });
  });
  onMount(() => {
    setOwner(trigger);
    const dismiss = (event: PointerEvent) => {
      if (!container?.contains(event.target as Node) && !panel()?.contains(event.target as Node)) setTooltipOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    onCleanup(() => document.removeEventListener('pointerdown', dismiss, true));
  });
  const openTooltip = () => {
    if (visible() && hasDetail()) setTooltipOpen(true);
  };
  const closeTooltip = () => setTooltipOpen(false);
  const toggleTooltip = () => {
    if (visible() && hasDetail()) setTooltipOpen((open) => !open);
  };
  return (
    <div
      ref={container}
      class="flower-compaction-divider"
      data-flower-decoration-id={props.decoration.decoration_id}
      data-flower-compaction-status={compaction().status}
    >
      <div
        ref={trigger}
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
          <span class="flower-compaction-divider-label">{label()}</span>
        </span>
      </div>
      <Show when={tooltipOpen() && hasDetail()}>
        <SurfaceFloatingLayer owner={owner()} boundary={owner()?.closest<HTMLElement>('.flower-subagent-detail-window') ?? undefined} position={layout().position} estimatedSize={layout().size} class="flower-compaction-tooltip-layer" data-flower-floating-layer="true">
          <span
            ref={setPanel}
            id={tooltipID}
            role="tooltip"
            class="flower-compaction-divider-tooltip"
            data-open="true"
          >
            {detail()}
          </span>
        </SurfaceFloatingLayer>
      </Show>
      <Show when={props.onRetry}>
        <Button size="sm" variant="ghost" onClick={() => props.onRetry?.()}>{props.copy.chat.compactContext}</Button>
      </Show>
    </div>
  );
}
