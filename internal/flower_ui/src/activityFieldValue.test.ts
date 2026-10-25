import { describe, expect, it, vi } from 'vitest';
import { readActivityRow, readActivityRowSnapshot, readActivityValue } from './activityFieldValue';
import { createActivityFieldReader } from './activityFieldReader';

function fixture(value: unknown = { content: 'code\n中🌸', format: 'code', language: 'ts', truncated: false }) {
  const api = { loadActivityValue: vi.fn(async (thread: string, input: { item_id: string; path: string }) => ({
    thread_id: thread, item_id: input.item_id, turn_id: 'turn', run_id: 'run', path: input.path, value,
  })) };
  return { api, reader: createActivityFieldReader(api), expected: value };
}
describe('visible atomic activity values', () => {
  it('reads the selected row once without requesting sibling fields', async () => {
    const { api, reader, expected } = fixture({ content: 'a'.repeat(60000), format: 'code' });
    expect(await readActivityValue(reader, 'thread', 'tool', '/payload/rows/70', new AbortController().signal)).toEqual(expected);
    expect(api.loadActivityValue).toHaveBeenCalledTimes(1);
    expect(api.loadActivityValue.mock.calls[0][1]).toMatchObject({ item_id: 'tool', path: '/payload/rows/70', maximum_bytes: 98304, maximum_nodes: 96 });
  });
  it('rejects a response outside its requested byte budget', async () => {
    const { reader } = fixture({ content: 'a'.repeat(100000) });
    await expect(readActivityValue(reader, 'thread', 'tool', '/payload/rows/70', new AbortController().signal)).rejects.toThrow('invalid atomic value');
  });
  it('does not read a canceled visible value', async () => {
    const { api, reader } = fixture(); const scope = new AbortController(); scope.abort();
    await expect(readActivityValue(reader, 'thread', 'tool', '/payload/rows/70', scope.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.loadActivityValue).not.toHaveBeenCalled();
  });
  it('rejects wrong owner and excessive structure', async () => {
    const { reader } = fixture(Array.from({length: 100}, () => false));
    await expect(reader.value('thread', 'tool', '/payload/rows', new AbortController().signal, 4096, 16)).rejects.toThrow('structure budget');
    const wrong = createActivityFieldReader({ loadActivityValue: async () => ({ thread_id: 'other', item_id: 'tool', path: '', turn_id: 'turn', run_id: 'run', value: null }) });
    await expect(wrong.value('thread', 'tool', '', new AbortController().signal)).rejects.toThrow('invalid atomic value');
  });
  it('reads legal heavily escaped code through bounded frozen source chunks', async () => {
    const content = '<>&'.repeat(21845);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const api = {
      loadActivityValue: vi.fn(async () => ({ thread_id: 'thread', item_id: 'tool', turn_id: 'turn', run_id: 'run', path: '/payload/rows/0',
        value: { format: 'code', language: 'html' },
        text_fields: [{ path: '/payload/rows/0/content', kind: 'string' as const, source_id: 'frozen', run_id: 'run', bytes: bytes.length }] })),
      loadActivityField: vi.fn(async (_thread: string, input: { path: string; offset_bytes: number; limit_bytes?: number }) => ({
        thread_id: 'thread', path: input.path, source_id: 'frozen', run_id: 'run', offset_bytes: input.offset_bytes, bytes: bytes.length,
        text: new TextDecoder().decode(bytes.slice(input.offset_bytes, input.offset_bytes + Math.min(input.limit_bytes ?? 0, 4096))) })),
    };
    const reader = createActivityFieldReader(api);
    expect(await readActivityRow(reader, 'thread', 'tool', '/payload/rows/0', new AbortController().signal)).toEqual({ format: 'code', language: 'html', content });
    expect(api.loadActivityValue).toHaveBeenCalledTimes(1);
    expect(api.loadActivityField.mock.calls.length).toBe(16);
    expect(api.loadActivityField.mock.calls.every(([, request]) => request.limit_bytes! <= 16384)).toBe(true);
  });
  it('preserves legal oversized Markdown as a frozen source and reads only normalized titles', async () => {
    const content = '\n'.repeat(70000) + '    preserved indentation\n';
    const title = ' '.repeat(40000) + 'Title';
    const values = { title, content };
    const api = {
      loadActivityValue: async () => ({ thread_id: 'thread', item_id: 'tool', turn_id: 'turn', run_id: 'run', path: '/payload/rows/0',
        value: { format: 'markdown' }, text_fields: Object.entries(values).map(([name, text]) => ({ path: '/payload/rows/0/' + name,
          kind: 'string' as const, source_id: name, run_id: 'run', bytes: new TextEncoder().encode(text).length,
          text_extent: { start_bytes: new TextEncoder().encode(text.slice(0, text.length - text.trimStart().length)).length,
            end_bytes: new TextEncoder().encode(text.trimEnd()).length } })) }),
      loadActivityField: vi.fn(async (_thread: string, input: { path: string; source_id?: string; offset_bytes: number; limit_bytes?: number }) => {
        const bytes = new TextEncoder().encode(values[input.source_id as keyof typeof values]);
        return { thread_id: 'thread', path: input.path, source_id: input.source_id, run_id: 'run', offset_bytes: input.offset_bytes, bytes: bytes.length,
          text: new TextDecoder().decode(bytes.slice(input.offset_bytes, input.offset_bytes + input.limit_bytes!)) };
      }),
    };
    const row = await readActivityRowSnapshot(createActivityFieldReader(api), 'thread', 'tool', '/payload/rows/0', new AbortController().signal);
    expect(row.value).toEqual({ format: 'markdown', title: 'Title' });
    expect(row.content).toMatchObject({ source_id: 'content', bytes: new TextEncoder().encode(content).length });
    expect(api.loadActivityField.mock.calls).toHaveLength(1);
    expect(api.loadActivityField.mock.calls[0][1]).toMatchObject({ source_id: 'title', offset_bytes: 40000 });
    expect(api.loadActivityField.mock.calls.every(([, input]) => input.limit_bytes! <= 16384)).toBe(true);
  });
  it('rejects deferred sources from other fields or execution owners', async () => {
    for (const field of [
      { path: '/payload/rows/1/content', kind: 'string' as const, source_id: 'frozen', run_id: 'run', bytes: 1 },
      { path: '/payload/rows/0/content', kind: 'string' as const, source_id: 'frozen', run_id: 'other', bytes: 1 },
      { path: '/payload/rows/0/content', kind: 'string' as const, bytes: 1 },
    ]) {
      const reader = createActivityFieldReader({ loadActivityValue: async () => ({ thread_id: 'thread', item_id: 'tool', turn_id: 'turn', run_id: 'run',
        path: '/payload/rows/0', value: { format: 'text' }, text_fields: [field] }) });
      await expect(readActivityRow(reader, 'thread', 'tool', '/payload/rows/0', new AbortController().signal)).rejects.toThrow('deferred ownership');
    }
  });
});
