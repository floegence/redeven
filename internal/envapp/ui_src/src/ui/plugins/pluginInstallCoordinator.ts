import { createSignal, type Accessor } from 'solid-js';
import {
  PluginPlatformRequestError,
  PluginTransportError,
  type PluginEvent,
  type PluginExecution,
  type PluginPlatformErrorCode,
} from '@floegence/redevplugin-ui';

import type { PluginLifecycleAPI } from './pluginApi';
import type { ApprovedOfficialInstallSetupResult } from './pluginApprovedInstallSetup';
import type { OfficialPluginReleaseInspection, PluginInstallExecutionProjection } from './pluginTypes';

type InstallLifecycle = Pick<
  PluginLifecycleAPI,
  | 'installOfficialRelease'
  | 'inspectOfficialRelease'
  | 'listReleaseInstallExecutions'
  | 'getReleaseInstallExecution'
  | 'listReleaseInstallExecutionEvents'
  | 'deleteIncompatibleRetainedData'
>;

const RECENT_TERMINAL_FAILURE_MS = 24 * 60 * 60 * 1_000;
const REATTACH_BASE_DELAY_MS = 250;
const REATTACH_MAX_DELAY_MS = 5_000;
const INVENTORY_REFRESH_TIMEOUT_MS = 8_000;

export type PluginInstallRetirementFence = Readonly<{
  managementRevision: number;
  generation: number;
}>;

export type PluginInstallCoordinator = Readonly<{
  projections: Accessor<readonly PluginInstallExecutionProjection[]>;
  start: (
    pluginID: string,
    pluginInstanceID: string,
    inspection: OfficialPluginReleaseInspection,
  ) => Promise<void>;
  resume: () => Promise<void>;
  retry: (pluginInstanceID: string) => Promise<void>;
  discardRetainedDataAndRetry: (pluginInstanceID: string) => Promise<void>;
  dispose: () => void;
}>;

export function createPluginInstallCoordinator(options: Readonly<{
  lifecycle: InstallLifecycle;
  refreshInventory: () => Promise<unknown>;
  refreshMarket: () => Promise<unknown>;
  completeApprovedInstall: (
    pluginInstanceID: string,
    signal?: AbortSignal,
  ) => Promise<ApprovedOfficialInstallSetupResult>;
  captureInstallRetirementFence: (pluginInstanceID: string) => PluginInstallRetirementFence | undefined;
  onInstallReady: (pluginInstanceID: string, fence: PluginInstallRetirementFence) => void;
  createRequestID: () => string;
  resolvePluginID: (pluginInstanceID: string) => string | undefined;
}>): PluginInstallCoordinator {
  const [projections, setProjections] = createSignal<readonly PluginInstallExecutionProjection[]>([]);
  const tasks = new Map<string, Promise<void>>();
  const controllers = new Map<string, AbortController>();
  const completedPostInstallExecutionByInstanceID = new Map<string, string>();
  const installRetirementFenceByInstanceID = new Map<string, PluginInstallRetirementFence>();
  let disposed = false;

  const projectionFor = (pluginInstanceID: string) => (
    projections().find((projection) => projection.pluginInstanceID === pluginInstanceID)
  );
  const put = (projection: PluginInstallExecutionProjection) => {
    if (disposed) return;
    setProjections((current) => [
      ...current.filter((candidate) => candidate.pluginInstanceID !== projection.pluginInstanceID),
      projection,
    ]);
  };
  const remove = (pluginInstanceID: string) => {
    if (disposed) return;
    setProjections((current) => current.filter(
      (projection) => projection.pluginInstanceID !== pluginInstanceID,
    ));
  };
  const runExclusive = (pluginInstanceID: string, run: () => Promise<void>): Promise<void> => {
    const existing = tasks.get(pluginInstanceID);
    if (existing) return existing;
    const task = run().finally(() => {
      if (tasks.get(pluginInstanceID) === task) tasks.delete(pluginInstanceID);
    });
    tasks.set(pluginInstanceID, task);
    return task;
  };

  const finish = async (projection: PluginInstallExecutionProjection, signal?: AbortSignal) => {
    const execution = projection.execution;
    if (!execution || !isExecutionTerminal(execution)) {
      put(projection);
      return;
    }
    if (execution.status !== 'completed') {
      put({ ...projection, observation: 'failed' });
      return;
    }
    if (completedPostInstallExecutionByInstanceID.get(projection.pluginInstanceID) === execution.execution_id) {
      remove(projection.pluginInstanceID);
      return;
    }
    put({ ...projection, observation: 'refreshing' });
    try {
      await withTimeout(
        options.refreshInventory(),
        INVENTORY_REFRESH_TIMEOUT_MS,
        signal,
        'Plugin inventory refresh timed out',
      );
    } catch {
      put({ ...projection, observation: 'refresh_failed' });
      return;
    }
    put({ ...projection, observation: 'authorizing' });
    try {
      const setup = await options.completeApprovedInstall(projection.pluginInstanceID, signal);
      if (setup === 'ready') {
        const fence = installRetirementFenceByInstanceID.get(projection.pluginInstanceID);
        if (fence) options.onInstallReady(projection.pluginInstanceID, fence);
      }
      completedPostInstallExecutionByInstanceID.set(
        projection.pluginInstanceID,
        execution.execution_id,
      );
      installRetirementFenceByInstanceID.delete(projection.pluginInstanceID);
      remove(projection.pluginInstanceID);
    } catch {
      put({ ...projection, observation: 'activation_failed' });
    }
  };

  const observe = async (projection: PluginInstallExecutionProjection): Promise<void> => {
    const executionID = projection.execution?.execution_id;
    if (!executionID) {
      put({ ...projection, observation: 'failed' });
      return;
    }
    const controller = new AbortController();
    controllers.get(projection.pluginInstanceID)?.abort('Plugin installation observation superseded');
    controllers.set(projection.pluginInstanceID, controller);
    let reconnectAttempt = 0;
    let current = projection;
    try {
      while (!disposed && !controller.signal.aborted) {
        try {
          const execution = await options.lifecycle.getReleaseInstallExecution(
            executionID,
            { signal: controller.signal },
          );
          const eventList = await options.lifecycle.listReleaseInstallExecutionEvents(
            executionID,
            latestEventCursor(current.events),
            { signal: controller.signal },
          );
          current = {
            ...current,
            observation: 'watching',
            execution,
            events: mergeEvents(current.events, eventList.events),
            startFailure: undefined,
          };
          put(current);
          if (isExecutionTerminal(execution)) {
            await finish(current, controller.signal);
            return;
          }
          reconnectAttempt = 0;
          await waitForReattach(REATTACH_BASE_DELAY_MS, controller.signal);
        } catch {
          if (disposed || controller.signal.aborted) return;
          put({ ...current, observation: 'reconnecting' });
          const delay = Math.min(REATTACH_BASE_DELAY_MS * (2 ** reconnectAttempt), REATTACH_MAX_DELAY_MS);
          reconnectAttempt += 1;
          await waitForReattach(delay, controller.signal);
        }
      }
    } finally {
      if (controllers.get(projection.pluginInstanceID) === controller) {
        controllers.delete(projection.pluginInstanceID);
      }
    }
  };

  const startWithInspection = (
    pluginID: string,
    pluginInstanceID: string,
    resolveInspection: (signal: AbortSignal) => Promise<OfficialPluginReleaseInspection>,
    existingSubmission?: NonNullable<PluginInstallExecutionProjection['submission']>,
    captureRetirementFence = false,
  ): Promise<void> => runExclusive(pluginInstanceID, async () => {
    if (captureRetirementFence) {
      const fence = options.captureInstallRetirementFence(pluginInstanceID);
      if (fence) installRetirementFenceByInstanceID.set(pluginInstanceID, fence);
      else installRetirementFenceByInstanceID.delete(pluginInstanceID);
    }
    const controller = new AbortController();
    controllers.get(pluginInstanceID)?.abort('Plugin installation submission superseded');
    controllers.set(pluginInstanceID, controller);
    let current: PluginInstallExecutionProjection = {
      pluginID,
      pluginInstanceID,
      observation: 'starting',
      events: [],
    };
    put(current);
    try {
      const inspection = existingSubmission?.inspection ?? await resolveInspection(controller.signal);
      const submission = existingSubmission ?? {
        requestID: options.createRequestID(),
        inspection,
        retrySameRequest: false,
      };
      current = { ...current, submission };
      put(current);
      const execution = await options.lifecycle.installOfficialRelease(
        {
          type: 'install',
          pluginID,
          source: 'official_catalog',
        },
        inspection,
        submission.requestID,
        { signal: controller.signal },
        (update, events) => {
          current = {
            ...current,
            observation: 'watching',
            execution: update,
            events: mergeEvents(current.events, events),
          };
          put(current);
        },
      );
      current = { ...current, observation: 'watching', execution };
      await finish(current, controller.signal);
    } catch (error) {
      if (disposed || controller.signal.aborted) return;
      if (error instanceof PluginPlatformRequestError) {
        const retryable = startFailureRetryable(error.errorCode);
        put({
          ...current,
          observation: 'failed',
          ...(current.submission
            ? {
                submission: {
                  ...current.submission,
                  retrySameRequest: retryable && error.mutationOutcome === 'unknown',
                },
              }
            : {}),
          startFailure: {
            code: error.errorCode,
            retryable,
          },
        });
        return;
      }
      if (error instanceof PluginTransportError) {
        put({
          ...current,
          observation: 'failed',
          ...(current.submission
            ? { submission: { ...current.submission, retrySameRequest: true } }
            : {}),
          startFailure: { code: 'PLUGIN_RELEASE_NETWORK', retryable: true },
        });
        return;
      }
      if (current.execution) {
        put({ ...current, observation: 'reconnecting' });
        await observe(current);
        return;
      }
      put({
        ...current,
        observation: 'failed',
        startFailure: { code: 'PLUGIN_INTERNAL_FAILURE', retryable: false },
      });
    } finally {
      if (controllers.get(pluginInstanceID) === controller) controllers.delete(pluginInstanceID);
    }
  });

  const start = (
    pluginID: string,
    pluginInstanceID: string,
    inspection: OfficialPluginReleaseInspection,
  ): Promise<void> => startWithInspection(
    pluginID,
    pluginInstanceID,
    async () => inspection,
    undefined,
    true,
  );

  const startWithFreshInspection = (
    pluginID: string,
    pluginInstanceID: string,
    refreshMarket: boolean,
  ): Promise<void> => startWithInspection(pluginID, pluginInstanceID, async (signal) => {
    if (refreshMarket) await options.refreshMarket();
    return options.lifecycle.inspectOfficialRelease(pluginID, { signal });
  });

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
      if (execution.kind !== 'operation' || !options.resolvePluginID(execution.plugin_instance_id)) continue;
      const previous = latestByPlugin.get(execution.plugin_instance_id);
      if (!previous || executionIsNewer(execution, previous)) {
        latestByPlugin.set(execution.plugin_instance_id, execution);
      }
    }
    const now = Date.now();
    await Promise.all([...latestByPlugin.values()].flatMap((execution) => {
      if (execution.status === 'completed') {
        if (completedPostInstallExecutionByInstanceID.get(execution.plugin_instance_id) === execution.execution_id) {
          remove(execution.plugin_instance_id);
          return [];
        }
        const projection: PluginInstallExecutionProjection = {
          pluginID: options.resolvePluginID(execution.plugin_instance_id) ?? '',
          pluginInstanceID: execution.plugin_instance_id,
          observation: 'refreshing',
          execution,
          events: [],
        };
        put(projection);
        return [runExclusive(execution.plugin_instance_id, () => finish(projection))];
      }
      if (isExecutionTerminal(execution) && !terminalFailureIsRecent(execution, now)) return [];
      const projection: PluginInstallExecutionProjection = {
        pluginID: options.resolvePluginID(execution.plugin_instance_id) ?? '',
        pluginInstanceID: execution.plugin_instance_id,
        observation: isExecutionTerminal(execution) ? 'failed' : 'watching',
        execution,
        events: [],
      };
      put(projection);
      return [runExclusive(execution.plugin_instance_id, () => observe(projection))];
    }));
  };

  const retry = async (pluginInstanceID: string): Promise<void> => {
    const projection = projectionFor(pluginInstanceID);
    if (!projection) return;
    if (projection.observation === 'refresh_failed' || projection.observation === 'activation_failed') {
      if (projection.execution?.status === 'completed') {
        await runExclusive(pluginInstanceID, () => finish(projection));
        return;
      }
      put({ ...projection, observation: 'refreshing' });
      try {
        await withTimeout(options.refreshInventory(), INVENTORY_REFRESH_TIMEOUT_MS, undefined, 'Plugin inventory refresh timed out');
        remove(pluginInstanceID);
      } catch {
        put({ ...projection, observation: 'refresh_failed' });
      }
      return;
    }
    if (projection.observation === 'reconnecting' && projection.execution) {
      await runExclusive(pluginInstanceID, () => observe(projection));
      return;
    }
    if (projection.startFailure?.retryable && projection.submission?.retrySameRequest) {
      remove(pluginInstanceID);
      await startWithInspection(
        projection.pluginID,
        pluginInstanceID,
        async () => projection.submission!.inspection,
        projection.submission,
      );
      return;
    }
    const retryable = projection.startFailure?.retryable
      || (projection.execution?.status === 'failed' && startFailureRetryable(projection.execution.failure_code ?? ''));
    const pluginID = projection.pluginID || options.resolvePluginID(pluginInstanceID);
    if (!retryable || !pluginID) return;
    const refreshMarket = failureCode(projection) === 'PLUGIN_RELEASE_INSPECTION_STALE';
    remove(pluginInstanceID);
    await startWithFreshInspection(pluginID, pluginInstanceID, refreshMarket);
  };

  const discardRetainedDataAndRetry = async (pluginInstanceID: string): Promise<void> => {
    const projection = projectionFor(pluginInstanceID);
    const pluginID = projection?.pluginID || options.resolvePluginID(pluginInstanceID);
    if (!projection || !pluginID || projection.execution?.failure_code !== 'PLUGIN_RETAINED_DATA_INCOMPATIBLE') return;
    await runExclusive(pluginInstanceID, () => options.lifecycle.deleteIncompatibleRetainedData(pluginInstanceID));
    remove(pluginInstanceID);
    await startWithFreshInspection(pluginID, pluginInstanceID, false);
  };

  const dispose = () => {
    disposed = true;
    for (const controller of controllers.values()) controller.abort('Env App shell disposed');
    controllers.clear();
    completedPostInstallExecutionByInstanceID.clear();
    installRetirementFenceByInstanceID.clear();
  };

  return Object.freeze({ projections, start, resume, retry, discardRetainedDataAndRetry, dispose });
}

function isExecutionTerminal(execution: PluginExecution): boolean {
  return execution.status === 'completed'
    || execution.status === 'canceled'
    || execution.status === 'failed'
    || execution.status === 'orphaned';
}

function latestEventCursor(events: readonly PluginEvent[]): number {
  return events.reduce((cursor, event) => Math.max(cursor, event.sequence), 0);
}

function mergeEvents(current: readonly PluginEvent[], incoming: readonly PluginEvent[]): readonly PluginEvent[] {
  const events = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) events.set(event.sequence, event);
  return [...events.values()].sort((left, right) => left.sequence - right.sequence);
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal | undefined, message: string): Promise<T> {
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

function startFailureRetryable(code: PluginPlatformErrorCode | string): boolean {
  return code === 'PLUGIN_RELEASE_NETWORK'
    || code === 'PLUGIN_RELEASE_TIMEOUT'
    || code === 'PLUGIN_INSTALL_INTERRUPTED'
    || code === 'PLUGIN_RELEASE_INSPECTION_EXPIRED'
    || code === 'PLUGIN_RELEASE_INSPECTION_STALE'
    || code === 'PLUGIN_RUNTIME_UNAVAILABLE';
}

function failureCode(projection: PluginInstallExecutionProjection): string | undefined {
  return projection.startFailure?.code ?? projection.execution?.failure_code;
}
