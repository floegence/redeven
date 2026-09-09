import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readMainSource(): string {
  return fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
}

function readSharedLauncherIPCSource(): string {
  return fs.readFileSync(path.join(__dirname, '..', 'shared', 'desktopLauncherIPC.ts'), 'utf8');
}

function readMainModuleSource(filename: string): string {
  return fs.readFileSync(path.join(__dirname, filename), 'utf8');
}

function readSharedGatewaySource(): string {
  return fs.readFileSync(path.join(__dirname, '..', 'shared', 'desktopGateway.ts'), 'utf8');
}

describe('main routing', () => {
  it('owns and injects one Desktop SSH transport manager without direct consumer SSH spawns', () => {
    const mainSrc = readMainSource();
    expect(mainSrc).toContain('const desktopSSHTransportManager = new DefaultDesktopSSHTransportManager({');
    expect(mainSrc).toContain('sshTransportManager: desktopSSHTransportManager');
    expect(mainSrc).toContain('ssh_transport_manager: desktopSSHTransportManager');
    expect(mainSrc.indexOf('await runtimePlacementBridgeRegistry.retireAll().catch(() => undefined);')).toBeLessThan(
      mainSrc.indexOf('await desktopSSHTransportManager.dispose();'),
    );

    const consumerSources = [
      'sshRuntime.ts',
      'runtimeHostAccess.ts',
      'runtimePlacementBridgeSession.ts',
      'runtimePlacementManager.ts',
      'gatewayServiceHost.ts',
      'gatewayLifecycleManager.ts',
      'main.ts',
    ].map(readMainModuleSource);
    for (const source of consumerSources) {
      expect(source).not.toMatch(/\bspawn(?:Sync)?\s*\(\s*['"]ssh['"]/u);
      expect(source).not.toMatch(/\bspawn(?:Sync)?\s*\(\s*sshBinary\b/u);
    }
  });

  it('keeps the launcher as the single desktop utility window', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("type DesktopUtilityWindowKind = 'launcher';");
    expect(mainSrc).toContain('const utilityWindows = new Map<DesktopUtilityWindowKind, DesktopTrackedWindow>();');
    expect(mainSrc).toContain("const UTILITY_WINDOW_KINDS = ['launcher'] as const;");
    expect(mainSrc).toContain("surface: 'connect_environment'");
    expect(mainSrc).toContain("surface: 'environment_settings'");
    expect(mainSrc).toContain("return 'window:launcher';");
    expect(mainSrc).not.toContain("'window:settings'");
  });

  it('keeps Local Environment auto-start on the unified lifecycle path', () => {
    const mainSrc = readMainSource();
    const start = mainSrc.indexOf('async function autoStartLocalRuntimeOnDesktopLaunch(');
    const end = mainSrc.indexOf('function controlPlaneIssueForError(', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const startupSrc = mainSrc.slice(start, end);
    expect(startupSrc).toContain('await runEnvironmentRuntimeLifecycleFromLauncher({');
    expect(startupSrc).toContain("kind: 'update_environment_runtime'");
    expect(startupSrc).toContain("result.failure?.code !== 'runtime_update_required'");
    expect(startupSrc).toContain('operation_key: `${environment.id}:auto_repair`');
    expect(startupSrc).not.toContain('attachLocalEnvironmentRuntime(environment)');
    expect(startupSrc).not.toContain('prepareManagedEnvironmentRuntime({');
    expect(startupSrc).toContain("structuredFailure?.code === 'reinstall_required'");
    expect(startupSrc).toContain('await markReinstallTargetRequired(preferences.local_environment.id');
    expect(startupSrc).toMatch(/await refreshWelcomeRuntimeHealthForEnvironment\(environment\.id,\s*\{\s*force: true,?\s*\}\);/u);
    expect(startupSrc).toContain('resetLauncherIssueState();');
    expect(startupSrc).toContain('broadcastDesktopWelcomeSnapshots();');
    expect(startupSrc).not.toContain('initializeGatewayRuntime({');
    expect(startupSrc).not.toContain('prepareDesktopRuntimeUploadAsset');
    expect(startupSrc).not.toContain('prepareCustomRuntimeLifecycleArtifact');
    expect(startupSrc).not.toContain('upsertDirectRuntimeGateway');
    expect(startupSrc).not.toContain('gatewayReinstallPairingRequired');
  });

  it('preserves reinstall-required health across status refresh and durable recovery state', () => {
    const mainSrc = readMainSource();
    const presenceSrc = fs.readFileSync(
      path.join(__dirname, '..', 'shared', 'desktopRuntimePresence.ts'),
      'utf8',
    );
    const healthSrc = fs.readFileSync(
      path.join(__dirname, '..', 'shared', 'desktopRuntimeHealth.ts'),
      'utf8',
    );
    const recoveryStart = mainSrc.indexOf('async function reinstallRecoveryRequiredTargetFingerprints(');
    const recoveryEnd = mainSrc.indexOf('async function reinstallRecoveryBlockForEnvironment(', recoveryStart);
    const recoverySrc = mainSrc.slice(recoveryStart, recoveryEnd);

    expect(presenceSrc).toContain("| 'reinstall_required'");
    expect(healthSrc).toContain("| 'reinstall_required'");
    expect(mainSrc.match(/runtimeControlMissingReasonFromBlockedClassification\(classification\)/gu))
      .toHaveLength(3);
    expect(mainSrc).toContain("if (classification.kind === 'reinstall_required') {");
    expect(mainSrc).toContain("case 'reinstall_required':");
    expect(recoverySrc).toContain("currentJournal.phase !== 'confirmation'");
    expect(recoverySrc).toContain("healthState?.offline_reason_code === 'reinstall_required'");
    expect(recoverySrc).toContain('fs.lstat(reinstallTargetRequiredMarkerPath(descriptor))');
  });

  it('projects one Runtime package task without a maintenance-helper task', () => {
    const mainSrc = readMainSource();
    const reporterStart = mainSrc.indexOf('function runtimePackageProgressReporter<');
    const reporterEnd = mainSrc.indexOf('function buildOpenConnectionProgress(', reporterStart);
    const reporterSrc = mainSrc.slice(reporterStart, reporterEnd);
    expect(reporterSrc).toContain("[{ id: 'runtime', status, phase, strategy: input.strategy }]");
    expect(reporterSrc).not.toContain('maintenance_helper');
    expect(mainSrc).not.toContain('concurrentRuntimePreparationReporter');
  });

  it('keeps direct targets isolated from the Gateway store and pairing flow', () => {
    const mainSrc = readMainSource();
    expect(mainSrc).toContain('await markReinstallTargetRequired(preferences.local_environment.id, {');
    expect(mainSrc).not.toContain('reinstallTargetRequiredFailureIfPresent');
    expect(mainSrc).not.toContain('reinstallTargetRequiredLauncherFailure');
    expect(mainSrc).toContain('async function reinstallRecoveryBlockForEnvironment(');
    expect(mainSrc).not.toContain('pendingReinstallOperationForEnvironment');
    expect(mainSrc).toContain('const gatewaySources = await loadGatewaySourcesForWelcome();');
    const openStart = mainSrc.indexOf('async function openLocalEnvironmentFromLauncher(');
    const openEnd = mainSrc.indexOf('async function openRemoteEnvironmentFromLauncher(', openStart);
    const openSrc = mainSrc.slice(openStart, openEnd);
    expect(openSrc).not.toContain('reinstallTargetRequired(');
    expect(openSrc.indexOf('await openRuntimePlacementBridgeFromLauncher(request)')).toBeLessThan(
      openSrc.indexOf('findLocalEnvironmentByID(preferences, request.environment_id)'),
    );

    expect(mainSrc).toContain('new ReinstallTargetCoordinator({');
    expect(mainSrc).toContain('close_sessions: closeDesktopSessionsForReinstallTarget');
    expect(mainSrc).toContain(
      'prepare_process_session: async (descriptor, targetRoot, executor, _platform, preparedPackage, signal) => openReinstallTargetProcessSession',
    );
    const prepareFreshStart = mainSrc.indexOf('async function prepareFreshReinstallRuntimePackage(');
    const prepareFreshEnd = mainSrc.indexOf('async function installFreshReinstallRuntime(', prepareFreshStart);
    const prepareFreshSrc = mainSrc.slice(prepareFreshStart, prepareFreshEnd);
    expect(prepareFreshSrc).toContain("if (descriptor.host_access.kind === 'wsl_host')");
    expect(prepareFreshSrc).toContain('requireDesktopBundle().managed_wsl_archive_path');
    expect(prepareFreshSrc).toContain('archiveData = await fs.readFile(archivePath)');
    const freshInstallStart = mainSrc.indexOf('async function installFreshReinstallRuntime(');
    const freshInstallEnd = mainSrc.indexOf('async function startFreshReinstallRuntime(', freshInstallStart);
    const freshInstallSrc = mainSrc.slice(freshInstallStart, freshInstallEnd);
    expect(freshInstallSrc).toContain('installReinstallRuntimePackage(');
    expect(freshInstallSrc).not.toContain('startRuntimePlacementBridgeSession({');
    expect(freshInstallSrc).not.toContain('runtimeHostExecutor(');
    const freshStartStart = freshInstallEnd;
    const freshStartEnd = mainSrc.indexOf('async function finalizeFreshReinstallRuntime(', freshStartStart);
    const freshStartSrc = mainSrc.slice(freshStartStart, freshStartEnd);
    expect(freshStartSrc).toContain('startReinstallRuntime({');
    expect(mainSrc).toContain('const ready = await verifyReinstallRuntimeReady({');
    const freshAccessStart = mainSrc.indexOf('async function verifyReinstallTargetCatalogAndLocalUI(');
    const freshAccessEnd = mainSrc.indexOf('function reinstallTargetCoordinator()', freshAccessStart);
    const freshAccessSrc = mainSrc.slice(freshAccessStart, freshAccessEnd);
    expect(freshAccessSrc).toContain('probeLocalRuntimeBridgeStartup(bridge.startup');
    expect(freshAccessSrc).toContain('signal,');
    expect(freshAccessSrc).toContain('runtimeServiceIsOpenable(localUI.value.runtime_service)');
    expect(freshStartSrc).not.toContain('runtimeHostExecutor(');
    const placementStart = mainSrc.indexOf('function resolvedReinstallRuntimePlacement(');
    const placementEnd = mainSrc.indexOf('async function prepareFreshReinstallRuntimePackage(', placementStart);
    const placementSrc = mainSrc.slice(placementStart, placementEnd);
    expect(placementSrc).toContain('desktopRuntimePlacementStateRoot(descriptor.placement)');
    expect(placementSrc).not.toContain('runtime_state_root: targetRoot');
    const failureMappingStart = mainSrc.indexOf('function reinstallFailureForPhase(');
    const failureMappingEnd = mainSrc.indexOf(
      'function launcherActionFailureFromRuntimeStartError(',
      failureMappingStart,
    );
    const failureMappingSrc = mainSrc.slice(failureMappingStart, failureMappingEnd);
    expect(failureMappingSrc).toContain("case 'runtime_installed':");
    expect(failureMappingSrc).toContain("code: 'reinstall_runtime_install_failed'");
    expect(failureMappingSrc).toContain("code: 'reinstall_runtime_verification_failed'");
    expect(failureMappingSrc).toContain("code: 'reinstall_runtime_access_failed'");
    expect(freshInstallSrc).not.toContain('ensureManagedGatewayServiceReady(');
    expect(freshInstallSrc).not.toContain('ensureRuntimePlacementReady(');
    expect(freshInstallSrc).not.toContain('ensureManagedSSHRuntimeReady(');
    expect(freshInstallSrc).not.toContain('gatewayLifecycleManager()');
    expect(freshInstallSrc).not.toContain('startManagedRuntime({');
    expect(freshInstallSrc).not.toContain('syncGatewayRecord(');
    expect(mainSrc).not.toContain('resetLocalEnvironmentFromLauncher');

    const autoSyncStart = mainSrc.indexOf('async function syncGatewayIfNeeded(');
    const autoSyncEnd = mainSrc.indexOf('async function syncVisibleGatewaysIfNeeded(', autoSyncStart);
    const autoSyncSrc = mainSrc.slice(autoSyncStart, autoSyncEnd);
    expect(autoSyncSrc).not.toContain('reinstallTargetBlocksGateway');

    const lifecycleStart = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(');
    const lifecycleEnd = mainSrc.indexOf('async function startEnvironmentRuntimeFromLauncher(', lifecycleStart);
    const lifecycleSrc = mainSrc.slice(lifecycleStart, lifecycleEnd);
    const executeLifecycleStart = mainSrc.indexOf('async function executeDirectManagedEnvironmentLifecycle(');
    const executeLifecycleEnd = mainSrc.indexOf(
      'async function runEnvironmentRuntimeLifecycleFromLauncher(',
      executeLifecycleStart,
    );
    const executeLifecycleSrc = mainSrc.slice(executeLifecycleStart, executeLifecycleEnd);
    expect(executeLifecycleSrc).not.toContain('reinstallTargetRequiredFailureIfPresent');
    expect(executeLifecycleSrc).toContain("if (input.operation !== 'stop')");
    expect(executeLifecycleSrc).toContain('await verifyManagedRuntimeLifecycleAccess({');
    const lifecycleAccessStart = mainSrc.indexOf('async function verifyManagedRuntimeLifecycleAccess(');
    const lifecycleAccessEnd = mainSrc.indexOf('function runtimeBridgeStartCanRecover(', lifecycleAccessStart);
    const lifecycleAccessSrc = mainSrc.slice(lifecycleAccessStart, lifecycleAccessEnd);
    expect(lifecycleAccessSrc).toContain('runtimeServiceIsOpenable(ready.runtime_service)');
    expect(lifecycleAccessSrc).not.toContain('ready.startup');
    expect(lifecycleAccessSrc).toContain('startRuntimePlacementBridgeSession({');
    expect(lifecycleAccessSrc).toContain('runtimeServiceIsOpenable(localUI.value.runtime_service)');
    expect(mainSrc).not.toContain('waitForDesktopRuntimeLifecycleReadiness');
    expect(lifecycleSrc).not.toContain('localEnvironmentPairingRequiredLauncherFailure');
    expect(lifecycleSrc).not.toContain('upsertDirectRuntimeGateway');

    const refreshStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshEnd = mainSrc.indexOf('async function refreshAllEnvironmentRuntimesFromLauncher(', refreshStart);
    const refreshSrc = mainSrc.slice(refreshStart, refreshEnd);
    expect(refreshSrc).not.toContain('reinstallTargetRequiredFailureIfPresent');
    expect(refreshSrc).not.toContain('localEnvironmentPairingRequiredLauncherFailure');
    expect(mainSrc).not.toContain('clearGatewayReinstallPairingRequired');
  });

  it('tracks environment windows by session key and scopes child windows per session', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('const sessionsByKey = new Map<DesktopSessionKey, DesktopSessionRecord>();');
    expect(mainSrc).toContain('const sessionKeyByWebContentsID = new Map<number, DesktopSessionKey>();');
    expect(mainSrc).toContain('function sessionWindowStateKey(sessionKey: DesktopSessionKey): string {');
    expect(mainSrc).toContain(
      'function sessionChildWindowStateKey(sessionKey: DesktopSessionKey, childKey: string): string {',
    );
    expect(mainSrc).toContain(
      'function sessionCodespaceWindowStateKey(sessionKey: DesktopSessionKey, codeSpaceID: string): string {',
    );
    expect(mainSrc).toContain('function openSessionChildWindow(');
    expect(mainSrc).toContain('async function prepareSessionNativeCodeSpace(');
    expect(mainSrc).toContain('if (isAllowedSessionNavigation(sessionKey, nextURL)) {');
    expect(mainSrc).toContain(
      'new URL(url).origin === state.gateway.origin',
    );
    expect(mainSrc).toContain('child_windows: Map<string, DesktopTrackedWindow>;');
    expect(mainSrc).toContain('codespace_windows: Map<string, DesktopTrackedWindow>;');
    expect(mainSrc).toContain('sessionKeyByWebContentsID.delete(closedWindow.webContentsID);');
    expect(mainSrc).not.toContain('sessionKeyByWebContentsID.delete(childWindow.webContents.id);');
  });

  it('routes launcher and shell actions into the multi-window desktop flow', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("case 'start_control_plane_connect':");
    expect(mainSrc).toContain("case 'open_environment_settings':");
    expect(mainSrc).toContain("case 'start_environment_runtime':");
    expect(mainSrc).toContain("case 'restart_environment_runtime':");
    expect(mainSrc).toContain("case 'stop_environment_runtime':");
    expect(mainSrc).toContain("case 'refresh_environment_runtime':");
    expect(mainSrc).toContain("case 'refresh_all_environment_runtimes':");
    expect(mainSrc).toContain("case 'save_local_environment_settings':");
    expect(mainSrc).toContain("case 'focus_environment_window':");
    expect(mainSrc).toContain("case 'close_launcher_or_quit':");
    expect(mainSrc).toContain("if (normalized.kind === 'connection_center') {");
    expect(mainSrc).toContain("if (normalized.kind === 'flower_settings') {");
    expect(mainSrc).toContain('focusFlowerSettings: true,');
    expect(mainSrc).toContain('await openAdvancedSettingsWindow();');
    expect(mainSrc).toContain('DESKTOP_SHELL_OPEN_CODESPACE_WINDOW_CHANNEL');
    expect(mainSrc).toContain(
      'return openCodespaceWindowFromShell(record, normalized);',
    );
    expect(mainSrc).toContain("return openUtilityWindow('launcher', {");
    expect(mainSrc).toContain("surface: 'environment_settings',");
    expect(mainSrc).toContain('return focusEnvironmentWindow(request.session_key);');
  });

  it('enforces Redeven Cloud origins at authorization and callback persistence boundaries', () => {
    const mainSrc = readMainSource();
    const start = mainSrc.slice(
      mainSrc.indexOf('async function startControlPlaneAuthorization('),
      mainSrc.indexOf('async function saveAuthorizedControlPlane('),
    );
    const save = mainSrc.slice(
      mainSrc.indexOf('async function saveAuthorizedControlPlane('),
      mainSrc.indexOf('async function syncSavedControlPlaneAccount('),
    );
    const deepLink = mainSrc.slice(
      mainSrc.indexOf('async function handleDesktopDeepLink('),
      mainSrc.indexOf('function registerDesktopProtocolClient('),
    );
    const completeDeepLink = mainSrc.slice(
      mainSrc.indexOf('async function completeControlPlaneAuthorizationFromDeepLink('),
      mainSrc.indexOf('async function handleDesktopDeepLink('),
    );

    expect(start).toContain('requireRedevenCloudOrigin(args.providerOrigin, policy)');
    expect(start).toContain('requireRedevenCloudOrigin(provider.provider_origin, policy)');
    expect(save).toContain('requireRedevenCloudOrigin(providerOrigin, policy)');
    expect(save).toContain('requireRedevenCloudOrigin(provider.provider_origin, policy)');
    expect(deepLink).toContain('completeControlPlaneAuthorizationFromDeepLink(request)');
    expect(completeDeepLink).toContain('saveAuthorizedControlPlane(');
  });

  it('cleans unsupported local control-plane state without remote or Runtime side effects', () => {
    const mainSrc = readMainSource();
    const load = mainSrc.slice(
      mainSrc.indexOf('async function loadDesktopPreferencesCached('),
      mainSrc.indexOf('function syncOpenSessionTargetsWithPreferences('),
    );

    expect(load).toContain('restrictDesktopPreferencesToRedevenCloud(');
    expect(load).toContain('await saveDesktopPreferences(');
    expect(load).toContain("code: 'redeven_cloud_local_cleanup'");
    expect(load).not.toContain('revoke');
    expect(load).not.toContain('disconnect');
    expect(load).not.toContain('closeSession');
  });

  it('scopes transport recovery IPC to the sending Desktop session', () => {
    const mainSrc = readMainSource();
    const handlerStart = mainSrc.indexOf('ipcMain.on(DESKTOP_SESSION_TRANSPORT_RECOVERY_GET_CHANNEL');
    const handlerEnd = mainSrc.indexOf('ipcMain.on(DESKTOP_THEME_GET_SNAPSHOT_CHANNEL', handlerStart);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handlerSrc = mainSrc.slice(handlerStart, handlerEnd);
    expect(handlerSrc.match(/sessionRecordForWebContentsID\(event\.sender\.id\)/gu)).toHaveLength(3);
    expect(handlerSrc).toContain('event.returnValue = sessionRecord?.transport_recovery_snapshot ?? null;');
    expect(handlerSrc).toContain('return sessionRecord?.transport_recovery_session?.requestRecoveryNow() ?? false;');
    expect(handlerSrc).not.toContain('sessionsByKey.get(');
    expect(handlerSrc).not.toContain('runtimePlacementBridgeByTargetID.get(');
  });

  it('routes validated shell preset updates through the Desktop theme authority', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('DESKTOP_THEME_SET_SHELL_THEME_CHANNEL,');
    expect(mainSrc).toContain('ipcMain.on(DESKTOP_THEME_SET_SHELL_THEME_CHANNEL, (event, mode, presetName) => {');
    expect(mainSrc).toContain('event.returnValue = desktopRendererThemeSnapshot(');
    expect(mainSrc).toContain('desktopThemeState().setShellTheme(mode, presetName),');
  });

  it('returns structured launcher failures for stale sessions instead of raw exception text', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("'session_stale'");
    expect(mainSrc).toContain("'That window was already closed. Desktop refreshed the environment list.'");
    expect(mainSrc).not.toContain("throw new Error('That environment window is no longer open.')");
  });

  it('keeps desktop windows unthrottled while the user works in other apps', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('backgroundThrottling: false,');
  });

  it('opens codespaces in persistent isolated windows without editor shell authority', () => {
    const mainSrc = readMainSource();
    const start = mainSrc.indexOf('async function openSessionCodespaceLoadingWindow(');
    const end = mainSrc.indexOf('function refreshCodespaceLoadingDocuments(', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const helper = mainSrc.slice(start, end);
    expect(helper).toContain('partition: `persist:redeven-code:${identity}`');
    expect(helper).toContain('sessionPartition: state.partition');
    expect(helper).toContain("role: 'codespace_child'");
    expect(helper).toContain("chrome: 'native'");
    expect(helper).toContain("preload: 'none'");
    expect(helper).not.toContain('sessionKeyByWebContentsID.set(');
    expect(helper).toContain('state.lifetime.abort()');
    expect(helper).toContain('await gateway.close()');
    expect(helper).toContain('createSessionCodeSpaceRoute(record, codeSpaceID, signal, password)');
    const route = mainSrc.slice(mainSrc.indexOf('async function createSessionCodeSpaceRoute('), start);
    expect(route).toContain("record.transport.kind === 'provider_remote'");
    expect(route).toContain('createRemoteNativeCodeSpaceRoute(');
    expect(route).toContain('createLocalNativeCodeSpaceRoute(');
    expect(helper.indexOf('const profile = codeSpaceProfiles();')).toBeLessThan(helper.indexOf('const route ='));
    const closing = mainSrc.slice(mainSrc.indexOf('async function finalizeSessionClosure('));
    expect(closing.indexOf('const nativeCodeSpaces = Array.from')).toBeLessThan(closing.indexOf('for (const codespaceWindow'));
    expect(closing).toContain('await state.opening?.catch(() => undefined)');
  });

  it('opens Web Services in a trusted browser shell with bridge-free target views', () => {
    const mainSrc = readMainSource();
    const helperStart = mainSrc.indexOf('async function prepareWebServiceWindowPartition(');
    const helperEnd = mainSrc.indexOf('function sessionOpenFailureMessage(', helperStart);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperSrc = mainSrc.slice(helperStart, helperEnd);
    expect(helperSrc).toContain('const webSession = session.fromPartition(partition);');
    expect(helperSrc).toContain('await webSession.setProxy({ mode: sessionRecord.transport.proxyPolicy });');
    expect(helperSrc.indexOf('await prepareWebServiceWindowPartition(sessionRecord, partition, request.forward_id, loopbackGateway);')).toBeLessThan(
      helperSrc.indexOf('const controller = createWebServiceBrowserController(sessionRecord, request, partition, loopbackGateway);'),
    );
    expect(helperSrc).toContain("role: 'web_service_child'");
    expect(helperSrc).toContain("preload: 'web_service_browser'");
    expect(helperSrc).not.toContain("chrome: 'native'");
    expect(helperSrc).toContain('const contentView = new WebContentsView({');
    expect(helperSrc).toContain('const contentViewIdentity = snapshotWebContentsIdentity(contentView.webContents);');
    expect(helperSrc).toContain(
      'sessionKeyByWebContentsID.set(contentViewIdentity.webContentsID, sessionRecord.session_key);',
    );
    expect(helperSrc).toContain('sessionKeyByWebContentsID.delete(contentViewIdentity.webContentsID);');
    expect(helperSrc).toContain('partition,');
    expect(helperSrc).toContain('sandbox: true,');
    expect(helperSrc).toContain('contextIsolation: true,');
    expect(helperSrc).toContain('nodeIntegration: false,');
    expect(helperSrc).toContain('resolveWebServiceBrowserAddress(');
    expect(helperSrc).toContain('webServiceBrowserDisplayURL(routeAddress, request.target_url, request.forward_id)');
    expect(helperSrc).toContain('request.target_url,');
    expect(helperSrc).toContain('DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL');
    expect(helperSrc).toContain(
      'isAllowedWebServiceWindowNavigation(targetURL, sessionRecord.allowed_base_url, request.forward_id)',
    );
    expect(helperSrc).toContain("case 'open_external':");
    expect(helperSrc).toContain("case 'toggle_devtools':");
    expect(helperSrc).toContain("contentView.webContents.openDevTools({ mode: 'detach' });");
    expect(helperSrc).toContain("contentView.webContents.on('before-input-event', handleDevToolsShortcut);");
    expect(helperSrc).toContain('isMarkedWebServiceUpstreamUnavailable(details)');
    expect(helperSrc).toContain('webServiceUnavailableDocumentURL(targetAddress)');
    expect(helperSrc).toContain('callback({ cancel: true });');
    expect(helperSrc).toContain('WEB_SERVICE_BROWSER_RETRY_FEEDBACK_MS');
    expect(helperSrc).toContain('const refreshUnavailableTheme = (): void => {');
    expect(helperSrc).not.toContain('void win.loadURL(webServiceBrowserDocumentURL());');
    expect(helperSrc).toContain('unavailablePageURL = webServiceUnavailableDocumentURL(targetAddress);');
    expect(helperSrc).toContain('if (unavailablePageURL !== retryPageURL) return;');
    expect(helperSrc).toContain('if (contentView.webContents.getURL() !== `${retryPageURL}#retry`) return;');
    expect(helperSrc).toContain('await openWebServiceInSystemBrowser({');
    expect(helperSrc).toContain('bridgeBaseURL: sessionRecord.startup.local_ui_bridge_url,');
    expect(helperSrc).toContain('bridgeToken: sessionRecord.startup.local_ui_bridge_token,');
    expect(helperSrc).not.toContain('|| currentRouteURL');
    expect(helperSrc).not.toContain('webServiceBrowserExternalURL(');
    expect(helperSrc).toContain('blockExternalNavigation(url);');
    expect(helperSrc).toContain('blockExternalNavigation(targetURL);');
    expect(helperSrc).not.toContain(".t('webServiceBrowser.blockedNavigation')");
    expect(helperSrc).not.toContain('else openExternal(url);');
    expect(helperSrc).not.toContain('openExternal(targetURL);');
    expect(helperSrc).toContain('webSession.clearStorageData()');
    expect(helperSrc).toContain('webSession.clearCache()');
    expect(helperSrc).toContain('current?.webContentsID !== closedWindow.webContentsID');
    expect(helperSrc).toContain('clearWebServiceWindowPartition(partition);');
    expect(helperSrc).toContain('routeWebServiceTargetRequest(');
    expect(helperSrc).toContain('callback(redirectURL ? { redirectURL } : {});');
    expect(helperSrc).toContain('webSession.webRequest.onBeforeRequest(null);');
    expect(helperSrc).toContain('webSession.webRequest.onBeforeSendHeaders(null);');
    expect(helperSrc).toContain('webSession.webRequest.onHeadersReceived(null);');
    expect(helperSrc).toContain('webSession.webRequest.onCompleted(null);');
    expect(helperSrc).toContain('webSession.webRequest.onErrorOccurred(null);');
    expect(helperSrc).not.toContain('sessionRecord.session_partition');
  });

  it('keeps the codespace loading document local, scriptless, and bridge-free', () => {
    const mainSrc = readMainSource();
    const helperSrc = readMainModuleSource('codespaceLoadingDocument.ts');
    expect(mainSrc).toContain("from './codespaceLoadingDocument';");
    expect(helperSrc).toContain('data:text/html;charset=utf-8');
    expect(helperSrc).toContain('Content-Security-Policy');
    expect(helperSrc).toContain("default-src 'none'");
    expect(helperSrc).toContain("script-src 'none'");
    expect(helperSrc).toContain('redeven-loading-curtain__panel');
    expect(helperSrc).toContain('redeven-loading-curtain__indicator');
    expect(helperSrc).toContain('redeven-loading-curtain__message');
    expect(helperSrc).toContain('Redeven');
    expect(helperSrc).not.toContain('Attention required');
    expect(helperSrc).not.toContain('<script');
    expect(helperSrc).not.toContain('redevenDesktopShell');
    expect(helperSrc).not.toContain('preload');
  });

  it('refreshes tracked local documents after a theme change', () => {
    const mainSrc = readMainSource();
    const helperStart = mainSrc.indexOf('function refreshCodespaceLoadingDocuments(');
    const helperEnd = mainSrc.indexOf('function openCodespaceWindowFromShell(', helperStart);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperSrc = mainSrc.slice(helperStart, helperEnd);
    expect(mainSrc).toContain('refreshCodespaceLoadingDocuments();');
    expect(mainSrc).toContain('refreshWebServiceUnavailableDocuments();');
    expect(helperSrc).toContain('for (const [codeSpaceID, copy] of sessionRecord.codespace_loading_documents)');
    expect(helperSrc).toContain('buildCodespaceLoadingDocumentURL(codeSpaceID, themeSnapshot, copy)');
    expect(helperSrc).not.toContain('for (const [codeSpaceID, codespaceWindow] of sessionRecord.codespace_windows)');
  });

  it('admits codespace opening only from the environment root frame and resolves routes in main', () => {
    const mainSrc = readMainSource();
    const start = mainSrc.indexOf('ipcMain.handle(DESKTOP_SHELL_OPEN_CODESPACE_WINDOW_CHANNEL');
    const end = mainSrc.indexOf('ipcMain.handle(DESKTOP_SHELL_OPEN_WEB_SERVICE_WINDOW_CHANNEL', start);
    const handler = mainSrc.slice(start, end);
    expect(handler).toContain('normalizeDesktopShellOpenCodespaceWindowRequest(request)');
    expect(handler).toContain('sessionRecordForWebContentsID(event.sender.id)');
    expect(handler).toContain('event.senderFrame !== event.sender.mainFrame');
    expect(handler).toContain('record.root_window.webContentsID !== event.sender.id');
    const helperStart = mainSrc.indexOf('async function openCodespaceWindowFromShell(');
    const helperEnd = mainSrc.indexOf('async function prepareWebServiceWindowPartition(', helperStart);
    const helper = mainSrc.slice(helperStart, helperEnd);
    expect(helper).toContain('!record || record.closing');
    expect(helper).toContain('openSessionCodespaceLoadingWindow(record.session_key, request.code_space_id');
    expect(helper).toContain('prepareSessionNativeCodeSpace(record, request.code_space_id, request.password)');
    expect(helper).not.toContain('request.url');
  });

  it('models Refresh Gateway as one visible launcher workflow with internal service, package, pairing, and catalog stages', () => {
    const mainSrc = readMainSource();
    const stepsStart = mainSrc.indexOf('const GATEWAY_REFRESH_WORKFLOW_STEPS');
    const stepsEnd = mainSrc.indexOf('function gatewayStepProgress(', stepsStart);
    expect(stepsStart).toBeGreaterThanOrEqual(0);
    expect(stepsEnd).toBeGreaterThan(stepsStart);
    const stepsSrc = mainSrc.slice(stepsStart, stepsEnd);

    expect(stepsSrc).toContain(
      "id: 'checking_gateway_service', label: 'Checking Gateway service', labelKey: 'progress.checkingGatewayService'",
    );
    expect(stepsSrc).toContain(
      "id: 'checking_gateway_package', label: 'Checking Gateway package', labelKey: 'progress.checkingGatewayVersion'",
    );
    expect(stepsSrc).toContain(
      "id: 'fetching_pairing_challenge', label: 'Fetching pairing challenge', labelKey: 'progress.checkingGatewayTrust'",
    );
    expect(stepsSrc).toContain(
      "id: 'saving_trust_profile', label: 'Saving trust profile', labelKey: 'progress.checkingGatewayTrust'",
    );
    expect(stepsSrc).toContain(
      "id: 'refreshing_gateway_catalog', label: 'Refreshing Gateway catalog', labelKey: 'progress.checkingGatewayCatalog'",
    );
    expect(stepsSrc).toContain(
      "id: 'gateway_refreshed', label: 'Gateway refreshed', labelKey: 'progress.gatewayChecked'",
    );
    expect(mainSrc).not.toContain('const GATEWAY_CHECK_WORKFLOW_STEPS');
    expect(mainSrc).not.toContain('const GATEWAY_PAIR_WORKFLOW_STEPS');
  });

  it('records Gateway Refresh probe results as diagnosis facts without exposing Check, Sync, Pair, or Review Trust recoveries', () => {
    const mainSrc = readMainSource();
    const helperStart = mainSrc.indexOf('function gatewayProbeResultsForDiagnosis(');
    const helperEnd = mainSrc.indexOf('function completeGatewayDiagnosis(', helperStart);
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperSrc = mainSrc.slice(helperStart, helperEnd);

    expect(helperSrc).toContain("serviceStatus === 'service_needs_update' || reinstallRequired");
    expect(helperSrc).toContain("serviceWarning ? 'warning'");
    expect(helperSrc).not.toContain("serviceWarning ? 'unknown'");
    expect(helperSrc).toContain(
      "const catalogSkipped = diagnosis.catalog_state === 'idle' || diagnosis.catalog_state === 'pairing_failed';",
    );
    expect(helperSrc).toContain("trustFailed || pairingFailed || catalogSkipped ? 'skipped' : 'passed'");
    expect(helperSrc).toContain("id: 'gateway_service'");
    expect(helperSrc).toContain("id: 'gateway_version'");
    expect(helperSrc).toContain("id: 'gateway_trust'");
    expect(helperSrc).toContain("id: 'gateway_catalog'");
    expect(helperSrc).not.toContain("label: 'Check Gateway'");
    expect(helperSrc).not.toContain("label: 'Sync Gateway'");
    expect(helperSrc).not.toContain("label: 'Pair Gateway'");
    expect(helperSrc).not.toContain("label: 'Review Trust'");
  });

  it('does not expose Gateway service lifecycle recovery actions', () => {
    const mainSrc = readMainSource();
    const gatewayTypeSrc = readSharedGatewaySource();
    const nextActionsStart = mainSrc.indexOf('function gatewayDiagnosisNextActions(');
    const nextActionsEnd = mainSrc.indexOf('function gatewayFailureTitleKeyForDiagnosis(', nextActionsStart);
    expect(nextActionsStart).toBeGreaterThanOrEqual(0);
    expect(nextActionsEnd).toBeGreaterThan(nextActionsStart);
    const nextActionsSrc = mainSrc.slice(nextActionsStart, nextActionsEnd);

    expect(gatewayTypeSrc).not.toContain('recommended_recovery?:');
    expect(mainSrc).not.toContain('gatewayRecommendedRecoveryForDiagnosis');
    expect(mainSrc).not.toContain("recommended_recovery: 'start_gateway'");
    expect(mainSrc).not.toContain("recommended_recovery: 'restart_gateway'");
    expect(mainSrc).not.toContain("recommended_recovery: 'update_gateway'");
    expect(nextActionsSrc).not.toContain("kind: 'start_gateway'");
    expect(nextActionsSrc).not.toContain("kind: 'restart_gateway'");
    expect(nextActionsSrc).not.toContain("kind: 'update_gateway'");
    expect(nextActionsSrc).not.toContain("kind: 'check_gateway'");
    expect(nextActionsSrc).not.toContain("kind: 'refresh_gateway_catalog'");
    expect(nextActionsSrc).not.toContain("kind: 'resolve_gateway'");
    expect(mainSrc).not.toContain('recommended_action');
    expect(mainSrc).not.toContain("recommended_recovery: 'review_trust'");
    expect(mainSrc).not.toContain("label: 'Review Trust'");
  });

  it('treats Gateway authorization rejection as facts-only pairing state unless the managed package is stale', () => {
    const mainSrc = readMainSource();
    const gatewayTypeSrc = readSharedGatewaySource();
    const syncStateStart = mainSrc.indexOf('function gatewayClientErrorIsPairingRejected(');
    const syncStateEnd = mainSrc.indexOf('function gatewaySyncRecordFromError(', syncStateStart);
    expect(syncStateStart).toBeGreaterThanOrEqual(0);
    expect(syncStateEnd).toBeGreaterThan(syncStateStart);
    const pairingHelperSrc = mainSrc.slice(syncStateStart, syncStateEnd);

    expect(pairingHelperSrc).toContain("code === 'UNAUTHORIZED'");
    expect(pairingHelperSrc).toContain("message.includes('pair this gateway before')");
    expect(pairingHelperSrc).not.toContain("code === 'GATEWAY_TRUST_CHANGED'");

    const diagnosisStart = mainSrc.indexOf('function gatewayDiagnosisForError(');
    const diagnosisEnd = mainSrc.indexOf('async function checkGatewayRecord(', diagnosisStart);
    expect(diagnosisStart).toBeGreaterThanOrEqual(0);
    expect(diagnosisEnd).toBeGreaterThan(diagnosisStart);
    const diagnosisSrc = mainSrc.slice(diagnosisStart, diagnosisEnd);

    expect(gatewayTypeSrc).toContain('package_status?:');
    expect(gatewayTypeSrc).toContain('target_version?: string;');
    expect(gatewayTypeSrc).toContain('target_commit?: string;');
    expect(mainSrc).toContain('target_commit: bundle.commit');
    expect(mainSrc).toContain('function gatewayManagedProbeNeedsUpdate(');
    expect(diagnosisSrc).toContain('if (gatewayClientErrorIsPairingRejected(error)) {');
    expect(diagnosisSrc).toContain('if (gatewayManagedProbeNeedsUpdate(managedProbe)) {');
    expect(diagnosisSrc).toContain("classification: 'needs_update'");
    expect(diagnosisSrc).toContain("catalog_state: 'pairing_failed'");
    expect(diagnosisSrc).toContain("classification: 'pairing_required'");
    expect(diagnosisSrc).not.toContain("recommended_recovery: 'review_trust'");
    expect(diagnosisSrc.indexOf('if (gatewayClientErrorIsPairingRejected(error)) {')).toBeLessThan(
      diagnosisSrc.indexOf(
        "classification: manageable && serviceState?.status === 'ready' ? 'service_ready_catalog_failed' : 'catalog_failed'",
      ),
    );
  });

  it('keeps Gateway protocol mismatches separate from pairing, trust, reachability, and Runtime compatibility', () => {
    const mainSrc = readMainSource();
    const diagnosisStart = mainSrc.indexOf('function gatewayDiagnosisForError(');
    const diagnosisEnd = mainSrc.indexOf('async function checkGatewayRecord(', diagnosisStart);
    expect(diagnosisStart).toBeGreaterThanOrEqual(0);
    expect(diagnosisEnd).toBeGreaterThan(diagnosisStart);
    const diagnosisSrc = mainSrc.slice(diagnosisStart, diagnosisEnd);
    const protocolStart = diagnosisSrc.indexOf("error.code === 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED'");
    const protocolEnd = diagnosisSrc.indexOf('classification: manageable && serviceState?.status', protocolStart);
    expect(protocolStart).toBeGreaterThanOrEqual(0);
    expect(protocolEnd).toBeGreaterThan(protocolStart);
    const protocolSrc = diagnosisSrc.slice(protocolStart, protocolEnd);

    expect(protocolSrc).toContain("classification: manageable ? 'needs_reinstall' : 'catalog_failed'");
    expect(protocolSrc).toContain("catalog_state: 'catalog_failed'");
    expect(protocolSrc).toContain("error.code === 'GATEWAY_INVALID_RESPONSE'");
    expect(protocolSrc).toContain("error.code === 'GATEWAY_RUNTIME_CAPABILITY_INVALID'");
    expect(protocolSrc).toContain(
      "summary: manageable ? 'Gateway requires host maintenance' : 'Gateway response is incompatible'",
    );
    expect(protocolSrc).not.toContain("catalog_state: 'pairing_failed'");
    expect(protocolSrc).not.toContain("classification: 'pairing_required'");
    expect(protocolSrc).not.toContain("classification: 'identity_changed'");
    expect(protocolSrc).not.toContain("classification: 'ssh_unreachable'");
    expect(protocolSrc).not.toContain('Runtime Service');
    expect(protocolSrc).not.toContain('compatibility');
  });

  it('invalidates cached Gateway catalog entries after protocol mismatches', () => {
    const mainSrc = readMainSource();
    const syncStart = mainSrc.indexOf('function gatewaySyncRecordFromError(');
    const syncEnd = mainSrc.indexOf('function gatewayServiceStateInvalidatesCatalog(', syncStart);
    expect(syncStart).toBeGreaterThanOrEqual(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const syncSrc = mainSrc.slice(syncStart, syncEnd);

    expect(syncSrc).toContain('const invalidateCatalog = gatewayErrorInvalidatesCatalog(error, serviceState);');
    expect(syncSrc).toContain(
      'environments: invalidateCatalog ? [] : previous.source?.environments ?? errorSource.environments',
    );
    expect(syncSrc).toContain(
      'capabilities: invalidateCatalog ? [] : previous.source?.capabilities ?? errorSource.capabilities',
    );

    const invalidatesStart = mainSrc.indexOf('function gatewayErrorInvalidatesCatalog(');
    const invalidatesEnd = mainSrc.indexOf('function gatewayCatalogFresh(', invalidatesStart);
    expect(invalidatesStart).toBeGreaterThanOrEqual(0);
    expect(invalidatesEnd).toBeGreaterThan(invalidatesStart);
    const invalidatesSrc = mainSrc.slice(invalidatesStart, invalidatesEnd);

    const serviceInvalidatesStart = mainSrc.indexOf('function gatewayServiceStateInvalidatesCatalog(');
    const serviceInvalidatesEnd = mainSrc.indexOf('function gatewayErrorInvalidatesCatalog(', serviceInvalidatesStart);
    expect(serviceInvalidatesStart).toBeGreaterThanOrEqual(0);
    expect(serviceInvalidatesEnd).toBeGreaterThan(serviceInvalidatesStart);
    const serviceInvalidatesSrc = mainSrc.slice(serviceInvalidatesStart, serviceInvalidatesEnd);

    expect(serviceInvalidatesSrc).toContain("serviceState?.status === 'service_needs_update'");
    expect(serviceInvalidatesSrc).toContain("serviceState?.status === 'needs_reinstall'");
    expect(invalidatesSrc).toContain('gatewayServiceStateInvalidatesCatalog(serviceState)');
    expect(invalidatesSrc).toContain("error.code === 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED'");
    expect(invalidatesSrc).toContain("error.code === 'GATEWAY_INVALID_RESPONSE'");
    expect(invalidatesSrc).toContain("error.code === 'GATEWAY_TRUST_CHANGED'");
    expect(invalidatesSrc).not.toContain("error.code === 'UNAUTHORIZED'");
  });

  it('keeps launcher snapshot construction on the fast in-memory path', () => {
    const mainSrc = readMainSource();
    const snapshotStart = mainSrc.indexOf('async function buildCurrentDesktopWelcomeSnapshot(');
    const snapshotEnd = mainSrc.indexOf('function stampDesktopWelcomeSnapshot(', snapshotStart);
    expect(snapshotStart).toBeGreaterThanOrEqual(0);
    expect(snapshotEnd).toBeGreaterThan(snapshotStart);
    const snapshotSrc = mainSrc.slice(snapshotStart, snapshotEnd);

    expect(snapshotSrc).toContain('welcomeRuntimeHealthStore.prime(');
    expect(snapshotSrc).toContain('buildWelcomeRuntimeHealthTargets(preferences, openSessions)');
    expect(snapshotSrc).toContain('welcomeRuntimeHealthStore.snapshot()');
    expect(snapshotSrc).not.toContain('hydrateWelcomeLocalEnvironmentRuntimeState');
    expect(snapshotSrc).not.toContain('probeManagedSSHRuntimeStatus');
    expect(snapshotSrc).not.toContain('loadExternalLocalUIStartup');
    expect(snapshotSrc).not.toContain('inspectSavedRuntimeTargetState');
    expect(snapshotSrc).not.toContain('queryProviderEnvironmentRuntimeHealth');
    expect(snapshotSrc).not.toContain('refreshAllProviderEnvironmentRuntimeHealth');
  });

  it('prefers an existing bridge before reconciling saved runtime target maintenance', () => {
    const mainSrc = readMainSource();
    const inspectStart = mainSrc.indexOf('async function inspectSavedRuntimeTargetState(');
    const inspectEnd = mainSrc.indexOf('function createInitialLoadDeferred(', inspectStart);
    expect(inspectStart).toBeGreaterThanOrEqual(0);
    expect(inspectEnd).toBeGreaterThan(inspectStart);
    const inspectSrc = mainSrc.slice(inspectStart, inspectEnd);

    expect(mainSrc).toContain('function runtimePlacementMaintenanceForRuntimeService(');
    expect(mainSrc).toContain('runtimePlacementMaintenanceByTargetID.delete(targetID)');
    expect(inspectSrc.indexOf('const bridgeState = await runtimePlacementInspectionFromBridge(target)')).toBeLessThan(
      inspectSrc.indexOf('resolveRuntimeContainerPlacement('),
    );
    expect(inspectSrc).toContain('const status = await probeManagedSSHRuntimeStatus({');
    expect(inspectSrc.indexOf('const status = await probeManagedSSHRuntimeStatus({')).toBeLessThan(
      inspectSrc.indexOf('resolveRuntimeContainerPlacement('),
    );
    expect(inspectSrc).not.toContain(
      'const bridgeRecord = runtimePlacementBridgeByTargetID.get(target.targetID) ?? null',
    );
    expect(inspectSrc).toContain('await clearRuntimePlacementTargetRecords(target.targetID)');
    expect(inspectSrc).not.toContain(
      'const cachedReadyRecord = runtimePlacementReadyByTargetID.get(target.targetID) ?? null',
    );
    expect(inspectSrc).not.toContain('cachedReadyRecord.startup');
    expect(inspectSrc).toContain('runtimePlacementReadyByTargetID.delete(target.targetID)');
    expect(inspectSrc).toContain(
      'const maintenance = runtimePlacementMaintenanceForRuntimeService(target.targetID, report.startup.runtime_service);',
    );
    expect(inspectSrc).not.toContain(
      'maintenance: maintenance && !runtimeServiceIsOpenable(report.startup.runtime_service)',
    );
  });

  it('does not publish stale runtime target presence for offline probes', () => {
    const mainSrc = readMainSource();
    const probeStart = mainSrc.indexOf('async function probeSavedRuntimeTargetHealth(');
    const probeEnd = mainSrc.indexOf('function buildWelcomeRuntimeHealthTargets(', probeStart);
    expect(probeStart).toBeGreaterThanOrEqual(0);
    expect(probeEnd).toBeGreaterThan(probeStart);
    const probeSrc = mainSrc.slice(probeStart, probeEnd);

    expect(probeSrc).toContain('if (!state.running)');
    expect(probeSrc.indexOf('if (!state.running)')).toBeLessThan(
      probeSrc.indexOf('presence: runtimeTargetPresenceFromState(target, state)'),
    );
    expect(probeSrc).toContain('health: runtimeTargetHealthFromState(target, state)');
    expect(mainSrc).toContain('runtime_pid: state.startup.pid');
    expect(mainSrc).toContain('started_at_unix_ms: state.startup.started_at_unix_ms');
  });

  it('lets dev SSH bootstrap use an explicit runtime release tag without changing the bundled runtime version', () => {
    const mainSrc = readMainSource();
    const bundleVersionStart = mainSrc.indexOf('function resolveDesktopBundleVersion()');
    const bundleVersionEnd = mainSrc.indexOf('function desktopBundleTarget()', bundleVersionStart);
    const bundleVersionSrc = mainSrc.slice(bundleVersionStart, bundleVersionEnd);
    const sshVersionStart = mainSrc.indexOf('function resolveSSHRuntimeReleaseTag()');
    const sshVersionEnd = mainSrc.indexOf('function desktopRuntimePackageCacheRoot()', sshVersionStart);
    const sshVersionSrc = mainSrc.slice(sshVersionStart, sshVersionEnd);

    expect(bundleVersionSrc).toContain('process.env.REDEVEN_DESKTOP_BUNDLE_VERSION');
    expect(bundleVersionSrc).not.toContain('REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG');
    expect(sshVersionSrc).toContain('process.env.REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG');
    expect(sshVersionSrc).toContain('process.env.REDEVEN_DESKTOP_BUNDLE_VERSION');
    expect(sshVersionSrc).toContain('Set REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG for dev SSH bootstrap');
  });

  it('routes runtime lifecycle and Open connection progress through cancellable launcher operations', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL');
    expect(mainSrc).toContain(
      'const launcherOperations = new LauncherOperationRegistry(handleLauncherOperationChange);',
    );
    expect(mainSrc).toContain('actionProgress: launcherOperations.progressItems()');
    expect(mainSrc).toContain('operations: launcherOperations.operations()');
    expect(mainSrc).toContain('desktopRuntimeLifecycleLocation');
    expect(mainSrc).not.toContain('buildRuntimeLifecycleProgress');
    expect(mainSrc).toContain('updateRuntimeLifecycleOperation');
    expect(mainSrc).toContain('RuntimeLifecycleWorkflow');
    expect(mainSrc).toContain('runtimeLifecyclePlanIncludingStep');
    expect(mainSrc).not.toContain('commitRuntimeLifecycleDecision');
    expect(mainSrc).toContain('runtimeLifecycleWorkflowFailure');
    expect(mainSrc).toContain('currentRuntimeLifecycleWorkflowProgress');
    expect(mainSrc).not.toContain('runtimeLifecycleWorkflowAcceptsPhase');
    expect(mainSrc).not.toContain('currentRuntimeLifecyclePhase');
    expect(mainSrc).not.toContain('lifecycleProgress.stage_index < current.lifecycle_progress.stage_index');
    expect(mainSrc).not.toContain('lifecycle_progress: runtimeLifecycleProgress({');
    expect(mainSrc).not.toContain('runtimeLifecyclePhaseSequence');
    expect(mainSrc).not.toContain('async function startLocalHostRuntimeWithLifecycleProgress(');
    expect(mainSrc).toContain("subject_kind: 'runtime_target'");
    expect(mainSrc).toContain('operation_key: operationKey');
    expect(mainSrc).toContain('open_progress: buildOpenConnectionProgress(input)');
    expect(mainSrc).not.toContain('interrupt_label:');
    expect(mainSrc).not.toContain('interrupt_detail:');
    expect(mainSrc).not.toContain('interrupt_kind:');
    expect(mainSrc).toContain('const runtimeLifecycleCoordinator = new RuntimeLifecycleCoordinator();');
    expect(mainSrc).toContain('runtimeLifecycleCoordinator.run({');
    expect(mainSrc).toContain('runtimeLifecycleCoordinator.waitForReadyMutation<DesktopLauncherActionResult>(');
    expect(mainSrc).toContain('runtimeLifecycleCoordinator.runOpen({');
    expect(mainSrc).not.toContain('runtimeLifecycleCoordinator.runWhenReady({');
    expect(mainSrc).toContain('snapshot.operation_key !== preservedOperationKey');
    expect(mainSrc).toContain('preserved_open_operation_key: input.operation_key');
    expect(mainSrc).toContain('const executeAcceptedOperation = async (lifecycleSignal: AbortSignal)');
    expect(mainSrc).toContain('execute: executeAcceptedOperation');
    expect(mainSrc).toContain("openOwner?.intent !== 'open'");
    expect(mainSrc).toContain('openOwner.operation_key !== operationKey');
    expect(mainSrc).toContain(
      'retireSupersededEnvironmentOperations([input.environment_id], input.operation_key)',
    );
    expect(mainSrc).toContain("intent: 'reinstall'");
    expect(mainSrc).not.toContain('Redeven reinstall is taking ownership of this target.');
    expect(mainSrc).not.toContain('pendingSSHRuntimeStartByKey');
    expect(mainSrc).not.toContain('pendingRuntimePlacementStartByTargetID');
    expect(mainSrc).not.toContain('pendingLocalHostRuntimeStartByTargetID');
    expect(mainSrc).toContain('const sshRuntimeMaintenanceByKey = new Map');
    expect(mainSrc).toContain('runtime_maintenance: maintenance');
    expect(mainSrc).toContain('sshRuntimeMaintenanceByKey.delete(runtimeKey)');
    expect(mainSrc).toContain('const operation = launcherOperations.create({');
    expect(mainSrc).toContain('action,');
    expect(mainSrc).toContain('cancelable: true');
    expect(mainSrc).toContain('signal,');
    expect(mainSrc).toContain(
      'const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;',
    );
    expect(mainSrc).toContain('environment_label: label');
    expect(mainSrc).toContain('detail: progress.detail');
    const executeDirectLifecycleStart = mainSrc.indexOf('async function executeDirectManagedEnvironmentLifecycle(');
    const executeDirectLifecycleEnd = mainSrc.indexOf(
      'async function runEnvironmentRuntimeLifecycleFromLauncher(',
      executeDirectLifecycleStart,
    );
    const executeDirectLifecycleSrc = mainSrc.slice(executeDirectLifecycleStart, executeDirectLifecycleEnd);
    expect(executeDirectLifecycleSrc).not.toContain('runtimeLifecycleCoordinator.run({');
    expect(executeDirectLifecycleSrc).not.toContain('launcherOperations.create({');
    const directLifecycleStart = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(');
    const directLifecycleEnd = mainSrc.indexOf(
      'async function startEnvironmentRuntimeFromLauncher(',
      directLifecycleStart,
    );
    const directLifecycleSrc = mainSrc.slice(directLifecycleStart, directLifecycleEnd);
    expect(directLifecycleSrc).not.toContain('const launch = await startManagedRuntime({');
    expect(directLifecycleSrc).toContain('const executeAcceptedOperation = async (lifecycleSignal: AbortSignal)');
    expect(directLifecycleSrc).toContain('launcherOperations.create({');
    expect(directLifecycleSrc).toContain('return await runtimeLifecycleCoordinator.run({');
    expect(directLifecycleSrc).toContain('execute: executeAcceptedOperation');
    const refreshLifecycleStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshLifecycleEnd = mainSrc.indexOf(
      'async function refreshAllEnvironmentRuntimesFromLauncher(',
      refreshLifecycleStart,
    );
    const refreshLifecycleSrc = mainSrc.slice(refreshLifecycleStart, refreshLifecycleEnd);
    expect(refreshLifecycleSrc).toContain('const executeAcceptedOperation = async (signal: AbortSignal)');
    expect(refreshLifecycleSrc).toContain('const operation = launcherOperations.create({');
    expect(refreshLifecycleSrc).toContain('return await runtimeLifecycleCoordinator.run({');
    expect(refreshLifecycleSrc).toContain('execute: executeAcceptedOperation');
    expect(mainSrc).toContain('const startedAtUnixMs = snapshot?.started_at_unix_ms;');
    expect(mainSrc).toContain('current?.started_at_unix_ms !== startedAtUnixMs');
    expect(mainSrc).toContain('function desktopFailureFromError(');
    expect(mainSrc).toContain('operationFailureFromUnknown(error, desktopOperationFailurePresentation({');
    expect(mainSrc).not.toContain('function friendlyRuntimeStartErrorMessage(');
    expect(mainSrc).not.toContain('firstDisplayLine(');
    expect(mainSrc).not.toContain(['The SSH host resolved its runtime directory to', '/root'].join(' '));
  });

  it('observes runtime liveness without taking bridge lifecycle ownership', () => {
    const mainSrc = readMainSource();

    const providerStart = mainSrc.indexOf('async function resolveProviderRuntimeLinkTarget(');
    const providerEnd = mainSrc.indexOf('function updateProviderRuntimeTargetStartup(', providerStart);
    expect(providerStart).toBeGreaterThanOrEqual(0);
    expect(providerEnd).toBeGreaterThan(providerStart);
    const providerSrc = mainSrc.slice(providerStart, providerEnd);
    expect(providerSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(runtimeKey)');
    expect(providerSrc).toContain('if (!desktopPlatformCapabilities.native_host_runtime)');
    expect(providerSrc).toContain('await verifyCurrentLocalEnvironmentRuntimeRecord(preferences.local_environment)');
    expect(providerSrc).not.toContain(
      'const record = currentLocalEnvironmentRuntimeRecord(preferences.local_environment)',
    );

    const providerOccupancyStart = mainSrc.indexOf('async function providerEnvironmentOccupyingRuntime(');
    const providerOccupancyEnd = mainSrc.indexOf('type ProviderDesktopSessionMaterial', providerOccupancyStart);
    expect(providerOccupancyStart).toBeGreaterThanOrEqual(0);
    expect(providerOccupancyEnd).toBeGreaterThan(providerOccupancyStart);
    const providerOccupancySrc = mainSrc.slice(providerOccupancyStart, providerOccupancyEnd);
    expect(providerOccupancySrc).toContain('preferences: DesktopPreferences');
    expect(providerOccupancySrc).toContain('desktopPlatformCapabilities.native_host_runtime');
    expect(providerOccupancySrc).toContain('providerRuntimeLinkKindForHostAccess(record.session.host_access)');
    expect(providerOccupancySrc).toContain(
      'await verifyCurrentLocalEnvironmentRuntimeRecord(preferences.local_environment)',
    );
    expect(providerOccupancySrc).toContain('await observeRuntimePlacementBridgeRecord(targetID)');
    expect(providerOccupancySrc).not.toContain('if (localEnvironmentRuntimeRecord)');
    expect(providerOccupancySrc).not.toContain('runtimePlacementBridgeByTargetID');

    const healthTargetsStart = mainSrc.indexOf('function buildWelcomeRuntimeHealthTargets(');
    const healthTargetsEnd = mainSrc.indexOf('function scheduleWelcomeRuntimeHealthRefresh(', healthTargetsStart);
    const healthTargetsSrc = mainSrc.slice(healthTargetsStart, healthTargetsEnd);
    expect(healthTargetsSrc).toContain("target.host_access.kind !== 'local_host'");
    expect(healthTargetsSrc).toContain("hostAccess.kind === 'wsl_host'");
    expect(healthTargetsSrc).toContain("distribution.state === 'running'");

    const refreshStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshEnd = mainSrc.indexOf('async function connectEnvironmentRuntimeFromLauncher(', refreshStart);
    const refreshSrc = mainSrc.slice(refreshStart, refreshEnd);
    expect(refreshSrc).toContain("} else if (hostAccess.kind === 'wsl_host') {");
    expect(refreshSrc).toContain('runtimePlacementReadyByTargetID.get(targetID)');
    expect(refreshSrc).toContain('desktopPlatformCapabilities.native_host_runtime && localEnvironment?.local_hosting');

    const localRecordVerifyStart = mainSrc.indexOf('async function verifyLocalEnvironmentRuntimeRecord(');
    const localRecordVerifyEnd = mainSrc.indexOf('function providerRuntimeHealthMap(', localRecordVerifyStart);
    expect(localRecordVerifyStart).toBeGreaterThanOrEqual(0);
    expect(localRecordVerifyEnd).toBeGreaterThan(localRecordVerifyStart);
    const localRecordVerifySrc = mainSrc.slice(localRecordVerifyStart, localRecordVerifyEnd);
    expect(localRecordVerifySrc).toContain(
      'started_at_unix_ms: startup.started_at_unix_ms ?? record.startup.started_at_unix_ms',
    );
    expect(localRecordVerifySrc).not.toContain('started_at_unix_ms: record.startup.started_at_unix_ms');

    const bridgeRecordObserveStart = mainSrc.indexOf('async function observeRuntimePlacementBridgeRecord(');
    const bridgeRecordObserveEnd = mainSrc.indexOf('function clearSSHRuntimeReadyState(', bridgeRecordObserveStart);
    expect(bridgeRecordObserveStart).toBeGreaterThanOrEqual(0);
    expect(bridgeRecordObserveEnd).toBeGreaterThan(bridgeRecordObserveStart);
    const bridgeRecordObserveSrc = mainSrc.slice(bridgeRecordObserveStart, bridgeRecordObserveEnd);
    const bridgeObservationModuleSrc = readMainModuleSource('runtimePlacementBridgeObservation.ts');
    expect(bridgeRecordObserveSrc).toContain('return observeRuntimePlacementBridge(');
    expect(bridgeObservationModuleSrc).toContain('bridgeRecord.session.getRecoverySnapshot()');
    expect(bridgeObservationModuleSrc).toContain(
      "beforeProbe.phase === 'waiting' || beforeProbe.phase === 'connecting'",
    );
    expect(bridgeObservationModuleSrc).toContain('const result = await probe(bridgeRecord);');
    expect(bridgeObservationModuleSrc).toContain('registry.updateIfCurrent(');
    expect(bridgeObservationModuleSrc).not.toContain('.retire(');

    const runtimeTargetProbeStart = mainSrc.indexOf('async function probeSavedRuntimeTargetHealth(');
    const runtimeTargetProbeEnd = mainSrc.indexOf(
      'function welcomeRuntimeProbeCoordinatorKey(',
      runtimeTargetProbeStart,
    );
    expect(runtimeTargetProbeStart).toBeGreaterThanOrEqual(0);
    expect(runtimeTargetProbeEnd).toBeGreaterThan(runtimeTargetProbeStart);
    const runtimeTargetProbeSrc = mainSrc.slice(runtimeTargetProbeStart, runtimeTargetProbeEnd);
    expect(runtimeTargetProbeSrc).toContain('const state = await inspectSavedRuntimeTargetState(target);');
    expect(runtimeTargetProbeSrc).toContain('runtimeTargetHealthFromState(target, state)');
    expect(runtimeTargetProbeSrc).toContain('runtimeTargetPresenceFromState(target, state)');

    const openSSHStart = mainSrc.indexOf('async function openSSHEnvironmentFromLauncher(');
    const openSSHEnd = mainSrc.indexOf('function thrownLauncherActionFailure(', openSSHStart);
    expect(openSSHStart).toBeGreaterThanOrEqual(0);
    expect(openSSHEnd).toBeGreaterThan(openSSHStart);
    const openSSHSrc = mainSrc.slice(openSSHStart, openSSHEnd);
    expect(openSSHSrc).toContain('const bridgeOpenResult = await openRuntimePlacementBridgeFromLauncher(request);');
    expect(openSSHSrc).toContain('return bridgeOpenResult;');
    expect(openSSHSrc).not.toContain('sshRuntimeReadyByKey');
    expect(openSSHSrc).not.toContain('probeManagedSSHRuntimeStatus');
    expect(mainSrc).toContain('if (!sessionRecord.env_app_ready) {');
    expect(mainSrc).not.toContain('desktop_model_source_settled');
    expect(mainSrc).toContain('resolveSessionInitialLoadWhenReady(sessionRecord);');
    expect(mainSrc).toContain("'environment_open_timing'");
    expect(mainSrc).toContain('launcher_phases: operation?.open_timing?.completed_phases.map((phase) => ({');
    const appReadyGateStart = mainSrc.indexOf('function markSessionAppReady(');
    const appReadyGateEnd = mainSrc.indexOf('async function failOpeningSession(', appReadyGateStart);
    const appReadyGateSrc = mainSrc.slice(appReadyGateStart, appReadyGateEnd);
    expect(appReadyGateSrc).toContain('sessionRecord.env_app_ready = true;');
    expect(appReadyGateSrc).toContain('resolveSessionInitialLoadWhenReady(sessionRecord);');
    expect(appReadyGateSrc).not.toContain('presentAppWindow(');
    const bridgeOpenStart = mainSrc.indexOf('async function openRuntimePlacementBridgeFromLauncher(');
    const bridgeOpenEnd = mainSrc.indexOf(
      'async function runEnvironmentRuntimeLifecycleFromLauncher(',
      bridgeOpenStart,
    );
    const bridgeOpenSrc = mainSrc.slice(bridgeOpenStart, bridgeOpenEnd);
    expect(bridgeOpenSrc).toContain('const desktopModelSource = await startDesktopModelSourceForStartup({');
    expect(bridgeOpenSrc).not.toContain('await desktopModelSource.ready');
    expect(bridgeOpenSrc.indexOf('const desktopModelSource = await startDesktopModelSourceForStartup({')).toBeLessThan(
      bridgeOpenSrc.indexOf('sessionRecord = await createSessionRecord(openTarget'),
    );

    expect(mainSrc).not.toContain('async function ensureRuntimePlacementReadyRecordFromLauncher(');
    expect(mainSrc).not.toContain('async function ensureRuntimePlacementReadyRecordFromLauncherUncoordinated(');

    const bridgeHelperStart = mainSrc.indexOf('async function openRuntimePlacementBridgeForReadyRecord(');
    const bridgeHelperEnd = mainSrc.indexOf('type ProviderRuntimeLinkTargetRecord', bridgeHelperStart);
    expect(bridgeHelperStart).toBeGreaterThanOrEqual(0);
    expect(bridgeHelperEnd).toBeGreaterThan(bridgeHelperStart);
    const bridgeHelperSrc = mainSrc.slice(bridgeHelperStart, bridgeHelperEnd);
    expect(bridgeHelperSrc).toContain(
      'await clearRuntimePlacementBridgeRecord(readyRecord.runtime_key as DesktopRuntimeTargetID)',
    );
    expect(bridgeHelperSrc).not.toContain('return existing;');

    const deleteRuntimeTargetStart = mainSrc.indexOf('async function deleteSavedRuntimeTargetFromWelcome(');
    const deleteRuntimeTargetEnd = mainSrc.indexOf(
      'async function listRuntimeContainersFromLauncher(',
      deleteRuntimeTargetStart,
    );
    expect(deleteRuntimeTargetStart).toBeGreaterThanOrEqual(0);
    expect(deleteRuntimeTargetEnd).toBeGreaterThan(deleteRuntimeTargetStart);
    const deleteRuntimeTargetSrc = mainSrc.slice(deleteRuntimeTargetStart, deleteRuntimeTargetEnd);
    expect(deleteRuntimeTargetSrc).toContain('await clearRuntimePlacementTargetRecords(runtimeTargetID)');
    expect(deleteRuntimeTargetSrc).not.toContain('runtimePlacementBridgeByTargetID.get(runtimeTargetID)');
  });

  it('hydrates runtime lifecycle workflows only from active matching launcher attempts', () => {
    const mainSrc = readMainSource();
    const ownerStatusesStart = mainSrc.indexOf('const RUNTIME_LIFECYCLE_WORKFLOW_OWNER_STATUSES');
    const ownerStatusesEnd = mainSrc.indexOf('];', ownerStatusesStart);
    expect(ownerStatusesStart).toBeGreaterThanOrEqual(0);
    expect(ownerStatusesEnd).toBeGreaterThan(ownerStatusesStart);
    const ownerStatusesSrc = mainSrc.slice(ownerStatusesStart, ownerStatusesEnd);

    expect(ownerStatusesSrc).toContain("'running'");
    expect(ownerStatusesSrc).toContain("'canceling'");
    expect(ownerStatusesSrc).toContain("'cleanup_running'");
    expect(ownerStatusesSrc).not.toContain("'succeeded'");
    expect(ownerStatusesSrc).not.toContain("'failed'");
    expect(ownerStatusesSrc).not.toContain("'canceled'");

    const matchStart = mainSrc.indexOf('function runtimeLifecycleAttemptMatchesSnapshot(');
    const matchEnd = mainSrc.indexOf('function runtimeLifecycleWorkflowFromInput(', matchStart);
    expect(matchStart).toBeGreaterThanOrEqual(0);
    expect(matchEnd).toBeGreaterThan(matchStart);
    const matchSrc = mainSrc.slice(matchStart, matchEnd);
    expect(matchSrc).toContain('attempt.workflow.progress().operation !== operation');
    expect(matchSrc).toMatch(/attempt\.action === (snapshot|identity)\.action/u);
    expect(matchSrc).toMatch(/attempt\.started_at_unix_ms === (snapshot|identity)\.started_at_unix_ms/u);

    const workflowStart = mainSrc.indexOf('function runtimeLifecycleWorkflowForOperation(');
    const workflowEnd = mainSrc.indexOf('function runtimeLifecycleWorkflowFailure(', workflowStart);
    expect(workflowStart).toBeGreaterThanOrEqual(0);
    expect(workflowEnd).toBeGreaterThan(workflowStart);
    const workflowSrc = mainSrc.slice(workflowStart, workflowEnd);
    expect(workflowSrc).toContain('runtimeLifecycleWorkflowAttemptsByKey.get(key)');
    expect(workflowSrc).toContain('owner: LauncherOperationAttemptIdentity');
    expect(workflowSrc).toContain('runtimeLifecycleAttemptMatchesIdentity(existing, owner)');
    expect(workflowSrc).toContain('runtimeLifecycleAttemptMatchesSnapshot(existing, snapshot, input.operation)');
    expect(workflowSrc).toContain('runtimeLifecycleWorkflowAttemptsByKey.delete(key)');
    expect(workflowSrc).toContain('const identity = runtimeLifecycleAttemptIdentity(snapshot)');
    expect(workflowSrc).toContain('currentProgress.operation === input.operation');
    expect(workflowSrc).toContain('&& identity');
    expect(workflowSrc).not.toContain(
      'if (currentProgress) {\n    const hydrated = RuntimeLifecycleWorkflow.fromProgress(currentProgress);',
    );

    const updateLifecycleStart = mainSrc.indexOf('function updateRuntimeLifecycleOperation(');
    const updateLifecycleEnd = mainSrc.indexOf(
      'function runtimeLifecyclePhaseFromManagedRuntime(',
      updateLifecycleStart,
    );
    expect(updateLifecycleStart).toBeGreaterThanOrEqual(0);
    expect(updateLifecycleEnd).toBeGreaterThan(updateLifecycleStart);
    const updateLifecycleSrc = mainSrc.slice(updateLifecycleStart, updateLifecycleEnd);
    expect(updateLifecycleSrc).toContain('owner: LauncherOperationAttemptIdentity');
    expect(updateLifecycleSrc).toContain('const currentStepIndex = workflow.currentStepIDs().indexOf(currentStep);');
    expect(updateLifecycleSrc).toContain('const nextStepIndex = workflow.currentStepIDs().indexOf(input.phase);');
    expect(updateLifecycleSrc).toContain('update = workflow.advanceToStep(input.phase, input.detail);');
    expect(updateLifecycleSrc).toContain('launcherOperations.updateCurrentAttempt(operationKey, owner');

    const removalStart = mainSrc.indexOf('function scheduleCurrentLauncherOperationRemoval(');
    const removalEnd = mainSrc.indexOf('function setLauncherViewState(', removalStart);
    expect(removalStart).toBeGreaterThanOrEqual(0);
    expect(removalEnd).toBeGreaterThan(removalStart);
    const removalSrc = mainSrc.slice(removalStart, removalEnd);
    expect(removalSrc).toContain('owner: LauncherOperationAttemptIdentity');
    expect(removalSrc).toContain('const snapshot = launcherOperations.get(operationKey)');
    expect(removalSrc).toContain('launcherOperationMatchesAttempt(snapshot, owner)');
    expect(removalSrc).toContain('const current = launcherOperations.get(cleanOperationKey)');
    expect(removalSrc).toContain('launcherOperationMatchesAttempt(current, owner)');
  });

  it('keeps Managed Environment lifecycle actions on direct Desktop executors', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('DESKTOP_SHELL_RUNTIME_MAINTENANCE_CONTEXT_CHANNEL');
    expect(mainSrc).toContain('DESKTOP_SHELL_RUNTIME_MAINTENANCE_STARTED_CHANNEL');
    expect(mainSrc).toContain('function runtimeMaintenanceContextFromSession(');
    expect(mainSrc).toContain("? 'runtime_direct_setup_required'");
    expect(mainSrc).toContain("readiness: directTarget ? 'setup_required' : 'unknown'");
    expect(mainSrc).toContain('async function manageDesktopUpdateFromLauncher(');
    expect(mainSrc).toContain('async function runEnvironmentRuntimeLifecycleFromLauncher(');
    expect(mainSrc).toContain("case 'manage_desktop_update':");
    expect(mainSrc).toContain("case 'restart_environment_runtime':");
    expect(mainSrc).toContain("launcherActionSuccess('opened_desktop_update_handoff')");

    const directLifecycleStart = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(');
    const directLifecycleEnd = mainSrc.indexOf(
      'async function startEnvironmentRuntimeFromLauncher(',
      directLifecycleStart,
    );
    const directLifecycleSrc = mainSrc.slice(directLifecycleStart, directLifecycleEnd);
    expect(directLifecycleSrc).toContain('executeDirectManagedEnvironmentLifecycle({');
    expect(directLifecycleSrc).not.toContain('upsertDirectRuntimeGateway(');
    expect(directLifecycleSrc).not.toContain('runGatewayEnvironmentLifecycleFromLauncher(');
    expect(directLifecycleSrc).not.toContain('gatewayLifecycleManager().prepareRuntimeOperation(');

    const shellActionStart = mainSrc.indexOf('ipcMain.handle(DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL');
    const shellActionEnd = mainSrc.indexOf(
      'ipcMain.handle(DESKTOP_CODE_WORKSPACE_PACKAGE_PREPARE_CHANNEL',
      shellActionStart,
    );
    const shellActionSrc = mainSrc.slice(shellActionStart, shellActionEnd);
    expect(shellActionSrc).not.toContain("normalized.action === 'restart_managed_runtime'");
    expect(shellActionSrc).toContain("performRuntimeMaintenanceFromShell(event.sender.id, 'restart')");
    expect(shellActionSrc).not.toContain('restartManagedRuntimeFromShell(');

    expect(mainSrc).not.toContain('runProviderEnvironmentLifecycleFromLauncher(');
    expect(mainSrc).not.toContain('authorizeProviderRuntimeOperation(');
    expect(mainSrc).not.toContain('upsertDirectRuntimeGateway(');
  });

  it('uses one localized Desktop update handoff for the Desktop and Local Runtime restart notice', () => {
    const mainSrc = readMainSource();
    const handoffStart = mainSrc.indexOf('async function showDesktopUpdateHandoffDialog()');
    const handoffEnd = mainSrc.indexOf('async function manageDesktopUpdateFromShell(', handoffStart);
    const handoffSrc = mainSrc.slice(handoffStart, handoffEnd);

    expect(handoffStart).toBeGreaterThanOrEqual(0);
    expect(handoffEnd).toBeGreaterThan(handoffStart);
    expect(handoffSrc).toContain("desktopUpdateCoordinator().perform({ kind: 'open_update_ui' });");
    expect(mainSrc.match(/await showDesktopUpdateHandoffDialog\(\);/gu)).toHaveLength(2);
    expect(mainSrc).not.toContain('Manage Desktop Update');
    expect(mainSrc).not.toContain('Environment type:');
    expect(mainSrc).not.toContain('provider-backed Local Environment profile');
  });

  it('prepares Windows Desktop updates without accessing or stopping a WSL Runtime', () => {
    const mainSrc = readMainSource();
    const prepareStart = mainSrc.indexOf('async function prepareDesktopForUpdateInstallation()');
    const prepareEnd = mainSrc.indexOf('function createDesktopUpdateAdapter()', prepareStart);
    expect(prepareStart).toBeGreaterThanOrEqual(0);
    expect(prepareEnd).toBeGreaterThan(prepareStart);
    const prepareSrc = mainSrc.slice(prepareStart, prepareEnd);
    const windowsBoundary = prepareSrc.indexOf('if (!desktopPlatformCapabilities.native_host_runtime)');
    expect(windowsBoundary).toBeGreaterThanOrEqual(0);
    expect(prepareSrc.indexOf('bundledRuntimeExecutablePath()')).toBeGreaterThan(windowsBoundary);
    const windowsSrc = prepareSrc.slice(windowsBoundary, prepareSrc.indexOf('const preferences =', windowsBoundary));
    expect(windowsSrc).toContain('runtimeFlowerAccessCookies.clear();');
    expect(windowsSrc).not.toContain('inspectLocalManagedRuntimeProcesses');
    expect(windowsSrc).not.toContain('stopLocalManagedRuntimeProcesses');
    expect(windowsSrc).not.toContain('createWSLRuntimeHostExecutor');
  });

  it('uses fresh provider health and SSH runtime-affecting settings for launcher routing', () => {
    const mainSrc = readMainSource();
    const routeSnapshotStart = mainSrc.indexOf('function controlPlaneRouteSnapshot(');
    const routeSnapshotEnd = mainSrc.indexOf('function launcherActionFailureForRemoteRouteState', routeSnapshotStart);
    expect(routeSnapshotStart).toBeGreaterThanOrEqual(0);
    expect(routeSnapshotEnd).toBeGreaterThan(routeSnapshotStart);
    const routeSnapshotSrc = mainSrc.slice(routeSnapshotStart, routeSnapshotEnd);
    expect(routeSnapshotSrc).toContain(
      'const summary = controlPlaneSummary(controlPlane, preferences.provider_environments);',
    );
    expect(routeSnapshotSrc).toContain('summary.environments.find');
    expect(routeSnapshotSrc).not.toContain('controlPlane.environments.find');

    expect(mainSrc).not.toContain('async function ensureSSHRuntimeReadyRecord(');
    expect(mainSrc).not.toContain('async function ensureSSHRuntimeReadyRecordUncoordinated(');
    expect(routeSnapshotSrc).not.toContain('ensureManagedSSHRuntimeReady({');
    expect(
      mainSrc.slice(
        mainSrc.indexOf('async function installFreshReinstallRuntime('),
        mainSrc.indexOf('async function verifyFreshDirectReinstallTarget('),
      ),
    ).not.toContain('ensureManagedSSHRuntimeReady({');

    const openSSHStart = mainSrc.indexOf('async function openSSHEnvironmentFromLauncher(');
    const openSSHEnd = mainSrc.indexOf('function thrownLauncherActionFailure(', openSSHStart);
    const openSSHSrc = mainSrc.slice(openSSHStart, openSSHEnd);
    expect(openSSHSrc).toContain('const bridgeOpenResult = await openRuntimePlacementBridgeFromLauncher(request);');
    expect(openSSHSrc).toContain('return bridgeOpenResult;');

    const startRuntimeStart = mainSrc.indexOf('function sshDetailsFromRuntimeTargetRequest(');
    const startRuntimeEnd = mainSrc.indexOf(
      'async function runEnvironmentRuntimeLifecycleFromLauncher(',
      startRuntimeStart,
    );
    expect(mainSrc.slice(startRuntimeStart, startRuntimeEnd)).toContain(
      'connect_timeout_seconds: request.connect_timeout_seconds',
    );
  });

  it('keeps runtime lifecycle dispatch target-first and opens SSH or container placement only through bridge sessions', () => {
    const mainSrc = readMainSource();
    expect(mainSrc).not.toContain('function launcherActionFailureForUnsupportedRuntimePlacement(');
    expect(mainSrc).toContain(
      'const runtimePlacementBridgeRegistry = new RuntimePlacementBridgeRegistry(handleRuntimePlacementBridgeSettlement);',
    );
    expect(mainSrc).not.toContain('runtimePlacementBridgeByTargetID');
    expect(mainSrc).toContain(
      'const runtimePlacementReadyByTargetID = new Map<DesktopRuntimeTargetID, RuntimePlacementReadyRecord>();',
    );
    expect(mainSrc).toContain(
      'const pendingRuntimePlacementOpenByTargetID = new Map<DesktopRuntimeTargetID, Promise<DesktopLauncherActionResult | null>>();',
    );
    expect(mainSrc).toContain('startRuntimePlacementBridgeSession({');
    expect(mainSrc).toContain('startDesktopModelSourceForStartup({');
    expect(mainSrc).toContain('trackRuntimePlacementBridgeRecord(record, operationKey)');
    expect(mainSrc).toContain('open_connection_required: true');
    expect(mainSrc).toContain('openConnectionRequired: state.open_connection_required === true');
    expect(mainSrc).toContain('async function openRuntimePlacementBridgeFromLauncher(');
    const bridgeOpenStart = mainSrc.indexOf('async function openRuntimePlacementBridgeFromLauncher(');
    const bridgeOpenEnd = mainSrc.indexOf(
      'async function runEnvironmentRuntimeLifecycleFromLauncher(',
      bridgeOpenStart,
    );
    const bridgeOpenSrc = mainSrc.slice(bridgeOpenStart, bridgeOpenEnd);
    expect(bridgeOpenSrc).toContain('const pendingOpen = pendingRuntimePlacementOpenByTargetID.get(targetID) ?? null');
    expect(bridgeOpenSrc).toContain('return pendingOpen');
    expect(bridgeOpenSrc).toContain('const runOpenTask = async (');
    expect(bridgeOpenSrc).toMatch(/const openTask = runtimeLifecycleCoordinator\s*\.runOpen\(\{/u);
    expect(bridgeOpenSrc).toContain('execute: runOpenTask');
    expect(bridgeOpenSrc).toContain('pendingRuntimePlacementOpenByTargetID.set(targetID, openTask)');
    expect(bridgeOpenSrc).toContain('pendingRuntimePlacementOpenByTargetID.delete(targetID)');
    expect(bridgeOpenSrc).not.toContain('(async (): Promise<DesktopLauncherActionResult | null> =>');
    expect(bridgeOpenSrc.indexOf('runtimeLifecycleCoordinator.runOpen({')).toBeLessThan(
      bridgeOpenSrc.indexOf('pendingRuntimePlacementOpenByTargetID.set(targetID, openTask)'),
    );
    expect(bridgeOpenSrc.indexOf('pendingRuntimePlacementOpenByTargetID.set(targetID, openTask)')).toBeLessThan(
      bridgeOpenSrc.indexOf('return openTask;'),
    );
    expect(bridgeOpenSrc).toContain('canReuseFreshRuntimeOpenPreflight(cachedHealth, readyRecord)');
    expect(bridgeOpenSrc).toContain("? 'fresh_health_reused'");
    expect(bridgeOpenSrc).toContain('if (!reusedFreshRuntimePreflight) {');
    expect(bridgeOpenSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(environmentID)');
    expect(bridgeOpenSrc.indexOf('const existingSession = liveSession(sessionKey)')).toBeLessThan(
      bridgeOpenSrc.indexOf('await refreshWelcomeRuntimeHealthForEnvironment(environmentID)'),
    );
    expect(bridgeOpenSrc).not.toContain('await runtimeLifecycleCoordinator.waitForReadyMutation(lifecycleTargetKey)');
    expect(bridgeOpenSrc).toContain('launcherActionFailureFromRuntimeLifecycleError(error');
    expect(bridgeOpenSrc).toContain("title: 'Checking runtime status'");
    expect(bridgeOpenSrc.indexOf("&& lifecycleHostAccess.kind !== 'wsl_host'")).toBeLessThan(
      bridgeOpenSrc.indexOf('runtimeLifecycleTargetKey(lifecycleHostAccess, lifecyclePlacement)'),
    );
    expect(mainSrc).toContain('function savedRuntimePlacementReadyRecord(');
    expect(mainSrc).toContain("startup report's state_dir points at the nested local-environment state");
    expect(mainSrc).toContain('directory, which is not a valid bridge --state-root.');
    expect(mainSrc).not.toContain('const runtimeStateRoot = compact(sshReady.startup.state_dir);');
    expect(bridgeOpenSrc).toContain('let readyRecord = savedRuntimePlacementReadyRecord(');
    expect(bridgeOpenSrc).toContain("phase: 'opening_bridge_proxy'");
    expect(bridgeOpenSrc).toContain('runtimeBridgeStartCanRecover(error)');
    expect(bridgeOpenSrc).toContain('MANAGED_ENVIRONMENT_OPEN_BRIDGE_START_RETRY_DELAYS_MS');
    expect(bridgeOpenSrc).toContain('cachedPreflightRefreshAttempted = true');
    expect(bridgeOpenSrc).toContain("runtimeProbeCacheDecision = 'fresh_health_retry_refreshed'");
    expect(bridgeOpenSrc).toContain('const refreshedReadyRecord = savedRuntimePlacementReadyRecord(');
    expect(bridgeOpenSrc).toContain(
      'The Runtime is still starting. Desktop will retry the connection before restarting it.',
    );
    expect(bridgeOpenSrc).toContain('managedEnvironmentOpenBridgeRecoveryAttemptsByTargetID');
    expect(bridgeOpenSrc).toContain('MAX_MANAGED_ENVIRONMENT_OPEN_BRIDGE_RECOVERY_ATTEMPTS');
    expect(bridgeOpenSrc).toContain('The SSH Runtime was restarted, but Desktop still could not connect to it.');
    expect(bridgeOpenSrc).toContain(
      'Refresh status and retry Open. If it continues, update the Runtime from this environment card.',
    );
    expect(bridgeOpenSrc).toContain("kind: 'restart_environment_runtime' as const");
    expect(bridgeOpenSrc).toContain('The SSH Runtime stopped while Desktop was connecting.');
    expect(bridgeOpenSrc).toContain("phase: 'checking_env_app_readiness'");
    expect(bridgeOpenSrc.match(/probeLocalRuntimeBridgeStartup\(bridgeSession\.startup/gu)).toHaveLength(1);
    expect(bridgeOpenSrc).toContain('shellCacheScope: targetID');
    expect(bridgeOpenSrc).toContain('desktopFailureForRuntimePlacementBridgeReadiness(');
    expect(bridgeOpenSrc).not.toContain('Runtime Placement Bridge readiness failed (');
    expect(bridgeOpenSrc).toContain('local_ui_url: bridgeSession.startup.local_ui_url');
    expect(bridgeOpenSrc).toContain('local_ui_urls: bridgeSession.startup.local_ui_urls');
    expect(bridgeOpenSrc).toContain('savedRuntimePlacementSSHPassword(');
    expect(bridgeOpenSrc).not.toContain('Start this runtime first, then open it.');

    const settleBridgeStart = mainSrc.indexOf('async function handleRuntimePlacementBridgeSettlement(');
    const settleBridgeEnd = mainSrc.indexOf(
      'async function openRuntimePlacementBridgeForReadyRecord(',
      settleBridgeStart,
    );
    const settleBridgeSrc = mainSrc.slice(settleBridgeStart, settleBridgeEnd);
    const registrySrc = readMainModuleSource('runtimePlacementBridgeRegistry.ts');
    expect(registrySrc).toContain('entry.settlement = session.closed.then(async (termination) => {');
    expect(registrySrc).toContain('this.entries.delete(targetID);');
    expect(registrySrc.indexOf('await entry.record.session.disconnect();')).toBeLessThan(
      registrySrc.indexOf('await entry.settlement;'),
    );
    expect(settleBridgeSrc).toContain("termination.kind === 'failed'");
    expect(settleBridgeSrc).toContain('sessionRecord.runtime_handle = null;');
    expect(settleBridgeSrc).toContain('sendSessionTransportRecoverySnapshot(sessionRecord);');
    expect(settleBridgeSrc).toContain('else if (sessionRecord && !sessionRecord.closing)');
    expect(bridgeOpenSrc).toContain('sessionTransportRecoveryFailed(existingSession)');
    expect(bridgeOpenSrc).toContain('await finalizeSessionClosure(existingSession.session_key);');
    expect(bridgeOpenSrc).toContain('transportRecovery: record.session');
    expect(bridgeOpenSrc).toContain(
      'runtimePlacementBridgeRegistry.attachSession(targetID, record.session, sessionRecord.session_key)',
    );

    const shutdownStart = mainSrc.indexOf('async function shutdownDesktopWindowsAndSessions(');
    const shutdownEnd = mainSrc.indexOf('type DesktopDeepLinkRequest', shutdownStart);
    const shutdownSrc = mainSrc.slice(shutdownStart, shutdownEnd);
    expect(shutdownSrc.indexOf('await Promise.allSettled(sessionClosePromises);')).toBeLessThan(
      shutdownSrc.indexOf('await runtimePlacementBridgeRegistry.retireAll().catch(() => undefined);'),
    );
    expect(mainSrc).toContain('resolveRuntimeContainerPlacement');
    expect(mainSrc).toContain('DESKTOP_LAUNCHER_LIST_RUNTIME_CONTAINERS_CHANNEL');
    expect(mainSrc).toContain('containerStartCommand');
    expect(mainSrc).not.toContain('containerStopCommand');
    expect(mainSrc).not.toContain("container_engine, 'stop'");

    expect(mainSrc).not.toContain('async function ensureRuntimePlacementReadyRecordFromLauncher(');
    expect(mainSrc).not.toContain('async function ensureRuntimePlacementReadyRecordFromLauncherUncoordinated(');
    expect(mainSrc).not.toContain('function runtimePlacementLiveDaemonFromInspection(');
    expect(mainSrc).not.toContain('function commitRuntimePlacementLiveDaemonReplacement(');

    const startRuntimeStart = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(');
    const startRuntimeEnd = mainSrc.indexOf('async function connectProviderRuntimeFromLauncher(', startRuntimeStart);
    const startRuntimeSrc = mainSrc.slice(startRuntimeStart, startRuntimeEnd);
    expect(startRuntimeSrc).toContain('executeDirectManagedEnvironmentLifecycle({');
    expect(startRuntimeSrc).toContain('authoritativeRuntimeTargetFromRequest(');
    expect(startRuntimeSrc).not.toContain('upsertDirectRuntimeGateway(');
    expect(startRuntimeSrc).not.toContain('runGatewayEnvironmentLifecycleFromLauncher({');
    expect(startRuntimeSrc).not.toContain('gatewayLifecycleManager().prepareRuntimeOperation(');

    const stopRuntimeStart = mainSrc.indexOf('async function stopEnvironmentRuntimeFromLauncher(');
    const stopRuntimeEnd = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(', stopRuntimeStart);
    const stopRuntimeSrc = mainSrc.slice(stopRuntimeStart, stopRuntimeEnd);
    expect(stopRuntimeSrc).toContain('return runEnvironmentRuntimeLifecycleFromLauncher(request);');
    expect(stopRuntimeSrc).not.toContain('stopEnvironmentRuntimeFromLauncherUncoordinated(request');

    const refreshRuntimeStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshRuntimeEnd = mainSrc.indexOf(
      'async function refreshAllEnvironmentRuntimesFromLauncher(',
      refreshRuntimeStart,
    );
    const refreshRuntimeSrc = mainSrc.slice(refreshRuntimeStart, refreshRuntimeEnd);
    expect(refreshRuntimeSrc).toContain("if (placement.kind === 'container_process')");
    expect(refreshRuntimeSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(environmentID)');
    expect(refreshRuntimeSrc).not.toContain('loadExternalLocalUIStartup(runtimeRecord.startup.local_ui_url');
    expect(refreshRuntimeSrc).not.toContain('assertRuntimeTargetContainerRunning(hostAccess, placement)');
    expect(refreshRuntimeSrc).not.toContain('markSavedRuntimeTargetUsed(preferences');
  });

  it('prepares one container Runtime package before deriving the process helper and modifying the target', () => {
    const managerSrc = fs.readFileSync(path.join(__dirname, 'runtimePlacementManager.ts'), 'utf8');
    const prepareIndex = managerSrc.indexOf('preparedRuntimeAsset = await prepareDesktopRuntimeUploadAsset({');
    const sessionIndex = managerSrc.indexOf('processSession = await openContainerRuntimeProcessSession({');
    const helperIndex = managerSrc.indexOf(
      'runtimeProcessHelperArchiveFromRuntimePackage(preparedRuntimeAsset.archiveData)',
    );
    const inventoryIndex = managerSrc.indexOf('const processInventory = await processSession.inspect();');
    const stopIndex = managerSrc.indexOf('await processSession.stop(processInventory);');
    const installIndex = managerSrc.indexOf('containerRuntimeUploadedInstallCommand({');
    expect(prepareIndex).toBeGreaterThanOrEqual(0);
    expect(sessionIndex).toBeGreaterThan(prepareIndex);
    expect(helperIndex).toBeGreaterThan(sessionIndex);
    expect(inventoryIndex).toBeGreaterThan(helperIndex);
    expect(stopIndex).toBeGreaterThan(inventoryIndex);
    expect(installIndex).toBeGreaterThan(stopIndex);
  });

  it('keeps Local Host Open under the same Open-owned runtime preflight contract', () => {
    const mainSrc = readMainSource();
    const localOpenStart = mainSrc.indexOf('async function openLocalEnvironmentRecord(');
    const localOpenEnd = mainSrc.indexOf('function remoteManagedSessionStartup(', localOpenStart);
    expect(localOpenStart).toBeGreaterThanOrEqual(0);
    expect(localOpenEnd).toBeGreaterThan(localOpenStart);
    const localOpenSrc = mainSrc.slice(localOpenStart, localOpenEnd);

    expect(mainSrc).toContain('type LocalHostOpenTarget = Readonly<{');
    expect(mainSrc).toContain(
      'function localHostOpenTarget(environment: DesktopLocalEnvironmentState): LocalHostOpenTarget',
    );
    expect(localOpenSrc).toContain("action: 'open_local_environment'");
    expect(localOpenSrc).toContain("subject_kind: 'local_environment'");
    expect(localOpenSrc).toContain("phase: 'checking_runtime_record'");
    expect(localOpenSrc).toContain('open_progress: buildOpenConnectionProgress({');
    expect(localOpenSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(environment.id)');
    expect(localOpenSrc).toContain('runtimeRecord = await attachLocalEnvironmentRuntime(environment)');
    expect(mainSrc).toContain('runtimeStartupTimeoutMs: DESKTOP_RUNTIME_STARTUP_TIMEOUT_MS');
    expect(localOpenSrc).toContain('localRuntimeHealthForOpenPreflight(environment.id)');
    expect(localOpenSrc).toContain('finishLocalHostOpenFailure(operationKey, openTarget, signal, result, preferences)');
    expect(localOpenSrc).toContain("phase: 'checking_env_app_readiness'");
    expect(localOpenSrc).toContain("phase: 'opening_window'");
    expect(localOpenSrc).toContain("phase: 'open_ready'");
    expect(localOpenSrc).not.toContain('Start the runtime first, then open this environment.');

    const refreshRuntimeStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshRuntimeEnd = mainSrc.indexOf(
      'async function refreshAllEnvironmentRuntimesFromLauncher(',
      refreshRuntimeStart,
    );
    const refreshRuntimeSrc = mainSrc.slice(refreshRuntimeStart, refreshRuntimeEnd);
    expect(refreshRuntimeSrc).toMatch(
      /const runtimeRecord =\s*\(await verifyCurrentLocalEnvironmentRuntimeRecord\(localEnvironment\)\)\s*\?\?\s*\(await attachLocalEnvironmentRuntime\(localEnvironment\)\);/u,
    );
    expect(refreshRuntimeSrc).toContain("intent: 'refresh'");
    expect(refreshRuntimeSrc).toContain("action: 'refresh_environment_runtime'");
    expect(refreshRuntimeSrc).toContain("active_progress_surface: 'runtime_lifecycle'");
    expect(refreshRuntimeSrc).toContain("lifecycleOperation: 'refresh'");
    expect(refreshRuntimeSrc).toContain("operation: 'refresh'");
    expect(refreshRuntimeSrc.indexOf('launcherOperations.create({')).toBeLessThan(
      refreshRuntimeSrc.indexOf('await refreshWelcomeRuntimeHealthForEnvironment(environmentID)'),
    );
    expect(refreshRuntimeSrc).toContain("launcherOperations.finishCurrentAttempt(operationKey, owner, 'succeeded'");
  });

  it('keeps the Desktop state root distinct from the Local Environment Runtime root', () => {
    const mainSrc = readMainSource();
    expect(mainSrc).toContain('function localEnvironmentRuntimeRoot(');
    expect(mainSrc).toContain('return compact(environment.local_hosting.state_dir);');
    expect(mainSrc).toContain('function localEnvironmentStateRoot(): string {');
    expect(mainSrc).toContain('return preferencesPaths().stateRoot;');

    const prepareStart = mainSrc.indexOf('async function prepareManagedEnvironmentRuntime(');
    const prepareEnd = mainSrc.indexOf('async function attachLocalEnvironmentRuntime(', prepareStart);
    const prepareSrc = mainSrc.slice(prepareStart, prepareEnd);
    expect(prepareSrc).toContain('runtimeRoot: launchPlan.state_layout.stateDir,');
    expect(prepareSrc).toContain('stateRoot: launchPlan.state_layout.stateRoot,');

    const attachStart = mainSrc.indexOf('async function attachLocalEnvironmentRuntime(');
    const attachEnd = mainSrc.indexOf('type RuntimeFlowerRoute', attachStart);
    const attachSrc = mainSrc.slice(attachStart, attachEnd);
    expect(attachSrc).toContain('runtimeRoot: localEnvironmentRuntimeRoot(environment),');
    expect(attachSrc).toContain('stateRoot: localEnvironmentStateRoot(),');
    expect(attachSrc).not.toContain('stateRoot: localEnvironmentRuntimeRoot(environment),');

    const placementStart = mainSrc.indexOf('function localHostRuntimeLifecyclePlacement(');
    const placementEnd = mainSrc.indexOf('function localHostRuntimeLifecycleTargetKey(', placementStart);
    const placementSrc = mainSrc.slice(placementStart, placementEnd);
    expect(placementSrc).toContain('runtime_root: localEnvironmentRuntimeRoot(environment),');
    expect(placementSrc).toContain('runtime_state_root: localEnvironmentStateRoot(),');

    expect(mainSrc).toContain('stateRoot: localEnvironmentStateRoot(),');
    expect(mainSrc).not.toContain('currentRuntimeFromProbeStateDir');
    expect(mainSrc).toContain('function authoritativeRuntimeTargetFromRequest(');
    expect(mainSrc).toContain('placement: localHostRuntimeLifecyclePlacement(localEnvironment),');
  });

  it('keeps provider-link tickets separate from remote open route readiness', () => {
    const mainSrc = readMainSource();

    const remoteOpenStart = mainSrc.indexOf('async function prepareProviderRemoteOpenSession(');
    const remoteOpenEnd = mainSrc.indexOf('function providerEnvironmentFailureContext', remoteOpenStart);
    expect(remoteOpenStart).toBeGreaterThanOrEqual(0);
    expect(remoteOpenEnd).toBeGreaterThan(remoteOpenStart);
    const remoteOpenSrc = mainSrc.slice(remoteOpenStart, remoteOpenEnd);
    expect(remoteOpenSrc).toContain('launcherActionFailureForRemoteRouteState');

    const connectStart = mainSrc.indexOf('async function connectProviderRuntimeFromLauncher(');
    const connectEnd = mainSrc.indexOf('async function disconnectProviderRuntimeFromLauncher(', connectStart);
    expect(connectStart).toBeGreaterThanOrEqual(0);
    expect(connectEnd).toBeGreaterThan(connectStart);
    const connectSrc = mainSrc.slice(connectStart, connectEnd);
    expect(connectSrc).toContain('requestProviderRuntimeLinkAuthorization(');
    expect(connectSrc).toContain('connectProviderLink(runtimeControl, {');
    expect(connectSrc).toContain('runtime_link_ticket: runtimeLink.runtime_link_ticket');
    expect(connectSrc).not.toContain('requestDesktopOpenSession(');
    expect(connectSrc).not.toContain('bootstrap_ticket');
    expect(connectSrc).not.toContain('prepareProviderRemoteOpenSession');
    expect(connectSrc).not.toContain('launcherActionFailureForRemoteRouteState');
    expect(connectSrc).not.toContain('openProviderEnvironmentFromLauncher');

    expect(mainSrc).not.toContain('targetURL: latest.environment.environment_url || material.remoteSessionURL');

    const disconnectStart = mainSrc.indexOf('async function disconnectProviderRuntimeFromLauncher(');
    const disconnectEnd = mainSrc.indexOf('async function cancelLauncherOperationFromLauncher(', disconnectStart);
    expect(disconnectStart).toBeGreaterThanOrEqual(0);
    expect(disconnectEnd).toBeGreaterThan(disconnectStart);
    const disconnectSrc = mainSrc.slice(disconnectStart, disconnectEnd);
    expect(disconnectSrc).toContain(
      'const unlinked = await disconnectProviderLink(runtimeRecord.startup.runtime_control);',
    );
    expect(
      disconnectSrc.indexOf('const unlinked = await disconnectProviderLink(runtimeRecord.startup.runtime_control);'),
    ).toBeLessThan(disconnectSrc.indexOf('updateProviderRuntimeTargetStartup(runtimeTarget, {'));
    expect(disconnectSrc).toContain(
      'const currentBinding = runtimeServiceProviderLinkBinding(runtimeRecord?.startup.runtime_service);',
    );
    expect(disconnectSrc).toContain("if (currentBinding.state !== 'linked')");
    expect(disconnectSrc).toContain('await refreshProviderEnvironmentRuntimeHealth(');
    expect(disconnectSrc.indexOf('await refreshProviderEnvironmentRuntimeHealth(')).toBeLessThan(
      disconnectSrc.indexOf("return launcherActionSuccess('disconnected_provider_runtime');"),
    );

    const openStart = mainSrc.indexOf('async function openProviderEnvironmentFromLauncher(');
    const openEnd = mainSrc.indexOf('async function focusEnvironmentWindow(', openStart);
    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(openEnd).toBeGreaterThan(openStart);
    const openSrc = mainSrc.slice(openStart, openEnd);
    expect(openSrc).toContain('prepareProviderRemoteOpenSession(preferences, environment)');
  });

  it('keeps provider environment open remote-only when Flower is first-class', () => {
    const mainSrc = readMainSource();

    const openStart = mainSrc.indexOf('async function openProviderEnvironmentFromLauncher(');
    const openEnd = mainSrc.indexOf('async function focusEnvironmentWindow(', openStart);
    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(openEnd).toBeGreaterThan(openStart);
    const openSrc = mainSrc.slice(openStart, openEnd);

    expect(openSrc).toContain('prepareProviderRemoteOpenSession(preferences, environment)');
    expect(openSrc).not.toContain('startDesktopModelSourceForStartup');
    expect(openSrc).not.toContain('runEnvironmentRuntimeLifecycleFromLauncher');
    expect(openSrc).not.toContain('startRuntimePlacementBridgeSession');
    expect(openSrc).not.toContain('resolveProviderRuntimeLinkTarget');
  });

  it('routes Welcome Flower through one selected Runtime API without provider-session shortcuts', () => {
    const mainSrc = readMainSource();

    const routeStart = mainSrc.indexOf('const runtimeFlowerNoQuery');
    const routeEnd = mainSrc.indexOf('function runtimeFlowerPath(', routeStart);
    expect(routeStart).toBeGreaterThanOrEqual(0);
    expect(routeEnd).toBeGreaterThan(routeStart);
    const routeSrc = mainSrc.slice(routeStart, routeEnd);
    expect(routeSrc).toContain("'/_redeven_proxy/api/settings'");
    expect(routeSrc).toContain("'/_redeven_proxy/api/fs/path_context'");
    expect(routeSrc).toContain("'/_redeven_proxy/api/fs/list'");
    expect(routeSrc).toContain("'/_redeven_proxy/api/ai/provider_bundle'");
    expect(routeSrc).toContain("{ path: '/_redeven_proxy/api/ai/default_permission', methods: ['PUT'] }");
    expect(routeSrc).toContain("{ path: '/_redeven_proxy/api/ai/current_model', methods: ['PUT'] }");
    expect(routeSrc).toContain("'/_redeven_proxy/api/ai/models'");
    expect(routeSrc).toContain("{ path: '/_redeven_proxy/api/ai/model_catalog', methods: ['POST'] }");
    expect(routeSrc).toContain("{ path: '/_redeven_proxy/api/ai/turns', methods: ['POST'] }");
    expect(routeSrc).toContain("{ path: '/_redeven_proxy/api/ai/upload-staging-scopes', methods: ['POST'] }");
    expect(routeSrc).toContain('/^\\/_redeven_proxy\\/api\\/ai\\/upload-staging-scopes\\/[^/]+$/u');
    expect(routeSrc).not.toContain('composer-drafts');
    expect(routeSrc).not.toContain('draft_id');
    expect(mainSrc).toContain('runtimeFlowerDeleteQuery,');
    expect(routeSrc).toContain("methods: ['GET', 'PATCH']");
    expect(routeSrc).toContain("methods: ['DELETE'], allowsQuery: runtimeFlowerDeleteQuery");
    expect(routeSrc).not.toContain("methods: ['GET', 'PATCH', 'DELETE']");
    expect(routeSrc).not.toContain("'/_redeven_proxy/api/ai/runs'");
    expect(routeSrc).not.toContain('live\\/bootstrap');
    expect(routeSrc).toContain("{ path: '/_redeven_proxy/api/ai/flower/stream', methods: ['GET'] }");
    expect(routeSrc).not.toContain('runtimeFlowerStreamQuery');
    expect(routeSrc).not.toContain('live\\/events');
    expect(routeSrc).toContain('/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/subagents\\/[^/]+\\/detail$/u');
    expect(routeSrc).toContain('runtimeFlowerSubagentDetailQuery');
    expect(routeSrc).toContain('after_ordinal');
    expect(routeSrc).toContain('/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/turns$/u');
    expect(routeSrc).toContain("/^\\/_redeven_proxy\\/api\\/ai\\/uploads\\/[^/]+$/u, methods: ['GET', 'DELETE']");
    expect(routeSrc).toContain("/^\\/_redeven_proxy\\/api\\/ai\\/uploads\\/[^/]+\\/long_text$/u, methods: ['GET']");
    expect(routeSrc).not.toContain('/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/live$/u');
    expect(routeSrc).not.toContain('live\\/updates');
    expect(routeSrc).toContain('/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/approvals$/u');
    expect(routeSrc).not.toContain('context\\/compact');
    expect(routeSrc).toContain('/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/queue\\/order$/u');
    expect(routeSrc).toContain('/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/queue\\/[^/]+$/u');
    expect(routeSrc).toContain('/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/queue\\/[^/]+\\/promote$/u');
    expect(routeSrc).not.toContain('followups');
    expect(routeSrc).toContain('/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/retry$/u');
    expect(routeSrc).not.toContain('retry_effect');
    expect(routeSrc).toContain('/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/cancel$/u');
    expect(routeSrc).toContain('/^\\/_redeven_proxy\\/api\\/ai\\/runs\\/[^/]+\\/terminal\\/[^/]+\\/read$/u');
    expect(routeSrc).toContain('runtimeFlowerTerminalReadQuery');
    expect(routeSrc).toContain("'after_seq'");
    expect(routeSrc).not.toContain("'wait_ms'");
    expect(routeSrc).not.toContain("'max_bytes'");
    const terminalReadQueryStart = routeSrc.indexOf('const runtimeFlowerTerminalReadQuery');
    const terminalReadQueryEnd = routeSrc.indexOf(
      'const runtimeFlowerAttachmentCapabilityQuery',
      terminalReadQueryStart,
    );
    const terminalReadQuerySrc = routeSrc.slice(terminalReadQueryStart, terminalReadQueryEnd);
    expect(terminalReadQuerySrc).not.toContain("'wait_ms'");
    expect(routeSrc).not.toContain('terminal\\/[^/]+\\/write');
    expect(routeSrc).not.toContain('terminal\\/[^/]+\\/terminate');
    expect(routeSrc).not.toContain("startsWith('/_redeven_proxy/api/ai/threads')");
    expect(routeSrc).not.toContain("startsWith('/_redeven_proxy/api/fs')");

    const pathStart = mainSrc.indexOf('function runtimeFlowerPath(');
    const pathEnd = mainSrc.indexOf('function runtimeFlowerMethod(', pathStart);
    expect(pathStart).toBeGreaterThanOrEqual(0);
    expect(pathEnd).toBeGreaterThan(pathStart);
    const pathSrc = mainSrc.slice(pathStart, pathEnd);
    expect(pathSrc).toContain("new URL(raw, 'http://runtime-flower.local')");
    expect(pathSrc).toContain('runtimeFlowerAllowedRoute(parsed)');
    expect(pathSrc).toContain("throw new Error('Flower runtime request path is not allowed.');");

    const methodStart = mainSrc.indexOf('function runtimeFlowerMethodAllowed(');
    const methodEnd = mainSrc.indexOf('async function requestRuntimeFlower(', methodStart);
    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodEnd).toBeGreaterThan(methodStart);
    const methodSrc = mainSrc.slice(methodStart, methodEnd);
    expect(methodSrc).toContain('route.methods.includes(method)');
    expect(methodSrc).not.toContain('terminal\\/[^/]+\\/write');
    expect(methodSrc).not.toContain('terminal\\/[^/]+\\/terminate');

    const requestStart = mainSrc.indexOf('async function requestRuntimeFlower(');
    const requestEnd = mainSrc.indexOf('function runtimeTargetDetail(', requestStart);
    expect(requestStart).toBeGreaterThanOrEqual(0);
    expect(requestEnd).toBeGreaterThan(requestStart);
    const requestSrc = mainSrc.slice(requestStart, requestEnd);
    expect(requestSrc).toContain('const flowerTarget = await ensureRuntimeFlowerRecord();');
    expect(requestSrc).toContain('const record = flowerTarget.record;');
    expect(requestSrc).toContain('const url = new URL(path, runtimeFlowerBaseURL(record));');
    expect(requestSrc).toContain('runtimeFlowerMethodAllowed(path, method)');
    expect(requestSrc).toContain(
      'let accessHeaders = withStagingCapability(await runtimeFlowerAccessHeaders(record, environment));',
    );
    expect(requestSrc).toContain('runtimeFlowerInvalidJSONError(response, parsed)');
    expect(requestSrc).toContain("failureKind: 'transport_unknown'");
    expect(requestSrc).not.toContain('error.body');
    expect(requestSrc).toContain(
      'accessHeaders = withStagingCapability(await runtimeFlowerAccessHeaders(record, environment));',
    );
    expect(requestSrc).toContain(
      'runtimeFlowerRequestHTTP(url, { ...request, method, path }, { headers: accessHeaders })',
    );
    expect(requestSrc).not.toContain('requestProviderDesktopSessionMaterial');
    expect(requestSrc).not.toContain('requestDesktopOpenSession');

    const runtimeFlowerHTTPSrc = readMainModuleSource('runtimeFlowerHTTP.ts');
    const httpStart = runtimeFlowerHTTPSrc.indexOf('export function requestRuntimeFlowerHTTP(');
    const httpEnd = runtimeFlowerHTTPSrc.indexOf('export function parseRuntimeFlowerJSON(', httpStart);
    expect(httpStart).toBeGreaterThanOrEqual(0);
    expect(httpEnd).toBeGreaterThan(httpStart);
    const httpSrc = runtimeFlowerHTTPSrc.slice(httpStart, httpEnd);
    expect(httpSrc).toContain("Accept: options.accept ?? 'application/json'");
    expect(httpSrc).not.toContain('application/x-ndjson');
    expect(requestSrc).toContain("accept: '*/*'");
    expect(requestSrc).toContain("contentType: response.headers['content-type']");
    expect(requestSrc).not.toContain('displayName: request.display_name');

    expect(runtimeFlowerHTTPSrc).toContain('export function requestRuntimeFlowerHTTP(');
    expect(runtimeFlowerHTTPSrc).toContain('export function runtimeFlowerPrivateBridgeHeaders(');
    expect(runtimeFlowerHTTPSrc).toContain('DESKTOP_PRIVATE_BRIDGE_TOKEN_HEADER');
    expect(runtimeFlowerHTTPSrc).toContain('export function parseRuntimeFlowerJSON(');
    expect(runtimeFlowerHTTPSrc).toContain('export function runtimeFlowerInvalidJSONError(');
    expect(runtimeFlowerHTTPSrc).toContain("'runtime_flower_invalid_json'");
    expect(runtimeFlowerHTTPSrc).toContain("'Flower returned an invalid JSON response.'");

    const chunkStart = mainSrc.indexOf('async function writeRuntimeFlowerAttachmentChunk(');
    const commitStart = mainSrc.indexOf('async function commitRuntimeFlowerAttachmentUpload(', chunkStart);
    const cancelStart = mainSrc.indexOf('function cancelRuntimeFlowerAttachmentUpload(', commitStart);
    expect(chunkStart).toBeGreaterThanOrEqual(0);
    expect(commitStart).toBeGreaterThan(chunkStart);
    expect(cancelStart).toBeGreaterThan(commitStart);
    const chunkSrc = mainSrc.slice(chunkStart, commitStart);
    const commitSrc = mainSrc.slice(commitStart, cancelStart);
    expect(chunkSrc).toContain('beginRuntimeFlowerAttachmentWrite(operation)');
    expect(chunkSrc).toContain('endRuntimeFlowerAttachmentWrite(operation)');
    expect(commitSrc).toContain('beginRuntimeFlowerAttachmentWrite(operation)');
    expect(commitSrc).toContain('endRuntimeFlowerAttachmentWrite(operation)');
    expect(commitSrc.indexOf('beginRuntimeFlowerAttachmentWrite(operation)')).toBeLessThan(
      commitSrc.indexOf('writeRuntimeFlowerAttachmentBytes(operation.request, operation.footer)'),
    );

    const errorStart = mainSrc.indexOf('function runtimeFlowerEnvelopeError(');
    const errorEnd = mainSrc.indexOf('async function unlockRuntimeFlowerAccess(', errorStart);
    expect(errorStart).toBeGreaterThanOrEqual(0);
    expect(errorEnd).toBeGreaterThan(errorStart);
    const errorSrc = mainSrc.slice(errorStart, errorEnd);
    expect(errorSrc).toContain('runtimeFlowerRetryAfterMs(error.retry_after_ms)');
    expect(errorSrc).toContain('runtimeFlowerRetryAfterMs(record.retry_after_ms)');
    expect(errorSrc).toContain("compact(record.error_code) || 'runtime_flower_request_failed'");
    expect(errorSrc).toContain('record.data');

    const unlockStart = mainSrc.indexOf('async function unlockRuntimeFlowerAccess(');
    const unlockEnd = mainSrc.indexOf('async function runtimeFlowerAccessHeaders(', unlockStart);
    expect(unlockStart).toBeGreaterThanOrEqual(0);
    expect(unlockEnd).toBeGreaterThan(unlockStart);
    const unlockSrc = mainSrc.slice(unlockStart, unlockEnd);
    expect(unlockSrc).toContain("new URL('/api/local/access/unlock', baseURL)");
    expect(unlockSrc).toContain('headers: runtimeFlowerPrivateBridgeHeaders(record.startup)');
    expect(unlockSrc).toContain('throw (error ?? runtimeFlowerError(');
    expect(unlockSrc).not.toContain('throw new Error(error?.message');

    const accessStart = mainSrc.indexOf('async function runtimeFlowerAccessHeaders(', unlockEnd);
    const accessEnd = mainSrc.indexOf('async function requestRuntimeFlower(', accessStart);
    expect(accessStart).toBeGreaterThanOrEqual(0);
    expect(accessEnd).toBeGreaterThan(accessStart);
    const accessSrc = mainSrc.slice(accessStart, accessEnd);
    expect(accessSrc).toContain('const bridgeHeaders = runtimeFlowerPrivateBridgeHeaders(record.startup);');
    expect(accessSrc).toContain('...bridgeHeaders');
    expect(accessSrc).toContain('Cookie: runtimeFlowerAccessCookieHeader(cookie)');

    const ensureStart = mainSrc.indexOf('async function ensureRuntimeFlowerRecord()');
    const ensureEnd = mainSrc.indexOf('function runtimeFlowerEnvelopeError(', ensureStart);
    expect(ensureStart).toBeGreaterThanOrEqual(0);
    expect(ensureEnd).toBeGreaterThan(ensureStart);
    const ensureSrc = mainSrc.slice(ensureStart, ensureEnd);
    expect(ensureSrc).toContain('if (desktopPlatformCapabilities.wsl_environment)');
    expect(ensureSrc).toContain('return ensureWSLRuntimeFlowerTarget(preferences);');
    expect(ensureSrc).toContain('const targetKey = localHostRuntimeLifecycleTargetKey(environment);');
    expect(ensureSrc).toContain("activeLifecycle.intent === 'start'");
    expect(ensureSrc).toContain("activeLifecycle.intent === 'restart'");
    expect(ensureSrc).toContain("activeLifecycle.intent === 'update'");
    expect(ensureSrc).toContain("markRuntimeLifecyclePresentationContext(activeLifecycle, 'flower_warmup');");
    expect(ensureSrc).toContain('runtimeLifecycleCoordinator.waitForReadyMutation<DesktopLauncherActionResult>(targetKey)');
    expect(ensureSrc).toContain("presentationContext: 'flower_warmup'");
    expect(ensureSrc).toContain("kind: 'start_environment_runtime'");
    expect(ensureSrc).toContain('runtimeFlowerAccessCookies.delete(runtimeFlowerBaseURL(target.record));');
    expect(ensureSrc).toContain('buildDesktopLocalRuntimeOpenPlan(');
    expect(ensureSrc).toContain('if (runtimePlan.requires_restart)');
    expect(ensureSrc).toContain('assertRuntimeFlowerRecordOpenable(attached);');
    expect(ensureSrc).toContain('Initialize this environment before restarting it.');
    expect(ensureSrc).not.toContain('startLocalHostRuntimeWithLifecycleProgress({');
    expect(ensureSrc).not.toContain('setTimeout(');
    expect(ensureSrc).not.toContain('setInterval(');

    expect(mainSrc).not.toContain('async function startLocalHostRuntimeWithLifecycleProgress(');
    expect(mainSrc).not.toContain('async function stopEnvironmentRuntimeFromLauncherUncoordinated(');
    expect(mainSrc).not.toContain('async function restartManagedRuntimeFromShell(');
    expect(mainSrc).not.toContain('async function restartSSHRuntimeFromShell(');
  });

  it('syncs linked provider health after runtime lifecycle changes', () => {
    const mainSrc = readMainSource();

    const helperStart = mainSrc.indexOf('async function syncLinkedProviderRuntimeHealthFromService(');
    const helperEnd = mainSrc.indexOf('async function refreshAllProviderEnvironmentRuntimeHealth(', helperStart);
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperSrc = mainSrc.slice(helperStart, helperEnd);
    expect(helperSrc).toContain("if (binding.state !== 'linked')");
    expect(helperSrc).toContain(
      'await refreshProviderEnvironmentRuntimeHealth(providerOrigin, providerID, [envPublicID]);',
    );

    const startRuntimeStart = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(');
    const startRuntimeEnd = mainSrc.indexOf('async function connectProviderRuntimeFromLauncher(', startRuntimeStart);
    expect(startRuntimeStart).toBeGreaterThanOrEqual(0);
    expect(startRuntimeEnd).toBeGreaterThan(startRuntimeStart);
    const startRuntimeSrc = mainSrc.slice(startRuntimeStart, startRuntimeEnd);
    expect(startRuntimeSrc).not.toContain('syncLinkedProviderRuntimeHealthFromService(');
    expect(startRuntimeSrc).toContain('executeDirectManagedEnvironmentLifecycle({');
    expect(startRuntimeSrc).not.toContain('upsertDirectRuntimeGateway(');
    expect(startRuntimeSrc).not.toContain('runGatewayEnvironmentLifecycleFromLauncher({');

    const connectStart = mainSrc.indexOf('async function connectProviderRuntimeFromLauncher(');
    const connectEnd = mainSrc.indexOf('async function disconnectProviderRuntimeFromLauncher(', connectStart);
    expect(connectStart).toBeGreaterThanOrEqual(0);
    expect(connectEnd).toBeGreaterThan(connectStart);
    expect(mainSrc.slice(connectStart, connectEnd)).toContain(
      'await syncLinkedProviderRuntimeHealthFromService(linked.runtime_service);',
    );

    const refreshRuntimeStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshRuntimeEnd = mainSrc.indexOf(
      'async function refreshAllEnvironmentRuntimesFromLauncher(',
      refreshRuntimeStart,
    );
    expect(refreshRuntimeStart).toBeGreaterThanOrEqual(0);
    expect(refreshRuntimeEnd).toBeGreaterThan(refreshRuntimeStart);
    const refreshRuntimeSrc = mainSrc.slice(refreshRuntimeStart, refreshRuntimeEnd);
    expect(refreshRuntimeSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(environmentID)');
    expect(refreshRuntimeSrc).toContain(
      'await syncLinkedProviderRuntimeHealthFromService(runtimeService).catch(() => undefined)',
    );
  });

  it('forces provider catalog sync before refreshing a provider environment card', () => {
    const mainSrc = readMainSource();

    const refreshRuntimeStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshRuntimeEnd = mainSrc.indexOf(
      'async function refreshAllEnvironmentRuntimesFromLauncher(',
      refreshRuntimeStart,
    );
    expect(refreshRuntimeStart).toBeGreaterThanOrEqual(0);
    expect(refreshRuntimeEnd).toBeGreaterThan(refreshRuntimeStart);
    const refreshRuntimeSrc = mainSrc.slice(refreshRuntimeStart, refreshRuntimeEnd);
    const providerBranchStart = refreshRuntimeSrc.indexOf('if (providerEnvironment) {');
    const providerBranchEnd = refreshRuntimeSrc.indexOf(
      'const sshDetails = sshDetailsFromRuntimeTargetRequest(request);',
      providerBranchStart,
    );
    expect(providerBranchStart).toBeGreaterThanOrEqual(0);
    expect(providerBranchEnd).toBeGreaterThan(providerBranchStart);
    const providerBranchSrc = refreshRuntimeSrc.slice(providerBranchStart, providerBranchEnd);
    expect(providerBranchSrc).toContain('await syncSavedControlPlaneAccountWithState(');
    expect(providerBranchSrc).toMatch(/\{\s*force: true,?\s*\}/u);
    expect(providerBranchSrc.indexOf('await syncSavedControlPlaneAccountWithState(')).toBeLessThan(
      providerBranchSrc.indexOf('await refreshProviderEnvironmentRuntimeHealth('),
    );
  });

  it('marks provider environment management boundaries as important source constraints', () => {
    const mainSrc = readMainSource();
    expect(mainSrc).toContain('IMPORTANT: Provider-link operations must resolve the exact Local/WSL/SSH runtime');
    expect(mainSrc).toContain('IMPORTANT: Provider Environment Open is remote-only provider tunnel access.');
    expect(mainSrc).toContain('desktopProviderEnvironmentOpenRoute()');
  });

  it('settles deleted runtime lifecycle tasks while preventing stale SSH and provider tasks from resurrecting entries', () => {
    const mainSrc = readMainSource();
    const runtimeTargetDeleteStart = mainSrc.indexOf('async function deleteSavedRuntimeTargetFromWelcome');
    const providerDeleteStart = mainSrc.indexOf('async function deleteControlPlaneFromLauncher');
    const providerCleanupStart = mainSrc.indexOf('async function cleanupDeletedControlPlane');
    const syncAccountStart = mainSrc.indexOf('async function syncSavedControlPlaneAccount(');
    const syncStart = mainSrc.indexOf('async function syncSavedControlPlaneAccountWithState');
    const syncEnd = mainSrc.indexOf('async function ensureControlPlaneAccessToken');

    expect(runtimeTargetDeleteStart).toBeGreaterThanOrEqual(0);
    const runtimeTargetDeleteSrc = mainSrc.slice(
      runtimeTargetDeleteStart,
      mainSrc.indexOf('async function listRuntimeContainersFromLauncher', runtimeTargetDeleteStart),
    );
    expect(runtimeTargetDeleteSrc).toContain('await mutateDesktopPreferences((current) => {');
    expect(runtimeTargetDeleteSrc.indexOf('return deleteSavedRuntimeTarget(current, runtimeTargetID);')).toBeLessThan(
      runtimeTargetDeleteSrc.indexOf("launcherOperations.markSubjectDeleted('runtime_target', runtimeTargetID);"),
    );
    expect(runtimeTargetDeleteSrc).toContain('void (async () => {');
    expect(runtimeTargetDeleteSrc).toContain(
      'await runtimeLifecycleCoordinator.waitForIdle(targetKey).catch(() => undefined);',
    );

    expect(providerDeleteStart).toBeGreaterThanOrEqual(0);
    expect(providerCleanupStart).toBeGreaterThan(providerDeleteStart);
    const providerDeleteSrc = mainSrc.slice(providerDeleteStart, providerCleanupStart);
    expect(providerDeleteSrc).toContain("launcherOperations.markSubjectDeleted(\n    'control_plane'");
    expect(providerDeleteSrc).toContain(
      'await mutateDesktopPreferences((current) => deleteSavedControlPlane(current, request.provider_origin, request.provider_id));',
    );
    expect(providerDeleteSrc).toContain(
      'void cleanupDeletedControlPlane(controlPlane, refreshToken, providerSessionKeys);',
    );
    expect(providerDeleteSrc).not.toContain('await revokeProviderDesktopAuthorization');
    expect(providerDeleteSrc).not.toContain('await finalizeSessionClosure(sessionKey)');

    expect(syncAccountStart).toBeGreaterThanOrEqual(0);
    expect(syncStart).toBeGreaterThan(syncAccountStart);
    const syncAccountSrc = mainSrc.slice(syncAccountStart, syncStart);
    expect(syncAccountSrc).toContain('const assertCurrentSubject = () => {');
    expect(syncAccountSrc.indexOf('assertCurrentSubject();')).toBeLessThan(
      syncAccountSrc.indexOf('rememberControlPlaneAccessState('),
    );

    expect(syncStart).toBeGreaterThanOrEqual(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const syncSrc = mainSrc.slice(syncStart, syncEnd);
    expect(syncSrc).toContain(
      "const subjectGeneration = launcherOperations.currentSubjectGeneration('control_plane', key);",
    );
    expect(syncSrc).toContain(
      "if (launcherOperations.currentSubjectGeneration('control_plane', key) === subjectGeneration) {",
    );
  });

  it('keeps desktop diagnostics for SSH and external sessions in local userData', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain(
      'function desktopDiagnosticsStateDirForTarget(target: DesktopSessionTarget, startup: StartupReport): string',
    );
    expect(mainSrc).toContain("target.kind === 'local_environment'");
    expect(mainSrc).toContain("app.getPath('userData'), 'session-diagnostics'");
    expect(mainSrc).toContain('stateDirOverride: desktopDiagnosticsStateDirForTarget(target, startup)');
  });

  it('opens Local UI sessions at the canonical Env App entry while keeping the origin root as the navigation boundary', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('resolveDesktopSessionTransport(target, startup');
    expect(mainSrc).toContain('placementBridge: options.transportRecovery != null');
    expect(mainSrc).toContain('await prepareDesktopSessionTransport(transport);');
    expect(mainSrc).toContain("await webSession.setProxy({ mode: 'direct' });");
    expect(mainSrc).toContain('loopbackGateway?: WebServiceLoopbackGateway,\n): void');
    expect(mainSrc).toContain('desktopDiagnosticsHookSessions.has(webSession)');
    expect(mainSrc).toContain('shouldFailDesktopSessionMainDocument({');
    expect(mainSrc).toContain('details.resourceType');
    expect(mainSrc).toMatch(/\{\s*channel: 'http_status',\s*label: 'HTTP status',\s*text: String\(details\.statusCode\),?\s*\}/u);
    expect(mainSrc).toContain('const entryURL = transport.entryURL;');
    expect(mainSrc).toContain('const rootWindow = createSessionRootWindow(target.session_key, entryURL, diagnostics');
    expect(mainSrc).toContain(
      'const safeAllowedBaseURL = stripSensitiveURLPayload(transport.allowedBaseURL) || transport.allowedBaseURL;',
    );
    expect(mainSrc).toContain('allowed_base_url: safeAllowedBaseURL');
    expect(mainSrc).toContain('function rendererSafeStartupReport(startup: StartupReport): StartupReport');
    expect(mainSrc).toContain('delete rendererStartup.local_ui_bridge_url;');
    expect(mainSrc).toContain('delete rendererStartup.local_ui_bridge_token;');
    expect(mainSrc).toContain('entry_url: rendererSafeSessionURL(session)');
    expect(mainSrc).toContain('startup: rendererSafeStartupReport(session.startup)');
    expect(mainSrc).toContain("url.search = '';");
    expect(mainSrc).toContain("url.hash = '';");
    expect(mainSrc).toContain('void rootWindow.browserWindow.loadURL(entryURL);');
  });

  it('saves Local Environment settings without exposing deletion or extra local records', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('async function saveLocalEnvironmentSettingsFromWelcome(');
    expect(mainSrc).toContain("case 'save_local_environment_settings':");
    expect(mainSrc).toContain('mutateDesktopPreferences((current) => updateLocalEnvironmentSettings(current, {');
    expect(mainSrc).not.toContain('autoRuntimeProbeEnabled: draft.auto_runtime_probe_enabled');
    expect(mainSrc).toContain("'action_invalid',");
    expect(mainSrc).toContain("'dialog',");
  });

  it('broadcasts launcher snapshots per utility window and keeps session child identities stable', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL');
    expect(mainSrc).toContain('function emitDesktopWelcomeSnapshot(kind: DesktopUtilityWindowKind): Promise<void>');
    expect(mainSrc).toContain('function broadcastDesktopWelcomeSnapshots(): void {');
    expect(mainSrc).toContain('function senderUtilityWindowKind(webContentsID: number): DesktopUtilityWindowKind {');
    expect(mainSrc).toContain('function childWindowIdentity(frameName: string, targetURL: string): string {');
    expect(mainSrc).toContain('return `child:${url.pathname}${url.search}`;');
    expect(mainSrc).not.toContain('handoffAskFlowerToOwningSession');
    expect(mainSrc).not.toContain('queueSessionAskFlowerHandoff');
  });

  it('routes explicit quit, system quit, and non-macOS last-window close through shared quit-impact logic', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('buildDesktopLastWindowCloseConfirmationModel,');
    expect(mainSrc).toContain('buildDesktopQuitConfirmationModel,');
    expect(mainSrc).toContain('buildDesktopQuitImpact,');
    expect(mainSrc).toContain('shouldConfirmDesktopLastWindowClose,');
    expect(mainSrc).toContain('shouldConfirmDesktopQuit,');
    expect(mainSrc).toContain('showDesktopConfirmationDialog,');
    expect(mainSrc).toContain(
      "let quitPhase: 'idle' | 'confirming' | 'requested' | 'shutting_down' | 'update_installing' = 'idle';",
    );
    expect(mainSrc).toContain('const confirmedFinalWindowCloseWebContentsIDs = new Set<number>();');
    expect(mainSrc).toContain('label: string;');
    expect(mainSrc).toContain('async function buildCurrentDesktopQuitImpact(): Promise<DesktopQuitImpact> {');
    expect(mainSrc).toContain('pending_operation_count: launcherOperations.operations().filter((operation) => (');
    expect(mainSrc).toContain('for (const operation of runtimeLifecycleCoordinator.operations()) {');
    expect(mainSrc).toContain(
      "const reason = 'Redeven Desktop is quitting and canceling this runtime lifecycle operation.';",
    );
    expect(mainSrc).toContain(
      "runtimeLifecycleCoordinator.cancel(operation.target_key, new DOMException(reason, 'AbortError'));",
    );
    expect(mainSrc).toContain('runtimeLifecycleCoordinator.waitForAll()');
    expect(mainSrc).toContain('async function confirmDesktopImpact(');
    expect(mainSrc).toContain('async function requestFinalWindowClose(');
    expect(mainSrc).toContain('confirmedFinalWindowCloseWebContentsIDs.add(windowRecord.webContentsID);');
    expect(mainSrc).toContain('confirmedFinalWindowCloseWebContentsIDs.delete(closedWindow.webContentsID);');
    expect(mainSrc).not.toContain('confirmedFinalWindowCloseWebContentsIDs.delete(win.webContents.id);');
    expect(mainSrc).toContain("if (process.platform === 'darwin') {");
    expect(mainSrc).toContain('void requestFinalWindowClose(trackedWindow);');
    expect(mainSrc).toContain('if (shouldConfirmDesktopQuit(impact, source)) {');
    expect(mainSrc).toContain(
      'buildDesktopLastWindowCloseConfirmationModel(impact, desktopLanguageState().getSnapshot().resolved_locale)',
    );
    expect(mainSrc).toContain(
      'buildDesktopQuitConfirmationModel(impact, desktopLanguageState().getSnapshot().resolved_locale)',
    );
    expect(mainSrc).toContain("void requestQuit('last_window_close', win);");
    expect(mainSrc).toContain("void requestQuit('system');");
    expect(mainSrc).toContain("if (process.platform !== 'darwin' && quitPhase === 'idle') {");
  });

  it('pairs Gateways without native confirmation while verifying challenge and completion proof', () => {
    const mainSrc = readMainSource();
    const helperStart = mainSrc.indexOf('async function pairGatewayWithClient(');
    const syncStart = mainSrc.indexOf('async function syncGatewayRecord(', helperStart);
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(syncStart).toBeGreaterThan(helperStart);
    const helperSrc = mainSrc.slice(helperStart, syncStart);
    const pairStart = mainSrc.indexOf('async function pairGatewayFromLauncher(');
    const deleteStart = mainSrc.indexOf('async function deleteGatewayFromLauncher(', pairStart);
    expect(pairStart).toBeGreaterThanOrEqual(0);
    expect(deleteStart).toBeGreaterThan(pairStart);
    const pairSrc = mainSrc.slice(pairStart, deleteStart);

    expect(helperSrc).toContain("record.connection.kind === 'url'");
    expect(helperSrc).toContain("pairingChallengeRequestWithCode(material, options.pairingCode ?? '')");
    expect(helperSrc).toContain('const challenge = await client.pairingChallenge(record, challengeRequest, {');
    expect(helperSrc).toContain('assertGatewayPairingChallenge({');
    expect(pairSrc).not.toContain('confirmDesktopImpact({');
    expect(pairSrc).not.toContain("phase: 'waiting_for_identity_confirmation'");
    expect(helperSrc).toContain("const pairingOptions = record.connection.kind === 'url'");
    expect(helperSrc).not.toContain('runtimeGrants');
    expect(helperSrc).not.toContain('runtime_grants');
    expect(helperSrc).toContain(
      'const completionRequest = buildPairingCompleteRequest(material, challenge, pairingOptions);',
    );
    expect(helperSrc).toContain('const completion = await client.completePairing(record, completionRequest, {');
    expect(helperSrc).toContain('assertGatewayPairingCompleteResponse(material, challenge, completion, {');
    expect(helperSrc).toContain('completeGatewayPairing({');
    expect(helperSrc).toContain('trust_accepted: true');
    expect(helperSrc.indexOf('assertGatewayPairingChallenge({')).toBeLessThan(
      helperSrc.indexOf('const completion = await client.completePairing(record, completionRequest, {'),
    );
    expect(helperSrc.indexOf('assertGatewayPairingCompleteResponse(material, challenge, completion, {')).toBeLessThan(
      helperSrc.indexOf('completeGatewayPairing({'),
    );
    expect(helperSrc.indexOf('completeGatewayPairing({')).toBeLessThan(
      helperSrc.indexOf('gatewayStore().updateTrustProfile(currentRecord.gateway_id, trustProfile);'),
    );
    expect(helperSrc.indexOf('await options.beforeStoreWrite?.()')).toBeLessThan(
      helperSrc.indexOf('completeGatewayPairing({'),
    );
    expect(pairSrc).toContain('return refreshGatewayFromLauncher({');
    expect(pairSrc).toContain("kind: 'refresh_gateway'");
    expect(pairSrc).not.toContain('await client.pairingChallenge(');
    expect(pairSrc).not.toContain('await gatewayLifecycleManager().refreshCatalog(');
    expect(pairSrc).not.toContain('await syncGatewayRecord(record, {');
    expect(mainSrc).toContain("case 'pair_gateway':");
    expect(mainSrc).not.toContain('request.user_confirmed');
  });

  it('keeps the saved Gateway name as the source of truth during sync', () => {
    const mainSrc = readMainSource();
    const mergeStart = mainSrc.indexOf('function mergeGatewaySourceRecord(');
    const mergeEnd = mainSrc.indexOf('function setGatewaySyncRecord(', mergeStart);
    const syncStart = mainSrc.indexOf('async function syncGatewayRecord(');
    const syncEnd = mainSrc.indexOf('async function pairGatewayFromLauncher(', syncStart);
    expect(mergeStart).toBeGreaterThanOrEqual(0);
    expect(mergeEnd).toBeGreaterThan(mergeStart);
    expect(syncStart).toBeGreaterThanOrEqual(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const mergeSrc = mainSrc.slice(mergeStart, mergeEnd);
    const syncSrc = mainSrc.slice(syncStart, syncEnd);

    expect(mergeSrc).toContain('display_name: base.display_name,');
    expect(mergeSrc).not.toContain('display_name: source.display_name || base.display_name');
    expect(syncSrc).toContain('gatewayRecordToSourceWithCatalog(syncedRecord, {');
    expect(syncSrc).not.toContain('display_name: catalog.gateway.display_name');
  });

  it('keeps Gateway catalog sync in a main-process poller instead of snapshot-time probing', () => {
    const mainSrc = readMainSource();
    const loadStart = mainSrc.indexOf('async function loadGatewaySourcesForWelcome(');
    const defaultSyncStart = mainSrc.indexOf('function defaultGatewaySyncRecord(', loadStart);
    expect(defaultSyncStart).toBeGreaterThan(loadStart);
    const loadSrc = mainSrc.slice(loadStart, defaultSyncStart);

    expect(mainSrc).toContain('const gatewaySyncStateByID = new Map<string, GatewaySyncRecord>();');
    expect(mainSrc).toContain('type GatewaySyncTaskRecord = Readonly<{');
    expect(mainSrc).toContain('priority: GatewaySyncOperationPriority;');
    expect(mainSrc).toContain('token: symbol;');
    expect(mainSrc).toContain('controller: AbortController;');
    expect(mainSrc).toContain('task: Promise<DesktopGatewaySource>;');
    expect(mainSrc).toContain('const gatewaySyncTaskByID = new Map<string, GatewaySyncTaskRecord>();');
    expect(mainSrc).toContain('const supersededGatewaySyncTaskTokens = new Set<symbol>();');
    expect(mainSrc).toContain('function supersedeGatewaySyncTask(gatewayID: string): void');
    expect(mainSrc).toContain('function updateGatewaySyncPoller(): void');
    expect(mainSrc).toContain('async function syncVisibleGatewaysIfNeeded(');
    expect(mainSrc).toContain('last_synced_at_ms: 0,');
    expect(mainSrc).toContain('background_sync_running: false,');
    expect(mainSrc).toContain('const serviceStatus = syncRecord?.source?.service_state?.status;');
    expect(mainSrc).toContain(
      "serviceStatus === 'not_started' || serviceStatus === 'service_needs_update' || serviceStatus === 'needs_reinstall'",
    );
    expect(mainSrc).toContain('if (!syncRecord?.source) {');
    expect(mainSrc).toContain('if (!record.local_enabled) {');
    expect(mainSrc).toMatch(/gatewaySyncTaskByID\.set\(record\.gateway_id,\s*\{\s*priority,\s*token: taskToken,\s*controller,\s*task,?\s*\}\);/u);
    expect(loadSrc).not.toContain('inspectRuntime(');
    expect(loadSrc).not.toContain('refreshCatalog(');
    expect(loadSrc).toContain('mergeGatewaySourceRecord(');
  });

  it('keeps Gateway enable/disable and Refresh as explicit local state transitions', () => {
    const mainSrc = readMainSource();
    const scheduleStart = mainSrc.indexOf('function scheduleGatewaySyncAfterLauncherAction(');
    const scheduleEnd = mainSrc.indexOf('async function buildCurrentDesktopWelcomeSnapshot(', scheduleStart);
    const syncStart = mainSrc.indexOf('async function syncGatewayRecord(');
    const syncEnd = mainSrc.indexOf('async function syncGatewayIfNeeded(', syncStart);
    const toggleStart = mainSrc.indexOf('async function setGatewayEnabledFromLauncher(');
    const toggleEnd = mainSrc.indexOf('async function pairGatewayFromLauncher(', toggleStart);
    expect(scheduleStart).toBeGreaterThanOrEqual(0);
    expect(scheduleEnd).toBeGreaterThan(scheduleStart);
    expect(syncStart).toBeGreaterThanOrEqual(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    expect(toggleStart).toBeGreaterThanOrEqual(0);
    expect(toggleEnd).toBeGreaterThan(toggleStart);
    const scheduleSrc = mainSrc.slice(scheduleStart, scheduleEnd);
    const syncSrc = mainSrc.slice(syncStart, syncEnd);
    const toggleSrc = mainSrc.slice(toggleStart, toggleEnd);

    expect(scheduleSrc).toContain("case 'set_gateway_enabled':");
    expect(scheduleSrc).toContain(
      "const requestEnabled = request.kind === 'set_gateway_enabled' ? request.enabled : true;",
    );
    expect(scheduleSrc).toContain('if (!requestEnabled) {');
    expect(scheduleSrc).toContain('gatewaySyncStateByID.delete(gatewayID);');
    expect(scheduleSrc).toContain('supersedeGatewaySyncTask(gatewayID);');
    expect(scheduleSrc).toContain('broadcastDesktopWelcomeSnapshots();');
    expect(toggleSrc).toContain('gatewayStore().setLocalEnabled(request.gateway_id, request.enabled)');
    expect(toggleSrc).toContain('if (!request.enabled) {');
    expect(toggleSrc).toContain('gatewaySyncStateByID.delete(record.gateway_id);');
    expect(toggleSrc).toContain('supersedeGatewaySyncTask(record.gateway_id);');
    expect(toggleSrc).toContain("return launcherActionSuccess('disabled_gateway');");
    expect(toggleSrc).toContain("return launcherActionSuccess('enabled_gateway');");
    expect(toggleSrc).not.toContain('syncGatewayIfNeeded(');
    expect(syncSrc).toContain("if (priority === 'background' || existingTaskRecord.priority === 'foreground') {");
    expect(syncSrc).toContain('supersedeGatewaySyncTask(record.gateway_id);');
    expect(syncSrc).toContain('if (!latestRecord.local_enabled) {');
    expect(syncSrc).toContain(
      "throw new GatewaySyncCanceledError('Gateway sync was canceled because this Gateway is disabled on this Desktop.');",
    );
  });

  it('waits for the real Desktop Runtime health projection after direct lifecycle success', () => {
    const mainSrc = readMainSource();
    const directStart = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(');
    const directEnd = mainSrc.indexOf('async function connectProviderRuntimeFromLauncher(', directStart);
    const directSrc = mainSrc.slice(directStart, directEnd);

    expect(mainSrc).toMatch(/await refreshWelcomeRuntimeHealthForEnvironment\(input\.environment_id,\s*\{\s*force: true,?\s*\}\)/u);
    expect(directSrc).not.toContain('syncGatewayRecord(');
    expect(directSrc).toContain('return executeDirectManagedEnvironmentLifecycle({');
    expect(directSrc).toContain('operation: coordinatorIntent');
    expect(mainSrc).not.toContain('reinstallTargetRequiredFailureIfPresent');
    expect(directSrc).not.toContain('gatewayLifecycleManager()');
    expect(directSrc).not.toContain('open-session');
  });

  it('keeps Runtime recovery inside Open as a child of the parent Launcher Operation', () => {
    const mainSrc = readMainSource();
    const executeStart = mainSrc.indexOf('async function executeDirectManagedEnvironmentLifecycle(');
    const executeEnd = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(', executeStart);
    expect(executeStart).toBeGreaterThanOrEqual(0);
    expect(executeEnd).toBeGreaterThan(executeStart);
    const executeSrc = mainSrc.slice(executeStart, executeEnd);

    expect(executeSrc).toContain("operation_owner: 'runtime_lifecycle' | 'open'");
    expect(executeSrc).toContain("if (input.operation_owner === 'runtime_lifecycle') {");
    expect(executeSrc).toContain("launcherOperations.finishCurrentAttempt(input.operation_key, owner, 'succeeded'");
    expect(executeSrc).toContain('scheduleCurrentLauncherOperationRemoval(input.operation_key, owner);');
    expect(executeSrc).toContain('launcherOperations.updateCurrentAttempt(input.operation_key, owner, {');
    const standaloneBranch = executeSrc.indexOf("if (input.operation_owner === 'runtime_lifecycle') {");
    const childUpdate = executeSrc.indexOf(
      'launcherOperations.updateCurrentAttempt(input.operation_key, owner, {',
      standaloneBranch,
    );
    expect(childUpdate).toBeGreaterThan(standaloneBranch);
    expect(executeSrc.slice(childUpdate)).not.toContain(
      'scheduleCurrentLauncherOperationRemoval(input.operation_key, owner);',
    );
  });

  it('returns the exact reinstall operation identity after preview and continuation', () => {
    const mainSrc = readMainSource();
    const reinstallStart = mainSrc.indexOf('async function previewReinstallTargetFromLauncher(');
    const reinstallEnd = mainSrc.indexOf('async function deleteGatewayFromLauncher(', reinstallStart);
    const reinstallSrc = mainSrc.slice(reinstallStart, reinstallEnd);

    expect(reinstallSrc).toContain('operationStartedAtUnixMS: operation.started_at_unix_ms');
    expect(reinstallSrc).toContain('operationStartedAtUnixMS: existing.started_at_unix_ms');
    expect(reinstallSrc).toContain('candidatePreview.environment_id === request.environment_id');
    expect(reinstallSrc).toContain('candidatePreview.mode === requestedMode');
    expect(reinstallSrc.indexOf('candidatePreview.mode === requestedMode')).toBeLessThan(
      reinstallSrc.indexOf("intent: 'reinstall'"),
    );
    expect(reinstallSrc).toContain('resolveDirectReinstallTarget(preview.environment_id)');
    expect(reinstallSrc).toContain('mode: preview.mode');
    expect(reinstallSrc).toContain('preflight_id: preview.preflight_id');
    expect(reinstallSrc).not.toContain('resolveDirectReinstallTarget(request.environment_id)');
    expect(readSharedLauncherIPCSource()).toContain('operation_started_at_unix_ms?: number;');
  });

  it('converges every affected Environment after successful reinstall through one refresh path', () => {
    const mainSrc = readMainSource();
    const convergenceStart = mainSrc.indexOf('async function convergeLauncherStateAfterSuccessfulReinstall(');
    const convergenceEnd = mainSrc.indexOf('async function reinstallRecoveryRequiredTargetFingerprints(', convergenceStart);
    const convergenceSrc = mainSrc.slice(convergenceStart, convergenceEnd);
    const retirementStart = mainSrc.indexOf('function retireSupersededEnvironmentOperations(');
    const retirementEnd = mainSrc.indexOf(
      'async function executeDirectManagedEnvironmentLifecycle(',
      retirementStart,
    );
    const retirementSrc = mainSrc.slice(retirementStart, retirementEnd);
    const reinstallStart = mainSrc.indexOf('async function reinstallTargetFromLauncher(');
    const reinstallEnd = mainSrc.indexOf('async function deleteGatewayFromLauncher(', reinstallStart);
    const reinstallSrc = mainSrc.slice(reinstallStart, reinstallEnd);
    const refreshScopeStart = mainSrc.indexOf('function launcherActionRefreshScope(');
    const refreshScopeEnd = mainSrc.indexOf(
      'function scheduleWelcomeRuntimeHealthRefreshAfterLauncherAction(',
      refreshScopeStart,
    );
    const refreshScopeSrc = mainSrc.slice(refreshScopeStart, refreshScopeEnd);

    expect(convergenceStart).toBeGreaterThanOrEqual(0);
    expect(convergenceEnd).toBeGreaterThan(convergenceStart);
    expect(convergenceSrc).toContain('retireSupersededEnvironmentOperations(affected, currentOperationKey);');
    expect(convergenceSrc).toContain('resetLauncherIssueState();');
    expect(convergenceSrc.match(/refreshWelcomeRuntimeHealth\(\{/gu)).toHaveLength(1);
    expect(convergenceSrc).toContain("mode: 'manual'");
    expect(convergenceSrc).toContain('force: true');
    expect(convergenceSrc).toContain('targetEnvironmentIDs: affected');
    expect(retirementStart).toBeGreaterThanOrEqual(0);
    expect(retirementEnd).toBeGreaterThan(retirementStart);
    expect(retirementSrc).toContain('supersededEnvironmentOperationKeys(');
    expect(retirementSrc).toContain('removeLauncherOperation(operationKey);');
    expect(reinstallSrc).toContain('return await runtimeLifecycleCoordinator.run({');
    expect(reinstallSrc).toContain('const completedJournal = await reinstallTargetCoordinator().execute(');
    expect(reinstallSrc).toContain('completedJournal.affected_environment_ids');
    expect(reinstallSrc).not.toContain('operation.reinstall_preview?.affected_environment_ids');
    expect(refreshScopeSrc).not.toContain("case 'reinstall_target':");
  });

  it('routes legacy Gateway refresh requests through the unified Refresh workflow', () => {
    const mainSrc = readMainSource();
    const syncStart = mainSrc.indexOf('async function syncGatewayRecord(');
    const syncEnd = mainSrc.indexOf('async function syncGatewayIfNeeded(', syncStart);
    expect(syncStart).toBeGreaterThanOrEqual(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const syncSrc = mainSrc.slice(syncStart, syncEnd);
    const refreshStart = mainSrc.indexOf('async function refreshGatewayStatusFromLauncher(');
    const refreshEnd = mainSrc.indexOf('function reinstallTargetFailureCode(', refreshStart);
    expect(refreshStart).toBeGreaterThanOrEqual(0);
    expect(refreshEnd).toBeGreaterThan(refreshStart);
    const refreshSrc = mainSrc.slice(refreshStart, refreshEnd);

    expect(syncSrc).not.toContain("mode === 'refresh_status'");
    expect(syncSrc).toContain('inspectGatewayServiceForSync(currentRecord, {');
    expect(syncSrc).toContain('const client = await gatewayClientForSync(currentRecord, {');
    expect(syncSrc).toContain('startPolicy,');
    expect(syncSrc).toContain('pairGatewayWithClient(currentRecord, client, secretStore, {');
    expect(syncSrc).toContain('return gatewayLifecycleManager().refreshCatalog(targetRecord, {');
    expect(refreshSrc).toContain('return refreshGatewayFromLauncher({');
    expect(refreshSrc).toContain("kind: 'refresh_gateway'");
    expect(refreshSrc).not.toContain("kind: 'sync_gateway'");
    expect(refreshSrc).not.toContain('refresh_status');
    expect(mainSrc).toContain("if (requested === 'start_if_needed') {");
    expect(mainSrc).toContain("return 'require_ready';");
  });

  it('does not repair incompatible managed Gateway trust through the old sync fallback', () => {
    const mainSrc = readMainSource();
    const syncStart = mainSrc.indexOf('async function syncGatewayRecord(');
    const syncEnd = mainSrc.indexOf('async function syncGatewayIfNeeded(', syncStart);
    expect(syncStart).toBeGreaterThanOrEqual(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const syncSrc = mainSrc.slice(syncStart, syncEnd);

    expect(mainSrc).not.toContain('function gatewayTrustErrorNeedsRepair(');
    expect(mainSrc).not.toContain('function gatewayErrorNeedsTrustRepair(');
    expect(mainSrc).not.toContain('function gatewayCanRepairManagedTrust(');
    expect(syncSrc).not.toContain('catch (catalogError) {');
    expect(syncSrc).not.toContain('repairClient');
    expect(syncSrc).not.toContain('gatewayErrorNeedsTrustRepair');
  });

  it('blocks ordinary Gateway sync and lifecycle actions after reinstall is required', () => {
    const mainSrc = readMainSource();
    const syncStart = mainSrc.indexOf('async function syncGatewayRecord(');
    const syncEnd = mainSrc.indexOf('async function syncGatewayIfNeeded(', syncStart);
    const syncSrc = mainSrc.slice(syncStart, syncEnd);
    expect(syncSrc).toContain('if (!currentRecord.trust_profile)');
    expect(syncSrc).toContain('options.allowPairing !== true');
    expect(syncSrc).toContain("classification: 'pairing_required'");
    expect(syncSrc).not.toContain('gatewayReinstallPairingRequired');

    expect(mainSrc).not.toContain('runGatewayServiceActionFromLauncher');

    const refreshStart = mainSrc.indexOf('async function refreshGatewayFromLauncher(');
    const refreshEnd = mainSrc.indexOf('async function checkGatewayFromLauncher(', refreshStart);
    const refreshSrc = mainSrc.slice(refreshStart, refreshEnd);
    expect(refreshSrc).not.toContain('allowReinstallPairing');
    expect(refreshSrc).toContain('allowPairing: options.allowPairing === true');
  });

  it('keeps Gateway service state stable while sync activity is running', () => {
    const mainSrc = readMainSource();
    const helperStart = mainSrc.indexOf('function gatewaySyncingServiceState(');
    const helperEnd = mainSrc.indexOf('async function inspectGatewayServiceForSync(', helperStart);
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperSrc = mainSrc.slice(helperStart, helperEnd);

    expect(helperSrc).toContain('if (previous) {');
    expect(helperSrc).toContain('return previous;');
    expect(helperSrc).toContain("status: 'unknown'");
    expect(helperSrc).not.toContain("status: previous?.status === 'ready' ? 'ready' : 'starting'");
  });

  it('does not erase the confirmed Gateway service state after stop actions finish', () => {
    const mainSrc = readMainSource();
    const sideEffectStart = mainSrc.indexOf('function scheduleGatewaySyncAfterLauncherAction(');
    const snapshotStart = mainSrc.indexOf('async function buildCurrentDesktopWelcomeSnapshot(', sideEffectStart);
    expect(sideEffectStart).toBeGreaterThanOrEqual(0);
    expect(snapshotStart).toBeGreaterThan(sideEffectStart);
    const sideEffectSrc = mainSrc.slice(sideEffectStart, snapshotStart);

    expect(sideEffectSrc).not.toContain("case 'stop_gateway':");
    expect(sideEffectSrc).not.toContain(
      'gatewaySyncStateByID.delete(gatewayID);\n        gatewayDiagnosisByID.delete(gatewayID);\n        broadcastDesktopWelcomeSnapshots();',
    );
  });

  it('keeps Standalone Gateway lifecycle actions host-managed and unavailable in Desktop', () => {
    const mainSrc = readMainSource();
    expect(mainSrc).not.toContain('runGatewayServiceActionFromLauncher');
  });

  it('opens Gateway-backed Environments only through explicit access endpoints', () => {
    const mainSrc = readMainSource();
    const openStart = mainSrc.indexOf('async function openGatewayEnvironmentFromLauncher(');
    const openEnd = mainSrc.indexOf('async function openProviderRemoteEnvironmentRecord(', openStart);
    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(openEnd).toBeGreaterThan(openStart);
    const openSrc = mainSrc.slice(openStart, openEnd);
    expect(openSrc).toContain('gatewayEnvironmentAccessEndpoint(record, environment)');
    expect(openSrc).toContain('openRemoteEnvironmentFromLauncher({');
    expect(openSrc).not.toContain('openSessionWithBridge');
    expect(openSrc).not.toContain('pairGatewayWithClient');
    const endpointStart = mainSrc.indexOf('function gatewayEnvironmentAccessEndpoint(');
    const endpointEnd = mainSrc.indexOf('async function upsertGatewayEnvironmentProfileFromLauncher(', endpointStart);
    expect(endpointStart).toBeGreaterThanOrEqual(0);
    expect(endpointEnd).toBeGreaterThan(endpointStart);
    const endpointSrc = mainSrc.slice(endpointStart, endpointEnd);
    expect(endpointSrc).toContain("route.kind !== 'url'");
    expect(endpointSrc).toContain("pathName.includes('/gateway')");
  });

  it('parses Control Plane deep links through PKCE authorization state instead of bearer handoff tickets', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("parsed.searchParams.get('authorization_code')");
    expect(mainSrc).toContain("parsed.pathname === '/authorized'");
    expect(mainSrc).toContain('createPendingControlPlaneAuthorization');
    expect(mainSrc).toContain('exchangeProviderDesktopConnectAuthorization');
    expect(mainSrc).not.toContain("parsed.searchParams.get('session_token')");
    expect(mainSrc).not.toContain("parsed.searchParams.get('handoff_ticket')");
  });

  it('keeps Managed Environment operation discovery out of Gateway sources', () => {
    const mainSrc = readMainSource();
    expect(mainSrc).not.toContain('refreshDirectGatewayRuntimeOperationAttachments(');
    expect(mainSrc).not.toContain('upsertDirectRuntimeGateway(');
    expect(mainSrc).toContain('executeDirectManagedEnvironmentLifecycle({');
  });

  it('does not retain Provider lifecycle attachment or reconcile paths', () => {
    const mainSrc = readMainSource();
    expect(mainSrc).not.toContain('refreshProviderRuntimeOperationAttachments(');
    expect(mainSrc).not.toContain('reconcileRuntimeOperationFromLauncher(');
    expect(mainSrc).not.toContain('authorizeProviderRuntimeOperation(');
  });
});
