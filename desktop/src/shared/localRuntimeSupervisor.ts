import { normalizeControlPlaneOrigin } from './controlPlaneProvider';
import {
  runtimeServiceHasActiveWork,
  runtimeServiceIsOpenable,
  runtimeServiceMatchesIdentity,
  runtimeServiceNeedsRuntimeUpdate,
  runtimeServiceProviderLinkBinding,
  type RuntimeServiceIdentity,
  type RuntimeServiceSnapshot,
} from './runtimeService';

export type DesktopLocalRuntimeBinding = Readonly<{
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
}>;

export type DesktopLocalRuntimeTarget = Readonly<
  | {
    kind: 'local_environment';
  }
  | ({
    kind: 'provider_environment';
  } & DesktopLocalRuntimeBinding)
>;

export type DesktopLocalRuntimeOpenPlanState =
  | 'not_running'
  | 'openable'
  | 'starting'
  | 'needs_provider_link'
  | 'linked_elsewhere'
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
  current_binding?: DesktopLocalRuntimeBinding;
  target_binding?: DesktopLocalRuntimeBinding;
  runtime_url?: string;
  message: string;
}>;

export type DesktopProviderPreferredOpenRoute = 'auto' | 'local_host' | 'remote_desktop';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopLocalRuntimeBinding(
  value: Readonly<Partial<DesktopLocalRuntimeBinding>> | null | undefined,
): DesktopLocalRuntimeBinding | null {
  const providerOrigin = compact(value?.provider_origin);
  const providerID = compact(value?.provider_id);
  const envPublicID = compact(value?.env_public_id);
  if (providerOrigin === '' || providerID === '' || envPublicID === '') {
    return null;
  }
  try {
    return {
      provider_origin: normalizeControlPlaneOrigin(providerOrigin),
      provider_id: providerID,
      env_public_id: envPublicID,
    };
  } catch {
    return null;
  }
}

export function desktopLocalRuntimeBindingFromObservation(
  runtime: DesktopLocalRuntimeObservation | null | undefined,
): DesktopLocalRuntimeBinding | null {
  const providerLink = runtimeServiceProviderLinkBinding(runtime?.runtime_service);
  if (providerLink.state === 'linked') {
    return normalizeDesktopLocalRuntimeBinding({
      provider_origin: providerLink.provider_origin,
      provider_id: providerLink.provider_id,
      env_public_id: providerLink.env_public_id,
    });
  }
  return normalizeDesktopLocalRuntimeBinding({
    provider_origin: runtime?.controlplane_base_url,
    provider_id: runtime?.controlplane_provider_id,
    env_public_id: runtime?.env_public_id,
  });
}

export function desktopLocalRuntimeBindingFromTarget(
  target: DesktopLocalRuntimeTarget,
): DesktopLocalRuntimeBinding | null {
  if (target.kind !== 'provider_environment') {
    return null;
  }
  return normalizeDesktopLocalRuntimeBinding(target);
}

export function desktopLocalRuntimeBindingsMatch(
  left: DesktopLocalRuntimeBinding | null | undefined,
  right: DesktopLocalRuntimeBinding | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.provider_origin === right.provider_origin
    && left.provider_id === right.provider_id
    && left.env_public_id === right.env_public_id,
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
    currentBinding?: DesktopLocalRuntimeBinding;
    targetBinding?: DesktopLocalRuntimeBinding;
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
    ...(input.currentBinding ? { current_binding: input.currentBinding } : {}),
    ...(input.targetBinding ? { target_binding: input.targetBinding } : {}),
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
  const currentBinding = desktopLocalRuntimeBindingFromObservation(runtime);
  const targetBinding = desktopLocalRuntimeBindingFromTarget(target);
  const runtimeMatchesTarget = target.kind === 'local_environment'
    ? currentBinding === null
    : desktopLocalRuntimeBindingsMatch(currentBinding, targetBinding);
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
      targetBinding: targetBinding ?? undefined,
      message: target.kind === 'provider_environment'
        ? 'Start the Local Runtime first, then connect it to this provider Environment.'
        : 'Desktop will start the Local Runtime before opening the Local Environment.',
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
      currentBinding: currentBinding ?? undefined,
      targetBinding: targetBinding ?? undefined,
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
        currentBinding: currentBinding ?? undefined,
        targetBinding: targetBinding ?? undefined,
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
      currentBinding: currentBinding ?? undefined,
      targetBinding: targetBinding ?? undefined,
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
      currentBinding: currentBinding ?? undefined,
      targetBinding: targetBinding ?? undefined,
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
        currentBinding: currentBinding ?? undefined,
        targetBinding: targetBinding ?? undefined,
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
        currentBinding: currentBinding ?? undefined,
        targetBinding: targetBinding ?? undefined,
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
      currentBinding: currentBinding ?? undefined,
      targetBinding: targetBinding ?? undefined,
      runtimeURL,
      message: 'Desktop will restart the Local Runtime with the bundled update before opening.',
    });
  }

  if (!runtimeMatchesTarget) {
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
        currentBinding: currentBinding ?? undefined,
        targetBinding: targetBinding ?? undefined,
        runtimeURL,
        message: currentBinding
          ? 'The Local Runtime is managed outside Desktop and linked to another provider Environment.'
          : 'The Local Runtime is managed outside Desktop and is not linked to this provider Environment.',
      });
    }
    if (currentBinding && runtimeHasActiveWork) {
      return plan({
        target,
        state: 'blocked_active_work',
        runtimeRunning,
        runtimeMatchesTarget,
        desktopCanManage,
        canOpen: false,
        canPrepare: false,
        requiresBootstrap,
        requiresRestart: false,
        requiresConfirmation: true,
        currentBinding: currentBinding ?? undefined,
        targetBinding: targetBinding ?? undefined,
        runtimeURL,
        message: 'The Local Runtime has active provider work. Disconnect that work before linking another provider Environment.',
      });
    }
    return plan({
      target,
      state: currentBinding ? 'linked_elsewhere' : 'needs_provider_link',
      runtimeRunning,
      runtimeMatchesTarget,
      desktopCanManage,
      canOpen: false,
      canPrepare: true,
      requiresBootstrap,
      requiresRestart: false,
      requiresConfirmation: false,
      currentBinding: currentBinding ?? undefined,
      targetBinding: targetBinding ?? undefined,
      runtimeURL,
      message: currentBinding
        ? 'Local Runtime is connected to another provider Environment. Disconnect it before connecting this one.'
        : 'Connect Local Runtime to this provider Environment before opening it locally.',
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
      currentBinding: currentBinding ?? undefined,
      targetBinding: targetBinding ?? undefined,
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
    currentBinding: currentBinding ?? undefined,
    targetBinding: targetBinding ?? undefined,
    runtimeURL,
    message: runtimeService?.open_readiness?.message || 'Runtime cannot open this Environment yet.',
  });
}

export function desktopLocalRuntimePlanAllowsAutoLocalOpen(
  plan: DesktopLocalRuntimeOpenPlan,
  preferredOpenRoute: DesktopProviderPreferredOpenRoute | null | undefined,
): boolean {
  return plan.can_open && preferredOpenRoute !== 'remote_desktop';
}
