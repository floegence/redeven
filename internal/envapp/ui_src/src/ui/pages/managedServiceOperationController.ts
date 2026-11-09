import { isSessionEventAuthorizationError, readSessionEvents } from '../services/sessionHTTP';
import { createSignal } from 'solid-js';

import { fetchLocalApiJSON } from '../services/localApi';

export type ManagedOperation = Readonly<{
	cancel_requested?: boolean;
  observation_error?: string;
  request_id?: string;
  operation_id: string;
  service_id: string;
  action: 'install' | 'start' | 'stop' | 'restart' | 'retry' | 'retry_install' | 'update' | 'reconfigure' | 'uninstall' | 'detach' | 'restore' | 'recover';
  state: string;
  stage: string;
  progress_current: number;
  progress_total: number;
  created_at_unix_ms?: number;
  updated_at_unix_ms?: number;
  finished_at_unix_ms?: number;
  progress_detail?: Readonly<{
    schema_version: 2;
    stage_started_at_unix_ms?: number;
    updated_at_unix_ms?: number;
    transfer?: Readonly<{
      phase?: string;
      artifact_reference?: string;
      artifact_index?: number;
      artifact_total?: number;
      downloaded_bytes?: number;
      total_bytes?: number;
      bytes_per_second?: number;
      completed_layers?: number;
      total_layers?: number;
    }>;
    commands?: ReadonlyArray<Readonly<{
      command_id: string;
      display: string;
      state: 'running' | 'succeeded' | 'failed' | 'cancelled';
      started_at_unix_ms?: number;
      finished_at_unix_ms?: number;
    }>>;
    output?: ReadonlyArray<Readonly<{
      sequence: number;
      command_id: string;
      stream: 'stdout' | 'stderr';
      text: string;
    }>>;
    output_truncated?: boolean;
  }>;
  error_code?: string;
  error_message?: string;
  delete_data?: boolean;
  delete_workspace?: boolean;
}>;

export type ManagedOperationControllerOptions = Readonly<{
  streamFailedMessage: () => string;
  canObserve?: () => boolean;
  onSubmittingOperationAccepted?: (submittingOperationID: string, operationID: string) => void;
  onOperationUpdated?: (operation: ManagedOperation) => void;
  onOperationReleased?: (operationID: string) => void;
}>;

type ActiveStream = Readonly<{
  controller: AbortController;
  promise: Promise<ManagedOperation>;
}>;

type ManagedOperationState = Readonly<{
  operation: ManagedOperation;
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
  const listeners = new Set<ManagedOperationControllerOptions>([options]);
  const released = new Set<string>();
  let generation = 0;
  let submissionSequence = 0;

  const update = (operation: ManagedOperation) => {
    const previous = states()[operation.service_id]?.operation;
    if (previous?.operation_id === operation.operation_id) {
      if (operationTerminal(previous) && !operationTerminal(operation)) return previous;
      if ((previous.updated_at_unix_ms ?? 0) > (operation.updated_at_unix_ms ?? 0)) return previous;
    }
    if (previous?.state === 'submitting' && previous.operation_id !== operation.operation_id) {
      for (const listener of listeners) listener.onSubmittingOperationAccepted?.(previous.operation_id, operation.operation_id);
    }
    if (previous && previous.operation_id !== operation.operation_id) released.delete(previous.operation_id);
    setStates((current) => ({ ...current, [operation.service_id]: { operation } }));
    for (const listener of listeners) listener.onOperationUpdated?.(operation);
    return operation;
  };

  const begin = (serviceID: string, action: ManagedOperation['action']): ManagedOperation => {
    const previous = states()[serviceID]?.operation;
    if (previous && !operationTerminal(previous)) throw new Error('A service operation is already active');
    return update({
      operation_id: `submitting:${serviceID}:${action}:${++submissionSequence}`,
      service_id: serviceID, action, state: 'submitting', stage: submittingStage(action),
      progress_current: 0, progress_total: operationProgressTotal(action),
    });
  };

  const pause = (signal: AbortSignal, delay: number) => new Promise<void>((resolve, reject) => {
    const abort = () => { window.clearTimeout(timer); reject(new DOMException('Observation retired', 'AbortError')); };
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });

  const track = (initial: ManagedOperation): Promise<ManagedOperation> => {
    const existing = streams.get(initial.operation_id);
    if (existing) return existing.promise;
    const operation = update(initial);
    if (operationTerminal(operation)) return Promise.resolve(operation);
    const controller = new AbortController();
    const epoch = generation;
    const current = () => epoch === generation && !controller.signal.aborted;
    const accept = (snapshot: ManagedOperation) => {
      if (!snapshot || snapshot.operation_id !== operation.operation_id || snapshot.service_id !== operation.service_id || snapshot.action !== operation.action || !['pending', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(snapshot.state)) {
        throw new Error('Invalid service operation snapshot');
      }
      if (!current()) throw new DOMException('Observation retired', 'AbortError');
      return update({ ...snapshot, observation_error: undefined });
    };
    const promise = (async () => {
      let retryDelay = 1000;
      while (current()) {
        if (options.canObserve?.() === false) { await pause(controller.signal, retryDelay); continue; }
        try {
          for await (const frame of readSessionEvents(`/_redeven_proxy/api/managed-web-service-operations/${encodeURIComponent(operation.operation_id)}/events`, {
            method: 'GET', signal: controller.signal,
          })) {
            if (!frame.data) continue;
            const snapshot = accept(JSON.parse(frame.data) as ManagedOperation);
            retryDelay = 1000;
            if (operationTerminal(snapshot)) return snapshot;
          }
        } catch (error) {
          if (!current()) throw error;
          if (isSessionEventAuthorizationError(error)) throw error;
        }
        if (!current()) break;
        // Losing observation says nothing about execution. Reconcile this exact
        // operation, never replay the mutation that created it.
        try {
          if (options.canObserve?.() !== false) {
            const snapshot = accept(await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-service-operations/${encodeURIComponent(operation.operation_id)}`, { method: 'GET', signal: controller.signal }));
            if (operationTerminal(snapshot)) return snapshot;
          }
        } catch (error) {
          if (!current()) throw error;
          if (isSessionEventAuthorizationError(error) || (error instanceof Object && 'status' in error && error.status === 404)) throw error;
        }
        const latest = states()[operation.service_id]?.operation;
        if (current() && latest?.operation_id === operation.operation_id && !operationTerminal(latest)) update({ ...latest, observation_error: options.streamFailedMessage() });
        await pause(controller.signal, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15000);
      }
      throw new DOMException('Observation retired', 'AbortError');
    })().catch(error => {
      const latest = states()[operation.service_id]?.operation;
      if (current() && latest?.operation_id === operation.operation_id && !operationTerminal(latest)) update({ ...latest, observation_error: options.streamFailedMessage() });
      throw error;
    }).finally(() => {
      if (streams.get(operation.operation_id)?.controller === controller) streams.delete(operation.operation_id);
    });
    streams.set(operation.operation_id, { controller, promise });
    return promise;
  };

  const clear = (operationID: string) => {
    const operation = Object.values(states()).find(state => state.operation.operation_id === operationID)?.operation;
    if (!operation || !operationTerminal(operation) || released.has(operationID)) return;
    released.add(operationID);
    for (const listener of listeners) listener.onOperationReleased?.(operationID);
  };

  const reject = (submission: ManagedOperation, errorCode: string) => {
    update({ ...submission, state: 'failed', stage: 'failed', error_code: errorCode });
    clear(submission.operation_id);
  };
  const cancel = async (operation: ManagedOperation) => {
    const epoch = generation;
    const updated = await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-service-operations/${encodeURIComponent(operation.operation_id)}/cancel`, { method: 'POST' });
    if (epoch === generation) update(updated);
    return updated;
  };
  const subscribe = (listener: ManagedOperationControllerOptions) => {
    listeners.add(listener);
    for (const { operation } of Object.values(states())) {
      listener.onOperationUpdated?.(operation);
      if (released.has(operation.operation_id)) listener.onOperationReleased?.(operation.operation_id);
    }
    return () => { listeners.delete(listener); };
  };
  const operationForService = (serviceID: string) => states()[serviceID]?.operation ?? null;
  const knows = (operationID: string) => streams.has(operationID) || Object.values(states()).some(({operation}) => operation.operation_id === operationID && (operationTerminal(operation) || operation.state === 'submitting'));
  const operations = () => Object.values(states()).map(state => state.operation);
  const dispose = () => {
    ++generation;
    for (const stream of streams.values()) stream.controller.abort();
    streams.clear(); released.clear(); setStates({});
  };
  return { begin, track, clear, reject, update, cancel, subscribe, operations, operationForService, knows, dispose };
}
