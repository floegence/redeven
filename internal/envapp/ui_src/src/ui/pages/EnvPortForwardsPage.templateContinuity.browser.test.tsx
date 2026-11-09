import '../../index.css';

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { EnvPortForwardsPage } from './EnvPortForwardsPage';
import { I18nProvider } from '../i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';

const api = vi.hoisted(() => ({ scope: '', canManage: true, request: vi.fn() }));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({ resourceCacheAccess: () => ({ phase: 'ready', generation: 0, scope: api.scope }), env_id: () => 'template-continuity', goActivity: vi.fn(), env: Object.assign(() => ({ permissions: { can_read: true, can_write: api.canManage, can_execute: api.canManage } }), { state: 'ready' }) }) }));
vi.mock('../services/localApi', async original => ({ ...await original<object>(), fetchLocalApiJSON: api.request }));
vi.mock('@floegence/floe-webapp-core', async original => ({ ...await original<object>(), useNotification: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@floegence/floe-webapp-protocol', () => ({ useProtocol: () => ({ session: () => null }) }));
vi.mock('../protocol/redeven_v1', () => ({ useRedevenRpc: () => ({ fs: { list: vi.fn() } }) }));

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  expect(found, selector).not.toBeNull();
  return found!;
}

function geometry(selectors: string[]) {
  return selectors.map(selector => {
    const { x, y, width, height } = element(selector).getBoundingClientRect();
    return { x, y, width, height };
  });
}

describe('template discovery loading continuity', () => {
  let dispose: (() => void) | undefined;
  afterEach(async () => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
    localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY);
    api.request.mockReset();
    api.canManage = true;
    await page.viewport(1280, 720);
  });

  function mount() {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <I18nProvider><EnvPortForwardsPage /></I18nProvider>, host);
  }

  function requests() {
    api.scope = `template-continuity-${crypto.randomUUID()}`;
    const cached = deferred(), refresh = deferred(), retry = deferred();
    let refreshes = 0;
    api.request.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/market-catalog')) return init?.method === 'POST' ? (++refreshes === 1 ? refresh.promise : retry.promise) : cached.promise;
      if (url.endsWith('/catalog')) return Promise.resolve({ templates: [] });
      if (url.endsWith('/forwards')) return Promise.resolve({ forwards: [] });
      if (url.endsWith('/managed-web-services')) return Promise.resolve({ services: [] });
      throw new Error(`Unexpected API: ${url}`);
    });
    return { cached, refresh, retry };
  }

  const chrome = ['[data-testid=market-navigation]', '.service-template-search-actions', '.service-template-switcher'];
  it.each(['host', 'container', 'compose'].flatMap(kind => [
    { kind, width: 1440, locale: 'en-US' }, { kind, width: 390, locale: 'zh-CN' },
    { kind, width: 320, locale: 'de-DE' }, { kind, width: 1440, locale: 'zh-TW' },
  ]))('retains $kind geometry through cache, refresh, failure and recovery at $width in $locale', async ({ kind, width, locale }) => {
    await page.viewport(width, 900);
    localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
    const pending = requests();
    mount();
    await userEvent.click(page.getByTestId('service-templates-button'));
    await expect.element(page.getByTestId('market-navigation')).toBeVisible();
    await settle();
    const initialChrome = geometry(chrome);
    const item = { template_id: 'git_continuity', document_template_id: 'continuity', service_family_id: 'continuity',
      source: { repository: 'owner/templates', repository_id: 123, ref: 'main', path: 'templates/example', commit_sha: 'a'.repeat(40) },
      sha256: 'b'.repeat(64), deployment: kind, revision: 1, default_locale: 'en-US',
      localizations: { 'en-US': { name: 'Continuity service', description: 'Retained catalog entry' } }, classification: kind === 'compose' ? 'community' : 'official', status: 'available' };
    const result = { items: [{ ...item, template_id: 'git_other', document_template_id: 'other' }, item], stale: true, generation: 1, checked_at: Date.now() };
    pending.cached.resolve(result);
    await expect.element(page.getByTestId('service-template-row').first()).toBeVisible();
    await settle();
    expect(geometry(chrome)).toEqual(initialChrome);
    const refresh = element('[data-testid=market-refresh]') as HTMLButtonElement;
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    expect(refresh.querySelector('svg')).not.toBeNull();
    expect(refresh.disabled).toBe(true);
    await userEvent.click(element('[data-testid=service-template-row][data-template-id=git_continuity]'));
    const search = element('.service-template-search input') as HTMLInputElement;
    await userEvent.fill(search, 'Continuity');
    const retained = [...chrome, '[data-testid=market-refresh]', '[data-testid=service-template-row]', '[data-testid=service-template-details]', '[data-testid=service-template-primary]'];
    await settle();
    const bounds = geometry(retained);
    const drawer = element('[data-testid=service-template-drawer]');
    drawer.scrollTop = 30;
    const scroll = drawer.scrollTop;
    const scrolledBounds = geometry(retained);
    pending.refresh.reject(new Error('offline'));
    await expect.poll(() => refresh.disabled).toBe(false);
    await settle();
    expect(geometry(retained)).toEqual(scrolledBounds);
    expect(drawer.scrollTop).toBe(scroll);
    expect(document.activeElement).toBe(search);
    expect(search.value).toBe('Continuity');
    expect(element('[data-testid=service-template-details]').getAttribute('data-template-id')).toBe(item.template_id);
    const status = element('#' + refresh.getAttribute('aria-describedby'));
    expect(status.getAttribute('role')).toBe('status');
    expect(getComputedStyle(status).position).toBe('absolute');
    expect(status.textContent).not.toBe('');
    await page.screenshot({ path: `__screenshots__/template-continuity-${kind}-${width}-failed.png` });
    drawer.scrollTop = 0;
    await userEvent.hover(refresh);
    await expect.element(page.getByRole('tooltip')).toBeVisible();
    const tooltip = element('[role=tooltip]').getBoundingClientRect();
    expect(tooltip.left).toBeGreaterThanOrEqual(0);
    expect(tooltip.right).toBeLessThanOrEqual(width);
    expect(tooltip.height).toBeLessThan(100);
    await page.screenshot({ path: `__screenshots__/template-continuity-${kind}-${width}-${locale}-tooltip.png` });
    await userEvent.click(refresh);
    await userEvent.click(search);
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    pending.retry.resolve(structuredClone({ ...result, stale: false, generation: 2 }));
    await expect.poll(() => refresh.disabled).toBe(false);
    await settle();
    expect(geometry(retained)).toEqual(bounds);
    expect(document.activeElement).toBe(search);
    expect(element('.service-template-search input')).toBe(search);
    expect(search.value).toBe('Continuity');
    expect(status.textContent).toBe('');
    expect(element('[data-testid=service-template-details]').getAttribute('data-template-id')).toBe(item.template_id);
    await page.screenshot({ path: `__screenshots__/template-continuity-${kind}-${width}-recovered.png` });
  });

  it('retains a successful empty catalog during refresh and recovery', async () => {
    await page.viewport(1440, 900);
    const pending = requests();
    mount();
    await userEvent.click(page.getByTestId('service-templates-button'));
    await expect.element(page.getByTestId('market-navigation')).toBeVisible();
    await settle();
    const initialChrome = geometry(chrome);
    pending.cached.resolve({ items: [], stale: true, generation: 1, checked_at: Date.now() });
    await expect.poll(() => document.querySelector('.service-template-empty')).not.toBeNull();
    const empty = element('.service-template-empty');
    await settle();
    expect(geometry(chrome)).toEqual(initialChrome);
    pending.refresh.reject(new Error('offline'));
    const refresh = element('[data-testid=market-refresh]') as HTMLButtonElement;
    await expect.poll(() => refresh.disabled).toBe(false);
    expect(element('.service-template-empty')).toBe(empty);
    await userEvent.click(refresh);
    expect(element('.service-template-empty')).toBe(empty);
    pending.retry.resolve({ items: [], stale: false, generation: 2, checked_at: Date.now() });
    await expect.poll(() => refresh.disabled).toBe(false);
    await settle();
    expect(geometry(chrome)).toEqual(initialChrome);
    expect(element('.service-template-empty')).toBe(empty);
  });

  it('exposes read-only cached status without adding layout rows or refreshing', async () => {
    await page.viewport(390, 900);
    const pending = requests();
    api.canManage = false;
    mount();
    await userEvent.click(page.getByTestId('service-templates-button'));
    await expect.element(page.getByTestId('market-navigation')).toBeVisible();
    await settle();
    const bounds = geometry(chrome);
    pending.cached.resolve({ items: [], stale: true, generation: 1, checked_at: Date.now() });
    const refresh = element('[data-testid=market-refresh]') as HTMLButtonElement;
    await expect.poll(() => refresh.getAttribute('aria-busy')).toBeNull();
    expect(refresh.disabled).toBe(true);
    expect(api.request.mock.calls.filter(([url]) => url.endsWith('/market-catalog'))).toHaveLength(1);
    const status = element('#' + refresh.getAttribute('aria-describedby'));
    expect(status.textContent).toContain('saved templates');
    await settle();
    expect(geometry(chrome)).toEqual(bounds);
    await userEvent.hover(refresh.parentElement!);
    await expect.element(page.getByRole('tooltip')).toBeVisible();
    expect(element('[role=tooltip]').textContent).toBe(status.textContent);
  });

  it('keeps initial errors accessible and supports retry from the keyboard', async () => {
    const pending = requests();
    mount();
    await userEvent.click(page.getByTestId('service-templates-button'));
    await expect.element(page.getByTestId('market-navigation')).toBeVisible();
    await settle();
    const bounds = geometry(chrome);
    pending.cached.reject(new Error('cache unavailable'));
    await expect.poll(() => api.request.mock.calls.filter(([url]) => url.endsWith('/market-catalog')).length).toBe(2);
    pending.refresh.reject(new Error('offline'));
    const refresh = element('[data-testid=market-refresh]') as HTMLButtonElement;
    await expect.poll(() => refresh.disabled).toBe(false);
    refresh.focus();
    await expect.element(page.getByRole('tooltip')).toBeVisible();
    const status = element('#' + refresh.getAttribute('aria-describedby'));
    expect(status.textContent).toContain('failed');
    await settle();
    expect(geometry(chrome)).toEqual(bounds);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => api.request.mock.calls.filter(([url]) => url.endsWith('/market-catalog')).length).toBe(3);
    pending.retry.resolve({ items: [], stale: false, generation: 1, checked_at: Date.now() });
    await expect.poll(() => refresh.disabled).toBe(false);
    await settle();
    expect(geometry(chrome)).toEqual(bounds);
    expect(status.textContent).toBe('');
  });
});
