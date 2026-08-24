import type { PluginSessionCredentialBinding } from './pluginSessionCredential';

export type PluginSessionReadinessCandidate = Readonly<{
  client: unknown;
  binding: PluginSessionCredentialBinding;
}>;

export type PluginSessionReadinessCoordinator = Readonly<{
  observe: (candidate: PluginSessionReadinessCandidate) => void;
  cancel: (reason?: string) => void;
  dispose: () => void;
}>;

type PluginSessionReadinessCoordinatorOptions = Readonly<{
  waitForReady: (binding: PluginSessionCredentialBinding, signal: AbortSignal) => Promise<void>;
  isCurrent: (candidate: PluginSessionReadinessCandidate) => boolean;
  activate: (binding: PluginSessionCredentialBinding) => boolean;
  onReady: (candidate: PluginSessionReadinessCandidate) => void;
  onFailure: (error: unknown, candidate: PluginSessionReadinessCandidate) => void;
}>;

function sameBinding(
  left: PluginSessionCredentialBinding,
  right: PluginSessionCredentialBinding,
): boolean {
  return left.generation === right.generation && left.channelID === right.channelID;
}

export function createPluginSessionReadinessCoordinator(
  options: PluginSessionReadinessCoordinatorOptions,
): PluginSessionReadinessCoordinator {
  let current: Readonly<{
    candidate: PluginSessionReadinessCandidate;
    controller: AbortController;
  }> | undefined;
  let disposed = false;

  const cancel = (reason = 'Plugin session readiness superseded') => {
    const request = current;
    current = undefined;
    request?.controller.abort(reason);
  };

  const observe = (candidate: PluginSessionReadinessCandidate) => {
    if (disposed) return;
    const observed = current;
    if (
      observed
      && observed.candidate.client === candidate.client
      && sameBinding(observed.candidate.binding, candidate.binding)
    ) return;

    cancel();
    const request = Object.freeze({
      candidate,
      controller: new AbortController(),
    });
    current = request;

    void options.waitForReady(candidate.binding, request.controller.signal).then(() => {
      if (disposed || current !== request || request.controller.signal.aborted) return;
      if (!options.isCurrent(candidate)) return;
      current = undefined;
      if (!options.activate(candidate.binding)) {
        options.onFailure(new Error('Plugin session credential binding was superseded'), candidate);
        return;
      }
      options.onReady(candidate);
    }).catch((error: unknown) => {
      if (disposed || current !== request || request.controller.signal.aborted) return;
      current = undefined;
      if (!options.isCurrent(candidate)) return;
      options.onFailure(error, candidate);
    });
  };

  return Object.freeze({
    observe,
    cancel,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancel('Plugin session readiness coordinator disposed');
    },
  });
}
