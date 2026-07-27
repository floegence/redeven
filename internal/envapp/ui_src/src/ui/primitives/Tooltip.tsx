import { Show, createEffect, createSignal, onCleanup, createMemo, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { createFloatingPresence, SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';
import { resolveAnchoredOverlayPosition, type AnchoredOverlayPlacement, type AnchoredOverlayPosition } from './anchoredOverlay';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';

export interface TooltipProps {
  content: string | JSX.Element;
  children: JSX.Element;
  placement?: AnchoredOverlayPlacement;
  delay?: number;
  class?: string;
  anchorClass?: string;
  clickToToggle?: boolean;
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
 * Render the tooltip in a body-level portal so dialog/layout overflow rules never clip it.
 */
export function Tooltip(props: TooltipProps) {
  const [visible, setVisible] = createSignal(false);
  const [forceUnmount, setForceUnmount] = createSignal(false);
  const tooltipPresence = createFloatingPresence({
    open: visible,
    exitDurationMs: 80,
  });
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
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportOffsetLeft = viewport?.offsetLeft ?? 0;
    const viewportOffsetTop = viewport?.offsetTop ?? 0;

    const nextPosition = resolveAnchoredOverlayPosition({
      anchorRect,
      overlaySize: { width: tooltipRect.width, height: tooltipRect.height },
      viewport: { width: viewportWidth, height: viewportHeight },
      preferredPlacement: props.placement,
    });

    setPosition({
      ...nextPosition,
      left: nextPosition.left + viewportOffsetLeft,
      top: nextPosition.top + viewportOffsetTop,
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
    if (!visible()) {
      clearFrameHandle();
      return;
    }

    scheduleUpdate();

    const handleViewportChange = () => scheduleUpdate();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);
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
      window.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      clearFrameHandle();
    });
  });

  createEffect(() => {
    if (!tooltipPresence.mounted()) {
      setPosition(null);
    }
  });

  onCleanup(() => {
    clearTimeoutHandle();
    clearFrameHandle();
  });

  return (
    <span
      ref={anchorRef}
      data-redeven-tooltip-anchor=""
      class={cn('relative inline-block max-w-full', props.anchorClass)}
      onMouseEnter={() => {
        hovered = true;
        dismissed = false;
        show();
      }}
      onMouseLeave={() => {
        hovered = false;
        if (!focused && !pinned) hide();
      }}
      onClick={() => {
        if (!props.clickToToggle) {
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

      <Show when={tooltipPresence.mounted() && !forceUnmount()}>
        <SurfaceFloatingLayer
          owner={anchorRef}
          position={{ x: position()?.left ?? 0, y: position()?.top ?? 0 }}
          clamp={false}
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
