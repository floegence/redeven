import { describe, expect, it, vi } from 'vitest';
import { createActivityFieldReader } from './activityFieldReader';
import { createActivityTextWindow } from './activityTextWindow';
import type { FlowerActivityField, FlowerActivityFieldRequest } from './contracts/flowerSurfaceContracts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
function fixture() {
  const bytes = encoder.encode('a中🌸\n'.repeat(100000));
  const field: FlowerActivityField = { path: '/payload/output', kind: 'string', bytes: bytes.length, entry_id: 'result', source_sha256: 'source', sha256: 'text' };
  const transport = vi.fn(async (_id: string, input: FlowerActivityFieldRequest) => {
    let start = input.offset_bytes;
    if (input.align_start) while (start > 0 && (bytes[start] & 0xc0) === 0x80) start--;
    let end = Math.min(bytes.length, start + Math.min(input.limit_bytes!, 8192));
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    return { thread_id: 'thread', path: field.path, entry_id: 'result', source_sha256: 'source', sha256: 'text', bytes: bytes.length,
      offset_bytes: start, text: decoder.decode(bytes.subarray(start, end)) };
  });
  const reader = createActivityFieldReader({ loadActivityField: transport }, { fields: 40000, structure: 2000 });
  const window = createActivityTextWindow(reader, 'thread', 'tool', field, 40 << 10);
  return { bytes, field, reader, window, transport };
}
describe('bounded bidirectional activity text', () => {
  it('starts a new visible read while an abandoned read for the same field settles', async () => {
    const { reader, window } = fixture();
    const pending: (() => void)[] = [];
    const read = vi.spyOn(reader, 'chunk').mockImplementation(async (_thread, _item, _field, offset, signal) => {
      await new Promise<void>(resolve => pending.push(resolve));
      signal.throwIfAborted();
      return { offset, text: 'current', next: offset + 7, complete: false };
    });
    const hidden = new AbortController();
    const prior = window.read('after', hidden.signal).catch(error => error);
    hidden.abort();
    const current = window.read('after', new AbortController().signal);
    expect(read).toHaveBeenCalledTimes(2);
    pending[0]();
    expect(await prior).toMatchObject({ name: 'AbortError' });
    expect(window.chunks).toEqual([]);
    pending[1]();
    expect(await current).toBe(true);
    expect(window.chunks.map(chunk => chunk.text)).toEqual(['current']);
    reader.dispose();
  });
  it('keeps verified chunks across growing and completed source handoff', async () => {
    const bytes = encoder.encode('a中🌸\n'.repeat(20000));
    const api = vi.fn(async (_thread: string, input: FlowerActivityFieldRequest) => {
      let end = Math.min(bytes.length, input.offset_bytes + input.limit_bytes!);
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      return { thread_id: 'thread', path: '/payload/output', entry_id: input.entry_id, source_sha256: input.source_sha256, sha256: input.sha256,
        bytes: bytes.length, offset_bytes: input.offset_bytes, text: decoder.decode(bytes.subarray(input.offset_bytes, end)) };
    });
    const reader = createActivityFieldReader({ loadActivityField: api });
    const field: FlowerActivityField = { path: '/payload/output', kind: 'string', bytes: bytes.length / 2, entry_id: 'live-1', source_sha256: 'one', sha256: 'one' };
    const window = createActivityTextWindow(reader, 'thread', 'tool', field, 40 << 10);
    const signal = new AbortController().signal;
    await window.read('after', signal);
    const original = window.chunks[0];
    await window.replace({ ...field, bytes: bytes.length, entry_id: 'complete', source_sha256: 'two', sha256: 'two' }, signal);
    expect(window.chunks[0]).toBe(original);
    expect(window.hasAfter).toBe(true);
    expect(api).toHaveBeenCalledTimes(2);
    await window.read('after', signal);
    expect(window.chunks[0]).toBe(original);
    expect(window.chunks[1].offset).toBe(original.next);
    expect(window.bytes).toBeLessThanOrEqual(40 << 10);
    reader.dispose();
  });
  it('reaches both ends after eviction and preserves every UTF-8 source slice', async () => {
    const { bytes, reader, window } = fixture();
    const signal = new AbortController().signal;
    const check = () => {
      const chunks = window.chunks;
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        expect(chunk.text).toBe(decoder.decode(bytes.subarray(chunk.offset, chunk.next)));
        if (index) expect(chunk.offset).toBe(chunks[index - 1].next);
      }
      expect(window.bytes).toBeLessThanOrEqual(40 << 10);
      expect(reader.bytes.fields).toBeLessThanOrEqual(40000);
    };
    while (window.hasAfter) { await window.read('after', signal); check(); }
    expect(window.hasBefore).toBe(true);
    while (window.hasBefore) { await window.read('before', signal); check(); }
    expect(window.chunks[0].offset).toBe(0);
    expect(window.hasAfter).toBe(true);
    reader.dispose();
  });
  it('retains a selected island without pinning every byte between it and the viewport', async () => {
    const { reader, window } = fixture();
    const signal = new AbortController().signal;
    await window.read('after', signal);
    const selected = window.chunks[0];
    for (let i = 0; i < 30; i++) {
      await window.read('after', signal, { first: selected.offset, last: selected.next });
      expect(window.chunks[0]).toBe(selected);
      expect(window.bytes).toBeLessThanOrEqual((40 << 10) + selected.next - selected.offset);
    }
    expect(window.chunks.some((chunk, index) => index > 0 && chunk.offset > window.chunks[index - 1].next)).toBe(true);
    reader.dispose();
  });
  it('pins the visible interval and coalesces concurrent edge demands', async () => {
    const { reader, window, transport } = fixture();
    const signal = new AbortController().signal;
    await window.read('after', signal);
    const pin = { first: 0, last: window.chunks[0].next };
    for (let i = 0; i < 6; i++) {
      const one = window.read('after', signal, pin);
      const two = window.read('after', signal, pin);
      expect(two).toBe(one); await one;
    }
    expect(window.chunks[0].offset).toBe(0);
    expect(transport).toHaveBeenCalledTimes(7);
    await window.read('after', signal);
    expect(window.bytes).toBeLessThanOrEqual(40 << 10);
    reader.dispose();
  });
  it('protects the current selection when it changes while an edge read is pending', async () => {
    const { reader, window } = fixture();
    const signal = new AbortController().signal;
    for (let i = 0; i < 5; i++) await window.read('after', signal);
    const selected = window.chunks[0];
    const original = reader.chunk.bind(reader);
    let release!: () => void;
    vi.spyOn(reader, 'chunk').mockImplementation(async (...args) => {
      await new Promise<void>(resolve => { release = resolve; });
      return original(...args);
    });
    let pins: { first: number; last: number }[] = [];
    const pending = window.read('after', signal, () => pins);
    pins = [{ first: selected.offset, last: selected.next }];
    release();
    await pending;
    expect(window.chunks).toContain(selected);
    expect(window.bytes).toBeLessThanOrEqual(40 << 10);
    reader.dispose();
  });
  it('realigns retained islands when a replacement changes UTF-8 boundaries', async () => {
    const originalBytes = encoder.encode('a'.repeat(100000));
    const replacementBytes = encoder.encode('中'.repeat(40000));
    const transport = vi.fn(async (_thread: string, input: FlowerActivityFieldRequest) => {
      const bytes = input.source_id === 'first' ? originalBytes : replacementBytes;
      let offset = input.offset_bytes;
      if (input.align_start) while (offset && (bytes[offset] & 0xc0) === 0x80) offset--;
      let end = Math.min(bytes.length, offset + input.limit_bytes!);
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      return { thread_id: 'thread', path: '/payload/output', source_id: input.source_id, run_id: 'run',
        bytes: bytes.length, offset_bytes: offset, text: decoder.decode(bytes.subarray(offset, end)) };
    });
    const reader = createActivityFieldReader({ loadActivityField: transport });
    const field: FlowerActivityField = { path: '/payload/output', kind: 'string', bytes: originalBytes.length, source_id: 'first', run_id: 'run' };
    const window = createActivityTextWindow(reader, 'thread', 'tool', field, 40 << 10);
    const signal = new AbortController().signal;
    for (let i = 0; i < 5; i++) await window.read('after', signal);
    expect(window.chunks[0].offset).toBeGreaterThan(0);
    await window.replace({ ...field, source_id: 'second', bytes: replacementBytes.length }, signal);
    for (const chunk of window.chunks) {
      expect(chunk.text).toBe(decoder.decode(replacementBytes.subarray(chunk.offset, chunk.next)));
    }
    for (let i = 1; i < window.chunks.length; i++) expect(window.chunks[i].offset).toBe(window.chunks[i - 1].next);
    expect(window.bytes).toBeLessThanOrEqual(40 << 10);
    reader.dispose();
  });

});
