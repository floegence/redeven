import '../../index.css';
import { render } from 'solid-js/web';
import { FloeConfigProvider, builtInShellThemePresets, ThemeProvider, useTheme } from '@floegence/floe-webapp-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { I18nProvider } from '../i18n';
import { SUPPORTED_LOCALES } from '../i18n/localeMeta';
import { EnvPortForwardsPage } from './EnvPortForwardsPage';

const api = vi.hoisted(() => ({ fetch: vi.fn(), stream: vi.fn(), open: vi.fn(), notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@floegence/floe-webapp-core', async (original) => ({ ...await original<typeof import('@floegence/floe-webapp-core')>(), useNotification: () => api.notify }));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({ env: Object.assign(() => ({ permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true } }), { state: 'ready' }), env_id: () => 'test-env' }) }));
vi.mock('../services/localApi', async (original) => ({ ...await original<typeof import('../services/localApi')>(), fetchLocalApiJSON: api.fetch, fetchLocalApi: api.stream }));
vi.mock('@floegence/floe-webapp-protocol', () => ({ useProtocol: () => ({ session: () => null }) }));
vi.mock('../protocol/redeven_v1', () => ({ useRedevenRpc: () => ({ fs: { list: async () => ({ entries: [] }) } }) }));
vi.mock('../services/controlplaneApi', async (original) => ({ ...await original<typeof import('../services/controlplaneApi')>(), getLocalRuntime: async () => ({ env_id: 'test-env', desktop_managed: true, local_ui_origin: 'http://127.0.0.1:9000' }), getEnvPublicIDFromSession: () => 'test-env', mintEnvEntryTicketForApp: vi.fn() }));
vi.mock('../services/desktopShellBridge', async (original) => ({ ...await original<typeof import('../services/desktopShellBridge')>(), desktopShellWebServiceWindowOpenAvailable: () => true, openWebServiceWindowInDesktopShell: api.open }));
vi.mock('../services/desktopSessionContext', async (original) => ({ ...await original<typeof import('../services/desktopSessionContext')>(), readDesktopSessionContextSnapshot: () => null }));

const base = {
  service_id: 'sample-running', template_id: 'sample', name: 'Example dashboard',
  template_source: 'builtin', deployment: 'host', workspace_path: '/Users/demo/Services/dashboard', workspace_ownership: 'redeven_created',
  desired_state: 'running', observed_state: 'running', status: 'running', primary_action: 'stop', management_state: 'active',
  forward_id: 'pf-running', runtime_port: 3000, access_mode: 'desktop_loopback',
  release_status: { schema_version: 2, current_release: { schema_version: 1, kind: 'npm', source: '@example/dashboard', version: '1.0.0' }, check_status: 'pending' },
  actions: { open: { available: true }, inspect: { available: true }, start: { available: false }, stop: { available: true }, restart: { available: true }, uninstall: { available: true }, retry: { available: false } },
};
const retained = { ...base, name: 'Example workspace', deployment: 'container', service_id: 'sample-cleanup', status: 'uninstall_pending', primary_action: 'inspect', observed_state: 'missing', problem_code: 'RESOURCE_IN_USE', workspace_path: '/Users/demo/Services/workspace', forward_id: 'pf-cleanup', actions: { ...base.actions, open: { available: false } } };
const saved = { forward_id: 'saved', name: 'Local dashboard', description: '', target_url: 'http://localhost:3002', access_mode: 'desktop_loopback', created_at_unix_ms: 1, updated_at_unix_ms: 1, last_opened_at_unix_ms: Date.now(), health: { status: 'healthy', last_checked_at_unix_ms: Date.now(), latency_ms: 8, last_error: '' } };
const settle = async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); };
const media = commands as unknown as {
  emulateMediaPreferences: (value: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void>;
  inspectWebServicesZoom: () => Promise<{ devicePixelRatio: number; viewportWidth: number; cssWidth: number; pixelWidth: number; surfaceOverflow: number; mainOverflow: number; overflow: string[] }>;
};

describe('Web Services product interaction', () => {
  let dispose: (() => void) | undefined;
  let records: (typeof base & { problem_code?: string })[];
  let failRefresh = false;
  let host: HTMLDivElement;
  let rootAttributes: [string, string][];
  let storedPreferences: [string, string][];
  beforeEach(() => {
    rootAttributes = Array.from(document.documentElement.attributes, ({ name, value }) => [name, value]);
    storedPreferences = Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)!]);
    localStorage.clear();
    localStorage.setItem('redeven_ui_language_preference', 'en-US');
    records = [base, retained, { ...base, service_id: 'sample-archive', name: 'Archived dashboard', management_state: 'detached', status: 'detached', primary_action: 'inspect' }];
    failRefresh = false;
    api.open.mockReset().mockResolvedValue({ ok: true });
    api.stream.mockReset();
    api.fetch.mockReset().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/catalog')) return { templates: [] };
      if (url.endsWith('/managed-web-services')) { if (failRefresh) throw new Error('offline'); return { services: records }; }
      if (url.endsWith('/forwards')) { if (failRefresh) throw new Error('offline'); return { forwards: [saved] }; }
      if (url.endsWith('/management-plans')) {
        const request = JSON.parse(String(options?.body));
        return { plan_digest: 'reviewed-plan', request, path: request.action, blockers: [], facts: { presence: 'absent', runtime: 'stopped', ownership: 'verified', checked_at_unix_ms: Date.now(), resources: [{ resource_id: 'data', kind: 'volume', identity: 'example-volume', presence: 'present', ownership: 'verified', references: [{ container_id: 'other-container', name: 'Other workspace', state: 'running' }] }] } };
      }
      if (url.endsWith('/open-session')) return { state: 'ready', forward: { ...saved, forward_id: 'pf-running' }, app_path: '/' };
      if (url.endsWith('/touch')) return {};
      if (url.endsWith('/operations')) {
        const action = JSON.parse(String(options?.body)).action;
        records = records.filter((item) => item.service_id !== 'sample-cleanup');
        return { operation_id: 'test-operation', service_id: 'sample-cleanup', action, stage: 'completed', state: 'succeeded' };
      }
      throw new Error(`Unexpected test API: ${url}`);
    });
  });
  afterEach(async () => {
    dispose?.();
    document.body.replaceChildren();
    localStorage.clear();
    for (const [key, value] of storedPreferences) localStorage.setItem(key, value);
    // ThemeProvider clears token overrides but intentionally leaves the selected mode on the root.
    for (const attribute of Array.from(document.documentElement.attributes)) document.documentElement.removeAttribute(attribute.name);
    for (const [name, value] of rootAttributes) document.documentElement.setAttribute(name, value);
    await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  });
  async function mount(width = 1120, preset = 'classic-light') {
    await page.viewport(1440, 960);
    host = document.createElement('div');
    host.style.cssText = `width:${width}px;height:840px;position:relative;`;
    document.body.append(host);
    function Surface() { const theme = useTheme(); theme.selectShellTheme(preset === 'classic-dark' ? 'dark' : 'light', preset); return <I18nProvider><EnvPortForwardsPage /></I18nProvider>; }
    dispose = render(() => <FloeConfigProvider config={{ theme: { shellPresets: builtInShellThemePresets }, storage: { enabled: false } }}><ThemeProvider><Surface /></ThemeProvider></FloeConfigProvider>, host);
    await expect.poll(() => host.querySelectorAll('[data-testid="managed-service-row"]').length).toBe(records.filter((item) => item.management_state === 'active').length);
    await settle();
  }
  function assertLayout() {
    const surface = host.querySelector<HTMLElement>('.web-services')!;
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    for (const row of host.querySelectorAll<HTMLElement>('[data-testid="managed-service-row"], [data-testid="port-forward-row"]')) {
      const bounds = row.getBoundingClientRect();
      for (const child of row.querySelectorAll<HTMLElement>('button, [data-testid="managed-service-status"], [data-testid="managed-service-notice"]')) {
        const rect = child.getBoundingClientRect();
        expect(rect.left, child.textContent ?? '').toBeGreaterThanOrEqual(bounds.left - 1);
        expect(rect.right, child.textContent ?? '').toBeLessThanOrEqual(bounds.right + 1);
        expect(rect.bottom, child.textContent ?? '').toBeLessThanOrEqual(bounds.bottom + 1);
        expect(child.scrollWidth, child.textContent ?? '').toBeLessThanOrEqual(child.clientWidth + 1);
      }
    }
    const main = host.querySelector<HTMLElement>('main')!;
    expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth + 1);
  }

  for (const locale of SUPPORTED_LOCALES) it(`keeps ${locale} copy readable in compact surfaces and at 200% zoom`, async () => {
    localStorage.setItem('redeven_ui_language_preference', locale);
    await mount();
    await expect.poll(() => document.documentElement.lang).toBe(locale);
    for (const width of [360, 480, 680, 1024]) { host.style.width = `${width}px`; await settle(); assertLayout(); }
    host.style.width = '480px';
    await settle();
    const zoom = await media.inspectWebServicesZoom();
    expect(zoom.devicePixelRatio).toBe(2);
    expect(zoom.viewportWidth).toBe(720);
    expect(zoom.cssWidth).toBe(480);
    expect(zoom.pixelWidth).toBe(1440);
    expect(zoom.surfaceOverflow).toBeLessThanOrEqual(1);
    expect(zoom.mainOverflow).toBeLessThanOrEqual(1);
    expect(zoom.overflow).toEqual([]);
  });

  for (const preset of ['classic-light', 'classic-dark', 'solarized-light']) it(`renders the normal and exception hierarchy in ${preset}`, async () => {
    await mount(1120, preset);
    assertLayout();
    expect((await page.screenshot({ element: host, save: false })).length).toBeGreaterThan(1_000);
  });

  for (const [status, problem] of [['inspection_unavailable', 'ENGINE_NOT_RUNNING'], ['confirmation_required', 'HOST_PROCESS_IDENTITY_MISMATCH'], ['recovery_required', 'INSTANCE_MISSING']]) it(`opens the reviewed next step for ${status}`, async () => {
    records = [{ ...retained, deployment: 'compose', status, problem_code: problem }];
    await mount(360);
    assertLayout();
    await userEvent.click(page.getByRole('button', { name: 'Example workspace: Review and resolve', exact: true }));
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeTruthy();
    await expect.poll(() => api.fetch.mock.calls.some(([url]) => String(url).endsWith('/management-plans'))).toBe(true);
    expect(document.querySelector('[data-testid="service-management-footer"]')).toBeTruthy();
  });

  it('keeps loaded services visible after refresh failure and preserves their order', async () => {
    await mount();
    const before = [...host.querySelectorAll('[data-managed-service-id]')].map((row) => row.getAttribute('data-managed-service-id'));
    failRefresh = true;
    await userEvent.click(page.getByTestId('web-services-refresh'));
    await expect.poll(() => host.textContent).toContain('The latest check did not complete');
    expect([...host.querySelectorAll('[data-managed-service-id]')].map((row) => row.getAttribute('data-managed-service-id'))).toEqual(before);
    expect(host.querySelector('[data-testid="port-forward-row"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="managed-service-more"]')?.closest('[data-floe-dropdown-trigger]')?.getAttribute('aria-disabled')).not.toBe('true');
    failRefresh = false;
    await userEvent.click(page.getByTestId('web-services-refresh'));
    await expect.poll(() => host.querySelector('.web-services-refresh-error')).toBeNull();
  });

  it('opens archives with the keyboard and returns to the service collection', async () => {
    await mount();
    const archives = page.getByRole('button', { name: 'Archives', exact: true });
    (archives.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(() => document.activeElement?.getAttribute('role')).toBe('menuitem');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => host.querySelector('#web-services-collection-title')?.textContent).toBe('Detached services');
    expect(host.textContent).toContain('Archived dashboard');
    expect(host.querySelector('.web-service-open')).toBeNull();
    await userEvent.click(page.getByRole('button', { name: 'Back to services' }));
    await expect.poll(() => host.querySelectorAll('[data-managed-service-id]').length).toBe(records.filter((item) => item.management_state === 'active').length);
  });

  it('reviews an exception in the same sidebar, confirms its plan, and focuses the remaining collection', async () => {
    await mount(680);
    await userEvent.click(page.getByRole('button', { name: 'Example workspace: Review and resolve', exact: true }));
    await expect.poll(() => document.querySelector('[data-testid="service-management-footer"]')).toBeTruthy();
    expect(host.querySelector('[data-selected="true"]')?.textContent).toContain('Example workspace');
    const footer = document.querySelector<HTMLElement>('[data-testid="service-management-footer"]')!;
    expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(960);
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
    await userEvent.click(page.getByRole('button', { name: 'Keep data and complete uninstall', exact: true }));
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeNull();
    await expect.poll(() => host.querySelectorAll('[data-managed-service-id]').length).toBe(1);
    expect(api.fetch.mock.calls.find(([url]) => String(url).endsWith('/operations'))?.[1].body).toContain('reviewed-plan');
    await expect.poll(() => host.contains(document.activeElement)).toBe(true);
  });

  it('shows request acceptance and completion without blocking other services or repeating a start', async () => {
    records = records.map((item) => item.service_id === base.service_id ? { ...item, status: 'stopped', observed_state: 'stopped', primary_action: 'start', actions: { ...item.actions, start: { available: true } } } : item);
    const original = api.fetch.getMockImplementation()!;
    let accept!: (value: unknown) => void;
    const pending = new Promise((resolve) => { accept = resolve; });
    api.fetch.mockImplementation((url: string, options?: RequestInit) => url.endsWith('/operations') ? pending : original(url, options));
    await mount();
    const start = page.getByRole('button', { name: 'Example dashboard: Start', exact: true });
    await userEvent.click(start);
    await expect.poll(() => host.querySelector('[data-managed-service-id="sample-running"] [data-testid="managed-service-status"]')?.textContent).toBe('Submitting request…');
    expect((start.element() as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="web-services-refresh"]')?.disabled).toBe(false);
    await userEvent.click(page.getByRole('button', { name: 'Example workspace: Review and resolve', exact: true }));
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    records = records.map((item) => item.service_id === base.service_id ? base : item);
    accept({ operation_id: 'started', service_id: base.service_id, action: 'start', state: 'succeeded', stage: 'completed', progress_current: 3, progress_total: 3 });
    await expect.poll(() => host.querySelector('[data-managed-service-id="sample-running"] [data-testid="managed-service-status"]')?.textContent).toBe('Running');
    expect(api.fetch.mock.calls.filter(([url]) => String(url).endsWith('/operations'))).toHaveLength(1);
  });

  it('keeps a rejected request in recent operation details while retaining the observed running state', async () => {
    const original = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation((url: string, options?: RequestInit) => url.endsWith('/operations') ? Promise.reject(new Error('The operation request was not accepted.')) : original(url, options));
    await mount();
    await userEvent.click(page.getByRole('button', { name: 'Example dashboard: Stop', exact: true }));
    await expect.poll(() => host.querySelector('[data-testid="managed-operation-terminal-icon"]')).toBeTruthy();
    expect(host.querySelector('[data-managed-service-id="sample-running"] [data-testid="managed-service-status"]')?.textContent).toBe('Running');
    await userEvent.click(page.getByTestId('managed-service-operation-trigger'));
    await expect.poll(() => host.textContent).toContain('The request did not complete. Check the service before trying again.');
    expect(host.textContent).not.toContain('The operation request was not accepted.');
    expect((page.getByRole('button', { name: 'Example dashboard: Stop', exact: true }).element() as HTMLButtonElement).disabled).toBe(false);
  });

  it('allows independent opens and coalesces repeated clicks for one service', async () => {
    let finishOpen!: (value: { ok: boolean }) => void;
    const first = new Promise<{ ok: boolean }>((resolve) => { finishOpen = resolve; });
    api.open.mockReturnValueOnce(first).mockResolvedValue({ ok: true });
    await mount();
    const managed = host.querySelector<HTMLButtonElement>('[data-managed-service-id="sample-running"] .web-service-open button')!;
    await userEvent.click(managed);
    await expect.poll(() => api.open.mock.calls.length).toBe(1);
    expect(managed.disabled).toBe(true);
    const other = host.querySelector<HTMLButtonElement>('[data-testid="port-forward-row"] .web-service-open button')!;
    expect(other.disabled).toBe(false);
    await userEvent.click(other);
    await expect.poll(() => api.open.mock.calls.length).toBe(2);
    finishOpen({ ok: true });
    await expect.poll(() => managed.disabled).toBe(false);
  });

  it('keeps reviewed content intact during the sidebar exit', async () => {
    await mount();
    await userEvent.click(page.getByRole('button', { name: 'Example workspace: Review and resolve', exact: true }));
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')?.textContent).toContain('example-volume');
    await new Promise((resolve) => setTimeout(resolve, 260));
    await userEvent.keyboard('{Escape}');
    const exiting = document.querySelector('[data-testid="service-management-drawer"]');
    if (exiting) {
      expect(exiting.textContent).toContain('/Users/demo/Services/workspace');
      expect(exiting.textContent).toContain('example-volume');
    }
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeNull();
  });

  it('restores the selected trigger and removes motion when reduced motion is requested', async () => {
    await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    await mount(480);
    const trigger = host.querySelector<HTMLButtonElement>('[data-managed-service-id="sample-cleanup"] [data-testid="managed-service-primary"]')!;
    await userEvent.click(trigger);
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.activeElement).toBe(trigger);
    expect(getComputedStyle(host.querySelector('.web-service-notice')!).animationName).toBe('none');
    expect((await page.screenshot({ element: host, save: false })).length).toBeGreaterThan(1_000);
  });
});
