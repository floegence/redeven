import { createSignal, type Accessor } from 'solid-js';
import { decodePluginInstallProgressEvent, type PluginInspectedInstallOperation } from '@floegence/redevplugin-ui';
import type { PluginLifecycleAPI } from './pluginApi';
import { executionInstallFailure, inventoryInstallFailure } from './pluginInstallFailure';
import type { PluginInstallExecutionProjection, PluginInventoryProjection } from './pluginTypes';

type Attempt = { requestID: string; controller: AbortController };
export type PluginInstallCoordinator = Readonly<{
  projections: Accessor<readonly PluginInstallExecutionProjection[]>;
  forget: (pluginInstanceID: string) => void;
  resume: () => Promise<void>;
  retry: (pluginInstanceID: string) => Promise<void>;
  reconcileInventory: () => void;
  reset: () => void;
  dispose: () => void;
}>;

/** Restore operation presentation from owner-scoped durable receipts, including first installs. */
export function createPluginInstallCoordinator(options: {
  lifecycle: Pick<PluginLifecycleAPI, 'listInspectedInstalls' | 'getInspectedInstall' | 'listInstallExecutionEvents'>;
  refreshInventory: () => Promise<PluginInventoryProjection | undefined>;
  completeApprovedInstall: (id: string, inventory: PluginInventoryProjection, signal?: AbortSignal) => Promise<unknown>;
}): PluginInstallCoordinator {
  const [projections, setProjections] = createSignal<readonly PluginInstallExecutionProjection[]>([]);
  const attempts = new Map<string, Attempt>();
  const forgotten = new Map<string, string>();
  let disposed = false;
  let scope = new AbortController();
  const current = (id: string, attempt: Attempt) => !disposed && !attempt.controller.signal.aborted && attempts.get(id) === attempt;
  const put = (projection: PluginInstallExecutionProjection, attempt: Attempt) => {
    if (current(projection.pluginInstanceID, attempt)) setProjections((items) => [...items.filter((item) => item.pluginInstanceID !== projection.pluginInstanceID), projection]);
  };
  const terminal = (receipt: PluginInspectedInstallOperation) => ['completed', 'failed', 'canceled', 'orphaned'].includes(receipt.execution.status);
  async function observe(initial: PluginInspectedInstallOperation, attempt: Attempt) {
    const id = initial.execution.plugin_instance_id;
    let receipt = initial;
    let cursor = 0;
    let backoff = 250;
    let progress: PluginInstallExecutionProjection['progress'] = [];
    while (current(id, attempt)) {
      const projection: PluginInstallExecutionProjection = { pluginID: receipt.plugin_id, pluginInstanceID: id, execution: receipt.execution, receipt, observation: 'watching', progress };
      try {
        if (terminal(receipt)) {
          if (receipt.mutation_outcome === 'unknown') {
            put({ ...projection, observation: 'reconnecting' }, attempt);
          } else if (receipt.mutation_outcome === 'not_committed') {
            put({ ...projection, observation: 'failed', failure: executionInstallFailure({ code: receipt.execution.failure_code ?? 'PLUGIN_INSTALL_INTERRUPTED' }) }, attempt);
            return;
          } else {
            put({ ...projection, observation: 'finalizing' }, attempt);
            try {
              const inventory = await options.refreshInventory();
              if (!current(id, attempt)) return;
              if (!inventory) throw new Error('Inventory unavailable');
              const installed = inventory.items.find((item) => item.pluginInstanceID === id);
              // A completed historical operation must not resurrect an uninstalled plugin.
              if (installed) await options.completeApprovedInstall(id, inventory, attempt.controller.signal);
              if (current(id, attempt)) setProjections((items) => items.filter((item) => item.pluginInstanceID !== id));
            } catch {
              put({ ...projection, observation: 'refresh_failed', failure: inventoryInstallFailure() }, attempt);
            }
            return;
          }
        } else {
          put(projection, attempt);
          const events = await options.lifecycle.listInstallExecutionEvents(receipt.execution.execution_id, cursor, { signal: attempt.controller.signal });
          cursor = Math.max(cursor, events.cursor);
          const byStage = new Map(progress.map((event) => [event.stage, event]));
          for (const event of events.events) {
            const decoded = decodePluginInstallProgressEvent(event);
            if (decoded?.request_id === receipt.request_id) byStage.set(decoded.stage, decoded);
          }
          progress = [...byStage.values()];
          put({ ...projection, progress }, attempt);
        }
        await delay(backoff, attempt.controller.signal);
        receipt = await options.lifecycle.getInspectedInstall(attempt.requestID, { signal: attempt.controller.signal });
        backoff = 250;
      } catch {
        if (!current(id, attempt)) return;
        put({ ...projection, observation: 'reconnecting' }, attempt);
        backoff = Math.min(backoff * 2, 5000);
        try { await delay(backoff, attempt.controller.signal); receipt = await options.lifecycle.getInspectedInstall(attempt.requestID, { signal: attempt.controller.signal }); } catch { if (!current(id, attempt)) return; }
      }
    }
  }
  const begin = (receipt: PluginInspectedInstallOperation) => {
    const id = receipt.execution.plugin_instance_id;
    attempts.get(id)?.controller.abort();
    const attempt = { requestID: receipt.request_id, controller: new AbortController() };
    attempts.set(id, attempt);
    void observe(receipt, attempt);
  };
  const resume = async () => {
    if (disposed) return;
    const ownerScope = scope;
    const receipts = await options.lifecycle.listInspectedInstalls({ signal: ownerScope.signal });
    if (disposed || ownerScope !== scope || ownerScope.signal.aborted) return;
    const latest = new Map<string, PluginInspectedInstallOperation>();
    for (const receipt of receipts) {
      const id = receipt.execution.plugin_instance_id;
      // The paginated Host list is in durable admission order. Timestamps and
      // opaque execution IDs do not define which mutation was admitted last.
      latest.set(id, receipt);
    }
    for (const [id, receipt] of latest) {
      if (forgotten.get(id) === receipt.request_id || attempts.get(id)?.requestID === receipt.request_id) continue;
      if (terminal(receipt) && receipt.mutation_outcome === 'not_committed' && Date.parse(receipt.execution.updated_at) < Date.now() - 86400_000) continue;
      begin(receipt);
    }
  };
  const retry = async (id: string) => {
    const attempt = attempts.get(id);
    if (!attempt || disposed) return;
    const receipt = await options.lifecycle.getInspectedInstall(attempt.requestID, { signal: attempt.controller.signal });
    if (current(id, attempt)) begin(receipt);
  };
  const forget = (id: string) => { const attempt = attempts.get(id); if (attempt) forgotten.set(id, attempt.requestID); attempt?.controller.abort(); attempts.delete(id); setProjections((items) => items.filter((item) => item.pluginInstanceID !== id)); };
  // Only a fresh, owner-bound authoritative inventory may retire this warning.
  // An absent item is also authoritative: historical receipts cannot resurrect it.
  const reconcileInventory = () => {
    if (disposed) return;
    setProjections((items) => items.filter((item) => !(item.observation === 'refresh_failed' && item.receipt?.mutation_outcome === 'committed')));
  };
  const reset = () => {
    scope.abort('Plugin owner changed');
    scope = new AbortController();
    for (const attempt of attempts.values()) attempt.controller.abort();
    attempts.clear();
    forgotten.clear();
    setProjections([]);
  };
  const dispose = () => { disposed = true; reset(); scope.abort('Plugin observer disposed'); };
  return { projections, resume, retry, reconcileInventory, forget, reset, dispose };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
