import '../../../index.css';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { I18nProvider } from '../../i18n';
import { writeStoredLanguagePreference } from '../../i18n/storage';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { StorageSettings } from './StorageSettings';
import type { StorageEntry } from './storageOverview';
const request = vi.hoisted(() => vi.fn());
vi.mock('../../services/localApi', () => ({ fetchLocalApiJSON: request }));
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); request.mockReset(); localStorage.removeItem('storage-design-theme'); document.documentElement.classList.remove('dark'); });
const entry = (id: string, bytes = 3456789, extra: Partial<StorageEntry> = {}): StorageEntry => ({ id, path: `/environment/${id}`, kind: 'persistent', backup: 'environment', bytes, complete: true, present: true, ...extra });
function mount(canAdmin = true, active = true, locale: 'en-US' | 'zh-CN' | 'de-DE' = 'en-US', dark = false) {
  writeStoredLanguagePreference(locale);
  host = document.createElement('div');
  Object.assign(host.style, { width: '320px', maxWidth: '100%', padding: '16px' });
  document.body.appendChild(host);
  const [allowed, setAllowed] = createSignal(canAdmin), [visible, setVisible] = createSignal(active), [scope, setScope] = createSignal('environment-a');
  const manage = vi.fn();
  dispose = render(() => <I18nProvider><FloeProvider config={{ theme: { storageKey: 'storage-design-theme', defaultTheme: dark ? 'dark' : 'light' } }}><StorageSettings canAdmin={allowed()} active={visible()} scope={scope()} onManage={manage} /></FloeProvider></I18nProvider>, host);
  return { setAllowed, setVisible, setScope, manage };
}
it('loads immediately, orders observed sizes and opens the exact owner without exposing details by default', async () => {
  request.mockResolvedValue({ entries: [entry('skills', 500), entry('plugins', 3456789, { path: '/very-long-environment-root/'.repeat(6), complete: false }), entry('runtime', 0, { complete: false, present: false })] });
  const { manage } = mount();
  await expect.element(page.getByRole('button', { name: 'Manage Application plugins' })).toBeVisible();
  expect(request).toHaveBeenCalledOnce();
  expect(host.querySelector('.storage-usage-list li')?.textContent).toContain('Application plugins');
  expect(host.textContent).toContain('lower bound');
  expect(host.querySelector('.storage-usage-list')?.textContent).toContain('Unavailable');
  expect(host.querySelector('details[open]')).toBeNull();
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
  await page.getByRole('button', { name: 'Manage Application plugins' }).click();
  expect(manage).toHaveBeenCalledWith({ kind: 'plugins' });
  await page.getByText('Storage locations', { exact: true }).click();
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
});
it('does not read before presentation or without administrator access', async () => {
  request.mockResolvedValue({ entries: [] });
  const { setAllowed, setVisible } = mount(false, false);
  setVisible(true); expect(request).not.toHaveBeenCalled();
  setAllowed(true); await expect.poll(() => request.mock.calls.length).toBe(1);
});
it.each(['permission', 'scope', 'hidden', 'unmount'] as const)('fences late inventory on %s changes', async reason => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ entries: [] });
  const control = mount();
  await expect.poll(() => request.mock.calls.length).toBe(1);
  const signal = request.mock.calls[0][1].signal as AbortSignal;
  if (reason === 'permission') control.setAllowed(false);
  if (reason === 'scope') control.setScope('environment-b');
  if (reason === 'hidden') control.setVisible(false);
  if (reason === 'unmount') { dispose?.(); dispose = undefined; }
  finish({ entries: [entry('plugins', 1, { path: '/secret-path' })] });
  await Promise.resolve(); await Promise.resolve();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain('/secret-path');
  expect(host.querySelector('.storage-usage-link')).toBeNull();
});
it('retains the last inventory after a failed refresh and offers retry', async () => {
  request.mockResolvedValueOnce({ entries: [entry('skills', 1)] }).mockRejectedValueOnce(new Error('offline'));
  mount();
  await expect.element(page.getByRole('button', { name: 'Manage Managed skills' })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect storage', exact: true }).click();
  await expect.element(page.getByRole('alert')).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Manage Managed skills' })).toBeVisible();
});
it('keeps missing locations collapsed and never offers a generic cache deletion', async () => {
  request.mockResolvedValue({ entries: [entry('skills', 0, { present: false }), entry('cache', 50)] });
  mount();
  await expect.element(page.getByText('Cache', { exact: true }).first()).toBeVisible();
  expect(host.querySelector('details')?.open).toBe(false);
  expect(host.querySelector('.storage-usage-list')?.querySelector('button')).toBeNull();
});

it('refreshes after returning from management while retaining the last observation', async () => {
  request.mockResolvedValueOnce({ entries: [entry('skills', 100)] }).mockResolvedValueOnce({ entries: [entry('skills', 500)] });
  const { setVisible } = mount();
  await expect.element(page.getByRole('button', { name: 'Manage Managed skills' })).toBeVisible();
  setVisible(false); expect(request).toHaveBeenCalledOnce();
  setVisible(true);
  await expect.poll(() => request.mock.calls.length).toBe(2);
  await expect.poll(() => host.querySelector('.storage-usage-size')?.textContent).toBe('500 byte');
});

it.each(([320, 768, 1280] as const).flatMap(width => (['en-US', 'zh-CN', 'de-DE'] as const).flatMap(locale => [false, true].map(dark => ({ width, locale, dark })))) )('presents a bounded usage group at $width / $locale / dark=$dark', async ({ width, locale, dark }) => {
  await page.viewport(width, 900);
  request.mockResolvedValue({ entries: [entry('flower', 7700000000), entry('plugins', 322400000, { complete: false }), entry('configuration', 5700), entry('terminal', 300), entry('audit', 0, { present: false, complete: false })] });
  mount(true, true, locale, dark); host.style.width = '100%';
  await expect.poll(() => host.querySelectorAll('.storage-usage-main').length).toBe(5);
  const group = host.querySelector<HTMLElement>('.storage-usage-group')!;
  expect(parseFloat(getComputedStyle(group).borderRadius)).toBeGreaterThan(0);
  for (const row of group.querySelectorAll<HTMLElement>('.storage-usage-main')) {
    expect(row.querySelector('.storage-usage-icon')).not.toBeNull();
    expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(group.getBoundingClientRect().right);
  }
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  await page.screenshot({ path: `../../../../dist/settings-refinement/storage-${width}-${locale}-${dark ? 'dark' : 'light'}.png` });
});
