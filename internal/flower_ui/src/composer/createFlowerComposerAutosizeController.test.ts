// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { createFlowerComposerAutosizeController } from './createFlowerComposerAutosizeController';

const createHarness = () => {
  const textarea = document.createElement('textarea');
  textarea.style.boxSizing = 'border-box';
  textarea.style.fontSize = '16px';
  textarea.style.lineHeight = '20px';
  textarea.style.padding = '4px 0';
  textarea.style.border = '1px solid transparent';
  document.body.append(textarea);
  let scrollHeight = 28;
  Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  const frames = new Map<number, FrameRequestCallback>();
  let frameID = 0;
  const controller = createFlowerComposerAutosizeController(textarea, {
    requestFrame: (callback) => {
      frameID += 1;
      frames.set(frameID, callback);
      return frameID;
    },
    cancelFrame: (handle) => frames.delete(handle),
    resizeObserver: undefined,
  });
  const flush = () => {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [id, callback] of pending) callback(id);
  };
  return {
    textarea,
    controller,
    flush,
    setScrollHeight: (height: number) => { scrollHeight = height; },
    pendingFrames: () => frames.size,
  };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('createFlowerComposerAutosizeController', () => {
  it('uses scrollHeight for explicit and soft-wrapped lines and caps at five visual lines', () => {
    const harness = createHarness();
    harness.flush();
    expect(harness.textarea.style.height).toBe('30px');
    expect(harness.textarea.style.overflowY).toBe('hidden');

    harness.textarea.value = 'one line of text that wraps because the composer became narrow';
    harness.setScrollHeight(68);
    harness.controller.schedule();
    harness.flush();
    expect(harness.textarea.style.height).toBe('70px');
    expect(harness.textarea.style.overflowY).toBe('hidden');

    harness.textarea.value = '1\n2\n3\n4\n5\n6';
    harness.setScrollHeight(128);
    harness.controller.schedule();
    harness.flush();
    expect(harness.textarea.style.height).toBe('110px');
    expect(harness.textarea.style.overflowY).toBe('auto');
    expect(harness.textarea.dataset.flowerComposerScrollable).toBe('true');
    harness.controller.dispose();
  });

  it('shrinks after content deletion or a width expansion', () => {
    const harness = createHarness();
    harness.setScrollHeight(108);
    harness.flush();
    expect(harness.textarea.style.height).toBe('110px');

    harness.setScrollHeight(28);
    harness.controller.schedule();
    harness.flush();
    expect(harness.textarea.style.height).toBe('30px');
    expect(harness.textarea.hasAttribute('data-flower-composer-scrollable')).toBe(false);
    harness.controller.dispose();
  });

  it('coalesces frames and clears sizing while a compact companion is collapsed', () => {
    const harness = createHarness();
    harness.controller.schedule();
    harness.controller.schedule();
    expect(harness.pendingFrames()).toBe(1);

    harness.controller.suspend();
    expect(harness.pendingFrames()).toBe(0);
    expect(harness.textarea.style.height).toBe('');
    expect(harness.textarea.style.overflowY).toBe('');

    harness.setScrollHeight(68);
    harness.controller.schedule();
    expect(harness.pendingFrames()).toBe(0);
    harness.controller.resume();
    expect(harness.pendingFrames()).toBe(1);
    harness.flush();
    expect(harness.textarea.style.height).toBe('70px');
    harness.controller.dispose();
  });

  it('cancels pending work and rejects later scheduling after dispose', () => {
    const harness = createHarness();
    expect(harness.pendingFrames()).toBe(1);
    harness.controller.dispose();
    expect(harness.pendingFrames()).toBe(0);
    expect(harness.textarea.style.height).toBe('');

    harness.controller.schedule();
    harness.controller.measure();
    expect(harness.pendingFrames()).toBe(0);
    expect(harness.textarea.style.height).toBe('');
  });
});
