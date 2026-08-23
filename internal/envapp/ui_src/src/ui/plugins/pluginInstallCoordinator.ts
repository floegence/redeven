import { createSignal, type Accessor } from 'solid-js';
import {
  decodePluginReleaseInstallProgressEvent,
  type PluginExecution,
  type PluginReleaseInstallProgressEvent,
} from '@floegence/redevplugin-ui';

import type { PluginLifecycleAPI } from './pluginApi';
import {
  executionInstallFailure,
  inventoryInstallFailure,
  setupInstallFailure,
  submissionInstallFailure,
} from './pluginInstallFailure';
import type {
  PluginInstallExecutionProjection,
  PluginInventoryProjection,
  PluginOfficialInstallCommand,
} from './pluginTypes';

type InstallLifecycle = Pick<
  PluginLifecycleAPI,
  | 'installOfficialRelease'
  | 'listReleaseInstallExecutions'
  | 'getReleaseInstallExecution'
  | 'listReleaseInstallExecutionEvents'
  | 'getIncompatibleRetainedDataRevision'
  | 'deleteIncompatibleRetainedData'
>;

const RECENT_TERMINAL_FAILURE_MS = 24 * 60 * 60 * 1_000;
const REATTACH_BASE_DELAY_MS = 250;
const REATTACH_MAX_DELAY_MS = 5_000;
const INVENTORY_REFRESH_TIMEOUT_MS = 8_000;

type Attempt = Readonly<{
  generation: number;
  requestID?: string;
  command?: PluginOfficialInstallCommand;
  controller: AbortController;
}>;

export type PluginInstallCoordinator = Readonly<{
  projections: Accessor<readonly PluginInstallExecutionProjection[]>;
  start: (command: PluginOfficialInstallCommand) => Promise<void>;
  forget: (pluginInstanceID: string) => void;
  resume: () => Promise<void>;
  retry: (pluginInstanceID: string) => Promise<void>;
  discardRetainedDataAndRetry: (pluginInstanceID: string) => Promise<void>;
  dispose: () => void;
}>;

export function createPluginInstallCoordinator(options: Readonly<{
  lifecycle: InstallLifecycle;
  refreshInventory: () => Promise<PluginInventoryProjection | undefined>;
  completeApprovedInstall: (
    pluginInstanceID: string,
    inventory: PluginInventoryProjection,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  createRequestID: () => string;
  resolvePluginID: (pluginInstanceID: string) => string | undefined;
  isPluginInstalled?: (pluginInstanceID: string) => boolean;
}>): PluginInstallCoordinator {
  const [projections, setProjections] = createSignal<readonly PluginInstallExecutionProjection[]>([]);
  const attempts = new Map<string, Attempt>();
  const submissions = new Map<string, Promise<void>>();
  const observers = new Map<string, Readonly<{
    executionID: string;
    generation: number;
    promise: Promise<void>;
  }>>();
  const retainedDataRevisions = new Map<string, number>();
  const forgottenPluginInstanceIDs = new Set<string>();
  let nextGeneration = 0;
  let disposed = false;

  const projectionFor = (pluginInstanceID: string) => (
    projections().find((projection) => projection.pluginInstanceID === pluginInstanceID)
  );
  const isCurrent = (pluginInstanceID: string, generation: number) => (
    !disposed && attempts.get(pluginInstanceID)?.generation === generation
  );
  const put = (projection: PluginInstallExecutionProjection, generation: number) => {
    if (!isCurrent(projection.pluginInstanceID, generation)) return;
    setProjections((current) => [
      ...current.filter((candidate) => candidate.pluginInstanceID !== projection.pluginInstanceID),
      projection,
    ]);
  };
  const remove = (pluginInstanceID: string, generation: number) => {
    if (!isCurrent(pluginInstanceID, generation)) return;
    setProjections((current) => current.filter(
      (projection) => projection.pluginInstanceID !== pluginInstanceID,
    ));
  };
  const beginAttempt = (
    pluginInstanceID: string,
    requestID?: string,
    command?: PluginOfficialInstallCommand,
  ): Attempt => {
    attempts.get(pluginInstanceID)?.controller.abort('Plugin installation attempt superseded');
    const attempt = {
      generation: nextGeneration += 1,
      ...(requestID ? { requestID } : {}),
      ...(command ? { command } : {}),
      controller: new AbortController(),
    };
    attempts.set(pluginInstanceID, attempt);
    return attempt;
  };

  const finish = async (
    projection: PluginInstallExecutionProjection,
    attempt: Attempt,
  ): Promise<void> => {
    const execution = projection.execution;
    if (!execution || !isExecutionTerminal(execution)) {
      put(projection, attempt.generation);
      return;
    }
    if (execution.status !== 'completed') {
      put({
        ...projection,
        observation: 'failed',
        failure: projection.failure ?? executionInstallFailure({
          code: execution.failure_code ?? 'PLUGIN_INTERNAL_FAILURE',
          retryable: false,
          // Without a decoded terminal progress event there is no released
          // retryability fact. Return to exact review instead of guessing.
          hasReviewedCommand: false,
        }),
      }, attempt.generation);
      return;
    }

    put({ ...projection, observation: 'refreshing', failure: undefined }, attempt.generation);
    let inventory: PluginInventoryProjection | undefined;
    try {
      inventory = await withTimeout(
        options.refreshInventory(),
        INVENTORY_REFRESH_TIMEOUT_MS,
        attempt.controller.signal,
        'Plugin inventory refresh timed out',
      );
      if (!inventory) throw new Error('Plugin inventory is unavailable');
    } catch {
      put({
        ...projection,
        observation: 'refresh_failed',
        failure: inventoryInstallFailure(),
      }, attempt.generation);
      return;
    }

    put({ ...projection, observation: 'authorizing', failure: undefined }, attempt.generation);
    try {
      await options.completeApprovedInstall(
        projection.pluginInstanceID,
        inventory,
        attempt.controller.signal,
      );
      remove(projection.pluginInstanceID, attempt.generation);
    } catch {
      put({
        ...projection,
        observation: 'activation_failed',
        failure: setupInstallFailure(),
      }, attempt.generation);
    }
  };

  const attachObserver = (
    projection: PluginInstallExecutionProjection,
    attempt: Attempt,
    initialCursor = 0,
  ): Promise<void> => {
    const executionID = projection.execution?.execution_id;
    if (!executionID) {
      put({
        ...projection,
        observation: 'failed',
        failure: submissionInstallFailure(new Error('Installation execution is missing')),
      }, attempt.generation);
      return Promise.resolve();
    }
    const existing = observers.get(projection.pluginInstanceID);
    if (
      existing?.executionID === executionID
      && existing.generation === attempt.generation
    ) return existing.promise;

    const run = observeExecution(projection, attempt, initialCursor).finally(() => {
      const current = observers.get(projection.pluginInstanceID);
      if (current?.promise === run) observers.delete(projection.pluginInstanceID);
    });
    observers.set(projection.pluginInstanceID, {
      executionID,
      generation: attempt.generation,
      promise: run,
    });
    return run;
  };

  const submit = (
    command: PluginOfficialInstallCommand,
    attempt: Attempt,
  ): Promise<void> => {
    const pluginInstanceID = command.pluginInstanceID;
    const existing = submissions.get(pluginInstanceID);
    if (existing) return existing;
    const run = (async () => {
      let projection: PluginInstallExecutionProjection = {
        pluginID: command.pluginID,
        pluginInstanceID,
        observation: 'starting',
        progress: [],
      };
      put(projection, attempt.generation);
      try {
        const execution = await options.lifecycle.installOfficialRelease(
          command,
          attempt.requestID!,
          { signal: attempt.controller.signal },
        );
        if (!isCurrent(pluginInstanceID, attempt.generation)) return;
        projection = { ...projection, observation: 'watching', execution, failure: undefined };
        put(projection, attempt.generation);
        void attachObserver(projection, attempt);
      } catch (error) {
        if (!isCurrent(pluginInstanceID, attempt.generation) || attempt.controller.signal.aborted) return;
        put({
          ...projection,
          observation: 'failed',
          failure: submissionInstallFailure(error),
        }, attempt.generation);
      }
    })().finally(() => {
      if (submissions.get(pluginInstanceID) === run) submissions.delete(pluginInstanceID);
    });
    submissions.set(pluginInstanceID, run);
    return run;
  };

  const start = (command: PluginOfficialInstallCommand): Promise<void> => {
    const pluginInstanceID = command.pluginInstanceID;
    forgottenPluginInstanceIDs.delete(pluginInstanceID);
    const current = projectionFor(pluginInstanceID);
    if (current && installOperationActive(current)) {
      return submissions.get(pluginInstanceID) ?? Promise.resolve();
    }
    const attempt = beginAttempt(pluginInstanceID, options.createRequestID(), command);
    return submit(command, attempt);
  };

  const resume = async (): Promise<void> => {
    if (disposed) return;
    let listed: readonly PluginExecution[];
    try {
      listed = await options.lifecycle.listReleaseInstallExecutions();
    } catch {
      return;
    }
    const latestByPlugin = new Map<string, PluginExecution>();
    for (const execution of listed) {
      if (
        execution.kind !== 'operation'
        || forgottenPluginInstanceIDs.has(execution.plugin_instance_id)
        || !options.resolvePluginID(execution.plugin_instance_id)
      ) continue;
      const previous = latestByPlugin.get(execution.plugin_instance_id);
      if (!previous || executionIsNewer(execution, previous)) {
        latestByPlugin.set(execution.plugin_instance_id, execution);
      }
    }

    const now = Date.now();
    for (const execution of latestByPlugin.values()) {
      const pluginInstanceID = execution.plugin_instance_id;
      if (attempts.has(pluginInstanceID) || observers.has(pluginInstanceID)) continue;
      const pluginID = options.resolvePluginID(pluginInstanceID);
      if (!pluginID) continue;
      if (execution.status === 'completed' && options.isPluginInstalled && !options.isPluginInstalled(pluginInstanceID)) {
        continue;
      }
      if (isExecutionTerminal(execution) && execution.status !== 'completed' && !terminalFailureIsRecent(execution, now)) {
        continue;
      }
      const attempt = beginAttempt(pluginInstanceID);
      const projection: PluginInstallExecutionProjection = {
        pluginID,
        pluginInstanceID,
        observation: execution.status === 'completed' ? 'refreshing' : 'watching',
        execution,
        progress: [],
      };
      put(projection, attempt.generation);
      if (execution.status === 'completed') void finish(projection, attempt);
      else void attachObserver(projection, attempt);
    }
  };

  const retry = async (pluginInstanceID: string): Promise<void> => {
    const projection = projectionFor(pluginInstanceID);
    const previous = attempts.get(pluginInstanceID);
    if (!projection || !previous || !projection.failure) return;

    switch (projection.failure.recovery) {
      case 'refresh_inventory':
      case 'retry_setup': {
        const attempt = beginAttempt(pluginInstanceID, previous.requestID, previous.command);
        await finish({ ...projection, failure: undefined }, attempt);
        return;
      }
      case 'replay_submission': {
        if (!previous.command) return;
        const attempt = beginAttempt(pluginInstanceID, previous.requestID, previous.command);
        await submit(previous.command, attempt);
        return;
      }
      case 'retry_install': {
        if (!previous.command) return;
        const attempt = beginAttempt(pluginInstanceID, options.createRequestID(), previous.command);
        await submit(previous.command, attempt);
        return;
      }
      default:
        return;
    }
  };

  const discardRetainedDataAndRetry = async (pluginInstanceID: string): Promise<void> => {
    const projection = projectionFor(pluginInstanceID);
    const previous = attempts.get(pluginInstanceID);
    if (
      !projection
      || projection.failure?.recovery !== 'erase_retained_data'
      || !previous?.command
    ) return;
    let expectedRevision = retainedDataRevisions.get(pluginInstanceID);
    if (expectedRevision === undefined) {
      expectedRevision = await options.lifecycle.getIncompatibleRetainedDataRevision(
        pluginInstanceID,
        { signal: previous.controller.signal },
      );
      retainedDataRevisions.set(pluginInstanceID, expectedRevision);
    }
    await options.lifecycle.deleteIncompatibleRetainedData(
      pluginInstanceID,
      expectedRevision,
      { signal: previous.controller.signal },
    );
    retainedDataRevisions.delete(pluginInstanceID);
    const attempt = beginAttempt(pluginInstanceID, options.createRequestID(), previous.command);
    await submit(previous.command, attempt);
  };

  const forget = (pluginInstanceID: string) => {
    forgottenPluginInstanceIDs.add(pluginInstanceID);
    attempts.get(pluginInstanceID)?.controller.abort('Plugin was uninstalled');
    attempts.delete(pluginInstanceID);
    submissions.delete(pluginInstanceID);
    observers.delete(pluginInstanceID);
    retainedDataRevisions.delete(pluginInstanceID);
    setProjections((current) => current.filter(
      (projection) => projection.pluginInstanceID !== pluginInstanceID,
    ));
  };

  const dispose = () => {
    disposed = true;
    for (const attempt of attempts.values()) attempt.controller.abort('Env App shell disposed');
    attempts.clear();
    submissions.clear();
    observers.clear();
    retainedDataRevisions.clear();
    forgottenPluginInstanceIDs.clear();
  };

  return Object.freeze({ projections, start, forget, resume, retry, discardRetainedDataAndRetry, dispose });

  async function observeExecution(
    initial: PluginInstallExecutionProjection,
    attempt: Attempt,
    initialCursor: number,
  ): Promise<void> {
    const executionID = initial.execution!.execution_id;
    let current = initial;
    let cursor = initialCursor;
    let reconnectAttempt = 0;
    let terminalObserved = false;
    while (isCurrent(initial.pluginInstanceID, attempt.generation) && !attempt.controller.signal.aborted) {
      try {
        if (terminalObserved) {
          const execution = await options.lifecycle.getReleaseInstallExecution(
            executionID,
            { signal: attempt.controller.signal },
          );
          current = { ...current, execution };
          if (isExecutionTerminal(execution)) {
            await finish(current, attempt);
            return;
          }
          await waitForReattach(REATTACH_BASE_DELAY_MS, attempt.controller.signal);
          continue;
        }
        const eventList = await options.lifecycle.listReleaseInstallExecutionEvents(
          executionID,
          cursor,
          { signal: attempt.controller.signal },
        );
        cursor = Math.max(cursor, eventList.cursor);
        const decoded = eventList.events.flatMap((event) => {
          const progress = decodePluginReleaseInstallProgressEvent(event);
          if (!progress) return [];
          if (attempt.requestID && progress.request_id !== attempt.requestID) return [];
          return [progress];
        });
        const progress = mergeProgress(current.progress, decoded);
        const failedProgress = latestFailedProgress(decoded) ?? latestFailedProgress(progress);
        current = {
          ...current,
          observation: 'watching',
          progress,
          ...(failedProgress ? {
            failure: executionInstallFailure({
              code: failedProgress.failure_code!,
              stage: failedProgress.failure_stage,
              retryable: failedProgress.retryable!,
              hasReviewedCommand: Boolean(attempt.command),
            }),
          } : { failure: undefined }),
        };
        put(current, attempt.generation);

        if (eventList.events.some((event) => event.kind === 'terminal')) {
          const matchingTerminal = decoded.some((progress) => (
            progress.status === 'completed' || progress.status === 'failed'
          ));
          if (attempt.requestID && !matchingTerminal) {
            current = {
              ...current,
              failure: executionInstallFailure({
                code: 'PLUGIN_INTERNAL_FAILURE',
                retryable: false,
                hasReviewedCommand: false,
              }),
            };
          }
          terminalObserved = true;
          const execution = await options.lifecycle.getReleaseInstallExecution(
            executionID,
            { signal: attempt.controller.signal },
          );
          current = { ...current, execution };
          if (isExecutionTerminal(execution)) {
            await finish(current, attempt);
            return;
          }
        }
        reconnectAttempt = 0;
        if (eventList.events.length >= 1_000) continue;
        await waitForReattach(REATTACH_BASE_DELAY_MS, attempt.controller.signal);
      } catch {
        if (!isCurrent(initial.pluginInstanceID, attempt.generation) || attempt.controller.signal.aborted) return;
        put({ ...current, observation: 'reconnecting' }, attempt.generation);
        const delay = Math.min(REATTACH_BASE_DELAY_MS * (2 ** reconnectAttempt), REATTACH_MAX_DELAY_MS);
        reconnectAttempt += 1;
        await waitForReattach(delay, attempt.controller.signal);
      }
    }
  }
}

function isExecutionTerminal(execution: PluginExecution): boolean {
  return execution.status === 'completed'
    || execution.status === 'canceled'
    || execution.status === 'failed'
    || execution.status === 'orphaned';
}

function installOperationActive(projection: PluginInstallExecutionProjection): boolean {
  return projection.observation === 'starting'
    || projection.observation === 'watching'
    || projection.observation === 'reconnecting'
    || projection.observation === 'refreshing'
    || projection.observation === 'authorizing';
}

function mergeProgress(
  current: readonly PluginReleaseInstallProgressEvent[],
  incoming: readonly PluginReleaseInstallProgressEvent[],
): readonly PluginReleaseInstallProgressEvent[] {
  const byStage = new Map(current.map((progress) => [progress.stage, progress]));
  for (const progress of incoming) byStage.set(progress.stage, progress);
  return ['download', 'verify', 'install', 'enable'].flatMap((stage) => {
    const progress = byStage.get(stage as PluginReleaseInstallProgressEvent['stage']);
    return progress ? [progress] : [];
  });
}

function latestFailedProgress(
  progress: readonly PluginReleaseInstallProgressEvent[],
): PluginReleaseInstallProgressEvent | undefined {
  for (let index = progress.length - 1; index >= 0; index -= 1) {
    if (progress[index]?.status === 'failed') return progress[index];
  }
  return undefined;
}

function waitForReattach(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  message: string,
): Promise<T> {
  if (signal?.aborted) throw signal.reason;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
    abort = () => reject(signal?.reason ?? new Error('Plugin execution was aborted'));
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    if (signal && abort) signal.removeEventListener('abort', abort);
  }
}

function executionIsNewer(candidate: PluginExecution, current: PluginExecution): boolean {
  const candidateUpdatedAt = Date.parse(candidate.updated_at);
  const currentUpdatedAt = Date.parse(current.updated_at);
  if (candidateUpdatedAt !== currentUpdatedAt) return candidateUpdatedAt > currentUpdatedAt;
  return candidate.execution_id > current.execution_id;
}

function terminalFailureIsRecent(execution: PluginExecution, now: number): boolean {
  if (!isExecutionTerminal(execution) || !execution.terminal_at) return false;
  const terminalAt = Date.parse(execution.terminal_at);
  return Number.isFinite(terminalAt) && terminalAt <= now && terminalAt >= now - RECENT_TERMINAL_FAILURE_MS;
}
