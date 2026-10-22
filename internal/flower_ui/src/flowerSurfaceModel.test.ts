import { describe, expect, it } from 'vitest';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { flowerThreadHasActiveTurnEvidence, projectFlowerThreadListItem } from './flowerSurfaceModel';

function snapshot(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-active-evidence',
    title: 'Active evidence',
    title_status: 'ready', title_generation: 1,
    model_id: 'provider/model',
    working_dir: '/workspace',
    settings_revision: 1,
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'idle',
    source_label: 'Local Environment',
    target_labels: [],
    messages: [],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 2 },
      read_state: { last_seen_activity_revision: 2 },
    },
    ...overrides,
  };
}

describe('flowerThreadHasActiveTurnEvidence', () => {
  it.each(['running', 'waiting_approval', 'waiting_user'] as const)('accepts %s as active evidence', (status) => {
    expect(flowerThreadHasActiveTurnEvidence(snapshot({ status }))).toBe(true);
  });

  it('accepts retained turn identities even when status is stale', () => {
    expect(flowerThreadHasActiveTurnEvidence(snapshot({ active_run_id: 'run-a' }))).toBe(true);
    expect(flowerThreadHasActiveTurnEvidence(snapshot({
      active_run_id: 'run-b',
      run_progress: { phase: 'finalizing', run_id: 'run-b', turn_id: 'turn-b' },
    }))).toBe(true);
  });

  it('rejects a terminal snapshot without an active identity', () => {
    expect(flowerThreadHasActiveTurnEvidence(snapshot({ status: 'success' }))).toBe(false);
  });
});

describe('projectFlowerThreadListItem preview', () => {
  type Message = FlowerThreadSnapshot['messages'][number];
  const message = (content: string, blocks: Message['blocks'] = []): Message => ({
    id: 'message', role: 'assistant', content, blocks,
  } as Message);

  it('stops at the newest nonempty preview without reading older bodies', () => {
    const older = message('historical');
    Object.defineProperty(older, 'content', { get: () => { throw new Error('older content accessed'); } });
    const thread = snapshot({ messages: [older, message(' latest '), message(' ')] });
    expect(projectFlowerThreadListItem(thread).preview).toBe('latest');
    expect(thread.messages[0]).toBe(older);
  });

  it.each([
    { messages: [], expected: '' },
    { messages: [message(' ')], expected: '' },
    { messages: [message('earlier'), message('')], expected: 'earlier' },
    { messages: [message('body', [{ type: 'text', content: 'block' }])], expected: 'body' },
    { messages: [message('', [{ type: 'text', content: ' first ' }, { type: 'markdown', content: ' second ' }])], expected: 'first\n\nsecond' },
    { messages: [message('earlier'), message(' ', [{ type: 'text', content: 'ignored by existing whitespace-body semantics' }])], expected: 'earlier' },
  ])('preserves the existing preview result: $expected', ({ messages, expected }) => {
    expect(projectFlowerThreadListItem(snapshot({ messages })).preview).toBe(expected);
  });
});
