import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
} from './desktopRuntimePlacement';

export type DesktopRuntimeLifecycleLocation =
  | 'local_host'
  | 'local_container'
  | 'ssh_host'
  | 'ssh_container';

export type DesktopRuntimeLifecyclePhase =
  | 'checking_existing_runtime'
  | 'checking_host'
  | 'checking_container'
  | 'detecting_platform'
  | 'checking_runtime_package'
  | 'preparing_runtime_package'
  | 'installing_runtime_package'
  | 'starting_runtime_process'
  | 'attaching_existing_runtime'
  | 'checking_runtime_service'
  | 'runtime_ready'
  | 'failed'
  | 'canceled';

export type DesktopRuntimeLifecycleProgress = Readonly<{
  kind: 'runtime_lifecycle';
  location: DesktopRuntimeLifecycleLocation;
  phase: DesktopRuntimeLifecyclePhase;
  stage_index: number;
  stage_count: number;
  target_id: string;
  target_label: string;
  target_detail?: string;
}>;

const LOCAL_HOST_LIFECYCLE_PHASES: readonly DesktopRuntimeLifecyclePhase[] = [
  'checking_existing_runtime',
  'attaching_existing_runtime',
  'starting_runtime_process',
  'checking_runtime_service',
  'runtime_ready',
];

const CONTAINER_LIFECYCLE_PHASES: readonly DesktopRuntimeLifecyclePhase[] = [
  'checking_container',
  'detecting_platform',
  'checking_runtime_package',
  'preparing_runtime_package',
  'installing_runtime_package',
  'starting_runtime_process',
  'checking_runtime_service',
  'runtime_ready',
];

const SSH_HOST_LIFECYCLE_PHASES: readonly DesktopRuntimeLifecyclePhase[] = [
  'checking_host',
  'checking_runtime_package',
  'detecting_platform',
  'preparing_runtime_package',
  'installing_runtime_package',
  'starting_runtime_process',
  'attaching_existing_runtime',
  'checking_runtime_service',
  'runtime_ready',
];

const SSH_CONTAINER_LIFECYCLE_PHASES: readonly DesktopRuntimeLifecyclePhase[] = [
  'checking_host',
  'checking_container',
  'detecting_platform',
  'checking_runtime_package',
  'preparing_runtime_package',
  'installing_runtime_package',
  'starting_runtime_process',
  'checking_runtime_service',
  'runtime_ready',
];

const RUNTIME_LIFECYCLE_PHASES_BY_LOCATION: Record<DesktopRuntimeLifecycleLocation, readonly DesktopRuntimeLifecyclePhase[]> = {
  local_host: LOCAL_HOST_LIFECYCLE_PHASES,
  local_container: CONTAINER_LIFECYCLE_PHASES,
  ssh_host: SSH_HOST_LIFECYCLE_PHASES,
  ssh_container: SSH_CONTAINER_LIFECYCLE_PHASES,
};

export const RUNTIME_LIFECYCLE_PHASE_LABELS: Record<DesktopRuntimeLifecyclePhase, string> = {
  checking_existing_runtime: 'Checking existing runtime',
  checking_host: 'Checking host',
  checking_container: 'Checking container',
  detecting_platform: 'Detecting platform',
  checking_runtime_package: 'Checking runtime package',
  preparing_runtime_package: 'Preparing runtime package',
  installing_runtime_package: 'Installing runtime package',
  starting_runtime_process: 'Starting runtime',
  attaching_existing_runtime: 'Attaching existing runtime',
  checking_runtime_service: 'Checking runtime service',
  runtime_ready: 'Runtime ready',
  failed: 'Failed',
  canceled: 'Canceled',
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function stageIndexForPhase(
  location: DesktopRuntimeLifecycleLocation,
  phase: DesktopRuntimeLifecyclePhase,
): number {
  const phases = RUNTIME_LIFECYCLE_PHASES_BY_LOCATION[location];
  const index = phases.indexOf(phase);
  if (index >= 0) {
    return index + 1;
  }
  if (phase === 'failed' || phase === 'canceled') {
    return Math.max(1, phases.length);
  }
  return 1;
}

export function desktopRuntimeLifecycleLocation(
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
): DesktopRuntimeLifecycleLocation {
  if (placement.kind === 'container_process') {
    return hostAccess.kind === 'ssh_host' ? 'ssh_container' : 'local_container';
  }
  return hostAccess.kind === 'ssh_host' ? 'ssh_host' : 'local_host';
}

export function runtimeLifecyclePhaseSequence(
  location: DesktopRuntimeLifecycleLocation,
): readonly DesktopRuntimeLifecyclePhase[] {
  return RUNTIME_LIFECYCLE_PHASES_BY_LOCATION[location];
}

export function runtimeLifecycleProgress(
  input: Readonly<{
    location: DesktopRuntimeLifecycleLocation;
    phase: DesktopRuntimeLifecyclePhase;
    targetID?: string;
    targetLabel: string;
    targetDetail?: string;
  }>,
): DesktopRuntimeLifecycleProgress {
  const location = input.location;
  const phases = RUNTIME_LIFECYCLE_PHASES_BY_LOCATION[location];
  const targetDetail = compact(input.targetDetail);
  return {
    kind: 'runtime_lifecycle',
    location,
    phase: input.phase,
    stage_index: stageIndexForPhase(location, input.phase),
    stage_count: phases.length,
    target_id: compact(input.targetID) || compact(input.targetLabel) || 'runtime',
    target_label: compact(input.targetLabel) || 'Runtime',
    ...(targetDetail ? { target_detail: targetDetail } : {}),
  };
}
