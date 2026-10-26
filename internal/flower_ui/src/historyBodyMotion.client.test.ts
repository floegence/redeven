import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { observeHistoryBodyMotion } from './historyBodyMotion';
import type { FlowerScrollTailController } from './flowerScrollTail';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(reduced = false) {
  let now = 0;
  let shellHeight = 80;
  let bodyHeight = 2000;
  let resized = () => {};
  const disconnect = vi.fn();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const shell = document.createElement('div');
  const content = document.createElement('div');
  shell.getBoundingClientRect = () => ({ height: shellHeight }) as DOMRect;
  shell.checkVisibility = () => true;
  content.getBoundingClientRect = () => ({ height: bodyHeight }) as DOMRect;
  const animations: { finish: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    let finish!: () => void;
    let reject!: () => void;
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
    const cancel = vi.fn(() => reject());
    animations.push({ finish, cancel });
    return { finished, cancel } as unknown as Animation;
  });
  shell.animate = animate;
  const flushLayout = vi.fn();
  const [loading, setLoading] = createSignal(true);
  let dispose!: () => void;
  createRoot(stop => { dispose = stop; observeHistoryBodyMotion(shell, content, loading, { flushLayout } as unknown as FlowerScrollTailController, () => reduced); });
  return { animate, animations, flushLayout, disconnect, setLoading, dispose, resize(at: number, shell: number, body: number) {
    now = at; shellHeight = shell; bodyHeight = body; resized();
  } };
}

it('retargets first body chunks within one bounded deadline and retains the settled layout', async () => {
  const f = fixture();
  try {
    f.setLoading(false); await Promise.resolve();
    expect(f.animate.mock.calls[0][1]).toEqual({ duration: 320, easing: 'linear' });
    f.resize(120, 800, 3000);
    expect(f.animate.mock.calls[1]).toEqual([
      [{ height: '800px', overflow: 'hidden' }, { height: '3000px', overflow: 'hidden' }], { duration: 200, easing: 'linear' },
    ]);
    expect(f.animations[0].cancel).toHaveBeenCalledOnce();
    f.animations[0].finish(); await Promise.resolve();
    expect(f.disconnect).not.toHaveBeenCalled();
    f.animations[1].finish(); await Promise.resolve();
    expect(f.disconnect).toHaveBeenCalledOnce();
    expect(f.flushLayout).toHaveBeenLastCalledWith(false);
    f.setLoading(false); await Promise.resolve();
    expect(f.animate).toHaveBeenCalledTimes(2);
  } finally { f.dispose(); }
});

it('honors reduced motion and cancels a disposed pending hydration', async () => {
  const reduced = fixture(true);
  reduced.setLoading(false); await Promise.resolve();
  expect(reduced.animate).not.toHaveBeenCalled();
  expect(reduced.flushLayout).toHaveBeenCalledWith(false);
  reduced.dispose();
  const pending = fixture();
  pending.setLoading(false); pending.dispose(); await Promise.resolve();
  expect(pending.animate).not.toHaveBeenCalled();
});

it('disconnects body observation and cancels active motion on disposal', async () => {
  const f = fixture();
  f.setLoading(false); await Promise.resolve();
  f.dispose();
  expect(f.disconnect).toHaveBeenCalledOnce();
  expect(f.animations[0].cancel).toHaveBeenCalledOnce();
});
