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

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../services/localApi', () => ({ fetchLocalApiJSON: api.request }));
const priorLocale = readStoredLanguagePreference();
let cleanup: (() => void) | undefined;
afterEach(async () => { cleanup?.(); cleanup = undefined; writeStoredLanguagePreference(priorLocale); document.documentElement.classList.remove('dark'); api.request.mockReset(); await page.viewport(1280, 800); });
const button = (label: string) => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === label)!;
async function mount(locale: RedevenLocale = 'en-US') {
  writeStoredLanguagePreference(locale);
  let profiles = [{ id: 'browser-main', name: 'Default' }, { id: 'work', name: 'Work accounts' }];
  api.request.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (path.endsWith('/profiles')) {
      if (options?.method === 'POST') profiles = [...profiles, { id: 'new-profile', name: JSON.parse(options.body!).name }];
      return profiles;
    }
    if (path.endsWith('/extension/status')) return { profiles: [{ id: 'personal', name: 'My Chrome' }], platform: 'darwin', hostname: 'Workstation', prepared: true };
    if (path.includes('/extension/tabs?')) return [{ id: '7', profile_id: 'personal', title: 'Issue draft', url: 'https://example.test/issues/draft' }];
    if (path.endsWith('/connections/cdp')) return [{ id: 'remote', profile_id: 'default', title: 'CDP project', url: 'https://project.test/' }];
    throw new Error('Unexpected fixture request');
  });
  const select = vi.fn(), close = vi.fn();
  const host = document.createElement('div'); document.body.append(host);
  const Chooser = () => <BrowserSourceDialog service={browserSourceService(`source-fixture-${locale}`)} messages={browserSourceMessages(useI18n())} current={{ request: { managed_profile_id: 'browser-main' }, label: 'Default profile' }} onSelect={select} onClose={close} />;
  const dispose = render(() => <FloeConfigProvider><LayoutProvider><I18nProvider><Chooser /></I18nProvider></LayoutProvider></FloeConfigProvider>, host);
  cleanup = () => { dispose(); host.remove(); };
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Issue draft'));
  return { select, close };
}
it('keeps source selection as a draft until Open and preserves exact personal tab identity', async () => {
  const { select } = await mount();
  const personal = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('Issue draft'))!;
  personal.click();
  expect(select).not.toHaveBeenCalled();
  expect(api.request.mock.calls.some(([path]) => String(path).includes('/workspace'))).toBe(false);
  button('Open selection').click();
  expect(select).toHaveBeenCalledWith({ label: 'Issue draft', request: { connection: { extension_profile_id: 'personal', tab_id: '7', tab_url: 'https://example.test/issues/draft', tab_title: 'Issue draft' } } }, expect.any(AbortSignal));
});
it('creates and selects an isolated profile without replacing the active page', async () => {
  const { select } = await mount();
  const name = document.querySelector<HTMLInputElement>('input[maxlength="120"]')!;
  name.value = 'Client account'; name.dispatchEvent(new Event('input', { bubbles: true }));
  button('Create profile').click();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Client account'));
  expect(select).not.toHaveBeenCalled();
  button('Open selection').click();
  expect(select).toHaveBeenCalledWith({ label: 'Client account', request: { managed_profile_id: 'new-profile' } }, expect.any(AbortSignal));
});
it('discovers an advanced endpoint only on request and opens the exact discovered page', async () => {
  const { select } = await mount();
  document.querySelector('summary')!.click();
  const endpoint = document.querySelector<HTMLInputElement>('input[aria-label="Browser debugging endpoint"]')!;
  endpoint.value = 'http://127.0.0.1:9222'; endpoint.dispatchEvent(new Event('input', { bubbles: true }));
  expect(api.request.mock.calls.some(([path]) => String(path).endsWith('/connections/cdp'))).toBe(false);
  button('Find tabs').click();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('CDP project'));
  [...document.querySelectorAll('label')].find(label => label.textContent?.includes('CDP project'))!.click();
  button('Open selection').click();
  expect(select).toHaveBeenCalledWith({ label: 'CDP project', request: { connection: { cdp_url: 'http://127.0.0.1:9222', profile_id: 'default', tab_id: 'remote', tab_url: 'https://project.test/', tab_title: 'CDP project' } } }, expect.any(AbortSignal));
});
for (const [locale, width] of [['en-US', 1280], ['zh-CN', 390], ['de-DE', 390]] as const) it(`keeps source choices readable in ${locale} at ${width}px`, async () => {
  await page.viewport(width, 850);
  if (locale === 'zh-CN') document.documentElement.classList.add('dark');
  await mount(locale);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await vi.waitFor(() => expect(getComputedStyle(dialog).opacity).toBe('1'));
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  for (const input of dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')) expect(input.getBoundingClientRect().width).toBeGreaterThan(10);
  if (import.meta.env.VITE_REDEVEN_BROWSER_SOURCE_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/browser-sources-${locale}-${width}.png` });
});
