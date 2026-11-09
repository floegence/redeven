import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js';
import type { EnvContextValue } from '../pages/EnvContext';
import type { EnvAppTranslationKey } from '../i18n';
import type { HostApplicationDesktopProgress } from '../pages/HostApplicationSetupPanel';
import type { HostApplicationComponentsProgress } from '../../../../../../desktop/src/shared/hostApplicationComponents';
import { cancelHostApplicationSetup, getHostApplicationSetup, getHostApplicationTransferPlan, hostApplicationSetupActive, observeHostApplicationSetup, startHostApplicationSetup, uploadHostApplicationSetup, type HostApplicationSetup, type HostApplicationTransferPlan } from './hostApplicationsApi';
import { LocalApiError } from './localApi';

export class ComponentAcquisitionError extends Error {
  constructor(readonly translationKey: EnvAppTranslationKey) { super(translationKey); }
}

/** Component admission, Desktop acquisition and upload belong to the environment. */
export function createHostApplicationSetupSession(context: Pick<EnvContextValue, 'env_id' | 'env' | 'resourceCacheAccess'>) {
  const [setup, setSetup] = createSignal<HostApplicationSetup | null>(null);
  const [setupBusy, setSetupBusy] = createSignal(false);
  const [setupPlan, setSetupPlan] = createSignal<HostApplicationTransferPlan | null>(null);
  const [planBusy, setPlanBusy] = createSignal(false);
  const [acquisitionProgress, setAcquisitionProgress] = createSignal<HostApplicationDesktopProgress | null>(null);
  const [setupDisconnected, setSetupDisconnected] = createSignal(false);
  const [error, setError] = createSignal<unknown>();
  let setupObserver: AbortController | undefined;
  let setupTransfer: AbortController | undefined;
  let setupRequestID = '';
  let setupRequestSignature = '';
  let setupCancelled = false;
  let relaying = false;
  let relaySourceReceiving = false;
  let disposed = false;
  let epoch = 0;
  const ready = () => !context.resourceCacheAccess || context.resourceCacheAccess().phase === 'ready';
  const allowed = () => !disposed && ready() && Boolean(context.env()?.permissions?.can_read && context.env()?.permissions?.can_write && context.env()?.permissions?.can_execute);
  const capture = () => {
    const generation = epoch; const environment = context.env_id(); const owner = context.resourceCacheAccess?.().owner;
    return () => !disposed && generation === epoch && environment === context.env_id() && owner === context.resourceCacheAccess?.().owner;
  };
  const listeners = new Set<(value: HostApplicationSetup) => void>();
  const acceptSetup = (next: HostApplicationSetup) => {
    if (disposed) return;
    if (setup()?.package?.digest !== next.package?.digest) setSetupPlan(null);
    setSetup(next); setSetupDisconnected(false);
    for (const listener of listeners) listener(next);
  };
  const observeSetup = () => {
    if (disposed || setupObserver || !ready()) return;
    const current = capture();
    const controller = new AbortController(); setupObserver = controller;
    setSetupDisconnected(false);
    void observeHostApplicationSetup(next => {
      if (current() && !controller.signal.aborted) acceptSetup(next);
    }, controller.signal).catch(() => {
      if (current() && !controller.signal.aborted) setSetupDisconnected(true);
    }).finally(() => {
      if (setupObserver === controller) setupObserver = undefined;
      if (current() && !controller.signal.aborted && hostApplicationSetupActive(setup())) setSetupDisconnected(true);
    });
  };
  const inspectPreparation = async () => {
    const current = capture(); setPlanBusy(true);
    try { const plan = await getHostApplicationTransferPlan(); if (current()) setSetupPlan(plan); return plan; }
    finally { if (current()) setPlanBusy(false); }
  };
  const prepare = async (file?: File, method: 'host' | 'desktop' = 'host') => {
    if (!allowed() || setupBusy() || relaying) return;
    const current = capture();
    setSetupBusy(true);
    setupCancelled = false;
    setError(undefined);
    try {
      if (file && (!setup()?.package || file.size < setup()!.package!.size_bytes || file.size > setup()!.package!.size_bytes + 2 * 1048576)) throw new Error('The component package does not match this host.');
      const plan = file ? null : await inspectPreparation();
      if (!current() || setupCancelled) return;
      let next = setup();
      if (!file && plan && plan.missing_bytes > 0 && method === 'desktop') {
        if (!next?.package || !window.redevenDesktopShell?.applicationComponents) throw new Error('Desktop component acquisition is unavailable.');
        await relayPreparation(next, plan);
        observeSetup();
        return;
      }
      if (!file && next?.state === 'receiving') return;
      if (!hostApplicationSetupActive(setup())) {
        const source = file ? 'upload' : plan?.missing_bytes === 0 ? 'cache' : 'download';
        const signature = `${source}:${file?.size ?? 0}:${setup()?.package?.digest ?? ''}`;
        if (!setupRequestID || setupRequestSignature !== signature || (setup() && ['failed', 'cancelled', 'interrupted'].includes(setup()!.state))) {
          setupRequestID = crypto.randomUUID();
        }
        setupRequestSignature = signature;
        next = await startHostApplicationSetup(setupRequestID, source, file?.size ?? 0, plan?.package_digest ?? setup()?.package?.digest);
        if (setupCancelled) {
          if (setupCancelled && current() && next.can_cancel && next.operation_id) await cancelHostApplicationSetup(next.operation_id);
          return;
        }
        if (!current()) return;
        acceptSetup(next);
      }
      if (next?.state === 'receiving' && next.can_cancel) {
        if (file) {
          if (!next.operation_id || file.size !== next.expected_bytes) throw new Error('The component package does not match this host.');
          setupTransfer = new AbortController();
          observeSetup();
          const uploaded = await uploadHostApplicationSetup(next.operation_id, file, setupTransfer.signal);
          if (current()) acceptSetup(uploaded);
          setupTransfer = undefined;
        }
      }
      observeSetup();
    } catch (e) {
      if (current() && !setupTransfer?.signal.aborted) {
        if (e instanceof LocalApiError && e.code === 'HOST_APP_SETUP_BUSY') {
          try { const latest = await getHostApplicationSetup(); if (current()) { acceptSetup(latest); observeSetup(); } }
          catch { setSetupDisconnected(true); }
        } else setError(e);
      }
    }
    finally { if (!relaying) setupTransfer = undefined; if (current()) setSetupBusy(false); }
  };
  const relayPreparation = async (source: HostApplicationSetup, plan: HostApplicationTransferPlan) => {
    const bridge = window.redevenDesktopShell;
    const acquire = bridge?.applicationComponents;
    if (!allowed() || !acquire || !source.package || relaying || disposed) return;
    const current = capture();
    relaying = true; relaySourceReceiving = source.state === 'receiving';
    const transfer = new AbortController(); setupTransfer = transfer;
    const updateAcquisition = (progress: HostApplicationComponentsProgress) => {
      if (!current() || transfer.signal.aborted) return;
      setAcquisitionProgress(progress);

    };
    const remove = bridge.onApplicationComponentsProgress?.(updateAcquisition);
    updateAcquisition({ phase: 'checking', component_bytes: plan.missing_bytes, downloaded_bytes: 0 });
    try {
      const capability = await acquire({ action: 'capabilities' });
      if (!current() || transfer.signal.aborted) return;
      if (!capability.ok || !capability.supports_transfer_plan || !capability.supports_cache_progress) throw new ComponentAcquisitionError('hostApplications.update.desktopMismatch');
      const bundle = await acquire({ action: 'acquire', architecture: source.package.architecture, plan });
      if (!current() || transfer.signal.aborted) return;
      if (!bundle.ok || !bundle.size) throw new ComponentAcquisitionError(bundle.error === 'target_mismatch' ? 'hostApplications.update.desktopMismatch' : 'hostApplications.prepare.networkError');
      if (source.state === 'receiving' && bundle.size !== source.expected_bytes) throw new Error('The component package does not match this transfer.');
      if (source.state !== 'receiving') {
        const signature = `upload:${bundle.size}:${plan.package_digest}`;
        if (!setupRequestID || setupRequestSignature !== signature || ['failed', 'cancelled', 'interrupted'].includes(source.state)) setupRequestID = crypto.randomUUID();
        setupRequestSignature = signature;
      }
      const next = source.state === 'receiving' ? source : await startHostApplicationSetup(setupRequestID, 'upload', bundle.size, plan.package_digest);
      if (!current() || transfer.signal.aborted) {
        if (setupCancelled && current() && next.can_cancel && next.operation_id) await cancelHostApplicationSetup(next.operation_id);
        return;
      }
      setAcquisitionProgress(current => current ? { ...current, phase: 'uploading' } : null);
      acceptSetup(next);
      if (next.state === 'receiving' && next.operation_id) {
        const uploaded = await uploadHostApplicationSetup(next.operation_id, { size: bundle.size, read: async offset => {
          const chunk = await acquire({ action: 'read', offset });
          if (!chunk.ok || !chunk.data) throw new Error('Desktop component transfer failed.');
          return new Blob([Uint8Array.from(chunk.data)]);
        } }, transfer.signal);
        if (current()) acceptSetup(uploaded);
      }
    } catch (e) {
      if (current() && !transfer.signal.aborted) {
        setError(e);
        // Reconcile uncertain admission or upload results with the host operation.
        try { const latest = await getHostApplicationSetup(); if (current()) acceptSetup(latest); }
        catch { setSetupDisconnected(true); }
      }
    } finally {
      remove?.();
      if (current()) setAcquisitionProgress(null);
      try { await acquire({ action: 'cancel' }); }
      finally { if (setupTransfer === transfer) setupTransfer = undefined; relaying = false; }
    }
  };
  const cancelPreparation = async () => {
    if (!allowed() || (!setupBusy() && !relaying && !setup()?.operation_id)) return;
    const operationID = setup()?.operation_id;
    const current = capture();
    setupCancelled = true;
    const localAcquisitionOnly = relaying && !relaySourceReceiving && acquisitionProgress() !== null && acquisitionProgress()?.phase !== 'uploading';
    setupTransfer?.abort();
    setAcquisitionProgress(null);
    if (relaying) {
      await window.redevenDesktopShell?.applicationComponents?.({ action: 'cancel' });
      if (!current()) return;
      setSetup(value => value ? { ...value, state: 'cancelled', can_cancel: false } : value);
      if (localAcquisitionOnly) return;
    }
    if (!operationID) return;
    try {
      const next = await cancelHostApplicationSetup(operationID);
      if (current()) acceptSetup(next);
    } catch (e) { if (current()) setError(e); }
  };

  const owner = createMemo(() => context.resourceCacheAccess?.().owner);
  createEffect(on(() => [context.env_id(), owner()], () => {
    untrack(() => {
      ++epoch; setupObserver?.abort(); setupObserver = undefined; setupTransfer?.abort();
      setSetup(null); setSetupPlan(null); setSetupBusy(false); setAcquisitionProgress(null); setError(undefined);
      setupRequestID = ''; setupRequestSignature = '';
    });
  }));
  // Observation can be resumed by a new view or a recovered connection.
  createEffect(on(ready, value => { if (value && untrack(setup)) untrack(observeSetup); }));
  createEffect(() => {
    if (!ready() || !setupDisconnected() || (!hostApplicationSetupActive(setup()) && !setupBusy())) return;
    const current = capture();
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending || !current()) return;
      pending = true;
      void getHostApplicationSetup().then(next => {
        if (!current()) return;
        acceptSetup(next); observeSetup();
      }).catch(() => undefined).finally(() => { pending = false; });
    }, 2000);
    onCleanup(() => window.clearInterval(timer));
  });
  onCleanup(() => { disposed = true; ++epoch; setupObserver?.abort(); setupTransfer?.abort(); listeners.clear(); });
  return { setup, setupBusy, setupPlan, planBusy, acquisitionProgress, setupDisconnected, setSetupDisconnected, error, acceptSetup, observeSetup, inspectPreparation, prepare, cancelPreparation,
    relaying: () => relaying, subscribe: (listener: (value: HostApplicationSetup) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
export type HostApplicationSetupSession = ReturnType<typeof createHostApplicationSetupSession>;
