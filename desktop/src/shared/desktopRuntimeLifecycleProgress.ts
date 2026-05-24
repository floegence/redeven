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
  | 'runtime_up_to_date'
  | 'runtime_already_stopped'
  | 'runtime_stopped';

export type DesktopRuntimeLifecycleStepID = DesktopRuntimeLifecyclePhase;

export type DesktopRuntimeLifecyclePlanState =
  | 'planning'
  | 'executing'
  | 'terminal';

export type DesktopRuntimeLifecycleStepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed';

export type DesktopRuntimeLifecycleStepSnapshot = Readonly<{
  id: DesktopRuntimeLifecycleStepID;
  key: string;
  label: string;
  status: DesktopRuntimeLifecycleStepStatus;
  detail?: string;
  attempt_count?: number;
}>;

export type DesktopRuntimeLifecycleOmittedStepReason =
  | 'runtime_already_openable'
  | 'runtime_already_stopped'
  | 'runtime_package_current'
  | 'runtime_process_absent'
  | 'managed_helper_not_required';

export type DesktopRuntimeLifecycleOmittedStep = Readonly<{
  id: DesktopRuntimeLifecycleStepID;
  reason: DesktopRuntimeLifecycleOmittedStepReason;
}>;

export type DesktopRuntimeLifecycleProgress = Readonly<{
  kind: 'runtime_lifecycle';
  location: DesktopRuntimeLifecycleLocation;
  operation: DesktopRuntimeLifecycleOperation;
  plan_state: DesktopRuntimeLifecyclePlanState;
  plan_revision: number;
  phase: DesktopRuntimeLifecyclePhase;
  active_step_id: DesktopRuntimeLifecycleStepID;
  failed_step_id?: DesktopRuntimeLifecycleStepID;
  stage_index: number;
  stage_count: number;
  steps: readonly DesktopRuntimeLifecycleStepSnapshot[];
  target_id: string;
  target_label: string;
  target_detail?: string;
  diagnostics?: {
    omitted_steps?: readonly DesktopRuntimeLifecycleOmittedStep[];
  };
}>;

export type DesktopRuntimeLifecycleOperation = 'start' | 'restart' | 'update' | 'stop';

export type DesktopRuntimeLifecycleStepState = Readonly<{
  id: DesktopRuntimeLifecycleStepID;
  key?: string;
  label?: string;
  status: DesktopRuntimeLifecycleStepStatus;
  detail?: string;
  attempt_count?: number;
}>;

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
  runtime_up_to_date: 'Runtime up to date',
  runtime_already_stopped: 'Runtime already stopped',
  runtime_stopped: 'Runtime stopped',
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function lifecycleStepKey(
  step: DesktopRuntimeLifecycleStepState,
  index: number,
  planRevision: number,
): string {
  return compact(step.key) || `runtime-lifecycle:${planRevision}:${index}:${step.id}`;
}

function stageIndexForPhase(
  phases: readonly DesktopRuntimeLifecycleStepID[],
  phase: DesktopRuntimeLifecyclePhase,
): number {
  const index = phases.indexOf(phase);
  if (index >= 0) {
    return index + 1;
  }
  return 1;
}

export function runtimeLifecycleStepsFromStates(input: Readonly<{
  stepStates: readonly DesktopRuntimeLifecycleStepState[];
  planRevision?: number;
}>): readonly DesktopRuntimeLifecycleStepSnapshot[] {
  const planRevision = Math.max(0, Math.floor(input.planRevision ?? 0));
  return input.stepStates.map((step, index) => {
    const detail = compact(step.detail);
    const attemptCount = step.attempt_count !== undefined
      ? Math.max(0, Math.floor(step.attempt_count))
      : undefined;
    return {
      id: step.id,
      key: lifecycleStepKey(step, index, planRevision),
      label: compact(step.label) || RUNTIME_LIFECYCLE_PHASE_LABELS[step.id],
      status: step.status,
      ...(detail ? { detail } : {}),
      ...(attemptCount !== undefined ? { attempt_count: attemptCount } : {}),
    };
  });
}

function activeStepIDForSteps(
  steps: readonly DesktopRuntimeLifecycleStepSnapshot[],
  fallbackPhase: DesktopRuntimeLifecycleStepID,
): DesktopRuntimeLifecycleStepID {
  return steps.find((step) => step.status === 'failed')?.id
    ?? steps.find((step) => step.status === 'running')?.id
    ?? steps.find((step) => step.status === 'pending')?.id
    ?? steps.at(-1)?.id
    ?? fallbackPhase;
}

function runtimeLifecycleStepStates(input: Readonly<{
  activeStepID: DesktopRuntimeLifecyclePhase;
  failedStepID?: DesktopRuntimeLifecyclePhase;
  activeDetail?: string;
  attemptCount?: number;
  stepStates?: readonly DesktopRuntimeLifecycleStepState[];
}>): readonly DesktopRuntimeLifecycleStepState[] {
  if (input.stepStates && input.stepStates.length > 0) {
    return input.stepStates;
  }
  const failedStepID = input.failedStepID;
  const detail = compact(input.activeDetail);
  const attemptCount = input.attemptCount !== undefined
      ? Math.max(0, Math.floor(input.attemptCount))
      : undefined;
  return [{
    id: input.activeStepID,
    status: failedStepID === input.activeStepID ? 'failed' : failedStepID === undefined ? 'running' : 'pending',
    ...(detail ? { detail } : {}),
    ...(attemptCount !== undefined ? { attempt_count: attemptCount } : {}),
  }];
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

export function runtimeLifecycleProgress(
  input: Readonly<{
    location: DesktopRuntimeLifecycleLocation;
    operation?: DesktopRuntimeLifecycleOperation;
    planState?: DesktopRuntimeLifecyclePlanState;
    planRevision?: number;
    phase: DesktopRuntimeLifecyclePhase;
    failedPhase?: DesktopRuntimeLifecyclePhase;
    detail?: string;
    attemptCount?: number;
    stepStates?: readonly DesktopRuntimeLifecycleStepState[];
    omittedSteps?: readonly DesktopRuntimeLifecycleOmittedStep[];
    targetID?: string;
    targetLabel: string;
    targetDetail?: string;
  }>,
): DesktopRuntimeLifecycleProgress {
  const location = input.location;
  const operation = input.operation ?? 'start';
  const planRevision = Math.max(0, Math.floor(input.planRevision ?? 0));
  const stepStates = runtimeLifecycleStepStates({
    activeStepID: input.phase,
    failedStepID: input.failedPhase,
    activeDetail: input.detail,
    attemptCount: input.attemptCount,
    stepStates: input.stepStates,
  });
  const steps = runtimeLifecycleStepsFromStates({
    stepStates,
    planRevision,
  });
  const failedStepID = input.failedPhase ?? steps.find((step) => step.status === 'failed')?.id;
  const activeStepID = failedStepID ?? activeStepIDForSteps(steps, input.phase);
  const stageIndex = stageIndexForPhase(steps.map((step) => step.id), activeStepID);
  const targetDetail = compact(input.targetDetail);
  const omittedSteps = input.omittedSteps?.length ? input.omittedSteps : undefined;
  return {
    kind: 'runtime_lifecycle',
    location,
    operation,
    plan_state: input.planState ?? (failedStepID || steps.every((step) => step.status === 'succeeded') ? 'terminal' : 'executing'),
    plan_revision: planRevision,
    phase: activeStepID,
    active_step_id: activeStepID,
    ...(failedStepID ? { failed_step_id: failedStepID } : {}),
    stage_index: stageIndex,
    stage_count: steps.length,
    steps,
    target_id: compact(input.targetID) || compact(input.targetLabel) || 'runtime',
    target_label: compact(input.targetLabel) || 'Runtime',
    ...(targetDetail ? { target_detail: targetDetail } : {}),
    ...(omittedSteps ? { diagnostics: { omitted_steps: omittedSteps } } : {}),
  };
}
