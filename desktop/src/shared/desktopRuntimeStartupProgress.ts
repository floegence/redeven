import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
} from './desktopRuntimePlacement';

export type DesktopRuntimeStartupLocation =
  | 'local_host'
  | 'local_container'
  | 'ssh_host'
  | 'ssh_container';

export type DesktopRuntimeStartupPhase =
  | 'checking_existing_runtime'
  | 'checking_host'
  | 'checking_container'
  | 'detecting_platform'
  | 'checking_runtime'
  | 'preparing_runtime_package'
  | 'installing_runtime'
  | 'starting_runtime'
  | 'starting_bridge'
  | 'waiting_for_readiness'
  | 'runtime_ready'
  | 'failed'
  | 'canceled';

export type DesktopRuntimeStartupProgress = Readonly<{
  kind: 'runtime_startup';
  location: DesktopRuntimeStartupLocation;
  phase: DesktopRuntimeStartupPhase;
  stage_index: number;
  stage_count: number;
  target_label: string;
  target_detail?: string;
}>;

const LOCAL_HOST_STARTUP_PHASES: readonly DesktopRuntimeStartupPhase[] = [
  'checking_existing_runtime',
  'starting_runtime',
  'waiting_for_readiness',
  'runtime_ready',
];

const CONTAINER_STARTUP_PHASES: readonly DesktopRuntimeStartupPhase[] = [
  'checking_container',
  'detecting_platform',
  'checking_runtime',
  'preparing_runtime_package',
  'installing_runtime',
  'starting_bridge',
  'waiting_for_readiness',
  'runtime_ready',
];

const SSH_HOST_STARTUP_PHASES: readonly DesktopRuntimeStartupPhase[] = [
  'checking_host',
  'checking_runtime',
  'detecting_platform',
  'preparing_runtime_package',
  'installing_runtime',
  'starting_runtime',
  'waiting_for_readiness',
  'runtime_ready',
];

const SSH_CONTAINER_STARTUP_PHASES: readonly DesktopRuntimeStartupPhase[] = [
  'checking_host',
  'checking_container',
  'detecting_platform',
  'checking_runtime',
  'preparing_runtime_package',
  'installing_runtime',
  'starting_bridge',
  'waiting_for_readiness',
  'runtime_ready',
];

const RUNTIME_STARTUP_PHASES_BY_LOCATION: Record<DesktopRuntimeStartupLocation, readonly DesktopRuntimeStartupPhase[]> = {
  local_host: LOCAL_HOST_STARTUP_PHASES,
  local_container: CONTAINER_STARTUP_PHASES,
  ssh_host: SSH_HOST_STARTUP_PHASES,
  ssh_container: SSH_CONTAINER_STARTUP_PHASES,
};

export const RUNTIME_STARTUP_PHASE_LABELS: Record<DesktopRuntimeStartupPhase, string> = {
  checking_existing_runtime: 'Checking existing runtime',
  checking_host: 'Checking host',
  checking_container: 'Checking container',
  detecting_platform: 'Detecting platform',
  checking_runtime: 'Checking runtime',
  preparing_runtime_package: 'Preparing runtime package',
  installing_runtime: 'Installing runtime',
  starting_runtime: 'Starting runtime',
  starting_bridge: 'Starting runtime bridge',
  waiting_for_readiness: 'Waiting for readiness',
  runtime_ready: 'Runtime ready',
  failed: 'Failed',
  canceled: 'Canceled',
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function stageIndexForPhase(
  location: DesktopRuntimeStartupLocation,
  phase: DesktopRuntimeStartupPhase,
): number {
  const phases = RUNTIME_STARTUP_PHASES_BY_LOCATION[location];
  const index = phases.indexOf(phase);
  if (index >= 0) {
    return index + 1;
  }
  if (phase === 'failed' || phase === 'canceled') {
    return Math.max(1, phases.length);
  }
  return 1;
}

export function desktopRuntimeStartupLocation(
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
): DesktopRuntimeStartupLocation {
  if (placement.kind === 'container_process') {
    return hostAccess.kind === 'ssh_host' ? 'ssh_container' : 'local_container';
  }
  return hostAccess.kind === 'ssh_host' ? 'ssh_host' : 'local_host';
}

export function runtimeStartupPhaseSequence(
  location: DesktopRuntimeStartupLocation,
): readonly DesktopRuntimeStartupPhase[] {
  return RUNTIME_STARTUP_PHASES_BY_LOCATION[location];
}

export function runtimeStartupProgress(
  input: Readonly<{
    location: DesktopRuntimeStartupLocation;
    phase: DesktopRuntimeStartupPhase;
    targetLabel: string;
    targetDetail?: string;
  }>,
): DesktopRuntimeStartupProgress {
  const location = input.location;
  const phases = RUNTIME_STARTUP_PHASES_BY_LOCATION[location];
  const targetDetail = compact(input.targetDetail);
  return {
    kind: 'runtime_startup',
    location,
    phase: input.phase,
    stage_index: stageIndexForPhase(location, input.phase),
    stage_count: phases.length,
    target_label: compact(input.targetLabel) || 'Runtime',
    ...(targetDetail ? { target_detail: targetDetail } : {}),
  };
}
