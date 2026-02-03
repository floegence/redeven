type BufferLikeValue = Uint8Array & { toString: (encoding: string) => string };
type BufferLikeCtor = {
  from: (data: Uint8Array | string, encoding?: string) => BufferLikeValue;
};

function nodeBuffer(): BufferLikeCtor | null {
  const B = (globalThis as unknown as { Buffer?: unknown }).Buffer;
  if (!B) return null;
  const from = (B as { from?: unknown }).from;
  if (typeof from !== 'function') return null;
  return B as BufferLikeCtor;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      bin += String.fromCharCode(...chunk);
    }
    return btoa(bin);
  }

  const B = nodeBuffer();
  if (B) return B.from(bytes).toString('base64');

  throw new Error('Base64 encoding is not available in this environment');
}

export function bytesFromBase64(b64: string): Uint8Array {
  const raw = String(b64 ?? '');
  if (!raw) return new Uint8Array();

  if (typeof atob === 'function') {
    const bin = atob(raw);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }

  const B = nodeBuffer();
  if (B) return new Uint8Array(B.from(raw, 'base64'));

  throw new Error('Base64 decoding is not available in this environment');
}
