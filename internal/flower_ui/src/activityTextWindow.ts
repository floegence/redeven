import { ACTIVITY_FIELD_CHUNK_BYTES, type createActivityFieldReader } from './activityFieldReader';
import type { FlowerActivityField } from './contracts/flowerSurfaceContracts';

type Reader = ReturnType<typeof createActivityFieldReader>;
export type ActivityTextChunk = Readonly<{ offset: number; text: string; next: number }>;
export type ActivityTextInterval = Readonly<{ first: number; last: number }>;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const overlaps = (chunk: ActivityTextChunk, interval: ActivityTextInterval) => chunk.offset < interval.last && chunk.next > interval.first;

// Retain a finite reading interval plus the exact selected/visible islands.
// A distant selection never pins the unselected bytes between it and reading.
// Gaps are source offsets, so returning to them never scans the omitted prefix.
export function createActivityTextWindow(reader: Reader, threadID: string, itemID: string, field: FlowerActivityField,
  maximumBytes = 128 << 10) {
  if (field.kind !== 'string' || !Number.isSafeInteger(field.bytes ?? 0) || (field.bytes ?? 0) < 0
    || maximumBytes < 2 * ACTIVITY_FIELD_CHUNK_BYTES) throw new Error('Invalid field window.');
  let extent = field.bytes ?? 0;
  let generation = 0;
  let chunks: ActivityTextChunk[] = [];
  let pending: Promise<boolean> | undefined;
  let pendingSignal: AbortSignal | undefined;
  let retainedBytes = 0;
  let readingOffset = 0;
  const interval = () => {
    if (!chunks.length) return { first: 0, last: 0, start: 0, end: 0 };
    let start = chunks.findIndex(chunk => chunk.offset <= readingOffset && chunk.next > readingOffset);
    if (start < 0) start = chunks.findIndex(chunk => chunk.offset >= readingOffset);
    if (start < 0) start = chunks.length - 1;
    let end = start;
    while (start > 0 && chunks[start - 1].next === chunks[start].offset) start--;
    while (end + 1 < chunks.length && chunks[end].next === chunks[end + 1].offset) end++;
    return { first: chunks[start].offset, last: chunks[end].next, start, end };
  };
  const trim = (direction: 'before' | 'after', pins: readonly ActivityTextInterval[]) => {
    // Pinning can temporarily retain the explicitly selected bytes in addition
    // to the normal cache. Unpinned bytes always stay within the normal budget.
    const pinnedBytes = chunks.reduce((total, chunk) => total + (pins.some(pin => overlaps(chunk, pin)) ? chunk.next - chunk.offset : 0), 0);
    const limit = Math.max(maximumBytes, pinnedBytes + (pinnedBytes ? ACTIVITY_FIELD_CHUNK_BYTES : 0));
    const distance = (chunk: ActivityTextChunk) => Math.max(chunk.offset - readingOffset, readingOffset - chunk.next, 0);
    const candidates = chunks.filter(chunk => !pins.some(pin => overlaps(chunk, pin)))
      .sort((a, b) => distance(b) - distance(a) || (direction === 'after' ? a.offset - b.offset : b.offset - a.offset));
    for (const chunk of candidates) {
      if (retainedBytes <= limit) break;
      chunks.splice(chunks.indexOf(chunk), 1);
      retainedBytes -= chunk.next - chunk.offset;
    }
  };
  return {
    get chunks(): readonly ActivityTextChunk[] { return chunks; },
    get bytes() { return retainedBytes; },
    get hasBefore() { return interval().first > 0; },
    get hasAfter() { return interval().last < extent; },
    focus(offset: number) { if (Number.isSafeInteger(offset) && offset >= 0 && offset <= extent) readingOffset = offset; },
    async replace(nextField: FlowerActivityField, signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      if (nextField.kind !== 'string' || nextField.path !== field.path || !Number.isSafeInteger(nextField.bytes ?? 0) || (nextField.bytes ?? 0) < 0) throw new Error('Invalid replacement field.');
      const epoch = ++generation;
      const nextExtent = nextField.bytes ?? 0;
      const nextChunks: ActivityTextChunk[] = [];
      // Verify retained islands only. Their gaps are never fetched by a source
      // handoff, and identical chunks retain their DOM and selection identity.
      for (const original of chunks) {
        if (original.offset >= nextExtent) continue;
        let offset = original.offset;
        const through = Math.min(original.next, nextExtent);
        const parts: string[] = [];
        let first = original.offset;
        while (offset < through) {
          // Source replacement may move code-point boundaries. Align only the
          // first read, then retain a contiguous UTF-8 range in the new source.
          const part = await reader.chunk(threadID, itemID, nextField, offset, signal, parts.length === 0);
          signal.throwIfAborted();
          if (epoch !== generation) throw new DOMException('Field replacement superseded.', 'AbortError');
          const raw = encoder.encode(part.text);
          let length = Math.min(raw.length, through - part.offset);
          while (length < raw.length && length > 0 && (raw[length] & 0xc0) === 0x80) length--;
          const end = part.offset + length;
          if (parts.length ? part.offset !== offset : part.offset > offset || offset - part.offset > 3) throw new Error('Field replacement is not contiguous.');
          if (!parts.length) first = part.offset;
          if (end <= part.offset) break;
          parts.push(decoder.decode(raw.subarray(0, length)));
          offset = end;
          // through can now fall inside a code point. The next old chunk is
          // aligned to this same boundary; retrying through would never advance.
          if (part.next >= through) break;
        }
        if (!parts.length) continue;
        const text = parts.join('');
        nextChunks.push(original.offset === first && original.next === offset && original.text === text
          ? original : { offset: first, text, next: offset });
      }
      signal.throwIfAborted();
      if (epoch !== generation) throw new DOMException('Field replacement superseded.', 'AbortError');
      field = nextField; extent = nextExtent; chunks = nextChunks;
      readingOffset = Math.min(readingOffset, extent);
      retainedBytes = nextChunks.reduce((total, chunk) => total + chunk.next - chunk.offset, 0);
    },
    read(direction: 'before' | 'after', signal: AbortSignal, pin?: ActivityTextInterval | readonly ActivityTextInterval[] | (() => readonly ActivityTextInterval[]), at?: number): Promise<boolean> {
      signal.throwIfAborted();
      if (pending && !pendingSignal?.aborted) return pending;
      let current = interval();
      if (at !== undefined) {
        if (!Number.isSafeInteger(at) || at < 0 || at >= extent) throw new Error('Invalid field seek.');
        if (chunks.some(chunk => chunk.offset <= at && chunk.next > at)) return Promise.resolve(false);
        const next = chunks.findIndex(chunk => chunk.offset > at);
        current = { first: at, last: at, start: next < 0 ? chunks.length : next, end: (next < 0 ? chunks.length : next) - 1 };
      }
      const { first, last, start, end } = current;
      if (direction === 'before' && first === 0 || direction === 'after' && last === extent) return Promise.resolve(false);
      const prior = start > 0 ? chunks[start - 1].next : 0;
      const following = end + 1 < chunks.length ? chunks[end + 1].offset : extent;
      const epoch = generation;
      const source = field;
      const operation = async () => {
        const loaded: ActivityTextChunk[] = [];
        let offset = direction === 'after' ? last : Math.max(prior, first - ACTIVITY_FIELD_CHUNK_BYTES + 4);
        do {
          const part = await reader.chunk(threadID, itemID, source, offset, signal, (direction === 'before' || at !== undefined) && loaded.length === 0);
          signal.throwIfAborted();
          const stop = Math.min(part.next, direction === 'before' ? first : following);
          if (stop <= part.offset || part.offset < prior || loaded.length && part.offset !== offset) throw new Error('Field range made no progress.');
          const text = stop === part.next ? part.text : decoder.decode(encoder.encode(part.text).subarray(0, stop - part.offset));
          loaded.push({ offset: part.offset, text, next: stop });
          offset = stop;
        } while (direction === 'before' && offset < first);
        signal.throwIfAborted();
        if (epoch !== generation) throw new DOMException('Field read superseded.', 'AbortError');
        chunks = [...chunks, ...loaded].sort((a, b) => a.offset - b.offset);
        for (const part of loaded) retainedBytes += part.next - part.offset;
        readingOffset = direction === 'after' ? loaded.at(-1)!.offset : loaded[0].offset;
        // Selection and focus may change while transport is pending. Read the
        // current pins immediately before eviction, never a stale request copy.
        const pins = typeof pin === 'function' ? pin() : pin ? Array.isArray(pin) ? pin : [pin as ActivityTextInterval] : [];
        trim(direction, pins);
        return true;
      };
      const owned = operation().finally(() => { if (pending === owned) { pending = undefined; pendingSignal = undefined; } });
      pending = owned; pendingSignal = signal;
      return owned;
    },
  };
}
