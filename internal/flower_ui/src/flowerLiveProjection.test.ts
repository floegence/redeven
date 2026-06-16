import { describe, expect, it } from 'vitest';

import type {
  FlowerChatMessage,
  FlowerThreadLiveSnapshot,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { mapFlowerLiveSnapshot } from './flowerLiveMapper';
import { applyFlowerLiveUpdate, projectFlowerLiveSnapshot } from './flowerLiveReducer';

function readStatus(overrides: Record<string, unknown> = {}) {
  return {
    is_unread: false,
    snapshot: {
      activity_revision: 1,
      last_message_at_unix_ms: 1000,
      activity_signature: 'sig-1',
    },
    read_state: {
      last_seen_activity_revision: 1,
      last_read_message_at_unix_ms: 1000,
      last_seen_activity_signature: 'sig-1',
    },
    ...overrides,
  };
}

function message(overrides: Partial<FlowerChatMessage> = {}): FlowerChatMessage {
  return {
    id: 'msg-user',
    role: 'user',
    content: 'Hello',
    status: 'complete',
    created_at_ms: 1000,
    blocks: [{ type: 'markdown', content: 'Hello' }],
    ...overrides,
  };
}

function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'th-live',
    title: 'Live thread',
    model_id: 'openai/gpt-5.2',
    working_dir: '/workspace',
    created_at_ms: 1000,
    updated_at_ms: 1000,
    status: 'running',
    source_label: 'This host',
    target_labels: [],
    messages: [message()],
    read_status: readStatus(),
    ...overrides,
  };
}

describe('Flower live projection', () => {
  it('maps top-level read_status from live snapshots', () => {
    const snapshot = mapFlowerLiveSnapshot({
      thread: {
        thread_id: 'th-live',
        title: 'Live thread',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'running',
      },
      messages: [{
        id: 'msg-user',
        role: 'user',
        timestamp: 1000,
        status: 'complete',
        blocks: [{ type: 'markdown', content: 'Hello' }],
      }],
      read_status: readStatus({
        is_unread: true,
        snapshot: {
          activity_revision: 7,
          last_message_at_unix_ms: 2000,
          activity_signature: 'sig-7',
          waiting_prompt_id: 'prompt-1',
        },
        read_state: {
          last_seen_activity_revision: 3,
          last_read_message_at_unix_ms: 1500,
          last_seen_activity_signature: 'sig-3',
        },
      }),
      event_cursor: 42,
      generated_at_unix_ms: 3000,
    }, {
      runtimeID: 'local',
      runtimeKind: 'local_environment',
      sourceLabel: 'This host',
      targetLabels: [],
    });

    expect(snapshot.event_cursor).toBe(42);
    expect(snapshot.thread.read_status.is_unread).toBe(true);
    expect(snapshot.thread.read_status.snapshot.activity_revision).toBe(7);
    expect(snapshot.thread.read_status.snapshot.waiting_prompt_id).toBe('prompt-1');
  });

  it('projects active run messages and pending approval actions into the thread', () => {
    const snapshot: FlowerThreadLiveSnapshot = {
      thread: thread({ status: 'running' }),
      active_run: {
        run_id: 'run-1',
        status: 'waiting_approval',
        message: message({
          id: 'assistant-active',
          role: 'assistant',
          status: 'streaming',
          content: 'Inspecting files',
          blocks: [{ type: 'markdown', content: 'Inspecting files' }],
        }),
        approval_actions: [{
          action_id: 'appr-1',
          run_id: 'run-1',
          tool_id: 'tool-1',
          tool_name: 'terminal.exec',
          state: 'requested',
          status: 'pending',
          revision: 1,
          requested_at_ms: 2000,
          can_approve: true,
          expected_seq: 5,
          summary: { label: 'terminal.exec', effects: ['shell'] },
        }],
        last_event_seq: 5,
      },
      event_cursor: 5,
      generated_at_ms: 2000,
    };

    const projected = projectFlowerLiveSnapshot(snapshot);

    expect(projected.status).toBe('waiting_approval');
    expect(projected.messages.map((item) => item.id)).toEqual(['msg-user', 'assistant-active']);
    expect(projected.approval_actions?.map((action) => action.action_id)).toEqual(['appr-1']);
    expect(projected.approval_actions?.[0]?.revision).toBe(1);
    expect(projected.approval_actions?.[0]?.expected_seq).toBe(5);
  });

  it('replaces active run drafts when the final transcript message arrives', () => {
    const current = thread({
      messages: [
        message(),
        message({
          id: 'assistant-active',
          role: 'assistant',
          status: 'streaming',
          content: 'Running terminal',
        }),
      ],
      approval_actions: [{
        action_id: 'appr-1',
        run_id: 'run-1',
        tool_id: 'tool-1',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        requested_at_ms: 2000,
        can_approve: true,
        summary: { label: 'terminal.exec' },
      }],
    });

    const result = applyFlowerLiveUpdate(current, 5, {
      seq: 6,
      thread_id: 'th-live',
      kind: 'message.appended',
      at_ms: 2500,
      clear_active_run: true,
      message: message({
        id: 'assistant-final',
        role: 'assistant',
        status: 'complete',
        content: 'Done',
      }),
    });

    expect(result.resyncRequired).toBe(false);
    expect(result.cursor).toBe(6);
    expect(result.thread.messages.map((item) => item.id)).toEqual(['msg-user', 'assistant-final']);
    expect(result.thread.approval_actions).toEqual([]);
  });

  it('marks stale update cursors as requiring a snapshot resync', () => {
    const current = thread();

    const result = applyFlowerLiveUpdate(current, 5, {
      seq: 8,
      thread_id: 'th-live',
      kind: 'resync.required',
      at_ms: 3000,
      resync_reason: 'cursor_expired',
    });

    expect(result.resyncRequired).toBe(true);
    expect(result.cursor).toBe(8);
    expect(result.thread).toBe(current);
  });
});
