import { describe, expect, it } from 'vitest';

import {
  mapContextUsage,
  mapModelContext,
  mapFlowerActivityItem,
  mapFlowerMessage,
  mapFlowerThread,
  mergeFlowerContextUsage,
} from './flowerLiveMapper';
import { messageBlockSignature } from './flowerTimelineProjection';

describe('Canonical assistant citations in historical pages', () => {
  it('preserves block text, locations and metadata changes without a host source store', () => {
    const text = ' 你好😀 \uE200cite\uE202turn1view5\uE201 ';
    const source = { title: 'Reference', url: 'https://example.com/docs', start_index: 5, end_index: [...text].length - 1 };
    const wire = { id: 'answer', thread_id: 'thread-a', turn_id: 'turn-a', run_id: 'run-a', role: 'assistant', status: 'complete', timestamp: 10, blocks: [{ type: 'markdown', content: text, sources: [source] }] };
    const message = mapFlowerMessage(JSON.parse(JSON.stringify(wire)));
    expect(message.blocks?.[0]).toEqual(wire.blocks[0]);
    const renamed = mapFlowerMessage({ ...wire, blocks: [{ ...wire.blocks[0], sources: [{ ...source, title: 'Updated title' }] }] });
    expect(messageBlockSignature(message.blocks![0])).not.toBe(messageBlockSignature(renamed.blocks![0]));
    expect(mapFlowerMessage({ ...wire, blocks: undefined, content: text, sources: [source] })).toMatchObject({ content: text, sources: [source] });
  });
});

describe('Canonical thread reference identity', () => {
  const message = { id: 'user-ref', thread_id: 'thread-target', turn_id: 'turn-target', run_id: 'run-target', role: 'user', status: 'complete', timestamp: 10 };
  const reference = { reference_id: 'thread-ref', kind: 'thread', referenced_thread_id: 'thread-source', label: 'Source', text: '{"frozen":"snapshot"}' };
  it('preserves the explicit target and frozen snapshot', () => {
    expect(mapFlowerMessage({ ...message, references: [reference] }).references).toEqual([reference]);
  });
  it.each([
    { ...reference, referenced_thread_id: undefined }, { ...reference, referenced_thread_id: '../forged' },
    { ...reference, kind: 'text' }, { ...reference, text: '' }, { ...reference, resource_ref: 'private-authority' },
  ])('rejects malformed or parallel reference authority %j', value => {
    expect(() => mapFlowerMessage({ ...message, references: [value] })).toThrow('Flower contract error');
  });
});

describe('Flower context usage contract', () => {
  const confirmed = { phase: 'provider_usage', pressure_status: 'stable', input_tokens: 71872, context_window_tokens: 950000, updated_at_ms: 10 };
  const estimate = { ...confirmed, phase: 'projected_request', input_tokens: 82346, updated_at_ms: 11 };
  const thread_usage = { input_tokens: 50, output_tokens: 20, cache_read_tokens: 45, cache_write_tokens: 5 };

  it.each([
    { source: 'rendered_content_v3', tokenizer: 'deepseek_v4', quality: 'token_estimate', framing_tokens: 40 },
    { source: 'rendered_content_v3', quality: 'relative_weight', attachment_tokens: 4096 },
    { source: 'semantic_input_bpe_v1', user_tokens: 100 },
  ])('preserves distribution quality on live and restored snapshots %j', breakdown => {
    const wire = { confirmed: { ...confirmed, breakdown } };
    expect(mapContextUsage(wire)?.confirmed?.breakdown).toEqual(breakdown);
    expect(mapContextUsage(JSON.parse(JSON.stringify(wire)))).toEqual(mapContextUsage(wire));
  });

  it.each([
    { quality: 'precise', tokenizer: 'deepseek_v4' },
    { quality: 'token_estimate' },
    { quality: 'token_estimate', tokenizer: '' },
    { quality: 'token_estimate', tokenizer: 'deepseek_v4', attachment_tokens: 1 },
    { quality: 'relative_weight', tokenizer: 7 },
  ])('rejects unsupported distribution claims %j', metadata => {
    expect(() => mapContextUsage({ confirmed: { ...confirmed, breakdown: { source: 'rendered_content_v3', ...metadata } } })).toThrow();
  });

  it('maps the same confirmed and estimated samples for live and reconnect', () => {
    const wire = { confirmed, estimate, thread_usage, recent_request_usage: {input_tokens: 30, output_tokens: 5, cache_read_tokens: 60, cache_write_tokens: 10} };
    expect(mapContextUsage(wire)).toEqual(wire);
    expect(mapContextUsage(JSON.parse(JSON.stringify(wire)))).toEqual(mapContextUsage(wire));
  });
  it('retains canonical cache totals when a live usage update omits them', () => {
    const previous = mapContextUsage({ confirmed, thread_usage })!;
    const incoming = mapContextUsage({ confirmed, estimate })!;
    expect(mergeFlowerContextUsage(previous, incoming)).toEqual({ ...incoming, thread_usage });
  });
  it('clears obsolete samples on model changes and successful compaction', () => {
    const previous = mapContextUsage({ confirmed, estimate, thread_usage, recent_request_usage: thread_usage })!;
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


describe('Provider retry progress', () => {
  const mapperOptions = { runtimeID: 'runtime', runtimeKind: 'local_environment' as const, sourceLabel: 'Local', targetLabels: [] };
  it('preserves request observations, absolute retry deadlines and attempt replacement facts', () => {
    const retry = { retry: 1, max_retries: 4, next_attempt_at: '2026-10-15T16:00:03Z', reason: 'transient', replaced_attempt_id: 'attempt-1', replaced_attempt_epoch: 1 };
    const request = { logical_request_id: 'request', attempt_id: 'attempt-1', attempt_epoch: 1,
      started_at: '2026-10-15T16:00:00Z', first_output_at: '2026-10-15T16:00:01Z', estimated_output_tokens: 128 };
    const sampledAt = Date.parse('2026-10-15T16:00:02Z');
    const mapped = mapFlowerThread({ read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } }, created_at_unix_ms: 1, updated_at_unix_ms: 1, title: '', title_status: '', title_generation: 0, thread_id: 'thread-retry', active_run_id: 'run-retry', run_id: 'run-retry', turn_id: 'turn-retry', run_status: 'running', run_progress: { run_id: 'run-retry', turn_id: 'turn-retry', phase: 'retrying', retry, request, sampled_at_ms: sampledAt } }, [], mapperOptions);
    expect(mapped.run_progress?.retry).toEqual(retry);
    expect(mapped.run_progress?.request).toMatchObject(request);
    expect(mapped.run_progress?.sampled_at_ms).toBe(sampledAt);
    expect(Number.isFinite(mapped.run_progress?.request?.wait_anchor_monotonic_ms)).toBe(true);
    expect(() => mapFlowerThread({ thread_id: 'thread-retry', active_run_id: 'run-retry', run_id: 'run-retry', turn_id: 'turn-retry', run_status: 'running', run_progress: { run_id: 'run-retry', turn_id: 'turn-retry', phase: 'retrying', retry: { ...retry, retry: 0 } } }, [], mapperOptions)).toThrow('run_progress.retry');
  });
});


describe('Canonical managed model context', () => {
 const facts = { snapshot: { sections: [{ key: 'skills', title: 'Available skills', text: 'Complete catalog' }] },
  entry_id: 'entry-facts', path_depth: 2, turn_id: 'turn-a', run_id: 'run-a', updated_at: '2026-10-15T12:00:00Z',
  changed_keys: ['skills'], removed_keys: [] };
 it('maps admitted and used snapshots identically on live and reconnect', () => {
  const used = { ...facts, used_by_request_id: 'request-a', used_by_turn_id: 'turn-a', used_by_run_id: 'run-a', used_at: '2026-10-15T12:00:01Z' };
  expect(mapModelContext(facts)?.used_at).toBeUndefined();
  expect(mapModelContext(used)).toEqual(mapModelContext(JSON.parse(JSON.stringify(used))));
  expect(mapModelContext({ ...facts, snapshot: { sections: [] }, changed_keys: [], removed_keys: ['skills'] })?.snapshot.sections).toEqual([]);
 });
 it.each([
  { snapshot: { sections: [facts.snapshot.sections[0], facts.snapshot.sections[0]] } },
  { snapshot: { sections: [{ ...facts.snapshot.sections[0], text: 'x'.repeat(64001) }] } },
  { path_depth: -1 }, { changed_keys: ['skills', 'skills'] }, { removed_keys: [7] },
  { used_at: 'invalid' }, { used_by_request_id: 7 }, { run_id: null },
 ])('rejects corrupt canonical facts %j', override => {
  expect(() => mapModelContext({ ...facts, ...override })).toThrow();
 });
});

it('retains request-scoped context categories and zero native input', () => {
 const sample = { phase:'provider_usage', pressure_status:'stable', updated_at_ms:1, input_tokens:0,
  breakdown:{ source:'semantic_input_bpe_v1', tool_result_tokens:1234, tool_call_tokens:70, attachment_tokens:4096 } };
 const mapped = mapContextUsage({ confirmed:sample })!;
 expect(mapped.confirmed?.input_tokens).toBe(0);
 expect(mapped.confirmed?.breakdown).toEqual(sample.breakdown);
 for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER+1, '100']) {
  expect(() => mapContextUsage({ confirmed:{...sample, breakdown:{source:'test',tool_result_tokens:value}} })).toThrow();
 }
});
