// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it('coalesces resize measurements into a frame and cancels them on disposal', async () => {
  let resized: (() => void) | undefined;
  let frameID = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect = disconnect; });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameID, callback); return frameID; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const anchor = document.createElement('button');
  const host = document.createElement('div');
  document.body.append(anchor, host);
  const measured = vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 100, left: 100, top: 100, right: 140, bottom: 130, width: 40, height: 30, toJSON() {} });
  dispose = render(() => <DesktopAnchoredOverlaySurface open anchorRef={anchor} role="tooltip">Help</DesktopAnchoredOverlaySurface>, host);
  await Promise.resolve();
  frames.clear(); measured.mockClear();
  expect(resized).toBeTypeOf('function');
  resized?.(); resized?.(); resized?.();
  expect(measured).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0));
  expect(measured).toHaveBeenCalledTimes(1);
  dispose(); dispose = undefined;
  expect(disconnect).toHaveBeenCalled();
  expect(frames.size).toBe(0);
});
