// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  assembleFlowerLiveEnvelopes,
  FLOWER_LIVE_ENVELOPE_BYTES,
  FlowerLiveSyncError,
  type FlowerLiveTransportFrame,
} from './flowerLiveWire';
import { createLiveTransport } from './liveTransport';
import { flowerLiveByteFixture, flowerLiveWireFixture } from './test/flowerLiveWireFixture';

async function* frames(values: readonly FlowerLiveTransportFrame[]) { yield* values; }
async function collect(values: readonly FlowerLiveTransportFrame[]) {
  const envelopes = [];
  for await (const envelope of assembleFlowerLiveEnvelopes(frames(values))) envelopes.push(envelope);
  return envelopes;
}
function change(frame: FlowerLiveTransportFrame, fields: Record<string, unknown>): FlowerLiveTransportFrame {
  return { data: JSON.stringify({ ...JSON.parse(frame.data), ...fields }) };
}

describe('Flower live wire assembly', () => {
  it('admits small public JSON without Base64 or fragment decoding', async () => {
    const envelope = { schema_version: 2, kind: 'ready' };
    expect(await collect([{ data: JSON.stringify(envelope) }])).toEqual([envelope]);
  });
  it('reconstructs the complete long conversation without losing any of its 395 records', async () => {
    const current = {
      thread_id: 'long-conversation', view_version: 20705, activity: 'active', run_id: 'run', turn_id: 'turn',
      items: Array.from({ length: 395 }, (_, index) => ({ id: `record-${index}`, kind: 'assistant', ordinal: index, text: `Record ${index}: ${'historical text '.repeat(260)}` })),
    };
    const envelope = { schema_version: 2, kind: 'thread.batch', thread_id: current.thread_id, current };
    const wire = flowerLiveWireFixture(envelope);
    expect(new TextEncoder().encode(JSON.stringify(envelope)).length).toBeGreaterThan(1_489_792);
    expect(wire.length).toBeGreaterThan(32);
    expect(wire.every((frame) => new TextEncoder().encode(frame.data).length <= 65536)).toBe(true);
    expect(await collect(wire)).toEqual([envelope]);
  });

  it.each(['ready', 'thread.batch', 'subagent', 'completed', 'computer.frame'])('uses the same complete assembly for %s envelopes', async (kind) => {
    const large = { thread_id: 'large', items: [{ id: 'one-large-turn', text: 'x'.repeat(1_100_000) }] };
    const envelope = kind === 'ready'
      ? { schema_version: 2, kind, summaries: [large] }
      : kind === 'subagent'
        ? { schema_version: 2, kind: 'thread.batch', subagent_current: large }
        : kind === 'completed'
          ? { schema_version: 2, kind: 'thread.batch', current: { ...large, activity: 'idle' } }
          : kind === 'computer.frame'
            ? { schema_version: 2, kind, computer_frame: large }
            : { schema_version: 2, kind, current: large };
    expect(await collect(flowerLiveWireFixture(envelope))).toEqual([envelope]);
  });

  it('decodes UTF-8 only after assembly, including multibyte characters across fragment boundaries', async () => {
    const envelope = { schema_version: 2, kind: 'thread.batch', text: `${'a'.repeat(32697)}中文消息🌸${'汉字'.repeat(18000)}` };
    const encoded = new TextEncoder().encode(JSON.stringify(envelope));
    const cut = encoded.subarray(0, 32768);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(cut)).toThrow();
    expect(await collect(flowerLiveWireFixture(envelope))).toEqual([envelope]);
  });

  it.each([0, 1, 2])('accepts canonical Base64 with %i trailing bytes', async (remainder) => {
    const envelope = { schema_version: 2, text: 'x'.repeat(32769 + remainder) };
    expect(await collect(flowerLiveWireFixture(envelope))).toEqual([envelope]);
  });

  it.each(['Zg== ', 'Zg==\n', 'Z g==', 'Zg', 'Zg===', 'Zg=_', 'Zh==', 'Zm9=', 'Zg--'])('rejects noncanonical payload %j', async (data) => {
    const frame = change(flowerLiveByteFixture(new Uint8Array([102]))[0]!, { data_base64: data });
    await expect(collect([frame])).rejects.toBeInstanceOf(FlowerLiveSyncError);
  });

  it('enforces encoded byte limits for both direct envelopes and fragments', async () => {
    await expect(collect([{ data: JSON.stringify({ schema_version: 2, text: '汉'.repeat(11000) }) }])).rejects.toBeInstanceOf(FlowerLiveSyncError);
    const frame = flowerLiveWireFixture({ text: 'x'.repeat(40000) })[0]!;
    await expect(collect([{ data: '汉'.repeat(22000) + frame.data }])).rejects.toBeInstanceOf(FlowerLiveSyncError);
  });

  it('publishes one atomic envelope before the connection or provider work ends', async () => {
    const envelope = { schema_version: 2, kind: 'thread.batch', current: { text: 'partial thought '.repeat(6000), activity: 'active' } };
    const wire = flowerLiveWireFixture(envelope);
    let releaseFinal!: () => void;
    let releaseEnd!: () => void;
    const final = new Promise<void>((resolve) => { releaseFinal = resolve; });
    const end = new Promise<void>((resolve) => { releaseEnd = resolve; });
    let reachedFinal = false;
    async function* paused() {
      yield* wire.slice(0, -1);
      reachedFinal = true;
      await final;
      yield wire.at(-1)!;
      await end;
    }
    const iterator = assembleFlowerLiveEnvelopes(paused())[Symbol.asyncIterator]();
    let settled = false;
    const pending = iterator.next().then((result) => { settled = true; return result; });
    await vi.waitFor(() => expect(reachedFinal).toBe(true));
    expect(settled).toBe(false);
    releaseFinal();
    expect(await pending).toEqual({ done: false, value: envelope });
    releaseEnd();
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  it('discards interrupted bytes and recovers exclusively from the new connection baseline', async () => {
    const old = { schema_version: 2, kind: 'thread.batch', current: { text: 'old'.repeat(15000) } };
    await expect(collect(flowerLiveWireFixture(old).slice(0, -1))).rejects.toBeInstanceOf(FlowerLiveSyncError);
    const baseline = { schema_version: 2, kind: 'ready', summaries: [{ thread_id: 'new-baseline' }] };
    expect(await collect(flowerLiveWireFixture(baseline, 'next-connection'))).toEqual([baseline]);
  });

  it('keeps completed observations when a later envelope disconnects midway', async () => {
    const ready = { schema_version: 2, kind: 'ready' };
    const later = { schema_version: 2, kind: 'thread.batch', current: { text: 'x'.repeat(100000) } };
    const iterator = assembleFlowerLiveEnvelopes(frames([...flowerLiveWireFixture(ready), ...flowerLiveWireFixture(later, 'later').slice(0, 1)]))[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual(ready);
    await expect(iterator.next()).rejects.toBeInstanceOf(FlowerLiveSyncError);
  });

  it.each([
    ['oversized direct envelope', { data: JSON.stringify({ schema_version: 2, kind: 'ready', text: 'x'.repeat(32768) }) }],
    ['invalid JSON', { data: '{' }],
    ['non-object JSON', { data: '[]' }],
    ['oversized encoded frame', { data: ' '.repeat(65537) }],
    ['unknown event', { data: '{}', event: 'other' }],
    ['missing field', { data: '{"envelope_id":"missing"}' }],
  ])('rejects %s', async (_name, frame) => {
    await expect(collect([frame])).rejects.toBeInstanceOf(FlowerLiveSyncError);
  });

  it.each([
    ['unknown field', { ignored: true }],
    ['invalid identity', { envelope_id: ' whitespace ' }],
    ['negative index', { fragment_index: -1 }],
    ['fractional index', { fragment_index: 0.5 }],
    ['first fragment out of order', { fragment_index: 1 }],
    ['inconsistent fragment count', { fragment_count: 2 }],
    ['zero envelope size', { total_bytes: 0 }],
    ['oversized envelope', { total_bytes: FLOWER_LIVE_ENVELOPE_BYTES + 1, fragment_count: 1025 }],
    ['malformed Base64', { data_base64: '%%%=' }],
    ['noncanonical Base64', { total_bytes: 1, data_base64: 'Zh==' }],
    ['incorrect decoded size', { data_base64: 'e30=' }],
  ])('rejects %s without admitting an envelope', async (_name, fields) => {
    await expect(collect([change(flowerLiveWireFixture({ schema_version: 2, kind: 'ready' })[0]!, fields)])).rejects.toBeInstanceOf(FlowerLiveSyncError);
  });

  it.each([
    ['interleaved envelope', { envelope_id: 'other' }],
    ['repeated fragment', { fragment_index: 0 }],
    ['different total size', { total_bytes: 80001 }],
    ['skipped fragment', { fragment_index: 2 }],
  ])('rejects %s during assembly', async (_name, fields) => {
    const wire = flowerLiveWireFixture({ text: 'x'.repeat(100000) });
    await expect(collect([wire[0]!, change(wire[1]!, fields)])).rejects.toBeInstanceOf(FlowerLiveSyncError);
  });

  it.each([
    ['invalid UTF-8', new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125])],
    ['invalid envelope JSON', new TextEncoder().encode('{')],
  ])('rejects %s after full byte validation', async (_name, bytes) => {
    await expect(collect(flowerLiveByteFixture(bytes))).rejects.toBeInstanceOf(FlowerLiveSyncError);
  });

  it('uses the single transport recovery owner for server synchronization invalidation', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(() => assembleFlowerLiveEnvelopes(frames([{ event: 'error', data: '{"code":"flower_live_sync_error"}' }])));
    const onTerminalError = vi.fn();
    const stop = createLiveTransport().start({ connect, onCurrent: vi.fn(), onTerminalError });
    try {
      await vi.advanceTimersByTimeAsync(60000);
      expect(connect.mock.calls.length).toBeGreaterThan(1);
      expect(onTerminalError).not.toHaveBeenCalled();
    } finally { stop(); vi.useRealTimers(); }
  });
});
