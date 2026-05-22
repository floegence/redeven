import {
  runtimeLifecyclePhaseSequence,
  runtimeLifecycleProgress,
  type DesktopRuntimeLifecycleLocation,
  type DesktopRuntimeLifecycleOperation,
  type DesktopRuntimeLifecyclePhase,
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

export type RuntimeLifecycleStepUpdate = Readonly<{
  title: string;
  detail: string;
  progress: DesktopRuntimeLifecycleProgress;
}>;

export class RuntimeLifecycleWorkflow {
  private readonly phases: readonly DesktopRuntimeLifecyclePhase[];
  private readonly states = new Map<DesktopRuntimeLifecycleStepID, DesktopRuntimeLifecycleStepState>();
  private activeStepID: DesktopRuntimeLifecycleStepID;
  private failedStepID: DesktopRuntimeLifecycleStepID | null = null;

  constructor(private readonly context: RuntimeLifecycleWorkflowContext) {
    this.phases = runtimeLifecyclePhaseSequence(context.location, context.operation);
    this.activeStepID = this.phases[0] ?? 'checking_existing_runtime';
    for (const phase of this.phases) {
      this.states.set(phase, {
        id: phase,
        status: 'pending',
      });
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
    for (const step of progress.steps) {
      workflow.setStepState(step.id, step.status, step.detail, step.attempt_count);
    }
    workflow.activeStepID = progress.active_step_id;
    workflow.failedStepID = progress.failed_step_id ?? null;
    return workflow;
  }

  beginStep(
    stepID: DesktopRuntimeLifecycleStepID,
    detail = '',
    attemptCount?: number,
  ): RuntimeLifecycleStepUpdate {
    const nextIndex = this.stepIndex(stepID);
    const activeIndex = this.stepIndex(this.activeStepID);
    if (nextIndex < activeIndex) {
      return {
        title: '',
        detail,
        progress: this.progress(),
      };
    }
    const currentRunning = this.stepStates().find((step) => step.status === 'running');
    if (currentRunning && this.stepIndex(currentRunning.id) < nextIndex) {
      this.setStepState(currentRunning.id, 'succeeded');
    }
    this.activeStepID = stepID;
    this.failedStepID = null;
    this.setStepState(stepID, 'running', detail, attemptCount);
    for (const phase of this.phases.slice(nextIndex + 1)) {
      const state = this.states.get(phase);
      if (state?.status === 'failed') {
        this.setStepState(phase, 'pending');
      }
    }
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
    const observedIndex = this.stepIndex(stepID);
    const activeIndex = this.stepIndex(this.activeStepID);
    if (observedIndex < activeIndex) {
      return null;
    }
    if (observedIndex === activeIndex) {
      const current = this.states.get(this.activeStepID);
      if (current?.status === 'succeeded') {
        return null;
      }
      return this.updateStep(detail, attemptCount);
    }
    return this.beginStep(stepID, detail, attemptCount);
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
    this.setStepState(stepID, 'succeeded');
    this.activeStepID = stepID;
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
    this.failedStepID = stepID;
    this.activeStepID = stepID;
    for (const phase of this.phases.slice(0, failedIndex)) {
      const state = this.states.get(phase);
      if (state?.status === 'running') {
        this.setStepState(phase, 'succeeded', state.detail, state.attempt_count);
      }
    }
    this.setStepState(stepID, 'failed', compact(stepFailure.presentation.summary));
    for (const phase of this.phases.slice(failedIndex + 1)) {
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
      phase: this.activeStepID,
      failedPhase: this.failedStepID ?? undefined,
      stepStates: this.stepStates(),
      targetID: this.context.target_id,
      targetLabel: this.context.target_label,
      targetDetail: this.context.target_detail,
    });
  }

  stepStates(): readonly DesktopRuntimeLifecycleStepState[] {
    return this.phases.map((phase) => this.states.get(phase) ?? {
      id: phase,
      status: 'pending' as const,
    });
  }

  private setStepState(
    stepID: DesktopRuntimeLifecycleStepID,
    status: DesktopRuntimeLifecycleStepStatus,
    detail = '',
    attemptCount?: number,
  ): void {
    this.states.set(stepID, {
      id: stepID,
      status,
      ...(compact(detail) ? { detail: compact(detail) } : {}),
      ...(attemptCount !== undefined ? { attempt_count: Math.max(0, Math.floor(attemptCount)) } : {}),
    });
  }

  private stepIndex(stepID: DesktopRuntimeLifecycleStepID): number {
    const index = this.phases.indexOf(stepID);
    return index >= 0 ? index : this.phases.length;
  }
}
