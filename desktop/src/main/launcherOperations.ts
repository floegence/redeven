import type {
  DesktopLauncherActionKind,
  DesktopLauncherActionProgress,
  DesktopLauncherOperationSnapshot,
  DesktopLauncherOperationStatus,
  DesktopLauncherOperationSubjectKind,
} from '../shared/desktopLauncherIPC';

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
  phase: string;
  title: string;
  detail: string;
  cancelable?: boolean;
  interrupt_label?: string;
  interrupt_detail?: string;
  interrupt_kind?: DesktopLauncherOperationSnapshot['interrupt_kind'];
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function subjectKey(kind: DesktopLauncherOperationSubjectKind, id: string): string {
  return `${kind}:${compact(id)}`;
}

function operationProgress(snapshot: DesktopLauncherOperationSnapshot): DesktopLauncherActionProgress {
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
    cancelable: snapshot.cancelable,
    interrupt_label: snapshot.interrupt_label,
    interrupt_detail: snapshot.interrupt_detail,
    interrupt_kind: snapshot.interrupt_kind,
    deleted_subject: snapshot.deleted_subject,
    error_message: snapshot.error_message,
  };
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
  if (snapshot.subject_kind === 'ssh_environment' && snapshot.action === 'start_environment_runtime') {
    return {
      phase: 'ssh_stopping_startup',
      title: 'Stopping SSH runtime startup',
      detail: 'Desktop is stopping the SSH runtime startup and cleaning up resources already created.',
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
      started_at_unix_ms: now,
      updated_at_unix_ms: now,
      status: 'running',
      phase: compact(input.phase),
      title: compact(input.title),
      detail: compact(input.detail),
      cancelable: input.cancelable === true,
      interrupt_label: compact(input.interrupt_label) || undefined,
      interrupt_detail: compact(input.interrupt_detail) || undefined,
      interrupt_kind: input.interrupt_kind,
      deleted_subject: false,
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
    patch: Partial<Omit<DesktopLauncherOperationSnapshot, 'operation_key' | 'started_at_unix_ms' | 'subject_kind' | 'subject_id' | 'subject_generation'>>,
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

  finish(
    operationKey: string,
    status: Extract<DesktopLauncherOperationStatus, 'canceled' | 'cleanup_failed' | 'failed' | 'succeeded'>,
    patch: Partial<Omit<DesktopLauncherOperationSnapshot, 'operation_key' | 'started_at_unix_ms' | 'subject_kind' | 'subject_id' | 'subject_generation' | 'status'>> = {},
  ): DesktopLauncherOperationSnapshot | null {
    const next = this.update(operationKey, {
      ...patch,
      status,
      cancelable: false,
    });
    this.abortControllersByKey.delete(compact(operationKey));
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
      const next = this.update(snapshot.operation_key, {
        ...patch,
        deleted_subject: true,
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
    return this.update(key, {
      status: 'canceling',
      phase: cancelPhase.phase,
      title: cancelPhase.title,
      detail: compact(reason) || cancelPhase.detail,
      cancelable: false,
      interrupt_label: undefined,
      interrupt_detail: undefined,
      interrupt_kind: undefined,
    });
  }
}

export function launcherOperationProgress(snapshot: DesktopLauncherOperationSnapshot): DesktopLauncherActionProgress {
  return operationProgress(snapshot);
}
