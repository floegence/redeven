import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js';
import type { EnvContextValue } from '../pages/EnvContext';
import { codeRuntimeReady, type BrowserEditorInstallMethod, type CodeRuntimeStatus } from './codeRuntimeApi';
import { browserEditorLocalFailureFromError, type BrowserEditorSetupLocalFailure } from './browserEditorSetupActivity';
import { createBrowserEditorSetupOperationID, type BrowserEditorSetupProgress } from './browserEditorSetupProgress';
import { browserEditorRuntimeOperationAbsenceConfirmed, cancelBrowserEditorSetup, createBrowserEditorSetupOrchestration, defaultBrowserEditorInstallMethod, type BrowserEditorSetupOrchestration } from './browserEditorSetup';

/** Preparation and Desktop delivery belong to the environment, not the codespace view. */
export function createBrowserEditorSetupSession(context: Pick<EnvContextValue, 'env_id' | 'resourceCacheAccess'>) {
  const [runtimePrepareLocalPending, setRuntimePrepareLocalPending] = createSignal(false);
  const [runtimePrepareLocalFailure, setRuntimePrepareLocalFailure] = createSignal<BrowserEditorSetupLocalFailure | null>(null);
  const [runtimePrepareLocalCancelled, setRuntimePrepareLocalCancelled] = createSignal(false);
  const [runtimePrepareProgress, setRuntimePrepareProgress] = createSignal<BrowserEditorSetupProgress | null>(null);
  const [runtimePrepareSubmitting, setRuntimePrepareSubmitting] = createSignal(false);
  const [runtimeInstallMethod, setRuntimeInstallMethod] = createSignal<BrowserEditorInstallMethod>(defaultBrowserEditorInstallMethod());
  const [runtimeCancelSubmitting, setRuntimeCancelSubmitting] = createSignal(false);
  const [status, setStatus] = createSignal<CodeRuntimeStatus | null>(null);
  let orchestration: BrowserEditorSetupOrchestration | null = null;
  let epoch = 0, disposed = false;
  const captureAuthority = () => {
    const generation = epoch, environment = context.env_id(), owner = context.resourceCacheAccess?.().owner;
    return () => !disposed && generation === epoch && environment === context.env_id() && owner === context.resourceCacheAccess?.().owner;
  };
  const run = async (initial: CodeRuntimeStatus | undefined) => {
    if (runtimePrepareSubmitting()) return;
    const current = captureAuthority();
    setRuntimePrepareLocalPending(true); setRuntimePrepareSubmitting(true); setRuntimePrepareLocalFailure(null); setRuntimePrepareLocalCancelled(false); setRuntimePrepareProgress(null);
    const execution = createBrowserEditorSetupOrchestration({
      operationID: createBrowserEditorSetupOperationID(), installMethod: runtimeInstallMethod(), status: initial,
      onSnapshot: snapshot => {
        if (!current()) return;
        setRuntimeInstallMethod(snapshot.operation.installMethod); setRuntimePrepareProgress(snapshot.localProgress);
        if (snapshot.operationObserved) {setRuntimePrepareLocalPending(false); setRuntimePrepareLocalFailure(null); setRuntimePrepareLocalCancelled(false);}
        if (snapshot.runtimeStatus) setStatus(snapshot.runtimeStatus);
      },
    });
    orchestration = execution;
    try {
      const result = await execution.run();
      if (!current()) return;
      if (result.state === 'cancelled' && !result.status) setRuntimePrepareLocalCancelled(true);
      if (result.state === 'failed') setRuntimePrepareLocalFailure(browserEditorLocalFailureFromError(result.message, execution.snapshot().operation.installMethod));
      return result;
    } catch (error) {
      if (!current() || execution.isCancellationRequested()) return;
      const snapshot = execution.snapshot();
      if (!snapshot.operationObserved && browserEditorRuntimeOperationAbsenceConfirmed(error)) setRuntimePrepareLocalFailure(browserEditorLocalFailureFromError(error, snapshot.operation.installMethod));
      throw error;
    } finally {
      if (current() && orchestration === execution) {
        orchestration = null; setRuntimePrepareSubmitting(false); setRuntimePrepareLocalPending(false); setRuntimePrepareProgress(null); setRuntimeInstallMethod(defaultBrowserEditorInstallMethod());
      }
    }
  };
  const cancel = async (observed: CodeRuntimeStatus | undefined) => {
    if (runtimeCancelSubmitting()) return;
    const current = captureAuthority(); setRuntimeCancelSubmitting(true);
    try {
      if (orchestration) await orchestration.cancel();
      else {
        const operation = observed?.operation;
        if (operation?.action === 'prepare_workspace_engine' && operation.operation_id && operation.install_method) {
          const result = await cancelBrowserEditorSetup(operation.operation_id, operation.install_method);
          if (current()) setStatus(result);
        }
      }
    } finally {if (current()) setRuntimeCancelSubmitting(false);}
  };
  const observe = (value: CodeRuntimeStatus) => {
    if (codeRuntimeReady(value)) {setRuntimePrepareLocalFailure(null); setRuntimePrepareLocalCancelled(false);}
  };
  const owner = createMemo(() => context.resourceCacheAccess?.().owner);
  createEffect(on(() => [context.env_id(), owner()], () => untrack(() => {
    ++epoch; orchestration?.retire(); orchestration = null; setStatus(null); setRuntimePrepareLocalPending(false); setRuntimePrepareSubmitting(false); setRuntimePrepareLocalFailure(null); setRuntimePrepareLocalCancelled(false); setRuntimePrepareProgress(null); setRuntimeCancelSubmitting(false);
  })));
  onCleanup(() => {disposed = true; ++epoch; orchestration?.retire();});
  return {run, cancel, observe, captureAuthority, status, runtimePrepareLocalPending, runtimePrepareLocalFailure, runtimePrepareLocalCancelled, runtimePrepareProgress, runtimePrepareSubmitting, runtimeInstallMethod, setRuntimeInstallMethod, runtimeCancelSubmitting};
}
export type BrowserEditorSetupSession = ReturnType<typeof createBrowserEditorSetupSession>;
