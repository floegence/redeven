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

  it('lets dev SSH bootstrap use an explicit runtime release tag without changing the bundled runtime version', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('process.env.REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG');
    expect(mainSrc.indexOf('process.env.REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG')).toBeLessThan(
      mainSrc.indexOf('process.env.REDEVEN_DESKTOP_BUNDLE_VERSION'),
    );
    expect(mainSrc).toContain('Set REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG for dev SSH bootstrap');
  });

  it('routes SSH runtime bootstrap progress through cancellable launcher operations', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL');
    expect(mainSrc).toContain('const launcherOperations = new LauncherOperationRegistry(handleLauncherOperationChange);');
    expect(mainSrc).toContain('actionProgress: launcherOperations.progressItems()');
    expect(mainSrc).toContain('operations: launcherOperations.operations()');
    expect(mainSrc).toContain('const pendingStart = pendingSSHRuntimeStartByKey.get(runtimeKey) ?? null;');
    expect(mainSrc).toContain('return pendingStart.task;');
    expect(mainSrc).toContain('const sshRuntimeMaintenanceByKey = new Map');
    expect(mainSrc).toContain('error instanceof DesktopSSHRuntimeMaintenanceRequiredError');
    expect(mainSrc).toContain('sshRuntimeMaintenanceByKey.set(runtimeKey, error.maintenance)');
    expect(mainSrc).toContain('runtime_maintenance: maintenance');
    expect(mainSrc).toContain('sshRuntimeMaintenanceByKey.delete(runtimeKey)');
    expect(mainSrc).toContain('const operation = launcherOperations.create({');
    expect(mainSrc).toContain("phase: 'ssh_preparing_start'");
    expect(mainSrc).toContain("title: 'Preparing SSH runtime'");
    expect(mainSrc).toContain("action: 'start_environment_runtime'");
    expect(mainSrc).toContain("subject_kind: 'ssh_environment'");
    expect(mainSrc).toContain('cancelable: true');
    expect(mainSrc).toContain("interrupt_label: 'Stop startup'");
    expect(mainSrc).toContain('signal,');
    expect(mainSrc).toContain("interrupt_kind: 'stop_opening'");
    expect(mainSrc).toContain('const signal = launcherOperations.operationSignal(operation.operation_key) ?? undefined;');
    expect(mainSrc).toContain('environment_label: label');
    expect(mainSrc).toContain('phase: progress.phase');
    expect(mainSrc).toContain('detail: progress.detail');
    expect(mainSrc).toContain('launcherOperations.isStale(runtimeKey)');
    expect(mainSrc).toContain('scheduleLauncherOperationRemoval(runtimeKey);');
    expect(mainSrc).toContain('function friendlyRuntimeStartErrorMessage(');
    expect(mainSrc).toContain('The SSH host resolved its runtime directory to /root');
  });

  it('routes runtime maintenance through an explicit Desktop session contract', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('DESKTOP_SHELL_RUNTIME_MAINTENANCE_CONTEXT_CHANNEL');
    expect(mainSrc).toContain('function runtimeMaintenanceContextFromSession(');
    expect(mainSrc).toContain("authority: 'desktop_ssh'");
    expect(mainSrc).toContain("method: 'desktop_ssh_restart'");
    expect(mainSrc).toContain("method: 'desktop_ssh_force_update'");
    expect(mainSrc).toContain('async function restartSSHRuntimeFromShell(');
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
    expect(sshStartSrc).toContain('options.allowActiveWorkReplacement !== true');
    expect(sshStartSrc).toContain('desktopSSHRuntimeAffectingSettingsMatch(existingRecord.details, sshDetails)');

    const openSSHStart = mainSrc.indexOf('async function openSSHEnvironmentFromLauncher(');
    const openSSHEnd = mainSrc.indexOf('const optimisticSessionKey = sshDesktopSessionKey(sshDetails);', openSSHStart);
    expect(mainSrc.slice(openSSHStart, openSSHEnd)).toContain('connect_timeout_seconds: request.connect_timeout_seconds');

    const startRuntimeStart = mainSrc.indexOf('function sshDetailsFromRuntimeTargetRequest(');
    const startRuntimeEnd = mainSrc.indexOf('async function startEnvironmentRuntimeFromLauncher(', startRuntimeStart);
    expect(mainSrc.slice(startRuntimeStart, startRuntimeEnd)).toContain('connect_timeout_seconds: request.connect_timeout_seconds');
  });

  it('keeps runtime lifecycle dispatch target-first and opens container placement only through bridge sessions', () => {
    const mainSrc = readMainSource();
    expect(mainSrc).not.toContain('function launcherActionFailureForUnsupportedRuntimePlacement(');
    expect(mainSrc).toContain('const runtimePlacementBridgeByTargetID = new Map<DesktopRuntimeTargetID, RuntimePlacementBridgeRecord>();');
    expect(mainSrc).toContain('startRuntimePlacementBridgeSession({');
    expect(mainSrc).toContain('runtimePlacementBridgeByTargetID.set(session.placement_target_id, record)');
    expect(mainSrc).toContain('async function openRuntimePlacementBridgeFromLauncher(');
    expect(mainSrc).toContain('Start this runtime first, then open it.');
    expect(mainSrc).toContain('This external container is stopped. Start it from its container owner, then start the runtime in Desktop.');

    const startRuntimeStart = mainSrc.indexOf('async function startEnvironmentRuntimeFromLauncher(');
    const startRuntimeEnd = mainSrc.indexOf('async function connectProviderRuntimeFromLauncher(', startRuntimeStart);
    const startRuntimeSrc = mainSrc.slice(startRuntimeStart, startRuntimeEnd);
    expect(startRuntimeSrc).toContain("if (placement.kind === 'container_process')");
    expect(startRuntimeSrc).toContain('startRuntimePlacementBridgeRecordFromLauncher(request)');
    expect(startRuntimeSrc).toContain('const normalizedSSHTarget = sshDetailsFromRuntimeTargetRequest(request);');

    const stopRuntimeStart = mainSrc.indexOf('async function stopEnvironmentRuntimeFromLauncher(');
    const stopRuntimeEnd = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(', stopRuntimeStart);
    const stopRuntimeSrc = mainSrc.slice(stopRuntimeStart, stopRuntimeEnd);
    expect(stopRuntimeSrc).toContain("if (placement.kind === 'container_process')");
    expect(stopRuntimeSrc).toContain('await runtimeRecord.session.stop();');
    expect(stopRuntimeSrc).toContain('runtimePlacementBridgeByTargetID.delete(runtimeRecord.session.placement_target_id)');
    expect(stopRuntimeSrc).toContain('const sshDetails = sshDetailsFromRuntimeTargetRequest(request);');

    const refreshRuntimeStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshRuntimeEnd = mainSrc.indexOf('async function refreshAllEnvironmentRuntimesFromLauncher(', refreshRuntimeStart);
    const refreshRuntimeSrc = mainSrc.slice(refreshRuntimeStart, refreshRuntimeEnd);
    expect(refreshRuntimeSrc).toContain("if (placement.kind === 'container_process')");
    expect(refreshRuntimeSrc).toContain('loadExternalLocalUIStartup(runtimeRecord.startup.local_ui_url');
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
    expect(connectSrc).not.toContain('prepareProviderRemoteOpenSession');
    expect(connectSrc).not.toContain('launcherActionFailureForRemoteRouteState');

    const openStart = mainSrc.indexOf('async function openProviderEnvironmentFromLauncher(');
    const openEnd = mainSrc.indexOf('async function focusEnvironmentWindow(', openStart);
    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(openEnd).toBeGreaterThan(openStart);
    const openSrc = mainSrc.slice(openStart, openEnd);
    expect(openSrc).toContain('prepareProviderRemoteOpenSession(preferences, environment)');
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
    expect(mainSrc).toContain('updateLocalEnvironmentAccess(preferences, existing.id, access)');
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
    expect(mainSrc).toContain("launcherOperations.cancel(pendingStart.operation_key, 'Redeven Desktop is quitting and canceling this SSH startup task.');");
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
