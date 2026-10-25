import { describe, expect, it, vi } from 'vitest';
import { createActivityFieldReader, ACTIVITY_FIELD_CHUNK_BYTES } from './activityFieldReader';
import type { FlowerActivityField, FlowerActivityFieldChunk, FlowerActivityStructurePage } from './contracts/flowerSurfaceContracts';
const signal = () => new AbortController().signal;
const field: FlowerActivityField = { path: '/payload/output', kind: 'string', bytes: 10 << 20, entry_id: 'result', source_sha256: 'source', sha256: 'text' };
const page = (value = field): FlowerActivityStructurePage => ({ thread_id: 'thread', item_id: 'tool', turn_id: 'turn', run_id: 'run', version: 'v1', field: value, children: [], next: 0, has_more: false });
function transport() {
  return {
    loadActivityStructure: vi.fn(async () => page()),
    loadActivityField: vi.fn(async (_thread: string, input: { path: string; offset_bytes: number; limit_bytes?: number }, _signal?: AbortSignal): Promise<FlowerActivityFieldChunk> => ({
      thread_id: 'thread', path: input.path, entry_id: 'result', source_sha256: 'source', sha256: 'text', bytes: field.bytes!, offset_bytes: input.offset_bytes,
      text: 'x'.repeat(input.limit_bytes!),
    })),
  };
}
describe('activity field reader', () => {
  it('revalidates resident extents even when the requested shape version is unchanged', async () => {
    const api = transport(); const reader = createActivityFieldReader(api);
    const version = 'resident:shape';
    api.loadActivityStructure.mockResolvedValue({ ...page({ ...field, bytes: 10, source_id: 'first' }), version });
    expect((await reader.structure('thread', 'tool', field.path, signal(), 0, version)).field.bytes).toBe(10);
    api.loadActivityStructure.mockResolvedValue({ ...page({ ...field, bytes: 20, source_id: 'second' }), version });
    const next = await reader.structure('thread', 'tool', field.path, signal(), 0, version);
    expect(next.field.bytes).toBe(20);
    expect(next.field.source_id).toBe('second');
    expect(api.loadActivityStructure).toHaveBeenCalledTimes(2);
  });

  it('reads random UTF-8 ranges without retained preceding chunk boundaries', async () => {
    const api = transport(); const reader = createActivityFieldReader(api);
    api.loadActivityField.mockResolvedValue({ thread_id: 'thread', path: field.path, entry_id: 'result', source_sha256: 'source', sha256: 'text', bytes: field.bytes!, offset_bytes: 65535, text: '🌸中' });
    expect(await reader.chunk('thread', 'tool', field, 65538, signal(), true)).toEqual({ offset: 65535, text: '🌸中', next: 65542, complete: false });
    expect(api.loadActivityField.mock.calls[0][1]).toMatchObject({ align_start: true, offset_bytes: 65538 });
    await expect(reader.chunk('thread', 'tool', field, 65538, signal())).rejects.toThrow('contract');
    expect(await reader.chunk('thread', 'tool', { ...field, inline_text: '中🌸文', bytes: 10 }, 5, signal(), true)).toEqual({ offset: 3, text: '🌸文', next: 10, complete: true });
  });
  it('uses canonical scalar types and rejects foreign collection children', async () => {
    const api = transport(); const reader = createActivityFieldReader(api);
    for (const value of [true, false, null, 17]) {
      api.loadActivityStructure.mockResolvedValue(page({ path: field.path, kind: 'scalar', value }));
      expect((await reader.structure('thread', 'tool', field.path, signal())).field.value).toBe(value);
    }
    api.loadActivityStructure.mockResolvedValue({ ...page({ path: '/payload', kind: 'object', count: 1 }), children: [field], next: 1 });
    await expect(reader.structure('thread', 'tool', '/payload', signal())).resolves.toMatchObject({ next: 1 });
    api.loadActivityStructure.mockResolvedValue({ ...page({ path: '/payload', kind: 'object', count: 1 }), children: [{ ...field, path: '/other/output' }], next: 1 });
    await expect(reader.structure('thread', 'tool', '/payload', signal())).rejects.toThrow('ownership');
  });
  it('does not read beyond a frozen extent or after disposal', async () => {
    const api = transport(); const reader = createActivityFieldReader(api);
    expect(await reader.chunk('thread', 'tool', field, field.bytes!, signal())).toEqual({ offset: field.bytes, text: '', next: field.bytes, complete: true });
    expect(api.loadActivityField).not.toHaveBeenCalled();
    await reader.structure('thread', 'tool', field.path, signal());
    reader.dispose();
    await expect(reader.structure('thread', 'tool', field.path, signal(), 0, 'v1')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(reader.chunk('thread', 'tool', { ...field, inline_text: 'x', bytes: 1 }, 0, signal())).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('invalidates pending transport immediately without requiring its response', async () => {
    const api = transport(); let aborted = false;
    api.loadActivityField.mockImplementation((...args) => {
      const requestSignal = args[2] as AbortSignal;
      requestSignal.addEventListener('abort', () => { aborted = true; });
      return new Promise(() => undefined);
    });
    const reader = createActivityFieldReader(api);
    const read = reader.chunk('thread', 'tool', field, 0, signal());
    reader.invalidate();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted).toBe(true);
    expect(reader.bytes.fields).toBe(0);
  });
  it('reads shape without hidden bodies and exactly one requested field range', async () => {
    const api = transport(); const reader = createActivityFieldReader(api);
    const result = await reader.structure('thread', 'tool', field.path, signal());
    expect(result.field.bytes).toBe(10 << 20); expect(api.loadActivityField).not.toHaveBeenCalled();
    const chunk = await reader.chunk('thread', 'tool', field, 0, signal());
    expect(chunk.next).toBe(ACTIVITY_FIELD_CHUNK_BYTES); expect(chunk.complete).toBe(false);
    expect(api.loadActivityField).toHaveBeenCalledTimes(1);
    await reader.chunk('thread', 'tool', field, 0, signal());
    expect(api.loadActivityField).toHaveBeenCalledTimes(1);
    expect(reader.bytes.fields).toBeLessThan(17000);
  });
  it('bounds retained chunks independently of total traversal', async () => {
    const api = transport(); const reader = createActivityFieldReader(api, { fields: 40000, structure: 2000 });
    for (let offset = 0; offset < 100 * ACTIVITY_FIELD_CHUNK_BYTES; offset += ACTIVITY_FIELD_CHUNK_BYTES) {
      await reader.chunk('thread', 'tool', field, offset, signal());
      expect(reader.bytes.fields).toBeLessThanOrEqual(40000);
    }
    await reader.chunk('thread', 'tool', field, 0, signal());
    expect(api.loadActivityField).toHaveBeenCalledTimes(101);
  });
  it('rejects late responses after collapse, scope invalidation or disposal', async () => {
    for (const action of ['collapse', 'invalidate', 'dispose']) {
      const api = transport(); let finish!: (value: FlowerActivityFieldChunk) => void;
      api.loadActivityField.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      const reader = createActivityFieldReader(api); const owner = new AbortController();
      const pending = reader.chunk('thread', 'tool', field, 0, owner.signal);
      if (action === 'collapse') owner.abort(); else if (action === 'invalidate') reader.invalidate(); else reader.dispose();
      finish({ thread_id: 'thread', path: field.path, entry_id: 'result', source_sha256: 'source', sha256: 'text', bytes: field.bytes!, offset_bytes: 0, text: 'x' });
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(reader.bytes.fields).toBe(0);
    }
  });
  it.each(['identity', 'offset', 'empty', 'extent', 'oversize'])('rejects %s contract failures before caching', async mode => {
    const api = transport(); const reader = createActivityFieldReader(api);
    api.loadActivityField.mockResolvedValue({ thread_id: mode === 'identity' ? 'other' : 'thread', path: field.path,
      entry_id: 'result', source_sha256: 'source', sha256: 'text', bytes: mode === 'extent' ? 1 : field.bytes!,
      offset_bytes: mode === 'offset' ? 1 : 0, text: mode === 'empty' ? '' : 'x'.repeat(mode === 'oversize' ? 20000 : 1) });
    await expect(reader.chunk('thread', 'tool', field, 0, signal())).rejects.toThrow('contract');
    expect(reader.bytes.fields).toBe(0);
  });
  it('resolves live shape again while retaining frozen canonical chunks', async () => {
    const api = transport(); const reader = createActivityFieldReader(api);
    await reader.structure('thread', 'tool', field.path, signal());
    await reader.structure('thread', 'tool', field.path, signal());
    expect(api.loadActivityStructure).toHaveBeenCalledTimes(2);
    await reader.structure('thread', 'tool', field.path, signal(), 0, 'v1');
    expect(api.loadActivityStructure).toHaveBeenCalledTimes(2);
    reader.invalidate();
    await reader.structure('thread', 'tool', field.path, signal(), 0, 'v1');
    expect(api.loadActivityStructure).toHaveBeenCalledTimes(3);
  });
  it('reads normalized UTF-8 slices at source offsets', async () => {
    const api = transport(); const reader = createActivityFieldReader(api);
    api.loadActivityField.mockResolvedValue({ thread_id: 'thread', path: '/original', entry_id: 'result', source_sha256: 'source', sha256: 'text', bytes: 20, offset_bytes: 4, text: '🌸中' });
    const part = await reader.chunk('thread', 'tool', { ...field, source_path: '/original', source_offset_bytes: 4, bytes: 7 }, 0, signal());
    expect(part).toEqual({ offset: 0, text: '🌸中', next: 7, complete: true });
  });
});
