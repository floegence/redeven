import '../../index.css';
import './plugin-creation-workspace.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { I18nProvider } from '../i18n';
import { PluginCanvasComment } from './PluginCanvasComment';

let dispose: (() => void) | undefined;
const media = commands as unknown as { emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
afterEach(async () => { dispose?.(); document.body.replaceChildren(); await media.emulateMediaPreferences({ reducedMotion: 'no-preference' }); });
function mount(initialOpen = true) {
  const [text, setText] = createSignal('');
  const [stale, setStale] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [open, setOpen] = createSignal(initialOpen);
  const [anchor, setAnchor] = createSignal<{ x: number; y: number }>({ x: 24, y: 480 });
  const [selectionKey, setSelectionKey] = createSignal('first');
  const submit = vi.fn();
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:100%;height:600px';
  document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginCanvasComment open={open()} text={text()}
    target="button · Save" selectionKey={selectionKey()} anchor={anchor} stale={stale()} busy={busy()} sending={false} onText={setText}
    onClose={() => setOpen(false)} onSubmit={submit} /></I18nProvider></FloeConfigProvider>, host);
  return { text, setStale, setBusy, setOpen, setAnchor, setSelectionKey, submit };
}
it('does not paint before positioning and keeps busy feedback out of the editor layout', async () => {
  await page.viewport(1280, 720);
  const state = mount(false);
  state.setOpen(true);
  const panel = document.querySelector<HTMLElement>('.plugin-canvas-comment')!;
  const first = getComputedStyle(panel);
  expect(first.visibility === 'hidden' || Number(first.opacity) === 0 || Boolean(panel.style.left && panel.style.top)).toBe(true);
  await expect.element(page.getByRole('textbox')).toHaveFocus();
  await expect.poll(() => Number(getComputedStyle(panel).opacity)).toBe(1);
  const height = panel.offsetHeight;
  state.setBusy(true);
  expect(panel.offsetHeight).toBe(height);
  expect(panel.textContent).not.toContain('You can keep writing');
});
it('preserves comment text across close and stale selection, requiring a fresh target before sending', async () => {
  const state = mount();
  await expect.element(page.getByRole('textbox')).toHaveFocus();
  await page.getByRole('textbox').fill('Use a smaller label');
  state.setStale(true);
  await expect.element(page.getByRole('button', { name: 'Ask Flower to change' })).toBeDisabled();
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  state.setOpen(true);
  await expect.element(page.getByRole('textbox')).toHaveValue('Use a smaller label');
  state.setStale(false);
  await expect.element(page.getByRole('button', { name: 'Ask Flower to change' })).toBeEnabled();
  await page.getByRole('textbox').click();
  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  expect(state.submit).toHaveBeenCalledTimes(1);
  expect(state.text()).toBe('Use a smaller label');
});
it.each([320, 1280])('keeps comment editing and actions inside a %ipx canvas', async width => {
  await page.viewport(width, 720);
  const state = mount();
  await page.getByRole('textbox').fill('Make this clearer');
  state.setBusy(true);
  await expect.element(page.getByRole('button', { name: 'Ask Flower to change' })).toBeDisabled();
  const panel = document.querySelector<HTMLElement>('.plugin-canvas-comment')!;
  await expect.poll(() => getComputedStyle(panel).transform).toBe('matrix(1, 0, 0, 1, 0, 0)');
  expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  if (width < 720) {
    for (const button of panel.querySelectorAll('button')) {
      expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  }
});
it.each(['no-preference', 'reduce'] as const)('reveals and reopens only at the resolved anchor with %s motion', async reducedMotion => {
  await media.emulateMediaPreferences({ reducedMotion });
  await page.viewport(1280, 720);
  const state = mount(false);
  for (const anchor of [{ x: 1050, y: 440 }, { x: 100, y: 80 }]) {
    state.setAnchor(anchor);
    state.setSelectionKey(String(anchor.x));
    const samples: Array<{ x: number; y: number; opacity: number }> = [];
    let frame = 0;
    const observe = () => {
      const panel = document.querySelector<HTMLElement>('.plugin-canvas-comment');
      if (panel) samples.push({ x: panel.offsetLeft, y: panel.offsetTop, opacity: Number(getComputedStyle(panel).opacity) });
      frame = requestAnimationFrame(observe);
    };
    frame = requestAnimationFrame(observe);
    state.setOpen(true);
    try {
      await expect.element(page.getByRole('textbox')).toHaveFocus();
      await expect.poll(() => Number(getComputedStyle(document.querySelector('.plugin-canvas-comment')!).opacity)).toBe(1);
      const panel = document.querySelector<HTMLElement>('.plugin-canvas-comment')!;
      const visible = samples.filter(sample => sample.opacity > 0);
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every(sample => sample.x === panel.offsetLeft && sample.y === panel.offsetTop)).toBe(true);
      if (reducedMotion === 'no-preference') expect(samples.some(sample => sample.opacity > 0 && sample.opacity < 1)).toBe(true);
      else expect(getComputedStyle(panel).transitionDuration).toBe('0.001s');
      const position = [panel.offsetLeft, panel.offsetTop];
      state.setStale(true);
      await new Promise(requestAnimationFrame);
      expect(panel.offsetLeft).toBe(position[0]);
      await page.getByRole('button', { name: 'Close comment', exact: true }).click();
      expect(panel.inert).toBe(true);
      await expect.poll(() => panel.isConnected).toBe(false);
      state.setStale(false);
    } finally { cancelAnimationFrame(frame); }
  }
});
it('keeps the comment open when Escape belongs to an active input composition', async () => {
  const state = mount();
  await page.getByRole('textbox').fill('调整按钮间距');
  document.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(state.text()).toBe('调整按钮间距');
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
});

it('retargets during exit without flashing or losing input and restores focus', async () => {
  await page.viewport(1280, 720);
  const trigger = document.createElement('button'); trigger.textContent = 'Canvas action'; document.body.append(trigger); trigger.focus();
  const state = mount(false); state.setOpen(true);
  await expect.element(page.getByRole('textbox')).toHaveFocus();
  await page.getByRole('textbox').fill('Keep this edit');
  await expect.poll(() => Number(getComputedStyle(document.querySelector('.plugin-canvas-comment')!).opacity)).toBe(1);
  state.setOpen(false);
  state.setAnchor({ x: 1020, y: 120 }); state.setSelectionKey('retarget'); state.setOpen(true);
  await expect.element(page.getByRole('textbox')).toHaveFocus();
  await expect.element(page.getByRole('textbox')).toHaveValue('Keep this edit');
  expect(document.querySelectorAll('.plugin-canvas-comment')).toHaveLength(1);
  const panel = document.querySelector<HTMLElement>('.plugin-canvas-comment')!;
  expect(panel.offsetLeft).toBeGreaterThan(600);
  await page.getByRole('button', { name: 'Close comment', exact: true }).click();
  await expect.poll(() => document.activeElement).toBe(trigger);
});
