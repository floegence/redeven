import { describe, expect, it } from 'vitest';
import {
  desktopOverlayArrowClass,
  desktopOverlayArrowStyle,
  resolveDesktopAnchoredOverlayPosition,
} from './desktopOverlayPosition';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('desktopOverlayPosition', () => {
  it('keeps the preferred top placement when enough space exists', () => {
    const position = resolveDesktopAnchoredOverlayPosition({
      anchorRect: rect(200, 180, 48, 28),
      overlayWidth: 180,
      overlayHeight: 80,
      viewportWidth: 800,
      viewportHeight: 600,
      preferredPlacement: 'top',
    });

    expect(position.placement).toBe('top');
    expect(position.top).toBe(92);
    expect(position.left).toBe(134);
  });

  it('falls back to bottom placement when the preferred top placement does not fit', () => {
    const position = resolveDesktopAnchoredOverlayPosition({
      anchorRect: rect(220, 18, 40, 24),
      overlayWidth: 170,
      overlayHeight: 72,
      viewportWidth: 800,
      viewportHeight: 600,
      preferredPlacement: 'top',
    });

    expect(position.placement).toBe('bottom');
    expect(position.top).toBe(50);
  });

  it('keeps an unconstrained overlay on the preferred top placement even when it overflows', () => {
    const position = resolveDesktopAnchoredOverlayPosition({
      anchorRect: rect(220, 18, 40, 24),
      overlayWidth: 170,
      overlayHeight: 72,
      viewportWidth: 800,
      viewportHeight: 600,
      preferredPlacement: 'top',
      constrainToViewport: false,
    });

    expect(position.placement).toBe('top');
    expect(position.top).toBe(-62);
    expect(position.left).toBe(155);
  });

  it('does not fallback to a side placement when unconstrained top overflows', () => {
    const anchorRect = rect(64, 90, 32, 28);
    const constrainedPosition = resolveDesktopAnchoredOverlayPosition({
      anchorRect,
      overlayWidth: 72,
      overlayHeight: 180,
      viewportWidth: 640,
      viewportHeight: 210,
      preferredPlacement: 'top',
    });
    const unconstrainedPosition = resolveDesktopAnchoredOverlayPosition({
      anchorRect,
      overlayWidth: 72,
      overlayHeight: 180,
      viewportWidth: 640,
      viewportHeight: 210,
      preferredPlacement: 'top',
      constrainToViewport: false,
    });

    expect(constrainedPosition.placement).toBe('right');
    expect(unconstrainedPosition.placement).toBe('top');
    expect(unconstrainedPosition.top).toBe(-98);
    expect(unconstrainedPosition.left).toBe(44);
  });

  it('clamps the overlay inside the viewport while keeping the arrow offset usable', () => {
    const position = resolveDesktopAnchoredOverlayPosition({
      anchorRect: rect(6, 160, 24, 24),
      overlayWidth: 200,
      overlayHeight: 70,
      viewportWidth: 220,
      viewportHeight: 400,
      preferredPlacement: 'top',
    });

    expect(position.left).toBe(8);
    expect(position.arrowOffset).toBeGreaterThanOrEqual(12);
    expect(position.arrowOffset).toBeLessThanOrEqual(188);
    expect(desktopOverlayArrowStyle(position)).toEqual({ left: `${position.arrowOffset}px` });
    expect(desktopOverlayArrowClass('top')).toContain('border-t-popover');
  });

  it('does not clamp an unconstrained overlay inside the viewport', () => {
    const position = resolveDesktopAnchoredOverlayPosition({
      anchorRect: rect(6, 160, 24, 24),
      overlayWidth: 200,
      overlayHeight: 70,
      viewportWidth: 220,
      viewportHeight: 400,
      preferredPlacement: 'top',
      constrainToViewport: false,
    });

    expect(position.placement).toBe('top');
    expect(position.left).toBe(-82);
    expect(position.arrowOffset).toBe(100);
  });

  it('keeps a top overlay above the anchor while shifting it inside the left viewport edge', () => {
    const position = resolveDesktopAnchoredOverlayPosition({
      anchorRect: rect(6, 18, 24, 24),
      overlayWidth: 200,
      overlayHeight: 70,
      viewportWidth: 220,
      viewportHeight: 400,
      preferredPlacement: 'top',
      allowMainAxisOverflow: true,
    });

    expect(position.placement).toBe('top');
    expect(position.top).toBe(-60);
    expect(position.left).toBe(8);
    expect(position.arrowOffset).toBe(12);
  });

  it('keeps a top overlay above the anchor while shifting it inside the right viewport edge', () => {
    const position = resolveDesktopAnchoredOverlayPosition({
      anchorRect: rect(186, 18, 24, 24),
      overlayWidth: 200,
      overlayHeight: 70,
      viewportWidth: 220,
      viewportHeight: 400,
      preferredPlacement: 'top',
      allowMainAxisOverflow: true,
    });

    expect(position.placement).toBe('top');
    expect(position.top).toBe(-60);
    expect(position.left).toBe(12);
    expect(position.arrowOffset).toBe(186);
  });

  it('locks Gateway action popovers above the trigger while only shifting inline', () => {
    const position = resolveDesktopAnchoredOverlayPosition({
      anchorRect: rect(186, 18, 24, 24),
      overlayWidth: 200,
      overlayHeight: 70,
      viewportWidth: 220,
      viewportHeight: 400,
      preferredPlacement: 'top',
      placementLock: 'top-inline-shift',
      allowMainAxisOverflow: false,
    });

    expect(position.placement).toBe('top');
    expect(position.top).toBe(8);
    expect(position.left).toBe(12);
    expect(position.arrowOffset).toBe(186);
    expect(position.maxHeight).toBe(2);
  });

  it('keeps a short locked Gateway action popover attached above the trigger when it fits', () => {
    const position = resolveDesktopAnchoredOverlayPosition({
      anchorRect: rect(186, 120, 24, 24),
      overlayWidth: 200,
      overlayHeight: 70,
      viewportWidth: 220,
      viewportHeight: 400,
      preferredPlacement: 'top',
      placementLock: 'top-inline-shift',
      allowMainAxisOverflow: false,
    });

    expect(position.placement).toBe('top');
    expect(position.top).toBe(42);
    expect(position.left).toBe(12);
    expect(position.arrowOffset).toBe(186);
    expect(position.maxHeight).toBe(104);
  });

  it('keeps a tall locked Gateway action popover inside the viewport', () => {
    const position = resolveDesktopAnchoredOverlayPosition({
      anchorRect: rect(49, 388, 282, 28),
      overlayWidth: 304,
      overlayHeight: 522,
      viewportWidth: 1311,
      viewportHeight: 835,
      preferredPlacement: 'top',
      placementLock: 'top-inline-shift',
      allowMainAxisOverflow: false,
    });

    expect(position.placement).toBe('top');
    expect(position.top).toBe(8);
    expect(position.left).toBe(38);
    expect(position.maxHeight).toBe(372);
    expect(position.arrowOffset).toBeCloseTo(152, 0);
  });

  it('keeps the same viewport height lock after a tall Gateway popover has been clipped', () => {
    const position = resolveDesktopAnchoredOverlayPosition({
      anchorRect: rect(49, 388, 282, 28),
      overlayWidth: 304,
      overlayHeight: 372,
      viewportWidth: 1311,
      viewportHeight: 835,
      preferredPlacement: 'top',
      placementLock: 'top-inline-shift',
      allowMainAxisOverflow: false,
    });

    expect(position.placement).toBe('top');
    expect(position.top).toBe(8);
    expect(position.left).toBe(38);
    expect(position.maxHeight).toBe(372);
    expect(position.arrowOffset).toBeCloseTo(152, 0);
  });
});
