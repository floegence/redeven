import '../../index.css';
import '../../styles/browserWorkspace.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { expectSingleLineButtonLabels } from '../../test/buttonLayoutAssertions';
import { browserSourceMessages } from '../i18n/browserSourceMessages';
import { SUPPORTED_LOCALES, type RedevenLocale } from '../i18n/localeMeta';
import { createTestI18nHelpers } from '../i18n/locales/testDictionaries';
import type { BrowserSourceService } from '../services/browserSourceContract';
import type { BrowserWorkspaceState } from '../services/browserWorkspaceController';
import { BrowserWorkspaceNotice } from './BrowserWorkspaceNotice';

let cleanup: (() => void) | undefined;
afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  document.documentElement.classList.remove('dark');
  await page.viewport(1280, 800);
});

function mount(locale: RedevenLocale = 'en-US', initial: BrowserWorkspaceState = { phase: 'selecting' }) {
  const i18n = createTestI18nHelpers(locale);
  const messages = browserSourceMessages(i18n);
  const service: BrowserSourceService = {
    management: {}, preference: vi.fn(), profiles: vi.fn(), createProfile: vi.fn(),
    status: vi.fn(), tabs: vi.fn(), discover: vi.fn(),
  };
  const chooseSource = vi.fn(), retry = vi.fn(async () => undefined), recover = vi.fn(async () => undefined);
  const [state, setState] = createSignal(initial);
  const host = document.createElement('div');
  host.className = 'redeven-browser-page';
  host.style.height = '100vh';
  document.body.append(host);
  const dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <BrowserWorkspaceNotice title={i18n.t('shell.nav.remoteBrowser')} state={state()} messages={messages}
      service={service} connected retry={retry} recover={recover} chooseSource={chooseSource} />
  </LayoutProvider></FloeConfigProvider>, host);
  cleanup = () => { dispose(); host.remove(); };
  return { host, messages, chooseSource, retry, recover, service, setState };
}

for (const dark of [false, true]) it(`centers the browser welcome content in a large ${dark ? 'dark' : 'light'} workspace`, async () => {
  await page.viewport(1440, 1000);
  document.documentElement.classList.toggle('dark', dark);
  const { host, messages } = mount('zh-CN');
  const content = host.querySelector<HTMLElement>('.redeven-browser-notice-content')!;
  const bounds = content.getBoundingClientRect();
  expect(Math.abs(bounds.y + bounds.height / 2 - 500)).toBeLessThan(2);
  expect(Math.abs(bounds.x + bounds.width / 2 - 720)).toBeLessThan(2);
  expect(host.querySelector('h2')?.textContent).not.toBe(messages.product.sourceHint);
  expect(host.querySelector('.redeven-browser-welcome-description')?.textContent).toBeTruthy();
  expect(host.querySelector('.redeven-browser-welcome-art')?.getAttribute('aria-hidden')).toBe('true');
  expect(host.querySelectorAll('button')).toHaveLength(1);
  expectSingleLineButtonLabels(host);
  if (import.meta.env.VITE_REDEVEN_BROWSER_WELCOME_SCREENSHOTS === '1') {
    await page.screenshot({ element: host, path: `__screenshots__/browser-welcome-zh-CN-${dark ? 'dark' : 'light'}.png` });
  }
});

for (const locale of SUPPORTED_LOCALES) it(`keeps the welcome copy and action within a narrow ${locale} workspace`, async () => {
  await page.viewport(320, 640);
  const { host } = mount(locale);
  const notice = host.querySelector<HTMLElement>('.redeven-browser-notice')!;
  expect(notice.scrollWidth).toBeLessThanOrEqual(notice.clientWidth);
  expect(notice.scrollHeight).toBeLessThanOrEqual(notice.clientHeight);
  for (const element of host.querySelectorAll<HTMLElement>('h2, p, button')) {
    const bounds = element.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(16);
    expect(bounds.right).toBeLessThanOrEqual(304);
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
  }
  expectSingleLineButtonLabels(host);
  if (locale === 'zh-CN' && import.meta.env.VITE_REDEVEN_BROWSER_WELCOME_SCREENSHOTS === '1') {
    await page.screenshot({ element: host, path: '__screenshots__/browser-welcome-zh-CN-narrow.png' });
  }
});

it('keeps the entire welcome reachable when the workspace is short', async () => {
  await page.viewport(360, 240);
  const { host } = mount('de-DE');
  const notice = host.querySelector<HTMLElement>('.redeven-browser-notice')!;
  const content = host.querySelector<HTMLElement>('.redeven-browser-notice-content')!;
  expect(content.getBoundingClientRect().top).toBeGreaterThanOrEqual(16);
  notice.scrollTop = notice.scrollHeight;
  const action = host.querySelector('button')!.getBoundingClientRect();
  expect(action.top).toBeGreaterThanOrEqual(0);
  expect(action.bottom).toBeLessThanOrEqual(240);
  expect(notice.scrollWidth).toBeLessThanOrEqual(notice.clientWidth);
});

it('opens source selection by keyboard without starting browser work', async () => {
  const { host, chooseSource, retry, recover, service } = mount();
  const action = host.querySelector('button')!;
  expect(getComputedStyle(action).cursor).toBe('pointer');
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement).toBe(action);
  await userEvent.keyboard('{Enter}');
  expect(chooseSource).toHaveBeenCalledOnce();
  expect(retry).not.toHaveBeenCalled();
  expect(recover).not.toHaveBeenCalled();
  expect(service.profiles).not.toHaveBeenCalled();
  expect(service.status).not.toHaveBeenCalled();
});

it('retains explicit recovery confirmation and restores neutral selection after a failure', async () => {
  const { host, messages, recover, setState } = mount('en-US', { phase: 'failed', failure: 'BROWSER_SERVICE_FAILED' });
  expect(host.querySelector('h2')?.textContent).toBe(messages.product.recoverTitle);
  expect(host.querySelector('.redeven-browser-welcome-art')).toBeNull();
  await page.getByRole('button', { name: messages.product.recover, exact: true }).click();
  expect(recover).not.toHaveBeenCalled();
  const dialog = page.getByRole('dialog');
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog).toHaveTextContent(messages.product.recoveryDescription);
  await dialog.getByRole('button', { name: messages.product.recover, exact: true }).click();
  await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
  setState({ phase: 'selecting' });
  expect(host.querySelector('.redeven-browser-welcome-art')).not.toBeNull();
  expect(host.querySelectorAll('.redeven-browser-notice-actions button')).toHaveLength(1);
});
