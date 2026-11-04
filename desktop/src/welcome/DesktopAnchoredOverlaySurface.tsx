import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { createFloatingPresence } from '@floegence/floe-webapp-core/ui';
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
  zIndex?: number;
  motion?: 'menu' | 'tooltip';
  onExitComplete?: () => void;
  role?: JSX.HTMLAttributes<HTMLDivElement>['role'];
  ariaModal?: boolean;
  ariaLabel?: string;
  class?: string;
  interactive?: boolean;
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
  const presence = createFloatingPresence({
    open: () => props.open,
    element: overlayElement,
    exitDurationMs: props.motion === 'tooltip' ? 90 : 160,
  });
  let wasMounted = props.open;
  createEffect(() => {
    const mounted = presence.mounted();
    // IMPORTANT: Only the current completed exit may release its session; reopening cancels it.
    if (wasMounted && !mounted && !props.open) props.onExitComplete?.();
    wasMounted = mounted;
  });

  let frame = 0;
  let followUpFrames = 0;
  let positionerRef: HTMLDivElement | undefined;
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
    if (presence.exiting()) {
      return;
    }
    const currentOverlay = positionerRef;
    if (!currentOverlay || typeof window === 'undefined') {
      return;
    }

    if (props.anchorRef?.isConnected) retainedAnchorRect = props.anchorRef.getBoundingClientRect();
    const anchorRect = retainedAnchorRect;
    if (!anchorRect) return;
    const overlay = overlayElement();
    if (!overlay) return;
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportOffsetLeft = viewport?.offsetLeft ?? 0;
    const viewportOffsetTop = viewport?.offsetTop ?? 0;

    const nextPosition = resolveDesktopAnchoredOverlayPosition({
      anchorRect,
      overlayWidth: overlay.offsetWidth,
      overlayHeight: overlay.offsetHeight,
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
    if (!presence.mounted()) {
      clearFrame();
      setPosition(null);
      return;
    }
    if (presence.exiting()) {
      clearFrame();
      return;
    }
    if (!overlayElement()) return;

    // Establish the resolved starting pose before presence opens on the next frame.
    updatePosition();
    schedulePositionSettlingUpdates();

    const handleViewportChange = () => schedulePositionUpdate();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    const anchorEl = props.anchorRef;
    const nextOverlayRef = positionerRef;
    const observer = typeof ResizeObserver === 'undefined' || !anchorEl || !nextOverlayRef
      ? null
      : new ResizeObserver(() => {
        // Updating measured geometry inside delivery can trigger another resize.
        schedulePositionUpdate();
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

  // Position uses untransformed layout dimensions; only the inner surface moves.
  // IMPORTANT: Exiting or hidden surfaces must stop accepting keyboard and pointer input immediately.
  return (
    <Show when={presence.mounted()}>
      <Portal>
        <div
          ref={positionerRef}
          data-redeven-overlay-positioner=""
          class="fixed pointer-events-none"
          style={{
            'z-index': props.zIndex ?? 225,
            width: 'max-content',
            left: position() ? `${position()!.left}px` : '0px',
            top: position() ? `${position()!.top}px` : '0px',
            visibility: position() ? 'visible' : 'hidden',
            ...(position()?.maxWidth !== undefined ? { maxWidth: `${position()!.maxWidth}px` } : {}),
            ...(position()?.maxHeight !== undefined
              ? { '--redeven-anchored-overlay-max-height': `${position()!.maxHeight}px` }
              : {}),
          }}
        >
          <div
            ref={(element) => {
              clearPointerDownCapture();
              element.addEventListener('pointerdown', handlePointerDownCapture, true);
              pointerCaptureElement = element;
              setOverlayElement(element);
              props.onOverlayRef?.(element);
              onCleanup(() => {
                clearPointerDownCapture();
                props.onOverlayRef?.(undefined);
              });
              if (element && props.open) {
                updatePosition();
                schedulePositionSettlingUpdates();
              }
            }}
            inert={!props.open || props.interactive !== true || !position()}
            aria-hidden={!props.open || !position() ? true : undefined}
            role={props.role}
            aria-modal={props.ariaModal}
            aria-label={props.ariaLabel}
            data-floe-surface="floating"
            data-placement={resolvedPlacement()}
            data-placement-lock={props.placementLock}
            data-floating-presence={presence.state()}
            data-floating-side={resolvedPlacement()}
            class={cn(
              'relative floe-floating-presence',
              props.open && props.interactive === true ? 'pointer-events-auto' : 'pointer-events-none',
              props.motion === 'tooltip' ? 'floe-floating-tooltip' : 'floe-floating-menu',
              props.class,
            )}
            style={{
              '--floe-floating-origin': position()
                ? (resolvedPlacement() === 'top' || resolvedPlacement() === 'bottom'
                  ? `${position()!.arrowOffset}px ${resolvedPlacement() === 'top' ? 'bottom' : 'top'}`
                  : `${resolvedPlacement() === 'left' ? 'right' : 'left'} ${position()!.arrowOffset}px`)
                : undefined,
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
        </div>
      </Portal>
    </Show>
  );
}
