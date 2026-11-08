import '../../../index.css';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { I18nProvider } from '../../i18n';
import { writeStoredLanguagePreference } from '../../i18n/storage';
import { StorageSettings } from './StorageSettings';
const request = vi.hoisted(() => vi.fn());
vi.mock('../../services/localApi', () => ({ fetchLocalApiJSON: request }));
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); request.mockReset(); });
function mount(canAdmin = true) {
  writeStoredLanguagePreference('en-US');
  host = document.createElement('div');
  Object.assign(host.style, { width: '340px', maxWidth: '100%', padding: '16px' });
  document.body.appendChild(host);
  const [allowed, setAllowed] = createSignal(canAdmin);
  const flower = vi.fn();
  dispose = render(() => <I18nProvider><StorageSettings canAdmin={allowed()} scope="environment-a" openFlower={flower} openTooling={() => undefined} /></I18nProvider>, host);
  return { setAllowed, flower };
}
it('shows truthful paths and bounded sizes without overflowing a narrow viewport', async () => {
  request.mockResolvedValue({ entries: [{ id: 'plugins', path: '/very-long-environment-root/'.repeat(6) + 'apps/plugins/platform', kind: 'persistent', backup: 'environment', bytes: 3456789, complete: false, present: true }] });
  const { flower } = mount();
  await page.getByRole('button', { name: 'Inspect storage', exact: true }).click();
  await expect.element(page.getByText('Application plugins', { exact: true })).toBeVisible();
  expect(host.textContent).toContain('lower bound');
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
  await page.getByRole('button', { name: 'Flower recovery', exact: true }).click();
  expect(flower).toHaveBeenCalledOnce();
});
it('fences late inventory responses after administrator access is removed', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { setAllowed } = mount();
  await page.getByRole('button', { name: 'Inspect storage', exact: true }).click();
  setAllowed(false);
  finish({ entries: [{ id: 'plugins', path: '/secret-path', kind: 'persistent', backup: 'environment', bytes: 1, complete: true, present: true }] });
  await expect.element(page.getByRole('button', { name: 'Inspect storage', exact: true })).toBeDisabled();
  expect(host.textContent).not.toContain('/secret-path');
});
it('retains the last inventory after a failed refresh and offers retry', async () => {
  request.mockResolvedValueOnce({ entries: [{ id: 'skills', path: '/environment/apps/skills', kind: 'persistent', backup: 'environment', bytes: 1, complete: true, present: true }] }).mockRejectedValueOnce(new Error('offline'));
  mount();
  await page.getByRole('button', { name: 'Inspect storage', exact: true }).click();
  await expect.element(page.getByText('Managed skills', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect storage', exact: true }).click();
  await expect.element(page.getByRole('alert')).toBeVisible();
  await expect.element(page.getByText('Managed skills', { exact: true })).toBeVisible();
});
