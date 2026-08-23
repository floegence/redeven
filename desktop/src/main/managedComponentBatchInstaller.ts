import type { DesktopComponentTaskProgress } from '../shared/desktopLauncherIPC';

export type ManagedComponentKind = 'gateway' | 'runtime';
export type ManagedComponentTaskProgress = DesktopComponentTaskProgress & Readonly<{
  id: ManagedComponentKind;
}>;

export type ManagedComponentTask = Readonly<{
  component: ManagedComponentKind;
  strategy: 'desktop_upload' | 'remote_install';
  release_tag: string;
  commit: string;
  platform: string;
  architecture: string;
}>;

export type PreparedComponent = Readonly<{
  task: ManagedComponentTask;
  staging_id: string;
  evidence: Readonly<{
    archive_sha256: string;
    archive_size_bytes: number;
    executable_sha256: string;
    reported_release_tag: string;
    reported_commit: string;
  }>;
  /** Opaque package handle owned by the task implementation. */
  value: unknown;
}>;

export type ManagedComponentSuiteManifestEntry = Readonly<{
  component: ManagedComponentKind;
  strategy: ManagedComponentTask['strategy'];
  release_tag: string;
  commit: string;
  platform: string;
  architecture: string;
  staging_id: string;
  archive_sha256: string;
  archive_size_bytes: number;
  executable_sha256: string;
}>;

export type PreparedComponentBatch = Readonly<{
  operation_id: string;
  tasks: readonly PreparedComponent[];
  suite_manifest: Readonly<{
    release_tag: string;
    commit: string;
    platform: string;
    architecture: string;
    components: readonly ManagedComponentSuiteManifestEntry[];
  }>;
}>;

export type ManagedComponentTaskRunner = (
  task: ManagedComponentTask,
  signal: AbortSignal,
  onProgress: (progress: ManagedComponentTaskProgress) => void,
) => Promise<PreparedComponent>;

export type ManagedComponentBatchInstallerOptions = Readonly<{
  operation_id?: string;
  run: ManagedComponentTaskRunner;
  activate?: (batch: PreparedComponentBatch) => Promise<void>;
  discard?: (batch: PreparedComponentBatch) => Promise<void>;
}>;

function abortError(): DOMException {
  return new DOMException('Managed component batch was canceled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : abortError();
  }
}

function validateTasks(tasks: readonly ManagedComponentTask[]): void {
  if (tasks.length === 0) {
    throw new Error('A managed component batch must contain at least one task.');
  }
  const components = new Set<ManagedComponentKind>();
  for (const task of tasks) {
    if (components.has(task.component)) {
      throw new Error(`Managed component batch contains duplicate ${task.component} task.`);
    }
    components.add(task.component);
  }
  const releaseTag = tasks[0]?.release_tag;
  const commit = tasks[0]?.commit;
  const platform = tasks[0]?.platform;
  const architecture = tasks[0]?.architecture;
  if (tasks.some((task) => (
    task.release_tag !== releaseTag
    || task.commit !== commit
    || task.platform !== platform
    || task.architecture !== architecture
  ))) {
    throw new Error('Managed component batch has inconsistent release, commit, platform, or architecture metadata.');
  }
}

function validatePreparedComponent(prepared: PreparedComponent): void {
  const { task, evidence } = prepared;
  if (prepared.staging_id.trim() === '') {
    throw new Error(`Managed ${task.component} staging identity is missing.`);
  }
  if (!/^[a-f0-9]{64}$/u.test(evidence.archive_sha256)) {
    throw new Error(`Managed ${task.component} archive digest is invalid.`);
  }
  if (!Number.isSafeInteger(evidence.archive_size_bytes) || evidence.archive_size_bytes <= 0) {
    throw new Error(`Managed ${task.component} archive size is invalid.`);
  }
  if (!/^[a-f0-9]{64}$/u.test(evidence.executable_sha256)) {
    throw new Error(`Managed ${task.component} executable digest is invalid.`);
  }
  if (evidence.reported_release_tag !== task.release_tag || evidence.reported_commit !== task.commit) {
    throw new Error(`Managed ${task.component} package identity does not match the batch target.`);
  }
}

function suiteEntry(prepared: PreparedComponent): ManagedComponentSuiteManifestEntry {
  return {
    component: prepared.task.component,
    strategy: prepared.task.strategy,
    release_tag: prepared.task.release_tag,
    commit: prepared.task.commit,
    platform: prepared.task.platform,
    architecture: prepared.task.architecture,
    staging_id: prepared.staging_id,
    archive_sha256: prepared.evidence.archive_sha256,
    archive_size_bytes: prepared.evidence.archive_size_bytes,
    executable_sha256: prepared.evidence.executable_sha256,
  };
}

function partialBatch(
  tasks: readonly ManagedComponentTask[],
  prepared: readonly PreparedComponent[],
  operationID?: string,
): PreparedComponentBatch {
  const releaseTag = tasks[0]?.release_tag ?? '';
  const commit = tasks[0]?.commit ?? '';
  const platform = tasks[0]?.platform ?? '';
  const architecture = tasks[0]?.architecture ?? '';
  const preparedByComponent = new Map(
    prepared.map((item) => [item.task.component, item]),
  );
  const ordered = tasks
    .map((task) => preparedByComponent.get(task.component))
    .filter((item): item is PreparedComponent => item !== undefined);
  return {
    operation_id: operationID ?? 'batch',
    tasks: ordered,
    suite_manifest: {
      release_tag: releaseTag,
      commit,
      platform,
      architecture,
      components: ordered.map(suiteEntry),
    },
  };
}

/**
 * Prepare and transfer all requested components together. A failed component
 * cancels its siblings and no caller may activate a partial batch.
 */
export async function prepareAndStageBatch(
  tasks: readonly ManagedComponentTask[],
  signal: AbortSignal,
  onProgress: (progress: ManagedComponentTaskProgress) => void,
  options: ManagedComponentBatchInstallerOptions,
): Promise<PreparedComponentBatch> {
  validateTasks(tasks);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal.reason);
  if (signal.aborted) {
    abortFromParent();
  } else {
    signal.addEventListener('abort', abortFromParent, { once: true });
  }
  const prepared: PreparedComponent[] = [];
  try {
    const results = await Promise.allSettled(tasks.map(async (task) => {
      throwIfAborted(controller.signal);
      try {
        const result = await options.run(task, controller.signal, onProgress);
        validatePreparedComponent(result);
        prepared.push(result);
        return result;
      } catch (error) {
        // Abort siblings immediately. Promise.allSettled below still waits for
        // their cleanup so no upload or staging process is left behind.
        controller.abort(error);
        throw error;
      }
    }));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) {
      controller.abort(failure.reason);
      throw signal.aborted ? (signal.reason ?? failure.reason) : failure.reason;
    }
    throwIfAborted(controller.signal);
    const releaseTag = tasks[0]?.release_tag ?? '';
    const commit = tasks[0]?.commit ?? '';
    const platform = tasks[0]?.platform ?? '';
    const architecture = tasks[0]?.architecture ?? '';
    const batch: PreparedComponentBatch = {
      operation_id: options.operation_id ?? 'batch',
      tasks: tasks.map((task) => prepared.find((item) => item.task.component === task.component)!).filter(Boolean),
      suite_manifest: {
        release_tag: releaseTag,
        commit,
        platform,
        architecture,
        components: tasks.map((task) => suiteEntry(prepared.find((item) => item.task.component === task.component)!)),
      },
    };
    if (batch.tasks.length !== tasks.length) {
      throw new Error('Managed component batch did not produce every requested component.');
    }
    return batch;
  } catch (error) {
    controller.abort(error);
    // A parent cancellation, metadata error, or incomplete result can occur
    // after one or more tasks have staged successfully. Always discard the
    // complete partial batch before returning the failure to the operation.
    await options.discard?.(partialBatch(tasks, prepared, options.operation_id)).catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', abortFromParent);
  }
}

export async function activateBatch(
  batch: PreparedComponentBatch,
  options: ManagedComponentBatchInstallerOptions,
): Promise<void> {
  if (batch.tasks.length !== batch.suite_manifest.components.length) {
    throw new Error('Cannot activate an incomplete managed component batch.');
  }
  await options.activate?.(batch);
}

export async function discardBatch(
  batch: PreparedComponentBatch,
  options: ManagedComponentBatchInstallerOptions,
): Promise<void> {
  await options.discard?.(batch);
}
