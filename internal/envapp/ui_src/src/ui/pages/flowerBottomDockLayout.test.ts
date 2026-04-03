import { describe, expect, it } from 'vitest';

import {
  FLOWER_BOTTOM_DOCK_CLEARANCE_PX,
  FLOWER_TRANSCRIPT_OVERLAY_INSET_CSS_VAR,
  createFlowerBottomDockLayoutController,
  resolveFlowerBottomDockLayoutMetrics,
} from './flowerBottomDockLayout';

type ResizeObserverRecord = {
  callback: ResizeObserverCallback;
  targets: Set<Element>;
};

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

function createMockElement(initialHeight = 0): {
  element: HTMLElement;
  setHeight: (height: number) => void;
} {
  let height = initialHeight;
  const styleValues = new Map<string, string>();
  const style = {
    setProperty(name: string, value: string) {
      styleValues.set(name, value);
    },
    removeProperty(name: string) {
      styleValues.delete(name);
    },
    getPropertyValue(name: string) {
      return styleValues.get(name) ?? '';
    },
  } as CSSStyleDeclaration;

  return {
    element: {
      style,
      getBoundingClientRect: () => ({
        width: 640,
        height,
        top: 0,
        right: 640,
        bottom: height,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    } as unknown as HTMLElement,
    setHeight(nextHeight: number) {
      height = nextHeight;
    },
  };
}

describe('flowerBottomDockLayout', () => {
  it('rounds dock height and appends the shared clearance', () => {
    expect(resolveFlowerBottomDockLayoutMetrics({
      dockHeightPx: 132.2,
      clearancePx: 15,
    })).toEqual({
      dockHeightPx: 133,
      clearancePx: 15,
      transcriptOverlayInsetPx: 148,
    });
  });

  it('falls back to zero inset until a measurable dock height exists', () => {
    expect(resolveFlowerBottomDockLayoutMetrics({
      dockHeightPx: 0,
      clearancePx: FLOWER_BOTTOM_DOCK_CLEARANCE_PX,
    })).toEqual({
      dockHeightPx: 0,
      clearancePx: FLOWER_BOTTOM_DOCK_CLEARANCE_PX,
      transcriptOverlayInsetPx: 0,
    });
  });

  it('writes the transcript overlay inset when the observed dock height changes', () => {
    const resizeObserverHarness = createResizeObserverHarness();
    const controller = createFlowerBottomDockLayoutController({
      createResizeObserver: resizeObserverHarness.create,
    });
    const transcript = createMockElement();
    const dock = createMockElement(136.4);

    controller.setTranscriptElement(transcript.element);
    controller.setDockElement(dock.element);
    resizeObserverHarness.notify(dock.element);

    expect(controller.metrics()).toEqual({
      dockHeightPx: 137,
      clearancePx: FLOWER_BOTTOM_DOCK_CLEARANCE_PX,
      transcriptOverlayInsetPx: 149,
    });
    expect(transcript.element.style.getPropertyValue(FLOWER_TRANSCRIPT_OVERLAY_INSET_CSS_VAR)).toBe('149px');
  });

  it('syncs immediately when the transcript element is attached after the dock', () => {
    const resizeObserverHarness = createResizeObserverHarness();
    const controller = createFlowerBottomDockLayoutController({
      createResizeObserver: resizeObserverHarness.create,
    });
    const transcript = createMockElement();
    const dock = createMockElement(120);

    controller.setDockElement(dock.element);
    controller.setTranscriptElement(transcript.element);

    expect(transcript.element.style.getPropertyValue(FLOWER_TRANSCRIPT_OVERLAY_INSET_CSS_VAR)).toBe('132px');
  });

  it('removes the inline transcript inset on dispose', () => {
    const resizeObserverHarness = createResizeObserverHarness();
    const controller = createFlowerBottomDockLayoutController({
      createResizeObserver: resizeObserverHarness.create,
    });
    const transcript = createMockElement();
    const dock = createMockElement(118);

    controller.setTranscriptElement(transcript.element);
    controller.setDockElement(dock.element);
    expect(transcript.element.style.getPropertyValue(FLOWER_TRANSCRIPT_OVERLAY_INSET_CSS_VAR)).toBe('130px');

    controller.dispose();

    expect(transcript.element.style.getPropertyValue(FLOWER_TRANSCRIPT_OVERLAY_INSET_CSS_VAR)).toBe('');
  });
});
