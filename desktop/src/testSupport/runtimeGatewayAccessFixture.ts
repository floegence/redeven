import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { buildDesktopRuntimeOperationPlans } from '../shared/desktopRuntimeOperationPlanner';
import { buildDesktopRuntimeMaintenanceRequirement } from '../shared/desktopRuntimeHealth';
import { desktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import { desktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import { RUNTIME_SERVICE_COMPATIBILITY_EPOCH } from '../shared/runtimeService';
import { mixedEnvironmentFixture } from './mixedEnvironmentFixture';

export type GatewayRuntimeFixtureKind = 'local' | 'ssh' | 'wsl' | 'local_container' | 'ssh_container';
export type GatewayRuntimeFixtureState = 'unknown' | 'stopped' | 'control_missing' | 'connection_required' | 'ready' | 'update_required' | 'management_unavailable';

/** Real saved targets and Presence projection; containers retain their direct host owner. */
export function runtimeGatewayAccessFixture(kind: GatewayRuntimeFixtureKind, state: GatewayRuntimeFixtureState = 'ready', startedAtUnixMS?: number) {
  const environmentKind = kind === 'wsl' ? 'wsl_environment' : kind.startsWith('local') ? 'local_environment' : 'ssh_environment';
  const fixture = mixedEnvironmentFixture({ linkKind: environmentKind });
  const original = fixture.snapshot.environments.find(entry => entry.kind === environmentKind)!;
  const sourcePresence = fixture.inputs.managedRuntimePresenceByTargetID[original.provider_runtime_link_target!.id]!;
  const container = kind.endsWith('_container');
  const placement = container ? {
    kind: 'container_process' as const, container_engine: 'docker' as const, container_id: 'gateway-fixture',
    container_ref: 'gateway-fixture', container_label: 'Gateway test container', bridge_strategy: 'exec_stream' as const,
    runtime_root: '/home/dev/.redeven',
  } : sourcePresence.placement;
  const placementID = desktopRuntimeTargetID(sourcePresence.host_access, placement);
  const id = environmentKind === 'local_environment' && !container ? original.id : placementID;
  const targetID = desktopCloudRuntimeLinkTargetID(environmentKind, id);
  const rawPresence = {
    ...sourcePresence, environment_id: id, target_id: targetID, placement_target_id: desktopRuntimeTargetID(sourcePresence.host_access, placement),
    runtime_key: targetID, placement, running: state !== 'stopped', openable: state !== 'stopped',
    started_at_unix_ms: startedAtUnixMS ?? sourcePresence.started_at_unix_ms,
    open_connection_required: state === 'connection_required',
    runtime_control_status: state === 'connection_required' ? { state: 'missing' as const, reason_code: 'forward_unavailable' as const, message: 'Connect the Desktop bridge' } : state === 'stopped' ? { state: 'missing' as const, reason_code: 'not_started' as const, message: 'Stopped Runtime' }
      : state === 'control_missing' ? { state: 'missing' as const, reason_code: 'not_reported' as const, message: 'Control unavailable' }
        : state === 'management_unavailable' ? { state: 'missing' as const, reason_code: 'auth_required' as const, message: 'Credentials required' }
          : { state: 'available' as const },
    maintenance: state === 'update_required' ? buildDesktopRuntimeMaintenanceRequirement({ kind: 'runtime_update_required',
      can_desktop_restart: true, current_runtime_version: 'v1.4.1', target_runtime_version: 'v1.4.2', message: 'Update required' }) : undefined,
    runtime_service: state === 'stopped' ? undefined : { ...sourcePresence.runtime_service!,
      compatibility_epoch: RUNTIME_SERVICE_COMPATIBILITY_EPOCH,
      compatibility: state === 'update_required' ? 'update_required' as const : sourcePresence.runtime_service!.compatibility,
      open_readiness: state === 'update_required' ? { state: 'blocked' as const, reason_code: 'runtime_update_required', message: 'Update required' } : sourcePresence.runtime_service!.open_readiness,
      bindings: { ...sourcePresence.runtime_service!.bindings!, cloud_link: { state: 'unbound' as const, remote_enabled: false } },
      capabilities: { ...sourcePresence.runtime_service!.capabilities!, runtime_gateway: { supported: true, bind_method: 'runtime_control_v2' } },
    },
  };
  const savedTarget = { ...fixture.targets[0], id: placementID, label: original.label, host_access: sourcePresence.host_access, placement };
  const inputs = { ...fixture.inputs, controlPlanes: [],
    preferences: { ...fixture.inputs.preferences,
      saved_runtime_targets: environmentKind === 'local_environment' && !container ? [] : [savedTarget],
    },
    managedRuntimePresenceByTargetID: state === 'unknown' ? {} : {
      [targetID]: { ...rawPresence, operations: buildDesktopRuntimeOperationPlans({ surface: 'managed_runtime_card', ...rawPresence }) },
    },
  };
  const snapshot = buildDesktopWelcomeSnapshot(inputs);
  const environment = snapshot.environments.find(entry => entry.id === id)!;
  return { environment, inputs, presence: inputs.managedRuntimePresenceByTargetID[targetID], snapshot: { ...snapshot, environments: [environment] } };
}
