import { Show, createEffect, createSignal, onCleanup, createMemo, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { resolveAnchoredOverlayPosition, type AnchoredOverlayPlacement, type AnchoredOverlayPosition } from './anchoredOverlay';

export interface TooltipProps {
  content: string | JSX.Element;
  children: JSX.Element;
  placement?: AnchoredOverlayPlacement;
  delay?: number;
  class?: string;
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
  const [position, setPosition] = createSignal<AnchoredOverlayPosition | null>(null);
  const resolvedPlacement = createMemo(() => position()?.placement ?? (props.placement ?? 'top'));

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let anchorRef: HTMLSpanElement | undefined;
  let tooltipRef: HTMLDivElement | undefined;

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
      setVisible(true);
      return;
    }
    timeout = setTimeout(() => {
      timeout = undefined;
      setVisible(true);
    }, delay);
  };

  const hide = () => {
    clearTimeoutHandle();
    setVisible(false);
  };

  createEffect(() => {
    if (!visible()) {
      clearFrameHandle();
      setPosition(null);
      return;
    }

    scheduleUpdate();

    const handleViewportChange = () => scheduleUpdate();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

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
      clearFrameHandle();
    });
  });

  onCleanup(() => {
    clearTimeoutHandle();
    clearFrameHandle();
  });

  return (
    <span
      ref={anchorRef}
      data-redeven-tooltip-anchor=""
      class="relative inline-block max-w-full"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusIn={show}
      onFocusOut={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        hide();
      }}
    >
      {props.children}

      <Show when={visible()}>
        <Portal>
          <div
            ref={tooltipRef}
            role="tooltip"
            data-placement={resolvedPlacement()}
            class={cn(
              'pointer-events-none fixed z-[200] max-w-[min(24rem,calc(100vw-1rem))] rounded border border-border/70 bg-popover px-2 py-1 text-xs leading-snug text-popover-foreground shadow-md',
              'whitespace-normal break-words',
              'animate-in fade-in zoom-in-95',
              props.class,
            )}
            style={{
              left: position() ? `${position()!.left}px` : '0px',
              top: position() ? `${position()!.top}px` : '0px',
              visibility: position() ? 'visible' : 'hidden',
            }}
          >
            {props.content}
            <div
              class={cn('absolute h-0 w-0', tooltipArrowClass(resolvedPlacement()))}
              style={position() ? tooltipArrowStyle(position()!) : undefined}
            />
          </div>
        </Portal>
      </Show>
    </span>
  );
}
