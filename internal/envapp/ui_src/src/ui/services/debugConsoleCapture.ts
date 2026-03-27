import type { DiagnosticsEvent } from './diagnosticsApi';
import { redevenV1TypeIds } from '../protocol/redeven_v1/typeIds';

const TRACE_HEADER = 'X-Redeven-Debug-Trace-ID';
const MAX_CAPTURED_TEXT_CHARS = 20_000;
const MAX_CAPTURED_ITEMS = 40;
const MAX_CAPTURED_DEPTH = 5;

type DebugConsoleCapturedBody = Readonly<{
  kind: 'json' | 'text' | 'form_data' | 'binary' | 'empty' | 'stream';
  payload?: unknown;
  summary?: string;
  content_type?: string;
  truncated?: boolean;
  size_bytes?: number;
}>;

type DebugConsoleCapturedRequest = Readonly<{
  url?: string;
  path?: string;
  query?: string;
  headers?: Record<string, unknown>;
  payload?: unknown;
  payload_kind?: string;
  payload_summary?: string;
  content_type?: string;
  truncated?: boolean;
  size_bytes?: number;
}>;

type DebugConsoleCapturedResponse = Readonly<{
  ok?: boolean;
  status?: number;
  status_text?: string;
  headers?: Record<string, unknown>;
  payload?: unknown;
  payload_kind?: string;
  payload_summary?: string;
  content_type?: string;
  truncated?: boolean;
  size_bytes?: number;
  error_message?: string;
}>;

type DebugConsoleClientListener = (event: DiagnosticsEvent) => void;

type DebugConsoleFetchCaptureContext = Readonly<{
  method: string;
  url: URL;
  request: DebugConsoleCapturedRequest;
  started_at_unix_ms: number;
  started_at_iso: string;
}>;

const protocolOperationByTypeID = new Map<number, string>();
const clientListeners = new Set<DebugConsoleClientListener>();

let captureEnabled = false;
let fetchPatched = false;
let originalFetch: typeof fetch | null = null;
let clientTraceSequence = 0;

function buildProtocolOperationMap(prefix: string, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    protocolOperationByTypeID.set(value, prefix);
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    buildProtocolOperationMap(prefix ? `${prefix}.${key}` : key, child);
  }
}

buildProtocolOperationMap('', redevenV1TypeIds);

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function truncateText(value: string, maxChars = MAX_CAPTURED_TEXT_CHARS): Readonly<{ value: string; truncated: boolean }> {
  if (value.length <= maxChars) {
    return { value, truncated: false };
  }
  return {
    value: `${value.slice(0, maxChars)}\n...[truncated]`,
    truncated: true,
  };
}

function sensitiveKey(key: string): boolean {
  const normalized = compact(key).toLowerCase();
  if (!normalized) {
    return false;
  }
  for (const token of ['token', 'secret', 'password', 'authorization', 'cookie', 'api_key', 'apikey', 'psk']) {
    if (normalized.includes(token)) {
      return true;
    }
  }
  return false;
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth >= MAX_CAPTURED_DEPTH) {
    return '[max-depth]';
  }
  if (value == null) {
    return value;
  }
  if (typeof value === 'string') {
    return truncateText(value, 2048).value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_CAPTURED_ITEMS).map((item) => sanitizeUnknown(item, depth + 1));
  }
  if (typeof File !== 'undefined' && value instanceof File) {
    return {
      name: value.name,
      size_bytes: value.size,
      type: value.type || undefined,
    };
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      size_bytes: value.size,
      type: value.type || undefined,
    };
  }
  if (value instanceof URLSearchParams) {
    return sanitizeUnknown(Object.fromEntries(value.entries()), depth + 1);
  }
  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, entry] of value.entries()) {
      if (count >= MAX_CAPTURED_ITEMS) {
        out.__truncated__ = true;
        break;
      }
      out[key] = sanitizeUnknown(entry, depth + 1);
      count += 1;
    }
    return out;
  }
  if (value instanceof ArrayBuffer) {
    return { byte_length: value.byteLength };
  }
  if (ArrayBuffer.isView(value)) {
    return { byte_length: value.byteLength };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [index, [key, child]] of entries.entries()) {
      if (index >= MAX_CAPTURED_ITEMS) {
        out.__truncated__ = true;
        break;
      }
      out[key] = sensitiveKey(key) ? '[redacted]' : sanitizeUnknown(child, depth + 1);
    }
    return out;
  }
  return String(value);
}

function serializeHeaders(headers: Headers): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let count = 0;
  headers.forEach((value, key) => {
    if (count >= MAX_CAPTURED_ITEMS) {
      return;
    }
    out[key] = sensitiveKey(key) ? '[redacted]' : truncateText(value, 1024).value;
    count += 1;
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

function shouldCaptureURL(url: URL): boolean {
  const path = compact(url.pathname);
  if (!path) {
    return false;
  }
  if (path.startsWith('/_redeven_proxy/api/debug/diagnostics')) {
    return false;
  }
  if (path.startsWith('/_redeven_proxy/api/') || path.startsWith('/api/local/') || path.startsWith('/_redeven_direct/')) {
    return true;
  }
  return false;
}

function fetchScopeForPath(path: string): string {
  if (path.startsWith('/api/local/') || path.startsWith('/_redeven_direct/')) {
    return 'localui_http';
  }
  return 'gateway_api';
}

function bodyContentType(headers: Headers): string {
  return compact(headers.get('content-type')).toLowerCase();
}

function isLikelyJSON(contentType: string, text: string): boolean {
  const trimmed = text.trim();
  return contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[');
}

function captureTextBody(text: string, contentType: string): DebugConsoleCapturedBody {
  const sizeBytes = text.length;
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      kind: 'empty',
      summary: 'No body',
      content_type: contentType || undefined,
      size_bytes: sizeBytes,
    };
  }
  if (isLikelyJSON(contentType, text)) {
    try {
      return {
        kind: 'json',
        payload: sanitizeUnknown(JSON.parse(text)),
        content_type: contentType || undefined,
        size_bytes: sizeBytes,
      };
    } catch {
      // Fall through to plain-text capture.
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return {
      kind: 'form_data',
      payload: sanitizeUnknown(Object.fromEntries(new URLSearchParams(text).entries())),
      content_type: contentType || undefined,
      size_bytes: sizeBytes,
    };
  }
  const truncated = truncateText(text);
  return {
    kind: 'text',
    payload: truncated.value,
    content_type: contentType || undefined,
    truncated: truncated.truncated,
    size_bytes: sizeBytes,
  };
}

async function captureRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<DebugConsoleCapturedBody | undefined> {
  const body = init?.body;
  if (body != null) {
    if (typeof body === 'string') {
      return captureTextBody(body, compact(new Headers(init?.headers).get('content-type')).toLowerCase());
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      return {
        kind: 'form_data',
        payload: sanitizeUnknown(Object.fromEntries(body.entries())),
        content_type: 'application/x-www-form-urlencoded',
      };
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      return {
        kind: 'form_data',
        payload: sanitizeUnknown(body),
        content_type: compact(new Headers(init?.headers).get('content-type')).toLowerCase() || 'multipart/form-data',
      };
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      if (compact(body.type).toLowerCase().includes('json') || compact(body.type).toLowerCase().startsWith('text/')) {
        return captureTextBody(await body.text(), compact(body.type).toLowerCase());
      }
      return {
        kind: 'binary',
        summary: `Blob ${body.size} bytes`,
        content_type: compact(body.type).toLowerCase() || undefined,
        size_bytes: body.size,
      };
    }
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      const sizeBytes = body instanceof ArrayBuffer ? body.byteLength : body.byteLength;
      return {
        kind: 'binary',
        summary: `Binary payload ${sizeBytes} bytes`,
        size_bytes: sizeBytes,
      };
    }
    return {
      kind: 'binary',
      summary: 'Unserializable request body',
    };
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      const clone = input.clone();
      const contentType = bodyContentType(clone.headers);
      if (!clone.body) {
        return undefined;
      }
      if (contentType.includes('multipart/form-data')) {
        return {
          kind: 'form_data',
          payload: sanitizeUnknown(await clone.formData()),
          content_type: contentType || undefined,
        };
      }
      return captureTextBody(await clone.text(), contentType);
    } catch {
      return {
        kind: 'binary',
        summary: 'Request body unavailable',
      };
    }
  }

  return undefined;
}

async function captureResponseBody(response: Response): Promise<DebugConsoleCapturedBody | undefined> {
  const contentType = bodyContentType(response.headers);
  if (contentType.includes('text/event-stream')) {
    return {
      kind: 'stream',
      summary: 'Streaming response',
      content_type: contentType || undefined,
    };
  }
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return {
      kind: 'empty',
      summary: 'No response body',
      content_type: contentType || undefined,
    };
  }
  const contentLength = Number.parseInt(compact(response.headers.get('content-length')), 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_CAPTURED_TEXT_CHARS * 4 && !contentType.includes('json') && !contentType.startsWith('text/')) {
    return {
      kind: 'binary',
      summary: `Body skipped (${contentLength} bytes)`,
      content_type: contentType || undefined,
      size_bytes: contentLength,
    };
  }
  try {
    return captureTextBody(await response.text(), contentType);
  } catch {
    return {
      kind: 'binary',
      summary: 'Response body unavailable',
      content_type: contentType || undefined,
    };
  }
}

function toCapturedRequest(url: URL, headers: Headers, body: DebugConsoleCapturedBody | undefined): DebugConsoleCapturedRequest {
  return {
    url: url.href,
    path: url.pathname,
    query: compact(url.search) || undefined,
    headers: serializeHeaders(headers),
    payload: body?.payload,
    payload_kind: body?.kind,
    payload_summary: compact(body?.summary) || undefined,
    content_type: compact(body?.content_type) || undefined,
    truncated: body?.truncated === true ? true : undefined,
    size_bytes: typeof body?.size_bytes === 'number' ? body.size_bytes : undefined,
  };
}

function toCapturedResponse(response: Response, body: DebugConsoleCapturedBody | undefined, errorMessage?: string): DebugConsoleCapturedResponse {
  return {
    ok: response.ok,
    status: response.status,
    status_text: compact(response.statusText) || undefined,
    headers: serializeHeaders(response.headers),
    payload: body?.payload,
    payload_kind: body?.kind,
    payload_summary: compact(body?.summary) || undefined,
    content_type: compact(body?.content_type) || undefined,
    truncated: body?.truncated === true ? true : undefined,
    size_bytes: typeof body?.size_bytes === 'number' ? body.size_bytes : undefined,
    error_message: compact(errorMessage) || undefined,
  };
}

function nextClientTraceID(prefix: string): string {
  clientTraceSequence += 1;
  return `${prefix}-${clientTraceSequence.toString().padStart(6, '0')}`;
}

function eventDurationMs(startedAtUnixMs: number): number {
  return Math.max(0, Date.now() - startedAtUnixMs);
}

function publishEvent(event: DiagnosticsEvent): void {
  if (!captureEnabled || clientListeners.size === 0) {
    return;
  }
  for (const listener of clientListeners) {
    listener(event);
  }
}

function buildFetchCaptureContext(input: RequestInfo | URL, init?: RequestInit): Promise<DebugConsoleFetchCaptureContext | null> {
  const urlValue =
    typeof input === 'string'
      ? input
      : typeof URL !== 'undefined' && input instanceof URL
        ? input.toString()
        : typeof Request !== 'undefined' && input instanceof Request
          ? input.url
          : String(input);
  const url = new URL(urlValue, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
  if (!shouldCaptureURL(url)) {
    return Promise.resolve(null);
  }
  const method =
    compact(init?.method)
    || (typeof Request !== 'undefined' && input instanceof Request ? compact(input.method) : '')
    || 'GET';
  const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
  const startedAtUnixMs = Date.now();
  return captureRequestBody(input, init).then((body) => ({
    method: method.toUpperCase(),
    url,
    request: toCapturedRequest(url, headers, body),
    started_at_unix_ms: startedAtUnixMs,
    started_at_iso: new Date(startedAtUnixMs).toISOString(),
  }));
}

function buildProtocolDetail(kind: 'call' | 'notify', typeID: number, payload: unknown, response: unknown, errorMessage?: string): DiagnosticsEvent {
  const operation = protocolOperationByTypeID.get(typeID) ?? `unknown.${typeID}`;
  const startedAtUnixMs = Date.now();
  const traceID = nextClientTraceID(kind === 'call' ? 'rpc' : 'notify');
  const hasError = compact(errorMessage).length > 0;
  return {
    created_at: new Date(startedAtUnixMs).toISOString(),
    source: 'browser',
    scope: 'protocol_rpc',
    kind: hasError ? `${kind}_failed` : kind,
    trace_id: traceID,
    method: kind === 'call' ? 'RPC' : 'NOTIFY',
    path: `rpc://redeven_v1/${operation}`,
    status_code: hasError ? 500 : 200,
    duration_ms: 0,
    message: hasError ? compact(errorMessage) : `${kind === 'call' ? 'RPC call' : 'RPC notify'} completed`,
    detail: {
      transport: kind === 'call' ? 'protocol_rpc' : 'protocol_notify',
      operation,
      type_id: typeID,
      request: {
        payload: sanitizeUnknown(payload),
      },
      response: hasError
        ? {
            error_message: compact(errorMessage),
          }
        : {
            payload: sanitizeUnknown(response),
          },
    },
  };
}

export function subscribeDebugConsoleClientEvents(listener: DebugConsoleClientListener): () => void {
  clientListeners.add(listener);
  return () => {
    clientListeners.delete(listener);
  };
}

export function setDebugConsoleCaptureEnabled(enabled: boolean): void {
  captureEnabled = enabled === true;
}

export function installDebugConsoleBrowserCapture(): void {
  if (fetchPatched || typeof globalThis.fetch !== 'function') {
    return;
  }
  originalFetch = globalThis.fetch.bind(globalThis);
  const wrappedFetch: typeof fetch = async (input, init) => {
    const captureContext = captureEnabled ? await buildFetchCaptureContext(input, init) : null;
    try {
      const response = await (originalFetch as typeof fetch)(input, init);
      if (captureContext) {
        const responseClone = response.clone();
        void captureResponseBody(responseClone)
          .then((body) => {
            const traceID = compact(response.headers.get(TRACE_HEADER)) || nextClientTraceID('http');
            publishEvent({
              created_at: new Date().toISOString(),
              source: 'browser',
              scope: fetchScopeForPath(captureContext.url.pathname),
              kind: response.ok ? 'completed' : 'failed',
              trace_id: traceID,
              method: captureContext.method,
              path: captureContext.url.href,
              status_code: response.status,
              duration_ms: eventDurationMs(captureContext.started_at_unix_ms),
              slow: eventDurationMs(captureContext.started_at_unix_ms) >= 1000,
              message: response.ok ? `${captureContext.method} completed` : `HTTP ${response.status} ${compact(response.statusText)}`.trim(),
              detail: {
                transport: 'browser_fetch',
                request: captureContext.request,
                response: toCapturedResponse(response, body),
              },
            });
          })
          .catch(() => undefined);
      }
      return response;
    } catch (error) {
      if (captureContext) {
        publishEvent({
          created_at: new Date().toISOString(),
          source: 'browser',
          scope: fetchScopeForPath(captureContext.url.pathname),
          kind: 'failed',
          trace_id: nextClientTraceID('http'),
          method: captureContext.method,
          path: captureContext.url.href,
          duration_ms: eventDurationMs(captureContext.started_at_unix_ms),
          slow: eventDurationMs(captureContext.started_at_unix_ms) >= 1000,
          message: error instanceof Error ? error.message : String(error),
          detail: {
            transport: 'browser_fetch',
            request: captureContext.request,
            response: {
              error_message: error instanceof Error ? error.message : String(error),
            },
          },
        });
      }
      throw error;
    }
  };
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = wrappedFetch;
  fetchPatched = true;
}

export async function captureDebugConsoleProtocolCall<Req, Resp>(args: Readonly<{
  typeID: number;
  payload: Req;
  execute: () => Promise<Resp>;
}>): Promise<Resp> {
  if (!captureEnabled) {
    return args.execute();
  }
  const startedAtUnixMs = Date.now();
  try {
    const response = await args.execute();
    const event = buildProtocolDetail('call', args.typeID, args.payload, response);
    publishEvent({
      ...event,
      duration_ms: eventDurationMs(startedAtUnixMs),
      slow: eventDurationMs(startedAtUnixMs) >= 1000,
    });
    return response;
  } catch (error) {
    const event = buildProtocolDetail('call', args.typeID, args.payload, null, error instanceof Error ? error.message : String(error));
    publishEvent({
      ...event,
      duration_ms: eventDurationMs(startedAtUnixMs),
      slow: eventDurationMs(startedAtUnixMs) >= 1000,
    });
    throw error;
  }
}

export async function captureDebugConsoleProtocolNotify<Payload>(args: Readonly<{
  typeID: number;
  payload: Payload;
  execute: () => Promise<void>;
}>): Promise<void> {
  if (!captureEnabled) {
    await args.execute();
    return;
  }
  const startedAtUnixMs = Date.now();
  try {
    await args.execute();
    const event = buildProtocolDetail('notify', args.typeID, args.payload, { delivered: true });
    publishEvent({
      ...event,
      duration_ms: eventDurationMs(startedAtUnixMs),
      slow: eventDurationMs(startedAtUnixMs) >= 1000,
    });
  } catch (error) {
    const event = buildProtocolDetail('notify', args.typeID, args.payload, null, error instanceof Error ? error.message : String(error));
    publishEvent({
      ...event,
      duration_ms: eventDurationMs(startedAtUnixMs),
      slow: eventDurationMs(startedAtUnixMs) >= 1000,
    });
    throw error;
  }
}

export function resetDebugConsoleCaptureForTests(): void {
  clientListeners.clear();
  captureEnabled = false;
  clientTraceSequence = 0;
  if (fetchPatched && originalFetch) {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
  }
  fetchPatched = false;
  originalFetch = null;
}
