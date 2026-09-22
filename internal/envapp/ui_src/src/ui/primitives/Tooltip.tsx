import { Show, createEffect, createSignal, onCleanup, createMemo, type JSX } from 'solid-js';
import { observeViewport, readViewportSnapshot } from '@floegence/floe-webapp-core/viewport';
import { cn } from '@floegence/floe-webapp-core';
import { createFloatingPresence, SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';
import {
  resolveAnchoredOverlayPosition,
  type AnchoredOverlayMarginInput,
  type AnchoredOverlayPlacement,
  type AnchoredOverlayPosition,
} from './anchoredOverlay';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';

export interface TooltipProps {
  content: string | JSX.Element;
  children: JSX.Element;
  placement?: AnchoredOverlayPlacement;
  delay?: number;
  class?: string;
  anchorClass?: string;
  clickToToggle?: boolean;
  dismissOnTriggerClick?: boolean;
  disabled?: boolean;
  viewportMargin?: AnchoredOverlayMarginInput | (() => AnchoredOverlayMarginInput);
  onOpenChange?: (open: boolean) => void;
}

function tooltipArrowClass(placement: AnchoredOverlayPlacement): string {
  switch (placement) {
    case 'top':
      return 'left-0 top-full -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-popover border-b-0';
    case 'bottom':
      return 'left-0 bottom-full -translate-x-1/2 border-x-4 border-b-4 border-x-transparent border-b-popover border-t-0';
    case 'left':
      return 'left-full top-0 -translate-y-1/2 border-y-4 border-l-4 border-y-transparent border-l-popover border-r-0';
    case 'right':
    default:
      return 'right-full top-0 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-popover border-l-0';
  }
}

function tooltipArrowStyle(position: AnchoredOverlayPosition): JSX.CSSProperties {
  if (position.placement === 'top' || position.placement === 'bottom') {
    return { left: `${position.arrowOffset}px` };
  }
  return { top: `${position.arrowOffset}px` };
}

/**
 * Delegate portal ownership and projected-surface clamping to Floe.
 */
export function Tooltip(props: TooltipProps) {
  const [visible, setVisible] = createSignal(false);
  const [forceUnmount, setForceUnmount] = createSignal(false);
  const tooltipPresence = createFloatingPresence({
    open: visible,
    exitDurationMs: 80,
  });
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [bounds, setBounds] = createSignal({ width: 384, height: 600 });
  const [position, setPosition] = createSignal<AnchoredOverlayPosition | null>(null);
  const resolvedPlacement = createMemo(() => position()?.placement ?? (props.placement ?? 'top'));

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let anchorRef: HTMLSpanElement | undefined;
  let tooltipRef: HTMLDivElement | undefined;
  let hovered = false;
  let focused = false;
  let pinned = false;
  let dismissed = false;

  const clearTimeoutHandle = () => {
    if (!timeout) return;
    clearTimeout(timeout);
    timeout = undefined;
  };

  const clearFrameHandle = () => {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const updatePosition = () => {
    if (!anchorRef || !tooltipRef || typeof window === 'undefined') return;

    const anchorRect = anchorRef.getBoundingClientRect();
    const tooltipRect = tooltipRef.getBoundingClientRect();
    const { visible: viewport, safeArea } = readViewportSnapshot(window);
    setBounds({ width: Math.max(1, viewport.width - safeArea.left - safeArea.right - 16),
      height: Math.max(1, viewport.height - safeArea.top - safeArea.bottom - 16) });
    setSize({ width: tooltipRect.width, height: tooltipRect.height });
    const viewportMargin = typeof props.viewportMargin === 'function'
      ? props.viewportMargin()
      : props.viewportMargin;

    const nextPosition = resolveAnchoredOverlayPosition({
      anchorRect: { width: anchorRect.width, height: anchorRect.height,
        left: anchorRect.left - viewport.left, right: anchorRect.right - viewport.left,
        top: anchorRect.top - viewport.top, bottom: anchorRect.bottom - viewport.top },
      overlaySize: { width: tooltipRect.width, height: tooltipRect.height },
      viewport,
      preferredPlacement: props.placement,
      margin: viewportMargin,
    });

    setPosition({
      ...nextPosition,
      left: nextPosition.left + viewport.left,
      top: nextPosition.top + viewport.top,
    });
  };

  const scheduleUpdate = () => {
    clearFrameHandle();
    frame = requestAnimationFrame(() => {
      frame = 0;
      updatePosition();
    });
  };

  const show = () => {
    if (props.disabled) return;
    clearTimeoutHandle();
    const delay = props.delay ?? 300;
    if (delay <= 0) {
      setForceUnmount(false);
      setVisible(true);
      return;
    }
    timeout = setTimeout(() => {
      timeout = undefined;
      setForceUnmount(false);
      setVisible(true);
    }, delay);
  };

  const hide = () => {
    clearTimeoutHandle();
    setVisible(false);
  };

  const dismissTransient = () => {
    clearTimeoutHandle();
    setForceUnmount(true);
    setVisible(false);
  };

  createEffect(() => {
    if (!props.disabled) return;
    hovered = false;
    pinned = false;
    dismissed = true;
    dismissTransient();
  });

  createEffect(() => {
    if (!visible()) {
      clearFrameHandle();
      return;
    }

    scheduleUpdate();

    const handleViewportChange = () => scheduleUpdate();
    window.addEventListener('scroll', handleViewportChange, true);
    const stopViewport = observeViewport(window, handleViewportChange);
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (anchorRef?.contains(event.target as Node)) return;
      pinned = false;
      dismissed = true;
      if (props.clickToToggle) hide();
      else dismissTransient();
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);

    const anchorEl = anchorRef;
    const tooltipEl = tooltipRef;
    const observer = typeof ResizeObserver === 'undefined' || !anchorEl || !tooltipEl
      ? null
      : new ResizeObserver(() => scheduleUpdate());
    if (observer && anchorEl && tooltipEl) {
      observer.observe(anchorEl);
      observer.observe(tooltipEl);
    }

    onCleanup(() => {
      observer?.disconnect();
      window.removeEventListener('scroll', handleViewportChange, true);
      stopViewport();
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      clearFrameHandle();
    });
  });

  createEffect(() => {
    if (!tooltipPresence.mounted()) {
      setPosition(null);
    }
  });

  createEffect(() => {
    props.onOpenChange?.(visible());
  });

  onCleanup(() => {
    clearTimeoutHandle();
    clearFrameHandle();
    props.onOpenChange?.(false);
  });

  return (
    <span
      ref={anchorRef}
      data-redeven-tooltip-anchor=""
      data-redeven-tooltip-disabled={props.disabled ? 'true' : undefined}
      class={cn('relative inline-block max-w-full', props.anchorClass)}
      onMouseEnter={() => {
        if (props.disabled) return;
        hovered = true;
        dismissed = false;
        show();
      }}
      onMouseLeave={() => {
        hovered = false;
        if (!focused && !pinned) hide();
      }}
      onClick={() => {
        if (props.disabled) return;
        if (!props.clickToToggle) {
          if (props.dismissOnTriggerClick === false) return;
          dismissed = true;
          dismissTransient();
          return;
        }
        if (pinned) {
          pinned = false;
          dismissed = true;
          hide();
        } else {
          pinned = true;
          dismissed = false;
          show();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !visible()) return;
        event.preventDefault();
        event.stopPropagation();
        pinned = false;
        dismissed = true;
        hide();
      }}
      onFocusIn={() => {
        if (props.disabled) return;
        focused = true;
        if (!dismissed) show();
      }}
      onFocusOut={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        focused = false;
        pinned = false;
        dismissed = false;
        if (!hovered) hide();
      }}
    >
      {props.children}

      <Show when={!props.disabled && tooltipPresence.mounted() && !forceUnmount()}>
        <SurfaceFloatingLayer
          owner={anchorRef}
          position={{ x: position()?.left ?? 0, y: position()?.top ?? 0 }}
          estimatedSize={size()}
          layerRef={(element) => {
            tooltipRef = element;
          }}
          role="tooltip"
          data-placement={resolvedPlacement()}
          data-floating-presence={tooltipPresence.state()}
          aria-hidden={tooltipPresence.exiting() ? 'true' : undefined}
          class={cn(
            'pointer-events-none z-[200] max-w-[min(24rem,calc(100vw-1rem))] rounded border px-2 py-1 text-xs leading-snug text-popover-foreground shadow-md',
            redevenSurfaceRoleClass('overlay'),
            'whitespace-normal break-words',
            'floe-floating-presence floe-floating-tooltip',
            props.class,
          )}
          style={{
            visibility: position() ? 'visible' : 'hidden',
            'max-width': `min(24rem, ${bounds().width}px)`,
            'max-height': `${bounds().height}px`,
            'overflow-y': 'auto',
          }}
        >
          {props.content}
          <div
            class={cn('absolute h-0 w-0', tooltipArrowClass(resolvedPlacement()))}
            style={position() ? tooltipArrowStyle(position()!) : undefined}
          />
        </SurfaceFloatingLayer>
      </Show>
    </span>
  );
}
