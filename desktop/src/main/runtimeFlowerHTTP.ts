import http, { type ClientRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import {
	DESKTOP_PRIVATE_BRIDGE_TOKEN_HEADER,
	normalizeDesktopPrivateBridgeToken,
} from './desktopPrivateBridge';
import type { StartupReport } from './startup';
import type { RuntimeFlowerMedia, RuntimeFlowerError, RuntimeFlowerRequest } from '../shared/runtimeFlowerIPC';

export function runtimeFlowerComputerFrame(response: RuntimeFlowerHTTPResponse): RuntimeFlowerMedia {
  if (response.headers['content-type'] !== 'image/png' || response.bytes.length === 0 || response.bytes.length > (10 << 20)) {
    throw new Error('Flower returned invalid computer media.');
  }
  return { bytes: new Uint8Array(response.bytes), mime_type: 'image/png' };
}

export function runtimeFlowerMessageFile(response: RuntimeFlowerHTTPResponse): RuntimeFlowerMedia {
  const mime = String(response.headers['content-type'] ?? '').toLowerCase();
  if (!/^(image\/(?!svg\+xml)|video\/|audio\/|text\/plain(?:;|$))/.test(mime) || response.bytes.length > (64 << 20)) {
    throw new Error('Flower returned invalid file media.');
  }
  return { bytes: new Uint8Array(response.bytes), mime_type: mime };
}

export type RuntimeFlowerHTTPResponse = Readonly<{
  status: number;
  body: string;
  bytes: Buffer;
  headers: IncomingHttpHeaders;
}>;

export type RuntimeFlowerHTTPStream = Readonly<{
	request: ClientRequest;
	response: Promise<IncomingMessage>;
}>;

export function runtimeFlowerDeleteQuery(parsed: URL): boolean {
	return parsed.search === '?force=true';
}

export function invalidateRuntimeFlowerAccessOnStatus(
	cache: Map<string, string>,
	cacheKey: string,
	status: number,
): boolean {
	if (status !== 423) return false;
	return cache.delete(cacheKey);
}

export function runtimeFlowerPrivateBridgeHeaders(
	startup: Pick<StartupReport, 'local_ui_bridge_token'>,
	headers: Readonly<Record<string, string>> = {},
): Record<string, string> {
	const token = normalizeDesktopPrivateBridgeToken(startup.local_ui_bridge_token);
	if (!token) {
		throw new Error('Desktop startup report is missing private Local UI bridge authorization.');
	}
	const normalizedHeaderName = DESKTOP_PRIVATE_BRIDGE_TOKEN_HEADER.toLowerCase();
	return {
		...Object.fromEntries(
			Object.entries(headers).filter(([name]) => name.toLowerCase() !== normalizedHeaderName),
		),
		[DESKTOP_PRIVATE_BRIDGE_TOKEN_HEADER]: token,
	};
}

export function readRuntimeFlowerHTTPResponse(response: IncomingMessage, maxBytes = Infinity): Promise<RuntimeFlowerHTTPResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    response.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        fail(new Error('Flower runtime media response is too large.'));
        response.destroy();
        return;
      }
      chunks.push(bytes);
    });
    response.once('aborted', () => {
      fail(new Error('Flower runtime response was aborted.'));
    });
    response.once('error', fail);
    response.once('close', () => {
      if (!response.complete) fail(new Error('Flower runtime response closed before completion.'));
    });
    response.once('end', () => {
      if (settled) return;
      settled = true;
      const bytes = Buffer.concat(chunks);
      resolve({
        status: response.statusCode ?? 0,
        body: bytes.toString('utf8'),
        bytes,
        headers: response.headers,
      });
    });
  });
}

export function requestRuntimeFlowerHTTP(
  url: URL,
  request: RuntimeFlowerRequest,
  options: Readonly<{ headers?: Readonly<Record<string, string>>; accept?: string; timeoutMs?: number }> = {},
): Promise<RuntimeFlowerHTTPResponse> {
  return new Promise((resolve, reject) => {
    const body = request.body === undefined ? '' : JSON.stringify(request.body);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method: request.method,
      timeout: Math.max(1, Math.floor(options.timeoutMs ?? 120_000)),
      headers: {
        Accept: options.accept ?? 'application/json',
        ...(options.headers ?? {}),
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    }, (response) => {
      void readRuntimeFlowerHTTPResponse(response, url.pathname === '/_redeven_proxy/api/fs/file' ? 64 << 20 : Infinity).then(resolve, reject);
    });
    req.on('timeout', () => {
      const error = new Error('Flower runtime request timed out.');
      Object.assign(error, { code: 'runtime_flower_timeout' });
      req.destroy(error);
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export function openRuntimeFlowerHTTPStream(
	url: URL,
	options: Readonly<{ headers?: Readonly<Record<string, string>> }> = {},
): RuntimeFlowerHTTPStream {
	let resolveResponse!: (response: IncomingMessage) => void;
	let rejectResponse!: (error: Error) => void;
	const response = new Promise<IncomingMessage>((resolve, reject) => {
		resolveResponse = resolve;
		rejectResponse = reject;
	});
	const client = url.protocol === 'https:' ? https : http;
	const request = client.request(url, {
		method: 'GET',
		timeout: 120_000,
		headers: {
			Accept: 'text/event-stream',
			...(options.headers ?? {}),
		},
	}, resolveResponse);
	request.once('timeout', () => request.destroy(new Error('Flower runtime stream timed out.')));
	request.once('error', rejectResponse);
	request.end();
	return { request, response };
}

export function parseRuntimeFlowerJSON(body: string): unknown {
  if (!String(body ?? '').trim()) {
    return null;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

export function runtimeFlowerInvalidJSONError(
  response: Pick<RuntimeFlowerHTTPResponse, 'status' | 'body'>,
  parsed: unknown = parseRuntimeFlowerJSON(response.body),
): RuntimeFlowerError | null {
  if (response.status === 204) return null;
  if (String(response.body ?? '').trim() && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return null;
  }
  return {
    code: 'runtime_flower_invalid_json',
    message: 'Flower returned an invalid JSON response.',
    status: response.status,
  };
}
