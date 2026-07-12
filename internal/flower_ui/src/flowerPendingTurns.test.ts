import { describe, expect, it } from 'vitest';

import type { FlowerChatMessage, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import {
  pendingTurnCanonicalMessage,
  reconcilePendingTurnsForThread,
  type PendingFlowerTurn,
} from './flowerPendingTurns';

const contextAction = {
  schema_version: 2,
  action_id: 'assistant.ask.flower',
  provider: 'flower',
  target: { target_id: 'current', locality: 'auto' },
  source: { surface: 'file_browser' },
  context: [{ kind: 'file_path', path: '/workspace/index.ts', is_directory: false }],
  presentation: { label: 'Ask Flower', priority: 100 },
};

function message(status: FlowerChatMessage['status']): FlowerChatMessage {
  return {
    id: 'msg-linked-file',
    role: 'user',
    content: 'Inspect this file',
    status,
    created_at_ms: 100,
    context_action: contextAction,
  };
}

function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-linked-file',
    title: 'Linked file',
    model_id: 'openai/gpt-5.5',
    working_dir: '/workspace',
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'running',
    source_label: 'This host',
    target_labels: [],
    messages: [],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 1, last_message_at_unix_ms: 1, activity_signature: 'sig' },
      read_state: { last_seen_activity_revision: 1, last_read_message_at_unix_ms: 1, last_seen_activity_signature: 'sig' },
    },
    ...overrides,
  };
}

function pending(state: PendingFlowerTurn['state'] = 'sending'): PendingFlowerTurn {
  return {
    thread_id: 'thread-linked-file',
    message_id: 'msg-linked-file',
    prompt: 'Inspect this file',
    state,
    created_at_ms: 100,
    context_action: contextAction,
  };
}

describe('Flower pending linked context', () => {
  it('hydrates queued turns with their persisted context after reload', () => {
    const result = reconcilePendingTurnsForThread([], thread({
      queued_turn_count: 1,
      queued_turns: [{
        message_id: 'msg-linked-file',
        prompt: 'Inspect this file',
        created_at_ms: 100,
        context_action: contextAction,
      }],
    }));

    expect(result).toEqual([pending('queued')]);
  });

  it.each(['complete', 'error', 'canceled'] as const)(
    'replaces the optimistic turn with the canonical %s transcript message',
    (status) => {
      const canonical = message(status);
      const snapshot = thread({
        status: status === 'error' ? 'failed' : status === 'canceled' ? 'canceled' : 'idle',
        messages: [canonical],
        queued_turn_count: 0,
      });

      expect(pendingTurnCanonicalMessage(snapshot, pending('queued'))).toBe(canonical);
      expect(reconcilePendingTurnsForThread([pending('queued')], snapshot)).toEqual([]);
    },
  );

  it('keeps unrelated thread state while reconciling the selected thread', () => {
    const other = { ...pending(), thread_id: 'thread-other', message_id: 'other' };
    expect(reconcilePendingTurnsForThread([other], thread())).toEqual([other]);
  });

  it('preserves pending state when a partial snapshot does not own queued turn details', () => {
    expect(reconcilePendingTurnsForThread([pending('queued')], thread({
      queued_turn_count: 1,
      queued_turns: undefined,
    }))).toEqual([pending('queued')]);
  });

  it('does not rehydrate stale queue detail after the canonical message appears', () => {
    const canonical = message('complete');
    expect(reconcilePendingTurnsForThread([pending('queued')], thread({
      status: 'success',
      messages: [canonical],
      queued_turn_count: 0,
      queued_turns: [{
        message_id: 'msg-linked-file',
        prompt: 'Inspect this file',
        created_at_ms: 100,
        context_action: contextAction,
      }],
    }))).toEqual([]);
  });
});
