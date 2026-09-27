import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { EnvHostApplicationsPage } from './EnvHostApplicationsPage';

const state = vi.hoisted(() => ({ locale: 'en-US' as 'en-US' | 'zh-CN', scope: '', catalog: vi.fn(), setup: vi.fn(), detach: vi.fn() }));
vi.mock('../i18n', async () => {
  const { createTestI18nHelpers } = await import('../i18n/locales/testDictionaries');
  return { useI18n: () => ({ ...createTestI18nHelpers(state.locale), locale: () => state.locale }) };
});
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ permissions: { can_read: true, can_write: true, can_execute: true } }),
  resourceCacheAccess: () => ({ phase: 'ready' as const, generation: 0, scope: state.scope }),
  env_id: () => 'host', localRuntime: () => ({}),
}) }));
vi.mock('../services/hostApplicationsApi', async importOriginal => {
  const app = { id: 'editor.app', name: 'Text Editor', description: '', categories: [], icon: '', custom: false };
  const session = { id: 'shared', application: app, state: 'running', backend: 'macos' };
  return {
    ...await importOriginal<object>(),
    listHostApplications: async () => state.catalog.getMockImplementation() ? state.catalog() : ({ availability: { backend: 'macos', supported: true, ready: true, native_ready: true }, applications: [app], sessions: [session], running: [{ application_id: app.id, instances: ['instance'] }] }),
    listHostApplicationSessions: async () => state.catalog.getMockImplementation() ? (await state.catalog()).sessions : [session],
    listRunningHostApplications: async () => state.catalog.getMockImplementation() ? (await state.catalog()).running ?? [] : [{ application_id: app.id, instances: ['instance'] }],
    getHostApplicationSetup: state.setup,
    observeHostApplicationSetup: async (_callback: unknown, signal: AbortSignal) => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve())),
    detachHostApplication: state.detach,
  };
});

let dispose: (() => void) | undefined;
afterEach(async () => {
  dispose?.();
  document.body.replaceChildren();
  state.detach.mockClear(); state.catalog.mockReset(); state.setup.mockReset(); state.scope = "";
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
    if (width < 768) {
      await userEvent.click(page.getByRole('button', { name: `${locale === 'zh-CN' ? '应用控制' : 'Application controls'} · Text Editor`, exact: true }));
      await userEvent.click(page.getByRole('menuitem', { name: title, exact: true }));
    } else {
    await userEvent.click(page.getByRole('button', { name: `${title} · Text Editor`, exact: true }));
    }
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeTruthy();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await expect.poll(() => getComputedStyle(dialog).opacity).toBe('1');
    const header = dialog.querySelector<HTMLElement>('[data-floe-dialog-header]')!;
    const body = dialog.querySelector<HTMLElement>('[data-floe-dialog-body]')!;
    const footer = dialog.querySelector<HTMLElement>('[data-floe-dialog-footer]')!;
    const description = document.getElementById(dialog.getAttribute('aria-describedby')!)!;
    expect(header.textContent).toBe(title);
    expect(description.parentElement).toBe(body);
    expect(getComputedStyle(description).fontSize).toBe('12px');
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

it.each([390, 1440])('uses the same host header and tile geometry for module and data placeholders at %s px', async width => {
  const { Suspense, lazy } = await import('solid-js');
  const { HostApplicationsPageSkeleton } = await import('./HostApplicationsPresentation');
  state.locale = 'en-US'; state.scope = `host-geometry-${crypto.randomUUID()}`;
  await page.viewport(width, 900);
  let finishModule!: (value: { default: typeof EnvHostApplicationsPage }) => void;
  let finishData!: (value: unknown) => void;
  const LazyPage = lazy(() => new Promise<{ default: typeof EnvHostApplicationsPage }>(resolve => { finishModule = resolve; }));
  state.catalog.mockReturnValue(new Promise(resolve => { finishData = resolve; }));
  const host = document.createElement('div'); host.style.height = '800px'; document.body.append(host);
  dispose = render(() => <Suspense fallback={<HostApplicationsPageSkeleton />}><LazyPage /></Suspense>, host);
  const geometry = () => ['.host-apps-header', '.host-apps-content', '.host-apps-library-heading', '.host-app-session', '.host-app-tile'].map(selector => {
    const rect = host.querySelector(selector)!.getBoundingClientRect(); return { selector, top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  });
  await document.fonts.ready;
  const before = geometry();
  finishModule({ default: EnvHostApplicationsPage });
  await expect.poll(() => host.querySelector('[data-testid="host-applications"]')).toBeTruthy();
  expect(geometry()).toEqual(before);
  const apps = Array.from({ length: 6 }, (_, index) => ({ id: `app-${index}`, name: `Editor ${index}`, description: '', categories: [], icon: '', custom: false }));
  finishData({ availability: { backend: 'macos', native_ready: true, supported: true, ready: true }, applications: apps, sessions: [], running: apps.slice(0, 3).map(app => ({ application_id: app.id, instances: ['process'] })) });
  await expect.poll(() => host.querySelector('button.host-app-tile')).toBeTruthy();
  expect(geometry()).toEqual(before);
});

it('keeps compact running controls and a searchable mobile catalog with stable search across resizing', async () => {
  state.locale = 'en-US'; state.scope = `mobile-host-${crypto.randomUUID()}`;
  await page.viewport(1200, 800);
  const apps = Array.from({ length: 100 }, (_, index) => ({ id: `app-${index}`, name: `Application ${String(index).padStart(3, '0')}`, description: '', categories: ['Development'], icon: '', custom: false }));
  state.catalog.mockResolvedValue({ availability: { backend: 'macos', native_ready: true, supported: true, ready: true }, applications: [...apps, apps[0]], sessions: [{ id: 'starting', application: apps[70], state: 'starting' }], running: [{ application_id: apps[50].id, instances: ['process'] }] });
  const host = document.createElement('div'); host.style.cssText = 'width:393px;height:650px;'; document.body.append(host);
  dispose = render(() => <EnvHostApplicationsPage />, host);
  await expect.poll(() => host.querySelectorAll('button.host-app-tile').length).toBe(100);
  await expect.poll(() => host.querySelector('button.host-app-tile')?.textContent).toContain('Application 050');
  const tiles = [...host.querySelectorAll('button.host-app-tile')];
  expect(tiles[1].textContent).toContain('Application 070');
  const running = host.querySelector<HTMLElement>('.host-apps-running')!.getBoundingClientRect();
  expect(running.height).toBeGreaterThan(0);
  expect(running.height).toBeLessThan(120);
  const search = host.querySelector<HTMLInputElement>('.host-apps-search input')!;
  expect(search.getBoundingClientRect().top).toBeGreaterThanOrEqual(running.bottom);
  expect(search.getBoundingClientRect().top - running.bottom).toBeLessThan(24);
  expect(search.getBoundingClientRect().width).toBeGreaterThanOrEqual(128);
  expect(host.querySelector('.host-apps-header')!.getBoundingClientRect().height).toBeLessThanOrEqual(56);
  search.focus();
  search.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
  search.value = 'Application'; search.setSelectionRange(3, 5);
  search.dispatchEvent(new InputEvent('input', { data: 'Application', isComposing: true }));
  host.style.width = '767px'; await new Promise(resolve => requestAnimationFrame(resolve));
  host.style.width = '768px'; await new Promise(resolve => requestAnimationFrame(resolve));
  expect(host.querySelector('.host-apps-search input')).toBe(search);
  expect(document.activeElement).toBe(search);
  expect(search.selectionStart).toBe(3); expect(search.selectionEnd).toBe(5);
  search.dispatchEvent(new CompositionEvent('compositionend', { data: 'Application' }));
  host.style.width = '320px'; await new Promise(resolve => requestAnimationFrame(resolve));
  await userEvent.click(page.getByRole('button', { name: 'Filter applications', exact: true }));
  await userEvent.click(page.getByRole('menuitem', { name: 'Running applications', exact: true }));
  await expect.poll(() => host.querySelectorAll('button.host-app-tile').length).toBe(2);
  await userEvent.keyboard('{Escape}');
  expect(host.querySelector('.host-apps-filter-count')?.textContent).toBe('1');
  await userEvent.click(page.getByRole('button', { name: 'Filter applications', exact: true }));
  await userEvent.click(page.getByRole('menuitem', { name: 'Clear filters', exact: true }));
  await expect.poll(() => host.querySelectorAll('button.host-app-tile').length).toBe(100);
});


it.each(['macos', 'xpra'])('keeps the %s inventory compact and shares one entry for update and refresh feedback', async backend => {
  state.locale = 'en-US'; state.scope = `host-feedback-${crypto.randomUUID()}`;
  const apps = Array.from({ length: 8 }, (_, index) => ({ id: `application-${index}`, name: `Application ${index}`, description: '', categories: [], icon: '', custom: false }));
  const catalog = { availability: { backend, native_ready: true, supported: true, ready: true }, applications: apps, sessions: [], running: [] };
  const setup = { state: 'ready', received_bytes: 0, expected_bytes: 100, can_cancel: false,
    installed: { id: 'components-r1', digest: 'old', architecture: 'arm64', contract: 'xpra-6-private-v1', ready: true },
    update_available: true, package: { id: 'components-r2', digest: 'new', architecture: 'arm64', size_bytes: 100, installed_bytes: 200 } };
  state.catalog.mockResolvedValue(catalog); state.setup.mockResolvedValue(setup);
  const host = document.createElement('div'); host.style.height = '600px'; document.body.append(host);
  dispose = render(() => <EnvHostApplicationsPage />, host);
  await expect.poll(() => host.querySelectorAll('button.host-app-tile').length).toBe(8);
  const content = host.querySelector<HTMLElement>('.host-apps-content')!;
  const heading = host.querySelector<HTMLElement>('.host-apps-library-heading')!;
  expect(heading.getBoundingClientRect().top - content.getBoundingClientRect().top).toBeCloseTo(parseFloat(getComputedStyle(content).paddingTop), 0);
  const trigger = host.querySelector<HTMLButtonElement>('[data-floe-status-indicator] button')!;
  if (backend === 'macos') {
    expect(state.setup).not.toHaveBeenCalled();
    expect(trigger.getAttribute('aria-hidden')).toBe('true');
  } else {
    await expect.poll(() => trigger.getAttribute('aria-label')).toContain('Component update available');
  }
  const tile = host.querySelector<HTMLButtonElement>('button.host-app-tile')!;
  tile.focus();
  const before = tile.getBoundingClientRect().toJSON();
  state.catalog.mockRejectedValue(new Error('Refresh failed'));
  host.querySelector<HTMLButtonElement>('button[aria-label="Refresh applications"]')!.click();
  await expect.poll(() => trigger.getAttribute('aria-label')).toContain('could not');
  expect(document.activeElement).toBe(tile);
  expect(tile.getBoundingClientRect().toJSON()).toEqual(before);
  await userEvent.click(trigger);
  await expect.poll(() => document.querySelectorAll('[data-floe-status-details] section').length).toBe(backend === 'macos' ? 1 : 2);
  state.catalog.mockResolvedValue(catalog);
  await userEvent.click(page.getByRole('button', { name: 'Retry', exact: true }));
  if (backend === 'xpra') {
    await expect.poll(() => document.querySelectorAll('[data-floe-status-details] section').length).toBe(1);
    expect(trigger.getAttribute('aria-label')).toContain('Component update available');
    state.setup.mockResolvedValue({ ...setup, update_available: false });
    host.querySelector<HTMLButtonElement>('button[aria-label="Refresh applications"]')!.click();
  }
  await expect.poll(() => trigger.getAttribute('aria-hidden')).toBe('true');
  expect(document.querySelector('[data-floe-status-details]')).toBeNull();
  expect(host.querySelector('button.host-app-tile')).toBe(tile);
  expect(tile.getBoundingClientRect().toJSON()).toEqual(before);
});
