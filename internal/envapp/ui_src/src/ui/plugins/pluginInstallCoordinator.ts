import { createSignal, type Accessor } from 'solid-js';
import {
  PluginPlatformRequestError,
  type PluginEvent,
  type PluginExecution,
  type PluginPlatformErrorCode,
} from '@floegence/redevplugin-ui';

import type { PluginLifecycleAPI } from './pluginApi';
import type { PluginInstallExecutionProjection } from './pluginTypes';

type InstallLifecycle = Pick<
  PluginLifecycleAPI,
  | 'installOfficialRelease'
  | 'listReleaseInstallExecutions'
  | 'getReleaseInstallExecution'
  | 'listReleaseInstallExecutionEvents'
>;

const RECENT_TERMINAL_FAILURE_MS = 24 * 60 * 60 * 1_000;
const REATTACH_BASE_DELAY_MS = 250;
const REATTACH_MAX_DELAY_MS = 5_000;
const INVENTORY_REFRESH_TIMEOUT_MS = 8_000;

export type PluginInstallCoordinator = Readonly<{
  projections: Accessor<readonly PluginInstallExecutionProjection[]>;
  start: (
    pluginID: string,
    pluginInstanceID: string,
  ) => Promise<void>;
  resume: () => Promise<void>;
  retry: (pluginInstanceID: string) => Promise<void>;
  dispose: () => void;
}>;

export function createPluginInstallCoordinator(options: Readonly<{
  lifecycle: InstallLifecycle;
  refreshInventory: () => Promise<unknown>;
  completeApprovedInstall: (pluginInstanceID: string, signal?: AbortSignal) => Promise<unknown>;
  createRequestID: () => string;
  resolvePluginID: (pluginInstanceID: string) => string | undefined;
}>): PluginInstallCoordinator {
  const [projections, setProjections] = createSignal<readonly PluginInstallExecutionProjection[]>([]);
  const tasks = new Map<string, Promise<void>>();
  const controllers = new Map<string, AbortController>();
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
      await options.completeApprovedInstall(projection.pluginInstanceID, signal);
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

  const start = (
    pluginID: string,
    pluginInstanceID: string,
  ): Promise<void> => runExclusive(pluginInstanceID, async () => {
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
      const execution = await options.lifecycle.installOfficialRelease(
        {
          type: 'install',
          pluginID,
          source: 'official_catalog',
        },
        options.createRequestID(),
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
        put({
          ...current,
          observation: 'failed',
          startFailure: {
            code: error.errorCode,
            retryable: startFailureRetryable(error.errorCode),
          },
        });
        return;
      }
      if (current.execution) {
        put({ ...current, observation: 'reconnecting' });
        await observe(current);
        return;
      }
      put({ ...current, observation: 'failed' });
    } finally {
      if (controllers.get(pluginInstanceID) === controller) controllers.delete(pluginInstanceID);
    }
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
    const retryable = projection.startFailure?.retryable
      || (projection.execution?.status === 'failed' && startFailureRetryable(projection.execution.failure_code ?? ''));
    const pluginID = projection.pluginID || options.resolvePluginID(pluginInstanceID);
    if (!retryable || !pluginID) return;
    remove(pluginInstanceID);
    await start(pluginID, pluginInstanceID);
  };

  const dispose = () => {
    disposed = true;
    for (const controller of controllers.values()) controller.abort('Env App shell disposed');
    controllers.clear();
  };

  return Object.freeze({ projections, start, resume, retry, dispose });
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
    || code === 'PLUGIN_INSTALL_INTERRUPTED';
}
