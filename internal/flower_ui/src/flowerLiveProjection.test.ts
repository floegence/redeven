import { describe, expect, it } from 'vitest';

import type {
  FlowerApprovalAction,
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerLiveBootstrap,
  FlowerLiveEvent,
  FlowerLiveThreadPatch,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { mapFlowerLiveBootstrap, mapFlowerLiveEvents, mapFlowerMessage } from './flowerLiveMapper';
import { applyFlowerLiveEvent, projectFlowerLiveBootstrap } from './flowerLiveReducer';

type FlowerMainToolApprovalAction = Exclude<FlowerApprovalAction, { origin: 'delegated_subagent' }>;

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
    thread_id: 'th-live',
    turn_id: 'turn-user',
    run_id: 'run-1',
    role: 'user',
    content: 'Hello',
    status: 'complete',
    created_at_ms: 1000,
    blocks: [{ type: 'markdown', content: 'Hello' }],
    ...overrides,
  };
}

function activityTimelineBlock(itemID: string, label: string): FlowerActivityTimelineBlock {
  const item: FlowerActivityItem = {
    item_id: itemID,
    tool_id: itemID,
    tool_name: 'terminal.exec',
    kind: 'tool',
    status: 'success',
    severity: 'quiet',
    needs_attention: false,
    requires_approval: false,
    label,
  };
  return {
    type: 'activity-timeline',
    schema_version: 1,
    thread_id: 'th-live',
    turn_id: 'turn-1',
    run_id: 'run-1',
    summary: {
      status: 'success',
      severity: 'quiet',
      needs_attention: false,
      total_items: 1,
      counts: { success: 1 },
    },
    items: [item],
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
    title_status: overrides.title_status ?? 'ready',
  };
}

function approvalAction(overrides: Partial<FlowerMainToolApprovalAction> = {}): FlowerMainToolApprovalAction {
  return {
    action_id: 'appr-1',
    origin: 'main_tool',
    run_id: 'run-1',
    tool_id: 'tool-1',
    tool_name: 'terminal.exec',
    state: 'requested',
    status: 'pending',
    revision: 1,
    version: 1,
    requested_at_ms: 2000,
    can_approve: true,
    expected_seq: 5,
    summary: { label: 'curl https://example.test', command: 'curl https://example.test', effects: ['shell'] },
    ...overrides,
  };
}

function rawControlApprovalAction(overrides: Record<string, unknown> = {}) {
  return {
    action_id: 'control-1',
    origin: 'control_confirm',
    run_id: 'run-control',
    tool_id: 'tool-control',
    tool_name: 'terminal.exec',
    state: 'requested',
    status: 'pending',
    revision: 1,
    version: 1,
    surface_epoch: 1,
    requested_at_unix_ms: 2000,
    can_approve: true,
    expected_seq: 5,
    queue_generation: 0,
    queue_order: 0,
    batch_index: 0,
    batch_size: 1,
    summary: { label: 'Run command' },
    ...overrides,
  };
}

function rawCanonicalApprovalAction(overrides: Record<string, unknown> = {}) {
  return {
    action_id: 'canonical-1',
    origin: 'main_tool',
    run_id: 'run-canonical',
    tool_id: 'tool-canonical',
    tool_name: 'terminal.exec',
    state: 'requested',
    status: 'pending',
    revision: 2,
    version: 2,
    surface_epoch: 3,
    scope: 'thread:th-live',
    requested_at_unix_ms: 2000,
    can_approve: true,
    expected_seq: 5,
    queue_generation: 3,
    queue_order: 1,
    batch_index: 0,
    batch_size: 1,
    summary: { label: 'Run command' },
    ...overrides,
  };
}

function bootstrap(overrides: Partial<FlowerLiveBootstrap> = {}): FlowerLiveBootstrap {
  const baseThread = thread();
  return {
    schema_version: 1,
    endpoint_id: 'runtime',
    thread_id: baseThread.thread_id,
    stream_generation: 1,
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

function mapperOptions() {
  return {
    runtimeID: 'runtime',
    runtimeKind: 'local_environment' as const,
    sourceLabel: 'This host',
    targetLabels: [],
  };
}

function rawBootstrapWithTimelineDecoration(decoration: unknown) {
  return {
    schema_version: 1,
    endpoint_id: 'runtime',
    thread_id: 'th-live',
    cursor: 1,
    retained_from_seq: 1,
    thread: {
      thread_id: 'th-live',
      title: 'Live thread',
      title_status: 'ready',
      model_id: 'openai/gpt-5.2',
      working_dir: '/workspace',
      created_at_unix_ms: 1000,
      updated_at_unix_ms: 1000,
      run_status: 'success',
      read_status: readStatus(),
    },
    timeline_messages: [{
      id: 'msg-user',
      thread_id: 'th-live',
      turn_id: 'turn-user',
      run_id: 'run-1',
      role: 'user',
      content: 'Hello',
      status: 'complete',
      created_at_ms: 1000,
    }],
    read_status: readStatus(),
    live_state: {
      thread_patch: {},
      runs: {},
      timeline_decorations: [decoration],
      approval_actions: {},
      input_requests: {},
    },
  };
}

function bootstrapWithLiveAssistant(overrides: Partial<FlowerChatMessage> = {}): FlowerLiveBootstrap {
  const baseThread = thread();
  const assistant: FlowerChatMessage = {
    id: 'assistant-live',
    thread_id: 'th-live',
    turn_id: 'turn-1',
    run_id: 'run-1',
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
  it('keeps canonical message and turn identities distinct and rejects a missing turn identity', () => {
    expect(mapFlowerMessage({
      id: 'entry-user-1',
      thread_id: 'th-live',
      turn_id: 'turn-1',
      run_id: 'run-1',
      role: 'user',
      status: 'complete',
      created_at_ms: 1000,
      blocks: [{ type: 'text', content: 'Hello' }],
    })).toMatchObject({ id: 'entry-user-1', turn_id: 'turn-1' });
    expect(() => mapFlowerMessage({
      id: 'entry-user-1',
      thread_id: 'th-live',
      run_id: 'run-1',
      role: 'user',
      status: 'complete',
      created_at_ms: 1000,
      blocks: [{ type: 'text', content: 'Hello' }],
    })).toThrow(/timeline message entry-user-1 requires turn_id/);
  });

  it('rejects host-only fields and path text in canonical reference DTOs', () => {
    const base = {
      id: 'entry-user-reference',
      thread_id: 'th-live',
      turn_id: 'turn-reference',
      run_id: 'run-reference',
      role: 'user',
      status: 'complete',
      created_at_ms: 1000,
      blocks: [],
    };
    expect(mapFlowerMessage({
      ...base,
      references: [
        { reference_id: 'context:0', kind: 'file', label: 'main.ts' },
        { reference_id: 'context:1', kind: 'text', label: 'Quote', text: 'visible excerpt', truncated: true },
      ],
    }).references).toEqual([
      { reference_id: 'context:0', kind: 'file', label: 'main.ts' },
      { reference_id: 'context:1', kind: 'text', label: 'Quote', text: 'visible excerpt', truncated: true },
    ]);
    for (const reference of [
      { reference_id: 'context:0', kind: 'file', label: 'main.ts', text: '' },
      { reference_id: 'context:0', kind: 'file', label: 'main.ts', path: '/workspace/main.ts' },
      { reference_id: 'context:0', kind: 'file', label: 'main.ts', resource_ref: 'sentinel-locator' },
      { reference_id: 'context:0', kind: 'directory', label: 'src', target: { target_id: 'local' } },
    ]) {
      expect(() => mapFlowerMessage({ ...base, references: [reference] })).toThrow(/reference/);
    }
  });

  it('maps canonical attachment blocks and rejects malformed or mismatched blocks as a unit', () => {
    const base = {
      id: 'entry-user-attachments',
      thread_id: 'th-live',
      turn_id: 'turn-attachments',
      run_id: 'run-attachments',
      role: 'user',
      status: 'complete',
      created_at_ms: 1000,
    };
    expect(mapFlowerMessage({
      ...base,
      blocks: [
        { type: 'image', src: '/api/uploads/image-1', alt: 'Screenshot' },
        { type: 'file', name: 'notes.txt', size: 12, mimeType: 'text/plain', url: '/api/uploads/file-1' },
      ],
    }).blocks).toEqual([
      { type: 'image', src: '/api/uploads/image-1', alt: 'Screenshot' },
      { type: 'file', name: 'notes.txt', size: 12, mimeType: 'text/plain', url: '/api/uploads/file-1' },
    ]);
    expect(() => mapFlowerMessage({
      ...base,
      blocks: [{ type: 'file', name: 'notes.txt', size: -1, mimeType: 'text/plain', url: '/api/uploads/file-1' }],
    })).toThrow(/block 0 is invalid/);
    expect(() => mapFlowerMessage({
      ...base,
      blocks: [{ type: 'file', name: 'notes.txt', size: 12, mimeType: 'text/plain', url: 'javascript:alert(1)' }],
    })).toThrow(/block 0 is invalid/);
    expect(() => mapFlowerMessage({
      ...base,
      role: 'assistant',
      blocks: [{
        ...activityTimelineBlock('tool-1', 'Inspect'),
        turn_id: 'turn-other',
        run_id: 'run-attachments',
      }],
    })).toThrow(/activity block 0 has mismatched identity/);
  });

  it('rejects an entire canonical message array when any bootstrap or replacement row is invalid', () => {
    const valid = {
      id: 'entry-user-1',
      thread_id: 'th-live',
      turn_id: 'turn-1',
      run_id: 'run-1',
      role: 'user',
      status: 'complete',
      created_at_ms: 1000,
      blocks: [{ type: 'text', content: 'Hello' }],
    };
    const invalid = { ...valid, id: 'entry-bad', role: 'unknown' };
    const rawBootstrap = rawBootstrapWithTimelineDecoration({
      decoration_id: 'context-compaction:valid',
      kind: 'context_compaction',
      anchor: { target_kind: 'message', message_id: 'entry-user-1', edge: 'after' },
      ordinal: 0,
      compaction: { operation_id: 'valid', phase: 'complete', status: 'compacted', updated_at_ms: 1000 },
    });
    expect(() => mapFlowerLiveBootstrap({
      ...rawBootstrap,
      timeline_messages: [valid, invalid],
    }, mapperOptions())).toThrow(/timeline message entry-bad has invalid role/);

    expect(() => mapFlowerLiveEvents({
      stream_generation: 1,
      next_cursor: 1,
      retained_from_seq: 1,
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        turn_id: 'turn-1',
        run_id: 'run-1',
        kind: 'timeline.replaced',
        at_unix_ms: 2000,
        payload: { messages: [valid, invalid], stream_generation: 1, snapshot_through_seq: 1 },
      }],
    })).toThrow(/timeline message entry-bad has invalid role/);
  });

  it('binds browser live deltas to exact thread, turn, run, and message identity', () => {
    const initial = thread({ messages: [message()] });
    const missingRun = applyFlowerLiveEvent(initial, 0, {
      ...event(1, 'message.started', {
        message_id: 'assistant-distinct', role: 'assistant', status: 'streaming', created_at_ms: 2000,
      }),
      run_id: undefined,
    });
    expect(missingRun.resyncRequired).toBe(true);
    expect(missingRun.thread.messages).toHaveLength(1);

    const started = applyFlowerLiveEvent(initial, 0, event(1, 'message.started', {
      message_id: 'assistant-distinct', role: 'assistant', status: 'streaming', created_at_ms: 2000,
    }));
    const blockStarted = applyFlowerLiveEvent(started.thread, 1, event(2, 'message.block_started', {
      message_id: 'assistant-distinct', block_index: 0, block_type: 'markdown',
    }));
    const mismatched = applyFlowerLiveEvent(blockStarted.thread, 2, {
      ...event(3, 'message.block_delta', {
        message_id: 'assistant-distinct', block_index: 0, delta: 'must not apply',
      }),
      turn_id: 'turn-other',
    });
    expect(mismatched.resyncRequired).toBe(true);
    expect(mismatched.thread.messages.find((item) => item.id === 'assistant-distinct')?.content).toBe('');

    const exact = applyFlowerLiveEvent(blockStarted.thread, 2, event(3, 'message.block_delta', {
      message_id: 'assistant-distinct', block_index: 0, delta: 'applied',
    }));
    expect(exact.resyncRequired).toBe(false);
    expect(exact.thread.messages.find((item) => item.id === 'assistant-distinct')).toMatchObject({
      thread_id: 'th-live', turn_id: 'turn-1', run_id: 'run-1', content: 'applied',
    });

    const mismatchedActivity = applyFlowerLiveEvent(exact.thread, 3, event(4, 'message.block_set', {
      message_id: 'assistant-distinct',
      block_index: 1,
      block: {
        type: 'activity-timeline',
        block: {
          ...activityTimelineBlock('tool-mismatch', 'Must not apply'),
          run_id: 'run-other',
        },
      },
    }));
    expect(mismatchedActivity.resyncRequired).toBe(true);
    expect(mismatchedActivity.thread.messages.find((item) => item.id === 'assistant-distinct')?.blocks).toHaveLength(1);
  });

  it('projects model io status from bootstrap and live updates', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap({
      live_state: {
        thread_patch: {},
        runs: {
          'run-1': { run_id: 'run-1', status: 'running', message_id: 'assistant-live' },
        },
        model_io: {
          phase: 'waiting_response',
          run_id: 'run-1',
          step_index: 1,
          updated_at_ms: 3100,
        },
        approval_actions: {},
        input_requests: {},
      },
    }));

    expect(initial.model_io_status).toEqual({
      phase: 'waiting_response',
      run_id: 'run-1',
      step_index: 1,
      updated_at_ms: 3100,
    });

    const streaming = applyFlowerLiveEvent(initial, 0, event(1, 'model_io.updated', {
      status: {
        phase: 'streaming',
        run_id: 'run-1',
        updated_at_ms: 3200,
      },
    }));
    expect(streaming.thread.model_io_status).toEqual({
      phase: 'streaming',
      run_id: 'run-1',
      updated_at_ms: 3200,
    });
  });

  it('projects context usage and compaction decorations from bootstrap state', () => {
    const projected = projectFlowerLiveBootstrap(bootstrap({
      live_state: {
        thread_patch: {},
        runs: {
          'run-1': { run_id: 'run-1', status: 'running', message_id: 'assistant-live' },
        },
        context_usage: {
          run_id: 'run-1',
          step_index: 1,
          phase: 'projected_request',
          input_tokens: 620,
          context_window_tokens: 1000,
          threshold_tokens: 900,
          used_ratio: 0.62,
          threshold_ratio: 0.9,
          pressure_status: 'stable',
          source: 'full_request_estimate',
          updated_at_ms: 3100,
        },
        context_compactions: [{
          operation_id: 'compact-1',
          run_id: 'run-1',
          step_index: 1,
          phase: 'complete',
          status: 'compacted',
          tokens_before: 920,
          tokens_after_estimate: 210,
          updated_at_ms: 3200,
        }],
        timeline_decorations: [{
          decoration_id: 'context-compaction:compact-1',
          kind: 'context_compaction',
          anchor: {
            target_kind: 'message',
            message_id: 'assistant-live',
            edge: 'after',
          },
          ordinal: 0,
          compaction: {
            operation_id: 'compact-1',
            run_id: 'run-1',
            phase: 'complete',
            status: 'compacted',
            tokens_before: 920,
            tokens_after_estimate: 210,
            updated_at_ms: 3200,
          },
        }],
        approval_actions: {},
        input_requests: {},
      },
    }));

    expect(projected.context_usage).toMatchObject({
      run_id: 'run-1',
      input_tokens: 620,
      pressure_status: 'stable',
    });
    expect(projected.context_compactions?.[0]?.operation_id).toBe('compact-1');
    expect(projected.timeline_decorations?.[0]?.anchor.message_id).toBe('assistant-live');
  });

  it('keeps empty structured blocks in timeline messages so original block indexes stay stable', () => {
    const projected = projectFlowerLiveBootstrap(bootstrap({
      timeline_messages: [{
        id: 'assistant-live',
        thread_id: 'th-live',
        turn_id: 'turn-1',
        run_id: 'run-1',
        role: 'assistant',
        content: 'alpha\n\nbeta',
        status: 'canceled',
        created_at_ms: 2000,
        blocks: [
          { type: 'markdown', content: '' },
          activityTimelineBlock('tool-1', 'first'),
          { type: 'markdown', content: 'alpha' },
          activityTimelineBlock('tool-2', 'second'),
        ],
      }],
      live_state: {
        thread_patch: {},
        runs: {},
        approval_actions: {},
        input_requests: {},
      },
    }));

    expect(projected.messages[0]?.blocks).toHaveLength(4);
    expect(projected.messages[0]?.blocks?.map((block) => block.type)).toEqual(['markdown', 'activity-timeline', 'markdown', 'activity-timeline']);
  });

  it('rejects invalid bootstrap compaction decorations instead of dropping them', () => {
    expect(() => mapFlowerLiveBootstrap({
      schema_version: 1,
      endpoint_id: 'runtime',
      thread_id: 'th-live',
      cursor: 1,
      retained_from_seq: 1,
      thread: {
        thread_id: 'th-live',
        title: 'Live thread',
        title_status: 'ready',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'running',
        read_status: readStatus(),
      },
      timeline_messages: [],
      read_status: readStatus(),
      live_state: {
        thread_patch: {},
        runs: {},
        context_compactions: [{
          operation_id: 'compact-1',
          phase: 'complete',
          status: 'compacted',
          updated_at_ms: 3200,
        }],
        timeline_decorations: [{
          decoration_id: 'context-compaction:compact-1',
          kind: 'context_compaction',
          anchor: {
            target_kind: 'message',
            message_id: 'assistant-live',
          },
          compaction: {
            operation_id: 'compact-1',
            phase: 'complete',
            status: 'compacted',
            updated_at_ms: 3200,
          },
        }],
        approval_actions: {},
        input_requests: {},
      },
    }, mapperOptions())).toThrow(/timeline_decorations requires valid decoration payloads/);
  });

  it.each([
    ['missing kind', {
      decoration_id: 'context-compaction:compact-1',
      anchor: { target_kind: 'message', message_id: 'msg-user', edge: 'after' },
      ordinal: 0,
      compaction: { operation_id: 'compact-1', phase: 'complete', status: 'compacted', updated_at_ms: 2000 },
    }],
    ['unknown kind', {
      decoration_id: 'unknown:1',
      kind: 'unknown',
      anchor: { target_kind: 'message', message_id: 'msg-user', edge: 'after' },
      ordinal: 0,
      compaction: { operation_id: 'compact-1', phase: 'complete', status: 'compacted', updated_at_ms: 2000 },
    }],
    ['mixed payloads', {
      decoration_id: 'turn-projection-unavailable:turn-1',
      kind: 'turn_projection_unavailable',
      anchor: { target_kind: 'message', message_id: 'msg-user', edge: 'after' },
      ordinal: 0,
      compaction: { operation_id: 'compact-1', phase: 'complete', status: 'compacted', updated_at_ms: 2000 },
      projection_unavailable: {
        turn_id: 'turn-1',
        run_id: 'run-1',
        expected_message_id: 'msg-assistant',
        reason: 'not_renderable',
      },
    }],
  ])('rejects %s timeline decoration contracts', (_name, decoration) => {
    expect(() => mapFlowerLiveBootstrap(rawBootstrapWithTimelineDecoration(decoration), mapperOptions()))
      .toThrow(/timeline_decorations requires valid decoration payloads/);
  });

  it('maps unavailable projection decorations without synthesizing an assistant message', () => {
    const mapped = mapFlowerLiveBootstrap(rawBootstrapWithTimelineDecoration({
      decoration_id: 'turn-projection-unavailable:turn-1',
      kind: 'turn_projection_unavailable',
      anchor: { target_kind: 'message', message_id: 'msg-user', edge: 'after' },
      ordinal: 0,
      projection_unavailable: {
        turn_id: 'turn-1',
        run_id: 'run-1',
        expected_message_id: 'msg-assistant',
        reason: 'not_renderable',
      },
    }), mapperOptions());

    expect(mapped.timeline_messages.map((message) => message.id)).toEqual(['msg-user']);
    expect(mapped.live_state.timeline_decorations).toEqual([expect.objectContaining({
      kind: 'turn_projection_unavailable',
      projection_unavailable: expect.objectContaining({ expected_message_id: 'msg-assistant', reason: 'not_renderable' }),
    })]);
  });

  it('maps and applies live context usage and compaction events', () => {
    const initial = thread({
      status: 'running',
      active_run_id: 'run-1',
      messages: [
        message(),
        {
          id: 'assistant-live',
          thread_id: 'th-live',
          turn_id: 'turn-1',
          run_id: 'run-1',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 2000,
          active_cursor: true,
        },
      ],
    });

    const mapped = mapFlowerLiveEvents({
      events: [
        {
          schema_version: 1,
          seq: 1,
          endpoint_id: 'runtime',
          thread_id: 'th-live',
          run_id: 'run-1',
          at_unix_ms: 4000,
          kind: 'context.usage.updated',
          payload: {
            usage: {
              run_id: 'run-1',
              step_index: 1,
              phase: 'projected_request',
              input_tokens: 700,
              context_window_tokens: 1000,
              used_ratio: 0.7,
              pressure_status: 'near_threshold',
              updated_at_ms: 4000,
            },
          },
        },
        {
          schema_version: 1,
          seq: 2,
          endpoint_id: 'runtime',
          thread_id: 'th-live',
          run_id: 'run-1',
          at_unix_ms: 4100,
          kind: 'context.compaction.updated',
          payload: {
            compaction: {
              operation_id: 'compact-live',
              run_id: 'run-1',
              step_index: 1,
              phase: 'start',
              status: 'compacting',
              trigger: 'pre_request',
              reason: 'threshold',
              tokens_before: 910,
              updated_at_ms: 4100,
            },
            timeline_decoration: {
              decoration_id: 'context-compaction:compact-live',
              kind: 'context_compaction',
              anchor: {
                target_kind: 'message',
                message_id: 'assistant-live',
                edge: 'after',
              },
              ordinal: 0,
              compaction: {
                operation_id: 'compact-live',
                run_id: 'run-1',
                step_index: 1,
                phase: 'start',
                status: 'compacting',
                trigger: 'pre_request',
                reason: 'threshold',
                tokens_before: 910,
                updated_at_ms: 4100,
              },
            },
          },
        },
      ],
      next_cursor: 2,
      retained_from_seq: 1,
    });
    const result = applyEvents(initial, 0, mapped.events);

    expect(result.thread.context_usage).toMatchObject({
      run_id: 'run-1',
      input_tokens: 700,
      pressure_status: 'near_threshold',
    });
    expect(result.thread.context_compactions?.[0]?.operation_id).toBe('compact-live');
    expect(result.thread.timeline_decorations?.[0]).toMatchObject({
      decoration_id: 'context-compaction:compact-live',
      anchor: {
        message_id: 'assistant-live',
        edge: 'after',
      },
      compaction: {
        status: 'compacting',
      },
    });
  });

  it('maps unknown context lifecycle strings to stable UI enums', () => {
    const mapped = mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        run_id: 'run-1',
        at_unix_ms: 4100,
        kind: 'context.compaction.updated',
        payload: {
          compaction: {
            operation_id: 'compact-unknown',
            phase: 'provider_private_phase',
            status: 'provider_private_status',
            updated_at_ms: 4100,
          },
          timeline_decoration: {
            decoration_id: 'context-compaction:compact-unknown',
            kind: 'context_compaction',
            anchor: {
              target_kind: 'message',
              message_id: 'assistant-live',
              edge: 'after',
            },
            ordinal: 0,
            compaction: {
              operation_id: 'compact-unknown',
              phase: 'provider_private_phase',
              status: 'provider_private_status',
              updated_at_ms: 4100,
            },
          },
        },
      }],
      next_cursor: 1,
      retained_from_seq: 1,
    });
    const event = mapped.events[0] as Extract<FlowerLiveEvent, { kind: 'context.compaction.updated' }>;

    expect(event.kind).toBe('context.compaction.updated');
    expect(event.payload.compaction.status).toBe('checkpoint');
    expect(event.payload.compaction.phase).toBe('checkpoint');
    expect(event.payload.compaction.status).not.toBe('provider_private_status');
    expect(event.payload.timeline_decoration.compaction.status).toBe('checkpoint');
    expect(event.payload.timeline_decoration.compaction.phase).toBe('checkpoint');
  });

  it('keeps compaction dividers anchored to the event timeline decoration', () => {
    const initial = thread({
      messages: [
        message(),
        {
          id: 'assistant-live',
          thread_id: 'th-live',
          turn_id: 'turn-1',
          run_id: 'run-1',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 2000,
          active_cursor: true,
        },
      ],
    });

    const applied = applyFlowerLiveEvent(initial, 0, event(1, 'context.compaction.updated', {
      compaction: {
        operation_id: 'compact-anchor',
        run_id: 'run-1',
        phase: 'start',
        status: 'compacting',
        tokens_before: 910,
        updated_at_ms: 4100,
      },
      timeline_decoration: {
        decoration_id: 'context-compaction:compact-anchor',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'assistant-live',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-anchor',
          run_id: 'run-1',
          phase: 'start',
          status: 'compacting',
          tokens_before: 910,
          updated_at_ms: 4100,
        },
      },
    }));

    expect(applied.thread.timeline_decorations?.[0]).toMatchObject({
      decoration_id: 'context-compaction:compact-anchor',
      anchor: {
        target_kind: 'message',
        message_id: 'assistant-live',
        edge: 'after',
      },
    });
  });

  it('maps zero-based compaction decoration block anchors from raw live events', () => {
    const mapped = mapFlowerLiveEvents({
      events: [
        {
          schema_version: 1,
          seq: 1,
          endpoint_id: 'runtime',
          thread_id: 'th-live',
          run_id: 'run-1',
          at_unix_ms: 4100,
          kind: 'context.compaction.updated',
          payload: {
            compaction: {
              operation_id: 'compact-block-zero',
              run_id: 'run-1',
              phase: 'complete',
              status: 'compacted',
              updated_at_ms: 4100,
            },
            timeline_decoration: {
              decoration_id: 'context-compaction:compact-block-zero',
              kind: 'context_compaction',
              anchor: {
                target_kind: 'block',
                message_id: 'assistant-live',
                block_index: 0,
                edge: 'after',
              },
              ordinal: 0,
              compaction: {
                operation_id: 'compact-block-zero',
                run_id: 'run-1',
                phase: 'complete',
                status: 'compacted',
                updated_at_ms: 4100,
              },
            },
          },
        },
        {
          schema_version: 1,
          seq: 2,
          endpoint_id: 'runtime',
          thread_id: 'th-live',
          run_id: 'run-1',
          at_unix_ms: 4200,
          kind: 'context.compaction.updated',
          payload: {
            compaction: {
              operation_id: 'compact-activity-zero',
              run_id: 'run-1',
              phase: 'start',
              status: 'compacting',
              updated_at_ms: 4200,
            },
            timeline_decoration: {
              decoration_id: 'context-compaction:compact-activity-zero',
              kind: 'context_compaction',
              anchor: {
                target_kind: 'activity_item',
                message_id: 'assistant-live',
                block_index: 0,
                activity_item_id: 'tool-zero',
                edge: 'after',
              },
              ordinal: 1,
              compaction: {
                operation_id: 'compact-activity-zero',
                run_id: 'run-1',
                phase: 'start',
                status: 'compacting',
                updated_at_ms: 4200,
              },
            },
          },
        },
      ],
      next_cursor: 2,
      retained_from_seq: 1,
    });

    const blockEvent = mapped.events[0] as Extract<FlowerLiveEvent, { kind: 'context.compaction.updated' }>;
    const activityEvent = mapped.events[1] as Extract<FlowerLiveEvent, { kind: 'context.compaction.updated' }>;
    expect(blockEvent.kind).toBe('context.compaction.updated');
    expect(activityEvent.kind).toBe('context.compaction.updated');
    expect(blockEvent.payload.timeline_decoration.anchor).toMatchObject({
      target_kind: 'block',
      message_id: 'assistant-live',
      block_index: 0,
      edge: 'after',
    });
    expect(activityEvent.payload.timeline_decoration.anchor).toMatchObject({
      target_kind: 'activity_item',
      message_id: 'assistant-live',
      block_index: 0,
      activity_item_id: 'tool-zero',
      edge: 'after',
    });
  });

  it('clamps context usage ratios and ignores the obsolete usage event name', () => {
    const mapped = mapFlowerLiveEvents({
      events: [
        {
          schema_version: 1,
          seq: 1,
          endpoint_id: 'runtime',
          thread_id: 'th-live',
          run_id: 'run-1',
          at_unix_ms: 4000,
          kind: 'context.usage.updated',
          payload: {
            usage: {
              run_id: 'run-1',
              phase: 'projected_request',
              input_tokens: 1400,
              context_window_tokens: 1000,
              used_ratio: 1.4,
              threshold_ratio: 1.2,
              pressure_status: 'hard_limit',
              updated_at_ms: 4000,
            },
          },
        },
        {
          schema_version: 1,
          seq: 2,
          endpoint_id: 'runtime',
          thread_id: 'th-live',
          run_id: 'run-1',
          at_unix_ms: 4100,
          kind: 'usage.updated',
          payload: {
            usage: {
              phase: 'projected_request',
              pressure_status: 'stable',
              updated_at_ms: 4100,
            },
          },
        },
      ],
      next_cursor: 2,
      retained_from_seq: 1,
    });

    expect(mapped.events).toHaveLength(1);
    expect(mapped.events[0]?.kind).toBe('context.usage.updated');
    if (mapped.events[0]?.kind !== 'context.usage.updated') throw new Error('expected context usage event');
    expect(mapped.events[0].payload.usage.used_ratio).toBe(1);
    expect(mapped.events[0].payload.usage.threshold_ratio).toBe(1);
  });

  it('updates an existing compaction divider by operation id', () => {
    const initial = thread({
      messages: [
        message(),
        {
          id: 'assistant-live',
          thread_id: 'th-live',
          turn_id: 'turn-1',
          run_id: 'run-1',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 2000,
          active_cursor: true,
        },
      ],
    });
    const started = applyFlowerLiveEvent(initial, 0, event(1, 'context.compaction.updated', {
      compaction: {
        operation_id: 'compact-live',
        run_id: 'run-1',
        phase: 'start',
        status: 'compacting',
        tokens_before: 910,
        updated_at_ms: 4100,
      },
      timeline_decoration: {
        decoration_id: 'context-compaction:compact-live',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'assistant-live',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-live',
          run_id: 'run-1',
          phase: 'start',
          status: 'compacting',
          tokens_before: 910,
          updated_at_ms: 4100,
        },
      },
    }));
    const completed = applyFlowerLiveEvent(started.thread, started.cursor, event(2, 'context.compaction.updated', {
      compaction: {
        operation_id: 'compact-live',
        run_id: 'run-1',
        phase: 'complete',
        status: 'compacted',
        tokens_before: 910,
        tokens_after_estimate: 220,
        updated_at_ms: 4200,
      },
      timeline_decoration: {
        decoration_id: 'context-compaction:compact-live',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'assistant-live',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-live',
          run_id: 'run-1',
          phase: 'complete',
          status: 'compacted',
          tokens_before: 910,
          tokens_after_estimate: 220,
          updated_at_ms: 4200,
        },
      },
    }));

    expect(completed.thread.context_compactions).toHaveLength(1);
    expect(completed.thread.timeline_decorations).toHaveLength(1);
    expect(completed.thread.timeline_decorations?.[0]?.anchor.message_id).toBe('assistant-live');
    expect(completed.thread.timeline_decorations?.[0]?.compaction).toMatchObject({
      status: 'compacted',
      tokens_after_estimate: 220,
    });
  });

  it('keeps compaction lifecycle separate from running run lifecycle', () => {
    const initial = thread({
      status: 'running',
      active_run_id: 'run-1',
      model_io_status: {
        phase: 'streaming',
        run_id: 'run-1',
        updated_at_ms: 4000,
      },
      messages: [
        message(),
        {
          id: 'assistant-live',
          thread_id: 'th-live',
          turn_id: 'turn-1',
          run_id: 'run-1',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 2000,
          active_cursor: true,
        },
      ],
    });

    const compacting = applyFlowerLiveEvent(initial, 0, event(1, 'context.compaction.updated', {
      compaction: {
        operation_id: 'compact-continue',
        run_id: 'run-1',
        phase: 'start',
        status: 'compacting',
        tokens_before: 910,
        updated_at_ms: 4100,
      },
      timeline_decoration: {
        decoration_id: 'context-compaction:compact-continue',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'assistant-live',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-continue',
          run_id: 'run-1',
          phase: 'start',
          status: 'compacting',
          tokens_before: 910,
          updated_at_ms: 4100,
        },
      },
    }));
    const compacted = applyFlowerLiveEvent(compacting.thread, compacting.cursor, event(2, 'context.compaction.updated', {
      compaction: {
        operation_id: 'compact-continue',
        run_id: 'run-1',
        phase: 'complete',
        status: 'compacted',
        tokens_before: 910,
        tokens_after_estimate: 220,
        updated_at_ms: 4200,
      },
      timeline_decoration: {
        decoration_id: 'context-compaction:compact-continue',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'assistant-live',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-continue',
          run_id: 'run-1',
          phase: 'complete',
          status: 'compacted',
          tokens_before: 910,
          tokens_after_estimate: 220,
          updated_at_ms: 4200,
        },
      },
    }));

    expect(compacted.thread.status).toBe('running');
    expect(compacted.thread.active_run_id).toBe('run-1');
    expect(compacted.thread.model_io_status).toMatchObject({
      phase: 'streaming',
      run_id: 'run-1',
    });
    expect(compacted.thread.context_compactions).toHaveLength(1);
    expect(compacted.thread.timeline_decorations).toHaveLength(1);
    const compactedDecoration = compacted.thread.timeline_decorations?.[0];
    expect(compactedDecoration?.kind).toBe('context_compaction');
    if (compactedDecoration?.kind !== 'context_compaction') throw new Error('expected context compaction decoration');
    expect(compactedDecoration.compaction.status).toBe('compacted');

    const blockStarted = applyFlowerLiveEvent(compacted.thread, compacted.cursor, event(3, 'message.block_started', {
      message_id: 'assistant-live',
      block_index: 0,
      block_type: 'markdown',
    }));
    const continued = applyFlowerLiveEvent(blockStarted.thread, blockStarted.cursor, event(4, 'message.block_delta', {
      message_id: 'assistant-live',
      block_index: 0,
      delta: 'continuing after compaction',
    }));
    expect(continued.thread.status).toBe('running');
    expect(continued.thread.active_run_id).toBe('run-1');
    expect(continued.thread.messages.find((item) => item.id === 'assistant-live')?.content).toContain('continuing after compaction');
  });

  it('applies queued turn count patches down to zero', () => {
    const initial = thread({
      queued_turn_count: 1,
      queued_turns: [{ turn_id: 'turn-queued', prompt: 'queued prompt', created_at_ms: 2000 }],
    });
    const mapped = mapFlowerLiveEvents({
      schema_version: 1,
      stream_generation: 1,
      next_cursor: 10,
      events: [{
        schema_version: 1,
        seq: 10,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        at_unix_ms: 3000,
        kind: 'thread.patched',
        payload: {
          patch: {
            queued_turn_count: 0,
            queued_turns: [],
          },
        },
      }],
    });
    const result = applyFlowerLiveEvent(initial, 9, mapped.events[0]);

    expect(result.thread.queued_turn_count).toBe(0);
    expect(result.thread.queued_turns).toEqual([]);
  });

  it('keeps queued turn count from thread bootstrap payload', () => {
    const mapped = mapFlowerLiveBootstrap({
      schema_version: 1,
      endpoint_id: 'runtime',
      thread_id: 'th-live',
      stream_generation: 1,
      cursor: 0,
      retained_from_seq: 1,
      thread: {
        thread_id: 'th-live',
        title: 'Queued thread',
        title_status: 'ready',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'idle',
        queued_turn_count: 1,
        last_message_preview: 'queued',
        read_status: readStatus(),
      },
      timeline_messages: [],
      live_state: {
        thread_patch: {},
        runs: {},
        approval_actions: {},
        input_requests: {},
      },
      read_status: readStatus(),
      generated_at_ms: 1000,
    }, mapperOptions());

    const projected = projectFlowerLiveBootstrap(mapped);

    expect(projected.queued_turn_count).toBe(1);
  });

  it('preserves an owned empty queued turn list from full bootstrap', () => {
    const mapped = mapFlowerLiveBootstrap({
      ...rawBootstrapWithTimelineDecoration({
        decoration_id: 'context-compaction:empty-queue',
        kind: 'context_compaction',
        anchor: { target_kind: 'message', message_id: 'msg-user', edge: 'after' },
        ordinal: 0,
        compaction: { operation_id: 'empty-queue', phase: 'complete', status: 'compacted', updated_at_ms: 1000 },
      }),
      thread: {
        ...rawBootstrapWithTimelineDecoration({}).thread,
        queued_turn_count: 0,
        queued_turns: [],
      },
    }, mapperOptions());

    expect(mapped.thread.queued_turns).toEqual([]);
  });

  it('rejects an owned queued turn list when any element is malformed', () => {
    const raw = rawBootstrapWithTimelineDecoration({
      decoration_id: 'context-compaction:invalid-queue',
      kind: 'context_compaction',
      anchor: { target_kind: 'message', message_id: 'msg-user', edge: 'after' },
      ordinal: 0,
      compaction: { operation_id: 'invalid-queue', phase: 'complete', status: 'compacted', updated_at_ms: 1000 },
    });

    expect(() => mapFlowerLiveBootstrap({
      ...raw,
      thread: {
        ...raw.thread,
        queued_turn_count: 1,
        queued_turns: [null],
      },
    }, mapperOptions())).toThrow(/queued turn 0 must be an object/);
  });

  it('rejects malformed queued attachment contracts', () => {
    const raw = rawBootstrapWithTimelineDecoration({
      decoration_id: 'context-compaction:invalid-queued-attachment',
      kind: 'context_compaction',
      anchor: { target_kind: 'message', message_id: 'msg-user', edge: 'after' },
      ordinal: 0,
      compaction: { operation_id: 'invalid-queued-attachment', phase: 'complete', status: 'compacted', updated_at_ms: 1000 },
    });

    expect(() => mapFlowerLiveBootstrap({
      ...raw,
      thread: {
        ...raw.thread,
        queued_turn_count: 1,
        queued_turns: [{
          turn_id: 'turn-invalid-attachment',
          text: 'Inspect this file',
          created_at_unix_ms: 1_710_000_000_000,
          attachments: { name: 'notes.txt' },
        }],
      },
    }, mapperOptions())).toThrow(/queued turn 0 attachments must be an array/);

    expect(() => mapFlowerLiveBootstrap({
      ...raw,
      thread: {
        ...raw.thread,
        queued_turn_count: 1,
        queued_turns: [{
          turn_id: 'turn-invalid-attachment',
          text: 'Inspect this file',
          created_at_unix_ms: 1_710_000_000_000,
          attachments: [{ name: 'notes.txt', mime_type: 'text/plain', url: '' }],
        }],
      },
    }, mapperOptions())).toThrow(/queued turn 0 attachment 0 is invalid/);
  });

  it('maps queued turn linked context for pending hydration', () => {
    const contextAction = {
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      provider: 'flower',
      target: { target_id: 'current', locality: 'auto' },
      source: { surface: 'file_browser' },
      context: [{ kind: 'file_path', path: '/workspace/index.ts', is_directory: false }],
      presentation: { label: 'Ask Flower', priority: 100 },
    };
    const mapped = mapFlowerLiveBootstrap({
      schema_version: 1,
      endpoint_id: 'runtime',
      thread_id: 'th-live',
      stream_generation: 1,
      cursor: 0,
      retained_from_seq: 1,
      thread: {
        thread_id: 'th-live',
        title: 'Queued thread',
        title_status: 'ready',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'running',
        queued_turn_count: 1,
        queued_turns: [{
          turn_id: 'turn-linked-file',
          text: 'Inspect this file',
          created_at_unix_ms: 1_710_000_000_000,
          attachments: [{ name: 'notes.txt', mime_type: 'text/plain', url: '/api/uploads/notes' }],
          context_action: contextAction,
        }],
        read_status: readStatus(),
      },
      timeline_messages: [],
      live_state: {
        thread_patch: {},
        runs: {},
        approval_actions: {},
        input_requests: {},
      },
      read_status: readStatus(),
      generated_at_ms: 1300,
    }, mapperOptions());

    expect(mapped.thread.queued_turns).toEqual([{
      turn_id: 'turn-linked-file',
      prompt: 'Inspect this file',
      created_at_ms: 1_710_000_000_000,
      attachments: [{ name: 'notes.txt', mime_type: 'text/plain', url: '/api/uploads/notes' }],
      context_action: contextAction,
    }]);
  });

  it('clears queued turn detail when timeline replacement confirms the queue is empty', () => {
    const initial = thread({
      queued_turn_count: 1,
      queued_turns: [{
        turn_id: 'turn-linked-file',
        prompt: 'Inspect this file',
        created_at_ms: 1200,
      }],
    });
    const replacement = applyFlowerLiveEvent(initial, 0, event(1, 'timeline.replaced', {
      messages: [{
        id: 'msg-linked-file',
        role: 'user',
        content: 'Inspect this file',
        status: 'complete',
        created_at_ms: 1200,
      }],
      stream_generation: 1,
      snapshot_through_seq: 1,
      thread_patch: { queued_turn_count: 0 },
    }));

    expect(replacement.thread.queued_turn_count).toBe(0);
    expect(replacement.thread.queued_turns).toEqual([]);
    expect(replacement.thread.messages.map((item) => item.id)).toEqual(['msg-linked-file']);
  });

  it('keeps failed compaction separate from failed run lifecycle', () => {
    const initial = thread({
      status: 'running',
      active_run_id: 'run-1',
      model_io_status: {
        phase: 'streaming',
        run_id: 'run-1',
        updated_at_ms: 4000,
      },
    });

    const failedCompaction = applyFlowerLiveEvent(initial, 0, event(1, 'context.compaction.updated', {
      compaction: {
        operation_id: 'compact-failed',
        run_id: 'run-1',
        phase: 'failed',
        status: 'failed',
        error: 'summary failed',
        updated_at_ms: 4100,
      },
      timeline_decoration: {
        decoration_id: 'context-compaction:compact-failed',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'msg-user',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-failed',
          run_id: 'run-1',
          phase: 'failed',
          status: 'failed',
          error: 'summary failed',
          updated_at_ms: 4100,
        },
      },
    }));

    expect(failedCompaction.thread.status).toBe('running');
    expect(failedCompaction.thread.active_run_id).toBe('run-1');
    expect(failedCompaction.thread.model_io_status?.run_id).toBe('run-1');
    expect(failedCompaction.thread.timeline_decorations?.[0]?.compaction).toMatchObject({
      status: 'failed',
      error: 'summary failed',
    });
  });

  it('keeps no-op compaction as a context divider without ending the run', () => {
    const initial = thread({
      status: 'running',
      active_run_id: 'run-1',
      model_io_status: {
        phase: 'streaming',
        run_id: 'run-1',
        updated_at_ms: 4000,
      },
    });

    const noOpCompaction = applyFlowerLiveEvent(initial, 0, event(1, 'context.compaction.updated', {
      compaction: {
        operation_id: 'compact-noop',
        run_id: 'run-1',
        phase: 'noop',
        status: 'noop',
        reason: 'context_too_small',
        updated_at_ms: 4100,
      },
      timeline_decoration: {
        decoration_id: 'context-compaction:compact-noop',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'msg-user',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-noop',
          run_id: 'run-1',
          phase: 'noop',
          status: 'noop',
          reason: 'context_too_small',
          updated_at_ms: 4100,
        },
      },
    }));

    expect(noOpCompaction.thread.status).toBe('running');
    expect(noOpCompaction.thread.active_run_id).toBe('run-1');
    expect(noOpCompaction.thread.model_io_status?.run_id).toBe('run-1');
    expect(noOpCompaction.thread.timeline_decorations?.[0]?.compaction).toMatchObject({
      status: 'noop',
      reason: 'context_too_small',
    });
  });

  it('accepts model io updates only from the active live run', () => {
    const initial = thread();
    const staleBeforeRun = applyFlowerLiveEvent(initial, 0, event(1, 'model_io.updated', {
      status: {
        phase: 'waiting_response',
        run_id: 'run-old',
        updated_at_ms: 3100,
      },
    }));
    expect(staleBeforeRun.thread.model_io_status).toBeUndefined();

    const started = applyFlowerLiveEvent(staleBeforeRun.thread, staleBeforeRun.cursor, event(2, 'run.started', {
      run_id: 'run-new',
      message_id: 'assistant-new',
      status: 'running',
    }));
    const accepted = applyFlowerLiveEvent(started.thread, started.cursor, event(3, 'model_io.updated', {
      status: {
        phase: 'waiting_response',
        run_id: 'run-new',
        updated_at_ms: 3200,
      },
    }));
    expect(accepted.thread.model_io_status).toMatchObject({
      phase: 'waiting_response',
      run_id: 'run-new',
    });

    const staleAfterRun = applyFlowerLiveEvent(accepted.thread, accepted.cursor, {
      ...event(4, 'model_io.updated', {
        status: {
          phase: 'streaming',
          run_id: 'run-old',
          updated_at_ms: 3300,
        },
      }),
      run_id: 'run-old',
    });
    expect(staleAfterRun.thread.model_io_status).toMatchObject({
      phase: 'waiting_response',
      run_id: 'run-new',
    });
  });

  it('clears model io status only for the matching run', () => {
    const initial = thread({
      active_run_id: 'run-new',
      model_io_status: {
        phase: 'streaming',
        run_id: 'run-new',
        updated_at_ms: 3200,
      },
    });

    const staleClear = applyFlowerLiveEvent(initial, 0, {
      ...event(1, 'model_io.updated', { status: null }),
      run_id: 'run-old',
    });
    expect(staleClear.thread.model_io_status?.run_id).toBe('run-new');

    const emptyRunClear = applyFlowerLiveEvent(staleClear.thread, staleClear.cursor, {
      ...event(2, 'model_io.updated', { status: null }),
      run_id: '',
    });
    expect(emptyRunClear.thread.model_io_status?.run_id).toBe('run-new');

    const staleSet = applyFlowerLiveEvent(emptyRunClear.thread, emptyRunClear.cursor, {
      ...event(3, 'model_io.updated', {
        status: {
          phase: 'waiting_response',
          run_id: 'run-old',
          updated_at_ms: 3300,
        },
      }),
      run_id: 'run-old',
    });
    expect(staleSet.thread.model_io_status).toMatchObject({
      phase: 'streaming',
      run_id: 'run-new',
    });

    const staleTerminal = applyFlowerLiveEvent(staleSet.thread, staleSet.cursor, {
      ...event(4, 'run.status_changed', { run_id: 'run-old', status: 'success' }),
      run_id: 'run-old',
    });
    expect(staleTerminal.thread.model_io_status?.run_id).toBe('run-new');

    const matchingTerminal = applyFlowerLiveEvent(staleTerminal.thread, staleTerminal.cursor, {
      ...event(5, 'run.status_changed', { run_id: 'run-new', status: 'success' }),
      run_id: 'run-new',
    });
    expect(matchingTerminal.thread.model_io_status).toBeNull();
  });

  it('hides bootstrap model io status for user-waiting and terminal threads', () => {
    for (const status of ['waiting_user', 'success', 'failed', 'canceled'] as const) {
      const projected = projectFlowerLiveBootstrap(bootstrap({
        thread: thread({ status }),
        live_state: {
          thread_patch: {},
          runs: {
            'run-1': { run_id: 'run-1', status: 'running', message_id: 'assistant-live' },
          },
          model_io: {
            phase: 'streaming',
            run_id: 'run-1',
            updated_at_ms: 3200,
          },
          approval_actions: {},
          input_requests: {},
        },
      }));

      expect(projected.model_io_status).toBeNull();
    }
  });

  it('hides bootstrap model io status while a pending approval is visible', () => {
    const projected = projectFlowerLiveBootstrap(bootstrap({
      thread: thread({ status: 'waiting_approval' }),
      live_state: {
        thread_patch: {},
        runs: {
          'run-1': { run_id: 'run-1', status: 'running', message_id: 'assistant-live' },
        },
        model_io: {
          phase: 'streaming',
          run_id: 'run-1',
          updated_at_ms: 3200,
        },
        approval_actions: {
          'appr-1': approvalAction(),
        },
        input_requests: {},
      },
    }));

    expect(projected.status).toBe('waiting_approval');
    expect(projected.model_io_status).toBeNull();
  });

  it('projects waiting prompt reasoning selection', () => {
    const projected = projectFlowerLiveBootstrap(bootstrap({
      thread: thread({ status: 'waiting_user' }),
      live_state: {
        thread_patch: {},
        runs: {},
        approval_actions: {},
        input_requests: {
          'prompt-1': {
            prompt_id: 'prompt-1',
            message_id: 'msg-wait',
            tool_id: 'tool-wait',
            tool_name: 'request_user_input',
            reasoning_selection: { level: 'high' },
            questions: [{
              id: 'next',
              header: 'Continue',
              question: 'Continue?',
              response_mode: 'select',
              choices: [{ choice_id: 'yes', label: 'Yes', kind: 'select' }],
            }],
          },
        },
      },
    }));

    expect(projected.input_request?.reasoning_selection).toEqual({ level: 'high' });
  });

  it('hides model io status when thread patches enter waiting or terminal status without run identity', () => {
    const initial = thread({
      active_run_id: 'run-new',
      model_io_status: {
        phase: 'streaming',
        run_id: 'run-new',
        updated_at_ms: 3200,
      },
    });

    for (const [index, runStatusValue] of ['success', 'failed', 'canceled', 'waiting_user'].entries()) {
      const patched = applyFlowerLiveEvent(initial, 0, {
        ...event(index + 1, 'thread.patched', {
          patch: {
            run_status: runStatusValue,
            updated_at_ms: 3300 + index,
          },
        }),
        run_id: '',
      });

      expect(patched.thread.status).toBe(runStatusValue);
      expect(patched.thread.model_io_status).toBeNull();
      expect(patched.thread.active_run_id).toBeUndefined();

      const lateModelIO = applyFlowerLiveEvent(patched.thread, patched.cursor, {
        ...event(index + 10, 'model_io.updated', {
          status: {
            phase: 'streaming',
            run_id: 'run-new',
            updated_at_ms: 3400 + index,
          },
        }),
        run_id: 'run-new',
      });

      expect(lateModelIO.thread.model_io_status).toBeNull();
    }

    const waitingApproval = applyFlowerLiveEvent(initial, 0, {
      ...event(20, 'thread.patched', {
        patch: {
          run_status: 'waiting_approval',
          updated_at_ms: 3320,
        },
      }),
      run_id: '',
    });

    expect(waitingApproval.thread.status).toBe('waiting_approval');
    expect(waitingApproval.thread.model_io_status).toBeNull();
    expect(waitingApproval.thread.active_run_id).toBe('run-new');

    const waitingApprovalLateModelIO = applyFlowerLiveEvent(waitingApproval.thread, waitingApproval.cursor, {
      ...event(21, 'model_io.updated', {
        status: {
          phase: 'streaming',
          run_id: 'run-new',
          updated_at_ms: 3420,
        },
      }),
      run_id: 'run-new',
    });

    expect(waitingApprovalLateModelIO.thread.model_io_status).toBeNull();
  });

  it('clears stale active run identity when bootstrap live state is terminal', () => {
    const projected = projectFlowerLiveBootstrap(bootstrap({
      thread: thread({
        status: 'success',
        active_run_id: 'run-old',
        model_io_status: {
          phase: 'streaming',
          run_id: 'run-old',
          updated_at_ms: 3200,
        },
        context_usage: {
          run_id: 'run-post-compact',
          phase: 'projected_request',
          input_tokens: 240,
          context_window_tokens: 1000,
          used_ratio: 0.24,
          pressure_status: 'stable',
          updated_at_ms: 3300,
        },
      }),
      live_state: {
        thread_patch: { run_status: 'success' },
        runs: {},
        context_usage: {
          run_id: 'run-post-compact',
          phase: 'projected_request',
          input_tokens: 240,
          context_window_tokens: 1000,
          used_ratio: 0.24,
          pressure_status: 'stable',
          updated_at_ms: 3300,
        },
        approval_actions: {},
        input_requests: {},
      },
    }));

    expect(projected.status).toBe('success');
    expect(projected.active_run_id).toBeUndefined();
    expect(projected.model_io_status).toBeNull();
    expect(projected.context_usage?.run_id).toBe('run-post-compact');
  });

  it('keeps model io status across non-status thread summary patches', () => {
    const initial = thread({
      active_run_id: 'run-new',
      model_io_status: {
        phase: 'streaming',
        run_id: 'run-new',
        updated_at_ms: 3200,
      },
    });

    const patched = applyFlowerLiveEvent(initial, 0, {
      ...event(1, 'thread.patched', {
        patch: {
          title: 'Updated thread title',
          updated_at_ms: 3300,
        },
      }),
      run_id: '',
    });

    expect(patched.thread.status).toBe('running');
    expect(patched.thread.title).toBe('Updated thread title');
    expect(patched.thread.model_io_status?.run_id).toBe('run-new');
  });

  it('hides model io status when approval or user input takes over', () => {
    const base = thread({
      active_run_id: 'run-1',
      model_io_status: {
        phase: 'streaming',
        run_id: 'run-1',
        updated_at_ms: 3200,
      },
    });

    const approval = applyFlowerLiveEvent(base, 0, event(1, 'approval.requested', {
      action: {
        action_id: 'appr-1',
        origin: 'main_tool',
        run_id: 'run-1',
        tool_id: 'tool-1',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        version: 1,
        requested_at_ms: 3000,
        can_approve: true,
        summary: { label: 'terminal.exec' },
      },
    }));
    expect(approval.thread.model_io_status).toBeNull();

    const input = applyFlowerLiveEvent(base, 0, event(2, 'input.requested', {
      request: {
        prompt_id: 'prompt-1',
        message_id: 'msg-1',
        tool_id: 'tool-ask',
        tool_name: 'ask_user',
        questions: [{
          id: 'q1',
          header: 'Choice',
          question: 'Pick one',
          response_mode: 'write',
        }],
      },
    }));
    expect(input.thread.model_io_status).toBeNull();
  });

  it('clears stale active run identity from terminal materialized snapshots', () => {
    const projected = projectFlowerLiveBootstrap(bootstrap({
      thread: thread({
        status: 'success',
        active_run_id: 'run-old',
        context_usage: {
          run_id: 'run-latest',
          phase: 'projected_request',
          input_tokens: 510,
          context_window_tokens: 1000,
          used_ratio: 0.51,
          pressure_status: 'stable',
          updated_at_ms: 4300,
        },
      }),
      live_state: {
        thread_patch: { run_status: 'success' },
        runs: {},
        context_usage: {
          run_id: 'run-latest',
          phase: 'projected_request',
          input_tokens: 510,
          context_window_tokens: 1000,
          used_ratio: 0.51,
          pressure_status: 'stable',
          updated_at_ms: 4300,
        },
        approval_actions: {},
        input_requests: {},
      },
    }));

    expect(projected.status).toBe('success');
    expect(projected.active_run_id).toBeUndefined();
    expect(projected.context_usage?.run_id).toBe('run-latest');
  });

  it('clears stale active run identity when timeline replacement reaches terminal state', () => {
    const initial = thread({
      status: 'running',
      active_run_id: 'run-old',
      model_io_status: {
        phase: 'streaming',
        run_id: 'run-old',
        updated_at_ms: 4200,
      },
      context_usage: {
        run_id: 'run-latest',
        phase: 'projected_request',
        input_tokens: 610,
        context_window_tokens: 1000,
        used_ratio: 0.61,
        pressure_status: 'stable',
        updated_at_ms: 4300,
      },
    });
    const mapped = mapFlowerLiveEvents({
      schema_version: 1,
      stream_generation: 1,
      next_cursor: 30,
      events: [{
        schema_version: 1,
        seq: 30,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        run_id: 'run-old',
        at_unix_ms: 5000,
        kind: 'timeline.replaced',
        payload: {
          stream_generation: 1,
          snapshot_through_seq: 30,
          messages: [message({ id: 'msg-final', content: 'Done', blocks: [{ type: 'markdown', content: 'Done' }] })],
          thread_patch: {
            run_status: 'success',
          },
        context_usage: {
          run_id: 'run-latest',
          phase: 'projected_request',
          input_tokens: 610,
          context_window_tokens: 1000,
          used_ratio: 0.61,
          pressure_status: 'stable',
          updated_at_ms: 4300,
        },
      },
      }],
    });

    const result = applyFlowerLiveEvent(initial, 29, mapped.events[0]);

    expect(result.thread.status).toBe('success');
    expect(result.thread.active_run_id).toBeUndefined();
    expect(result.thread.model_io_status).toBeNull();
    expect(result.thread.context_usage?.run_id).toBe('run-latest');
  });

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
        title_status: 'ready',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'running',
      },
      timeline_messages: [{
        id: 'msg-user',
        thread_id: 'th-live',
        turn_id: 'turn-user',
        run_id: 'run-1',
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

  it('applies read_status from thread patch live events', () => {
    const initial = thread({
      status: 'running',
      read_status: readStatus({
        is_unread: false,
        snapshot: {
          activity_revision: 10,
          last_message_at_unix_ms: 1000,
          activity_signature: 'sig-10',
        },
      }),
    });
    const freshReadStatus = readStatus({
      is_unread: true,
      snapshot: {
        activity_revision: 20,
        last_message_at_unix_ms: 2000,
        activity_signature: 'sig-20',
      },
      read_state: {
        last_seen_activity_revision: 10,
        last_read_message_at_unix_ms: 1000,
        last_seen_activity_signature: 'sig-10',
      },
    });

    const mapped = mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        run_id: 'run-1',
        at_unix_ms: 4000,
        kind: 'thread.patched',
        payload: {
          patch: {
            run_status: 'success',
            updated_at_unix_ms: 2000,
            read_status: freshReadStatus,
          },
        },
      }],
      next_cursor: 1,
      retained_from_seq: 1,
    });
    const result = applyFlowerLiveEvent(initial, 0, mapped.events[0]);

    expect(result.thread.status).toBe('success');
    expect(result.thread.read_status.is_unread).toBe(true);
    expect(result.thread.read_status.snapshot.activity_signature).toBe('sig-20');
  });

  it('atomically replaces canonical approvals and preserves independent control confirmations', () => {
    const control = approvalAction({
      action_id: 'control-1',
      origin: 'control_confirm',
      run_id: 'run-control',
      tool_id: 'tool-control',
      queue_order: 0,
    });
    const initial = thread({
      status: 'waiting_approval',
      permission_type: 'approval_required',
      approval_actions: [control, approvalAction({ action_id: 'stale-main' })],
      approval_queue: { generation: 1, revision: 1, current_action_id: 'stale-main', current_position: 1, total: 1, unresolved_count: 1 },
    });
    const mapped = mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        run_id: 'run-parent',
        at_unix_ms: 4000,
        kind: 'approval.queue_replaced',
        payload: {
          actions: [{
            action_id: 'delegated-1',
            origin: 'delegated_subagent',
            run_id: 'run-child',
            tool_id: 'tool-child',
            tool_name: 'terminal.exec',
            state: 'requested',
            status: 'pending',
            revision: 2,
            version: 2,
            surface_epoch: 2,
            scope: 'thread:child-thread',
            queue_generation: 2,
            queue_order: 1,
            batch_index: 0,
            batch_size: 1,
            expected_seq: 1,
            requested_at_unix_ms: 3000,
            can_approve: true,
            summary: { label: 'Run command' },
          }, {
            action_id: 'main-1',
            origin: 'main_tool',
            run_id: 'run-parent',
            tool_id: 'tool-main',
            tool_name: 'file.write',
            state: 'requested',
            status: 'pending',
            revision: 1,
            version: 1,
            surface_epoch: 2,
            scope: 'thread:th-live',
            queue_generation: 2,
            queue_order: 2,
            batch_index: 0,
            batch_size: 1,
            expected_seq: 1,
            requested_at_unix_ms: 3100,
            can_approve: false,
            summary: { label: 'Write file' },
          }],
          approval_queue: {
            generation: 2,
            revision: 3,
            current_action_id: 'delegated-1',
            current_position: 1,
            total: 2,
            unresolved_count: 2,
          },
        },
      }],
      next_cursor: 1,
      retained_from_seq: 1,
    });

    const applied = applyEvents(initial, 0, mapped.events);

    expect(applied.thread.approval_actions?.map((action) => action.action_id)).toEqual([
      'control-1',
      'delegated-1',
      'main-1',
    ]);
    expect(applied.thread.approval_actions?.[1]).toMatchObject({
      origin: 'delegated_subagent',
      run_id: 'run-child',
      tool_id: 'tool-child',
      scope: 'thread:child-thread',
    });
    expect(applied.thread.approval_actions?.some((action) => action.action_id === 'stale-main')).toBe(false);
    expect(applied.thread.approval_queue).toMatchObject({ generation: 2, revision: 3 });

    const stale = applyFlowerLiveEvent(applied.thread, applied.cursor, event(2, 'approval.queue_replaced', {
      actions: [approvalAction({ action_id: 'regressed' })],
      approval_queue: { generation: 2, revision: 2, current_action_id: 'regressed', current_position: 1, total: 1, unresolved_count: 1 },
    }));
    expect(stale.thread).toBe(applied.thread);

    const cleared = applyFlowerLiveEvent(stale.thread, stale.cursor, event(3, 'approval.queue_replaced', {
      actions: [],
      approval_queue: { generation: 2, revision: 4, current_position: 0, total: 0, unresolved_count: 0 },
    }));
    expect(cleared.thread.approval_actions?.map((action) => action.action_id)).toEqual(['control-1']);
    expect(cleared.thread.status).toBe('waiting_approval');
  });

  it('rejects malformed canonical approval replacements as a unit', () => {
    const action = {
      action_id: 'delegated-1',
      origin: 'delegated_subagent',
      run_id: 'run-child',
      tool_id: 'tool-child',
      tool_name: 'terminal.exec',
      state: 'requested',
      status: 'pending',
      revision: 1,
      version: 1,
      surface_epoch: 3,
      scope: 'thread:child-thread',
      queue_generation: 3,
      queue_order: 1,
      batch_index: 0,
      batch_size: 1,
      requested_at_unix_ms: 3000,
      can_approve: true,
      expected_seq: 1,
      summary: { label: 'Run command' },
    };
    const queue = {
      generation: 3,
      revision: 4,
      current_action_id: 'delegated-1',
      current_position: 1,
      total: 1,
      unresolved_count: 1,
    };
    const malformed = [
      { actions: [{ ...action, origin: '' }], approval_queue: queue },
      { actions: [{ ...action, scope: 'child-thread' }], approval_queue: queue },
      { actions: [{ ...action, queue_generation: 2, surface_epoch: 2 }], approval_queue: queue },
      { actions: [{ ...action, can_approve: 'yes' }], approval_queue: queue },
      { actions: [action], approval_queue: { ...queue, generation: Number.NaN } },
      { actions: [action], approval_queue: { ...queue, current_action_id: 'missing' } },
      { actions: [action], approval_queue: { ...queue, total: 2 } },
      { actions: [action, { ...action }], approval_queue: { ...queue, total: 2, unresolved_count: 2 } },
    ];

    for (const payload of malformed) {
      expect(() => mapFlowerLiveEvents({
        events: [{
          schema_version: 1,
          seq: 1,
          endpoint_id: 'runtime',
          thread_id: 'th-live',
          run_id: 'run-parent',
          at_unix_ms: 4000,
          kind: 'approval.queue_replaced',
          payload,
        }],
        next_cursor: 1,
        retained_from_seq: 1,
      })).toThrow(/approval\.queue_replaced/);
    }
  });

  it('rejects malformed bootstrap approval actions instead of synthesizing authority fields', () => {
    const malformed = [
      { origin: undefined },
      { origin: 'unknown' },
      { state: undefined },
      { state: 'running' },
      { status: undefined },
      { status: 'complete' },
      { revision: 0 },
      { version: 0 },
      { version: 2 },
      { surface_epoch: undefined },
      { requested_at_unix_ms: undefined },
      { can_approve: 'false' },
      { can_approve: false },
      { expected_seq: undefined },
      { queue_generation: -1 },
      { queue_generation: 1 },
      { queue_order: Number.NaN },
      { queue_order: 1 },
      { batch_index: -1 },
      { batch_index: 1, batch_size: 2 },
      { batch_size: 0 },
      { summary: {} },
      { state: 'approved', status: 'resolved', can_approve: false, resolved_at_unix_ms: 2100 },
    ];

    for (const overrides of malformed) {
      expect(() => mapFlowerLiveBootstrap({
        ...rawBootstrapWithTimelineDecoration({
          decoration_id: 'context-compaction:approval-contract',
          kind: 'context_compaction',
          anchor: { target_kind: 'message', message_id: 'msg-user', edge: 'after' },
          ordinal: 0,
          compaction: {
            operation_id: 'approval-contract',
            phase: 'complete',
            status: 'compacted',
            updated_at_ms: 2000,
          },
        }),
        live_state: {
          thread_patch: {},
          runs: {},
          approval_actions: {
            'control-1': rawControlApprovalAction(overrides),
          },
          input_requests: {},
        },
      }, mapperOptions())).toThrow(/approval/);
    }
  });

  it('rejects invalid bootstrap approval containers and mismatched action identities', () => {
    const base = rawBootstrapWithTimelineDecoration({
      decoration_id: 'context-compaction:approval-container',
      kind: 'context_compaction',
      anchor: { target_kind: 'message', message_id: 'msg-user', edge: 'after' },
      ordinal: 0,
      compaction: {
        operation_id: 'approval-container',
        phase: 'complete',
        status: 'compacted',
        updated_at_ms: 2000,
      },
    });
    for (const approvalActions of [null, [], 'invalid']) {
      expect(() => mapFlowerLiveBootstrap({
        ...base,
        live_state: { thread_patch: {}, runs: {}, approval_actions: approvalActions, input_requests: {} },
      }, mapperOptions())).toThrow(/approval_actions must be an object/);
    }
    expect(() => mapFlowerLiveBootstrap({
      ...base,
      live_state: {
        thread_patch: {},
        runs: {},
        approval_actions: { 'stale-key': rawControlApprovalAction() },
        input_requests: {},
      },
    }, mapperOptions())).toThrow(/mismatched action identity/);
    expect(() => mapFlowerLiveBootstrap({
      ...base,
      live_state: {
        thread_patch: {},
        runs: {},
        approval_actions: {
          'control-1': rawControlApprovalAction(),
          'control-2': rawControlApprovalAction(),
        },
        input_requests: {},
      },
    }, mapperOptions())).toThrow(/mismatched action identity/);
  });

  it('rejects control confirmation events with inconsistent lifecycle authority', () => {
    const malformed = [
      { kind: 'approval.requested' as const, action: rawControlApprovalAction({ can_approve: false }) },
      { kind: 'approval.requested' as const, action: rawControlApprovalAction({ version: 2 }) },
      { kind: 'approval.requested' as const, action: rawControlApprovalAction({ expected_seq: undefined }) },
      { kind: 'approval.resolved' as const, action: rawControlApprovalAction({ state: 'approved', status: 'resolved', can_approve: true, resolved_at_unix_ms: 3900 }) },
      { kind: 'approval.resolved' as const, action: rawControlApprovalAction({ state: 'approved', status: 'resolved', can_approve: false }) },
      { kind: 'approval.resolved' as const, action: rawControlApprovalAction({ state: 'approved', status: 'resolved', can_approve: false, resolved_at_unix_ms: 3900, queue_generation: 1 }) },
    ];
    for (const item of malformed) {
      expect(() => mapFlowerLiveEvents({
        events: [{
          schema_version: 1,
          seq: 1,
          endpoint_id: 'runtime',
          thread_id: 'th-live',
          run_id: 'run-control',
          at_unix_ms: 4000,
          kind: item.kind,
          payload: { action: item.action },
        }],
        next_cursor: 1,
        retained_from_seq: 1,
      })).toThrow(/control confirmation/);
    }
  });

  it('requires canonical bootstrap approvals to match one complete approval queue', () => {
    const base = rawBootstrapWithTimelineDecoration({
      decoration_id: 'context-compaction:canonical-approval',
      kind: 'context_compaction',
      anchor: { target_kind: 'message', message_id: 'msg-user', edge: 'after' },
      ordinal: 0,
      compaction: {
        operation_id: 'canonical-approval',
        phase: 'complete',
        status: 'compacted',
        updated_at_ms: 2000,
      },
    });
    const liveState = {
      thread_patch: {},
      runs: {},
      approval_actions: { 'canonical-1': rawCanonicalApprovalAction() },
      approval_queue: {
        generation: 3,
        revision: 4,
        current_action_id: 'canonical-1',
        current_position: 1,
        total: 1,
        unresolved_count: 1,
      },
      input_requests: {},
    };

    const mapped = mapFlowerLiveBootstrap({ ...base, live_state: liveState }, mapperOptions());
    expect(mapped.live_state.approval_actions?.['canonical-1']).toMatchObject({
      origin: 'main_tool',
      queue_generation: 3,
      queue_order: 1,
    });
    expect(() => mapFlowerLiveBootstrap({
      ...base,
      live_state: { ...liveState, approval_queue: undefined },
    }, mapperOptions())).toThrow(/canonical approval queue/);
  });

  it.each(['approval.requested', 'approval.resolved'] as const)(
    'rejects %s events with missing or unknown approval origin',
    (kind) => {
      for (const origin of [undefined, 'unknown']) {
        expect(() => mapFlowerLiveEvents({
          events: [{
            schema_version: 1,
            seq: 1,
            endpoint_id: 'runtime',
            thread_id: 'th-live',
            run_id: 'run-control',
            at_unix_ms: 4000,
            kind,
            payload: {
              action: rawControlApprovalAction({
                origin,
                ...(kind === 'approval.resolved'
                  ? { state: 'approved', status: 'resolved', can_approve: false, resolved_at_unix_ms: 3900 }
                  : {}),
              }),
            },
          }],
          next_cursor: 1,
          retained_from_seq: 1,
        })).toThrow(/approval/);
      }
    },
  );

  it('returns a waiting thread to running when the canonical queue becomes empty', () => {
    const initial = thread({
      status: 'waiting_approval',
      approval_actions: [approvalAction()],
      approval_queue: { generation: 1, revision: 1, current_action_id: 'appr-1', current_position: 1, total: 1, unresolved_count: 1 },
    });
    const applied = applyFlowerLiveEvent(initial, 0, event(1, 'approval.queue_replaced', {
      actions: [],
      approval_queue: { generation: 1, revision: 2, current_position: 0, total: 0, unresolved_count: 0 },
    }));

    expect(applied.thread.approval_actions).toEqual([]);
    expect(applied.thread.status).toBe('running');
  });

  it('applies normalized reasoning fields from thread patches', () => {
    const initial = thread({
      reasoning_selection: { level: 'medium' },
    });

    const mapped = mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        run_id: 'run-1',
        at_unix_ms: 4000,
        kind: 'thread.patched',
        payload: {
          patch: {
            reasoning_selection: { level: 'high' },
            reasoning_capability: {
              kind: 'effort',
              supported_levels: ['low', 'medium', 'high'],
              default_level: 'medium',
              wire_shape: 'openai_responses_reasoning_effort',
              source_urls: ['https://developers.openai.com/api/docs/guides/reasoning'],
              source_checked_at: '2026-06-23',
              fixture: 'openai_responses_reasoning_effort',
            },
          },
        },
      }],
      next_cursor: 1,
      retained_from_seq: 1,
    });
    const result = applyFlowerLiveEvent(initial, 0, mapped.events[0]);

    expect(result.thread.reasoning_selection).toEqual({ level: 'high' });
    expect(result.thread.reasoning_capability?.supported_levels).toEqual(['low', 'medium', 'high']);
  });

  it('clears reasoning fields from live thread patches', () => {
    const initial = thread({
      reasoning_selection: { level: 'medium' },
      reasoning_capability: {
        kind: 'effort',
        supported_levels: ['low', 'medium', 'high'],
        default_level: 'medium',
        wire_shape: 'openai_responses_reasoning_effort',
      },
    });

    const mapped = mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        run_id: 'run-1',
        at_unix_ms: 4000,
        kind: 'thread.patched',
        payload: {
          patch: {
            model_id: 'custom/plain-model',
            reasoning_selection: null,
            reasoning_capability: null,
          },
        },
      }],
      next_cursor: 1,
      retained_from_seq: 1,
    });
    const result = applyFlowerLiveEvent(initial, 0, mapped.events[0]);

    expect(result.thread.model_id).toBe('custom/plain-model');
    expect(result.thread.reasoning_selection).toBeUndefined();
    expect(result.thread.reasoning_capability).toBeUndefined();
  });

  it('rejects unsupported inbound reasoning levels instead of falling back', () => {
    for (const level of ['turbo', 'none']) {
      expect(() => mapFlowerLiveEvents({
        events: [{
          schema_version: 1,
          seq: 1,
          endpoint_id: 'runtime',
          thread_id: 'th-live',
          run_id: 'run-1',
          at_unix_ms: 4000,
          kind: 'thread.patched',
          payload: {
            patch: {
              reasoning_selection: { level },
            },
          },
        }],
        next_cursor: 1,
        retained_from_seq: 1,
      })).toThrow(/reasoning level is unsupported/);
    }
  });

  it('maps ordered canonical user references in bootstrap and ignores admitted context actions', () => {
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
        title_status: 'ready',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'idle',
      },
      timeline_messages: [{
        id: 'msg-context',
        thread_id: 'th-live',
        turn_id: 'turn-context',
        run_id: 'run-context',
        role: 'user',
        timestamp: 1000,
        status: 'complete',
        blocks: [{ type: 'text', content: 'Inspect this env' }],
        context_action: contextAction,
        references: [
          { reference_id: 'ref-text', kind: 'text', label: 'Quoted selection', text: '选中的内容', truncated: true },
          { reference_id: 'ref-file', kind: 'file', label: 'index.ts' },
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

    expect(mapped.timeline_messages[0]?.references).toEqual([
      { reference_id: 'ref-text', kind: 'text', label: 'Quoted selection', text: '选中的内容', truncated: true },
      { reference_id: 'ref-file', kind: 'file', label: 'index.ts' },
    ]);
    expect(mapped.thread.messages[0]?.references).toEqual(mapped.timeline_messages[0]?.references);
    expect(mapped.timeline_messages[0]).not.toHaveProperty('context_action');
    expect(mapped.thread.messages[0]).not.toHaveProperty('context_action');
  });

  it('projects canonical title status without using the message preview as a title fallback', () => {
    const mapped = mapFlowerLiveBootstrap({
      schema_version: 1,
      endpoint_id: 'runtime',
      thread_id: 'th-title',
      cursor: 1,
      retained_from_seq: 1,
      thread: {
        thread_id: 'th-title',
        title: '',
        title_status: 'failed',
        last_message_preview: 'user message must remain a preview',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'idle',
      },
      timeline_messages: [],
      live_state: { thread_patch: {}, runs: {}, approval_actions: {}, input_requests: {} },
      read_status: readStatus(),
      generated_at_ms: 3000,
    }, {
      runtimeID: 'runtime',
      runtimeKind: 'env_local',
      sourceLabel: 'Local',
      targetLabels: [],
    });
    expect(mapped.thread.title).toBe('');
    expect(mapped.thread.title_status).toBe('failed');

    const patched = applyFlowerLiveEvent(mapped.thread, 1, {
      schema_version: 1,
      seq: 2,
      endpoint_id: 'runtime',
      thread_id: 'th-title',
      at_unix_ms: 4000,
      kind: 'thread.patched',
      payload: { patch: { title: '', title_status: 'pending' } },
    });
    expect(patched.thread.title).toBe('');
    expect(patched.thread.title_status).toBe('pending');
  });

  it.each([undefined, '', 'unknown'])('rejects missing or invalid canonical title status %s', (titleStatus) => {
    expect(() => mapFlowerLiveBootstrap({
      schema_version: 1,
      endpoint_id: 'runtime',
      thread_id: 'th-title-contract',
      cursor: 1,
      retained_from_seq: 1,
      thread: {
        thread_id: 'th-title-contract',
        title: '',
        ...(titleStatus !== undefined ? { title_status: titleStatus } : {}),
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'idle',
      },
      timeline_messages: [],
      live_state: { thread_patch: {}, runs: {}, approval_actions: {}, input_requests: {} },
      read_status: readStatus(),
      generated_at_ms: 3000,
    }, {
      runtimeID: 'runtime',
      runtimeKind: 'env_local',
      sourceLabel: 'Local',
      targetLabels: [],
    })).toThrow(/title_status/);
  });

  it('maps canonical references from live timeline replacement', () => {
    const mapped = mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 2,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        run_id: 'run-1',
        turn_id: 'turn-user',
        at_unix_ms: 4000,
        kind: 'timeline.replaced',
        payload: {
          messages: [{
            id: 'msg-reference-only',
            thread_id: 'th-live',
            turn_id: 'turn-user',
            run_id: 'run-1',
            role: 'user',
            timestamp: 1000,
            status: 'complete',
            blocks: [],
            references: [
              { reference_id: 'ref-terminal', kind: 'terminal', label: 'Terminal output', text: 'PASS' },
              { reference_id: 'ref-process', kind: 'process', label: 'node (4242)' },
            ],
          }],
          stream_generation: 1,
          snapshot_through_seq: 2,
        },
      }],
      next_cursor: 2,
      retained_from_seq: 1,
    });

    expect(mapped.events[0]?.kind).toBe('timeline.replaced');
    if (mapped.events[0]?.kind !== 'timeline.replaced') throw new Error('expected timeline replacement');
    expect(mapped.events[0].payload.messages[0]?.references?.map((reference) => reference.reference_id)).toEqual([
      'ref-terminal',
      'ref-process',
    ]);
  });

  it('ignores legacy Redeven thread ownership shadow fields', () => {
    const mapped = mapFlowerLiveBootstrap(bootstrap({
      thread: {
        ...thread(),
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        owner_kind: 'product_detail',
        owner_id: 'redeven',
        parent_thread_id: 'parent-thread',
        read_only_reason: 'Localized read-only copy.',
      } as unknown as FlowerThreadSnapshot,
    }), {
      runtimeID: 'local',
      runtimeKind: 'local_environment',
      sourceLabel: 'This host',
      targetLabels: [],
    });

    expect(mapped.thread).not.toHaveProperty('owner_kind');
    expect(mapped.thread).not.toHaveProperty('owner_id');
    expect(mapped.thread).not.toHaveProperty('parent_thread_id');

    const patched = applyFlowerLiveEvent(mapped.thread, mapped.cursor, event(2, 'thread.patched', {
      patch: {
        owner_kind: 'product_detail',
        owner_id: 'redeven',
        parent_thread_id: 'parent-thread-2',
        read_only_reason: 'Updated localized copy.',
      } as unknown as FlowerLiveThreadPatch,
    }));

    expect(patched.thread).not.toHaveProperty('owner_kind');
    expect(patched.thread).not.toHaveProperty('owner_id');
    expect(patched.thread).not.toHaveProperty('parent_thread_id');
    expect(patched.thread.read_only_reason).toBe('Updated localized copy.');
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
            origin: 'main_tool',
            run_id: 'run-1',
            tool_id: 'tool-1',
            tool_name: 'terminal.exec',
            state: 'requested',
            status: 'pending',
            revision: 1,
            version: 1,
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
          turn_id: 'turn-live',
          role: 'user',
          content: 'Hello',
          status: 'complete',
          created_at_ms: 1000,
          blocks: [{ type: 'text', content: 'Hello' }],
        },
        {
          id: 'assistant-live',
          thread_id: 'th-live',
          turn_id: 'turn-live',
          run_id: 'run-1',
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

  it('keeps existing approval actions when bootstrap live state has not sampled approvals', () => {
    const approval = approvalAction();
    const approvalQueue = { generation: 1, revision: 1, current_action_id: 'appr-1', current_position: 1, total: 1, unresolved_count: 1 };
    const projected = projectFlowerLiveBootstrap(bootstrap({
      thread: thread({
        status: 'waiting_approval',
        approval_actions: [approval],
        approval_queue: approvalQueue,
      }),
      live_state: {
        thread_patch: { run_status: 'running' },
        runs: {
          'run-1': { run_id: 'run-1', status: 'running', message_id: 'assistant-live' },
        },
        input_requests: {},
      },
    }));

    expect(projected.status).toBe('waiting_approval');
    expect(projected.approval_actions?.map((action) => action.action_id)).toEqual(['appr-1']);
    expect(projected.approval_queue).toEqual(approvalQueue);
    expect(projected.active_run_id).toBe('run-1');
  });

  it('maps missing live approval actions as unsampled rather than an authoritative empty map', () => {
    const mapped = mapFlowerLiveBootstrap({
      schema_version: 1,
      endpoint_id: 'runtime',
      thread_id: 'th-live',
      cursor: 5,
      retained_from_seq: 1,
      thread: {
        thread_id: 'th-live',
        title: 'Live thread',
        title_status: 'ready',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'running',
      },
      timeline_messages: [],
      live_state: {
        thread_patch: { run_status: 'running' },
        runs: {},
        input_requests: {},
      },
      read_status: readStatus(),
      generated_at_ms: 3000,
    }, mapperOptions());

    expect(mapped.live_state.approval_actions).toBeUndefined();
  });

  it('clears approval actions only when live state explicitly provides an empty approval map', () => {
    const projected = projectFlowerLiveBootstrap(bootstrap({
      thread: thread({
        status: 'waiting_approval',
        approval_actions: [approvalAction()],
      }),
      live_state: {
        thread_patch: { run_status: 'running' },
        runs: {
          'run-1': { run_id: 'run-1', status: 'running', message_id: 'assistant-live' },
        },
        approval_actions: {},
        input_requests: {},
      },
    }));

    expect(projected.status).toBe('running');
    expect(projected.approval_actions).toEqual([]);
    expect(projected.active_run_id).toBe('run-1');
  });

  it('clears existing approval actions when live state explicitly clears the queue', () => {
    const projected = projectFlowerLiveBootstrap(bootstrap({
      thread: thread({
        status: 'waiting_approval',
        approval_actions: [approvalAction()],
        approval_queue: { generation: 1, revision: 1, current_action_id: 'appr-1', current_position: 1, total: 1, unresolved_count: 1 },
      }),
      live_state: {
        thread_patch: { run_status: 'running' },
        runs: {
          'run-1': { run_id: 'run-1', status: 'running', message_id: 'assistant-live' },
        },
        approval_queue: null,
        input_requests: {},
      },
    }));

    expect(projected.status).toBe('running');
    expect(projected.approval_actions).toEqual([]);
    expect(projected.approval_queue).toBeNull();
    expect(projected.active_run_id).toBe('run-1');
  });

  it('keeps pending approval ahead of an active run when deriving bootstrap status', () => {
    const projected = projectFlowerLiveBootstrap(bootstrap({
      live_state: {
        thread_patch: { run_status: 'running' },
        runs: {
          'run-1': { run_id: 'run-1', status: 'running', message_id: 'assistant-live' },
        },
        approval_actions: {
          'appr-1': approvalAction(),
        },
        input_requests: {},
      },
    }));

    expect(projected.status).toBe('waiting_approval');
    expect(projected.active_run_id).toBe('run-1');
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
        title_status: 'ready',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'running',
      },
      timeline_messages: [
        {
          id: 'msg-user',
          thread_id: 'th-live',
          turn_id: 'turn-whitespace',
          run_id: 'run-1',
          role: 'user',
          timestamp: 1000,
          status: 'complete',
          blocks: [{ type: 'markdown', content: 'Hello' }],
        },
        {
          id: 'assistant-live',
          thread_id: 'th-live',
          turn_id: 'turn-1',
          run_id: 'run-1',
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
          thread_id: 'th-live',
          turn_id: 'turn-1',
          run_id: 'run-1',
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

  it('creates an assistant streaming row from message.started before block events', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const projected = applyEvents(initial, 0, [
      event(1, 'message.started', {
        message_id: 'assistant-started',
        role: 'assistant',
        status: 'streaming',
        created_at_ms: 2100,
      }),
      event(2, 'message.block_started', {
        message_id: 'assistant-started',
        block_index: 0,
        block_type: 'markdown',
      }),
      event(3, 'message.block_delta', {
        message_id: 'assistant-started',
        block_index: 0,
        delta: 'hello from live',
      }),
    ]);

    expect(projected.cursor).toBe(3);
    expect(projected.thread.messages.map((item) => item.id)).toEqual(['msg-user', 'assistant-started']);
    expect(projected.thread.messages[1]).toMatchObject({
      turn_id: 'turn-1',
      role: 'assistant',
      status: 'streaming',
      content: 'hello from live',
      active_cursor: true,
    });
  });

  it('requires message.started to carry the owning TurnID before creating a row', () => {
    const initial = projectFlowerLiveBootstrap(bootstrap());
    const messageStarted = event(1, 'message.started', {
      message_id: 'assistant-without-turn',
      role: 'assistant',
      status: 'streaming',
      created_at_ms: 2100,
    });
    const result = applyFlowerLiveEvent(initial, 0, { ...messageStarted, turn_id: undefined });

    expect(result.resyncRequired).toBe(true);
    expect(result.thread.messages.find((message) => message.id === 'assistant-without-turn')).toBeUndefined();
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
      stream_generation: 1,
      snapshot_through_seq: 6,
      messages: [
		message({ id: 'z-user-1', content: 'First request', created_at_ms: 9000, blocks: [{ type: 'markdown', content: 'First request' }] }),
        {
		  id: 'y-assistant-1',
          role: 'assistant',
          content: 'Canceled partial output',
          status: 'canceled',
		  created_at_ms: 7000,
          blocks: [{ type: 'markdown', content: 'Canceled partial output' }],
        },
		message({ id: 'b-user-2', content: 'Second request', created_at_ms: 3000, blocks: [{ type: 'markdown', content: 'Second request' }] }),
        {
		  id: 'a-assistant-2',
          role: 'assistant',
          content: '',
          status: 'streaming',
		  created_at_ms: 1000,
          blocks: [{ type: 'markdown', content: '' }],
          active_cursor: true,
        },
      ],
    }));

    expect(result.resyncRequired).toBe(false);
    expect(result.cursor).toBe(6);
	  expect(result.thread.messages.map((item) => item.id)).toEqual(['z-user-1', 'y-assistant-1', 'b-user-2', 'a-assistant-2']);
    expect(result.thread.messages[1]).toMatchObject({ role: 'assistant', status: 'canceled' });
    expect(result.thread.messages[1]?.active_cursor).toBeUndefined();
    expect(result.thread.messages[3]).toMatchObject({ role: 'assistant', status: 'streaming', active_cursor: true });
  });

  it('replaces a stale running terminal row with canonical terminal success', () => {
    const runningBlock: FlowerActivityTimelineBlock = {
      type: 'activity-timeline',
      schema_version: 1,
      summary: {
        status: 'running',
        severity: 'normal',
        needs_attention: false,
        total_items: 1,
        counts: { running: 1 },
      },
      items: [{
        item_id: 'tool:exec-1',
        tool_id: 'exec-1',
        tool_name: 'terminal.exec',
        kind: 'tool',
        status: 'running',
        severity: 'normal',
        needs_attention: false,
        requires_approval: false,
        label: 'sleep 5',
        renderer: 'terminal',
        payload: { command: 'sleep 5' },
      }],
    };
    const successBlock: FlowerActivityTimelineBlock = {
      ...runningBlock,
      summary: {
        status: 'success',
        severity: 'normal',
        needs_attention: false,
        total_items: 1,
        counts: { success: 1 },
      },
      items: [{
        ...runningBlock.items[0],
        status: 'success',
        ended_at_unix_ms: 5000,
        payload: { command: 'sleep 5', output: 'done', exit_code: 0 },
      }],
    };
    const initial = thread({
      status: 'running',
      active_run_id: 'run-1',
      model_io_status: {
        phase: 'streaming',
        run_id: 'run-1',
        updated_at_ms: 4200,
      },
      messages: [message(), {
        id: 'turn-1',
        role: 'assistant',
        content: '',
        status: 'streaming',
        created_at_ms: 2000,
        active_cursor: true,
        blocks: [runningBlock],
      }],
    });

    const result = applyFlowerLiveEvent(initial, 10, event(11, 'timeline.replaced', {
      stream_generation: 1,
      snapshot_through_seq: 11,
      messages: [message(), {
        id: 'turn-1',
        role: 'assistant',
        content: '',
        status: 'complete',
        created_at_ms: 2000,
        blocks: [successBlock],
      }],
      thread_patch: {
        run_status: 'success',
      },
      live_state: {
        thread_patch: {
          run_status: 'success',
        },
        runs: {},
        approval_actions: {},
        input_requests: {},
      },
    }));

    const activityBlock = result.thread.messages[1]?.blocks?.[0] as FlowerActivityTimelineBlock | undefined;
    expect(result.resyncRequired).toBe(false);
    expect(result.thread.status).toBe('success');
    expect(result.thread.active_run_id).toBeUndefined();
    expect(result.thread.model_io_status).toBeNull();
    expect(activityBlock?.items[0]?.status).toBe('success');
    expect(activityBlock?.summary.counts?.running).toBeUndefined();
  });

  it('replaces stale live state when canonical timeline includes materialized state', () => {
    const initial = thread({
      context_compactions: [{
        operation_id: 'compact-stale',
        phase: 'start',
        status: 'compacting',
        updated_at_ms: 4100,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-stale',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'msg-user',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-stale',
          phase: 'start',
          status: 'compacting',
          updated_at_ms: 4100,
        },
      }],
      context_usage: {
        phase: 'provider_usage',
        pressure_status: 'will_compact',
        run_id: 'run-old',
        input_tokens: 900,
        context_window_tokens: 1000,
        used_ratio: 0.9,
        updated_at_ms: 4100,
      },
      queued_turn_count: 1,
    });
    const mapped = mapFlowerLiveEvents({
      schema_version: 1,
      stream_generation: 1,
      next_cursor: 12,
      events: [{
        schema_version: 1,
        seq: 12,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        at_unix_ms: 5000,
        kind: 'timeline.replaced',
        payload: {
          stream_generation: 1,
          snapshot_through_seq: 12,
          messages: [message({ id: 'msg-user', content: 'Canonical', blocks: [{ type: 'markdown', content: 'Canonical' }] })],
          live_state: {
            thread_patch: {
              run_status: 'success',
              queued_turn_count: 0,
            },
            runs: {},
            approval_actions: {},
            input_requests: {},
            context_usage: null,
            context_compactions: [],
            timeline_decorations: [],
          },
          read_status: readStatus({
            snapshot: {
              activity_revision: 2,
              last_message_at_unix_ms: 5000,
              activity_signature: 'sig-2',
            },
          }),
        },
      }],
    });
    const result = applyFlowerLiveEvent(initial, 11, mapped.events[0]);

    expect(result.thread.messages.map((item) => item.id)).toEqual(['msg-user']);
    expect(result.thread.context_compactions).toEqual([]);
    expect(result.thread.timeline_decorations).toEqual([]);
    expect(result.thread.context_usage).toBeNull();
    expect(result.thread.status).toBe('success');
    expect(result.thread.queued_turn_count).toBe(0);
    expect(result.thread.read_status.snapshot.activity_signature).toBe('sig-2');
  });

  it('rejects unsupported persisted message blocks instead of partially rendering them', () => {
    expect(() => mapFlowerLiveBootstrap({
      schema_version: 1,
      endpoint_id: 'runtime',
      thread_id: 'th-live',
      cursor: 1,
      retained_from_seq: 1,
      thread: {
        thread_id: 'th-live',
        title: 'Live thread',
        title_status: 'ready',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'running',
      },
      timeline_messages: [{
        id: 'assistant-unsupported',
        thread_id: 'th-live',
        turn_id: 'turn-unsupported',
        run_id: 'run-unsupported',
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
    })).toThrow(/timeline message assistant-unsupported block 1 is invalid/);
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
        title_status: 'ready',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'success',
      },
      timeline_messages: [{
        id: 'assistant-thinking',
        thread_id: 'th-live',
        turn_id: 'turn-thinking',
        run_id: 'run-thinking',
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

  it('maps thread subagents from bootstrap and thread patch events', () => {
    const mapped = mapFlowerLiveBootstrap({
      schema_version: 1,
      endpoint_id: 'runtime',
      thread_id: 'th-live',
      stream_generation: 1,
      cursor: 0,
      retained_from_seq: 1,
      thread: {
        thread_id: 'th-live',
        title: 'Live thread',
        title_status: 'ready',
        model_id: 'openai/gpt-5.2',
        working_dir: '/workspace',
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        run_status: 'idle',
        subagents: [{
          parent_thread_id: 'th-live',
          thread_id: 'child-1',
          task_name: 'Review API',
          task_description: 'Review the public API boundary.',
          agent_type: 'reviewer',
          status: 'completed',
          can_send_input: false,
          can_interrupt: false,
          can_close: false,
          created_at_ms: 1100,
          updated_at_ms: 1200,
        }],
        read_status: readStatus(),
      },
      timeline_messages: [],
      live_state: {
        thread_patch: {},
        runs: {},
        approval_actions: {},
        input_requests: {},
      },
      read_status: readStatus(),
      generated_at_ms: 1000,
    }, mapperOptions());

    const projected = projectFlowerLiveBootstrap(mapped);
    expect(projected.subagents).toEqual([
      expect.objectContaining({
        parent_thread_id: 'th-live',
        thread_id: 'child-1',
        task_name: 'Review API',
        status: 'completed',
      }),
    ]);

    const patch = mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        at_unix_ms: 3000,
        kind: 'thread.patched',
        payload: {
          patch: {
            thread_id: 'th-live',
            subagents: [{
              parent_thread_id: 'th-live',
              thread_id: 'child-2',
              task_name: 'Check tests',
              task_description: 'Run focused tests.',
              status: 'running',
              can_send_input: true,
              can_interrupt: true,
              can_close: true,
              created_at_ms: 2100,
              updated_at_ms: 2200,
        }],
      },
      timeline_messages: [],
        },
      }],
      next_cursor: 1,
      retained_from_seq: 1,
    });
    const result = applyFlowerLiveEvent(projected, 0, patch.events[0]);
    expect(result.thread.subagents).toEqual([
      expect.objectContaining({
        parent_thread_id: 'th-live',
        thread_id: 'child-2',
        task_name: 'Check tests',
        status: 'running',
      }),
    ]);
  });

  it('rejects unsupported activity item statuses instead of falling back', () => {
    expect(() => mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        turn_id: 'turn-1',
        run_id: 'run-1',
        at_unix_ms: 3000,
        kind: 'message.block_set',
        payload: {
          message_id: 'assistant-live',
          block_index: 0,
          block: {
            type: 'activity-timeline',
            schema_version: 1,
            thread_id: 'th-live',
            turn_id: 'turn-1',
            run_id: 'run-1',
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

  it('rejects terminal activity pending lifecycle payload fields', () => {
    expect(() => mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        turn_id: 'turn-1',
        run_id: 'run-1',
        at_unix_ms: 3000,
        kind: 'message.block_set',
        payload: {
          message_id: 'assistant-live',
          block_index: 0,
          block: {
            type: 'activity-timeline',
            schema_version: 1,
            thread_id: 'th-live',
            turn_id: 'turn-1',
            run_id: 'run-1',
            summary: { status: 'running', severity: 'normal', needs_attention: true, total_items: 1, counts: { running: 1 } },
            items: [{
              item_id: 'tool-1',
              tool_id: 'tool-1',
              tool_name: 'terminal.exec',
              kind: 'tool',
              status: 'running',
              severity: 'normal',
              needs_attention: true,
              requires_approval: false,
              renderer: 'terminal',
              payload: {
                command: 'sleep 10',
                process_id: 'tp_123',
                pending_handle: 'tp_123',
              },
            }],
          },
        },
      }],
      next_cursor: 1,
      retained_from_seq: 1,
    })).toThrow(/activity_item\.payload\.pending_handle/);
  });

  it('rejects missing activity summary status instead of falling back', () => {
    expect(() => mapFlowerLiveEvents({
      events: [{
        schema_version: 1,
        seq: 1,
        endpoint_id: 'runtime',
        thread_id: 'th-live',
        turn_id: 'turn-1',
        run_id: 'run-1',
        at_unix_ms: 3000,
        kind: 'message.block_set',
        payload: {
          message_id: 'assistant-live',
          block_index: 0,
          block: {
            type: 'activity-timeline',
            schema_version: 1,
            thread_id: 'th-live',
            turn_id: 'turn-1',
            run_id: 'run-1',
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
