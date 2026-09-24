import { readApiJSONResponse } from './localApi';
import type { AcquisitionConnectionLifecycle, FetchServerSentEventsOptions, ServerSentEvent } from '@floegence/floe-webapp-boot';

// The Shell's connection lifecycle owns transport and cancellation. This binding
// only routes product requests to that lifecycle; it never opens or retries one.
type SessionHTTP = Pick<AcquisitionConnectionLifecycle, 'fetch' | 'events'>;
let current: SessionHTTP | undefined;

export function bindSessionHTTP(transport: SessionHTTP): () => void {
  current = transport;
  return () => { if (current === transport) current = undefined; };
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
