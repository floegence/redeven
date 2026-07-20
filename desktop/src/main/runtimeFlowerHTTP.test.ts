import http from 'node:http';

import { describe, expect, it } from 'vitest';

import { readRuntimeFlowerHTTPResponse } from './runtimeFlowerHTTP';

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
});
