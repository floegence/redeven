import { describe, expect, it } from 'vitest';

import {
  projectFileBrowserFABAnchor,
  resolveFileBrowserFABAnchorFromPosition,
  type FileBrowserFABAnchorState,
} from './createFileBrowserFABModel';

describe('createFileBrowserFABModel geometry helpers', () => {
  it('projects a right-edge anchor to the lower-right corner of the current container', () => {
    const position = projectFileBrowserFABAnchor(
      {
        edge: 'right',
        offsetRatio: 1,
      },
      {
        width: 320,
        height: 240,
      },
    );

    expect(position).toEqual({
      left: 264,
      top: 184,
    });
  });

  it('resolves a dropped position into a stable edge anchor', () => {
    const anchor = resolveFileBrowserFABAnchorFromPosition(
      {
        left: 262,
        top: 120,
      },
      {
        width: 320,
        height: 240,
      },
    );

    expect(anchor.edge).toBe('right');
    expect(anchor.offsetRatio).toBeCloseTo(108 / 172, 6);
  });

  it('reprojects the same anchor against a resized container without drifting away from the snapped edge', () => {
    const anchor: FileBrowserFABAnchorState = {
      edge: 'bottom',
      offsetRatio: 0.5,
    };

    const before = projectFileBrowserFABAnchor(anchor, {
      width: 320,
      height: 240,
    });
    const after = projectFileBrowserFABAnchor(anchor, {
      width: 480,
      height: 320,
    });

    expect(before.top).toBe(184);
    expect(after.top).toBe(264);
    expect(after.left).toBe(218);
  });

  it('preserves a dragged left-edge snap after the container resizes', () => {
    const anchor = resolveFileBrowserFABAnchorFromPosition(
      {
        left: 10,
        top: 98,
      },
      {
        width: 320,
        height: 240,
      },
    );

    const resized = projectFileBrowserFABAnchor(anchor, {
      width: 480,
      height: 320,
    });

    expect(anchor.edge).toBe('left');
    expect(resized.left).toBe(12);
    expect(resized.top).toBe(138);
  });
});
