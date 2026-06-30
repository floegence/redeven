import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readMainSource(): string {
  return fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
}

function readSharedGatewaySource(): string {
  return fs.readFileSync(path.join(__dirname, '..', 'shared', 'desktopGateway.ts'), 'utf8');
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

  it('models Refresh Gateway as one visible launcher workflow with internal service, package, pairing, and catalog stages', () => {
    const mainSrc = readMainSource();
    const stepsStart = mainSrc.indexOf('const GATEWAY_REFRESH_WORKFLOW_STEPS');
    const stepsEnd = mainSrc.indexOf('function gatewayStepProgress(', stepsStart);
    expect(stepsStart).toBeGreaterThanOrEqual(0);
    expect(stepsEnd).toBeGreaterThan(stepsStart);
    const stepsSrc = mainSrc.slice(stepsStart, stepsEnd);

    expect(stepsSrc).toContain("{ id: 'checking_gateway_service', label: 'Checking Gateway service', backendEvent: 'gateway.service.check' }");
    expect(stepsSrc).toContain("{ id: 'checking_gateway_package', label: 'Checking Gateway package', backendEvent: 'gateway.package.check' }");
    expect(stepsSrc).toContain("{ id: 'fetching_pairing_challenge', label: 'Fetching pairing challenge', backendEvent: 'gateway.pair.challenge' }");
    expect(stepsSrc).toContain("{ id: 'saving_trust_profile', label: 'Saving trust profile', backendEvent: 'gateway.pair.trust' }");
    expect(stepsSrc).toContain("{ id: 'refreshing_gateway_catalog', label: 'Refreshing Gateway catalog', backendEvent: 'gateway.catalog.refresh' }");
    expect(stepsSrc).toContain("{ id: 'gateway_refreshed', label: 'Gateway refreshed', backendEvent: 'gateway.refresh.done' }");
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

    expect(helperSrc).toContain("serviceStatus === 'service_needs_update'");
    expect(helperSrc).toContain("serviceWarning ? 'warning'");
    expect(helperSrc).not.toContain("serviceWarning ? 'unknown'");
    expect(helperSrc).toContain("const catalogSkipped = diagnosis.catalog_state === 'idle' || diagnosis.catalog_state === 'pairing_failed';");
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

  it('limits Gateway diagnosis recovery guidance to Start, Restart, and Update', () => {
    const mainSrc = readMainSource();
    const gatewayTypeSrc = readSharedGatewaySource();
    const recoveryStart = mainSrc.indexOf('function gatewayRecommendedRecoveryForDiagnosis(');
    const recoveryEnd = mainSrc.indexOf('function gatewayProbeResultsForDiagnosis(', recoveryStart);
    expect(recoveryStart).toBeGreaterThanOrEqual(0);
    expect(recoveryEnd).toBeGreaterThan(recoveryStart);
    const recoverySrc = mainSrc.slice(recoveryStart, recoveryEnd);
    const nextActionsStart = mainSrc.indexOf('function gatewayDiagnosisNextActions(');
    const nextActionsEnd = mainSrc.indexOf('function gatewayRecommendedRecoveryForDiagnosis(', nextActionsStart);
    expect(nextActionsStart).toBeGreaterThanOrEqual(0);
    expect(nextActionsEnd).toBeGreaterThan(nextActionsStart);
    const nextActionsSrc = mainSrc.slice(nextActionsStart, nextActionsEnd);

    expect(gatewayTypeSrc).toContain('recommended_recovery?:');
    expect(gatewayTypeSrc).not.toContain('recommended_action?:');
    expect(mainSrc).toContain('recommended_recovery: recommendedRecovery');
    expect(mainSrc).toContain('switch (diagnosis.recommended_recovery ?? gatewayRecommendedRecoveryForDiagnosis(diagnosis))');
    expect(gatewayTypeSrc).toContain("recommended_recovery?: 'start_gateway' | 'restart_gateway' | 'update_gateway';");
    expect(recoverySrc).toContain("return diagnosis.service_state?.can_start === false ? undefined : 'start_gateway';");
    expect(recoverySrc).toContain("return diagnosis.service_state?.can_update === false ? undefined : 'update_gateway';");
    expect(recoverySrc).toContain("return diagnosis.service_state?.can_restart === false ? undefined : 'restart_gateway';");
    expect(recoverySrc).toContain("case 'service_ready_catalog_failed':");
    expect(recoverySrc).toContain("case 'trust_failed':");
    expect(recoverySrc).toContain("case 'pairing_required':");
    expect(recoverySrc).toContain('return undefined;');
    expect(nextActionsSrc).toContain("kind: 'start_gateway'");
    expect(nextActionsSrc).toContain("kind: 'restart_gateway'");
    expect(nextActionsSrc).toContain("kind: 'update_gateway'");
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
    expect(mainSrc).toContain('target_commit: process.env.REDEVEN_DESKTOP_BUNDLE_COMMIT');
    expect(mainSrc).toContain('function gatewayManagedProbeNeedsUpdate(');
    expect(diagnosisSrc).toContain('if (gatewayClientErrorIsPairingRejected(error)) {');
    expect(diagnosisSrc).toContain('if (gatewayManagedProbeNeedsUpdate(managedProbe)) {');
    expect(diagnosisSrc).toContain("classification: 'needs_update'");
    expect(diagnosisSrc).toContain("catalog_state: 'pairing_failed'");
    expect(diagnosisSrc).toContain("recommended_recovery: 'update_gateway'");
    expect(diagnosisSrc).toContain("classification: 'pairing_required'");
    expect(diagnosisSrc).not.toContain("recommended_recovery: 'review_trust'");
    expect(diagnosisSrc.indexOf('if (gatewayClientErrorIsPairingRejected(error)) {')).toBeLessThan(
      diagnosisSrc.indexOf("classification: manageable && serviceState?.status === 'ready' ? 'service_ready_catalog_failed' : 'catalog_failed'"),
    );
  });

  it('keeps Gateway protocol mismatches separate from pairing, trust, reachability, and Runtime compatibility', () => {
    const mainSrc = readMainSource();
    const diagnosisStart = mainSrc.indexOf('function gatewayDiagnosisForError(');
    const diagnosisEnd = mainSrc.indexOf('async function checkGatewayRecord(', diagnosisStart);
    expect(diagnosisStart).toBeGreaterThanOrEqual(0);
    expect(diagnosisEnd).toBeGreaterThan(diagnosisStart);
    const diagnosisSrc = mainSrc.slice(diagnosisStart, diagnosisEnd);
    const protocolStart = diagnosisSrc.indexOf("if (error.code === 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED') {");
    const protocolEnd = diagnosisSrc.indexOf("if (managedProbe?.legacy_runtime_residue === true)", protocolStart);
    expect(protocolStart).toBeGreaterThanOrEqual(0);
    expect(protocolEnd).toBeGreaterThan(protocolStart);
    const protocolSrc = diagnosisSrc.slice(protocolStart, protocolEnd);

    expect(protocolSrc).toContain("classification: manageable ? 'needs_update' : 'catalog_failed'");
    expect(protocolSrc).toContain("catalog_state: 'catalog_failed'");
    expect(protocolSrc).toContain("summary: manageable ? 'Gateway update required' : 'Gateway protocol unsupported'");
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
    expect(syncSrc).toContain('environments: invalidateCatalog ? [] : previous.source?.environments ?? errorSource.environments');
    expect(syncSrc).toContain('capabilities: invalidateCatalog ? [] : previous.source?.capabilities ?? errorSource.capabilities');

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
    expect(mainSrc).toContain('const pendingLocalHostRuntimeStartByTargetID = new Map<DesktopRuntimeTargetID, PendingLocalHostRuntimeStart>();');
    expect(mainSrc).toContain('const pendingStart = pendingLocalHostRuntimeStartByTargetID.get(operationKey) ?? null;');
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
    expect(routeSnapshotSrc).toContain('const summary = controlPlaneSummary(controlPlane, preferences.provider_environments);');
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

    expect(mainSrc).not.toContain('targetURL: latest.environment.environment_url || material.remoteSessionURL');

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

  it('routes Welcome Flower through the Local Environment runtime API only', () => {
    const mainSrc = readMainSource();

    const pathStart = mainSrc.indexOf('function runtimeFlowerPath(');
    const pathEnd = mainSrc.indexOf('function runtimeFlowerMethod(', pathStart);
    expect(pathStart).toBeGreaterThanOrEqual(0);
    expect(pathEnd).toBeGreaterThan(pathStart);
    const pathSrc = mainSrc.slice(pathStart, pathEnd);
    expect(pathSrc).toContain("new URL(raw, 'http://runtime-flower.local')");
    expect(pathSrc).toContain('const pathname = parsed.pathname;');
    expect(pathSrc).toContain("'/_redeven_proxy/api/settings'");
    expect(pathSrc).toContain("'/_redeven_proxy/api/ai/provider_bundle'");
    expect(pathSrc).toContain("'/_redeven_proxy/api/ai/models'");
    expect(pathSrc).not.toContain("'/_redeven_proxy/api/ai/runs'");
    expect(pathSrc).toContain("/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/live\\/bootstrap$/u");
    expect(pathSrc).toContain("/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/live\\/events$/u");
    expect(pathSrc).toContain("/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/subagents\\/[^/]+\\/detail$/u");
    expect(pathSrc).toContain('allowsSubagentDetailQuery(query)');
    expect(pathSrc).toContain('after_ordinal');
    expect(pathSrc).toContain("/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/turns$/u");
    expect(pathSrc).not.toContain("/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/live$/u");
    expect(pathSrc).not.toContain('live\\/updates');
    expect(pathSrc).toContain("/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/approvals$/u");
    expect(pathSrc).toContain("/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/context\\/compact$/u");
    expect(pathSrc).toContain("/^\\/_redeven_proxy\\/api\\/ai\\/threads\\/[^/]+\\/cancel$/u");
    expect(pathSrc).toContain("/^\\/_redeven_proxy\\/api\\/ai\\/runs\\/[^/]+\\/terminal\\/[^/]+\\/read$/u");
    expect(pathSrc).toContain('allowsTerminalReadQuery(parsed.searchParams)');
    expect(pathSrc).toContain("'after_seq'");
    expect(pathSrc).toContain("'wait_ms'");
    expect(pathSrc).toContain("'max_bytes'");
    expect(pathSrc).not.toContain('terminal\\/[^/]+\\/write');
    expect(pathSrc).not.toContain('terminal\\/[^/]+\\/terminate');
    expect(pathSrc).toContain("throw new Error('Flower runtime request path is not allowed.');");
    expect(pathSrc).not.toContain("startsWith('/_redeven_proxy/api/ai/threads')");

    const methodStart = mainSrc.indexOf('function runtimeFlowerMethodAllowed(');
    const methodEnd = mainSrc.indexOf('async function requestRuntimeFlower(', methodStart);
    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodEnd).toBeGreaterThan(methodStart);
    const methodSrc = mainSrc.slice(methodStart, methodEnd);
    expect(methodSrc).toContain("/^\\/_redeven_proxy\\/api\\/ai\\/runs\\/[^/]+\\/terminal\\/[^/]+\\/read$/u");
    expect(methodSrc).not.toContain('terminal\\/[^/]+\\/write');
    expect(methodSrc).not.toContain('terminal\\/[^/]+\\/terminate');

    const requestStart = mainSrc.indexOf('async function requestRuntimeFlower(');
    const requestEnd = mainSrc.indexOf('async function assertLocalEnvironmentRuntimeStopped(', requestStart);
    expect(requestStart).toBeGreaterThanOrEqual(0);
    expect(requestEnd).toBeGreaterThan(requestStart);
    const requestSrc = mainSrc.slice(requestStart, requestEnd);
    expect(requestSrc).toContain('const record = await ensureRuntimeFlowerRecord();');
    expect(requestSrc).toContain('const url = new URL(path, record.startup.local_ui_url);');
    expect(requestSrc).toContain('runtimeFlowerMethodAllowed(path, method)');
    expect(requestSrc).toContain('let accessHeaders = await runtimeFlowerAccessHeaders(record, environment);');
    expect(requestSrc).toContain('Cookie: runtimeFlowerAccessCookieHeader(cookie)');
    expect(requestSrc).toContain('runtimeFlowerRequestHTTP(url, { ...request, method, path }, { headers: accessHeaders })');
    expect(requestSrc).not.toContain('requestProviderDesktopSessionMaterial');
    expect(requestSrc).not.toContain('requestDesktopOpenSession');

    const httpStart = mainSrc.indexOf('function runtimeFlowerRequestHTTP(');
    const httpEnd = mainSrc.indexOf('function parseRuntimeFlowerJSON(', httpStart);
    expect(httpStart).toBeGreaterThanOrEqual(0);
    expect(httpEnd).toBeGreaterThan(httpStart);
    const httpSrc = mainSrc.slice(httpStart, httpEnd);
    expect(httpSrc).toContain("Accept: 'application/json'");
    expect(httpSrc).not.toContain('application/x-ndjson');

    const errorStart = mainSrc.indexOf('function runtimeFlowerEnvelopeError(');
    const errorEnd = mainSrc.indexOf('async function unlockRuntimeFlowerAccess(', errorStart);
    expect(errorStart).toBeGreaterThanOrEqual(0);
    expect(errorEnd).toBeGreaterThan(errorStart);
    const errorSrc = mainSrc.slice(errorStart, errorEnd);
    expect(errorSrc).toContain('runtimeFlowerRetryAfterMs(error.retry_after_ms)');
    expect(errorSrc).toContain('runtimeFlowerRetryAfterMs(record.retry_after_ms)');

    const unlockStart = mainSrc.indexOf('async function unlockRuntimeFlowerAccess(');
    const unlockEnd = mainSrc.indexOf('async function runtimeFlowerAccessHeaders(', unlockStart);
    expect(unlockStart).toBeGreaterThanOrEqual(0);
    expect(unlockEnd).toBeGreaterThan(unlockStart);
    const unlockSrc = mainSrc.slice(unlockStart, unlockEnd);
    expect(unlockSrc).toContain("new URL('/api/local/access/unlock', baseURL)");
    expect(unlockSrc).toContain('throw (error ?? runtimeFlowerError(');
    expect(unlockSrc).not.toContain('throw new Error(error?.message');

    const pendingFlowerStart = mainSrc.indexOf('async function waitForRuntimeFlowerPendingStart(');
    const pendingFlowerEnd = mainSrc.indexOf('async function ensureRuntimeFlowerRecord()', pendingFlowerStart);
    expect(pendingFlowerStart).toBeGreaterThanOrEqual(0);
    expect(pendingFlowerEnd).toBeGreaterThan(pendingFlowerStart);
    const pendingFlowerSrc = mainSrc.slice(pendingFlowerStart, pendingFlowerEnd);
    expect(pendingFlowerSrc).toContain("presentation_context: 'flower_warmup'");
    expect(pendingFlowerSrc).toContain('const record = await pendingStart.task;');
    expect(pendingFlowerSrc).toContain('assertRuntimeFlowerRecordOpenable(record);');

    const ensureStart = mainSrc.indexOf('async function ensureRuntimeFlowerRecord()');
    const ensureEnd = mainSrc.indexOf('type RuntimeFlowerHTTPResponse', ensureStart);
    expect(ensureStart).toBeGreaterThanOrEqual(0);
    expect(ensureEnd).toBeGreaterThan(ensureStart);
    const ensureSrc = mainSrc.slice(ensureStart, ensureEnd);
    expect(ensureSrc).toContain('pendingLocalHostRuntimeStartForEnvironment(environment.id)');
    expect(ensureSrc).toContain('return waitForRuntimeFlowerPendingStart(pendingStart);');
    expect(ensureSrc).toContain('buildDesktopLocalRuntimeOpenPlan(');
    expect(ensureSrc).toContain('if (runtimePlan.requires_restart)');
    expect(ensureSrc).toContain("action: 'restart_environment_runtime'");
    expect(ensureSrc).toContain('assertRuntimeFlowerRecordOpenable(attached);');
    expect(ensureSrc).toContain('startLocalHostRuntimeWithLifecycleProgress({');
    expect(ensureSrc).toContain("action: 'start_environment_runtime'");
    expect(ensureSrc).toContain("presentationContext: 'flower_warmup'");
    expect(ensureSrc).not.toContain('prepareManagedTarget({ environment })');

    const lifecycleStart = mainSrc.indexOf('async function startLocalHostRuntimeWithLifecycleProgress(');
    const lifecycleEnd = mainSrc.indexOf('async function startEnvironmentRuntimeFromLauncher(', lifecycleStart);
    expect(lifecycleStart).toBeGreaterThanOrEqual(0);
    expect(lifecycleEnd).toBeGreaterThan(lifecycleStart);
    const lifecycleSrc = mainSrc.slice(lifecycleStart, lifecycleEnd);
    expect(lifecycleSrc).toContain('launcherOperations.create({');
    expect(lifecycleSrc).toContain("subject_kind: 'local_environment'");
    expect(lifecycleSrc).toContain('presentation_context: input.presentationContext');
    expect(lifecycleSrc).toContain('launcherOperations.update(pendingStart.operation_key, {\n          presentation_context: input.presentationContext,');
    expect(lifecycleSrc).toContain("title: 'Waiting for local runtime startup'");
    expect(lifecycleSrc).not.toContain('launcherOperations.cancel(pendingStart.operation_key');
    expect(lifecycleSrc).toContain('onProgress: (progress: ManagedRuntimeProgress) => {');
    expect(lifecycleSrc).toContain('updateRuntimeLifecycleOperation(operationKey, lifecycleAttemptOwner');
    expect(lifecycleSrc).toContain("launcherOperations.finishCurrentAttempt(operationKey, lifecycleAttemptOwner, 'succeeded'");
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
    expect(startRuntimeSrc).toContain('void syncLinkedProviderRuntimeHealthFromService(record.startup.runtime_service)');
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
    expect(mainSrc).toContain("launcherOperations.cancel(pendingStart.operation_key, 'Redeven Desktop is quitting and waiting for this local runtime startup task.');");
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

    expect(helperSrc).toContain("record.connection.kind === 'url'");
    expect(helperSrc).toContain('pairingChallengeRequestWithCode(material, options.pairingCode ?? \'\')');
    expect(helperSrc).toContain('const challenge = await client.pairingChallenge(record, challengeRequest, {');
    expect(helperSrc).toContain('assertGatewayPairingChallenge({');
    expect(pairSrc).not.toContain('confirmDesktopImpact({');
    expect(pairSrc).not.toContain("phase: 'waiting_for_identity_confirmation'");
    expect(helperSrc).toContain("const pairingOptions = { profileWrite: record.connection.kind !== 'url' };");
    expect(helperSrc).toContain('const completionRequest = buildPairingCompleteRequest(material, challenge, pairingOptions);');
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
    expect(pairSrc).toContain("return refreshGatewayFromLauncher({");
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
    expect(mainSrc).toContain('function launcherOperationIsActiveGatewayServiceAction(');
    expect(mainSrc).toContain('function activeGatewayServiceOperation(gatewayID: string): DesktopLauncherOperationSnapshot | null');
    expect(mainSrc).toContain("last_synced_at_ms: 0,");
    expect(mainSrc).toContain('background_sync_running: false,');
    expect(mainSrc).toContain('const serviceStatus = syncRecord?.source?.service_state?.status;');
    expect(mainSrc).toContain("serviceStatus === 'not_started' || serviceStatus === 'service_needs_update'");
    expect(mainSrc).toContain('if (!syncRecord?.source) {');
    expect(mainSrc).toContain('if (!record.local_enabled) {');
    expect(mainSrc).toContain('if (activeGatewayServiceOperation(record.gateway_id)) {');
    expect(mainSrc).toContain("gatewaySyncTaskByID.set(record.gateway_id, { priority, token: taskToken, controller, task });");
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
    expect(scheduleSrc).toContain('const requestEnabled = request.kind === \'set_gateway_enabled\' ? request.enabled : true;');
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
    expect(syncSrc).toContain("supersedeGatewaySyncTask(record.gateway_id);");
    expect(syncSrc).toContain('if (!latestRecord.local_enabled) {');
    expect(syncSrc).toContain('throw new GatewaySyncCanceledError(\'Gateway sync was canceled because this Gateway is disabled on this Desktop.\');');
  });

  it('routes legacy Gateway refresh requests through the unified Refresh workflow', () => {
    const mainSrc = readMainSource();
    const syncStart = mainSrc.indexOf('async function syncGatewayRecord(');
    const syncEnd = mainSrc.indexOf('async function syncGatewayIfNeeded(', syncStart);
    expect(syncStart).toBeGreaterThanOrEqual(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const syncSrc = mainSrc.slice(syncStart, syncEnd);
    const refreshStart = mainSrc.indexOf('async function refreshGatewayStatusFromLauncher(');
    const refreshEnd = mainSrc.indexOf('async function runGatewayServiceActionFromLauncher(', refreshStart);
    expect(refreshStart).toBeGreaterThanOrEqual(0);
    expect(refreshEnd).toBeGreaterThan(refreshStart);
    const refreshSrc = mainSrc.slice(refreshStart, refreshEnd);

    expect(syncSrc).not.toContain("mode === 'refresh_status'");
    expect(syncSrc).toContain('inspectGatewayServiceForSync(currentRecord, {');
    expect(syncSrc).toContain('const client = await gatewayClientForSync(currentRecord, {');
    expect(syncSrc).toContain('startPolicy,');
    expect(syncSrc).toContain('pairGatewayWithClient(currentRecord, client, secretStore, {');
    expect(syncSrc).toContain('return gatewayLifecycleManager().refreshCatalog(targetRecord, {');
    expect(refreshSrc).toContain("return refreshGatewayFromLauncher({");
    expect(refreshSrc).toContain("kind: 'refresh_gateway'");
    expect(refreshSrc).not.toContain("kind: 'sync_gateway'");
    expect(refreshSrc).not.toContain('refresh_status');
    expect(mainSrc).toContain("if (requested === 'start_if_needed') {");
    expect(mainSrc).toContain("return 'require_ready';");
  });

  it('repairs managed Gateway trust internally when local or remote trust is stale', () => {
    const mainSrc = readMainSource();
    const helperStart = mainSrc.indexOf('function gatewayTrustErrorNeedsRepair(');
    const helperEnd = mainSrc.indexOf('function gatewaySyncRecordFromError(', helperStart);
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperSrc = mainSrc.slice(helperStart, helperEnd);
    const syncStart = mainSrc.indexOf('async function syncGatewayRecord(');
    const syncEnd = mainSrc.indexOf('async function syncGatewayIfNeeded(', syncStart);
    expect(syncStart).toBeGreaterThanOrEqual(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const syncSrc = mainSrc.slice(syncStart, syncEnd);

    expect(mainSrc).toContain('revokeGatewayTrust,');
    expect(helperSrc).toContain('function gatewayTrustErrorNeedsRepair(error: GatewayTrustError): boolean');
    expect(helperSrc).toContain("case 'GATEWAY_PAIRING_REQUIRED':");
    expect(helperSrc).toContain("case 'GATEWAY_CLIENT_PRIVATE_KEY_REQUIRED':");
    expect(helperSrc).toContain("case 'GATEWAY_TRUST_REVOKED':");
    expect(helperSrc).toContain('function gatewayErrorNeedsTrustRepair(error: unknown): boolean');
    expect(helperSrc).toContain('return gatewayClientErrorIsPairingRejected(error);');
    expect(helperSrc).toContain('return gatewayTrustErrorNeedsRepair(error);');
    expect(helperSrc).toContain("record.connection.kind !== 'url' && !!record.trust_profile");
    expect(helperSrc).toContain('await revokeGatewayTrust(profile, secretStore);');
    expect(helperSrc).toContain('await gatewayLifecycleManager().clear(record);');
    expect(helperSrc).toContain('return gatewayStore().updateTrustProfile(record.gateway_id, undefined);');
    expect(syncSrc).toContain('catch (catalogError) {');
    expect(syncSrc).toContain('gatewayErrorNeedsTrustRepair(catalogError)');
    expect(syncSrc).toContain('gatewayCanRepairManagedTrust(currentRecord)');
    expect(syncSrc).toContain('currentRecord = await resetManagedGatewayTrust(currentRecord, secretStore);');
    expect(syncSrc).toContain('const repairClient = await gatewayClientForSync(currentRecord, {');
    expect(syncSrc).toContain('currentRecord = await pairGatewayWithClient(currentRecord, repairClient, secretStore, {');
    expect(syncSrc).toContain('catalog = await refreshCatalog(currentRecord);');
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

  it('keeps Gateway service actions in one foreground workflow with internal post-success state refresh', () => {
    const mainSrc = readMainSource();
    const serviceStart = mainSrc.indexOf('async function runGatewayServiceActionFromLauncher(');
    const serviceEnd = mainSrc.indexOf('function gatewayServiceOperationName(', serviceStart);
    expect(serviceStart).toBeGreaterThanOrEqual(0);
    expect(serviceEnd).toBeGreaterThan(serviceStart);
    const serviceSrc = mainSrc.slice(serviceStart, serviceEnd);
    const nextActionsStart = mainSrc.indexOf('function gatewayOperationFailureNextActions(');
    const nextActionsEnd = mainSrc.indexOf('function gatewayDiagnosisForServiceState(', nextActionsStart);
    expect(nextActionsStart).toBeGreaterThanOrEqual(0);
    expect(nextActionsEnd).toBeGreaterThan(nextActionsStart);
    const nextActionsSrc = mainSrc.slice(nextActionsStart, nextActionsEnd);
    const refreshStart = mainSrc.indexOf('async function refreshGatewayFromLauncher(');
    const refreshEnd = mainSrc.indexOf('async function checkGatewayFromLauncher(', refreshStart);
    expect(refreshStart).toBeGreaterThanOrEqual(0);
    expect(refreshEnd).toBeGreaterThan(refreshStart);
    const refreshSrc = mainSrc.slice(refreshStart, refreshEnd);
    const checkWrapperStart = mainSrc.indexOf('async function checkGatewayFromLauncher(');
    const pairWrapperEnd = mainSrc.indexOf('function gatewayOpenSessionSummaries(', checkWrapperStart);
    expect(checkWrapperStart).toBeGreaterThanOrEqual(0);
    expect(pairWrapperEnd).toBeGreaterThan(checkWrapperStart);
    const legacyWrapperSrc = mainSrc.slice(checkWrapperStart, pairWrapperEnd);
    const checkRecordStart = mainSrc.indexOf('async function checkGatewayRecord(');
    const checkRecordEnd = mainSrc.indexOf('type GatewayLifecycleOperationContext', checkRecordStart);
    expect(checkRecordStart).toBeGreaterThanOrEqual(0);
    expect(checkRecordEnd).toBeGreaterThan(checkRecordStart);
    const checkRecordSrc = mainSrc.slice(checkRecordStart, checkRecordEnd);

    expect(serviceSrc).toContain('const operationKey = `${descriptor.target_id}:${gatewayServiceOperationName(request.kind)}`;');
    expect(serviceSrc).toContain('const activeServiceOperation = launcherOperations.get(operationKey);');
    expect(serviceSrc).toContain('if (launcherOperationIsActive(activeServiceOperation)) {');
    expect(serviceSrc).toContain('gateway_id: record.gateway_id,');
    expect(serviceSrc).toContain('supersedeGatewaySyncTask(record.gateway_id);');
    expect(serviceSrc).toContain('clearGatewayRefreshDiagnosisState(record.gateway_id);');
    expect(serviceSrc).toContain('rememberCompletedGatewayServiceAction(record, request, descriptor);');
    expect(serviceSrc).toContain('await refreshGatewayAfterCompletedServiceAction(record, request);');
    expect(serviceSrc.indexOf('supersedeGatewaySyncTask(record.gateway_id);')).toBeLessThan(
      serviceSrc.indexOf('const descriptor = gatewayServiceTargetDescriptor(record);'),
    );
    expect(serviceSrc.indexOf('clearGatewayRefreshDiagnosisState(record.gateway_id);')).toBeLessThan(
      serviceSrc.indexOf('rememberCompletedGatewayServiceAction(record, request, descriptor);'),
    );
    expect(serviceSrc.indexOf('rememberCompletedGatewayServiceAction(record, request, descriptor);')).toBeLessThan(
      serviceSrc.indexOf('await refreshGatewayAfterCompletedServiceAction(record, request);'),
    );
    expect(serviceSrc).toContain('const completedServiceLifecycleProgress = completeRuntimeLifecycleWorkflowProgress(operationKey, lifecycleAttemptOwner, {');
    expect(serviceSrc).toContain('lifecycle_progress: completedServiceLifecycleProgress');
    expect(serviceSrc).not.toContain('lifecycle_progress: undefined');
    expect(serviceSrc).toContain("title: `${actionLabel} complete`");
    expect(serviceSrc).toContain('Desktop updated, restarted, and refreshed ${record.display_name}.');
    expect(serviceSrc).not.toContain('Use Refresh to refresh pairing and catalog.');
    expect(serviceSrc).not.toContain('refreshing_gateway_catalog');
    expect(serviceSrc).not.toContain('Gateway synced');
    expect(serviceSrc).toContain('next_actions: gatewayOperationFailureNextActions(operationKey, {');
    expect(serviceSrc).not.toContain("kind: 'sync_gateway'");
    expect(mainSrc).not.toContain('function activeGatewayForegroundOperation(gatewayID: string): DesktopLauncherOperationSnapshot | null');
    const postSuccessStart = mainSrc.indexOf('async function refreshGatewayAfterCompletedServiceAction(');
    const postSuccessEnd = mainSrc.indexOf('async function runGatewayServiceActionFromLauncher(', postSuccessStart);
    expect(postSuccessStart).toBeGreaterThanOrEqual(0);
    expect(postSuccessEnd).toBeGreaterThan(postSuccessStart);
    const postSuccessSrc = mainSrc.slice(postSuccessStart, postSuccessEnd);
    expect(postSuccessSrc).toContain("if (request.kind === 'stop_gateway') {");
    expect(postSuccessSrc).toContain('return;');
    expect(postSuccessSrc).toContain('await syncGatewayRecord(latestRecord, {');
    expect(postSuccessSrc).toContain("startPolicy: 'require_ready'");
    expect(nextActionsSrc).not.toContain("kind: 'retry' as const");
    expect(nextActionsSrc).not.toContain("kind: 'check_gateway' as const");
    expect(nextActionsSrc).toContain("kind: 'copy_diagnostics' as const");
    expect(nextActionsSrc).toContain("kind: 'dismiss' as const");
    const failureHelperStart = mainSrc.indexOf('function gatewayFailureTitleKeyForDiagnosis(');
    const failureHelperEnd = mainSrc.indexOf('function gatewayRecommendedRecoveryForDiagnosis(', failureHelperStart);
    expect(failureHelperStart).toBeGreaterThanOrEqual(0);
    expect(failureHelperEnd).toBeGreaterThan(failureHelperStart);
    const failureHelperSrc = mainSrc.slice(failureHelperStart, failureHelperEnd);
    expect(failureHelperSrc).toContain("case 'not_started':");
    expect(failureHelperSrc).toContain("return 'environmentCenter.gatewayGuidanceStoppedTitle';");
    expect(failureHelperSrc).toContain("return 'environmentCenter.gatewayPanelStartToSyncDetail';");
    expect(failureHelperSrc).toContain("case 'needs_update':");
    expect(failureHelperSrc).toContain("return 'environmentCenter.gatewayPanelUpdateRequiredTitle';");
    expect(refreshSrc).toContain('const activeRefreshOperation = launcherOperations.get(operationKey);');
    expect(refreshSrc).toContain('if (launcherOperationIsActive(activeRefreshOperation)) {\n    rebroadcastLauncherOperationProgress(activeRefreshOperation);');
    expect(refreshSrc).toContain('cancelable: false');
    expect(refreshSrc).toContain("action: 'refresh_gateway'");
    expect(refreshSrc).toContain("phase: 'checking_gateway_service'");
    expect(refreshSrc).toContain("step_progress: gatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, 'checking_gateway_service')");
    expect(refreshSrc).toContain("title: 'Gateway is ready'");
    expect(refreshSrc).toContain("detail: 'Desktop refreshed this Gateway and can reach its catalog.'");
    expect(refreshSrc).toContain("step_progress: completeGatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, 'gateway_refreshed')");
    expect(refreshSrc).toContain('gateway_diagnosis: completeGatewayDiagnosis(diagnosis)');
    expect(refreshSrc).toContain('next_actions: gatewayDiagnosisNextActions(operationKey, latestRecord, diagnosis)');
    expect(refreshSrc).toContain('const failure = gatewayFailureFromDiagnosis(diagnosis);');
    expect(refreshSrc).not.toContain("title: 'Refresh Gateway Failed'");
    expect(refreshSrc).not.toContain('targetLabel: record.display_name');
    expect(legacyWrapperSrc).toContain("return refreshGatewayFromLauncher({");
    expect(legacyWrapperSrc).toContain("kind: 'refresh_gateway'");
    expect(checkRecordSrc).toContain('await gatewayLifecycleManager().refreshCatalog(record, {');
    expect(checkRecordSrc).toContain("startPolicy: record.connection.kind === 'url' ? undefined : 'require_ready'");
    expect(checkRecordSrc).toContain("catalog_state: 'ready'");
    expect(checkRecordSrc).toContain("trust_state: 'unpaired'");
    expect(checkRecordSrc).toContain("classification: 'pairing_required'");
    expect(checkRecordSrc).not.toContain("recommended_recovery: 'sync_gateway'");
    expect(checkRecordSrc).not.toContain("recommended_recovery: 'review_trust'");
    expect(checkRecordSrc).not.toContain('markCatalogSynced(');
    expect(checkRecordSrc).not.toContain('setGatewaySyncRecord(');
  });

  it('publishes confirmed Gateway service state after service actions without claiming catalog success', () => {
    const mainSrc = readMainSource();
    const stateStart = mainSrc.indexOf('function serviceStateForCompletedGatewayAction(');
    const rememberStart = mainSrc.indexOf('function rememberCompletedGatewayServiceAction(', stateStart);
    const diagnosisStart = mainSrc.indexOf('function setGatewayDiagnosis(', rememberStart);
    expect(stateStart).toBeGreaterThanOrEqual(0);
    expect(rememberStart).toBeGreaterThan(stateStart);
    expect(diagnosisStart).toBeGreaterThan(rememberStart);
    const stateSrc = mainSrc.slice(stateStart, rememberStart);
    const rememberSrc = mainSrc.slice(rememberStart, diagnosisStart);

    expect(stateSrc).toContain("request.kind === 'stop_gateway'");
    expect(stateSrc).toContain("status: 'not_started'");
    expect(stateSrc).toContain('can_start: true');
    expect(stateSrc).toContain('can_stop: false');
    expect(stateSrc).toContain("status: 'ready'");
    expect(stateSrc).toContain('can_stop: true');
    expect(stateSrc).toContain('can_restart: true');
    expect(stateSrc).toContain('can_update: true');
    expect(stateSrc).toContain('service_target_id: descriptor.target_id');
    expect(stateSrc).toContain('service_state_root: descriptor.service_state_root');
    expect(rememberSrc).toContain('previous.source ?? gatewayRecordToSource(record)');
    expect(rememberSrc).toContain("sync_state: 'idle'");
    expect(rememberSrc).toContain('background_sync_running: false');
    expect(rememberSrc).toContain("last_sync_error_code: ''");
    expect(rememberSrc).toContain("last_sync_error_message: ''");
    expect(rememberSrc).toContain('serviceStateForCompletedGatewayAction(request, descriptor)');
    expect(rememberSrc).not.toContain("sync_state: 'ready'");
    expect(rememberSrc).not.toContain('gatewayRecordToSourceWithCatalog(');
    expect(rememberSrc).not.toContain('markCatalogSynced(');
  });

  it('does not erase the confirmed Gateway service state after stop actions finish', () => {
    const mainSrc = readMainSource();
    const sideEffectStart = mainSrc.indexOf('function scheduleGatewaySyncAfterLauncherAction(');
    const snapshotStart = mainSrc.indexOf('async function buildCurrentDesktopWelcomeSnapshot(', sideEffectStart);
    expect(sideEffectStart).toBeGreaterThanOrEqual(0);
    expect(snapshotStart).toBeGreaterThan(sideEffectStart);
    const sideEffectSrc = mainSrc.slice(sideEffectStart, snapshotStart);

    expect(sideEffectSrc).not.toContain("case 'stop_gateway':");
    expect(sideEffectSrc).not.toContain('gatewaySyncStateByID.delete(gatewayID);\n        gatewayDiagnosisByID.delete(gatewayID);\n        broadcastDesktopWelcomeSnapshots();');
  });

  it('plans Gateway service actions in the same order as the real host lifecycle', () => {
    const mainSrc = readMainSource();
    const helperStart = mainSrc.indexOf('function gatewayServiceInitialStepIDs(');
    const helperEnd = mainSrc.indexOf('function buildGatewayServiceLifecycleProgress(', helperStart);
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperSrc = mainSrc.slice(helperStart, helperEnd);

    expect(helperSrc).toContain("if (operation === 'restart') {");
    expect(helperSrc).toContain("'stopping_gateway_service',\n      'verifying_gateway_stopped',\n      'starting_gateway_service'");
    expect(helperSrc).toContain("if (operation === 'update') {");
    expect(helperSrc).toContain("'stopping_gateway_service',\n      'verifying_gateway_stopped',\n      'preparing_gateway_package',\n      'installing_gateway_package'");
    expect(helperSrc).toContain("'gateway_service_up_to_date'");
    expect(helperSrc).toContain("'starting_gateway_service',\n    'opening_gateway_bridge',\n    'checking_gateway_service',\n    'gateway_service_ready'");
  });

  it('keeps Gateway start-required failures specific enough for recovery popovers', () => {
    const mainSrc = readMainSource();
    const failureStart = mainSrc.indexOf('function gatewayStartRequiredFailure(');
    const failureEnd = mainSrc.indexOf('function gatewayLauncherFailureFromError(', failureStart);
    expect(failureStart).toBeGreaterThanOrEqual(0);
    expect(failureEnd).toBeGreaterThan(failureStart);
    const failureSrc = mainSrc.slice(failureStart, failureEnd);

    expect(failureSrc).toContain('const failure = desktopOperationFailurePresentation({');
    expect(failureSrc).toContain("title: 'Gateway is stopped'");
    expect(failureSrc).toContain("titleKey: 'environmentCenter.gatewayGuidanceStoppedTitle'");
    expect(failureSrc).toContain("detailKey: 'environmentCenter.gatewayPanelStartToSyncDetail'");
    expect(failureSrc).not.toContain('targetLabel');
    expect(failureSrc).toContain('failure,');
  });

  it('opens Gateway environments only through Gateway open-session without provider fallback', () => {
    const mainSrc = readMainSource();
    const openStart = mainSrc.indexOf('async function openGatewayEnvironmentFromLauncher(');
    const providerStart = mainSrc.indexOf('async function openProviderRemoteEnvironmentRecord(', openStart);
    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(providerStart).toBeGreaterThan(openStart);
    const openSrc = mainSrc.slice(openStart, providerStart);

    expect(openSrc).toContain('const capabilityFailure = await requireGatewayEnvironmentOpenCapability(record, request, {');
    expect(openSrc).toContain('onGatewayServiceProgress: lifecycleContext?.onProgress,');
    expect(openSrc).toContain('return finishGatewayOpenCapabilityFailure(operationKey, record, request, operationTargetID, capabilityFailure);');
    expect(openSrc).toContain('const clientNonce = crypto.randomBytes(24).toString(\'base64url\');');
    expect(openSrc).toContain('const issued = await gatewayLifecycleManager().openSessionWithBridge(record, {');
    expect(openSrc).toContain("requested_capability: 'env_app'");
    expect(openSrc).toContain('if (error instanceof GatewayServiceStartRequiredError || error instanceof GatewayNotManageableError) {');
    expect(openSrc).toContain("next_actions: gatewayOperationFailureNextActions(operationKey, {");
    expect(openSrc).toContain("return gatewayLauncherFailureFromError(error, record, 'open_gateway_environment', {");
    expect(openSrc).toContain('const artifactURL = gatewaySessionArtifactURL(record, response, bridgeSession);');
    expect(openSrc).toContain('buildGatewayDesktopTarget({');
    expect(openSrc).toContain('gatewaySessionID: response.gateway_session_id');
    expect(openSrc).toContain('gatewayManagedSessionStartup(artifactURL)');
    expect(openSrc).toContain('const sessionRecord = await createSessionRecord(openTarget, startup, {');
    expect(openSrc).toContain("location: 'runtime_gateway'");
    expect(openSrc).not.toContain('cookies.set(');
    expect(openSrc).not.toContain('installGatewayLocalAccessCookies');
    expect(openSrc).not.toContain('openRemoteEnvironmentFromLauncher');
    expect(openSrc).not.toContain('openProviderEnvironmentFromLauncher');
    expect(openSrc).not.toContain('openProviderEnvironmentWithOpenSession');
    expect(openSrc).not.toContain('openProviderRemoteEnvironmentRecord');
    expect(openSrc).toContain('const operationKey = `${operationTargetID}:open:${clientNonce}`;');
    expect(openSrc.indexOf('const artifactURL = gatewaySessionArtifactURL(record, response, bridgeSession);')).toBeLessThan(
      openSrc.indexOf('const sessionRecord = await createSessionRecord(openTarget, startup'),
    );
    expect(openSrc.indexOf('const openTarget = buildGatewayDesktopTarget({')).toBeGreaterThan(
      openSrc.indexOf('const artifactURL = gatewaySessionArtifactURL(record, response, bridgeSession);'),
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
