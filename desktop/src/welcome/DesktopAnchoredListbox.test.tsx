import { describe, expect, it } from 'vitest';

import { resolveDesktopAnchoredListboxGeometry } from './DesktopAnchoredListbox';

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

describe('DesktopAnchoredListbox', () => {
  it('opens below the anchor when there is enough room', () => {
    const geometry = resolveDesktopAnchoredListboxGeometry({
      anchorRect: rect(120, 160, 360, 32),
      overlayHeight: 220,
      viewportWidth: 900,
      viewportHeight: 700,
      maxHeight: 320,
    });

    expect(geometry).toMatchObject({
      placement: 'bottom',
      left: 120,
      top: 198,
      width: 360,
      maxHeight: 320,
    });
  });

  it('flips above the anchor instead of being clipped by dialog footers', () => {
    const geometry = resolveDesktopAnchoredListboxGeometry({
      anchorRect: rect(520, 520, 420, 32),
      overlayHeight: 260,
      viewportWidth: 1100,
      viewportHeight: 620,
      maxHeight: 320,
    });

    expect(geometry.placement).toBe('top');
    expect(geometry.top).toBe(254);
    expect(geometry.maxHeight).toBe(320);
  });

  it('keeps the listbox inside narrow viewports and constrains available height', () => {
    const geometry = resolveDesktopAnchoredListboxGeometry({
      anchorRect: rect(4, 92, 500, 32),
      overlayHeight: 360,
      viewportWidth: 360,
      viewportHeight: 260,
      maxHeight: 320,
    });

    expect(geometry.left).toBe(8);
    expect(geometry.width).toBe(344);
    expect(geometry.placement).toBe('bottom');
    expect(geometry.maxHeight).toBe(122);
  });
});
