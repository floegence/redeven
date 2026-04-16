import { describe, expect, it } from 'vitest';

import {
  DESKTOP_EMBEDDED_DRAG_REGION_VERSION,
  normalizeDesktopEmbeddedDragRegionRect,
  normalizeDesktopEmbeddedDragRegionSnapshot,
} from './desktopEmbeddedDragRegions';

describe('desktopEmbeddedDragRegions', () => {
  it('normalizes drag rects with positive geometry only', () => {
    expect(normalizeDesktopEmbeddedDragRegionRect({
      x: 32,
      y: 8,
      width: 160,
      height: 40,
    })).toEqual({
      x: 32,
      y: 8,
      width: 160,
      height: 40,
    });

    expect(normalizeDesktopEmbeddedDragRegionRect({
      x: -50,
      y: -4,
      width: 120,
      height: 40,
    })).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 40,
    });

    expect(normalizeDesktopEmbeddedDragRegionRect({
      x: 0,
      y: 0,
      width: 0,
      height: 40,
    })).toBeNull();
  });

  it('normalizes only supported drag snapshots', () => {
    expect(normalizeDesktopEmbeddedDragRegionSnapshot({
      version: DESKTOP_EMBEDDED_DRAG_REGION_VERSION,
      regions: [
        { x: 0, y: 0, width: 200, height: 40 },
      ],
    })).toEqual({
      version: DESKTOP_EMBEDDED_DRAG_REGION_VERSION,
      regions: [
        { x: 0, y: 0, width: 200, height: 40 },
      ],
    });

    expect(normalizeDesktopEmbeddedDragRegionSnapshot({
      version: DESKTOP_EMBEDDED_DRAG_REGION_VERSION + 1,
      regions: [
        { x: 0, y: 0, width: 200, height: 40 },
      ],
    })).toBeNull();

    expect(normalizeDesktopEmbeddedDragRegionSnapshot({
      version: DESKTOP_EMBEDDED_DRAG_REGION_VERSION,
      regions: [],
    })).toBeNull();
  });
});
