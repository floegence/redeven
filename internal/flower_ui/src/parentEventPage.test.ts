import { expect, it } from 'vitest';
import { validateParentEventPage } from './parentEventPage';
import type { FlowerParentEvent } from './contracts/flowerSurfaceContracts';

const event = (id: string): FlowerParentEvent => ({ id, parent_thread_id: 'parent', source_thread_id: 'child', source_turn_id: 'turn', source_run_id: 'run', source_entry_id: 'entry', kind: 'report', received_at: '2026-10-18T00:00:00Z', admitted: false, message: 'Report' });
const query = { action: 'read' as const, first_event_id: 'z', last_event_id: 'a', limit: 50 };
it.each(['', ' ', ' turn ', null, 1])('rejects malformed optional parent turn identity %j', (parent_turn_id) => {
  const page = { thread_id: 'parent', events: [{ ...event('z'), parent_turn_id }], first_event_id: 'z', last_event_id: 'z' };
  expect(() => validateParentEventPage(page, 'parent')).toThrow('Flower contract error:');
});
it('preserves explicit inherited ownership while allowing genuinely unowned events', () => {
  const page = { thread_id: 'fork', events: [{ ...event('z'), parent_turn_id: 'original-turn' }, event('a')], first_event_id: 'z', last_event_id: 'a' };
  expect(validateParentEventPage(page, 'fork')).toBe(page);
});
it('keeps opaque event order and accepts a fixed-range continuation', () => {
  const first = { thread_id: 'parent', events: [event('z')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'z' };
  expect(validateParentEventPage(first, 'parent', query)).toBe(first);
  const last = { thread_id: 'parent', events: [event('a')], first_event_id: 'z', last_event_id: 'a' };
  expect(validateParentEventPage(last, 'parent', { ...query, after_event_id: 'z' })).toBe(last);
});
it.each([
  { thread_id: 'parent', events: null }, { thread_id: 'parent', events: 'invalid' }, { thread_id: 'parent', events: [{}] },
  {}, { thread_id: 'parent', events: [], first_event_id: 'z', last_event_id: 'a' },
  { thread_id: 'parent', events: [event('z'), event('a')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'a' },
  { thread_id: 'parent', events: [event('z'), event('a'), event('middle')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'middle' },
  { thread_id: 'parent', events: [event('z'), event('z')], first_event_id: 'z', last_event_id: 'a' },
  { thread_id: 'other', events: [event('z')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'z' },
  { thread_id: 'parent', events: [{ ...event('z'), kind: ['report'] }], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'z' },
  { thread_id: 'parent', events: [event('z')], first_event_id: 'other', last_event_id: 'a' },
  { thread_id: 'parent', events: [event('z')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'unknown' },
  { thread_id: 'parent', events: [event('z')], first_event_id: 'z', last_event_id: 'a' },
  { thread_id: 'parent', events: [{ ...event('z'), message: undefined }], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'z' },
])('rejects malformed or incomplete fixed-range pages: %j', value => {
  expect(() => validateParentEventPage(value, 'parent', query)).toThrow('Flower contract error:');
});
it('rejects cursor loops and repeated boundary events', () => {
  expect(() => validateParentEventPage({ thread_id: 'parent', events: [event('z')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'z' }, 'parent', { ...query, after_event_id: 'z' })).toThrow();
});
it('rejects a malformed canonical empty range before publication', () => {
  expect(() => validateParentEventPage({ thread_id: 'parent', events: [], first_event_id: 'z', last_event_id: 'a' }, 'parent')).toThrow();
});

it('accepts inherited event recipients only under the explicit queried page scope', () => {
  const inherited = { thread_id: 'fork', events: [event('z'), { ...event('a'), parent_thread_id: 'fork' }], first_event_id: 'z', last_event_id: 'a' };
  expect(validateParentEventPage(inherited, 'fork', query)).toBe(inherited);
  expect(() => validateParentEventPage(inherited, 'parent', query)).toThrow('Flower contract error:');
  expect(() => validateParentEventPage({ ...inherited, thread_id: undefined }, 'fork', query)).toThrow('Flower contract error:');
  expect(validateParentEventPage({ thread_id: 'fork', events: [] }, 'fork').events).toEqual([]);
});
