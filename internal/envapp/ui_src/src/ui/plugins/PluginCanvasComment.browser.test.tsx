import '../../index.css';
import './plugin-creation-workspace.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { I18nProvider } from '../i18n';
import { PluginCanvasComment } from './PluginCanvasComment';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
function mount() {
  const [text, setText] = createSignal('');
  const [stale, setStale] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [open, setOpen] = createSignal(true);
  const submit = vi.fn();
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:100%;height:600px';
  document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginCanvasComment open={open()} text={text()}
    target="button · Save" stale={stale()} busy={busy()} sending={false} onText={setText}
    onClose={() => setOpen(false)} onSubmit={submit} /></I18nProvider></FloeConfigProvider>, host);
  return { text, setStale, setBusy, setOpen, submit };
}
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
it('keeps the comment open when Escape belongs to an active input composition', async () => {
  const state = mount();
  await page.getByRole('textbox').fill('调整按钮间距');
  document.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(state.text()).toBe('调整按钮间距');
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
});
