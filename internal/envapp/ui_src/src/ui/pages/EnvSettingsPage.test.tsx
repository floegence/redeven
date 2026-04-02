// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvSettingsPage } from './EnvSettingsPage';

const notificationMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
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
  settingsSeq: vi.fn(() => 0),
  debugConsoleEnabled: vi.fn(() => false),
  setDebugConsoleEnabled: vi.fn(),
  connectionOverlayVisible: vi.fn(() => false),
  connectionOverlayMessage: vi.fn(() => 'Connecting to runtime...'),
  settingsFocusSeq: vi.fn(() => 0),
  settingsFocusSection: vi.fn(() => null),
  bumpSettingsSeq: vi.fn(),
}));

const agentUpdateMocks = vi.hoisted(() => ({
  version: {
    latestMeta: vi.fn(() => null),
    latestMetaLoading: vi.fn(() => false),
    latestMetaError: vi.fn(() => null),
    preferredTargetVersion: vi.fn(() => ''),
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
}));

const gatewayMocks = vi.hoisted(() => ({
  fetchGatewayJSON: vi.fn(async () => null),
}));

const codeRuntimeMocks = vi.hoisted(() => ({
  fetchCodeRuntimeStatus: vi.fn(async () => null),
  installCodeRuntime: vi.fn(async () => undefined),
  uninstallCodeRuntime: vi.fn(async () => undefined),
  cancelCodeRuntimeOperation: vi.fn(async () => undefined),
  codeRuntimeOperationNeedsAttention: vi.fn(() => false),
  codeRuntimeOperationSucceeded: vi.fn(() => false),
}));

function icon(name: string) {
  return (props: any) => <span data-icon={name} class={props.class} />;
}

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => notificationMocks,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Code: icon('Code'),
  Database: icon('Database'),
  FileCode: icon('FileCode'),
  Globe: icon('Globe'),
  Layers: icon('Layers'),
  RefreshIcon: icon('RefreshIcon'),
  Shield: icon('Shield'),
  Terminal: icon('Terminal'),
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
  Button: (props: any) => (
    <button type="button" onClick={props.onClick} disabled={props.disabled}>
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

vi.mock('../maintenance/AgentUpdateContext', () => ({
  useAgentUpdateContext: () => agentUpdateMocks,
}));

vi.mock('../maintenance/agentUpgradeState', () => ({
  resolveAgentUpgradeState: () => ({
    allowsUpgradeAction: true,
    message: '',
    policy: 'local',
    releasePageURL: '',
  }),
}));

vi.mock('../maintenance/agentVersion', () => ({
  isReleaseVersion: () => true,
}));

vi.mock('../maintenance/shared', () => ({
  formatAgentStatusLabel: (status: string) => status,
  formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error ?? '')),
}));

vi.mock('../services/gatewayApi', () => ({
  fetchGatewayJSON: gatewayMocks.fetchGatewayJSON,
}));

vi.mock('../services/codeRuntimeApi', () => ({
  fetchCodeRuntimeStatus: codeRuntimeMocks.fetchCodeRuntimeStatus,
  installCodeRuntime: codeRuntimeMocks.installCodeRuntime,
  uninstallCodeRuntime: codeRuntimeMocks.uninstallCodeRuntime,
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
    settingsSeq: envContextMocks.settingsSeq,
    debugConsoleEnabled: envContextMocks.debugConsoleEnabled,
    setDebugConsoleEnabled: envContextMocks.setDebugConsoleEnabled,
    connectionOverlayVisible: envContextMocks.connectionOverlayVisible,
    connectionOverlayMessage: envContextMocks.connectionOverlayMessage,
    settingsFocusSeq: envContextMocks.settingsFocusSeq,
    settingsFocusSection: envContextMocks.settingsFocusSection,
    bumpSettingsSeq: envContextMocks.bumpSettingsSeq,
  }),
}));

vi.mock('./EnvDebugConsoleSettingsPanel', () => ({
  EnvDebugConsoleSettingsPanel: () => <div>Debug Console Panel</div>,
}));

vi.mock('./settings/AIProviderDialog', () => ({
  AIProviderDialog: () => null,
}));

vi.mock('./settings/CodeRuntimeSettingsCard', () => ({
  CodeRuntimeSettingsCard: () => <section data-settings-card="code-server Runtime">code-server Runtime</section>,
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
  FieldLabel: (props: any) => <label>{props.children}</label>,
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

describe('EnvSettingsPage', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it('renders the updated settings information architecture in navigation and groups', async () => {
    render(() => <EnvSettingsPage />, host);
    await flushPage();

    const groupTitles = Array.from(host.querySelectorAll('[data-settings-group] > h2')).map((node) => node.textContent?.trim());
    expect(groupTitles).toEqual([
      'Overview',
      'Runtime Configuration',
      'Codespaces & Tooling',
      'Security',
      'AI & Extensions',
      'Diagnostics',
    ]);

    const navLabels = Array.from(host.querySelectorAll('[data-settings-nav-item]')).map((node) => node.textContent?.trim());
    expect(navLabels).toEqual([
      'Config File',
      'Connection',
      'Runtime Status',
      'Shell & Workspace',
      'Logging',
      'Codespaces & Tooling',
      'Permission Policy',
      'Flower',
      'Skills',
      'Codex',
      'Debug Console',
    ]);

    const diagnosticsGroup = host.querySelector('[data-settings-group="diagnostics"]');
    expect(diagnosticsGroup?.querySelector('[data-settings-section="debug_console"]')).not.toBeNull();

    const codespacesGroup = host.querySelector('[data-settings-group="codespaces_tooling"]');
    expect(codespacesGroup?.querySelector('[data-settings-section="codespaces"]')).not.toBeNull();

    const runtimeGroup = host.querySelector('[data-settings-group="runtime_configuration"]');
    expect(runtimeGroup?.querySelector('[data-settings-section="debug_console"]')).toBeNull();
    expect(runtimeGroup?.querySelector('[data-settings-section="codespaces"]')).toBeNull();

    const aiGroup = host.querySelector('[data-settings-group="ai_extensions"]');
    const aiGroupSections = Array.from(aiGroup?.querySelectorAll('[data-settings-section]') ?? []).map((node) => node.getAttribute('data-settings-section'));
    expect(aiGroupSections).toEqual(['ai', 'skills', 'codex']);
  });
});
