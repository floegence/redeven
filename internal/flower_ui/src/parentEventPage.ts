import type { FlowerParentEventPage, FlowerParentEventQuery } from './contracts/flowerSurfaceContracts';

const kinds = new Set(['report', 'completed', 'failed', 'cancelled', 'interrupted', 'timed_out', 'input_required', 'approval_required']);
const identityFields = ['id', 'parent_thread_id', 'source_thread_id', 'source_turn_id', 'source_run_id', 'source_entry_id'] as const;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim();

export function validateParentEventPage(value: unknown, threadID: string, query?: FlowerParentEventQuery): FlowerParentEventPage {
  const invalid = (): never => { throw new Error('Flower contract error: invalid parent event page.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const page = value as Record<string, unknown>;
  const ordinalQuery = query?.after_ordinal !== undefined || query?.before_ordinal !== undefined;
  if (query?.leaf_id !== undefined && (!nonempty(query.leaf_id) || page.leaf_id !== query.leaf_id)) return invalid();
  if (ordinalQuery) {
    if (query?.action !== 'list' || query.after_event_id || query.before_event_id || query.latest) return invalid();
    for (const position of [query.after_ordinal, query.before_ordinal]) {
      if (position !== undefined && (!Number.isSafeInteger(position) || position < 0)) return invalid();
    }
    if (query.after_ordinal && query.before_ordinal && query.after_ordinal >= query.before_ordinal) return invalid();
  }
  if (query?.action === 'read' && query.leaf_id) return invalid();
  if (query?.after_event_id && (query.before_event_id || query.latest)) return invalid();
  const backward = Boolean(query?.before_event_id || query?.latest || !query && page.previous_before_event_id);
  const continuation = backward ? page.previous_before_event_id : page.next_after_event_id;
  if (!nonempty(threadID) || page.thread_id !== threadID || !Array.isArray(page.events)) return invalid();
  for (const field of ['leaf_id', 'first_event_id', 'last_event_id', 'next_after_event_id', 'previous_before_event_id']) {
    if (page[field] !== undefined && !nonempty(page[field])) return invalid();
  }
  const first = page.first_event_id;
  const last = page.last_event_id;
  if (Boolean(first) !== Boolean(last) || (page.events.length > 0 && !first)) return invalid();
  const seen = new Set<string>();
  let ordinal = 0;
  for (const raw of page.events) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
    const event = raw as Record<string, unknown>;
    if ((event.canonical_ordinal !== undefined && (!Number.isSafeInteger(event.canonical_ordinal) || Number(event.canonical_ordinal) < 1))
      || identityFields.some(field => !nonempty(event[field]))
      || typeof event.kind !== 'string' || !kinds.has(event.kind) || !nonempty(event.received_at) || !Number.isFinite(Date.parse(event.received_at))
      || typeof event.admitted !== 'boolean' || (event.resolved !== undefined && typeof event.resolved !== 'boolean')
      || (event.message !== undefined && typeof event.message !== 'string') || seen.has(event.id as string)) return invalid();
    if (['parent_turn_id', 'reason_code', 'interaction_id'].some(field => event[field] !== undefined && !nonempty(event[field]))) return invalid();
    if (query?.action === 'read' && event.kind === 'report' && (typeof event.message !== 'string' || !event.message.trim())) return invalid();
    if (ordinalQuery && (event.canonical_ordinal === undefined
      || query?.after_ordinal && Number(event.canonical_ordinal) <= query.after_ordinal
      || query?.before_ordinal && Number(event.canonical_ordinal) >= query.before_ordinal)) return invalid();
    if (event.canonical_ordinal !== undefined) {
      if (Number(event.canonical_ordinal) <= ordinal) return invalid();
      ordinal = Number(event.canonical_ordinal);
    }
    seen.add(event.id as string);
  }
  if (page.next_after_event_id !== undefined && (page.events.length === 0
    || page.next_after_event_id !== page.events.at(-1)?.id || page.next_after_event_id === last
    || page.next_after_event_id === query?.after_event_id)) return invalid();
  if (seen.has(last as string) && (page.events.at(-1)?.id !== last || page.next_after_event_id !== undefined)) return invalid();
  if (page.previous_before_event_id !== undefined && (page.events.length === 0
    || page.previous_before_event_id !== page.events[0]?.id || page.previous_before_event_id === first
    || page.previous_before_event_id === query?.before_event_id)) return invalid();
  if (seen.has(first as string) && (page.events[0]?.id !== first || page.previous_before_event_id !== undefined)) return invalid();
  if (query?.before_event_id && seen.has(query.before_event_id)) return invalid();
  if (query?.event_id) {
    if (first !== query.event_id || last !== query.event_id || page.events.length !== 1 || page.events[0].id !== query.event_id) return invalid();
  } else if (query?.action === 'read') {
    if (first !== query.first_event_id || last !== query.last_event_id
      || (query.after_event_id && seen.has(query.after_event_id))
      || (!query.after_event_id && !backward && page.events[0]?.id !== first)
      || (page.events.length > 0 && !continuation && (backward ? page.events[0]?.id !== first : page.events.at(-1)?.id !== last))
      || (page.events.length === 0 && (continuation || (backward ? query.before_event_id !== first : query.after_event_id !== last)))) return invalid();
  } else if (query?.action !== 'list' && ((page.events.length === 0 && Boolean(first))
    || (page.events.length > 0 && (backward ? page.events.at(-1)?.id !== last || (!continuation && page.events[0].id !== first) : page.events[0].id !== first || (!continuation && page.events.at(-1)?.id !== last))))) return invalid();
  return value as FlowerParentEventPage;
}
