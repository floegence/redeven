import { createSignal } from 'solid-js';

import type { ManagedOperation } from './managedServiceOperationController';

export const MANAGED_OPERATION_MIN_VISIBLE_MS = 1_800;
export const MANAGED_OPERATION_SUCCESS_HOLD_MS = 1_200;
export const MANAGED_OPERATION_EXIT_MS = 220;

export type ManagedOperationPresentationPhase = 'visible' | 'exiting';

type ManagedOperationPresentation = Readonly<{
  operation: ManagedOperation;
  phase: ManagedOperationPresentationPhase;
  visibleSinceUnixMs: number;
  terminalSinceUnixMs?: number;
  released: boolean;
}>;

type ManagedOperationPresentationOptions = Readonly<{
  isExpanded: (operationID: string) => boolean;
}>;

const operationTerminal = (operation: ManagedOperation) => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(operation.state);

export function createManagedServiceOperationPresentation(options: ManagedOperationPresentationOptions) {
  const [presentations, setPresentations] = createSignal<Record<string, ManagedOperationPresentation>>({});
  const exitStartTimers = new Map<string, number>();
  const exitRemovalTimers = new Map<string, number>();

  const clearTimers = (serviceID: string) => {
    const exitStartTimer = exitStartTimers.get(serviceID);
    if (exitStartTimer !== undefined) window.clearTimeout(exitStartTimer);
    exitStartTimers.delete(serviceID);
    const exitRemovalTimer = exitRemovalTimers.get(serviceID);
    if (exitRemovalTimer !== undefined) window.clearTimeout(exitRemovalTimer);
    exitRemovalTimers.delete(serviceID);
  };

  const remove = (serviceID: string, operationID: string) => {
    clearTimers(serviceID);
    setPresentations((current) => {
      if (current[serviceID]?.operation.operation_id !== operationID) return current;
      const next = { ...current };
      delete next[serviceID];
      return next;
    });
  };

  const beginExit = (serviceID: string, operationID: string) => {
    exitStartTimers.delete(serviceID);
    const current = presentations()[serviceID];
    if (!current || current.operation.operation_id !== operationID) return;
    if (options.isExpanded(operationID)) return;
    setPresentations((state) => ({
      ...state,
      [serviceID]: { ...current, phase: 'exiting' },
    }));
    exitRemovalTimers.set(serviceID, window.setTimeout(
      () => remove(serviceID, operationID),
      MANAGED_OPERATION_EXIT_MS,
    ));
  };

  const scheduleSuccessfulExit = (serviceID: string, presentation: ManagedOperationPresentation) => {
    const operationID = presentation.operation.operation_id;
    if (!presentation.released || presentation.operation.state !== 'succeeded' || options.isExpanded(operationID)) return;
    clearTimers(serviceID);
    const terminalSinceUnixMs = presentation.terminalSinceUnixMs ?? Date.now();
    const exitAtUnixMs = Math.max(
      presentation.visibleSinceUnixMs + MANAGED_OPERATION_MIN_VISIBLE_MS,
      terminalSinceUnixMs + MANAGED_OPERATION_SUCCESS_HOLD_MS,
    );
    const delay = Math.max(0, exitAtUnixMs - Date.now());
    if (delay === 0) {
      beginExit(serviceID, operationID);
      return;
    }
    exitStartTimers.set(serviceID, window.setTimeout(
      () => beginExit(serviceID, operationID),
      delay,
    ));
  };

  const scheduleReleasedExit = (serviceID: string, presentation: ManagedOperationPresentation) => {
    const operationID = presentation.operation.operation_id;
    clearTimers(serviceID);
    const delay = Math.max(
      0,
      presentation.visibleSinceUnixMs + MANAGED_OPERATION_MIN_VISIBLE_MS - Date.now(),
    );
    if (delay === 0) {
      beginExit(serviceID, operationID);
      return;
    }
    exitStartTimers.set(serviceID, window.setTimeout(
      () => beginExit(serviceID, operationID),
      delay,
    ));
  };

  const update = (operation: ManagedOperation) => {
    const current = presentations()[operation.service_id];
    const now = Date.now();
    const continuesSubmission = Boolean(
      current
      && current.operation.operation_id !== operation.operation_id
      && current.operation.state === 'submitting'
      && operation.state !== 'submitting',
    );
    const sameOperation = current?.operation.operation_id === operation.operation_id;
    if (!sameOperation && !continuesSubmission) clearTimers(operation.service_id);
    const terminalSinceUnixMs = operationTerminal(operation)
      ? sameOperation
        ? current?.terminalSinceUnixMs ?? now
        : now
      : undefined;
    const next: ManagedOperationPresentation = {
      operation,
      phase: 'visible',
      visibleSinceUnixMs: sameOperation || continuesSubmission ? current!.visibleSinceUnixMs : now,
      terminalSinceUnixMs,
      released: sameOperation ? current!.released : false,
    };
    setPresentations((state) => ({ ...state, [operation.service_id]: next }));
    scheduleSuccessfulExit(operation.service_id, next);
  };

  const release = (operationID: string) => {
    const serviceID = Object.keys(presentations()).find((candidate) => presentations()[candidate]?.operation.operation_id === operationID);
    if (!serviceID) return;
    const current = presentations()[serviceID]!;
    const next = { ...current, released: true };
    setPresentations((state) => ({ ...state, [serviceID]: next }));
    if (!operationTerminal(next.operation)) {
      scheduleReleasedExit(serviceID, next);
      return;
    }
    scheduleSuccessfulExit(serviceID, next);
  };

  const reconcileExpansion = (operationID: string) => {
    const serviceID = Object.keys(presentations()).find((candidate) => presentations()[candidate]?.operation.operation_id === operationID);
    if (!serviceID) return;
    const current = presentations()[serviceID]!;
    if (!current.released) return;
    clearTimers(serviceID);
    if (options.isExpanded(operationID)) {
      if (current.phase !== 'visible') {
        setPresentations((state) => ({ ...state, [serviceID]: { ...current, phase: 'visible' } }));
      }
      return;
    }
    if (current.operation.state === 'succeeded') {
      scheduleSuccessfulExit(serviceID, current);
    } else if (!operationTerminal(current.operation)) {
      scheduleReleasedExit(serviceID, current);
    }
  };

  const pruneServices = (serviceIDs: ReadonlySet<string>) => {
    setPresentations((current) => {
      const next = { ...current };
      let changed = false;
      for (const serviceID of Object.keys(current)) {
        if (serviceIDs.has(serviceID)) continue;
        clearTimers(serviceID);
        delete next[serviceID];
        changed = true;
      }
      return changed ? next : current;
    });
  };

  const operationForService = (serviceID: string) => presentations()[serviceID]?.operation ?? null;
  const phaseForService = (serviceID: string): ManagedOperationPresentationPhase => presentations()[serviceID]?.phase ?? 'visible';
  const operationIDs = () => Object.values(presentations()).map((presentation) => presentation.operation.operation_id);

  const dispose = () => {
    for (const serviceID of new Set([...exitStartTimers.keys(), ...exitRemovalTimers.keys()])) clearTimers(serviceID);
  };

  return { update, release, reconcileExpansion, pruneServices, operationForService, phaseForService, operationIDs, dispose };
}
