import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
} from './desktopRuntimePlacement';

export type DesktopOpenConnectionLocation =
  | 'local_host'
  | 'local_container'
  | 'ssh_host'
  | 'ssh_container'
  | 'provider_remote';

export type DesktopOpenConnectionPhase =
  | 'checking_runtime_record'
  | 'ensuring_runtime_ready'
  | 'opening_ssh_control'
  | 'opening_local_tunnel'
  | 'starting_container_bridge'
  | 'opening_bridge_proxy'
  | 'connecting_runtime_control'
  | 'connecting_desktop_model_source'
  | 'checking_env_app_readiness'
  | 'opening_window'
  | 'open_ready'
  | 'failed'
  | 'canceled';

export type DesktopOpenConnectionProgress = Readonly<{
  kind: 'open_connection';
  location: DesktopOpenConnectionLocation;
  phase: DesktopOpenConnectionPhase;
  stage_index: number;
  stage_count: number;
  environment_id: string;
  environment_label: string;
  target_id?: string;
  target_label?: string;
  target_detail?: string;
}>;

const LOCAL_HOST_OPEN_PHASES: readonly DesktopOpenConnectionPhase[] = [
  'checking_runtime_record',
  'checking_env_app_readiness',
  'opening_window',
  'open_ready',
];

const CONTAINER_OPEN_PHASES: readonly DesktopOpenConnectionPhase[] = [
  'checking_runtime_record',
  'ensuring_runtime_ready',
  'starting_container_bridge',
  'opening_bridge_proxy',
  'connecting_runtime_control',
  'connecting_desktop_model_source',
  'checking_env_app_readiness',
  'opening_window',
  'open_ready',
];

const SSH_HOST_OPEN_PHASES: readonly DesktopOpenConnectionPhase[] = [
  'checking_runtime_record',
  'ensuring_runtime_ready',
  'opening_ssh_control',
  'opening_local_tunnel',
  'connecting_runtime_control',
  'connecting_desktop_model_source',
  'checking_env_app_readiness',
  'opening_window',
  'open_ready',
];

const SSH_CONTAINER_OPEN_PHASES: readonly DesktopOpenConnectionPhase[] = [
  'checking_runtime_record',
  'ensuring_runtime_ready',
  'opening_ssh_control',
  'starting_container_bridge',
  'opening_bridge_proxy',
  'connecting_runtime_control',
  'connecting_desktop_model_source',
  'checking_env_app_readiness',
  'opening_window',
  'open_ready',
];

const PROVIDER_REMOTE_OPEN_PHASES: readonly DesktopOpenConnectionPhase[] = [
  'checking_runtime_record',
  'opening_window',
  'open_ready',
];

const OPEN_CONNECTION_PHASES_BY_LOCATION: Record<DesktopOpenConnectionLocation, readonly DesktopOpenConnectionPhase[]> = {
  local_host: LOCAL_HOST_OPEN_PHASES,
  local_container: CONTAINER_OPEN_PHASES,
  ssh_host: SSH_HOST_OPEN_PHASES,
  ssh_container: SSH_CONTAINER_OPEN_PHASES,
  provider_remote: PROVIDER_REMOTE_OPEN_PHASES,
};

export const OPEN_CONNECTION_PHASE_LABELS: Record<DesktopOpenConnectionPhase, string> = {
  checking_runtime_record: 'Checking runtime',
  ensuring_runtime_ready: 'Preparing runtime',
  opening_ssh_control: 'Opening SSH connection',
  opening_local_tunnel: 'Opening local tunnel',
  starting_container_bridge: 'Opening container bridge',
  opening_bridge_proxy: 'Opening bridge proxy',
  connecting_runtime_control: 'Connecting runtime control',
  connecting_desktop_model_source: 'Connecting model source',
  checking_env_app_readiness: 'Checking app readiness',
  opening_window: 'Opening window',
  open_ready: 'Open ready',
  failed: 'Failed',
  canceled: 'Canceled',
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function stageIndexForPhase(
  location: DesktopOpenConnectionLocation,
  phase: DesktopOpenConnectionPhase,
): number {
  const phases = OPEN_CONNECTION_PHASES_BY_LOCATION[location];
  const index = phases.indexOf(phase);
  if (index >= 0) {
    return index + 1;
  }
  if (phase === 'failed' || phase === 'canceled') {
    return Math.max(1, phases.length);
  }
  return 1;
}

export function desktopOpenConnectionLocation(
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
): DesktopOpenConnectionLocation {
  if (placement.kind === 'container_process') {
    return hostAccess.kind === 'ssh_host' ? 'ssh_container' : 'local_container';
  }
  return hostAccess.kind === 'ssh_host' ? 'ssh_host' : 'local_host';
}

export function openConnectionPhaseSequence(
  location: DesktopOpenConnectionLocation,
): readonly DesktopOpenConnectionPhase[] {
  return OPEN_CONNECTION_PHASES_BY_LOCATION[location];
}

export function openConnectionProgress(
  input: Readonly<{
    location: DesktopOpenConnectionLocation;
    phase: DesktopOpenConnectionPhase;
    environmentID: string;
    environmentLabel: string;
    targetID?: string;
    targetLabel?: string;
    targetDetail?: string;
  }>,
): DesktopOpenConnectionProgress {
  const location = input.location;
  const phases = OPEN_CONNECTION_PHASES_BY_LOCATION[location];
  const targetID = compact(input.targetID);
  const targetLabel = compact(input.targetLabel);
  const targetDetail = compact(input.targetDetail);
  return {
    kind: 'open_connection',
    location,
    phase: input.phase,
    stage_index: stageIndexForPhase(location, input.phase),
    stage_count: phases.length,
    environment_id: compact(input.environmentID),
    environment_label: compact(input.environmentLabel) || 'Environment',
    ...(targetID ? { target_id: targetID } : {}),
    ...(targetLabel ? { target_label: targetLabel } : {}),
    ...(targetDetail ? { target_detail: targetDetail } : {}),
  };
}
