import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from 'solid-js';

import { fetchLocalApiJSON } from '../services/localApi';

export type ManagedInstallRequest = Readonly<{
  template_id: string;
  deployment: string;
  workspace_path: string;
  access_mode: string;
  parameters: Record<string, string>;
  accepted_notice_revisions: Record<string, number>;
  target_release_id?: string;
}>;
type InstallPlan = Readonly<{
  service_id: string;
  plan_digest: string;
  workspace_path: string;
  expires_at_unix_ms: number;
}>;
type InstallSelection = Readonly<{ identity: string; request: ManagedInstallRequest }>;

// Preparation validates local inputs only. Deployment always requires a separate user action.
export function createManagedServiceInstallPreparation(selection: Accessor<InstallSelection | null>) {
  const [prepared, setPrepared] = createSignal<{ key: string; plan: InstallPlan; request: ManagedInstallRequest } | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<unknown>(null);
  const [workspace, setWorkspace] = createSignal<{ identity: string; requested: string; resolved: string }>();
  const key = createMemo(() => JSON.stringify(selection()));
  let generation = 0;
  let controller: AbortController | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    generation += 1;
    controller?.abort();
    controller = undefined;
    clearTimeout(expiry);
  };
  const refresh = () => {
    cancel();
    const target = selection();
    const requestKey = key();
    const requestGeneration = generation;
    setPrepared(null);
    setError(null);
    setLoading(Boolean(target));
    if (!target) return;
    const request = { ...target.request };
    // Keep the server's final directory stable across edits and plan renewal.
    const resolved = workspace();
    if (resolved?.identity === target.identity && resolved.requested === request.workspace_path) request.workspace_path = resolved.resolved;
    void Promise.resolve().then(async () => {
      if (requestGeneration !== generation) return;
      const abort = new AbortController();
      controller = abort;
      try {
        const plan = await fetchLocalApiJSON<InstallPlan>('/_redeven_proxy/api/managed-web-services/install-plans', {
          method: 'POST', signal: abort.signal, body: JSON.stringify(request),
        });
        if (requestGeneration !== generation || abort.signal.aborted) return;
        if (!plan.service_id || !plan.plan_digest || !plan.workspace_path || !Number.isFinite(plan.expires_at_unix_ms) || plan.expires_at_unix_ms <= Date.now()) throw new Error('Invalid installation preparation');
        setWorkspace({ identity: target.identity, requested: target.request.workspace_path, resolved: plan.workspace_path });
        setPrepared({ key: requestKey, plan, request: { ...request, workspace_path: plan.workspace_path } });
        expiry = setTimeout(refresh, plan.expires_at_unix_ms - Date.now());
      } catch (failure) {
        if (requestGeneration === generation && !abort.signal.aborted) setError(failure);
      } finally {
        if (requestGeneration === generation) { controller = undefined; setLoading(false); }
      }
    });
  };
  createEffect(on(key, refresh));
  onCleanup(cancel);
  const current = () => {
    const value = prepared();
    return value?.key === key() && value.plan.expires_at_unix_ms > Date.now() ? value : null;
  };
  const workspacePath = () => {
    const target = selection();
    const resolved = workspace();
    return target && resolved?.identity === target.identity && resolved.requested === target.request.workspace_path ? resolved.resolved : target?.request.workspace_path;
  };
  return { current, workspacePath, loading, error, refresh };
}
