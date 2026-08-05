import http, { type ClientRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { RuntimeFlowerError, RuntimeFlowerRequest } from '../shared/runtimeFlowerIPC';

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

export function readRuntimeFlowerHTTPResponse(response: IncomingMessage): Promise<RuntimeFlowerHTTPResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    response.on('data', (chunk: Buffer | string) => {
      if (!settled) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
  options: Readonly<{ headers?: Readonly<Record<string, string>>; accept?: string }> = {},
): Promise<RuntimeFlowerHTTPResponse> {
  return new Promise((resolve, reject) => {
    const body = request.body === undefined ? '' : JSON.stringify(request.body);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method: request.method,
      timeout: 120_000,
      headers: {
        Accept: options.accept ?? 'application/json',
        ...(options.headers ?? {}),
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    }, (response) => {
      void readRuntimeFlowerHTTPResponse(response).then(resolve, reject);
    });
    req.on('timeout', () => {
      req.destroy(new Error('Flower runtime request timed out.'));
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
