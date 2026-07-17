import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';
import type { DesktopOverlayPlacementLock } from './desktopOverlayPosition';

export type DesktopActionPopoverProps = Readonly<{
  content: JSX.Element;
  children: JSX.Element;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  class?: string;
  anchorClass?: string;
  placementLock?: DesktopOverlayPlacementLock;
  allowMainAxisOverflow?: boolean;
  popoverAriaLabel?: string;
  onAnchorPointerDown?: JSX.EventHandlerUnion<HTMLSpanElement, PointerEvent>;
  onExitComplete?: () => void;
}>;

function cn(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(' ');
}

const ACTION_POPOVER_EXIT_MS = 180;

function firstFocusableElement(root: HTMLElement | undefined): HTMLElement | null {
  if (!root) {
    return null;
  }
  return root.querySelector<HTMLElement>(
    '[data-redeven-action-popover-initial-focus], button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  );
}

export function DesktopActionPopover(props: DesktopActionPopoverProps) {
  let anchorRef: HTMLSpanElement | undefined;
  let popoverRef: HTMLDivElement | undefined;
  let focusFrame = 0;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let latestFrameHTML: string | null = null;
  let frameObserver: MutationObserver | null = null;

  const [rendered, setRendered] = createSignal(props.open);
  const [closing, setClosing] = createSignal(false);
  const [closingFrameHTML, setClosingFrameHTML] = createSignal<string | null>(null);

  const clearCloseTimer = () => {
    if (!closeTimer) {
      return;
    }
    clearTimeout(closeTimer);
    closeTimer = null;
  };

  const currentFrameHTML = (): string | null => (
    popoverRef?.querySelector<HTMLElement>('.redeven-action-popover-frame')?.innerHTML ?? null
  );

  const captureCurrentFrameHTML = (): string | null => {
    const html = currentFrameHTML();
    if (html !== null) {
      latestFrameHTML = html;
    }
    return html;
  };

  const clearFrameObserver = () => {
    frameObserver?.disconnect();
    frameObserver = null;
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

  const stopSurfacePointerDownPropagation = (event: PointerEvent) => {
    event.stopPropagation();
  };

  const requestOpenChange = (open: boolean) => {
    if (!open) {
      setClosingFrameHTML(captureCurrentFrameHTML() ?? latestFrameHTML);
    }
    props.onOpenChange(open);
  };

  createEffect(() => {
    if (props.open) {
      clearCloseTimer();
      setRendered(true);
      setClosing(false);
      setClosingFrameHTML(null);
      return;
    }
    if (!rendered()) {
      return;
    }
    setClosing(true);
    setClosingFrameHTML(closingFrameHTML() ?? latestFrameHTML ?? captureCurrentFrameHTML());
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      setRendered(false);
      setClosing(false);
      setClosingFrameHTML(null);
      props.onExitComplete?.();
    }, ACTION_POPOVER_EXIT_MS);
  });

  createEffect(() => {
    clearFrameObserver();
    if (!props.open || closing()) {
      return;
    }
    const frameElement = popoverRef?.querySelector<HTMLElement>('.redeven-action-popover-frame');
    if (!frameElement || typeof MutationObserver === 'undefined') {
      captureCurrentFrameHTML();
      return;
    }
    captureCurrentFrameHTML();
    frameObserver = new MutationObserver(() => {
      captureCurrentFrameHTML();
    });
    frameObserver.observe(frameElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    onCleanup(clearFrameObserver);
  });

  createEffect(() => {
    if (!props.open) {
      return;
    }

    focusFrame = requestAnimationFrame(() => {
      focusFrame = 0;
      firstFocusableElement(popoverRef)?.focus();
    });

    const handlePointerDown = (event: PointerEvent) => {
      if (!containsTarget(event.target)) {
        requestOpenChange(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        requestOpenChange(false);
        focusAnchor();
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!containsTarget(event.target)) {
        requestOpenChange(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    onCleanup(() => {
      if (focusFrame) {
        cancelAnimationFrame(focusFrame);
        focusFrame = 0;
      }
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
    });
  });

  onCleanup(() => {
    clearFrameObserver();
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
      onPointerDown={props.onAnchorPointerDown}
    >
      {props.children}

      <Show when={rendered()}>
        <DesktopAnchoredOverlaySurface
          open={rendered()}
          anchorRef={anchorRef}
          placement="top"
          placementLock={props.placementLock}
          allowMainAxisOverflow={props.allowMainAxisOverflow ?? true}
          role="dialog"
          ariaModal={false}
          ariaLabel={props.popoverAriaLabel}
          interactive
          positionFrozen={closing()}
          class={cn(
            'redeven-action-popover-surface z-[225] text-popover-foreground',
            closing() && 'redeven-action-popover-surface--closing',
            props.class,
          )}
          onOverlayRef={(element) => {
            popoverRef = element;
            if (element && props.open && !closing()) {
              captureCurrentFrameHTML();
            }
          }}
          onPointerDownCapture={stopSurfacePointerDownPropagation}
        >
          <Show
            when={closingFrameHTML()}
            fallback={<div class="redeven-action-popover-frame">{props.content}</div>}
          >
            {(html) => <div class="redeven-action-popover-frame" innerHTML={html()} />}
          </Show>
        </DesktopAnchoredOverlaySurface>
      </Show>
    </span>
  );
}
