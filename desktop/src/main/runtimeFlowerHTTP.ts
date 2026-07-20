import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

export type RuntimeFlowerHTTPResponse = Readonly<{
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
}>;

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
      resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: response.headers,
      });
    });
  });
}
