import { createSignal } from 'solid-js';

import { fetchLocalApi, fetchLocalApiJSON } from '../services/localApi';

export type ManagedOperation = Readonly<{
  operation_id: string;
  service_id: string;
  action: 'install' | 'start' | 'stop' | 'restart' | 'retry_install' | 'update' | 'reconfigure' | 'uninstall';
  state: string;
  stage: string;
  progress_current: number;
  progress_total: number;
  error_code?: string;
  error_message?: string;
}>;

export type ManagedOperationOwner = 'row' | 'install' | 'update' | 'reconfigure' | 'uninstall';

type ManagedOperationControllerOptions = Readonly<{
  streamFailedMessage: () => string;
  timedOutMessage: () => string;
}>;

type ActiveStream = Readonly<{
  controller: AbortController;
  promise: Promise<ManagedOperation>;
}>;

type ManagedOperationState = Readonly<{
  operation: ManagedOperation;
  owner: ManagedOperationOwner;
}>;

const operationTerminal = (operation: ManagedOperation) => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(operation.state);

function submittingStage(action: ManagedOperation['action']): string {
  switch (action) {
    case 'start': return 'starting';
    case 'stop':
    case 'restart':
    case 'uninstall': return 'stopping';
    case 'update': return 'update_preparing';
    case 'reconfigure': return 'reconfigure_preflight';
    default: return 'environment_check';
  }
}

function operationProgressTotal(action: ManagedOperation['action']): number {
  switch (action) {
    case 'start': return 3;
    case 'stop': return 2;
    case 'restart': return 4;
    case 'reconfigure': return 5;
    case 'uninstall': return 3;
    default: return 7;
  }
}

export function createManagedServiceOperationController(options: ManagedOperationControllerOptions) {
  const [states, setStates] = createSignal<Record<string, ManagedOperationState>>({});
  const streams = new Map<string, ActiveStream>();

  const update = (operation: ManagedOperation, owner?: ManagedOperationOwner) => {
    setStates((current) => {
      const existing = current[operation.service_id];
      const resolvedOwner = existing?.operation.operation_id === operation.operation_id
        ? existing.owner
        : owner ?? 'row';
      return { ...current, [operation.service_id]: { operation, owner: resolvedOwner } };
    });
  };

  const begin = (serviceID: string, action: ManagedOperation['action'], owner: ManagedOperationOwner): ManagedOperation => {
    const operation: ManagedOperation = {
      operation_id: `submitting:${serviceID}:${action}`,
      service_id: serviceID,
      action,
      state: 'submitting',
      stage: submittingStage(action),
      progress_current: 0,
      progress_total: operationProgressTotal(action),
    };
    update(operation, owner);
    return operation;
  };

  const track = (operation: ManagedOperation, owner: ManagedOperationOwner): Promise<ManagedOperation> => {
    update(operation, owner);
    if (operationTerminal(operation)) return Promise.resolve(operation);
    const existing = streams.get(operation.operation_id);
    if (existing) return existing.promise;

    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 35 * 60_000);
    const promise = (async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      try {
        const response = await fetchLocalApi(`/_redeven_proxy/api/managed-web-service-operations/${encodeURIComponent(operation.operation_id)}/events`, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(options.streamFailedMessage());
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? '';
          for (const event of events) {
            const data = event.split(/\r?\n/)
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('\n');
            if (!data) continue;
            try {
              const snapshot = JSON.parse(data) as ManagedOperation;
              update(snapshot);
              if (operationTerminal(snapshot)) return snapshot;
            } catch {
              // Continue until the stream provides a complete operation snapshot.
            }
          }
        }
        throw new Error(options.streamFailedMessage());
      } catch (error) {
        if (timedOut) throw new Error(options.timedOutMessage());
        throw error;
      } finally {
        window.clearTimeout(timeout);
        await reader?.cancel().catch(() => undefined);
      }
    })().finally(() => {
      if (streams.get(operation.operation_id)?.controller === controller) streams.delete(operation.operation_id);
    });
    streams.set(operation.operation_id, { controller, promise });
    return promise;
  };

  const clear = (operationID: string) => {
    setStates((current) => {
      const serviceID = Object.keys(current).find((key) => current[key]?.operation.operation_id === operationID);
      if (!serviceID) return current;
      const next = { ...current };
      delete next[serviceID];
      return next;
    });
  };

  const cancel = async (operation: ManagedOperation) => {
    const updated = await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-service-operations/${encodeURIComponent(operation.operation_id)}/cancel`, { method: 'POST' });
    update(updated);
    return updated;
  };

  const ownedOperation = (serviceID: string, owner: ManagedOperationOwner) => {
    const state = states()[serviceID];
    return state?.owner === owner ? state.operation : null;
  };
  const knows = (operationID: string) => Object.values(states()).some((state) => state.operation.operation_id === operationID);

  const dispose = () => {
    for (const stream of streams.values()) stream.controller.abort();
    streams.clear();
  };

  return { begin, track, clear, cancel, ownedOperation, knows, dispose };
}
