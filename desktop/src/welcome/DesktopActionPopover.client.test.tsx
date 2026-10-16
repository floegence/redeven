import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopActionPopover } from './DesktopActionPopover';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 35));
function mount() {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 150, y: 300, top: 300, bottom: 330, left: 150, right: 350, width: 200, height: 30, toJSON() {} });
  const [open, setOpen] = createSignal(true), [nested, setNested] = createSignal(false);
  const exit = vi.fn();
  dispose = render(() => <>
    <DesktopActionPopover open={open()} onOpenChange={setOpen} onExitComplete={exit} content={<><input aria-label="Draft" /><button onClick={() => setNested(true)}>Child</button></>}><button>Anchor</button></DesktopActionPopover>
    <Dialog open={nested()} onOpenChange={setNested} title="Child dialog"><input aria-label="Nested draft" /></Dialog>
    <button data-outside>Outside</button>
  </>, document.body);
  return { open, setOpen, setNested, exit };
}
it('keeps the live draft through exit reversal and disables exiting content immediately', async () => {
  const h = mount(); await settle();
  const surface = document.querySelector<HTMLElement>('.redeven-action-popover-surface')!;
  const input = surface.querySelector('input')!; input.value = 'retained'; input.focus(); input.setSelectionRange(1, 4);
  h.setOpen(false); await Promise.resolve();
  expect(surface.inert).toBe(true); expect(surface.getAttribute('aria-hidden')).toBe('true');
  h.setOpen(true); await settle();
  expect(document.querySelector('.redeven-action-popover-surface')).toBe(surface);
  expect(surface.querySelector('input')).toBe(input); expect(input.value).toBe('retained');
  expect(h.exit).not.toHaveBeenCalled();
  h.setOpen(false); await new Promise(resolve => setTimeout(resolve, 300));
  expect(document.querySelector('.redeven-action-popover-surface')).toBeNull(); expect(h.exit).toHaveBeenCalledOnce();
});
it('routes nested dialog focus and Escape only to its owning layer', async () => {
  const h = mount(); await settle(); h.setNested(true); await settle();
  const nested = document.querySelector<HTMLInputElement>('[aria-label="Nested draft"]')!;
  nested.focus(); nested.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  expect(h.open()).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 300));
  expect(h.open()).toBe(true);
  document.querySelector('[data-outside]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); await settle();
  expect(h.open()).toBe(false);
});
