import type { DesktopEnvironmentEntry } from './desktopLauncherIPC';
import type { DesktopRuntimeOperation } from './desktopRuntimeOperations';
import { runtimeServiceNeedsRuntimeUpdate, runtimeServiceSupportsRuntimeGateway } from './runtimeService';

export type RuntimeGatewayRecovery = Extract<DesktopRuntimeOperation, 'start' | 'restart' | 'update' | 'refresh'>;
export type RuntimeGatewayAccessPresentation = Readonly<{
  phase: 'ready' | 'check_required' | 'not_started' | 'control_missing' | 'update_required' | 'management_unavailable' | 'unsupported' | 'busy';
  recovery?: RuntimeGatewayRecovery;
  recovery_enabled: boolean;
}>;

/** A saved direct executor makes enrollment discoverable; only current Presence makes it executable. */
export function runtimeGatewayAccessPresentation(
  environment: DesktopEnvironmentEntry,
  busy = false,
): RuntimeGatewayAccessPresentation | undefined {
  if (!['local_environment', 'ssh_environment', 'wsl_environment'].includes(environment.kind)
    || !environment.managed_runtime_host_access || !environment.managed_runtime_placement) return undefined;
  const state = (phase: RuntimeGatewayAccessPresentation['phase'], recovery?: RuntimeGatewayRecovery): RuntimeGatewayAccessPresentation => ({
    phase, recovery, recovery_enabled: !!recovery && environment.runtime_operations[recovery].availability === 'available',
  });
  if (busy) return state('busy');
  const target = environment.provider_runtime_link_target;
  const control = target?.runtime_control_status;
  const service = environment.runtime_service;
  const health = environment.runtime_health;
  const update = environment.runtime_operations.update;
  if (runtimeServiceNeedsRuntimeUpdate(service) || update.reason_code === 'runtime_update_required' || update.maintenance?.kind === 'runtime_update_required'
    || update.package_state?.state === 'outdated' || update.package_state?.state === 'incompatible') return state('update_required', 'update');
  if (control?.state === 'missing' && ['auth_required', 'unverified', 'container_engine_unavailable', 'forward_unavailable', 'reinstall_required'].includes(control.reason_code)) {
    return state('management_unavailable', 'refresh');
  }
  if (health.freshness === 'checking' || !service && (health.freshness === 'unknown' || !health.checked_at_unix_ms)) {
    return state('check_required', 'refresh');
  }
  if (health.status === 'offline' && health.offline_reason_code && !['not_started', 'container_not_running'].includes(health.offline_reason_code)) {
    return state('management_unavailable', 'refresh');
  }
  if (control?.state === 'missing' && ['not_started', 'container_not_running'].includes(control.reason_code)) return state('not_started', 'start');
  if (!target?.runtime_running || environment.runtime_health.status !== 'online') return state('management_unavailable', 'refresh');
  if (control?.state !== 'available' || environment.runtime_operations.restart.maintenance?.kind === 'runtime_restart_required') {
    return state('control_missing', 'restart');
  }
  if (!service) return state('check_required', 'refresh');
  if (!runtimeServiceSupportsRuntimeGateway(service)) return state('unsupported', 'update');
  return state('ready');
}
