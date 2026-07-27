import http from 'node:http';

import { describe, expect, it } from 'vitest';

import {
	invalidateRuntimeFlowerAccessOnStatus,
	parseRuntimeFlowerJSON,
	readRuntimeFlowerHTTPResponse,
	runtimeFlowerDeleteQuery,
	runtimeFlowerInvalidJSONError,
} from './runtimeFlowerHTTP';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('test server did not expose a TCP address'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function request(port: number): Promise<ReturnType<typeof readRuntimeFlowerHTTPResponse>> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/' }, (response) => {
      resolve(readRuntimeFlowerHTTPResponse(response));
    });
    req.once('error', reject);
  });
}

describe('readRuntimeFlowerHTTPResponse', () => {
  it('reads a complete response', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
    });
    const port = await listen(server);
    try {
      await expect(request(port)).resolves.toMatchObject({ status: 200, body: '{"ok":true}' });
    } finally {
      await close(server);
    }
  });

  it('rejects when a response is interrupted after headers and a partial body', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': '1024',
      });
      response.flushHeaders();
      response.write('{"ok":true,"data":');
      setImmediate(() => response.socket?.destroy());
    });
    const port = await listen(server);
    try {
      await expect(request(port)).rejects.toThrow(/aborted|closed before completion/);
    } finally {
      await close(server);
    }
  });

  it.each([
    ['empty', ''],
    ['HTML', '<!doctype html><title>proxy error</title>'],
    ['malformed JSON', '{"ok":true'],
  ])('classifies a real successful %s response as typed invalid JSON', async (_label, body) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(body);
    });
    const port = await listen(server);
    try {
      const response = await request(port);
      const parsed = parseRuntimeFlowerJSON(response.body);
      expect(runtimeFlowerInvalidJSONError(response, parsed)).toEqual({
        code: 'runtime_flower_invalid_json',
        message: 'Flower returned an invalid JSON response.',
        status: 200,
      });
    } finally {
      await close(server);
    }
  });
});

describe('runtimeFlowerDeleteQuery', () => {
  it('accepts only the exact force=true query', () => {
    expect(runtimeFlowerDeleteQuery(new URL('http://runtime.test/thread?force=true'))).toBe(true);
  });

  it.each([
    '',
    '?force=false',
    '?force=1',
    '?force=True',
    '?force=true&force=true',
    '?force=true&extra=1',
    '?extra=1&force=true',
    '?force=%74rue',
  ])('rejects non-canonical delete query %s', (query) => {
    expect(runtimeFlowerDeleteQuery(new URL(`http://runtime.test/thread${query}`))).toBe(false);
  });
});

describe('invalidateRuntimeFlowerAccessOnStatus', () => {
	it('invalidates only the challenged runtime cookie after a streamed upload returns 423', () => {
		const cache = new Map([
			['http://runtime-a.test', 'expired-cookie'],
			['http://runtime-b.test', 'other-cookie'],
		]);
		expect(invalidateRuntimeFlowerAccessOnStatus(cache, 'http://runtime-a.test', 200)).toBe(false);
		expect(cache.get('http://runtime-a.test')).toBe('expired-cookie');

		expect(invalidateRuntimeFlowerAccessOnStatus(cache, 'http://runtime-a.test', 423)).toBe(true);
		expect(cache.has('http://runtime-a.test')).toBe(false);
		expect(cache.get('http://runtime-b.test')).toBe('other-cookie');
	});
});
