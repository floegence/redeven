import { createSignal, type Accessor } from 'solid-js';
import {
  PluginPlatformRequestError,
  type PluginPlatformErrorCode,
  type PluginReleaseInstallOperation,
} from '@floegence/redevplugin-ui';

import type { PluginLifecycleAPI } from './pluginApi';
import type { PluginInstallOperationProjection } from './pluginTypes';

type InstallLifecycle = Pick<
  PluginLifecycleAPI,
  | 'installOfficialRelease'
  | 'listReleaseInstallOperations'
  | 'getReleaseInstallOperationByRequest'
  | 'watchReleaseInstallOperation'
>;

const RECENT_TERMINAL_FAILURE_MS = 24 * 60 * 60 * 1_000;

export type PluginInstallCoordinator = Readonly<{
  projections: Accessor<readonly PluginInstallOperationProjection[]>;
  start: (pluginID: string, pluginInstanceID: string) => Promise<void>;
  resume: () => Promise<void>;
  retry: (pluginInstanceID: string) => Promise<void>;
  dispose: () => void;
}>;

export function createPluginInstallCoordinator(options: Readonly<{
  lifecycle: InstallLifecycle;
  refreshInventory: () => Promise<unknown>;
  createRequestID: () => string;
  resolvePluginID: (pluginInstanceID: string) => string | undefined;
}>): PluginInstallCoordinator {
  const [projections, setProjections] = createSignal<readonly PluginInstallOperationProjection[]>([]);
  const tasks = new Map<string, Promise<void>>();
  const controllers = new Map<string, AbortController>();
  let disposed = false;

  const projectionFor = (pluginInstanceID: string) => (
    projections().find((projection) => projection.pluginInstanceID === pluginInstanceID)
  );
  const put = (projection: PluginInstallOperationProjection) => {
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
  const runExclusive = (
    pluginInstanceID: string,
    operation: () => Promise<void>,
  ): Promise<void> => {
    const existing = tasks.get(pluginInstanceID);
    if (existing) return existing;
    const task = operation().finally(() => {
      if (tasks.get(pluginInstanceID) === task) tasks.delete(pluginInstanceID);
    });
    tasks.set(pluginInstanceID, task);
    return task;
  };

  const finish = async (projection: PluginInstallOperationProjection): Promise<void> => {
    const operation = projection.operation;
    if (!operation || operation.status === 'failed') {
      put({ ...projection, observation: 'watching' });
      return;
    }
    if (operation.status !== 'succeeded') {
      put(projection);
      return;
    }
    put({ ...projection, observation: 'refreshing' });
    try {
      await options.refreshInventory();
      remove(projection.pluginInstanceID);
    } catch {
      put({ ...projection, observation: 'refresh_failed' });
    }
  };

  const observe = async (
    projection: PluginInstallOperationProjection,
    initialOperation?: PluginReleaseInstallOperation,
  ): Promise<void> => {
    const controller = new AbortController();
    controllers.get(projection.pluginInstanceID)?.abort('Plugin installation observation superseded');
    controllers.set(projection.pluginInstanceID, controller);
    try {
      let operation = initialOperation;
      if (!operation) {
        operation = await options.lifecycle.getReleaseInstallOperationByRequest(
          projection.requestID,
          { signal: controller.signal },
        );
      }
      let current: PluginInstallOperationProjection = {
        ...projection,
        requestID: operation.request_id,
        observation: 'watching',
        operation,
        startFailure: undefined,
      };
      put(current);
      if (operation.status !== 'succeeded' && operation.status !== 'failed') {
        operation = await options.lifecycle.watchReleaseInstallOperation(
          operation.operation_id,
          { signal: controller.signal },
          (update) => {
            current = { ...current, observation: 'watching', operation: update };
            put(current);
          },
        );
        current = { ...current, observation: 'watching', operation };
      }
      await finish(current);
    } catch {
      if (!disposed && !controller.signal.aborted) {
        put({ ...projectionFor(projection.pluginInstanceID) ?? projection, observation: 'reconnecting' });
      }
    } finally {
      if (controllers.get(projection.pluginInstanceID) === controller) {
        controllers.delete(projection.pluginInstanceID);
      }
    }
  };

  const start = (pluginID: string, pluginInstanceID: string): Promise<void> => (
    runExclusive(pluginInstanceID, async () => {
      const active = projections().some((projection) => (
        projection.pluginInstanceID !== pluginInstanceID && projectionIsActive(projection)
      ));
      if (active) return;
      const requestID = options.createRequestID();
      const controller = new AbortController();
      controllers.get(pluginInstanceID)?.abort('Plugin installation submission superseded');
      controllers.set(pluginInstanceID, controller);
      let current: PluginInstallOperationProjection = {
        pluginID,
        pluginInstanceID,
        requestID,
        observation: 'starting',
      };
      put(current);
      try {
        const operation = await options.lifecycle.installOfficialRelease(
          { type: 'install', pluginID, source: 'official_catalog' },
          requestID,
          { signal: controller.signal },
          (update) => {
            current = { ...current, observation: 'watching', operation: update };
            put(current);
          },
        );
        current = { ...current, observation: 'watching', operation };
        await finish(current);
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        if (error instanceof PluginPlatformRequestError) {
          put({
            ...current,
            observation: 'watching',
            startFailure: {
              code: error.errorCode,
              retryable: startFailureRetryable(error.errorCode),
            },
          });
        } else {
          current = { ...current, observation: 'reconnecting' };
          put(current);
          await observe(current);
        }
      } finally {
        if (controllers.get(pluginInstanceID) === controller) controllers.delete(pluginInstanceID);
      }
    })
  );

  const resume = async (): Promise<void> => {
    if (disposed) return;
    let listed: readonly PluginReleaseInstallOperation[] = [];
    try {
      listed = await options.lifecycle.listReleaseInstallOperations();
    } catch {
      return;
    }
    const latestByPlugin = new Map<string, PluginReleaseInstallOperation>();
    for (const operation of listed) {
      const previous = latestByPlugin.get(operation.plugin_instance_id);
      if (!previous || releaseInstallOperationIsNewer(operation, previous)) {
        latestByPlugin.set(operation.plugin_instance_id, operation);
      }
    }
    const now = Date.now();
    const candidates = new Map<string, PluginInstallOperationProjection>();
    for (const operation of latestByPlugin.values()) {
      if (operation.status === 'succeeded') continue;
      if (operation.status === 'failed' && !terminalFailureIsRecent(operation, now)) continue;
      candidates.set(operation.plugin_instance_id, {
        pluginID: options.resolvePluginID(operation.plugin_instance_id) ?? '',
        pluginInstanceID: operation.plugin_instance_id,
        requestID: operation.request_id,
        observation: 'watching',
        operation,
      });
    }
    for (const projection of projections()) {
      if (projection.observation === 'reconnecting') {
        candidates.set(projection.pluginInstanceID, projection);
      }
    }
    await Promise.all([...candidates.values()].map((projection) => (
      runExclusive(projection.pluginInstanceID, () => observe(
        projection,
        projection.observation === 'reconnecting' ? undefined : projection.operation,
      ))
    )));
  };

  const retry = async (pluginInstanceID: string): Promise<void> => {
    const projection = projectionFor(pluginInstanceID);
    if (!projection) return;
    if (projection.observation === 'refresh_failed') {
      put({ ...projection, observation: 'refreshing' });
      try {
        await options.refreshInventory();
        remove(pluginInstanceID);
      } catch {
        put({ ...projection, observation: 'refresh_failed' });
      }
      return;
    }
    if (projection.observation === 'reconnecting') {
      await runExclusive(pluginInstanceID, () => observe(projection));
      return;
    }
    const failure = projection.operation?.failure ?? projection.startFailure;
    if (!failure?.retryable) return;
    const pluginID = projection.pluginID || options.resolvePluginID(pluginInstanceID);
    if (!pluginID) return;
    remove(pluginInstanceID);
    await start(pluginID, pluginInstanceID);
  };

  const dispose = () => {
    disposed = true;
    for (const controller of controllers.values()) {
      controller.abort('Env App shell disposed');
    }
    controllers.clear();
  };

  return Object.freeze({ projections, start, resume, retry, dispose });
}

function releaseInstallOperationIsNewer(
  candidate: PluginReleaseInstallOperation,
  current: PluginReleaseInstallOperation,
): boolean {
  const candidateCreatedAt = Date.parse(candidate.created_at);
  const currentCreatedAt = Date.parse(current.created_at);
  const candidateHasValidTime = Number.isFinite(candidateCreatedAt);
  const currentHasValidTime = Number.isFinite(currentCreatedAt);
  if (candidateHasValidTime !== currentHasValidTime) return candidateHasValidTime;
  if (candidateHasValidTime && candidateCreatedAt !== currentCreatedAt) {
    return candidateCreatedAt > currentCreatedAt;
  }
  return candidate.operation_id > current.operation_id;
}

function terminalFailureIsRecent(
  operation: PluginReleaseInstallOperation,
  now: number,
): boolean {
  if (operation.status !== 'failed' || !operation.terminal_at) return false;
  const terminalAt = Date.parse(operation.terminal_at);
  return Number.isFinite(terminalAt)
    && terminalAt <= now
    && terminalAt >= now - RECENT_TERMINAL_FAILURE_MS;
}

function projectionIsActive(projection: PluginInstallOperationProjection): boolean {
  if (
    projection.observation === 'starting'
    || projection.observation === 'reconnecting'
    || projection.observation === 'refreshing'
  ) {
    return true;
  }
  return projection.observation === 'watching'
    && projection.operation?.status !== 'succeeded'
    && projection.operation?.status !== 'failed';
}

function startFailureRetryable(code: PluginPlatformErrorCode): boolean {
  return code === 'PLUGIN_RELEASE_NETWORK'
    || code === 'PLUGIN_RELEASE_TIMEOUT'
    || code === 'PLUGIN_INSTALL_INTERRUPTED';
}
