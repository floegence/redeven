import '../../index.css';
import { createSignal, type Accessor } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeConfigProvider, builtInShellThemePresets, ThemeProvider, useTheme } from '@floegence/floe-webapp-core';
import { createDefaultWorkbenchState, type WorkbenchState, type WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { I18nProvider } from '../i18n';
import { LocalApiError } from '../services/localApi';
import { EnvPortForwardsPage } from './EnvPortForwardsPage';
import { RedevenWorkbenchSurface } from '../workbench/surface/RedevenWorkbenchSurface';
import { REDEVEN_WORKBENCH_WHEEL_LAYOUT_ONLY_PROPS } from '../workbench/surface/workbenchWheelInteractive';

const api = vi.hoisted(() => ({ fetch: vi.fn(), stream: vi.fn(), open: vi.fn(), notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@floegence/floe-webapp-core', async (original) => ({ ...await original<typeof import('@floegence/floe-webapp-core')>(), useNotification: () => api.notify }));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({ env: Object.assign(() => ({ permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true } }), { state: 'ready' }), env_id: () => 'test-env' }) }));
vi.mock('../services/localApi', async (original) => ({ ...await original<typeof import('../services/localApi')>(), fetchLocalApiJSON: api.fetch, fetchLocalApi: api.stream }));
vi.mock('@floegence/floe-webapp-protocol', () => ({ useProtocol: () => ({ session: () => null }) }));
vi.mock('../protocol/redeven_v1', () => ({ useRedevenRpc: () => ({ fs: { list: async () => ({ entries: [] }) } }) }));
vi.mock('../services/controlplaneApi', async (original) => ({ ...await original<typeof import('../services/controlplaneApi')>(), getLocalRuntime: async () => ({ env_id: 'test-env', desktop_managed: true, local_ui_origin: 'http://127.0.0.1:9000' }), getEnvPublicIDFromSession: () => 'test-env', mintEnvEntryTicketForApp: vi.fn() }));
vi.mock('../services/desktopShellBridge', async (original) => ({ ...await original<typeof import('../services/desktopShellBridge')>(), desktopShellWebServiceWindowOpenAvailable: () => true, openWebServiceWindowInDesktopShell: api.open }));
vi.mock('../services/desktopSessionContext', async (original) => ({ ...await original<typeof import('../services/desktopSessionContext')>(), readDesktopSessionContextSnapshot: () => null }));

const currentRelease = { schema_version: 1, kind: 'oci', source: 'registry.example/workspace', tag: '1.0.0', digest: `sha256:${'a'.repeat(64)}`, platform: 'linux/arm64' };
const candidate = (id: string, relation = 'newer', overrides = {}) => ({ schema_version: 2, candidate_id: id, source_kind: 'oci', source: currentRelease.source, tag: id, digest: `sha256:${'b'.repeat(64)}`, platform: 'linux/arm64', channel: 'stable', trust: 'registry_verified', selectable: true, verification_status: 'verified', relation, ...overrides });
const notice = { id: 'root-access', revision: 2, severity: 'warning', acknowledgement_required: true };
const base = {
  service_id: 'workspace', template_id: 'workspace-template', name: 'Workspace', description: 'Development workspace', template_source: 'builtin', deployment: 'container',
  workspace_path: '/Users/demo/Services/workspace', workspace_ownership: 'redeven_created', desired_state: 'running', observed_state: 'running', status: 'running', primary_action: 'stop', management_state: 'active', forward_id: 'pf-workspace', runtime_port: 3000,
  localizations: { 'en-US': { name: 'Workspace', description: 'Development workspace', notices: { 'root-access': { title: 'Container access', description: 'This version can access the mounted workspace and connect to external services. Only give access to users you trust.' } } } },
  release_status: { schema_version: 2, current_release: currentRelease, recommended_release: currentRelease, check_status: 'fresh' },
  actions: { open: { available: true }, inspect: { available: true }, start: { available: false }, stop: { available: true }, restart: { available: true }, uninstall: { available: true }, retry: { available: false } },
};
const settle = async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); };
const wheel = commands as unknown as { wheelScrollRegion: (options: { regionSelector: string; deltaY: number }) => Promise<{ before: number; after: number }> };

describe('Managed service version drawer', () => {
  let dispose: (() => void) | undefined;
  let service: typeof base;
  let candidates: ReturnType<typeof candidate>[];
  let notices: typeof notice[];
  let accepted: Record<string, number>;
  let failure: string;
  let pendingPlan: boolean;
  let pendingSubmission: boolean;
  let stopFails: boolean;
  let host: HTMLDivElement;
  let attributes: [string, string][];
  let preferences: [string, string][];
  let operations: Record<string, unknown>[];
  let workbenchState: Accessor<WorkbenchState> | undefined;
  beforeEach(() => {
    attributes = Array.from(document.documentElement.attributes, ({ name, value }) => [name, value]);
    preferences = Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)!]);
    localStorage.clear();
    localStorage.setItem('redeven_ui_language_preference', 'en-US');
    service = structuredClone(base);
    candidates = [candidate('1.2.0', 'newer', { is_recommended: true, recommendation_status: 'available', is_latest_stable: true }), candidate('1.1.0'), candidate('1.0.0', 'same', { is_current: true }), ...Array.from({ length: 18 }, (_, index) => candidate(`0.${18 - index}.0`, 'older'))];
    notices = [];
    accepted = {};
    failure = '';
    pendingPlan = pendingSubmission = stopFails = false;
    operations = [];
    workbenchState = undefined;
    api.fetch.mockReset().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/catalog')) return { templates: [] };
      if (url.endsWith('/managed-web-services')) return { services: [service] };
      if (url.endsWith('/forwards')) return { forwards: [] };
      if (url.endsWith('/release-candidates')) return { schema_version: 2, current_release: currentRelease, recommended_release: currentRelease, candidates: [...candidates], catalog_status: 'complete', has_more: false, loaded_count: candidates.length, check_status: 'fresh', checked_at_unix_ms: Date.now() };
      if (url.endsWith('/update-plans')) {
        if (pendingPlan) return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
        const selected = candidates.find((item) => item.candidate_id === JSON.parse(String(options?.body)).target_candidate_id)!;
        return { schema_version: 4, update_plan_id: `plan-${selected.candidate_id}`, current_release: currentRelease, target_release: { ...currentRelease, tag: selected.tag, digest: selected.digest }, notices, accepted_notice_revisions: accepted, risk_ids: selected.relation === 'older' ? ['downgrade'] : [], requires_stopped: ['older', 'unknown'].includes(selected.relation), expires_at_unix_ms: Date.now() + 60_000 };
      }
      if (url.endsWith('/operations')) {
        const request = JSON.parse(String(options?.body));
        operations.push(request);
        if (failure) throw new LocalApiError({ status: 409, code: failure, message: 'Backend details must not be rendered' });
        if (pendingSubmission) return new Promise(() => {});
        if (request.action === 'stop' && !stopFails) service = { ...service, desired_state: 'stopped', observed_state: 'stopped' };
        return { operation_id: `operation-${operations.length}`, service_id: service.service_id, action: request.action, state: stopFails && request.action === 'stop' ? 'failed' : 'succeeded', stage: 'completed', error_code: stopFails ? 'STOP_SCRIPT_FAILED' : undefined };
      }
      throw new Error(`Unexpected test request ${url}`);
    });
    api.notify.success.mockReset();
    api.notify.error.mockReset();
  });
  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
    localStorage.clear();
    for (const [key, value] of preferences) localStorage.setItem(key, value);
    for (const attribute of Array.from(document.documentElement.attributes)) document.documentElement.removeAttribute(attribute.name);
    for (const [name, value] of attributes) document.documentElement.setAttribute(name, value);
  });
  async function mount(width = 1440, dark = false, locale = 'en-US', workbench = false) {
    localStorage.setItem('redeven_ui_language_preference', locale);
    await page.viewport(width, width < 600 ? 780 : 960);
    host = document.createElement('div');
    host.style.cssText = 'height:100vh;width:100%;position:relative;';
    document.body.append(host);
    function Surface() {
      const theme = useTheme();
      theme.selectShellTheme(dark ? 'dark' : 'light', dark ? 'classic-dark' : 'classic-light');
      if (!workbench) return <I18nProvider><EnvPortForwardsPage /></I18nProvider>;
      const definitions: WorkbenchWidgetDefinition[] = [{
        type: 'test.web-services', label: 'Web Services', defaultTitle: 'Web Services', icon: () => null,
        defaultSize: { width: 1100, height: 900 }, renderMode: 'projected_surface',
        body: () => <div {...REDEVEN_WORKBENCH_WHEEL_LAYOUT_ONLY_PROPS} class="redeven-workbench-body-surface h-full min-h-0 overflow-auto"><EnvPortForwardsPage /></div>,
      }];
      const [state, setState] = createSignal<WorkbenchState>({
        ...createDefaultWorkbenchState(definitions), mode: 'work', viewport: { x: 0, y: 0, scale: 0.8 },
        widgets: [{ id: 'services', type: 'test.web-services', title: 'Web Services', x: 80, y: 60, width: 1100, height: 900, z_index: 1, created_at_unix_ms: 1 }],
        selectedWidgetId: 'services', selectedObject: { kind: 'widget', id: 'services' },
      });
      workbenchState = state;
      return <I18nProvider><RedevenWorkbenchSurface state={state} setState={setState} widgetDefinitions={definitions} /></I18nProvider>;
    }
    dispose = render(() => <FloeConfigProvider config={{ theme: { shellPresets: builtInShellThemePresets }, storage: { enabled: false } }}><ThemeProvider><Surface /></ThemeProvider></FloeConfigProvider>, host);
    await expect.poll(() => document.querySelector('[data-testid="managed-service-version"]')).toBeTruthy();
    await userEvent.click(document.querySelector<HTMLButtonElement>('[data-testid="managed-service-version"]')!);
    await expect.poll(() => document.querySelector('[data-release-id="1.2.0"]')).toBeTruthy();
    if (!workbench) await expect.poll(() => Math.round(document.querySelector('.managed-service-version-drawer')!.getBoundingClientRect().right)).toBe(width);
  }
  const submit = () => document.querySelector<HTMLButtonElement>('[data-testid="managed-release-submit"]')!;
  async function select(id = '1.2.0') {
    await userEvent.click(document.querySelector<HTMLButtonElement>(`[data-release-id="${id}"]`)!);
    if (!pendingPlan) await expect.poll(() => document.querySelector('[data-testid="managed-update-plan"]')).toBeTruthy();
    await settle();
  }
  function assertGeometry() {
    const panel = document.querySelector<HTMLElement>('.managed-service-version-drawer')!;
    const body = document.querySelector<HTMLElement>('[data-testid="managed-release-drawer-body"]')!;
    const footer = document.querySelector<HTMLElement>('[data-testid="managed-release-footer"]')!;
    const scroll = document.querySelector<HTMLElement>('[data-testid="managed-release-candidate-scroll"]')!;
    expect(body.querySelectorAll('[data-redeven-workbench-wheel-role="local-scroll-viewport"]')).toHaveLength(1);
    expect(scroll.clientHeight).toBeGreaterThan(180);
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(submit().getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    expect(getComputedStyle(scroll).overflowY).toBe('auto');
  }
  async function screenshot(name: string) {
    await settle();
    const directory = import.meta.env.VITE_REDEVEN_VERSION_SCREENSHOTS;
    if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
    else expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1000);
  }

  for (const dark of [false, true]) for (const width of [1440, 390]) it(`keeps a clear single-screen update at ${width}px in ${dark ? 'dark' : 'light'} mode`, async () => {
    await mount(width, dark);
    await select();
    assertGeometry();
    expect(submit().textContent).toContain('Update to 1.2.0');
    expect(submit().disabled).toBe(false);
    expect(operations).toHaveLength(0);
    await screenshot(`update-${width}-${dark ? 'dark' : 'light'}`);
    const footer = document.querySelector<HTMLElement>('[data-testid="managed-release-footer"]')!;
    const bottom = footer.getBoundingClientRect().bottom;
    const result = await wheel.wheelScrollRegion({ regionSelector: '[data-testid="managed-release-candidate-scroll"]', deltaY: 500 });
    expect(result.after).toBeGreaterThan(result.before);
    expect(footer.getBoundingClientRect().bottom).toBe(bottom);
    await userEvent.click(submit());
    await expect.poll(() => document.querySelector('[data-testid="managed-release-drawer-body"]')).toBeNull();
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ action: 'update', update_plan_id: 'plan-1.2.0', accepted_notice_revisions: {} });
  });

  it('scrolls locally in the real projected Workbench without moving its canvas or footer', async () => {
    await mount(1440, false, 'en-US', true);
    await select();
    assertGeometry();
    const viewport = { ...workbenchState!().viewport };
    const footer = document.querySelector<HTMLElement>('[data-testid="managed-release-footer"]')!;
    const footerBottom = footer.getBoundingClientRect().bottom;
    const scroll = await wheel.wheelScrollRegion({ regionSelector: '[data-testid="managed-release-candidate-scroll"]', deltaY: 420 });
    expect(scroll.after).toBeGreaterThan(scroll.before);
    expect(workbenchState!().viewport).toEqual(viewport);
    expect(footer.getBoundingClientRect().bottom).toBe(footerBottom);
    await wheel.wheelScrollRegion({ regionSelector: '[data-testid="managed-release-candidate-scroll"]', deltaY: -420 });
    await screenshot('workbench-update');
    expect(submit().disabled).toBe(false);
    await userEvent.click(submit());
    expect(operations).toHaveLength(1);
    await expect.poll(() => document.querySelector('[data-testid="managed-release-drawer-body"]')).toBeNull();
    expect(workbenchState!().viewport).toEqual(viewport);
  });

  it('shows only newly required confirmations and keeps them across version changes', async () => {
    notices = [notice];
    await mount(390);
    await select();
    expect(submit().disabled).toBe(true);
    await screenshot('new-notice-narrow');
    await userEvent.click(document.querySelector<HTMLInputElement>('[data-testid="managed-update-plan"] input')!.closest('label')!);
    expect(submit().disabled).toBe(false);
    await select('1.1.0');
    expect(document.querySelector<HTMLInputElement>('[data-testid="managed-update-plan"] input')?.checked).toBe(true);
    expect(submit().disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLButtonElement>('[data-testid="managed-release-footer"] button[aria-label="Refresh"]')!);
    await settle();
    expect(document.querySelector<HTMLInputElement>('[data-testid="managed-update-plan"] input')?.checked).toBe(true);
    await userEvent.click(submit());
    expect(operations[0].accepted_notice_revisions).toEqual({ 'root-access': 2 });
  });

  it('does not repeat a previously saved confirmation', async () => {
    notices = [notice]; accepted = { 'root-access': 2 };
    await mount(); await select();
    expect(document.querySelector('[data-testid="managed-update-plan"] input')).toBeNull();
    expect(submit().disabled).toBe(false);
    await userEvent.click(submit());
    expect(operations[0].accepted_notice_revisions).toEqual({});
  });

  it('stops in place, retains the selection, and waits for an explicit downgrade', async () => {
    await mount(); await select('0.18.0');
    expect(submit().textContent).toBe('Stop service');
    await screenshot('stop-before-downgrade');
    await userEvent.click(submit());
    await expect.poll(() => submit().textContent).toBe('Downgrade to 0.18.0');
    expect(operations.map((item) => item.action)).toEqual(['stop']);
    expect(document.querySelector('[data-release-id="0.18.0"]')?.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-testid="managed-release-impact"]')?.textContent).toContain('remain stopped');
    await userEvent.click(submit());
    expect(operations.map((item) => item.action)).toEqual(['stop', 'update']);
  });

  it('retains a failed stop and never attempts the update', async () => {
    stopFails = true;
    await mount(); await select('0.18.0');
    await userEvent.click(submit());
    await expect.poll(() => submit().textContent).toBe('Stop service');
    expect(document.querySelector('[data-testid="managed-release-footer"] [role="alert"]')).toBeTruthy();
    expect(operations.map((item) => item.action)).toEqual(['stop']);
  });

  it('keeps submission failures in place with the accepted new notice', async () => {
    notices = [notice]; failure = 'OPERATION_CONFLICT';
    await mount(); await select();
    await userEvent.click(document.querySelector<HTMLInputElement>('[data-testid="managed-update-plan"] input')!.closest('label')!);
    await userEvent.click(submit());
    await expect.poll(() => document.querySelector('[data-testid="managed-release-footer"] [role="alert"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Backend details');
    expect(document.querySelector<HTMLInputElement>('[data-testid="managed-update-plan"] input')?.checked).toBe(true);
    await screenshot('submission-failure');
    failure = '';
    await userEvent.click(submit());
    await expect.poll(() => document.querySelector('[data-testid="managed-release-drawer-body"]')).toBeNull();
  });

  it('keeps the list and dismissal usable while verifying', async () => {
    pendingPlan = true;
    await mount(390); await select();
    expect(submit().textContent).toBe('Verifying selected version…');
    expect(submit().disabled).toBe(true);
    assertGeometry();
    await screenshot('verifying-narrow');
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('[data-testid="managed-release-drawer-body"]')).toBeNull();
    expect(operations).toHaveLength(0);
  });

  it('prevents duplicate submissions while awaiting backend admission', async () => {
    pendingSubmission = true;
    await mount(); await select();
    await userEvent.click(submit());
    expect(submit().disabled).toBe(true);
    submit().click();
    expect(operations).toHaveLength(1);
    expect(document.querySelector('[data-testid="managed-release-drawer-body"]')).toBeTruthy();
  });

  it('supports radio keyboard selection and long translated copy', async () => {
    candidates[0] = candidate('1.2.0', 'newer', { tag: '1.2.0-development-with-a-long-release-identifier' });
    await mount(390, true, 'de-DE');
    const first = document.querySelector<HTMLButtonElement>('[data-release-id="1.2.0"]')!;
    first.focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(() => document.querySelector('[data-release-id="1.1.0"]')?.getAttribute('aria-checked')).toBe('true');
    await userEvent.keyboard('{ArrowUp}');
    await expect.poll(() => document.querySelector('[data-testid="managed-update-plan"]')).toBeTruthy();
    assertGeometry();
    await screenshot('long-version-german-dark');
  });
  it('clears unsaved confirmations when the drawer is closed', async () => {
    notices = [notice];
    await mount(); await select();
    await userEvent.click(document.querySelector<HTMLInputElement>('[data-testid="managed-update-plan"] input')!.closest('label')!);
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('[data-testid="managed-release-drawer-body"]')).toBeNull();
    await userEvent.click(document.querySelector<HTMLButtonElement>('[data-testid="managed-service-version"]')!);
    await expect.poll(() => document.querySelector('[data-release-id="1.2.0"]')).toBeTruthy();
    await select();
    expect(document.querySelector<HTMLInputElement>('[data-testid="managed-update-plan"] input')?.checked).toBe(false);
    expect(submit().disabled).toBe(true);
  });

  it('reprepares a stale plan but never resubmits without another click', async () => {
    failure = 'UPDATE_PLAN_STALE';
    await mount(); await select();
    await userEvent.click(submit());
    await expect.poll(() => api.fetch.mock.calls.filter(([url]) => url.endsWith('/update-plans')).length).toBe(2);
    expect(operations).toHaveLength(1);
    expect(document.querySelector('[data-testid="managed-release-footer"]')?.textContent).toContain('Check the refreshed details');
    expect(document.querySelector('[data-release-id="1.2.0"]')?.getAttribute('aria-checked')).toBe('true');
    failure = '';
    await userEvent.click(submit());
    expect(operations).toHaveLength(2);
  });

  it('keeps unavailable versions disabled and does not prepare them', async () => {
    candidates[0] = candidate('1.2.0', 'newer', { selectable: false, verification_status: 'unavailable', reason_code: 'PLATFORM_UNAVAILABLE' });
    await mount();
    expect(document.querySelector<HTMLButtonElement>('[data-release-id="1.2.0"]')?.disabled).toBe(true);
    expect(submit().disabled).toBe(true);
    expect(api.fetch.mock.calls.some(([url]) => url.endsWith('/update-plans'))).toBe(false);
  });

  it('labels a moved image tag as replacement and preserves the stop requirement', async () => {
    candidates[0] = candidate('1.2.0', 'unknown', { tag: 'latest', tag_moved: true });
    service = { ...service, desired_state: 'stopped', observed_state: 'stopped' };
    await mount(); await select();
    expect(submit().textContent).toBe('Replace image: latest');
    expect(submit().disabled).toBe(false);
  });

  it('uses the same inline preparation for npm Host updates', async () => {
    service = { ...service, deployment: 'host', release_status: { ...service.release_status, current_release: { ...currentRelease, kind: 'npm' } } };
    candidates[0] = candidate('1.2.0', 'newer', { source_kind: 'npm', version: '1.2.0', integrity: 'sha512-exact-release' });
    await mount(); await select();
    expect(submit().textContent).toBe('Update to 1.2.0');
    await userEvent.click(submit());
    expect(operations[0]).toMatchObject({ action: 'update' });
  });

});
