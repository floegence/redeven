import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { EnvHostApplicationsPage } from './EnvHostApplicationsPage';

const state = vi.hoisted(() => ({ locale: 'en-US' as 'en-US' | 'zh-CN', scope: '', catalog: vi.fn(), detach: vi.fn() }));
vi.mock('../i18n', async () => {
  const { createTestI18nHelpers } = await import('../i18n/locales/testDictionaries');
  return { useI18n: () => ({ ...createTestI18nHelpers(state.locale), locale: () => state.locale }) };
});
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ permissions: { can_read: true, can_write: true, can_execute: true } }),
  resourceCacheScope: () => state.scope,
  env_id: () => 'host', localRuntime: () => ({}),
}) }));
vi.mock('../services/hostApplicationsApi', async importOriginal => {
  const app = { id: 'editor.app', name: 'Text Editor', description: '', categories: [], icon: '', custom: false };
  const session = { id: 'shared', application: app, state: 'running', backend: 'macos' };
  return {
    ...await importOriginal<object>(),
    listHostApplications: async () => state.catalog.getMockImplementation() ? state.catalog() : ({ availability: { backend: 'macos', supported: true, ready: true, native_ready: true }, applications: [app], sessions: [session], running: [{ application_id: app.id, instances: ['instance'] }] }),
    listHostApplicationSessions: async () => [session],
    listRunningHostApplications: async () => [{ application_id: app.id, instances: ['instance'] }],
    detachHostApplication: state.detach,
  };
});

let dispose: (() => void) | undefined;
afterEach(async () => {
  dispose?.();
  document.body.replaceChildren();
  state.detach.mockClear(); state.catalog.mockReset(); state.scope = "";
  await page.viewport(1280, 720);
});

it.each([390, 1440].flatMap(width => (['en-US', 'zh-CN'] as const).map(locale => ({ width, locale }))))(
  'shows stop-sharing guidance in the body at $width px in $locale', async ({ width, locale }) => {
    state.locale = locale;
    await page.viewport(width, 900);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvHostApplicationsPage />, host);
    const title = locale === 'zh-CN' ? '停止共享' : 'Stop sharing';
    await userEvent.click(page.getByRole('button', { name: `${title} · Text Editor`, exact: true }));
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeTruthy();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await expect.poll(() => getComputedStyle(dialog).opacity).toBe('1');
    const header = dialog.querySelector<HTMLElement>('[data-floe-dialog-header]')!;
    const body = dialog.querySelector<HTMLElement>('[data-floe-dialog-body]')!;
    const footer = dialog.querySelector<HTMLElement>('[data-floe-dialog-footer]')!;
    const description = document.getElementById(dialog.getAttribute('aria-describedby')!)!;
    expect(header.textContent).toBe(title);
    expect(description.parentElement).toBe(body);
    expect(body.children).toHaveLength(1);
    expect(description.textContent).toContain(locale === 'zh-CN' ? '应用窗口和未保存的工作会保留。' : 'Its windows and unsaved work stay open.');
    expect(description.getBoundingClientRect().top).toBeGreaterThan(header.getBoundingClientRect().bottom);
    expect(description.getBoundingClientRect().bottom).toBeLessThan(footer.getBoundingClientRect().top);
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
    await page.screenshot({ element: dialog, path: `__screenshots__/stop-sharing-${locale}-${width}.png` });
    await userEvent.click(page.getByRole('button', { name: locale === 'zh-CN' ? '取消' : 'Cancel', exact: true }));
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
    expect(state.detach).not.toHaveBeenCalled();
  },
);

it('restores a persisted directory and icon before the network, preserving row focus through an update', async () => {
  const { createResourceCache, createIndexedDBResourceCacheStorage } = await import('@floegence/floe-webapp-core/resource-cache');
  const { hostApplicationSnapshot } = await import('../services/envResourceSnapshots');
  state.locale = 'en-US'; state.scope = `browser-host-${crypto.randomUUID()}`;
  const application = { id: 'persisted-editor', name: 'Persisted Editor', description: '', categories: [], icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', custom: false };
  const snapshot = { availability: { supported: true, ready: true }, applications: [application], sessions: [] };
  const writer = createResourceCache({ storage: createIndexedDBResourceCacheStorage('redeven-resource-cache') });
  writer.resource({ scope: state.scope, key: 'host-applications:en-US', version: 1, decode: hostApplicationSnapshot }).set(snapshot);
  await writer.flush(); writer.dispose();
  let resolve!: (value: unknown) => void;
  state.catalog.mockReturnValue(new Promise(done => { resolve = done; }));
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <EnvHostApplicationsPage />, host);
  await expect.poll(() => host.querySelector('.host-app-tile')?.textContent).toContain('Persisted Editor');
  expect(host.querySelector('.host-apps-skeleton')).toBeNull();
  expect(host.querySelector('header .animate-spin')).not.toBeNull();
  expect(host.querySelector<HTMLImageElement>('.host-app-tile img')?.src).toBe(application.icon);
  const row = host.querySelector<HTMLButtonElement>('.host-app-tile')!; row.focus();
  resolve({ ...snapshot, applications: [{ ...application, name: 'Updated Editor' }] });
  await expect.poll(() => row.textContent).toContain('Updated Editor');
  expect(host.querySelector('.host-app-tile')).toBe(row);
  expect(document.activeElement).toBe(row);
  expect(host.querySelector('header .animate-spin')).toBeNull();
});
