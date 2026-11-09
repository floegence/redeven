import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js';
import type { EnvContextValue } from '../pages/EnvContext';
import { listRunningHostApplications, quitHostApplication, terminateHostApplication, type RunningHostApplication } from './hostApplicationsApi';

type ApplicationOperation = { kind: 'close_windows' | 'force_quit'; instances: string[]; state: 'submitting' | 'accepted' | 'failed' };

/** Window closure is asynchronous; absence from an authoritative snapshot settles it. */
export function createHostApplicationOperationSession(context: Pick<EnvContextValue, 'env_id' | 'resourceCacheAccess'>) {
  const [operations, setOperations] = createSignal<Record<string, ApplicationOperation>>({});
  let epoch = 0;
  let disposed = false;
  const capture = () => { const current = epoch, environment = context.env_id(), owner = context.resourceCacheAccess?.().owner; return () => !disposed && epoch === current && environment === context.env_id() && owner === context.resourceCacheAccess?.().owner; };
  const forget = (applicationID: string) => setOperations(previous => { const next = {...previous}; delete next[applicationID]; return next; });
  const reconcile = (running: readonly RunningHostApplication[]) => {
    const instances = new Map(running.map(item => [item.application_id, new Set(item.instances)]));
    setOperations(previous => {
      const next = {...previous}; let changed = false;
      for (const [id, operation] of Object.entries(previous)) {
        if (operation.state !== 'submitting' && !operation.instances.some(instance => instances.get(id)?.has(instance))) {delete next[id]; changed = true;}
      }
      return changed ? next : previous;
    });
  };
  const submit = async (applicationID: string, instances: string[], force: boolean) => {
    const previous = operations()[applicationID];
    if (previous?.state === 'submitting' || previous?.state === 'accepted') return;
    const current = capture();
    const operation: ApplicationOperation = {kind: force ? 'force_quit' : 'close_windows', instances, state:'submitting'};
    setOperations(items => ({...items, [applicationID]:operation}));
    try {
      await (force ? terminateHostApplication : quitHostApplication)(applicationID, instances);
      if (current()) setOperations(items => ({...items,[applicationID]:{...operation,state:'accepted'}}));
    } catch (error) {
      if (current()) setOperations(items => ({...items,[applicationID]:{...operation,state:'failed'}}));
      throw error;
    }
  };
  createEffect(() => {
    if (!Object.values(operations()).some(item => item.state === 'accepted') || (context.resourceCacheAccess && context.resourceCacheAccess().phase !== 'ready')) return;
    const current = capture(); let pending = false;
    const timer = window.setInterval(() => {
      if (pending || !current()) return;
      pending = true;
      void listRunningHostApplications().then(items => { if (current()) reconcile(items); }).catch(() => undefined).finally(() => {pending = false;});
    }, 2000);
    onCleanup(() => window.clearInterval(timer));
  });
  const owner = createMemo(() => context.resourceCacheAccess?.().owner);
  createEffect(on(() => [context.env_id(), owner()], () => untrack(() => {++epoch; setOperations({});})));
  onCleanup(() => {disposed = true; ++epoch;});
  return {operations, submit, reconcile, forget, captureAuthority:capture};
}
export type HostApplicationOperationSession = ReturnType<typeof createHostApplicationOperationSession>;
