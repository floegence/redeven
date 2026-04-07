// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  NOTES_OVERLAY_VIEWPORT_ATTR,
  NOTES_OVERLAY_VIEWPORT_ATTR_VALUE,
  NOTES_OVERLAY_VIEWPORT_CSS_VARS,
  createNotesOverlayViewportController,
  resolveNotesOverlayViewportRect,
} from './notesOverlayViewport';

type ResizeObserverRecord = Readonly<{
  callback: ResizeObserverCallback;
  targets: Set<Element>;
}>;

function createResizeObserverHarness() {
  const records: ResizeObserverRecord[] = [];

  return {
    create(callback: ResizeObserverCallback) {
      const record: ResizeObserverRecord = {
        callback,
        targets: new Set<Element>(),
      };
      records.push(record);
      return {
        observe(target: Element) {
          record.targets.add(target);
        },
        disconnect() {
          record.targets.clear();
        },
        unobserve(target: Element) {
          record.targets.delete(target);
        },
      };
    },
    notify(target: Element) {
      for (const record of records) {
        if (!record.targets.has(target)) continue;
        record.callback([
          {
            target,
            contentRect: target.getBoundingClientRect(),
          } as ResizeObserverEntry,
        ], {} as ResizeObserver);
      }
    },
  };
}

function createMockHostRect(initialRect: Readonly<{
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}>): {
  element: HTMLElement;
  setRect: (nextRect: Readonly<{
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  }>) => void;
} {
  let rect = initialRect;
  const element = document.createElement('div');
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  });

  return {
    element,
    setRect(nextRect) {
      rect = nextRect;
    },
  };
}

afterEach(() => {
  document.body.removeAttribute(NOTES_OVERLAY_VIEWPORT_ATTR);
  for (const cssVarName of Object.values(NOTES_OVERLAY_VIEWPORT_CSS_VARS)) {
    document.body.style.removeProperty(cssVarName);
  }
  document.body.innerHTML = '';
});

describe('notesOverlayViewport', () => {
  it('normalizes the measured shell host rect into viewport insets and dimensions', () => {
    expect(resolveNotesOverlayViewportRect({
      hostRect: {
        top: 39.6,
        left: 63.7,
        right: 1215.4,
        bottom: 769.6,
        width: 1151.7,
        height: 730.1,
      },
      viewportWidth: 1280,
      viewportHeight: 800,
    })).toEqual({
      top: 40,
      left: 64,
      right: 65,
      bottom: 30,
      width: 1151,
      height: 730,
    });
  });

  it('clamps overflow so the contract never writes negative insets or sizes', () => {
    expect(resolveNotesOverlayViewportRect({
      hostRect: {
        top: -24,
        left: -12,
        right: 1448,
        bottom: 900,
      },
      viewportWidth: 1280,
      viewportHeight: 800,
    })).toEqual({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 1280,
      height: 800,
    });
  });

  it('writes and updates the body contract while the overlay is active', () => {
    const resizeObserverHarness = createResizeObserverHarness();
    const host = createMockHostRect({
      top: 40,
      left: 64,
      right: 1216,
      bottom: 768,
      width: 1152,
      height: 728,
    });
    const controller = createNotesOverlayViewportController({
      target: document.body,
      createResizeObserver: resizeObserverHarness.create,
      getViewportSize: () => ({ width: 1280, height: 800 }),
    });

    controller.setViewportHostElement(host.element);
    controller.setActive(true);

    expect(document.body.getAttribute(NOTES_OVERLAY_VIEWPORT_ATTR)).toBe(NOTES_OVERLAY_VIEWPORT_ATTR_VALUE);
    expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.top)).toBe('40px');
    expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.left)).toBe('64px');
    expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.right)).toBe('64px');
    expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.bottom)).toBe('32px');
    expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.width)).toBe('1152px');
    expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.height)).toBe('728px');

    host.setRect({
      top: 40,
      left: 88,
      right: 1180,
      bottom: 756,
      width: 1092,
      height: 716,
    });
    resizeObserverHarness.notify(host.element);

    expect(controller.rect()).toEqual({
      top: 40,
      left: 88,
      right: 100,
      bottom: 44,
      width: 1092,
      height: 716,
    });
    expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.left)).toBe('88px');
    expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.width)).toBe('1092px');
  });

  it('clears the body contract when the overlay deactivates or is disposed', () => {
    const controller = createNotesOverlayViewportController({
      target: document.body,
      getViewportSize: () => ({ width: 1280, height: 800 }),
    });
    const host = createMockHostRect({
      top: 40,
      left: 64,
      right: 1216,
      bottom: 768,
      width: 1152,
      height: 728,
    });

    controller.setViewportHostElement(host.element);
    controller.setActive(true);
    expect(document.body.getAttribute(NOTES_OVERLAY_VIEWPORT_ATTR)).toBe(NOTES_OVERLAY_VIEWPORT_ATTR_VALUE);

    controller.setActive(false);
    expect(document.body.getAttribute(NOTES_OVERLAY_VIEWPORT_ATTR)).toBeNull();
    expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.width)).toBe('');

    controller.setActive(true);
    expect(document.body.getAttribute(NOTES_OVERLAY_VIEWPORT_ATTR)).toBe(NOTES_OVERLAY_VIEWPORT_ATTR_VALUE);

    controller.dispose();
    expect(document.body.getAttribute(NOTES_OVERLAY_VIEWPORT_ATTR)).toBeNull();
    expect(document.body.style.getPropertyValue(NOTES_OVERLAY_VIEWPORT_CSS_VARS.height)).toBe('');
  });
});
