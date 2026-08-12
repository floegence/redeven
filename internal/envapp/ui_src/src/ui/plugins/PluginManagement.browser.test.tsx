import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { LayoutProvider } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import {
  DEFAULT_WORKBENCH_THEME,
  WorkbenchSurface,
  createWorkbenchViewportFitForWidget,
  type WorkbenchState,
  type WorkbenchWidgetDefinition,
  type WorkbenchWidgetItem,
} from '@floegence/floe-webapp-core/workbench';
import type { PluginConfirmationIntent, PluginSurfaceHost } from '@floegence/redevplugin-ui';

import { I18nProvider, SUPPORTED_LOCALES, type RedevenLocale } from '../i18n';
import { loadEnvAppDictionary } from '../i18n/locales';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import { redevenWorkbenchWidgets } from '../workbench/redevenWorkbenchWidgets';
import { ActivityPluginSurfaceWindow } from './ActivityPluginSurfaceWindow';
import { ExternalPluginInstallDialog } from './ExternalPluginInstallDialog';
import { PluginConfirmationDialog, createPluginConfirmationQueue } from './PluginConfirmationQueue';
import { PluginCenterView } from './PluginCenterView';
import { PluginPanel } from './PluginPanel';
import { PluginUpdateReviewDialog } from './PluginUpdateReviewDialog';
import {
  OFFICIAL_PLUGIN_CATALOG_SEED,
  OFFICIAL_PLUGIN_MARKET_SNAPSHOT,
} from './officialPluginCatalog.test-fixture';
import { PLUGIN_MOBILE_TOUCH_TARGET_CLASS } from './pluginPresentation';
import type { PluginSurfacePlacementCoordinator } from './pluginPlatform';
import type {
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  PluginInventoryItem,
  PluginInventoryProjection,
  PluginPanelModel,
} from './pluginTypes';

const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{
    forcedColors?: null | 'active' | 'none';
    reducedMotion?: null | 'reduce' | 'no-preference';
  }>) => Promise<void>;
}>;

const viewportCases = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 768, height: 820 },
  { width: 1440, height: 900 },
] as const;

const containersHostPresentation = {
  default_locale: OFFICIAL_PLUGIN_MARKET_SNAPSHOT.plugins[0]!.presentation.default_locale,
  locales: OFFICIAL_PLUGIN_MARKET_SNAPSHOT.plugins[0]!.presentation.locales.map((locale) => ({
    locale: locale.locale,
    plugin_name: locale.name,
    ...(locale.publisher_name ? { publisher_name: locale.publisher_name } : {}),
    summary: locale.summary,
    description: [locale.summary],
    highlights: [locale.keywords.join(', ')],
    keywords: [...locale.keywords],
    surfaces: [{ surface_id: 'containers.dashboard', label: locale.name }],
    settings: [],
  })),
};

const updateDialogViewportCases = [
  { width: 320, height: 568 },
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 768, height: 820 },
  { width: 1180, height: 800 },
  { width: 1440, height: 900 },
] as const;

const containersItem: PluginInventoryItem = {
  inventoryKey: 'instance:containers',
  pluginID: 'com.redeven.official.containers',
  pluginInstanceID: 'plugini_redeven_official_containers',
  displayName: 'Containers',
  description: 'Manage Docker and Podman resources without leaving the current environment.',
  iconFallback: 'generic',
  category: 'infrastructure',
  searchKeywords: ['docker', 'podman'],
  publisher: 'Redeven',
  version: '2.0.0',
  managementRevision: 7,
  canDisable: true,
  lifecycleState: 'enabled',
  trustBadge: 'official',
  pinned: true,
  presentation: containersHostPresentation,
  defaultLaunchTarget: {
    pluginID: 'com.redeven.official.containers',
    pluginInstanceID: 'plugini_redeven_official_containers',
    surfaceID: 'containers.dashboard',
    displayName: 'Containers',
    expectedManagementRevision: 7,
    preferredPlacement: 'activity',
  },
  authorization: {
    grants: [],
    permissions: [{
      permissionID: 'containers.read',
      group: 'read',
      requiredToOpen: true,
      methods: ['containers.status'],
      requiredToOpenMethods: ['containers.status'],
      granted: true,
      deniedByGrant: false,
      blockedByPolicy: false,
      grantBlockedByPolicy: false,
      blockedToOpen: false,
    }],
    revisions: {
      policyRevision: 3,
      managementRevision: 7,
      revokeEpoch: 2,
    },
  },
};

const toolboxItem: PluginInventoryItem = {
  inventoryKey: 'instance:toolbox',
  pluginID: 'com.example.toolbox',
  pluginInstanceID: 'plugini_example_toolbox',
  displayName: 'Developer Toolbox With A Deliberately Long Name',
  description: 'A long description verifies that plugin copy stays inside its assigned readable column.',
  iconFallback: 'generic',
  category: 'development',
  searchKeywords: ['toolbox'],
  publisher: 'Example Publisher',
  version: '1.2.3',
  managementRevision: 4,
  lifecycleState: 'disabled',
  trustBadge: 'community',
  pinned: false,
};

const projection: PluginInventoryProjection = { items: [containersItem, toolboxItem] };
const panelModel: PluginPanelModel = {
  loading: false,
  tiles: [
    { kind: 'plugin', item: containersItem, action: 'open_surface' },
    { kind: 'plugin', item: toolboxItem, action: 'open_details' },
    { kind: 'open_center', id: 'plugin-center', label: 'Plugin Center' },
  ],
};

const updateDialogItem: PluginInventoryItem = {
  ...containersItem,
  version: '4.0.0',
  managementRevision: 18,
  lifecycleState: 'update_available',
  trustBadge: 'unsigned',
  installedPackage: {
    packageHash: 'sha256:previous-package',
    manifestHash: 'sha256:previous-manifest',
    entriesHash: 'sha256:previous-entries',
  },
  officialCatalog: OFFICIAL_PLUGIN_CATALOG_SEED[0],
  defaultLaunchTarget: {
    ...containersItem.defaultLaunchTarget!,
    expectedManagementRevision: 18,
  },
};

const updatePanelModel: PluginPanelModel = {
  loading: false,
  tiles: [
    { kind: 'plugin', item: updateDialogItem, action: 'open_surface' },
    { kind: 'open_center', id: 'plugin-center', label: 'Plugin Center' },
  ],
};

const disposers: Array<() => void> = [];

function fixedHost(): HTMLDivElement {
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    overflow: 'hidden',
  });
  document.body.appendChild(host);
  return host;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function expectInsideViewport(element: Element, viewport: Readonly<{ width: number; height: number }>): void {
  const rect = element.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(-1);
  expect(rect.top).toBeGreaterThanOrEqual(-1);
  expect(rect.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect.bottom).toBeLessThanOrEqual(viewport.height + 1);
}

function expectNoHorizontalOverflow(element: HTMLElement): void {
  expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
}

function expectTouchTarget(element: Element): void {
  const rect = element.getBoundingClientRect();
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
}

function expectTouchTargets(elements: readonly Element[]): void {
  const undersized = elements.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width >= 44 && rect.height >= 44) return [];
    return [{
      control: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }];
  });
  expect(undersized).toEqual([]);
}

async function expectScreenshotHasPixelVariance(): Promise<void> {
  const screenshot = await page.screenshot({ save: false });
  expect(screenshot.length).toBeGreaterThan(1_000);
  const image = new Image();
  image.src = screenshot.startsWith('data:') ? screenshot : `data:image/png;base64,${screenshot}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const colorBuckets = new Set<string>();
  for (let index = 0; index < pixels.length; index += 16) {
    colorBuckets.add(`${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${pixels[index + 2] >> 4}`);
  }
  expect(colorBuckets.size).toBeGreaterThan(4);
}

function mountPanel(mobile: boolean, model: PluginPanelModel = panelModel): Readonly<{
  host: HTMLElement;
  trigger: () => HTMLButtonElement | undefined;
}> {
  const host = fixedHost();
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const [open, setOpen] = createSignal(true);
  disposers.push(render(() => (
    <>
      <button
        ref={setTrigger}
        type="button"
        data-testid="plugin-switcher-trigger"
        class="fixed left-3 top-5 h-11 w-11"
      >
        Plugins
      </button>
      <button type="button" data-testid="after-plugin-switcher" class="fixed bottom-3 right-3 h-11">
        After switcher
      </button>
      <PluginPanel
        id="plugin-switcher-browser-test"
        open={open()}
        mobile={mobile}
        trigger={trigger()}
        model={model}
        onClose={() => setOpen(false)}
        onOpenCenter={() => undefined}
        onOpenPluginSurface={() => undefined}
        onOpenPluginDetails={() => undefined}
      />
    </>
  ), host));
  return { host, trigger };
}

function mountPluginCenter(): HTMLElement {
  const host = fixedHost();
  disposers.push(render(() => (
    <PluginCenterView
      projection={projection}
      loading={false}
      canManagePlugins
      canOpenPluginSurfaces
      onRefresh={() => undefined}
      onCommand={() => undefined}
    />
  ), host));
  return host;
}

async function mountLocalizedPluginCenter(locale: RedevenLocale): Promise<HTMLElement> {
  localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
  await loadEnvAppDictionary(locale);
  const host = fixedHost();
  const localizedProjection: PluginInventoryProjection = {
    items: [{
      ...containersItem,
      officialCatalog: OFFICIAL_PLUGIN_CATALOG_SEED[0],
      lifecycleState: 'needs_attention',
      attentionReason: 'runtime_missing',
      displayName: 'Container Runtime Integration With A Deliberately Long Localized Layout Name',
    }],
  };
  disposers.push(render(() => (
    <I18nProvider>
      <PluginCenterView
        projection={localizedProjection}
        loading={false}
        canManagePlugins
        canOpenPluginSurfaces
        onRefresh={() => undefined}
        onCommand={() => undefined}
      />
    </I18nProvider>
  ), host));
  return host;
}

function mountPluginCenterNavigation(): Readonly<{
  host: HTMLElement;
  openDetails: (inventoryKey: string) => void;
}> {
  const host = fixedHost();
  const [selectedInventoryKey, setSelectedInventoryKey] = createSignal<string>();
  const [focusRequest, setFocusRequest] = createSignal(0);
  disposers.push(render(() => (
    <PluginCenterView
      projection={projection}
      loading={false}
      selectedInventoryKey={selectedInventoryKey()}
      focusRequest={focusRequest()}
      canManagePlugins
      canOpenPluginSurfaces
      onRefresh={() => undefined}
      onCommand={() => undefined}
    />
  ), host));
  return {
    host,
    openDetails: (inventoryKey) => {
      setSelectedInventoryKey(inventoryKey);
      setFocusRequest((request) => request + 1);
    },
  };
}

function unavailableInspection(): ExternalPluginInspection {
  throw new Error('Inspection is not used on the source-stage geometry path');
}

function unavailableCommit(): ExternalPluginCommitResult {
  throw new Error('Commit is not used on the source-stage geometry path');
}

function mountExternalDialog(
  onInspect: Parameters<typeof ExternalPluginInstallDialog>[0]['onInspect'] = async () => unavailableInspection(),
): HTMLElement {
  const host = fixedHost();
  disposers.push(render(() => (
    <ExternalPluginInstallDialog
      open
      onOpenChange={() => undefined}
      onInspect={onInspect}
      onCommit={async () => unavailableCommit()}
      onCommitted={() => undefined}
    />
  ), host));
  return host;
}

function mountUpdateReviewDialog(): HTMLElement {
  const host = fixedHost();
  disposers.push(render(() => (
    <PluginUpdateReviewDialog
      open
      item={updateDialogItem}
      canManage
      onOpenChange={() => undefined}
      onInspect={async () => browserUpdateInspection()}
      onCommitExternal={async () => unavailableCommit()}
      onOfficialUpdate={async () => undefined}
      onRefresh={() => undefined}
      onCommitted={() => undefined}
      onOpenActivity={() => undefined}
      onViewPermissions={() => undefined}
    />
  ), host));
  return host;
}

function browserUpdateInspection(): ExternalPluginInspection {
  return {
    ...browserInspection(),
    intent: {
      action: 'update',
      plugin_instance_id: updateDialogItem.pluginInstanceID!,
      expected_management_revision: updateDialogItem.managementRevision!,
    },
    plugin_id: updateDialogItem.pluginID,
    version: '4.1.0',
  };
}

async function mountLocalizedExternalDialog(
  locale: RedevenLocale,
  onInspect: Parameters<typeof ExternalPluginInstallDialog>[0]['onInspect'],
): Promise<HTMLElement> {
  localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
  await loadEnvAppDictionary(locale);
  const host = fixedHost();
  disposers.push(render(() => (
    <I18nProvider>
      <ExternalPluginInstallDialog
        open
        onOpenChange={() => undefined}
        onInspect={onInspect}
        onCommit={async () => unavailableCommit()}
        onCommitted={() => undefined}
      />
    </I18nProvider>
  ), host));
  return host;
}

function browserInspection(): ExternalPluginInspection {
  const packageHash = 'sha256:8ecf6c0d206ee557c5528e2192b2594b5d097912b83028d43ff1336532b06d13';
  const manifestHash = 'sha256:f96534ca709165d0e30f6e7713a57ec0754f84f84ccadc2edc000f19dde7cc3d';
  const entriesHash = 'sha256:8a0048517719d934e52406dc6e9964d9ca165728d3e530d2c4df16f619bf17fa';
  return {
    inspection_id: 'inspection_external_browser_test',
    expires_at: '2026-07-25T18:00:00Z',
    intent: { action: 'install', plugin_instance_id: 'plugini_external_browser_test' },
    publisher_id: 'com.example.publisher',
    plugin_id: 'com.example.toolbox',
    version: '1.2.3',
    inspected_hashes: { package_sha256: packageHash, manifest_sha256: manifestHash, entries_sha256: entriesHash },
    signature_assessment: {
      state: 'absent',
      reason_codes: [],
      assessed_hashes: { package_sha256: packageHash, manifest_sha256: manifestHash, entries_sha256: entriesHash },
      assessed_at: '2026-07-25T10:00:00Z',
    },
    source_provenance: {
      kind: 'package_url',
      source_origin: 'https://plugins.example.com',
      source_path: '/toolbox.redevplugin',
      redirect_chain: [],
      package_sha256: packageHash,
      resolved_at: '2026-07-25T10:00:00Z',
    },
    execution_approval: { state: 'pending', reason_codes: [], assessed_at: '2026-07-25T10:00:00Z' },
    update_eligibility: { state: 'manual_only', reason_codes: [], assessed_at: '2026-07-25T10:00:00Z' },
    security_summary: {
      summary_sha256: 'sha256:9b30eca232030072294fcabdc98df492609672c92d2d04a545d5790119d1822b',
      permissions: [],
      methods: [],
      capability_contracts: [],
      workers: [],
      network: [{
        connector_id: 'github-api',
        transport: 'http',
        scope: 'user',
        destinations: ['api.github.com:443'],
        auth_declared: true,
        tls_declared: true,
        method_access: [{ method: 'github.repositories', operations: ['http'], http_methods: ['GET'] }],
      }],
      storage: [],
      secret_refs: [],
      core_actions: [],
      intents: [],
      surfaces: [],
    },
    confirmation_digest: 'sha256:684a09cfd858448baa7d52c3d30932d7684a09cfd858448baa7d52c3d30932d7',
  };
}

function mountMobileTouchTargetContract(): HTMLElement {
  const host = fixedHost();
  disposers.push(render(() => (
    <Button data-plugin-mobile-touch-contract size="sm" class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS}>
      Critical plugin action
    </Button>
  ), host));
  return host;
}

function browserCoordinator(): PluginSurfacePlacementCoordinator {
  return {
    open: async (slot) => {
      const iframe = document.createElement('iframe');
      iframe.srcdoc = '<!doctype html><html><body>Plugin surface</body></html>';
      slot.element.appendChild(iframe);
      return {
        element: iframe,
        surfaceInstanceId: 'surface_browser_activity',
        sendLifecycle: () => undefined,
        updateContext: () => undefined,
        close: async () => ({
          quiesce: { outcome: 'acknowledged', durationMs: 0 },
          revokeDurationMs: 0,
          totalDurationMs: 0,
        }),
        dispose: async () => undefined,
      } satisfies PluginSurfaceHost;
    },
    setVisible: () => undefined,
    fail: async () => undefined,
    release: async () => undefined,
    invalidatePlugin: async () => undefined,
    closeAll: async () => undefined,
    dispose: async () => undefined,
  };
}

function mountActivityWindow(): HTMLElement {
  const host = fixedHost();
  const queue = createPluginConfirmationQueue();
  disposers.push(render(() => (
    <LayoutProvider>
      <ActivityPluginSurfaceWindow
        instanceID="activity_browser_plugin"
        target={containersItem.defaultLaunchTarget!}
        coordinator={browserCoordinator()}
        confirmationQueue={queue}
        visible
        active
        focusRequest={1}
        onActivate={() => undefined}
        onClosed={() => undefined}
        onEndPluginSession={async () => true}
        onRetirementError={() => undefined}
      />
    </LayoutProvider>
  ), host));
  return host;
}

function mountConfirmationDialog(): HTMLElement {
  const host = fixedHost();
  const queue = createPluginConfirmationQueue();
  const controller = new AbortController();
  const intent: PluginConfirmationIntent = {
    requestId: 'request_browser_confirmation',
    method: 'containers.delete',
    params: { container_id: 'api' },
    requestHash: 'sha256:request-browser-confirmation',
    planHash: 'sha256:plan-browser-confirmation',
    plan: {
      summary: 'Delete the selected production container after reviewing the irreversible impact',
      action: 'Delete container',
      resource_display_name: 'api-production-container-with-a-deliberately-long-name',
      destructive: true,
      risk_flags: [{ title: 'Service interruption', detail: 'The running service will stop immediately.' }],
    },
    confirmationTokenId: 'confirmation_browser',
    signal: controller.signal,
  };
  void queue.createHandler({
    pluginID: containersItem.pluginID,
    displayName: containersItem.displayName,
    pluginInstanceID: containersItem.pluginInstanceID!,
    surfaceID: containersItem.defaultLaunchTarget!.surfaceID,
    canConfirm: () => true,
  })(intent);
  disposers.push(render(() => <PluginConfirmationDialog queue={queue} />, host));
  return host;
}

function mountWorkbenchPluginChrome(viewport: Readonly<{ width: number; height: number }>): HTMLElement {
  const host = fixedHost();
  const productionDefinition = redevenWorkbenchWidgets.find((definition) => definition.type === 'redeven.plugin')!;
  const definition: WorkbenchWidgetDefinition = {
    ...productionDefinition,
    body: () => <div data-redeven-plugin-workbench-surface class="h-full w-full bg-background">Plugin surface</div>,
  };
  const item: WorkbenchWidgetItem = {
    id: 'workbench_plugin_browser',
    type: 'redeven.plugin',
    title: 'Developer Toolbox With A Deliberately Long Name',
    x: 20,
    y: 20,
    width: 720,
    height: 520,
    z_index: 1,
    created_at_unix_ms: Date.now(),
  };
  const [state, setState] = createSignal<WorkbenchState>({
    version: 1,
    widgets: [item],
    viewport: createWorkbenchViewportFitForWidget({
      widget: item,
      frameWidth: viewport.width,
      frameHeight: viewport.height,
      paddingPx: 32,
    }),
    locked: false,
    filters: {},
    selectedWidgetId: 'workbench_plugin_browser',
    theme: DEFAULT_WORKBENCH_THEME,
  });
  disposers.push(render(() => (
    <WorkbenchSurface
      state={state}
      setState={(updater) => setState(updater)}
      widgetDefinitions={[definition]}
      launcherWidgetTypes={[]}
      enableKeyboard={false}
    />
  ), host));
  return host;
}

beforeEach(async () => {
  await mediaCommands.emulateMediaPreferences({ forcedColors: 'none', reducedMotion: 'no-preference' });
  await page.viewport(1440, 900);
});

afterEach(async () => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.style.zoom = '';
  localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY);
  await mediaCommands.emulateMediaPreferences({ forcedColors: 'none', reducedMotion: 'no-preference' });
});

describe('plugin management browser geometry and interaction', () => {
  it.each(viewportCases.filter(({ width }) => width >= 768))(
    'centers the modal Plugin Launcher without overflow at $width px',
    async (viewport) => {
      await page.viewport(viewport.width, viewport.height);
      const mounted = mountPanel(false);
      await settle();

      const dialog = document.querySelector<HTMLElement>('#plugin-switcher-browser-test')!;
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expectInsideViewport(dialog, viewport);
      expectNoHorizontalOverflow(dialog);
      expect(Math.abs(dialog.getBoundingClientRect().left + dialog.getBoundingClientRect().width / 2 - viewport.width / 2)).toBeLessThan(2);
      expect(mounted.host.inert).toBe(true);

      const lastAction = dialog.querySelector<HTMLButtonElement>('[data-plugin-center-market-action]')!;
      lastAction.focus();
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    },
  );

  it('keeps the 320 px Plugin Switcher sheet modal, contained, and touchable', async () => {
    const viewport = viewportCases[0];
    await page.viewport(viewport.width, viewport.height);
    mountPanel(true);
    await settle();

    const dialog = document.querySelector<HTMLElement>('#plugin-switcher-browser-test')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expectInsideViewport(dialog, viewport);
    expectNoHorizontalOverflow(dialog);

    const actions = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'));
    expect(actions.length).toBeGreaterThanOrEqual(4);
    actions.forEach(expectTouchTarget);

    const lastAction = dialog.querySelector<HTMLButtonElement>('[data-plugin-center-market-action]')!;
    lastAction.focus();
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it.each([
    { width: 320, height: 568, mobile: true },
    { width: 1440, height: 900, mobile: false },
  ])('renders only the New update badge without overlapping plugin actions at $width px', async (viewport) => {
    await page.viewport(viewport.width, viewport.height);
    mountPanel(viewport.mobile, updatePanelModel);
    await settle();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 220));

    const tile = document.querySelector<HTMLElement>('[data-plugin-panel-tile="instance:containers"]')!;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const badge = tile.querySelector<HTMLElement>('[data-plugin-update-badge]')!;
    const tileRect = tile.getBoundingClientRect();
    const badgeRect = badge.getBoundingClientRect();

    expect(badge.textContent).toBe('New');
    expect(badgeRect.width).toBeGreaterThanOrEqual(28);
    expect(badgeRect.height).toBeGreaterThanOrEqual(16);
    expect(badgeRect.left).toBeGreaterThanOrEqual(tileRect.left);
    expect(badgeRect.right).toBeLessThanOrEqual(tileRect.right);
    expect(dialog.querySelector('[data-plugin-panel-tile-menu]')).toBeNull();
    await expectScreenshotHasPixelVariance();
  });

  it.each(viewportCases)('keeps Plugin Center readable and non-overlapping at $width px', async (viewport) => {
    await page.viewport(viewport.width, viewport.height);
    const host = mountPluginCenter();
    await settle();

    const view = host.querySelector<HTMLElement>('[data-plugin-center-view]')!;
    const shell = host.querySelector<HTMLElement>('[data-plugin-center-shell]')!;
    const master = host.querySelector<HTMLElement>('[data-plugin-center-master]')!;
    const item = host.querySelector<HTMLElement>('[data-plugin-center-item="instance:containers"]')!;
    expectInsideViewport(view, viewport);
    expectNoHorizontalOverflow(view);
    expectNoHorizontalOverflow(shell);
    expect(host.querySelector('[data-plugin-center-details]')).toBeNull();
    expect(getComputedStyle(item).boxShadow).toBe('none');
    const filterTriggers = Array.from(host.querySelectorAll<HTMLElement>('[data-plugin-center-filter]'));
    expect(filterTriggers).toHaveLength(3);
    expect(filterTriggers.map((trigger) => trigger.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Plugin source: All'),
      expect.stringContaining('Trust: All'),
      expect.stringContaining('Lifecycle: All'),
    ]));
    filterTriggers.forEach((trigger) => expect(trigger.querySelector('svg')).not.toBeNull());

    item.click();
    await settle();
    const details = host.querySelector<HTMLElement>('[data-plugin-center-details]')!;
    const detailControls = details.querySelector<HTMLElement>('[data-plugin-detail-controls]')!;
    const detailBody = details.querySelector<HTMLElement>('[data-plugin-detail-scroll-body]')!;
    const detailActions = details.querySelector<HTMLElement>('[data-plugin-action-row]')!;
    const selectedRow = item.closest<HTMLElement>('article')!;
    expect(selectedRow.getAttribute('aria-current')).toBe('true');
    expect(getComputedStyle(selectedRow).boxShadow).not.toBe('none');
    expect(host.querySelector<HTMLElement>('[data-plugin-center-list]')!.className).toContain('grid-cols-[repeat(auto-fill');
    expect(getComputedStyle(details).overflowY).toBe('hidden');
    expect(getComputedStyle(detailBody).overflowY).toBe('auto');
    expect(detailControls.contains(detailActions)).toBe(true);
    expect(detailBody.contains(detailActions)).toBe(false);
    const detailsRect = details.getBoundingClientRect();
    const controlsRect = detailControls.getBoundingClientRect();
    expect(controlsRect.top).toBeGreaterThanOrEqual(detailsRect.top - 1);
    expect(controlsRect.bottom).toBeLessThanOrEqual(detailsRect.bottom + 1);

    if (viewport.width >= 640) {
      expect(getComputedStyle(master).display).not.toBe('none');
      expect(getComputedStyle(details).display).not.toBe('none');
      const masterRect = master.getBoundingClientRect();
      expect(Math.abs(masterRect.top - detailsRect.top)).toBeLessThanOrEqual(1);
      expect(masterRect.right).toBeLessThanOrEqual(detailsRect.left + 1);
      if (viewport.width >= 1280) {
        expect(detailsRect.width).toBeGreaterThanOrEqual(360);
        expect(detailsRect.width).toBeLessThanOrEqual(420);
        expect(masterRect.width).toBeGreaterThan(detailsRect.width);
      }
    }
  });

  it('renders the selected Plugin Center detail with nonblank pixels in dark mode', async () => {
    await page.viewport(1440, 900);
    document.documentElement.classList.add('dark');
    const host = mountPluginCenter();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-plugin-center-item="instance:containers"]')!.click();
    await settle();

    const view = host.querySelector<HTMLElement>('[data-plugin-center-view]')!;
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(view.querySelector('[data-plugin-center-details]')).not.toBeNull();
    expectNoHorizontalOverflow(view);
    await expectScreenshotHasPixelVariance();
  });

  it('keeps the localized primary card action on one line before and after selection', async () => {
    await page.viewport(2048, 1200);
    const host = await mountLocalizedPluginCenter('zh-CN');
    await settle();

    const card = host.querySelector<HTMLElement>('[data-plugin-directory-card="instance:containers"]')!;
    expect(card.querySelector('[data-plugin-center-item] [lang="zh-CN"]')).not.toBeNull();
    expect(card.querySelector('[data-plugin-center-item] [dir="auto"]')).not.toBeNull();
    const primary = card.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="instance:containers"]')!;
    const label = primary.querySelector<HTMLElement>('[data-plugin-center-card-primary-label]')!;
    const actions = card.querySelector<HTMLElement>('[data-plugin-center-card-actions]')!;
    const initialHeight = primary.getBoundingClientRect().height;
    expect(label.textContent?.trim()).toBe('查看运行时要求');
    expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
    expect(primary.scrollWidth).toBeLessThanOrEqual(primary.clientWidth + 1);
    expectNoHorizontalOverflow(actions);

    card.querySelector<HTMLButtonElement>('[data-plugin-center-item="instance:containers"]')!.click();
    await settle();

    expect(card.getAttribute('aria-current')).toBe('true');
    expect(primary.getBoundingClientRect().height).toBe(initialHeight);
    expect(primary.scrollWidth).toBeLessThanOrEqual(primary.clientWidth + 1);
    expectNoHorizontalOverflow(actions);
  });

  it('opens the Plugin Center card overflow menu in the browser', async () => {
    await page.viewport(1440, 900);
    const host = mountPluginCenter();
    await settle();

    const card = host.querySelector<HTMLElement>('[data-plugin-center-item="instance:containers"]')!.closest('article')!;
    expect(card.getBoundingClientRect().height).toBeLessThanOrEqual(240);
    host.querySelector<HTMLButtonElement>('[data-plugin-center-card-menu="instance:containers"]')!.click();
    await settle();

    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain('Open');
    expect(menu.textContent).toContain('Open in Workbench');
    expect(menu.textContent).toContain('View plugin details');
    const detailsAction = [...menu.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'View plugin details')!;
    detailsAction.click();
    await settle();
    expect(host.querySelector('[data-plugin-center-details]')?.textContent).toContain('Containers');
  });

  it('opens a filter from the keyboard and restores focus when dismissed', async () => {
    await page.viewport(390, 844);
    const host = mountPluginCenter();
    await settle();
    const source = host.querySelector<HTMLElement>('[data-plugin-center-filter="source"]')!;
    const sourceTrigger = source.closest<HTMLElement>('[data-floe-dropdown-trigger]')!;
    const trustTrigger = host.querySelector<HTMLElement>('[data-plugin-center-filter="trust"]')!
      .closest<HTMLElement>('[data-floe-dropdown-trigger]')!;
    expect(source.matches('button, [role="button"]')).toBe(false);
    expect(source.tabIndex).toBe(-1);
    expect(sourceTrigger.tabIndex).toBe(0);
    sourceTrigger.focus();
    await userEvent.keyboard('{Enter}');
    await settle();
    expect(sourceTrigger.getAttribute('aria-expanded')).toBe('true');
    await userEvent.keyboard('{Escape}');
    await settle();
    expect(sourceTrigger.getAttribute('aria-expanded')).not.toBe('true');
    expect(document.activeElement).toBe(sourceTrigger);
    await userEvent.tab();
    expect(document.activeElement).toBe(trustTrigger);
  });

  it.each(viewportCases.filter(({ width }) => width <= 390))(
    'keeps clear filters visible outside the horizontal filter track at $width px',
    async (viewport) => {
      await page.viewport(viewport.width, viewport.height);
      const host = mountPluginCenter();
      await settle();
      const sourceTrigger = host.querySelector<HTMLElement>('[data-plugin-center-filter="source"]')!
        .closest<HTMLElement>('[data-floe-dropdown-trigger]')!;
      sourceTrigger.focus();
      await userEvent.keyboard('{Enter}');
      await settle();
      await userEvent.keyboard('{ArrowDown}{Enter}');
      await settle();

      const clear = host.querySelector<HTMLButtonElement>('[data-plugin-center-clear-filters]')!;
      expect(clear).not.toBeNull();
      expect(clear.closest('[data-plugin-center-filter-scroll]')).toBeNull();
      expectInsideViewport(clear, viewport);
      expectTouchTarget(clear);
    },
  );

  it('supports the 320 px Plugin Center list-to-detail drill-in and back navigation', async () => {
    const viewport = viewportCases[0];
    await page.viewport(viewport.width, viewport.height);
    const host = mountPluginCenter();
    await settle();

    const master = host.querySelector<HTMLElement>('[data-plugin-center-master]')!;
    const item = host.querySelector<HTMLButtonElement>('[data-plugin-center-item="instance:containers"]')!;
    expect(getComputedStyle(master).display).not.toBe('none');
    expect(host.querySelector('[data-plugin-center-details]')).toBeNull();
    expectTouchTarget(item);
    expectTouchTargets([
      host.querySelector<HTMLElement>('[data-plugin-center-install-external]')!,
      host.querySelector<HTMLElement>('[data-plugin-center-search]')!,
      host.querySelector<HTMLElement>('[data-plugin-center-refresh]')!,
      ...Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]')),
    ]);

    item.click();
    await settle();
    const details = host.querySelector<HTMLElement>('[data-plugin-center-details]')!;
    const back = host.querySelector<HTMLButtonElement>('[data-plugin-center-mobile-back]')!;
    expect(getComputedStyle(master).display).toBe('none');
    expect(getComputedStyle(details).display).not.toBe('none');
    expectTouchTarget(back);
    expect(document.activeElement).toBe(back);
    expectTouchTarget(host.querySelector<HTMLButtonElement>('[role="switch"]')!);
    expectInsideViewport(details, viewport);
    expectNoHorizontalOverflow(details);

    const permissionSwitch = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
    permissionSwitch.click();
    await settle();
    const permissionDialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expectTouchTargets(Array.from(permissionDialog.querySelectorAll<HTMLButtonElement>('button:not([aria-label="Close"])')));
    permissionDialog.querySelector<HTMLButtonElement>('button:not([aria-label="Close"])')?.click();
    await settle();

    back.click();
    await settle();
    expect(getComputedStyle(master).display).not.toBe('none');
    expect(host.querySelector('[data-plugin-center-details]')).toBeNull();
    expect(document.activeElement).toBe(item);
  });

  it('returns the 320 px Plugin Center to its list for search and tab changes', async () => {
    await page.viewport(320, 720);
    const host = mountPluginCenter();
    await settle();
    const master = host.querySelector<HTMLElement>('[data-plugin-center-master]')!;
    host.querySelector<HTMLButtonElement>('[data-plugin-center-item="instance:containers"]')!.click();
    await settle();
    expect(getComputedStyle(master).display).toBe('none');

    const search = host.querySelector<HTMLInputElement>('[data-plugin-center-search]')!;
    await userEvent.fill(search, 'containers');
    await settle();
    expect(getComputedStyle(master).display).not.toBe('none');
    expect(host.querySelector('[data-plugin-center-details]')).toBeNull();
    expect(document.activeElement).toBe(search);

    host.querySelector<HTMLButtonElement>('[data-plugin-center-item="instance:containers"]')!.click();
    await settle();
    const discover = host.querySelector<HTMLButtonElement>('#plugin-center-tab-discover')!;
    discover.click();
    await settle();
    expect(getComputedStyle(master).display).not.toBe('none');
    expect(host.querySelector('[data-plugin-center-details]')).toBeNull();
    expect(discover.getAttribute('aria-selected')).toBe('true');
  });

  it.each(SUPPORTED_LOCALES)(
    'keeps the 320 px Plugin Center contained for %s long copy',
    async (locale) => {
      await page.viewport(320, 720);
      const host = await mountLocalizedPluginCenter(locale);
      await settle();
      const view = host.querySelector<HTMLElement>('[data-plugin-center-view]')!;
      expect(view).not.toBeNull();
      expect(document.documentElement.lang).toBe(locale);
      expectInsideViewport(view, { width: 320, height: 720 });
      expectNoHorizontalOverflow(view);
      expectNoHorizontalOverflow(host.querySelector<HTMLElement>('[data-plugin-center-shell]')!);
      const item = host.querySelector<HTMLButtonElement>('[data-plugin-center-item="instance:containers"]')!;
      expect(item.querySelector(`[lang="${locale}"]`)).not.toBeNull();
      expectTouchTargets([
        host.querySelector<HTMLElement>('[data-plugin-center-install-external]')!,
        host.querySelector<HTMLElement>('[data-plugin-center-search]')!,
        host.querySelector<HTMLElement>('[data-plugin-center-refresh]')!,
        ...Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]')),
      ]);

      item.click();
      await settle();
      const detail = host.querySelector<HTMLElement>('[data-plugin-center-details]')!;
      expect(detail.querySelector(`[data-plugin-author-content] [lang="${locale}"]`)).not.toBeNull();
      expectNoHorizontalOverflow(detail);
    },
  );

  it('reopens a kept-alive mobile plugin detail for every shell navigation request', async () => {
    await page.viewport(320, 720);
    const navigation = mountPluginCenterNavigation();
    await settle();

    navigation.openDetails('instance:containers');
    await settle();
    const master = navigation.host.querySelector<HTMLElement>('[data-plugin-center-master]')!;
    const details = navigation.host.querySelector<HTMLElement>('[data-plugin-center-details]')!;
    const back = navigation.host.querySelector<HTMLButtonElement>('[data-plugin-center-mobile-back]')!;
    expect(getComputedStyle(master).display).toBe('none');
    expect(getComputedStyle(details).display).not.toBe('none');
    expect(document.activeElement).toBe(back);

    back.click();
    await settle();
    expect(getComputedStyle(master).display).not.toBe('none');
    expect(navigation.host.querySelector('[data-plugin-center-details]')).toBeNull();

    navigation.openDetails('instance:containers');
    await settle();
    const reopenedDetails = navigation.host.querySelector<HTMLElement>('[data-plugin-center-details]')!;
    const reopenedBack = navigation.host.querySelector<HTMLButtonElement>('[data-plugin-center-mobile-back]')!;
    expect(getComputedStyle(master).display).toBe('none');
    expect(getComputedStyle(reopenedDetails).display).not.toBe('none');
    expect(document.activeElement).toBe(reopenedBack);
  });

  it('moves desktop keyboard focus into details for shell navigation requests', async () => {
    await page.viewport(1440, 900);
    const navigation = mountPluginCenterNavigation();
    const staleTrigger = document.createElement('button');
    staleTrigger.textContent = 'View issue';
    document.body.append(staleTrigger);
    staleTrigger.focus();
    expect(document.activeElement).toBe(staleTrigger);

    navigation.openDetails('instance:containers');
    await settle();
    const heading = navigation.host.querySelector<HTMLHeadingElement>('[data-plugin-center-detail-heading]')!;
    expect(heading.textContent).toBe('Containers');
    expect(document.activeElement).toBe(heading);
  });

  it.each(viewportCases)('keeps the external install source step contained at $width px', async (viewport) => {
    await page.viewport(viewport.width, viewport.height);
    mountExternalDialog();
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const content = dialog.querySelector<HTMLElement>('[data-external-plugin-dialog]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expectInsideViewport(dialog, viewport);
    expectNoHorizontalOverflow(dialog);
    expectNoHorizontalOverflow(content);

    const sourceTabs = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const sourceLabels = Array.from(dialog.querySelectorAll<HTMLElement>('[data-external-plugin-source-label]'));
    expect(sourceTabs).toHaveLength(3);
    expect(sourceLabels).toHaveLength(3);
    sourceLabels.forEach(expectNoHorizontalOverflow);
    for (let index = 1; index < sourceTabs.length; index += 1) {
      expect(sourceTabs[index - 1].getBoundingClientRect().right)
        .toBeLessThanOrEqual(sourceTabs[index].getBoundingClientRect().left + 1);
    }
    const segments = Array.from(dialog.querySelectorAll<HTMLElement>('[data-install-progress-segment]'));
    const nodes = Array.from(dialog.querySelectorAll<HTMLElement>('[data-install-progress-node]'));
    const track = dialog.querySelector<HTMLElement>('[data-install-progress-track]')!;
    expect(segments).toHaveLength(4);
    expect(nodes).toHaveLength(4);
    expect(dialog.querySelector('[data-install-progress-current]')?.textContent).toBe('Plugin source');
    expect(dialog.querySelector('[data-install-progress]')?.textContent).toContain('Step 1 of 4');
    segments.forEach(expectNoHorizontalOverflow);
    const trackRect = track.getBoundingClientRect();
    const firstNodeRect = nodes[0].getBoundingClientRect();
    const lastNodeRect = nodes[nodes.length - 1].getBoundingClientRect();
    expect(Math.abs(trackRect.left - (firstNodeRect.left + firstNodeRect.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(trackRect.right - (lastNodeRect.left + lastNodeRect.width / 2))).toBeLessThanOrEqual(1);
    if (viewport.width === 320) {
      expectTouchTargets([
        ...sourceTabs,
        ...Array.from(dialog.querySelectorAll<HTMLInputElement>('input:not([type="file"])')),
        ...Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
          .filter((button) => button.getAttribute('role') !== 'tab'),
      ]);
    }
  });

  it.each(viewportCases)('keeps the external install review contained at $width px', async (viewport) => {
    await page.viewport(viewport.width, viewport.height);
    mountExternalDialog(async () => browserInspection());
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type="url"]')!;
    await userEvent.fill(input, 'https://plugins.example.com/toolbox.redevplugin');
    dialog.querySelector<HTMLButtonElement>('[data-external-plugin-inspect]')!.click();
    await settle();

    const consent = dialog.querySelector<HTMLElement>('[data-external-plugin-confirmation]')!;
    const trustReview = dialog.querySelector<HTMLElement>('[data-external-plugin-trust-review]')!;
    const highlights = dialog.querySelector<HTMLElement>('[data-external-plugin-review-highlights]')!;
    const report = dialog.querySelector<HTMLDetailsElement>('[data-external-plugin-report]')!;
    const footer = dialog.querySelector<HTMLElement>('[data-external-plugin-footer]')!;
    expect(trustReview.textContent).toContain('Confirm this package source');
    expect(trustReview.textContent).not.toContain('Waiting for your approval');
    expect(highlights.textContent).toContain('api.github.com:443');
    expect(highlights.textContent).toContain('What this plugin can do');
    expect(highlights.textContent).toContain('Other access to review');
    expect(highlights.textContent).not.toContain('declares no plugin capabilities or access');
    expect(report.open).toBe(false);
    expect(document.activeElement).toBe(trustReview);
    expect(footer.contains(consent)).toBe(true);
    expectInsideViewport(dialog, viewport);
    expectNoHorizontalOverflow(consent);
    expectNoHorizontalOverflow(trustReview);
    expectNoHorizontalOverflow(highlights);
    expectNoHorizontalOverflow(report);
    expectNoHorizontalOverflow(footer);
    if (viewport.width === 320) {
      expectTouchTarget(consent);
      expectInsideViewport(consent, viewport);
      const touchContractHost = mountMobileTouchTargetContract();
      await settle();
      expectTouchTarget(touchContractHost.querySelector<HTMLElement>('[data-plugin-mobile-touch-contract]')!);
      await expectScreenshotHasPixelVariance();
    }
    report.querySelector<HTMLElement>('summary')!.click();
    await settle();
    expect(report.open).toBe(true);
    expectNoHorizontalOverflow(report);
  });

  it('keeps a long localized review contained and its report keyboard-operable', async () => {
    const viewport = { width: 320, height: 720 } as const;
    await page.viewport(viewport.width, viewport.height);
    await mountLocalizedExternalDialog('de-DE', async () => browserInspection());
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await userEvent.fill(dialog.querySelector<HTMLInputElement>('input[type="url"]')!, 'https://plugins.example.com/toolbox.redevplugin');
    dialog.querySelector<HTMLButtonElement>('[data-external-plugin-inspect]')!.click();
    await settle();

    const trustReview = dialog.querySelector<HTMLElement>('[data-external-plugin-trust-review]')!;
    const highlights = dialog.querySelector<HTMLElement>('[data-external-plugin-review-highlights]')!;
    const report = dialog.querySelector<HTMLDetailsElement>('[data-external-plugin-report]')!;
    const reportSummary = report.querySelector<HTMLElement>('summary')!;
    const footer = dialog.querySelector<HTMLElement>('[data-external-plugin-footer]')!;
    expect(document.documentElement.lang).toBe('de-DE');
    expect(document.activeElement).toBe(trustReview);
    expectInsideViewport(dialog, viewport);
    [dialog, trustReview, highlights, report, footer].forEach(expectNoHorizontalOverflow);

    reportSummary.focus();
    expect(document.activeElement).toBe(reportSummary);
    await userEvent.keyboard('{Enter}');
    await settle();
    expect(report.open).toBe(true);
    await userEvent.keyboard('{Space}');
    await settle();
    expect(report.open).toBe(false);
  });

  it.each(updateDialogViewportCases)(
    'keeps the update review footer visible and actions unwrapped at $width x $height',
    async (viewport) => {
      await page.viewport(viewport.width, viewport.height);
      mountUpdateReviewDialog();
      await settle();

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      const content = dialog.querySelector<HTMLElement>('[data-plugin-update-dialog]')!;
      const footer = dialog.querySelector<HTMLElement>('[data-plugin-update-footer]')!;
      const submit = dialog.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!;
      const consent = footer.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expectInsideViewport(dialog, viewport);
      expectInsideViewport(footer, viewport);
      expectNoHorizontalOverflow(dialog);
      expectNoHorizontalOverflow(content);
      expectNoHorizontalOverflow(footer);
      expect(getComputedStyle(submit).whiteSpace).toBe('nowrap');
      expect(submit.scrollWidth).toBeLessThanOrEqual(submit.clientWidth + 1);
      if (viewport.width < 640) {
        expectTouchTarget(submit);
        expectTouchTarget(footer.querySelector<HTMLButtonElement>('button')!);
      } else {
        expect(submit.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
        expect(footer.querySelector<HTMLButtonElement>('button')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
      }
      expect(consent).not.toBeNull();
      if (viewport.width === 320 && viewport.height === 568) await expectScreenshotHasPixelVariance();
    },
  );

  it('keeps update review controls operable at the 320 px effective layout of 200 percent zoom', async () => {
    await page.viewport(320, 568);
    mountUpdateReviewDialog();
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const footer = dialog.querySelector<HTMLElement>('[data-plugin-update-footer]')!;
    const submit = dialog.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!;
    expectInsideViewport(dialog, { width: 320, height: 568 });
    expectInsideViewport(footer, { width: 320, height: 568 });
    expectNoHorizontalOverflow(dialog);
    expect(getComputedStyle(submit).whiteSpace).toBe('nowrap');
    expectTouchTarget(submit);
  });

  it.each(viewportCases)(
    'keeps Activity, Workbench, and confirmation window chrome contained at $width px',
    async (viewport) => {
      await page.viewport(viewport.width, viewport.height);
      mountActivityWindow();
      await settle();
      const activity = document.querySelector<HTMLElement>('[data-redeven-plugin-activity-window="true"]')!;
      expect(activity).not.toBeNull();
      expectInsideViewport(activity, viewport);
      expectNoHorizontalOverflow(activity);
      expect(activity.querySelector('[data-plugin-surface-host]')).not.toBeNull();

      while (disposers.length > 0) disposers.pop()?.();
      document.body.replaceChildren();
      const workbenchHost = mountWorkbenchPluginChrome(viewport);
      await settle();
      const widget = workbenchHost.querySelector<HTMLElement>('[data-workbench-widget-type="redeven.plugin"]')!;
      expect(widget).not.toBeNull();
      expectInsideViewport(widget, viewport);
      expectNoHorizontalOverflow(widget);
      expect(widget.querySelector('[data-redeven-plugin-workbench-surface]')).not.toBeNull();
      expect(widget.querySelector('[aria-label="Remove widget"]')).not.toBeNull();

      while (disposers.length > 0) disposers.pop()?.();
      document.body.replaceChildren();
      mountConfirmationDialog();
      await settle();
      const confirmation = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(confirmation).not.toBeNull();
      expectInsideViewport(confirmation, viewport);
      expectNoHorizontalOverflow(confirmation);
      if (viewport.width === 320) {
        expectTouchTargets(Array.from(confirmation.querySelectorAll<HTMLButtonElement>('button')));
      }
    },
  );

  it('keeps primary plugin flows operable without waiting for motion', async () => {
    await page.viewport(320, 720);
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce', forcedColors: 'none' });
    const host = mountPluginCenter();
    await settle();

    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    const card = host.querySelector<HTMLElement>('[data-plugin-center-item="instance:containers"]')!.closest('article')!;
    expect(getComputedStyle(card).animationName).toBe('none');
    expect(getComputedStyle(card).transitionDuration).toBe('0s');
    host.querySelector<HTMLButtonElement>('[data-plugin-center-item="instance:containers"]')!.click();
    await Promise.resolve();
    const details = host.querySelector<HTMLElement>('[data-plugin-center-details]')!;
    expect(getComputedStyle(details).display).not.toBe('none');
    expect(getComputedStyle(details).animationName).toBe('none');
    host.querySelector<HTMLButtonElement>('[data-plugin-center-mobile-back]')!.click();
    await Promise.resolve();
    expect(getComputedStyle(host.querySelector<HTMLElement>('[data-plugin-center-master]')!).display).not.toBe('none');
  });

  it('uses coordinated lift, depth, and icon motion for plugin directory transitions', async () => {
    const host = mountPluginCenter();
    await settle();

    const root = host.querySelector<HTMLElement>('[data-plugin-center-view]')!;
    const card = host.querySelector<HTMLElement>('[data-plugin-center-item="instance:containers"]')!.closest('article')!;
    const icon = card.querySelector<HTMLElement>('.redeven-plugin-directory-card-icon')!;
    expect(getComputedStyle(root).animationName).toBe('animate-in');
    expect(getComputedStyle(root).animationDuration).toBe('0.2s');
    expect(getComputedStyle(card).getPropertyValue('--tw-enter-translate-y').trim()).toBe('0.25rem');
    expect(getComputedStyle(card).transitionProperty).toContain('transform');
    expect(getComputedStyle(card).transitionDuration).toBe('0.18s');
    expect(getComputedStyle(card).transitionTimingFunction).toContain('cubic-bezier(0.22, 1, 0.36, 1)');

    await page.elementLocator(card).hover();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
    const hoveredCardStyle = getComputedStyle(card);
    const hoveredCardTransform = new DOMMatrixReadOnly(hoveredCardStyle.transform);
    const hoveredIconTransform = new DOMMatrixReadOnly(getComputedStyle(icon).transform);
    expect(hoveredCardTransform.m42).toBeCloseTo(-1, 1);
    expect(hoveredCardStyle.boxShadow).not.toBe('none');
    expect(hoveredIconTransform.m11).toBeGreaterThan(1);
    expect(hoveredIconTransform.m11).toBeLessThan(1.03);
    await expectScreenshotHasPixelVariance();

    host.querySelector<HTMLButtonElement>('[data-plugin-center-item="instance:containers"]')!.click();
    await Promise.resolve();
    expect(card.getAttribute('aria-current')).toBe('true');
    expect(getComputedStyle(card).boxShadow).not.toBe('none');
    const details = host.querySelector<HTMLElement>('[data-plugin-center-details]')!;
    expect(getComputedStyle(details).animationName).toBe('animate-in');
    expect(getComputedStyle(details).animationDuration).toBe('0.2s');
  });

  it('keeps the external review report operable with reduced motion and forced colors', async () => {
    await page.viewport(390, 844);
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce', forcedColors: 'active' });
    mountExternalDialog(async () => browserInspection());
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await userEvent.fill(dialog.querySelector<HTMLInputElement>('input[type="url"]')!, 'https://plugins.example.com/toolbox.redevplugin');
    dialog.querySelector<HTMLButtonElement>('[data-external-plugin-inspect]')!.click();
    await settle();

    const report = dialog.querySelector<HTMLDetailsElement>('[data-external-plugin-report]')!;
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    expect(window.matchMedia('(forced-colors: active)').matches).toBe(true);
    expect(report.open).toBe(false);
    report.querySelector<HTMLElement>('summary')!.click();
    await Promise.resolve();
    expect(report.open).toBe(true);
    expectNoHorizontalOverflow(dialog);
    expectNoHorizontalOverflow(report);
  });
});
