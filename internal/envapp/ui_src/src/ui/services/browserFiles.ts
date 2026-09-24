import { fetchSessionHTTP } from './sessionHTTP';
import type { BrowserFileResult } from './browserWindowProtocol';

// Bound the bytes awaiting transfer to trusted browser documents across views.
const budget = 256 * 1024 * 1024;
let retained = 0;
let downloads = 0;

export async function readBrowserFile(root: string, kind: 'resource' | 'download', target: string, id: string, signal: AbortSignal): Promise<BrowserFileResult> {
  if (typeof target !== 'string' || !target || target.length > 512 || typeof id !== 'string' || !id || id.length > 512)
    throw new Error('Invalid browser file');
  if (kind === 'download' && downloads >= 4) throw new Error('Browser download limit');
  if (kind === 'download') downloads++;
  const limit = kind === 'resource' ? 8 * 1024 * 1024 : budget;
  let size = 0;
  try {
    const response = await fetchSessionHTTP(`${root}/${kind}?${new URLSearchParams({ target, id })}`, { signal });
    const length = response.headers.get('Content-Length');
    const expected = length === null ? undefined : Number(length);
    if (!response.ok || !response.body || (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0 || expected > limit))) {
      await response.body?.cancel();
      throw new Error('Browser file unavailable');
    }
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        if (size + chunk.value.byteLength > limit || retained + chunk.value.byteLength > budget) throw new Error('Browser file limit');
        size += chunk.value.byteLength; retained += chunk.value.byteLength;
        chunks.push(chunk.value);
      }
      if (expected !== undefined && size !== expected) throw new Error('Browser file incomplete');
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return { body: body.buffer, contentType: response.headers.get('Content-Type') ?? '', disposition: response.headers.get('Content-Disposition') ?? '' };
    } finally {
      signal.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => undefined); reader.releaseLock();
    }
  } finally { retained -= size; if (kind === 'download') downloads--; }
}
