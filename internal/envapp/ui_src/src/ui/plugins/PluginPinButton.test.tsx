// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { PluginPinButton } from './PluginPinButton';

const notifyError = vi.hoisted(() => vi.fn());
vi.mock('@floegence/floe-webapp-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core')>(),
  useNotification: () => ({ error: notifyError }),
}));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.clearAllMocks(); });

it('waits for the authoritative update, blocks duplicate toggles and prevents parent activation', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const activate = vi.fn();
  host.addEventListener('pointerdown', activate);
  host.addEventListener('click', activate);
  const [pinned, setPinned] = createSignal(false);
  let finish!: () => void;
  const onSetPinned = vi.fn(() => new Promise<void>((resolve) => { finish = () => { setPinned(true); resolve(); }; }));
  dispose = render(() => <PluginPinButton pluginName="Weather" pinned={pinned()} onSetPinned={onSetPinned} />, host);
  const button = host.querySelector('button')!;
  button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  button.click();
  button.click();
  expect(onSetPinned).toHaveBeenCalledTimes(1);
  expect(onSetPinned).toHaveBeenCalledWith(true);
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(activate).not.toHaveBeenCalled();
  finish();
  await Promise.resolve();
  expect(button.disabled).toBe(false);
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.getAttribute('aria-label')).toBe('Weather: Unpin from Activity Bar');
});

it('reports failed updates without changing selection and allows an explicit retry', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const onSetPinned = vi.fn().mockRejectedValueOnce(new Error('The surface could not be closed.')).mockResolvedValue(undefined);
  dispose = render(() => <PluginPinButton pluginName="Weather" pinned onSetPinned={onSetPinned} />, host);
  const button = host.querySelector('button')!;
  button.click();
  await Promise.resolve();
  expect(notifyError).toHaveBeenCalledWith('Unpin from Activity Bar', 'The surface could not be closed.');
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.disabled).toBe(false);
  button.click();
  await Promise.resolve();
  expect(onSetPinned).toHaveBeenCalledTimes(2);
  expect(onSetPinned).toHaveBeenLastCalledWith(false);
});
