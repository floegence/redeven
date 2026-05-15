import {
  runtimeServiceHasActiveWork,
  runtimeServiceProviderLinkMatches,
  runtimeServiceSupportsProviderLink,
} from './runtimeService';
import type {
  DesktopProviderEnvironmentCandidate,
  DesktopProviderRuntimeLinkTarget,
  DesktopProviderRuntimeLinkTargetID,
} from './providerRuntimeLinkTarget';

export type DesktopProviderRuntimeLinkPlanState =
  | 'target_ready'
  | 'target_not_running'
  | 'runtime_control_missing'
  | 'provider_link_unsupported'
  | 'linked_but_remote_disabled'
  | 'already_linked'
  | 'provider_environment_occupied'
  | 'linked_elsewhere'
  | 'blocked_active_work'
  | 'blocked_owner_mismatch'
  | 'blocked_runtime';

export type DesktopProviderRuntimeLinkPlan = Readonly<{
  state: DesktopProviderRuntimeLinkPlanState;
  runtime_target_id: DesktopProviderRuntimeLinkTargetID;
  provider_environment_id: string;
  runtime_running: boolean;
  runtime_matches_provider: boolean;
  requires_confirmation: boolean;
  can_connect: boolean;
  can_disconnect: boolean;
  current_binding?: DesktopProviderRuntimeLinkTarget['provider_link_binding'];
  target_binding: Readonly<{
    provider_origin: string;
    provider_id: string;
    env_public_id: string;
  }>;
  message: string;
}>;

function runtimeTargetLabel(target: DesktopProviderRuntimeLinkTarget): string {
  return target.kind === 'ssh_environment' ? 'SSH runtime' : 'Local Runtime';
}

function planMessage(
  state: DesktopProviderRuntimeLinkPlanState,
  target: DesktopProviderRuntimeLinkTarget,
  providerEnvironment: DesktopProviderEnvironmentCandidate,
): string {
  const runtimeLabel = runtimeTargetLabel(target);
  switch (state) {
    case 'target_ready':
      return `${runtimeLabel} is ready to connect to ${providerEnvironment.label}.`;
    case 'target_not_running':
      return `${runtimeLabel} is not running. Start it from this runtime card before connecting it to a provider.`;
    case 'runtime_control_missing':
      return `${runtimeLabel} does not expose Desktop runtime-control. Restart it from Desktop, then connect again.`;
    case 'provider_link_unsupported':
      return `${runtimeLabel} does not support provider linking. Restart it with the current Desktop runtime, then connect again.`;
    case 'linked_but_remote_disabled':
      return `${runtimeLabel} is linked to ${providerEnvironment.label}, but its provider control connection is not enabled in this running process. Connect again to enable it without restarting the runtime.`;
    case 'already_linked':
      return `${runtimeLabel} is already connected to ${providerEnvironment.label}.`;
    case 'provider_environment_occupied':
      return providerEnvironment.occupancy.state === 'occupied_by_known_runtime' && providerEnvironment.occupancy.runtime_label
        ? `${providerEnvironment.label} is already connected to ${providerEnvironment.occupancy.runtime_label}. Disconnect it from that runtime card before connecting another runtime.`
        : `${providerEnvironment.label} already has an online runtime through the provider. Disconnect that runtime before connecting another runtime.`;
    case 'linked_elsewhere':
      return `${runtimeLabel} is connected to another provider Environment. Disconnect it before connecting this provider.`;
    case 'blocked_active_work':
      return `${runtimeLabel} has active provider work. Disconnect or finish that work before changing provider links.`;
    case 'blocked_owner_mismatch':
      return `${runtimeLabel} is owned by another Desktop instance. Manage it from the owning Desktop.`;
    case 'blocked_runtime':
      return `${runtimeLabel} cannot accept provider linking in its current state.`;
  }
}

export function buildDesktopProviderRuntimeLinkPlan(
  runtimeTarget: DesktopProviderRuntimeLinkTarget,
  providerEnvironment: DesktopProviderEnvironmentCandidate,
): DesktopProviderRuntimeLinkPlan {
  const runtimeMatchesProvider = runtimeServiceProviderLinkMatches(runtimeTarget.runtime_service, {
    provider_origin: providerEnvironment.provider_origin,
    provider_id: providerEnvironment.provider_id,
    env_public_id: providerEnvironment.env_public_id,
  });
  const binding = runtimeTarget.provider_link_binding;
  const state: DesktopProviderRuntimeLinkPlanState = (() => {
    if (!runtimeTarget.runtime_running) {
      return 'target_not_running';
    }
    if (runtimeTarget.runtime_control_status.state === 'missing') {
      return 'runtime_control_missing';
    }
    if (runtimeTarget.runtime_control_status.state === 'owner_mismatch') {
      return 'blocked_owner_mismatch';
    }
    if (!runtimeServiceSupportsProviderLink(runtimeTarget.runtime_service)) {
      return 'provider_link_unsupported';
    }
    if (
      providerEnvironment.occupancy.state === 'occupied_by_known_runtime'
      || providerEnvironment.occupancy.state === 'occupied_by_provider_online_runtime'
    ) {
      return 'provider_environment_occupied';
    }
    if (binding?.state === 'linked') {
      // IMPORTANT: A saved provider binding is not proof that this process has
      // enabled the provider control channel. Keep "linked" and "remote enabled"
      // separate so Local/SSH cards can repair local-only processes without
      // giving Provider cards runtime management powers.
      if (runtimeMatchesProvider) {
        return binding.remote_enabled === true
          && runtimeTarget.runtime_service?.remote_enabled === true
          ? 'already_linked'
          : 'linked_but_remote_disabled';
      }
      return runtimeServiceHasActiveWork(runtimeTarget.runtime_service)
          ? 'blocked_active_work'
          : 'linked_elsewhere';
    }
    if (binding?.state === 'linking' || binding?.state === 'disconnecting' || binding?.state === 'error') {
      return 'blocked_runtime';
    }
    return 'target_ready';
  })();

  return {
    state,
    runtime_target_id: runtimeTarget.id,
    provider_environment_id: providerEnvironment.provider_environment_id,
    runtime_running: runtimeTarget.runtime_running,
    runtime_matches_provider: runtimeMatchesProvider,
    requires_confirmation: state === 'target_ready' || state === 'linked_but_remote_disabled' || state === 'already_linked',
    can_connect: state === 'target_ready' || state === 'linked_but_remote_disabled',
    can_disconnect: state === 'already_linked' || state === 'linked_but_remote_disabled',
    ...(binding ? { current_binding: binding } : {}),
    target_binding: {
      provider_origin: providerEnvironment.provider_origin,
      provider_id: providerEnvironment.provider_id,
      env_public_id: providerEnvironment.env_public_id,
    },
    message: planMessage(state, runtimeTarget, providerEnvironment),
  };
}
