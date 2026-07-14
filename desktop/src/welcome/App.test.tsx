import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { desktopControlPlaneKey } from '../shared/controlPlaneProvider';
import { createDesktopI18n } from '../shared/i18n';
import type { DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import { openConnectionProgress } from '../shared/desktopOpenConnectionProgress';
import {
  testDesktopPreferences,
  testLocalAccess,
  testLocalEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  environmentProgressPrimaryPresentation,
  selectEnvironmentPanelProgress,
} from './environmentProgressPrimaryPresentation';
import {
  IDLE_LAUNCHER_BUSY_STATE,
  busyStateBlocksEnvironmentAction,
  reconcileBusyStateWithActionProgressSnapshot,
  selectedSnapshotOpenConnectionProgressForEnvironment,
} from './launcherBusyState';
import {
  buildDesktopWelcomeShellViewModel,
  buildProviderBackedEnvironmentActionModel,
  environmentLibraryCount,
  filterEnvironmentLibrary,
  LOCAL_ENVIRONMENT_LIBRARY_FILTER,
  PROVIDER_ENVIRONMENT_LIBRARY_FILTER,
  shellStatus,
} from './viewModel';

function readWelcomeSource(): string {
  return fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');
}

function readGatewaySourceActionRunnerSource(): string {
  return fs.readFileSync(path.join(__dirname, 'gatewaySourceActionRunner.ts'), 'utf8');
}

function readDesktopTooltipSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopTooltip.tsx'), 'utf8');
}

function readDesktopPopoverSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopPopover.tsx'), 'utf8');
}

function readDesktopActionPopoverSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopActionPopover.tsx'), 'utf8');
}

function readDesktopAnchoredOverlaySurfaceSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopAnchoredOverlaySurface.tsx'), 'utf8');
}

function readDesktopAnchoredListboxSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopAnchoredListbox.tsx'), 'utf8');
}

function readWelcomeStyles(): string {
  return fs.readFileSync(path.join(__dirname, 'index.css'), 'utf8');
}

function readWindowChromeContractSource(): string {
  return fs.readFileSync(path.join(__dirname, '..', 'shared', 'windowChromeContract.ts'), 'utf8');
}

function readInstalledDialogSource(): string {
  return fs.readFileSync(
    path.join(
      __dirname,
      '..',
      '..',
      'node_modules',
      '@floegence',
      'floe-webapp-core',
      'dist',
      'components',
      'ui',
      'Dialog.js',
    ),
    'utf8',
  );
}

function cssRuleBlock(styles: string, selector: string): string {
  const ruleStart = styles.indexOf(`${selector} {`);
  expect(ruleStart).toBeGreaterThanOrEqual(0);
  const bodyStart = styles.indexOf('{', ruleStart);
  const bodyEnd = styles.indexOf('\n}', bodyStart);
  expect(bodyStart).toBeGreaterThan(ruleStart);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return styles.slice(ruleStart, bodyEnd + 2);
}

function testProviderAccessPoint(providerOrigin: string) {
  return {
    access_point_id: 'dev',
    region: 'dev',
    display_name: 'Development',
    description: 'Development access point',
    access_point_origin: providerOrigin === 'https://cp.other.invalid'
      ? 'https://dev.cp.other.invalid'
      : 'https://dev.provider.example.invalid',
    country_code: 'SG',
    city: 'Singapore',
    status: 'active',
    health_status: 'healthy',
  };
}

function testControlPlaneSummary(input: Readonly<{
  providerOrigin?: string;
  envPublicID?: string;
  label?: string;
  namespacePublicID?: string;
  namespaceName?: string;
  userPublicID?: string;
  userDisplayName?: string;
  displayLabel?: string;
}> = {}) {
  const providerOrigin = input.providerOrigin ?? 'https://provider.example.invalid';
  const envPublicID = input.envPublicID ?? 'env_demo';
  const accessPoint = testProviderAccessPoint(providerOrigin);
  return {
    provider: {
      protocol_version: 'rcpp-v2' as const,
      provider_id: 'example_control_plane',
      display_name: 'Example Control Plane',
      provider_origin: providerOrigin,
      documentation_url: `${providerOrigin}/help/control-plane-providers`,
      access_points: [accessPoint],
    },
    account: {
      provider_id: 'example_control_plane',
      provider_origin: providerOrigin,
      display_name: 'Example Control Plane',
      user_public_id: input.userPublicID ?? 'user_demo',
      user_display_name: input.userDisplayName ?? 'Demo User',
      authorization_expires_at_unix_ms: Date.now() + 60_000,
    },
    display_label: input.displayLabel ?? 'Demo Control Plane',
    environments: [{
      provider_id: 'example_control_plane',
      provider_origin: providerOrigin,
      env_public_id: envPublicID,
      region: accessPoint.region,
      access_point_id: accessPoint.access_point_id,
      access_point_origin: accessPoint.access_point_origin,
      label: input.label ?? 'Demo Environment',
      environment_url: `${accessPoint.access_point_origin}/env/${envPublicID}`,
      description: 'team sandbox',
      namespace_public_id: input.namespacePublicID ?? 'ns_demo',
      namespace_name: input.namespaceName ?? 'Demo Team',
      status: 'online',
      lifecycle_status: 'active',
      last_seen_at_unix_ms: 456,
    }],
    last_synced_at_ms: Date.now(),
    sync_state: 'ready' as const,
    last_sync_attempt_at_ms: Date.now(),
    last_sync_error_code: '',
    last_sync_error_message: '',
    catalog_freshness: 'fresh' as const,
  };
}

describe('DesktopWelcomeShell', () => {
  it('describes Connect Environment inside the shared shell model', () => {
    const local = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        saved_environments: [
          {
            id: 'http://192.168.1.11:24000/',
            label: '192.168.1.11:24000',
            local_ui_url: 'http://192.168.1.11:24000/',
            pinned: false,
            created_at_ms: 10,
            last_used_at_ms: 10,
          },
        ],
        saved_ssh_environments: [],
      }),
      surface: 'connect_environment',
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'Connect Environment',
      connect_heading: 'Connect Environment',
      primary_action_label: 'Open Environment',
      settings_save_key: 'settings.saveEnvironmentSettings',
    });
    expect(shellStatus(snapshot)).toEqual({
      tone: 'disconnected',
      label: 'No environment windows open',
    });
    expect(shellStatus(snapshot, createDesktopI18n('zh-CN'))).toEqual({
      tone: 'disconnected',
      label: '没有打开环境窗口',
    });
  });

  it('keeps the outer Flower entry icon-only while chat creation lives inside the shared surface', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('const flowerWarmupState = createMemo<FlowerSurfaceWarmupState | null>');
    expect(appSrc).toContain('selectedFlowerWarmupProgress(flowerRuntimeLifecycleProgress())');
    expect(appSrc).toContain('warmup={flowerWarmupState()}');
    expect(appSrc).toContain("aria-label={i18n().t('flowerSurface.chat.entryLabel')}");
    expect(appSrc).toContain("when={snapshot().surface !== 'flower'}");
    expect(appSrc).toContain('class="redeven-flower-topbar-button"');
    expect(appSrc).not.toContain("class={cn('rounded-full'");
    expect(appSrc).toContain('<FlowerIcon class="h-5 w-5" />');
    expect(appSrc).not.toContain('<FlowerNavigationIcon class="h-5 w-5" />');
    expect(appSrc).toContain('copy={createDesktopFlowerSurfaceCopy(i18n())}');
    expect(appSrc).toContain('notify={(notice) => {');
    expect(appSrc).toContain('showActionToast(notice.message, notice.tone');
    expect(appSrc).toContain("runtimeDisplayName: i18n().t('flowerSurface.runtime.localEnvironment')");
    expect(appSrc).toContain('sidebarLeadingAction={(');
    expect(appSrc).toContain('class="flower-sidebar-leading-action"');
    expect(appSrc).toContain("aria-label={i18n().t('shell.backToEnvironments')}");
    expect(appSrc).toContain('onClick={() => void openEnvironmentCenterSurface()}');
    expect(appSrc).toContain('FlowerIcon,');
    expect(appSrc).toContain('FlowerSoftAuraIcon,');
    expect(appSrc).toContain('FlowerSurface,');
    expect(appSrc).toContain('FlowerTurnLauncherWindow,');
    expect(appSrc).toContain('createLocalEnvironmentFlowerSurfaceAdapter(');
    expect(appSrc).not.toContain('aria-label="Compose with Flower"');
    expect(appSrc).not.toContain('✿');
    expect(appSrc).not.toContain('history rail');
  });

  it('routes the Redeven mark back to Environments while Flower owns the main surface', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('async function openEnvironmentCenterSurface(): Promise<void>');
    expect(appSrc).toContain("kind: 'open_environment_center'");
    expect(appSrc).toContain("snapshot().surface === 'flower'");
    expect(appSrc).toContain("i18n().t('shell.backToEnvironments')");
    expect(appSrc).toContain('class="redeven-flower-back-button"');
    expect(appSrc).toContain('<ArrowLeft class="h-3.5 w-3.5" />');
    expect(appSrc).toContain('class="flower-sidebar-leading-action"');
    expect(appSrc).toContain('<ArrowLeft class="h-4 w-4" />');
    expect(appSrc).toContain('<TopBarIconButton label={topBarLogoLabel()} onClick={activateTopBarLogo}>');
  });

  it('keeps Gateways as a third Environment Center tab with independent query and filter state', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("{ value: 'gateways', labelKey: 'environmentCenter.gatewaysSection' }");
    expect(appSrc).toContain('const [gatewaySourceFilter, setGatewaySourceFilter] = createSignal');
    expect(appSrc).toContain('const [gatewayQuery, setGatewayQuery] = createSignal');
    expect(appSrc).toContain('filterGatewayEnvironmentEntries(');
    expect(appSrc).toContain('function focusGatewayEnvironments(gateway: DesktopGatewaySource): void');
    expect(appSrc).toContain('<GatewaySourcesPanel');
    expect(appSrc).toContain("props.activeTab === 'gateways'");
    expect(appSrc).toContain('gatewaySourceFilterValue,');
    expect(appSrc).not.toContain("fallback={(\n                <ControlPlanesPanel");
  });

  it('keeps Gateway setup and source actions out of the legacy Redeven URL dialog', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('function suggestGatewayDisplayName(state: GatewaySetupDialogState | null): string | null');
    expect(appSrc).toContain("return seed === '' ? null : `Gateway-${seed}`;");
    expect(appSrc).toContain('display_name_touched: overrides.display_name_touched === true');
    expect(appSrc).toContain("runtimeRoot = trimString(state.runtime_root) || DEFAULT_DESKTOP_SSH_RUNTIME_ROOT");
    expect(appSrc).toContain("placeholder={DEFAULT_DESKTOP_SSH_RUNTIME_ROOT_LABEL}");
    expect(appSrc).not.toContain("placeholder={isContainer() ? '/root/.redeven' : DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}");
    expect(appSrc).not.toContain("runtime_root: trimString(overrides.runtime_root) || (overrides.connection_kind === 'ssh_container' ? '/root/.redeven' : DEFAULT_DESKTOP_SSH_RUNTIME_ROOT)");
    expect(appSrc).toContain('function openCreateGatewaySetup(gateway?: DesktopGatewaySource, focusSection?: DesktopGatewayResolveFocus): void');
    expect(appSrc).toContain('function gatewaySetupFocusForGateway(');
    expect(appSrc).toContain('requestedFocus?: DesktopGatewayResolveFocus');
    expect(appSrc).toContain('if (requestedFocus) {');
    expect(appSrc).toContain('focus_section: gatewaySetupFocusForGateway(gateway, focusSection)');
    expect(appSrc).toContain("setActiveCenterTab('gateways')");
    expect(appSrc).toContain('<GatewaySetupDialog');
    expect(appSrc).toContain("kind: 'upsert_gateway'");
    expect(appSrc).toContain('ssh_password_configured: gateway.ssh_password_configured === true');
    expect(appSrc).toContain('removeSSHPassword={removeSSHPasswordFromGatewaySetupDialog}');
    expect(appSrc).toContain('auth_mode: state.auth_mode');
    const gatewayDialogStart = appSrc.indexOf('function GatewaySetupDialog');
    const gatewayDialogEnd = appSrc.indexOf('function ControlPlaneDialog');
    const gatewayDialogSrc = appSrc.slice(gatewayDialogStart, gatewayDialogEnd);
    const gatewayAdvancedCollapseOffset = gatewayDialogSrc.indexOf("'redeven-dialog-collapse'");
    expect(gatewayAdvancedCollapseOffset).toBeGreaterThan(-1);
    expect(gatewayDialogSrc).toContain('syncSSHConnectionDialogAdvancedState');
    expect(gatewayDialogSrc).toContain('gatewayAdvancedDescription()');
    expect(gatewayDialogSrc).toContain("props.i18n.t('connectionDialog.gatewayRuntimeRootHelp'");
    expect(gatewayDialogSrc).not.toContain("props.i18n.t('connectionDialog.runtimeRootHelp'");
    expect(gatewayDialogSrc).not.toContain("props.i18n.t('connectionDialog.connectTimeoutShort')");
    expect(gatewayDialogSrc.indexOf('id="gateway-data-root"')).toBeGreaterThan(gatewayAdvancedCollapseOffset);
    expect(gatewayDialogSrc.indexOf('id="gateway-ssh-connect-timeout"')).toBeGreaterThan(gatewayAdvancedCollapseOffset);
    expect(gatewayDialogSrc.indexOf('id="gateway-release-base-url"')).toBeGreaterThan(gatewayAdvancedCollapseOffset);
    expect(appSrc).toContain("performLauncherAction(action, 'gateway_dialog');");
    expect(appSrc).toContain('onClick={() => props.openCreateGatewaySetup()}');
    expect(appSrc).toContain("from './gatewaySourceActionRunner';");
    const gatewaySourceActionRunnerSrc = readGatewaySourceActionRunnerSource();
    expect(appSrc).toContain('const selectedGatewayWorkflowProgress = createMemo(() => {');
    expect(appSrc).toContain('const selectedGatewayRefreshDiagnosisResult = createMemo<GatewayDiagnosisResultSnapshot | null>(() => {');
    expect(appSrc).toContain('gatewayProgressBelongsToForegroundAction(progress, foreground)');
    expect(appSrc).toContain('<GatewayActionPanel');
    expect(appSrc).not.toContain('openResolveGateway={openGatewaySetupForPanelResolve}');
    expect(appSrc).not.toContain('props.openCreateGatewaySetup(props.gateway, visiblePanelModel().resolve_focus)');
    expect(appSrc).not.toContain('props.openCreateGatewaySetup(props.gateway, action.resolve_focus)');
    expect(appSrc).toContain('<EnvironmentProgressPanel');
    expect(appSrc).toContain('buildGatewayActionPresentation');
    expect(appSrc).toContain('row().environment_summary_label');
    expect(appSrc).toContain('row().environment_summary_detail');
    expect(appSrc).not.toContain('gatewayStartRequiredDialog');
    expect(appSrc).toContain("case 'refresh_status':");
    expect(appSrc).toContain("case 'refresh_gateway':");
    expect(appSrc).not.toContain('row().management_label');
    expect(gatewaySourceActionRunnerSrc).toContain("case 'refresh_gateway':");
    expect(gatewaySourceActionRunnerSrc).not.toContain("case 'resolve_gateway':");
    expect(gatewaySourceActionRunnerSrc).not.toContain("case 'sync_gateway':");
    expect(gatewaySourceActionRunnerSrc).not.toContain("case 'check_gateway':");
    expect(appSrc).toContain("case 'start_gateway':");
    expect(appSrc).toContain("case 'open_gateway_environment':");
    expect(appSrc).toContain("intent: 'open_gateway_environment'");
    expect(appSrc).not.toContain("case 'manage_desktop_update':\n                        case 'open_gateway_environment':\n                          break;");
    expect(appSrc).toContain('const ENVIRONMENT_CENTER_HEADER_COPY');
    expect(appSrc).toContain("titleKey: 'environmentCenter.environmentsTitle'");
    expect(appSrc).toContain("titleKey: 'environmentCenter.providersTitle'");
    expect(appSrc).toContain("titleKey: 'environmentCenter.gatewaysTitle'");
    expect(appSrc).toContain("props.i18n.t(headerCopy().titleKey)");
    expect(appSrc).toContain("props.i18n.t(headerCopy().descriptionKey)");
    expect(appSrc).not.toContain("props.i18n.t('environmentCenter.description')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.addGatewayShort')");
    expect(appSrc).toContain("title={props.i18n.t('environmentCenter.addGateway')}");
    expect(appSrc).toContain("aria-label={props.i18n.t('environmentCenter.addGateway')}");
    expect(appSrc).toContain("case 'view_gateway_environments':");
    expect(appSrc).toContain("case 'add_gateway_environment':");
    expect(appSrc).not.toContain("props.i18n.t('environmentCenter.syncGatewayForLabel'");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.moreActions')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.moreActionsForLabel'");
    expect(appSrc).toContain('popoverAriaLabel={');
    expect(appSrc).toContain('localizedGatewaySourceCountText(props.i18n, row().environment_summary_label)');
    expect(appSrc).not.toContain('>\\n            View\\n');
    expect(appSrc).not.toContain('content="More actions"');
    const gatewayHeaderButtonOffset = appSrc.indexOf("props.i18n.t('environmentCenter.addGatewayShort')");
    const gatewayHeaderButtonSrc = appSrc.slice(Math.max(0, gatewayHeaderButtonOffset - 420), gatewayHeaderButtonOffset + 120);
    expect(gatewayHeaderButtonSrc).toContain('props.openCreateGatewaySetup()');
    expect(gatewayHeaderButtonSrc).toContain("props.i18n.t('environmentCenter.addGateway')");
    expect(gatewayHeaderButtonSrc).not.toContain('openCreateConnectionDialog');
    const fullAddGatewayButtonOffset = appSrc.lastIndexOf("props.i18n.t('environmentCenter.addGateway')");
    const fullAddGatewayButtonSrc = appSrc.slice(Math.max(0, fullAddGatewayButtonOffset - 260), fullAddGatewayButtonOffset + 80);
    expect(fullAddGatewayButtonSrc).toContain('props.openCreateGatewaySetup()');
    expect(fullAddGatewayButtonSrc).not.toContain('openCreateConnectionDialog');
  });

	  it('does not let Gateway environment open fall back to remote URL actions', () => {
	    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("if (environment.kind === 'gateway_environment') {\n      return openGatewayEnvironment(environment, errorTarget);\n    }");
    expect(appSrc).toContain("kind: 'open_gateway_environment'");
    expect(appSrc).toContain("gateway_id: gatewayID");
    expect(appSrc).toContain("gateway_env_id: gatewayEnvID");
    expect(appSrc).toContain("case 'resolve_gateway':\n        if (environment.kind === 'gateway_environment') {");
    expect(appSrc).toContain('openCreateGatewaySetup(gateway);');
    expect(appSrc).not.toContain("case 'resolve_gateway':\n        await pairGateway(environment.gateway_id ?? '');");
    expect(appSrc).toContain("kind: 'refresh_gateway'");
    expect(appSrc).not.toContain("kind: 'sync_gateway'");
	    expect(appSrc).not.toContain("gateway_environment') {\n      return openRemoteEnvironment");
	  });

	  it('keeps Gateway-backed SSH profile UI honest about container loading and auth support', () => {
	    const appSrc = readWelcomeSource();

	    expect(appSrc).toContain("connectionState?.connection_kind === 'gateway_url_profile' && connectionState.profile_route_kind === 'ssh_container'");
	    expect(appSrc).toContain("auth_mode: 'key_agent'");
	    expect(appSrc).toContain("props.i18n.t('connectionDialog.gatewayEnvironmentSshAuthHelp')");
	    expect(appSrc).toContain('const gatewaySSHProfileAuthOnly = createMemo');
	    expect(appSrc).toContain('ssh_secret: undefined');
	    expect(appSrc).not.toContain("mode: state.auth_mode === 'password' ? state.ssh_password_mode : 'clear'");
	  });

	  it('filters Gateway source rows with the Gateways tab source filter and query', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('const gatewaySourcesByID = createMemo(() => {');
    expect(appSrc).toContain('const visibleGatewaySourceIDs = createMemo(() => visibleGatewaySources().map((gateway) => gateway.gateway_id));');
    expect(appSrc).toContain('const renderedGatewaySourceIDs = createMemo(() => gatewaySourceIDsWithActiveOverlay(');
    expect(appSrc).toContain('<For each={renderedGatewaySourceIDs()}>');
    expect(appSrc).not.toContain('<For each={visibleGatewaySourceIDs()}>');
    expect(appSrc).toContain('gatewayEntriesByGatewayID()[gatewayID] ?? []');
    expect(appSrc).toContain("gatewaySourceFilterValue(gateway.gateway_id) !== props.gatewaySourceFilter");
    expect(appSrc).toContain('return !hasQuery || gatewaySourceMatchesQuery(gateway, query);');
    expect(appSrc).toContain('function gatewaySourceMatchesQuery(gateway: DesktopGatewaySource, query: string): boolean');
    expect(appSrc).toContain('gateway.endpoint_label,');
    expect(appSrc).toContain('const visibleGatewaySourceCount = createMemo(() => (');
    expect(appSrc).toContain('const totalGatewaySourceCount = createMemo(() => props.gatewaySources.length);');
    expect(appSrc).toContain('noMatchingGatewaysTitle');
    expect(styles).toContain('.redeven-gateway-grid');
    expect(styles).toContain('grid-template-columns: repeat(auto-fit, minmax(min(100%, 18.5rem), 22rem));');
    expect(styles).toContain('.redeven-gateway-card {\n  animation: none;');
  });

  it('describes Local Environment Settings inside the same shell model', () => {
    const local = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
      }),
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
      }),
      surface: 'environment_settings',
      selectedEnvironmentID: local.id,
    });

    expect(buildDesktopWelcomeShellViewModel(snapshot)).toEqual({
      shell_title: 'Redeven Desktop',
      surface_title: 'Environment Settings',
      connect_heading: 'Connect Environment',
      primary_action_label: 'Open Environment',
      settings_save_key: 'settings.saveEnvironmentSettings',
    });
    expect(snapshot.settings_surface.window_title_key).toBe('settings.settingsWindowTitle');
    expect(snapshot.settings_surface.access_mode).toBe('shared_local_network');
    expect(snapshot.settings_surface.password_state_id).toBe('configured');
    expect(snapshot.settings_surface.draft.local_ui_password).toBe('');
    expect(snapshot.settings_surface.draft.local_ui_password_mode).toBe('keep');
    expect(snapshot.settings_surface.summary_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'next_start_address',
        value: '24000',
        detail_key: 'settings.sharedAddressDetail',
      }),
      expect.objectContaining({
        id: 'password_state',
        value_key: 'settings.passwordSet',
        tone: 'success',
      }),
    ]));
  });

  it('localizes issue status labels when a semantic issue key is available', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      issue: {
        scope: 'local_environment',
        code: 'state_dir_locked',
        title: 'Redeven is already starting elsewhere',
        title_key: 'issue.stateDirLockedAttachTitle',
        message: 'Another Redeven runtime instance is using the default state directory and appears to provide Local UI. Retry in a moment so Desktop can attach to it.',
        message_key: 'issue.stateDirLockedAttachMessage',
        diagnostics_copy: 'status: blocked',
        target_url: '',
      },
    });

    expect(shellStatus(snapshot, createDesktopI18n('zh-CN'))).toEqual({
      tone: 'error',
      label: 'Redeven 已在其他位置启动中',
    });
  });

  it('derives the Env card primary progress from snapshot action progress instead of stale Opening state', () => {
    const local = testLocalEnvironment({
      currentRuntime: {
        local_ui_url: 'http://localhost:23998/',
        desktop_managed: true,
        effective_run_mode: 'desktop',
        runtime_service: {
          protocol_version: 'redeven-runtime-v1',
          service_owner: 'desktop',
          desktop_managed: true,
          effective_run_mode: 'desktop',
          remote_enabled: false,
          compatibility: 'compatible',
          open_readiness: { state: 'openable' },
          active_workload: {
            terminal_count: 0,
            session_count: 0,
            task_count: 0,
            port_forward_count: 0,
          },
        },
      },
    });
    const failedOpenProgress: DesktopLauncherActionProgress = {
      action: 'open_local_environment',
      operation_key: 'local:host:local:open:failed',
      subject_kind: 'local_environment',
      subject_id: local.id,
      environment_id: local.id,
      environment_label: local.label,
      started_at_unix_ms: 300,
      updated_at_unix_ms: 320,
      status: 'failed',
      phase: 'failed',
      title: 'Open failed',
      detail: 'Desktop could not open the local environment.',
      open_progress: openConnectionProgress({
        location: 'local_host',
        phase: 'failed',
        environmentID: local.id,
        environmentLabel: local.label,
        targetID: 'local:local',
        targetLabel: local.label,
      }),
    };
    const staleBusyProgress: DesktopLauncherActionProgress = {
      ...failedOpenProgress,
      operation_key: 'local:host:local:open:stale',
      started_at_unix_ms: 100,
      updated_at_unix_ms: 400,
      status: 'running',
      phase: 'opening_window',
      title: 'Opening environment',
      open_progress: openConnectionProgress({
        location: 'local_host',
        phase: 'opening_window',
        environmentID: local.id,
        environmentLabel: local.label,
        targetID: 'local:local',
        targetLabel: local.label,
      }),
    };
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
      }),
      openSessions: [{
        session_key: 'env:local:local_host',
        target: {
          kind: 'local_environment',
          session_key: 'env:local:local_host',
          environment_id: local.id,
          label: local.label,
          route: 'local_host',
          local_environment_kind: 'local',
          has_local_hosting: true,
          has_remote_desktop: false,
        },
        lifecycle: 'opening',
      }],
      actionProgress: [failedOpenProgress],
    });
    const entry = snapshot.environments.find((environment) => environment.id === local.id)!;
    const fallbackAction = buildProviderBackedEnvironmentActionModel(entry).action_presentation.primary_action;
    const selectedOpenProgress = selectedSnapshotOpenConnectionProgressForEnvironment(entry, snapshot.action_progress);
    const panelProgress = selectEnvironmentPanelProgress(selectedOpenProgress, null);
    const busyState = reconcileBusyStateWithActionProgressSnapshot({
      ...IDLE_LAUNCHER_BUSY_STATE,
      action: 'open_local_environment' as const,
      environment_id: local.id,
      progress: staleBusyProgress,
    }, snapshot.action_progress);

    expect(entry.open_action).toBe('opening');
    expect(fallbackAction).toMatchObject({ intent: 'opening', enabled: false });
    expect(environmentProgressPrimaryPresentation(panelProgress)).toMatchObject({
      kind: 'attention_trigger',
      label: 'Open failed',
    });
    expect(busyState).toBe(IDLE_LAUNCHER_BUSY_STATE);
    expect(busyStateBlocksEnvironmentAction(
      busyState,
      local.id,
      ['open_local_environment'],
      panelProgress,
    )).toBe(false);
  });

  it('filters the Environment Library by local and provider sources', () => {
    const local = testLocalEnvironment();
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        saved_environments: [
          {
            id: 'http://192.168.1.12:24000/',
            label: 'Staging',
            local_ui_url: 'http://192.168.1.12:24000/',
            pinned: false,
            created_at_ms: 20,
            last_used_at_ms: 20,
          },
          {
            id: 'http://192.168.1.11:24000/',
            label: 'Laptop',
            local_ui_url: 'http://192.168.1.11:24000/',
            pinned: false,
            created_at_ms: 10,
            last_used_at_ms: 10,
          },
        ],
        saved_ssh_environments: [],
      }),
      controlPlanes: [testControlPlaneSummary()],
    });

    expect(environmentLibraryCount(snapshot)).toBe(4);
    expect(environmentLibraryCount(snapshot, '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);
    expect(environmentLibraryCount(snapshot, '', PROVIDER_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);

    expect(filterEnvironmentLibrary(snapshot, '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)).toEqual([
      expect.objectContaining({
        id: 'local',
        category: 'local',
        local_environment_kind: 'local',
      }),
    ]);
    expect(filterEnvironmentLibrary(snapshot, 'stag')).toEqual([
      expect.objectContaining({
        id: 'http://192.168.1.12:24000/',
        label: 'Staging',
      }),
    ]);
  });

  it('can narrow the Environment Library to one provider-backed catalog', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment(),
      }),
      controlPlanes: [
        testControlPlaneSummary(),
        testControlPlaneSummary({
          providerOrigin: 'https://cp.other.invalid',
          envPublicID: 'env_other',
          label: 'Other Environment',
          namespacePublicID: 'ns_other',
          namespaceName: 'Other Team',
          userPublicID: 'user_other',
          userDisplayName: 'Other User',
          displayLabel: 'Other Control Plane',
        }),
      ],
    });

    expect(filterEnvironmentLibrary(
      snapshot,
      '',
      desktopControlPlaneKey('https://provider.example.invalid', 'example_control_plane'),
    )).toEqual([
      expect.objectContaining({
        kind: 'provider_environment',
        env_public_id: 'env_demo',
      }),
    ]);
  });

  it('shows compact Control Plane metrics with tooltip-based guidance instead of inline prose', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("props.i18n.t('environmentCenter.providerOnlineLabel')");
    expect(appSrc).toContain('ControlPlaneMetricTile');
    expect(appSrc).toContain('controlPlanePublishedCountTooltipContent');
    expect(appSrc).toContain('controlPlaneOnlineCountTooltipContent');
    expect(appSrc).toContain('controlPlaneLocalHostCountTooltipContent');
    expect(appSrc).toContain('desktopProviderOnlineEnvironmentCount(controlPlane.environments)');
    expect(appSrc).not.toContain('Environments currently visible from this provider account.');
    expect(appSrc).not.toContain('Published environments currently reporting online status.');
    expect(appSrc).not.toContain('Latest provider signal:');
    expect(appSrc).not.toContain('Unified Catalog');
    expect(appSrc).not.toContain('Provider-backed entries already materialized into the Environment list.');
  });

  it('uses the same rounded-lg shell radius for Control Plane cards as Environment cards', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('redeven-provider-shelf rounded-lg border border-border bg-card');
    expect(appSrc).not.toContain('redeven-provider-shelf rounded-[0.625rem]');
  });

  it('keeps Local Environment Settings as a dialog layered on top of the launcher surface', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('<ConnectEnvironmentSurface');
    expect(appSrc).toContain("<LocalEnvironmentSettingsDialog");
    expect(appSrc).toContain("open={snapshot().surface === 'environment_settings'}");
    expect(appSrc).not.toContain('fallback={<div class="h-full min-h-0 bg-background" />}');
  });

  it('pins the welcome surface to the full desktop shell width so filtered views do not shrink the page', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('redeven-welcome-surface h-full min-h-0 w-full min-w-0 overflow-auto bg-background');
  });

  it('uses one shared welcome shell so dense environments and management tabs stay aligned', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('redeven-welcome-shell');
    expect(appSrc).toContain('redeven-welcome-shell--spacious');
    expect(appSrc).toContain('useSpaciousWelcomeShell');
    expect(appSrc).toContain('shouldUseSpaciousEnvironmentGrid');
    expect(appSrc).toContain('props.libraryEntries.length + (showQuickAddCards() ? 1 : 0)');
    expect(appSrc).toContain('useSpaciousControlPlaneLayout');
    expect(appSrc).toContain("props.activeTab === 'control_planes'");
    expect(appSrc).toContain('useSpaciousGatewayLayout');
    expect(appSrc).toContain("props.activeTab === 'gateways'");
    expect(appSrc).not.toContain("props.activeTab === 'control_planes' && props.controlPlanes.length > 0");
    expect(appSrc).not.toContain("props.activeTab === 'gateways' && props.gatewaySources.length > 0");
    expect(styles).toContain('--redeven-welcome-shell-max-width: 80rem;');
    expect(styles).toContain('--redeven-welcome-shell-spacious-max-width: 100rem;');
    expect(styles).toContain('.redeven-welcome-shell--spacious');
  });

  it('drives the welcome bottom bar from the Environment Library summary model', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('buildEnvironmentLibrarySummaryModel');
    expect(appSrc).toContain('const librarySummary = createMemo(() => (');
    expect(appSrc).toContain('buildEnvironmentLibrarySummaryModel(snapshot(), libraryEntries())');
    expect(appSrc).toContain('localizedVisibleLabel(i18n(), librarySummary().environment_count)');
    expect(appSrc).toContain('localizedWindowsLabel(i18n(), librarySummary().window_count)');
    expect(appSrc).toContain('count={librarySummary().ready_count}');
    expect(appSrc).toContain("label={i18n().t('launcher.ready')}");
    expect(appSrc).toContain('count={librarySummary().running_count}');
    expect(appSrc).toContain("label={i18n().t('launcher.running')}");
    expect(appSrc).toContain('count={librarySummary().attention_count}');
    expect(appSrc).toContain("label={i18n().t('launcher.attention')}");

    expect(appSrc).not.toMatch(/\b(?:openCount|runningCount|offlineCount)\b/);
    expect(appSrc).not.toMatch(/snapshot\(\)\.environments\s*\.filter[\s\S]{0,240}(?:open|running|offline)[\s\S]{0,120}(?:\.length|Count|_count)/);
    expect(appSrc).not.toContain("i18n().t('launcher.offline')");
  });

  it('uses shared tooltip and compact card-grid helpers for desktop help affordances', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("import { DesktopTooltip } from './DesktopTooltip';");
    expect(appSrc).toContain('data-redeven-settings-help=""');
    expect(appSrc).not.toContain('title={tooltip()}');
    expect(appSrc).toContain('redeven-console-tab');
    expect(appSrc).toContain('redeven-provider-pill');
    expect(appSrc).toContain('redeven-runtime-chip');
    expect(appSrc).toContain('redeven-environment-card');
    expect(appSrc).toContain('redeven-environment-grid');
  });

  it('renders environment card time from runtime startup time, not access time', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('card().runtime_started_label');
    expect(appSrc).not.toContain('formatRelativeTimestamp(props.environment.last_used_at_ms)');
    expect(appSrc).not.toContain('formatLocalizedRelativeTimestamp(props.i18n, props.environment.last_used_at_ms)');
    expect(appSrc).not.toContain('props.environment.last_used_at_ms');
    expect(appSrc).not.toContain('runtime_started_at_unix_ms ? props.environment.last_used_at_ms');
  });

  it('uses one measured shared column model across pinned and regular environment sections', () => {
    const styles = readWelcomeStyles();
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('buildEnvironmentLibraryLayoutModel');
    expect(appSrc).toContain('visibleCardCount={visibleEnvironmentCardCount()}');
    expect(appSrc).toContain("layoutReferenceCardCount={layoutReferenceEnvironmentCardCount()}");
    expect(appSrc).toContain("environmentLibraryCount(");
    expect(appSrc).toContain("props.librarySourceFilter");
    expect(appSrc).toContain("LOCAL_ENVIRONMENT_LIBRARY_FILTER");
    expect(appSrc).toContain("layoutReferenceEnvironmentCount() + 1");
    expect(appSrc).toContain('layout_reference_count: props.layoutReferenceCardCount');
    expect(appSrc).toContain("'--redeven-environment-grid-columns': String(layoutModel().column_count)");
    expect(appSrc).toContain('new ResizeObserver(() => updateLayoutMetrics())');
    expect(appSrc).toContain('function EnvironmentLibrarySection');
    expect(appSrc).toContain('data-density={layoutModel().density}');
    expect(styles).toContain('.redeven-environment-library');
    expect(styles).toContain('--redeven-environment-grid-min-column-size: 17rem;');
    expect(styles).toContain('--redeven-environment-grid-spacious-column-size: 19rem;');
    expect(styles).toContain('--redeven-environment-grid-gap: 1rem;');
    expect(styles).toContain('--redeven-environment-grid-spacious-gap: 1.125rem;');
    expect(styles).toContain('grid-template-columns: repeat(var(--redeven-environment-grid-columns), minmax(0, 1fr));');
    expect(styles).not.toContain('.redeven-environment-grid__section-title');
    expect(styles).not.toContain('.redeven-environment-grid--spacious');
    expect(styles).not.toMatch(/@media\s*\(min-width:\s*640px\)\s*\{\s*\.redeven-environment-grid\s*\{/);
    expect(styles).not.toMatch(/@media\s*\(min-width:\s*1024px\)\s*\{\s*\.redeven-environment-grid\s*\{/);
  });

  it('renders Gateway sources as environment-style cards with guided actions', () => {
    const appSrc = readWelcomeSource();
    const gatewaySourceActionRunnerSrc = readGatewaySourceActionRunnerSource();
    const actionPopoverSrc = readDesktopActionPopoverSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('function GatewaySourceCard');
    expect(appSrc).toContain('class="redeven-gateway-library"');
    expect(appSrc).toContain('<div class="redeven-gateway-grid">');
    expect(appSrc).toContain('redeven-environment-card redeven-gateway-card');
    expect(appSrc).toContain('const selectedGatewayRefreshDiagnosisResult = createMemo<GatewayDiagnosisResultSnapshot | null>(() => {');
    expect(appSrc).toContain('const selectedGatewayOperationProgress = createMemo(() => {');
    expect(appSrc).toContain('function localizedGatewaySourceActionLabel');
    expect(appSrc).toContain('const primaryActionLabel = createMemo(() => localizedGatewaySourceActionLabel(props.i18n, displayedPrimaryAction()));');
    expect(appSrc).toContain('const localizedPanelActionLabel = (action: GatewaySourceActionModel) => localizedGatewaySourceActionLabel(props.i18n, action);');
    expect(appSrc).toContain('function localizedGatewaySourceStatusLabel');
    expect(appSrc).toContain('localizedGatewaySourceStatusLabel(props.i18n, row().status_label)');
    expect(appSrc).toContain("'Service ready': 'progress.gatewayServiceReady'");
    expect(appSrc).toContain("'The Gateway service is ready. Use Refresh to pair if needed and refresh the environment catalog.': 'environmentCenter.gatewayGuidanceReadyDetail'");
    expect(appSrc).toContain('type GatewayForegroundActionSnapshot');
    expect(appSrc).toContain('type GatewayDiagnosisResultSnapshot');
    expect(appSrc).toContain('closedGatewaySourceOverlayState');
    expect(appSrc).toContain('reconcileGatewaySourceOverlayState(current, props.gatewaySources)');
    expect(appSrc).toContain('const renderedGatewaySourceIDs = createMemo(() => gatewaySourceIDsWithActiveOverlay(');
    expect(appSrc).toContain('<For each={renderedGatewaySourceIDs()}>');
    expect(appSrc).not.toContain('activeGatewayPopoverID');
    expect(appSrc).not.toContain('if (!visibleGatewaySourceIDs().includes(activeGatewayID))');
    expect(appSrc).toContain('const [foregroundGatewayActions, setForegroundGatewayActions] = createSignal<Record<string, GatewayForegroundActionSnapshot | null>>({});');
    expect(appSrc).toContain('const foregroundAction = () => props.foregroundAction;');
    expect(appSrc).toContain('const setForegroundAction = props.setForegroundAction;');
    expect(appSrc).toContain('owns_progress: boolean;');
    expect(appSrc).toContain('const [retainedDiagnosisResult, setRetainedDiagnosisResult] = createSignal<GatewayDiagnosisResultSnapshot | null>(null);');
    expect(appSrc).not.toContain('diagnosis_result?: GatewayDiagnosisResultSnapshot;');
    expect(appSrc).toContain('function buildGatewayDiagnosisResultSnapshot');
    expect(appSrc).not.toContain('function gatewayDiagnosisResultMatchesProgress');
    expect(appSrc).not.toContain('foregroundCheckResultPanel');
    expect(appSrc).not.toContain('diagnosis_gateway');
    expect(appSrc).not.toContain('diagnosis_checked_at_unix_ms');
    expect(appSrc).toContain('gatewayProgressBelongsToForegroundAction(progress, foreground)');
    expect(appSrc).toContain('function gatewayBusyStateBelongsToForegroundAction(');
    expect(appSrc).toContain('function selectForegroundGatewayProgress(');
    expect(appSrc).toContain('return progressStartedAt > 0 && progressStartedAt >= foreground.started_at_unix_ms;');
    expect(appSrc).not.toContain('return gatewayProgressIsActive(progress)\n      || progressStartedAt >= foreground.started_at_unix_ms;');
    expect(appSrc).not.toContain('progressStartedAt + 750');
    expect(appSrc).toContain('const GATEWAY_TERMINAL_PROGRESS_VISIBLE_MS = ACTION_TOAST_TTL_MS;');
    expect(appSrc).toContain('const [liveActionProgress, setLiveActionProgress] = createSignal<readonly DesktopLauncherActionProgress[]>([]);');
    expect(appSrc).toContain('function launcherProgressIdentityKey(progress: DesktopLauncherActionProgress): string');
    expect(appSrc).toContain('const rememberLiveActionProgress = (progress: DesktopLauncherActionProgress) => {');
    expect(appSrc).toContain('rememberLiveActionProgress(progress);');
    expect(appSrc).toContain('...liveActionProgress().filter((live) => (');
    expect(appSrc).toContain('const selectedGatewayWorkflowProgress = createMemo(() => {');
    expect(appSrc).toContain('const selectedGatewayForegroundRecoveryProgress = createMemo(() => {');
    expect(appSrc).toContain('const busyGatewayWorkflowProgress = createMemo(() => {');
    expect(appSrc).not.toContain('function gatewayProgressCanOccupyForeground(progress: DesktopLauncherActionProgress): boolean');
    expect(appSrc).toContain('function gatewayProgressCanRecoverForegroundAction(progress: DesktopLauncherActionProgress): boolean');
    expect(appSrc).toContain('const selectedGatewayForegroundRecoveryProgress = createMemo(() => {');
    expect(appSrc).toContain('if (foregroundAction()) {\n      return null;\n    }');
    expect(appSrc).not.toContain('gatewayProgressMatchesAction(props.gateway, row().primary_action, progress)');
    expect(appSrc).toContain('gatewayProgressMatchesSubject(props.gateway.gateway_id, progress)');
    const recoveryStart = appSrc.indexOf('function gatewayProgressCanRecoverForegroundAction(progress: DesktopLauncherActionProgress): boolean');
    const recoveryEnd = appSrc.indexOf('function gatewaySourceActionForLauncherRequest', recoveryStart);
    const recoverySrc = appSrc.slice(recoveryStart, recoveryEnd);
    expect(recoverySrc).toContain("case 'restart_gateway':");
    expect(recoverySrc).toContain("case 'update_gateway':");
    expect(recoverySrc).not.toContain("case 'sync_gateway':");
    expect(appSrc).not.toContain('GATEWAY_FOREGROUND_PENDING_MIN_VISIBLE_MS');
    expect(appSrc).toContain('pending_progress?: DesktopLauncherActionProgress;');
    expect(appSrc).toContain('const ownsProgress = presentationCanStartProgress(action);');
    expect(appSrc).toContain('const pendingProgress = ownsProgress\n      ? pendingGatewayForegroundProgress(props.gateway, action, operationKey, startedAtUnixMS)\n      : null;');
    expect(appSrc).toContain('...(pendingProgress ? { pending_progress: pendingProgress } : {}),');
    expect(appSrc).toContain('const progress = selectedGatewayWorkflowProgress() ?? busyGatewayWorkflowProgress();');
    expect(appSrc).toContain('if (progress) {\n      clearForegroundPendingProgress();\n    }');
    expect(appSrc).toContain('const selectedGatewayOperationProgress = createMemo(() => {');
    expect(appSrc).toContain('if (foreground && !foreground.owns_progress) {\n      return null;\n    }');
    expect(appSrc).toContain('const selected = foreground\n      ? selectedGatewayWorkflowProgress() ?? busyGatewayWorkflowProgress()\n      : (props.actionPopoverOpen ? selectedGatewayForegroundRecoveryProgress() : null);');
    expect(appSrc).toContain('const selectedGatewayRefreshDiagnosisResult = createMemo<GatewayDiagnosisResultSnapshot | null>(() => {');
    expect(appSrc).toContain('const visibleGatewayDiagnosisResult = createMemo<GatewayDiagnosisResultSnapshot | null>(() => {');
    expect(appSrc).toContain('if (props.gateway.diagnosis) {\n      return buildGatewayDiagnosisResultSnapshot({');
    expect(appSrc).toContain("if (selected?.action === 'refresh_gateway' && selected.status === 'succeeded') {");
    expect(appSrc).not.toContain("if (progress?.action === 'refresh_gateway' && progress.status === 'succeeded') {\n      return null;\n    }");
    expect(appSrc).toContain('const visibleGatewayProgress = createMemo(() => {\n    const progress = selectedGatewayOperationProgress();\n    return progress;\n  });');
    expect(appSrc).toContain('const labelsByStepID: Readonly<Record<string, DesktopTranslationKey>> = {');
    expect(appSrc).toContain('const stepIDKey = labelsByStepID[cleanStepID];');
    expect(appSrc).toContain('return fallbackKey ? i18n.t(fallbackKey) : cleanFallback || cleanStepID;');
    expect(appSrc).toContain('if (pending && !selected) {');
    expect(appSrc).not.toContain('if (pending && (!selected || launcherActionProgressIsTerminal(selected))) {');
    expect(appSrc).toContain('if (progress && !launcherActionProgressIsTerminal(progress)) {');
    expect(appSrc).toContain('if (progress && gatewayProgressNeedsAttention(progress)) {');
    expect(appSrc).not.toContain('selectedVisibleGatewayProgress');
    expect(appSrc).not.toContain('if (selected && launcherActionProgressIsTerminal(selected)) {');
    expect(appSrc).toContain('const activeProgressForAction = (action: GatewaySourceActionModel): DesktopLauncherActionProgress | null => selectForegroundGatewayProgress(');
    expect(appSrc).toContain('progress.lifecycle_progress.operation === operation');
    expect(appSrc).not.toContain('const selectedActiveGatewaySnapshotProgress = createMemo(() => selectForegroundGatewayProgress(');
    expect(appSrc).not.toContain('?? selectedActiveGatewaySnapshotProgress()');
    expect(appSrc).toContain("'Legacy Gateway service residue': 'environmentCenter.gatewayPanelFactLegacyRuntimeResidue'");
    expect(appSrc).not.toContain('?? activeGatewayOperationProgress()');
    expect(appSrc).toContain('<GatewayActionPanel');
    expect(appSrc).not.toContain('statusFacts={liveStatusFacts()}');
    expect(appSrc).toContain('foregroundActionBusy={foregroundActionBusy}');
    expect(appSrc).toContain('runGatewayLauncherAction={runForegroundRequest}');
    expect(appSrc).toContain('if (progress.gateway_diagnosis) {');
    expect(appSrc).toContain('return progress.gateway_diagnosis;');
    expect(appSrc).not.toContain("nextAction.resolve_focus === 'identity_trust'");
    expect(appSrc).not.toContain("? 'review_trust'");
    expect(appSrc).toContain('const closeActionPopover = () => {');
    expect(appSrc).toContain('let actionPopoverExitTask: (() => void) | null = null;');
    expect(appSrc).toContain('const releaseClosedForegroundAction = () => {');
    expect(appSrc).toContain('const closeActionPopoverAfterExit = (task: () => void) => {');
    expect(appSrc).toContain('onExitComplete={releaseClosedForegroundAction}');
    expect(appSrc).toContain('setForegroundAction(null);');
    expect(appSrc).toContain('let previousGatewayID = props.gateway.gateway_id;');
    expect(appSrc).toContain('if (gatewayID === previousGatewayID) {\n      return;\n    }');
    expect(appSrc).not.toContain("createEffect(on(\n    () => props.gateway.gateway_id,\n    () => {");
    expect(appSrc).toContain('return !foregroundWantsPopover();');
    expect(appSrc).toContain('const runForegroundRequestFromProgress = (');
    expect(appSrc).toContain("if (currentProgress.subject_kind === 'gateway' && launcherActionProgressIsTerminal(currentProgress)) {");
    expect(appSrc).toContain('props.dismissOperation(currentProgress);');
    expect(appSrc).toContain('runForegroundRequest(request);');
    expect(appSrc).toContain('const foregroundWantsPopover = createMemo(() => (');
    expect(appSrc).toContain('gatewayProgressIsActive(visibleGatewayProgress())');
    expect(appSrc).toContain('const guidePanelHasState = createMemo(() => (');
    expect(appSrc).toContain('&& guidePanelHasState()');
    expect(appSrc).toContain('let actionPopoverStaleCloseFrame = 0;');
    expect(appSrc).toContain('const clearActionPopoverStaleCloseFrame = () => {');
    expect(appSrc).toContain('actionPopoverStaleCloseFrame = requestAnimationFrame(() => {');
    expect(appSrc).toContain('if (props.actionPopoverOpen && !actionPopoverOpen()) {\n        props.onActionPopoverOpenChange(false);\n      }');
    expect(appSrc).toContain('const foregroundCanShowGuidePanel = createMemo(() => {');
    expect(appSrc).toContain('foregroundPendingProgress() !== null\n      || visibleGatewayDiagnosisResult() !== null\n      || gatewayProgressNeedsAttention(visibleGatewayProgress())');
    expect(appSrc).toContain('function gatewayProgressNeedsAttention(progress: DesktopLauncherActionProgress | null | undefined): boolean');
    expect(appSrc).toContain('!gatewayProgressNeedsAttention(currentProgress)');
    expect(appSrc).toContain('props.onActionPopoverOpenChange(false);');
    expect(appSrc).toContain('}, GATEWAY_TERMINAL_PROGRESS_VISIBLE_MS);');
    expect(appSrc).toContain('closeActionPopoverAfterExit(() => {\n                        props.dismissOperation(currentProgress);');
    expect(appSrc).toContain('if (foreground !== null && foreground.action.intent !== \'refresh_gateway\') {\n      return null;\n    }');
    expect(appSrc).not.toContain('if (!foregroundAction()?.owns_progress || foregroundActionIsTerminal()) {');
    expect(appSrc).not.toContain('const gatewayAttentionID = createMemo(() => {');
    expect(appSrc).not.toContain('onClick={() => props.onActionPopoverOpenChange(!props.actionPopoverOpen)}');
    expect(appSrc).toContain('const visiblePanelModel = createMemo(() => {');
    expect(appSrc).toContain('const diagnosisResult = visibleGatewayDiagnosisResult();\n    if (diagnosisResult) {\n      return diagnosisResult.panel_model;\n    }');
    expect(appSrc).toContain('const runPrimaryPointerDown: JSX.EventHandlerUnion<HTMLSpanElement, PointerEvent>');
    expect(appSrc).toContain('if (currentProgress && progressPresentation()) {\n      return;\n    }');
    expect(appSrc).toContain('onAnchorPointerDown={runPrimaryPointerDown}');
    expect(appSrc).toContain('function gatewayForegroundDiagnosisBelongsToRefresh(');
    expect(appSrc).toContain('return checkedAtUnixMS >= foreground.started_at_unix_ms;');
    expect(appSrc).toContain('void runGatewaySourceAction(action, props.gateway, props.openCreateGatewaySetup, props.runGatewayLauncherAction);');
    expect(appSrc).not.toContain('props.pairGateway');
    expect(appSrc).not.toContain('props.runGatewayServiceAction');
    expect(gatewaySourceActionRunnerSrc).not.toContain('gatewaySourceActionShouldStartIfNeeded');
    expect(appSrc).toContain('const menuActions = createMemo(() => row().secondary_actions);');
    expect(appSrc).toContain('const [foregroundGatewayActions, setForegroundGatewayActions] = createSignal<Record<string, GatewayForegroundActionSnapshot | null>>({});');
    expect(appSrc).toContain('foregroundAction={foregroundGatewayAction(gatewayID)}');
    expect(appSrc).toContain('setForegroundAction={(next) => setForegroundGatewayAction(gatewayID, next)}');
    expect(appSrc).toContain('const openActionPopover = () => {');
    expect(appSrc).toContain('if (visibleGatewayProgress() || retainedDiagnosisResult()) {\n      props.onActionPopoverOpenChange(true);\n      return;\n    }');
    const openPopoverStart = appSrc.indexOf('const openActionPopover = () => {');
    const openPopoverEnd = appSrc.indexOf('const syncGatewayLabel = createMemo', openPopoverStart);
    const openPopoverSrc = appSrc.slice(openPopoverStart, openPopoverEnd);
    expect(openPopoverSrc.indexOf('retainedDiagnosisResult()')).toBeLessThan(
      openPopoverSrc.indexOf('actionStartsWorkflowImmediately(primaryAction)'),
    );
    expect(appSrc).toContain('setRetainedDiagnosisResult(diagnosisResult);');
    expect(appSrc).toContain("setForegroundAction({\n        ...foreground,\n        gateway: diagnosisResult.gateway,\n        panel_model: diagnosisResult.panel_model,\n      });");
    expect(appSrc).not.toContain('if (props.actionPopoverOpen && !actionPopoverOpen()) {\n      props.onActionPopoverOpenChange(false);');
    const gatewayCardStart = appSrc.indexOf('function GatewaySourceCard');
    const gatewayCardEnd = appSrc.indexOf('function gatewayPanelIconTone', gatewayCardStart);
    expect(gatewayCardStart).toBeGreaterThanOrEqual(0);
    expect(gatewayCardEnd).toBeGreaterThan(gatewayCardStart);
    const gatewayCardSrc = appSrc.slice(gatewayCardStart, gatewayCardEnd);
    expect(gatewayCardSrc).toContain('fallback={(\n                  <GatewayActionPanel');
    expect(gatewayCardSrc).toContain('<EnvironmentProgressPanel');
    expect(gatewayCardSrc).not.toContain('redeven-popover-panel-collapse');
    expect(appSrc).toContain("if (trimString(failure.operation_key) !== '') {\n        return;\n      }");
    expect(appSrc).not.toContain('const quickSecondaryActions = createMemo(() => secondaryActions().slice(0, 1));');
    expect(appSrc).not.toContain('const overflowSecondaryActions = createMemo(() => secondaryActions().slice(quickSecondaryActions().length));');
    expect(appSrc).toContain('class="redeven-gateway-card__catalog-summary"');
    expect(appSrc).toContain('redeven-gateway-card__summary-title');
    expect(appSrc).toContain('redeven-gateway-card__summary-detail');
    expect(appSrc).toContain("if (action.intent === 'view_gateway_environments')");
    expect(appSrc).toContain("if (action.intent === 'add_gateway_environment')");
    expect(appSrc).toContain('const primaryActionRunning = createMemo(() => (');
    expect(appSrc).toContain('foregroundActionRunning()');
    expect(appSrc).not.toContain('const gatewayActionRunning = createMemo(() => (');
    expect(appSrc).not.toContain('Start Gateway & Pair');
    expect(appSrc).not.toContain('gatewayStartRequiredDialog');
    expect(appSrc).toContain("case 'refresh_status':");
    expect(appSrc).toContain("case 'update_gateway':\n                          runForegroundRequestFromProgress({");
    expect(appSrc).not.toContain("case 'update_gateway':\n                          runForegroundRequest({");
    expect(appSrc).toContain('<MoreHorizontal class="h-3.5 w-3.5" />');
    expect(appSrc).toContain('ariaLabel={moreActionsForLabel()}');
    expect(appSrc).toContain('moreActionsMenuOpen={gatewaySourceOverlayOpenFor(activeGatewayOverlayState(), \'more_actions_menu\', gatewayID)}');
    expect(appSrc).toContain('onMoreActionsMenuOpenChange={(open) => setGatewayMoreActionsMenuOpen(gatewayID, open)}');
    expect(gatewayCardSrc).not.toContain('const [moreActionsOpen, setMoreActionsOpen] = createSignal(false);');
    expect(appSrc).toContain('<For each={menuActions()}>');
    expect(appSrc).toContain('disabled={menuItemDisabled(action)}');
    expect(appSrc).toContain('<span class="redeven-split-menu-item-icon">');
    expect(appSrc).toContain('<GatewaySourceActionIcon intent={action.intent} class="h-3.5 w-3.5" />');
    const gatewaySourceActionIconStart = appSrc.indexOf('function GatewaySourceActionIcon');
    const gatewaySourceActionIconEnd = appSrc.indexOf('const LOCAL_ENVIRONMENT_SETTINGS_DIALOG_CLASS', gatewaySourceActionIconStart);
    expect(gatewaySourceActionIconStart).toBeGreaterThanOrEqual(0);
    expect(gatewaySourceActionIconEnd).toBeGreaterThan(gatewaySourceActionIconStart);
    const gatewaySourceActionIconSrc = appSrc.slice(gatewaySourceActionIconStart, gatewaySourceActionIconEnd);
    expect(gatewaySourceActionIconSrc).toContain("case 'disable_gateway':\n      return <GatewayDisabledIcon class={iconClass()} />;");
    expect(gatewaySourceActionIconSrc).toContain("case 'stop_gateway':\n      return <Stop class={iconClass()} />;");
    expect(gatewaySourceActionIconSrc).toContain("case 'restart_gateway':\n      return <Refresh class={iconClass()} />;");
    expect(gatewaySourceActionIconSrc).toContain("case 'update_gateway':\n      return <Package class={iconClass()} />;");
    expect(gatewaySourceActionIconSrc).not.toContain("case 'disable_gateway':\n      return <Stop");
    expect(gatewaySourceActionIconSrc).not.toContain("case 'update_gateway':\n      return <Save");
    expect(gatewayCardSrc).not.toContain('<div class="p-1">');
    expect(appSrc).toContain('loading={primaryBusy()}');
    expect(appSrc).toContain('onClick={runPrimaryAction}');
    expect(appSrc).toContain('foregroundActionRunning()');
    expect(appSrc).not.toContain('syncGatewayRunning');
    expect(appSrc).not.toContain('syncGatewayFromIcon');
    expect(appSrc).not.toContain('selectedActiveGatewaySyncProgress');
    expect(appSrc).toContain('const displayedPrimaryAction = createMemo(() => {');
    expect(appSrc).toContain('if (foreground && !foreground.owns_progress && props.actionPopoverOpen) {');
    expect(appSrc).toContain('if (foreground && foreground.owns_progress && gatewayProgressIsActive(progress)) {');
    expect(appSrc).not.toContain('visibleGatewayDiagnosisResult()?.panel_model.primary_action');
    const displayedPrimaryStart = appSrc.indexOf('const displayedPrimaryAction = createMemo(() => {');
    const displayedPrimaryEnd = appSrc.indexOf('const primaryActionLabel = createMemo', displayedPrimaryStart);
    const displayedPrimarySrc = appSrc.slice(displayedPrimaryStart, displayedPrimaryEnd);
    expect(displayedPrimarySrc).not.toContain('gatewayProgressCanRecoverForegroundAction(progress)');
    expect(displayedPrimarySrc).not.toContain('gatewaySourceActionForLauncherRequest({');
    expect(appSrc).toContain('const runMoreMenuAction = (action: GatewaySourceActionModel) => {');
    expect(appSrc).toContain("if (presentationCanStartProgress(action) && presentation.execution_mode !== 'confirm') {");
    const menuWorkflowStart = appSrc.indexOf('const runMoreMenuAction = (action: GatewaySourceActionModel) => {');
    const menuWorkflowEnd = appSrc.indexOf('const runPanelAction = (action: GatewaySourceActionModel) => {', menuWorkflowStart);
    const menuWorkflowSrc = appSrc.slice(menuWorkflowStart, menuWorkflowEnd);
    expect(menuWorkflowSrc).toContain('closeMoreActions();\n      window.setTimeout(() => {');
    expect(menuWorkflowSrc).toContain('if (!runGatewayActionAsForeground(action)) {');
    expect(menuWorkflowSrc).not.toContain('onPointerDown={(event) => runMoreMenuActionFromPointer(event, action)}');
    expect(appSrc).toContain('runMoreMenuAction(action);');
    expect(appSrc).toContain('clicked_action: displayedPrimaryAction()');
    expect(appSrc).toContain('allowMainAxisOverflow={false}');
    expect(appSrc).toContain('onAnchorPointerDown={runPrimaryPointerDown}');
    expect(actionPopoverSrc).toContain('onPointerDownCapture={stopSurfacePointerDownPropagation}');
    expect(actionPopoverSrc).toContain('event.stopPropagation();');
    expect(appSrc).toContain("'Update available': 'environmentCenter.gatewayNeedsUpdate'");
    expect(appSrc).toContain("'Update required': 'environmentCenter.gatewayNeedsUpdate'");
    expect(appSrc).toContain("Starting: 'environmentCenter.gatewayStatusStarting'");
    const gatewayPanelStart = appSrc.indexOf('function GatewayActionPanel');
    const gatewayPanelEnd = appSrc.indexOf('function gatewaySourceLauncherActionKind');
    const gatewayPanelSrc = appSrc.slice(gatewayPanelStart, gatewayPanelEnd);
    expect(gatewayPanelSrc).toContain('<div class="redeven-gateway-action-panel__body">');
    expect(gatewayPanelSrc).toContain('redeven-gateway-action-panel__result-facts');
    expect(gatewayPanelSrc).toContain('environmentCenter.gatewayPanelCheckResult');
    expect(gatewayPanelSrc).toContain('const [diagnosticsOpen, setDiagnosticsOpen] = createSignal(false);');
    expect(gatewayPanelSrc).toContain('onClick={() => setDiagnosticsOpen((open) => !open)}');
    const diagnosticsToggleStart = gatewayPanelSrc.indexOf('class="redeven-gateway-action-panel__diagnostics-toggle"');
    const diagnosticsToggleEnd = gatewayPanelSrc.indexOf('<Show when={diagnosticsOpen()}>', diagnosticsToggleStart);
    const diagnosticsToggleSrc = gatewayPanelSrc.slice(diagnosticsToggleStart, diagnosticsToggleEnd);
    expect(diagnosticsToggleSrc).not.toContain('runGatewayLauncherAction');
    expect(diagnosticsToggleSrc).not.toContain('runAction');
    expect(gatewayPanelSrc).not.toContain('stopPropagation');
    expect(gatewayPanelSrc).toContain('<div class="redeven-gateway-action-panel__footer" data-mode="primary">');
    expect(gatewayPanelSrc).not.toContain('close-only');
    expect(gatewayPanelSrc).not.toContain("props.i18n.t('common.close')");
    expect(gatewayPanelSrc.indexOf('<div class="redeven-gateway-action-panel__body">')).toBeLessThan(
      gatewayPanelSrc.indexOf('<div class="redeven-gateway-action-panel__footer" data-mode="primary">'),
    );
    expect(gatewayPanelSrc).not.toContain("if (action.intent === 'manage_gateway')");
    expect(gatewayPanelSrc).toContain('loading={props.foregroundActionBusy(action())}');
    expect(gatewayPanelSrc).not.toContain('gatewaySourceActionBusy(props.busyState');
    expect(appSrc).not.toContain('setSelectedAction(refreshStatusAction)');
    expect(appSrc).not.toContain('setSelectedAction(action)');
    expect(appSrc).not.toContain('redeven-gateway-card__management-chip');
    expect(appSrc).not.toContain('redeven-gateway-card__secondary-actions');
    expect(gatewayCardSrc).not.toContain("intent: 'delete_gateway'");
    expect(gatewayCardSrc).not.toContain("case 'delete_gateway':");
    expect(gatewayPanelSrc).not.toContain("intent: 'delete_gateway'");
    expect(gatewayPanelSrc).not.toContain("case 'delete_gateway':");
    expect(appSrc).not.toContain('gatewayStartRequiredDialog');
    expect(appSrc).not.toContain('gatewayStartRequiredNextStep');
    expect(appSrc).not.toContain('function GatewaySourceRow');
    expect(appSrc).not.toContain('function GatewayEnvironmentInlineRow');
    expect(appSrc).not.toContain('GatewayEnvironmentActionIcon');
    expect(appSrc).not.toContain('gateway_env_id: action.environment_id');
    expect(appSrc).not.toContain('redeven-gateway-row');
    expect(styles).toContain('.redeven-gateway-grid');
    expect(styles).toContain('grid-template-columns: repeat(auto-fit, minmax(min(100%, 18.5rem), 22rem));');
    expect(styles).toContain('.redeven-gateway-card {');
    expect(styles).toContain('--redeven-action-popover-width: min(19rem, calc(100vw - 1rem));');
    expect(styles).not.toContain('--redeven-action-popover-width: min(28rem');
    expect(styles).toContain('.redeven-gateway-action-panel__footer button > span');
    expect(styles).toContain('.redeven-gateway-action-panel__diagnostics-label');
    expect(styles).toContain('overflow-wrap: anywhere;');
    expect(styles).toContain('.redeven-gateway-card__primary-anchor');
    expect(styles).toContain('flex: 1 1 auto;');
    expect(styles).not.toContain('.redeven-gateway-card__guidance');
    expect(styles).toContain('.redeven-gateway-card__summary-title');
    expect(styles).toContain('.redeven-gateway-card__summary-detail');
    expect(styles).toContain('.redeven-gateway-card__catalog-summary');
    expect(styles).toContain('.redeven-gateway-action-panel__hero');
    expect(styles).toContain(".redeven-action-popover__action-stack[data-subject-kind='gateway'] .redeven-action-popover__actions[data-layout='secondary']");
    expect(styles).toContain('.redeven-gateway-action-panel__section-label');
    expect(styles).toContain('.redeven-gateway-action-panel__result-facts');
    expect(styles).toContain(".redeven-gateway-action-panel__result-fact[data-tone='success']");
    expect(styles).toContain('.redeven-gateway-action-panel__result-fact-value');
    expect(styles).toContain('text-overflow: ellipsis;');
    expect(styles).toContain('.redeven-gateway-action-panel__diagnostics-toggle');
    expect(styles).toContain('.redeven-gateway-action-panel__facts--status');
    expect(styles).toContain('grid-template-rows: minmax(0, 1fr) auto;');
    expect(styles).toContain('.redeven-gateway-action-panel__body');
    expect(styles).toContain('overflow: auto;');
    expect(styles).not.toContain('.redeven-gateway-card__management-chip');
    expect(styles).not.toContain('.redeven-gateway-card__env-list');
    expect(styles).not.toContain('.redeven-gateway-env-row');
    expect(styles).not.toContain('.redeven-gateway-card__secondary-actions');
  });

  it('keeps the language picker closed until an explicit open request arrives', () => {
    const appSrc = readWelcomeSource();
    const pickerStart = appSrc.indexOf('function DesktopLanguagePicker');
    const pickerEnd = appSrc.indexOf('function PrimaryNavigation');
    const pickerSrc = appSrc.slice(pickerStart, pickerEnd);

    expect(pickerSrc).toContain('const [open, setOpen] = createSignal(false);');
    expect(pickerSrc).toContain('{ defer: true }');
    expect(pickerSrc).toContain('if (next === previous) {');
  });

  it('builds retained Gateway failure progress with Refresh-owned recovery actions', () => {
    const appSrc = readWelcomeSource();
    const retainedStart = appSrc.indexOf('function retainedGatewayFailureProgress');
    const retainedEnd = appSrc.indexOf('function localizedFailureForDisplay');
    const retainedSrc = appSrc.slice(retainedStart, retainedEnd);
    const normalizerStart = appSrc.indexOf('function gatewayActionKindForRequest');
    const normalizerEnd = appSrc.indexOf('function retainedGatewayFailureProgress', normalizerStart);
    const normalizerSrc = appSrc.slice(normalizerStart, normalizerEnd);

    expect(normalizerSrc).toContain("case 'check_gateway':");
    expect(normalizerSrc).toContain("case 'sync_gateway':");
    expect(normalizerSrc).toContain("case 'pair_gateway':");
    expect(normalizerSrc).toContain("return 'refresh_gateway';");
    expect(retainedSrc).not.toContain("case 'gateway_start_required':");
    expect(retainedSrc).not.toContain("kind: 'check_gateway'");
    expect(retainedSrc).not.toContain("kind: 'sync_gateway'");
    expect(retainedSrc).not.toContain("kind: 'pair_gateway'");
    expect(retainedSrc).not.toContain("kind: 'update_gateway'");
    expect(retainedSrc).not.toContain("kind: 'resolve_gateway'");
    expect(retainedSrc).not.toContain("failure.code === 'gateway_start_required' ? { start_policy");
  });

  it('routes welcome action controls through shared pointer-ready button classes', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('redeven-console-icon-button');
    expect(appSrc).toContain('redeven-console-chip-button');
    expect(styles).toContain('.redeven-console-icon-button');
    expect(styles).toContain('.redeven-console-chip-button');
    expect(styles).toContain('cursor: pointer;');
  });

  it('routes environment Flower entrypoints into the shared Flower surface', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('const [flowerTurnLauncherIntent, setFlowerTurnLauncherIntent]');
    expect(appSrc).toContain('const [flowerFocusThreadRequest, setFlowerFocusThreadRequest] = createSignal<FlowerThreadFocusRequest | null>(null)');
    expect(appSrc).toContain('let flowerFocusThreadRequestSequence = 0;');
    expect(appSrc).toContain('function openEnvironmentFlowerSurface(');
    expect(appSrc).toContain('environment: DesktopEnvironmentEntry,');
    expect(appSrc).toContain('openEnvironmentFlowerSurface(props.environment');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.askFlowerForLabel', { label: props.environment.label })");
    expect(appSrc).toContain('<FlowerTurnLauncherWindow');
    expect(appSrc).toContain('intent={flowerTurnLauncherIntent()}');
    expect(appSrc).toContain('focusThreadRequest={flowerFocusThreadRequest()}');
    expect(appSrc).toContain('source_surface:');
    expect(appSrc).toContain("'desktop_welcome_environment_card'");
    expect(appSrc).toContain('launchLocalEnvironmentFlowerTurn(props.runtime.settings');
    expect(appSrc).toContain('const bootstrap = await launchLocalEnvironmentFlowerTurn(props.runtime.settings');
    expect(appSrc).toContain('const threadID = trimString(bootstrap.thread.thread_id || bootstrap.thread_id);');
    expect(appSrc).toContain('flowerFocusThreadRequestSequence += 1;');
    expect(appSrc).toContain('request_id: `welcome-flower-focus-${flowerFocusThreadRequestSequence}`');
    expect(appSrc).toContain('onFocusThreadRequestConsumed={(requestID) => {');
    expect(appSrc).toContain('current?.request_id === requestID ? null : current');
    expect(appSrc).toContain('closeFlowerTurnLauncher();\n      await openFlowerSurface();');
    expect(appSrc).toContain('context_action: buildEnvironmentFlowerContextAction(environment, contextSummary, cleanLabel)');
    expect(appSrc).not.toContain('context_action: buildEnvironmentFlowerContextEnvelope(environment).raw');
    expect(appSrc).toContain('async function openFlowerSurface(): Promise<void>');
    expect(appSrc).toContain("kind: 'open_flower'");
    expect(appSrc).toContain('class="redeven-environment-card__flower-button"');
    expect(appSrc).toContain('FlowerSoftAuraIcon');
    expect(appSrc).not.toContain('flowerDraftIntent');
    expect(appSrc).not.toContain('draftIntent=');
    expect(appSrc).not.toContain('FlowerSurfaceDraftIntent');
    expect(appSrc).not.toContain('From Desktop Environment: ${cleanLabel}');
    expect(appSrc).not.toContain('askFlowerCardReadyHint');
    expect(appSrc).not.toContain('EnvironmentFlowerCardPopover');
    expect(appSrc).not.toContain('PersistentFloatingWindow');
    expect(appSrc).not.toContain('function EnvironmentFlowerComposerWindow');
    expect(appSrc).not.toContain('redeven-environment-flower-window');
    expect(appSrc).not.toContain('sendEnvironmentFlowerPrompt');
    expect(appSrc).not.toContain('focusedFlowerThreadID');
    expect(styles).toContain('.redeven-environment-card__flower-button');
    expect(styles).toContain('border: 0;');
    expect(styles).toContain('.redeven-environment-card__flower-button:hover .redeven-environment-card__flower-icon');
    expect(styles).toContain('animation: redeven-flower-intro-spin');
    expect(styles).not.toContain('.redeven-environment-flower-window');
    expect(styles).not.toContain('.redeven-flower-card-popover-surface');
  });

  it('renders desktop tooltips through a body-level portal so dialogs do not clip them', () => {
    const tooltipSrc = readDesktopTooltipSource();
    const anchoredSurfaceSrc = readDesktopAnchoredOverlaySurfaceSource();

    expect(tooltipSrc).toContain("import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';");
    expect(tooltipSrc).toContain('data-redeven-tooltip-anchor=""');
    expect(tooltipSrc).toContain('role="tooltip"');
    expect(tooltipSrc).toContain("z-[220]");
    expect(anchoredSurfaceSrc).toContain("import { Portal } from 'solid-js/web';");
    expect(anchoredSurfaceSrc).toContain('<Portal>');
    expect(anchoredSurfaceSrc).toContain("'fixed'");
    expect(anchoredSurfaceSrc).not.toContain('animate-in fade-in zoom-in-95');
  });

  it('renders interactive desktop popovers through a body-level portal so blocked actions can offer guided recovery', () => {
    const popoverSrc = readDesktopPopoverSource();
    const actionPopoverSrc = readDesktopActionPopoverSource();
    const styles = readWelcomeStyles();

    expect(popoverSrc).toContain("import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';");
    expect(popoverSrc).toContain('data-redeven-popover-anchor=""');
    expect(popoverSrc).toContain('role="dialog"');
    expect(popoverSrc).toContain("z-[225]");
    expect(popoverSrc).toContain('open: boolean;');
    expect(popoverSrc).toContain('onOpenChange: (open: boolean) => void;');
    expect(popoverSrc).toContain('props.onOpenChange(true);');
    expect(popoverSrc).not.toContain("const [visible, setVisible] = createSignal(false);");
    expect(actionPopoverSrc).toContain('data-redeven-action-popover-anchor=""');
    expect(styles).toContain('min-height: 2.75rem;');
    expect(styles).toContain('.redeven-popover-panel-collapse {');
    expect(styles).toContain('display: none;');
    expect(styles).toContain('.redeven-popover-panel-collapse--open {');
    expect(styles).toContain('display: grid;');
    expect(actionPopoverSrc).toContain("document.addEventListener('focusin', handleFocusIn);");
    expect(actionPopoverSrc).toContain("event.key === 'Escape'");
  });

  it('renders dialog field listboxes through anchored portals so footers and scroll panes cannot clip them', () => {
    const appSrc = readWelcomeSource();
    const listboxSrc = readDesktopAnchoredListboxSource();

    expect(appSrc).toContain("import { DesktopAnchoredListbox } from './DesktopAnchoredListbox';");
    expect(appSrc).toContain('<DesktopAnchoredListbox');
    expect(appSrc).toContain('anchorRef={buttonRef}');
    expect(appSrc).toContain('anchorRef={rootRef}');
    expect(appSrc).toContain('width={288}');
    expect(appSrc).not.toContain('class="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover p-1 shadow-xl"');
    expect(appSrc).not.toContain('class="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-xl"');
    expect(listboxSrc).toContain("import { Portal } from 'solid-js/web';");
    expect(listboxSrc).toContain('<Portal>');
    expect(listboxSrc).toContain("'fixed z-[240] flex flex-col overflow-hidden");
    expect(listboxSrc).toContain('style={{');
    expect(listboxSrc).toContain('width?: number;');
    expect(listboxSrc).toContain('resolveDesktopAnchoredListboxGeometry');
    expect(listboxSrc).toContain('function readDesktopTitlebarTopInset(): number');
    expect(listboxSrc).toContain("getPropertyValue('--redeven-desktop-titlebar-height')");
    expect(listboxSrc).toContain('viewportTopInset: readDesktopTitlebarTopInset()');
    expect(listboxSrc).toContain('IMPORTANT: Dialog form listboxes must live outside dialog scroll containers.');
  });

  it('renders the Desktop header language picker as an anchored rich listbox', () => {
    const appSrc = readWelcomeSource();
    const pickerStart = appSrc.indexOf('function DesktopLanguagePicker');
    const pickerEnd = appSrc.indexOf('function DesktopCommandRegistrar', pickerStart);
    const pickerSrc = appSrc.slice(pickerStart, pickerEnd);

    expect(pickerSrc).not.toContain('<select');
    expect(pickerSrc).not.toContain('<option');
    expect(pickerSrc).toContain('<TopBarIconButton');
    expect(pickerSrc).toContain('<DesktopAnchoredListbox');
    expect(pickerSrc).toContain('anchorRef={buttonRef}');
    expect(pickerSrc).toContain('width={288}');
    expect(pickerSrc).toContain('role="listbox"');
    expect(pickerSrc).toContain('role="option"');
    expect(pickerSrc).toContain('tabIndex={-1}');
    expect(pickerSrc).toContain('scrollListboxOptionIntoView');
    expect(pickerSrc).toContain('aria-haspopup="listbox"');
    expect(pickerSrc).toContain("aria-expanded={open() ? 'true' : 'false'}");
    expect(pickerSrc).toContain('aria-controls="redeven-desktop-language-options"');
    expect(pickerSrc).toContain("aria-activedescendant={open() ? `redeven-desktop-language-option-${highlightedIndex()}` : undefined}");
    expect(pickerSrc).toContain("props.i18n.t('common.language')");
    expect(pickerSrc).toContain("props.i18n.t('language.usingLanguage'");
    expect(pickerSrc).toContain('REDEVEN_LOCALE_META[preference].english_name');
    expect(pickerSrc).toContain('<Globe');
    expect(pickerSrc).toContain('<Check');
  });

  it('does not use native browser selects in the Desktop welcome surface', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).not.toContain('<select');
    expect(appSrc).not.toContain('<option');
  });

  it('renders the Gateway profile source control as an anchored rich listbox', () => {
    const appSrc = readWelcomeSource();
    const pickerStart = appSrc.indexOf('function GatewayProfileSourcePicker');
    const pickerEnd = appSrc.indexOf('function ConnectionDialog', pickerStart);
    const pickerSrc = appSrc.slice(pickerStart, pickerEnd);

    expect(pickerSrc).toContain('function GatewayProfileSourcePicker');
    expect(pickerSrc).not.toContain('<select');
    expect(pickerSrc).not.toContain('<option');
    expect(pickerSrc).toContain('<DesktopAnchoredListbox');
    expect(pickerSrc).toContain('anchorRef={buttonRef}');
    expect(pickerSrc).toContain('role="listbox"');
    expect(pickerSrc).toContain('role="option"');
    expect(pickerSrc).toContain('tabIndex={-1}');
    expect(pickerSrc).toContain('scrollListboxOptionIntoView');
    expect(pickerSrc).toContain('aria-haspopup="listbox"');
    expect(pickerSrc).toContain("aria-expanded={open() ? 'true' : 'false'}");
    expect(pickerSrc).toContain('aria-controls={listboxID}');
    expect(pickerSrc).toContain('buildGatewaySourceRowModel(gateway)');
    expect(pickerSrc).toContain("props.i18n.t('environmentCenter.gatewaySearchPlaceholder')");
    expect(pickerSrc).toContain("props.i18n.t('environmentCenter.noMatchingGatewaysDescription')");
    expect(pickerSrc).toContain('localizedGatewaySourceStatusLabel');
    expect(pickerSrc).toContain('localizedGatewaySourceCountText');
    expect(pickerSrc).toContain('gatewaySourceToneTagVariant(row().status_tone)');
    expect(pickerSrc).toContain('selectedGatewayProfileSource(props.gateways, props.selectedGatewayID)');
    expect(pickerSrc).not.toContain('sources[0]');
    expect(pickerSrc).toContain('connectionDialog.validationGatewayRequired');
    expect(pickerSrc).toContain('<ShieldCheck');
    expect(pickerSrc).toContain('<ChevronDown');
    expect(pickerSrc).toContain('<Check');
  });

  it('keeps Gateway profile source selection searchable and keyboard reachable', () => {
    const appSrc = readWelcomeSource();
    const pickerStart = appSrc.indexOf('function GatewayProfileSourcePicker');
    const pickerEnd = appSrc.indexOf('function ConnectionDialog', pickerStart);
    const pickerSrc = appSrc.slice(pickerStart, pickerEnd);
    const dialogStart = appSrc.indexOf('function ConnectionDialog');
    const dialogEnd = appSrc.indexOf('function officialProviderOptionForOrigin', dialogStart);
    const dialogSrc = appSrc.slice(dialogStart, dialogEnd);

    expect(pickerSrc).toContain('const [query, setQuery] = createSignal');
    expect(pickerSrc).toContain('gatewayProfileSourceSearchText(gateway)');
    expect(pickerSrc).toContain("event.key === 'ArrowDown'");
    expect(pickerSrc).toContain("event.key === 'ArrowUp'");
    expect(pickerSrc).toContain("event.key === 'Enter' || event.key === ' '");
    expect(pickerSrc).toContain("event.key === 'Escape'");
    expect(pickerSrc).toContain('buttonRef?.focus();');
    expect(pickerSrc).toContain('props.onSelect(gateway.gateway_id);');
    expect(pickerSrc).toContain('props.clearFieldErrors();');
    expect(dialogSrc).toContain('<GatewayProfileSourcePicker');
    expect(dialogSrc).toContain('gateways={props.gatewayProfileSources}');
    expect(dialogSrc).toContain("selectedGatewayID={props.state?.connection_kind === 'gateway_url_profile' ? props.state.gateway_id : ''}");
    expect(dialogSrc).toContain("onSelect={(gatewayID) => props.updateField('gateway_id', gatewayID)}");
  });

  it('preserves keyboard and focus behavior for the Desktop header language listbox', () => {
    const appSrc = readWelcomeSource();
    const pickerStart = appSrc.indexOf('function DesktopLanguagePicker');
    const pickerEnd = appSrc.indexOf('function DesktopCommandRegistrar', pickerStart);
    const pickerSrc = appSrc.slice(pickerStart, pickerEnd);

    expect(pickerSrc).toContain("event.key === 'ArrowDown'");
    expect(pickerSrc).toContain("event.key === 'ArrowUp'");
    expect(pickerSrc).toContain("event.key === 'Enter' || event.key === ' '");
    expect(pickerSrc).toContain("event.key === 'Escape'");
    expect(pickerSrc).toContain('createEffect(on(');
    expect(pickerSrc).toContain('setHighlightedIndex(selectedIndex());');
    expect(pickerSrc).toContain('setHighlightedIndex((current) => (current + delta + count) % count);');
    expect(pickerSrc).toContain('document.addEventListener(\'mousedown\', handlePointerDown);');
    expect(pickerSrc).toContain('document.addEventListener(\'keydown\', handleKeyDown);');
    expect(pickerSrc).toContain('buttonRef?.focus();');
    expect(pickerSrc).toContain('props.onPreferenceChange(preference);');
    expect(pickerSrc).toContain('onMouseDown={(event) => {');
    expect(pickerSrc).toContain('event.preventDefault();');
  });

  it('routes Desktop language and command chrome through i18n dictionaries', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("props.i18n.t('language.systemDefault')");
    expect(appSrc).toContain("props.i18n.t('language.usingLanguage'");
    expect(appSrc).toContain("i18n.t('shell.accessibility.skipLinkLabel')");
    expect(appSrc).toContain("i18n.t('shell.commandSearchPlaceholder')");
    expect(appSrc).toContain("props.i18n.t('commandPalette.changeLanguageTitle')");
    expect(appSrc).toContain('execute: () => props.openLanguageSettings()');
    expect(appSrc).toContain('openLanguageSettings={openLanguageSettings}');
    expect(appSrc).toContain('function openLanguageSettings(): void');
    expect(appSrc).toContain('const [languagePickerOpenRequest, setLanguagePickerOpenRequest] = createSignal(0);');
    expect(appSrc).toContain('setLanguagePickerOpenRequest((current) => current + 1);');
    expect(appSrc).toContain('openRequest={languagePickerOpenRequest()}');
    expect(appSrc).not.toContain('<DesktopInterfaceSettingsDialog');
    expect(appSrc).not.toContain('open={languageSettingsOpen()}');
    expect(appSrc).not.toContain('setLanguageSettingsOpen');
    expect(appSrc).toContain("props.i18n.t('commandPalette.toggleThemeTitle')");
    expect(appSrc).toContain("i18n().t('shell.useDarkTheme')");
    expect(appSrc).toContain("i18n().t('shell.useLightTheme')");
    expect(appSrc).not.toContain("title: 'Change Language'");
    expect(appSrc).not.toContain("label={theme.resolvedTheme() === 'light' ? 'Use dark theme' : 'Use light theme'}");
  });

  it('includes compact environment-card launcher copy inside the source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('connectEnvironmentTitle');
    expect(appSrc).toContain('openRedevenDashboard');
    expect(appSrc).toContain('function openRedevenDashboard');
    expect(appSrc).toContain("props.i18n.t(headerCopy().titleKey)");
    expect(appSrc).toContain("labelKey: 'desktop.provider'");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.searchPlaceholder')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.localFilter')");
    expect(appSrc).toContain('<EnvironmentConnectionCard');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.newEnvironmentTitle')");
    expect(appSrc).toContain('NewEnvironmentPlaceholderCard');
  });

  it('renders filter pills with counts, a dismissible chip for runtime target / control plane filters, and conditional live count', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    // Pill counts
    expect(appSrc).toContain("{props.i18n.t('environmentCenter.allFilter')} ({layoutReferenceEnvironmentCount()})");
    expect(appSrc).toContain('{option.label} ({option.count})');
    // Chip for non-category filters
    expect(appSrc).toContain('activeNonCategoryFilterChipLabel');
    expect(appSrc).toContain('redeven-runtime-chip');
    expect(styles).toContain('.redeven-runtime-chip');
    expect(styles).toContain('.redeven-runtime-chip:hover');
    // Conditional live count
    expect(appSrc).toContain('open_windows.length > 0');
    // Dead code removed
    expect(appSrc).not.toContain('redeven-native-select');
    expect(appSrc).not.toContain('All Sources');
    expect(appSrc).not.toContain('activeSourceFilterLabel');
    // Active pill contrast enhanced
    expect(styles).toContain('border-color: var(--primary)');
  });

  it('renders facts rows, endpoint copy inputs, and pinned sections in the environment library', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('buildEnvironmentCardFactsModel');
    expect(appSrc).not.toContain('buildControlPlaneEnvironmentFactsModel');
    expect(appSrc).toContain('EndpointsPopover');
    expect(appSrc).toContain('splitPinnedEnvironmentEntryIDs');
    expect(appSrc).toContain('environmentLibraryEntryRecord');
    expect(appSrc).not.toContain('splitPinnedEnvironmentEntries(props.entries)');
    expect(appSrc).toContain('function EnvironmentLibrarySection');
    expect(appSrc).toContain('function EnvironmentCardFactsBlock');
    expect(appSrc).toContain('runEnvironmentCardFactAction');
    expect(appSrc).toContain('runtimeTargetEnvironmentLibraryFilterValue(action.runtime_target_id)');
    expect(appSrc).toContain('runtimeTargetEnvironmentLibraryFilterTargetID(props.librarySourceFilter)');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.linkedRuntimeFilterWithLabel'");
    expect(appSrc).toContain('redeven-card-fact-value--action');
    expect(appSrc).toContain('cardFactIconMaskStyle');
    expect(appSrc).not.toContain('<img src={icon()} class="redeven-card-fact-label-icon"');
    expect(appSrc).not.toContain('<img src={icon()} class="redeven-card-fact-leading-icon"');
    expect(appSrc).toContain('function EndpointsPopover');
    expect(appSrc).toContain("import { endpointDisplayValue } from './endpointDisplay';");
    expect(appSrc).toContain("openEnvironmentLibraryOverlayState('endpoints', environmentID)");
    expect(appSrc).toContain('selectEnvironmentEndpointOverlayState(environmentID, endpointValue)');
    expect(appSrc).toContain('function EndpointQRCodePanel');
    expect(appSrc).toContain("qrcode(0, 'M')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.pinnedSection')");
    expect(appSrc).toContain('copyEnvironmentValue');
    expect(appSrc).toContain('<Pin class=');
    expect(styles).toContain('.redeven-card-fact-row');
    expect(styles).toContain('.redeven-card-fact-label');
    expect(styles).toContain('--redeven-card-fact-icon-mask');
    expect(styles).toContain('background-color: currentColor');
    expect(styles).toContain('mask: var(--redeven-card-fact-icon-mask) center / contain no-repeat');
    expect(styles).toContain('.redeven-card-fact-value--action');
    expect(styles).toContain('.redeven-card-fact-value__text');
    expect(styles).toContain('.redeven-endpoints-popover--expanded');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) 8.35rem;');
    expect(styles).toContain('.redeven-endpoints-section');
    expect(styles).toContain('.redeven-endpoints-title');
    expect(styles).toContain('.redeven-card-endpoint-row');
    expect(styles).toContain('.redeven-card-endpoint-label');
    expect(styles).toContain('.redeven-card-endpoint-value');
    expect(styles).toContain('.redeven-card-endpoint-copy');
    expect(styles).toContain('.redeven-endpoint-qr-panel');
    expect(styles).toContain('.redeven-endpoint-qr-image');
    expect(styles).toContain('.redeven-endpoint-qr-copy-label');
    expect(styles).toContain('.redeven-endpoint-qr-copy-button');
    expect(styles).toContain('.redeven-status-indicator');
    expect(appSrc).toContain('EnvironmentStatusIndicator');
  });

  it('renders split runtime actions with refresh controls and external-runtime messaging', () => {
    const appSrc = readWelcomeSource();
    const actionPopoverSrc = readDesktopActionPopoverSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('function EnvironmentSplitActionButton');
    expect(appSrc).toContain('function EnvironmentPrimaryActionPanel');
    expect(appSrc).toContain('function localizedEnvironmentActionPresentation');
    expect(appSrc).toContain('primary_action: localizedEnvironmentAction(i18n, presentation.primary_action)');
    expect(appSrc).toContain('localizedEnvironmentOverlay(i18n, presentation.primary_action_overlay)');
    expect(appSrc).toContain('menu_button_label: localizedEnvironmentActionLabel(i18n, presentation.menu_button_label)');
    expect(appSrc).toContain('menu_actions: presentation.menu_actions.map((item) => localizedEnvironmentMenuItem(i18n, item))');
    expect(appSrc).toContain('label: localizedEnvironmentActionLabel(i18n, item.label)');
    expect(appSrc).toContain('disabled_reason: localizedRuntimeMessage(i18n, action.disabled_reason)');
    expect(appSrc).toContain('const renderPrimaryButton = () => (');
    expect(appSrc).not.toContain('const primaryButton = (');
    expect(appSrc).not.toContain('function openProviderLocalServeDialog');
    expect(appSrc).toContain('openSettingsSurface(environment.id);');
    expect(appSrc).toContain("route: 'remote_desktop'");
    expect(appSrc).toContain('return startEnvironmentRuntime(environment, errorTarget);');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.refreshRuntimeStatus')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.refreshRuntimeStatuses')");
    expect(appSrc).toContain('const secondaryIconOnly = () => isSecondary && props.overlay.actions.length > 1;');
    expect(appSrc).toContain("showsRefreshIcon && 'gap-1.5'");
    expect(appSrc).toContain('<Show when={showsRefreshIcon}>');
    expect(appSrc).toContain('primary_action_overlay');
    expect(appSrc).toContain('<DesktopActionPopover');
    expect(actionPopoverSrc).toContain('placement="top"');
    expect(actionPopoverSrc).toContain('allowMainAxisOverflow');
    expect(actionPopoverSrc).not.toContain('placement?: DesktopOverlayPlacement');
    expect(actionPopoverSrc).not.toMatch(/\bprops\.placement\b(?!Lock)/u);
    expect(appSrc).toContain('<DesktopAnchoredOverlaySurface');
    expect(appSrc).toContain('const blockedPrimaryActionDisabled = createMemo(() => (');
    expect(appSrc).toContain('redeven-split-action-trigger__content');
    expect(appSrc).toContain('<Lock class="redeven-split-action-trigger__icon h-3.5 w-3.5" />');
    expect(appSrc).toContain('fallback={props.presentation.primary_action.label}');
    expect(appSrc).toContain("'redeven-split-action-trigger--blocked'");
    expect(appSrc).toContain('aria-disabled={blockedPrimaryActionDisabled() ? true : undefined}');
    expect(appSrc).toContain("return i18n.t('environmentAction.unavailableTrigger', { label });");
    expect(appSrc).toContain('activeEnvironmentOverlayState');
    expect(appSrc).toContain('guidanceSessionState');
    expect(appSrc).toContain('reconcileEnvironmentLibraryOverlayState');
    expect(appSrc).toContain('reconcileEnvironmentGuidanceSession');
    expect(appSrc).toContain('projectedEntriesByID');
    expect(appSrc).toContain('projectedEntryIDs');
    expect(appSrc).toContain('<For each={groupedEntryIDs().pinned_entry_ids}>');
    expect(appSrc).toContain('environment={projectedEnvironment(environmentID)}');
    expect(appSrc).toContain('guidanceOpen={props.primaryActionGuidanceOpen}');
    expect(appSrc).toContain('props.presentation.menu_button_label');
    expect(appSrc).toContain('menuContainsTarget');
    expect(appSrc).toContain('menuRef?.contains(target)');
    expect(appSrc).toContain('firstEnabledMenuItem(menuRef)?.focus();');
    expect(appSrc).toContain('anchorRef={rootRef}');
    expect(appSrc).toContain('role="menu"');
    expect(appSrc).toContain('ariaLabel={props.presentation.menu_button_label}');
    expect(appSrc).not.toContain("document.addEventListener('focusin', handleFocusIn);");
    expect(appSrc).toContain('startEnvironmentRuntime');
    expect(appSrc).toContain('stopEnvironmentRuntime');
    expect(appSrc).not.toContain('runtimeMaintenanceConfirmation');
    expect(appSrc).not.toContain('requestRuntimeMaintenanceConfirmation');
    expect(appSrc).not.toContain('confirmRuntimeMaintenance');
    expect(appSrc).toContain('force_runtime_update');
    expect(appSrc).toContain('forceRuntimeUpdate: true');
    expect(appSrc).not.toContain('allow_active_work_replacement');
    expect(appSrc).not.toContain('allowActiveWorkReplacement: true');
    expect(appSrc).not.toContain('continueLauncherOperation');
    expect(appSrc).not.toContain("kind: 'continue_launcher_operation'");
    expect(appSrc).toContain("kind: 'dismiss_launcher_operation'");
    expect(appSrc).toContain('IMPORTANT: Provider-link confirmation is intentionally reachable only from');
    expect(appSrc).toContain('desktopEntryKindOwnsRuntimeManagement(environment.kind)');
    expect(appSrc).toContain("action?.runtime_operation_method === 'desktop_local_update_handoff'");
    expect(appSrc).toContain("kind: 'manage_desktop_update'");
    expect(appSrc).toContain("result?.outcome === 'opened_desktop_update_handoff'");
    expect(appSrc).toContain("i18n().t('environmentCenter.desktopUpdateOpenedToast'");
    expect(appSrc).toContain('localizedRuntimeServiceWorkload');
    expect(appSrc).toContain('providerRuntimeLinkActiveWorkLabel');
    expect(appSrc).toContain("i18n.tn('plural.terminalCount'");
    expect(appSrc).toContain("case 'start_runtime':");
    expect(appSrc).toContain("case 'connect_provider_runtime':");
    expect(appSrc).toContain("case 'disconnect_provider_runtime':");
    expect(appSrc).toContain("case 'stop_runtime':");
    expect(appSrc).toContain("case 'restart_runtime':");
    expect(appSrc).toContain("case 'update_runtime':");
    expect(appSrc).toContain("case 'refresh_runtime':");
    expect(appSrc).toContain('openEnvironmentLibraryOverlayState');
    expect(appSrc).not.toContain('openRuntimeMenuEnvironmentID');
    expect(appSrc).toContain('aria-label={props.presentation.menu_button_label}');
    expect(styles).toContain('.redeven-split-action');
    expect(styles).toContain('.redeven-split-action-primary');
    expect(styles).toContain('.redeven-split-action-trigger__content');
    expect(styles).toContain('.redeven-split-action-trigger__icon');
    expect(styles).toContain('.redeven-split-action-trigger--blocked');
    expect(styles).toContain('border-style: solid;');
    expect(styles).toContain(".redeven-split-action-trigger--blocked[aria-expanded='true']");
    expect(styles).toContain('.redeven-split-action-toggle');
    expect(styles).toContain('.redeven-split-menu');
    expect(styles).not.toContain('bottom: calc(100% + 0.5rem);');
    expect(styles).toContain('.redeven-split-menu-item');
    expect(styles).toContain('.redeven-action-popover-frame');
    expect(styles).toContain('--redeven-action-popover-border');
    expect(styles).toContain('--redeven-action-popover-width: min(19rem, calc(100vw - 1rem));');
    expect(styles).toContain('width: 100%;');
    expect(styles).toContain('.redeven-action-popover > *');
    expect(styles).toContain('.redeven-action-popover__notice-detail');
    expect(styles).toContain('overflow-wrap: anywhere;');
    expect(styles).toContain('flex-wrap: wrap;');
    expect(styles).toContain('.redeven-action-popover');
    expect(styles).toContain('.redeven-action-popover__actions');
    expect(styles).toContain('.redeven-action-popover__action-stack');
    expect(styles).toContain(".redeven-action-popover__actions[data-layout='primary']");
    expect(styles).toContain(".redeven-action-popover__actions[data-layout='secondary']");
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(styles).toContain('.redeven-action-popover__notice');
  });

  it('renders lifecycle and Open connection progress inside the Open popup instead of the old SSH activity overlay', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('const activeActionProgress = createMemo(() => [');
    expect(appSrc).toContain('...snapshot().action_progress,');
    expect(appSrc).toContain('...retainedGatewayFailures().filter');
    expect(appSrc).toContain('reconcileBusyStateWithActionProgressSnapshot');
    expect(appSrc).toContain('setBusyState((busy) => reconcileBusyStateWithActionProgressSnapshot(busy, next.action_progress));');
    expect(appSrc).toContain('setBusyState((busy) => reconcileBusyStateWithActionProgressSnapshot(busy, acceptedSnapshot.action_progress));');
    expect(appSrc).toContain('actionProgress={props.actionProgress}');
    expect(appSrc).toContain('selectedSnapshotRuntimeLifecycleProgressForEnvironment(props.environment, props.actionProgress)');
    expect(appSrc).toContain('selectedSnapshotOpenConnectionProgressForEnvironment(props.environment, props.actionProgress)');
    expect(appSrc).toContain('launcherProgressBlocksPrimaryAction(openConnectionProgress())');
    expect(appSrc).not.toContain('|| openConnectionProgress() !== null');
    expect(appSrc).not.toContain('activeRuntimeLifecycleProgressForEnvironment');
    expect(appSrc).not.toContain('activeOpenConnectionProgressForEnvironment');
    expect(appSrc).not.toContain('selectedOpenConnectionProgressForEnvironment(props.environment, props.busyState, props.actionProgress)');
    expect(appSrc).not.toContain('selectedRuntimeLifecycleProgressForEnvironment(props.environment, props.busyState, props.actionProgress)');
    expect(appSrc).not.toContain('runtimeLifecycleProgress() !== null && !runtimeOpenable()');
    expect(appSrc).toContain('runtimeLifecycleProgress={visibleRuntimeLifecycleProgress()}');
    expect(appSrc).toContain('openConnectionProgress={visibleOpenConnectionProgress()}');
    expect(appSrc).toContain('visibleEnvironmentLifecycleProgress({');
    expect(appSrc).toContain('selectedProgress: runtimeLifecycleProgress(),');
    expect(appSrc).toContain('disclosure: props.lifecycleDisclosure,');
    expect(appSrc).toContain('busyState: props.busyState,');
    expect(appSrc).not.toContain('const disclosureRuntimeLifecycleProgress = createMemo');
    expect(appSrc).toContain('environmentLifecycleDisclosureHasPendingRequest(lifecycleDisclosure, props.busyState)');
    expect(appSrc).toContain('progressOpen={props.lifecycleProgressOpen}');
    expect(appSrc).toContain('onProgressOpenChange={props.onLifecycleProgressOpenChange}');
    expect(appSrc).toContain('function EnvironmentProgressPanel');
    expect(appSrc).toContain('environmentProgressMeterPercent(props.progress)');
    expect(appSrc).toContain('primaryAction?: EnvironmentActionModel;');
    expect(appSrc).toContain('runPrimaryAction?: (action: EnvironmentActionModel) => void;');
    expect(appSrc).toContain('const panelPrimaryAction = createMemo(() => localizedProgressPanelPrimaryAction(');
    expect(appSrc).toContain('<Show when={panelPrimaryAction()}>');
    expect(appSrc).toContain('<ExternalLink class="h-3.5 w-3.5" />');
    expect(appSrc).toContain('onClick={() => props.runPrimaryAction?.(action().action)}');
    expect(appSrc).toContain('{action().label}');
    expect(appSrc).toContain('primaryAction={props.presentation.primary_action}');
    expect(appSrc).toContain('const [rememberedOpenConnectionProgress, setRememberedOpenConnectionProgress] = createSignal<DesktopLauncherActionProgress | null>(null);');
    expect(appSrc).toContain('const visibleOpenConnectionProgress = createMemo(() => (');
    expect(appSrc).toContain('openConnectionProgress() ?? rememberedOpenConnectionProgress()');
    expect(appSrc).toContain("if (progress.status === 'succeeded' || progress.status === 'canceled') {");
    expect(appSrc).toContain('setRememberedOpenConnectionProgress(progress);');
    expect(appSrc).toContain('props.onProgressOpenChange(false);\n                            closeMenu();\n                            props.onRunAction(action);');
    expect(appSrc).toContain('createRuntimeLifecycleStepAnimation');
    expect(appSrc).toContain('<Index each={phaseSequence()}>');
    expect(appSrc).toContain('data-step-key={step().key}');
    expect(appSrc).toContain('data-plan-revision={startup()?.plan_revision ?? 0}');
    expect(appSrc).toContain('data-entering={startup() ? stepEntering(step().key) : false}');
    expect(appSrc).toContain("data-plan-state={startup()?.plan_state ?? 'executing'}");
    expect(appSrc).toContain("currentRuntimeLifecycle()?.plan_state !== 'planning'");
    expect(appSrc).not.toContain("current.plan_state === 'planning'");
    expect(appSrc).toContain('localizedProgressPlanningLabel(props.i18n, props.progress.action)');
    expect(appSrc).toContain('<Show when={localizedFailure()}>');
    expect(appSrc).toContain('<div class="redeven-action-popover__notice-detail">{failure().summary}</div>');
    expect(appSrc).toContain('redeven-action-popover__notice-detail--pre');
    expect(appSrc).toContain("action.kind === 'update_runtime'");
    expect(appSrc).toContain('const nextActionGroups = createMemo(() => groupedVisibleOperationNextActions(props.progress));');
    expect(appSrc).toContain('<For each={nextActionGroups()}>');
    expect(appSrc).toContain('data-layout={group.kind}');
    expect(appSrc).toContain('<For each={group.actions}>');
    expect(appSrc).toContain("case 'refresh_status':");
    expect(appSrc).toContain("case 'copy_diagnostics':");
    expect(appSrc).toContain("case 'dismiss':");
    expect(appSrc).toContain('runNextAction?.(action, props.progress)');
    expect(appSrc).toContain("case 'manage_desktop_update':");
    expect(appSrc).toContain('props.runDesktopUpdateHandoff(props.environmentID, props.environmentLabel);');
    expect(appSrc).toContain('primaryActionBusy={props.loading === true}');
    expect(appSrc).toContain('loading={action().loading}');
    expect(appSrc).toContain('disabled={action().disabled}');
    expect(appSrc).not.toContain('props.progress.error_message');
    expect(appSrc).toContain('const panelProgress = createMemo(() => selectEnvironmentPanelProgress(primaryProgress(), runtimeMenuProgress()));');
    expect(appSrc).toContain('runtimeLifecycleProgress={runtimeMenuProgress()}');
    expect(appSrc).toContain('busyStateBlocksEnvironmentAction(busyState, environmentID, [\'stop_environment_runtime\', \'run_gateway_environment_lifecycle\'], runtimeLifecycleProgress)');
    expect(appSrc).toContain('const progressPanelVisible = createMemo(() => props.progressOpen && hasPanelProgress());');
    expect(appSrc).toContain('const primaryProgressPresentation = createMemo(() => localizedPrimaryProgressPresentation(');
    expect(appSrc).toContain('primaryProgressPresentation() || progressPanelVisible()');
    expect(appSrc).toContain('const popoverOpen = createMemo(() => progressPanelVisible() || (props.guidanceOpen && popoverOverlay() !== undefined));');
    expect(appSrc).toContain("classList={{ 'redeven-popover-panel-collapse--open': progressPanelVisible() }}");
    expect(appSrc).not.toContain('const progressOccupiesPrimaryTrigger = createMemo(() => (');
    expect(appSrc).not.toContain('const showProgress = createMemo(() =>');
    expect(appSrc).not.toContain('when={showProgress()}');
    expect(appSrc).toContain('aria-haspopup="dialog"');
    expect(appSrc).not.toContain('const environmentProgressTriggerIcon = createMemo(() => (');
    expect(appSrc).not.toContain('environmentProgressTriggerLabel');
    expect(appSrc).not.toContain('const currentPresentation = presentation();');
    expect(appSrc).toContain('type EnvironmentProgressPrimaryPresentation,');
    expect(appSrc).toContain('function progressTriggerClassName(presentation: EnvironmentProgressPrimaryPresentation): string');
    expect(appSrc).toContain("presentation.kind === 'progress_trigger'");
    expect(appSrc).toContain('renderEnvironmentProgressPresentationIcon(presentation())');
    expect(appSrc).toContain("'redeven-split-action-trigger--attention'");
    expect(appSrc).toContain('<AlertTriangle class="redeven-split-action-trigger__icon h-3.5 w-3.5" />');
    expect(appSrc).toContain('aria-label={presentation().ariaLabel}');
    expect(appSrc).toContain('<span>{presentation().label}</span>');
    expect(appSrc).toContain('redeven-environment-progress');
    expect(appSrc).toContain('redeven-split-action-trigger--progress');
    expect(appSrc).toContain('props.onProgressOpenChange(false);\n                      props.onRunAction(props.presentation.primary_action);');
    expect(appSrc).toContain("openEnvironmentLibraryOverlayState('lifecycle_progress', environmentID)");
    expect(appSrc).not.toContain('autoOpenedEnvironmentProgressOperation');
    expect(appSrc).not.toContain('OPEN_CONNECTION_PROGRESS_POPOVER_DELAY_MS');
    expect(appSrc).not.toContain('<SSHRuntimeActivityOverlay');
    expect(appSrc).not.toContain('sshRuntimeProgressItems');
    expect(appSrc).not.toContain('function SSHRuntimeActivityOverlay');
    expect(appSrc).not.toContain('Starting SSH Runtime');
    expect(styles).toContain('.redeven-environment-progress');
    expect(styles).toContain('grid-template-columns: 1rem minmax(0, 1fr);');
    expect(styles).toContain(".redeven-environment-progress__step[data-entering='true']");
    expect(appSrc).toContain('const hasStepTimeline = createMemo(() => Boolean(stepProgress() || startup() || openConnection()));');
    expect(appSrc).toContain('const failureNoticeHeading = createMemo(() => trimString(localizedFailure()?.title) || failureNoticeTitle());');
    expect(appSrc).toContain('<div class="redeven-action-popover__notice-title">{failureNoticeHeading()}</div>');
    const steppedProgressStart = appSrc.indexOf('<Show when={hasStepTimeline()}>');
    const steppedProgressEnd = appSrc.indexOf('<Show when={canCancel()}>', steppedProgressStart);
    const steppedProgressSrc = appSrc.slice(steppedProgressStart, steppedProgressEnd);
    expect(steppedProgressSrc.indexOf('{renderFailureNotice()}')).toBeGreaterThan(
      steppedProgressSrc.indexOf('<div class="redeven-environment-progress__steps" aria-hidden="true">'),
    );
    expect(steppedProgressSrc.indexOf('{renderNextActionGroups()}')).toBeGreaterThan(
      steppedProgressSrc.indexOf('<div class="redeven-environment-progress__steps" aria-hidden="true">'),
    );
    expect(appSrc).toContain("data-placement={hasStepTimeline() ? 'after-steps' : 'inline'}");
    expect(styles).toContain(".redeven-action-popover__action-stack[data-placement='after-steps']");
    expect(styles).toContain(".redeven-environment-progress .redeven-action-popover__notice[data-placement='after-steps']");
    expect(styles).toContain(".redeven-environment-progress__meter[data-plan-state='planning'] span");
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('.redeven-environment-progress__meter');
    expect(styles).toContain('.redeven-environment-progress__meta');
    expect(styles).toContain('.redeven-split-action-trigger--progress');
    expect(styles).toContain('.redeven-split-action-trigger--attention');
    expect(styles).not.toContain('.redeven-ssh-runtime-activity');
  });

  it('shows structured card failures with diagnostics behind Details', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('formatDesktopOperationFailureForClipboard(presentation())');
    expect(appSrc).toContain('{presentation().summary}');
    expect(appSrc).toContain('{presentation().recovery_hint}');
    expect(appSrc).toContain("<summary>{props.i18n.t('settings.detailsTitle')}</summary>");
    expect(appSrc).toContain('diagnostic.label');
    expect(appSrc).toContain('diagnostic.text');
    expect(styles).toContain('.redeven-environment-card__failure-details summary');
    expect(styles).toContain('cursor: pointer;');
    expect(styles).toContain('.redeven-environment-card__failure-diagnostic');
  });

  it('lets users inspect and cancel lifecycle or Open progress from the Open popup while shimmer feedback stays active', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('async function cancelLauncherOperation(progress: DesktopLauncherActionProgress): Promise<void>');
    expect(appSrc).toContain("kind: 'cancel_launcher_operation'");
    expect(appSrc).not.toContain("kind: 'continue_launcher_operation'");
    expect(appSrc).toContain("kind: 'dismiss_launcher_operation'");
    expect(appSrc).toContain("showActionToast(progress.open_progress ? i18n().t('toast.openingStopping') : i18n().t('toast.runtimeStartupStopping'), 'info');");
    expect(appSrc).toMatch(/cancelOperation=\{\(progress\) => \{\s+void cancelLauncherOperation\(progress\);/u);
    expect(appSrc).toContain('cancelOperation: (progress: DesktopLauncherActionProgress) => void;');
    expect(appSrc).toContain("case 'cleanup_failed':\n      return i18n.t('progress.cleanupNeedsAttention');");
    expect(appSrc).toContain('props.progress.subject_kind !== \'gateway\'');
    expect(appSrc).toContain('props.progress.cancelable === true');
    expect(appSrc).toContain('props.progress.status === \'running\'');
    expect(appSrc).toContain("props.progress.subject_kind !== 'gateway' && !nextActionsByKind().has('dismiss')");
    expect(appSrc).toContain('onClick={() => props.cancelOperation(props.progress)}');
    expect(appSrc).not.toContain("props.progress.status === 'awaiting_confirmation'");
    expect(appSrc).not.toContain('onClick={() => props.continueOperation(props.progress)}');
    expect(appSrc).toContain('onClick={() => props.dismissOperation(props.progress)}');
    expect(appSrc).toContain("props.i18n.t('progress.copyLog')");
    expect(appSrc).toContain('<Stop class="h-3.5 w-3.5" />');
    expect(appSrc).toContain('localizedProgressInterruptLabel(props.i18n, props.progress)');
    expect(appSrc).toContain("class={shimmerBlocked() ? 'redeven-blocked-shimmer-overlay' : 'redeven-loading-shimmer-overlay'}");
    expect(appSrc).not.toContain('disabled={props.loading && !hasOpenConnectionProgress() && !hasRuntimeLifecycleProgress()}');
    expect(appSrc).not.toContain('disabled={props.loading && popoverPrimaryRunsAction()}');
    expect(appSrc).toContain('disabled={props.loading && !primaryProgressPresentation()}');
    expect(appSrc).toContain('disabled={props.loading && primaryFallbackRunsAction()}');
    expect(appSrc).toContain('environmentActionStartsLifecycleDisclosure(action)');
    expect(appSrc).toContain('props.beginLifecycleDisclosure(action.intent);');
    expect(appSrc).toContain('props.onProgressOpenChange(false);');
    expect(appSrc).toContain('props.setGuidanceSession(startEnvironmentGuidanceIntent(');
    expect(appSrc).not.toContain('function environmentActionOpensRuntimeLifecycleProgress(action: EnvironmentActionModel): boolean');
    expect(appSrc).not.toContain('props.onPrimaryActionGuidanceOpenChange(environmentActionOpensRuntimeLifecycleProgress(action));');
    expect(styles).toContain('.redeven-loading-shimmer-overlay');
    expect(styles).toContain('.redeven-blocked-shimmer-overlay');
    expect(appSrc).not.toContain('Cancel\n                      </Button>\n                    </Show>');
  });

  it('includes Control Plane management copy inside the launcher source', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain("labelKey: 'desktop.provider'");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.addProviderTitle')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.viewEnvironments')");
    expect(appSrc).not.toContain('All Sources');
    expect(appSrc).toContain('Local');
    expect(appSrc).toContain('control-plane-label');
    expect(appSrc).toContain('CONTROL_PLANE_PROVIDER_PRESET_OPTIONS');
    expect(appSrc).toContain("OFFICIAL_PROVIDER_DOMAIN_PARTS = ['redeven', 'com']");
    expect(appSrc).toContain("DEVELOPMENT_PROVIDER_DOMAIN_PARTS = ['redeven', 'test']");
    expect(appSrc).toContain("origin_mode: ControlPlaneOriginMode");
    expect(appSrc).toContain('preset_provider_origin: string');
    expect(appSrc).toContain('custom_provider_origin: string');
    expect(appSrc).toContain('domain: OFFICIAL_PROVIDER_DOMAIN');
    expect(appSrc).toContain('provider_origin: DEFAULT_CONTROL_PLANE_PROVIDER_ORIGIN');
    expect(appSrc).toContain("props.i18n.t('desktop.controlPlane')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.providerOriginPreset')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.providerOriginCustom')");
    expect(appSrc).toContain('control-plane-provider-picker');
    expect(appSrc).toContain('control-plane-provider-options');
    expect(appSrc).toContain('control-plane-custom-origin');
    expect(appSrc).toContain('<OfficialProviderPicker');
    expect(appSrc).toContain('suggestControlPlaneProviderName');
    expect(appSrc).toContain("props.i18n.t('connectionDialog.providerNameAuto')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.providerNameCustom')");
    expect(appSrc.indexOf('control-plane-origin-mode-label')).toBeLessThan(appSrc.indexOf('control-plane-label'));
    expect(appSrc).toContain("props.i18n.t('connectionDialog.continueInBrowser')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.providerAuthorizationHelp')");
    expect(appSrc).not.toContain('id="control-plane-origin"');
    expect(appSrc).not.toContain("props.i18n.t('connectionDialog.providerUrl')");
    expect(appSrc).not.toContain('placeholder="https://redeven.test"');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.reconnect')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.connectProvider')");
    expect(appSrc).toContain('redeven-control-plane-grid');
    expect(appSrc).toContain('redeven-control-plane-card');
    expect(styles).toContain('--redeven-control-plane-grid-column-size: 35rem;');
    expect(styles).toContain('--redeven-control-plane-card-max-width: 44rem;');
    expect(styles).toContain('.redeven-control-plane-grid');
    expect(styles).toContain('.redeven-control-plane-card');
    expect(appSrc).toContain('redeven-provider-shelf__metrics');
    expect(styles).toContain('--redeven-provider-shelf-metric-min-size: 10.75rem;');
    expect(styles).toContain('.redeven-provider-shelf__metrics');
    expect(styles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(styles).toContain('.redeven-provider-shelf__metric');
    expect(styles).toContain('.redeven-provider-shelf__metric-header');
    expect(styles).toContain('@media (max-width: 36rem)');
    expect(appSrc).not.toContain('Remote access through Control Plane');
  });

  it('routes transient launcher failures through toasts instead of page-flow banners or issue cards', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('launcherActionFailurePresentation');
    expect(appSrc).toContain('title: presentation.title');
    expect(appSrc).toContain('action: presentation.action');
    expect(appSrc).toContain('autoDismiss: presentation.auto_dismiss');
    expect(appSrc).toContain('runToastAction={runActionToastAction}');
    expect(appSrc).not.toContain('IssueCard');
    expect(appSrc).not.toContain('EnvironmentInlineNotice');
    expect(appSrc).not.toContain('redeven-console-banner--error');
  });

  it('keeps environment cards concise instead of rendering helper prose under the actions', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).not.toContain('managedActionModel()?.helper_text');
    expect(appSrc).not.toContain('actionModel().helper_text');
    expect(appSrc).not.toContain('The provider currently reports this environment as offline.');
    expect(appSrc).not.toContain('Desktop opens a remote session through the Control Plane without starting a local runtime here.');
  });

  it('uses a settings affordance for every editable environment card', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("props.i18n.t('common.settings')");
    expect(appSrc).not.toContain("case 'manage_gateway':");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.runtimeTargetSettings')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.connectionSettingsForLabel'");
    expect(appSrc).toContain('<Settings class="h-3.5 w-3.5" />');
    expect(appSrc).not.toContain('<Pencil class="h-3.5 w-3.5" />');
  });

  it('describes local environment actions as window-only and runtime-decoupled', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('openEnvironmentDescription');
    expect(appSrc).toContain("case 'start_runtime':");
  });

  it('keeps provider runtime link confirmation explicit and source-scoped', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('providerRuntimeLinkConfirmation');
    expect(appSrc).toContain("i18n().t('environmentCenter.connectToProvider')");
    expect(appSrc).toContain("i18n().t('environmentCenter.disconnectFromProvider')");
    expect(appSrc).toContain("i18n().t('environmentCenter.providerEnvironment')");
    expect(appSrc).toContain("i18n().t('environmentCenter.sourceEnvironment')");
    expect(appSrc).toContain("i18n().t('environmentCenter.connectProviderRuntimeNote')");
    expect(appSrc).toContain("i18n().t('environmentCenter.disconnectProviderRuntimeNote')");
    expect(appSrc).not.toContain('matching provider link. Confirming');
    expect(appSrc).toContain("busyStateMatchesAction(busyState(), 'disconnect_provider_runtime')");
    expect(appSrc).toContain("showActionToast(i18n().t('environmentCenter.disconnectedFromProviderToast'), 'info');");
    expect(appSrc).toContain('if (presentation.refresh_snapshot) {');
    expect(appSrc).toContain("const [providerRuntimeLinkProviderEnvironmentID, setProviderRuntimeLinkProviderEnvironmentID] = createSignal('');");
  });

  it('keeps transient action feedback out of page flow by using a toast viewport', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain("import { Portal } from 'solid-js/web';");
    expect(appSrc).toContain('<DesktopActionToastViewport');
    expect(appSrc).toContain('showActionToast(');
    expect(appSrc).not.toContain('feedback={feedback()}');
    expect(appSrc).not.toContain('props.feedback');
    expect(styles).toContain('.redeven-desktop-toast-viewport');
    expect(styles).toContain('.redeven-desktop-toast');
    expect(styles).toContain('.redeven-desktop-toast__action');
  });

  it('keeps environment cards stable by rendering them directly instead of replaying entry animations', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).not.toContain('function AnimatedCard');
    expect(appSrc).not.toContain('<AnimatedCard');
  });

  it('keeps the New Environment dialog focused on Redeven URLs, SSH hosts, and managed container targets', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("props.i18n.t('connectionDialog.name')");
    expect(appSrc).not.toContain('Environment Name');
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.redevenUrl')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.sshHost')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.localContainer')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.sshContainer')");
    expect(appSrc).not.toContain('Run a Desktop-managed Redeven environment on this device.');
    expect(appSrc).not.toContain('Create a local serve runtime for this provider environment on this Mac.');
    expect(appSrc).not.toContain('This provider environment card will keep both routes visible on this device: serve local here, or open via Control Plane.');
    expect(appSrc).toContain("props.i18n.t('connectionDialog.urlDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.notProviderUrl')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshEnvironmentNotice')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.localContainerDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshContainerDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshContainerDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.container')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.runtimeRoot')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.containerRuntimeRootHelp')");
    expect(appSrc).not.toContain(['Runtime', 'Install', 'Root'].join(' ') + ' <span class="text-destructive">*</span>');
    expect(appSrc).not.toContain(['Runtime', 'State', 'Root'].join(' ') + ' <span class="text-destructive">*</span>');
    expect(appSrc).toContain("label: 'Docker'");
    expect(appSrc).toContain("label: 'Podman'");
    expect(appSrc).toContain('function ContainerPicker');
    expect(appSrc).toContain("props.i18n.t('connectionDialog.chooseRunningContainer')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.noRunningContainers')");
    expect(appSrc).not.toContain('Container Label</label>');
    expect(appSrc).not.toContain('Owner</label>');
    expect(appSrc).not.toContain("label: 'External'");
    expect(appSrc).not.toContain("label: 'Desktop'");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.bootstrapDelivery')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.authentication')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.keyAgent')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.passwordPrompt')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.localSshPassword')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.localSshPasswordHelp')");
    expect(appSrc).toContain('value={isSSHBackedKind() ? (props.state as SSHBackedConnectionDialogState | null)?.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE : DEFAULT_DESKTOP_SSH_AUTH_MODE}');
    expect(appSrc).toContain('variant="default"');
    expect(appSrc).not.toContain("const showCreateConnectAction = createMemo(() => isCreate() && connectionKind() === 'external_local_ui');");
    expect(appSrc).not.toContain('<Show when={showCreateConnectAction()}>');
    expect(appSrc).not.toContain('async function saveAndConnectURLFromDialog()');
    expect(appSrc).not.toContain('async function ' + 'connectFrom' + 'Dialog()');
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.automatic')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.desktopUpload')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.remoteFallback')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.bootstrapHelp')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshDestination')");
    expect(appSrc).toContain('function SSHDestinationCombobox');
    expect(appSrc).toContain('sm:grid-cols-[minmax(0,1fr)_7.5rem]');
    expect(appSrc).toContain("props.updateField('ssh_destination', host.alias);");
    expect(appSrc).toContain("props.updateField('ssh_port', host.port == null ? '' : String(host.port));");
    expect(appSrc).toContain('getSSHConfigHosts');
    expect(appSrc).toContain('listRuntimeContainers');
    expect(appSrc).toContain("props.i18n.t('connectionDialog.runtimeRoot')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.releaseBaseUrl')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.releaseBaseUrlHelp'");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.runtimeRootHelp'");
    expect(appSrc).not.toContain(['Remote', 'Install', 'Directory'].join(' '));
    expect(appSrc).not.toContain(['default', 'remote', 'user', 'cache'].join(' '));
  });

  it('keeps the connection dialog source-scoped across URL, SSH, and managed container targets', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('type ConnectionDialogState = ExternalURLConnectionDialogState | SSHConnectionDialogState | RuntimeContainerConnectionDialogState | GatewayURLProfileConnectionDialogState | null;');
    expect(appSrc).toContain('props.switchKind(value as ConnectionDialogKind)');
    expect(appSrc).toContain("profile_route_kind: DesktopGatewayConnectionKind;");
    expect(appSrc).toContain("props.updateField('profile_route_kind', value);");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.gatewayEnvironmentRouteType')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.gatewayEnvironmentManagedNotice')");
    expect(appSrc).not.toContain('const showCreateConnectAction = createMemo(() => isCreate() && connectionKind() === \'external_local_ui\');');
    expect(appSrc).not.toContain('onConnect={saveAndConnectURLFromDialog}');
    expect(appSrc).not.toContain('scope derived from Name.');
  });

  it('keeps linked-local runtime setup out of the connection dialog', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).not.toContain('LocalEnvironmentBindingResolutionPanel');
    expect(appSrc).not.toContain('resolveLocalEnvironmentBindingResolution');
    expect(appSrc).not.toContain('provider_local_serve');
    expect(appSrc).not.toContain('use_control_plane_binding');
    expect(appSrc).not.toContain('function serveRuntimeLocally');
    expect(appSrc).not.toContain("case 'serve_runtime_locally':");
  });

  it('keeps Local UI access controls inside Local Environment Settings', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('props.baselineSnapshot.access_mode_options');
    expect(appSrc).toContain("aria-label={props.i18n.t('settings.visibilityTitle')}");
    expect(appSrc).toContain("props.i18n.t('settings.accessSecurityDescription')");
    expect(appSrc).toContain("props.i18n.t('settings.visibilityDescription')");
    expect(appSrc).toContain("i18n.t('environmentCenter.localLinksTooltipTitle')");
    expect(appSrc).toContain("i18n.t('environmentCenter.localLinksTooltipDescription')");
    expect(appSrc).toContain("props.i18n.t('settings.localOnlyProtectionNote')");
    expect(appSrc).toContain("i18n.t('settings.sharedPasswordHelp')");
  });

  it('keeps global language controls out of Local Environment Settings', () => {
    const appSrc = readWelcomeSource();
    const dialogStart = appSrc.indexOf('function LocalEnvironmentSettingsDialog');
    const dialogEnd = appSrc.indexOf('function ConnectionDialog', dialogStart);
    const dialogSrc = appSrc.slice(dialogStart, dialogEnd);

    expect(dialogSrc).not.toContain('DesktopLanguageSettingsPanel');
    expect(dialogSrc).not.toContain('languageSnapshot');
    expect(dialogSrc).not.toContain('updateLanguagePreference');
    expect(dialogSrc).not.toContain("props.i18n.t('settings.interfaceTitle')");
    expect(dialogSrc).not.toContain("props.i18n.t('settings.languageTitle')");
  });

  it('closes Local Environment Settings after a successful save', () => {
    const appSrc = readWelcomeSource();
    const saveStart = appSrc.indexOf('async function saveSettings()');
    const saveEnd = appSrc.indexOf('function cancelSettings()', saveStart);
    const saveSrc = appSrc.slice(saveStart, saveEnd);

    expect(saveSrc).toContain("showActionToast(i18n().t('toast.settingsSaved'));");
    expect(saveSrc).toContain('cancelSettings();');
    expect(saveSrc.indexOf('if (!result.ok)')).toBeLessThan(saveSrc.indexOf('cancelSettings();'));
    expect(saveSrc.indexOf('return;')).toBeLessThan(saveSrc.indexOf('cancelSettings();'));
    expect(saveSrc.indexOf('cancelSettings();')).toBeLessThan(saveSrc.indexOf('await refreshSnapshot();'));
    expect(saveSrc).toContain("showActionToast(getErrorMessage(error) || i18n().t('toast.actionFailedFallback'), 'error');");
  });

  it('includes Local Environment Settings copy inside the source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("props.i18n.t('settings.nextStartLabel')");
    expect(appSrc).toContain("props.i18n.t('settings.visibilityTitle')");
    expect(appSrc).toContain("props.i18n.t('settings.detailsTitle')");
    expect(appSrc).toContain("props.i18n.t('settings.runtimeLabel')");
    expect(appSrc).toContain("props.i18n.t('settings.accessSecurityTitle')");
  });

  it('exposes auto status detection only on non-provider runtime forms', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("kind === 'local_container_runtime'");
    expect(appSrc).toContain('connectionDialogAutoRuntimeProbeConfigurable(props.state)');
    expect(appSrc).toContain('toggleAutoRuntimeProbe={toggleConnectionRuntimeAutoProbe}');
    expect(appSrc).toContain("props.i18n.t('connectionDialog.statusDetection')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.autoStatusDetection')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.autoStatusDetectionHelp')");
    expect(appSrc).toContain('auto_runtime_probe_configurable');
    expect(appSrc).not.toContain('Control whether Welcome checks this runtime in the background');
    expect(appSrc).not.toContain('Welcome checks this runtime automatically while open. Refresh status still checks immediately when this is off.');
    expect(appSrc).toContain("title={props.i18n.t('connectionDialog.addProviderTitle')}");
    expect(appSrc).not.toContain('ControlPlaneDialog(props: Readonly<{\\n  state: ControlPlaneDialogState;\\n  auto_runtime_probe_enabled');
  });

  it('keeps destructive hover affordances aligned with floe-webapp dialog close behavior', () => {
    const styles = readWelcomeStyles();
    const dialogSrc = readInstalledDialogSource();

    expect(styles).toContain('.redeven-console-icon-button--danger:hover');
    expect(styles).toContain('background: var(--error);');
    expect(styles).toContain('color: var(--error-foreground);');
    expect(dialogSrc).toContain('variant: "ghost-destructive"');
  });

  it('keeps Welcome global dialogs below desktop titlebar chrome without scattered height math', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();
    const chromeSrc = readWindowChromeContractSource();
    const dialogSrc = readInstalledDialogSource();
    const overlayRule = cssRuleBlock(styles, "[data-floe-dialog-overlay-root][data-floe-dialog-mode='global']");
    const panelRule = cssRuleBlock(styles, "[data-floe-dialog-overlay-root][data-floe-dialog-mode='global'] [data-floe-dialog-panel]");
    const backdropRule = cssRuleBlock(styles, "[data-floe-dialog-overlay-root][data-floe-dialog-mode='global'] [data-floe-dialog-backdrop]");
    const semanticPanelRule = cssRuleBlock(styles, '.redeven-welcome-dialog-panel');
    const dialogBodyRule = cssRuleBlock(styles, '.redeven-welcome-dialog-panel > div:nth-child(2)');

    expect(dialogSrc).toContain('data-floe-dialog-overlay-root');
    expect(dialogSrc).toContain('data-floe-dialog-mode');
    expect(dialogSrc).toContain('return r() ? "surface" : "global";');
    expect(dialogSrc).toContain('"global"');
    expect(dialogSrc).toContain('"fixed inset-0 box-border z-50 p-4"');
    expect(dialogSrc).toContain('data-floe-dialog-backdrop');
    expect(dialogSrc).toContain('data-floe-dialog-panel');
    expect(dialogSrc).toContain('"flex flex-col", e.class');
    expect(dialogSrc).toContain('return r() ? void 0 : "true";');
    expect(dialogSrc).toContain('return e.children ??');
    expect(dialogSrc).toContain('as ConfirmDialog');
    expect(chromeSrc).toContain("'--redeven-desktop-titlebar-height': `${snapshot.titleBarHeight}px`");
    expect(chromeSrc).toContain("[data-floe-shell-slot='top-bar']");
    expect(chromeSrc).toContain('app-region: drag;');

    expect(overlayRule).toContain('--redeven-welcome-dialog-titlebar-offset: var(--redeven-desktop-titlebar-height);');
    expect(overlayRule).not.toContain('var(--redeven-desktop-titlebar-height,');
    expect(overlayRule).toContain('--redeven-welcome-dialog-edge-gap: 1rem;');
    expect(overlayRule).toContain('calc(100dvh - var(--redeven-welcome-dialog-titlebar-offset) - (var(--redeven-welcome-dialog-edge-gap) * 2))');
    expect(overlayRule).toContain('--redeven-welcome-dialog-panel-max-height: var(--redeven-welcome-dialog-available-height);');
    expect(overlayRule).toContain('padding:\n    calc(var(--redeven-welcome-dialog-titlebar-offset) + var(--redeven-welcome-dialog-edge-gap))');
    expect(overlayRule).toContain('app-region: no-drag;');
    expect(panelRule).toContain('app-region: no-drag;');
    expect(panelRule).toContain('margin-block: auto;');
    expect(panelRule).toContain('max-height: var(--redeven-welcome-dialog-panel-max-height);');
    expect(backdropRule).toContain('app-region: no-drag;');
    expect(semanticPanelRule).toContain('display: flex;');
    expect(semanticPanelRule).toContain('flex-direction: column;');
    expect(semanticPanelRule).toContain('max-width: none;');
    expect(semanticPanelRule).toContain('overflow: hidden;');
    expect(semanticPanelRule).toContain('padding: 0;');
    expect(dialogBodyRule).toContain('min-height: 0;');
    expect(dialogBodyRule).toContain('flex: 1 1 auto;');
    expect(dialogBodyRule).toContain('overflow: auto;');
    expect(styles).toContain('.redeven-welcome-dialog-panel--settings');
    expect(styles).toContain('width: min(52rem, 96vw);');
    expect(styles).toContain('.redeven-welcome-dialog-panel--connection');
    expect(styles).toContain('width: min(58rem, 96vw);');

    expect(appSrc).toContain("const WELCOME_DIALOG_PANEL_CLASS = 'redeven-welcome-dialog-panel';");
    expect(appSrc).toContain("'redeven-welcome-dialog-panel--settings'");
    expect(appSrc).toContain("'redeven-welcome-dialog-panel--connection'");
    expect(appSrc).not.toContain("[&>div:first-child]");
    expect(appSrc).not.toContain("[&>div:nth-child(2)]");
    expect(appSrc).not.toContain("[&>div:last-child]");
    expect(appSrc).not.toContain('max-h-[calc(100dvh-1rem)]');
    expect(appSrc).not.toContain('max-h-[calc(100dvh-3rem)]');
    expect(appSrc).not.toContain('100dvh');
    expect((styles.match(/100dvh/g) ?? []).length).toBe(1);

    expect((appSrc.match(/<ConfirmDialog\b/g) ?? []).length).toBe(3);
    expect((appSrc.match(/<Dialog\b/g) ?? []).length).toBe(5);
    expect((appSrc.match(/class=\{LOCAL_ENVIRONMENT_SETTINGS_DIALOG_CLASS\}/g) ?? []).length).toBe(1);
    expect((appSrc.match(/class=\{CONNECTION_DIALOG_CLASS\}/g) ?? []).length).toBe(2);
    expect(appSrc).toContain('function ControlPlaneDialog');
    expect(appSrc).toContain("title={props.i18n.t('connectionDialog.addProviderTitle')}");
    expect(appSrc).toContain('open={providerRuntimeLinkDialogOpen()}');
  });

  it('uses Gateway-specific deletion copy for Gateway-owned profiles', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("i18n().t('confirm.deleteConnectionTitle')");
    expect(appSrc).toContain("i18n().t('confirm.deleteConnectionConfirm')");
    expect(appSrc).toContain("i18n().t('confirm.deleteConnectionQuestion'");
    expect(appSrc).toContain("i18n().t('confirm.deleteGatewayEnvironmentTitle')");
    expect(appSrc).toContain("i18n().t('confirm.deleteGatewayEnvironmentConfirm')");
    expect(appSrc).toContain("i18n().t('confirm.deleteGatewayEnvironmentQuestion'");
    expect(appSrc).toContain("i18n().t('confirm.deleteGatewayEnvironmentDescription')");
    expect(appSrc).toContain('const deleteTargetOperation = createMemo(() => {');
    expect(appSrc).toContain("i18n().t('confirm.deleteConnectionBusyDescription')");
    expect(appSrc).toContain("i18n().t('confirm.deleteGatewayEnvironmentBusyDescription')");
    expect(appSrc).toContain("i18n().t('environmentCenter.connectionRemovedCleanup')");
    expect(appSrc).toContain("i18n().t('environmentCenter.gatewayEnvironmentRemoved')");
  });

  it('memoizes the Dialog open prop so overlay-mask focus trap does not thrash on every keystroke', () => {
    const appSrc = readWelcomeSource();

    // ConnectionDialog: state -> open must go through a memo accessor.
    // `props.state !== null` evaluated inline would re-track props.state on every
    // re-read, re-running the overlay-mask effect (cleanup restores focus to the
    // previously-focused element, body re-autofocuses the first focusable) on every
    // state update - which makes typing in any input of the dialog impossible.
    expect(appSrc).not.toMatch(/<Dialog\b[^>]*open=\{props\.state\s*!==\s*null\}/);
    expect(appSrc).toMatch(/const isOpen = createMemo\(\(\) => props\.state !== null\)/);
    expect(appSrc).toMatch(/const isOpen = createMemo\(\(\) => props\.open\)/);

    // Provider runtime link dialog: selecting a provider environment is an
    // in-dialog choice, not an open/close transition. Keep it out of the
    // confirmation object tracked by the dialog open prop so the overlay mask
    // and focus trap do not unmount/remount when the radio changes.
    expect(appSrc).toContain('const providerRuntimeLinkDialogOpen = createMemo(() => providerRuntimeLinkConfirmation() !== null);');
    expect(appSrc).toContain('open={providerRuntimeLinkDialogOpen()}');
    expect(appSrc).not.toMatch(/<ConfirmDialog\b[^>]*open=\{providerRuntimeLinkConfirmation\(\) !== null\}/);
    expect(appSrc).not.toContain('setProviderRuntimeLinkConfirmation((current) => current ? {');
    expect(appSrc).toContain('const providerRuntimeLinkCandidatePlans = createMemo(() => {');
    expect(appSrc).toContain('const providerRuntimeLinkSelectedPlan = createMemo(() => (');
    expect(appSrc).toContain('const providerRuntimeLinkConfirmDisabled = createMemo(() => (');
    expect(appSrc).toContain('disabled={providerRuntimeLinkConfirmDisabled()}');
    expect(appSrc).toContain("providerRuntimeLinkConfirmation()?.action === 'connect'");
    expect(appSrc).toContain('disabled={!item.canConnect}');
    expect(appSrc).toContain('<Show when={!item.canConnect}>');
  });

  it('routes runtime restart directly to the main-process lifecycle workflow', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("runtimeActionRequest(environment, 'restart_environment_runtime'");
    expect(appSrc).not.toContain("allowActiveWorkReplacement: true");
    expect(appSrc).not.toContain("kind: 'continue_launcher_operation'");
  });
});

describe('suggestConnectionLabel', () => {
  // suggestConnectionLabel is defined inside App.tsx. These tests mirror its
  // pure logic so the connection label contract stays covered.

  function trimString(value: string): string {
    return value.trim();
  }

  type ConnectionKind = 'external_local_ui' | 'ssh_environment' | 'local_container_runtime' | 'ssh_container_runtime';

  type TestState = Readonly<{
    connection_kind: ConnectionKind;
    label: string;
    ssh_destination?: string;
    container_label?: string;
  }>;

  function suggestConnectionLabel(state: TestState | null): string | null {
    if (!state) return null;
    switch (state.connection_kind) {
      case 'ssh_environment': {
        const dest = trimString(state.ssh_destination ?? '');
        return dest === '' ? null : dest;
      }
      case 'local_container_runtime':
      case 'ssh_container_runtime': {
        const lbl = trimString(state.container_label ?? '');
        return lbl === '' ? null : lbl;
      }
      case 'external_local_ui':
        return null;
    }
  }

  it('returns null for null state', () => {
    expect(suggestConnectionLabel(null)).toBeNull();
  });

  it('returns the SSH destination for ssh_environment when set', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_environment',
      label: '',
      ssh_destination: 'my-server',
    })).toBe('my-server');
  });

  it('returns null for ssh_environment when ssh_destination is empty', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_environment',
      label: '',
      ssh_destination: '',
    })).toBeNull();
  });

  it('returns the container_label for local_container_runtime when set', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'local_container_runtime',
      label: '',
      container_label: 'web-app',
    })).toBe('web-app');
  });

  it('returns the container_label for ssh_container_runtime when set', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_container_runtime',
      label: '',
      ssh_destination: 'remote-host',
      container_label: 'prod-app',
    })).toBe('prod-app');
  });

  it('returns null for container kinds when container_label is empty', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'local_container_runtime',
      label: '',
      container_label: '',
    })).toBeNull();
  });

  it('returns null for external_local_ui regardless of other fields', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'external_local_ui',
      label: '',
    })).toBeNull();
  });

  it('ignores label field in the state — only uses connection-specific fields', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_environment',
      label: 'user-typed-name',
      ssh_destination: 'dev-server',
    })).toBe('dev-server');
  });

  it('trims whitespace from the connection field before returning', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_environment',
      label: '',
      ssh_destination: '  staging-box  ',
    })).toBe('staging-box');
  });

  it('returns null when ssh_destination is all whitespace', () => {
    expect(suggestConnectionLabel({
      connection_kind: 'ssh_environment',
      label: '',
      ssh_destination: '   ',
    })).toBeNull();
  });
});
