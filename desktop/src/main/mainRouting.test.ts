import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readMainSource(): string {
  return fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
}

describe('main routing', () => {
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

  it('tracks environment windows by session key and scopes child windows per session', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('const sessionsByKey = new Map<DesktopSessionKey, DesktopSessionRecord>();');
    expect(mainSrc).toContain('const sessionKeyByWebContentsID = new Map<number, DesktopSessionKey>();');
    expect(mainSrc).toContain('function sessionWindowStateKey(sessionKey: DesktopSessionKey): string {');
    expect(mainSrc).toContain('function sessionChildWindowStateKey(sessionKey: DesktopSessionKey, childKey: string): string {');
    expect(mainSrc).toContain('function openSessionChildWindow(');
    expect(mainSrc).toContain('if (isAllowedSessionNavigation(sessionKey, nextURL)) {');
    expect(mainSrc).toContain('child_windows: Map<string, DesktopTrackedWindow>;');
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
    expect(mainSrc).toContain('await openAdvancedSettingsWindow();');
    expect(mainSrc).toContain("return openUtilityWindow('launcher', {");
    expect(mainSrc).toContain("surface: 'environment_settings',");
    expect(mainSrc).toContain("return focusEnvironmentWindow(request.session_key);");
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

  it('reconciles saved runtime target maintenance before exposing Welcome state', () => {
    const mainSrc = readMainSource();
    const inspectStart = mainSrc.indexOf('async function inspectSavedRuntimeTargetState(');
    const inspectEnd = mainSrc.indexOf('function createInitialLoadDeferred(', inspectStart);
    expect(inspectStart).toBeGreaterThanOrEqual(0);
    expect(inspectEnd).toBeGreaterThan(inspectStart);
    const inspectSrc = mainSrc.slice(inspectStart, inspectEnd);

    expect(mainSrc).toContain('function runtimePlacementMaintenanceForRuntimeService(');
    expect(mainSrc).toContain('runtimePlacementMaintenanceByTargetID.delete(targetID)');
    expect(inspectSrc).toContain('maintenance: runtimePlacementMaintenanceForRuntimeService(target.targetID, bridgeRecord.startup.runtime_service)');
    expect(inspectSrc).toContain('maintenance: runtimePlacementMaintenanceForRuntimeService(target.targetID, cachedReadyRecord.startup?.runtime_service)');
    expect(inspectSrc).toContain('const maintenance = runtimePlacementMaintenanceForRuntimeService(target.targetID, report.startup.runtime_service);');
    expect(inspectSrc).not.toContain('maintenance: maintenance && !runtimeServiceIsOpenable(report.startup.runtime_service)');
  });

  it('lets dev SSH bootstrap use an explicit runtime release tag without changing the bundled runtime version', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('process.env.REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG');
    expect(mainSrc.indexOf('process.env.REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG')).toBeLessThan(
      mainSrc.indexOf('process.env.REDEVEN_DESKTOP_BUNDLE_VERSION'),
    );
    expect(mainSrc).toContain('Set REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG for dev SSH bootstrap');
  });

  it('routes runtime lifecycle and Open connection progress through cancellable launcher operations', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL');
    expect(mainSrc).toContain('const launcherOperations = new LauncherOperationRegistry(handleLauncherOperationChange);');
    expect(mainSrc).toContain('actionProgress: launcherOperations.progressItems()');
    expect(mainSrc).toContain('operations: launcherOperations.operations()');
    expect(mainSrc).toContain('desktopRuntimeLifecycleLocation');
    expect(mainSrc).toContain('buildRuntimeLifecycleProgress');
    expect(mainSrc).toContain('updateRuntimeLifecycleOperation');
    expect(mainSrc).toContain('lifecycleProgress.stage_index < current.lifecycle_progress.stage_index');
    expect(mainSrc).toContain("lifecycle_progress: runtimeLifecycleProgress({");
    expect(mainSrc).toContain("location: 'ssh_host'");
    expect(mainSrc).toContain("const hostAccess: DesktopRuntimeHostAccess = { kind: 'local_host' };");
    expect(mainSrc).toContain('const localHostPlacement: DesktopRuntimePlacement = { kind: \'host_process\'');
    expect(mainSrc).toContain("subject_kind: 'local_environment'");
    expect(mainSrc).toContain("subject_kind: 'runtime_target'");
    expect(mainSrc).toContain('operation_key: operationKey');
    expect(mainSrc).toContain('operation_key: targetID');
    expect(mainSrc).toContain("phase: 'checking_existing_runtime'");
    expect(mainSrc).toContain("case 'waiting_for_readiness':\n      return 'checking_runtime_service';");
    expect(mainSrc).toContain('open_progress: buildOpenConnectionProgress(input)');
    expect(mainSrc).toContain("interrupt_label: 'Stop opening'");
    expect(mainSrc).toContain('const pendingStart = pendingSSHRuntimeStartByKey.get(runtimeKey) ?? null;');
    expect(mainSrc).toContain('const pendingStart = pendingRuntimePlacementStartByTargetID.get(targetID) ?? null;');
    expect(mainSrc).toContain('return pendingStart.task;');
    expect(mainSrc).toContain('const sshRuntimeMaintenanceByKey = new Map');
    expect(mainSrc).toContain('error instanceof DesktopSSHRuntimeMaintenanceRequiredError');
    expect(mainSrc).toContain('sshRuntimeMaintenanceByKey.set(runtimeKey, error.maintenance)');
    expect(mainSrc).toContain('runtime_maintenance: maintenance');
    expect(mainSrc).toContain('sshRuntimeMaintenanceByKey.delete(runtimeKey)');
    expect(mainSrc).toContain('const operation = launcherOperations.create({');
    expect(mainSrc).toContain("phase: 'ssh_preparing_start'");
    expect(mainSrc).toContain('title: runtimeLifecycleStartTitle(action)');
    expect(mainSrc).toContain('action,');
    expect(mainSrc).toContain("subject_kind: 'ssh_environment'");
    expect(mainSrc).toContain('cancelable: true');
    expect(mainSrc).toContain("interrupt_label: 'Stop startup'");
    expect(mainSrc).toContain('signal,');
    expect(mainSrc).toContain("interrupt_kind: 'stop_opening'");
    expect(mainSrc).toContain('const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;');
    expect(mainSrc).toContain('environment_label: label');
    expect(mainSrc).toContain('phase: sshRuntimeLifecyclePhase(progress.phase)');
    expect(mainSrc).toContain('detail: progress.detail');
    expect(mainSrc).toContain('runtimeLifecycleProgressFromSSH(sshDetails, progress, label, lifecycleOperation)');
    expect(mainSrc).toContain('ensureRuntimePlacementReady({');
    expect(mainSrc).toContain('on_progress: (progress: RuntimePlacementProgress) => {');
    expect(mainSrc).toContain('const launch = await startManagedRuntime({');
    expect(mainSrc).toContain('onProgress: (progress: ManagedRuntimeProgress) => {');
    expect(mainSrc).toContain('launcherOperations.isStale(runtimeKey)');
    expect(mainSrc).toContain('scheduleLauncherOperationRemoval(runtimeKey);');
    expect(mainSrc).toContain('const startedAtUnixMs = snapshot?.started_at_unix_ms;');
    expect(mainSrc).toContain('current?.started_at_unix_ms !== startedAtUnixMs');
    expect(mainSrc).toContain('function desktopFailureFromError(');
    expect(mainSrc).toContain('operationFailureFromUnknown(error, desktopOperationFailurePresentation({');
    expect(mainSrc).not.toContain('function friendlyRuntimeStartErrorMessage(');
    expect(mainSrc).not.toContain('firstDisplayLine(');
    expect(mainSrc).not.toContain(['The SSH host resolved its runtime directory to', '/root'].join(' '));
  });

  it('routes runtime maintenance through an explicit Desktop session contract', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('DESKTOP_SHELL_RUNTIME_MAINTENANCE_CONTEXT_CHANNEL');
    expect(mainSrc).toContain('function runtimeMaintenanceContextFromSession(');
    expect(mainSrc).toContain("authority: 'desktop_ssh'");
    expect(mainSrc).toContain("method: 'desktop_ssh_restart'");
    expect(mainSrc).toContain("method: 'desktop_ssh_force_update'");
    expect(mainSrc).toContain("method: 'desktop_local_update_handoff'");
    expect(mainSrc).toContain('async function restartSSHRuntimeFromShell(');
    expect(mainSrc).toContain('async function manageDesktopUpdateFromLauncher(');
    expect(mainSrc).toContain('async function runEnvironmentRuntimeLifecycleFromLauncher(');
    expect(mainSrc).toContain('async function restartEnvironmentRuntimeFromLauncher(');
    expect(mainSrc).toContain("case 'manage_desktop_update':");
    expect(mainSrc).toContain("case 'restart_environment_runtime':");
    expect(mainSrc).toContain("launcherActionSuccess('opened_desktop_update_handoff')");
    expect(mainSrc).toContain('forceRuntimeUpdate: options.forceRuntimeUpdate === true');
    expect(mainSrc).toContain('allowActiveWorkReplacement: true');
    expect(mainSrc).toContain("if (normalized.action === 'restart_runtime')");
    expect(mainSrc).toContain("if (normalized.action === 'upgrade_runtime')");
  });

  it('uses fresh provider health and SSH runtime-affecting settings for launcher routing', () => {
    const mainSrc = readMainSource();
    const routeSnapshotStart = mainSrc.indexOf('function controlPlaneRouteSnapshot(');
    const routeSnapshotEnd = mainSrc.indexOf('function launcherActionFailureForRemoteRouteState', routeSnapshotStart);
    expect(routeSnapshotStart).toBeGreaterThanOrEqual(0);
    expect(routeSnapshotEnd).toBeGreaterThan(routeSnapshotStart);
    const routeSnapshotSrc = mainSrc.slice(routeSnapshotStart, routeSnapshotEnd);
    expect(routeSnapshotSrc).toContain('const summary = controlPlaneSummary(controlPlane);');
    expect(routeSnapshotSrc).toContain('summary.environments.find');
    expect(routeSnapshotSrc).not.toContain('controlPlane.environments.find');

    const sshStartStart = mainSrc.indexOf('async function startSSHEnvironmentRuntimeRecord(');
    const sshStartEnd = mainSrc.indexOf('const pendingStart = pendingSSHRuntimeStartByKey.get(runtimeKey)', sshStartStart);
    expect(sshStartStart).toBeGreaterThanOrEqual(0);
    expect(sshStartEnd).toBeGreaterThan(sshStartStart);
    const sshStartSrc = mainSrc.slice(sshStartStart, sshStartEnd);
    expect(sshStartSrc).toContain('options.forceRuntimeUpdate !== true');
    expect(sshStartSrc).toContain('!activeWorkReplacementAllowed');
    expect(sshStartSrc).toContain('desktopSSHRuntimeAffectingSettingsMatch(existingRecord.details, sshDetails)');

    const sshStartTaskEnd = mainSrc.indexOf('const managedSSHRuntime = await ensureManagedSSHRuntimeReady', sshStartStart);
    expect(sshStartTaskEnd).toBeGreaterThan(sshStartStart);
    const sshStartTaskSrc = mainSrc.slice(sshStartStart, sshStartTaskEnd);
    expect(sshStartTaskSrc).toContain("if (statusProbe.status === 'blocked')");
    expect(sshStartTaskSrc).toContain('const replacingReadySSHRuntime = action === \'restart_environment_runtime\'');
    expect(sshStartTaskSrc).toContain('await stopManagedSSHRuntimeProcess({');
    expect(sshStartTaskSrc).toContain('!maintenance.can_desktop_restart');
    expect(sshStartTaskSrc).toContain('maintenance.can_desktop_restart');

    const openSSHStart = mainSrc.indexOf('async function openSSHEnvironmentFromLauncher(');
    const openSSHEnd = mainSrc.indexOf('const optimisticSessionKey = sshDesktopSessionKey(sshDetails);', openSSHStart);
    expect(mainSrc.slice(openSSHStart, openSSHEnd)).toContain('connect_timeout_seconds: request.connect_timeout_seconds');

    const startRuntimeStart = mainSrc.indexOf('function sshDetailsFromRuntimeTargetRequest(');
    const startRuntimeEnd = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(', startRuntimeStart);
    expect(mainSrc.slice(startRuntimeStart, startRuntimeEnd)).toContain('connect_timeout_seconds: request.connect_timeout_seconds');
  });

  it('keeps runtime lifecycle dispatch target-first and opens container placement only through bridge sessions', () => {
    const mainSrc = readMainSource();
    expect(mainSrc).not.toContain('function launcherActionFailureForUnsupportedRuntimePlacement(');
    expect(mainSrc).toContain('const runtimePlacementBridgeByTargetID = new Map<DesktopRuntimeTargetID, RuntimePlacementBridgeRecord>();');
    expect(mainSrc).toContain('const runtimePlacementReadyByTargetID = new Map<DesktopRuntimeTargetID, RuntimePlacementReadyRecord>();');
    expect(mainSrc).toContain('startRuntimePlacementBridgeSession({');
    expect(mainSrc).toContain('startDesktopModelSourceForStartup({');
    expect(mainSrc).toContain('runtimePlacementReadyByTargetID.set(targetID, readyRecord)');
    expect(mainSrc).toContain('runtimePlacementBridgeByTargetID.set(bridgeSession.placement_target_id, record)');
    expect(mainSrc).toContain('open_connection_required: true');
    expect(mainSrc).toContain('openConnectionRequired: state.open_connection_required === true');
    expect(mainSrc).toContain('async function openRuntimePlacementBridgeFromLauncher(');
    const bridgeOpenStart = mainSrc.indexOf('async function openRuntimePlacementBridgeFromLauncher(');
    const bridgeOpenEnd = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(', bridgeOpenStart);
    const bridgeOpenSrc = mainSrc.slice(bridgeOpenStart, bridgeOpenEnd);
    expect(bridgeOpenSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(environmentID)');
    expect(bridgeOpenSrc).toContain("title: 'Checking runtime status'");
    expect(bridgeOpenSrc).not.toContain('Start this runtime first, then open it.');
    expect(mainSrc).toContain('resolveRuntimeContainerPlacement');
    expect(mainSrc).toContain('DESKTOP_LAUNCHER_LIST_RUNTIME_CONTAINERS_CHANNEL');
    expect(mainSrc).not.toContain('containerStartCommand');
    expect(mainSrc).not.toContain('containerStopCommand');
    expect(mainSrc).not.toContain("container_engine, 'start'");
    expect(mainSrc).not.toContain("container_engine, 'stop'");

    const ensureRuntimeStart = mainSrc.indexOf('async function ensureRuntimePlacementReadyRecordFromLauncher(');
    const ensureRuntimeEnd = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(', ensureRuntimeStart);
    expect(ensureRuntimeStart).toBeGreaterThanOrEqual(0);
    expect(ensureRuntimeEnd).toBeGreaterThan(ensureRuntimeStart);
    const ensureRuntimeSrc = mainSrc.slice(ensureRuntimeStart, ensureRuntimeEnd);
    expect(ensureRuntimeSrc).toContain('inspection.ready_record && replacementRequested');

    const startRuntimeStart = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(');
    const startRuntimeEnd = mainSrc.indexOf('async function connectProviderRuntimeFromLauncher(', startRuntimeStart);
    const startRuntimeSrc = mainSrc.slice(startRuntimeStart, startRuntimeEnd);
    expect(startRuntimeSrc).toContain("if (requestedPlacement.kind === 'container_process')");
    expect(startRuntimeSrc).toContain('ensureRuntimePlacementReadyRecordFromLauncher(request)');
    expect(startRuntimeSrc).not.toContain('startRuntimePlacementBridgeSession({');
    expect(startRuntimeSrc).toContain('const normalizedSSHTarget = sshDetailsFromRuntimeTargetRequest(request);');

    const stopRuntimeStart = mainSrc.indexOf('async function stopEnvironmentRuntimeFromLauncher(');
    const stopRuntimeEnd = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(', stopRuntimeStart);
    const stopRuntimeSrc = mainSrc.slice(stopRuntimeStart, stopRuntimeEnd);
    expect(stopRuntimeSrc).toContain("if (placement.kind === 'container_process')");
    expect(stopRuntimeSrc).toContain("action: 'stop_environment_runtime'");
    expect(stopRuntimeSrc).toContain("operation: lifecycleOperation");
    expect(stopRuntimeSrc).toContain("phase: 'stopping_runtime_process'");
    expect(stopRuntimeSrc).toContain("phase: 'verifying_runtime_stopped'");
    expect(stopRuntimeSrc).toContain("phase: 'runtime_stopped'");
    expect(stopRuntimeSrc).toContain('containerRuntimeDaemonStopCommand({');
    expect(stopRuntimeSrc).toContain('containerRuntimeDaemonStatusCommand({');
    expect(stopRuntimeSrc).toContain('assertRuntimeStopVerifiedFromLaunchReport(parseLaunchReport(statusResult.stdout))');
    expect(stopRuntimeSrc).toContain('await runtimeRecord?.session.disconnect().catch(() => undefined);');
    expect(stopRuntimeSrc).toContain('runtimePlacementBridgeByTargetID.delete(targetID)');
    expect(stopRuntimeSrc).toContain('runtimePlacementReadyByTargetID.delete(targetID)');
    expect(stopRuntimeSrc).toContain('sshRuntimeReadyByKey.delete(runtimeKey)');
    expect(stopRuntimeSrc).toContain('runtimeLifecycleFailureNextActions');
    expect(stopRuntimeSrc).toContain('const sshDetails = sshDetailsFromRuntimeTargetRequest(request);');

    const refreshRuntimeStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshRuntimeEnd = mainSrc.indexOf('async function refreshAllEnvironmentRuntimesFromLauncher(', refreshRuntimeStart);
    const refreshRuntimeSrc = mainSrc.slice(refreshRuntimeStart, refreshRuntimeEnd);
    expect(refreshRuntimeSrc).toContain("if (placement.kind === 'container_process')");
    expect(refreshRuntimeSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(environmentID)');
    expect(refreshRuntimeSrc).not.toContain('loadExternalLocalUIStartup(runtimeRecord.startup.local_ui_url');
    expect(refreshRuntimeSrc).not.toContain('assertRuntimeTargetContainerRunning(hostAccess, placement)');
    expect(refreshRuntimeSrc).not.toContain('markSavedRuntimeTargetUsed(preferences');
  });

  it('keeps Local Host Open under the same Open-owned runtime preflight contract', () => {
    const mainSrc = readMainSource();
    const localOpenStart = mainSrc.indexOf('async function openLocalEnvironmentRecord(');
    const localOpenEnd = mainSrc.indexOf('function remoteManagedSessionStartup(', localOpenStart);
    expect(localOpenStart).toBeGreaterThanOrEqual(0);
    expect(localOpenEnd).toBeGreaterThan(localOpenStart);
    const localOpenSrc = mainSrc.slice(localOpenStart, localOpenEnd);

    expect(mainSrc).toContain('type LocalHostOpenTarget = Readonly<{');
    expect(mainSrc).toContain('function localHostOpenTarget(environment: DesktopLocalEnvironmentState): LocalHostOpenTarget');
    expect(localOpenSrc).toContain("action: 'open_local_environment'");
    expect(localOpenSrc).toContain("subject_kind: 'local_environment'");
    expect(localOpenSrc).toContain("phase: 'checking_runtime_record'");
    expect(localOpenSrc).toContain('open_progress: buildOpenConnectionProgress({');
    expect(localOpenSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(environment.id)');
    expect(localOpenSrc).toContain('runtimeRecord = await attachLocalEnvironmentRuntime(environment)');
    expect(localOpenSrc).toContain('localRuntimeHealthForOpenPreflight(environment.id)');
    expect(localOpenSrc).toContain('finishLocalHostOpenFailure(operationKey, openTarget, signal, result)');
    expect(localOpenSrc).toContain("phase: 'checking_env_app_readiness'");
    expect(localOpenSrc).toContain("phase: 'opening_window'");
    expect(localOpenSrc).toContain("phase: 'open_ready'");
    expect(localOpenSrc).not.toContain('Start the runtime first, then open this environment.');

    const refreshRuntimeStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshRuntimeEnd = mainSrc.indexOf('async function refreshAllEnvironmentRuntimesFromLauncher(', refreshRuntimeStart);
    const refreshRuntimeSrc = mainSrc.slice(refreshRuntimeStart, refreshRuntimeEnd);
    expect(refreshRuntimeSrc).toContain('const runtimeRecord = currentLocalEnvironmentRuntimeRecord(localEnvironment)\n      ?? await attachLocalEnvironmentRuntime(localEnvironment);');
  });

  it('keeps provider-link tickets separate from remote open route readiness', () => {
    const mainSrc = readMainSource();

    const materialStart = mainSrc.indexOf('async function requestProviderDesktopSessionMaterial(');
    const materialEnd = mainSrc.indexOf('async function prepareProviderRemoteOpenSession(', materialStart);
    expect(materialStart).toBeGreaterThanOrEqual(0);
    expect(materialEnd).toBeGreaterThan(materialStart);
    const materialSrc = mainSrc.slice(materialStart, materialEnd);
    expect(materialSrc).toContain('requestDesktopOpenSession(');
    expect(materialSrc).not.toContain('launcherActionFailureForRemoteRouteState');

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
    expect(connectSrc).toContain('requestProviderDesktopSessionMaterial(preferences, environment)');
    expect(connectSrc).toContain('connectProviderLink(runtimeControl, {');
    expect(connectSrc).not.toContain('prepareProviderRemoteOpenSession');
    expect(connectSrc).not.toContain('launcherActionFailureForRemoteRouteState');
    expect(connectSrc).not.toContain('openProviderEnvironmentFromLauncher');

    const disconnectStart = mainSrc.indexOf('async function disconnectProviderRuntimeFromLauncher(');
    const disconnectEnd = mainSrc.indexOf('async function cancelLauncherOperationFromLauncher(', disconnectStart);
    expect(disconnectStart).toBeGreaterThanOrEqual(0);
    expect(disconnectEnd).toBeGreaterThan(disconnectStart);
    const disconnectSrc = mainSrc.slice(disconnectStart, disconnectEnd);
    expect(disconnectSrc).toContain('const unlinked = await disconnectProviderLink(runtimeRecord.startup.runtime_control);');
    expect(disconnectSrc.indexOf('const unlinked = await disconnectProviderLink(runtimeRecord.startup.runtime_control);')).toBeLessThan(
      disconnectSrc.indexOf('updateProviderRuntimeTargetStartup(runtimeTarget, {'),
    );
    expect(disconnectSrc).toContain('const currentBinding = runtimeServiceProviderLinkBinding(runtimeRecord?.startup.runtime_service);');
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

  it('syncs linked provider health after runtime lifecycle changes', () => {
    const mainSrc = readMainSource();

    const helperStart = mainSrc.indexOf('async function syncLinkedProviderRuntimeHealthFromService(');
    const helperEnd = mainSrc.indexOf('async function refreshAllProviderEnvironmentRuntimeHealth(', helperStart);
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperSrc = mainSrc.slice(helperStart, helperEnd);
    expect(helperSrc).toContain("if (binding.state !== 'linked')");
    expect(helperSrc).toContain('await refreshProviderEnvironmentRuntimeHealth(providerOrigin, providerID, [envPublicID]);');

    const startRuntimeStart = mainSrc.indexOf('async function runEnvironmentRuntimeLifecycleFromLauncher(');
    const startRuntimeEnd = mainSrc.indexOf('async function connectProviderRuntimeFromLauncher(', startRuntimeStart);
    expect(startRuntimeStart).toBeGreaterThanOrEqual(0);
    expect(startRuntimeEnd).toBeGreaterThan(startRuntimeStart);
    const startRuntimeSrc = mainSrc.slice(startRuntimeStart, startRuntimeEnd);
    expect(startRuntimeSrc).toContain('await syncLinkedProviderRuntimeHealthFromService(runtimeRecord.startup.runtime_service);');
    expect(startRuntimeSrc).toContain('await syncLinkedProviderRuntimeHealthFromService(prepared.launch.managedRuntime.startup.runtime_service);');

    const connectStart = mainSrc.indexOf('async function connectProviderRuntimeFromLauncher(');
    const connectEnd = mainSrc.indexOf('async function disconnectProviderRuntimeFromLauncher(', connectStart);
    expect(connectStart).toBeGreaterThanOrEqual(0);
    expect(connectEnd).toBeGreaterThan(connectStart);
    expect(mainSrc.slice(connectStart, connectEnd)).toContain('await syncLinkedProviderRuntimeHealthFromService(linked.runtime_service);');

    const refreshRuntimeStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshRuntimeEnd = mainSrc.indexOf('async function refreshAllEnvironmentRuntimesFromLauncher(', refreshRuntimeStart);
    expect(refreshRuntimeStart).toBeGreaterThanOrEqual(0);
    expect(refreshRuntimeEnd).toBeGreaterThan(refreshRuntimeStart);
    const refreshRuntimeSrc = mainSrc.slice(refreshRuntimeStart, refreshRuntimeEnd);
    expect(refreshRuntimeSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(environmentID)');
    expect(refreshRuntimeSrc).toContain('await syncLinkedProviderRuntimeHealthFromService(runtimeService).catch(() => undefined)');
  });

  it('forces provider catalog sync before refreshing a provider environment card', () => {
    const mainSrc = readMainSource();

    const refreshRuntimeStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshRuntimeEnd = mainSrc.indexOf('async function refreshAllEnvironmentRuntimesFromLauncher(', refreshRuntimeStart);
    expect(refreshRuntimeStart).toBeGreaterThanOrEqual(0);
    expect(refreshRuntimeEnd).toBeGreaterThan(refreshRuntimeStart);
    const refreshRuntimeSrc = mainSrc.slice(refreshRuntimeStart, refreshRuntimeEnd);
    const providerBranchStart = refreshRuntimeSrc.indexOf('if (providerEnvironment) {');
    const providerBranchEnd = refreshRuntimeSrc.indexOf('const sshDetails = sshDetailsFromRuntimeTargetRequest(request);', providerBranchStart);
    expect(providerBranchStart).toBeGreaterThanOrEqual(0);
    expect(providerBranchEnd).toBeGreaterThan(providerBranchStart);
    const providerBranchSrc = refreshRuntimeSrc.slice(providerBranchStart, providerBranchEnd);
    expect(providerBranchSrc).toContain('await syncSavedControlPlaneAccountWithState(');
    expect(providerBranchSrc).toContain('{ force: true }');
    expect(providerBranchSrc.indexOf('await syncSavedControlPlaneAccountWithState(')).toBeLessThan(
      providerBranchSrc.indexOf('await refreshProviderEnvironmentRuntimeHealth('),
    );
  });

  it('marks provider environment management boundaries as important source constraints', () => {
    const mainSrc = readMainSource();
    expect(mainSrc).toContain('IMPORTANT: Provider-link operations must resolve the exact Local/SSH runtime');
    expect(mainSrc).toContain('IMPORTANT: Provider Environment Open is remote-only provider tunnel access.');
    expect(mainSrc).toContain('desktopProviderEnvironmentOpenRoute()');
  });

  it('keeps delete actions non-blocking while preventing stale SSH and provider tasks from resurrecting entries', () => {
    const mainSrc = readMainSource();
    const sshDeleteStart = mainSrc.indexOf('async function deleteSavedSSHEnvironmentFromWelcome');
    const providerDeleteStart = mainSrc.indexOf('async function deleteControlPlaneFromLauncher');
    const providerCleanupStart = mainSrc.indexOf('async function cleanupDeletedControlPlane');
    const syncAccountStart = mainSrc.indexOf('async function syncSavedControlPlaneAccount(');
    const syncStart = mainSrc.indexOf('async function syncSavedControlPlaneAccountWithState');
    const syncEnd = mainSrc.indexOf('async function ensureControlPlaneAccessToken');

    expect(sshDeleteStart).toBeGreaterThanOrEqual(0);
    const sshDeleteSrc = mainSrc.slice(sshDeleteStart, mainSrc.indexOf('async function performDesktopLauncherAction', sshDeleteStart));
    expect(sshDeleteSrc).toContain("launcherOperations.markSubjectDeleted('ssh_environment', runtimeKey");
    expect(sshDeleteSrc.indexOf('await persistDesktopPreferences(deleteSavedSSHEnvironment(preferences, environmentID));')).toBeLessThan(
      sshDeleteSrc.indexOf('launcherOperations.cancel(pendingStart.operation_key'),
    );

    expect(providerDeleteStart).toBeGreaterThanOrEqual(0);
    expect(providerCleanupStart).toBeGreaterThan(providerDeleteStart);
    const providerDeleteSrc = mainSrc.slice(providerDeleteStart, providerCleanupStart);
    expect(providerDeleteSrc).toContain("launcherOperations.markSubjectDeleted(\n    'control_plane'");
    expect(providerDeleteSrc).toContain('await persistDesktopPreferences(deleteSavedControlPlane(preferences, request.provider_origin, request.provider_id));');
    expect(providerDeleteSrc).toContain('void cleanupDeletedControlPlane(controlPlane, refreshToken, providerSessionKeys);');
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
    expect(syncSrc).toContain("const subjectGeneration = launcherOperations.currentSubjectGeneration('control_plane', key);");
    expect(syncSrc).toContain("if (launcherOperations.currentSubjectGeneration('control_plane', key) === subjectGeneration) {");
  });

  it('keeps desktop diagnostics for SSH and external sessions in local userData', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('function desktopDiagnosticsStateDirForTarget(target: DesktopSessionTarget, startup: StartupReport): string');
    expect(mainSrc).toContain("target.kind === 'local_environment'");
    expect(mainSrc).toContain("app.getPath('userData'), 'session-diagnostics'");
    expect(mainSrc).toContain('stateDirOverride: desktopDiagnosticsStateDirForTarget(target, startup)');
  });

  it('opens Local UI sessions at the canonical Env App entry while keeping the origin root as the navigation boundary', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('function desktopSessionEntryURL(target: DesktopSessionTarget, startup: StartupReport): string');
    expect(mainSrc).toContain("target.kind === 'local_environment' && target.route === 'remote_desktop'");
    expect(mainSrc).toContain('return buildLocalUIEnvAppEntryURL(startup.local_ui_url);');
    expect(mainSrc).toContain('const entryURL = desktopSessionEntryURL(target, startup);');
    expect(mainSrc).toContain('const rootWindow = createSessionRootWindow(target.session_key, entryURL, diagnostics');
    expect(mainSrc).toContain('allowed_base_url: startup.local_ui_url');
    expect(mainSrc).toContain('await rootWindow.loadURL(sessionRecord.entry_url);');
  });

  it('saves Local Environment settings without exposing deletion or extra local records', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('async function saveLocalEnvironmentSettingsFromWelcome(');
    expect(mainSrc).toContain("case 'save_local_environment_settings':");
    expect(mainSrc).toContain('updateLocalEnvironmentSettings(preferences, {');
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
    expect(mainSrc).toContain("return `child:${url.pathname}${url.search}`;");
    expect(mainSrc).not.toContain('handoffAskFlowerToOwningSession');
    expect(mainSrc).not.toContain('queueSessionAskFlowerHandoff');
  });

  it('routes explicit quit, system quit, and non-macOS last-window close through shared quit-impact logic', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("buildDesktopLastWindowCloseConfirmationModel,");
    expect(mainSrc).toContain("buildDesktopQuitConfirmationModel,");
    expect(mainSrc).toContain("buildDesktopQuitImpact,");
    expect(mainSrc).toContain("shouldConfirmDesktopLastWindowClose,");
    expect(mainSrc).toContain("shouldConfirmDesktopQuit,");
    expect(mainSrc).toContain("showDesktopConfirmationDialog,");
    expect(mainSrc).toContain("let quitPhase: 'idle' | 'confirming' | 'requested' | 'shutting_down' = 'idle';");
    expect(mainSrc).toContain('const confirmedFinalWindowCloseWebContentsIDs = new Set<number>();');
    expect(mainSrc).toContain('label: string;');
    expect(mainSrc).toContain('async function buildCurrentDesktopQuitImpact(): Promise<DesktopQuitImpact> {');
    expect(mainSrc).toContain('pending_operation_count: launcherOperations.operations().filter((operation) => (');
    expect(mainSrc).toContain("launcherOperations.cancel(pendingStart.operation_key, 'Redeven Desktop is quitting and canceling this runtime startup task.');");
    expect(mainSrc).toContain('async function confirmDesktopImpact(');
    expect(mainSrc).toContain('async function requestFinalWindowClose(');
    expect(mainSrc).toContain('confirmedFinalWindowCloseWebContentsIDs.add(windowRecord.webContentsID);');
    expect(mainSrc).toContain('confirmedFinalWindowCloseWebContentsIDs.delete(closedWindow.webContentsID);');
    expect(mainSrc).not.toContain('confirmedFinalWindowCloseWebContentsIDs.delete(win.webContents.id);');
    expect(mainSrc).toContain('if (process.platform === \'darwin\') {');
    expect(mainSrc).toContain('void requestFinalWindowClose(trackedWindow);');
    expect(mainSrc).toContain("if (shouldConfirmDesktopQuit(impact, source)) {");
    expect(mainSrc).toContain('buildDesktopLastWindowCloseConfirmationModel(impact)');
    expect(mainSrc).toContain('buildDesktopQuitConfirmationModel(impact)');
    expect(mainSrc).toContain("void requestQuit('last_window_close', win);");
    expect(mainSrc).toContain("void requestQuit('system');");
    expect(mainSrc).toContain("if (process.platform !== 'darwin' && quitPhase === 'idle') {");
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
});
