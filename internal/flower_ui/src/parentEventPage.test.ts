import { expect, it } from 'vitest';
import { validateParentEventPage } from './parentEventPage';
import type { FlowerParentEvent } from './contracts/flowerSurfaceContracts';

const event = (id: string): FlowerParentEvent => ({ id, parent_thread_id: 'parent', source_thread_id: 'child', source_turn_id: 'turn', source_run_id: 'run', source_entry_id: 'entry', kind: 'report', received_at: '2026-10-18T00:00:00Z', admitted: false, message: 'Report' });
const query = { action: 'read' as const, first_event_id: 'z', last_event_id: 'a', limit: 50 };
it('keeps opaque event order and accepts a fixed-range continuation', () => {
  const first = { events: [event('z')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'z' };
  expect(validateParentEventPage(first, 'parent', query)).toBe(first);
  const last = { events: [event('a')], first_event_id: 'z', last_event_id: 'a' };
  expect(validateParentEventPage(last, 'parent', { ...query, after_event_id: 'z' })).toBe(last);
});
it.each([
  { events: null }, { events: 'invalid' }, { events: [{}] },
  {}, { events: [], first_event_id: 'z', last_event_id: 'a' },
  { events: [event('z'), event('a')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'a' },
  { events: [event('z'), event('a'), event('middle')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'middle' },
  { events: [event('z'), event('z')], first_event_id: 'z', last_event_id: 'a' },
  { events: [{ ...event('z'), parent_thread_id: 'other' }], first_event_id: 'z', last_event_id: 'a' },
  { events: [{ ...event('z'), kind: ['report'] }], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'z' },
  { events: [event('z')], first_event_id: 'other', last_event_id: 'a' },
  { events: [event('z')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'unknown' },
  { events: [event('z')], first_event_id: 'z', last_event_id: 'a' },
  { events: [{ ...event('z'), message: undefined }], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'z' },
])('rejects malformed or incomplete fixed-range pages: %j', value => {
  expect(() => validateParentEventPage(value, 'parent', query)).toThrow('Flower contract error:');
});
it('rejects cursor loops and repeated boundary events', () => {
  expect(() => validateParentEventPage({ events: [event('z')], first_event_id: 'z', last_event_id: 'a', next_after_event_id: 'z' }, 'parent', { ...query, after_event_id: 'z' })).toThrow();
});
it('rejects a malformed canonical empty range before publication', () => {
  expect(() => validateParentEventPage({ events: [], first_event_id: 'z', last_event_id: 'a' }, 'parent')).toThrow();
});
