import {
  runtimeLifecycleProgress,
  type DesktopRuntimeLifecycleLocation,
  type DesktopRuntimeLifecycleOmittedStep,
  type DesktopRuntimeLifecycleOperation,
  type DesktopRuntimeLifecyclePlanState,
  type DesktopRuntimeLifecycleProgress,
  type DesktopRuntimeLifecycleStepID,
  type DesktopRuntimeLifecycleStepState,
  type DesktopRuntimeLifecycleStepStatus,
} from '../shared/desktopRuntimeLifecycleProgress';
import {
  DesktopOperationFailureError,
  operationFailureFromUnknown,
} from './desktopOperationFailure';
import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';
import { initialRuntimeLifecyclePlan } from './runtimeLifecycleExecutionPlan';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export class RuntimeLifecycleStepFailureError extends DesktopOperationFailureError {
  readonly failed_step_id: DesktopRuntimeLifecycleStepID;

  constructor(
    presentation: DesktopOperationFailurePresentation,
    failedStepID: DesktopRuntimeLifecycleStepID,
    options: Readonly<{ cause?: unknown }> = {},
  ) {
    super(presentation, {
      cause: options.cause,
      runtimeLifecycleStepID: failedStepID,
    });
    this.name = 'RuntimeLifecycleStepFailureError';
    this.failed_step_id = failedStepID;
  }
}

export function runtimeLifecycleStepIDFromError(error: unknown): DesktopRuntimeLifecycleStepID | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const record = error as {
    failed_step_id?: unknown;
    runtime_lifecycle_step_id?: unknown;
  };
  const stepID = compact(record.failed_step_id) || compact(record.runtime_lifecycle_step_id);
  return stepID === '' ? null : stepID as DesktopRuntimeLifecycleStepID;
}

function runtimeLifecycleFailurePresentation(
  error: unknown,
  fallback: DesktopOperationFailurePresentation,
): DesktopOperationFailurePresentation {
  return operationFailureFromUnknown(error, fallback);
}

function runtimeLifecycleStepFailureError(
  error: unknown,
  failedStepID: DesktopRuntimeLifecycleStepID,
  fallback: DesktopOperationFailurePresentation,
): RuntimeLifecycleStepFailureError {
  if (error instanceof RuntimeLifecycleStepFailureError) {
    return error;
  }
  return new RuntimeLifecycleStepFailureError(
    runtimeLifecycleFailurePresentation(error, fallback),
    runtimeLifecycleStepIDFromError(error) ?? failedStepID,
    { cause: error },
  );
}

export type RuntimeLifecycleWorkflowContext = Readonly<{
  location: DesktopRuntimeLifecycleLocation;
  operation: DesktopRuntimeLifecycleOperation;
  target_id: string;
  target_label: string;
  target_detail?: string;
}>;

export type RuntimeLifecyclePlanPatch = Readonly<{
  state?: DesktopRuntimeLifecyclePlanState;
  steps: readonly DesktopRuntimeLifecycleStepID[];
  omitted_steps?: readonly DesktopRuntimeLifecycleOmittedStep[];
}>;

export type RuntimeLifecycleStepUpdate = Readonly<{
  title: string;
  detail: string;
  progress: DesktopRuntimeLifecycleProgress;
}>;

const OBSERVED_RUNTIME_LIFECYCLE_STEP_STATUSES: readonly DesktopRuntimeLifecycleStepStatus[] = [
  'running',
  'succeeded',
  'failed',
];

function uniqueStepIDs(ids: readonly DesktopRuntimeLifecycleStepID[]): readonly DesktopRuntimeLifecycleStepID[] {
  return [...new Set(ids)];
}

function isObservedRuntimeLifecycleStep(step: DesktopRuntimeLifecycleStepState): boolean {
  return OBSERVED_RUNTIME_LIFECYCLE_STEP_STATUSES.includes(step.status);
}

export function runtimeLifecyclePlanPatchPreservingObservedHistory(input: Readonly<{
  currentSteps: readonly DesktopRuntimeLifecycleStepState[];
  patch: RuntimeLifecyclePlanPatch;
}>): RuntimeLifecyclePlanPatch {
  const nextSteps = uniqueStepIDs(input.patch.steps);
  let lastObservedIndex = -1;
  for (const [index, step] of input.currentSteps.entries()) {
    if (isObservedRuntimeLifecycleStep(step)) {
      lastObservedIndex = index;
    }
  }
  if (lastObservedIndex < 0) {
    return {
      ...input.patch,
      steps: nextSteps,
    };
  }

  const observedPrefix = input.currentSteps.slice(0, lastObservedIndex + 1).map((step) => step.id);
  const mergedSteps = uniqueStepIDs([
    ...observedPrefix,
    ...nextSteps,
  ]);
  const omittedSteps = input.patch.omitted_steps?.filter((step) => !mergedSteps.includes(step.id));
  return {
    ...input.patch,
    steps: mergedSteps,
    ...(omittedSteps ? { omitted_steps: omittedSteps } : {}),
  };
}

export class RuntimeLifecycleWorkflow {
  private readonly states = new Map<DesktopRuntimeLifecycleStepID, DesktopRuntimeLifecycleStepState>();
  private plan: readonly DesktopRuntimeLifecycleStepID[];
  private planState: DesktopRuntimeLifecyclePlanState;
  private planRevision = 0;
  private omittedSteps: readonly DesktopRuntimeLifecycleOmittedStep[] = [];
  private activeStepID: DesktopRuntimeLifecycleStepID;
  private failedStepID: DesktopRuntimeLifecycleStepID | null = null;

  constructor(private readonly context: RuntimeLifecycleWorkflowContext) {
    const initialPlan = initialRuntimeLifecyclePlan({
      location: context.location,
      operation: context.operation,
    });
    this.plan = initialPlan.steps.map((step) => step.id);
    this.planState = initialPlan.state;
    this.activeStepID = this.plan[0] ?? 'checking_existing_runtime';
    for (const step of initialPlan.steps) {
      this.states.set(step.id, step);
    }
  }

  static fromProgress(progress: DesktopRuntimeLifecycleProgress): RuntimeLifecycleWorkflow {
    const workflow = new RuntimeLifecycleWorkflow({
      location: progress.location,
      operation: progress.operation,
      target_id: progress.target_id,
      target_label: progress.target_label,
      target_detail: progress.target_detail,
    });
    workflow.plan = progress.steps.map((step) => step.id);
    workflow.planState = progress.plan_state;
    workflow.planRevision = progress.plan_revision;
    workflow.omittedSteps = progress.diagnostics?.omitted_steps ?? [];
    workflow.states.clear();
    for (const step of progress.steps) {
      workflow.states.set(step.id, {
        id: step.id,
        key: step.key,
        label: step.label,
        status: step.status,
        detail: step.detail,
        attempt_count: step.attempt_count,
      });
    }
    workflow.activeStepID = progress.active_step_id;
    workflow.failedStepID = progress.failed_step_id ?? null;
    return workflow;
  }

  commitPlan(patch: RuntimeLifecyclePlanPatch): RuntimeLifecycleStepUpdate {
    const previousPlan = this.plan;
    const nextPlan = [...new Set(patch.steps)];
    const protectedSteps = this.stepStates().filter((step) => step.status === 'succeeded' || step.status === 'running' || step.status === 'failed');
    for (const step of protectedSteps) {
      if (!nextPlan.includes(step.id)) {
        throw new Error(`Runtime lifecycle plan cannot remove active or completed step "${step.id}".`);
      }
    }
    this.plan = nextPlan;
    this.planState = patch.state ?? this.planState;
    this.omittedSteps = patch.omitted_steps ?? this.omittedSteps;
    if (previousPlan.join('\n') !== this.plan.join('\n')) {
      this.planRevision += 1;
    }
    for (const [index, stepID] of this.plan.entries()) {
      const existing = this.states.get(stepID);
      if (existing) {
        this.states.set(stepID, {
          ...existing,
          key: existing.key ?? this.stepKey(stepID, index),
        });
      } else {
        this.states.set(stepID, {
          id: stepID,
          key: this.stepKey(stepID, index),
          status: 'pending',
        });
      }
    }
    for (const stepID of [...this.states.keys()]) {
      if (!this.plan.includes(stepID)) {
        this.states.delete(stepID);
      }
    }
    if (!this.plan.includes(this.activeStepID)) {
      this.activeStepID = this.firstPendingStep()?.id ?? this.plan.at(-1) ?? this.activeStepID;
    }
    return {
      title: '',
      detail: '',
      progress: this.progress(),
    };
  }

  ensureStepPlanned(
    stepID: DesktopRuntimeLifecycleStepID,
    patch: RuntimeLifecyclePlanPatch,
  ): RuntimeLifecycleStepUpdate | null {
    if (this.plan.includes(stepID)) {
      return null;
    }
    return this.commitPlan(patch);
  }

  currentStepIDs(): readonly DesktopRuntimeLifecycleStepID[] {
    return this.plan;
  }

  beginStep(
    stepID: DesktopRuntimeLifecycleStepID,
    detail = '',
    attemptCount?: number,
  ): RuntimeLifecycleStepUpdate {
    const nextIndex = this.stepIndex(stepID);
    if (nextIndex < 0) {
      throw new Error(`Runtime lifecycle step "${stepID}" is not in the current execution plan.`);
    }
    const currentRunning = this.stepStates().find((step) => step.status === 'running') ?? null;
    if (currentRunning && currentRunning.id !== stepID) {
      const firstPending = this.firstPendingStep();
      if (firstPending?.id !== stepID) {
        throw new Error(`Runtime lifecycle step "${stepID}" cannot start while "${currentRunning.id}" is still running.`);
      }
      this.setStepState(currentRunning.id, 'succeeded', currentRunning.detail, currentRunning.attempt_count);
    }
    const firstPending = this.firstPendingStep();
    if (firstPending && firstPending.id !== stepID && currentRunning?.id !== stepID) {
      throw new Error(`Runtime lifecycle step "${stepID}" cannot skip pending step "${firstPending.id}".`);
    }
    this.activeStepID = stepID;
    this.failedStepID = null;
    this.setStepState(stepID, 'running', detail, attemptCount);
    return {
      title: '',
      detail,
      progress: this.progress(),
    };
  }

  observeStep(
    stepID: DesktopRuntimeLifecycleStepID,
    detail = '',
    attemptCount?: number,
  ): RuntimeLifecycleStepUpdate | null {
    if (stepID !== this.activeStepID) {
      return null;
    }
    const current = this.states.get(this.activeStepID);
    if (current?.status === 'succeeded') {
      return null;
    }
    return this.updateStep(detail, attemptCount);
  }

  updateStep(detail: string, attemptCount?: number): RuntimeLifecycleStepUpdate {
    const current = this.states.get(this.activeStepID);
    this.setStepState(
      this.activeStepID,
      current?.status === 'failed' ? 'failed' : 'running',
      detail,
      attemptCount,
    );
    return {
      title: '',
      detail,
      progress: this.progress(),
    };
  }

  completeStep(stepID: DesktopRuntimeLifecycleStepID = this.activeStepID): RuntimeLifecycleStepUpdate {
    const current = this.states.get(stepID);
    if (!current || current.status !== 'running') {
      throw new Error(`Runtime lifecycle step "${stepID}" cannot complete because it is not running.`);
    }
    this.setStepState(stepID, 'succeeded');
    this.activeStepID = stepID;
    if (this.stepStates().every((step) => step.status === 'succeeded')) {
      this.planState = 'terminal';
    }
    return {
      title: '',
      detail: compact(this.states.get(stepID)?.detail),
      progress: this.progress(),
    };
  }

  completeThrough(stepID: DesktopRuntimeLifecycleStepID): RuntimeLifecycleStepUpdate {
    const targetIndex = this.stepIndex(stepID);
    if (targetIndex < 0) {
      throw new Error(`Runtime lifecycle step "${stepID}" is not in the current execution plan.`);
    }
    for (const phase of this.plan.slice(0, targetIndex + 1)) {
      const state = this.states.get(phase);
      this.setStepState(phase, 'succeeded', state?.detail, state?.attempt_count);
    }
    this.activeStepID = stepID;
    if (this.stepStates().every((step) => step.status === 'succeeded')) {
      this.planState = 'terminal';
    }
    return {
      title: '',
      detail: compact(this.states.get(stepID)?.detail),
      progress: this.progress(),
    };
  }

  failStep(
    error: unknown,
    fallback: DesktopOperationFailurePresentation,
    stepID: DesktopRuntimeLifecycleStepID = runtimeLifecycleStepIDFromError(error) ?? this.activeStepID,
  ): RuntimeLifecycleStepFailureError {
    const stepFailure = runtimeLifecycleStepFailureError(error, stepID, fallback);
    const failedIndex = this.stepIndex(stepID);
    if (failedIndex < 0) {
      throw new Error(`Runtime lifecycle step "${stepID}" is not in the current execution plan.`);
    }
    this.failedStepID = stepID;
    this.activeStepID = stepID;
    this.planState = 'terminal';
    for (const phase of this.plan.slice(0, failedIndex)) {
      const state = this.states.get(phase);
      if (state?.status !== 'failed') {
        this.setStepState(phase, 'succeeded', state?.detail, state?.attempt_count);
      }
    }
    this.setStepState(stepID, 'failed', compact(stepFailure.presentation.summary));
    for (const phase of this.plan.slice(failedIndex + 1)) {
      this.setStepState(phase, 'pending');
    }
    return stepFailure;
  }

  async runStep<T>(
    stepID: DesktopRuntimeLifecycleStepID,
    title: string,
    detail: string,
    fallback: DesktopOperationFailurePresentation,
    emit: (update: RuntimeLifecycleStepUpdate) => void,
    task: () => Promise<T>,
  ): Promise<T> {
    emit({
      title,
      detail,
      progress: this.beginStep(stepID, detail).progress,
    });
    try {
      const result = await task();
      this.completeStep(stepID);
      return result;
    } catch (error) {
      throw this.failStep(error, fallback, stepID);
    }
  }

  progress(): DesktopRuntimeLifecycleProgress {
    return runtimeLifecycleProgress({
      location: this.context.location,
      operation: this.context.operation,
      planState: this.planState,
      planRevision: this.planRevision,
      phase: this.activeStepID,
      failedPhase: this.failedStepID ?? undefined,
      stepStates: this.stepStates(),
      omittedSteps: this.omittedSteps,
      targetID: this.context.target_id,
      targetLabel: this.context.target_label,
      targetDetail: this.context.target_detail,
    });
  }

  stepStates(): readonly DesktopRuntimeLifecycleStepState[] {
    return this.plan.map((phase, index) => this.states.get(phase) ?? {
      id: phase,
      key: this.stepKey(phase, index),
      status: 'pending' as const,
    });
  }

  private setStepState(
    stepID: DesktopRuntimeLifecycleStepID,
    status: DesktopRuntimeLifecycleStepStatus,
    detail = '',
    attemptCount?: number,
  ): void {
    const index = this.stepIndex(stepID);
    this.states.set(stepID, {
      id: stepID,
      key: this.states.get(stepID)?.key ?? this.stepKey(stepID, index < 0 ? this.plan.length : index),
      label: this.states.get(stepID)?.label,
      status,
      ...(compact(detail) ? { detail: compact(detail) } : {}),
      ...(attemptCount !== undefined ? { attempt_count: Math.max(0, Math.floor(attemptCount)) } : {}),
    });
  }

  private stepIndex(stepID: DesktopRuntimeLifecycleStepID): number {
    return this.plan.indexOf(stepID);
  }

  private firstPendingStep(): DesktopRuntimeLifecycleStepState | null {
    return this.stepStates().find((step) => step.status === 'pending') ?? null;
  }

  private stepKey(stepID: DesktopRuntimeLifecycleStepID, index: number): string {
    return `runtime-plan:${index}:${stepID}`;
  }
}
