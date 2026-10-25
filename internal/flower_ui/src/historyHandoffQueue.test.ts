import { describe, it, expect } from 'vitest';
import { createHistoryHandoffQueue } from './historyHandoffQueue';
import type { FlowerLiveStreamEnvelope } from './contracts/flowerSurfaceContracts';

describe('reading handoff budget', () => {
  const value: FlowerLiveStreamEnvelope = { schema_version: 3, kind: 'thread.batch', thread_id: '🌸', reading_revision: 1 };
  it('accounts actual UTF-8 and rejects before retaining an oversized envelope', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    const queue = createHistoryHandoffQueue(bytes, 64);
    queue.push(value);
    expect(queue.bytes).toBe(bytes);
    expect(() => queue.push(value)).toThrow('overflow');
    expect(queue.length).toBe(1);
    expect(queue.take()).toEqual([value]);
    expect(queue.bytes).toBe(0);
    queue.push(value);
    queue.clear();
    expect(queue.length).toBe(0);
    expect(queue.bytes).toBe(0);
  });
  it('also bounds small envelopes by count and preserves delivery order', () => {
    const queue = createHistoryHandoffQueue(10000, 2);
    queue.push(value); queue.push({ ...value, reading_revision: 2 });
    expect(() => queue.push(value)).toThrow('overflow');
    expect(queue.take().map(item => item.reading_revision)).toEqual([1, 2]);
  });
});
