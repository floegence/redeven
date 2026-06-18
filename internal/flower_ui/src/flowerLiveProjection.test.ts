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
    timeline_messages: baseThread.messages,
    live_state: {
      thread_patch: {},
      runs: {},
      approval_actions: {},
      input_requests: {},
    },
    read_status: baseThread.read_status,
    generated_at_ms: 3000,
    ...overrides,
  };
}

function bootstrapWithLiveAssistant(overrides: Partial<FlowerChatMessage> = {}): FlowerLiveBootstrap {
  const baseThread = thread();
  const assistant: FlowerChatMessage = {
    id: 'assistant-live',
    role: 'assistant',
    content: '',
    status: 'streaming',
    created_at_ms: 2000,
    active_cursor: true,
    ...overrides,
  };
  return bootstrap({
    thread: { ...baseThread, status: 'running' },
    timeline_messages: [
      ...baseThread.messages,
      assistant,
    ],
  });
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
      timeline_messages: [{
        id: 'msg-user',
        role: 'user',
        timestamp: 1000,
        status: 'complete',
        blocks: [{ type: 'markdown', content: 'Hello' }],
      }],
      live_state: {
        thread_patch: {},
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

  it('maps persisted user message context actions into transcript messages', () => {
    const contextAction = {
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      provider: 'flower',
      target: { target_id: 'local:local', locality: 'auto' },
      source: { surface: 'desktop_welcome_environment_card', surface_id: 'local' },
      context: [{
        kind: 'text_snapshot',
        title: 'Local Environment',
        detail: 'Local · Ready',
        content: 'Environment: Local Environment\nKind: local_environment',
      }],
      presentation: { label: 'Ask Flower', priority: 100 },
    };
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
        run_status: 'idle',
      },
      timeline_messages: [{
        id: 'msg-context',
        role: 'user',
        timestamp: 1000,
        status: 'complete',
        blocks: [{ type: 'text', content: 'Inspect this env' }],
        contextAction,
      }],
      live_state: {
        thread_patch: {},
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

    expect(mapped.timeline_messages[0]?.context_action).toEqual(contextAction);
    expect(mapped.thread.messages[0]?.context_action).toEqual(contextAction);
  });

  it('projects bootstrap timeline messages and approvals without local message synthesis', () => {
    const projected = projectFlowerLiveBootstrap(bootstrap({
      cursor: 5,
      live_state: {
        thread_patch: { run_status: 'waiting_approval' },
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
      timeline_messages: [
        {
          id: 'msg-user',
          role: 'user',
          content: 'Hello',
          status: 'complete',
          created_at_ms: 1000,
          blocks: [{ type: 'text', content: 'Hello' }],
        },
        {
          id: 'assistant-live',
          role: 'assistant',
          content: 'Inspecting files',
          status: 'streaming',
          created_at_ms: 2000,
          blocks: [{ type: 'markdown', content: 'Inspecting files' }],
          active_cursor: true,
        },
      ],
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
      timeline_messages: [
        {
          id: 'msg-user',
          role: 'user',
          timestamp: 1000,
          status: 'complete',
          blocks: [{ type: 'markdown', content: 'Hello' }],
        },
        {
          id: 'assistant-live',
          role: 'assistant',
          timestamp: 2000,
          status: 'streaming',
          active_cursor: true,
          blocks: [{ type: 'markdown', content: 'hello ' }],
        },
      ],
      live_state: {
        thread_patch: { run_status: 'running' },
        runs: {
          'run-1': { run_id: 'run-1', status: 'running', message_id: 'assistant-live' },
        },
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
    const initial = projectFlowerLiveBootstrap(bootstrapWithLiveAssistant({
      blocks: [{ type: 'markdown', content: '' }],
    }));
    const events = [
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

    const projected = applyEvents(initial, 2, events);

    expect(projected.cursor).toBe(4);
    expect(projected.thread.messages[1]?.content).toBe('hello world');
    expect(projected.thread.messages[1]?.blocks?.[0]).toMatchObject({
      type: 'markdown',
      content: 'hello world\n',
    });
  });

  it('streams thinking before markdown without using thinking as message content', () => {
    const initial = projectFlowerLiveBootstrap(bootstrapWithLiveAssistant({
      blocks: [
        { type: 'thinking', content: '' },
        { type: 'markdown', content: '' },
      ],
    }));
    const projected = applyEvents(initial, 0, [
      event(3, 'message.block_delta', {
        message_id: 'assistant-live',
        block_index: 0,
        delta: 'Inspecting provider flow.',
      }),
      event(5, 'message.block_delta', {
        message_id: 'assistant-live',
        block_index: 1,
        delta: 'Final answer.',
      }),
    ]);

    expect(projected.thread.messages[1]?.blocks).toEqual([
      { type: 'thinking', content: 'Inspecting provider flow.' },
      { type: 'markdown', content: 'Final answer.' },
    ]);
    expect(projected.thread.messages[1]?.content).toBe('Final answer.');
  });

  it('requires resync when message starts before the canonical timeline contains it', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const result = applyFlowerLiveEvent(initial, 0, event(1, 'message.block_delta', {
      message_id: 'assistant-live',
      block_index: 0,
      delta: 'draft',
    }));

    expect(result.resyncRequired).toBe(true);
    expect(result.thread.messages.map((item) => item.id)).toEqual(['msg-user']);
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
    const initial = projectFlowerLiveBootstrap(bootstrapWithLiveAssistant({
      blocks: [{ type: 'markdown', content: '' }],
    }));
    const events = [
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

    const whole = applyEvents(initial, 2, events);
    const firstHalf = applyEvents(initial, 2, events.slice(0, 1));
    const split = applyEvents(firstHalf.thread, firstHalf.cursor, events.slice(1));

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
    const initial = projectFlowerLiveBootstrap(bootstrapWithLiveAssistant({
      blocks: [{ type: 'markdown', content: '' }],
    }));
    const withDraft = applyEvents(initial, 0, [
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

  it('preserves streamed markdown through activity blocks and commit', () => {
    const initial = projectFlowerLiveBootstrap(bootstrapWithLiveAssistant({
      blocks: [{ type: 'markdown', content: '' }],
    }));
    const beforeCommit = applyEvents(initial, 0, [
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
    ]);

    expect(beforeCommit.thread.messages[1]?.blocks).toHaveLength(2);
    expect(beforeCommit.thread.messages[1]?.blocks?.[0]).toEqual({ type: 'markdown', content: 'Let me inspect Loomcycle first.' });
    expect(beforeCommit.thread.messages[1]?.blocks?.[1]).toEqual(expect.objectContaining({ type: 'activity-timeline' }));
    expect(beforeCommit.thread.messages[1]?.content).toBe('Let me inspect Loomcycle first.');

    const committed = applyFlowerLiveEvent(beforeCommit.thread, beforeCommit.cursor, event(5, 'message.committed', {
      message_id: 'assistant-live',
      message: message({
        id: 'assistant-live',
        role: 'assistant',
        status: 'complete',
        content: 'Let me inspect Loomcycle first.',
        blocks: [
          { type: 'markdown', content: 'Let me inspect Loomcycle first.' },
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
        ],
      }),
    }));

    expect(committed.thread.messages[1]?.blocks).toEqual([
      { type: 'markdown', content: 'Let me inspect Loomcycle first.' },
      expect.objectContaining({ type: 'activity-timeline' }),
    ]);
    expect(committed.thread.messages[1]?.content).toBe('Let me inspect Loomcycle first.');
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
    const initial = projectFlowerLiveBootstrap(bootstrapWithLiveAssistant());
    const result = applyFlowerLiveEvent(initial, 0, event(1, 'message.block_started', {
      message_id: 'assistant-live',
      block_index: 0,
      block_type: 'mermaid',
    }));

    expect(result.resyncRequired).toBe(true);
    expect(result.thread.messages.find((item) => item.id === 'assistant-live')?.blocks).toBeUndefined();
  });

  it('requires resync instead of padding skipped live block indexes', () => {
    const initial = projectFlowerLiveBootstrap(bootstrapWithLiveAssistant());
    const result = applyFlowerLiveEvent(initial, 1, event(2, 'message.block_started', {
      message_id: 'assistant-live',
      block_index: 1,
      block_type: 'markdown',
    }));

    expect(result.thread.messages.find((item) => item.id === 'assistant-live')?.blocks).toBeUndefined();
    expect(applyFlowerLiveEvent(initial, 1, event(2, 'message.block_started', {
      message_id: 'assistant-live',
      block_index: 1,
      block_type: 'markdown',
    })).resyncRequired).toBe(true);
  });

  it('requires resync for unsupported live block_set types', () => {
    const initial = projectFlowerLiveBootstrap(bootstrapWithLiveAssistant({
      blocks: [{ type: 'markdown', content: '' }],
    }));
    const result = applyFlowerLiveEvent(initial, 2, event(3, 'message.block_set', {
      message_id: 'assistant-live',
      block_index: 0,
      block: { type: 'shell', content: 'pwd' },
    }));

    expect(result.resyncRequired).toBe(true);
    expect(result.thread.messages.find((item) => item.id === 'assistant-live')?.blocks).toEqual([
      { type: 'markdown', content: '' },
    ]);
  });

  it('requires resync for failed events that reference an unknown message', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const result = applyFlowerLiveEvent(initial, 0, event(1, 'message.failed', {
      message_id: 'assistant-live',
      error: 'stream failed',
    }));

    expect(result.resyncRequired).toBe(true);
    expect(result.thread.messages.map((item) => item.id)).toEqual(['msg-user']);
  });

  it('replaces the message list with canonical timeline order', () => {
    const initial = projectFlowerLiveBootstrap(bootstrapWithLiveAssistant({
      content: 'old streaming output',
      blocks: [{ type: 'markdown', content: 'old streaming output' }],
    }));
    const result = applyFlowerLiveEvent(initial, 5, event(6, 'timeline.replaced', {
      messages: [
        message({ id: 'msg-user-1', content: 'First request', created_at_ms: 1000, blocks: [{ type: 'markdown', content: 'First request' }] }),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Canceled partial output',
          status: 'canceled',
          created_at_ms: 1500,
          blocks: [{ type: 'markdown', content: 'Canceled partial output' }],
        },
        message({ id: 'msg-user-2', content: 'Second request', created_at_ms: 2000, blocks: [{ type: 'markdown', content: 'Second request' }] }),
        {
          id: 'assistant-2',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 2500,
          blocks: [{ type: 'markdown', content: '' }],
          active_cursor: true,
        },
      ],
    }));

    expect(result.resyncRequired).toBe(false);
    expect(result.thread.messages.map((item) => item.id)).toEqual(['msg-user-1', 'assistant-1', 'msg-user-2', 'assistant-2']);
    expect(result.thread.messages[1]).toMatchObject({ role: 'assistant', status: 'canceled' });
    expect(result.thread.messages[1]?.active_cursor).toBeUndefined();
    expect(result.thread.messages[3]).toMatchObject({ role: 'assistant', status: 'streaming', active_cursor: true });
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
      timeline_messages: [{
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

  it('restores transcript thinking blocks without using them as message content', () => {
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
        run_status: 'success',
      },
      timeline_messages: [{
        id: 'assistant-thinking',
        role: 'assistant',
        timestamp: 1000,
        status: 'complete',
        blocks: [
          { type: 'thinking', content: 'Inspecting provider flow.' },
          { type: 'markdown', content: 'Final answer.' },
        ],
      }],
      live_state: {
        thread_patch: {},
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

    expect(mapped.thread.messages[0]?.blocks).toEqual([
      { type: 'thinking', content: 'Inspecting provider flow.' },
      { type: 'markdown', content: 'Final answer.' },
    ]);
    expect(mapped.thread.messages[0]?.content).toBe('Final answer.');
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
