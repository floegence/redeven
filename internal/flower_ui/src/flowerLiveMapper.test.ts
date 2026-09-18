import { describe, expect, it } from 'vitest';

import {
  mapContextUsage,
  mapFlowerActivityItem,
  mapFlowerMessage,
  mapFlowerThread,
  mergeFlowerContextUsage,
} from './flowerLiveMapper';

describe('Flower context usage contract', () => {
  const confirmed = { phase: 'provider_usage', pressure_status: 'stable', input_tokens: 71872, context_window_tokens: 950000, updated_at_ms: 10 };
  const estimate = { ...confirmed, phase: 'projected_request', input_tokens: 82346, updated_at_ms: 11 };
  const thread_usage = { input_tokens: 50, output_tokens: 20, cache_read_tokens: 45, cache_write_tokens: 5 };

  it('maps the same confirmed and estimated samples for live and reconnect', () => {
    const wire = { confirmed, estimate, thread_usage };
    expect(mapContextUsage(wire)).toEqual(wire);
    expect(mapContextUsage(JSON.parse(JSON.stringify(wire)))).toEqual(mapContextUsage(wire));
  });
  it('retains canonical cache totals when a live usage update omits them', () => {
    const previous = mapContextUsage({ confirmed, thread_usage })!;
    const incoming = mapContextUsage({ confirmed, estimate })!;
    expect(mergeFlowerContextUsage(previous, incoming)).toEqual({ ...incoming, thread_usage });
  });
  it('clears obsolete samples on model changes and successful compaction', () => {
    const previous = mapContextUsage({ confirmed, estimate, thread_usage })!;
    expect(mergeFlowerContextUsage(previous, mapContextUsage({})!)).toEqual({ thread_usage });
    const next = mapContextUsage({ estimate })!;
    expect(mergeFlowerContextUsage(previous, next).confirmed).toBeUndefined();
  });
  it('updates totals from a final measurement and accepts the first snapshot', () => {
    const next = mapContextUsage({ confirmed, thread_usage })!;
    expect(mergeFlowerContextUsage(null, next)).toBe(next);
    expect(mergeFlowerContextUsage(mapContextUsage({ estimate }), next)).toBe(next);
  });
  it('rejects malformed canonical totals and obsolete mixed samples', () => {
    expect(() => mapContextUsage({ thread_usage: { ...thread_usage, cache_read_tokens: -1 } })).toThrow('context_usage.thread_usage.cache_read_tokens must be a non-negative integer');
    expect(() => mapContextUsage(confirmed)).toThrow('requires a measurement/estimate snapshot');
    expect(() => mapContextUsage({ confirmed: estimate })).toThrow('requires model usage');
    expect(() => mapContextUsage({ estimate: { ...estimate, phase: 'unknown' } })).toThrow('invalid phase');
    expect(() => mapContextUsage({ estimate: { ...estimate, pressure_status: 'unknown' } })).toThrow('invalid pressure status');
  });
});

describe('Flower input response message contract', () => {
  it('maps the structured question receipt and derives canonical visible text', () => {
    const message = mapFlowerMessage({
      id: 'interaction-answer',
      thread_id: 'thread-a',
      turn_id: 'turn-a',
      run_id: 'run-a',
      role: 'user',
      status: 'complete',
      timestamp: 10,
      blocks: [{
        type: 'input-response',
        questions: [
          { question_id: 'second', question: 'Second question?', answer: 'second answer' },
          { question_id: 'first', question: 'First question?', answer: 'first answer' },
        ],
      }],
    });

    expect(message.content).toBe('Second question?\nsecond answer\n\nFirst question?\nfirst answer');
    expect(message.blocks?.[0]).toMatchObject({
      type: 'input-response',
      questions: [
        { question_id: 'second', question: 'Second question?', answer: 'second answer' },
        { question_id: 'first', question: 'First question?', answer: 'first answer' },
      ],
    });
  });

  it('rejects invalid input response blocks instead of falling back to message content', () => {
    expect(() => mapFlowerMessage({
      id: 'interaction-answer',
      thread_id: 'thread-a',
      turn_id: 'turn-a',
      run_id: 'run-a',
      role: 'user',
      status: 'complete',
      timestamp: 10,
      content: 'legacy answer',
      blocks: [{ type: 'input-response', questions: [] }],
    })).toThrow('input-response block requires at least one question');
  });
});

describe('mapFlowerThread title contract', () => {
  it('rejects a running summary without canonical run progress', () => {
    expect(() => mapFlowerThread({
      thread_id: 'thread-running-without-progress',
      title: '',
      title_status: '', title_generation: 0,
      model_id: 'openai/gpt-5-mini',
      working_dir: '/',
      created_at_unix_ms: 1,
      updated_at_unix_ms: 1,
      run_status: 'running',
      active_run_id: 'run-a',
      queued_turn_count: 0,
    }, [], {
      runtimeID: 'runtime-test',
      runtimeKind: 'local_environment',
      sourceLabel: 'Local',
      targetLabels: [],
    })).toThrow('a running thread summary requires run_progress');
  });

  it('rejects a non-empty title without a canonical title status', () => {
    expect(() => mapFlowerThread({
      thread_id: 'thread-invalid-title',
      title: 'Canonical title',
      title_status: '', title_generation: 0,
      model_id: 'openai/gpt-5-mini',
      working_dir: '/',
      created_at_unix_ms: 1,
      updated_at_unix_ms: 1,
      run_status: 'idle',
      queued_turn_count: 0,
    }, [], {
      runtimeID: 'runtime-test',
      runtimeKind: 'local_environment',
      sourceLabel: 'Local',
      targetLabels: [],
    })).toThrow('title_status may be empty only when title is empty');
  });

  it('maps the product settings revision independently from runtime activity', () => {
    const mapped = mapFlowerThread({
      thread_id: 'thread-settings-revision',
      title: '',
      title_status: '', title_generation: 0,
      model_id: 'openai/gpt-5-mini',
      working_dir: '/',
      permission_type: 'full_access',
      settings_revision: 42,
      created_at_unix_ms: 1,
      updated_at_unix_ms: 9,
      run_status: 'running',
      active_run_id: 'run-settings-revision',
      run_progress: { run_id: 'run-settings-revision', turn_id: 'turn-settings-revision', phase: 'preparing' },
      queued_turn_count: 0,
      read_status: {
        is_unread: false,
        snapshot: {
          activity_revision: 9,
        },
        read_state: {
          last_seen_activity_revision: 9,
        },
      },
    }, [], {
      runtimeID: 'runtime-test',
      runtimeKind: 'local_environment',
      sourceLabel: 'Local',
      targetLabels: [],
    });

    expect(mapped.settings_revision).toBe(42);
    expect(mapped.permission_type).toBe('full_access');
  });
});

describe('mapFlowerActivityItem structured rows contract', () => {
  it('preserves literal long script inputs and explicit empty output across the wire', () => {
    const content = '  await ui.observe();\n' + '// comment\n'.repeat(1200);
    const payload = { inputs: [{ content, format: 'code', language: 'javascript', truncated: false }], rows_provided: true };
    const mapped = mapFlowerActivityItem(JSON.parse(JSON.stringify({ item_id: 'script', kind: 'tool', status: 'success', presentation: { renderer: 'structured', payload } })));
    expect(mapped?.payload).toEqual(payload);
    expect(() => mapFlowerActivityItem({ item_id: 'script', kind: 'tool', status: 'success', presentation: { renderer: 'structured', payload: { inputs: [{ content: 'a'.repeat(65537), format: 'code' }] } } })).toThrow('exceeds the structured activity limit');
    expect(() => mapFlowerActivityItem({ item_id: 'script', kind: 'tool', status: 'success', presentation: { renderer: 'structured', payload: { rows_provided: 'true' } } })).toThrow('must be a boolean');
  });

  const activity = (rows: unknown) => ({
    item_id: 'activity-okf',
    kind: 'tool',
    status: 'success',
    severity: 'quiet',
    presentation: {
      label: 'OKF search',
      renderer: 'structured',
      payload: { rows },
    },
  });

  it('maps typed rows without exposing another payload shape', () => {
    expect(mapFlowerActivityItem(activity([{
      title: 'Flower runtime',
      meta: 'Architecture',
      content: 'One current view.',
      format: 'markdown',
    }]))?.payload?.rows).toEqual([{
      title: 'Flower runtime',
      meta: 'Architecture',
      content: 'One current view.',
      format: 'markdown',
    }]);
  });

  it('rejects unknown row fields and unsupported formats', () => {
    expect(() => mapFlowerActivityItem(activity([{ title: 'Unsafe', format: 'text', internal_id: 'private' }])))
      .toThrow('internal_id is not part of the structured activity row contract');
    expect(() => mapFlowerActivityItem(activity([{ title: 'Unsafe', format: 'json' }])))
      .toThrow('format is unsupported');
  });

  it('rejects empty rows and an oversized row list', () => {
    expect(() => mapFlowerActivityItem(activity([{ format: 'text' }])))
      .toThrow('must contain display content');
    expect(() => mapFlowerActivityItem(activity(Array.from({ length: 201 }, () => ({ title: 'row', format: 'text' })))))
      .toThrow('exceeds 200 rows');
  });
});

describe('mapFlowerActivityItem retired renderer contract', () => {
  it('keeps a neutral readable item without unknown payload data', () => {
    const mapped = mapFlowerActivityItem({
      item_id: 'activity-retired',
      tool_name: 'retired_tool',
      kind: 'tool',
      status: 'success',
      severity: 'quiet',
      presentation: {
        label: 'Historical tool',
        renderer: 'retired_renderer',
        payload: { arguments: { token: 'must-not-render' }, result: { private: true } },
      },
    });

    expect(mapped).toMatchObject({
      item_id: 'activity-retired',
      tool_name: 'retired_tool',
      status: 'success',
      label: 'Historical tool',
    });
    expect(mapped?.renderer).toBeUndefined();
    expect(mapped?.payload).toBeUndefined();
    expect(JSON.stringify(mapped)).not.toContain('must-not-render');
  });
});

describe('mapFlowerActivityItem web fetch contract', () => {
  it('preserves the dedicated renderer and bounded preview', () => {
    const mapped = mapFlowerActivityItem({
      item_id: 'activity-web-fetch',
      tool_name: 'web_fetch',
      kind: 'tool',
      status: 'success',
      severity: 'quiet',
      presentation: {
        label: 'Fetch web page',
        renderer: 'web_fetch',
        payload: {
          url: 'https://example.test/start',
          final_url: 'https://example.test/final',
          status_code: 200,
          content_type: 'text/html',
          format: 'markdown',
          content_preview: '# Preview',
          preview_truncated: true,
          bytes_read: 512,
          truncated: false,
        },
      },
    });

    expect(mapped?.renderer).toBe('web_fetch');
    expect(mapped?.payload).toMatchObject({
      final_url: 'https://example.test/final',
      status_code: 200,
      content_preview: '# Preview',
      preview_truncated: true,
      bytes_read: 512,
    });
  });

  it.each([
    { name: 'unknown payload field', payload: { content: 'full body' }, message: 'is not part of the Web Fetch contract' },
    { name: 'deprecated page icon', payload: { site_icon: { content_type: 'image/png', data: 'iVBORw0KGgo=' } }, message: 'is not part of the Web Fetch contract' },
    { name: 'oversized preview', payload: { content_preview: '界'.repeat(2_001) }, message: 'exceeds 2000 characters' },
    { name: 'invalid preview flag', payload: { preview_truncated: 'true' }, message: 'must be a boolean' },
  ])('rejects $name', ({ payload, message }) => {
    expect(() => mapFlowerActivityItem({
      item_id: 'activity-web-fetch-invalid',
      tool_name: 'web_fetch',
      kind: 'tool',
      status: 'success',
      severity: 'quiet',
      presentation: { renderer: 'web_fetch', payload },
    })).toThrow(message);
  });
});

describe('mapFlowerActivityItem Subagent operation contract', () => {
  const activity = (payload: unknown) => ({
    item_id: 'activity-subagents-wait',
    tool_name: 'subagents',
    kind: 'tool',
    status: 'running',
    severity: 'normal',
    presentation: {
      label: 'wait',
      renderer: 'subagent_operation',
      payload,
    },
  });

  it('preserves the exact action, ordered targets, and outcome counts', () => {
    const mapped = mapFlowerActivityItem(activity({
      action: 'wait',
      status: 'running',
      targets: [
        { thread_id: 'thread-one', task_name: 'One', status: 'completed' },
        { thread_id: 'thread-two', task_name: 'Two', status: 'running' },
      ],
      requested_count: 2,
      completed_count: 1,
      missing_count: 0,
      timed_out: false,
    }));

    expect(mapped?.renderer).toBe('subagent_operation');
    expect(mapped?.payload).toEqual({
      action: 'wait',
      status: 'running',
      targets: [
        { thread_id: 'thread-one', task_name: 'One', status: 'completed' },
        { thread_id: 'thread-two', task_name: 'Two', status: 'running' },
      ],
      requested_count: 2,
      completed_count: 1,
      missing_count: 0,
      timed_out: false,
    });
  });

  it('rejects unknown actions, duplicate targets, and legacy payload fields', () => {
    expect(() => mapFlowerActivityItem(activity({ action: 'unknown' }))).toThrow('action is unsupported');
    expect(() => mapFlowerActivityItem(activity({
      action: 'wait',
      targets: [{ thread_id: 'thread-one' }, { thread_id: 'thread-one' }],
    }))).toThrow('thread_id is duplicated');
    expect(() => mapFlowerActivityItem(activity({ action: 'wait', items: [] }))).toThrow('items is not part of the Subagent operation contract');
  });
});
