import {
  runtimeServiceAllowsOpenAttempt,
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
  | 'blocked_runtime';

export type DesktopLocalRuntimeObservation = Readonly<{
  local_ui_url?: string;
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
  runtime_url?: string;
  message: string;
}>;

export type DesktopLocalRuntimeProviderBinding = Readonly<{
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
  access_point_origin: string;
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
    && compact(binding.env_public_id) === compact(expected?.env_public_id)
    && compact(binding.access_point_origin) === compact(expected?.access_point_origin),
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
): DesktopLocalRuntimeOpenPlan {
  const runtimeURL = compact(runtime?.local_ui_url);
  const runtimeRunning = runtimeURL !== '';
  const desktopCanManage = true;
  const runtimeMatchesTarget = true;
  const requiresBootstrap = false;
  const runtimeService = runtime?.runtime_service;

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

  if (runtimeMatchesTarget && runtimeServiceAllowsOpenAttempt(runtimeService)) {
    const readinessState = runtimeService?.open_readiness?.state;
    return plan({
      target,
      state: readinessState === 'openable'
        ? 'openable'
        : readinessState === 'starting'
          ? 'starting'
          : 'openable',
      runtimeRunning,
      runtimeMatchesTarget,
      desktopCanManage,
      canOpen: true,
      canPrepare: false,
      requiresBootstrap,
      requiresRestart: false,
      requiresConfirmation: false,
      runtimeURL,
      message: readinessState === 'openable'
        ? 'Runtime is ready to open.'
        : readinessState === 'starting'
          ? runtimeService?.open_readiness?.message || 'Desktop will wait for the Environment App to finish preparing.'
          : 'Desktop will try opening this runtime and report upgrade guidance if the runtime rejects the connection.',
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
