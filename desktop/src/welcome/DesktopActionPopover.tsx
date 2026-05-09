import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { type DesktopOverlayPlacement } from './desktopOverlayPosition';
import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';

export type DesktopActionPopoverProps = Readonly<{
  content: JSX.Element;
  children: JSX.Element;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placement?: DesktopOverlayPlacement;
  class?: string;
  anchorClass?: string;
  popoverAriaLabel?: string;
}>;

function cn(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(' ');
}

const ACTION_POPOVER_EXIT_MS = 180;

function firstFocusableElement(root: HTMLElement | undefined): HTMLElement | null {
  if (!root) {
    return null;
  }
  return root.querySelector<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
}

export function DesktopActionPopover(props: DesktopActionPopoverProps) {
  let anchorRef: HTMLSpanElement | undefined;
  let popoverRef: HTMLDivElement | undefined;
  let focusFrame = 0;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const [rendered, setRendered] = createSignal(props.open);
  const [closing, setClosing] = createSignal(false);

  const clearCloseTimer = () => {
    if (!closeTimer) {
      return;
    }
    clearTimeout(closeTimer);
    closeTimer = null;
  };

  const containsTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) {
      return false;
    }
    return anchorRef?.contains(target) === true || popoverRef?.contains(target) === true;
  };

  const focusAnchor = () => {
    firstFocusableElement(anchorRef)?.focus();
  };

  createEffect(() => {
    if (props.open) {
      clearCloseTimer();
      setRendered(true);
      setClosing(false);
      return;
    }
    if (!rendered()) {
      return;
    }
    setClosing(true);
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      setRendered(false);
      setClosing(false);
    }, ACTION_POPOVER_EXIT_MS);
  });

  createEffect(() => {
    if (!props.open) {
      return;
    }

    focusFrame = requestAnimationFrame(() => {
      focusFrame = 0;
      firstFocusableElement(popoverRef)?.focus();
    });

    const handlePointerDown = (event: MouseEvent) => {
      if (!containsTarget(event.target)) {
        props.onOpenChange(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onOpenChange(false);
        focusAnchor();
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!containsTarget(event.target)) {
        props.onOpenChange(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    onCleanup(() => {
      if (focusFrame) {
        cancelAnimationFrame(focusFrame);
        focusFrame = 0;
      }
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
    });
  });

  onCleanup(() => {
    clearCloseTimer();
    if (focusFrame) {
      cancelAnimationFrame(focusFrame);
      focusFrame = 0;
    }
    popoverRef = undefined;
  });

  return (
    <span
      ref={anchorRef}
      data-redeven-action-popover-anchor=""
      class={cn('relative inline-block max-w-full', props.anchorClass)}
    >
      {props.children}

      <Show when={rendered()}>
        <DesktopAnchoredOverlaySurface
          open={rendered()}
          anchorRef={anchorRef}
          placement={props.placement}
          role="dialog"
          ariaModal={false}
          ariaLabel={props.popoverAriaLabel}
          interactive
          class={cn(
            'redeven-action-popover-surface z-[225] max-w-[min(18rem,calc(100vw-1rem))] border border-border bg-popover text-popover-foreground',
            closing() && 'redeven-action-popover-surface--closing',
            props.class,
          )}
          onOverlayRef={(element) => {
            popoverRef = element;
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
