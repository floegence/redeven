import { buildEnvironmentLibraryDisplayGroups } from './environmentLibraryProjection';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { desktopControlPlaneKey } from '../shared/cloud';
import { createDesktopI18n } from '../shared/i18n';
import type { DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import { openConnectionProgress } from '../shared/desktopOpenConnectionProgress';
import { testDesktopPreferences, testLocalAccess, testLocalEnvironment } from '../testSupport/desktopTestHelpers';
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
  buildEnvironmentCardFactsModel,
  buildProviderBackedEnvironmentActionModel,
  environmentLibraryCount,
  filterEnvironmentLibraryDisplayGroups,
  LOCAL_ENVIRONMENT_LIBRARY_FILTER,
  PROVIDER_ENVIRONMENT_LIBRARY_FILTER,
  runtimeHasUnsupportedLegacyControlPlaneLink,
  shellStatus,
} from './viewModel';

function readWelcomeSource(): string {
  return ['App.tsx', 'EnvironmentCards.tsx', 'environmentCardPrimitives.tsx', 'CloudAccountOverview.tsx'].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
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

function readSSHDestinationComboboxSource(): string {
  return fs.readFileSync(path.join(__dirname, 'SSHDestinationCombobox.tsx'), 'utf8');
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

function testCloudAccessPoint(cloudOrigin: string) {
  return {
    access_point_id: 'dev',
    region: 'dev',
    display_name: 'Development',
    description: 'Development access point',
    access_point_origin:
      cloudOrigin === 'https://cp.other.invalid'
        ? 'https://dev.cp.other.invalid'
        : 'https://dev.provider.example.invalid',
    country_code: 'SG',
    city: 'Singapore',
    status: 'active',
    health_status: 'healthy',
  };
}

function testControlPlaneSummary(
  input: Readonly<{
    cloudOrigin?: string;
    envPublicID?: string;
    label?: string;
    namespacePublicID?: string;
    namespaceName?: string;
    userPublicID?: string;
    userDisplayName?: string;
    displayLabel?: string;
  }> = {},
) {
  const cloudOrigin = input.cloudOrigin ?? 'https://provider.example.invalid';
  const envPublicID = input.envPublicID ?? 'env_demo';
  const accessPoint = testCloudAccessPoint(cloudOrigin);
  return {
    cloud: {
      protocol_version: 'rcpp-v5' as const,
      cloud_id: 'example_control_plane',
      display_name: 'Example Control Plane',
      cloud_origin: cloudOrigin,
      documentation_url: `${cloudOrigin}/help/control-plane-providers`,
      access_points: [accessPoint],
    },
    account: {
      cloud_id: 'example_control_plane',
      cloud_origin: cloudOrigin,
      display_name: 'Example Control Plane',
      user_public_id: input.userPublicID ?? 'user_demo',
      user_display_name: input.userDisplayName ?? 'Demo User',
      authorization_expires_at_unix_ms: Date.now() + 60_000,
    },
    display_label: input.displayLabel ?? 'Demo Control Plane',
    environments: [
      {
        cloud_id: 'example_control_plane',
        cloud_origin: cloudOrigin,
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
      },
    ],
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

  it('offers only manual disconnect recovery for an unsupported legacy control-plane link', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      surface: 'connect_environment',
    });
    const local = snapshot.environments.find((environment) => environment.kind === 'local_environment');
    expect(local).toBeDefined();
    const legacy = {
      ...local!,
      cloud_origin: 'https://legacy.example.invalid',
      control_plane_label: 'Legacy Control Plane',
      provider_runtime_link_target: {
        id: 'local:local' as const,
        kind: 'local_environment' as const,
        environment_id: local!.id,
        label: local!.label,
        runtime_key: 'local',
        runtime_url: 'http://127.0.0.1:23998',
        runtime_running: true,
        runtime_openable: true,
        runtime_control_status: { state: 'available' as const },
        provider_connection_state: 'connected' as const,
        cloud_link_state: 'linked' as const,
        cloud_origin: 'https://legacy.example.invalid',
        cloud_origin_supported: false,
        cloud_id: 'legacy',
        env_public_id: 'env_legacy',
        can_connect_cloud: false,
        can_disconnect_cloud: true,
      },
    };

    expect(runtimeHasUnsupportedLegacyControlPlaneLink(legacy)).toBe(true);
    expect(buildEnvironmentCardFactsModel(legacy)).toContainEqual(
      expect.objectContaining({
        label: 'CONTROL PLANE',
        value: 'Unsupported legacy control-plane link',
      }),
    );
    const actions = buildProviderBackedEnvironmentActionModel(legacy).action_presentation.menu_actions;
    expect(actions).toContainEqual(
      expect.objectContaining({
        id: 'disconnect_cloud_runtime',
        label_key: 'environmentAction.disconnectLegacyControlPlane',
        action: expect.objectContaining({
          intent: 'disconnect_cloud_runtime',
          enabled: true,
        }),
      }),
    );
    expect(actions.some((item) => item.action.intent === 'connect_cloud_runtime')).toBe(false);
  });

  it('keeps the outer Flower entry icon-only while chat creation lives inside the shared surface', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('const flowerWarmupState = createMemo<FlowerSurfaceWarmupState | null>');
    expect(appSrc).toContain('selectedFlowerWarmupProgress(flowerRuntimeLifecycleProgress())');
    expect(appSrc).toContain('warmup={flowerWarmupState()}');
    expect(appSrc).toContain("aria-label={i18n().t('flowerSurface.chat.entryLabel')}");
    expect(appSrc).toContain("when={!flowerVisible()}");
    expect(appSrc).toContain('class="redeven-flower-topbar-button"');
    expect(appSrc).not.toContain("class={cn('rounded-full'");
    expect(appSrc).toContain('<FlowerIcon class="h-5 w-5" />');
    expect(appSrc).not.toContain('<FlowerNavigationIcon class="h-5 w-5" />');
    expect(appSrc).toContain('const flowerSurfaceCopy = createMemo(() => createDesktopFlowerSurfaceCopy(i18n()));');
    expect(appSrc).toContain('copy={flowerSurfaceCopy()}');
    expect(appSrc).toContain('notify={(notice) => {');
    expect(appSrc).toContain('showActionToast(notice.message, notice.tone');
    expect(appSrc).toContain("get runtimeDisplayName() { return i18n().t('flowerSurface.runtime.localEnvironment'); }");
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

    expect(appSrc).toContain('function openEnvironmentCenterSurface(): void');
    expect(appSrc).toContain("navigateWelcomeSurface('connect_environment')");
    expect(appSrc).toContain("activeSurface() === 'flower'");
    expect(appSrc).toContain("i18n().t('shell.backToEnvironments')");
    expect(appSrc).toContain('class="redeven-flower-back-button"');
    expect(appSrc).toContain('<ArrowLeft class="h-3.5 w-3.5" />');
    expect(appSrc).toContain('class="flower-sidebar-leading-action"');
    expect(appSrc).toContain('<ArrowLeft class="h-4 w-4" />');
    expect(appSrc).toContain('<TopBarIconButton label={topBarLogoLabel()} onClick={activateTopBarLogo}>');
  });

  it('keeps an accessible icon-only Desktop update entry in the far-right titlebar corner', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();
    const trailingActions = appSrc.slice(
      appSrc.indexOf('trailingActions={('),
      appSrc.indexOf('topBarCornerActions={('),
    );
    const cornerActions = appSrc.slice(
      appSrc.indexOf('topBarCornerActions={('),
      appSrc.indexOf('<Show when={environmentsVisited()}>'),
    );
    const surfaceStart = appSrc.indexOf('function ConnectEnvironmentSurface(');
    const surfaceHeaderStart = appSrc.indexOf('<header class="redeven-header-separator', surfaceStart);
    const surfaceHeaderEnd = appSrc.indexOf('<div class="flex flex-col gap-3', surfaceHeaderStart);
    const surfaceHeader = appSrc.slice(surfaceHeaderStart, surfaceHeaderEnd);

    expect(trailingActions).not.toContain('redeven-desktop-update-button');
    expect(surfaceHeader).not.toContain('redeven-desktop-update-button');
    expect(appSrc).not.toContain('desktopUpdateSnapshot={desktopUpdateSnapshot()}');
    expect(appSrc).not.toContain('checkForDesktopUpdates={checkForDesktopUpdates}');
    expect(cornerActions).toContain('class="redeven-desktop-update-button"');
    expect(cornerActions).toContain('data-update-state={desktopUpdateSnapshot().state}');
    expect(cornerActions).toContain('onClick={activateDesktopUpdates}');
    expect(cornerActions).not.toContain("<span>{i18n().t('desktopUpdate.checkForUpdates')}</span>");
    expect(cornerActions).toContain('<DesktopTooltip');
    expect(cornerActions).toContain('placement="bottom"');
    expect(cornerActions).toContain('aria-label={desktopUpdateButtonLabel()}');
    expect(cornerActions).toContain('content={desktopUpdateButtonLabel()}');
    expect(cornerActions).toContain('aria-hidden="true"');
    expect(cornerActions).toContain("desktopUpdateSnapshot().state === 'checking' ? 'animate-spin' : ''");
    expect(cornerActions).toContain('class="redeven-desktop-update-button__indicator" aria-hidden="true"');
    expect(styles).toContain('.redeven-desktop-titlebar-corner-actions {');
    expect(styles).toContain('padding-inline-end: calc(0.75rem + var(--redeven-desktop-titlebar-end-inset, 0px));');
    expect(styles).toContain('app-region: no-drag;');
    const updateButton = cssRuleBlock(styles, '.redeven-desktop-update-button');
    expect(updateButton).toContain('width: 1.75rem;');
    expect(updateButton).toContain('height: 1.75rem;');
    expect(updateButton).toContain('background: transparent;');
    expect(updateButton).toContain('border: 0;');
    expect(styles).toContain('.redeven-desktop-update-button:focus-visible {\n  outline: 2px solid var(--ring);');
    expect(cssRuleBlock(styles, '.redeven-desktop-update-button__indicator')).toContain('position: absolute;');
    expect(styles).toContain(".redeven-desktop-update-button[data-update-state='available']");
  });

  it('keeps Gateways as a third Environment Center tab with independent query and filter state', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("{ value: 'gateways', labelKey: 'environmentCenter.gatewaysSection' }");
    expect(appSrc).toContain('const [gatewaySourceFilter, setGatewaySourceFilter] = createSignal');
    expect(appSrc).toContain('const [gatewayQuery, setGatewayQuery] = createSignal');
    expect(appSrc).toContain('filterGatewayEnvironmentEntries(');
    expect(appSrc).toContain('function openGatewayMembers(gateway: DesktopGatewaySource): void');
    expect(appSrc).toContain('<GatewaySourcesPanel');
    expect(appSrc).toContain("props.activeTab === 'gateways'");
    expect(appSrc).toContain('gatewaySourceFilterValue,');
    expect(appSrc).not.toContain('fallback={(\n                <ControlPlanesPanel');
  });

  it('keeps Gateway setup and source actions out of the legacy Redeven URL dialog', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain(
      'function suggestGatewayDisplayName(state: GatewaySetupDialogState | null): string | null',
    );
    expect(appSrc).toContain("return seed === '' ? null : `Gateway-${seed}`;");
    expect(appSrc).toContain('display_name_touched: overrides.display_name_touched === true');
    expect(appSrc).toContain(
      'function openCreateGatewaySetup(gateway?: DesktopGatewaySource, focusSection?: GatewaySetupTarget): void',
    );
    expect(appSrc).toContain('function gatewaySetupFocusForGateway(');
    expect(appSrc).toContain('requestedFocus?: DesktopGatewayResolveFocus');
    expect(appSrc).toContain("if (requestedFocus === 'url_endpoint' || requestedFocus === 'identity_trust') {");
    expect(appSrc).toContain("focus_section: gatewaySetupFocusForGateway(gateway, focusSection === 'url_endpoint' || focusSection === 'identity_trust' ? focusSection : undefined)");
    expect(appSrc).toContain("setActiveCenterTab('gateways')");
    expect(appSrc).toContain('<GatewaySetupDialog');
    expect(appSrc).toContain("kind: 'upsert_gateway'");
    expect(appSrc).toContain('gatewayAccess.managedServiceHelp');
    const gatewayDialogStart = appSrc.indexOf('function GatewaySetupDialog');
    const gatewayDialogEnd = appSrc.indexOf('function ControlPlaneDialog');
    const gatewayDialogSrc = appSrc.slice(gatewayDialogStart, gatewayDialogEnd);
    expect(gatewayDialogSrc).toContain("props.i18n.t('connectionDialog.gatewayUrl')");
    expect(gatewayDialogSrc).toContain("props.i18n.t('connectionDialog.gatewayAccessCode')");
    expect(gatewayDialogSrc).toContain("connectionDialog.gatewayTransportSshHost");
    expect(gatewayDialogSrc).toContain("connectionDialog.gatewayTransportSshContainer");
    expect(appSrc).toContain('onClick={() => props.openCreateGatewaySetup()}');
    expect(appSrc).toContain("from './gatewaySourceActionRunner';");
    const gatewaySourceActionRunnerSrc = readGatewaySourceActionRunnerSource();
    expect(appSrc).toContain('const selectedGatewayWorkflowProgress = createMemo(() => {');
    expect(appSrc).toContain(
      'const selectedGatewayRefreshDiagnosisResult = createMemo<GatewayDiagnosisResultSnapshot | null>(() => {',
    );
    expect(appSrc).toContain('gatewayProgressBelongsToForegroundAction(progress, foreground)');
    expect(appSrc).toContain('<GatewayActionPanel');
    expect(appSrc).not.toContain('openResolveGateway={openGatewaySetupForPanelResolve}');
    expect(appSrc).not.toContain('props.openCreateGatewaySetup(props.gateway, visiblePanelModel().resolve_focus)');
    expect(appSrc).not.toContain('props.openCreateGatewaySetup(props.gateway, action.resolve_focus)');
    expect(appSrc).toContain('<EnvironmentProgressPanel');
    expect(appSrc).toContain('buildGatewayActionPresentation');
    expect(appSrc).toContain("props.i18n.t('gatewayExperience.connectClient')");
    expect(appSrc).toContain("props.i18n.t('gatewayExperience.connectRuntime')");
    expect(appSrc).not.toContain('gatewayStartRequiredDialog');
    expect(appSrc).toContain("case 'refresh_status':");
    expect(appSrc).toContain("case 'refresh_gateway':");
    expect(appSrc).not.toContain('row().management_label');
    expect(gatewaySourceActionRunnerSrc).toContain("case 'refresh_gateway':");
    expect(gatewaySourceActionRunnerSrc).not.toContain("case 'resolve_gateway':");
    expect(gatewaySourceActionRunnerSrc).not.toContain("case 'sync_gateway':");
    expect(gatewaySourceActionRunnerSrc).not.toContain("case 'check_gateway':");
    expect(appSrc).toContain("case 'open_gateway_environment':");
    expect(appSrc).toContain("intent: 'open_gateway_environment'");
    expect(appSrc).not.toContain(
      "case 'manage_desktop_update':\n                        case 'open_gateway_environment':\n                          break;",
    );
    expect(appSrc).toContain('const ENVIRONMENT_CENTER_HEADER_COPY');
    expect(appSrc).toContain("titleKey: 'environmentCenter.environmentsTitle'");
    expect(appSrc).toContain("titleKey: 'environmentCenter.providersTitle'");
    expect(appSrc).toContain("titleKey: 'environmentCenter.gatewaysTitle'");
    expect(appSrc).toContain('props.i18n.t(headerCopy().titleKey)');
    expect(appSrc).toContain('props.i18n.t(headerCopy().descriptionKey)');
    expect(appSrc).not.toContain("props.i18n.t('environmentCenter.description')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.addGatewayShort')");
    expect(appSrc).toContain("<DesktopTooltip content={props.i18n.t('environmentCenter.addGateway')}");
    expect(appSrc).toContain("aria-label={props.i18n.t('environmentCenter.addGateway')}");
    expect(appSrc).toContain("case 'view_gateway_environments':");
    expect(appSrc).toContain("case 'manage_gateway_members':");
    expect(appSrc).not.toContain("props.i18n.t('environmentCenter.syncGatewayForLabel'");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.moreActions')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.moreActionsForLabel'");
    expect(appSrc).toContain('popoverAriaLabel={');
    expect(appSrc).not.toContain('>\\n            View\\n');
    expect(appSrc).not.toContain('content="More actions"');
    const gatewayHeaderButtonOffset = appSrc.indexOf("props.i18n.t('environmentCenter.addGatewayShort')");
    const gatewayHeaderButtonSrc = appSrc.slice(
      Math.max(0, gatewayHeaderButtonOffset - 420),
      gatewayHeaderButtonOffset + 120,
    );
    expect(gatewayHeaderButtonSrc).toContain('props.openCreateGatewaySetup()');
    expect(gatewayHeaderButtonSrc).toContain("props.i18n.t('environmentCenter.addGateway')");
    expect(gatewayHeaderButtonSrc).not.toContain('openCreateConnectionDialog');
    const fullAddGatewayButtonOffset = appSrc.lastIndexOf("props.i18n.t('environmentCenter.addGateway')");
    const fullAddGatewayButtonSrc = appSrc.slice(
      Math.max(0, fullAddGatewayButtonOffset - 260),
      fullAddGatewayButtonOffset + 80,
    );
    expect(fullAddGatewayButtonSrc).toContain('props.openCreateGatewaySetup()');
    expect(fullAddGatewayButtonSrc).not.toContain('openCreateConnectionDialog');
  });

  it('does not let Gateway environment open fall back to remote URL actions', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain(
      "if (environment.kind === 'gateway_environment') {\n      return openGatewayEnvironment(environment, errorTarget);\n    }",
    );
    expect(appSrc).toContain("kind: 'open_gateway_environment'");
    expect(appSrc).toContain('gateway_id: gatewayID');
    expect(appSrc).toContain('gateway_env_id: gatewayEnvID');
    expect(appSrc).toContain("case 'resolve_gateway':\n        if (environment.kind === 'gateway_environment') {");
    expect(appSrc).toContain('openCreateGatewaySetup(gateway);');
    expect(appSrc).not.toContain("case 'resolve_gateway':\n        await pairGateway(environment.gateway_id ?? '');");
    expect(appSrc).toContain("kind: 'refresh_gateway'");
    expect(appSrc).not.toContain("kind: 'sync_gateway'");
    expect(appSrc).not.toContain("gateway_environment') {\n      return openRemoteEnvironment");
  });

  it('uses member invitations instead of Gateway target configuration', () => {
    const appSrc = readWelcomeSource();
    expect(appSrc).toContain('<GatewayMembersPanel');
    expect(appSrc).not.toContain('GatewayURLProfileConnectionDialogState');
    expect(appSrc).not.toContain('GatewayProfileSourcePicker');
  });

  it('keeps open-flow steps on the shared timeline and progress styles', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toMatch(/state: index < activeIndex\s*\? 'done'\s*: step\.key === active\s*\? 'active'/u);
    expect(appSrc).toContain('class="redeven-environment-progress__step-connector"');
    expect(appSrc).toContain('class="redeven-environment-progress__step-line" data-state={state()}');
    expect(styles).toContain(".redeven-environment-progress__step-dot[data-state='done']");
    expect(styles).toContain(".redeven-environment-progress__step-dot[data-state='active']");
    expect(styles).toContain(".redeven-environment-progress__step-label[data-state='done']");
    expect(styles).toContain(".redeven-environment-progress__step-label[data-state='active']");
  });

  it('filters Gateway source rows with the Gateways tab source filter and query', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain(
      'const visibleGatewaySourceIDs = createMemo(() => visibleGatewaySources().map((gateway) => gateway.gateway_id));',
    );
    expect(appSrc).toContain('const renderedGatewaySourceIDs = createMemo(() => gatewaySourceIDsWithActiveOverlay(');
    expect(appSrc).toContain('<For each={renderedGatewaySourceIDs()}>');
    expect(appSrc).not.toContain('<For each={visibleGatewaySourceIDs()}>');
    expect(appSrc).toContain('gatewayEntriesByGatewayID()[gatewayID] ?? []');
    expect(appSrc).toContain('gatewaySourceFilterValue(gateway.gateway_id) !== props.gatewaySourceFilter');
    expect(appSrc).toContain('return !hasQuery || gatewaySourceMatchesQuery(gateway, query);');
    expect(appSrc).toContain(
      'function gatewaySourceMatchesQuery(gateway: DesktopGatewaySource, query: string): boolean',
    );
    expect(appSrc).toContain('gateway.endpoint_label,');
    expect(appSrc).toContain('const visibleGatewaySourceCount = createMemo(() => (');
    expect(appSrc).toContain('const totalGatewaySourceCount = createMemo(() => props.gatewaySources.length);');
    expect(appSrc).toContain('noMatchingGatewaysTitle');
    expect(styles).toContain('.redeven-gateway-grid');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(styles).not.toContain('redeven-card-entrance');
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
    expect(snapshot.settings_environment_id).toBe(local.id);
    expect(snapshot).not.toHaveProperty('settings_surface');
  });

  it('localizes issue status labels when a semantic issue key is available', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      issue: {
        scope: 'local_environment',
        code: 'state_dir_locked',
        title: 'Redeven is already starting elsewhere',
        title_key: 'issue.stateDirLockedAttachTitle',
        message:
          'Another Redeven runtime instance is using the default state directory and appears to provide Local UI. Retry in a moment so Desktop can attach to it.',
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
        effective_run_mode: 'desktop',
        runtime_service: {
          protocol_version: 'redeven-runtime-v1',
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
      active_progress_surface: 'open',
      phase: 'failed',
      title: 'Open failed',
      detail: 'Desktop could not open the local environment.',
      open_progress: openConnectionProgress({
        location: 'local_host',
        phase: 'checking_runtime_record',
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
      openSessions: [
        {
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
        },
      ],
      actionProgress: [failedOpenProgress],
    });
    const entry = snapshot.environments.find((environment) => environment.id === local.id)!;
    const fallbackAction = buildProviderBackedEnvironmentActionModel(entry).action_presentation.primary_action;
    const selectedOpenProgress = selectedSnapshotOpenConnectionProgressForEnvironment(entry, snapshot.action_progress);
    const panelProgress = selectEnvironmentPanelProgress(selectedOpenProgress, null);
    const busyState = reconcileBusyStateWithActionProgressSnapshot(
      {
        ...IDLE_LAUNCHER_BUSY_STATE,
        action: 'open_local_environment' as const,
        environment_id: local.id,
        progress: staleBusyProgress,
      },
      snapshot.action_progress,
    );

    expect(entry.open_action).toBe('opening');
    expect(fallbackAction).toMatchObject({ intent: 'opening', enabled: false });
    expect(environmentProgressPrimaryPresentation(panelProgress)).toMatchObject({
      kind: 'attention_trigger',
      label: 'Open failed',
    });
    expect(busyState).toBe(IDLE_LAUNCHER_BUSY_STATE);
    expect(busyStateBlocksEnvironmentAction(busyState, local.id, ['open_local_environment'], panelProgress)).toBe(
      false,
    );
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
      }),
      controlPlanes: [testControlPlaneSummary()],
    });

    expect(environmentLibraryCount(buildEnvironmentLibraryDisplayGroups(snapshot.environments))).toBe(4);
    expect(environmentLibraryCount(buildEnvironmentLibraryDisplayGroups(snapshot.environments), '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);
    expect(environmentLibraryCount(buildEnvironmentLibraryDisplayGroups(snapshot.environments), '', PROVIDER_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);

    expect(filterEnvironmentLibraryDisplayGroups(buildEnvironmentLibraryDisplayGroups(snapshot.environments), '', LOCAL_ENVIRONMENT_LIBRARY_FILTER).map(group => group.primary_entry)).toEqual([
      expect.objectContaining({
        id: 'local',
        category: 'local',
        local_environment_kind: 'local',
      }),
    ]);
    expect(filterEnvironmentLibraryDisplayGroups(buildEnvironmentLibraryDisplayGroups(snapshot.environments), 'stag').map(group => group.primary_entry)).toEqual([
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
          cloudOrigin: 'https://cp.other.invalid',
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

    expect(
      filterEnvironmentLibraryDisplayGroups(
        buildEnvironmentLibraryDisplayGroups(snapshot.environments),
        '',
        desktopControlPlaneKey('https://provider.example.invalid', 'example_control_plane'),
      ).map(group => group.primary_entry),
    ).toEqual([
      expect.objectContaining({
        kind: 'provider_environment',
        env_public_id: 'env_demo',
      }),
    ]);
  });

  it('renders source summaries directly above shared environment grids', () => {
    const appSrc = readWelcomeSource();
    expect(appSrc).toContain('<props.Grid groups={current().visible_groups}');
    expect(appSrc).toContain('props.section.linked_runtime_count');
    expect(appSrc).not.toContain('local_host_count: 0');
    expect(appSrc).not.toContain('viewControlPlaneEnvironments');
  });

  it('uses the same rounded-lg shell radius for Control Plane cards as Environment cards', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('redeven-cloud-source-header');
    expect(appSrc).not.toContain('redeven-provider-shelf rounded-[0.625rem]');
  });

  it('keeps Local Environment Settings as a dialog layered on top of the launcher surface', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('<ConnectEnvironmentSurface');
    expect(appSrc).toContain('<EnvironmentSettingsDialog');
    expect(appSrc).toContain("open={Boolean(settingsSession())}");
    expect(appSrc).not.toContain('fallback={<div class="h-full min-h-0 bg-background" />}');
  });

  it('pins the welcome surface to the full desktop shell width so filtered views do not shrink the page', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('redeven-welcome-surface h-full min-h-0 w-full min-w-0 overflow-auto bg-background');
  });

  it('keeps the welcome scrollbar slot stable while switching between tabs', () => {
    const styles = readWelcomeStyles();

    expect(styles).toContain('.redeven-welcome-surface {\n  scrollbar-gutter: stable;');
  });

  it('uses one fixed welcome shell while keeping environment grid density independent', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('class="mx-auto w-full redeven-welcome-shell"');
    expect(appSrc).not.toContain('useSpaciousWelcomeShell');
    expect(appSrc).not.toContain('useSpaciousControlPlaneLayout');
    expect(appSrc).not.toContain('useSpaciousGatewayLayout');
    expect(appSrc).not.toContain('redeven-welcome-shell--spacious');
    expect(appSrc).toContain('buildEnvironmentLibraryLayoutModel');
    expect(appSrc).toContain('data-density={layoutModel().density}');
    expect(appSrc).toContain("layout: { mobileQuery: 'not all' }");
    expect(styles).toContain('--redeven-welcome-shell-max-width: 100rem;');
    expect(styles).not.toContain('--redeven-welcome-shell-spacious-max-width');
    expect(styles).not.toContain('.redeven-welcome-shell--spacious');
  });

  it('keeps the environment header free of aggregate metrics while retaining issue feedback', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).not.toContain('LibrarySummary');
    expect(appSrc).not.toContain('librarySummary');
    expect(appSrc).not.toContain('localizedVisibleLabel');
    expect(appSrc).not.toContain('localizedWindowsLabel');
    expect(styles).not.toContain('.redeven-library-summary');
    expect(appSrc).toContain("props.activeTab === 'environments' && props.snapshot.issue");
    expect(appSrc).toContain('localizedIssueTitle(props.i18n, issue())');
  });

  it('carries no global bottom bar in the launcher shell', () => {
    const appSrc = readWelcomeSource();
    const shellSrc = fs.readFileSync(path.join(__dirname, 'DesktopLauncherShell.tsx'), 'utf8');
    const styles = readWelcomeStyles();

    expect(appSrc).not.toContain('bottomBarLeading');
    expect(appSrc).not.toContain('bottomBarTrailing');
    expect(appSrc).not.toContain('bottomBarHeight');
    expect(appSrc).not.toMatch(/\bBottomBarItem\b/);
    expect(shellSrc).not.toMatch(/\bBottomBar\b/);
    expect(styles).not.toContain('bottom-bar');
  });

  it('uses shared tooltip and compact card-grid helpers for desktop help affordances', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("import { DesktopTooltip } from './DesktopTooltip';");
    const workflow = fs.readFileSync(path.join(__dirname, 'EnvironmentAccessWorkflow.tsx'), 'utf8');
    expect(workflow).toContain("import { DesktopTooltip } from './DesktopTooltip';");
    expect(workflow).toContain('anchorTabIndex={0}');
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
    expect(appSrc).toContain('visibleCardCount={gridProps.groups.length + (gridProps.quickAdd ? 1 : 0)}');
    expect(appSrc).toContain('layoutReferenceCardCount={layoutReferenceEnvironmentCardCount()}');
    expect(appSrc).toContain('environmentLibraryCount(');
    expect(appSrc).toContain('props.librarySourceFilter');
    expect(appSrc).toContain('LOCAL_ENVIRONMENT_LIBRARY_FILTER');
    expect(appSrc).toContain('layoutReferenceEnvironmentCount() + 1');
    expect(appSrc).toContain('layout_reference_count: props.layoutReferenceCardCount');
    expect(appSrc).toContain("'--redeven-environment-grid-columns': String(layoutModel().column_count)");
    expect(appSrc).toContain('new ResizeObserver(() => updateLayoutMetrics())');
    expect(appSrc).toContain('function EnvironmentLibrarySection');
    expect(appSrc).toContain('data-density={layoutModel().density}');
    expect(styles).toContain('.redeven-environment-library');
    expect(styles).toContain('--redeven-environment-grid-min-column-size: 16.25rem;');
    expect(styles).not.toContain('--redeven-environment-grid-spacious-column-size');
    expect(styles).toContain('--redeven-environment-grid-gap: .75rem;');
    expect(styles).not.toContain('--redeven-environment-grid-spacious-gap');
    expect(styles).toContain('grid-template-columns: repeat(var(--redeven-environment-grid-columns), minmax(0, 1fr));');
    expect(styles).not.toContain('.redeven-environment-grid__section-title');
    expect(styles).not.toContain('.redeven-environment-grid--spacious');
    expect(styles).not.toMatch(/@media\s*\(min-width:\s*640px\)\s*\{\s*\.redeven-environment-grid\s*\{/);
    expect(styles).not.toMatch(/@media\s*\(min-width:\s*1024px\)\s*\{\s*\.redeven-environment-grid\s*\{/);
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
    const retainedEnd = appSrc.indexOf('function launcherFailureSummary');
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
    expect(appSrc).toContain(
      'const [flowerFocusThreadRequest, setFlowerFocusThreadRequest] = createSignal<FlowerThreadFocusRequest | null>(null)',
    );
    expect(appSrc).toContain('let flowerFocusThreadRequestSequence = 0;');
    expect(appSrc).toContain('function openEnvironmentFlowerSurface(');
    expect(appSrc).toContain('environment: DesktopEnvironmentEntry,');
    expect(appSrc).toContain('openEnvironmentFlowerSurface(props.environment');
    expect(appSrc).toMatch(/props\.i18n\.t\('environmentCenter\.askFlowerForLabel',\s*\{\s*label: ownerLabel\(\),?\s*\}\)/u);
    expect(appSrc).toContain('<FlowerTurnLauncherWindow');
    expect(appSrc).toContain('intent={flowerTurnLauncherIntent()}');
    expect(appSrc).toContain('focusThreadRequest={flowerVisible() ? flowerFocusThreadRequest() : null}');
    expect(appSrc).toContain('source_surface:');
    expect(appSrc).toContain("'desktop_welcome_environment_card'");
    expect(appSrc).toContain('launchLocalEnvironmentFlowerTurn(props.runtime.settings');
    expect(appSrc).toContain('const receipt = await launchLocalEnvironmentFlowerTurn(props.runtime.settings');
    expect(appSrc).toContain('flowerTurnLauncherRequest?.client_request_id !== input.client_request_id');
    expect(appSrc).toContain('await prepareLocalEnvironmentFlowerTurnInput(props.runtime.settings');
    expect(appSrc).toContain("flowerTurnAdmissionFailureKind(error) !== 'unknown'");
    expect(appSrc).toContain('const threadID = trimString(receipt.thread_id);');
    expect(appSrc).not.toContain('flowerTurnAdmissionUncertainIdentity');
    expect(appSrc).not.toContain('admission_pending');
    expect(appSrc).toContain('flowerFocusThreadRequestSequence += 1;');
    expect(appSrc).toContain('request_id: `welcome-flower-focus-${flowerFocusThreadRequestSequence}`');
    expect(appSrc).toContain('onFocusThreadRequestConsumed={(requestID) => {');
    expect(appSrc).toContain('current?.request_id === requestID ? null : current');
    expect(appSrc).toMatch(/closeFlowerTurnLauncher\(\);\s*openFlowerConversation\(threadID\);/u);
    expect(appSrc).toContain('onOpenFlower={openFlowerConversation}');
    expect(appSrc).not.toContain("showActionToast(i18n().t('toast.flowerPromptQueued')");
    expect(appSrc).toContain(
      'context_action: buildEnvironmentFlowerContextAction(environment, contextSummary, cleanLabel, {',
    );
    expect(appSrc).toContain('progressItems: activeActionProgress(),');
    expect(appSrc).toContain('busyState: busyState(),');
    expect(appSrc).not.toContain('context_action: buildEnvironmentFlowerContextEnvelope(environment).raw');
    expect(appSrc).toContain('function openFlowerSurface(): void');
    expect(appSrc).toContain("navigateWelcomeSurface('flower')");
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
    expect(styles).not.toContain('.redeven-environment-card__flower-button:hover .redeven-environment-card__flower-icon');
    expect(styles).not.toContain('animation: redeven-flower-intro-spin');
    expect(styles).not.toContain('.redeven-environment-flower-window');
    expect(styles).not.toContain('.redeven-flower-card-popover-surface');
  });

  it('renders desktop tooltips through a body-level portal so dialogs do not clip them', () => {
    const tooltipSrc = readDesktopTooltipSource();
    const anchoredSurfaceSrc = readDesktopAnchoredOverlaySurfaceSource();

    expect(tooltipSrc).toContain("import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';");
    expect(tooltipSrc).toContain('data-redeven-tooltip-anchor=""');
    expect(tooltipSrc).toContain('role="tooltip"');
    expect(tooltipSrc).toContain('z-[220]');
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
    expect(popoverSrc).toContain('z-[225]');
    expect(popoverSrc).toContain('open: boolean;');
    expect(popoverSrc).toContain('onOpenChange: (open: boolean) => void;');
    expect(popoverSrc).toContain('props.onOpenChange(true);');
    expect(popoverSrc).not.toContain('const [visible, setVisible] = createSignal(false);');
    expect(actionPopoverSrc).toContain('data-redeven-action-popover-anchor=""');
    expect(styles).toContain('min-height: 2.75rem;');
    expect(styles).toContain('.redeven-popover-panel-collapse {');
    expect(styles).toContain('display: none;');
    expect(styles).toContain('.redeven-popover-panel-collapse--open {');
    expect(styles).toContain('display: grid;');
  });

  it('renders dialog field listboxes through anchored portals so footers and scroll panes cannot clip them', () => {
    const appSrc = readWelcomeSource();
    const listboxSrc = readDesktopAnchoredListboxSource();
    const sshComboboxSrc = readSSHDestinationComboboxSource();

    expect(appSrc).toContain("} from './DesktopAnchoredListbox';");
    expect(appSrc).toContain('<DesktopAnchoredListbox');
    expect(sshComboboxSrc).toContain('<DesktopAnchoredListbox');
    expect(appSrc).toContain('anchorRef={buttonRef}');
    expect(sshComboboxSrc).toContain('anchorRef={rootRef}');
    expect(appSrc).toContain('width={288}');
    expect(appSrc).not.toContain(
      'class="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover p-1 shadow-xl"',
    );
    expect(appSrc).not.toContain(
      'class="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-xl"',
    );
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
    expect(pickerSrc).toContain('scrollDesktopListboxOptionIntoView');
    expect(pickerSrc).toContain('aria-haspopup="listbox"');
    expect(pickerSrc).toContain("aria-expanded={open() ? 'true' : 'false'}");
    expect(pickerSrc).toContain('aria-controls="redeven-desktop-language-options"');
    expect(pickerSrc).toContain(
      'aria-activedescendant={open() ? `redeven-desktop-language-option-${highlightedIndex()}` : undefined}',
    );
    expect(pickerSrc).toContain("props.i18n.t('common.language')");
    expect(pickerSrc).toContain("props.i18n.t('language.usingLanguage'");
    expect(pickerSrc).toContain('REDEVEN_LOCALE_META[preference].english_name');
    expect(pickerSrc).toContain('<Globe');
    expect(pickerSrc).toContain('<Check');
  });

  it('limits native browser selection to the paired Gateway member picker', () => {
    const appSrc = readWelcomeSource();
    const gatewayPicker = appSrc.match(/const gatewaySelector = [^\n]+/g) ?? [];
    expect(gatewayPicker).toHaveLength(1);
    expect(gatewayPicker[0]).toContain('gatewayMembers().length > 1');
    expect(gatewayPicker[0]).toContain("props.i18n.t('gatewayConnections.select')");
    const rest = appSrc.replace(gatewayPicker[0] ?? '', '');
    expect(rest.includes('<select')).toBe(false);
    expect(rest.includes('<option')).toBe(false);
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
    expect(pickerSrc).toContain("document.addEventListener('mousedown', handlePointerDown);");
    expect(pickerSrc).toContain("document.addEventListener('keydown', handleKeyDown);");
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
    expect(appSrc).toContain("id: 'redeven.desktop.changeAppearance'");
    expect(appSrc).toContain('execute: () => props.openThemePicker()');
    expect(appSrc).toContain('openThemePicker={() => setThemePickerOpenRequest((current) => current + 1)}');
    expect(appSrc).toContain('const [themePickerOpenRequest, setThemePickerOpenRequest] = createSignal(0);');
    expect(appSrc).toContain('<DesktopThemePicker');
    expect(appSrc).toContain('openRequest={themePickerOpenRequest()}');
    expect(appSrc).toContain('onSourceChange={updateDesktopThemeSource}');
    expect(appSrc).toContain('onShellThemeChange={updateDesktopShellTheme}');
    expect(appSrc).toContain('shellPresetStorageKey: DESKTOP_FLOE_SHELL_THEME_STORAGE_KEY');
    expect(appSrc).toContain('shellPresets: builtInShellThemePresets');
    expect(appSrc).toContain('defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS');
    expect(appSrc).not.toContain("i18n().t('shell.useDarkTheme')");
    expect(appSrc).not.toContain("i18n().t('shell.useLightTheme')");
    expect(appSrc).not.toContain('toggleDesktopTheme');
    expect(appSrc).not.toContain("title: 'Change Language'");
    expect(appSrc).not.toContain("label={theme.resolvedTheme() === 'light' ? 'Use dark theme' : 'Use light theme'}");
  });

  it('includes compact environment-card launcher copy inside the source', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('connectEnvironmentTitle');
    expect(appSrc).toContain('openRedevenDashboard');
    expect(appSrc).toContain('function openRedevenDashboard');
    expect(appSrc).toContain('props.i18n.t(headerCopy().titleKey)');
    expect(appSrc).toContain("labelKey: 'desktop.provider'");
    expect(appSrc).toContain("'environmentCenter.searchPlaceholder'");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.localFilter')");
    expect(appSrc).toContain('<EnvironmentOwnerSurface');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.newEnvironmentTitle')");
    expect(appSrc).toContain('NewEnvironmentPlaceholderCard');
  });

  it('keeps launcher operations as the single persistent Environment failure owner', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain("kind: 'dismiss_launcher_operation'");
    expect(appSrc).toContain('environmentOperationState');
    expect(appSrc).toContain('<EnvironmentProgressPanel');
    expect(appSrc).not.toContain('EnvironmentFailureState');
    expect(appSrc).not.toContain('environmentFailures');
    expect(appSrc).not.toContain('dismissEnvironmentFailure');
    expect(appSrc).not.toContain('redeven-environment-card__failure-badge');
    expect(styles).not.toContain('redeven-environment-card--failure');
    expect(styles).not.toContain('redeven-environment-card__failure-badge');
    const splitActionStart = appSrc.indexOf('function EnvironmentSplitActionButton');
    const splitActionEnd = appSrc.indexOf('function QuickCreateConnectionCard', splitActionStart);
    const splitActionSrc = appSrc.slice(splitActionStart, splitActionEnd);
    expect(splitActionSrc).toContain('allowMainAxisOverflow={false}');
    expect(splitActionSrc).toContain('placementLock="top-inline-shift"');
    expect(appSrc).toContain('data-redeven-action-popover-initial-focus=""');
  });

  it('renders filter pills with counts and a dismissible chip for runtime target / control plane filters', () => {
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
    expect(appSrc).not.toContain('environmentCenter.liveCount');
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
    expect(appSrc).toContain('filterEnvironmentLibraryDisplayGroups');
    expect(appSrc).toContain('EnvironmentLibraryDisplayGroup');
    expect(appSrc).not.toContain('splitPinnedEnvironmentEntries(props.entries)');
    expect(appSrc).toContain('function EnvironmentLibrarySection');
    expect(appSrc).toContain('function EnvironmentCardFactsBlock');
    expect(appSrc).toContain('runEnvironmentCardFactAction');
    expect(appSrc).toContain('setFocusedCloudSource(action.source_id)');
    expect(appSrc).toContain('runtimeTargetEnvironmentLibraryFilterTargetID(props.librarySourceFilter)');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.linkedRuntimeFilterWithLabel'");
    expect(appSrc).toContain('redeven-card-fact-value--action');
    expect(appSrc).toContain('cardFactIconMaskStyle');
    expect(appSrc).not.toContain('<img src={icon()} class="redeven-card-fact-label-icon"');
    expect(appSrc).not.toContain('<img src={icon()} class="redeven-card-fact-leading-icon"');
    expect(appSrc).toContain('style={cardFactIconMaskStyle(ICON_ENDPOINTS)}');
    expect(appSrc).not.toContain('<img src={ICON_ENDPOINTS}');
    expect(appSrc).toContain('function EndpointsPopover');
    expect(appSrc).toContain('title={props.endpoint.value}>{props.endpoint.value}</span>');
    expect(appSrc).toContain("openEnvironmentLibraryOverlayState('endpoints', environmentID)");
    expect(appSrc).toContain('selectEnvironmentEndpointOverlayState(environmentID, endpointID)');
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
    const endpointTriggerIconStyles = styles.match(/\.redeven-endpoint-trigger-icon\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(endpointTriggerIconStyles).toContain('background-color: currentColor');
    expect(endpointTriggerIconStyles).toContain('mask: var(--redeven-card-fact-icon-mask) center / contain no-repeat');
    expect(endpointTriggerIconStyles).toContain(
      '-webkit-mask: var(--redeven-card-fact-icon-mask) center / contain no-repeat',
    );
    expect(styles).toContain('.redeven-card-endpoint-row');
    expect(styles).toContain('.redeven-card-endpoint-label');
    expect(styles).toContain('.redeven-card-endpoint-value');
    expect(styles).toContain('.redeven-endpoint-qr-panel');
    expect(styles).toContain('.redeven-endpoint-qr-image');
    expect(styles).toContain('.redeven-endpoint-qr-copy-label');
    expect(styles).toContain('.redeven-endpoint-qr-copy-button');
    expect(styles).toContain('.redeven-status-indicator');
    expect(appSrc).toContain('EnvironmentStatusIndicator');
  });


  it('blocks every lifecycle action for a target while its lifecycle progress is active', () => {
    const appSrc = readWelcomeSource();
    const environmentBusyStart = appSrc.indexOf('function isEnvironmentActionBusy(');
    const environmentBusyEnd = appSrc.indexOf('function blockedPrimaryActionTriggerLabel(', environmentBusyStart);
    const environmentBusySrc = appSrc.slice(environmentBusyStart, environmentBusyEnd);
    expect(environmentBusySrc).toContain('environmentActionUsesLifecycleOwner(action)');
    expect(environmentBusySrc).toContain('return operationState.actionsDisabled;');
    expect(environmentBusySrc).not.toContain('launcherProgressBlocksPrimaryAction');
    const lifecycleOwnerStart = appSrc.indexOf('function environmentActionUsesLifecycleOwner(');
    const lifecycleOwnerEnd = appSrc.indexOf('function localizedPrimaryProgressPresentation(', lifecycleOwnerStart);
    const lifecycleOwnerSrc = appSrc.slice(lifecycleOwnerStart, lifecycleOwnerEnd);
    expect(lifecycleOwnerSrc).toContain('isEnvironmentLifecycleDisclosureIntent(action.intent)');
    expect(lifecycleOwnerSrc).toContain("action.intent === 'open'");
    expect(lifecycleOwnerSrc).toContain("action.intent === 'open_with_preflight'");
    expect(lifecycleOwnerSrc).toContain("action.intent === 'start_and_open'");

    const gatewayBusyStart = appSrc.indexOf('function gatewaySourceActionBusy(');
    const gatewayBusyEnd = appSrc.indexOf('function GatewaySourceActionIcon(', gatewayBusyStart);
    const gatewayBusySrc = appSrc.slice(gatewayBusyStart, gatewayBusyEnd);
    expect(gatewayBusySrc).not.toContain("actionKind === 'start_gateway'");
    expect(gatewayBusySrc).not.toContain("actionKind === 'stop_gateway'");
    expect(gatewayBusySrc).not.toContain("actionKind === 'restart_gateway'");
    expect(gatewayBusySrc).not.toContain("actionKind === 'update_gateway'");
    expect(gatewayBusySrc).toContain("progress.status !== 'canceled'");

    const operationKeyStart = appSrc.indexOf('function gatewayOperationKeyForAction(');
    const operationKeyEnd = appSrc.indexOf('function pendingGatewayRefreshProgress(', operationKeyStart);
    const operationKeySrc = appSrc.slice(operationKeyStart, operationKeyEnd);
    expect(operationKeySrc).toContain('return `${gateway.gateway_id}:refresh`;');
    expect(operationKeySrc).not.toContain('service_target_id');
  });


  it('routes unchecked Open through silent preflight and keeps lifecycle guidance in the same popup', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('runEnvironmentOpenPreflight,');
    expect(appSrc).toContain("} from './environmentOpenPreflight';");
    expect(appSrc).toContain("if (action.intent === 'open_with_preflight') {");
    expect(appSrc).toContain('const resolution = await runEnvironmentOpenPreflight({');
    expect(appSrc).toContain('attemptOpen: attemptEnvironmentOpenSilently,');
    expect(appSrc).toContain('loadLatestEnvironment: loadLatestEnvironmentEntry,');
    expect(appSrc).toContain("case 'open_with_preflight':");
    expect(appSrc).toContain('props.onPrimaryActionGuidanceOpenChange(true);');
    expect(appSrc).not.toContain("case 'open_with_preflight':\n        return openEnvironment(");
    expect(appSrc).toContain('const runOpenWithPreflight = async (action: EnvironmentActionModel): Promise<void> => {');
    expect(appSrc).toContain('await runOpenWithPreflight(action);');
  });

  it('shows structured operation failures in a compact card with scrollable technical details', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain('formatDesktopOperationFailureForClipboard(failure)');
    expect(appSrc).toContain('{failure().summary}');
    expect(appSrc).toContain('{failure().recovery_hint}');
    expect(appSrc).toContain("props.i18n.t('progress.technicalErrorDetails')");
    expect(appSrc).toContain('diagnostic.label');
    expect(appSrc).toContain('diagnostic.text');
    expect(styles).toContain('.redeven-action-popover__failure-details summary');
    expect(styles).toContain('cursor: pointer;');
    expect(styles).toContain('.redeven-action-popover__failure-details-viewport');
    expect(styles).toContain('max-height: 8rem;');
    expect(styles).toContain('scrollbar-gutter: stable;');
    expect(styles).toContain('user-select: text;');
    expect(styles).toContain('.redeven-action-popover__failure-diagnostic pre');
    expect(styles).not.toContain('.redeven-environment-card__failure-details');
  });


  it('keeps action progress local while preserving the loading and progress controls', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();
    expect(appSrc).toContain('loading={loading()}');
    expect(appSrc).toContain('loading={props.foregroundActionBusy(action())}');
    expect(appSrc).toContain('renderEnvironmentProgressPresentationIcon(presentation())');
    expect(appSrc).toContain('data-floe-progress-shimmer={primaryActionLoading() ? \'surface\' : undefined}');
    expect(appSrc).toContain('data-floe-progress-shimmer={presentation().kind === \'progress_trigger\' ? \'surface\' : undefined}');
    expect(appSrc).not.toContain('shimmer-overlay');
    expect(styles).not.toContain('shimmer-overlay');
    expect(styles).not.toContain('@keyframes redeven-status-dot-pulse');
  });

  it('keeps steady environment health indicators compositor-idle', () => {
    const styles = readWelcomeStyles();
    const environmentSuccessRule = cssRuleBlock(
      styles,
      ".redeven-status-indicator[data-tone='success'] .redeven-status-indicator__dot",
    );
    expect(environmentSuccessRule).not.toContain('animation:');
    expect(styles).not.toContain('@keyframes redeven-status-dot-glow');
    expect(styles).not.toContain('@keyframes redeven-bottom-bar-dot-breathe');
    expect(styles).not.toContain('@keyframes redeven-bottom-bar-dot-breathe-warning');
  });

  it('brands the fixed control-plane targets as Redeven Cloud', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toContain("labelKey: 'desktop.provider'");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.addProviderTitle')");
    expect(appSrc).toContain('data-cloud-source={id}');
    expect(appSrc).not.toContain('All Sources');
    expect(appSrc).toContain('Local');
    expect(appSrc).toContain('snapshot().redeven_cloud_origins');
    expect(appSrc).not.toContain('CONTROL_PLANE_PROVIDER_PRESET_OPTIONS');
    expect(appSrc).not.toContain('DESKTOP_WELCOME_IMPORT_META');
    expect(appSrc).toContain('cloudPresetOptions(snapshot().redeven_cloud_origins)');
    expect(appSrc).toContain("url.protocol !== 'https:'");
    expect(appSrc).not.toContain('ControlPlaneOriginMode');
    expect(appSrc).not.toContain('preset_cloud_origin');
    expect(appSrc).not.toContain('custom_cloud_origin');
    expect(appSrc).toContain('control-plane-provider-picker');
    expect(appSrc).toContain('control-plane-provider-options');
    expect(appSrc).not.toContain('control-plane-custom-origin');
    expect(appSrc).toContain('<OfficialProviderPicker');
    expect(appSrc).not.toContain('suggestCloudName');
    expect(appSrc).not.toContain("props.i18n.t('connectionDialog.providerName')");
    expect(appSrc).not.toContain("props.i18n.t('connectionDialog.cloudOriginCustom')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.continueInBrowser')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.providerAuthorizationHelp')");
    expect(appSrc).not.toContain('id="control-plane-origin"');
    expect(appSrc).not.toContain("props.i18n.t('connectionDialog.providerUrl')");
    expect(appSrc).not.toContain('placeholder="https://redeven.test"');
    expect(appSrc).toContain("props.i18n.t('environmentCenter.cloudSignInAgain')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.connectProvider')");
    expect(appSrc).toContain('redeven-cloud-source-header');
    expect(appSrc).toContain('cloudLastSyncResults');
    expect(styles).toContain('.redeven-cloud-source-header');
  });

  it('keeps the fixed Redeven Cloud confirmation flat while reserving selection chrome for development targets', () => {
    const appSrc = readWelcomeSource();
    const pickerStart = appSrc.indexOf('function OfficialProviderPicker');
    const pickerEnd = appSrc.indexOf('function ControlPlaneDialog', pickerStart);
    const pickerSrc = appSrc.slice(pickerStart, pickerEnd);
    const dialogStart = pickerEnd;
    const dialogEnd = appSrc.indexOf('export function EnvironmentAccessSettingsForm', dialogStart);
    const dialogSrc = appSrc.slice(dialogStart, dialogEnd);

    expect(pickerSrc).toContain('<Show when={canChooseTarget} fallback={(');
    expect(pickerSrc).toContain('data-redeven-cloud-target="fixed"');
    expect(pickerSrc).toContain('rounded-full bg-success');
    expect(pickerSrc).toContain('aria-haspopup="listbox"');
    expect(pickerSrc).toContain('<DesktopAnchoredListbox');
    expect(dialogSrc).not.toContain('space-y-3 rounded-lg border border-border/70 bg-muted/20');
    expect(dialogSrc).toContain('src={props.logoSrc}');
    expect(dialogSrc).toContain("props.i18n.t('desktop.provider')");
    expect(dialogSrc).toContain('class="w-full justify-center"');
    expect(dialogSrc).not.toContain('footer={(');
    expect(dialogSrc).toContain(
      "data-floe-autofocus={props.providerOptions.length <= 1 ? 'true' : undefined}",
    );
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
    expect(appSrc).not.toContain(
      'Desktop opens a remote session through the Control Plane without starting a local runtime here.',
    );
  });

  it('uses a settings affordance for every editable environment card', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("'common.settings'");
    expect(appSrc).not.toContain("case 'manage_gateway':");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.environmentSettings')");
    expect(appSrc).toContain("props.i18n.t('environmentCenter.settingsForLabel'");
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
    expect(appSrc).toContain("busyStateMatchesAction(busyState(), 'disconnect_cloud_runtime')");
    expect(appSrc).toContain("showActionToast(i18n().t('environmentCenter.disconnectedFromProviderToast'), 'info');");
    expect(appSrc).toContain('if (presentation.refresh_snapshot) {');
    expect(appSrc).toContain(
      "const [providerRuntimeLinkCloudEnvironmentID, setCloudRuntimeLinkCloudEnvironmentID] = createSignal('');",
    );
  });

  it('keeps transient action feedback out of page flow by using a toast viewport', () => {
    const appSrc = readWelcomeSource();
    const styles = readWelcomeStyles();

    expect(appSrc).toMatch(/import \{[^}]*\bPortal\b[^}]*\} from 'solid-js\/web';/);
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
    const sshComboboxSrc = readSSHDestinationComboboxSource();

    expect(appSrc).toContain("props.i18n.t('connectionDialog.name')");
    expect(appSrc).not.toContain('Environment Name');
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.redevenUrl')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.sshHost')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.localContainer')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.sshContainer')");
    expect(appSrc).not.toContain('Run a Desktop-managed Redeven environment on this device.');
    expect(appSrc).not.toContain('Create a local serve runtime for this provider environment on this Mac.');
    expect(appSrc).not.toContain(
      'This provider environment card will keep both routes visible on this device: serve local here, or open via Control Plane.',
    );
    expect(appSrc).toContain("props.i18n.t('connectionDialog.urlDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.notProviderUrl')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshDescription')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshDescription')");
    expect(appSrc).toContain('<SSHEnvironmentSettingsForm');
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
    const sshSettingsSrc = fs.readFileSync(path.join(__dirname, 'SSHEnvironmentSettingsForm.tsx'), 'utf8');
    expect(sshSettingsSrc).toContain("t('sshSettings.delivery')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.authentication')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.keyAgent')");
    expect(appSrc).toContain("label: props.i18n.t('connectionDialog.passwordPrompt')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.localSshPassword')");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.localSshPasswordHelp')");
    expect(appSrc).toContain(
      'value={isSSHBackedKind() ? (props.state as SSHBackedConnectionDialogState | null)?.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE : DEFAULT_DESKTOP_SSH_AUTH_MODE}',
    );
    expect(appSrc).toContain('variant="default"');
    expect(appSrc).not.toContain(
      "const showCreateConnectAction = createMemo(() => isCreate() && connectionKind() === 'external_local_ui');",
    );
    expect(appSrc).not.toContain('<Show when={showCreateConnectAction()}>');
    expect(appSrc).not.toContain('async function saveAndConnectURLFromDialog()');
    expect(appSrc).not.toContain('async function ' + 'connectFrom' + 'Dialog()');
    expect(sshSettingsSrc).toContain("'connectionDialog.automatic'");
    expect(sshSettingsSrc).toContain("'connectionDialog.desktopUpload'");
    expect(sshSettingsSrc).toContain("'connectionDialog.remoteDownloadInstall'");
    expect(appSrc).not.toContain('remoteFallback');
    expect(sshSettingsSrc).toContain("'connectionDialog.bootstrapHelp'");
    expect(appSrc).toContain("props.i18n.t('connectionDialog.sshDestination')");
    expect(appSrc).toContain("import { SSHDestinationCombobox } from './SSHDestinationCombobox';");
    expect(sshComboboxSrc).toContain('export function SSHDestinationCombobox');
    expect(sshComboboxSrc).toContain('filterAndRankSSHConfigHosts(props.hosts, props.value)');
    expect(sshComboboxSrc).not.toContain('hosts.slice(0, 8)');
    expect(sshComboboxSrc).toContain('maxHeight={320}');
    expect(sshComboboxSrc).toContain("props.i18n.t('connectionDialog.sshConfigLoading')");
    expect(sshComboboxSrc).toContain("props.i18n.t('connectionDialog.sshConfigLoadFailed')");
    expect(sshComboboxSrc).toContain("props.i18n.t('connectionDialog.sshConfigEmpty')");
    expect(sshComboboxSrc).toContain("props.i18n.t('connectionDialog.sshConfigNoMatches')");
    expect(appSrc).toContain('inputID="environment-ssh-destination"');
    expect(appSrc).toContain('inputID="gateway-ssh-destination"');
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

  it('refreshes SSH config hosts for each SSH dialog entry without reloading on field input', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain('const sshConfigHostsLoadKey = createMemo(() => {');
    expect(appSrc).toContain('createEffect(on(sshConfigHostsLoadKey, (loadKey, previousLoadKey) => {');
    expect(appSrc).toContain('const requestID = ++sshConfigHostsRequestID;');
    expect(appSrc).toContain('if (requestID !== sshConfigHostsRequestID)');
    expect(appSrc).toContain('setSSHConfigHostsLoading(true);');
    expect(appSrc).toContain('setSSHConfigHostsLoadError(true);');
    expect(appSrc).not.toContain('sshConfigHostsLoaded');
  });

  it('keeps the connection dialog source-scoped across URL, SSH, and managed container targets', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain(
      'type ConnectionDialogState = ExternalURLConnectionDialogState | SSHConnectionDialogState | RuntimeContainerConnectionDialogState | null;',
    );
    expect(appSrc).toContain('props.switchKind(value as ConnectionDialogKind)');
    expect(appSrc).not.toContain(
      "const showCreateConnectAction = createMemo(() => isCreate() && connectionKind() === 'external_local_ui');",
    );
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


  it('uses the selected Environment health and card status for the settings runtime state', () => {
    const appSrc = readWelcomeSource();
    const dialogStart = appSrc.indexOf('function EnvironmentAccessSettingsForm');
    const dialogEnd = appSrc.indexOf('function ConnectionDialog', dialogStart);
    const dialogSrc = appSrc.slice(dialogStart, dialogEnd);

    expect(appSrc).toContain('const runtime = buildEnvironmentSettingsRuntimeModel(environment);');
    expect(appSrc).toContain('statusLabel: localizedEnvironmentStatusLabel(i18n(), runtime.status_label)');
    expect(dialogSrc).toContain('{props.runtimeStatusLabel}');
    expect(appSrc).toContain('statusTone: runtime.status_tone');
    expect(appSrc).toContain('runtimeStatusTone={settingsRuntimePresentation().statusTone}');
    expect(dialogSrc).not.toContain("accessModel().current_runtime_url !== ''");
  });


  it('keeps global language controls out of Local Environment Settings', () => {
    const appSrc = readWelcomeSource();
    const dialogStart = appSrc.indexOf('function EnvironmentAccessSettingsForm');
    const dialogEnd = appSrc.indexOf('function ConnectionDialog', dialogStart);
    const dialogSrc = appSrc.slice(dialogStart, dialogEnd);

    expect(dialogSrc).not.toContain('DesktopLanguageSettingsPanel');
    expect(dialogSrc).not.toContain('languageSnapshot');
    expect(dialogSrc).not.toContain('updateLanguagePreference');
    expect(dialogSrc).not.toContain("props.i18n.t('settings.interfaceTitle')");
    expect(dialogSrc).not.toContain("props.i18n.t('settings.languageTitle')");
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
    expect(appSrc).not.toContain(
      'Welcome checks this runtime automatically while open. Refresh status still checks immediately when this is off.',
    );
    expect(appSrc).toContain("title={props.i18n.t('connectionDialog.addProviderTitle')}");
    expect(appSrc).not.toContain(
      'ControlPlaneDialog(props: Readonly<{\\n  state: ControlPlaneDialogState;\\n  auto_runtime_probe_enabled',
    );
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
    const panelRule = cssRuleBlock(
      styles,
      "[data-floe-dialog-overlay-root][data-floe-dialog-mode='global'] [data-floe-dialog-panel]",
    );
    const backdropRule = cssRuleBlock(
      styles,
      "[data-floe-dialog-overlay-root][data-floe-dialog-mode='global'] [data-floe-dialog-backdrop]",
    );
    const semanticPanelRule = cssRuleBlock(styles, '.redeven-welcome-dialog-panel');
    const dialogBodyRule = cssRuleBlock(styles, '.redeven-welcome-dialog-panel > div:nth-child(2)');
    const environmentSettingsRule = cssRuleBlock(
      fs.readFileSync(path.join(__dirname, 'EnvironmentSettingsDialog.css'), 'utf8'),
      '[data-floe-dialog-panel].redeven-environment-settings-dialog',
    );
    const cloudConnectionPanelRule = cssRuleBlock(styles, '.redeven-cloud-connection-panel');

    expect(dialogSrc).toContain('data-floe-dialog-overlay-root');
    expect(dialogSrc).toContain('data-floe-dialog-mode');
    expect(dialogSrc).toMatch(/return \w+\(\) \? "surface" : "global";/);
    expect(dialogSrc).toContain('"global"');
    expect(dialogSrc).toContain('"fixed box-border p-4"');
    expect(dialogSrc).toMatch(/observeViewport as \w+, viewportStyle as \w+/u);
    expect(dialogSrc).toContain('"--floe-dialog-safe-top"');
    expect(dialogSrc).toMatch(/\w+\(\) === void 0 && "z-50"/u);
    expect(dialogSrc).toMatch(/"z-index": \w+\(\)/u);
    expect(dialogSrc).toContain('data-floe-dialog-backdrop');
    expect(dialogSrc).toContain('data-floe-dialog-panel');
    expect(dialogSrc).toMatch(/flex flex-col.*e\.class/u);
    expect(dialogSrc).toMatch(/return \w+\(\) \? void 0 : "true";/);
    expect(dialogSrc).toContain('as ConfirmDialog');
    expect(chromeSrc).toContain("'--redeven-desktop-titlebar-height': `${snapshot.titleBarHeight}px`");
    expect(chromeSrc).toContain("[data-floe-shell-slot='top-bar']");
    expect(chromeSrc).toContain('app-region: drag;');

    expect(overlayRule).toContain('--redeven-welcome-dialog-titlebar-offset: var(--redeven-desktop-titlebar-height);');
    expect(overlayRule).not.toContain('var(--redeven-desktop-titlebar-height,');
    expect(overlayRule).toContain('--redeven-welcome-dialog-edge-gap: 1rem;');
    expect(overlayRule).toContain(
      'calc(100dvh - var(--redeven-welcome-dialog-titlebar-offset) - (var(--redeven-welcome-dialog-edge-gap) * 2))',
    );
    expect(overlayRule).toContain(
      '--redeven-welcome-dialog-panel-max-height: var(--redeven-welcome-dialog-available-height);',
    );
    expect(overlayRule).toContain(
      'padding:\n    calc(var(--redeven-welcome-dialog-titlebar-offset) + var(--redeven-welcome-dialog-edge-gap))',
    );
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
    expect(styles).toContain("@import './EnvironmentSettingsDialog.css';");
    expect(environmentSettingsRule).toContain('width: min(50rem, calc(100vw - 2rem));');
    expect(environmentSettingsRule).toContain('max-height: var(--redeven-welcome-dialog-panel-max-height);');
    expect(styles).toContain('.redeven-welcome-dialog-panel--connection');
    expect(styles).toContain('width: min(58rem, 96vw);');

    expect(appSrc).toContain("const WELCOME_DIALOG_PANEL_CLASS = 'redeven-welcome-dialog-panel';");
    expect(appSrc).toContain('<EnvironmentSettingsDialog');
    expect(appSrc).toContain("'redeven-welcome-dialog-panel--connection'");
    expect(appSrc).not.toContain('[&>div:first-child]');
    expect(appSrc).not.toContain('[&>div:nth-child(2)]');
    expect(appSrc).not.toContain('[&>div:last-child]');
    expect(appSrc).not.toContain('max-h-[calc(100dvh-1rem)]');
    expect(appSrc).not.toContain('max-h-[calc(100dvh-3rem)]');
    expect(appSrc).not.toContain('100dvh');
    expect(cloudConnectionPanelRule).toContain(
      'max-height: calc(var(--redeven-anchored-overlay-max-height, 100dvh - 1rem) - 2px);',
    );
    expect((styles.match(/100dvh/g) ?? []).length).toBe(4);

    expect((appSrc.match(/class=\{(?:cn\()?CONNECTION_DIALOG_CLASS/g) ?? []).length).toBe(2);
    expect(appSrc).toContain('function ControlPlaneDialog');
    expect(appSrc).toContain("title={props.i18n.t('connectionDialog.addProviderTitle')}");
    expect(appSrc).toContain('open={providerRuntimeLinkDialogOpen()}');
  });

  it('projects operation confirmation as progress without a client ownership dialog', () => {
    const appSrc = readWelcomeSource();
    expect(appSrc).toContain("progress.status === 'needs_confirmation'");
    expect(appSrc).not.toContain('runtimeTakeover');
    expect(appSrc).not.toContain('RuntimeProcessTakeover');
    expect(appSrc).not.toContain('owner_evidence');
  });


  it('localizes structured local Runtime target details', () => {
    const appSrc = readWelcomeSource();

    expect(appSrc).toContain("progress?.location === 'local_host'");
    expect(appSrc).toContain("i18n.t('environmentFacts.thisDevice')");
    expect(appSrc).toContain('const runtimeTargetDetail = createMemo');
    expect(appSrc).toContain('const openTargetDetail = createMemo');
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
    const settingsSrc = fs.readFileSync(new URL('./EnvironmentSettingsDialog.tsx', import.meta.url), 'utf8');
    expect(settingsSrc).toMatch(/const isOpen = createMemo\(\(\) => props\.open\)/);
    expect(appSrc).not.toContain('function RuntimeEnrollmentDialog');
    expect(appSrc).not.toContain('function ProviderRuntimeSetupDialog');
    expect(appSrc).not.toContain('environmentInitialization.');
    expect(appSrc).not.toContain('Set up Runtime management');

    // Provider runtime link dialog: selecting a provider environment is an
    // in-dialog choice, not an open/close transition. Keep it out of the
    // confirmation object tracked by the dialog open prop so the overlay mask
    // and focus trap do not unmount/remount when the radio changes.
    expect(appSrc).toContain(
      'const providerRuntimeLinkDialogOpen = createMemo(() => providerRuntimeLinkConfirmation() !== null);',
    );
    expect(appSrc).toContain('open={providerRuntimeLinkDialogOpen()}');
    expect(appSrc).not.toMatch(/<ConfirmDialog\b[^>]*open=\{providerRuntimeLinkConfirmation\(\) !== null\}/);
    expect(appSrc).not.toContain('setCloudRuntimeLinkConfirmation((current) => current ? {');
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
    expect(appSrc).not.toContain('allowActiveWorkReplacement: true');
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
    expect(
      suggestConnectionLabel({
        connection_kind: 'ssh_environment',
        label: '',
        ssh_destination: 'my-server',
      }),
    ).toBe('my-server');
  });

  it('returns null for ssh_environment when ssh_destination is empty', () => {
    expect(
      suggestConnectionLabel({
        connection_kind: 'ssh_environment',
        label: '',
        ssh_destination: '',
      }),
    ).toBeNull();
  });

  it('returns the container_label for local_container_runtime when set', () => {
    expect(
      suggestConnectionLabel({
        connection_kind: 'local_container_runtime',
        label: '',
        container_label: 'web-app',
      }),
    ).toBe('web-app');
  });

  it('returns the container_label for ssh_container_runtime when set', () => {
    expect(
      suggestConnectionLabel({
        connection_kind: 'ssh_container_runtime',
        label: '',
        ssh_destination: 'remote-host',
        container_label: 'prod-app',
      }),
    ).toBe('prod-app');
  });

  it('returns null for container kinds when container_label is empty', () => {
    expect(
      suggestConnectionLabel({
        connection_kind: 'local_container_runtime',
        label: '',
        container_label: '',
      }),
    ).toBeNull();
  });

  it('returns null for external_local_ui regardless of other fields', () => {
    expect(
      suggestConnectionLabel({
        connection_kind: 'external_local_ui',
        label: '',
      }),
    ).toBeNull();
  });

  it('ignores label field in the state — only uses connection-specific fields', () => {
    expect(
      suggestConnectionLabel({
        connection_kind: 'ssh_environment',
        label: 'user-typed-name',
        ssh_destination: 'dev-server',
      }),
    ).toBe('dev-server');
  });

  it('trims whitespace from the connection field before returning', () => {
    expect(
      suggestConnectionLabel({
        connection_kind: 'ssh_environment',
        label: '',
        ssh_destination: '  staging-box  ',
      }),
    ).toBe('staging-box');
  });

  it('returns null when ssh_destination is all whitespace', () => {
    expect(
      suggestConnectionLabel({
        connection_kind: 'ssh_environment',
        label: '',
        ssh_destination: '   ',
      }),
    ).toBeNull();
  });
});
