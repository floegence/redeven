import { describe, expect, it } from 'vitest';

import type {
  FlowerChatMessage,
  FlowerLiveBootstrap,
  FlowerLiveEvent,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { mapFlowerLiveBootstrap, mapFlowerLiveEvents } from './flowerLiveMapper';
import { applyFlowerLiveEvent, projectFlowerLiveBootstrap } from './flowerLiveReducer';

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

function bootstrap(overrides: Partial<FlowerLiveBootstrap> = {}): FlowerLiveBootstrap {
  const baseThread = thread();
  return {
    schema_version: 1,
    endpoint_id: 'runtime',
    thread_id: baseThread.thread_id,
    cursor: 0,
    retained_from_seq: 1,
    thread: baseThread,
    transcript_messages: baseThread.messages,
    live_state: {
      thread_patch: {},
      message_order: [],
      messages: {},
      runs: {},
      approval_actions: {},
      input_requests: {},
    },
    read_status: baseThread.read_status,
    generated_at_ms: 3000,
    ...overrides,
  };
}

function event<K extends FlowerLiveEvent['kind']>(
  seq: number,
  kind: K,
  payload: FlowerLiveEvent<K>['payload'],
): FlowerLiveEvent<K> {
  const result = {
    schema_version: 1,
    seq,
    endpoint_id: 'runtime',
    thread_id: 'th-live',
    run_id: 'run-1',
    turn_id: 'turn-1',
    at_unix_ms: 3000 + seq,
    kind,
    payload,
  } as FlowerLiveEvent<K>;
  return result;
}

function applyEvents(initial: FlowerThreadSnapshot, cursor: number, events: readonly FlowerLiveEvent[]) {
  let next = initial;
  let nextCursor = cursor;
  for (const item of events) {
    const result = applyFlowerLiveEvent(next, nextCursor, item);
    next = result.thread;
    nextCursor = result.cursor;
  }
  return { thread: next, cursor: nextCursor };
}

describe('Flower live projection', () => {
  it('maps top-level read_status from live bootstrap responses', () => {
    const mapped = mapFlowerLiveBootstrap({
      schema_version: 1,
      endpoint_id: 'runtime',
      thread_id: 'th-live',
      cursor: 42,
      retained_from_seq: 1,
      thread: {
        thread_id: 'th-live',
        title: 'Live thread',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'running',
      },
      transcript_messages: [{
        id: 'msg-user',
        role: 'user',
        timestamp: 1000,
        status: 'complete',
        blocks: [{ type: 'markdown', content: 'Hello' }],
      }],
      live_state: {
        thread_patch: {},
        message_order: [],
        messages: {},
        runs: {},
        approval_actions: {},
        input_requests: {},
      },
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
      generated_at_ms: 3000,
    }, {
      runtimeID: 'local',
      runtimeKind: 'local_environment',
      sourceLabel: 'This host',
      targetLabels: [],
    });

    expect(mapped.cursor).toBe(42);
    expect(mapped.thread.read_status.is_unread).toBe(true);
    expect(mapped.thread.read_status.snapshot.activity_revision).toBe(7);
    expect(mapped.thread.read_status.snapshot.waiting_prompt_id).toBe('prompt-1');
  });

  it('projects bootstrap live state into streaming assistant messages and approvals', () => {
    const projected = projectFlowerLiveBootstrap(bootstrap({
      cursor: 5,
      live_state: {
        thread_patch: { run_status: 'waiting_approval' },
        message_order: ['assistant-live'],
        messages: {
          'assistant-live': {
            message_id: 'assistant-live',
            role: 'assistant',
            status: 'streaming',
            created_at_ms: 2000,
            blocks: [{ type: 'markdown', content: 'Inspecting files' }],
          },
        },
        runs: {
          'run-1': { run_id: 'run-1', status: 'waiting_approval', message_id: 'assistant-live' },
        },
        approval_actions: {
          'appr-1': {
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
          },
        },
        input_requests: {},
      },
    }));

    expect(projected.status).toBe('waiting_approval');
    expect(projected.messages.map((item) => item.id)).toEqual(['msg-user', 'assistant-live']);
    expect(projected.messages[1]?.content).toBe('Inspecting files');
    expect(projected.approval_actions?.map((action) => action.action_id)).toEqual(['appr-1']);
  });

  it('preserves bootstrap live state whitespace before later deltas', () => {
    const mapped = mapFlowerLiveBootstrap({
      schema_version: 1,
      endpoint_id: 'runtime',
      thread_id: 'th-live',
      cursor: 5,
      retained_from_seq: 1,
      thread: {
        thread_id: 'th-live',
        title: 'Live thread',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'running',
      },
      transcript_messages: [{
        id: 'msg-user',
        role: 'user',
        timestamp: 1000,
        status: 'complete',
        blocks: [{ type: 'markdown', content: 'Hello' }],
      }],
      live_state: {
        thread_patch: { run_status: 'running' },
        message_order: ['assistant-live'],
        messages: {
          'assistant-live': {
            message_id: 'assistant-live',
            role: 'assistant',
            status: 'streaming',
            created_at_ms: 2000,
            blocks: [{ type: 'markdown', content: 'hello ' }],
          },
        },
        runs: {},
        approval_actions: {},
        input_requests: {},
      },
      read_status: readStatus(),
      generated_at_ms: 3000,
    }, {
      runtimeID: 'local',
      runtimeKind: 'local_environment',
      sourceLabel: 'This host',
      targetLabels: [],
    });
    const initial = projectFlowerLiveBootstrap(mapped);
    const appended = applyFlowerLiveEvent(initial, mapped.cursor, event(6, 'message.block_delta', {
      message_id: 'assistant-live',
      block_index: 0,
      delta: 'world',
    }));

    expect(initial.messages[1]?.blocks?.[0]).toMatchObject({
      type: 'markdown',
      content: 'hello ',
    });
    expect(appended.thread.messages[1]?.content).toBe('hello world');
  });

  it('applies message deltas incrementally without dropping whitespace', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const events = [
      event(1, 'message.started', {
        message_id: 'assistant-live',
        role: 'assistant',
        status: 'streaming',
        created_at_ms: 2000,
      }),
      event(2, 'message.block_started', {
        message_id: 'assistant-live',
        block_index: 0,
        block_type: 'markdown',
      }),
      event(3, 'message.block_delta', {
        message_id: 'assistant-live',
        block_index: 0,
        delta: 'hello ',
      }),
      event(4, 'message.block_delta', {
        message_id: 'assistant-live',
        block_index: 0,
        delta: 'world\n',
      }),
    ];

    const projected = applyEvents(initial, 0, events);

    expect(projected.cursor).toBe(4);
    expect(projected.thread.messages[1]?.content).toBe('hello world');
    expect(projected.thread.messages[1]?.blocks?.[0]).toMatchObject({
      type: 'markdown',
      content: 'hello world\n',
    });
  });

  it('requires an explicit live block before accepting deltas', () => {
    const initial = thread({
      messages: [
        message(),
        {
          id: 'assistant-live',
          role: 'assistant',
          content: 'already visible',
          status: 'streaming',
          created_at_ms: 2000,
        },
      ],
    });
    const result = applyFlowerLiveEvent(initial, 1, event(2, 'message.block_delta', {
      message_id: 'assistant-live',
      block_index: 0,
      delta: ' plus delta',
    }));

    expect(result.resyncRequired).toBe(true);
    expect(result.thread.messages[1]?.content).toBe('already visible');
    expect(result.thread.messages[1]?.blocks).toBeUndefined();
  });

  it('keeps whole-batch and split replay projections equivalent', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const events = [
      event(1, 'message.started', {
        message_id: 'assistant-live',
        role: 'assistant',
        status: 'streaming',
        created_at_ms: 2000,
      }),
      event(2, 'message.block_started', {
        message_id: 'assistant-live',
        block_index: 0,
        block_type: 'markdown',
      }),
      event(3, 'message.block_delta', {
        message_id: 'assistant-live',
        block_index: 0,
        delta: 'one',
      }),
      event(4, 'message.block_delta', {
        message_id: 'assistant-live',
        block_index: 0,
        delta: ' two',
      }),
    ];

    const whole = applyEvents(initial, 0, events);
    const firstHalf = applyEvents(initial, 0, events.slice(0, 2));
    const split = applyEvents(firstHalf.thread, firstHalf.cursor, events.slice(2));

    expect(split).toEqual(whole);
  });

  it('ignores duplicate and stale event sequences', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const first = applyFlowerLiveEvent(initial, 5, event(5, 'message.block_delta', {
      message_id: 'assistant-live',
      block_index: 0,
      delta: 'ignored',
    }));
    const second = applyFlowerLiveEvent(initial, 5, event(3, 'message.block_delta', {
      message_id: 'assistant-live',
      block_index: 0,
      delta: 'ignored',
    }));

    expect(first.thread).toBe(initial);
    expect(first.cursor).toBe(5);
    expect(second.thread).toBe(initial);
    expect(second.cursor).toBe(5);
  });

  it('commits a streaming draft under the same message id', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const withDraft = applyEvents(initial, 0, [
      event(1, 'message.started', {
        message_id: 'assistant-live',
        role: 'assistant',
        status: 'streaming',
        created_at_ms: 2000,
      }),
      event(2, 'message.block_started', {
        message_id: 'assistant-live',
        block_index: 0,
        block_type: 'markdown',
      }),
      event(3, 'message.block_delta', {
        message_id: 'assistant-live',
        block_index: 0,
        delta: 'draft',
      }),
    ]);
    const committed = applyFlowerLiveEvent(withDraft.thread, withDraft.cursor, event(4, 'message.committed', {
      message_id: 'assistant-live',
      message: message({
        id: 'assistant-live',
        role: 'assistant',
        status: 'complete',
        content: 'final',
        blocks: [{ type: 'markdown', content: 'final' }],
      }),
    }));

    expect(committed.thread.messages.map((item) => item.id)).toEqual(['msg-user', 'assistant-live']);
    expect(committed.thread.messages[1]).toMatchObject({
      id: 'assistant-live',
      content: 'final',
      status: 'complete',
    });
  });

  it('replaces draft markdown with canonical markdown after activity blocks', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const beforeCommit = applyEvents(initial, 0, [
      event(1, 'message.started', {
        message_id: 'assistant-live',
        role: 'assistant',
        status: 'streaming',
        created_at_ms: 2000,
      }),
      event(2, 'message.block_started', {
        message_id: 'assistant-live',
        block_index: 0,
        block_type: 'markdown',
      }),
      event(3, 'message.block_delta', {
        message_id: 'assistant-live',
        block_index: 0,
        delta: 'Let me inspect Loomcycle first.',
      }),
      event(4, 'message.block_set', {
        message_id: 'assistant-live',
        block_index: 1,
        block: {
          type: 'activity-timeline',
          block: {
            type: 'activity-timeline',
            schema_version: 1,
            run_id: 'run-live',
            summary: { status: 'success', severity: 'quiet', needs_attention: false, total_items: 1, counts: { success: 1 } },
            items: [{
              item_id: 'tool-1',
              kind: 'tool',
              status: 'success',
              severity: 'quiet',
              needs_attention: false,
              requires_approval: false,
            }],
          },
        },
      }),
      event(5, 'message.block_set', {
        message_id: 'assistant-live',
        block_index: 0,
        block: { type: 'markdown', content: '' },
      }),
      event(6, 'message.block_set', {
        message_id: 'assistant-live',
        block_index: 2,
        block: { type: 'markdown', content: 'Canonical Loomcycle answer.' },
      }),
    ]);

    expect(beforeCommit.thread.messages[1]?.blocks).toHaveLength(3);
    expect(beforeCommit.thread.messages[1]?.blocks?.[0]).toEqual({ type: 'markdown', content: '' });
    expect(beforeCommit.thread.messages[1]?.blocks?.[1]).toEqual(expect.objectContaining({ type: 'activity-timeline' }));
    expect(beforeCommit.thread.messages[1]?.blocks?.[2]).toEqual({ type: 'markdown', content: 'Canonical Loomcycle answer.' });
    expect(beforeCommit.thread.messages[1]?.content).toBe('Canonical Loomcycle answer.');

    const committed = applyFlowerLiveEvent(beforeCommit.thread, beforeCommit.cursor, event(7, 'message.committed', {
      message_id: 'assistant-live',
      message: message({
        id: 'assistant-live',
        role: 'assistant',
        status: 'complete',
        content: 'Canonical Loomcycle answer.',
        blocks: [
          {
            type: 'activity-timeline',
            schema_version: 1,
            run_id: 'run-live',
            summary: { status: 'success', severity: 'quiet', needs_attention: false, total_items: 1, counts: { success: 1 } },
            items: [{
              item_id: 'tool-1',
              kind: 'tool',
              status: 'success',
              severity: 'quiet',
              needs_attention: false,
              requires_approval: false,
            }],
          },
          { type: 'markdown', content: 'Canonical Loomcycle answer.' },
        ],
      }),
    }));

    expect(committed.thread.messages[1]?.blocks).toEqual([
      expect.objectContaining({ type: 'activity-timeline' }),
      { type: 'markdown', content: 'Canonical Loomcycle answer.' },
    ]);
    expect(committed.thread.messages[1]?.content).toBe('Canonical Loomcycle answer.');
  });

  it('marks stream resync events as requiring bootstrap reload', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const result = applyFlowerLiveEvent(initial, 5, event(8, 'stream.resync_required', {
      reason: 'cursor_expired',
    }));

    expect(result.resyncRequired).toBe(true);
    expect(result.cursor).toBe(5);
    expect(result.thread).toBe(initial);
  });

  it('requires resync for unsupported live block_start types', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const result = applyFlowerLiveEvent(initial, 0, event(1, 'message.block_started', {
      message_id: 'assistant-live',
      block_index: 0,
      block_type: 'mermaid',
    }));

    expect(result.resyncRequired).toBe(true);
    expect(result.thread.messages.find((item) => item.id === 'assistant-live')?.blocks).toBeUndefined();
  });

  it('requires resync instead of padding skipped live block indexes', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const result = applyEvents(initial, 0, [
      event(1, 'message.started', {
        message_id: 'assistant-live',
        role: 'assistant',
        status: 'streaming',
        created_at_ms: 2000,
      }),
      event(2, 'message.block_started', {
        message_id: 'assistant-live',
        block_index: 1,
        block_type: 'markdown',
      }),
    ]);

    expect(result.thread.messages.find((item) => item.id === 'assistant-live')?.blocks).toBeUndefined();
    expect(applyFlowerLiveEvent(initial, 1, event(2, 'message.block_started', {
      message_id: 'assistant-live',
      block_index: 1,
      block_type: 'markdown',
    })).resyncRequired).toBe(true);
  });

  it('requires resync for unsupported live block_set types', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const withBlock = applyEvents(initial, 0, [
      event(1, 'message.started', {
        message_id: 'assistant-live',
        role: 'assistant',
        status: 'streaming',
        created_at_ms: 2000,
      }),
      event(2, 'message.block_started', {
        message_id: 'assistant-live',
        block_index: 0,
        block_type: 'markdown',
      }),
    ]);
    const result = applyFlowerLiveEvent(withBlock.thread, withBlock.cursor, event(3, 'message.block_set', {
      message_id: 'assistant-live',
      block_index: 0,
      block: { type: 'shell', content: 'pwd' },
    }));

    expect(result.resyncRequired).toBe(true);
    expect(result.thread.messages.find((item) => item.id === 'assistant-live')?.blocks).toEqual([
      { type: 'markdown', content: '' },
    ]);
  });

  it('drops unsupported persisted message blocks instead of textifying them', () => {
    const mapped = mapFlowerLiveBootstrap({
      schema_version: 1,
      endpoint_id: 'runtime',
      thread_id: 'th-live',
      cursor: 1,
      retained_from_seq: 1,
      thread: {
        thread_id: 'th-live',
        title: 'Live thread',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'running',
      },
      transcript_messages: [{
        id: 'assistant-unsupported',
        role: 'assistant',
        timestamp: 1000,
        status: 'complete',
        blocks: [
          { type: 'markdown', content: 'Visible' },
          { type: 'shell', command: 'pwd', output: '/workspace' },
          { type: 'mermaid', content: 'graph TD;A-->B;' },
        ],
      }],
      live_state: {
        thread_patch: {},
        message_order: [],
        messages: {},
        runs: {},
        approval_actions: {},
        input_requests: {},
      },
      read_status: readStatus(),
      generated_at_ms: 3000,
    }, {
      runtimeID: 'local',
      runtimeKind: 'local_environment',
      sourceLabel: 'This host',
      targetLabels: [],
    });

    expect(mapped.thread.messages[0]?.content).toBe('Visible');
    expect(mapped.thread.messages[0]?.blocks).toEqual([{ type: 'markdown', content: 'Visible' }]);
  });

  it('rejects committed message events without a valid message payload', () => {
    expect(() => mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        at_unix_ms: 3000,
        kind: 'message.committed',
        payload: { message_id: 'assistant-live' },
      }],
      next_cursor: 1,
      retained_from_seq: 1,
    })).toThrow(/message\.committed/);
  });

  it('rejects unsupported activity item statuses instead of falling back', () => {
    expect(() => mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        at_unix_ms: 3000,
        kind: 'message.block_set',
        payload: {
          message_id: 'assistant-live',
          block_index: 0,
          block: {
            type: 'activity-timeline',
            schema_version: 1,
            summary: { status: 'success', severity: 'quiet', needs_attention: false, total_items: 1, counts: { success: 1 } },
            items: [{
              item_id: 'tool-1',
              kind: 'tool',
              status: 'timeout',
              severity: 'error',
              needs_attention: true,
              requires_approval: false,
            }],
          },
        },
      }],
      next_cursor: 1,
      retained_from_seq: 1,
    })).toThrow(/activity item status is unsupported/);
  });

  it('rejects missing activity summary status instead of falling back', () => {
    expect(() => mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        at_unix_ms: 3000,
        kind: 'message.block_set',
        payload: {
          message_id: 'assistant-live',
          block_index: 0,
          block: {
            type: 'activity-timeline',
            schema_version: 1,
            summary: { severity: 'quiet', needs_attention: false, total_items: 0, counts: {} },
            items: [],
          },
        },
      }],
      next_cursor: 1,
      retained_from_seq: 1,
    })).toThrow(/activity summary status is unsupported/);
  });
});
