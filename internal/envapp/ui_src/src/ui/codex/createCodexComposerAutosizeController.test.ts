// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CodexPretextModule } from './pretextLoader';
import { createCodexComposerAutosizeController } from './createCodexComposerAutosizeController';

function flushAsync(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

function createResizeObserverHarness() {
  const records: Array<{
    callback: ResizeObserverCallback;
    observed: Element[];
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];

  return {
    create: (callback: ResizeObserverCallback) => {
      const record = {
        callback,
        observed: [] as Element[],
        disconnect: vi.fn(),
      };
      records.push(record);
      return {
        observe: (target: Element) => {
          record.observed.push(target);
        },
        disconnect: record.disconnect,
      };
    },
    trigger: (target: Element) => {
      for (const record of records) {
        if (!record.observed.includes(target)) continue;
        record.callback([
          {
            target,
            contentRect: target.getBoundingClientRect(),
            contentBoxSize: [{
              inlineSize: target.getBoundingClientRect().width,
              blockSize: target.getBoundingClientRect().height,
            }],
          } as unknown as ResizeObserverEntry,
        ], {} as ResizeObserver);
      }
    },
    records,
  };
}

function createTextarea(options?: {
  clientWidth?: number;
  scrollHeight?: number;
  fontFamily?: string;
  fontSizePx?: number;
  lineHeight?: string;
  minHeightPx?: number;
  maxHeightPx?: number;
}) {
  let clientWidth = options?.clientWidth ?? 320;
  let scrollHeight = options?.scrollHeight ?? 56;
  const textarea = document.createElement('textarea');
  textarea.style.fontFamily = options?.fontFamily ?? '"Segoe UI", Arial, sans-serif';
  textarea.style.fontSize = `${options?.fontSizePx ?? 13}px`;
  textarea.style.lineHeight = options?.lineHeight ?? '1.5';
  textarea.style.minHeight = `${options?.minHeightPx ?? 56}px`;
  textarea.style.maxHeight = `${options?.maxHeightPx ?? 320}px`;
  textarea.style.paddingTop = '0px';
  textarea.style.paddingBottom = '0px';
  textarea.style.paddingLeft = '0px';
  textarea.style.paddingRight = '0px';
  document.body.append(textarea);

  Object.defineProperty(textarea, 'clientWidth', {
    configurable: true,
    get: () => clientWidth,
  });
  Object.defineProperty(textarea, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(textarea, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: clientWidth,
      height: scrollHeight,
      top: 0,
      right: clientWidth,
      bottom: scrollHeight,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  return {
    textarea,
    setClientWidth: (value: number) => {
      clientWidth = value;
    },
    setScrollHeight: (value: number) => {
      scrollHeight = value;
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createCodexComposerAutosizeController', () => {
  it('uses pretext when the textarea typography is safe', async () => {
    const resizeHarness = createResizeObserverHarness();
    const { textarea } = createTextarea();
    const prepare = vi.fn(() => ({ prepared: true }));
    const layout = vi.fn(() => ({ height: 144, lineCount: 6 }));
    const controller = createCodexComposerAutosizeController({
      loadPretext: async () => ({ prepare, layout } as unknown as CodexPretextModule),
      createResizeObserver: resizeHarness.create,
      requestAnimationFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelAnimationFrame: () => undefined,
      fonts: null,
    });

    controller.setTextarea(textarea);
    controller.requestMeasure('Review the failing command output');
    await flushAsync();

    expect(prepare).toHaveBeenLastCalledWith(
      'Review the failing command output',
      expect.stringContaining('13px'),
      { whiteSpace: 'pre-wrap' },
    );
    expect(layout).toHaveBeenLastCalledWith(expect.anything(), 320, 19.5);
    expect(controller.snapshot()).toEqual({
      heightPx: 144,
      lineCount: 6,
      overflowY: 'hidden',
      source: 'pretext',
    });
    expect(controller.style()).toEqual({ height: '144px', overflowY: 'hidden' });
    expect(textarea.style.height).toBe('144px');

    controller.dispose();
  });

  it('falls back to DOM measurement when the font stack is unsafe for pretext', async () => {
    const resizeHarness = createResizeObserverHarness();
    const { textarea } = createTextarea({
      fontFamily: 'system-ui, sans-serif',
      scrollHeight: 420,
    });
    const prepare = vi.fn(() => ({ prepared: true }));
    const layout = vi.fn(() => ({ height: 200, lineCount: 4 }));
    const controller = createCodexComposerAutosizeController({
      loadPretext: async () => ({ prepare, layout } as unknown as CodexPretextModule),
      createResizeObserver: resizeHarness.create,
      requestAnimationFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelAnimationFrame: () => undefined,
      fonts: null,
    });

    controller.setTextarea(textarea);
    controller.requestMeasure('Unsafe font family fallback');
    await flushAsync();

    expect(prepare).not.toHaveBeenCalled();
    expect(controller.snapshot()).toEqual({
      heightPx: 320,
      lineCount: 16,
      overflowY: 'auto',
      source: 'dom-fallback',
    });
    expect(textarea.style.height).toBe('320px');
    expect(textarea.style.overflowY).toBe('auto');

    controller.dispose();
  });

  it('falls back to DOM measurement when pretext fails to load', async () => {
    const resizeHarness = createResizeObserverHarness();
    const { textarea } = createTextarea({
      scrollHeight: 188,
    });
    const controller = createCodexComposerAutosizeController({
      loadPretext: async () => {
        throw new Error('pretext unavailable');
      },
      createResizeObserver: resizeHarness.create,
      requestAnimationFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelAnimationFrame: () => undefined,
      fonts: null,
    });

    controller.setTextarea(textarea);
    controller.requestMeasure('Fallback after pretext load failure');
    await flushAsync();

    expect(controller.snapshot()).toEqual({
      heightPx: 188,
      lineCount: 10,
      overflowY: 'hidden',
      source: 'dom-fallback',
    });
    expect(controller.style()).toEqual({ height: '188px', overflowY: 'hidden' });
    expect(textarea.style.height).toBe('188px');

    controller.dispose();
  });

  it('remeasures when the observed textarea width changes', async () => {
    const resizeHarness = createResizeObserverHarness();
    const { textarea, setClientWidth } = createTextarea({ clientWidth: 320 });
    const controller = createCodexComposerAutosizeController({
      loadPretext: async () => ({
        prepare: vi.fn(() => ({ prepared: true })),
        layout: vi.fn((_: unknown, width: number) => (
          width >= 300
            ? { height: 120, lineCount: 5 }
            : { height: 240, lineCount: 10 }
        )),
      } as unknown as CodexPretextModule),
      createResizeObserver: resizeHarness.create,
      requestAnimationFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelAnimationFrame: () => undefined,
      fonts: null,
    });

    controller.setTextarea(textarea);
    controller.requestMeasure('Resize-aware codex composer');
    await flushAsync();
    expect(controller.snapshot().heightPx).toBe(120);

    setClientWidth(160);
    resizeHarness.trigger(textarea);
    await flushAsync();

    expect(controller.snapshot()).toEqual({
      heightPx: 240,
      lineCount: 10,
      overflowY: 'hidden',
      source: 'pretext',
    });

    controller.dispose();
  });

  it('disconnects observers and cancels pending frames on dispose', () => {
    const resizeHarness = createResizeObserverHarness();
    const { textarea } = createTextarea();
    const cancelAnimationFrame = vi.fn();
    const controller = createCodexComposerAutosizeController({
      loadPretext: () => new Promise(() => undefined),
      createResizeObserver: resizeHarness.create,
      requestAnimationFrame: () => 7,
      cancelAnimationFrame,
      fonts: null,
    });

    controller.setTextarea(textarea);
    controller.dispose();

    expect(resizeHarness.records).toHaveLength(1);
    expect(resizeHarness.records[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
  });
});
