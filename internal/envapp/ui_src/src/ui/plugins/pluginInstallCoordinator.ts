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
> & Partial<Pick<PluginLifecycleAPI, 'authorizeAndEnablePlugin'>>;

const RECENT_TERMINAL_FAILURE_MS = 24 * 60 * 60 * 1_000;
const REATTACH_BASE_DELAY_MS = 250;
const REATTACH_MAX_DELAY_MS = 5_000;
// Enabling a freshly installed plugin may cold-start its worker runtime and
// publish surfaces. The operation remains bounded, but 12 seconds was shorter
// than the observed cold path and turned a successful mutation into a retry.
const ACTIVATION_TIMEOUT_MS = 90_000;
const INVENTORY_REFRESH_TIMEOUT_MS = 8_000;

export type PluginInstallCoordinator = Readonly<{
  projections: Accessor<readonly PluginInstallOperationProjection[]>;
  start: (
    pluginID: string,
    pluginInstanceID: string,
    approvedPermissionIDs?: readonly string[],
  ) => Promise<void>;
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

  const finish = async (
    projection: PluginInstallOperationProjection,
    signal?: AbortSignal,
  ): Promise<void> => {
    const operation = projection.operation;
    if (!operation) {
      put(projection);
      return;
    }
    if (operation.status === 'failed') {
      put({ ...projection, observation: 'failed' });
      return;
    }
    if (operation.status !== 'succeeded') {
      put(projection);
      return;
    }
    const missingPermissionIDs = operation.activation.status === 'needs_attention'
      ? operation.activation.missing_permission_ids ?? []
      : [];
    if (options.lifecycle.authorizeAndEnablePlugin
      && (operation.activation.status === 'needs_attention'
        || operation.activation.next_action === 'retry_activation')) {
      const activating = {
        ...projection,
        observation: 'activating' as const,
        activationFailure: undefined,
      };
      put(activating);
      try {
        await withTimeout(
          options.lifecycle.authorizeAndEnablePlugin(
            projection.pluginInstanceID,
            missingPermissionIDs,
            { signal },
          ),
          ACTIVATION_TIMEOUT_MS,
          signal,
          'Plugin setup timed out',
        );
      } catch (error) {
        // A timed out mutation may have committed. Refresh the authoritative
        // inventory once, then expose a bounded retry instead of leaving the
        // card in an endless post-install spinner.
        try {
          await withTimeout(
            options.refreshInventory(),
            INVENTORY_REFRESH_TIMEOUT_MS,
            signal,
            'Plugin inventory refresh timed out',
          );
          const reconciled = await withTimeout(
            options.lifecycle.getReleaseInstallOperationByRequest(
              projection.requestID,
              { signal },
            ),
            INVENTORY_REFRESH_TIMEOUT_MS,
            signal,
            'Plugin installation reconciliation timed out',
          );
          if (reconciled.activation.status === 'enabled') {
            remove(projection.pluginInstanceID);
            return;
          }
        } catch {
          // The activation failure remains the actionable terminal state.
        }
        put({
          ...projection,
          observation: 'activation_failed',
          activationFailure: {
            message: error instanceof Error ? error.message : 'Plugin activation did not complete',
            retryable: true,
          },
        });
        return;
      }
    }
    put({ ...projection, observation: 'refreshing' });
    try {
      await withTimeout(
        options.refreshInventory(),
        INVENTORY_REFRESH_TIMEOUT_MS,
        signal,
        'Plugin inventory refresh timed out',
      );
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
    let operation = initialOperation;
    let reconnectAttempt = 0;
    try {
      while (!disposed && !controller.signal.aborted) {
        try {
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
          await finish(current, controller.signal);
          return;
        } catch {
          if (disposed || controller.signal.aborted) return;
          put({ ...projectionFor(projection.pluginInstanceID) ?? projection, observation: 'reconnecting' });
          operation = undefined;
          const delay = Math.min(
            REATTACH_BASE_DELAY_MS * (2 ** reconnectAttempt),
            REATTACH_MAX_DELAY_MS,
          );
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
    approvedPermissionIDs: readonly string[] = [],
  ): Promise<void> => {
    // A terminal operation can outlive its registry record (for example after
    // an uninstall). An explicit new Install must be allowed to supersede
    // that historical observation instead of reusing its completed promise.
    const existing = tasks.get(pluginInstanceID);
    const existingProjection = projectionFor(pluginInstanceID);
    if (existing && existingProjection?.operation
      && (existingProjection.operation.status === 'succeeded'
        || existingProjection.operation.status === 'failed')) {
      controllers.get(pluginInstanceID)?.abort('Superseded terminal install operation');
      tasks.delete(pluginInstanceID);
      remove(pluginInstanceID);
    }
    return runExclusive(pluginInstanceID, async () => {
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
          {
            type: 'install',
            pluginID,
            source: 'official_catalog',
            ...(approvedPermissionIDs.length > 0 ? { approvedPermissionIDs } : {}),
          },
          requestID,
          { signal: controller.signal },
          (update) => {
            current = { ...current, observation: 'watching', operation: update };
            put(current);
          },
        );
        current = { ...current, observation: 'watching', operation };
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
        } else {
          current = { ...current, observation: 'reconnecting' };
          put(current);
          await observe(current);
        }
      } finally {
        if (controllers.get(pluginInstanceID) === controller) controllers.delete(pluginInstanceID);
      }
    });
  };

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
      if (operation.status === 'succeeded' && operation.activation.status !== 'needs_attention') continue;
      if (operation.status === 'failed' && !terminalFailureIsRecent(operation, now)) continue;
      candidates.set(operation.plugin_instance_id, {
        pluginID: options.resolvePluginID(operation.plugin_instance_id) ?? '',
        pluginInstanceID: operation.plugin_instance_id,
        requestID: operation.request_id,
        observation: operation.status === 'failed' ? 'failed' : 'watching',
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
        await withTimeout(
          options.refreshInventory(),
          INVENTORY_REFRESH_TIMEOUT_MS,
          undefined,
          'Plugin inventory refresh timed out',
        );
        remove(pluginInstanceID);
      } catch {
        put({ ...projection, observation: 'refresh_failed' });
      }
      return;
    }
    if (projection.observation === 'activation_failed') {
      await runExclusive(pluginInstanceID, () => observe({
        ...projection,
        observation: 'watching',
        activationFailure: undefined,
      }, projection.operation));
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
    abort = () => reject(signal?.reason ?? new Error('Plugin operation was aborted'));
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    if (signal && abort) signal.removeEventListener('abort', abort);
  }
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

function startFailureRetryable(code: PluginPlatformErrorCode): boolean {
  return code === 'PLUGIN_RELEASE_NETWORK'
    || code === 'PLUGIN_RELEASE_TIMEOUT'
    || code === 'PLUGIN_INSTALL_INTERRUPTED';
}
