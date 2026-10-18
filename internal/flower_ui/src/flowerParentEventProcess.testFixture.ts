import type { FlowerParentEvent, FlowerParentEventPage } from './contracts/flowerSurfaceContracts';

// Anonymized receipt shape: seven reports and two completions during failed
// work, followed by one report and one completion after the parent ended.
export const parentProcessEvents: readonly FlowerParentEvent[] = Array.from({ length: 11 }, (_, index) => ({
  id: 'event-' + index, parent_thread_id: 'process', parent_turn_id: 'turn',
  source_thread_id: 'child-' + index % 3, source_turn_id: 'child-turn-' + index % 3,
  source_run_id: 'child-run-' + index % 3, source_entry_id: 'child-entry-' + index,
  kind: index === 7 || index === 8 || index === 10 ? 'completed' : 'report',
  received_at: index < 9 ? '2026-10-11T12:01:00Z' : index === 9 ? '2026-10-11T12:03:23Z' : '2026-10-11T12:05:07Z',
  admitted: true, message: index === 7 || index === 8 || index === 10 ? undefined : 'Finding ' + index + '\n' + 'Complete evidence with original formatting.\n'.repeat(8),
}));

export function parentProcessPage(events = parentProcessEvents): FlowerParentEventPage {
  return { thread_id: 'process', events, first_event_id: events[0]?.id, last_event_id: events.at(-1)?.id };
}
