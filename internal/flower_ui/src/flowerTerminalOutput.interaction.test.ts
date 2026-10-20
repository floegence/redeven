// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createTerminalOutputViewportController } from './flowerTerminalOutput';

function fixture() {
  const root = document.createElement('div');
  const viewport = document.createElement('div');
  const pre = document.createElement('pre'); viewport.append(pre);
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  let geometryReads = 0;
  Object.defineProperty(viewport, 'scrollHeight', { get: () => { geometryReads++; return 400; } });
  Object.defineProperty(viewport, 'clientHeight', { get: () => { geometryReads++; return 100; } });
  const controller = createTerminalOutputViewportController({ interaction: { root, attribute: 'data-hot' },
    requestAnimationFrame: callback => { callbacks.set(++id, callback); return id; },
    cancelAnimationFrame: key => { callbacks.delete(key); },
  });
  controller.bind(viewport); controller.bindOutput(pre);
  const frame = () => { const work = [...callbacks.values()]; callbacks.clear(); work.forEach(callback => callback(0)); };
  controller.setOutput('Initial output'); frame();
  return { root, viewport, pre, controller, frame, callbacks, geometryReads: () => geometryReads };
}

describe('terminal output interaction presentation', () => {
  it.each(['drag', 'resize'])('retains every output update without DOM or geometry work during %s', async kind => {
    const f = fixture();
    try {
      const node = f.pre.firstChild;
      const reads = f.geometryReads();
      f.root.setAttribute('data-hot', kind);
      for (let index = 1; index <= 300; index++) f.controller.setOutput(`Initial output${'x'.repeat(index)}`);
      f.frame();
      expect(f.pre.textContent).toBe('Initial output');
      expect(f.geometryReads()).toBe(reads);
      expect(f.callbacks.size).toBe(0);
      f.root.removeAttribute('data-hot'); await Promise.resolve();
      expect(f.callbacks.size).toBe(1); f.frame();
      expect(f.pre.textContent).toBe(`Initial output${'x'.repeat(300)}`);
      expect(f.pre.firstChild).toBe(node);
      expect(f.viewport.scrollTop).toBe(300);
    } finally { f.controller.dispose(); }
  });

  it('cancels an already requested paint when dragging starts and flushes terminal or error output', async () => {
    const f = fixture();
    try {
      f.controller.setOutput('Initial output, pending');
      f.root.setAttribute('data-hot', 'drag'); await Promise.resolve();
      expect(f.callbacks.size).toBe(0);
      f.controller.setOutput('Final output', true); f.frame();
      expect(f.pre.textContent).toBe('Final output');
      f.controller.setOutput('Error detail', true); f.frame();
      expect(f.pre.textContent).toBe('Error detail');
      f.root.removeAttribute('data-hot'); await Promise.resolve(); f.frame();
      expect(f.pre.textContent).toBe('Error detail');
    } finally { f.controller.dispose(); }
  });

  it('does not follow output after the user scrolls up, and cancels all deferred work on disposal', async () => {
    const f = fixture();
    f.controller.onWheel({ deltaY: -10 }); f.viewport.scrollTop = 40;
    f.root.setAttribute('data-hot', 'drag');
    f.controller.setOutput('Deferred output');
    f.root.removeAttribute('data-hot'); await Promise.resolve(); f.frame();
    expect(f.viewport.scrollTop).toBe(40);
    f.root.setAttribute('data-hot', 'resize');
    f.controller.setOutput('Never paint disposed output');
    f.controller.dispose();
    f.root.removeAttribute('data-hot'); await Promise.resolve(); f.frame();
    expect(f.pre.textContent).toBe('Deferred output');
    expect(f.callbacks.size).toBe(0);
  });
});
