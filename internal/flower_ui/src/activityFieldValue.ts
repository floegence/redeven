import type { createActivityFieldReader } from './activityFieldReader';
import type { FlowerActivityField } from './contracts/flowerSurfaceContracts';

export const ACTIVITY_VALUE_BYTES = 96 << 10;
export const ACTIVITY_VALUE_NODES = 96;

export type ActivityRowSnapshot = Readonly<{ value: Record<string, unknown>; content?: FlowerActivityField }>;

// A complete selected row comes from one backend snapshot. Independent field
// requests cannot provide this guarantee while execution replaces the result.
export async function readActivityValue(reader: ReturnType<typeof createActivityFieldReader>, threadID: string, itemID: string, path: string, signal: AbortSignal,
  options: { maximumBytes?: number; maximumNodes?: number } = {}): Promise<unknown> {
  return reader.value(threadID, itemID, path, signal, options.maximumBytes ?? ACTIVITY_VALUE_BYTES, options.maximumNodes ?? ACTIVITY_VALUE_NODES);
}

// Structured display rows have a canonical 64 KiB code / 8,000 rune text
// bound. Acquire their metadata and text sources together, then decode complete
// fields in bounded wire chunks before parsing Markdown or highlighting code.
// JSON escaping must not make an otherwise legal row unreadable.
export async function readActivityRowSnapshot(reader: ReturnType<typeof createActivityFieldReader>, threadID: string, itemID: string, path: string, signal: AbortSignal): Promise<ActivityRowSnapshot> {
  const snapshot = await reader.snapshot(threadID, itemID, path, signal, 16 << 10, 32,
    ['format', 'language', 'target', 'truncated'], ['title', 'meta', 'content']);
  const row = { ...(snapshot.value as Record<string, unknown>) };
  let deferredContent: FlowerActivityField | undefined;
  for (const field of snapshot.text_fields ?? []) {
    const name = field.path.slice(path.length + 1);
    const maximum = name === 'content' ? 64 << 10 : 32000;
    if (name === 'content' && (field.bytes ?? 0) > maximum) {
      // Text and Markdown permit unbounded surrounding whitespace. Preserve
      // the exact frozen source for range rendering; never reinterpret it as
      // invalid code or allocate an unbounded joined string.
      if (row.format === 'code') throw new Error('Activity display row exceeds its source contract.');
      deferredContent = field;
      if (row.format === 'markdown') {
        row[name] = await readActivityMarkdown(reader, threadID, itemID, field, signal);
        deferredContent = undefined;
        continue;
      }
      // The presenter compares trimmed text for labels, empty screenshots and
      // repeated errors. Read that bounded semantic interval, while the field
      // renderer retains the exact whitespace and complete source geometry.
      if (!field.text_extent) throw new Error('Activity text row requires a source extent.');
    }
    const extent = name === 'content' && !deferredContent ? undefined : field.text_extent;
    const start = extent?.start_bytes ?? 0;
    const end = extent?.end_bytes ?? field.bytes ?? 0;
    if (end - start > maximum) throw new Error('Activity display row requires a source extent.');
    const chunks: string[] = [];
    let offset = start;
    while (offset < end) {
      const chunk = await reader.chunk(threadID, itemID, field, offset, signal);
      signal.throwIfAborted();
      const bytes = new TextEncoder().encode(chunk.text);
      chunks.push(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end - offset)));
      offset = chunk.next;
    }
    row[name] = chunks.join('') || (name === 'content' && deferredContent && (field.bytes ?? 0) > 0 ? ' ' : '');
  }
  return { value: row, ...(deferredContent ? { content: deferredContent } : {}) };
}

export async function readActivityRow(reader: ReturnType<typeof createActivityFieldReader>, threadID: string, itemID: string, path: string, signal: AbortSignal): Promise<unknown> {
  const snapshot = await readActivityRowSnapshot(reader, threadID, itemID, path, signal);
  if (snapshot.content) throw new Error('Activity row requires range rendering.');
  return snapshot.value;
}

// Markdown whitespace can change parsing and copied code, even outside the
// trimmed display extent. Read the exact selected document through bounded
// requests; never infer blank-line semantics from a sampled prefix.
async function readActivityMarkdown(reader: ReturnType<typeof createActivityFieldReader>, threadID: string, itemID: string,
  field: FlowerActivityField, signal: AbortSignal): Promise<string> {
  const chunks: string[] = [];
  for (let offset = 0; offset < (field.bytes ?? 0);) {
    const chunk = await reader.chunk(threadID, itemID, field, offset, signal);
    signal.throwIfAborted();
    chunks.push(chunk.text); offset = chunk.next;
    if (chunks.length % 4 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return chunks.join('');
}
