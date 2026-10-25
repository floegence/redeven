import type { FlowerLiveStreamEnvelope } from './contracts/flowerSurfaceContracts';
import { FlowerLiveSyncError } from './flowerLiveWire';

// Pending baseline handoffs are short lived. Bound encoded UTF-8 as well as
// count; sixty-four large envelopes must not retain unbounded tool details.
export function createHistoryHandoffQueue(maxBytes = 1024 * 1024, maxCount = 64) {
  const queue: FlowerLiveStreamEnvelope[] = [];
  let bytes = 0;
  return {
    clear() { queue.length = 0; bytes = 0; },
    take() { const values = queue.splice(0); bytes = 0; return values; },
    push(value: FlowerLiveStreamEnvelope) {
      const size = new TextEncoder().encode(JSON.stringify(value)).length;
      if (queue.length >= maxCount || size > maxBytes - bytes) {
        throw new FlowerLiveSyncError('Flower reading handoff queue overflow.');
      }
      queue.push(value); bytes += size;
    },
    get bytes() { return bytes; },
    get length() { return queue.length; },
  };
}
