import type { Session } from '@floegence/flowersec-core';
import type { BrowserSourceSelection, BrowserSourceService, BrowserSourcePreference } from './browserSourceContract';
import type { BrowserViewDescriptor, BrowserWorkspaceRequest } from './browserWindowProtocol';
import { fetchSessionJSON } from './sessionHTTP';

export type { BrowserFailureCode } from './browserFailure';
import { BrowserWorkspaceError, browserFailureCode, type BrowserFailureCode } from './browserFailure';
export type BrowserServiceStatus = { state: 'idle' | 'ready' | 'failed' | 'recovering'; generation: string };
export type BrowserWorkspaceState = Readonly<{
  phase: 'idle' | 'selecting' | 'opening' | 'live' | 'failed';
  selection?: BrowserSourceSelection;
  view?: BrowserViewDescriptor;
  failure?: BrowserFailureCode;
  service?: BrowserServiceStatus;
}>;

export function openBrowserWorkspace(request: BrowserWorkspaceRequest, signal: AbortSignal): Promise<BrowserViewDescriptor> {
  return fetchSessionJSON('/_redeven_proxy/api/browser/workspace', {
    method: 'POST', body: JSON.stringify(request), signal,
  });
}
export function browserWorkspaceSource(view: BrowserViewDescriptor): BrowserWorkspaceRequest {
  if (!view.workspace_id) throw new BrowserWorkspaceError('BROWSER_SOURCE_UNAVAILABLE');
  return { workspace_id: view.workspace_id, initial_target: view.initial_target };
}

/** Owns one product view. Surfaces own only their document/ports; installer and
 * environment Session lifetimes stay with their existing owners. */
export function createBrowserWorkspaceController(service: BrowserSourceService, initial?: BrowserSourceSelection) {
  let state: BrowserWorkspaceState = { phase: 'idle', selection: initial };
  let session: Session | undefined;
  let pending: AbortController | undefined;
  let revision = 0;
  let recovery: Promise<void> | undefined;
  let closed = false;
  const listeners = new Set<(value: BrowserWorkspaceState) => void>();
  const publish = (next: BrowserWorkspaceState) => { state = next; for (const listener of listeners) listener(state); };
  const release = (view?: BrowserViewDescriptor) => {
    if (view) void fetchSessionJSON(`/_redeven_proxy/api/browser/views/${encodeURIComponent(view.id)}`, { method: 'DELETE' }).catch(() => undefined);
  };
  const inspectFailure = async (attempt: number) => {
    if (!session || closed) return;
    try {
      const environment = await fetchSessionJSON<{ browser_service: BrowserServiceStatus }>('/_redeven_proxy/api/browser/environment', { method: 'GET' });
      if (closed || revision !== attempt || state.phase !== 'failed') return;
      const status = environment.browser_service;
      publish({ ...state, service: status, ...(status.state === 'failed' ? { failure: 'BROWSER_SERVICE_FAILED' as const } : {}) });
    } catch { /* Session recovery remains owned by the environment. */ }
  };
  const open = async (selection: BrowserSourceSelection, signal?: AbortSignal): Promise<void> => {
    if (closed || !session) throw new BrowserWorkspaceError('BROWSER_DISCONNECTED');
    pending?.abort();
    const attempt = new AbortController(); pending = attempt;
    const currentRevision = ++revision;
    const combined = signal ? AbortSignal.any([attempt.signal, signal]) : attempt.signal;
    const before = state;
    const previous = state.view;
    publish({ ...state, ...(previous ? {} : { selection }), phase: previous ? 'live' : 'opening', failure: undefined });
    let issued: BrowserViewDescriptor | undefined;
    try {
      if ('managed_profile_id' in selection.request) {
        const status = await service.management.loadBrowserInstallation!();
        combined.throwIfAborted();
        if (!status.enabled) throw new BrowserWorkspaceError('BROWSER_DISABLED');
        if (status.launch?.state === 'system_preparation_required') throw new BrowserWorkspaceError('BROWSER_SANDBOX_UNAVAILABLE');
        if (status.launch?.state === 'unavailable') throw new BrowserWorkspaceError(status.launch.reason === 'browser_dependencies_missing' ? 'BROWSER_DEPENDENCIES_MISSING' : 'BROWSER_OPEN_FAILED');
        if (status.state !== 'installed') throw new BrowserWorkspaceError('BROWSER_INSTALL_REQUIRED');
      }
      issued = await openBrowserWorkspace(selection.request, combined);
      combined.throwIfAborted();
      if (closed || pending !== attempt) throw new DOMException('Cancelled', 'AbortError');
      // Persist only the successful latest intent; the server derives the source
      // from this user/channel-bound view, never from renderer profile claims.
      await fetchSessionJSON('/_redeven_proxy/api/browser/preference', { method: 'POST', body: JSON.stringify({ view_id: issued.id }), signal: combined });
      combined.throwIfAborted();
      publish({ phase: 'live', selection: { label: selection.label, request: browserWorkspaceSource(issued) }, view: issued, service: { state: 'ready', generation: issued.generation } });
      issued = undefined;
      release(previous);
    } catch (error) {
      release(issued);
      if (combined.aborted && !closed && pending === attempt) publish(before);
      if (!combined.aborted && !closed && pending === attempt && !previous) {
        const failure = browserFailureCode(error);
        publish({ ...state, phase: 'failed', failure });
        if (!['BROWSER_INSTALL_REQUIRED', 'BROWSER_DISABLED', 'BROWSER_SANDBOX_UNAVAILABLE', 'BROWSER_DEPENDENCIES_MISSING'].includes(failure)) void inspectFailure(currentRevision);
      }
      throw error;
    } finally { if (pending === attempt) pending = undefined; }
  };
  const reconnect = async () => {
    if (closed || !session) throw new BrowserWorkspaceError('BROWSER_DISCONNECTED');
    if (!state.selection) {
      const attempt = ++revision;
      pending?.abort();
      const reading = new AbortController(); pending = reading;
      publish({ ...state, phase: 'opening', failure: undefined });
      try {
        const saved = await fetchSessionJSON<BrowserSourcePreference>('/_redeven_proxy/api/browser/preference', { method: 'GET', signal: reading.signal });
        if (closed || revision !== attempt || reading.signal.aborted) return;
        const request = saved.workspace_id ? { workspace_id: saved.workspace_id } : saved.extension_profile_id ? { connection: { extension_profile_id: saved.extension_profile_id } } : saved.managed_profile_id ? { managed_profile_id: saved.managed_profile_id } : undefined;
        if (!request) {
          publish(saved.preference ? { ...state, phase: 'failed', failure: 'BROWSER_SOURCE_UNAVAILABLE' }
            : { ...state, phase: 'selecting', failure: undefined });
          return;
        }
        await open({ request, label: '' });
      } catch (error) {
        if (!closed && revision === attempt && !reading.signal.aborted) {
          publish({ ...state, phase: 'failed', failure: browserFailureCode(error) });
          void inspectFailure(attempt);
        }
        throw error;
      } finally { if (pending === reading) pending = undefined; }
      return;
    }
    await open(state.selection);
  };
  const fail = async (failure: BrowserFailureCode = 'BROWSER_DISCONNECTED') => {
    if (closed || (!state.view && state.phase === 'failed')) return;
    const attempt = ++revision;
    pending?.abort(); pending = undefined;
    const view = state.view;
    publish({ ...state, view: undefined, phase: 'failed', failure });
    release(view);
    await inspectFailure(attempt);
  };
  return {
    snapshot: () => state,
    subscribe(listener: (value: BrowserWorkspaceState) => void) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    setSession(next: Session | undefined) {
      if (next === session) return;
      const previous = session;
      session = next;
      if (previous) {
        ++revision; pending?.abort(); pending = undefined;
        const view = state.view;
        publish({ ...state, view: undefined, phase: 'failed', failure: 'BROWSER_DISCONNECTED' });
        release(view);
      }
    },
    open, reconnect, fail,
    currentRequest(): BrowserWorkspaceRequest {
      if (!state.view) throw new BrowserWorkspaceError('BROWSER_SOURCE_UNAVAILABLE');
      return state.selection!.request;
    },
    selectTarget(target: string) {
      if (!state.view || !state.selection) return;
      publish({ ...state, selection: { ...state.selection, request: { ...browserWorkspaceSource(state.view), initial_target: target } } });
    },
    recover(): Promise<void> {
      if (recovery) return recovery;
      const attempt = ++revision;
      pending?.abort(); pending = undefined;
      const work = (async () => {
        if (closed || !session) throw new BrowserWorkspaceError('BROWSER_DISCONNECTED');
        try {
          const status = state.service ?? (await fetchSessionJSON<{ browser_service: BrowserServiceStatus }>('/_redeven_proxy/api/browser/environment', { method: 'GET' })).browser_service;
          if (closed || revision !== attempt) return;
          publish({ ...state, phase: 'opening' });
          await fetchSessionJSON('/_redeven_proxy/api/browser/recovery', { method: 'POST', body: JSON.stringify({ expected_generation: status.generation }) });
          if (closed || revision !== attempt) return;
          publish({ ...state, view: undefined, selection: undefined });
          await reconnect();
        } catch (error) { if (!closed && revision === attempt) publish({ ...state, phase: 'failed', failure: browserFailureCode(error) }); throw error; }
      })();
      recovery = work;
      void work.finally(() => { if (recovery === work) recovery = undefined; }).catch(() => undefined);
      return work;
    },
    close() {
      if (closed) return;
      closed = true; ++revision; pending?.abort(); release(state.view); listeners.clear();
      state = { ...state, view: undefined, phase: 'idle' };
    },
  };
}
export type BrowserWorkspaceController = ReturnType<typeof createBrowserWorkspaceController>;
