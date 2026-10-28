import { createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  desktopOverlayArrowClass,
  desktopOverlayArrowStyle,
  resolveDesktopAnchoredOverlayPosition,
  type DesktopAnchoredOverlayPosition,
  type DesktopOverlayPlacement,
  type DesktopOverlayPlacementLock,
} from './desktopOverlayPosition';

type DesktopAnchoredOverlaySurfaceProps = Readonly<{
  open: boolean;
  anchorRef: HTMLElement | undefined;
  placement?: DesktopOverlayPlacement;
  placementLock?: DesktopOverlayPlacementLock;
  constrainToViewport?: boolean;
  allowMainAxisOverflow?: boolean;
  hideArrow?: boolean;
  /** Floe's menu motion. Every anchored surface that is not a rich custom
   * popover opts in, so an open menu moves the way the rest of the shell does
   * instead of snapping into place. */
  motion?: 'menu' | 'none';
  role?: JSX.HTMLAttributes<HTMLDivElement>['role'];
  ariaModal?: boolean;
  ariaLabel?: string;
  class?: string;
  interactive?: boolean;
  inactive?: boolean;
  positionFrozen?: boolean;
  onMouseEnter?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  onMouseLeave?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  onPointerDownCapture?: (event: PointerEvent) => void;
  onKeyDown?: JSX.EventHandler<HTMLDivElement, KeyboardEvent>;
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
  const [overlayElement, setOverlayElement] = createSignal<HTMLDivElement | undefined>();
  const resolvedPlacement = createMemo(() => position()?.placement ?? (props.placement ?? 'top'));
  // Floe's presence states drive the menu motion: `entering` holds the offset,
  // scale and transparency for the frame the surface first paints, then `open`
  // releases them along the declared transition. A surface stays in `entering`
  // until it has a measured position, because an unpositioned panel is hidden
  // and would otherwise finish its motion off screen.
  const [presence, setPresence] = createSignal<'entering' | 'open'>('entering');
  createEffect(() => {
    if (!props.open) {
      setPresence('entering');
      return;
    }
    if (!position()) return;
    const frame = requestAnimationFrame(() => setPresence('open'));
    onCleanup(() => cancelAnimationFrame(frame));
  });

  let frame = 0;
  let followUpFrames = 0;
  let overlayRef: HTMLDivElement | undefined;
  let retainedAnchorRect: DOMRect | undefined;
  let pointerCaptureElement: HTMLDivElement | undefined;

  const handlePointerDownCapture = (event: PointerEvent) => {
    props.onPointerDownCapture?.(event);
  };

  const clearPointerDownCapture = () => {
    if (!pointerCaptureElement) {
      return;
    }
    pointerCaptureElement.removeEventListener('pointerdown', handlePointerDownCapture, true);
    pointerCaptureElement = undefined;
  };

  const clearFrame = () => {
    if (!frame) {
      return;
    }
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const updatePosition = () => {
    if (props.positionFrozen === true) {
      return;
    }
    const currentOverlay = overlayElement() ?? overlayRef;
    if (!currentOverlay || typeof window === 'undefined') {
      return;
    }

    if (props.anchorRef?.isConnected) retainedAnchorRect = props.anchorRef.getBoundingClientRect();
    const anchorRect = retainedAnchorRect;
    if (!anchorRect) return;
    const overlayRect = currentOverlay.getBoundingClientRect();
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
      placementLock: props.placementLock,
      constrainToViewport: props.constrainToViewport,
      allowMainAxisOverflow: props.allowMainAxisOverflow,
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
      if (followUpFrames > 0) {
        followUpFrames -= 1;
        schedulePositionUpdate();
      }
    });
  };

  const schedulePositionSettlingUpdates = () => {
    followUpFrames = 4;
    schedulePositionUpdate();
  };

  createEffect(() => {
    if (!props.open) {
      clearFrame();
      setPosition(null);
      return;
    }
    if (props.positionFrozen === true) {
      clearFrame();
      return;
    }

    schedulePositionSettlingUpdates();

    const handleViewportChange = () => schedulePositionUpdate();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    const anchorEl = props.anchorRef;
    const nextOverlayRef = overlayElement() ?? overlayRef;
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

  onCleanup(() => {
    clearPointerDownCapture();
    clearFrame();
  });

  // IMPORTANT: Exiting or hidden surfaces must stop accepting keyboard and pointer input immediately.
  return (
    <Portal>
      <div
        ref={(element) => {
          clearPointerDownCapture();
          overlayRef = element;
          element.addEventListener('pointerdown', handlePointerDownCapture, true);
          pointerCaptureElement = element;
          setOverlayElement(element);
          props.onOverlayRef?.(element);
          if (element && props.open && props.positionFrozen !== true) {
            updatePosition();
            schedulePositionSettlingUpdates();
          }
        }}
        inert={props.interactive !== true || !position()}
        aria-hidden={props.inactive || !position() ? true : undefined}
        role={props.role}
        aria-modal={props.ariaModal}
        aria-label={props.ariaLabel}
        data-floe-surface="floating"
        data-placement={resolvedPlacement()}
        data-placement-lock={props.placementLock}
        data-floating-presence={props.motion === 'menu' ? presence() : undefined}
        class={cn(
          'fixed',
          props.interactive === true ? 'pointer-events-auto' : 'pointer-events-none',
          props.motion === 'menu' && 'floe-floating-presence floe-floating-menu',
          props.class,
        )}
        style={{
          left: position() ? `${position()!.left}px` : '0px',
          top: position() ? `${position()!.top}px` : '0px',
          visibility: position() ? 'visible' : 'hidden',
          ...(position()?.maxWidth !== undefined ? { maxWidth: `${position()!.maxWidth}px` } : {}),
          ...(position()?.maxHeight !== undefined
            ? { '--redeven-anchored-overlay-max-height': `${position()!.maxHeight}px` }
            : {}),
        }}
        onMouseEnter={props.onMouseEnter}
        onMouseLeave={props.onMouseLeave}
        onKeyDown={props.onKeyDown}
        onFocusIn={props.onFocusIn}
        onFocusOut={props.onFocusOut}
      >
        {props.children}
        {!props.hideArrow && (
          <div
            class={cn('redeven-anchored-overlay-arrow absolute h-0 w-0', desktopOverlayArrowClass(resolvedPlacement()))}
            style={position() ? desktopOverlayArrowStyle(position()!) : undefined}
          />
        )}
      </div>
    </Portal>
  );
}
