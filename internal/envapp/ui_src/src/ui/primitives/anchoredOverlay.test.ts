import { describe, expect, it } from 'vitest';
import { resolveAnchoredOverlayPosition } from './anchoredOverlay';

describe('resolveAnchoredOverlayPosition', () => {
  it('keeps the preferred placement when there is enough space', () => {
    const result = resolveAnchoredOverlayPosition({
      anchorRect: { left: 240, top: 160, right: 320, bottom: 192, width: 80, height: 32 },
      overlaySize: { width: 140, height: 44 },
      viewport: { width: 800, height: 600 },
      preferredPlacement: 'top',
    });

    expect(result.placement).toBe('top');
    expect(result.left).toBe(210);
    expect(result.top).toBe(108);
    expect(result.arrowOffset).toBe(70);
  });

  it('falls back to the opposite placement when the preferred side is clipped', () => {
    const result = resolveAnchoredOverlayPosition({
      anchorRect: { left: 240, top: 12, right: 320, bottom: 44, width: 80, height: 32 },
      overlaySize: { width: 140, height: 44 },
      viewport: { width: 800, height: 600 },
      preferredPlacement: 'top',
    });

    expect(result.placement).toBe('bottom');
    expect(result.top).toBe(52);
  });

  it('clamps the overlay into the viewport while preserving an in-bounds arrow offset', () => {
    const result = resolveAnchoredOverlayPosition({
      anchorRect: { left: 8, top: 220, right: 40, bottom: 252, width: 32, height: 32 },
      overlaySize: { width: 180, height: 44 },
      viewport: { width: 320, height: 640 },
      preferredPlacement: 'top',
    });

    expect(result.placement).toBe('top');
    expect(result.left).toBe(8);
    expect(result.arrowOffset).toBeGreaterThanOrEqual(12);
    expect(result.arrowOffset).toBeLessThanOrEqual(168);
  });
});
