import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  desktopOverlayArrowClass,
  desktopOverlayArrowStyle,
  resolveDesktopAnchoredOverlayPosition,
  type DesktopAnchoredOverlayPosition,
  type DesktopOverlayPlacement,
} from './desktopOverlayPosition';

export type DesktopTooltipPlacement = DesktopOverlayPlacement;

export type DesktopTooltipProps = Readonly<{
  content: string | JSX.Element;
  children: JSX.Element;
  placement?: DesktopTooltipPlacement;
  delay?: number;
  class?: string;
  anchorClass?: string;
  anchorTabIndex?: number;
  anchorRole?: JSX.HTMLAttributes<HTMLSpanElement>['role'];
  anchorAriaLabel?: string;
  anchorAriaDisabled?: boolean;
}>;

function cn(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(' ');
}

export function DesktopTooltip(props: DesktopTooltipProps) {
  const [visible, setVisible] = createSignal(false);
  const [position, setPosition] = createSignal<DesktopAnchoredOverlayPosition | null>(null);
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

    const nextPosition = resolveDesktopAnchoredOverlayPosition({
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
      class={cn('relative inline-block max-w-full', props.anchorClass)}
      tabIndex={props.anchorTabIndex}
      role={props.anchorRole}
      aria-label={props.anchorAriaLabel}
      aria-disabled={props.anchorAriaDisabled === true ? true : undefined}
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
              class={cn('absolute h-0 w-0', desktopOverlayArrowClass(resolvedPlacement()))}
              style={position() ? desktopOverlayArrowStyle(position()!) : undefined}
            />
          </div>
        </Portal>
      </Show>
    </span>
  );
}
