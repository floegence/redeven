export const FLOWER_LIVE_FRAGMENT_BYTES = 32 << 10;
export const FLOWER_LIVE_FRAME_BYTES = 64 << 10;
export const FLOWER_LIVE_ENVELOPE_BYTES = 32 << 20;

export type FlowerLiveTransportFrame = Readonly<{ data: string; event?: string }>;

export class FlowerLiveSyncError extends Error {
  readonly code = 'flower_live_sync_error';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FlowerLiveSyncError';
  }
}

type Assembly = {
  envelopeID: string;
  count: number;
  nextIndex: number;
  bytes: Uint8Array;
};

const FRAGMENT_FIELDS = new Set(['envelope_id', 'fragment_index', 'fragment_count', 'total_bytes', 'data_base64']);
const BASE64_INVALID = /[^A-Za-z0-9+/]/u;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const utf8Encoder = new TextEncoder();

function decodeFrame(frame: FlowerLiveTransportFrame): { value: Record<string, unknown>; bytes: number } {
  if (!frame || typeof frame.data !== 'string' || frame.data.length > FLOWER_LIVE_FRAME_BYTES) {
    throw new FlowerLiveSyncError('Flower live stream returned an oversized or invalid frame.');
  }
  // UTF-8 uses at most three bytes per UTF-16 code unit. Small frames need no
  // temporary byte array; larger frames are measured once for both limits.
  const bytes = frame.data.length * 3 <= FLOWER_LIVE_FRAGMENT_BYTES
    ? frame.data.length * 3 : utf8Encoder.encode(frame.data).length;
  if (bytes > FLOWER_LIVE_FRAME_BYTES) throw new FlowerLiveSyncError('Flower live stream returned an oversized or invalid frame.');
  let value: unknown;
  try {
    value = JSON.parse(frame.data);
  } catch (cause) {
    throw new FlowerLiveSyncError('Flower live stream returned invalid frame JSON.', { cause });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FlowerLiveSyncError('Flower live stream returned an invalid frame.');
  }
  const record = value as Record<string, unknown>;
  if (frame.event === 'error') {
    throw new FlowerLiveSyncError('Flower live synchronization failed.');
  }
  if (frame.event && frame.event !== 'message') {
    throw new FlowerLiveSyncError('Flower live stream returned an unsupported event.');
  }
  return { value: record, bytes };
}

// Each connection owns one temporary assembly. Only a complete public
// envelope enters the mapper; disconnects discard unfinished bytes.
export async function* assembleFlowerLiveEnvelopes(frames: AsyncIterable<FlowerLiveTransportFrame>): AsyncIterable<unknown> {
  let assembly: Assembly | undefined;
  for await (const frame of frames) {
    const { value, bytes } = decodeFrame(frame);
    if (Object.hasOwn(value, 'schema_version')) {
      if (assembly) throw new FlowerLiveSyncError('Flower live stream interrupted an envelope.');
      if (bytes > FLOWER_LIVE_FRAGMENT_BYTES) {
        throw new FlowerLiveSyncError('Flower live stream returned an oversized direct envelope.');
      }
      yield value;
      continue;
    }
    const { envelope_id: envelopeID, fragment_index: index, fragment_count: count, total_bytes: total, data_base64: data } = value;
    if (Object.keys(value).length !== FRAGMENT_FIELDS.size || Object.keys(value).some((key) => !FRAGMENT_FIELDS.has(key))
      || typeof envelopeID !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(envelopeID)
      || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0
      || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1
      || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 1 || total > FLOWER_LIVE_ENVELOPE_BYTES
      || count !== Math.ceil(total / FLOWER_LIVE_FRAGMENT_BYTES) || index >= count
      || typeof data !== 'string') {
      throw new FlowerLiveSyncError('Flower live stream returned an invalid fragment.');
    }
    const fragmentLength = Math.min(FLOWER_LIVE_FRAGMENT_BYTES, total - index * FLOWER_LIVE_FRAGMENT_BYTES);
    const padding = (3 - fragmentLength % 3) % 3;
    const payloadLength = data.length - padding;
    // Exact length, alphabet, padding and zero unused bits establish canonical
    // Base64 before atob. Avoid a backtracking grammar and a second encoding.
    if (data.length !== Math.ceil(fragmentLength / 3) * 4
      || BASE64_INVALID.test(data.slice(0, payloadLength))
      || data.slice(payloadLength) !== '='.repeat(padding)
      || (padding > 0 && (BASE64_ALPHABET.indexOf(data[payloadLength - 1]!) & (padding === 2 ? 15 : 3)) !== 0)) {
      throw new FlowerLiveSyncError('Flower live stream returned an invalid fragment size or encoding.');
    }
    let decoded: string;
    try {
      decoded = atob(data);
    } catch (cause) {
      throw new FlowerLiveSyncError('Flower live stream returned invalid Base64 data.', { cause });
    }
    if (decoded.length !== fragmentLength) {
      throw new FlowerLiveSyncError('Flower live stream returned an invalid fragment size or encoding.');
    }
    if (!assembly) {
      if (index !== 0) throw new FlowerLiveSyncError('Flower live stream returned an out-of-order fragment.');
      assembly = { envelopeID, count, nextIndex: 0, bytes: new Uint8Array(total) };
    }
    if (assembly.envelopeID !== envelopeID || assembly.count !== count || assembly.bytes.length !== total || assembly.nextIndex !== index) {
      throw new FlowerLiveSyncError('Flower live stream returned inconsistent or out-of-order fragments.');
    }
    const offset = index * FLOWER_LIVE_FRAGMENT_BYTES;
    for (let byte = 0; byte < decoded.length; byte++) assembly.bytes[offset + byte] = decoded.charCodeAt(byte);
    assembly.nextIndex++;
    if (assembly.nextIndex === assembly.count) {
      let envelope: unknown;
      try {
        envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(assembly.bytes));
      } catch (cause) {
        throw new FlowerLiveSyncError('Flower live stream returned invalid envelope data.', { cause });
      }
      assembly = undefined;
      yield envelope;
    }
  }
  if (assembly) throw new FlowerLiveSyncError('Flower live stream ended with an incomplete envelope.');
}
