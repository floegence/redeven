import {
  runtimeServiceHasActiveWork,
  runtimeServiceCloudLinkMatches,
  runtimeServiceSupportsCloudLink,
} from './runtimeService';
import type {
  DesktopCloudEnvironmentCandidate,
  DesktopCloudRuntimeLinkTarget,
  DesktopCloudRuntimeLinkTargetID,
} from './providerRuntimeLinkTarget';

export type DesktopCloudRuntimeLinkPlanState =
  | 'target_ready'
  | 'target_not_running'
  | 'runtime_control_missing'
  | 'cloud_link_unsupported'
  | 'already_linked'
  | 'renewal_required'
  | 'provider_environment_occupied'
  | 'linked_elsewhere'
  | 'blocked_active_work'
  | 'blocked_runtime';

export type DesktopCloudRuntimeLinkPlan = Readonly<{
  state: DesktopCloudRuntimeLinkPlanState;
  runtime_target_id: DesktopCloudRuntimeLinkTargetID;
  provider_environment_id: string;
  runtime_running: boolean;
  runtime_matches_provider: boolean;
  requires_confirmation: boolean;
  can_connect: boolean;
  can_disconnect: boolean;
  current_binding?: DesktopCloudRuntimeLinkTarget['cloud_link_binding'];
  target_binding: Readonly<{
    cloud_origin: string;
    cloud_id: string;
    env_public_id: string;
    access_point_origin: string;
  }>;
  message: string;
}>;

function runtimeTargetLabel(target: DesktopCloudRuntimeLinkTarget): string {
  return target.kind === 'ssh_environment' ? 'SSH runtime' : 'Local Runtime';
}

function planMessage(
  state: DesktopCloudRuntimeLinkPlanState,
  target: DesktopCloudRuntimeLinkTarget,
  providerEnvironment: DesktopCloudEnvironmentCandidate,
): string {
  const runtimeLabel = runtimeTargetLabel(target);
  switch (state) {
    case 'target_ready':
      return `${runtimeLabel} is ready to connect to ${providerEnvironment.label}.`;
    case 'target_not_running':
      return `${runtimeLabel} is not running. Start it from this Runtime card before connecting it to Redeven Cloud.`;
    case 'runtime_control_missing':
      return `${runtimeLabel} does not expose Desktop runtime-control. Restart it from Desktop, then connect again.`;
    case 'cloud_link_unsupported':
      return `${runtimeLabel} does not support Redeven Cloud linking. Restart it with the current Desktop Runtime, then connect again.`;
    case 'renewal_required':
      return `Restore the saved Redeven Cloud connection for ${runtimeLabel}. Local work remains available.`;
    case 'already_linked':
      return `${runtimeLabel} is already connected to ${providerEnvironment.label}.`;
    case 'provider_environment_occupied':
      return providerEnvironment.occupancy.state === 'occupied_by_known_runtime' && providerEnvironment.occupancy.runtime_label
        ? `${providerEnvironment.label} is already connected to ${providerEnvironment.occupancy.runtime_label}. Disconnect it from that runtime card before connecting another runtime.`
        : `${providerEnvironment.label} already has an online Runtime through Redeven Cloud. Disconnect that Runtime before connecting another Runtime.`;
    case 'linked_elsewhere':
      return `${runtimeLabel} is connected to another Redeven Cloud Environment. Disconnect it before connecting this Environment.`;
    case 'blocked_active_work':
      return `${runtimeLabel} has active Redeven Cloud work. Disconnect or finish that work before changing Redeven Cloud links.`;
    case 'blocked_runtime':
      return `${runtimeLabel} cannot accept Redeven Cloud linking in its current state.`;
  }
}

export function buildDesktopCloudRuntimeLinkPlan(
  runtimeTarget: DesktopCloudRuntimeLinkTarget,
  providerEnvironment: DesktopCloudEnvironmentCandidate,
): DesktopCloudRuntimeLinkPlan {
  const runtimeMatchesProvider = runtimeServiceCloudLinkMatches(runtimeTarget.runtime_service, {
    cloud_origin: providerEnvironment.cloud_origin,
    cloud_id: providerEnvironment.cloud_id,
    env_public_id: providerEnvironment.env_public_id,
    access_point_origin: providerEnvironment.access_point_origin,
  });
  const binding = runtimeTarget.cloud_link_binding;
  const state: DesktopCloudRuntimeLinkPlanState = (() => {
    if (!runtimeTarget.runtime_running) {
      return 'target_not_running';
    }
    if (runtimeTarget.runtime_control_status.state === 'missing') {
      return 'runtime_control_missing';
    }
    if (!runtimeServiceSupportsCloudLink(runtimeTarget.runtime_service)) {
      return 'cloud_link_unsupported';
    }
    if (
      providerEnvironment.occupancy.state === 'occupied_by_known_runtime'
      || providerEnvironment.occupancy.state === 'occupied_by_provider_online_runtime'
    ) {
      return 'provider_environment_occupied';
    }
    if (binding?.state === 'linked') {
      if (runtimeMatchesProvider) {
        if (runtimeTarget.provider_connection_state === 'connected') return 'already_linked';
        return runtimeTarget.provider_connection_state === 'authorization_required'
          || runtimeTarget.provider_connection_state === 'disabled'
          || runtimeTarget.provider_connection_state === 'error'
          ? 'renewal_required' : 'blocked_runtime';
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
    requires_confirmation: state === 'target_ready' || state === 'already_linked' || state === 'renewal_required',
    can_connect: state === 'target_ready' || state === 'renewal_required',
    can_disconnect: state === 'already_linked' || state === 'renewal_required',
    ...(binding ? { current_binding: binding } : {}),
    target_binding: {
      cloud_origin: providerEnvironment.cloud_origin,
      cloud_id: providerEnvironment.cloud_id,
      env_public_id: providerEnvironment.env_public_id,
      access_point_origin: providerEnvironment.access_point_origin,
    },
    message: planMessage(state, runtimeTarget, providerEnvironment),
  };
}
