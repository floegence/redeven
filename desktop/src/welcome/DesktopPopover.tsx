import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  desktopOverlayArrowClass,
  desktopOverlayArrowStyle,
  resolveDesktopAnchoredOverlayPosition,
  type DesktopAnchoredOverlayPosition,
  type DesktopOverlayPlacement,
} from './desktopOverlayPosition';

export type DesktopPopoverProps = Readonly<{
  content: JSX.Element;
  children: JSX.Element;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placement?: DesktopOverlayPlacement;
  delay?: number;
  closeDelay?: number;
  class?: string;
  anchorClass?: string;
  anchorTabIndex?: number;
  anchorRole?: JSX.HTMLAttributes<HTMLSpanElement>['role'];
  anchorAriaLabel?: string;
  anchorAriaDisabled?: boolean;
  anchorHasPopup?: boolean | 'dialog' | 'menu' | 'grid' | 'listbox' | 'tree';
  popoverAriaLabel?: string;
}>;

function cn(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(' ');
}

function firstFocusableElement(root: HTMLElement | undefined): HTMLElement | null {
  if (!root) {
    return null;
  }
  return root.querySelector<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
}

export function DesktopPopover(props: DesktopPopoverProps) {
  const [position, setPosition] = createSignal<DesktopAnchoredOverlayPosition | null>(null);
  const resolvedPlacement = createMemo(() => position()?.placement ?? (props.placement ?? 'top'));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let anchorRef: HTMLSpanElement | undefined;
  let popoverRef: HTMLDivElement | undefined;

  const clearTimer = () => {
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    timer = undefined;
  };

  const clearFrame = () => {
    if (!frame) {
      return;
    }
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const updatePosition = () => {
    if (!anchorRef || !popoverRef || typeof window === 'undefined') {
      return;
    }

    const anchorRect = anchorRef.getBoundingClientRect();
    const popoverRect = popoverRef.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportOffsetLeft = viewport?.offsetLeft ?? 0;
    const viewportOffsetTop = viewport?.offsetTop ?? 0;

    const nextPosition = resolveDesktopAnchoredOverlayPosition({
      anchorRect,
      overlayWidth: popoverRect.width,
      overlayHeight: popoverRect.height,
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

  const containsTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) {
      return false;
    }
    return anchorRef?.contains(target) === true || popoverRef?.contains(target) === true;
  };

  const open = () => {
    clearTimer();
    if (props.open) {
      return;
    }
    const delay = props.delay ?? 0;
    if (delay <= 0) {
      props.onOpenChange(true);
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      props.onOpenChange(true);
    }, delay);
  };

  const hide = () => {
    clearTimer();
    if (!props.open) {
      return;
    }
    props.onOpenChange(false);
  };

  const scheduleHide = () => {
    clearTimer();
    const delay = props.closeDelay ?? 120;
    if (delay <= 0) {
      if (props.open) {
        props.onOpenChange(false);
      }
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      props.onOpenChange(false);
    }, delay);
  };

  const focusFirstAction = () => {
    open();
    requestAnimationFrame(() => {
      firstFocusableElement(popoverRef)?.focus();
    });
  };

  createEffect(() => {
    if (!props.open) {
      clearFrame();
      setPosition(null);
      return;
    }

    schedulePositionUpdate();

    const handlePointerDown = (event: MouseEvent) => {
      if (!containsTarget(event.target)) {
        hide();
      }
    };
    const handleViewportChange = () => schedulePositionUpdate();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hide();
        anchorRef?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    const anchorEl = anchorRef;
    const popoverEl = popoverRef;
    const observer = typeof ResizeObserver === 'undefined' || !anchorEl || !popoverEl
      ? null
      : new ResizeObserver(() => schedulePositionUpdate());
    if (observer && anchorEl && popoverEl) {
      observer.observe(anchorEl);
      observer.observe(popoverEl);
    }

    onCleanup(() => {
      observer?.disconnect();
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      clearFrame();
    });
  });

  onCleanup(() => {
    clearTimer();
    clearFrame();
  });

  return (
    <span
      ref={anchorRef}
      data-redeven-popover-anchor=""
      class={cn('relative inline-block max-w-full', props.anchorClass)}
      tabIndex={props.anchorTabIndex}
      role={props.anchorRole}
      aria-label={props.anchorAriaLabel}
      aria-disabled={props.anchorAriaDisabled === true ? true : undefined}
      aria-haspopup={props.anchorHasPopup}
      aria-expanded={props.anchorHasPopup ? props.open : undefined}
      onMouseEnter={open}
      onMouseLeave={(event) => {
        if (containsTarget(event.relatedTarget)) {
          return;
        }
        scheduleHide();
      }}
      onFocusIn={open}
      onFocusOut={(event) => {
        if (containsTarget(event.relatedTarget)) {
          return;
        }
        scheduleHide();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
          event.preventDefault();
          focusFirstAction();
        }
      }}
    >
      {props.children}

      <Show when={props.open}>
        <Portal>
          <div
            ref={popoverRef}
            role="dialog"
            aria-modal="false"
            aria-label={props.popoverAriaLabel}
            data-placement={resolvedPlacement()}
            class={cn(
              'pointer-events-auto fixed z-[225] max-w-[min(21rem,calc(100vw-1rem))] rounded-md border border-border/80 bg-popover text-popover-foreground shadow-[0_14px_40px_-22px_rgba(0,0,0,0.55),0_24px_50px_-28px_rgba(0,0,0,0.28)]',
              'animate-in fade-in zoom-in-95',
              props.class,
            )}
            style={{
              left: position() ? `${position()!.left}px` : '0px',
              top: position() ? `${position()!.top}px` : '0px',
              visibility: position() ? 'visible' : 'hidden',
            }}
            onMouseEnter={open}
            onMouseLeave={(event) => {
              if (containsTarget(event.relatedTarget)) {
                return;
              }
              scheduleHide();
            }}
            onFocusIn={open}
            onFocusOut={(event) => {
              if (containsTarget(event.relatedTarget)) {
                return;
              }
              scheduleHide();
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
