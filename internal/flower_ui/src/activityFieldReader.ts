import type { FlowerActivityField, FlowerActivityFieldChunk, FlowerActivityStructurePage, FlowerActivityValue, FlowerSurfaceAdapter } from './contracts/flowerSurfaceContracts';
import { recoverHistoryRead } from './historyReadRecovery';
import { createActivityReadQueue } from './activityReadQueue';

const encoder = new TextEncoder();
export const ACTIVITY_FIELD_CHUNK_BYTES = 16 << 10;
export const ACTIVITY_FIELD_CACHE_BYTES = 16 << 20;
export const ACTIVITY_STRUCTURE_CACHE_BYTES = 2 << 20;
type Transport = Pick<FlowerSurfaceAdapter, 'loadActivityStructure' | 'loadActivityField' | 'loadActivityValue'>;

function boundedCache<T>(budget: number) {
  const entries = new Map<string, { value: T; bytes: number }>();
  let bytes = 0;
  return {
    get(key: string) { const entry = entries.get(key); if (entry) { entries.delete(key); entries.set(key, entry); } return entry?.value; },
    put(key: string, value: T) {
      const size = encoder.encode(JSON.stringify(value)).length;
      if (size > budget) return;
      const previous = entries.get(key);
      if (previous) { bytes -= previous.bytes; entries.delete(key); }
      while (bytes + size > budget && entries.size) {
        const [oldest, entry] = entries.entries().next().value!;
        entries.delete(oldest); bytes -= entry.bytes;
      }
      entries.set(key, { value, bytes: size }); bytes += size;
    },
    clear() { entries.clear(); bytes = 0; },
    get bytes() { return bytes; },
  };
}
function invalid(message: string): never { throw new Error('Flower activity field contract: ' + message); }
function integer(value: number | undefined) { return value !== undefined && Number.isSafeInteger(value) && value >= 0; }
function validateField(field: FlowerActivityField) {
  if (!field || typeof field.path !== 'string' || !['object', 'array', 'string', 'scalar'].includes(field.kind)) invalid('invalid field kind');
  if (field.kind === 'string' && (!integer(field.bytes ?? 0) || !integer(field.source_offset_bytes ?? 0))) invalid('invalid string field');
  if (field.text_extent && (field.kind !== 'string' || !integer(field.text_extent.start_bytes)
    || !integer(field.text_extent.end_bytes) || field.text_extent.start_bytes > field.text_extent.end_bytes
    || field.text_extent.end_bytes > (field.bytes ?? 0))) invalid('invalid text extent');
  if ((field.kind === 'object' || field.kind === 'array') && !integer(field.count ?? 0)) invalid('invalid collection field');
  if (field.kind === 'scalar' && field.value !== null && typeof field.value !== 'boolean'
    && !(typeof field.value === 'number' && Number.isFinite(field.value))) invalid('invalid scalar value');
}
export function activityFieldIdentity(field: FlowerActivityField): string {
  return JSON.stringify([field.path, field.source_id, field.run_id, field.entry_id, field.source_path, field.source_sha256, field.sha256, field.source_offset_bytes ?? 0, field.bytes ?? 0, field.inline_text, field.text_extent]);
}

// Each surface owns finite disposable caches. Unpinned structure reads always
// revalidate the current shape. A request never downloads an unread remainder.
export function createActivityFieldReader(transport: Transport, budgets = { fields: ACTIVITY_FIELD_CACHE_BYTES, structure: ACTIVITY_STRUCTURE_CACHE_BYTES }, queue = createActivityReadQueue()) {
  const fields = boundedCache<FlowerActivityFieldChunk>(budgets.fields);
  const structures = boundedCache<FlowerActivityStructurePage>(budgets.structure);
  let generation = 0;
  let scope = new AbortController();
  const lifetime = new AbortController();
  const reader = {
    async snapshot(threadID: string, itemID: string, path: string, signal: AbortSignal, maximumBytes = 96 << 10, maximumNodes = 96, selectedFields?: readonly string[], textFields?: readonly string[]): Promise<FlowerActivityValue> {
      signal.throwIfAborted(); lifetime.signal.throwIfAborted();
      if (!transport.loadActivityValue) invalid('atomic value transport is unavailable');
      if (!integer(maximumBytes) || maximumBytes < 1 || maximumBytes > (256 << 10)
        || !integer(maximumNodes) || maximumNodes < 1 || maximumNodes > 256) invalid('invalid value budget');
      const epoch = generation;
      const owned = AbortSignal.any([signal, lifetime.signal, scope.signal]);
      if (selectedFields && (!selectedFields.length || selectedFields.length > 64 || new Set(selectedFields).size !== selectedFields.length
        || selectedFields.some(field => !field || field.length > 128 || /[/~]/u.test(field)))) invalid('invalid selected fields');
      if (textFields && (!selectedFields || textFields.length > 8 || new Set(textFields).size !== textFields.length
        || textFields.some(field => !field || field.length > 128 || /[/~]/u.test(field) || selectedFields.includes(field)))) invalid('invalid deferred fields');
      const key = JSON.stringify([threadID, itemID, path, maximumBytes, maximumNodes, selectedFields, textFields]);
      const result = await queue.run('value:' + key, owned, readSignal => recoverHistoryRead(() => transport.loadActivityValue!(threadID,
        { item_id: itemID, path, maximum_bytes: maximumBytes, maximum_nodes: maximumNodes, ...(selectedFields ? { fields: selectedFields } : {}), ...(textFields ? { text_fields: textFields } : {}) }, readSignal), readSignal), 'interactive');
      owned.throwIfAborted();
      if (epoch !== generation) throw new DOMException('Read scope changed.', 'AbortError');
      if (result.thread_id !== threadID || result.item_id !== itemID || result.path !== path || !result.turn_id || !result.run_id
        || result.value === undefined || encoder.encode(JSON.stringify(result.value)).length > maximumBytes) invalid('invalid atomic value');
      let nodes = maximumNodes;
      const visit = (value: unknown) => {
        if (--nodes < 0) invalid('atomic value exceeds structure budget');
        if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
        if (!value || typeof value !== 'object' || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid('invalid atomic value kind');
        for (const child of Object.values(value as object)) visit(child);
      };
      visit(result.value);
      if (selectedFields && (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)
        || Object.keys(result.value).some(key => !selectedFields.includes(key)))) invalid('unexpected selected field');
      const returned = result.text_fields ?? [];
      if (returned.length > (textFields?.length ?? 0) || new Set(returned.map(field => field.path)).size !== returned.length
        || encoder.encode(JSON.stringify(returned)).length > (64 << 10)) invalid('invalid deferred sources');
      for (const field of returned) {
        validateField(field);
        if (field.kind !== 'string' || !textFields?.some(name => field.path === path + '/' + name)
          || field.source_id && field.run_id !== result.run_id
          || !field.source_id && field.inline_text === undefined && (!field.entry_id || !field.source_sha256 || !field.sha256)) invalid('invalid deferred ownership');
        if (field.inline_text !== undefined && encoder.encode(field.inline_text).length !== (field.bytes ?? 0)) invalid('invalid deferred extent');
      }
      return result;
    },
    async value(threadID: string, itemID: string, path: string, signal: AbortSignal, maximumBytes = 96 << 10, maximumNodes = 96, selectedFields?: readonly string[]): Promise<unknown> {
      return (await reader.snapshot(threadID, itemID, path, signal, maximumBytes, maximumNodes, selectedFields)).value;
    },
    async structure(threadID: string, itemID: string, path: string, signal: AbortSignal, offset = 0, version?: string, limit = 16) {
      signal.throwIfAborted();
      lifetime.signal.throwIfAborted();
      if (!transport.loadActivityStructure) invalid('structure transport is unavailable');
      const key = JSON.stringify([threadID, itemID, path, version, offset, limit]);
      // A resident version pins shape only. Text extents, scalar values and
      // frozen SourceIDs can change without changing that shape.
      const immutable = version && !version.startsWith('resident:');
      const cached = immutable ? structures.get(key) : undefined;
      if (cached) return cached;
      const epoch = generation;
      const owned = AbortSignal.any([signal, lifetime.signal, scope.signal]);
      const page = await queue.run('shape:' + key, owned, readSignal => recoverHistoryRead(() => transport.loadActivityStructure!(threadID, { item_id: itemID, path, offset, limit, ...(version ? { version } : {}) }, readSignal), readSignal), 'interactive');
      owned.throwIfAborted();
      if (epoch !== generation) throw new DOMException('Read scope changed.', 'AbortError');
      validateField(page.field);
      for (const child of page.children) {
        validateField(child);
        if (!child.path.startsWith(path + '/') || child.path.slice(path.length + 1).includes('/')) invalid('invalid child ownership');
      }
      if (page.thread_id !== threadID || page.item_id !== itemID || !page.turn_id || !page.run_id || page.field.path !== path || !page.version || version && page.version !== version
        || !integer(page.next) || page.next < offset || page.children.length > limit || page.has_more && (page.next <= offset || !page.children.length)
        || page.next !== offset + page.children.length || page.next > (page.field.count ?? 0)
        || page.has_more !== (page.next < (page.field.count ?? 0))
        || page.field.kind !== 'array' && page.field.kind !== 'object' && (page.children.length || page.has_more)
        || encoder.encode(JSON.stringify(page)).length > (64 << 10)) invalid('invalid structure page');
      if (new Set(page.children.map(child => child.path)).size !== page.children.length) invalid('duplicate structure child');
      if (!page.version.startsWith('resident:')) structures.put(JSON.stringify([threadID, itemID, path, page.version, offset, limit]), page);
      return page;
    },
    async chunk(threadID: string, itemID: string, field: FlowerActivityField, offset: number, signal: AbortSignal, alignStart = false) {
      signal.throwIfAborted();
      lifetime.signal.throwIfAborted();
      const extent = field.bytes ?? 0;
      if (field.kind !== 'string' || !integer(extent) || !integer(offset) || offset > extent
        || !integer(field.source_offset_bytes ?? 0)) invalid('invalid string extent');
      if (offset === extent) return { offset, text: '', next: offset, complete: true };
      if (field.inline_text !== undefined || extent === 0) {
        const raw = encoder.encode(field.inline_text ?? '');
        if (raw.length !== extent) invalid('inline extent differs');
        if (alignStart) while (offset > 0 && (raw[offset] & 0xc0) === 0x80) offset--;
        const bytes = raw.slice(offset, offset + ACTIVITY_FIELD_CHUNK_BYTES);
        let end = bytes.length;
        while (end > 0) {
          try { return { offset, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, end)), next: offset + end, complete: offset + end === extent }; }
          catch { if (bytes.length - --end > 3) invalid('invalid inline UTF-8'); }
        }
        return { offset, text: '', next: offset, complete: offset === extent };
      }
      if (!transport.loadActivityField) invalid('field transport is unavailable');
      if (!field.source_id && (!field.entry_id || !field.source_sha256 || !field.sha256)) invalid('string has no frozen source');
      const base = field.source_offset_bytes ?? 0;
      const path = field.source_path ?? field.path;
      const key = JSON.stringify([threadID, itemID, activityFieldIdentity(field), offset, alignStart]);
      const cached = fields.get(key);
      const epoch = generation;
      const owned = AbortSignal.any([signal, lifetime.signal, scope.signal]);
      const chunk = cached ?? await queue.run('field:' + key, owned, readSignal => recoverHistoryRead(() => transport.loadActivityField!(threadID, {
        item_id: itemID, path, entry_id: field.entry_id, source_sha256: field.source_sha256, sha256: field.sha256,
        source_id: field.source_id, run_id: field.run_id, offset_bytes: base + offset, limit_bytes: Math.max(4, Math.min(ACTIVITY_FIELD_CHUNK_BYTES, extent - offset)),
        ...(alignStart ? { align_start: true } : {}),
      }, readSignal), readSignal), 'interactive');
      owned.throwIfAborted();
      if (epoch !== generation) throw new DOMException('Read scope changed.', 'AbortError');
      const size = encoder.encode(chunk.text).length;
      const start = chunk.offset_bytes - base;
      if (chunk.thread_id !== threadID || chunk.path !== path || !integer(start) || start > offset || offset - start > (alignStart ? 3 : 0) || !integer(chunk.bytes)
        || chunk.bytes < base + extent || (chunk.source_id || undefined) !== field.source_id || field.run_id && chunk.run_id !== field.run_id
        || field.entry_id && chunk.entry_id !== field.entry_id || field.source_sha256 && chunk.source_sha256 !== field.source_sha256
        || field.sha256 && chunk.sha256 !== field.sha256 || size > ACTIVITY_FIELD_CHUNK_BYTES || offset < extent && size === 0
        || encoder.encode(JSON.stringify(chunk)).length > (64 << 10)) invalid('field source or extent changed');
      if (!cached) fields.put(key, chunk);
      let text = chunk.text;
      if (size > extent - start) text = new TextDecoder('utf-8', { fatal: true }).decode(encoder.encode(text).slice(0, extent - start));
      const next = start + encoder.encode(text).length;
      return { offset: start, text, next, complete: next === extent };
    },
    invalidate() { generation++; scope.abort(); scope = new AbortController(); fields.clear(); structures.clear(); },
    dispose() { lifetime.abort(); generation++; fields.clear(); structures.clear(); },
    get bytes() { return { fields: fields.bytes, structure: structures.bytes }; },
    get requests() { return { active: queue.active, pending: queue.pending }; },
  };
  return reader;
}
