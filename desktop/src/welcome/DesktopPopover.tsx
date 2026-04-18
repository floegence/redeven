import { Show, createEffect, onCleanup, type JSX } from 'solid-js';
import { type DesktopOverlayPlacement } from './desktopOverlayPosition';
import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  let anchorRef: HTMLSpanElement | undefined;
  let popoverRef: HTMLDivElement | undefined;

  const clearTimer = () => {
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    timer = undefined;
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

  const bindDismissHandlers = () => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containsTarget(event.target)) {
        hide();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hide();
        anchorRef?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    });
  };

  createEffect(() => {
    if (!props.open) {
      return;
    }
    bindDismissHandlers();
  });

  onCleanup(() => {
    clearTimer();
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
        <DesktopAnchoredOverlaySurface
          open={props.open}
          anchorRef={anchorRef}
          placement={props.placement}
          role="dialog"
          ariaModal={false}
          ariaLabel={props.popoverAriaLabel}
          interactive
          class={cn(
            'z-[225] max-w-[min(21rem,calc(100vw-1rem))] rounded-md border border-border/80 bg-popover text-popover-foreground shadow-[0_14px_40px_-22px_rgba(0,0,0,0.55),0_24px_50px_-28px_rgba(0,0,0,0.28)]',
            props.class,
          )}
          onOverlayRef={(element) => {
            popoverRef = element;
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
          <>
            {props.content}
          </>
        </DesktopAnchoredOverlaySurface>
      </Show>
    </span>
  );
}
