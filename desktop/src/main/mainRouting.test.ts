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
    expect(inspectSrc.indexOf('resolveRuntimeContainerPlacement(')).toBeLessThan(
      inspectSrc.indexOf('const bridgeRecord = await verifyRuntimePlacementBridgeRecord(target.targetID)'),
    );
    expect(inspectSrc).not.toContain('const bridgeRecord = runtimePlacementBridgeByTargetID.get(target.targetID) ?? null');
    expect(inspectSrc).toContain('await clearRuntimePlacementTargetRecords(target.targetID)');
    expect(inspectSrc).not.toContain('const cachedReadyRecord = runtimePlacementReadyByTargetID.get(target.targetID) ?? null');
    expect(inspectSrc).not.toContain('cachedReadyRecord.startup');
    expect(inspectSrc).toContain('runtimePlacementReadyByTargetID.delete(target.targetID)');
    expect(inspectSrc).toContain('const maintenance = runtimePlacementMaintenanceForRuntimeService(target.targetID, report.startup.runtime_service);');
    expect(inspectSrc).not.toContain('maintenance: maintenance && !runtimeServiceIsOpenable(report.startup.runtime_service)');
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
    expect(mainSrc).toContain('RuntimeLifecycleWorkflow');
    expect(mainSrc).toContain('runtimeLifecyclePlanAfterDecision');
    expect(mainSrc).toContain('runtimeLifecyclePlanIncludingStep');
    expect(mainSrc).toContain('commitRuntimeLifecycleDecision');
    expect(mainSrc).toContain('runtimeLifecycleWorkflowFailure');
    expect(mainSrc).toContain('currentRuntimeLifecycleWorkflowProgress');
    expect(mainSrc).not.toContain('runtimeLifecycleWorkflowAcceptsPhase');
    expect(mainSrc).not.toContain('currentRuntimeLifecyclePhase');
    expect(mainSrc).not.toContain('lifecycleProgress.stage_index < current.lifecycle_progress.stage_index');
    expect(mainSrc).not.toContain("lifecycle_progress: runtimeLifecycleProgress({");
    expect(mainSrc).not.toContain('runtimeLifecyclePhaseSequence');
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
    expect(mainSrc).not.toContain('runtime_maintenance: maintenance');
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
    expect(mainSrc).toContain("case 'ssh_checking_runtime':\n    case 'ssh_runtime_ready':\n      return 'checking_runtime_package';");
    expect(mainSrc).not.toContain("case 'ssh_runtime_ready':\n      return 'checking_runtime_service';");
    expect(mainSrc).not.toContain('runtimeLifecycleProgressFromSSH(sshDetails, progress, label, lifecycleOperation)');
    expect(mainSrc).toContain('ensureRuntimePlacementReady({');
    expect(mainSrc).toContain('on_progress: (progress: RuntimePlacementProgress) => {');
    expect(mainSrc).toContain('const launch = await startManagedRuntime({');
    expect(mainSrc).toContain('onProgress: (progress: ManagedRuntimeProgress) => {');
    expect(mainSrc).toContain('launcherOperations.isStale(runtimeKey)');
    expect(mainSrc).toContain('scheduleCurrentLauncherOperationRemoval(runtimeKey, lifecycleAttemptOwner);');
    expect(mainSrc).toContain('const startedAtUnixMs = snapshot?.started_at_unix_ms;');
    expect(mainSrc).toContain('current?.started_at_unix_ms !== startedAtUnixMs');
    expect(mainSrc).toContain('function desktopFailureFromError(');
    expect(mainSrc).toContain('operationFailureFromUnknown(error, desktopOperationFailurePresentation({');
    expect(mainSrc).not.toContain('function friendlyRuntimeStartErrorMessage(');
    expect(mainSrc).not.toContain('firstDisplayLine(');
    expect(mainSrc).not.toContain(['The SSH host resolved its runtime directory to', '/root'].join(' '));
  });

  it('verifies runtime liveness before reusing launcher cache records', () => {
    const mainSrc = readMainSource();

    const providerStart = mainSrc.indexOf('async function resolveProviderRuntimeLinkTarget(');
    const providerEnd = mainSrc.indexOf('function updateProviderRuntimeTargetStartup(', providerStart);
    expect(providerStart).toBeGreaterThanOrEqual(0);
    expect(providerEnd).toBeGreaterThan(providerStart);
    const providerSrc = mainSrc.slice(providerStart, providerEnd);
    expect(providerSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(runtimeKey)');
    expect(providerSrc).toContain('await verifyCurrentLocalEnvironmentRuntimeRecord(preferences.local_environment)');
    expect(providerSrc).not.toContain('const record = currentLocalEnvironmentRuntimeRecord(preferences.local_environment)');

    const providerOccupancyStart = mainSrc.indexOf('async function providerEnvironmentOccupyingRuntime(');
    const providerOccupancyEnd = mainSrc.indexOf('type ProviderDesktopSessionMaterial', providerOccupancyStart);
    expect(providerOccupancyStart).toBeGreaterThanOrEqual(0);
    expect(providerOccupancyEnd).toBeGreaterThan(providerOccupancyStart);
    const providerOccupancySrc = mainSrc.slice(providerOccupancyStart, providerOccupancyEnd);
    expect(providerOccupancySrc).toContain('preferences: DesktopPreferences');
    expect(providerOccupancySrc).toContain('await verifyCurrentLocalEnvironmentRuntimeRecord(preferences.local_environment)');
    expect(providerOccupancySrc).toContain('await verifySSHEnvironmentRuntimeRecord(runtimeKey)');
    expect(providerOccupancySrc).toContain('await verifyRuntimePlacementBridgeRecord(targetID)');
    expect(providerOccupancySrc).not.toContain('if (localEnvironmentRuntimeRecord)');
    expect(providerOccupancySrc).not.toContain('for (const record of sshEnvironmentRuntimeByKey.values())');
    expect(providerOccupancySrc).not.toContain('for (const record of runtimePlacementBridgeByTargetID.values())');

    const localRecordVerifyStart = mainSrc.indexOf('async function verifyCurrentLocalEnvironmentRuntimeRecord(');
    const localRecordVerifyEnd = mainSrc.indexOf('function providerRuntimeHealthMap(', localRecordVerifyStart);
    expect(localRecordVerifyStart).toBeGreaterThanOrEqual(0);
    expect(localRecordVerifyEnd).toBeGreaterThan(localRecordVerifyStart);
    const localRecordVerifySrc = mainSrc.slice(localRecordVerifyStart, localRecordVerifyEnd);
    expect(localRecordVerifySrc).toContain('started_at_unix_ms: startup.started_at_unix_ms ?? currentRecord.startup.started_at_unix_ms');
    expect(localRecordVerifySrc).not.toContain('started_at_unix_ms: currentRecord.startup.started_at_unix_ms');

    const bridgeRecordVerifyStart = mainSrc.indexOf('async function verifyRuntimePlacementBridgeRecord(');
    const bridgeRecordVerifyEnd = mainSrc.indexOf('function clearSSHRuntimeReadyState(', bridgeRecordVerifyStart);
    expect(bridgeRecordVerifyStart).toBeGreaterThanOrEqual(0);
    expect(bridgeRecordVerifyEnd).toBeGreaterThan(bridgeRecordVerifyStart);
    const bridgeRecordVerifySrc = mainSrc.slice(bridgeRecordVerifyStart, bridgeRecordVerifyEnd);
    expect(bridgeRecordVerifySrc).toContain('started_at_unix_ms: startup.started_at_unix_ms\n            ?? bridgeRecord.startup.started_at_unix_ms');
    expect(bridgeRecordVerifySrc).toContain('runtimePlacementBridgeByTargetID.set(targetID, updatedRecord)');
    expect(bridgeRecordVerifySrc).not.toContain('started_at_unix_ms: bridgeRecord.startup.started_at_unix_ms');

    const sshRecordVerifyStart = mainSrc.indexOf('async function verifySSHEnvironmentRuntimeRecord(');
    const sshRecordVerifyEnd = mainSrc.indexOf('async function inspectSavedRuntimeTargetState(', sshRecordVerifyStart);
    expect(sshRecordVerifyStart).toBeGreaterThanOrEqual(0);
    expect(sshRecordVerifyEnd).toBeGreaterThan(sshRecordVerifyStart);
    const sshRecordVerifySrc = mainSrc.slice(sshRecordVerifyStart, sshRecordVerifyEnd);
    expect(sshRecordVerifySrc).toContain('started_at_unix_ms: startup.started_at_unix_ms\n            ?? runtimeRecord.startup.started_at_unix_ms');
    expect(sshRecordVerifySrc).toContain('sshEnvironmentRuntimeByKey.set(runtimeKey, updatedRecord)');
    expect(sshRecordVerifySrc).not.toContain('started_at_unix_ms: runtimeRecord.startup.started_at_unix_ms');

    const sshProbeStart = mainSrc.indexOf('async function probeSavedSSHRuntimeHealth(');
    const sshProbeEnd = mainSrc.indexOf('function runtimeTargetProbeSource(', sshProbeStart);
    expect(sshProbeStart).toBeGreaterThanOrEqual(0);
    expect(sshProbeEnd).toBeGreaterThan(sshProbeStart);
    const sshProbeSrc = mainSrc.slice(sshProbeStart, sshProbeEnd);
    expect(sshProbeSrc).toContain('const runtimeRecord = await verifySSHEnvironmentRuntimeRecord(runtimeKey)');
    expect(sshProbeSrc).toContain('sshRuntimeReadyByKey.delete(runtimeKey)');
    expect(sshProbeSrc).not.toContain('const runtimeRecord = sshEnvironmentRuntimeByKey.get(runtimeKey) ?? null');

    const openSSHStart = mainSrc.indexOf('async function openSSHEnvironmentFromLauncher(');
    const openSSHEnd = mainSrc.indexOf('function thrownLauncherActionFailure(', openSSHStart);
    expect(openSSHStart).toBeGreaterThanOrEqual(0);
    expect(openSSHEnd).toBeGreaterThan(openSSHStart);
    const openSSHSrc = mainSrc.slice(openSSHStart, openSSHEnd);
    expect(openSSHSrc).toContain('let readyRecord: SSHRuntimeReadyRecord | null = null;');
    expect(openSSHSrc).toContain('let existingRuntimeRecord = await verifySSHEnvironmentRuntimeRecord(optimisticSessionKey);');
    expect(openSSHSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(request.environment_id ?? optimisticSessionKey)');
    expect(openSSHSrc).not.toContain('let readyRecord = sshRuntimeReadyByKey.get(optimisticSessionKey) ?? null');

    const ensureRuntimeStart = mainSrc.indexOf('async function ensureRuntimePlacementReadyRecordFromLauncher(');
    const ensureRuntimeEnd = mainSrc.indexOf('async function openRuntimePlacementBridgeFromLauncher(', ensureRuntimeStart);
    expect(ensureRuntimeStart).toBeGreaterThanOrEqual(0);
    expect(ensureRuntimeEnd).toBeGreaterThan(ensureRuntimeStart);
    const ensureRuntimeSrc = mainSrc.slice(ensureRuntimeStart, ensureRuntimeEnd);
    expect(ensureRuntimeSrc).not.toContain('return existing;');
    expect(ensureRuntimeSrc).not.toContain('if (existing &&');
    expect(ensureRuntimeSrc).toContain('const inspection = await inspectRuntimePlacementTargetState({');

    const bridgeHelperStart = mainSrc.indexOf('async function openRuntimePlacementBridgeForReadyRecord(');
    const bridgeHelperEnd = mainSrc.indexOf('type ProviderRuntimeLinkTargetRecord', bridgeHelperStart);
    expect(bridgeHelperStart).toBeGreaterThanOrEqual(0);
    expect(bridgeHelperEnd).toBeGreaterThan(bridgeHelperStart);
    const bridgeHelperSrc = mainSrc.slice(bridgeHelperStart, bridgeHelperEnd);
    expect(bridgeHelperSrc).toContain('await clearRuntimePlacementBridgeRecord(readyRecord.runtime_key as DesktopRuntimeTargetID)');
    expect(bridgeHelperSrc).not.toContain('return existing;');

    const deleteRuntimeTargetStart = mainSrc.indexOf('async function deleteSavedRuntimeTargetFromWelcome(');
    const deleteRuntimeTargetEnd = mainSrc.indexOf('async function listRuntimeContainersFromLauncher(', deleteRuntimeTargetStart);
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
    expect(workflowSrc).not.toContain('if (currentProgress) {\n    const hydrated = RuntimeLifecycleWorkflow.fromProgress(currentProgress);');

    const updateLifecycleStart = mainSrc.indexOf('function updateRuntimeLifecycleOperation(');
    const updateLifecycleEnd = mainSrc.indexOf('function runtimeLifecyclePhaseFromManagedRuntime(', updateLifecycleStart);
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

    const startEnvironmentRuntimeStart = mainSrc.indexOf('async function startEnvironmentRuntimeFromLauncher(');
    const updateEnvironmentRuntimeStart = mainSrc.indexOf('async function updateEnvironmentRuntimeFromLauncher(');
    const restartEnvironmentRuntimeStart = mainSrc.indexOf('async function restartEnvironmentRuntimeFromLauncher(');
    expect(startEnvironmentRuntimeStart).toBeGreaterThanOrEqual(0);
    expect(updateEnvironmentRuntimeStart).toBeGreaterThan(startEnvironmentRuntimeStart);
    expect(restartEnvironmentRuntimeStart).toBeGreaterThan(updateEnvironmentRuntimeStart);
    const startEnvironmentRuntimeSrc = mainSrc.slice(startEnvironmentRuntimeStart, updateEnvironmentRuntimeStart);
    const updateEnvironmentRuntimeSrc = mainSrc.slice(updateEnvironmentRuntimeStart, restartEnvironmentRuntimeStart);
    const restartEnvironmentRuntimeSrc = mainSrc.slice(restartEnvironmentRuntimeStart, mainSrc.indexOf('async function manageDesktopUpdateFromLauncher(', restartEnvironmentRuntimeStart));
    expect(startEnvironmentRuntimeSrc).toContain('return runEnvironmentRuntimeLifecycleFromLauncher(request);');
    expect(updateEnvironmentRuntimeSrc).toContain("kind: 'update_environment_runtime',\n    force_runtime_update: true,");
    expect(restartEnvironmentRuntimeSrc).toContain("kind: 'restart_environment_runtime',\n    force_runtime_update: false,");

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
    expect(mainSrc).toContain('const pendingRuntimePlacementOpenByTargetID = new Map<DesktopRuntimeTargetID, Promise<DesktopLauncherActionResult | null>>();');
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
    expect(bridgeOpenSrc).toContain('const pendingOpen = pendingRuntimePlacementOpenByTargetID.get(targetID) ?? null');
    expect(bridgeOpenSrc).toContain('return pendingOpen');
    expect(bridgeOpenSrc).toContain('const runOpenTask = async (): Promise<DesktopLauncherActionResult | null> => {');
    expect(bridgeOpenSrc).toContain('const openTask = Promise.resolve()');
    expect(bridgeOpenSrc).toContain('.then(runOpenTask)');
    expect(bridgeOpenSrc).toContain('pendingRuntimePlacementOpenByTargetID.set(targetID, openTask)');
    expect(bridgeOpenSrc).toContain('pendingRuntimePlacementOpenByTargetID.delete(targetID)');
    expect(bridgeOpenSrc).not.toContain('(async (): Promise<DesktopLauncherActionResult | null> =>');
    expect(bridgeOpenSrc.indexOf('.then(runOpenTask)')).toBeLessThan(
      bridgeOpenSrc.indexOf('pendingRuntimePlacementOpenByTargetID.set(targetID, openTask)'),
    );
    expect(bridgeOpenSrc.indexOf('pendingRuntimePlacementOpenByTargetID.set(targetID, openTask)')).toBeLessThan(
      bridgeOpenSrc.indexOf('return openTask;'),
    );
    expect(bridgeOpenSrc).toContain('await refreshWelcomeRuntimeHealthForEnvironment(environmentID)');
    expect(bridgeOpenSrc).toContain('const activeRuntimeOperation = launcherOperations.get(targetID)');
    expect(bridgeOpenSrc).toContain("activeRuntimeOperation.subject_kind === 'runtime_target'");
    expect(bridgeOpenSrc).toContain("activeRuntimeOperation.status === 'running' || activeRuntimeOperation.status === 'canceling'");
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
    expect(ensureRuntimeSrc).toContain("request.kind === 'restart_environment_runtime'");
    expect(ensureRuntimeSrc).toContain("request.kind === 'update_environment_runtime'");
    expect(ensureRuntimeSrc).toContain('request.force_runtime_update === true');
    const pendingStartBranchStart = ensureRuntimeSrc.indexOf('if (pendingStart) {');
    const pendingStartBranchEnd = ensureRuntimeSrc.indexOf('const environmentID = runtimeTargetEnvironmentIDFromRequest(request);', pendingStartBranchStart);
    expect(pendingStartBranchStart).toBeGreaterThanOrEqual(0);
    expect(pendingStartBranchEnd).toBeGreaterThan(pendingStartBranchStart);
    const pendingStartBranchSrc = ensureRuntimeSrc.slice(pendingStartBranchStart, pendingStartBranchEnd);
    expect(pendingStartBranchSrc).toContain('if (replacementRequested) {');
    expect(pendingStartBranchSrc).toContain('launcherOperations.cancel(pendingStart.operation_key');
    expect(pendingStartBranchSrc).toContain('await pendingStart.task.catch(() => undefined)');
    expect(pendingStartBranchSrc).toContain('return pendingStart.task');
    expect(ensureRuntimeSrc).toContain('const pendingOpen = pendingRuntimePlacementOpenByTargetID.get(targetID) ?? null');
    expect(ensureRuntimeSrc).toContain('launcherOperations.cancel(`${targetID}:open`');
    expect(ensureRuntimeSrc).toContain('await pendingOpen.catch(() => undefined)');
    expect(ensureRuntimeSrc.indexOf('await pendingOpen.catch(() => undefined)')).toBeLessThan(
      ensureRuntimeSrc.indexOf('const inspection = await inspectRuntimePlacementTargetState({'),
    );
    expect(ensureRuntimeSrc).toContain('let replacementLiveDaemon = runtimePlacementLiveDaemonFromInspection({');
    expect(ensureRuntimeSrc).toContain('await stopRuntimePlacementLiveDaemonForReplacement({');
    expect(ensureRuntimeSrc).not.toContain('inspection.ready_record && replacementRequested');

    const liveDaemonHelperStart = mainSrc.indexOf('function runtimePlacementLiveDaemonFromInspection(');
    const liveDaemonHelperEnd = mainSrc.indexOf('async function stopRuntimePlacementLiveDaemonForReplacement(', liveDaemonHelperStart);
    expect(liveDaemonHelperStart).toBeGreaterThanOrEqual(0);
    expect(liveDaemonHelperEnd).toBeGreaterThan(liveDaemonHelperStart);
    const liveDaemonHelperSrc = mainSrc.slice(liveDaemonHelperStart, liveDaemonHelperEnd);
    expect(liveDaemonHelperSrc).toContain("source: 'bridge_record'");
    expect(liveDaemonHelperSrc).toContain("source: 'ready_record'");
    expect(liveDaemonHelperSrc).toContain("source: 'inspection'");
    expect(liveDaemonHelperSrc).toContain('input.inspection.running && input.inspection.placement?.kind === \'container_process\'');

    const replacementStopHelperStart = liveDaemonHelperEnd;
    const replacementStopHelperEnd = mainSrc.indexOf('async function assertRuntimeTargetContainerRunning(', replacementStopHelperStart);
    expect(replacementStopHelperEnd).toBeGreaterThan(replacementStopHelperStart);
    const replacementStopHelperSrc = mainSrc.slice(replacementStopHelperStart, replacementStopHelperEnd);
    const stopIndex = replacementStopHelperSrc.indexOf('containerRuntimeDaemonStopCommand({');
    const verifyIndex = replacementStopHelperSrc.indexOf("phase: 'verifying_runtime_stopped'");
    const assertStoppedIndex = replacementStopHelperSrc.indexOf('await assertContainerRuntimeStopped({');
    const readyCleanupIndex = replacementStopHelperSrc.indexOf('runtimePlacementReadyByTargetID.delete(input.liveDaemon.target_id)');
    const maintenanceCleanupIndex = replacementStopHelperSrc.indexOf('runtimePlacementMaintenanceByTargetID.delete(input.liveDaemon.target_id)');
    const returnReadinessIndex = replacementStopHelperSrc.indexOf('require_new_daemon: true');
    expect(stopIndex).toBeGreaterThanOrEqual(0);
    expect(verifyIndex).toBeGreaterThan(stopIndex);
    expect(assertStoppedIndex).toBeGreaterThan(verifyIndex);
    expect(readyCleanupIndex).toBeGreaterThan(assertStoppedIndex);
    expect(maintenanceCleanupIndex).toBeGreaterThan(readyCleanupIndex);
    expect(returnReadinessIndex).toBeGreaterThan(maintenanceCleanupIndex);
    expect(ensureRuntimeSrc.indexOf('await stopRuntimePlacementLiveDaemonForReplacement({')).toBeLessThan(
      ensureRuntimeSrc.indexOf('readyPlacement = await ensureRuntimePlacementReady({'),
    );

    const replacementBranchStart = ensureRuntimeSrc.indexOf('if (replacementLiveDaemon && replacementRequested)');
    const replacementBranchEnd = ensureRuntimeSrc.indexOf('} else if (inspection.ready_record)', replacementBranchStart);
    expect(replacementBranchStart).toBeGreaterThanOrEqual(0);
    expect(replacementBranchEnd).toBeGreaterThan(replacementBranchStart);
    const replacementBranchSrc = ensureRuntimeSrc.slice(replacementBranchStart, replacementBranchEnd);
    expect(replacementBranchSrc).not.toContain('runtime_already_current');
    expect(replacementBranchSrc).not.toContain('runtime_up_to_date');
    expect(ensureRuntimeSrc).toContain('let replacementReadiness: RuntimePlacementReplacementReadiness | null = null');
    expect(ensureRuntimeSrc).toContain('replacementReadiness = await stopRuntimePlacementLiveDaemonForReplacement({');
    expect(ensureRuntimeSrc).toContain('previous_runtime_pid: replacementReadiness?.previous_runtime_pid');
    expect(ensureRuntimeSrc).toContain('require_new_daemon: replacementReadiness?.require_new_daemon === true');
    expect(ensureRuntimeSrc).not.toContain('let previousRuntimePID');
    expect(ensureRuntimeSrc).not.toContain('previousRuntimePID !== undefined');

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
    expect(stopRuntimeSrc).toContain('assertContainerRuntimeStopped({');
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

  it('only accepts stopped runtime status verification after a container replacement stop', () => {
    const mainSrc = readMainSource();
    const assertStopStart = mainSrc.indexOf('function assertRuntimeStopVerifiedFromLaunchReport(');
    const assertStopEnd = mainSrc.indexOf('async function assertContainerRuntimeStopped(', assertStopStart);
    expect(assertStopStart).toBeGreaterThanOrEqual(0);
    expect(assertStopEnd).toBeGreaterThan(assertStopStart);
    const assertStopSrc = mainSrc.slice(assertStopStart, assertStopEnd);

    expect(assertStopSrc).toContain("if (report.status !== 'blocked')");
    expect(assertStopSrc).toContain('classifyDesktopRuntimeBlockedLaunchReport(report');
    expect(assertStopSrc).toContain("if (classification.kind === 'stopped') {\n    return;\n  }");
    expect(assertStopSrc).not.toContain("classification.kind === 'restart_required' &&");
    expect(assertStopSrc).not.toContain("classification.kind === 'update_required' &&");

    const assertContainerStart = assertStopEnd;
    const assertContainerEnd = mainSrc.indexOf('async function assertSSHRuntimeStopped(', assertContainerStart);
    expect(assertContainerEnd).toBeGreaterThan(assertContainerStart);
    const assertContainerSrc = mainSrc.slice(assertContainerStart, assertContainerEnd);
    expect(assertContainerSrc).toContain('containerRuntimeDaemonStatusCommand({');
    expect(assertContainerSrc).toContain('assertRuntimeStopVerifiedFromLaunchReport(parseLaunchReport(statusResult.stdout));');
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
    expect(localOpenSrc).toContain('finishLocalHostOpenFailure(operationKey, openTarget, signal, result, preferences)');
    expect(localOpenSrc).toContain("phase: 'checking_env_app_readiness'");
    expect(localOpenSrc).toContain("phase: 'opening_window'");
    expect(localOpenSrc).toContain("phase: 'open_ready'");
    expect(localOpenSrc).not.toContain('Start the runtime first, then open this environment.');

    const refreshRuntimeStart = mainSrc.indexOf('async function refreshEnvironmentRuntimeFromLauncher(');
    const refreshRuntimeEnd = mainSrc.indexOf('async function refreshAllEnvironmentRuntimesFromLauncher(', refreshRuntimeStart);
    const refreshRuntimeSrc = mainSrc.slice(refreshRuntimeStart, refreshRuntimeEnd);
    expect(refreshRuntimeSrc).toContain('const runtimeRecord = await verifyCurrentLocalEnvironmentRuntimeRecord(localEnvironment)\n      ?? await attachLocalEnvironmentRuntime(localEnvironment);');
  });

  it('keeps provider-link tickets separate from remote open route readiness', () => {
    const mainSrc = readMainSource();

    const materialStart = mainSrc.indexOf('async function requestProviderDesktopSessionMaterial(');
    const materialEnd = mainSrc.indexOf('async function prepareProviderRemoteOpenSession(', materialStart);
    expect(materialStart).toBeGreaterThanOrEqual(0);
    expect(materialEnd).toBeGreaterThan(materialStart);
    const materialSrc = mainSrc.slice(materialStart, materialEnd);
    expect(mainSrc).toContain('type ProviderDesktopSessionMaterialOptions = Readonly<{');
    expect(mainSrc).toContain('requireRemoteRouteReady?: boolean;');
    expect(materialSrc).toContain('requestDesktopOpenSession(');
    expect(materialSrc).toContain('if (options.requireRemoteRouteReady === true) {');
    expect(materialSrc).toContain('launcherActionFailureForRemoteRouteState');

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

    const flowerTargetStart = mainSrc.indexOf('async function openFlowerHostTargetSession(');
    const flowerTargetEnd = mainSrc.indexOf('function desktopStateStore()', flowerTargetStart);
    expect(flowerTargetStart).toBeGreaterThanOrEqual(0);
    expect(flowerTargetEnd).toBeGreaterThan(flowerTargetStart);
    const flowerTargetSrc = mainSrc.slice(flowerTargetStart, flowerTargetEnd);
    expect(flowerTargetSrc).toContain('requestProviderDesktopSessionMaterial(preferences, environment, {\n    requireRemoteRouteReady: true,\n  })');
    expect(flowerTargetSrc).toContain('stripSensitiveURLPayload(material.remoteSessionURL)');
    expect(flowerTargetSrc).not.toContain('targetURL: latest.environment.environment_url || material.remoteSessionURL');
    expect(flowerTargetSrc).toContain("const bootTicket = compact(bootPayload.boot_ticket);");
    expect(flowerTargetSrc).toContain('bearerToken: bootTicket');
    expect(flowerTargetSrc).toContain('bearerToken: entryTicket');
    expect(flowerTargetSrc).toContain('normalizeFlowerHostRequiredCapabilities(request.required_capabilities);');
    expect(flowerTargetSrc).toContain('capabilities: envAppTargetSessionCapabilities()');
    expect(mainSrc).toContain('function envAppTargetSessionCapabilities()');
    expect(mainSrc).not.toContain('function targetSessionCapabilitiesFor(');
    expect(flowerTargetSrc).not.toContain('bootstrap_ticket: bootTicket');
    expect(flowerTargetSrc).not.toContain('entry_ticket: entryTicket');
    expect(flowerTargetSrc).not.toContain('control_plane_access_token');
    expect(flowerTargetSrc).not.toContain('provider_access_token');
    expect(flowerTargetSrc).not.toContain('e2ee_psk');

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
    expect(startRuntimeSrc).toContain('void syncLinkedProviderRuntimeHealthFromService(runtimeRecord.startup.runtime_service)');
    expect(startRuntimeSrc).toContain('void syncLinkedProviderRuntimeHealthFromService(prepared.launch.managedRuntime.startup.runtime_service)');
    expect(startRuntimeSrc).toContain('.finally(() => broadcastDesktopWelcomeSnapshots())');

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
    expect(mainSrc).toContain("if (target.kind === 'gateway_environment') {\n    return startup.local_ui_url;\n  }");
    expect(mainSrc).toContain('return buildLocalUIEnvAppEntryURL(startup.local_ui_url);');
    expect(mainSrc).toContain('const entryURL = desktopSessionEntryURL(target, startup);');
    expect(mainSrc).toContain('const rootWindow = createSessionRootWindow(target.session_key, entryURL, diagnostics');
    expect(mainSrc).toContain('const safeAllowedBaseURL = stripSensitiveURLPayload(startup.local_ui_url) || startup.local_ui_url;');
    expect(mainSrc).toContain('allowed_base_url: safeAllowedBaseURL');
    expect(mainSrc).toContain('function rendererSafeStartupReport(startup: StartupReport): StartupReport');
    expect(mainSrc).toContain('entry_url: rendererSafeSessionURL(session)');
    expect(mainSrc).toContain('startup: rendererSafeStartupReport(session.startup)');
    expect(mainSrc).toContain('url.search = \'\';');
    expect(mainSrc).toContain('url.hash = \'\';');
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
    expect(mainSrc).toContain('buildDesktopLastWindowCloseConfirmationModel(impact, desktopLanguageState().getSnapshot().resolved_locale)');
    expect(mainSrc).toContain('buildDesktopQuitConfirmationModel(impact, desktopLanguageState().getSnapshot().resolved_locale)');
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

    expect(helperSrc).toContain('const challenge = await client.pairingChallenge(record, pairingChallengeRequest(material), {');
    expect(helperSrc).toContain('assertGatewayPairingChallenge({');
    expect(pairSrc).not.toContain('confirmDesktopImpact({');
    expect(pairSrc).not.toContain("phase: 'waiting_for_identity_confirmation'");
    expect(helperSrc).toContain('const completion = await client.completePairing(record, buildPairingCompleteRequest(material, challenge), {');
    expect(helperSrc).toContain('assertGatewayPairingCompleteResponse(material, challenge, completion);');
    expect(helperSrc).toContain('completeGatewayPairing({');
    expect(helperSrc).toContain('trust_accepted: true');
    expect(helperSrc.indexOf('assertGatewayPairingChallenge({')).toBeLessThan(
      helperSrc.indexOf('const completion = await client.completePairing(record, buildPairingCompleteRequest(material, challenge), {'),
    );
    expect(helperSrc.indexOf('assertGatewayPairingCompleteResponse(material, challenge, completion);')).toBeLessThan(
      helperSrc.indexOf('completeGatewayPairing({'),
    );
    expect(helperSrc.indexOf('completeGatewayPairing({')).toBeLessThan(
      helperSrc.indexOf('gatewayStore().updateTrustProfile(record.gateway_id, trustProfile);'),
    );
    expect(pairSrc).toContain('await syncGatewayRecord(record, {');
    expect(pairSrc).not.toContain('await client.pairingChallenge(');
    expect(pairSrc).not.toContain('await gatewayLifecycleManager().refreshCatalog(');
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
    expect(mainSrc).toContain('const gatewaySyncTaskByID = new Map<string, Promise<DesktopGatewaySource>>();');
    expect(mainSrc).toContain('function updateGatewaySyncPoller(): void');
    expect(mainSrc).toContain('async function syncVisibleGatewaysIfNeeded(');
    expect(mainSrc).toContain("last_synced_at_ms: 0,");
    expect(mainSrc).toContain('if (!syncRecord?.source) {');
    expect(loadSrc).not.toContain('inspectRuntime(');
    expect(loadSrc).not.toContain('refreshCatalog(');
    expect(loadSrc).toContain('mergeGatewaySourceRecord(');
  });

  it('opens Gateway environments only through Gateway open-session without provider fallback', () => {
    const mainSrc = readMainSource();
    const openStart = mainSrc.indexOf('async function openGatewayEnvironmentFromLauncher(');
    const providerStart = mainSrc.indexOf('async function openProviderRemoteEnvironmentRecord(', openStart);
    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(providerStart).toBeGreaterThan(openStart);
    const openSrc = mainSrc.slice(openStart, providerStart);

    expect(openSrc).toContain('const capabilityFailure = await requireGatewayEnvironmentOpenCapability(record, request, {');
    expect(openSrc).toContain('onRuntimeProgress: lifecycleContext?.onProgress,');
    expect(openSrc).toContain('return finishGatewayOpenCapabilityFailure(operationKey, record, request, target, capabilityFailure);');
    expect(openSrc).toContain('const issued = await gatewayLifecycleManager().openSessionWithBridge(record, {');
    expect(openSrc).toContain("requested_capability: 'env_app'");
    expect(openSrc).toContain('if (error instanceof GatewayRuntimeStartRequiredError || error instanceof GatewayNotManageableError) {');
    expect(openSrc).toContain("next_actions: gatewayOperationFailureNextActions(operationKey, {");
    expect(openSrc).toContain("return gatewayLauncherFailureFromError(error, record, 'open_gateway_environment', {");
    expect(openSrc).toContain('const artifactURL = gatewaySessionArtifactURL(record, response, bridgeSession);');
    expect(mainSrc).toContain('async function installGatewaySessionCookies(');
    expect(mainSrc).toContain('await installGatewaySessionCookies(entryURL, options.gatewaySetCookieHeaders, sessionPartition);');
    expect(openSrc).toContain('buildGatewayDesktopTarget({');
    expect(openSrc).toContain('gatewaySessionID: response.gateway_session_id');
    expect(openSrc).toContain('gatewayManagedSessionStartup(artifactURL)');
    expect(openSrc).toContain('const sessionRecord = await createSessionRecord(openTarget, startup, {');
    expect(openSrc).toContain('gatewaySetCookieHeaders: response.set_cookie_headers,');
    expect(openSrc).toContain("location: 'runtime_gateway'");
    expect(openSrc).not.toContain('installGatewayLocalAccessCookies');
    expect(openSrc).not.toContain('openRemoteEnvironmentFromLauncher');
    expect(openSrc).not.toContain('openProviderEnvironmentFromLauncher');
    expect(openSrc).not.toContain('openProviderEnvironmentWithOpenSession');
    expect(openSrc).not.toContain('openProviderRemoteEnvironmentRecord');
    expect(openSrc.indexOf('const artifactURL = gatewaySessionArtifactURL(record, response, bridgeSession);')).toBeLessThan(
      openSrc.indexOf('const sessionRecord = await createSessionRecord(openTarget, startup'),
    );
    expect(openSrc.indexOf('gatewaySetCookieHeaders: response.set_cookie_headers,')).toBeLessThan(
      openSrc.indexOf('await waitForSessionInitialLoad(sessionRecord);'),
    );
    expect(mainSrc).toContain("case 'open_gateway_environment':\n      return openGatewayEnvironmentFromLauncher(request);");
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
