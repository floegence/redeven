import { describe, expect, it } from 'vitest';

import {
  mapContextUsage,
  mapModelContext,
  mapFlowerActivityItem,
  mapFlowerMessage,
  mapFlowerGoal,
  mapFlowerGoalChange,
  mapFlowerThread,
  mapFlowerSubagents,
  mapFlowerContextCompactions,
  mapFlowerTimelineDecorations,
} from './flowerLiveMapper';

describe('Canonical assistant citations in historical pages', () => {
  it('preserves block text, locations and metadata changes without a host source store', () => {
    const text = ' 你好😀 \uE200cite\uE202turn1view5\uE201 ';
    const source = { title: 'Reference', url: 'https://example.com/docs', start_index: 5, end_index: [...text].length - 1 };
    const wire = { id: 'answer', thread_id: 'thread-a', turn_id: 'turn-a', run_id: 'run-a', role: 'assistant', status: 'complete', timestamp: 10, blocks: [{ type: 'markdown', content: text, sources: [source] }] };
    const message = mapFlowerMessage(JSON.parse(JSON.stringify(wire)));
    expect(message.blocks?.[0]).toEqual(wire.blocks[0]);
    const renamed = mapFlowerMessage({ ...wire, blocks: [{ ...wire.blocks[0], sources: [{ ...source, title: 'Updated title' }] }] });
    expect(renamed.blocks?.[0]).toEqual({ ...wire.blocks[0], sources: [{ ...source, title: 'Updated title' }] });
    expect(message.blocks?.[0]).toEqual(wire.blocks[0]);
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

describe('Historical subagent role metadata', () => {
  it('does not project legacy role fields into current Flower summaries', () => {
    const [summary] = mapFlowerSubagents([{
      parent_thread_id: 'parent-thread',
      thread_id: 'child-thread',
      task_name: 'Review API',
      task_description: 'Inspect the public API.',
      title: 'Review API',
      title_status: 'ready',
      title_generation: 1,
      agent_type: 'reviewer',
      status: 'completed',
      can_send_input: false,
      can_interrupt: false,
      can_close: false,
    }], 'thread.subagents')!;

    expect(summary).toMatchObject({
      parent_thread_id: 'parent-thread',
      thread_id: 'child-thread',
      task_name: 'Review API',
      task_description: 'Inspect the public API.',
      status: 'completed',
    });
    expect(summary).not.toHaveProperty('agent_type');
    expect(JSON.stringify(summary)).not.toContain('reviewer');
  });
});

describe('Flower context usage contract', () => {
  const confirmed = { available:true, measured:true, characters_available:false, phase: 'provider_usage', pressure_status: 'stable', input_tokens: 71872, context_window_tokens: 950000, updated_at_ms: 10 };
  const estimate = { ...confirmed, measured:false, phase: 'projected_request', input_tokens: 82346, updated_at_ms: 11 };
  const thread_usage = { input_tokens: 50, output_tokens: 20, cache_read_tokens: 45, cache_write_tokens: 5 };

  it('maps optional character statistics without converting native usage', () => {
    const characters = { source: 'prepared_characters_v1', unit: 'unicode_code_points', total_characters: 2, categories: [{ category: 'user', characters: 2 }] };
    const wire = { confirmed: { ...confirmed, characters_available: true, characters } };
    expect(mapContextUsage(wire)?.confirmed?.characters).toEqual(characters);
    expect(mapContextUsage(JSON.parse(JSON.stringify(wire)))).toEqual(mapContextUsage(wire));
  });

  it('maps the same confirmed and estimated samples for live and reconnect', () => {
    const wire = { confirmed, estimate, thread_usage, recent_request_usage: {input_tokens: 30, output_tokens: 5, cache_read_tokens: 60, cache_write_tokens: 10} };
    expect(mapContextUsage(wire)).toEqual(wire);
    expect(mapContextUsage(JSON.parse(JSON.stringify(wire)))).toEqual(mapContextUsage(wire));
  });
  it('preserves explicit empty snapshots and rejects invalid compactions', () => {
    expect(mapContextUsage({})).toEqual({});
    expect(mapContextUsage(null)).toBeNull();
    expect(mapFlowerContextCompactions([])).toEqual([]);
    expect(mapFlowerTimelineDecorations([])).toEqual([]);
    expect(mapFlowerContextCompactions(undefined)).toBeUndefined();
    expect(() => mapFlowerContextCompactions([{ operation_id: 'missing-identity', phase: 'start', status: 'compacting' }])).toThrow('canonical identity');
    expect(() => mapFlowerContextCompactions(null)).toThrow('must be an array');
  });
  it('preserves compaction evidence through live and reloaded timeline mapping without aliases', () => {
    const pressure = { projected_input_tokens: 480000, threshold_tokens: 472500, request_safe_limit_tokens: 500000, pressure_signal: 'projected_request', pressure_source: 'usage_anchored_delta' };
    const before = { payload_fingerprint: 'unsent', provider: 'test', model: 'model', estimated_input_tokens: 470382, source: 'fixture', estimate_method: 'provider_rendered_payload_estimate', estimate_confidence: 'conservative', pressure, calibration_request_id: 'confirmed' };
    const decision = { pressure, before, after: { ...before, estimated_input_tokens: 0 } };
    const compaction = { operation_id: 'compact', turn_id: 'turn', canonical_ordinal: 7, phase: 'complete', status: 'compacted', updated_at_ms: 10, decision };
    const decoration = { decoration_id: 'context-compaction:compact', kind: 'context_compaction', ordinal: 0, anchor: { target_kind: 'message', message_id: 'message', edge: 'after' }, compaction };
    expect(mapFlowerContextCompactions([compaction])?.[0].decision).toEqual(decision);
    const mapped = mapFlowerTimelineDecorations(JSON.parse(JSON.stringify([decoration])))?.[0];
    expect(mapped?.compaction.decision).toEqual(decision);
    const live = mapFlowerContextCompactions([compaction])![0].decision!;
    expect(live).not.toBe(decision);
    expect(live.before).not.toBe(before);
    expect(live.before?.pressure).not.toBe(pressure);
    expect(mapFlowerContextCompactions([{ ...compaction, decision: undefined }])?.[0].decision).toBeUndefined();
  });
  it('rejects malformed decision evidence without inventing a replacement', () => {
    const candidate = { payload_fingerprint: 'frozen', provider: 'test', model: 'model', estimated_input_tokens: 0, source: 'fixture', estimate_method: 'provider_rendered_payload_estimate', estimate_confidence: '', pressure: {} };
    const compaction = { operation_id: 'compact', turn_id: 'turn', canonical_ordinal: 7, phase: 'complete', status: 'compacted', updated_at_ms: 10 };
    for (const decision of [null, [], { pressure: {} }, { pressure: {}, before: null }, { pressure: [], after: candidate }, { pressure: {}, after: { ...candidate, estimated_input_tokens: -1 } }, { pressure: {}, after: { ...candidate, pressure: { threshold_tokens: '472500' } } }, { pressure: {}, after: { ...candidate, calibration_request_id: 7 } }]) {
      expect(() => mapFlowerContextCompactions([{ ...compaction, decision }])).toThrow('Flower contract error');
    }
    expect(mapFlowerContextCompactions([{ ...compaction, decision: { pressure: {}, after: candidate } }])?.[0].decision?.after?.estimated_input_tokens).toBe(0);
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
  it('preserves legal whitespace around structured text and Markdown', () => {
    for (const format of ['text', 'markdown']) {
      const content = ' '.repeat(70000) + '**Retained content**' + '\n'.repeat(70000);
      const mapped = mapFlowerActivityItem({ item_id: 'whitespace', kind: 'tool', status: 'success',
        presentation: { renderer: 'structured', payload: { rows: [{ content, format }] } } });
      expect((mapped?.payload?.rows as { content: string }[])[0].content).toBe(content);
      expect(() => mapFlowerActivityItem({ item_id: 'oversized', kind: 'tool', status: 'success',
        presentation: { renderer: 'structured', payload: { rows: [{ content: 'a'.repeat(8001), format }] } } }))
        .toThrow('exceeds the structured activity limit');
    }
  });
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

  it('accepts metadata-only status activity without expanding its payload', () => {
    const payload = { action: 'status', status: 'success', targets: [{ thread_id: 'child', status: 'running' }], requested_count: 1 };
    expect(mapFlowerActivityItem(activity(payload))?.payload).toEqual(payload);
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

it('preserves zero native input when optional characters are damaged', () => {
 const sample = { available: true, measured: true, characters_available: true, phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 0 };
 for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100']) {
  expect(mapContextUsage({ confirmed: { ...sample, characters: { source: 'prepared_characters_v1', unit: 'unicode_code_points', total_characters: value, categories: [] } } })?.confirmed).toMatchObject({ available: true, input_tokens: 0, characters_available: false, character_limitation: 'invalid_characters' });
 }
});

it('maps historical Goal changes independently of execution and keeps ordinary message identities strict', () => {
  const goal = { version: 2, status: 'absent', actor: 'user' };
  const change = { goal, operation: 'delete', actor: 'user', at: '2026-10-18T00:00:00Z' };
  const raw = { id: 'goal:deleted', thread_id: 'thread-a', role: 'system', status: 'complete', timestamp: 10, goal: change };
  expect(mapFlowerMessage(raw)).toMatchObject({ goal: change, role: 'system' });
  expect(() => mapFlowerMessage({ ...raw, goal: undefined })).toThrow('requires turn_id');
});

it('rejects malformed Goal facts before relaxing execution identity', () => {
 const valid = { goal: { version:1,status:'active',actor:'user',text:'Exact goal' }, operation:'set', actor:'user', at:'2026-10-18T00:00:00Z' };
 expect(mapFlowerGoalChange(valid)).toEqual(valid);
 for (const changed of [{goal:{...valid.goal,version:0}}, {goal:{...valid.goal,version:1.5}}, {goal:{...valid.goal,text:''}}, {goal:{...valid.goal,status:'absent'}}, {operation:'completed'}, {actor:'other'}, {at:'invalid'}]) {
   expect(() => mapFlowerGoalChange({...valid,...changed})).toThrow('invalid Goal');
 }
 expect(() => mapFlowerMessage({id:'goal',thread_id:'t',role:'user',goal:valid})).toThrow('require the system role');
});

it('validates current Goal states without truncating user text', () => {
  expect(mapFlowerGoal({ version: 0, status: 'absent', actor: '' })).toEqual({ version: 0, status: 'absent', actor: '' });
  const text = 'Readable result. '.repeat(1000);
  expect(mapFlowerGoal({ version: 1, status: 'active', actor: 'user', text }).text).toBe(text);
  for (const goal of [
    { version: -1, status: 'absent', actor: '' },
    { version: 0, status: 'active', actor: 'user', text: 'Forged' },
    { version: 1, status: 'active', actor: 'unknown', text: 'Forged' },
    { version: 1, status: 'active', actor: 'user', text: '' },
    { version: 2, status: 'absent', actor: 'user', text: 'Retained text' },
  ]) expect(() => mapFlowerGoal(goal)).toThrow('invalid Goal state');
});
