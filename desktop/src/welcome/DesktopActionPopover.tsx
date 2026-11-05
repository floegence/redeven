import { createSignal, type JSX } from 'solid-js';
import { useOverlayMask } from '@floegence/floe-webapp-core';
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

export function DesktopActionPopover(props: DesktopActionPopoverProps) {
  let anchorRef: HTMLSpanElement | undefined;
  const [popoverRef, setPopoverRef] = createSignal<HTMLDivElement>();
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
      <DesktopAnchoredOverlaySurface open={props.open} anchorRef={anchorRef} placement="top" animateHeight
        placementLock={props.placementLock} allowMainAxisOverflow={props.allowMainAxisOverflow ?? false}
        role="dialog" ariaModal={false} ariaLabel={props.popoverAriaLabel} interactive={props.open}
        onExitComplete={props.onExitComplete}
        class={cn('redeven-action-popover-surface z-[225] text-popover-foreground', props.class)}
        onOverlayRef={setPopoverRef} onPointerDownCapture={event => event.stopPropagation()}>
        <div class="redeven-action-popover-frame">{props.content}</div>
      </DesktopAnchoredOverlaySurface>
    </span>
  );
}
