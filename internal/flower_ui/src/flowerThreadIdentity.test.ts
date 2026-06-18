import { describe, expect, it } from 'vitest';

import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import {
  flowerReadSnapshotKey,
  flowerReadStateKey,
  reuseUnchangedFlowerThreadSnapshot,
  sameFlowerThreadSnapshot,
} from './flowerThreadIdentity';

function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-1',
    title: 'Thread',
    model_id: 'openai/gpt-5.2',
    working_dir: '/workspace',
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'success',
    source_label: 'This host',
    target_labels: ['local'],
    messages: [{
      id: 'assistant-1',
      role: 'assistant',
      content: 'Stable answer',
      status: 'complete',
      created_at_ms: 2,
    }],
    read_status: {
      is_unread: false,
      snapshot: {
        activity_revision: 1,
        last_message_at_unix_ms: 2,
        activity_signature: 'activity:1',
        waiting_prompt_id: 'prompt-1',
      },
      read_state: {
        last_seen_activity_revision: 1,
        last_read_message_at_unix_ms: 2,
        last_seen_activity_signature: 'activity:1',
        last_seen_waiting_prompt_id: 'prompt-1',
      },
    },
    ...overrides,
  };
}

describe('flower thread identity helpers', () => {
  it('builds read snapshot keys from every read cursor field', () => {
    expect(flowerReadSnapshotKey({
      activity_revision: 3,
      last_message_at_unix_ms: 9,
      activity_signature: 'activity:3',
      waiting_prompt_id: 'prompt-3',
    })).toBe('3\x1e9\x1eactivity:3\x1eprompt-3');
  });

  it('includes unread state and last seen fields in the read state key', () => {
    const base = thread();
    const changed = thread({
      read_status: {
        ...base.read_status,
        is_unread: true,
      },
    });

    expect(flowerReadStateKey(changed)).not.toBe(flowerReadStateKey(base));
  });

  it('reuses existing thread snapshots when the merged candidate is semantically unchanged', () => {
    const existing = thread();
    const candidate = {
      ...existing,
      target_labels: ['local'],
    };

    expect(candidate).not.toBe(existing);
    expect(sameFlowerThreadSnapshot(existing, candidate)).toBe(true);
    expect(reuseUnchangedFlowerThreadSnapshot(existing, candidate)).toBe(existing);
  });

  it('compares target labels by ordered content rather than array identity', () => {
    const existing = thread({ target_labels: ['local', 'sandbox'] });
    const sameLabels = thread({ ...existing, target_labels: ['local', 'sandbox'] });
    const reorderedLabels = thread({ ...existing, target_labels: ['sandbox', 'local'] });

    expect(sameFlowerThreadSnapshot(existing, sameLabels)).toBe(true);
    expect(sameFlowerThreadSnapshot(existing, reorderedLabels)).toBe(false);
  });

  it('replaces thread snapshots when runtime origin fields change', () => {
    const existing = thread({
      home_runtime_id: 'runtime-1',
      home_runtime_kind: 'local_environment',
      origin_env_public_id: 'env-1',
    });

    expect(sameFlowerThreadSnapshot(existing, thread({ ...existing, home_runtime_id: 'runtime-2' }))).toBe(false);
    expect(sameFlowerThreadSnapshot(existing, thread({ ...existing, home_runtime_kind: 'env_local' }))).toBe(false);
    expect(sameFlowerThreadSnapshot(existing, thread({ ...existing, origin_env_public_id: 'env-2' }))).toBe(false);
  });

  it('accepts new thread snapshots when visible thread semantics change', () => {
    const existing = thread();
    const candidate = {
      ...existing,
      status: 'running' as const,
      updated_at_ms: 3,
    };

    expect(sameFlowerThreadSnapshot(existing, candidate)).toBe(false);
    expect(reuseUnchangedFlowerThreadSnapshot(existing, candidate)).toBe(candidate);
  });

  it('treats missing and empty optional arrays as the same empty UI state', () => {
    const existing = thread({ messages: [], approval_actions: undefined });
    const candidate = thread({ messages: [], approval_actions: [] });

    expect(sameFlowerThreadSnapshot(existing, candidate)).toBe(true);
    expect(reuseUnchangedFlowerThreadSnapshot(existing, candidate)).toBe(existing);
  });

  it('keeps non-empty message and approval arrays reference-owned', () => {
    const existing = thread({
      messages: [{
        id: 'assistant-1',
        role: 'assistant',
        content: 'Stable answer',
        status: 'complete',
        created_at_ms: 2,
      }],
      approval_actions: [{
        action_id: 'approval-1',
        run_id: 'run-1',
        tool_id: 'tool-1',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        requested_at_ms: 2,
        can_approve: true,
        summary: { label: 'Run terminal command' },
      }],
    });
    const candidate = thread({
      ...existing,
      messages: [...existing.messages],
      approval_actions: [...(existing.approval_actions ?? [])],
    });

    expect(sameFlowerThreadSnapshot(existing, candidate)).toBe(false);
  });

  it('treats nullish input and error fields as the same absent UI state', () => {
    const existing = thread({ input_request: null, error: null });
    const candidate = thread({ ...existing, input_request: undefined, error: undefined });

    expect(sameFlowerThreadSnapshot(existing, candidate)).toBe(true);
  });

  it('keeps visible input requests and errors reference-owned', () => {
    const existing = thread({
      status: 'waiting_user',
      input_request: {
        prompt_id: 'prompt-1',
        message_id: 'assistant-1',
        tool_id: 'tool-ask',
        tool_name: 'ask_user',
        questions: [],
      },
      error: { code: 'failed', message: 'Provider failed.' },
    });
    const candidate = thread({
      ...existing,
      input_request: { ...existing.input_request!, questions: [] },
      error: { code: 'failed', message: 'Provider failed.' },
    });

    expect(sameFlowerThreadSnapshot(existing, candidate)).toBe(false);
  });
});
