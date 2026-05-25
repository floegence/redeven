import type {
  DesktopLauncherActionKind,
  DesktopLauncherActionProgress,
  DesktopLauncherOperationSnapshot,
  DesktopLauncherOperationStatus,
  DesktopLauncherOperationSubjectKind,
} from '../shared/desktopLauncherIPC';
import { openConnectionProgress } from '../shared/desktopOpenConnectionProgress';
import type { DesktopOpenConnectionProgress } from '../shared/desktopOpenConnectionProgress';
import type { DesktopRuntimeLifecycleProgress } from '../shared/desktopRuntimeLifecycleProgress';
import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';

type OperationChangeListener = (snapshot: DesktopLauncherOperationSnapshot) => void;

type CreateLauncherOperationInput = Readonly<{
  operation_key: string;
  action: DesktopLauncherActionKind;
  subject_kind: DesktopLauncherOperationSubjectKind;
  subject_id: string;
  environment_id?: string;
  environment_label?: string;
  provider_origin?: string;
  provider_id?: string;
  status?: DesktopLauncherOperationStatus;
  phase: string;
  title: string;
  detail: string;
  lifecycle_progress?: DesktopRuntimeLifecycleProgress;
  open_progress?: DesktopOpenConnectionProgress;
  cancelable?: boolean;
  interrupt_label?: string;
  interrupt_detail?: string;
  interrupt_kind?: DesktopLauncherOperationSnapshot['interrupt_kind'];
  failure?: DesktopOperationFailurePresentation;
  next_actions?: DesktopLauncherOperationSnapshot['next_actions'];
}>;

export type LauncherOperationAttemptIdentity = Readonly<{
  action: DesktopLauncherActionKind;
  started_at_unix_ms: number;
}>;

export type LauncherOperationUpdatePatch = Partial<Omit<
  DesktopLauncherOperationSnapshot,
  'operation_key' | 'action' | 'started_at_unix_ms' | 'subject_kind' | 'subject_id' | 'subject_generation'
>>;

export type LauncherOperationFinishPatch = Partial<Omit<
  DesktopLauncherOperationSnapshot,
  'operation_key' | 'action' | 'started_at_unix_ms' | 'subject_kind' | 'subject_id' | 'subject_generation' | 'status'
>>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function subjectKey(kind: DesktopLauncherOperationSubjectKind, id: string): string {
  return `${kind}:${compact(id)}`;
}

function operationProgress(snapshot: DesktopLauncherOperationSnapshot): DesktopLauncherActionProgress {
  // IMPORTANT: Launcher operations transport structured failure presentation
  // only. The registry must not infer user-facing copy from raw errors.
  return {
    action: snapshot.action,
    operation_key: snapshot.operation_key,
    subject_kind: snapshot.subject_kind,
    subject_id: snapshot.subject_id,
    environment_id: snapshot.environment_id,
    environment_label: snapshot.environment_label,
    started_at_unix_ms: snapshot.started_at_unix_ms,
    updated_at_unix_ms: snapshot.updated_at_unix_ms,
    status: snapshot.status,
    phase: snapshot.phase,
    title: snapshot.title,
    detail: snapshot.detail,
    ...(snapshot.lifecycle_progress ? { lifecycle_progress: snapshot.lifecycle_progress } : {}),
    ...(snapshot.open_progress ? { open_progress: snapshot.open_progress } : {}),
    cancelable: snapshot.cancelable,
    interrupt_label: snapshot.interrupt_label,
    interrupt_detail: snapshot.interrupt_detail,
    interrupt_kind: snapshot.interrupt_kind,
    deleted_subject: snapshot.deleted_subject,
    next_actions: snapshot.next_actions,
    failure: snapshot.failure,
  };
}

function operationAttemptMatches(
  snapshot: DesktopLauncherOperationSnapshot | null,
  attempt: LauncherOperationAttemptIdentity,
): boolean {
  return !!snapshot
    && snapshot.action === attempt.action
    && snapshot.started_at_unix_ms === attempt.started_at_unix_ms;
}

function cancelPhaseForSnapshot(snapshot: DesktopLauncherOperationSnapshot): Readonly<{
  phase: string;
  title: string;
  detail: string;
}> {
  if (snapshot.deleted_subject) {
    return {
      phase: 'canceling_deleted_connection',
      title: 'Connection removed',
      detail: 'Desktop is stopping the startup task for this deleted connection.',
    };
  }
  if (snapshot.lifecycle_progress) {
    return {
      phase: 'runtime_lifecycle_canceling',
      title: 'Stopping runtime startup',
      detail: 'Desktop is stopping the runtime startup and cleaning up resources already created.',
    };
  }
  if (snapshot.open_progress) {
    return {
      phase: 'open_connection_canceling',
      title: 'Stopping open',
      detail: 'Desktop is stopping the connection setup and cleaning up local resources already created.',
    };
  }
  return {
    phase: 'canceling',
    title: 'Stopping operation',
    detail: 'Desktop is stopping this background task.',
  };
}

export class LauncherOperationRegistry {
  private readonly operationsByKey = new Map<string, DesktopLauncherOperationSnapshot>();
  private readonly abortControllersByKey = new Map<string, AbortController>();
  private readonly subjectGenerations = new Map<string, number>();
  private lastStartedAtUnixMs = 0;

  constructor(private readonly onChange: OperationChangeListener = () => undefined) {}

  currentSubjectGeneration(kind: DesktopLauncherOperationSubjectKind, id: string): number {
    return this.subjectGenerations.get(subjectKey(kind, id)) ?? 0;
  }

  bumpSubjectGeneration(kind: DesktopLauncherOperationSubjectKind, id: string): number {
    const key = subjectKey(kind, id);
    const next = (this.subjectGenerations.get(key) ?? 0) + 1;
    this.subjectGenerations.set(key, next);
    return next;
  }

  create(input: CreateLauncherOperationInput): DesktopLauncherOperationSnapshot {
    const now = Date.now();
    const startedAtUnixMs = Math.max(now, this.lastStartedAtUnixMs + 1);
    this.lastStartedAtUnixMs = startedAtUnixMs;
    const operationKey = compact(input.operation_key);
    const subjectID = compact(input.subject_id);
    if (operationKey === '') {
      throw new Error('Launcher operation key is required.');
    }
    if (subjectID === '') {
      throw new Error('Launcher operation subject id is required.');
    }

    const snapshot: DesktopLauncherOperationSnapshot = {
      operation_key: operationKey,
      action: input.action,
      subject_kind: input.subject_kind,
      subject_id: subjectID,
      subject_generation: this.currentSubjectGeneration(input.subject_kind, subjectID),
      environment_id: compact(input.environment_id) || undefined,
      environment_label: compact(input.environment_label) || undefined,
      provider_origin: compact(input.provider_origin) || undefined,
      provider_id: compact(input.provider_id) || undefined,
      started_at_unix_ms: startedAtUnixMs,
      updated_at_unix_ms: startedAtUnixMs,
      status: input.status ?? 'running',
      phase: compact(input.phase),
      title: compact(input.title),
      detail: compact(input.detail),
      ...(input.lifecycle_progress ? { lifecycle_progress: input.lifecycle_progress } : {}),
      ...(input.open_progress ? { open_progress: input.open_progress } : {}),
      cancelable: input.cancelable === true,
      interrupt_label: compact(input.interrupt_label) || undefined,
      interrupt_detail: compact(input.interrupt_detail) || undefined,
      interrupt_kind: input.interrupt_kind,
      deleted_subject: false,
      ...(input.next_actions ? { next_actions: input.next_actions } : {}),
      ...(input.failure ? { failure: input.failure } : {}),
    };
    this.operationsByKey.set(operationKey, snapshot);
    this.abortControllersByKey.set(operationKey, new AbortController());
    this.onChange(snapshot);
    return snapshot;
  }

  operationSignal(operationKey: string): AbortSignal | null {
    return this.abortControllersByKey.get(compact(operationKey))?.signal ?? null;
  }

  get(operationKey: string): DesktopLauncherOperationSnapshot | null {
    return this.operationsByKey.get(compact(operationKey)) ?? null;
  }

  operations(): readonly DesktopLauncherOperationSnapshot[] {
    return [...this.operationsByKey.values()]
      .sort((left, right) => left.started_at_unix_ms - right.started_at_unix_ms || left.operation_key.localeCompare(right.operation_key));
  }

  progressItems(): readonly DesktopLauncherActionProgress[] {
    return this.operations().map(operationProgress);
  }

  update(
    operationKey: string,
    patch: LauncherOperationUpdatePatch,
  ): DesktopLauncherOperationSnapshot | null {
    const key = compact(operationKey);
    const current = this.operationsByKey.get(key);
    if (!current) {
      return null;
    }
    const next: DesktopLauncherOperationSnapshot = {
      ...current,
      ...patch,
      updated_at_unix_ms: Date.now(),
    };
    this.operationsByKey.set(key, next);
    this.onChange(next);
    return next;
  }

  updateCurrentAttempt(
    operationKey: string,
    attempt: LauncherOperationAttemptIdentity,
    patch: LauncherOperationUpdatePatch,
  ): DesktopLauncherOperationSnapshot | null {
    const key = compact(operationKey);
    if (!operationAttemptMatches(this.operationsByKey.get(key) ?? null, attempt)) {
      return null;
    }
    return this.update(key, patch);
  }

  finish(
    operationKey: string,
    status: Extract<DesktopLauncherOperationStatus, 'canceled' | 'cleanup_failed' | 'failed' | 'succeeded'>,
    patch: LauncherOperationFinishPatch = {},
  ): DesktopLauncherOperationSnapshot | null {
    const next = this.update(operationKey, {
      ...patch,
      status,
      cancelable: false,
      next_actions: patch.next_actions,
    });
    this.abortControllersByKey.delete(compact(operationKey));
    return next;
  }

  finishCurrentAttempt(
    operationKey: string,
    attempt: LauncherOperationAttemptIdentity,
    status: Extract<DesktopLauncherOperationStatus, 'canceled' | 'cleanup_failed' | 'failed' | 'succeeded'>,
    patch: LauncherOperationFinishPatch = {},
  ): DesktopLauncherOperationSnapshot | null {
    const key = compact(operationKey);
    if (!operationAttemptMatches(this.operationsByKey.get(key) ?? null, attempt)) {
      return null;
    }
    const next = this.update(key, {
      ...patch,
      status,
      cancelable: false,
      next_actions: patch.next_actions,
    });
    this.abortControllersByKey.delete(key);
    return next;
  }

  remove(operationKey: string): void {
    const key = compact(operationKey);
    this.operationsByKey.delete(key);
    this.abortControllersByKey.delete(key);
  }

  markSubjectDeleted(
    kind: DesktopLauncherOperationSubjectKind,
    id: string,
    patch: Partial<Omit<DesktopLauncherOperationSnapshot, 'operation_key' | 'started_at_unix_ms' | 'subject_kind' | 'subject_id' | 'subject_generation'>> = {},
  ): readonly DesktopLauncherOperationSnapshot[] {
    const subjectID = compact(id);
    this.bumpSubjectGeneration(kind, subjectID);
    const touched: DesktopLauncherOperationSnapshot[] = [];
    for (const snapshot of this.operationsByKey.values()) {
      if (snapshot.subject_kind !== kind || snapshot.subject_id !== subjectID) {
        continue;
      }
      const runtimeLifecycle = snapshot.lifecycle_progress;
      const openConnection = snapshot.open_progress
        ? openConnectionProgress({
            location: snapshot.open_progress.location,
            phase: 'canceled',
            environmentID: snapshot.open_progress.environment_id,
            environmentLabel: snapshot.open_progress.environment_label,
            targetID: snapshot.open_progress.target_id,
            targetLabel: snapshot.open_progress.target_label,
            targetDetail: snapshot.open_progress.target_detail,
          })
        : undefined;
      const next = this.update(snapshot.operation_key, {
        ...patch,
        deleted_subject: true,
        ...(runtimeLifecycle && !patch.lifecycle_progress ? { lifecycle_progress: runtimeLifecycle } : {}),
        ...(openConnection && !patch.open_progress ? { open_progress: openConnection } : {}),
      });
      if (next) {
        touched.push(next);
      }
    }
    return touched;
  }

  isStale(operationKey: string): boolean {
    const snapshot = this.get(operationKey);
    if (!snapshot) {
      return true;
    }
    return snapshot.deleted_subject
      || this.currentSubjectGeneration(snapshot.subject_kind, snapshot.subject_id) !== snapshot.subject_generation;
  }

  cancel(operationKey: string, reason: string): DesktopLauncherOperationSnapshot | null {
    const key = compact(operationKey);
    const snapshot = this.operationsByKey.get(key);
    const controller = this.abortControllersByKey.get(key);
    if (!snapshot || (!snapshot.cancelable && !(snapshot.deleted_subject && controller))) {
      return null;
    }
    if (controller && !controller.signal.aborted) {
      controller.abort(compact(reason) || 'Operation canceled.');
    }
    const cancelPhase = cancelPhaseForSnapshot(snapshot);
    const runtimeLifecycle = snapshot.lifecycle_progress;
    const openConnection = snapshot.open_progress
      ? openConnectionProgress({
          location: snapshot.open_progress.location,
          phase: 'canceled',
          environmentID: snapshot.open_progress.environment_id,
          environmentLabel: snapshot.open_progress.environment_label,
          targetID: snapshot.open_progress.target_id,
          targetLabel: snapshot.open_progress.target_label,
          targetDetail: snapshot.open_progress.target_detail,
        })
      : undefined;
    return this.update(key, {
      status: 'canceling',
      phase: cancelPhase.phase,
      title: cancelPhase.title,
      detail: compact(reason) || cancelPhase.detail,
      ...(runtimeLifecycle ? { lifecycle_progress: runtimeLifecycle } : {}),
      ...(openConnection ? { open_progress: openConnection } : {}),
      cancelable: false,
      interrupt_label: undefined,
      interrupt_detail: undefined,
      interrupt_kind: undefined,
      next_actions: undefined,
    });
  }
}

export function launcherOperationProgress(snapshot: DesktopLauncherOperationSnapshot): DesktopLauncherActionProgress {
  return operationProgress(snapshot);
}
