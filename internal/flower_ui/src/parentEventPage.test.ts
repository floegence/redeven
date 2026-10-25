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

it('accepts chronological backward pages and rejects direction conflicts', () => {
  const tail = { thread_id: 'parent', events: [event('middle'), event('a')], first_event_id: 'z', last_event_id: 'a', previous_before_event_id: 'middle' };
  expect(validateParentEventPage(tail, 'parent', { action: 'list', latest: true })).toBe(tail);
  const head = { thread_id: 'parent', events: [event('z')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'z' };
  expect(validateParentEventPage(head, 'parent', { ...query, before_event_id: 'middle' })).toBe(head);
  expect(() => validateParentEventPage(tail, 'parent', { action: 'list', latest: true, after_event_id: 'z' })).toThrow();
  expect(() => validateParentEventPage({ ...tail, previous_before_event_id: 'a' }, 'parent', { action: 'list', latest: true })).toThrow();
});
it('rejects repeated and reversed canonical receipt positions', () => {
  for (const positions of [[2, 2], [3, 2]]) {
    const page = { thread_id: 'parent', events: [event('z'), event('a')].map((entry, index) => ({ ...entry, canonical_ordinal: positions[index] })), first_event_id: 'z', last_event_id: 'a' };
    expect(() => validateParentEventPage(page, 'parent')).toThrow();
  }
});

it('validates source-bound ordinal receipt queries without treating an interval end as global EOF', () => {
  const page = { thread_id: 'parent', leaf_id: 'accepted', events: [{ ...event('middle'), canonical_ordinal: 20 }], first_event_id: 'first', last_event_id: 'last', previous_before_event_id: 'middle', next_after_event_id: 'middle' };
  const query = { action: 'list' as const, leaf_id: 'accepted', after_ordinal: 19, before_ordinal: 21, limit: 50 };
  expect(validateParentEventPage(page, 'parent', query)).toBe(page);
  for (const invalid of [
    { ...page, leaf_id: 'other' }, { ...page, leaf_id: undefined },
    { ...page, events: [{ ...event('middle'), canonical_ordinal: 19 }] },
    { ...page, events: [{ ...event('middle'), canonical_ordinal: 21 }] },
    { ...page, events: [event('middle')] },
  ]) expect(() => validateParentEventPage(invalid, 'parent', query)).toThrow('Flower contract error:');
});

it('rejects conflicting and malformed receipt source selectors', () => {
  const page = { thread_id: 'parent', leaf_id: 'accepted', events: [{ ...event('middle'), canonical_ordinal: 20 }], first_event_id: 'first', last_event_id: 'last' };
  for (const query of [
    { action: 'list' as const, after_ordinal: 2, after_event_id: 'first' },
    { action: 'list' as const, before_ordinal: 22, latest: true },
    { action: 'list' as const, after_ordinal: 21, before_ordinal: 20 },
    { action: 'list' as const, after_ordinal: -1 }, { action: 'list' as const, before_ordinal: 1.5 },
    { action: 'read' as const, event_id: 'middle', leaf_id: 'accepted' },
  ]) expect(() => validateParentEventPage(page, 'parent', query)).toThrow('Flower contract error:');
});
