export type AnchoredOverlayPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface AnchoredOverlayRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface AnchoredOverlaySize {
  width: number;
  height: number;
}

export interface AnchoredOverlayViewport {
  width: number;
  height: number;
}

export interface AnchoredOverlayPosition {
  placement: AnchoredOverlayPlacement;
  left: number;
  top: number;
  arrowOffset: number;
}

export interface ResolveAnchoredOverlayPositionOptions {
  anchorRect: AnchoredOverlayRect;
  overlaySize: AnchoredOverlaySize;
  viewport: AnchoredOverlayViewport;
  preferredPlacement?: AnchoredOverlayPlacement;
  gap?: number;
  margin?: number;
  arrowInset?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function oppositePlacement(placement: AnchoredOverlayPlacement): AnchoredOverlayPlacement {
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

export function resolveAnchoredOverlayPosition(options: ResolveAnchoredOverlayPositionOptions): AnchoredOverlayPosition {
  const preferredPlacement = options.preferredPlacement ?? 'top';
  const gap = Math.max(0, options.gap ?? 8);
  const margin = Math.max(0, options.margin ?? 8);
  const arrowInset = Math.max(8, options.arrowInset ?? 12);

  const { anchorRect, overlaySize, viewport } = options;
  const anchorCenterX = anchorRect.left + (anchorRect.width / 2);
  const anchorCenterY = anchorRect.top + (anchorRect.height / 2);

  const availableSpace = {
    top: anchorRect.top - margin - gap,
    bottom: viewport.height - anchorRect.bottom - margin - gap,
    left: anchorRect.left - margin - gap,
    right: viewport.width - anchorRect.right - margin - gap,
  } satisfies Record<AnchoredOverlayPlacement, number>;

  const orderedPlacements = [
    preferredPlacement,
    oppositePlacement(preferredPlacement),
    preferredPlacement === 'top' || preferredPlacement === 'bottom' ? 'right' : 'bottom',
    preferredPlacement === 'top' || preferredPlacement === 'bottom' ? 'left' : 'top',
  ] as const;

  const placement = orderedPlacements.find((candidate) => {
    const requiredSpace = candidate === 'top' || candidate === 'bottom' ? overlaySize.height : overlaySize.width;
    return availableSpace[candidate] >= requiredSpace;
  }) ?? orderedPlacements
    .slice()
    .sort((a, b) => availableSpace[b] - availableSpace[a])[0];

  let left = 0;
  let top = 0;

  switch (placement) {
    case 'top':
      left = anchorCenterX - (overlaySize.width / 2);
      top = anchorRect.top - gap - overlaySize.height;
      break;
    case 'bottom':
      left = anchorCenterX - (overlaySize.width / 2);
      top = anchorRect.bottom + gap;
      break;
    case 'left':
      left = anchorRect.left - gap - overlaySize.width;
      top = anchorCenterY - (overlaySize.height / 2);
      break;
    case 'right':
      left = anchorRect.right + gap;
      top = anchorCenterY - (overlaySize.height / 2);
      break;
  }

  left = clamp(left, margin, viewport.width - overlaySize.width - margin);
  top = clamp(top, margin, viewport.height - overlaySize.height - margin);

  const arrowOffset = placement === 'top' || placement === 'bottom'
    ? clamp(anchorCenterX - left, arrowInset, overlaySize.width - arrowInset)
    : clamp(anchorCenterY - top, arrowInset, overlaySize.height - arrowInset);

  return {
    placement,
    left,
    top,
    arrowOffset,
  };
}
