import '../../index.css';
import './plugin-creation-workspace.css';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { PluginCreationCanvasBackground } from './PluginCreationCanvasBackground';

let dispose: (() => void) | undefined;
const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' }) => Promise<void>;
};
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' });
});
function mount() {
  const [active, setActive] = createSignal(true);
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;isolation:isolate;height:400px;width:600px;max-width:100%';
  document.body.append(host);
  dispose = render(() => <>
    <PluginCreationCanvasBackground active={active()} />
    <textarea aria-label="Message" />
  </>, host);
  const background = host.querySelector<HTMLElement>('.plugin-creation-atmosphere')!;
  const move = (x = 100, y = 100, pointerType = 'mouse', buttons = 0) => {
    const bounds = background.getBoundingClientRect();
    host.dispatchEvent(new PointerEvent('pointermove', { clientX: bounds.left + x, clientY: bounds.top + y, pointerType, buttons }));
  };
  return { host, background, move, setActive };
}
it('moves light across a registered fine lattice without drifting the grid', () => {
  const { background, setActive } = mount();
  const grid = background.querySelector('.plugin-creation-atmosphere-grid')!;
  const sheen = background.querySelector('.plugin-creation-atmosphere-sheen')!;
  const pointer = background.querySelector('.plugin-creation-atmosphere-pointer')!;
  const [light] = sheen.getAnimations();
  light.pause();
  light.currentTime = 0;
  const initialMask = getComputedStyle(sheen).maskPosition;
  const initialGrid = getComputedStyle(grid).backgroundPosition;
  light.currentTime = 12000;
  expect(getComputedStyle(sheen).maskPosition).not.toBe(initialMask);
  expect(getComputedStyle(grid).backgroundPosition).toBe(initialGrid);
  expect(getComputedStyle(grid).transform).toBe('none');
  expect(getComputedStyle(grid).backgroundImage).toContain('linear-gradient');
  expect(getComputedStyle(grid).backgroundImage).not.toContain('radial-gradient');
  expect(getComputedStyle(pointer, '::after').backgroundSize).toBe(getComputedStyle(sheen).backgroundSize);
  light.play();
  setActive(false);
  expect(getComputedStyle(sheen).animationPlayState).toBe('paused');
});
it('smoothly follows a mouse and settles without changing composer focus or selection', async () => {
  const { host, background, move } = mount();
  const input = host.querySelector('textarea')!;
  await page.getByRole('textbox', { name: 'Message' }).fill('Keep this idea');
  input.setSelectionRange(5, 9);
  move();
  await expect.poll(() => background.dataset.pointerActive).toBe('true');
  expect(background.style.getPropertyValue('--canvas-pointer-x')).toBe('100.00px');
  const raf = vi.spyOn(window, 'requestAnimationFrame');
  move(400, 250);
  await expect.poll(() => parseFloat(background.style.getPropertyValue('--canvas-pointer-x'))).toBeGreaterThan(399.9);
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const calls = raf.mock.calls.length;
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(raf.mock.calls).toHaveLength(calls);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('Keep this idea');
  expect([input.selectionStart, input.selectionEnd]).toEqual([5, 9]);
  expect(getComputedStyle(background).pointerEvents).toBe('none');
  expect(background.getAttribute('aria-hidden')).toBe('true');
  host.dispatchEvent(new PointerEvent('pointerleave'));
  expect(background.dataset.pointerActive).toBe('false');
});
it('ignores touch, pen and text-selection drags', async () => {
  const { background, move } = mount();
  for (const pointerType of ['touch', 'pen']) move(80, 90, pointerType);
  move(80, 90, 'mouse', 1);
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  expect(background.dataset.pointerActive).toBe('false');
  expect(background.style.getPropertyValue('--canvas-pointer-x')).toBe('');
});
it('cancels tracking and pauses every ambient layer when hidden or inactive', async () => {
  const { background, move, setActive } = mount();
  move();
  await expect.poll(() => background.dataset.pointerActive).toBe('true');
  setActive(false);
  expect(background.dataset.pointerActive).toBe('false');
  for (const layer of background.children) expect(getComputedStyle(layer).animationPlayState).toBe('paused');
  move(300, 200);
  expect(background.dataset.pointerActive).toBe('false');
  setActive(true);
  move();
  await expect.poll(() => background.dataset.pointerActive).toBe('true');
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(background.dataset.active).toBe('false');
  expect(background.dataset.pointerActive).toBe('false');
});
it('pauses offscreen and resumes when the same canvas returns', async () => {
  const { host, background } = mount();
  host.style.transform = 'translateY(10000px)';
  await expect.poll(() => background.dataset.active).toBe('false');
  host.style.transform = '';
  await expect.poll(() => background.dataset.active).toBe('true');
});
it('honors live reduced-motion and forced-color changes', async () => {
  const { background, move } = mount();
  move();
  await expect.poll(() => background.dataset.pointerActive).toBe('true');
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  await expect.poll(() => background.dataset.pointerActive).toBe('false');
  move();
  for (const layer of background.children) expect(getComputedStyle(layer).animationName).toBe('none');
  expect(getComputedStyle(background.querySelector('.plugin-creation-atmosphere-pointer')!).display).toBe('none');
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'active' });
  move();
  expect(getComputedStyle(background).display).toBe('none');
  expect(background.dataset.pointerActive).toBe('false');
});
it('clears hover on scroll or blur and releases its listener and pending frame on disposal', async () => {
  const { host, background, move } = mount();
  move();
  await expect.poll(() => background.dataset.pointerActive).toBe('true');
  host.querySelector('textarea')!.dispatchEvent(new Event('scroll'));
  expect(background.dataset.pointerActive).toBe('false');
  move();
  await expect.poll(() => background.dataset.pointerActive).toBe('true');
  window.dispatchEvent(new Event('blur'));
  expect(background.dataset.pointerActive).toBe('false');
  move(300, 200);
  const cancel = vi.spyOn(window, 'cancelAnimationFrame');
  dispose?.();
  expect(cancel).toHaveBeenCalledWith(expect.any(Number));
  const raf = vi.spyOn(window, 'requestAnimationFrame');
  move();
  expect(raf).not.toHaveBeenCalled();
});
