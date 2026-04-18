import { Show, createEffect, onCleanup, type JSX } from 'solid-js';
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
            'z-[225] max-w-[min(22rem,calc(100vw-1rem))] rounded-md border border-border/80 bg-popover text-popover-foreground shadow-[0_14px_40px_-22px_rgba(0,0,0,0.55),0_24px_50px_-28px_rgba(0,0,0,0.28)]',
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
