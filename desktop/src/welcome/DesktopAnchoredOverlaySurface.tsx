import { createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  desktopOverlayArrowClass,
  desktopOverlayArrowStyle,
  resolveDesktopAnchoredOverlayPosition,
  type DesktopAnchoredOverlayPosition,
  type DesktopOverlayPlacement,
} from './desktopOverlayPosition';

type DesktopAnchoredOverlaySurfaceProps = Readonly<{
  open: boolean;
  anchorRef: HTMLElement | undefined;
  placement?: DesktopOverlayPlacement;
  role?: JSX.HTMLAttributes<HTMLDivElement>['role'];
  ariaModal?: boolean;
  ariaLabel?: string;
  class?: string;
  interactive?: boolean;
  onMouseEnter?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  onMouseLeave?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  onFocusIn?: JSX.EventHandlerUnion<HTMLDivElement, FocusEvent>;
  onFocusOut?: JSX.EventHandlerUnion<HTMLDivElement, FocusEvent>;
  onOverlayRef?: (element: HTMLDivElement | undefined) => void;
  children: JSX.Element;
}>;

function cn(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(' ');
}

export function DesktopAnchoredOverlaySurface(props: DesktopAnchoredOverlaySurfaceProps) {
  const [position, setPosition] = createSignal<DesktopAnchoredOverlayPosition | null>(null);
  const resolvedPlacement = createMemo(() => position()?.placement ?? (props.placement ?? 'top'));

  let frame = 0;
  let overlayRef: HTMLDivElement | undefined;

  const clearFrame = () => {
    if (!frame) {
      return;
    }
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const updatePosition = () => {
    if (!props.anchorRef || !overlayRef || typeof window === 'undefined') {
      return;
    }

    const anchorRect = props.anchorRef.getBoundingClientRect();
    const overlayRect = overlayRef.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportOffsetLeft = viewport?.offsetLeft ?? 0;
    const viewportOffsetTop = viewport?.offsetTop ?? 0;

    const nextPosition = resolveDesktopAnchoredOverlayPosition({
      anchorRect,
      overlayWidth: overlayRect.width,
      overlayHeight: overlayRect.height,
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

  const schedulePositionUpdate = () => {
    clearFrame();
    frame = requestAnimationFrame(() => {
      frame = 0;
      updatePosition();
    });
  };

  createEffect(() => {
    if (!props.open) {
      clearFrame();
      setPosition(null);
      return;
    }

    schedulePositionUpdate();

    const handleViewportChange = () => schedulePositionUpdate();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    const anchorEl = props.anchorRef;
    const nextOverlayRef = overlayRef;
    const observer = typeof ResizeObserver === 'undefined' || !anchorEl || !nextOverlayRef
      ? null
      : new ResizeObserver(() => {
	        updatePosition();
	      });
    if (observer && anchorEl && nextOverlayRef) {
      observer.observe(anchorEl);
      observer.observe(nextOverlayRef);
    }

    onCleanup(() => {
      observer?.disconnect();
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      clearFrame();
    });
  });

  onCleanup(() => clearFrame());

  return (
    <Portal>
      <div
        ref={(element) => {
          overlayRef = element;
          props.onOverlayRef?.(element);
        }}
        role={props.role}
        aria-modal={props.ariaModal}
        aria-label={props.ariaLabel}
        data-placement={resolvedPlacement()}
        class={cn(
          'fixed animate-in fade-in zoom-in-95',
          props.interactive === true ? 'pointer-events-auto' : 'pointer-events-none',
          props.class,
        )}
        style={{
          left: position() ? `${position()!.left}px` : '0px',
          top: position() ? `${position()!.top}px` : '0px',
          visibility: position() ? 'visible' : 'hidden',
        }}
        onMouseEnter={props.onMouseEnter}
        onMouseLeave={props.onMouseLeave}
        onFocusIn={props.onFocusIn}
        onFocusOut={props.onFocusOut}
      >
        {props.children}
        <div
          class={cn('absolute h-0 w-0', desktopOverlayArrowClass(resolvedPlacement()))}
          style={position() ? desktopOverlayArrowStyle(position()!) : undefined}
        />
      </div>
    </Portal>
  );
}
