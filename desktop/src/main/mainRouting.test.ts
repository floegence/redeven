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
    expect(mainSrc).toContain("case 'upsert_managed_environment':");
    expect(mainSrc).toContain("case 'delete_managed_environment':");
    expect(mainSrc).toContain("case 'focus_environment_window':");
    expect(mainSrc).toContain("case 'close_launcher_or_quit':");
    expect(mainSrc).not.toContain("case 'return_to_current_environment':");
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

  it('forwards SSH runtime bootstrap progress to the launcher renderer', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL');
    expect(mainSrc).toContain('function emitLauncherActionProgress(');
    expect(mainSrc).toContain('pendingLauncherActionProgressByKey.set(operationKey, persistedProgress);');
    expect(mainSrc).toContain('actionProgress: [...pendingLauncherActionProgressByKey.values()]');
    expect(mainSrc).toContain('const pendingStart = pendingSSHRuntimeStartByKey.get(runtimeKey) ?? null;');
    expect(mainSrc).toContain('return pendingStart.task;');
    expect(mainSrc).toContain("phase: 'ssh_preparing_start'");
    expect(mainSrc).toContain("action: 'start_environment_runtime'");
    expect(mainSrc).toContain('environment_label: label');
    expect(mainSrc).toContain('phase: progress.phase');
    expect(mainSrc).toContain('detail: progress.detail');
    expect(mainSrc).toContain('clearLauncherActionProgress(runtimeKey);');
    expect(mainSrc).toContain('function friendlyRuntimeStartErrorMessage(');
    expect(mainSrc).toContain('The SSH host resolved its runtime directory to /root');
  });

  it('keeps desktop diagnostics for SSH and external sessions in local userData', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('function desktopDiagnosticsStateDirForTarget(target: DesktopSessionTarget, startup: StartupReport): string');
    expect(mainSrc).toContain("target.kind === 'managed_environment'");
    expect(mainSrc).toContain("app.getPath('userData'), 'session-diagnostics'");
    expect(mainSrc).toContain('stateDirOverride: desktopDiagnosticsStateDirForTarget(target, startup)');
  });

  it('opens Local UI sessions at the canonical Env App entry while keeping the origin root as the navigation boundary', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('function desktopSessionEntryURL(target: DesktopSessionTarget, startup: StartupReport): string');
    expect(mainSrc).toContain("target.kind === 'managed_environment' && target.route === 'remote_desktop'");
    expect(mainSrc).toContain('return buildLocalUIEnvAppEntryURL(startup.local_ui_url);');
    expect(mainSrc).toContain('const entryURL = desktopSessionEntryURL(target, startup);');
    expect(mainSrc).toContain('const rootWindow = createSessionRootWindow(target.session_key, entryURL, diagnostics');
    expect(mainSrc).toContain('allowed_base_url: startup.local_ui_url');
    expect(mainSrc).toContain('await rootWindow.loadURL(sessionRecord.entry_url);');
  });

  it('protects the default local environment from deletion and reuses the single machine record', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('Local Environment is always available in Desktop. Change its settings instead of deleting it.');
    expect(mainSrc).toContain("|| 'machine';");
    expect(mainSrc).toContain('findManagedEnvironmentLocalBindConflict(next, resolvedEnvironment.id)');
    expect(mainSrc).toContain("'action_invalid',");
    expect(mainSrc).toContain("'dialog',");
    expect(mainSrc).toContain('protectedManagedEnvironmentDeleteFailure');
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
