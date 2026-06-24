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

function mapperOptions() {
  return {
    runtimeID: 'runtime',
    runtimeKind: 'local_environment' as const,
    sourceLabel: 'This host',
    targetLabels: [],
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

  it('maps and applies live context usage and compaction events', () => {
    const initial = thread({
      status: 'running',
      active_run_id: 'run-1',
      messages: [
        message(),
        {
          id: 'assistant-live',
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

  it('keeps compaction dividers anchored to the event timeline decoration', () => {
    const initial = thread({
      messages: [
        message(),
        {
          id: 'assistant-live',
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
    expect(compacted.thread.timeline_decorations?.[0]?.compaction.status).toBe('compacted');

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

	it('hides bootstrap model io status for waiting and terminal threads', () => {
		for (const status of ['waiting_user', 'waiting_approval', 'success', 'failed', 'canceled'] as const) {
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
        run_id: 'run-1',
        tool_id: 'tool-1',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
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

  it('maps structured thread ownership metadata from bootstrap and live patches', () => {
    const mapped = mapFlowerLiveBootstrap(bootstrap({
      thread: {
        ...thread(),
        created_at_unix_ms: 1000,
        updated_at_unix_ms: 1000,
        owner_kind: 'subagent_projection',
        owner_id: 'floret',
        parent_thread_id: 'parent-thread',
        read_only_reason: 'Localized read-only copy.',
      } as unknown as FlowerThreadSnapshot,
    }), {
      runtimeID: 'local',
      runtimeKind: 'local_environment',
      sourceLabel: 'This host',
      targetLabels: [],
    });

    expect(mapped.thread.owner_kind).toBe('subagent_projection');
    expect(mapped.thread.owner_id).toBe('floret');
    expect(mapped.thread.parent_thread_id).toBe('parent-thread');

    const patched = applyFlowerLiveEvent(mapped.thread, mapped.cursor, event(2, 'thread.patched', {
      patch: {
        owner_kind: 'subagent_projection',
        owner_id: 'floret',
        parent_thread_id: 'parent-thread-2',
        read_only_reason: 'Updated localized copy.',
      },
    }));

    expect(patched.thread.owner_kind).toBe('subagent_projection');
    expect(patched.thread.parent_thread_id).toBe('parent-thread-2');
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
