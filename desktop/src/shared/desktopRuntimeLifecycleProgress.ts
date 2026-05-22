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
  | 'stopping_runtime_process'
  | 'verifying_runtime_stopped'
  | 'preparing_runtime_package'
  | 'installing_runtime_package'
  | 'starting_runtime_process'
  | 'checking_runtime_service'
  | 'runtime_ready'
  | 'runtime_stopped';

export type DesktopRuntimeLifecycleStepID = DesktopRuntimeLifecyclePhase;

export type DesktopRuntimeLifecycleStepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed';

export type DesktopRuntimeLifecycleStepSnapshot = Readonly<{
  id: DesktopRuntimeLifecycleStepID;
  label: string;
  status: DesktopRuntimeLifecycleStepStatus;
  detail?: string;
  attempt_count?: number;
}>;

export type DesktopRuntimeLifecycleProgress = Readonly<{
  kind: 'runtime_lifecycle';
  location: DesktopRuntimeLifecycleLocation;
  operation: DesktopRuntimeLifecycleOperation;
  phase: DesktopRuntimeLifecyclePhase;
  active_step_id: DesktopRuntimeLifecycleStepID;
  failed_step_id?: DesktopRuntimeLifecycleStepID;
  stage_index: number;
  stage_count: number;
  steps: readonly DesktopRuntimeLifecycleStepSnapshot[];
  target_id: string;
  target_label: string;
  target_detail?: string;
}>;

export type DesktopRuntimeLifecycleOperation = 'start' | 'restart' | 'update' | 'stop';

export type DesktopRuntimeLifecycleStepState = Readonly<{
  id: DesktopRuntimeLifecycleStepID;
  status: DesktopRuntimeLifecycleStepStatus;
  detail?: string;
  attempt_count?: number;
}>;

const LOCAL_HOST_LIFECYCLE_PHASES: readonly DesktopRuntimeLifecyclePhase[] = [
  'checking_existing_runtime',
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

const RUNTIME_LIFECYCLE_PHASES_BY_OPERATION: Record<DesktopRuntimeLifecycleOperation, Partial<Record<DesktopRuntimeLifecycleLocation, readonly DesktopRuntimeLifecyclePhase[]>>> = {
  start: {},
  restart: {
    local_host: [
      'checking_existing_runtime',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ],
    local_container: [
      'checking_container',
      'checking_runtime_package',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ],
    ssh_host: [
      'checking_host',
      'checking_runtime_package',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ],
    ssh_container: [
      'checking_host',
      'checking_container',
      'checking_runtime_package',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ],
  },
  update: {
    local_host: [
      'checking_existing_runtime',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ],
    local_container: [
      'checking_container',
      'checking_runtime_package',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ],
    ssh_host: [
      'checking_host',
      'checking_runtime_package',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ],
    ssh_container: [
      'checking_host',
      'checking_container',
      'checking_runtime_package',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ],
  },
  stop: {
    local_host: [
      'checking_existing_runtime',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'runtime_stopped',
    ],
    local_container: [
      'checking_container',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'runtime_stopped',
    ],
    ssh_host: [
      'checking_host',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'runtime_stopped',
    ],
    ssh_container: [
      'checking_host',
      'checking_container',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'runtime_stopped',
    ],
  },
};

export const RUNTIME_LIFECYCLE_PHASE_LABELS: Record<DesktopRuntimeLifecyclePhase, string> = {
  checking_existing_runtime: 'Checking existing runtime',
  checking_host: 'Checking host',
  checking_container: 'Checking container',
  detecting_platform: 'Detecting platform',
  checking_runtime_package: 'Checking runtime package',
  stopping_runtime_process: 'Stopping runtime process',
  verifying_runtime_stopped: 'Verifying runtime stopped',
  preparing_runtime_package: 'Preparing runtime package',
  installing_runtime_package: 'Installing runtime package',
  starting_runtime_process: 'Starting runtime',
  checking_runtime_service: 'Checking runtime service',
  runtime_ready: 'Runtime ready',
  runtime_stopped: 'Runtime stopped',
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function stageIndexForPhase(
  phases: readonly DesktopRuntimeLifecyclePhase[],
  phase: DesktopRuntimeLifecyclePhase,
): number {
  const index = phases.indexOf(phase);
  if (index >= 0) {
    return index + 1;
  }
  return 1;
}

function runtimeLifecycleSteps(input: Readonly<{
  phases: readonly DesktopRuntimeLifecyclePhase[];
  activeStepID: DesktopRuntimeLifecyclePhase;
  failedStepID?: DesktopRuntimeLifecyclePhase;
  activeDetail?: string;
  attemptCount?: number;
  stepStates?: readonly DesktopRuntimeLifecycleStepState[];
}>): readonly DesktopRuntimeLifecycleStepSnapshot[] {
  const stateByID = new Map(input.stepStates?.map((step) => [step.id, step]) ?? []);
  const failedStepID = input.failedStepID;
  return input.phases.map((phase) => {
    const state = stateByID.get(phase);
    const status = state?.status
      ?? (failedStepID === phase ? 'failed' : phase === input.activeStepID && failedStepID === undefined ? 'running' : 'pending');
    const detail = compact(state?.detail ?? (phase === input.activeStepID ? input.activeDetail : ''));
    const attemptCount = state?.attempt_count !== undefined
      ? Math.max(0, Math.floor(state.attempt_count))
      : phase === input.activeStepID && input.attemptCount !== undefined
      ? Math.max(0, Math.floor(input.attemptCount))
      : undefined;
    return {
      id: phase,
      label: RUNTIME_LIFECYCLE_PHASE_LABELS[phase],
      status,
      ...(detail ? { detail } : {}),
      ...(attemptCount !== undefined ? { attempt_count: attemptCount } : {}),
    };
  });
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
  operation: DesktopRuntimeLifecycleOperation = 'start',
): readonly DesktopRuntimeLifecyclePhase[] {
  return RUNTIME_LIFECYCLE_PHASES_BY_OPERATION[operation][location]
    ?? RUNTIME_LIFECYCLE_PHASES_BY_LOCATION[location];
}

export function runtimeLifecycleProgress(
  input: Readonly<{
    location: DesktopRuntimeLifecycleLocation;
    operation?: DesktopRuntimeLifecycleOperation;
    phase: DesktopRuntimeLifecyclePhase;
    failedPhase?: DesktopRuntimeLifecyclePhase;
    detail?: string;
    attemptCount?: number;
    stepStates?: readonly DesktopRuntimeLifecycleStepState[];
    targetID?: string;
    targetLabel: string;
    targetDetail?: string;
  }>,
): DesktopRuntimeLifecycleProgress {
  const location = input.location;
  const operation = input.operation ?? 'start';
  const phases = runtimeLifecyclePhaseSequence(location, operation);
  const failedStepID = input.failedPhase ?? input.stepStates?.find((step) => step.status === 'failed')?.id;
  const activeStepID = failedStepID
    ?? input.stepStates?.find((step) => step.status === 'running')?.id
    ?? input.phase;
  const stageIndex = stageIndexForPhase(phases, activeStepID);
  const targetDetail = compact(input.targetDetail);
  return {
    kind: 'runtime_lifecycle',
    location,
    operation,
    phase: activeStepID,
    active_step_id: activeStepID,
    ...(failedStepID ? { failed_step_id: failedStepID } : {}),
    stage_index: stageIndex,
    stage_count: phases.length,
    steps: runtimeLifecycleSteps({
      phases,
      activeStepID,
      failedStepID,
      activeDetail: input.detail,
      attemptCount: input.attemptCount,
      stepStates: input.stepStates,
    }),
    target_id: compact(input.targetID) || compact(input.targetLabel) || 'runtime',
    target_label: compact(input.targetLabel) || 'Runtime',
    ...(targetDetail ? { target_detail: targetDetail } : {}),
  };
}
