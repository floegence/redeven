// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvSettingsPage } from './EnvSettingsPage';
import type { EnvSettingsPageContextValue } from './settings/EnvSettingsPageContext';
import { SETTINGS_GROUPS, SETTINGS_NAV_ITEMS } from './settings/settingsStructure';

const notificationMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

const protocolMocks = vi.hoisted(() => ({
  status: vi.fn(() => 'disconnected'),
}));

const envContextMocks = vi.hoisted(() => ({
  env: Object.assign(
    () => ({
      permissions: {
        can_read: true,
        can_write: true,
        can_execute: true,
        can_admin: true,
        is_owner: true,
      },
      status: 'online',
    }),
    { state: 'ready', loading: false, error: null },
  ),
  localRuntime: vi.fn(() => null),
  settingsSeq: vi.fn(() => 0),
  debugConsoleEnabled: vi.fn(() => false),
  setDebugConsoleEnabled: vi.fn(),
  connectionOverlayVisible: vi.fn(() => false),
  connectionOverlayMessage: vi.fn(() => 'Connecting to runtime...'),
  settingsFocusSeq: vi.fn(() => 0),
  settingsFocusSection: vi.fn(() => null),
  settingsOrigin: vi.fn((): { kind: 'flower'; returnSurfaceId: 'ai' } | null => null),
  returnFromSettingsOrigin: vi.fn(),
  bumpSettingsSeq: vi.fn(),
}));

let settingsFocusSeqAccessor: () => number = () => 0;
let settingsFocusSectionAccessor: () => string | null = () => null;

const runtimeUpdateMocks = vi.hoisted(() => ({
  version: {
    latestMeta: vi.fn(() => null),
    latestMetaLoading: vi.fn(() => false),
    latestMetaError: vi.fn(() => null),
    preferredTargetVersion: vi.fn(() => ''),
    runtimeService: vi.fn(() => undefined),
    currentVersion: vi.fn(() => 'v1.0.0'),
    refetchLatestVersion: vi.fn(async () => undefined),
  },
  maintenance: {
    displayedStatus: vi.fn(() => 'online'),
    stage: vi.fn(() => ''),
    error: vi.fn(() => null),
    maintaining: vi.fn(() => false),
    isUpgrading: vi.fn(() => false),
    isRestarting: vi.fn(() => false),
    startUpgrade: vi.fn(async () => undefined),
    startRestart: vi.fn(async () => undefined),
  },
  maintenanceContext: vi.fn(() => null),
  refetchMaintenanceContext: vi.fn(async () => null),
}));

const localApiMocks = vi.hoisted(() => ({
  fetchLocalApiJSON: vi.fn(async () => null),
}));

const desktopCodeWorkspaceMocks = vi.hoisted(() => ({
  prepareAvailable: vi.fn(() => true),
  prepareWorkspaceEngine: vi.fn(async () => ({ ok: true, prepared: true })),
  prepareWorkspaceEngineWithDesktop: vi.fn(async (): Promise<any> => ({ ok: true, prepared: true })),
}));

const desktopSessionContextMocks = vi.hoisted(() => ({
  readSnapshot: vi.fn<() => any>(() => null),
}));

let settingsResponse: any = null;

const codeRuntimeMocks = vi.hoisted(() => ({
  fetchCodeRuntimeStatus: vi.fn(async () => null),
  selectCodeRuntimeVersion: vi.fn(async () => undefined),
  removeCodeRuntimeVersion: vi.fn(async () => undefined),
  cancelCodeRuntimeOperation: vi.fn(async () => undefined),
  codeRuntimeOperationNeedsAttention: vi.fn(() => false),
  codeRuntimeOperationSucceeded: vi.fn(() => false),
}));

function icon(name: string) {
  return (props: any) => <span data-icon={name} class={props.class} />;
}

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: any[]) => values.filter(Boolean).join(' '),
  useNotification: () => notificationMocks,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  AlertTriangle: icon('AlertTriangle'),
  Bot: icon('Bot'),
  ChevronLeft: icon('ChevronLeft'),
  Code: icon('Code'),
  Database: icon('Database'),
  FileCode: icon('FileCode'),
  FileText: icon('FileText'),
  Globe: icon('Globe'),
  Grid3x3: icon('Grid3x3'),
  Key: icon('Key'),
  Layers: icon('Layers'),
  Link: icon('Link'),
  CheckCircle: icon('CheckCircle'),
  Download: icon('Download'),
  Pencil: icon('Pencil'),
  Plus: icon('Plus'),
  RefreshIcon: icon('RefreshIcon'),
  Settings: icon('Settings'),
  Search: icon('Search'),
  Shield: icon('Shield'),
  Terminal: icon('Terminal'),
  Trash: icon('Trash'),
  X: icon('X'),
  Zap: icon('Zap'),
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => (props.visible ? <div>{props.message}</div> : null),
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  Sidebar: (props: any) => <aside>{props.children}</aside>,
  SidebarContent: (props: any) => <div>{props.children}</div>,
  SidebarItem: (props: any) => (
    <button type="button" data-settings-nav-item={props.active ? 'active' : 'inactive'} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  SidebarItemList: (props: any) => <div>{props.children}</div>,
  SidebarSection: (props: any) => (
    <section>
      <div>{props.title}</div>
      {props.children}
    </section>
  ),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Button: (props: any) => (
    <button type="button" aria-label={props['aria-label']} onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  ),
  Checkbox: (props: any) => (
    <label>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).checked)}
        disabled={props.disabled}
      />
      {props.label}
    </label>
  ),
  ConfirmDialog: () => null,
  Dialog: () => null,
  Input: (props: any) => <input value={props.value} onInput={props.onInput} placeholder={props.placeholder} disabled={props.disabled} />,
  Select: (props: any) => (
    <select value={props.value} onChange={(event) => props.onChange?.((event.currentTarget as HTMLSelectElement).value)} disabled={props.disabled}>
      {(props.options ?? []).map((option: any) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    status: protocolMocks.status,
  }),
}));

vi.mock('../maintenance/RuntimeUpdateContext', () => ({
  useRuntimeUpdateContext: () => runtimeUpdateMocks,
}));

vi.mock('../maintenance/agentUpgradeState', () => ({
  resolveAgentUpgradeState: () => ({
    allowsUpgradeAction: true,
    requiresTargetVersion: true,
    message: '',
    policy: 'local',
    releasePageURL: '',
    actionLabel: 'Update Redeven',
    actionMethod: 'runtime_rpc_upgrade',
  }),
}));

vi.mock('../maintenance/agentVersion', () => ({
  isReleaseVersion: () => true,
}));

vi.mock('../maintenance/shared', () => ({
  formatAgentStatusLabel: (status: string) => status,
  formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error ?? '')),
}));

vi.mock('../services/localApi', () => ({
  fetchLocalApiJSON: localApiMocks.fetchLocalApiJSON,
}));

vi.mock('../services/desktopCodeWorkspaceBridge', () => ({
  desktopCodeWorkspacePrepareAvailable: desktopCodeWorkspaceMocks.prepareAvailable,
  prepareWorkspaceEngineInDesktop: desktopCodeWorkspaceMocks.prepareWorkspaceEngine,
  prepareWorkspaceEngineWithDesktop: desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop,
}));

vi.mock('../services/desktopSessionContext', () => ({
  readDesktopSessionContextSnapshot: desktopSessionContextMocks.readSnapshot,
}));

vi.mock('../services/codeRuntimeApi', () => ({
  fetchCodeRuntimeStatus: codeRuntimeMocks.fetchCodeRuntimeStatus,
  selectCodeRuntimeVersion: codeRuntimeMocks.selectCodeRuntimeVersion,
  removeCodeRuntimeVersion: codeRuntimeMocks.removeCodeRuntimeVersion,
  cancelCodeRuntimeOperation: codeRuntimeMocks.cancelCodeRuntimeOperation,
  codeRuntimeOperationNeedsAttention: codeRuntimeMocks.codeRuntimeOperationNeedsAttention,
  codeRuntimeOperationSucceeded: codeRuntimeMocks.codeRuntimeOperationSucceeded,
}));

vi.mock('../icons/FlowerIcon', () => ({
  FlowerIcon: icon('FlowerIcon'),
}));

vi.mock('../icons/CodexIcon', () => ({
  CodexIcon: icon('CodexIcon'),
  CodexNavigationIcon: icon('CodexNavigationIcon'),
}));

vi.mock('./EnvContext', () => ({
  useEnvContext: () => ({
    env: envContextMocks.env,
    localRuntime: envContextMocks.localRuntime,
    settingsSeq: envContextMocks.settingsSeq,
    debugConsoleEnabled: envContextMocks.debugConsoleEnabled,
    setDebugConsoleEnabled: envContextMocks.setDebugConsoleEnabled,
    connectionOverlayVisible: envContextMocks.connectionOverlayVisible,
    connectionOverlayMessage: envContextMocks.connectionOverlayMessage,
    settingsFocusSeq: envContextMocks.settingsFocusSeq,
    settingsFocusSection: envContextMocks.settingsFocusSection,
    settingsOrigin: envContextMocks.settingsOrigin,
    returnFromSettingsOrigin: envContextMocks.returnFromSettingsOrigin,
    bumpSettingsSeq: envContextMocks.bumpSettingsSeq,
  }),
}));

vi.mock('./EnvDebugConsoleSettingsPanel', () => ({
  EnvDebugConsoleSettingsPanel: () => <div>Debug Console Panel</div>,
}));

vi.mock('./settings/AIProviderDialog', () => ({
  AIProviderDialog: (props: any) => (
    <div
      data-testid="ai-provider-dialog"
      data-open={props.open ? 'true' : 'false'}
      data-provider-key-set={props.keySet ? 'true' : 'false'}
      data-web-search-key-set={props.webSearchKeySet ? 'true' : 'false'}
    >
      <button type="button" onClick={props.onConfirm} disabled={!props.open || !props.canInteract || !props.canAdmin || props.aiSaving}>
        Confirm provider
      </button>
    </div>
  ),
}));

vi.mock('./settings/CodeRuntimeSettingsCard', () => ({
  CodeRuntimeSettingsCard: (props: any) => (
    <section data-settings-card="Browser Editor">
      <div>Browser Editor</div>
      <div>{props.localPrepareFailure?.message}</div>
      <button type="button" onClick={props.onPrepare} disabled={props.actionLoading}>
        Update browser editor
      </button>
    </section>
  ),
}));

vi.mock('./settings/PermissionPolicyTables', () => ({
  PermissionMatrixTable: () => <div>Permission Matrix</div>,
  PermissionRuleTable: () => <div>Permission Rules</div>,
}));

vi.mock('./settings/SkillsCatalogTable', () => ({
  SkillsCatalogTable: () => <div>Skills Catalog</div>,
}));

vi.mock('./settings/SettingsPrimitives', () => ({
  AutoSaveIndicator: () => <span>Auto-save</span>,
  CodeBadge: (props: any) => <code>{props.children}</code>,
  CompactField: (props: any) => (
    <label>
      <span>{props.label}</span>
      {props.children}
    </label>
  ),
  CopyButton: (props: any) => <button type="button" data-copy-value={props.value}>Copy</button>,
  DotIndicator: (props: any) => <span data-dot-indicator={props.active ? 'active' : 'inactive'}>{props.label}</span>,
  FieldLabel: (props: any) => <label>{props.children}</label>,
  InfoRow: (props: any) => (
    <div>
      <span>{props.label}</span>
      <span>{props.children}</span>
      {props.actions}
    </div>
  ),
  JSONEditor: (props: any) => <textarea value={props.value} />,
  SectionGroup: (props: any) => (
    <section data-settings-group={props.groupId}>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  ),
  SettingsCard: (props: any) => (
    <section data-settings-card={props.title}>
      <h3>{props.title}</h3>
      <p>{props.description}</p>
      {props.actions}
      {props.children}
    </section>
  ),
  SettingsSection: (props: any) => (
    <section data-settings-card={props.title}>
      <h3>{props.title}</h3>
      <p>{props.description}</p>
      {props.actions}
      {props.children}
    </section>
  ),
  SettingsKeyValueTable: (props: any) => (
    <div>
      {(props.rows ?? []).map((row: any) => (
        <div>
          <span>{row.label}</span>
          <span>{row.value}</span>
          <span>{row.note}</span>
        </div>
      ))}
    </div>
  ),
  SettingsPill: (props: any) => <span>{props.children}</span>,
  SettingRow: (props: any) => (
    <div>
      <div>{props.title}</div>
      <div>{props.description}</div>
      <div>{props.control}</div>
      <div>{props.children}</div>
    </div>
  ),
  SettingsTable: (props: any) => <table>{props.children}</table>,
  SettingsTableBody: (props: any) => <tbody>{props.children}</tbody>,
  SettingsTableCell: (props: any) => <td>{props.children}</td>,
  SettingsTableHead: (props: any) => <thead>{props.children}</thead>,
  SettingsTableHeaderCell: (props: any) => <th>{props.children}</th>,
  SettingsTableHeaderRow: (props: any) => <tr>{props.children}</tr>,
  SettingsTableRow: (props: any) => <tr>{props.children}</tr>,
  SubSectionHeader: (props: any) => (
    <div>
      <div>{props.title}</div>
      <div>{props.description}</div>
      {props.actions}
    </div>
  ),
  ViewToggle: () => <div>View Toggle</div>,
}));

function flushPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function nextMicrotask(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

async function openSettingsSection(host: HTMLElement, section: string): Promise<void> {
  const button = host.querySelector(`[data-settings-nav-item="${section}"]`) as HTMLButtonElement | null;
  expect(button).toBeTruthy();
  button?.click();
  await flushPage();
}

describe('EnvSettingsPage', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    protocolMocks.status.mockReturnValue('disconnected');
    settingsResponse = null;
    settingsFocusSeqAccessor = () => 0;
    settingsFocusSectionAccessor = () => null;
    envContextMocks.settingsFocusSeq.mockImplementation(() => settingsFocusSeqAccessor());
    envContextMocks.settingsFocusSection.mockImplementation(() => settingsFocusSectionAccessor() as any);
    envContextMocks.settingsOrigin.mockReturnValue(null);
    envContextMocks.returnFromSettingsOrigin.mockReset();
    desktopCodeWorkspaceMocks.prepareAvailable.mockReset();
    desktopCodeWorkspaceMocks.prepareAvailable.mockReturnValue(true);
    desktopCodeWorkspaceMocks.prepareWorkspaceEngine.mockReset();
    desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop.mockReset();
    desktopSessionContextMocks.readSnapshot.mockReset();
    desktopSessionContextMocks.readSnapshot.mockReturnValue(null);
    host = document.createElement('div');
    document.body.appendChild(host);
    (localApiMocks.fetchLocalApiJSON as any).mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/settings') {
        return structuredClone(settingsResponse);
      }
      return null;
    });
  });

  afterEach(() => {
    host.remove();
  });

  it('renders the settings information architecture metadata and navigable sidebar', async () => {
    render(() => <EnvSettingsPage />, host);
    await flushPage();

    const groupTitles = SETTINGS_GROUPS.map((group) => group.title);
    expect(groupTitles).toEqual([
      'Overview',
      'Runtime Environment',
      'Security',
      'AI & Extensions',
      'Diagnostics',
    ]);

    const navLabels = SETTINGS_NAV_ITEMS.map((item) => item.label);
    expect(navLabels).toEqual([
      'Config File',
      'Connection',
      'Runtime Status',
      'Shell & Workspace',
      'Codespaces & Tooling',
      'Logging',
      'Permission Policy',
      'Flower',
      'Skills',
      'Codex',
      'Debug Console',
    ]);

    const renderedNavLabels = Array.from(host.querySelectorAll('button'))
      .map((node) => node.textContent?.trim() ?? '')
      .filter((label) => navLabels.includes(label));
    expect(renderedNavLabels).toEqual(navLabels);

    expect(host.querySelector('[data-settings-card="Config File"]')).toBeTruthy();
    expect(host.textContent).not.toContain('Language preference');
    expect(host.textContent).not.toContain('System default');

    const diagnosticsGroup = host.querySelector('[data-settings-group="diagnostics"]');
    expect(diagnosticsGroup?.querySelector('[data-settings-nav-item="debug_console"]')).not.toBeNull();

    const runtimeGroup = host.querySelector('[data-settings-group="runtime_configuration"]');
    expect(runtimeGroup?.querySelector('[data-settings-nav-item="debug_console"]')).toBeNull();
    expect(runtimeGroup?.querySelector('[data-settings-nav-item="runtime"]')).not.toBeNull();
    expect(runtimeGroup?.querySelector('[data-settings-nav-item="codespaces"]')).not.toBeNull();
    expect(runtimeGroup?.querySelector('[data-settings-nav-item="logging"]')).not.toBeNull();

    const aiGroup = host.querySelector('[data-settings-group="ai_extensions"]');
    const aiGroupSections = Array.from(aiGroup?.querySelectorAll('[data-settings-nav-item]') ?? []).map((node) => node.getAttribute('data-settings-nav-item'));
    expect(aiGroupSections).toEqual(['ai', 'skills', 'codex']);
    expect(host.querySelector('[data-settings-nav-item="plugins"]')).toBeNull();

    await openSettingsSection(host, 'debug_console');
    expect(host.querySelector('[data-settings-card="Debug Console"]')).toBeTruthy();

    await openSettingsSection(host, 'codespaces');
    expect(host.querySelector('[data-settings-card="Browser Editor"]')).toBeTruthy();
  });

  it('opens Runtime Settings on the existing Config File section by default', async () => {
    render(() => <EnvSettingsPage />, host);
    await flushPage();

    expect(host.querySelector('[data-settings-card="Config File"]')).toBeTruthy();
  });

  it('can render with an existing settings provider context instead of shadowing it', async () => {
    render(() => (
      <EnvSettingsPage
        context={{
          env: {
            settingsOrigin: () => null,
            returnFromSettingsOrigin: vi.fn(),
          } as unknown as EnvSettingsPageContextValue['env'],
          protocol: {} as EnvSettingsPageContextValue['protocol'],
          notify: {} as EnvSettingsPageContextValue['notify'],
          runtimeUpdate: {} as EnvSettingsPageContextValue['runtimeUpdate'],
          settings: Object.assign(() => null, { loading: false, error: null, state: 'ready' }) as EnvSettingsPageContextValue['settings'],
          refreshSettings: async () => undefined,
          mutateSettings: () => undefined,
          saveSettings: async () => ({ settings: null, aiUpdate: null }) as any,
          codexStatus: Object.assign(() => null, { loading: false, error: null, state: 'ready' }) as EnvSettingsPageContextValue['codexStatus'],
          refreshCodexStatus: () => undefined,
          codeRuntimeStatus: Object.assign(() => null, { loading: false, error: null, state: 'ready' }) as EnvSettingsPageContextValue['codeRuntimeStatus'],
          refreshCodeRuntimeStatus: () => undefined,
          canInteract: () => true,
          canAdmin: () => true,
          activeSection: () => 'ai',
          setActiveSection: vi.fn(),
          searchQuery: () => '',
          setSearchQuery: vi.fn(),
          latestVersion: () => null,
          latestVersionLoading: () => false,
          latestVersionError: () => null,
          maintenanceContext: () => null,
          upgradeState: () => null,
          displayedStatus: () => 'online',
          maintenanceStage: () => '',
          maintenanceError: () => null,
          maintaining: () => false,
          isUpgrading: () => false,
          isRestarting: () => false,
          runtimeService: () => null,
          activeWorkSummary: () => 'No active work',
          runtimeDesktopModelSourceBinding: () => null,
          statusLabel: () => 'Online',
          targetVersionInput: () => '',
          setTargetVersionInput: vi.fn(),
          targetUpgradeVersion: () => '',
          targetUpgradeVersionValid: () => false,
          canStartRestart: () => false,
          canStartUpgrade: () => false,
          startRestart: async () => undefined,
          startUpgrade: async () => undefined,
          refreshSettingsPage: async () => undefined,
          codeRuntimeActionLoading: () => false,
          codeRuntimeCancelLoading: () => false,
          codeRuntimeSelectionLoadingVersion: () => null,
          codeRuntimeRemoveVersionLoading: () => null,
          codeRuntimeLocalPrepareFailure: () => null,
          canManageCodeRuntime: () => false,
          prepareManagedCodeRuntime: () => undefined,
          cancelManagedCodeRuntimeOperation: () => undefined,
          selectManagedCodeRuntimeVersion: () => undefined,
          removeManagedCodeRuntimeVersion: () => undefined,
          showLoadingCurtain: () => undefined,
          hideLoadingCurtain: () => undefined,
        }}
      />
    ), host);
    await flushPage();

    expect(host.querySelector('[data-settings-card="Flower"]')).toBeTruthy();
    expect(localApiMocks.fetchLocalApiJSON).not.toHaveBeenCalledWith('/_redeven_proxy/api/settings', { method: 'GET' });
  });

  it('shows an icon-only back to Flower only for settings opened from Flower', async () => {
    envContextMocks.settingsOrigin.mockReturnValue({ kind: 'flower', returnSurfaceId: 'ai' });

    render(() => <EnvSettingsPage initialSection="ai" />, host);
    await flushPage();

    const back = host.querySelector('button[aria-label="Back to Flower"]') as HTMLButtonElement | null;
    expect(back).toBeTruthy();
    expect(back?.textContent?.trim()).toBe('');

    back?.click();
    expect(envContextMocks.returnFromSettingsOrigin).toHaveBeenCalledTimes(1);

    host.innerHTML = '';
    envContextMocks.settingsOrigin.mockReturnValue(null);
    render(() => <EnvSettingsPage initialSection="ai" />, host);
    await flushPage();

    expect(host.querySelector('button[aria-label="Back to Flower"]')).toBeNull();
  });

  it('honors the shell focus request for a Runtime Settings section', async () => {
    const [focusSeq, setFocusSeq] = createSignal(1);
    const [focusSection] = createSignal('agent');
    settingsFocusSeqAccessor = focusSeq;
    settingsFocusSectionAccessor = focusSection;

    render(() => <EnvSettingsPage />, host);
    await flushPage();

    await openSettingsSection(host, 'codespaces');
    expect(host.querySelector('[data-settings-card="Codespaces Ports"]')).toBeTruthy();

    setFocusSeq(2);
    await flushPage();

    expect(host.querySelector('[data-settings-card="Runtime Status"]')).toBeTruthy();
  });

  it('renders Runtime Service identity and live-work rows in Runtime Status', async () => {
    (runtimeUpdateMocks.version.runtimeService as any).mockReturnValue({
      runtimeVersion: 'v1.4.2',
      runtimeCommit: 'abc123',
      runtimeBuildTime: '2026-05-02T00:00:00Z',
      protocolVersion: 'redeven-runtime-v1',
      serviceOwner: 'desktop',
      desktopManaged: true,
      effectiveRunMode: 'hybrid',
      remoteEnabled: true,
      compatibility: 'restart_recommended',
      compatibilityMessage: 'Restart when your work is idle.',
      activeWorkload: {
        terminalCount: 3,
        sessionCount: 2,
        taskCount: 1,
        portForwardCount: 4,
      },
      capabilities: {
        desktopModelSource: {
          supported: true,
          bindMethod: 'runtime_control_v1',
        },
      },
      bindings: {
        desktopModelSource: {
          state: 'bound',
          sessionId: 'desktop-session',
          modelCount: 2,
        },
      },
    });

    render(() => <EnvSettingsPage />, host);
    await flushPage();
    await openSettingsSection(host, 'agent');

    const runtimeStatus = host.querySelector('[data-settings-card="Runtime Status"]');
    expect(runtimeStatus?.textContent).toContain('Service owner');
    expect(runtimeStatus?.textContent).toContain('Redeven Desktop');
    expect(runtimeStatus?.textContent).toContain('Maintenance authority');
    expect(runtimeStatus?.textContent).toContain('Runtime RPC');
    expect(runtimeStatus?.textContent).toContain('Compatibility');
    expect(runtimeStatus?.textContent).toContain('Restart recommended');
    expect(runtimeStatus?.textContent).toContain('Restart when your work is idle.');
    expect(runtimeStatus?.textContent).toContain('Active work');
    expect(runtimeStatus?.textContent).toContain('3 terminals, 2 sessions, 1 task, 4 web services');
    expect(runtimeStatus?.textContent).toContain('Runtime protocol');
    expect(runtimeStatus?.textContent).toContain('redeven-runtime-v1');
    expect(runtimeStatus?.textContent).toContain('Desktop model source');
    expect(runtimeStatus?.textContent).toContain('Bound');
  });

  it('shows Local AI Profile status instead of remote provider settings for Desktop model source sessions', async () => {
    protocolMocks.status.mockReturnValue('connected');
    desktopSessionContextMocks.readSnapshot.mockReturnValue({
      local_environment_id: 'local-env',
      renderer_storage_scope_id: 'scope',
      target_kind: 'ssh_environment',
      target_route: 'remote_desktop',
      session_source: 'ssh_environment',
    });
    settingsResponse = {
      ai: null,
      ai_runtime: {
        desktop_model_source: {
          binding_state: 'bound',
          connected: true,
          available: true,
          model_source: 'desktop_local_environment',
          model_count: 2,
          missing_key_provider_ids: [],
        },
      },
    };

    render(() => <EnvSettingsPage />, host);
    await openSettingsSection(host, 'ai');
    await vi.waitFor(() => {
      expect(host.querySelector('[data-settings-card="Flower"]')).toBeTruthy();
    });

    const flowerCard = host.querySelector('[data-settings-card="Flower"]');
    expect(flowerCard?.textContent).toContain('Local AI Profile on this Mac');
    expect(flowerCard?.textContent).toContain('Desktop model source ready');
    expect(flowerCard?.textContent).not.toContain('Add Provider');
  });

  it('moves Flower permission radio focus with arrow keys', async () => {
    protocolMocks.status.mockReturnValue('connected');
    settingsResponse = {
      config_path: '/tmp/config.json',
      runtime: { agent_home_dir: '/workspace', shell: '/bin/zsh' },
      logging: { log_format: 'plain', log_level: 'info' },
      codespaces: { code_server_port_min: 0, code_server_port_max: 0 },
      permission_policy: null,
      ai: {
        current_model_id: 'openai/gpt-5.2-mini',
        permission_type: 'approval_required',
        providers: [{
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          base_url: 'https://api.openai.com/v1',
          models: [{ model_name: 'gpt-5.2-mini', context_window: 400000, input_modalities: ['text'] }],
        }],
      },
      ai_secrets: {
        provider_api_key_set: { openai: true },
        web_search_provider_api_key_set: { openai: false },
      },
    };

    render(() => <EnvSettingsPage />, host);
    await openSettingsSection(host, 'ai');
    await vi.waitFor(() => {
      expect(host.querySelector('[data-settings-card="Flower"]')).toBeTruthy();
    });

    const radios = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios().map((button) => button.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);

    radios()[1]?.focus();
    expect(document.activeElement).toBe(radios()[1]);

    radios()[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await nextMicrotask();
    expect(document.activeElement).toBe(radios()[2]);
    expect(radios().map((button) => button.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);

    radios()[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await nextMicrotask();
    expect(document.activeElement).toBe(radios()[1]);
    expect(radios().map((button) => button.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
  });

  it('notifies the app settings revision after saving a Flower provider bundle', async () => {
    protocolMocks.status.mockReturnValue('connected');
    settingsResponse = {
      config_path: '/tmp/config.json',
      runtime: { agent_home_dir: '/workspace', shell: '/bin/zsh' },
      logging: { log_format: 'plain', log_level: 'info' },
      codespaces: { code_server_port_min: 0, code_server_port_max: 0 },
      permission_policy: null,
      ai: {
        current_model_id: 'openai/gpt-5.2-mini',
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            type: 'openai',
            base_url: 'https://api.openai.com/v1',
            models: [
              {
                model_name: 'gpt-5.2-mini',
                context_window: 400000,
                max_output_tokens: 128000,
                input_modalities: ['text', 'image'],
              },
            ],
          },
          {
            id: 'custom',
            name: 'Custom endpoint',
            type: 'openai_compatible',
            base_url: 'https://llm.example.invalid/v1',
            web_search: { mode: 'brave' },
            models: [
              {
                model_name: 'custom-model',
                context_window: 128000,
                input_modalities: ['text'],
              },
            ],
          },
        ],
      },
      ai_secrets: {
        provider_api_key_set: { openai: true, custom: true },
        web_search_provider_api_key_set: { openai: false, custom: true },
      },
    };

    (localApiMocks.fetchLocalApiJSON as any).mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/settings') {
        return structuredClone(settingsResponse);
      }
      if (url === '/_redeven_proxy/api/ai/provider_keys/status') {
        return { provider_api_key_set: { openai: true, custom: true } };
      }
      if (url === '/_redeven_proxy/api/ai/web_search_provider_keys/status') {
        return { web_search_provider_api_key_set: { openai: false, custom: true } };
      }
      if (url === '/_redeven_proxy/api/ai/provider_bundle') {
        return {
          settings: structuredClone(settingsResponse),
          ai_update: null,
        };
      }
      return null;
    });

    render(() => <EnvSettingsPage />, host);
    await openSettingsSection(host, 'ai');
    await vi.waitFor(() => {
      expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/settings', { method: 'GET' });
    });

    await vi.waitFor(() => {
      const button = host.querySelector('button[aria-label="Edit provider"]') as HTMLButtonElement | null;
      expect(button).toBeTruthy();
      expect(button?.disabled).toBe(false);
    });
    expect(host.textContent).toContain('OpenAI Compatible');
    const editButton = host.querySelectorAll('button[aria-label="Edit provider"]')[1] as HTMLButtonElement;
    editButton?.click();
    await flushPage();

    await vi.waitFor(() => {
      const dialog = host.querySelector('[data-testid="ai-provider-dialog"]');
      expect(dialog?.getAttribute('data-open')).toBe('true');
      expect(dialog?.getAttribute('data-provider-key-set')).toBe('true');
      expect(dialog?.getAttribute('data-web-search-key-set')).toBe('true');
    });

    const confirmButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Confirm provider'));
    confirmButton?.click();

    await vi.waitFor(() => {
      expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith(
        '/_redeven_proxy/api/ai/provider_bundle',
        expect.objectContaining({ method: 'PUT' }),
      );
      expect(envContextMocks.bumpSettingsSeq).toHaveBeenCalledTimes(1);
    });
  });

  it('does not silently replace an invalid Flower current model while saving providers', async () => {
    protocolMocks.status.mockReturnValue('connected');
    settingsResponse = {
      config_path: '/tmp/config.json',
      runtime: { agent_home_dir: '/workspace', shell: '/bin/zsh' },
      logging: { log_format: 'plain', log_level: 'info' },
      codespaces: { code_server_port_min: 0, code_server_port_max: 0 },
      permission_policy: null,
      ai: {
        current_model_id: 'missing/provider-model',
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            type: 'openai',
            base_url: 'https://api.openai.com/v1',
            models: [{ model_name: 'gpt-5.2-mini', context_window: 400000, input_modalities: ['text'] }],
          },
        ],
      },
      ai_secrets: {
        provider_api_key_set: { openai: true },
        web_search_provider_api_key_set: { openai: false },
      },
    };

    render(() => <EnvSettingsPage />, host);
    await openSettingsSection(host, 'ai');
    await vi.waitFor(() => {
      expect(host.querySelector('button[aria-label="Edit provider"]')).toBeTruthy();
    });

    (host.querySelector('button[aria-label="Edit provider"]') as HTMLButtonElement).click();
    await flushPage();
    const confirmButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Confirm provider'));
    confirmButton?.click();

    await vi.waitFor(() => {
      expect(notificationMocks.error).toHaveBeenCalledWith('Save failed', 'current_model_id is not in providers[].models[]: missing/provider-model');
    });
    expect(localApiMocks.fetchLocalApiJSON).not.toHaveBeenCalledWith(
      '/_redeven_proxy/api/ai/provider_bundle',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('updates the Browser Editor from the settings page through Desktop', async () => {
    settingsResponse = {
      ai: null,
    };

    desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop.mockResolvedValueOnce({
      ok: true,
      prepared: true,
      status: {
        active_runtime: {
          detection_state: 'ready',
          present: true,
          source: 'managed',
        },
        managed_runtime: {
          detection_state: 'ready',
          present: true,
          source: 'managed',
        },
        managed_prefix: '/Users/test/.redeven/local-environment/apps/code/runtime/managed',
        shared_runtime_root: '/Users/test/.redeven/shared/code-server/darwin-arm64',
        managed_runtime_version: '4.109.1',
        managed_runtime_source: 'managed',
        installed_versions: [],
        operation: { state: 'succeeded', action: 'prepare_workspace_engine', log_tail: [] },
        updated_at_unix_ms: 1,
      },
    });

    render(() => <EnvSettingsPage />, host);
    await flushPage();
    await openSettingsSection(host, 'codespaces');

    const button = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Update browser editor'));
    expect(button).toBeTruthy();

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPage();

    expect(desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop).toHaveBeenCalledWith({
      reason: 'settings',
      status: undefined,
      preferSessionUpload: false,
    });
    expect(notificationMocks.error).not.toHaveBeenCalled();
  });

  it('keeps Desktop Browser Editor preparation failures visible on the settings page', async () => {
    settingsResponse = {
      ai: null,
    };
    desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop.mockResolvedValueOnce({
      ok: false,
      prepared: false,
      message: 'Redeven Browser Editor catalog lookup failed with HTTP 503.',
    });

    render(() => <EnvSettingsPage />, host);
    await flushPage();
    await openSettingsSection(host, 'codespaces');

    const button = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Update browser editor'));
    expect(button).toBeTruthy();

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(host.querySelector('[data-settings-card="Browser Editor"]')?.textContent).toContain('Redeven Browser Editor catalog lookup failed with HTTP 503.');
    });

    expect(notificationMocks.error).toHaveBeenCalledWith('Browser Editor setup failed', 'Redeven Browser Editor catalog lookup failed with HTTP 503.');
  });
});
