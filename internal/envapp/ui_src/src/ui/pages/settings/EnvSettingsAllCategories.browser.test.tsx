import '../../../index.css';
import '../../flower-feature.css';
import { FloeProvider, builtInShellThemePresets, BUILT_IN_SHELL_THEME_DEFAULTS } from '@floegence/floe-webapp-core';
import { onCleanup, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { createRuntimeSettingsFixture } from '../../../../scripts/fixtures/runtime-settings/fixture';
import { createSettingsSession } from '../../../../../../settings_ui/src/settingsSession';
import { SettingsPanelContext } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { EnvSettingsDialog } from './EnvSettingsDialog';
import type { EnvSettingsPageContextValue } from './EnvSettingsPageContext';
import { SETTINGS_NAV_ITEMS } from './settingsStructure';
import type { EnvSettingsSection } from '../EnvContext';
import { I18nProvider } from '../../i18n';
import { writeStoredLanguagePreference } from '../../i18n/storage';
import { createTestI18nHelpers } from '../../i18n/locales/testDictionaries';
import { TerminalSettingsAttachmentsProvider, useTerminalSettingsAttachments, terminalSettingsResource, type TerminalSettingsAttachment } from '../../services/terminalSettingsTargets';
import type { ContainerServiceConfiguration } from '../../services/containerResourcesApi';
import type { HostApplicationCatalog } from '../../services/hostApplicationsApi';
import type { RemoteDesktopStatus } from '../../services/remoteDesktopApi';
import type { PluginInventoryProjection } from '../../plugins/pluginTypes';
import { pluginInstalledSettingsResource } from '../../plugins/pluginSettingsTarget';
import { agentPluginsFixture } from '../../flower/agentPluginsFixture';
import type { FlowerSettingsSnapshot } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

// IMPORTANT: This suite mounts the actual dialog and every production panel.
// Only external owners are fixtures; replacing a panel would hide missing
// categories, nested headers, empty resource editors, or responsive regressions.
const api = vi.hoisted(() => ({ request: vi.fn(), layout: vi.fn(), stream: vi.fn(), mutations: vi.fn(), refresh: vi.fn() }));
let fixture: ReturnType<typeof createRuntimeSettingsFixture>;
let context: EnvSettingsPageContextValue;
let session: ReturnType<typeof createSettingsSession>;
let dispose: (() => void) | undefined;

vi.mock('../EnvContext', async original => ({ ...await original<object>(), useEnvContext: () => context.env }));
vi.mock('./EnvSettingsPageContext', async original => {
  const actual = await original<typeof import('./EnvSettingsPageContext')>();
  return { ...actual, EnvSettingsPageProvider: (props: { children: JSX.Element }) => <actual.EnvSettingsPageCtx.Provider value={context}>{props.children}</actual.EnvSettingsPageCtx.Provider> };
});
vi.mock('../../services/localApi', async original => ({ ...await original<object>(), fetchLocalApiJSON: api.request }));
vi.mock('@floegence/floe-webapp-protocol', async original => ({ ...await original<object>(), useProtocol: () => ({ status: () => 'connected', session: () => null }) }));
vi.mock('../../protocol/redeven_v1', async original => ({ ...await original<object>(), useRedevenRpc: () => ({ fs: { list: async () => ({ entries: [] }) } }) }));
vi.mock('../../services/terminalSessionCatalog', () => ({ useTerminalSessionCatalog: () => ({ sessions: () => [{ id: 'session-a', name: 'Workspace terminal' }], refresh: async () => undefined }) }));
vi.mock('../../services/workbenchLayoutApi', async original => ({ ...await original<object>(), getWorkbenchLayoutSnapshot: api.layout, putWorkbenchWidgetState: api.mutations, connectWorkbenchLayoutEventStream: api.stream }));
vi.mock('../../services/containerResourcesApi', async original => ({ ...await original<object>(),
  listContainerServices: async () => [{ service_id: 'docker-a', name: 'Development Docker', engine: 'docker', implementation: 'docker_engine', state: 'running', capabilities: { start: true, stop: true, restart: true }, configuration: { mode: 'local', sources: ['engine', 'docker_cli'] } }],
  getContainerServiceConfiguration: async () => containerConfiguration, preflightContainerOperation: api.mutations, createContainerOperation: api.mutations,
}));
vi.mock('../../services/hostApplicationsApi', async original => ({ ...await original<object>(),
  listHostApplications: async () => hostCatalog, listHostApplicationSessions: async () => hostCatalog.sessions, listRunningHostApplications: async () => hostCatalog.running,
  requestHostApplicationPermission: api.mutations, startHostApplicationSetup: api.mutations, launchHostApplication: api.mutations,
}));
vi.mock('../../services/remoteDesktopApi', async original => ({ ...await original<object>(), getRemoteDesktopStatus: async () => desktopStatus, setRemoteDesktopUnattended: api.mutations, createRemoteDesktop: api.mutations }));
vi.mock('../../plugins/pluginCreationApi', async original => ({ ...await original<object>(), listPluginDrafts: async () => [{ id: 'draft-a', workspace_id: 'author-a', title: 'Workspace companion', lifecycle: 'active' }] }));

const retention = { effective: { max_lines: 1000, max_bytes: 1048576 }, defaults: { max_lines: 1000, max_bytes: 1048576 }, overrides: null };
const terminalLayout = { seq: 1, revision: 1, updated_at_unix_ms: 1, widgets: [{ widget_id: 'widget-a', widget_type: 'redeven.terminal', x: 0, y: 0, width: 600, height: 400, z_index: 1, created_at_unix_ms: 1 }], widget_states: [{ widget_id: 'widget-a', widget_type: 'redeven.terminal', revision: 1, updated_at_unix_ms: 1, state: { kind: 'terminal', session_ids: ['session-a'], font_size: 14, font_family_id: 'jetbrains' } }], sticky_notes: [], annotations: [], background_layers: [] };
const containerConfiguration: ContainerServiceConfiguration = { service_id: 'docker-a', sources: [
  { source_id: 'engine', display_path: '/etc/docker/daemon.json', status: 'ready', exists: true, format: 'json', sections: ['proxy', 'advanced'], apply_modes: ['save', 'save_and_restart'], base_revision: 'engine-a', http_proxy: '', https_proxy: '', no_proxy: 'localhost,127.0.0.1', content: '{}' },
  { source_id: 'docker_cli', display_path: '/home/alex/.docker/config.json', status: 'ready', exists: true, format: 'json', sections: ['general', 'proxy', 'credentials', 'advanced'], apply_modes: ['save'], base_revision: 'cli-a', content: '{"currentContext":"default","credsStore":"desktop"}' },
] };
const hostCatalog: HostApplicationCatalog = { access_state: 'enabled', availability: { backend: 'macos', supported: true, ready: true, native_ready: true, permission_app_name: 'Redeven', permissions: { screen_recording: true, accessibility: true } },
  applications: [{ id: 'editor.app', name: 'Text Editor', description: 'Edit project documents', categories: ['Development'], icon: '', custom: false }], sessions: [], running: [{ application_id: 'editor.app', instances: ['editor-process'] }],
};
const desktopStatus: RemoteDesktopStatus = { access_state: 'enabled', capabilities: { backend: 'macos', state: 'ready', authorization: 'saved', screen: true, input: true, audio: true, clipboard: true, displays: [{ id: 'main', name: 'Built-in Display', width: 2560, height: 1600, scale: 2, primary: true }] }, unattended: false, control_in_use: false, last_display_id: 'main' };
const managedService = { service_id: 'design-service', template_id: 'development-api', name: 'Development API', description: 'Shared development service', deployment: 'container', template_source: 'custom', workspace_path: '/workspace/api', workspace_ownership: 'user_selected', desired_state: 'stopped', observed_state: 'stopped', forward_id: 'api-forward', runtime_port: 3000, release_status: { schema_version: 2, check_status: 'pending', current_release: { schema_version: 1, kind: 'none' } } };
const serviceConfiguration = { service_id: 'design-service', name: 'Development API', description: 'Shared development service', access_mode: 'unified_proxy', deployment: 'container', template_source: 'custom', observed_state: 'stopped', configuration_revision: 3, configuration_sha256: 'fixture-sha', parameters: {}, parameter_definitions: [],
  runtime: { container: { entrypoint: '', command: [], environment: [{ name: 'NODE_ENV', value: 'development' }], labels: {}, restart_policy: 'no', network_mode: 'bridge', ports: [], mounts: [], cpus: 2, memory_bytes: 4294967296, pids_limit: 512, shm_size_bytes: 0, cap_add: [], cap_drop: ['ALL'], devices: [], privileged: false, read_only_root: true, security_opts: ['no-new-privileges:true'], user: '' } },
};
const secondaryService = { ...managedService, service_id: 'design-worker', name: 'Background Worker', forward_id: 'worker-forward' };
const secondaryConfiguration = { ...serviceConfiguration, service_id: secondaryService.service_id, name: secondaryService.name };
const pluginProjection: PluginInventoryProjection = { items: [{ inventoryKey: 'installed:metrics', pluginID: 'com.example.metrics', pluginInstanceID: 'metrics-instance', displayName: 'Workspace Metrics', description: 'Inspect the health and activity of the current environment.', iconFallback: 'generic', category: 'infrastructure', searchKeywords: ['metrics'], publisher: 'Workspace Tools', version: '1.2.0', managementRevision: 1, canDisable: true, lifecycleState: 'enabled', sourceKind: 'community', pinned: false, networkConnectors: [{ connectorID: 'workspace-api', transport: 'http', configurable: true, httpMethods: ['GET'] }] }] };
const flowerSnapshot: FlowerSettingsSnapshot = { defaults: { permission_type: 'approval_required' }, model_profile: { schema_version: 1, current_model_id: 'openai/gpt-5.4', providers: [{ id: 'openai', name: 'OpenAI', type: 'openai', models: [{ model_name: 'gpt-5.4', context_window: 1047576, input_modalities: ['text', 'image'] }] }] }, provider_secrets: [{ provider_id: 'openai', provider_api_key_configured: true, web_search_api_key_configured: false }] };
const flowerAdapter = { runtime: { display_name: 'Development Mac' }, canMutate: true, loadSettings: async () => flowerSnapshot, saveDefaultPermission: api.mutations, saveModelProfile: api.mutations,
  computerManagement: { loadEnvironment: async () => ({ hostname: 'Development Mac', platform: 'darwin', managed: { state: 'on_demand' }, desktop: { state: 'ready' }, chrome: { installations: [{ id: 'browser-aaaaaaaaaaaaaaaaaaaaaaaa', kind: 'google_chrome', name: 'Google Chrome', installed: true, prepared: true, connected: false }], profiles: [{ installation_id: 'browser-aaaaaaaaaaaaaaaaaaaaaaaa', library_id: 'chrome-library', id: 'work', name: 'Work profile' }] } }) },
  extensions: { canInteract: () => true, canAdmin: () => true, plugins: agentPluginsFixture(),
    listSkills: async () => ({ catalog_version: 1, skills: [{ id: 'review', name: 'code-review', description: 'Review changes for correctness and maintainability.', path: '/Users/alex/.agents/skills/code-review/SKILL.md', scope: 'user_agents', enabled: true, effective: true }] }),
    listSkillSources: async () => ({ items: [{ skill_path: '/Users/alex/.agents/skills/code-review/SKILL.md', source_type: 'github_import', source_id: 'workspace/skills#code-review' }] }),
    listMCP: async () => ({ servers: [{ id: 'workspace', revision: 1, name: 'Workspace tools', transport: 'http', url: 'https://tools.example.com/mcp', header_keys: [], env_keys: [], enabled: true, tools: [] }] }),
  },
};

function TerminalOwner() {
  const registry = useTerminalSettingsAttachments()!;
  onCleanup(registry.register({ widgetID: 'widget-a', ready: () => true, controllers: () => new Map([['session-a', 'controller-a']]), transport: { attach: api.mutations, takeover: api.mutations, historyRetention: async () => retention, configureHistoryRetention: api.mutations } } as unknown as TerminalSettingsAttachment));
  return null;
}
const media = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void>; emulateMediaPreferences: (value: { reducedMotion: 'reduce' | 'no-preference'; colorScheme: 'dark' | 'light' }) => Promise<void> };
const genericRefreshOwners = new Set<EnvSettingsSection>(['connection', 'agent', 'runtime', 'codespaces', 'permission_policy', 'config', 'logging', 'debug_console']);
type Locale = 'en-US' | 'zh-CN' | 'de-DE';

async function mount(width: number, locale: Locale = 'en-US', dark = false) {
  await page.viewport(width, 1000);
  localStorage.clear(); writeStoredLanguagePreference(locale);
  api.mutations.mockImplementation(() => { throw new Error('Acceptance browsing must not mutate its owners'); });
  api.layout.mockResolvedValue(terminalLayout);
  api.stream.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })));
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => {
    fixture = createRuntimeSettingsFixture();
    session = createSettingsSession({ history: true });
    const env = { ...fixture.context.env, env: Object.assign(() => ({ namespace_public_id: 'workspace', name: 'Development Mac', permissions: { can_admin: true, can_read: true, can_write: true, can_execute: true }, agent: { hostname: 'Development Mac' } }), { state: 'ready' }),
      localRuntime: () => null, flowerScopeKey: () => 'acceptance:incarnation', resourceCacheAccess: () => ({ phase: 'ready', generation: 0 }),
      settingsSeq: () => 0, settingsFocusSeq: session.revision, settingsFocusSection: () => session.target()?.section,
      openSettings: (section: EnvSettingsSection, target?: { resource?: string }) => session.open({ section, ...target }),
      createSettingsFlowerAdapter: async () => flowerAdapter,
    };
    context = { ...fixture.context, env, activeSection: () => session.target()?.section ?? 'appearance', setActiveSection: (section: EnvSettingsSection) => session.open({ section }), refreshSettingsPage: api.refresh } as unknown as EnvSettingsPageContextValue;
    api.request.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (init.method && init.method !== 'GET') throw new Error(`Unexpected owner mutation: ${url}`);
      if (url.includes('history-retention?')) return retention;
      if (url.includes('history-retention')) return { supported: true, can_manage: true, defaults: retention.defaults };
      if (url.endsWith('/host-applications/picture')) return { mode: 'auto', max_dimension: 0, frame_rate: 0 };
      if (url.endsWith('/forwards')) return { forwards: [] };
      if (url.endsWith('/managed-web-services/catalog')) return { templates: [] };
      if (url.endsWith('/managed-web-services')) return { services: [managedService, secondaryService] };
      if (url.endsWith('/design-service/settings')) return serviceConfiguration;
      if (url.endsWith('/design-worker/settings')) return secondaryConfiguration;
      return fixture.request(url, init);
    });
    session.open({ section: 'appearance' });
    return <I18nProvider><FloeProvider config={{ theme: { storageKey: 'settings-acceptance-theme', defaultTheme: dark ? 'dark' : 'light', shellPresets: builtInShellThemePresets, defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS, defaultSurfaceStyle: 'soft-neumorphic' } }}><TerminalSettingsAttachmentsProvider><TerminalOwner />
      <SettingsPanelContext.Provider value={{ ...session, register: () => () => {} }}>
        <EnvSettingsDialog session={session} panels={[]} onThemeSourceChange={() => true} onShellThemeChange={() => true}
          pluginSettings={{ items: pluginProjection.items, ownerScope: {}, loading: false, canManage: true, refresh: async () => undefined, api: {
            listConnections: async () => ({ connections: [{ plugin_instance_id: 'metrics-instance', connector_id: 'workspace-api', transport: 'http', status: 'active', destination: 'https://api.example.com', revision: 1, scope: 'environment', http_methods: ['GET'], private_prefixes: [] }] }) as never,
            reviewConnection: api.mutations, approveConnection: api.mutations, cancelConnectionReview: api.mutations, revokeConnection: api.mutations,
          } }} />
      </SettingsPanelContext.Provider>
    </TerminalSettingsAttachmentsProvider></FloeProvider></I18nProvider>;
  }, host);
  await expect.element(page.getByRole('dialog', { name: createTestI18nHelpers(locale).t('settings.runtimeTitle'), exact: true })).toBeVisible();
  await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(dark);
}

afterEach(async () => {
  dispose?.(); dispose = undefined; document.body.replaceChildren(); localStorage.clear(); window.history.replaceState({}, '', '/'); document.documentElement.classList.remove('dark');
  await media.emulateTouchInput(false); await media.emulateMediaPreferences({ reducedMotion: 'no-preference', colorScheme: 'light' });
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const selectors: Partial<Record<EnvSettingsSection, string>> = {
  appearance: '.floe-setting-row', terminal: '[data-terminal-history-settings] input', browser: '.flower-computer-capabilities',
  applications: '.host-access-settings .host-access-feature-settings', containers: 'input[aria-label]', services: '[data-testid=managed-service-settings] input',
  extensions: '[data-testid=flower-extensions] .flower-extension-source', plugins: '[data-plugin-connections] input', ai: '.flower-settings-provider-card',
};
async function openCategory(section: EnvSettingsSection) {
  const resource = section === 'containers' ? 'docker-a' : section === 'services' ? 'design-service' : section === 'plugins' ? pluginInstalledSettingsResource('metrics-instance') : section === 'terminal' ? terminalSettingsResource({ kind: 'widget', id: 'widget-a', sessionId: 'session-a' }) : undefined;
  session.open({ section, ...(resource ? { resource } : {}) });
  await expect.element(page.getByTestId(`settings-section-${section}`)).toBeVisible();
  const panel = document.querySelector<HTMLElement>(`[data-testid="settings-section-${section}"]`)!;
  await expect.poll(() => panel.innerText.trim().length, { message: `${section} renders nonempty real content` }).toBeGreaterThan(30);
  if (selectors[section]) await expect.poll(() => panel.querySelector(selectors[section]!), { message: `${section} owner data finishes loading` }).not.toBeNull();
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return panel;
}

function inspectCategory(section: EnvSettingsSection, panel: HTMLElement, locale: Locale) {
  const copy = createTestI18nHelpers(locale);
  const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
  const headers = dialog.querySelectorAll<HTMLElement>('[data-floe-dialog-header]');
  expect(headers, `${section}: one dialog header`).toHaveLength(1);
  const header = headers[0];
  const content = dialog.querySelector<HTMLElement>('.redeven-settings-content')!;
  const surface = getComputedStyle(content).backgroundColor;
  for (const element of [dialog, header, header.querySelector<HTMLElement>('.redeven-settings-header')!, dialog.querySelector<HTMLElement>('.floe-settings-layout__sidebar')!].filter(Boolean)) {
    expect(getComputedStyle(element).backgroundColor, `${section}: header, navigation and content share one surface`).toBe(surface);
  }
  expect(header.querySelectorAll('.redeven-settings-header')).toHaveLength(1);
  const refresh = [...header.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.getAttribute('aria-label') === copy.t('common.actions.refresh'));
  expect(refresh.length, `${section}: refresh belongs to its API owner`).toBe(genericRefreshOwners.has(section) ? 1 : 0);
  expect(header.querySelector('[aria-label="Back to Flower"]')).toBeNull();
  expect(dialog.querySelectorAll('.flower-extensions-header')).toHaveLength(0);
  expect([...panel.querySelectorAll<HTMLElement>('h1')].filter(node => node.checkVisibility() && !node.classList.contains('sr-only')), `${section}: no second visible page heading`).toHaveLength(0);
  // IMPORTANT: The dialog header owns category identity. Body headings name
  // real subgroups, never repeat the current localized destination.
  const categoryTitle = header.querySelector<HTMLElement>('.redeven-settings-breadcrumb [title]')!.title;
  expect([...panel.querySelectorAll<HTMLElement>('h1, h2, h3, [role=heading]')].filter(node => node.checkVisibility() && !node.classList.contains('sr-only') && node.textContent?.trim() === categoryTitle), `${section}: no duplicate category title`).toHaveLength(0);
  if (section === 'appearance') {
    expect(panel.querySelectorAll('[data-envapp-theme-preset]').length).toBeGreaterThan(10);
    expect(getComputedStyle(panel.querySelector<HTMLElement>('[data-envapp-theme-menu=inline]')!).boxShadow).toBe('none');
    expect([...panel.querySelectorAll('h2')].map(node => node.textContent)).toContain(copy.t('shell.themePicker.title'));
    expect([...panel.querySelectorAll('h2')].map(node => node.textContent)).toContain(copy.t('uiCopy.preview.markdownControls'));
  }
  expect(dialog.querySelector('[data-plugin-center-view]'), 'Plugin Center must remain an independent feature').toBeNull();
  expect([...panel.querySelectorAll<HTMLElement>('[role=alert]')].filter(node => node.checkVisibility()).map(node => node.textContent?.trim()).filter(Boolean), `${section}: no failed or unavailable owner`).toEqual([]);
  for (const element of [dialog, header, panel]) expect(element.scrollWidth, `${section}: ${element.className} width`).toBeLessThanOrEqual(element.clientWidth + 1);
  const bounds = panel.getBoundingClientRect();
  const groups = dialog.querySelector<HTMLElement>('.floe-settings-navigation__groups');
  if (groups?.checkVisibility()) {
    const bounds = groups.getBoundingClientRect();
    const geometry = [...groups.querySelectorAll<HTMLElement>('.floe-settings-navigation__item')].map(button => {
      const label = button.querySelector<HTMLElement>('span:last-child');
      const style = getComputedStyle(button), labelStyle = label ? getComputedStyle(label) : null;
      const box = button.getBoundingClientRect();
      return { text: button.textContent?.trim(), left: box.left, right: box.right, width: box.width, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth, whiteSpace: style.whiteSpace, flex: style.flex, minWidth: style.minWidth, labelWhiteSpace: labelStyle?.whiteSpace, labelFlex: labelStyle?.flex };
    });
    expect(groups.scrollWidth, JSON.stringify({ section, groupsWidth: groups.clientWidth, geometry })).toBeLessThanOrEqual(groups.clientWidth + 1);
    for (const button of geometry) { expect(button.left, button.text).toBeGreaterThanOrEqual(bounds.left - 1); expect(button.right, button.text).toBeLessThanOrEqual(bounds.right + 1); }
  }
  for (const element of panel.querySelectorAll<HTMLElement>('input, [role=combobox], .floe-setting-row__control')) {
    if (!element.checkVisibility() || element.closest('[hidden], [inert]')) continue;
    const box = element.getBoundingClientRect();
    expect(box.left, `${section}: ${element.getAttribute('aria-label') ?? element.className} left`).toBeGreaterThanOrEqual(bounds.left - 1);
    expect(box.right, `${section}: ${element.getAttribute('aria-label') ?? element.className} right`).toBeLessThanOrEqual(bounds.right + 1);
  }
  expect(api.mutations).not.toHaveBeenCalled();
}

it.each([1440, 1024, 768, 390, 320])('renders all 18 actual category owners without horizontal overflow at %ipx', async width => {
  await mount(width);
  expect(SETTINGS_NAV_ITEMS).toHaveLength(18);
  for (const item of SETTINGS_NAV_ITEMS) {
    const panel = await openCategory(item.id);
    inspectCategory(item.id, panel, 'en-US');
    if (width === 1440 || width === 320) await page.screenshot({ path: `../../../../dist/settings-all-categories/${width}-${item.id}.png` });
  }
}, 60_000);

it.each([1440, 390, 320])('gives host settings deliberate feature rows and aligned picture fields at %ipx', async width => {
  await mount(width);
  const panel = await openCategory('applications');
  await expect.poll(() => {
    const transform = getComputedStyle(panel.closest<HTMLElement>('[role=dialog]')!).transform;
    return transform === 'none' || new DOMMatrixReadOnly(transform).isIdentity;
  }).toBe(true);
  const rows = [...panel.querySelectorAll<HTMLElement>('.host-access-feature-row')];
  expect(rows).toHaveLength(2);
  const pictureList = panel.querySelector<HTMLElement>('.application-picture-fields')!;
  const featureList = panel.querySelector<HTMLElement>('.host-access-feature-group')!;
  const pictureRow = pictureList.querySelector<HTMLElement>('.floe-setting-row')!;
  expect(featureList.classList.contains('floe-settings-list')).toBe(true);
  for (const property of ['backgroundColor', 'borderRadius', 'borderTopColor'] as const) {
    expect(getComputedStyle(featureList)[property]).toBe(getComputedStyle(pictureList)[property]);
  }
  expect([...panel.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Save')).toBe(false);
  for (const row of rows) {
    expect(row.classList.contains('floe-setting-row')).toBe(true);
    expect(getComputedStyle(row).padding).toBe(getComputedStyle(pictureRow).padding);
    const title = row.querySelector<HTMLElement>('.floe-setting-row__title')!;
    const pictureTitle = pictureRow.querySelector<HTMLElement>('.floe-setting-row__title')!;
    for (const property of ['fontSize', 'fontWeight', 'lineHeight', 'color'] as const) expect(getComputedStyle(title)[property]).toBe(getComputedStyle(pictureTitle)[property]);
    const identity = row.querySelector<HTMLElement>('.floe-setting-row__label')!.getBoundingClientRect();
    const control = row.querySelector<HTMLElement>('.host-access-feature-control')!.getBoundingClientRect();
    expect(control.left).toBeGreaterThanOrEqual(identity.right);
    expect(Math.abs((control.top + control.bottom - identity.top - identity.bottom) / 2)).toBeLessThan(2);
    expect(row.getBoundingClientRect().height).toBeLessThan(110);
  }
  expect(panel.querySelectorAll('.host-access-feature-control [role=switch]')).toHaveLength(2);
  expect(panel.querySelectorAll('.host-access-feature-control [aria-haspopup=menu]')).toHaveLength(2);
  const fields = [...panel.querySelectorAll<HTMLElement>('[data-testid=application-picture-settings] [role=combobox]')].map(node => node.getBoundingClientRect());
  expect(fields).toHaveLength(3);
  for (const field of fields) expect(Math.abs(field.width - fields[0].width)).toBeLessThan(1);
  if (width <= 390) {
    const dialog = panel.closest<HTMLElement>('[role=dialog]')!.getBoundingClientRect();
    expect(Math.abs(dialog.width - width)).toBeLessThan(1);
    const controlWidth = panel.querySelector<HTMLElement>('[data-testid=application-picture-settings] .floe-setting-row__control')!.getBoundingClientRect().width;
    expect(Math.abs(fields[0].width - controlWidth)).toBeLessThan(1);
    for (const field of fields) expect(Math.abs(field.left - fields[0].left)).toBeLessThan(1);
  }
  await page.screenshot({ path: `../../../../dist/settings-all-categories/redesign-${width}-applications.png` });
});

it('saves real picture selections immediately and never writes from category navigation', async () => {
  await mount(1024);
  const panel = await openCategory('applications');
  const owner = api.request.getMockImplementation()!;
  const updates: unknown[] = [];
  api.request.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/host-applications/picture') && init.method === 'PUT') {
      const value = JSON.parse(String(init.body)); updates.push(value); return value;
    }
    return owner(url, init);
  });
  const picker = page.getByRole('combobox', { name: 'Picture quality', exact: true });
  await picker.click();
  await page.getByRole('option', { name: 'Motion first', exact: true }).click();
  await expect.poll(() => updates).toEqual([{ mode: 'smooth', max_dimension: 0, frame_rate: 0 }]);
  const field = picker.element();
  await openCategory('appearance');
  await openCategory('applications');
  expect(picker.element()).toBe(field);
  expect(panel.querySelector('.application-picture-save')).toBeNull();
  expect(updates).toHaveLength(1);
  session.close();
  session.open({ section: 'applications' });
  await expect.element(picker).toBeVisible();
  expect(updates).toHaveLength(1);
});

it.each(['Picture quality', 'Resolution limit', 'Frame rate limit'])('closes the retained %s popup on category navigation and dialog close', async label => {
  const warnings = vi.spyOn(console, 'warn');
  await mount(1024); await openCategory('applications');
  const picker = page.getByRole('combobox', { name: label, exact: true });
  await picker.click(); await expect.element(page.getByRole('listbox')).toBeVisible();
  await openCategory('appearance');
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
  await openCategory('applications');
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
  await picker.click(); await expect.element(page.getByRole('listbox')).toBeVisible();
  session.close();
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
  expect(api.request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  expect(warnings.mock.calls.filter(([message]) => String(message).includes('computations created outside'))).toEqual([]);
});

it.each([
  { locale: 'zh-CN' as const, width: 390, dark: false, touch: true },
  { locale: 'de-DE' as const, width: 320, dark: true, touch: false },
  { locale: 'en-US' as const, width: 1024, dark: true, touch: true },
])('keeps populated settings usable in $locale at $width px with dark=$dark and coarse=$touch', async ({ locale, width, dark, touch }) => {
  await media.emulateMediaPreferences({ reducedMotion: 'reduce', colorScheme: dark ? 'dark' : 'light' });
  await media.emulateTouchInput(touch);
  await mount(width, locale, dark);
  expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
  expect(matchMedia('(pointer: coarse)').matches).toBe(touch);
  for (const section of ['appearance', 'terminal', 'applications', 'containers', 'services', 'extensions', 'plugins', 'runtime', 'connection', 'codespaces'] as const) {
    const panel = await openCategory(section);
    inspectCategory(section, panel, locale);
    await page.screenshot({ path: `../../../../dist/settings-all-categories/${locale}-${width}-${dark ? 'dark' : 'light'}-${section}.png` });
  }
}, 60_000);

it('retains exact service drafts through real resource switches, invalid targets and owner refresh', async () => {
  const warnings = vi.spyOn(console, 'warn');
  await mount(1024);
  const panel = await openCategory('services');
  const picker = page.getByRole('combobox', { name: 'Added services', exact: true });
  const name = page.getByRole('textbox', { name: /^Name \*/ });
  await expect.element(name).toHaveValue('Development API');
  await name.fill('Unsaved API details');
  const first = name.element();
  await picker.click(); await page.getByRole('option', { name: 'Background Worker', exact: true }).click();
  await expect.element(name).toHaveValue('Background Worker');
  await name.fill('Unsaved worker details');
  const second = name.element();
  session.open({ section: 'services', resource: 'missing-service' });
  await expect.element(page.getByRole('alert')).toHaveTextContent('This settings target is no longer available.');
  expect([...panel.querySelectorAll<HTMLElement>('[data-testid=managed-service-settings]')].filter(node => node.checkVisibility())).toHaveLength(0);
  await picker.click(); await page.getByRole('option', { name: 'Development API', exact: true }).click();
  await expect.element(name).toHaveValue('Unsaved API details');
  expect(name.element()).toBe(first);
  const reads = () => api.request.mock.calls.filter(([url]) => String(url).endsWith('/design-service/settings')).length;
  const before = reads();
  await page.getByRole('group', { name: 'Added services', exact: true }).getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(reads).toBeGreaterThan(before);
  await expect.element(name).toHaveValue('Unsaved API details');
  expect(name.element()).toBe(first);
  await picker.click(); await page.getByRole('option', { name: 'Background Worker', exact: true }).click();
  await expect.element(name).toHaveValue('Unsaved worker details');
  expect(name.element()).toBe(second);
  inspectCategory('services', panel, 'en-US');
  expect(warnings.mock.calls.filter(([message]) => String(message).includes('computations created outside'))).toEqual([]);
});

it.each(['appearance','terminal','browser','containers','services','plugins','logging'] as const)('retires %s category selector portal on navigation', async section => {
 await mount(1440); const panel = await openCategory(section);
 const selector=panel.querySelector<HTMLElement>('[role=combobox]')!; expect(selector).not.toBeNull();
 selector.click();
 await expect.poll(() => document.querySelectorAll('[role=listbox]').length).toBeGreaterThan(0);
 session.open({section:section==='appearance'?'terminal':'appearance'});
 await expect.poll(() => document.querySelectorAll('[role=listbox]').length,{timeout:1500}).toBe(0);
});


it('hidden browser option cannot persist a frame rate choice', async () => {
 await mount(1440); const panel=await openCategory('browser');
 panel.querySelector<HTMLElement>('[role=combobox]')!.click();
 await expect.poll(() => document.querySelectorAll('[role=option]').length).toBeGreaterThan(0);
 const option=[...document.querySelectorAll<HTMLElement>('[role=option]')].find(node=>node.getAttribute('aria-selected')!=='true')!;
 const store=Object.fromEntries(Object.entries(localStorage)); session.open({section:'appearance'}); option.click();
 expect(Object.fromEntries(Object.entries(localStorage))).toEqual(store);
});


it('stale selected terminal option cannot navigate from another category', async () => {
 await mount(1440); const panel=await openCategory('terminal'); panel.querySelector<HTMLElement>('[role=combobox]')!.click();
 await expect.poll(() => document.querySelectorAll('[role=option]').length).toBeGreaterThan(0);
 const option=[...document.querySelectorAll<HTMLElement>('[role=option]')].find(node=>node.getAttribute('aria-selected')!=='true')!;
 session.open({section:'appearance'}); option.click(); await new Promise(resolve=>setTimeout(resolve,0));
 expect(session.target()?.section).toBe('appearance');
});
