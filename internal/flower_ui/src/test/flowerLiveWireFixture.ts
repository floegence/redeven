import type { FlowerLiveTransportFrame } from '../flowerLiveWire';

export function flowerLiveWireFixture(envelope: unknown, envelopeID = 'test-envelope'): FlowerLiveTransportFrame[] {
  return flowerLiveByteFixture(new TextEncoder().encode(JSON.stringify(envelope)), envelopeID);
}

export function flowerLiveByteFixture(bytes: Uint8Array, envelopeID = 'test-envelope'): FlowerLiveTransportFrame[] {
  const frames: FlowerLiveTransportFrame[] = [];
  const count = Math.ceil(bytes.length / 32768);
  for (let index = 0; index < count; index++) {
    frames.push({ data: JSON.stringify({
      envelope_id: envelopeID,
      fragment_index: index,
      fragment_count: count,
      total_bytes: bytes.length,
      data_base64: btoa(String.fromCharCode(...bytes.subarray(index * 32768, (index + 1) * 32768))),
    }) });
  }
  return frames;
}
