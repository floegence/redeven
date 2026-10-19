import { describe, expect, it } from 'vitest';
import type { FlowerRuntimeCurrentView, FlowerThreadSnapshot, FlowerToolCallPreview } from './contracts/flowerSurfaceContracts';
import { buildFlowerTimelineEntries, flowerMessageSignature } from './flowerTimelineProjection';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';
import { createThreadCache } from './threadCache';
import { canonicalProcessFixture } from './flowerCanonicalProcess.testFixture';
import { projectFlowerTurnProcess } from './flowerTurnPresentation';
import { mapFlowerMessage } from './flowerLiveMapper';

const summary = (): FlowerThreadSnapshot => ({
  thread_id: 'thread-a', title: 'Product title', title_status: 'ready', title_generation: 1, model_id: 'deepseek/chat', working_dir: '/',
  settings_revision: 1,
  created_at_ms: 1, updated_at_ms: 2, status: 'idle', source_label: 'Desktop', target_labels: ['local'],
  messages: [{ id: 'old', role: 'assistant', content: 'old', status: 'complete', created_at_ms: 1 }],
  read_status: { is_unread: false, snapshot: { activity_revision: 0 }, read_state: { last_seen_activity_revision: 0 } },
});

describe('streamed tool argument presentation', () => {
  const call: FlowerToolCallPreview = {
    thread_id: 'thread-a', turn_id: 'turn-a', run_id: 'run-a', logical_request_id: 'request-a', attempt_id: 'attempt-a', attempt_epoch: 1,
    call_id: 'call-a', name: 'file.write', arguments_complete: false, preview: { display_name: 'a.txt', additions: 8 },
  };
  const current: FlowerRuntimeCurrentView = {
    thread_id: 'thread-a', turn_id: 'turn-a', run_id: 'run-a', view_version: 1, activity: 'active',
    run_progress: { phase: 'streaming' }, tool_call_previews: [call], items: [],
  };
  const tool = (status: string) => ({
    id: 'tool:turn-a:call-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'tool' as const,
    activity: { item_id: 'canonical-entry-a', tool_id: 'call-a', tool_name: 'file.write', kind: 'tool', status, severity: 'normal',
      presentation: { renderer: 'file', payload: { display_name: 'a.txt', operation: 'write', change_type: 'noop' } } },
  });

  it('keeps unvalidated previews outside runtime items and joins the exact validated call without duplicates', () => {
    const generating = applyFlowerRuntimeCurrentView(summary(), current);
    expect(current.items).toEqual([]);
    expect(generating.messages).toHaveLength(1);
    expect(generating.messages[0].blocks?.[0]).toEqual({ type: 'tool-call-preview', call });
    const waiting = applyFlowerRuntimeCurrentView(generating, { ...current, view_version: 2, items: [tool('waiting')] });
    expect(waiting.messages).toHaveLength(1);
    const block = waiting.messages[0].blocks![0];
    expect(block.type).toBe('activity-timeline');
    if (block.type === 'activity-timeline') expect(block.items[0].argument_preview).toEqual(call.preview);
    const before = buildFlowerTimelineEntries(generating)[0];
    const after = buildFlowerTimelineEntries(waiting)[0];
    expect(before.key).toBe(after.key);
    if (before.type === 'message' && after.type === 'message') expect(before.blocks[0].key).toBe(after.blocks[0].key);
  });

  it.each(['success', 'error', 'declined', 'canceled'])('clears preview counts on %s, including a successful zero-change result', (status) => {
    const next = applyFlowerRuntimeCurrentView(summary(), { ...current, items: [tool(status)] });
    expect(next.messages).toHaveLength(1);
    const block = next.messages[0].blocks![0];
    if (block.type !== 'activity-timeline') throw new Error('Expected the canonical tool activity.');
    expect(block.items[0].argument_preview).toBeUndefined();
    expect(block.items[0].payload?.change_type).toBe('noop');
  });

  it('ignores previews from another attempt, run, turn or thread and clears them on refresh', () => {
    for (const changed of [{ thread_id: 'other' }, { turn_id: 'other' }, { run_id: 'other' }, { attempt_id: 'other' }, { attempt_epoch: 2 }, { logical_request_id: 'other' }]) {
      const next = applyFlowerRuntimeCurrentView(summary(), { ...current,
        sampled_at_ms: Date.parse('2026-01-01T00:00:02Z'),
        run_progress: { phase: 'streaming', request: { logical_request_id: 'request-a', attempt_id: 'attempt-a', attempt_epoch: 1, started_at: '2026-01-01T00:00:00Z', estimated_output_tokens: 12 } },
        tool_call_previews: [{ ...call, ...changed }],
      });
      expect(next.messages).toEqual([]);
    }
    const generated = applyFlowerRuntimeCurrentView(summary(), current);
    expect(applyFlowerRuntimeCurrentView(generated, { ...current, view_version: 2, tool_call_previews: [] }).messages).toEqual([]);
  });
});



describe('historical file navigation during live updates', () => {
  it.each(['file', 'structured', 'patch'])('retains only proven targets for equal %s facts', renderer => {
    const target = { kind: 'file', label: 'a.txt', path: '/unmounted/a.txt' };
    const entry = renderer === 'structured' ? { title: 'a.txt', content: 'historical snapshot', format: 'code', language: 'text' }
      : renderer === 'patch' ? { display_name: 'a.txt', change_type: 'modify', unified_diff: 'historical diff' }
        : { display_name: 'a.txt', content: 'historical snapshot' };
    const field = renderer === 'structured' ? 'rows' : 'mutations';
    const payload = renderer === 'file' ? entry : { [field]: [entry] };
    const enriched = renderer === 'file' ? payload : { [field]: [{ ...entry, target }] };
    const name = renderer === 'structured' ? 'read_files' : renderer === 'patch' ? 'apply_patch' : 'read_file';
    const rawActivity = {
      item_id: 'canonical', tool_id: 'call', tool_name: name, kind: 'tool', status: 'success',
      presentation: { renderer, payload: enriched, ...(renderer === 'file' ? { target_refs: [target] } : {}) },
    };
    const item = { id: 'historical', turn_id: 'turn-old', run_id: 'run-old', ordinal: 1, kind: 'tool' as const, activity: rawActivity };
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread-a', view_version: 1, activity: 'idle', items: [item] };
    const hydrated = applyFlowerRuntimeCurrentView(summary(), current);
    const plainItem = { ...item, activity: { ...rawActivity, presentation: { renderer, payload } } };
    const plain: FlowerRuntimeCurrentView = { ...current, view_version: 2, items: [plainItem] };
    const activity = (thread: FlowerThreadSnapshot) => {
      const block = thread.messages[0].blocks![0];
      if (block.type !== 'activity-timeline') throw new Error('Expected activity');
      return block.items[0];
    };
    expect(activity(applyFlowerRuntimeCurrentView(hydrated, plain))).toEqual(activity(hydrated));
    for (const version of [1, 2]) {
      const live = applyFlowerRuntimeCurrentView(summary(), plain);
      const cached = createThreadCache().receiveCurrent({ version: 2, thread: live }).cache;
      const received = cached.receiveView({ version, thread: hydrated });
      expect(activity(received.cache.views.get('thread-a')!.thread as FlowerThreadSnapshot)).toEqual(activity(hydrated));
      expect(received.cache.views.get('thread-a')!.version).toBe(2);
      expect(received.runtimeState).toBe(version === 2 ? 'unchanged' : 'stale');
    }

    // Full identity and immutable facts govern retention, never basename or position.
    for (const changed of [
      { ...plainItem, run_id: 'different-run' },
      { ...plainItem, activity: { ...plainItem.activity, tool_id: 'different-call' } },
      { ...plainItem, activity: { ...plainItem.activity, presentation: { renderer, payload: { ...payload, summary: 'changed' } } } },
    ]) {
      expect(JSON.stringify(activity(applyFlowerRuntimeCurrentView(hydrated, { ...plain, items: [changed] })))).not.toContain('/unmounted/a.txt');
    }
    expect(rawActivity.presentation.payload).toBe(enriched);
  });
});

describe('applyFlowerRuntimeCurrentView', () => {
  it('keeps Unicode citation positions relative to exact text and invalidates late metadata', () => {
    const text = ' 你好😀 \uE200cite\uE202turn1view5\uE201 ';
    const sources = [{ title: 'Reference', url: 'https://example.com/docs', start_index: 5, end_index: [...text].length - 1 }];
    const view: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 1, activity: 'idle', items: [
        { id: 'answer', kind: 'assistant', text, turn_id: 'turn-a', run_id: 'run-a', ordinal: 1 },
      ],
    };
    const before = applyFlowerRuntimeCurrentView(summary(), view);
    const after = applyFlowerRuntimeCurrentView(before, { ...view, view_version: 2, items: [{ ...view.items![0], sources }] });
    expect(after.messages[0].content).toBe(text);
    expect(after.messages[0].sources).toEqual(sources);
    expect(flowerMessageSignature(after.messages[0])).not.toBe(flowerMessageSignature(before.messages[0]));
    const entry = buildFlowerTimelineEntries(after)[0];
    expect(entry.type).toBe('message');
    if (entry.type === 'message') expect(entry.blocks[0]).toMatchObject({ type: 'content', content: text, sources });
  });
  it('preserves safe context diagnostics across a current refresh and clears them after retry', () => {
    const failed = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 8, activity: 'idle', turn_id: 'turn-a', run_id: 'run-a',
      last_outcome: 'failed', error: 'Increase the context window.', run_error_code: 'context_budget_invalid',
      run_error_detail: 'context_window_tokens=3891\nrequest_safe_limit=-205',
    });
    expect(failed.error).toEqual({ code: 'context_budget_invalid', message: 'Increase the context window.', detail: 'context_window_tokens=3891\nrequest_safe_limit=-205' });
    const retried = applyFlowerRuntimeCurrentView(failed, {
      thread_id: 'thread-a', view_version: 9, activity: 'active', turn_id: 'turn-b', run_id: 'run-b', run_progress: { phase: 'preparing' },
    });
    expect(retried.error).toBeUndefined();
  });

  it('preserves exact approval command whitespace through canonical refreshes', () => {
    const command = '\n  printf "first line"\n  printf "second line"\n';
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 2, activity: 'active', turn_id: 'turn-a', run_id: 'run-a',
      interactions: [{ id: 'approval-a', turn_id: 'turn-a', run_id: 'run-a', kind: 'approval',
        approval: { tool_name: 'terminal.exec', tool_call_id: 'tool-a', label: 'Inspect output', command } }],
    };
    expect(applyFlowerRuntimeCurrentView(summary(), current).approval_actions?.[0].summary.command).toBe(command);
  });

  it('retains canonical terminal execution identity without deriving it from a successful tool', () => {
    const view: FlowerRuntimeCurrentView = { thread_id: 'thread-a', view_version: 2, turn_id: 'turn-a', run_id: 'run-a', activity: 'idle', last_outcome: 'cancelled' };
    const stopped = applyFlowerRuntimeCurrentView(summary(), view);
    expect(stopped.active_run_id).toBeUndefined();
    expect(stopped.current_execution).toEqual({ turn_id: 'turn-a', run_id: 'run-a', status: 'canceled' });
    const next = applyFlowerRuntimeCurrentView(stopped, { ...view, view_version: 3, turn_id: 'turn-text', run_id: 'run-text', activity: 'active', last_outcome: undefined, run_progress: { phase: 'tool_execution' } });
    expect(next.current_execution).toEqual({ turn_id: 'turn-text', run_id: 'run-text', status: 'running' });
    expect(applyFlowerRuntimeCurrentView(stopped, { thread_id: 'thread-a', view_version: 4, activity: 'idle' }).current_execution).toBeUndefined();
  });
  it('normalizes legacy choices to explicit submitted values', () => {
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread-a', view_version: 1, activity: 'active', turn_id: 'turn-a', run_id: 'run-a', interactions: [{
      id: 'input-a', turn_id: 'turn-a', run_id: 'run-a', kind: 'input', input: { summary: '', questions: [{ id: 'q', kind: 'select', prompt: 'Choose', options: ['Stable'] }] },
    }] };
    expect(applyFlowerRuntimeCurrentView(summary(), current).input_request?.questions[0].choices)
      .toEqual([{ choice_id: 'Stable', value: 'Stable', label: 'Stable', kind: 'select' }]);
  });

  it.each(['multiple inputs', 'duplicate questions', 'duplicate choices', 'missing choices', 'invalid choice value'])('rejects ambiguous input: %s', (scenario) => {
    const question = { id: 'q', kind: 'select', prompt: 'Choose', choices: [{ choice_id: 'stable', value: 'Stable', label: 'Stable' }] };
    const interaction = { id: 'input-a', turn_id: 'turn-a', run_id: 'run-a', kind: 'input' as const, input: { summary: '', questions: [question] } };
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread-a', view_version: 1, activity: 'active', turn_id: 'turn-a', run_id: 'run-a', interactions: [interaction] };
    const tested = scenario === 'multiple inputs' ? { ...current, interactions: [interaction, { ...interaction, id: 'input-b' }] } : current;
    if (scenario === 'duplicate questions') interaction.input.questions.push(question);
    if (scenario === 'duplicate choices') question.choices.push(question.choices[0]);
    if (scenario === 'missing choices') question.choices = [];
    if (scenario === 'invalid choice value') question.choices[0].value = '';
    expect(() => applyFlowerRuntimeCurrentView(summary(), tested)).toThrow('Flower contract error');
  });
  it('owns exact Stop provenance and clears it only for the next canonical turn', () => {
    const cancellation = { thread_id: 'thread-a', turn_id: 'turn-a', run_id: 'run-a', source: 'user_stop', mode: 'graceful' as const, requested_at: '2026-09-10T03:00:00Z' };
    const current: FlowerRuntimeCurrentView = { thread_id: 'thread-a', view_version: 2, activity: 'active', turn_id: 'turn-a', run_id: 'run-a', run_progress: { phase: 'tool_execution' }, cancellation, items: [] };
    const stopping = applyFlowerRuntimeCurrentView(summary(), current);
    expect(stopping.cancellation).toEqual(cancellation);
    expect(stopping.status).toBe('running');
    const stopped = applyFlowerRuntimeCurrentView(stopping, { ...current, view_version: 3, activity: 'idle', last_outcome: 'cancelled' });
    expect(stopped.status).toBe('canceled');
    expect(stopped.error).toBeUndefined();
    expect(stopped.cancellation).toEqual(cancellation);
    const next = applyFlowerRuntimeCurrentView(stopped, { ...current, view_version: 4, cancellation: undefined, run_id: 'run-next', turn_id: 'turn-next' });
    expect(next.cancellation).toBeUndefined();
    expect(() => applyFlowerRuntimeCurrentView(summary(), { ...current, cancellation: { ...cancellation, run_id: 'wrong-run' } })).toThrow('exact execution identity');
  });

  it('keeps restored input separate from executable queues and canonical messages', () => {
    const restored = [{ id: 'restored-input', input: { text: 'Keep this old queue input', attachments: [{ name: 'notes.txt' }] } }];
    const result = applyFlowerRuntimeCurrentView(summary(), { thread_id: 'thread-a', view_version: 3, activity: 'idle', restored_inputs: restored, items: [] });
    expect(result.restored_inputs).toEqual(restored);
    expect(result.queued_turn_count).toBe(0);
    expect(result.messages).toEqual([]);
  });
  it('rejects a running current without canonical run progress', () => {
    expect(() => applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 6, activity: 'active', run_id: 'run-a', turn_id: 'turn-a',
      items: [{ id: 'user-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'user', text: 'hello' }],
    })).toThrow('a running thread current requires run_progress');
  });

  it('keeps product metadata while replacing detail with the typed current view', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 7, activity: 'active', run_id: 'run-a', turn_id: 'turn-a',
      run_progress: { phase: 'waiting_response' },
    items: [{ id: 'user-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'user', text: 'hello' }],
    };
    const result = applyFlowerRuntimeCurrentView(summary(), current);
    expect(result.model_id).toBe('deepseek/chat');
    expect(result.working_dir).toBe('/');
    expect(result.status).toBe('running');
    expect(result.messages.map((message) => message.content)).toEqual(['hello']);
    expect(result.active_run_id).toBe('run-a');
    expect(result.run_progress).toEqual({ run_id: 'run-a', turn_id: 'turn-a', phase: 'waiting_response' });
  });

  it('clears the derived model status after the runtime settles', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 8, activity: 'idle', turn_id: 'turn-a', last_outcome: 'completed',
    items: [{ id: 'assistant:turn-a:1', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'assistant', text: 'done' }],
    });

    expect(result.run_progress).toBeNull();
  });

  it('keeps a runtime failure visible in the thread error projection', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 8, activity: 'idle', turn_id: 'turn-a',
      last_outcome: 'failed', error: 'Desktop model source disconnected.',
    items: [{ id: 'user:turn-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'user', text: 'hello' }],
    });

    expect(result.status).toBe('failed');
    expect(result.error).toEqual({
      code: 'floret_turn_failed',
      message: 'Desktop model source disconnected.',
    });
  });

  it('preserves the server-classified unknown effect error', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 9, activity: 'idle', turn_id: 'turn-a',
      last_outcome: 'failed',
      error: 'Some operations may have completed, but their results could not be confirmed.',
      run_error_code: 'floret_effect_outcome_unknown',
    items: [{ id: 'user:turn-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'user', text: 'hello' }],
    });

    expect(result.error).toEqual({
      code: 'floret_effect_outcome_unknown',
      message: 'Some operations may have completed, but their results could not be confirmed.',
    });
  });

  it('does not render a duplicated current item twice', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 9, activity: 'idle', turn_id: 'turn-a', last_outcome: 'completed',
      items: [
    { id: 'assistant:turn-a:1', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'assistant', text: 'same reply' },
    { id: 'assistant:turn-a:1', turn_id: 'turn-a', run_id: 'run-a', ordinal: 2, kind: 'assistant', text: 'same reply' },
      ],
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ id: 'assistant:turn-a:1', content: 'same reply' });
  });

  it('keeps assistant messages with different stable identities even when text repeats', () => {
    const repeated = 'Current weather in Changsha: temperature 28-29C, humidity 85%, forecast is clear and dry.';
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 10, activity: 'idle', turn_id: 'turn-a', last_outcome: 'completed',
      items: [
    { id: 'assistant:turn-a:1', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'assistant', text: repeated },
    { id: 'assistant:turn-a:2', turn_id: 'turn-a', run_id: 'run-a', ordinal: 2, kind: 'assistant', text: repeated },
      ],
    });

    expect(result.messages.map((message) => message.id)).toEqual(['assistant:turn-a:1', 'assistant:turn-a:2']);
  });

  it('keeps user messages with different request identities even when text repeats', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 11, activity: 'active', run_id: 'run-b', turn_id: 'turn-b',
      run_progress: { phase: 'streaming' },
      items: [
    { id: 'user:request-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'user', text: 'same message' },
    { id: 'user:request-b', turn_id: 'turn-b', run_id: 'run-b', ordinal: 2, kind: 'user', text: 'same message' },
      ],
    });

    expect(result.messages.map((message) => message.id)).toEqual(['user:request-a', 'user:request-b']);
  });

  it('renders a 60-item three-turn history with every historical tool bound to its exact run', () => {
    const items = Array.from({ length: 60 }, (_, index) => {
      const turnIndex = Math.floor(index / 20) + 1;
      const turnID = `turn-${turnIndex}`;
      const runID = `run-${turnIndex}`;
      if (index < 29) {
        return {
          id: `tool-${index}`,
          turn_id: turnID,
          run_id: runID,
          ordinal: index + 1,
          kind: 'tool' as const,
          activity: {
            item_id: `tool-${index}`,
            tool_id: `call-${index}`,
            tool_name: 'terminal.exec',
            kind: 'tool',
            status: 'success',
            severity: 'normal',
            needs_attention: false,
            requires_approval: false,
          },
        };
      }
      return {
        id: `message-${index}`,
        turn_id: turnID,
        run_id: runID,
        ordinal: index + 1,
        kind: index % 2 === 0 ? 'user' as const : 'assistant' as const,
        text: `message ${index}`,
      };
    });
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a',
      view_version: 60,
      activity: 'idle',
      turn_id: 'turn-3',
      last_outcome: 'completed',
      items,
    });

    expect(result.messages).toHaveLength(60);
    expect(result.messages.slice(0, 29).map((message) => message.run_id)).toEqual([
      ...Array(20).fill('run-1'),
      ...Array(9).fill('run-2'),
    ]);
    expect(() => buildFlowerTimelineEntries(result)).not.toThrow();
  });

  it('rejects an item without an exact run identity', () => {
    const malformed = {
      thread_id: 'thread-a',
      view_version: 12,
      items: [{ id: 'user-a', turn_id: 'turn-a', ordinal: 1, kind: 'user', text: 'hello' }],
    } as unknown as FlowerRuntimeCurrentView;

    expect(() => applyFlowerRuntimeCurrentView(summary(), malformed)).toThrow(
      'Flower contract error: current item requires exact id, turn_id, and run_id.',
    );
  });

  it('rejects a current view for a different thread', () => {
    expect(() => applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-b',
      view_version: 12,
      items: [],
    })).toThrow('Flower contract error: current thread_id does not match the selected thread.');
  });

  it('rejects conflicting item and interaction identities', () => {
    expect(() => applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a',
      view_version: 13,
      items: [{
        id: 'interaction-a',
        turn_id: 'turn-a',
        run_id: 'run-a',
        ordinal: 1,
        kind: 'interaction',
        interaction: {
          id: 'input-a',
          turn_id: 'turn-a',
          run_id: 'run-b',
          kind: 'input',
          resolved: true,
        },
      }],
    })).toThrow('Flower contract error: current item and interaction execution identity differ.');
  });

  it('projects ordered current attachments as image and file blocks without duplicate reference chips', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 12, activity: 'idle', turn_id: 'turn-a', last_outcome: 'completed',
      items: [{
    id: 'user:turn-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'user', text: 'inspect these',
        attachments: [
          { name: 'screen.png', mime_type: 'image/png', size_bytes: 12, url: '/_redeven_proxy/api/ai/uploads/upl-image?thread_id=thread-a&turn_id=turn-a' },
          { name: 'notes.txt', mime_type: 'text/plain', size_bytes: 8 },
        ],
      }],
    });

    expect(result.messages[0]?.blocks).toEqual([
      { type: 'image', src: '/_redeven_proxy/api/ai/uploads/upl-image?thread_id=thread-a&turn_id=turn-a', alt: 'screen.png' },
      { type: 'file', name: 'notes.txt', mimeType: 'text/plain', size: 8 },
    ]);
    expect(result.messages[0]?.references).toBeUndefined();
  });

  it('keeps queued mixed attachments in order and projects scoped image URLs', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 13, activity: 'active', run_id: 'run-a', turn_id: 'turn-a',
      run_progress: { phase: 'preparing' },
      queue: [{
        id: 'queue-a', request_key: 'request-a', created_at: '2026-08-24T10:00:00.000Z',
        input: {
          text: 'queued with files',
          attachments: [
            { name: 'screen.png', mime_type: 'image/png', size_bytes: 12, url: '/uploads/photo?thread_id=thread-a&queue_id=queue-a' },
            { name: 'notes.txt', mime_type: 'text/plain', size_bytes: 8 },
          ],
        },
      }],
    });

    expect(result.queued_turns?.[0]?.attachments).toMatchObject([
      { attachment_id: 'queued:queue-a:0', name: 'screen.png', url: '/uploads/photo?thread_id=thread-a&queue_id=queue-a' },
      { attachment_id: 'queued:queue-a:1', name: 'notes.txt' },
    ]);
  });

  it.each(['interrupted', 'failed', 'cancelled'] as const)('keeps admitted messages normal after a %s turn', (outcome) => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 8, activity: 'idle', turn_id: 'turn-a', last_outcome: outcome,
      items: [
        { id: 'user:turn-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'user', text: 'continue' },
        { id: 'assistant:turn-a:1', turn_id: 'turn-a', run_id: 'run-a', ordinal: 2, kind: 'assistant', text: 'partial output' },
        { id: 'thinking:turn-a:1', turn_id: 'turn-a', run_id: 'run-a', ordinal: 3, kind: 'thinking', text: 'retained reasoning' },
      ],
    });

    expect(result.status).toBe(outcome === 'cancelled' ? 'canceled' : 'failed');
    expect(result.messages.map(message => message.status)).toEqual(['complete', 'complete', 'complete']);
  });

  it('uses the explicit live item marker as the only streaming authority', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 9, activity: 'active', run_id: 'run-a', turn_id: 'turn-a',
      run_progress: { phase: 'streaming' },
      items: [
    { id: 'assistant:turn-a:1', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'assistant', text: 'sealed segment' },
    { id: 'assistant:turn-a:2', turn_id: 'turn-a', run_id: 'run-a', ordinal: 2, kind: 'assistant', text: 'live segment', live: true },
      ],
    });

    expect(result.messages).toMatchObject([
      { id: 'assistant:turn-a:1', status: 'complete' },
      { id: 'assistant:turn-a:2', status: 'streaming', live: true, active_cursor: true },
    ]);
  });

  it('preserves Floret ordered segments and stable IDs through approval, completion, and reload', () => {
    const tool = (id: string, ordinal: number, status: 'waiting' | 'running' | 'success') => ({
    id: `tool:turn-a:${id}`, turn_id: 'turn-a', run_id: 'run-a', ordinal, kind: 'tool' as const,
      activity: {
        item_id: id, tool_id: id, tool_name: 'terminal.exec', kind: 'tool', status,
        severity: status === 'waiting' ? 'blocking' : 'normal', needs_attention: status === 'waiting',
        requires_approval: status === 'waiting',
      },
    });
    const ordered = [
    { id: 'user:turn-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'user' as const, text: 'run two tools' },
    { id: 'thinking:turn-a:1', turn_id: 'turn-a', run_id: 'run-a', ordinal: 2, kind: 'thinking' as const, text: 'first reasoning', live: true },
      tool('call-1', 3, 'waiting'),
    { id: 'thinking:turn-a:2', turn_id: 'turn-a', run_id: 'run-a', ordinal: 4, kind: 'thinking' as const, text: 'second reasoning', live: true },
      tool('call-2', 5, 'waiting'),
    { id: 'assistant:turn-a:1', turn_id: 'turn-a', run_id: 'run-a', ordinal: 6, kind: 'assistant' as const, text: 'done', live: true },
    ];
    const stages = [
      ordered.slice(0, 2),
      ordered.slice(0, 3),
      [...ordered.slice(0, 2), tool('call-1', 3, 'running')],
      [...ordered.slice(0, 2), tool('call-1', 3, 'success')],
      [...ordered.slice(0, 2), tool('call-1', 3, 'success'), ordered[3]],
      [...ordered.slice(0, 2), tool('call-1', 3, 'success'), ordered[3], ordered[4]],
      [...ordered.slice(0, 2), tool('call-1', 3, 'success'), ordered[3], tool('call-2', 5, 'running')],
      [...ordered.slice(0, 2), tool('call-1', 3, 'success'), ordered[3], tool('call-2', 5, 'success')],
      [...ordered.slice(0, 2), tool('call-1', 3, 'success'), { ...ordered[3], live: false }, tool('call-2', 5, 'success'), ordered[5]],
      ordered.map((item) => ({ ...item, live: false })),
    ];
    let stablePrefix: string[] = [];
    for (const [index, items] of stages.entries()) {
      const current: FlowerRuntimeCurrentView = {
        thread_id: 'thread-a', view_version: index + 1,
        activity: index === stages.length - 1 ? 'idle' : 'active', turn_id: 'turn-a',
        ...(index === stages.length - 1 ? {} : { run_id: 'run-a' }),
        ...(index === stages.length - 1 ? {} : { run_progress: { phase: 'streaming' as const } }),
        ...(index === stages.length - 1 ? { last_outcome: 'completed' as const } : {}),
        items,
      };
      const result = applyFlowerRuntimeCurrentView(summary(), current);
      const ids = result.messages.map((message) => message.id);
      expect(ids.slice(0, stablePrefix.length), `stage ${index}`).toEqual(stablePrefix);
      expect(new Set(ids).size, `stage ${index}`).toBe(ids.length);
      stablePrefix = ids;
    }
    expect(stablePrefix).toEqual([
      'user:turn-a', 'thinking:turn-a:1', 'tool:turn-a:call-1',
      'thinking:turn-a:2', 'tool:turn-a:call-2', 'assistant:turn-a:1',
    ]);
    const reload = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 11, activity: 'idle', turn_id: 'turn-a', last_outcome: 'completed',
      items: ordered.map((item) => ({ ...item, live: false })),
    });
    expect(reload.messages.map((message) => message.id)).toEqual(stablePrefix);
    expect(reload.messages[1]).toMatchObject({
      id: 'thinking:turn-a:1', status: 'complete', blocks: [{ type: 'thinking', content: 'first reasoning' }],
    });
  });

  it('prioritizes waiting input over approval and running', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 8, activity: 'active', run_id: 'run-a', turn_id: 'turn-a',
      run_progress: { phase: 'preparing' },
      interactions: [
    { id: 'approval-a', turn_id: 'turn-a', run_id: 'run-a', kind: 'approval' },
    { id: 'input-a', turn_id: 'turn-a', run_id: 'run-a', kind: 'input', input: { summary: '', questions: [{ id: 'q', prompt: 'Reply', kind: 'write' }] } },
      ],
    };
    expect(applyFlowerRuntimeCurrentView(summary(), current).status).toBe('waiting_user');
  });

  it.each([
    { name: 'null', questions: null },
    { name: 'missing', questions: undefined },
    { name: 'empty', questions: [] },
  ])('rejects a pending input interaction with $name questions', ({ questions }) => {
    const input = {
      summary: 'Choose a deployment target',
      ...(questions === undefined ? {} : { questions }),
    };
    const current = {
      thread_id: 'thread-a',
      view_version: 9,
      activity: 'active',
      run_id: 'run-a',
      turn_id: 'turn-a',
      interactions: [{
        id: 'input-a',
        turn_id: 'turn-a',
        run_id: 'run-a',
        kind: 'input',
        resolved: false,
        input,
      }],
    } as unknown as FlowerRuntimeCurrentView;

    expect(() => applyFlowerRuntimeCurrentView(summary(), current)).toThrow(
      'Flower contract error: typed current input interaction requires at least one question.',
    );
  });

  it('renders accepted busy input only in the typed runtime queue', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 8, activity: 'active', run_id: 'run-a', turn_id: 'turn-a',
      run_progress: { phase: 'preparing' },
    items: [{ id: 'user:active', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'user', text: 'active work' }],
      queue: [
        { id: 'queue:queued-first', request_key: 'queued-first', input: { text: 'first queued' } },
        { id: 'queue:queued-second', request_key: 'queued-second', input: { text: 'second queued' } },
      ],
    };

    const result = applyFlowerRuntimeCurrentView(summary(), current);
    expect(result.messages.map((message) => message.content)).toEqual(['active work']);
    expect(result.queued_turns).toEqual([
      { queue_id: 'queue:queued-first', request_key: 'queued-first', prompt: 'first queued', created_at_ms: result.updated_at_ms },
      { queue_id: 'queue:queued-second', request_key: 'queued-second', prompt: 'second queued', created_at_ms: result.updated_at_ms },
    ]);
    expect(result.queued_turn_count).toBe(2);
  });

  it('keeps declined tools quiet and terminal in their own timeline row', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 9, last_outcome: 'completed',
    items: [{ id: 'tool-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'tool', activity: {
        item_id: 'tool-a', kind: 'tool', status: 'declined', severity: 'quiet', needs_attention: false,
        requires_approval: true, approval_state: 'rejected',
      } }],
    };
    const result = applyFlowerRuntimeCurrentView(summary(), current);
    expect(result.status).toBe('success');
    expect(result.error).toBeUndefined();
    expect(result.messages[0]?.blocks?.[0]).toMatchObject({ items: [{ status: 'declined', severity: 'quiet', approval_state: 'rejected' }] });
  });

  it('preserves validated typed activity presentation and target metadata', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 10, last_outcome: 'completed', turn_id: 'turn-a',
      items: [{
    id: 'tool-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'tool',
        activity: {
          item_id: 'tool-a', tool_id: 'call-a', tool_name: 'terminal.exec', kind: 'tool',
          status: 'success', severity: 'normal', needs_attention: false, requires_approval: false,
          presentation: {
            label: 'printf hello', description: 'Command completed', renderer: 'terminal',
            chips: [{ kind: 'status', label: 'done', tone: 'positive' }],
            target_refs: [{ kind: 'process', label: 'shell', uri: 'process://shell', line: 0 }],
            payload: { command: 'printf hello', exit_code: 0 },
          },
          metadata: { source: 'runtime' },
        },
      }],
    };

    const result = applyFlowerRuntimeCurrentView(summary(), current);

    expect(result.messages[0]?.blocks?.[0]).toMatchObject({
      items: [{
        item_id: 'tool-a', tool_id: 'call-a', tool_name: 'terminal.exec',
        label: 'printf hello', description: 'Command completed', renderer: 'terminal',
        chips: [{ kind: 'status', label: 'done', tone: 'positive' }],
        target_refs: [{ kind: 'process', label: 'shell', uri: 'process://shell', line: 0 }],
        payload: { command: 'printf hello', exit_code: 0 },
        metadata: { source: 'runtime' },
      }],
    });
  });

  it.each([
    { name: 'approved', approved: true, outcome: '', status: 'success', severity: 'normal', requiresApproval: true },
    { name: 'rejected', approved: false, outcome: '', status: 'declined', severity: 'quiet', requiresApproval: false },
    { name: 'canceled', approved: undefined, outcome: 'cancelled', status: 'canceled', severity: 'warning', requiresApproval: true },
  ] as const)('merges a resolved $name approval into its canonical tool row', ({ name, approved, outcome, status, severity, requiresApproval }) => {
    const interaction = {
    id: 'approval-a', turn_id: 'turn-a', run_id: 'run-a', kind: 'approval' as const, tool_call_id: 'call-a', resolved: true,
      ...(approved !== undefined ? { approved } : {}),
      approval: { label: 'Run curl', tool_name: 'terminal.exec', tool_call_id: 'call-a' },
      resolution: {
        accepted: outcome !== 'cancelled',
        ...(approved !== undefined ? { approved } : {}),
        ...(outcome ? { outcome } : {}),
      },
    };
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 10, last_outcome: 'completed', turn_id: 'turn-a',
      interactions: [interaction],
      items: [
    { id: 'interaction-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'interaction', interaction },
        {
      id: 'tool-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 2, kind: 'tool', activity: {
            item_id: 'tool-a', tool_id: 'call-a', tool_name: 'terminal.exec', kind: 'tool',
            status: 'success', severity: 'normal', needs_attention: false, requires_approval: false,
            presentation: {
              label: 'curl -s https://example.test', renderer: 'terminal',
              payload: { command: 'curl -s https://example.test', exit_code: 0 },
            },
          },
        },
      ],
    };

    const result = applyFlowerRuntimeCurrentView(summary(), current);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ id: 'tool-a' });
    expect(result.messages[0]?.blocks?.[0]).toMatchObject({
      items: [{
        tool_id: 'call-a', status, severity, requires_approval: requiresApproval,
        approval_state: name, renderer: 'terminal',
        payload: { command: 'curl -s https://example.test', exit_code: 0 },
      }],
    });
  });

  it('does not merge or render a resolved approval without a matching canonical tool id', () => {
    const interaction = {
    id: 'approval-other', turn_id: 'turn-a', run_id: 'run-a', kind: 'approval' as const, tool_call_id: 'call-other', resolved: true,
      approved: false,
      approval: { label: 'Other command', tool_name: 'terminal.exec', tool_call_id: 'call-other' },
      resolution: { accepted: true, approved: false },
    };
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 10, last_outcome: 'completed', turn_id: 'turn-a',
      interactions: [interaction],
      items: [
    { id: 'interaction-other', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'interaction', interaction },
        {
      id: 'tool-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 2, kind: 'tool', activity: {
            item_id: 'tool-a', tool_id: 'call-a', tool_name: 'terminal.exec', kind: 'tool',
            status: 'success', severity: 'normal', needs_attention: false, requires_approval: false,
            presentation: {
              label: 'curl -s https://example.test', renderer: 'terminal',
              payload: { command: 'curl -s https://example.test', exit_code: 0 },
            },
          },
        },
      ],
    };

    const result = applyFlowerRuntimeCurrentView(summary(), current);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ id: 'tool-a' });
    expect(result.messages[0]?.blocks?.[0]).toMatchObject({
      items: [{ tool_id: 'call-a', status: 'success', renderer: 'terminal' }],
    });
    expect(result.messages[0]?.blocks?.[0]).not.toMatchObject({ items: [{ approval_state: 'rejected' }] });

    const withoutCanonicalTool = applyFlowerRuntimeCurrentView(summary(), {
      ...current,
    items: [{ id: 'interaction-other', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'interaction', interaction }],
    });
    expect(withoutCanonicalTool.messages).toEqual([]);
  });

  it('projects typed file-action target references into view-local action controls', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 11, last_outcome: 'completed', turn_id: 'turn-a',
      items: [{
    id: 'tool-entry-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'tool',
        activity: {
          item_id: 'tool-a', tool_id: 'call-a', tool_name: 'file.read', kind: 'tool',
          status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
          presentation: {
            label: 'app.ts', renderer: 'file',
            target_refs: [{ kind: 'file', label: 'app.ts', path:'/workspace/app.ts' }],
            payload: { operation: 'read', display_name: 'app.ts' },
          },
        },
      }],
    };

    const result = applyFlowerRuntimeCurrentView(summary(), current);

    expect(result.messages[0]).toMatchObject({ id: 'tool-entry-a' });
    expect(result.messages[0]?.blocks?.[0]).toMatchObject({
      items: [{target_refs:[{kind:'file',label:'app.ts',path:'/workspace/app.ts'}]}],
    });
  });

  it('projects accepted input as an ordered question-and-answer receipt', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 10, last_outcome: 'completed', turn_id: 'turn-a',
      items: [{
    id: 'interaction-answer', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'interaction',
        interaction: {
      id: 'input-a', turn_id: 'turn-a', run_id: 'run-a', kind: 'input', resolved: true,
          input: {
            summary: 'Two questions',
            questions: [
              { id: 'zeta', prompt: 'Second question?', kind: 'write' },
              { id: 'alpha', prompt: 'First question?', kind: 'write' },
            ],
          },
          resolution: { accepted: true, input: { zeta: 'second', alpha: 'first' } },
        },
      }],
    };

    const result = applyFlowerRuntimeCurrentView(summary(), current);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: 'interaction-answer',
      role: 'user',
      content: 'Second question?\nsecond\n\nFirst question?\nfirst',
      blocks: [{
        type: 'input-response',
        questions: [
          { question_id: 'zeta', question: 'Second question?', answer: 'second' },
          { question_id: 'alpha', question: 'First question?', answer: 'first' },
        ],
      }],
    });
  });

  it('keeps secret input questions visible without projecting their answers', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 10, last_outcome: 'completed', turn_id: 'turn-a',
      items: [{
        id: 'interaction-secret', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'interaction',
        interaction: {
          id: 'input-secret', turn_id: 'turn-a', run_id: 'run-a', kind: 'input', resolved: true,
          input: {
            summary: 'Secret question',
            questions: [{ id: 'token', prompt: 'Paste the deployment token.', kind: 'write', secret: true }],
          },
          resolution: { accepted: true, redacted: true },
        },
      }],
    };

    const result = applyFlowerRuntimeCurrentView(summary(), current);

    expect(result.messages[0]).toMatchObject({
      content: 'Paste the deployment token.',
      blocks: [{
        type: 'input-response',
        questions: [{ question_id: 'token', question: 'Paste the deployment token.', redacted: true }],
      }],
    });
    expect(JSON.stringify(result.messages[0])).not.toContain('secret-value');
  });

  it('rejects malformed presentation fields from typed activity items', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 11, last_outcome: 'completed', turn_id: 'turn-a',
      items: [{
    id: 'tool-a', turn_id: 'turn-a', run_id: 'run-a', ordinal: 1, kind: 'tool',
        activity: {
          item_id: 'tool-a', kind: 'tool', status: 'success', severity: 'quiet',
          needs_attention: false, requires_approval: false,
          presentation: {
            label: 'read app.ts', renderer: 'file',
            target_refs: [{ kind: 'file', label: 'app.ts', line: '12' }],
          },
        },
      }],
    };

    expect(() => applyFlowerRuntimeCurrentView(summary(), current)).toThrow(
      'Flower contract error: activity_item.presentation.target_refs[0].line must be a non-negative integer.',
    );
  });

  it('replaces pending approval and input state from typed interactions', () => {
    const base: FlowerThreadSnapshot = {
      ...summary(), status: 'waiting_approval', approval_pending: true, approval_pending_count: 2,
      approval_actions: [
        {
          action_id: 'approval-a', origin: 'main_tool', run_id: 'turn-a', tool_id: 'tool-a', tool_name: 'terminal.exec',
          state: 'requested', status: 'pending', requested_at_ms: 1, can_approve: true,
          queue_order: 1, summary: { label: 'first' },
        },
        {
          action_id: 'approval-b', origin: 'main_tool', run_id: 'turn-a', tool_id: 'tool-b', tool_name: 'terminal.exec',
          state: 'requested', status: 'pending', requested_at_ms: 1, can_approve: true,
          queue_order: 2, summary: { label: 'second' },
        },
      ],
      input_request: { prompt_id: 'input-a', message_id: 'message-a', tool_id: 'ask-a', tool_name: 'ask_user', questions: [] },
    };
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 10, activity: 'active', run_id: 'run-a', turn_id: 'turn-a',
      interactions: [
    { id: 'approval-a', turn_id: 'turn-a', run_id: 'run-a', kind: 'approval', tool_call_id: 'tool-a', resolved: true, approved: false },
        {
      id: 'approval-b', turn_id: 'turn-a', run_id: 'run-a', kind: 'approval', tool_call_id: 'tool-b',
          approval: { label: 'second', tool_name: 'terminal.exec', tool_call_id: 'tool-b' },
        },
    { id: 'input-a', turn_id: 'turn-a', run_id: 'run-a', kind: 'input', resolved: true },
      ],
    };

    const result = applyFlowerRuntimeCurrentView(base, current);
    expect(result.approval_actions?.map((action) => action.action_id)).toEqual(['approval-b']);
    expect(result.approval_pending_count).toBe(1);
    expect(result.input_request).toBeUndefined();
    expect(result.status).toBe('waiting_approval');
  });

  it('projects an unresolved approval as the composer authority instead of model thinking', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 11, activity: 'active', run_id: 'run-a', turn_id: 'turn-a',
      interactions: [{
    id: 'approval-a', turn_id: 'turn-a', run_id: 'run-a', kind: 'approval', tool_call_id: 'tool-a',
        approval: { label: 'Run command', tool_name: 'terminal.exec', tool_call_id: 'tool-a' },
      }],
    });

    expect(result.status).toBe('waiting_approval');
    expect(result.approval_pending).toBe(true);
    expect(result.approval_pending_count).toBe(1);
    expect(result.approval_actions).toHaveLength(1);
    expect(result.run_progress).toBeNull();
  });

  it('decodes typed approval targets without exposing Floret target encoding', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 12, activity: 'active', run_id: 'run-a', turn_id: 'turn-a',
      interactions: [{
    id: 'approval-file', turn_id: 'turn-a', run_id: 'run-a', kind: 'approval', tool_call_id: 'tool-file',
        approval: {
          label: 'Edit file', tool_name: 'file.write', tool_call_id: 'tool-file', effects: ['write'],
          targets: ['file:回声之王.md', 'working_directory:/workspace:with:colons'],
        },
      }],
    });

    expect(result.approval_actions?.[0]?.summary.targets).toEqual([
      { kind: 'file', label: '回声之王.md' },
      { kind: 'working_directory', label: '/workspace:with:colons' },
    ]);
    expect(JSON.stringify(result.approval_actions)).not.toContain('file:回声之王.md');
  });
});

describe('canonical turn facts', () => {
  const current = (): FlowerRuntimeCurrentView => ({
    thread_id: 'thread-a', view_version: 5, activity: 'idle', turn_id: 'new', run_id: 'new-run', last_outcome: 'completed',
    items: [
      { id: 'old-text', turn_id: 'old', run_id: 'old-run', ordinal: 1, kind: 'assistant', text: 'Partial' },
      { id: 'final-a', turn_id: 'new', run_id: 'new-run', ordinal: 2, kind: 'assistant', text: 'First' },
      { id: 'final-b', turn_id: 'new', run_id: 'new-run', ordinal: 3, kind: 'assistant', text: 'Second' },
    ],
    turns: [
      { turn_id: 'old', run_id: 'old-run', started_at: '2026-10-11T12:00:00Z', ended_at: '2026-10-11T12:00:05Z', outcome: 'interrupted', elapsed_ms: 5000, waiting_ms: 0, work_duration_ms: 5000, final_item_ids: [], final_boundary_complete: false },
      { turn_id: 'new', run_id: 'new-run', started_at: '2026-10-11T12:00:10Z', ended_at: '2026-10-11T12:00:20Z', outcome: 'completed', elapsed_ms: 10000, waiting_ms: 2000, work_duration_ms: 8000, final_item_ids: ['final-a', 'final-b'], final_boundary_complete: true },
    ],
  });
  it('preserves historical interruption and all explicit final segments', () => {
    const source = current();
    const mapped = applyFlowerRuntimeCurrentView(summary(), source);
    expect(mapped.turns).toEqual(source.turns);
    expect(mapped.turns?.[0].outcome).toBe('interrupted');
    expect(mapped.turns?.[1].final_item_ids).toEqual(['final-a', 'final-b']);
    expect(mapped.turns).not.toBe(source.turns);
  });
  it('rejects an ambiguous final identity rather than hiding the wrong segment', () => {
    const source = current();
    expect(() => applyFlowerRuntimeCurrentView(summary(), { ...source, items: [
      { ...source.items![1], text: 'Intermediate progress' }, ...source.items!,
    ] })).toThrow(/canonical turn presentation/);
  });
  it.each([
    { final_item_ids: ['old-text'] }, { final_item_ids: ['missing'] },
    { final_item_ids: ['final-b', 'final-a'] }, { final_item_ids: ['final-a', 'final-a'] },
    { final_boundary_complete: false }, { waiting_ms: 3000 }, { elapsed_ms: -1 },
    { outcome: 'interrupted' as const }, { ended_at: undefined },
  ])('rejects invalid final boundaries or timing without guessing: %o', (change) => {
    const source = current();
    expect(() => applyFlowerRuntimeCurrentView(summary(), { ...source, turns: [source.turns![0], { ...source.turns![1], ...change }] })).toThrow(/canonical turn presentation/);
  });
});


it('retains one user message identity while canonical steering settles', () => {
  const base: FlowerRuntimeCurrentView = { thread_id: 'thread-a', view_version: 1, activity: 'idle', items: [
    { id: 'steer-a', kind: 'steering', text: 'Change the scope', turn_id: 'turn-a', run_id: 'run-a', ordinal: 2, steering: { status: 'pending' } },
  ] };
  const pending = applyFlowerRuntimeCurrentView(summary(), base);
  const applied = applyFlowerRuntimeCurrentView(pending, { ...base, view_version: 2, items: [{ ...base.items![0], steering: { status: 'applied' } }] });
  expect(pending.messages).toHaveLength(1);
  expect(pending.messages[0]).toMatchObject({ id: 'steer-a', role: 'user', content: 'Change the scope', steering: { status: 'pending' } });
  expect(applied.messages[0]).toMatchObject({ id: 'steer-a', role: 'user', steering: { status: 'applied' } });
  expect(flowerMessageSignature(pending.messages[0])).not.toBe(flowerMessageSignature(applied.messages[0]));
});

describe('canonical parent event array contract', () => {
  it.each([null, {}, { events: null }, { events: 'invalid' }])('rejects malformed parent event pages before cache publication: %j', parent_events => {
    const base = summary();
    const current = { thread_id: base.thread_id, view_version: 1, activity: 'idle', items: [], parent_events } as unknown as FlowerRuntimeCurrentView;
    expect(() => applyFlowerRuntimeCurrentView(base, current)).toThrow('Flower contract error:');
    expect(base.messages[0].content).toBe('old');
  });
  it('rejects wrong or missing page scope while preserving the accepted conversation', () => {
    const base = summary();
    for (const parent_events of [{ thread_id: 'other', events: [] }, { events: [] }]) {
      expect(() => applyFlowerRuntimeCurrentView(base, { thread_id: base.thread_id, view_version: 1, activity: 'idle', items: [], parent_events } as FlowerRuntimeCurrentView)).toThrow('Flower contract error:');
    }
    expect(base.messages[0].content).toBe('old');
  });
  it('preserves a real serialized empty page and the disabled capability', () => {
    const base = summary();
    const current = JSON.parse(JSON.stringify({ thread_id: base.thread_id, view_version: 1, activity: 'idle', items: [], parent_events: { thread_id: base.thread_id, events: [] } })) as FlowerRuntimeCurrentView;
    expect(applyFlowerRuntimeCurrentView(base, current).parent_events?.events).toEqual([]);
    expect(applyFlowerRuntimeCurrentView(base, { ...current, parent_events: undefined }).parent_events).toBeUndefined();
  });
});

it('renders Goal facts before the first Turn and preserves their control identity', () => {
  const goal = { version: 1, text: 'Verify the result', status: 'active' as const, actor: 'user' as const };
  const change = { goal, operation: 'set' as const, actor: 'user' as const, at: '2026-10-18T00:00:00Z' };
  const current: FlowerRuntimeCurrentView = { thread_id: 'thread-a', view_version: 1, activity: 'idle', goal, items: [{ id: 'goal:a', ordinal: 1, kind: 'goal', goal: change }] };
  const next = applyFlowerRuntimeCurrentView(summary(), current);
  expect(next.goal).toEqual(goal);
  expect(next.messages).toHaveLength(1);
  expect(next.messages[0]).toMatchObject({ role: 'system', goal: change });
  expect(next.messages[0].turn_id).toBeUndefined();
  expect(next.messages[0].run_id).toBeUndefined();
  const entries = buildFlowerTimelineEntries(next);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ type: 'message', message: { goal: change } });
});

describe('canonical original and Fork process regression', () => {
  it.each([0, 1, 2])('keeps the user before all six child dynamics and both intermediate bodies at Fork depth %s', depth => {
    const current = canonicalProcessFixture(depth);
    const snapshot = applyFlowerRuntimeCurrentView({ ...summary(), thread_id: current.thread_id, messages: [] }, current);
    const entries = buildFlowerTimelineEntries(snapshot);
    const group = projectFlowerTurnProcess(entries, snapshot.turns).groups.get('research-turn')!;
    expect(entries[0]).toMatchObject({ type: 'message', message: { id: 'research-user' } });
    expect(entries.findIndex(row => row.key === group.summaryKey)).toBe(1);
    expect(group.disclosure).toBe('manual');
    expect(group.parentEventCount).toBe(6);
    expect(group.processKeys).toHaveLength(10);
    expect(entries.filter(row => row.type === 'message' || row.type === 'parent_event').map(row => row.type === 'message' ? row.message.canonical_ordinal : row.event.canonical_ordinal))
      .toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(entries.map(row => row.key)).size).toBe(entries.length);
    expect(snapshot.messages.every(message => mapFlowerMessage({ ...message, timestamp: message.created_at_ms }).canonical_ordinal === message.canonical_ordinal)).toBe(true);
  });
  it.each(['overlap', 'wrong-run', 'out-of-order', 'duplicate', 'missing'] as const)('rejects %s intermediate authority before cache admission', invalid => {
    const current = canonicalProcessFixture();
    const references = invalid === 'out-of-order' ? ['research-progress', 'research-intro'] : invalid === 'duplicate' ? ['research-intro', 'research-intro'] : invalid === 'missing' ? ['missing'] : ['research-intro'];
    const turns = [{ ...current.turns![0], intermediate_item_ids: references,
      ...(invalid === 'overlap' ? { outcome: 'completed' as const, final_item_ids: ['research-intro'], final_boundary_complete: true } : {}) }];
    const items = current.items!.map(item => invalid === 'wrong-run' && item.id === 'research-intro' ? { ...item, run_id: 'foreign-run' } : item);
    expect(() => applyFlowerRuntimeCurrentView({ ...summary(), thread_id: current.thread_id }, { ...current, items, turns })).toThrow(/canonical turn presentation/);
  });
});
