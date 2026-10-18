import type { FlowerParentEventPage, FlowerParentEventQuery } from './contracts/flowerSurfaceContracts';

const kinds = new Set(['report', 'completed', 'failed', 'cancelled', 'interrupted', 'timed_out', 'input_required', 'approval_required']);
const identityFields = ['id', 'parent_thread_id', 'source_thread_id', 'source_turn_id', 'source_run_id', 'source_entry_id'] as const;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim();

export function validateParentEventPage(value: unknown, threadID: string, query?: FlowerParentEventQuery): FlowerParentEventPage {
  const invalid = (): never => { throw new Error('Flower contract error: invalid parent event page.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.events)) return invalid();
  for (const field of ['first_event_id', 'last_event_id', 'next_after_event_id']) {
    if (page[field] !== undefined && !nonempty(page[field])) return invalid();
  }
  const first = page.first_event_id;
  const last = page.last_event_id;
  if (Boolean(first) !== Boolean(last) || (page.events.length > 0 && !first)) return invalid();
  const seen = new Set<string>();
  for (const raw of page.events) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
    const event = raw as Record<string, unknown>;
    if (identityFields.some(field => !nonempty(event[field])) || event.parent_thread_id !== threadID
      || typeof event.kind !== 'string' || !kinds.has(event.kind) || !nonempty(event.received_at) || !Number.isFinite(Date.parse(event.received_at))
      || typeof event.admitted !== 'boolean' || (event.resolved !== undefined && typeof event.resolved !== 'boolean')
      || (event.message !== undefined && typeof event.message !== 'string') || seen.has(event.id as string)) return invalid();
    if (['reason_code', 'interaction_id'].some(field => event[field] !== undefined && !nonempty(event[field]))) return invalid();
    if (query?.action === 'read' && event.kind === 'report' && (typeof event.message !== 'string' || !event.message.trim())) return invalid();
    seen.add(event.id as string);
  }
  if (page.next_after_event_id !== undefined && (page.events.length === 0
    || page.next_after_event_id !== page.events.at(-1)?.id || page.next_after_event_id === last
    || page.next_after_event_id === query?.after_event_id)) return invalid();
  if (seen.has(last as string) && (page.events.at(-1)?.id !== last || page.next_after_event_id !== undefined)) return invalid();
  if (query?.event_id) {
    if (first !== query.event_id || last !== query.event_id || page.events.length !== 1 || page.events[0].id !== query.event_id) return invalid();
  } else if (query?.action === 'read') {
    if (first !== query.first_event_id || last !== query.last_event_id
      || (query.after_event_id && seen.has(query.after_event_id))
      || (!query.after_event_id && page.events[0]?.id !== first)
      || (page.events.length > 0 && !page.next_after_event_id && page.events.at(-1)?.id !== last)
      || (page.events.length === 0 && (page.next_after_event_id || query.after_event_id !== last))) return invalid();
  } else if (query?.action !== 'list' && ((page.events.length === 0 && Boolean(first))
    || (page.events.length > 0 && (page.events[0].id !== first || (!page.next_after_event_id && page.events.at(-1)?.id !== last))))) return invalid();
  return value as FlowerParentEventPage;
}
