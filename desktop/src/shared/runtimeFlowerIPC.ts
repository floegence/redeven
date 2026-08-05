export const REQUEST_RUNTIME_FLOWER_CHANNEL = 'redeven-desktop:runtime-flower-request';
export const START_RUNTIME_FLOWER_STREAM_CHANNEL = 'redeven-desktop:runtime-flower-stream-start';
export const CANCEL_RUNTIME_FLOWER_STREAM_CHANNEL = 'redeven-desktop:runtime-flower-stream-cancel';
export const RUNTIME_FLOWER_STREAM_EVENT_CHANNEL = 'redeven-desktop:runtime-flower-stream-event';

export type RuntimeFlowerRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RuntimeFlowerRequest = Readonly<{
  method: RuntimeFlowerRequestMethod;
  path: string;
  body?: unknown;
  staging_scope_id?: string;
  staging_capability?: string;
}>;

export type RuntimeFlowerError = Readonly<{
  code?: string;
  message: string;
  status?: number;
  retryAfterMs?: number;
  data?: unknown;
}>;

export type RuntimeFlowerFailureKind = 'response' | 'transport_unknown' | 'local';

export type RuntimeFlowerRequestResult = Readonly<
  | {
      ok: true;
      data: unknown;
      stagingCapability?: string;
    }
  | {
      ok: false;
      error: RuntimeFlowerError;
      failureKind: RuntimeFlowerFailureKind;
    }
>;

export type RuntimeFlowerStreamRequest = Readonly<{
  stream_id: string;
  path: string;
}>;

export type RuntimeFlowerStreamStartResult = Readonly<{
  ok: true;
  status: number;
  content_type?: string;
  retry_after?: string;
}> | Readonly<{
  ok: false;
  error: RuntimeFlowerError;
}>;

export type RuntimeFlowerStreamEvent = Readonly<{
  stream_id: string;
  kind: 'chunk';
  chunk: Uint8Array;
}> | Readonly<{
  stream_id: string;
  kind: 'end';
}> | Readonly<{
  stream_id: string;
  kind: 'error';
  message: string;
}>;

const RUNTIME_FLOWER_STREAM_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/u;

export function normalizeRuntimeFlowerStreamID(value: unknown): string | null {
  const streamID = String(value ?? '').trim();
  return RUNTIME_FLOWER_STREAM_ID_PATTERN.test(streamID) ? streamID : null;
}

export function normalizeRuntimeFlowerStreamRequest(value: unknown): RuntimeFlowerStreamRequest | null {
  const record = value && typeof value === 'object'
    ? value as Readonly<{ stream_id?: unknown; path?: unknown }>
    : null;
  const streamID = normalizeRuntimeFlowerStreamID(record?.stream_id);
  const path = typeof record?.path === 'string' ? record.path : '';
  return streamID && path.length <= 4_096 && path.startsWith('/')
    ? { stream_id: streamID, path }
    : null;
}

export function normalizeRuntimeFlowerStreamEvent(value: unknown): RuntimeFlowerStreamEvent | null {
  const record = value && typeof value === 'object'
    ? value as Readonly<{ stream_id?: unknown; kind?: unknown; chunk?: unknown; message?: unknown }>
    : null;
  const streamID = normalizeRuntimeFlowerStreamID(record?.stream_id);
  if (!streamID) return null;
  if (record?.kind === 'chunk' && record.chunk instanceof Uint8Array) {
    return { stream_id: streamID, kind: 'chunk', chunk: record.chunk };
  }
  if (record?.kind === 'end') return { stream_id: streamID, kind: 'end' };
  if (record?.kind === 'error') {
    const message = String(record.message ?? '').trim();
    return message ? { stream_id: streamID, kind: 'error', message: message.slice(0, 1_000) } : null;
  }
  return null;
}
