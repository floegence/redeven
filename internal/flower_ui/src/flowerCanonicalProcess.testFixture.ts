import type { FlowerRuntimeCurrentView } from './contracts/flowerSurfaceContracts';

// Anonymized structure of the reported failed research turn: two prose segments
// followed by tools, six child dynamics, and timestamps rewritten by old Forks.
export function canonicalProcessFixture(forkDepth = 0): FlowerRuntimeCurrentView {
  const threadID = forkDepth ? 'research-fork-' + forkDepth : 'research-source';
  const at = '2026-10-18T12:00:00Z';
  return {
    thread_id: threadID, view_version: 1, turn_id: 'research-turn', run_id: 'research-run', activity: 'idle', last_outcome: 'failed',
    turns: [{ turn_id: 'research-turn', run_id: 'research-run', started_at: at, ended_at: '2026-10-18T12:02:16Z',
      outcome: 'failed', elapsed_ms: 136000, waiting_ms: 0, work_duration_ms: 136000,
      intermediate_item_ids: ['research-intro', 'research-progress'], final_item_ids: [], final_boundary_complete: false }],
    items: [
      { id: 'research-user', ordinal: 1, canonical_ordinal: 2, kind: 'user' as const, text: 'Inspect the project.' },
      { id: 'research-intro', ordinal: 2, canonical_ordinal: 3, kind: 'assistant' as const, text: 'I will inspect the sources.' },
      { id: 'research-tool-a', ordinal: 3, canonical_ordinal: 4, kind: 'tool' as const, activity: {
        item_id: 'inspect-a', tool_id: 'inspect-a', tool_name: 'terminal.exec', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
      } },
      { id: 'research-progress', ordinal: 4, canonical_ordinal: 8, kind: 'assistant' as const, text: 'The first source is confirmed.' },
      { id: 'research-tool-b', ordinal: 5, canonical_ordinal: 9, kind: 'tool' as const, activity: {
        item_id: 'inspect-b', tool_id: 'inspect-b', tool_name: 'terminal.exec', kind: 'tool', status: 'error', severity: 'error', needs_attention: false, requires_approval: false,
      } },
    ].map(item => ({ ...item, turn_id: 'research-turn', run_id: 'research-run', created_at: forkDepth ? '2026-10-18T15:17:31Z' : at })),
    parent_events: { thread_id: threadID, first_event_id: 'research-event-0', last_event_id: 'research-event-5', events: Array.from({ length: 6 }, (_, index) => ({
      id: 'research-event-' + index, canonical_ordinal: [5, 6, 7, 10, 11, 12][index], parent_thread_id: 'research-source', parent_turn_id: 'research-turn',
      source_thread_id: 'research-child', source_turn_id: 'child-turn', source_run_id: 'child-run', source_entry_id: 'child-entry-' + index,
      kind: index < 4 ? 'report' as const : index === 4 ? 'failed' as const : 'completed' as const,
      ...(index < 4 ? { message: 'Confirmed finding ' + index } : {}), received_at: '2026-10-18T12:01:00Z', admitted: true,
    })) },
  };
}
