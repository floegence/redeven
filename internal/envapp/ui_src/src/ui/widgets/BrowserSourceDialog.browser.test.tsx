import { expectSingleLineButtonLabels } from '../../test/buttonLayoutAssertions';
import '../../index.css';
import '../../styles/redeven.css';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { browserSourceService } from '../services/browserSourceManagement';
import { browserSourceMessages } from '../i18n/browserSourceMessages';
import { I18nProvider, useI18n } from '../i18n';
import { readStoredLanguagePreference, writeStoredLanguagePreference } from '../i18n/storage';
import type { RedevenLocale } from '../i18n';
import { BrowserSourceDialog } from './BrowserSourceDialog';
import { bindTestSessionHTTP } from '../../test/sessionHTTPFixture';

const api = { request: vi.fn() };
let unbind: (() => void) | undefined;
const priorLocale = readStoredLanguagePreference();
let cleanup: (() => void) | undefined;
afterEach(async () => { cleanup?.(); cleanup = undefined; unbind?.(); writeStoredLanguagePreference(priorLocale); document.documentElement.classList.remove('dark'); api.request.mockReset(); await page.viewport(1280, 800); });
const button = (label: string) => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === label)!;
async function mount(locale: RedevenLocale = 'en-US', installed = true) {
  writeStoredLanguagePreference(locale);
  let profiles = [{ id: 'browser-main', name: 'Default' }, { id: 'work', name: 'Work accounts' }];
  api.request.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (path.endsWith('/preference')) return { preference: null };
    if (path.endsWith('/installation')) {
      if (options?.method === 'POST') installed = true;
      return { storage_bytes: 1, enabled: true, state: installed ? 'installed' : 'not_installed', launch: { state: installed ? 'ready' : 'installation_required' }, package: { id: 'fixture', name: 'Chromium', version: '153', platform: 'darwin', architecture: 'arm64', size_bytes: 1, installed_bytes: 1 }, received_bytes: 0, directory: '/fixture' };
    }
    if (path.endsWith('/profiles')) {
      if (options?.method === 'POST') profiles = [...profiles, { id: 'new-profile', name: JSON.parse(options.body!).name }];
      return profiles;
    }
    if (path.endsWith('/extension/status')) return { installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: true, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'personal', name: 'My Chrome' }], platform: 'darwin', hostname: 'Workstation', prepared: true };
    if (path.includes('/extension/tabs?')) return [{ id: '7', profile_id: 'personal', title: 'Issue draft', url: 'https://example.test/issues/draft' }];
    if (path.endsWith('/connections/cdp')) return [{ id: 'remote', profile_id: 'default', title: 'CDP project', url: 'https://project.test/' }];
    throw new Error('Unexpected fixture request');
  });
  unbind = await bindTestSessionHTTP(async (path, options) => Response.json({ ok: true, data: await api.request(String(path), options) }));
  const select = vi.fn(), close = vi.fn();
  const host = document.createElement('div'); document.body.append(host);
  const Chooser = () => <BrowserSourceDialog service={browserSourceService(`source-fixture-${locale}`)} messages={browserSourceMessages(useI18n())} current={{ request: { managed_profile_id: 'browser-main' }, label: 'Default profile' }} onSelect={select} onClose={close} />;
  const dispose = render(() => <FloeConfigProvider><LayoutProvider><I18nProvider><Chooser /></I18nProvider></LayoutProvider></FloeConfigProvider>, host);
  cleanup = () => { dispose(); host.remove(); };
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.redeven-browser-source-card-action')?.disabled).toBe(false));
  return { select, close };
}
it('keeps source selection as a draft until Open and preserves exact personal tab identity', async () => {
  const { select } = await mount();
  await page.getByRole('button', { name: 'Personal browser', exact: true }).click();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Issue draft'));
  const personal = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('Issue draft'))!;
  personal.click();
  expect(select).not.toHaveBeenCalled();
  expect(api.request.mock.calls.some(([path]) => String(path).includes('/workspace'))).toBe(false);
  button('Open selection').click();
  expect(select).toHaveBeenCalledWith({ label: 'Issue draft', request: { connection: { extension_profile_id: 'personal', tab_id: '7', tab_url: 'https://example.test/issues/draft', tab_title: 'Issue draft' } } }, expect.any(AbortSignal));
});
it('creates and selects an isolated profile without replacing the active page', async () => {
  const { select } = await mount();
  await page.getByRole('button', { name: 'Built-in browser', exact: true }).click();
  button('Create profile').click();
  const name = document.querySelector<HTMLInputElement>('input[maxlength="120"]')!;
  name.value = 'Client account'; name.dispatchEvent(new Event('input', { bubbles: true }));
  button('Create profile').click();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Client account'));
  expect(select).not.toHaveBeenCalled();
  button('Open selection').click();
  await vi.waitFor(() => expect(select).toHaveBeenCalledWith({ label: 'Client account', request: { managed_profile_id: 'new-profile' } }, expect.any(AbortSignal)));
});
it('opens the selected source once after Install and open completes', async () => {
  const { select } = await mount('en-US', false);
  await page.getByRole('button', { name: 'Built-in browser', exact: true }).click();
  button('Open selection').click();
  await vi.waitFor(() => expect(button('Install and open')).toBeDefined());
  expect(select).not.toHaveBeenCalled();
  expect(api.request.mock.calls.filter(([path, options]) => path.endsWith('/installation') && options?.method === 'POST')).toHaveLength(0);
  button('Install and open').click();
  await vi.waitFor(() => expect(select).toHaveBeenCalledExactlyOnceWith({ label: 'Default profile', request: { managed_profile_id: 'browser-main' } }, expect.any(AbortSignal)));
  expect(api.request.mock.calls.filter(([path, options]) => path.endsWith('/installation') && options?.method === 'POST')).toHaveLength(1);
});
it('discovers an advanced endpoint only on request and opens the exact discovered page', async () => {
  const { select } = await mount();
  button('Discover a self-managed Chromium browser').click();
  const endpoint = document.querySelector<HTMLInputElement>('input[aria-label="Browser debugging endpoint"]')!;
  endpoint.value = 'http://127.0.0.1:9222'; endpoint.dispatchEvent(new Event('input', { bubbles: true }));
  expect(api.request.mock.calls.some(([path]) => String(path).endsWith('/connections/cdp'))).toBe(false);
  button('Find tabs').click();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('CDP project'));
  [...document.querySelectorAll('label')].find(label => label.textContent?.includes('CDP project'))!.click();
  button('Open selection').click();
  expect(select).toHaveBeenCalledWith({ label: 'CDP project', request: { connection: { cdp_url: 'http://127.0.0.1:9222', profile_id: 'default', tab_id: 'remote', tab_url: 'https://project.test/', tab_title: 'CDP project' } } }, expect.any(AbortSignal));
});
for (const [locale, width] of [['en-US', 1280], ['zh-CN', 390], ['de-DE', 390], ['fr-FR', 320], ['ru-RU', 320]] as const) it(`keeps source choices readable in ${locale} at ${width}px`, async () => {
  await page.viewport(width, 850);
  if (locale === 'zh-CN') document.documentElement.classList.add('dark');
  await mount(locale);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await vi.waitFor(() => expect(getComputedStyle(dialog).opacity).toBe('1'));
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  const bounds = dialog.getBoundingClientRect();
  for (const card of dialog.querySelectorAll<HTMLElement>('.redeven-browser-source-card')) {
    const cardBounds = card.getBoundingClientRect();
    expect(cardBounds.left).toBeGreaterThanOrEqual(bounds.left);
    expect(cardBounds.right).toBeLessThanOrEqual(bounds.right);
    for (const description of card.querySelectorAll<HTMLElement>('.redeven-browser-source-card-description')) {
      const text = document.createRange();
      text.selectNodeContents(description);
      for (const line of text.getClientRects()) {
        expect(line.left).toBeGreaterThanOrEqual(cardBounds.left);
        expect(line.right).toBeLessThanOrEqual(cardBounds.right);
      }
    }
  }
  expectSingleLineButtonLabels(dialog);
  for (const input of dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')) expect(input.getBoundingClientRect().width).toBeGreaterThan(10);
  if (import.meta.env.VITE_REDEVEN_BROWSER_SOURCE_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/browser-sources-${locale}-${width}.png` });
});

it('submits profile intent once on Enter and ignores composition Enter without native forms', async () => {
  await mount();
  await page.getByRole('button', { name: 'Built-in browser', exact: true }).click();
  button('Create profile').click();
  const name = document.querySelector<HTMLInputElement>('input[maxlength="120"]')!;
  name.value = 'Keyboard profile'; name.dispatchEvent(new Event('input', { bubbles: true }));
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  expect(api.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Keyboard profile'));
  expect(api.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  expect(document.querySelector('[role="dialog"] form')).toBeNull();
});

it('shows two source choices before revealing page selection or profile administration', async () => {
  await mount();
  expect(document.querySelectorAll('.redeven-browser-source-card')).toHaveLength(2);
  expect(document.querySelector('input[type="radio"]')).toBeNull();
  expect(document.querySelector('input[maxlength="120"]')).toBeNull();
  expect(button('Open selection')).toBeUndefined();
  await page.getByRole('button', { name: 'Built-in browser', exact: true }).click();
  expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(2);
  expect(document.querySelector('input[maxlength="120"]')).toBeNull();
  expect(document.querySelector('input[aria-label="Search pages"]')).toBeNull();
  button('Back').click();
  expect(document.querySelectorAll('.redeven-browser-source-card')).toHaveLength(2);
});

it('cancels a pending selection when returning to source choices', async () => {
  const { select } = await mount();
  let reject!: (reason: unknown) => void;
  select.mockImplementation(() => new Promise((_resolve, onReject) => { reject = onReject; }));
  await page.getByRole('button', { name: 'Built-in browser', exact: true }).click();
  button('Open selection').click();
  await vi.waitFor(() => expect(select).toHaveBeenCalledOnce());
  const signal = select.mock.calls[0][1] as AbortSignal;
  button('Back').click();
  expect(signal.aborted).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('.redeven-browser-source-card-action')!.disabled).toBe(false);
  reject(new Error('obsolete selection failed'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
