import { normalizeControlPlaneOrigin } from './controlPlaneProvider';
import {
  runtimeServiceHasActiveWork,
  runtimeServiceIsOpenable,
  runtimeServiceNeedsRuntimeUpdate,
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
  | 'restart_to_bind'
  | 'restart_to_update'
  | 'blocked_active_work'
  | 'blocked_external_runtime'
  | 'blocked_runtime';

export type DesktopLocalRuntimeObservation = Readonly<{
  local_ui_url?: string;
  desktop_managed?: boolean;
  controlplane_base_url?: string;
  controlplane_provider_id?: string;
  env_public_id?: string;
  runtime_service?: RuntimeServiceSnapshot;
}>;

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
): DesktopLocalRuntimeOpenPlan {
  const runtimeURL = compact(runtime?.local_ui_url);
  const runtimeRunning = runtimeURL !== '';
  const desktopCanManage = runtime?.desktop_managed === true;
  const currentBinding = desktopLocalRuntimeBindingFromObservation(runtime);
  const targetBinding = desktopLocalRuntimeBindingFromTarget(target);
  const runtimeMatchesTarget = target.kind === 'local_environment'
    ? currentBinding === null
    : desktopLocalRuntimeBindingsMatch(currentBinding, targetBinding);
  const requiresBootstrap = target.kind === 'provider_environment';
  const runtimeService = runtime?.runtime_service;
  const runtimeNeedsUpdate = !runtimeService || runtimeServiceNeedsRuntimeUpdate(runtimeService);
  const runtimeHasActiveWork = runtimeServiceHasActiveWork(runtimeService);

  if (!runtimeRunning) {
    return plan({
      target,
      state: 'not_running',
      runtimeRunning,
      runtimeMatchesTarget: false,
      desktopCanManage: true,
      canOpen: true,
      canPrepare: true,
      requiresBootstrap,
      requiresRestart: false,
      requiresConfirmation: false,
      targetBinding: targetBinding ?? undefined,
      message: requiresBootstrap
        ? 'Desktop will start the Local Runtime with this provider Environment before opening it.'
        : 'Desktop will start the Local Runtime before opening the Local Environment.',
    });
  }

  if (runtimeMatchesTarget && runtimeServiceIsOpenable(runtimeService)) {
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
        message: 'The Local Runtime is busy. Close active runtime work before Desktop relinks it to this provider Environment.',
      });
    }
    return plan({
      target,
      state: 'restart_to_bind',
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
      message: 'Desktop will restart the singleton Local Runtime for this provider Environment before opening.',
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
