import '../index.css';
import './flower-feature.css';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import type { FlowerSurfaceProps } from '../../../../flower_ui/src/FlowerSurface';
import { adapter, renderSurfaceWithAdapterProps, waitFor } from './FlowerSurface.navigation.testHarness';

const key = 'redeven.flower.threadRailWidth';
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
afterEach(() => { vi.restoreAllMocks(); localStorage.removeItem(key); });

it('coalesces dragging, avoids inherited width updates and saves the final pointer position once', async () => {
  await page.viewport(1280, 850);
  localStorage.setItem(key, '272');
  const host = renderSurfaceWithAdapterProps(adapter(), { layout: true });
  host.style.cssText = 'height:800px;width:100%';
  await waitFor(() => Boolean(host.querySelector('.flower-component-rail-resizer')));
  const root = host.querySelector<HTMLElement>('.flower-surface')!;
  const handle = host.querySelector<HTMLButtonElement>('.flower-component-rail-resizer')!;
  vi.spyOn(handle, 'setPointerCapture').mockImplementation(() => {});
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  const pointer = (target: EventTarget, type: string, x: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, isPrimary: true, button: 0, buttons: 1, clientX: x }));
  pointer(handle, 'pointerdown', 272);
  for (let x = 273; x <= 320; x++) pointer(window, 'pointermove', x);
  expect(handle.getAttribute('aria-valuenow')).toBe('272');
  expect(storage.mock.calls.filter(([name]) => name === key)).toHaveLength(0);
  await frame();
  expect(handle.getAttribute('aria-valuenow')).toBe('320');
  expect(root.style.getPropertyValue('--flower-thread-rail-width')).toBe('');
  expect(root.style.getPropertyValue('--flower-thread-drawer-width')).toBe('');
  expect(root.querySelector('.flower-component-thread-rail')!.getBoundingClientRect().width).toBe(320);
  pointer(window, 'pointerup', 333);
  expect(handle.getAttribute('aria-valuenow')).toBe('333');
  expect(storage.mock.calls.filter(([name]) => name === key)).toEqual([[key, '333']]);
  await frame();
  expect(handle.getAttribute('aria-valuenow')).toBe('333');
  expect(root.classList.contains('flower-component-shell-resizing')).toBe(false);
});

it('retains saved width across keyboard resizing and overlay layout transitions', async () => {
  await page.viewport(1280, 850);
  localStorage.setItem(key, '320');
  const host = renderSurfaceWithAdapterProps(adapter(), { layout: true });
  host.style.cssText = 'height:800px;width:100%';
  await waitFor(() => Boolean(host.querySelector('.flower-component-rail-resizer')));
  const root = host.querySelector<HTMLElement>('.flower-surface')!;
  const handle = host.querySelector<HTMLButtonElement>('.flower-component-rail-resizer')!;
  handle.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(handle.getAttribute('aria-valuenow')).toBe('336');
  expect(localStorage.getItem(key)).toBe('336');
  host.style.width = '640px';
  await waitFor(() => root.dataset.flowerSidebarPresentation === 'overlay');
  expect(root.style.gridTemplateColumns).toBe('');
  await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-chat-header .flower-mobile-navigation-button')!);
  await waitFor(() => Boolean(host.querySelector('.flower-desktop-thread-drawer')));
  const drawer = host.querySelector<HTMLElement>('.flower-desktop-thread-drawer')!;
  expect(drawer.getBoundingClientRect().width).toBe(336);
  await userEvent.keyboard('{Escape}');
  host.style.width = '1024px';
  await waitFor(() => root.dataset.flowerSidebarPresentation === 'inline');
  expect(root.querySelector('.flower-component-thread-rail')!.getBoundingClientRect().width).toBe(336);
});

it('releases inline sizing on companion transitions and restores the saved width', async () => {
  await page.viewport(1280, 850);
  localStorage.setItem(key, '320');
  const [presentation, setPresentation] = createSignal<'full' | 'companion'>('full');
  const host = renderSurfaceWithAdapterProps(adapter(), { layout: true, get presentation() { return presentation(); } });
  host.style.cssText = 'height:800px;width:100%';
  await waitFor(() => Boolean(host.querySelector('.flower-component-rail-resizer')));
  const root = host.querySelector<HTMLElement>('.flower-surface')!;
  expect(root.style.gridTemplateColumns).toContain('320px');
  setPresentation('companion');
  await frame();
  expect(root.style.gridTemplateColumns).toBe('');
  expect(root.querySelector('.flower-component-main')!.getBoundingClientRect().width).toBe(root.getBoundingClientRect().width);
  setPresentation('full');
  await frame();
  expect(root.querySelector('.flower-component-thread-rail')!.getBoundingClientRect().width).toBe(320);
});

it('ends a drag cleanly when the available width switches to overlay', async () => {
  await page.viewport(1280, 850);
  localStorage.setItem(key, '272');
  const host = renderSurfaceWithAdapterProps(adapter(), { layout: true });
  host.style.cssText = 'height:800px;width:800px';
  await waitFor(() => Boolean(host.querySelector('.flower-component-rail-resizer')));
  const handle = host.querySelector<HTMLButtonElement>('.flower-component-rail-resizer')!;
  vi.spyOn(handle, 'setPointerCapture').mockImplementation(() => {});
  handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, isPrimary: true, button: 0, clientX: 272 }));
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 350 }));
  await waitFor(() => host.querySelector<HTMLElement>('.flower-surface')?.dataset.flowerSidebarPresentation === 'overlay');
  expect(document.querySelector('.flower-thread-rail-drag-shield')).toBeNull();
  expect(localStorage.getItem(key)).toBe('350');
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 380 }));
  await frame();
  expect(handle.getAttribute('aria-valuenow')).toBe('350');
});

it.each(['embedded', 'inactive'] as const)('settles a drag when the surface becomes %s', async mode => {
  await page.viewport(1280, 850);
  localStorage.setItem(key, '272');
  const [changed, setChanged] = createSignal(false);
  const host = renderSurfaceWithAdapterProps(adapter(), {
    layout: true,
    get engaged() { return mode !== 'inactive' || !changed(); },
    get embeddedConversation(): FlowerSurfaceProps['embeddedConversation'] {
      return mode === 'embedded' && changed()
        ? { scope: 'resize-embedded', render: parts => parts.conversation }
        : undefined;
    },
  });
  host.style.cssText = 'height:800px;width:100%';
  await waitFor(() => Boolean(host.querySelector('.flower-component-rail-resizer')));
  const root = host.querySelector<HTMLElement>('.flower-surface')!;
  const handle = host.querySelector<HTMLButtonElement>('.flower-component-rail-resizer')!;
  vi.spyOn(handle, 'setPointerCapture').mockImplementation(() => {});
  handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, isPrimary: true, button: 0, clientX: 272 }));
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 315 }));
  setChanged(true);
  await frame();
  expect(document.querySelector('.flower-thread-rail-drag-shield')).toBeNull();
  expect(localStorage.getItem(key)).toBe('315');
  if (mode === 'embedded') expect(root.style.gridTemplateColumns).toBe('');
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 380 }));
  await frame();
  expect(handle.getAttribute('aria-valuenow')).toBe('315');
});
