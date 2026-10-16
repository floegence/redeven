import { Show, createEffect, createSignal, type JSX } from 'solid-js';
import { useOverlayMask } from '@floegence/floe-webapp-core';
import { createFloatingPresence } from '@floegence/floe-webapp-core/ui';
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

const ACTION_POPOVER_EXIT_MS = 160;

export function DesktopActionPopover(props: DesktopActionPopoverProps) {
  let anchorRef: HTMLSpanElement | undefined;
  const [popoverRef, setPopoverRef] = createSignal<HTMLDivElement>();
  const presence = createFloatingPresence({ open: () => props.open, exitDurationMs: ACTION_POPOVER_EXIT_MS });
  let wasMounted = props.open;
  createEffect(() => {
    const mounted = presence.mounted();
    // IMPORTANT: Only the completed current exit may release its session; reopening reverses that exit.
    if (wasMounted && !mounted && !props.open) props.onExitComplete?.();
    wasMounted = mounted;
  });
  useOverlayMask({
    open: () => props.open,
    root: popoverRef,
    containsTarget: target => target instanceof Node && (anchorRef?.contains(target) === true || popoverRef()?.contains(target) === true),
    onClose: () => props.onOpenChange(false),
    onInteractOutside: () => props.onOpenChange(false),
    lockBodyScroll: false,
    trapFocus: false,
    autoFocus: { selector: '[data-redeven-action-popover-initial-focus], button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])' },
    escapeKeyPhase: 'bubble',
  });
  return (
    <span ref={anchorRef} data-redeven-action-popover-anchor="" class={cn('relative inline-block max-w-full', props.anchorClass)} onPointerDown={props.onAnchorPointerDown}>
      {props.children}
      <Show when={presence.mounted()}>
        <DesktopAnchoredOverlaySurface open={presence.mounted()} anchorRef={anchorRef} placement="top"
          placementLock={props.placementLock} allowMainAxisOverflow={props.allowMainAxisOverflow ?? false}
          role="dialog" ariaModal={false} ariaLabel={props.popoverAriaLabel} interactive={props.open} inactive={!props.open}
          positionFrozen={presence.exiting()}
          class={cn('redeven-action-popover-surface z-[225] text-popover-foreground', presence.exiting() && 'redeven-action-popover-surface--closing', props.class)}
          onOverlayRef={setPopoverRef} onPointerDownCapture={event => event.stopPropagation()}>
          <div class="redeven-action-popover-frame">{props.content}</div>
        </DesktopAnchoredOverlaySurface>
      </Show>
    </span>
  );
}
