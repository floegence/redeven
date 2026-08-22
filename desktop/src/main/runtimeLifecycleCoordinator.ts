import path from 'node:path';

import {
  desktopRuntimePlacementStateRoot,
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import { desktopSSHAuthority } from '../shared/desktopSSH';

export type RuntimeLifecycleIntent = 'start' | 'stop' | 'restart' | 'update';

export type RuntimeLifecycleOperationSnapshot = Readonly<{
  target_key: string;
  intent: RuntimeLifecycleIntent;
  fingerprint: string;
  operation_key: string;
  started_at_unix_ms: number;
}>;

type ActiveRuntimeLifecycleOperation = RuntimeLifecycleOperationSnapshot & Readonly<{
  token: symbol;
  task: Promise<unknown>;
  controller: AbortController;
  detachInputSignal: () => void;
}>;

export class RuntimeLifecycleInProgressError extends Error {
  readonly code = 'runtime_lifecycle_in_progress';

  constructor(readonly active_operation: RuntimeLifecycleOperationSnapshot) {
    super(active_operation.intent === 'stop'
      ? 'The Runtime is stopping and cannot be started or opened until shutdown finishes.'
      : `Runtime lifecycle operation ${active_operation.intent} is already in progress.`);
    this.name = 'RuntimeLifecycleInProgressError';
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function required(value: unknown, label: string): string {
  const normalized = compact(value);
  if (normalized === '') {
    throw new Error(`${label} is required for runtime lifecycle coordination.`);
  }
  return normalized;
}

function targetKey(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

function normalizedStateRoot(
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
): string {
  const stateRoot = required(desktopRuntimePlacementStateRoot(placement), 'Runtime state root');
  return hostAccess.kind === 'local_host' && placement.kind === 'host_process'
    ? path.resolve(stateRoot)
    : path.posix.normalize(stateRoot);
}

export function runtimeLifecycleTargetKey(
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
): string {
  const stateRoot = normalizedStateRoot(hostAccess, placement);
  if (hostAccess.kind === 'local_host') {
    if (placement.kind === 'host_process') {
      return targetKey(['local_host', 'host_process', stateRoot]);
    }
    return targetKey([
      'local_host',
      'container_process',
      required(placement.container_engine, 'Container engine'),
      required(placement.container_id, 'Container identity'),
      stateRoot,
    ]);
  }
  const sshAuthority = required(desktopSSHAuthority(hostAccess.ssh), 'SSH authority');
  if (placement.kind === 'host_process') {
    return targetKey(['ssh_host', sshAuthority, 'host_process', stateRoot]);
  }
  return targetKey([
    'ssh_host',
    sshAuthority,
    'container_process',
    required(placement.container_engine, 'Container engine'),
    required(placement.container_id, 'Container identity'),
    stateRoot,
  ]);
}

export function runtimeLifecycleFingerprint(parts: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(canonicalFingerprintValue(parts));
}

function canonicalFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalFingerprintValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalFingerprintValue(entryValue)]),
    );
  }
  return value;
}

export class RuntimeLifecycleCoordinator {
  private readonly activeByTargetKey = new Map<string, ActiveRuntimeLifecycleOperation>();
  private lastStartedAtUnixMs = 0;

  active(targetKeyValue: string): RuntimeLifecycleOperationSnapshot | null {
    const active = this.activeByTargetKey.get(required(targetKeyValue, 'Runtime lifecycle target key'));
    return active ? this.snapshot(active) : null;
  }

  operations(): readonly RuntimeLifecycleOperationSnapshot[] {
    return [...this.activeByTargetKey.values()]
      .map((operation) => this.snapshot(operation))
      .sort((left, right) => left.started_at_unix_ms - right.started_at_unix_ms);
  }

  async waitForIdle(targetKeyValue: string): Promise<void> {
    const active = this.activeByTargetKey.get(required(targetKeyValue, 'Runtime lifecycle target key'));
    await active?.task.catch(() => undefined);
  }

  async waitForAll(): Promise<void> {
    await Promise.allSettled([...this.activeByTargetKey.values()].map((operation) => operation.task));
  }

  cancel(targetKeyValue: string, reason?: unknown): RuntimeLifecycleOperationSnapshot | null {
    const active = this.activeByTargetKey.get(required(targetKeyValue, 'Runtime lifecycle target key'));
    if (!active) {
      return null;
    }
    if (!active.controller.signal.aborted) {
      active.controller.abort(reason ?? new DOMException('Runtime lifecycle operation was canceled.', 'AbortError'));
    }
    return this.snapshot(active);
  }

  cancelByOperationKey(operationKeyValue: string, reason?: unknown): RuntimeLifecycleOperationSnapshot | null {
    const operationKey = required(operationKeyValue, 'Runtime lifecycle operation key');
    const active = [...this.activeByTargetKey.values()].find((operation) => operation.operation_key === operationKey);
    return active ? this.cancel(active.target_key, reason) : null;
  }

  async waitForReadyMutation(targetKeyValue: string): Promise<RuntimeLifecycleOperationSnapshot | null> {
    const key = required(targetKeyValue, 'Runtime lifecycle target key');
    const active = this.activeByTargetKey.get(key);
    if (!active) {
      return null;
    }
    if (active.intent === 'stop') {
      throw new RuntimeLifecycleInProgressError(this.snapshot(active));
    }
    await active.task;
    return this.snapshot(active);
  }

  run<T>(input: Readonly<{
    target_key: string;
    intent: RuntimeLifecycleIntent;
    fingerprint: string;
    operation_key: string;
    signal?: AbortSignal;
    execute: (signal: AbortSignal) => Promise<T>;
  }>): Promise<T> {
    const key = required(input.target_key, 'Runtime lifecycle target key');
    const fingerprint = required(input.fingerprint, 'Runtime lifecycle fingerprint');
    const operationKey = required(input.operation_key, 'Runtime lifecycle operation key');
    const existing = this.activeByTargetKey.get(key);
    if (existing) {
      if (existing.intent === input.intent && existing.fingerprint === fingerprint) {
        return existing.task as Promise<T>;
      }
      return Promise.reject(new RuntimeLifecycleInProgressError(this.snapshot(existing)));
    }

    const token = Symbol(key);
    const now = Date.now();
    const startedAtUnixMs = Math.max(now, this.lastStartedAtUnixMs + 1);
    this.lastStartedAtUnixMs = startedAtUnixMs;
    const controller = new AbortController();
    const abortFromInput = () => {
      if (!controller.signal.aborted) {
        controller.abort(input.signal?.reason ?? new DOMException('Runtime lifecycle operation was canceled.', 'AbortError'));
      }
    };
    input.signal?.addEventListener('abort', abortFromInput, { once: true });
    if (input.signal?.aborted) {
      abortFromInput();
    }
    let resolveTask!: (value: T | PromiseLike<T>) => void;
    let rejectTask!: (reason?: unknown) => void;
    const task = new Promise<T>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    const operation: ActiveRuntimeLifecycleOperation = {
      target_key: key,
      intent: input.intent,
      fingerprint,
      operation_key: operationKey,
      started_at_unix_ms: startedAtUnixMs,
      token,
      task,
      controller,
      detachInputSignal: () => input.signal?.removeEventListener('abort', abortFromInput),
    };
    this.activeByTargetKey.set(key, operation);
    try {
      resolveTask(input.execute(controller.signal));
    } catch (error) {
      rejectTask(error);
    }
    void task.then(
      () => this.release(key, token),
      () => this.release(key, token),
    );
    return task;
  }

  private release(targetKeyValue: string, token: symbol): void {
    const active = this.activeByTargetKey.get(targetKeyValue);
    if (active?.token === token) {
      active.detachInputSignal();
      this.activeByTargetKey.delete(targetKeyValue);
    }
  }

  private snapshot(operation: ActiveRuntimeLifecycleOperation): RuntimeLifecycleOperationSnapshot {
    return {
      target_key: operation.target_key,
      intent: operation.intent,
      fingerprint: operation.fingerprint,
      operation_key: operation.operation_key,
      started_at_unix_ms: operation.started_at_unix_ms,
    };
  }
}
