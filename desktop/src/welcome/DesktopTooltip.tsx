import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

export type DesktopTooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

type OverlayPosition = Readonly<{
  placement: DesktopTooltipPlacement;
  left: number;
  top: number;
  arrowOffset: number;
}>;

export type DesktopTooltipProps = Readonly<{
  content: string | JSX.Element;
  children: JSX.Element;
  placement?: DesktopTooltipPlacement;
  delay?: number;
  class?: string;
}>;

function cn(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(' ');
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function oppositePlacement(placement: DesktopTooltipPlacement): DesktopTooltipPlacement {
  switch (placement) {
    case 'top':
      return 'bottom';
    case 'bottom':
      return 'top';
    case 'left':
      return 'right';
    case 'right':
    default:
      return 'left';
  }
}

function resolveOverlayPosition(options: Readonly<{
  anchorRect: DOMRect;
  overlayWidth: number;
  overlayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  preferredPlacement?: DesktopTooltipPlacement;
}>): OverlayPosition {
  const preferredPlacement = options.preferredPlacement ?? 'top';
  const margin = 8;
  const gap = 8;
  const arrowInset = 12;
  const anchorCenterX = options.anchorRect.left + (options.anchorRect.width / 2);
  const anchorCenterY = options.anchorRect.top + (options.anchorRect.height / 2);

  const availableSpace = {
    top: options.anchorRect.top - margin - gap,
    bottom: options.viewportHeight - options.anchorRect.bottom - margin - gap,
    left: options.anchorRect.left - margin - gap,
    right: options.viewportWidth - options.anchorRect.right - margin - gap,
  } satisfies Record<DesktopTooltipPlacement, number>;

  const orderedPlacements = [
    preferredPlacement,
    oppositePlacement(preferredPlacement),
    preferredPlacement === 'top' || preferredPlacement === 'bottom' ? 'right' : 'bottom',
    preferredPlacement === 'top' || preferredPlacement === 'bottom' ? 'left' : 'top',
  ] as const;

  const placement = orderedPlacements.find((candidate) => {
    const requiredSpace = candidate === 'top' || candidate === 'bottom'
      ? options.overlayHeight
      : options.overlayWidth;
    return availableSpace[candidate] >= requiredSpace;
  }) ?? orderedPlacements.slice().sort((left, right) => availableSpace[right] - availableSpace[left])[0];

  let left = 0;
  let top = 0;

  switch (placement) {
    case 'top':
      left = anchorCenterX - (options.overlayWidth / 2);
      top = options.anchorRect.top - gap - options.overlayHeight;
      break;
    case 'bottom':
      left = anchorCenterX - (options.overlayWidth / 2);
      top = options.anchorRect.bottom + gap;
      break;
    case 'left':
      left = options.anchorRect.left - gap - options.overlayWidth;
      top = anchorCenterY - (options.overlayHeight / 2);
      break;
    case 'right':
      left = options.anchorRect.right + gap;
      top = anchorCenterY - (options.overlayHeight / 2);
      break;
  }

  left = clamp(left, margin, options.viewportWidth - options.overlayWidth - margin);
  top = clamp(top, margin, options.viewportHeight - options.overlayHeight - margin);

  return {
    placement,
    left,
    top,
    arrowOffset: placement === 'top' || placement === 'bottom'
      ? clamp(anchorCenterX - left, arrowInset, options.overlayWidth - arrowInset)
      : clamp(anchorCenterY - top, arrowInset, options.overlayHeight - arrowInset),
  };
}

function arrowClass(placement: DesktopTooltipPlacement): string {
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

function arrowStyle(position: OverlayPosition): JSX.CSSProperties {
  if (position.placement === 'top' || position.placement === 'bottom') {
    return { left: `${position.arrowOffset}px` };
  }
  return { top: `${position.arrowOffset}px` };
}

export function DesktopTooltip(props: DesktopTooltipProps) {
  const [visible, setVisible] = createSignal(false);
  const [position, setPosition] = createSignal<OverlayPosition | null>(null);
  const resolvedPlacement = createMemo(() => position()?.placement ?? (props.placement ?? 'top'));

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let anchorRef: HTMLSpanElement | undefined;
  let tooltipRef: HTMLDivElement | undefined;

  const clearTimeoutHandle = () => {
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    timeout = undefined;
  };

  const clearFrameHandle = () => {
    if (!frame) {
      return;
    }
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const updatePosition = () => {
    if (!anchorRef || !tooltipRef || typeof window === 'undefined') {
      return;
    }

    const anchorRect = anchorRef.getBoundingClientRect();
    const tooltipRect = tooltipRef.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportOffsetLeft = viewport?.offsetLeft ?? 0;
    const viewportOffsetTop = viewport?.offsetTop ?? 0;

    const nextPosition = resolveOverlayPosition({
      anchorRect,
      overlayWidth: tooltipRect.width,
      overlayHeight: tooltipRect.height,
      viewportWidth,
      viewportHeight,
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
        if (event.currentTarget.contains(event.relatedTarget as Node)) {
          return;
        }
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
              'pointer-events-none fixed z-[220] max-w-[min(24rem,calc(100vw-1rem))] rounded border border-border/80 bg-popover px-2 py-1 text-xs leading-snug text-popover-foreground shadow-md',
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
              class={cn('absolute h-0 w-0', arrowClass(resolvedPlacement()))}
              style={position() ? arrowStyle(position()!) : undefined}
            />
          </div>
        </Portal>
      </Show>
    </span>
  );
}
