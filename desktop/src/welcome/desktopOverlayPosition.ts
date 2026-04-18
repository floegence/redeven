import type { JSX } from 'solid-js';

export type DesktopOverlayPlacement = 'top' | 'bottom' | 'left' | 'right';

export type DesktopAnchoredOverlayPosition = Readonly<{
  placement: DesktopOverlayPlacement;
  left: number;
  top: number;
  arrowOffset: number;
}>;

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function oppositePlacement(placement: DesktopOverlayPlacement): DesktopOverlayPlacement {
  switch (placement) {
    case 'top':
      return 'bottom';
    case 'bottom':
      return 'top';
    case 'left':
      return 'right';
    case 'right':
    default:
      return 'left';
  }
}

export function resolveDesktopAnchoredOverlayPosition(options: Readonly<{
  anchorRect: DOMRect;
  overlayWidth: number;
  overlayHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  preferredPlacement?: DesktopOverlayPlacement;
}>): DesktopAnchoredOverlayPosition {
  const preferredPlacement = options.preferredPlacement ?? 'top';
  const margin = 8;
  const gap = 8;
  const arrowInset = 12;
  const anchorCenterX = options.anchorRect.left + (options.anchorRect.width / 2);
  const anchorCenterY = options.anchorRect.top + (options.anchorRect.height / 2);

  const availableSpace = {
    top: options.anchorRect.top - margin - gap,
    bottom: options.viewportHeight - options.anchorRect.bottom - margin - gap,
    left: options.anchorRect.left - margin - gap,
    right: options.viewportWidth - options.anchorRect.right - margin - gap,
  } satisfies Record<DesktopOverlayPlacement, number>;

  const orderedPlacements = [
    preferredPlacement,
    oppositePlacement(preferredPlacement),
    preferredPlacement === 'top' || preferredPlacement === 'bottom' ? 'right' : 'bottom',
    preferredPlacement === 'top' || preferredPlacement === 'bottom' ? 'left' : 'top',
  ] as const;

  const placement = orderedPlacements.find((candidate) => {
    const requiredSpace = candidate === 'top' || candidate === 'bottom'
      ? options.overlayHeight
      : options.overlayWidth;
    return availableSpace[candidate] >= requiredSpace;
  }) ?? orderedPlacements.slice().sort((left, right) => availableSpace[right] - availableSpace[left])[0];

  let left = 0;
  let top = 0;

  switch (placement) {
    case 'top':
      left = anchorCenterX - (options.overlayWidth / 2);
      top = options.anchorRect.top - gap - options.overlayHeight;
      break;
    case 'bottom':
      left = anchorCenterX - (options.overlayWidth / 2);
      top = options.anchorRect.bottom + gap;
      break;
    case 'left':
      left = options.anchorRect.left - gap - options.overlayWidth;
      top = anchorCenterY - (options.overlayHeight / 2);
      break;
    case 'right':
      left = options.anchorRect.right + gap;
      top = anchorCenterY - (options.overlayHeight / 2);
      break;
  }

  left = clamp(left, margin, options.viewportWidth - options.overlayWidth - margin);
  top = clamp(top, margin, options.viewportHeight - options.overlayHeight - margin);

  return {
    placement,
    left,
    top,
    arrowOffset: placement === 'top' || placement === 'bottom'
      ? clamp(anchorCenterX - left, arrowInset, options.overlayWidth - arrowInset)
      : clamp(anchorCenterY - top, arrowInset, options.overlayHeight - arrowInset),
  };
}

export function desktopOverlayArrowClass(placement: DesktopOverlayPlacement): string {
  switch (placement) {
    case 'top':
      return 'left-0 top-full -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-popover border-b-0';
    case 'bottom':
      return 'left-0 bottom-full -translate-x-1/2 border-x-4 border-b-4 border-x-transparent border-b-popover border-t-0';
    case 'left':
      return 'left-full top-0 -translate-y-1/2 border-y-4 border-l-4 border-y-transparent border-l-popover border-r-0';
    case 'right':
    default:
      return 'right-full top-0 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-popover border-l-0';
  }
}

export function desktopOverlayArrowStyle(position: DesktopAnchoredOverlayPosition): JSX.CSSProperties {
  if (position.placement === 'top' || position.placement === 'bottom') {
    return { left: `${position.arrowOffset}px` };
  }
  return { top: `${position.arrowOffset}px` };
}
