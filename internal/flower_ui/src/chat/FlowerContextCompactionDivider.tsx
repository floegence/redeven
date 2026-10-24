import { AlertCircle, Check, Clock, Minus, Refresh } from '@floegence/floe-webapp-core/icons';
import { SurfaceFloatingLayer, Tooltip } from '@floegence/floe-webapp-core/ui';
import { Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';
import { Dynamic } from 'solid-js/web';

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
  retrying?: boolean;
  retryDisabled?: boolean;
  visible?: boolean;
}) {
  const visible = () => props.visible !== false;
  const compaction = createMemo(() => props.decoration.compaction);
  const detail = createMemo(() => compactionDividerDetail(compaction(), props.copy));
  const label = createMemo(() => compactionDividerLabel(compaction(), props.copy));
  const running = createMemo(() => compaction().status === 'compacting');
  const statusIcon = () => {
    switch (compaction().status) {
      case 'compacted': return Check;
      case 'failed': return AlertCircle;
      case 'cancelled': return Minus;
      default: return Clock;
    }
  };
  const retryLabel = () => props.retrying ? props.copy.chat.compactionDivider.retrying : props.copy.chat.compactionDivider.retry;
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  const tooltipID = `flower-compaction-divider-${createUniqueId()}`;
  const hasDetail = createMemo(() => detail().length > 0);
  createEffect(() => { if (!visible() || !hasDetail()) setTooltipOpen(false); });
  let container: HTMLDivElement | undefined;
  let trigger: HTMLDivElement | undefined;
  let retryFocused = false;
  createEffect(() => {
    if (!props.onRetry && retryFocused) {
      trigger?.focus({ preventScroll: true });
      retryFocused = false;
    }
  });
  const [panel, setPanel] = createSignal<HTMLSpanElement>();
  const [owner, setOwner] = createSignal<HTMLElement>();
  const [layout, setLayout] = createSignal({ position: { x: 0, y: 0 }, size: { width: 0, height: 0 } });
  createEffect(() => {
    const tooltip = panel();
    if (!tooltipOpen() || !trigger || !tooltip) return;
    const measure = () => {
      const rect = trigger!.getBoundingClientRect();
      const { width, height } = tooltip.getBoundingClientRect();
      const boundary = trigger!.closest<HTMLElement>('.flower-subagent-detail-window')?.getBoundingClientRect();
      const top = boundary ? Math.max(0, boundary.top) : 0;
      const y = rect.top - height - 8;
      setLayout({ position: { x: rect.left + (rect.width - width) / 2, y: y >= top + 8 ? y : rect.bottom + 8 }, size: { width, height } });
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
    const dismissByKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') closeTooltip();
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismissByKeyboard);
    onCleanup(() => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismissByKeyboard); });
  });
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(closeTimer));
  const openTooltip = () => {
    clearTimeout(closeTimer);
    if (visible() && hasDetail()) setTooltipOpen(true);
  };
  const closeTooltip = () => { clearTimeout(closeTimer); setTooltipOpen(false); };
  const leaveTooltip = () => { clearTimeout(closeTimer); closeTimer = setTimeout(closeTooltip, 150); };
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
      <div class="flower-compaction-divider-center">
        <div
          ref={trigger}
          class={running() ? 'flower-compaction-divider-pill flower-compaction-divider-pill-running' : 'flower-compaction-divider-pill'}
          aria-describedby={tooltipOpen() && hasDetail() ? tooltipID : undefined}
          role={hasDetail() ? 'button' : undefined}
          tabIndex={hasDetail() ? 0 : -1}
          onPointerEnter={openTooltip}
          onPointerLeave={leaveTooltip}
          onFocus={openTooltip}
          onBlur={(event) => {
            // Clicking selectable tooltip text blurs its trigger without moving focus.
            if (event.relatedTarget || !panel()?.matches(':hover')) closeTooltip();
          }}
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
          <Show when={running()} fallback={<Dynamic component={statusIcon()} class="flower-compaction-divider-status-icon h-3.5 w-3.5" aria-hidden="true" />}>
            <FlowerContextCompactionRunningIcon />
          </Show>
          <span class="flower-compaction-divider-copy">
            <span class="flower-compaction-divider-label">{label()}</span>
          </span>
        </div>
        <Show when={props.onRetry}>
          <Tooltip content={retryLabel()}>
            <button type="button" class="flower-compaction-divider-retry" aria-label={retryLabel()}
              disabled={props.retryDisabled || props.retrying} aria-busy={props.retrying || undefined}
              onFocus={() => { retryFocused = true; }}
              onBlur={() => { retryFocused = false; }}
              onClick={() => props.onRetry?.()}>
              <Refresh class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        </Show>
      </div>
      <Show when={tooltipOpen() && hasDetail()}>
        <SurfaceFloatingLayer owner={owner()} boundary={owner()?.closest<HTMLElement>('.flower-subagent-detail-window') ?? undefined} position={layout().position} estimatedSize={layout().size} class="flower-compaction-tooltip-layer" data-flower-floating-layer="true">
          <span
            ref={setPanel}
            id={tooltipID}
            role="tooltip"
            class="flower-compaction-divider-tooltip"
            data-open="true"
            onPointerEnter={openTooltip}
            onPointerLeave={leaveTooltip}
          >
            {detail()}
          </span>
        </SurfaceFloatingLayer>
      </Show>
    </div>
  );
}
