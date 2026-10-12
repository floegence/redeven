import { readApiJSONResponse } from './localApi';
import type { AcquisitionConnectionLifecycle, FetchServerSentEventsOptions, ServerSentEvent } from '@floegence/floe-webapp-boot';

// The Shell's connection lifecycle owns transport and cancellation. This binding
// only routes product requests to that lifecycle; it never opens or retries one.
type SessionHTTP = Pick<AcquisitionConnectionLifecycle, 'fetch' | 'events'>;
let current: SessionHTTP | undefined;

export function bindSessionHTTP(transport: SessionHTTP): () => void {
  current = transport;
  // Desktop uses this exact environment lifecycle for both local and E2EE requests.
  const entranceRequests = new Map<string, AbortController>();
  const releaseEntrance = typeof window === 'undefined' ? undefined : window.redevenDesktopShell?.onManagedEntranceRequest?.(async request => {
    if (request.cancel) { entranceRequests.get(request.request_id)?.abort(); return null; }
    const controller = new AbortController();
    entranceRequests.set(request.request_id, controller);
    try {
      const response = await transport.fetch(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(request.service_id)}/open-session`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({request_id: `desktop-${request.request_id}`, refresh: request.refresh}),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(610000)]),
      });
      return (await readApiJSONResponse<unknown>(response)).data;
    } finally { entranceRequests.delete(request.request_id); }
  });
  return () => {
    releaseEntrance?.();
    for (const controller of entranceRequests.values()) controller.abort();
    entranceRequests.clear();
    if (current === transport) current = undefined;
  };
}

function sessionHTTP(): SessionHTTP {
  if (!current) throw Object.assign(new Error('Env session HTTP is unavailable'), { code: 'transport' });
  return current;
}

export async function fetchSessionHTTP(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return sessionHTTP().fetch(input, init);
}

export async function* readSessionEvents(
  input: RequestInfo | URL,
  options?: Omit<FetchServerSentEventsOptions, 'fetch'>,
): AsyncGenerator<ServerSentEvent> {
  yield* sessionHTTP().events(input, options);
}

export function isSessionEventAuthorizationError(error: unknown): boolean {
  const status = Number((error as { status?: unknown } | null)?.status);
  return status === 401 || status === 403 || status === 423;
}

export async function fetchSessionJSON<T>(input: RequestInfo | URL, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return (await readApiJSONResponse<T>(await fetchSessionHTTP(input, { ...init, headers }))).data;
}
