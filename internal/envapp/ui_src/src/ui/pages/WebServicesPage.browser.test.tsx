import { bindTestSessionHTTP } from '../../test/sessionHTTPFixture';
import '../../index.css';
import { createRoot } from 'solid-js';
import { createManagedServiceSession, type ManagedServiceSession } from '../services/managedServiceSession';
import { render } from 'solid-js/web';
import { FloeConfigProvider, builtInShellThemePresets, ThemeProvider, useTheme } from '@floegence/floe-webapp-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import { I18nProvider } from '../i18n';
import { SUPPORTED_LOCALES } from '../i18n/localeMeta';
import { EnvPortForwardsPage } from './EnvPortForwardsPage';
import { LocalApiError } from '../services/localApi';
import type { ManagedOperation } from './managedServiceOperationController';

const api = vi.hoisted(() => ({ fetch: vi.fn(), stream: vi.fn(), open: vi.fn(), session: undefined as ManagedServiceSession | undefined, notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@floegence/floe-webapp-core', async (original) => ({ ...await original<typeof import('@floegence/floe-webapp-core')>(), useNotification: () => api.notify }));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({ managedServiceSession: api.session, env: Object.assign(() => ({ permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true } }), { state: 'ready' }), env_id: () => 'test-env' }) }));
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
  actions: { recover: {available:false}, open: { available: true }, inspect: { available: true }, start: { available: false }, stop: { available: true }, restart: { available: true }, uninstall: { available: true }, retry: { available: false } },
};
const retained = { ...base, name: 'Example workspace', deployment: 'container', service_id: 'sample-cleanup', status: 'uninstall_pending', primary_action: 'inspect', observed_state: 'missing', problem_code: 'RESOURCE_IN_USE', workspace_path: '/Users/demo/Services/workspace', forward_id: 'pf-cleanup', actions: { ...base.actions, open: { available: false }, recover: { available: true } } };
const saved = { forward_id: 'saved', name: 'Local dashboard', description: '', target_url: 'http://localhost:3002', access_mode: 'desktop_loopback', created_at_unix_ms: 1, updated_at_unix_ms: 1, last_opened_at_unix_ms: Date.now(), health: { status: 'healthy', last_checked_at_unix_ms: Date.now(), latency_ms: 8, last_error: '' } };
const settle = async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); };
const media = commands as unknown as {
  emulateMediaPreferences: (value: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void>;
  inspectWebServicesZoom: () => Promise<{ devicePixelRatio: number; viewportWidth: number; cssWidth: number; pixelWidth: number; surfaceOverflow: number; mainOverflow: number; overflow: string[] }>;
};

describe('Web Services product interaction', () => {
  let dispose: (() => void) | undefined;
  let disposeSession: (() => void) | undefined;
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
      if (url.endsWith('/inspection')) { const id=url.split('/').at(-2); return {...records.find(item=>item.service_id===id),facts:{presence:'present',runtime:'running',ownership:'verified',checked_at_unix_ms:Date.now(),resources:[{ resource_id:'data',kind:'volume',identity:'example-volume',presence:'present',ownership:'verified',references:[] }]}}; }
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
    disposeSession?.(); disposeSession = undefined; api.session = undefined;
    document.body.replaceChildren();
    localStorage.clear();
    for (const [key, value] of storedPreferences) localStorage.setItem(key, value);
    // ThemeProvider clears token overrides but intentionally leaves the selected mode on the root.
    for (const attribute of Array.from(document.documentElement.attributes)) document.documentElement.removeAttribute(attribute.name);
    for (const [name, value] of rootAttributes) document.documentElement.setAttribute(name, value);
    await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  });
  function unmountPage() { dispose?.(); dispose = undefined; host.remove(); }
  async function mount(width = 1120, preset = 'classic-light') {
    await page.viewport(1440, 960);
    host = document.createElement('div');
    host.style.cssText = `width:${width}px;height:840px;position:relative;`;
    document.body.append(host);
    function Surface() { const theme = useTheme(); theme.selectShellTheme((preset.endsWith('dark') || preset === 'soft-black') ? 'dark' : 'light', preset); return <I18nProvider><EnvPortForwardsPage /></I18nProvider>; }
    dispose = render(() => <FloeConfigProvider config={{ theme: { shellPresets: builtInShellThemePresets }, storage: { enabled: false } }}><ThemeProvider><Surface /></ThemeProvider></FloeConfigProvider>, host);
    await expect.poll(() => host.querySelectorAll('[data-testid="managed-service-row"]').length).toBe(records.filter((item) => item.management_state === 'active').length);
    await settle();
  }
  function installFixture(requiredNotice = false) {
    const template = {
      template_id: 'compact-harness', service_family_id: 'compact-harness', name: 'Example Harness', description: 'Run Example Harness directly in this Environment.', source: 'custom', deployment: 'host', revision: 1,
      duplicateable: true, editable: false, available: true, developer_preview: true, deployments: [{deployment: 'host', available: true}],
      recommended_release: {schema_version: 1, kind: 'npm', source: '@example/harness', version: '0.2.0-rc.2'},
      default_workspace_path: '/Users/demo/Redeven/workspaces/managed-services/example-harness-host', workspace_roots: [{id: 'home', label: 'Home', path: '/Users/demo'}],
      default_access_mode: 'desktop_loopback', source_url: 'https://example.com/harness',
      localizations: {'en-US': {name: 'Example Harness', description: 'Run Example Harness directly in this Environment.', notices: {'trusted-workspace': {title: 'Use a trusted workspace', description: 'The service can modify the selected files.'}}}},
      notices: requiredNotice ? [{id: 'trusted-workspace', revision: 1, severity: 'warning', acknowledgement_required: true, title: 'Use a trusted workspace', description: 'The service can modify the selected files.'}] : [],
      spec: {schema_version: 7, kind: 'host', endpoint: {scheme: 'http'}, host: {npm: {package_name: '@example/harness', version: '0.2.0-rc.2', registry_url: 'https://registry.npmjs.org/', executable: 'harness'}, start_script: 'exec harness'}},
    };
    const normalFetch = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/market-catalog')) return {items: [], stale: false, generation: 1, checked_at: Date.now()};
      if (url.endsWith('/catalog')) return {templates: [template]};
      if (url.endsWith('/install-plans')) {
        const request = JSON.parse(String(options?.body));
        return {service_id: 'compact-install', expires_at_unix_ms: Date.now() + 60000, plan_digest: 'compact-reviewed', workspace_path: request.workspace_path === template.default_workspace_path ? request.workspace_path + '/instance' : request.workspace_path};
      }
      if (url.endsWith('/release-candidates')) return {schema_version: 2, check_status: 'fresh', catalog_status: 'complete', has_more: false, loaded_count: 1, candidates: [{schema_version: 2, candidate_id: 'recommended', source_kind: 'npm', source: '@example/harness', version: '0.2.0-rc.2', channel: 'preview', trust: 'registry_verified', selectable: true, verification_status: 'verified', is_recommended: true, recommendation_status: 'available', relation: 'same'}]};
      return normalFetch(url, options);
    });
    return template;
  }
  async function openInstall() {
    await userEvent.click(page.getByTestId('service-templates-button'));
    await userEvent.click(page.getByTestId('market-collection-library'));
    await expect.poll(() => document.querySelector('[data-testid="service-template-primary"]')).toBeTruthy();
    await userEvent.click(page.getByTestId('service-template-primary'));
    await expect.poll(() => document.querySelector('[data-testid="managed-install-form"]')).toBeTruthy();
    const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
    await Promise.allSettled(panel.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
    await document.fonts.ready;
    return panel;
  }
  for (const width of [1440, 900, 640, 390]) it(`keeps template actions consistent through deployment and version selection at ${width}px`, async () => {
    installFixture();
    await mount(Math.min(width, 1120));
    await page.viewport(width, 960);
    await userEvent.click(page.getByTestId('service-templates-button'));
    await userEvent.click(page.getByTestId('market-collection-library'));
    const catalogDeploy = page.getByTestId('service-template-primary');
    await expect.element(catalogDeploy).toBeVisible();
    const catalogButton = document.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')!;
    const expectedHeight = width < 640 ? 44 : 36;
    expect(catalogButton.getBoundingClientRect().height).toBe(expectedHeight);
    if (width >= 640) {
      expect(catalogButton.getBoundingClientRect().width).toBeGreaterThanOrEqual(112);
      expect(catalogButton.getBoundingClientRect().width).toBeLessThanOrEqual(160);
    }
    const catalogButtonWidth = catalogButton.getBoundingClientRect().width;
    await userEvent.click(catalogDeploy);
    await expect.element(page.getByTestId('managed-install-submit')).toBeEnabled();
    const submit = document.querySelector<HTMLButtonElement>('[data-testid="managed-install-submit"]')!;
    expect(submit.getBoundingClientRect().height).toBe(expectedHeight);
    if (width >= 640) expect(submit.getBoundingClientRect().width).toBe(catalogButtonWidth);
    const back = page.getByRole('button', {name: 'Back to templates', exact: true});
    expect(document.querySelector('.service-install-footer button')!.getBoundingClientRect().height).toBe(expectedHeight);
    await userEvent.click(page.elementLocator(document.querySelector<HTMLButtonElement>('[data-testid="managed-install-version"] button')!));
    await expect.element(page.getByTestId('managed-release-footer')).toBeVisible();
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-testid="managed-release-footer"] button')) {
      expect(button.getBoundingClientRect().height).toBe(expectedHeight);
    }
    await userEvent.keyboard('{Escape}');
    await userEvent.click(back);
    await expect.element(catalogDeploy).toBeVisible();
    expect(document.querySelector('[data-testid="managed-install-form"]')).toBeNull();
    expect(api.fetch.mock.calls.filter(([url, options]) => String(url).endsWith('/managed-web-services') && options?.method === 'POST')).toHaveLength(0);
  });
  it('returns to the selected template with keyboard focus after reviewing deployment', async () => {
    const first = installFixture();
    const second = {...first, template_id: 'second-harness', service_family_id: 'second-harness', name: 'Second Harness', localizations: {'en-US': {...first.localizations['en-US'], name: 'Second Harness'}}};
    const normalFetch = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation((url: string, options?: RequestInit) => url.endsWith('/catalog') ? Promise.resolve({templates: [first, second]}) : normalFetch(url, options));
    await mount();
    await userEvent.click(page.getByTestId('service-templates-button'));
    await userEvent.click(page.getByTestId('market-collection-library'));
    await userEvent.click(page.getByRole('option', {name: /Second Harness/}));
    await userEvent.click(page.getByTestId('service-template-primary'));
    await expect.element(page.getByTestId('managed-install-submit')).toBeEnabled();
    await userEvent.click(page.getByRole('button', {name: 'Back to templates', exact: true}));
    const selected = document.querySelector<HTMLElement>('[data-testid="service-template-row"][aria-selected="true"]')!;
    expect(selected.dataset.templateId).toBe(second.template_id);
    expect(document.activeElement).toBe(selected);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.querySelector('[data-testid="service-template-details"]')?.getAttribute('data-template-id')).toBe(first.template_id);
  });
  for (const preset of ['classic-light', 'classic-dark', 'porcelain-light', 'porcelain-dark']) for (const width of [1440, 390]) {
    const locale = width === 390 ? 'de-DE' : preset.endsWith('dark') ? 'zh-TW' : 'zh-CN';
    it(`keeps installation focused and keyboard accessible in ${preset} at ${width}px ${locale}`, async () => {
      localStorage.setItem('redeven_ui_language_preference', locale);
      const template = installFixture();
      await mount(Math.min(width, 1120), preset);
      await page.viewport(width, 960);
      const panel = await openInstall();
      const form = panel.querySelector<HTMLElement>('[data-testid="managed-install-form"]')!;
      const details = panel.querySelector<HTMLDetailsElement>('[data-testid="managed-install-options"]')!;
      const workspace = panel.querySelector<HTMLElement>('[data-testid="managed-workspace-path"]')!;
      expect(form.textContent?.split('0.2.0-rc.2')).toHaveLength(2);
      expect(form.innerText).not.toContain(template.description);
      expect(details.open).toBe(false);
      expect(details.querySelector<HTMLElement>('fieldset')!.checkVisibility()).toBe(false);
      expect(workspace.textContent).toBe(template.default_workspace_path + '/instance');
      expect(workspace.scrollWidth).toBeLessThanOrEqual(workspace.clientWidth + 1);
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
      expect(panel.getBoundingClientRect().width).toBeLessThanOrEqual(width === 390 ? 390 : 672);
      const submit = panel.querySelector<HTMLElement>('[data-testid="managed-install-submit"]')!;
      expect(submit.getBoundingClientRect().bottom).toBeLessThanOrEqual(960);
      const audit = async () => {
        const result = await axe.run(panel);
        expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({id: v.id, targets: v.nodes.map(n => n.target)}))).toEqual([]);
      };
      await audit();
      const directory = import.meta.env.VITE_REDEVEN_MANAGEMENT_EVIDENCE_DIR;
      if (directory) await page.screenshot({path: `${directory}/install-compact-${width}-${preset}-${locale}.png`});
      details.querySelector('summary')!.focus();
      await userEvent.keyboard('{Enter}');
      expect(details.open).toBe(true);
      const radios = details.querySelectorAll<HTMLInputElement>('input[type="radio"]');
      expect(radios).toHaveLength(2);
      expect(radios[1].checked).toBe(true);
      radios[1].focus();
      await userEvent.keyboard('{ArrowLeft}');
      await expect.poll(() => radios[0].checked).toBe(true);
      expect(document.activeElement).toBe(radios[0]);
      expect(details.querySelector('.service-install-options__value')?.textContent).toBe(radios[0].closest('label')?.textContent);
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
      await audit();
      if (directory) await page.screenshot({path: `${directory}/install-options-${width}-${preset}-${locale}.png`});
      await userEvent.click(page.elementLocator(panel.querySelector<HTMLButtonElement>('[data-testid="managed-install-version"] button')!));
      await expect.poll(() => document.querySelector('[data-testid="managed-release-candidates"]')).toBeTruthy();
      expect(document.querySelector('[data-release-id="recommended"]')).toBeTruthy();
      await userEvent.keyboard('{Escape}');
      await expect.poll(() => document.querySelector('[data-testid="managed-release-candidates"]')).toBeNull();
      expect(workspace.textContent).toBe(template.default_workspace_path + '/instance');
    });
  }
  for (const locale of SUPPORTED_LOCALES) it(`keeps the complete install form usable at 320px in ${locale}`, async () => {
    localStorage.setItem('redeven_ui_language_preference', locale);
    await media.emulateMediaPreferences({reducedMotion: 'reduce'});
    installFixture(true);
    await mount(320, 'porcelain-dark');
    await page.viewport(320, 720);
    const panel = await openInstall();
    const details = panel.querySelector<HTMLDetailsElement>('[data-testid="managed-install-options"]')!;
    details.querySelector('summary')!.focus();
    await userEvent.keyboard('{Enter}');
    const assertContained = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect();
      expect(bounds.left, element.textContent ?? '').toBeGreaterThanOrEqual(-1);
      expect(bounds.right, element.textContent ?? '').toBeLessThanOrEqual(321);
      expect(element.scrollWidth, element.textContent ?? '').toBeLessThanOrEqual(element.clientWidth + 1);
    };
    for (const element of panel.querySelectorAll<HTMLElement>('.service-install, .service-install-field__heading, [data-testid="managed-workspace-path"], [role="radiogroup"], [data-floe-choice-variant], [data-testid="managed-install-submit"]')) assertContained(element);
    const submit = panel.querySelector<HTMLElement>('[data-testid="managed-install-submit"]')!;
    expect(submit.getBoundingClientRect().bottom).toBeLessThanOrEqual(720);
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    const consent = panel.querySelector<HTMLElement>('[data-testid="managed-template-notices"]')!;
    consent.scrollIntoView({block: 'nearest'});
    await settle();
    expect(consent.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(consent.getBoundingClientRect().bottom).toBeLessThan(submit.getBoundingClientRect().top);
    expect(details.open).toBe(true);
  });
  it('prepares the chosen mode after consent and deploys with one click', async () => {
    const template = installFixture(true);
    const normalFetch = api.fetch.getMockImplementation()!;
    let resolvePlan!: (value: unknown) => void;
    const plan = new Promise(resolve => {resolvePlan = resolve;});
    const operation = {operation_id: 'compact-install', service_id: 'compact-install', action: 'install', state: 'succeeded', stage: 'completed', progress_current: 7, progress_total: 7};
    api.stream.mockResolvedValue(new Response(`event: snapshot\ndata: ${JSON.stringify(operation)}\n\n`, {headers: {'Content-Type': 'text/event-stream'}}));
    api.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/install-plans')) return plan;
      if (url.endsWith('/managed-web-services') && options?.method === 'POST') return {service: {...base, service_id: operation.service_id, template_id: template.template_id}, operation};
      return normalFetch(url, options);
    });
    await mount();
    const panel = await openInstall();
    const submit = panel.querySelector<HTMLButtonElement>('[data-testid="managed-install-submit"]')!;
    const notice = panel.querySelector<HTMLElement>('[data-testid="managed-template-notices"]')!;
    expect(notice.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(notice.closest('details')).toBeNull();
    expect(submit.disabled).toBe(true);
    await userEvent.click(page.elementLocator(notice.querySelector<HTMLInputElement>('input[type=checkbox]')!.closest('label')!));
    expect(submit.disabled).toBe(true);
    const details = panel.querySelector<HTMLDetailsElement>('[data-testid="managed-install-options"]')!;
    details.querySelector('summary')!.focus();
    await userEvent.keyboard('{Enter}');
    const radios = details.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    radios[1].focus(); await userEvent.keyboard('{ArrowLeft}');
    await expect.poll(() => api.fetch.mock.calls.filter(([url]) => String(url).endsWith('/install-plans')).length).toBe(2);
    expect(submit.disabled).toBe(true);
    expect(document.querySelector('[data-testid="managed-install-form"]')).toBeTruthy();
    expect(api.fetch.mock.calls.filter(([url]) => String(url).endsWith('/install-plans')).at(-1)?.[1]?.body).toContain('"access_mode":"unified_proxy"');
    expect(api.fetch.mock.calls.filter(([url, options]) => String(url).endsWith('/managed-web-services') && options?.method === 'POST')).toHaveLength(0);
    resolvePlan({service_id: operation.service_id, expires_at_unix_ms: Date.now() + 60000, plan_digest: 'compact-reviewed', workspace_path: template.default_workspace_path + '/instance'});
    await expect.poll(() => submit.disabled).toBe(false);
    expect(submit.textContent).toBe('Deploy');
    expect(submit.disabled).toBe(false);
    expect(panel.querySelector('[data-testid="managed-workspace-path"]')?.textContent).toBe(template.default_workspace_path + '/instance');
    await userEvent.click(page.elementLocator(submit));
    await expect.poll(() => document.querySelector('[data-testid="managed-install-form"]')).toBeNull();
    const requests = api.fetch.mock.calls.filter(([url, options]) => String(url).endsWith('/managed-web-services') && options?.method === 'POST');
    expect(requests).toHaveLength(1);
    expect(JSON.parse(String(requests[0][1]?.body))).toMatchObject({access_mode: 'unified_proxy', accepted_notice_revisions: {'trusted-workspace': 1}, plan_digest: 'compact-reviewed'});
  });
  for (const kind of ['host', 'container', 'compose'] as const) for (const width of [1120, 390]) {
    it(`deploys a discovered ${kind} directly with stable preparation and retry at ${width}px`, async () => {
      const seed = installFixture();
      const template = {...seed, source: 'git', deployment: kind, service_family_id: 'market-' + kind, template_id: 'market-' + kind,
        default_workspace_path: '/Users/demo/Services/market-' + kind,
        deployments: [{deployment: kind, available: true}],
        recommended_release: kind === 'host' ? seed.recommended_release : undefined,
        spec: kind === 'host' ? seed.spec : {schema_version: 7, kind, endpoint: {scheme: 'http', container_port: 8080},
          ...(kind === 'container' ? {container: {image: 'example/service:1'}} : {compose: {main_service: 'web', yaml: 'services:\n  web:\n    image: example/service:1\n'}})},
      };
      const source = {repository: 'owner/services', repository_id: 123, ref: 'main', path: 'templates/' + kind, commit_sha: 'a'.repeat(40)};
      const preview = {candidate_id: 'review-' + kind, sha256: 'b'.repeat(64), expected_sha256: '', template: {...template, git_source: source}, files: [], affected_service_ids: [], source_document_version: 4, source_spec_version: 7};
      const item = {template_id: template.template_id, document_template_id: kind, service_family_id: template.service_family_id, revision: 1, source, sha256: preview.sha256, deployment: kind, default_locale: 'en-US', localizations: {'en-US': {name: 'Market ' + kind, description: 'Discovered deployment'}}, classification: 'official', status: 'available'};
      const normalFetch = api.fetch.getMockImplementation()!;
      let rejectSource!: (reason: unknown) => void;
      let resolveSource!: (value: unknown) => void;
      let attempts = 0;
      let resolveReceipt!: (value: unknown) => void;
      let requests = 0;
      const receipt = new Promise(resolve => { resolveReceipt = resolve; });
      api.fetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url.endsWith('/market-catalog')) return Promise.resolve({items: [item], stale: false, generation: 1, checked_at: Date.now()});
        if (url.endsWith('/catalog')) return Promise.resolve({templates: []});
        if (url.endsWith('/source-previews')) {
          attempts++;
          return new Promise((resolve, reject) => {resolveSource = resolve; rejectSource = reject;});
        }
        if (url.endsWith('/managed-web-services') && options?.method === 'POST') { requests++; return receipt; }
        return normalFetch(url, options);
      });
      await mount(width, 'porcelain-dark'); await page.viewport(width, 800);
      await userEvent.click(page.getByTestId('service-templates-button'));
      await userEvent.click(page.getByTestId('service-template-primary'));
      await expect.element(page.getByTestId('managed-install-preparing')).toBeVisible();
      const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
      await Promise.allSettled(panel.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
      const submit = document.querySelector<HTMLButtonElement>('[data-testid="managed-install-submit"]')!;
      const bounds = submit.getBoundingClientRect();
      expect(submit.textContent).toBe('Deploy'); expect(submit.disabled).toBe(true);
      expect(panel.innerText).not.toContain('Review template'); expect(panel.innerText).not.toContain('Continue to deployment');
      expect(panel.innerText).not.toContain('Loading');
      rejectSource(new TypeError('offline'));
      await expect.element(page.getByTestId('managed-install-blocker')).toBeVisible();
      const blocker = document.querySelector<HTMLElement>('[data-testid="managed-install-blocker"]')!;
      const rect = blocker.getBoundingClientRect();
      expect(getComputedStyle(blocker).borderTopWidth).toBe('1px');
      expect(rect.bottom).toBeLessThan(submit.getBoundingClientRect().top);
      expect(rect.top).toBeGreaterThan(panel.getBoundingClientRect().top);
      expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(width);
      expect(blocker.scrollWidth).toBeLessThanOrEqual(blocker.clientWidth + 1);
      const retry = blocker.querySelector<HTMLButtonElement>('button')!;
      const retryRect = retry.getBoundingClientRect();
      expect(document.elementFromPoint(retryRect.x + retryRect.width / 2, retryRect.y + retryRect.height / 2)?.closest('button')).toBe(retry);
      const evidence = import.meta.env.VITE_REDEVEN_MANAGEMENT_EVIDENCE_DIR;
      if (evidence) await page.screenshot({path: `${evidence}/market-${kind}-${width}-source-failed.png`});
      await userEvent.click(page.elementLocator(retry));
      expect(submit.getBoundingClientRect().bottom).toBe(bounds.bottom);
      expect(submit.getBoundingClientRect().width).toBe(bounds.width);
      resolveSource(preview);
      await expect.element(page.getByTestId('managed-install-submit')).toBeEnabled();
      expect(attempts).toBe(2); expect(requests).toBe(0);
      expect(submit.getBoundingClientRect().bottom).toBe(bounds.bottom);
      expect(submit.getBoundingClientRect().width).toBe(bounds.width);
      expect(document.querySelector('[data-testid="managed-install-blocker"]')).toBeNull();
      const sourceDetails = document.querySelector<HTMLDetailsElement>('[data-testid="managed-install-source"]')!;
      await userEvent.click(page.elementLocator(sourceDetails.querySelector('summary')!));
      expect(sourceDetails.open).toBe(true); expect(sourceDetails.textContent).toContain(source.commit_sha);
      expect((await axe.run(panel)).violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
      if (evidence) await page.screenshot({path: `${evidence}/market-${kind}-${width}-prepared.png`});
      await userEvent.click(page.elementLocator(submit));
      await expect.element(page.getByTestId('managed-install-submission')).toBeVisible();
      expect(document.querySelector('[data-testid="managed-install-form"]')).toBeNull();
      expect(requests).toBe(1);
      const operation = {operation_id: 'market-operation', service_id: 'compact-install', action: 'install', state: 'succeeded', stage: 'completed', progress_current: 7, progress_total: 7};
      const service = {...base, ...template, service_id: 'compact-install'};
      records = [service];
      api.stream.mockResolvedValue(new Response(`event: snapshot\ndata: ${JSON.stringify(operation)}\n\n`, {headers: {'Content-Type': 'text/event-stream'}}));
      resolveReceipt({service, operation});
      await expect.poll(() => document.querySelector('[data-testid="managed-service-row"][data-managed-service-id="compact-install"]')).toBeTruthy();
      await expect.poll(() => document.querySelector('[data-testid="managed-install-submission"]')).toBeNull();
      expect(requests).toBe(1);
      await userEvent.click(page.getByTestId('service-templates-button'));
      const installed = page.getByTestId('service-template-primary');
      await expect.element(installed).toBeDisabled();
      expect(document.querySelector(`[data-template-id="${template.template_id}"]`)?.getAttribute('data-template-state')).toBe('installed');
      expect(attempts).toBe(2);
      const installedPanel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
      await Promise.allSettled(installedPanel.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
      expect(installedPanel.textContent).not.toContain('Loading');
      const installedButton = document.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')!.getBoundingClientRect();
      expect(installedButton.left).toBeGreaterThanOrEqual(0);
      expect(installedButton.right).toBeLessThanOrEqual(width);
      expect(installedButton.bottom).toBeLessThanOrEqual(800);
      if (evidence) await page.screenshot({path: `${evidence}/market-${kind}-${width}-installed.png`});
      await userEvent.click(page.getByTestId('service-template-more'));
      await userEvent.click(page.getByRole('menuitem', {name: 'Open', exact: true}));
      await expect.poll(() => api.open.mock.calls.length).toBe(1);
      expect(api.fetch).toHaveBeenCalledWith('/_redeven_proxy/api/managed-web-services/compact-install/open-session', expect.objectContaining({method: 'POST'}));
      expect(attempts).toBe(2); expect(requests).toBe(1);
    });
  }

  it('shows failed preparation without deploying or moving the footer', async () => {
    installFixture();
    const normalFetch = api.fetch.getMockImplementation()!;
    let attempts = 0;
    api.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/install-plans') && attempts++ === 0) throw new TypeError('offline');
      return normalFetch(url, options);
    });
    await mount(390, 'porcelain-dark');
    await page.viewport(390, 720);
    const panel = await openInstall();
    const submit = panel.querySelector<HTMLButtonElement>('[data-testid="managed-install-submit"]')!;
    const feedback = panel.querySelector<HTMLElement>('[data-testid="managed-install-blocker"]')!;
    expect(submit.disabled).toBe(true);
    expect(feedback.textContent).toContain('Could not check this deployment. Try again.');
    const before = submit.getBoundingClientRect();
    await userEvent.click(page.elementLocator(feedback.querySelector<HTMLButtonElement>('button')!));
    await expect.poll(() => submit.disabled).toBe(false);
    expect(panel.querySelector('[data-testid="managed-install-blocker"]')).toBeNull();
    expect(submit.getBoundingClientRect().bottom).toBe(before.bottom);
    expect(submit.getBoundingClientRect().width).toBe(before.width);
    expect(attempts).toBe(2);
    expect(api.fetch.mock.calls.filter(([url, options]) => String(url).endsWith('/managed-web-services') && options?.method === 'POST')).toHaveLength(0);
    expect((await axe.run(panel)).violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });

  for (const [width, preset, locale, reducedMotion] of [
    [1120, 'classic-light', 'en-US', false], [360, 'classic-dark', 'zh-CN', true],
    [480, 'classic-light', 'de-DE', false], [1120, 'classic-dark', 'zh-TW', false],
  ] as const) it(`hands installation from the real drawer to the list at ${width} in ${preset} ${locale}`, async () => {
    localStorage.setItem('redeven_ui_language_preference', locale);
    await media.emulateMediaPreferences({reducedMotion: reducedMotion ? 'reduce' : 'no-preference'});
    const template = {
      template_id: 'handoff-template', service_family_id: 'handoff-template', name: 'Handoff dashboard', description: 'Dashboard service', source: 'custom', deployment: 'host', revision: 1,
      duplicateable: true, editable: true, available: true, developer_preview: false, notices: [], deployments: [{deployment: 'host', available: true}],
      default_workspace_path: '/Users/demo/Services/handoff', workspace_roots: [{id: 'home', label: 'Home', path: '/Users/demo'}],
      spec: {schema_version: 7, kind: 'host', endpoint: {scheme: 'http'}, host: {start_script: 'exec true'}},
    };
    const operation: ManagedOperation = {operation_id: 'install-browser', service_id: 'install-browser-service', action: 'install', state: 'running', stage: 'release_validation', progress_current: 0, progress_total: 7};
    let resolveReceipt!: (value: unknown) => void;
    let installed = false;
    let admitted = false;
    let resolveCollection!: (value: unknown) => void;
    const collection = new Promise(resolve => { resolveCollection = resolve; });
    const receipt = new Promise(resolve => { resolveReceipt = resolve; });
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const normalFetch = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/catalog')) return {templates: [template]};
      if (url.endsWith('/install-plans')) return {service_id: operation.service_id, expires_at_unix_ms: Date.now() + 60000, plan_digest: 'reviewed-install', workspace_path: template.default_workspace_path + '/instance'};
      if (url.endsWith('/managed-web-services') && options?.method === 'POST') return receipt;
      if (url.endsWith('/managed-web-services')) { if (admitted && !installed) return collection; return {services: records}; }
      return normalFetch(url, options);
    });
    api.stream.mockImplementation(async () => new Response(new ReadableStream({start(controller) { streamController = controller; controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(operation)}\n\n`)); }}), {headers: {'Content-Type': 'text/event-stream'}}));
    await mount(width, preset);
    const search = host.querySelector<HTMLInputElement>('[data-testid="web-services-search"] input');
    if (search) { search.value = 'unrelated filter'; search.dispatchEvent(new Event('input', {bubbles: true})); }
    await userEvent.click(page.getByTestId('service-templates-button'));
    await userEvent.click(page.getByTestId('market-collection-library'));
    await expect.poll(() => document.querySelector('[data-testid="service-template-primary"]')).toBeTruthy();
    await userEvent.click(page.getByTestId('service-template-primary'));
    const submit = document.querySelector<HTMLButtonElement>('[data-testid="managed-install-submit"]');
    expect(submit).toBeTruthy();
    await expect.poll(() => api.fetch.mock.calls.some(([url]) => String(url).endsWith('/install-plans'))).toBe(true);
    await expect.poll(() => submit!.disabled).toBe(false);
    const startedAt = performance.now();
    await userEvent.click(page.elementLocator(submit!));
    await expect.poll(() => host.querySelector('[data-testid="managed-install-submission"]')).toBeTruthy();
    expect(performance.now() - startedAt).toBeLessThan(1000);
    await expect.poll(() => document.querySelector('[data-testid="service-template-drawer"]')).toBeNull();
    expect(document.querySelector('[data-testid="service-management-drawer"]')).toBeNull();
    expect(search?.value ?? '').toBe('');
    const pendingRow = host.querySelector<HTMLElement>('[data-testid="managed-install-submission"]')!;
    await expect.poll(() => pendingRow.contains(document.activeElement)).toBe(true);
    admitted = true;
    resolveReceipt({service: {service_id: operation.service_id, template_id: template.template_id, workspace_path: template.default_workspace_path + '/instance', observed_state: 'installing'}, operation});
    await expect.poll(() => pendingRow.querySelector('[aria-expanded]')).toBeTruthy();
    expect(host.querySelector('[data-testid="managed-install-submission"]')).toBe(pendingRow);
    await userEvent.click(page.elementLocator(pendingRow.querySelector<HTMLButtonElement>('[aria-expanded]')!));
    expect(pendingRow.querySelector('[data-testid="managed-operation-disclosure"]')).toBeTruthy();
    assertLayout();
    const directory = (import.meta as unknown as { env: Record<string, string> }).env.VITE_REDEVEN_MANAGEMENT_EVIDENCE_DIR;
    if (directory) await page.screenshot({path: `${directory}/install-handoff-${width}-${preset}-${locale}.png`});
    installed = true;
    resolveCollection({services: [...records, {...base, service_id: operation.service_id, template_id: template.template_id, name: template.name, observed_state: 'installing', status: 'installing', active_operation: operation}]});
    await expect.poll(() => host.querySelector(`[data-testid="managed-service-row"][data-managed-service-id="${operation.service_id}"]`)).toBeTruthy();
    expect(host.querySelector('[data-testid="managed-install-submission"]')).toBeNull();
    const row = host.querySelector(`[data-managed-service-id="${operation.service_id}"]`)!;
    expect(row.querySelector('[aria-expanded="true"]')).toBeTruthy();
    await expect.poll(() => row.contains(document.activeElement)).toBe(true);
    expect(api.fetch.mock.calls.filter(([url, init]) => String(url).endsWith('/managed-web-services') && init?.method === 'POST')).toHaveLength(1);
    expect(api.open).not.toHaveBeenCalled();
    streamController?.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify({...operation, state: 'succeeded', stage: 'completed', progress_current: 7})}\n\n`));
    streamController?.close();
    await expect.poll(() => { assertLayout(); return true; }).toBe(true);
  });

  it('keeps the compact collection flush with its list region', async () => {
    await mount();
    const list = host.querySelector('[data-testid="unified-web-services-list"]')!;
    const region = host.querySelector('[data-testid="web-services-list-region"]')!;
    expect(list.getBoundingClientRect().top).toBe(region.getBoundingClientRect().top);
  });
  function assertLayout() {
    const surface = host.querySelector<HTMLElement>('.web-services')!;
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    for (const row of host.querySelectorAll<HTMLElement>('[data-testid="managed-service-row"], [data-testid="port-forward-row"]')) {
      const bounds = row.getBoundingClientRect();
      for (const child of row.querySelectorAll<HTMLElement>('button, [data-testid="managed-service-status"], [data-testid="managed-service-notice"]')) {
        if (!child.getClientRects().length) continue;
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
    await userEvent.click(page.getByRole('button', { name: 'Example workspace: Details and diagnostics', exact: true }));
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeTruthy();
    await expect.poll(() => api.fetch.mock.calls.some(([url]) => String(url).endsWith('/inspection'))).toBe(true);
    expect(document.querySelector('[data-testid="service-management-footer"]')).toBeTruthy();
  });

  it('keeps loaded services visible after refresh failure and preserves their order', async () => {
    await mount();
    const before = [...host.querySelectorAll('[data-managed-service-id]')].map((row) => row.getAttribute('data-managed-service-id'));
    const row = host.querySelector('[data-managed-service-id]')!;
    const geometry = row.getBoundingClientRect().toJSON();
    failRefresh = true;
    await userEvent.click(page.getByTestId('web-services-refresh'));
    await expect.poll(() => host.textContent).toContain('The latest check did not complete');
    expect([...host.querySelectorAll('[data-managed-service-id]')].map((row) => row.getAttribute('data-managed-service-id'))).toEqual(before);
    expect(host.querySelector('[data-testid="port-forward-row"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="managed-service-more"]')?.closest('[data-floe-dropdown-trigger]')?.getAttribute('aria-disabled')).not.toBe('true');
    expect(row.getBoundingClientRect().toJSON()).toEqual(geometry);
    const indicator = host.querySelector<HTMLButtonElement>('[data-floe-status-indicator] button')!;
    await userEvent.click(indicator);
    await expect.poll(() => document.querySelector('[data-floe-status-details]')?.textContent).toContain('offline');
    failRefresh = false;
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Retry', exact: true }));
    await expect.poll(() => indicator.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('[data-managed-service-id]')).toBe(row);
    expect(row.getBoundingClientRect().toJSON()).toEqual(geometry);
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
    await userEvent.click(page.getByRole('button', { name: 'Example workspace: Details and diagnostics', exact: true }));
    await expect.poll(() => document.querySelector('[data-testid="service-management-footer"]')).toBeTruthy();
    expect(host.querySelector('[data-selected="true"]')?.textContent).toContain('Example workspace');
    const footer = document.querySelector<HTMLElement>('[data-testid="service-management-footer"]')!;
    expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(960);
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
    await userEvent.click(page.getByRole('button', { name: 'Other actions', exact: true }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Uninstall', exact: true }));
    await userEvent.click(page.getByRole('button', { name: 'Keep data and complete uninstall', exact: true }));
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeNull();
    await expect.poll(() => host.querySelectorAll('[data-managed-service-id]').length).toBe(1);
    expect(api.fetch.mock.calls.find(([url]) => String(url).endsWith('/operations'))?.[1].body).toContain('reviewed-plan');
    await expect.poll(() => host.contains(document.activeElement)).toBe(true);
  });

  it('keeps uninstall submission and execution visible after closing its drawer', async () => {
    records = [base];
    let accept!: (operation: ManagedOperation) => void;
    const receipt = new Promise<ManagedOperation>(resolve => { accept = resolve; });
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let signal: AbortSignal | null | undefined;
    api.stream.mockImplementation(async (_url: string, options?: RequestInit) => {
      signal = options?.signal;
      return new Response(new ReadableStream<Uint8Array>({start(controller) { stream = controller; }}), {headers: {'Content-Type': 'text/event-stream'}});
    });
    const original = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation((url: string, options?: RequestInit) => url.endsWith('/operations') ? receipt : original(url, options));
    await mount();
    await userEvent.click(page.getByRole('button', {name: 'Example dashboard: More', exact: true}));
    await userEvent.click(page.getByRole('menuitem', {name: 'Uninstall', exact: true}));
    await userEvent.click(page.getByRole('button', {name: 'Keep data and complete uninstall', exact: true}));
    await expect.poll(() => api.fetch.mock.calls.filter(([url]) => String(url).endsWith('/operations')).length).toBe(1);
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeNull();
    const row = host.querySelector<HTMLElement>('[data-managed-service-id="sample-running"]')!;
    await expect.poll(() => row.querySelector('[data-testid="managed-service-status"]')?.textContent).not.toBe('Running');
    expect((page.getByRole('button', {name: 'Example dashboard: Stop', exact: true}).element() as HTMLButtonElement).disabled).toBe(true);
    const running: ManagedOperation = {operation_id: 'background-uninstall', service_id: base.service_id, action: 'uninstall', state: 'running', stage: 'stopping', progress_current: 1, progress_total: 3};
    accept(running);
    await expect.poll(() => api.stream.mock.calls.length).toBe(1);
    await userEvent.click(page.elementLocator(row.querySelector<HTMLButtonElement>('.web-service-status-trigger')!));
    await expect.poll(() => row.querySelector('[data-testid="managed-operation-disclosure"]')?.textContent).toContain('Uninstall');
    expect(signal?.aborted).toBe(false);
    records = [];
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({...running, state: 'succeeded', stage: 'completed', progress_current: 3})}\n\n`));
    stream.close();
    await expect.poll(() => host.querySelector('[data-managed-service-id="sample-running"]')).toBeNull();
    expect(api.fetch.mock.calls.some(([url]) => String(url).endsWith('/cancel'))).toBe(false);
  });

  it.each(['host', 'container', 'compose'])('keeps %s uninstall admission and completion across page unmounts', async deployment => {
    createRoot(dispose => {
      disposeSession = dispose;
      api.session = createManagedServiceSession({env_id: () => 'test-env'}, {streamFailedMessage: () => 'Observation unavailable',});
    });
    records = [{...base, deployment}];
    let accept!: (value: ManagedOperation) => void;
    const receipt = new Promise<ManagedOperation>(resolve => { accept = resolve; });
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let signal: AbortSignal | null | undefined;
    api.stream.mockImplementation(async (_url: string, options?: RequestInit) => {
      signal = options?.signal;
      return new Response(new ReadableStream<Uint8Array>({start(controller) {stream = controller;}}), {headers: {'Content-Type': 'text/event-stream'}});
    });
    const original = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation((url: string, options?: RequestInit) => url.endsWith('/operations') ? receipt : original(url, options));
    await mount(680);
    await userEvent.click(page.getByRole('button', {name: 'Example dashboard: More', exact: true}));
    await userEvent.click(page.getByRole('menuitem', {name: 'Uninstall', exact: true}));
    await userEvent.click(page.getByRole('button', {name: 'Keep data and complete uninstall', exact: true}));
    await expect.poll(() => api.fetch.mock.calls.filter(([url]) => String(url).endsWith('/operations')).length).toBe(1);
    unmountPage();
    expect(api.session!.operations.operationForService(base.service_id)?.state).toBe('submitting');
    const running: ManagedOperation = {operation_id: 'background-uninstall', service_id: base.service_id, action: 'uninstall', state: 'running', stage: 'stopping', progress_current: 1, progress_total: 3};
    accept(running);
    await expect.poll(() => api.stream.mock.calls.length).toBe(1);
    await mount(680);
    const row = host.querySelector<HTMLElement>('[data-managed-service-id="sample-running"]')!;
    expect(row.querySelector('[data-testid="managed-service-status"]')?.textContent).toBe('Stopping');
    expect((page.getByRole('button', {name: 'Example dashboard: Stop', exact: true}).element() as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(page.elementLocator(row.querySelector<HTMLButtonElement>('.web-service-status-trigger')!));
    await expect.poll(() => row.querySelector('[data-testid="managed-operation-disclosure"]')?.textContent).toContain('Uninstall');
    const evidence = (import.meta as ImportMeta & {env: Record<string, string>}).env.VITE_REDEVEN_MANAGEMENT_EVIDENCE_DIR;
    if (evidence) await page.screenshot({path: `${evidence}/background-uninstall-${deployment}.png`});
    unmountPage();
    expect(signal?.aborted).toBe(false);
    records = [];
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({...running, state: 'succeeded', stage: 'completed', progress_current: 3})}\n\n`)); stream.close();
    await expect.poll(() => api.session!.managedResource.data()?.length).toBe(0);
    await mount(680);
    expect(host.querySelector('[data-managed-service-id="sample-running"]')).toBeNull();
    expect(api.fetch.mock.calls.filter(([url]) => String(url).endsWith('/operations'))).toHaveLength(1);
    expect(api.fetch.mock.calls.some(([url]) => String(url).endsWith('/cancel'))).toBe(false);
  });

  it('keeps pending install admission across view replacement', async () => {
    createRoot(dispose => {
      disposeSession = dispose;
      api.session = createManagedServiceSession({env_id: () => 'test-env'}, {streamFailedMessage: () => 'Observation unavailable',});
    });
    records = [];
    installFixture();
    let accept!: (value: unknown) => void;
    const receipt = new Promise(resolve => { accept = resolve; });
    const original = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation((url: string, options?: RequestInit) => url.endsWith('/managed-web-services') && options?.method === 'POST' ? receipt : original(url, options));
    await mount(); await openInstall();
    await userEvent.click(page.getByTestId('managed-install-submit'));
    await expect.poll(() => api.session!.installSubmissions().length).toBe(1);
    unmountPage();
    const installed = {...base, service_id: 'compact-install', template_id: 'compact-harness'};
    records = [installed];
    accept({service: installed, operation: {operation_id: 'install-background', service_id: installed.service_id, action: 'install', state: 'succeeded', stage: 'completed', progress_current: 7, progress_total: 7}});
    await expect.poll(() => api.session!.managedResource.data()?.length).toBe(1);
    await mount();
    expect(api.session!.installSubmissions()).toHaveLength(0);
    expect(api.fetch.mock.calls.filter(([url, options]) => String(url).endsWith('/managed-web-services') && options?.method === 'POST')).toHaveLength(1);
    expect(host.querySelector('[data-managed-service-id="compact-install"]')).not.toBeNull();
  });

  async function executeRecovery(mode: 'immediate' | 'streamed' | 'stream-error', state = 'succeeded') {
    records = [{ ...base, status: 'recovery_required', observed_state: 'missing', primary_action: 'inspect', actions: { ...base.actions, open: { available: false }, recover: { available: true } } }];
    const completed: ManagedOperation = {
      operation_id: 'recovery-operation', service_id: base.service_id, action: 'recover',
      state, stage: state === 'succeeded' ? 'completed' : 'failed', progress_current: 7, progress_total: 7,
      ...(state === 'failed' ? { error_code: 'START_FAILED' } : {}),
    };
    const running = { ...completed, state: 'running', stage: 'starting', progress_current: 3 };
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    api.stream.mockImplementation(async () => {
      if (mode === 'stream-error') throw new Error('Recovery event stream disconnected.');
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const original = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/operations')) {
        if (mode !== 'immediate') return running;
        if (state === 'succeeded') records = [base];
        return completed;
      }
      if (url.endsWith('/managed-web-service-operations/recovery-operation')) { records = [base]; return completed; }
      return original(url, options);
    });
    await mount(680);
    await userEvent.click(page.getByRole('button', { name: 'Example dashboard: Details and diagnostics', exact: true }));
    await userEvent.click(page.getByRole('button', { name: 'Recover service', exact: true }));
    await expect.poll(()=>document.querySelector('.service-management-execute')).toBeTruthy();
    await userEvent.click(page.elementLocator(document.querySelector<HTMLButtonElement>('.service-management-execute')!));
    if (mode === 'streamed') {
      await expect.poll(() => api.stream.mock.calls.length).toBe(1);
      if (state === 'succeeded') records = [base];
      stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(completed)}\n\n`));
      stream.close();
    }
    return host.querySelector<HTMLElement>('[data-managed-service-id="sample-running"]')!;
  }

  for (const mode of ['immediate', 'streamed'] as const) it(`dismisses ${mode} recovery success while keeping the service row`, async () => {
    const row = await executeRecovery(mode);
    await expect.poll(() => row.querySelector('.web-service-status-trigger')?.getAttribute('aria-label')).toContain('Completed');
    expect(row.querySelector('[data-testid="managed-operation-disclosure"]')).toBeNull();
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeNull();
    expect(row.querySelector('[data-testid="managed-service-status"]')?.textContent).toBe('Running');
    expect((page.getByRole('button', { name: 'Example dashboard: Stop', exact: true }).element() as HTMLButtonElement).disabled).toBe(false);
    await expect.poll(() => row.querySelector('[data-testid="managed-operation-disclosure"]'), { timeout: 4_000 }).toBeNull();
    expect(row.isConnected).toBe(true);
    await userEvent.click(page.getByTestId('web-services-refresh'));
    await expect.poll(() => (host.querySelector('[data-testid="web-services-refresh"]') as HTMLButtonElement).disabled).toBe(false);
    expect(row.querySelector('[data-testid="managed-operation-disclosure"]')).toBeNull();
    expect(row.isConnected).toBe(true);
  });

  it('keeps expanded recovery success readable and dismisses it after collapse', async () => {
    const row = await executeRecovery('immediate');
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeNull();
    const trigger = page.elementLocator(document.querySelector<HTMLButtonElement>('.web-service-status-trigger')!);
    await userEvent.click(trigger);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(trigger.element().getAttribute('aria-expanded')).toBe('true');
    expect(row.querySelector('[data-testid="managed-operation-disclosure"]')?.getAttribute('data-presentation-state')).toBe('visible');
    await userEvent.click(trigger);
    await expect.poll(() => row.querySelector('[data-testid="managed-operation-disclosure"]'), { timeout: 1_500 }).toBeNull();
    expect(row.isConnected).toBe(true);
  });

  it('retains a failed recovery result after closing the review drawer', async () => {
    const row = await executeRecovery('immediate', 'failed');
    await expect.poll(() => row.querySelector('[data-testid="managed-service-status"]')?.textContent).toContain('Failed');
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(row.querySelector('[data-testid="managed-service-status"]')?.textContent).toContain('Failed');
    expect((page.getByRole('button', { name: 'Example dashboard: Details and diagnostics', exact: true }).element() as HTMLButtonElement).disabled).toBe(false);
  });

  it('replaces a failed recovery with the next reviewed success and restores opening', async () => {
    const row = await executeRecovery('immediate', 'failed');
    await expect.poll(() => row.querySelector('[data-testid="managed-service-status"]')?.textContent).toContain('Failed');
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeNull();
    const original = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/operations')) {
        records = [base];
        return { operation_id: 'next-recovery', service_id: base.service_id, action: 'recover', state: 'succeeded', stage: 'completed', progress_current: 7, progress_total: 7 };
      }
      return original(url, options);
    });
    await userEvent.click(page.getByRole('button', { name: 'Example dashboard: Details and diagnostics', exact: true }));
    await userEvent.click(page.getByRole('button', { name: 'Recover service', exact: true }));
    await expect.poll(()=>document.querySelector('.service-management-execute')).toBeTruthy();
    await userEvent.click(page.elementLocator(document.querySelector<HTMLButtonElement>('.service-management-execute')!));
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeNull();
    await expect.poll(() => row.querySelector('[data-testid="managed-service-status"]')?.textContent).toBe('Running');
    await expect.poll(() => row.querySelector('[data-testid="managed-operation-disclosure"]'), { timeout: 4_000 }).toBeNull();
    await userEvent.click(row.querySelector<HTMLButtonElement>('.web-service-open button')!);
    await expect.poll(() => api.open.mock.calls.length).toBe(1);
  });

  it('reconciles a disconnected recovery stream without repeating the mutation', async () => {
    const row = await executeRecovery('stream-error');
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeNull();
    await expect.poll(() => row.querySelector('[data-testid="managed-service-status"]')?.textContent).toBe('Running');
    expect(api.fetch.mock.calls.filter(([url]) => String(url).endsWith('/operations'))).toHaveLength(1);
    expect(api.fetch.mock.calls.some(([url]) => String(url).endsWith('/managed-web-service-operations/recovery-operation'))).toBe(true);
  });

  it('shows request acceptance and completion without blocking other services or repeating a start', async () => {
    records = records.map((item) => item.service_id === base.service_id ? { ...item, status: 'stopped', observed_state: 'stopped', primary_action: 'start', actions: { ...item.actions, open: { available: false }, start: { available: true } } } : item);
    const original = api.fetch.getMockImplementation()!;
    let accept!: (value: unknown) => void;
    const pending = new Promise((resolve) => { accept = resolve; });
    api.fetch.mockImplementation((url: string, options?: RequestInit) => url.endsWith('/operations') ? pending : original(url, options));
    await mount();
    const start = page.getByRole('button', { name: 'Example dashboard: Start', exact: true });
    const row = host.querySelector<HTMLElement>('[data-managed-service-id="sample-running"]')!;
    const open = row.querySelector<HTMLButtonElement>('.web-service-open button')!;
    const availableOpen = host.querySelector<HTMLButtonElement>('[data-testid="port-forward-row"] .web-service-open button')!;
    const primaryColor = getComputedStyle(availableOpen).backgroundColor;
    expect(getComputedStyle(start.element()).backgroundColor).toBe(primaryColor);
    expect(getComputedStyle(open).backgroundColor).not.toBe(primaryColor);
    expect(open.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(open.getAttribute('aria-describedby')!)?.textContent).toBe('Start the service before opening it.');
    await userEvent.click(open, { force: true });
    expect(api.open).not.toHaveBeenCalled();
    await userEvent.click(start);
    await expect.poll(() => host.querySelector('[data-managed-service-id="sample-running"] [data-testid="managed-service-status"]')?.textContent).toBe('Submitting request…');
    expect((start.element() as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="web-services-refresh"]')?.disabled).toBe(false);
    await userEvent.click(page.getByRole('button', { name: 'Example workspace: Details and diagnostics', exact: true }));
    await expect.poll(() => document.querySelector('[data-testid="service-management-drawer"]')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    records = records.map((item) => item.service_id === base.service_id ? base : item);
    accept({ operation_id: 'started', service_id: base.service_id, action: 'start', state: 'succeeded', stage: 'completed', progress_current: 3, progress_total: 3 });
    await expect.poll(() => host.querySelector('[data-managed-service-id="sample-running"] [data-testid="managed-service-status"]')?.textContent).toBe('Running');
    await expect.poll(() => getComputedStyle(row.querySelector('.web-service-open button')!).backgroundColor).toBe(primaryColor);
    await expect.poll(() => getComputedStyle(row.querySelector('[data-testid="managed-service-primary"]')!).backgroundColor).not.toBe(primaryColor);
    expect(api.fetch.mock.calls.filter(([url]) => String(url).endsWith('/operations'))).toHaveLength(1);
  });

  it('keeps a rejected request in recent operation details while retaining the observed running state', async () => {
    const original = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation((url: string, options?: RequestInit) => url.endsWith('/operations') ? Promise.reject(new LocalApiError({message: 'The operation request was not accepted.', status: 409, code: 'UI_REQUEST_FAILED'})) : original(url, options));
    await mount();
    await userEvent.click(page.getByRole('button', { name: 'Example dashboard: Stop', exact: true }));
    await expect.poll(() => host.querySelector('[data-managed-service-id="sample-running"] [data-testid="managed-service-status"]')?.textContent).toBe('Stop · Failed');
    expect(host.querySelector('[data-testid="managed-operation-disclosure"]')).toBeNull();
    await userEvent.click(page.elementLocator(document.querySelector<HTMLButtonElement>('.web-service-status-trigger')!));
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

  for (const [width, preset] of [[1440, 'soft-black'], [390, 'cloud-white'], [320, 'soft-black']] as const) it(`keeps operation details and resource disclosure independent at ${width}px in ${preset}`, async () => {
    records = [base];
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let streamSignal: AbortSignal | null | undefined;
    const operation: ManagedOperation = {
      operation_id: 'stop-with-output', service_id: base.service_id, action: 'stop', state: 'running', stage: 'stopping', progress_current: 1, progress_total: 2,
      progress_detail: { schema_version: 2, stage_started_at_unix_ms: Date.now() - 5000,
        commands: [{ command_id: 'stop', display: 'stop application', state: 'running' }],
        output: [{ sequence: 1, command_id: 'stop', stream: 'stdout', text: 'Waiting for the application to exit' }],
      },
    };
    api.stream.mockImplementation(async (_url: string, options?: RequestInit) => {
      streamSignal = options?.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const original = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation(async (url: string, options?: RequestInit) => url.endsWith('/operations') ? operation : original(url, options));
    await mount(width, preset);
    await page.viewport(width, 900);
    await userEvent.click(page.getByRole('button', { name: 'Example dashboard: Stop', exact: true }));
    await expect.poll(() => api.stream.mock.calls.length).toBe(1);
    await userEvent.click(page.getByRole('button', { name: 'Example dashboard: More', exact: true }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Details and diagnostics', exact: true }));
    await expect.poll(() => document.querySelector('.service-management-conclusion')?.textContent).toBe('Running');
    const drawer = document.querySelector<HTMLElement>('.service-management-panel')!;
    const footer = drawer.querySelector<HTMLElement>('[data-testid="service-management-footer"]')!;
    expect(drawer.querySelector('.service-operation-heading')?.textContent).toContain('Stop');
    const spinner = drawer.querySelector<HTMLElement>('[data-managed-operation-spinner]');
    expect(spinner).not.toBeNull();
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(spinner!).animationName).toBe('service-operation-spin');
    expect(drawer.querySelectorAll('.service-operation-track > span')).toHaveLength(2);
    const directory = import.meta.env.VITE_REDEVEN_SERVICE_SCREENSHOTS;
    if (directory) {
      await new Promise((resolve) => setTimeout(resolve, 260));
      await document.fonts.ready;
      await page.screenshot({ path: `${directory}/management-overview-${width}-${preset}.png` });
    }
    await userEvent.click(page.elementLocator(drawer.querySelector<HTMLButtonElement>('.service-operation-summary-actions button')!));
    const detailsHeading = drawer.querySelector('.service-management-execution .service-operation-heading')?.textContent ?? '';
    expect(detailsHeading).toContain('1/2 ·');
    expect(detailsHeading).toMatch(/\d+s/);
    const footerTop = footer.getBoundingClientRect().top;
    const disclosure = drawer.querySelector<HTMLElement>('[data-testid="managed-operation-command-output"]')!;
    const output = drawer.querySelector<HTMLElement>('[data-testid="managed-operation-output"]')!;
    const resource = drawer.querySelector<HTMLDetailsElement>('.service-management-resource-details')!;
    expect(disclosure.tagName).toBe('SECTION');
    expect(output.clientHeight).toBeGreaterThan(100);
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ ...operation, progress_detail: { ...operation.progress_detail, output: [...operation.progress_detail!.output!, { sequence: 2, command_id: 'stop', stream: 'stdout', text: 'Still waiting for the application' }] } })}\n\n`));
    await expect.poll(() => output.textContent).toContain('Still waiting');
    expect(drawer.querySelector('[data-testid="managed-operation-output"]')).toBe(output);
    expect(disclosure.querySelector('summary')).toBeNull();
    expect(resource.open).toBe(false);
    expect(footer.getBoundingClientRect().top).toBe(footerTop);
    expect(drawer.scrollWidth).toBeLessThanOrEqual(drawer.clientWidth + 1);
    await document.fonts.ready;
    if (directory) await page.screenshot({ path: `${directory}/management-${width}-${preset}.png` });
    await userEvent.click(page.elementLocator([...footer.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Close')!));
    await expect.poll(() => document.querySelector('.service-management-panel')).toBeNull();
    expect(streamSignal?.aborted).toBe(false);
    expect(api.fetch.mock.calls.some(([url]) => String(url).endsWith('/cancel'))).toBe(false);
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ ...operation, state: 'failed', error_code: 'STOP_SCRIPT_FAILED' })}\n\n`));
    stream.close();
    await expect.poll(() => host.querySelector('[data-testid="managed-service-status"]')?.textContent).toBe('Stop · Failed');
    expect(host.querySelector('[data-testid="managed-operation-disclosure"]')).toBeNull();
  });

  it('keeps reviewed content intact during the sidebar exit', async () => {
    await mount();
    await userEvent.click(page.getByRole('button', { name: 'Example workspace: Details and diagnostics', exact: true }));
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

let releaseTestTransport: (() => void) | undefined;
beforeEach(async () => {
  releaseTestTransport = await bindTestSessionHTTP(async (input,init)=>{
 if(new Headers(init?.headers).get('Accept')==='text/event-stream')return api.stream(input,init);
 return new Response(JSON.stringify({ok:true,data:await api.fetch(String(input),init)}),{status:200});
});
});
afterEach(() => releaseTestTransport?.());
