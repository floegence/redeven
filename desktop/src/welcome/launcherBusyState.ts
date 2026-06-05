import type { DesktopLauncherActionProgress, DesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';

export type RuntimeProgressEnvironmentMatch = Pick<
  DesktopEnvironmentEntry,
  'id' | 'managed_runtime_target_id' | 'managed_runtime_placement_target_id' | 'provider_runtime_link_target'
>;

export type BusyAction =
  | ''
  | 'open_local_environment'
  | 'open_provider_environment'
  | 'open_gateway_environment'
  | 'open_remote_environment'
  | 'open_ssh_environment'
  | 'prepare_environment_open'
  | 'start_environment_runtime'
  | 'restart_environment_runtime'
  | 'update_environment_runtime'
  | 'manage_desktop_update'
  | 'connect_provider_runtime'
  | 'disconnect_provider_runtime'
  | 'stop_environment_runtime'
  | 'refresh_environment_runtime'
  | 'refresh_all_environment_runtimes'
  | 'start_control_plane_connect'
  | 'open_flower_host'
  | 'open_environment_center'
  | 'focus_environment_window'
  | 'open_environment_settings'
  | 'refresh_control_plane'
  | 'upsert_gateway'
  | 'refresh_gateway'
  | 'check_gateway'
  | 'pair_gateway'
  | 'sync_gateway'
  | 'set_gateway_enabled'
  | 'start_gateway'
  | 'stop_gateway'
  | 'restart_gateway'
  | 'update_gateway'
  | 'refresh_gateway_status'
  | 'refresh_gateway_catalog'
  | 'delete_gateway'
  | 'upsert_gateway_environment_profile'
  | 'delete_gateway_environment_profile'
  | 'run_gateway_environment_lifecycle'
  | 'set_local_environment_pinned'
  | 'set_provider_environment_pinned'
  | 'set_saved_environment_pinned'
  | 'set_saved_ssh_environment_pinned'
  | 'set_saved_runtime_target_pinned'
  | 'delete_control_plane'
  | 'cancel_launcher_operation'
  | 'dismiss_launcher_operation'
  | 'close_launcher_or_quit'
  | 'save_local_environment_settings'
  | 'save_settings'
  | 'save_environment'
  | 'delete_environment';

export type DesktopLauncherBusyState = Readonly<{
  action: BusyAction;
  environment_id: string;
  provider_origin: string;
  provider_id: string;
  gateway_id: string;
  request_started_at_unix_ms: number;
  progress: DesktopLauncherActionProgress | null;
}>;

export const IDLE_LAUNCHER_BUSY_STATE: DesktopLauncherBusyState = {
  action: '',
  environment_id: '',
  provider_origin: '',
  provider_id: '',
  gateway_id: '',
  request_started_at_unix_ms: 0,
  progress: null,
};

function requestTimestamp(): number {
  return Date.now();
}

export function busyStateForLauncherRequest(
  request: DesktopLauncherActionRequest,
): DesktopLauncherBusyState {
  const requestStartedAt = requestTimestamp();
  const withRequestTimestamp = (
    state: Omit<DesktopLauncherBusyState, 'request_started_at_unix_ms'>,
  ): DesktopLauncherBusyState => ({
    ...state,
    request_started_at_unix_ms: requestStartedAt,
  });
  switch (request.kind) {
    case 'save_local_environment_settings':
      return withRequestTimestamp({
        action: 'save_settings',
        environment_id: '',
        provider_origin: '',
        provider_id: '',
        gateway_id: '',
        progress: null,
      });
    case 'upsert_saved_environment':
    case 'upsert_saved_ssh_environment':
    case 'upsert_saved_runtime_target':
      return withRequestTimestamp({
        action: 'save_environment',
        environment_id: request.environment_id ?? '',
        provider_origin: '',
        provider_id: '',
        gateway_id: '',
        progress: null,
      });
    case 'delete_saved_environment':
    case 'delete_saved_ssh_environment':
    case 'delete_saved_runtime_target':
      return withRequestTimestamp({
        action: 'delete_environment',
        environment_id: request.environment_id,
        provider_origin: '',
        provider_id: '',
        gateway_id: '',
        progress: null,
      });
    case 'refresh_control_plane':
    case 'delete_control_plane':
      return withRequestTimestamp({
        action: request.kind,
        environment_id: '',
        provider_origin: request.provider_origin,
        provider_id: request.provider_id,
        gateway_id: '',
        progress: null,
      });
    case 'cancel_launcher_operation':
    case 'dismiss_launcher_operation':
      return withRequestTimestamp({
        action: request.kind,
        environment_id: '',
        provider_origin: '',
        provider_id: '',
        gateway_id: '',
        progress: null,
      });
    case 'start_control_plane_connect':
      return withRequestTimestamp({
        action: request.kind,
        environment_id: '',
        provider_origin: request.provider_origin,
        provider_id: '',
        gateway_id: '',
        progress: null,
      });
    default:
      return withRequestTimestamp({
        action: request.kind,
        environment_id: 'environment_id' in request ? request.environment_id ?? '' : '',
        provider_origin: '',
        provider_id: '',
        gateway_id: 'gateway_id' in request ? request.gateway_id ?? '' : '',
        progress: null,
      });
  }
}

export function busyStateWithActionProgress(
  state: DesktopLauncherBusyState,
  progress: DesktopLauncherActionProgress,
): DesktopLauncherBusyState {
  if (state.action !== progress.action) {
    return state;
  }
  if (state.gateway_id !== '' && !gatewayMatchesActionProgress(state.gateway_id, progress)) {
    return state;
  }
  const progressEnvironmentID = String(progress.environment_id ?? '').trim();
  if (state.environment_id !== '' && progressEnvironmentID !== '' && state.environment_id !== progressEnvironmentID) {
    return state;
  }
  return {
    ...state,
    progress,
  };
}

export function reconcileBusyStateWithActionProgressSnapshot(
  state: DesktopLauncherBusyState,
  progressItems: readonly DesktopLauncherActionProgress[],
): DesktopLauncherBusyState {
  if (!state.progress) {
    const snapshotOwnsBusyRequest = progressItems.some((progress) => (
      busyStateMatchesActionProgress(state, progress)
      && launcherProgressStartedAt(progress) >= state.request_started_at_unix_ms
    ));
    return snapshotOwnsBusyRequest ? IDLE_LAUNCHER_BUSY_STATE : state;
  }
  const busyProgress = state.progress;
  const busyOwnerKey = launcherProgressOwnerKey(busyProgress);
  const busyStartedAt = launcherProgressStartedAt(busyProgress);
  const snapshotOwnsBusySurface = progressItems.some((progress) => (
    launcherProgressOwnerKey(progress) === busyOwnerKey
    && (
      launcherProgressIdentity(progress) === launcherProgressIdentity(busyProgress)
      || launcherProgressStartedAt(progress) >= Math.max(busyStartedAt, state.request_started_at_unix_ms)
    )
  ));
  return snapshotOwnsBusySurface ? IDLE_LAUNCHER_BUSY_STATE : state;
}

export function environmentMatchesActionProgress(
  environmentID: string,
  progress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  if (!progress) {
    return false;
  }
  const cleanEnvironmentID = String(environmentID ?? '').trim();
  const progressEnvironmentID = String(progress.environment_id ?? '').trim();
  const operationKey = String(progress.operation_key ?? '').trim();
  return cleanEnvironmentID !== '' && (
    progressEnvironmentID === cleanEnvironmentID
    || String(progress.subject_id ?? '').trim() === cleanEnvironmentID
    || operationKey === cleanEnvironmentID
  );
}

function environmentRuntimeProgressIDs(environment: RuntimeProgressEnvironmentMatch): readonly string[] {
  return [
    environment.id,
    environment.managed_runtime_target_id,
    environment.managed_runtime_placement_target_id,
    environment.provider_runtime_link_target?.runtime_key,
  ]
    .map((value) => String(value ?? '').trim())
    .filter((value, index, values) => value !== '' && values.indexOf(value) === index);
}

export function environmentMatchesRuntimeLifecycleProgress(
  environment: RuntimeProgressEnvironmentMatch,
  progress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  if (!progress?.lifecycle_progress) {
    return false;
  }
  const progressIDs = [
    progress.environment_id,
    progress.subject_id,
    progress.operation_key,
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
  return environmentRuntimeProgressIDs(environment).some((environmentID) => progressIDs.includes(environmentID));
}

export function environmentMatchesOpenConnectionProgress(
  environment: RuntimeProgressEnvironmentMatch,
  progress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  if (!progress?.open_progress) {
    return false;
  }
  const progressIDs = [
    progress.open_progress.environment_id,
    progress.open_progress.target_id,
    progress.environment_id,
    progress.subject_id,
    progress.operation_key,
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
  return environmentRuntimeProgressIDs(environment).some((environmentID) => progressIDs.includes(environmentID));
}

export function gatewayMatchesActionProgress(
  gatewayID: string,
  progress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  if (!progress) {
    return false;
  }
  const cleanGatewayID = String(gatewayID ?? '').trim();
  if (cleanGatewayID === '') {
    return false;
  }
  const progressSubjectID = String(progress.subject_id ?? '').trim();
  const progressGatewayID = String(progress.gateway_id ?? '').trim();
  return progress.subject_kind === 'gateway' && (progressSubjectID === cleanGatewayID || progressGatewayID === cleanGatewayID);
}

export function gatewayMatchesRuntimeLifecycleProgress(
  gatewayID: string,
  progress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  return Boolean(progress?.lifecycle_progress) && gatewayMatchesActionProgress(gatewayID, progress);
}

export function gatewayMatchesWorkflowProgress(
  gatewayID: string,
  progress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  return (
    Boolean(progress?.lifecycle_progress)
    || Boolean(progress?.step_progress)
  ) && gatewayMatchesActionProgress(gatewayID, progress);
}

export function gatewaySourceMatchesRuntimeLifecycleProgress(
  gatewayID: string,
  progress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  if (!gatewayMatchesWorkflowProgress(gatewayID, progress)) {
    return false;
  }
  switch (progress?.action) {
    case 'refresh_gateway':
    case 'check_gateway':
    case 'sync_gateway':
    case 'pair_gateway':
    case 'start_gateway':
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
    case 'refresh_gateway_catalog':
    case 'refresh_gateway_status':
      return true;
    default:
      return false;
  }
}

export function busyStateMatchesActionProgress(
  state: DesktopLauncherBusyState,
  progress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  if (!progress || state.action !== progress.action) {
    return false;
  }
  if (state.gateway_id !== '') {
    return gatewayMatchesActionProgress(state.gateway_id, progress);
  }
  if (state.environment_id === '') {
    return false;
  }
  return environmentMatchesActionProgress(state.environment_id, progress);
}

export function launcherProgressBlocksPrimaryAction(
  progress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  return launcherProgressActivity(progress) === 'active';
}

export function busyStateBlocksEnvironmentAction(
  busyState: DesktopLauncherBusyState,
  environmentID: string,
  actions: readonly BusyAction[],
  selectedProgress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  if (!busyStateMatchesEnvironment(busyState, environmentID, actions)) {
    return false;
  }
  if (!busyState.progress) {
    return true;
  }
  if (
    selectedProgress
    && actions.some((action) => action === selectedProgress.action)
    && environmentMatchesActionProgress(environmentID, selectedProgress)
    && launcherProgressOwnsSameSurface(selectedProgress, busyState.progress)
    && launcherProgressActivity(selectedProgress) !== 'active'
    && (
      launcherProgressIdentity(selectedProgress) === launcherProgressIdentity(busyState.progress)
      || launcherProgressActivity(busyState.progress) !== 'active'
    )
  ) {
    return false;
  }
  return launcherProgressBlocksPrimaryAction(busyState.progress)
    || launcherProgressActivity(busyState.progress) === 'unknown';
}

export function selectedSnapshotRuntimeLifecycleProgressForEnvironment(
  environment: DesktopEnvironmentEntry,
  progressItems: readonly DesktopLauncherActionProgress[],
): DesktopLauncherActionProgress | null {
  return selectLauncherProgress(
    progressItems,
    (progress) => environmentMatchesRuntimeLifecycleProgress(environment, progress),
  );
}

export function selectedSnapshotOpenConnectionProgressForEnvironment(
  environment: DesktopEnvironmentEntry,
  progressItems: readonly DesktopLauncherActionProgress[],
): DesktopLauncherActionProgress | null {
  return selectLauncherProgress(
    progressItems,
    (progress) => environmentMatchesOpenConnectionProgress(environment, progress),
  );
}

export function selectedSnapshotRuntimeLifecycleProgressForGateway(
  gatewayID: string,
  progressItems: readonly DesktopLauncherActionProgress[],
): DesktopLauncherActionProgress | null {
  return selectLauncherProgress(
    progressItems,
    (progress) => gatewaySourceMatchesRuntimeLifecycleProgress(gatewayID, progress),
  );
}

export function selectedSnapshotGatewayProgress(
  gatewayID: string,
  progressItems: readonly DesktopLauncherActionProgress[],
): DesktopLauncherActionProgress | null {
  return selectLauncherProgress(
    progressItems,
    (progress) => gatewaySourceMatchesRuntimeLifecycleProgress(gatewayID, progress),
  );
}

type LauncherProgressActivity = 'active' | 'attention' | 'released' | 'unknown';

type LauncherProgressCandidate = Readonly<{
  progress: DesktopLauncherActionProgress;
  activity: LauncherProgressActivity;
  identity: string;
  startedAt: number;
  timestamp: number;
}>;

function launcherProgressActivity(
  progress: DesktopLauncherActionProgress | null | undefined,
): LauncherProgressActivity {
  switch (progress?.status) {
    case 'running':
    case 'canceling':
    case 'cleanup_running':
      return 'active';
    case 'failed':
    case 'cleanup_failed':
      return 'attention';
    case 'succeeded':
    case 'canceled':
      return 'released';
    default:
      return 'unknown';
  }
}

function launcherProgressIdentity(progress: DesktopLauncherActionProgress): string {
  const startedAt = launcherProgressStartedAt(progress);
  const attemptKey = startedAt > 0 ? `:started:${startedAt}` : '';
  const operationKey = String(progress.operation_key ?? '').trim();
  if (operationKey !== '') {
    return `operation:${operationKey}${attemptKey}`;
  }
  const action = String(progress.action ?? '').trim();
  const environmentID = String(progress.environment_id ?? progress.open_progress?.environment_id ?? '').trim();
  const subjectID = String(progress.subject_id ?? progress.open_progress?.target_id ?? '').trim();
  return `fallback:${action}:${environmentID}:${subjectID}${attemptKey}`;
}

function launcherProgressOwnerKey(progress: DesktopLauncherActionProgress): string {
  const action = String(progress.action ?? '').trim();
  const environmentID = String(progress.environment_id ?? progress.open_progress?.environment_id ?? '').trim();
  const subjectID = String(progress.subject_id ?? progress.open_progress?.target_id ?? '').trim();
  const operationKey = String(progress.operation_key ?? '').trim();
  const surfaceID = environmentID || subjectID || operationKey;
  return `surface:${action}:${surfaceID}:${subjectID}`;
}

function launcherProgressOwnsSameSurface(
  left: DesktopLauncherActionProgress,
  right: DesktopLauncherActionProgress,
): boolean {
  return launcherProgressOwnerKey(left) === launcherProgressOwnerKey(right);
}

function launcherProgressStartedAt(progress: DesktopLauncherActionProgress): number {
  const startedAt = Number(progress.started_at_unix_ms);
  return Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0;
}

function launcherProgressTimestamp(progress: DesktopLauncherActionProgress): number {
  const updatedAt = Number(progress.updated_at_unix_ms);
  if (Number.isFinite(updatedAt) && updatedAt > 0) {
    return updatedAt;
  }
  return launcherProgressStartedAt(progress);
}

function launcherProgressActivityRank(activity: LauncherProgressActivity): number {
  switch (activity) {
    case 'active':
      return 3;
    case 'attention':
      return 2;
    case 'released':
      return 1;
    default:
      return 0;
  }
}

function sameOperationProgressionRank(activity: LauncherProgressActivity): number {
  switch (activity) {
    case 'attention':
    case 'released':
      return 3;
    case 'active':
      return 2;
    default:
      return 1;
  }
}

function candidateForProgress(
  progress: DesktopLauncherActionProgress,
): LauncherProgressCandidate {
  return {
    progress,
    activity: launcherProgressActivity(progress),
    identity: launcherProgressIdentity(progress),
    startedAt: launcherProgressStartedAt(progress),
    timestamp: launcherProgressTimestamp(progress),
  };
}

function compareSameOperationCandidate(
  left: LauncherProgressCandidate,
  right: LauncherProgressCandidate,
): number {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }
  const leftProgressionRank = sameOperationProgressionRank(left.activity);
  const rightProgressionRank = sameOperationProgressionRank(right.activity);
  if (leftProgressionRank !== rightProgressionRank) {
    return leftProgressionRank - rightProgressionRank;
  }
  return 0;
}

function compareVisibleProgressCandidate(
  left: LauncherProgressCandidate,
  right: LauncherProgressCandidate,
): number {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt - right.startedAt;
  }
  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }
  const leftActivityRank = launcherProgressActivityRank(left.activity);
  const rightActivityRank = launcherProgressActivityRank(right.activity);
  if (leftActivityRank !== rightActivityRank) {
    return leftActivityRank - rightActivityRank;
  }
  return 0;
}

function selectLauncherProgress(
  progressItems: readonly DesktopLauncherActionProgress[],
  matchesProgress: (progress: DesktopLauncherActionProgress) => boolean,
): DesktopLauncherActionProgress | null {
  const candidates: LauncherProgressCandidate[] = [];
  for (const progress of progressItems) {
    if (matchesProgress(progress)) {
      candidates.push(candidateForProgress(progress));
    }
  }
  if (candidates.length === 0) {
    return null;
  }

  const latestByIdentity = new Map<string, LauncherProgressCandidate>();
  for (const candidate of candidates) {
    const current = latestByIdentity.get(candidate.identity);
    if (!current || compareSameOperationCandidate(current, candidate) < 0) {
      latestByIdentity.set(candidate.identity, candidate);
    }
  }

  return [...latestByIdentity.values()]
    .sort((left, right) => compareVisibleProgressCandidate(right, left))[0]?.progress ?? null;
}

export function busyStateMatchesAction(
  state: DesktopLauncherBusyState,
  action: BusyAction,
): boolean {
  return state.action === action;
}

export function busyStateMatchesAnyAction(
  state: DesktopLauncherBusyState,
  actions: readonly BusyAction[],
): boolean {
  return actions.includes(state.action);
}

export function busyStateMatchesEnvironment(
  state: DesktopLauncherBusyState,
  environmentID: string,
  actions?: readonly BusyAction[],
): boolean {
  if (state.environment_id === '' || state.environment_id !== environmentID) {
    return false;
  }
  return actions === undefined ? true : busyStateMatchesAnyAction(state, actions);
}

export function busyStateMatchesControlPlane(
  state: DesktopLauncherBusyState,
  providerOrigin: string,
  providerID: string,
  actions?: readonly BusyAction[],
): boolean {
  if (state.provider_origin === '' || state.provider_origin !== providerOrigin) {
    return false;
  }
  if (providerID !== '' && state.provider_id !== '' && state.provider_id !== providerID) {
    return false;
  }
  return actions === undefined ? true : busyStateMatchesAnyAction(state, actions);
}

export function busyStateMatchesGateway(
  state: DesktopLauncherBusyState,
  gatewayID: string,
  actions?: readonly BusyAction[],
): boolean {
  if (state.gateway_id === '' || state.gateway_id !== gatewayID) {
    return false;
  }
  return actions === undefined ? true : busyStateMatchesAnyAction(state, actions);
}
