import {
  runtimeServiceHasActiveWork,
  runtimeServiceIsOpenable,
  runtimeServiceMatchesIdentity,
  runtimeServiceNeedsRuntimeUpdate,
  type RuntimeServiceIdentity,
  type RuntimeServiceProviderLinkBinding,
  type RuntimeServiceSnapshot,
} from './runtimeService';

export type DesktopLocalRuntimeTarget = Readonly<{
  kind: 'local_environment';
}>;

export type DesktopLocalRuntimeOpenPlanState =
  | 'not_running'
  | 'openable'
  | 'starting'
  | 'restart_to_reclaim'
  | 'restart_to_update'
  | 'blocked_active_work'
  | 'blocked_external_runtime'
  | 'blocked_runtime';

export type DesktopLocalRuntimeObservation = Readonly<{
  local_ui_url?: string;
  desktop_managed?: boolean;
  desktop_owner_id?: string;
  desktop_ownership?: DesktopLocalRuntimeOwnership;
  controlplane_base_url?: string;
  controlplane_provider_id?: string;
  env_public_id?: string;
  runtime_service?: RuntimeServiceSnapshot;
}>;

export type DesktopLocalRuntimeOwnership =
  | 'owned'
  | 'managed_elsewhere'
  | 'legacy_unleased'
  | 'external';

export type DesktopLocalRuntimeOpenPlan = Readonly<{
  target: DesktopLocalRuntimeTarget;
  state: DesktopLocalRuntimeOpenPlanState;
  runtime_running: boolean;
  runtime_matches_target: boolean;
  desktop_can_manage: boolean;
  can_open: boolean;
  can_prepare: boolean;
  requires_bootstrap: boolean;
  requires_restart: boolean;
  requires_confirmation: boolean;
  runtime_url?: string;
  message: string;
}>;

export type DesktopLocalRuntimeProviderBinding = Readonly<{
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function desktopRuntimeProviderBindingMatches(
  binding: RuntimeServiceProviderLinkBinding | null | undefined,
  expected: Readonly<Partial<DesktopLocalRuntimeProviderBinding>> | null | undefined,
): boolean {
  return Boolean(
    binding?.state === 'linked'
    && compact(binding.provider_origin) === compact(expected?.provider_origin)
    && compact(binding.provider_id) === compact(expected?.provider_id)
    && compact(binding.env_public_id) === compact(expected?.env_public_id),
  );
}

function desktopLocalRuntimeOwnership(
  runtime: DesktopLocalRuntimeObservation | null | undefined,
  desktopOwnerID: string | undefined,
): DesktopLocalRuntimeOwnership {
  const declared = compact(runtime?.desktop_ownership);
  if (declared === 'owned' || declared === 'managed_elsewhere' || declared === 'legacy_unleased' || declared === 'external') {
    return declared;
  }
  if (runtime?.desktop_managed !== true) {
    return 'external';
  }
  const expectedOwnerID = compact(desktopOwnerID);
  const observedOwnerID = compact(runtime.desktop_owner_id);
  if (expectedOwnerID !== '' && observedOwnerID !== '' && expectedOwnerID === observedOwnerID) {
    return 'owned';
  }
  return observedOwnerID === '' ? 'legacy_unleased' : 'managed_elsewhere';
}

function plan(
  input: Readonly<{
    target: DesktopLocalRuntimeTarget;
    state: DesktopLocalRuntimeOpenPlanState;
    runtimeRunning: boolean;
    runtimeMatchesTarget: boolean;
    desktopCanManage: boolean;
    canOpen: boolean;
    canPrepare: boolean;
    requiresBootstrap: boolean;
    requiresRestart: boolean;
    requiresConfirmation: boolean;
    runtimeURL?: string;
    message: string;
  }>,
): DesktopLocalRuntimeOpenPlan {
  return {
    target: input.target,
    state: input.state,
    runtime_running: input.runtimeRunning,
    runtime_matches_target: input.runtimeMatchesTarget,
    desktop_can_manage: input.desktopCanManage,
    can_open: input.canOpen,
    can_prepare: input.canPrepare,
    requires_bootstrap: input.requiresBootstrap,
    requires_restart: input.requiresRestart,
    requires_confirmation: input.requiresConfirmation,
    ...(input.runtimeURL ? { runtime_url: input.runtimeURL } : {}),
    message: input.message,
  };
}

export function buildDesktopLocalRuntimeOpenPlan(
  target: DesktopLocalRuntimeTarget,
  runtime: DesktopLocalRuntimeObservation | null | undefined,
  options: Readonly<{
    desktopOwnerID?: string;
    expectedRuntimeIdentity?: RuntimeServiceIdentity | null;
  }> = {},
): DesktopLocalRuntimeOpenPlan {
  const runtimeURL = compact(runtime?.local_ui_url);
  const runtimeRunning = runtimeURL !== '';
  const runtimeOwnership = desktopLocalRuntimeOwnership(runtime, options.desktopOwnerID);
  const desktopCanManage = runtimeOwnership === 'owned' || runtimeOwnership === 'legacy_unleased';
  const runtimeMatchesTarget = true;
  const requiresBootstrap = false;
  const runtimeService = runtime?.runtime_service;
  const runtimeNeedsUpdate = !runtimeService
    || runtimeServiceNeedsRuntimeUpdate(runtimeService)
    || !runtimeServiceMatchesIdentity(runtimeService, options.expectedRuntimeIdentity);
  const runtimeHasActiveWork = runtimeServiceHasActiveWork(runtimeService);

  if (!runtimeRunning) {
    return plan({
      target,
      state: 'not_running',
      runtimeRunning,
      runtimeMatchesTarget: false,
      desktopCanManage: true,
      canOpen: target.kind === 'local_environment',
      canPrepare: true,
      requiresBootstrap,
      requiresRestart: false,
      requiresConfirmation: false,
      message: 'Desktop will start the Local Runtime before opening the Local Environment.',
    });
  }

  if (runtimeOwnership === 'managed_elsewhere') {
    return plan({
      target,
      state: 'blocked_external_runtime',
      runtimeRunning,
      runtimeMatchesTarget,
      desktopCanManage: false,
      canOpen: false,
      canPrepare: false,
      requiresBootstrap,
      requiresRestart: true,
      requiresConfirmation: false,
      runtimeURL,
      message: 'This Desktop-managed Local Runtime is owned by another Desktop instance. Stop that runtime from its owner, then refresh status.',
    });
  }

  if (runtimeOwnership === 'legacy_unleased') {
    if (runtimeHasActiveWork) {
      return plan({
        target,
        state: 'blocked_active_work',
        runtimeRunning,
        runtimeMatchesTarget,
        desktopCanManage,
        canOpen: false,
        canPrepare: false,
        requiresBootstrap,
        requiresRestart: true,
        requiresConfirmation: true,
        runtimeURL,
        message: 'This older Desktop-managed runtime needs to be restarted before Desktop can own it. Close active runtime work before restarting.',
      });
    }
    return plan({
      target,
      state: 'restart_to_reclaim',
      runtimeRunning,
      runtimeMatchesTarget,
      desktopCanManage,
      canOpen: true,
      canPrepare: true,
      requiresBootstrap,
      requiresRestart: true,
      requiresConfirmation: false,
      runtimeURL,
      message: 'Desktop will restart the Local Runtime before opening.',
    });
  }

  if (runtimeMatchesTarget && !runtimeNeedsUpdate && runtimeServiceIsOpenable(runtimeService)) {
    return plan({
      target,
      state: 'openable',
      runtimeRunning,
      runtimeMatchesTarget,
      desktopCanManage,
      canOpen: true,
      canPrepare: false,
      requiresBootstrap,
      requiresRestart: false,
      requiresConfirmation: false,
      runtimeURL,
      message: 'Runtime is ready to open.',
    });
  }

  if (runtimeNeedsUpdate) {
    if (!desktopCanManage) {
      return plan({
        target,
        state: 'blocked_external_runtime',
        runtimeRunning,
        runtimeMatchesTarget,
        desktopCanManage,
        canOpen: false,
        canPrepare: false,
        requiresBootstrap,
        requiresRestart: true,
        requiresConfirmation: false,
        runtimeURL,
        message: 'This runtime needs an update, but it is not managed by Desktop. Restart it from its owner, then refresh status.',
      });
    }
    if (runtimeHasActiveWork) {
      return plan({
        target,
        state: 'blocked_active_work',
        runtimeRunning,
        runtimeMatchesTarget,
        desktopCanManage,
        canOpen: false,
        canPrepare: false,
        requiresBootstrap,
        requiresRestart: true,
        requiresConfirmation: true,
        runtimeURL,
        message: 'This runtime needs an update, but active work is still running. Close or stop that work before restarting the runtime.',
      });
    }
    return plan({
      target,
      state: 'restart_to_update',
      runtimeRunning,
      runtimeMatchesTarget,
      desktopCanManage,
      canOpen: true,
      canPrepare: true,
      requiresBootstrap,
      requiresRestart: true,
      requiresConfirmation: false,
      runtimeURL,
      message: 'Desktop will restart the Local Runtime with the bundled update before opening.',
    });
  }

  if (runtimeService?.open_readiness?.state === 'starting') {
    return plan({
      target,
      state: 'starting',
      runtimeRunning,
      runtimeMatchesTarget,
      desktopCanManage,
      canOpen: false,
      canPrepare: false,
      requiresBootstrap,
      requiresRestart: false,
      requiresConfirmation: false,
      runtimeURL,
      message: runtimeService.open_readiness.message || 'Runtime is preparing the Environment App.',
    });
  }

  return plan({
    target,
    state: 'blocked_runtime',
    runtimeRunning,
    runtimeMatchesTarget,
    desktopCanManage,
    canOpen: false,
    canPrepare: false,
    requiresBootstrap,
    requiresRestart: false,
    requiresConfirmation: false,
    runtimeURL,
    message: runtimeService?.open_readiness?.message || 'Runtime cannot open this Environment yet.',
  });
}
