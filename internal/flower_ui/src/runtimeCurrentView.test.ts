import { describe, expect, it } from 'vitest';
import type { FlowerRuntimeCurrentView, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';

const summary = (): FlowerThreadSnapshot => ({
  thread_id: 'thread-a', title: 'Product title', title_status: 'ready', model_id: 'deepseek/chat', working_dir: '/',
  settings_revision: 1,
  created_at_ms: 1, updated_at_ms: 2, status: 'idle', source_label: 'Desktop', target_labels: ['local'],
  messages: [{ id: 'old', role: 'assistant', content: 'old', status: 'complete', created_at_ms: 1 }],
  read_status: { is_unread: false, snapshot: { activity_revision: 0, last_message_at_unix_ms: 0, activity_signature: '' }, read_state: { last_seen_activity_revision: 0, last_read_message_at_unix_ms: 0, last_seen_activity_signature: '' } },
});

describe('applyFlowerRuntimeCurrentView', () => {
  it('keeps product metadata while replacing detail with the typed current view', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 7, activity: 'active', turn_id: 'turn-a',
      items: [{ id: 'user-a', turn_id: 'turn-a', ordinal: 1, kind: 'user', text: 'hello' }],
      assistant_draft: 'deprecated assistant draft must not render',
      thinking_draft: 'deprecated thinking draft must not render',
    };
    const result = applyFlowerRuntimeCurrentView(summary(), current);
    expect(result.model_id).toBe('deepseek/chat');
    expect(result.working_dir).toBe('/');
    expect(result.status).toBe('running');
    expect(result.messages.map((message) => message.content)).toEqual(['hello']);
    expect(result.model_io_status).toMatchObject({ phase: 'streaming', run_id: 'turn-a' });
  });

  it('clears the derived model status after the runtime settles', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 8, activity: 'idle', turn_id: 'turn-a', last_outcome: 'completed',
      items: [{ id: 'assistant:turn-a:1', turn_id: 'turn-a', ordinal: 1, kind: 'assistant', text: 'done' }],
    });

    expect(result.model_io_status).toBeNull();
  });

  it('keeps a runtime failure visible in the thread error projection', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 8, activity: 'idle', turn_id: 'turn-a',
      last_outcome: 'failed', error: 'Desktop model source disconnected.',
      items: [{ id: 'user:turn-a', turn_id: 'turn-a', ordinal: 1, kind: 'user', text: 'hello' }],
    });

    expect(result.status).toBe('failed');
    expect(result.error).toEqual({
      code: 'floret_turn_failed',
      message: 'Desktop model source disconnected.',
    });
  });

  it('does not render a duplicated current item twice', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 9, activity: 'idle', turn_id: 'turn-a', last_outcome: 'completed',
      items: [
        { id: 'assistant:turn-a:1', turn_id: 'turn-a', ordinal: 1, kind: 'assistant', text: 'same reply' },
        { id: 'assistant:turn-a:1', turn_id: 'turn-a', ordinal: 2, kind: 'assistant', text: 'same reply' },
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
        { id: 'assistant:turn-a:1', turn_id: 'turn-a', ordinal: 1, kind: 'assistant', text: repeated },
        { id: 'assistant:turn-a:2', turn_id: 'turn-a', ordinal: 2, kind: 'assistant', text: repeated },
      ],
    });

    expect(result.messages.map((message) => message.id)).toEqual(['assistant:turn-a:1', 'assistant:turn-a:2']);
  });

  it('keeps user messages with different request identities even when text repeats', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 11, activity: 'active', turn_id: 'turn-b',
      items: [
        { id: 'user:request-a', turn_id: 'turn-a', ordinal: 1, kind: 'user', text: 'same message' },
        { id: 'user:request-b', turn_id: 'turn-b', ordinal: 2, kind: 'user', text: 'same message' },
      ],
    });

    expect(result.messages.map((message) => message.id)).toEqual(['user:request-a', 'user:request-b']);
  });

  it('projects ordered current attachments as image and file blocks without duplicate reference chips', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 12, activity: 'idle', turn_id: 'turn-a', last_outcome: 'completed',
      items: [{
        id: 'user:turn-a', turn_id: 'turn-a', ordinal: 1, kind: 'user', text: 'inspect these',
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
      thread_id: 'thread-a', view_version: 13, activity: 'active', turn_id: 'turn-a',
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

  it('projects an interrupted runtime outcome as a visible failed turn', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 8, activity: 'idle', turn_id: 'turn-a', last_outcome: 'interrupted',
      items: [{ id: 'assistant:turn-a:1', turn_id: 'turn-a', ordinal: 1, kind: 'assistant', text: 'partial output' }],
    });

    expect(result.status).toBe('failed');
    expect(result.messages[0]).toMatchObject({ id: 'assistant:turn-a:1', status: 'error' });
  });

  it('uses the explicit live item marker as the only streaming authority', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 9, activity: 'active', turn_id: 'turn-a',
      items: [
        { id: 'assistant:turn-a:1', turn_id: 'turn-a', ordinal: 1, kind: 'assistant', text: 'sealed segment' },
        { id: 'assistant:turn-a:2', turn_id: 'turn-a', ordinal: 2, kind: 'assistant', text: 'live segment', live: true },
      ],
    });

    expect(result.messages).toMatchObject([
      { id: 'assistant:turn-a:1', status: 'complete' },
      { id: 'assistant:turn-a:2', status: 'streaming', live: true, active_cursor: true },
    ]);
  });

  it('preserves Floret ordered segments and stable IDs through approval, completion, and reload', () => {
    const tool = (id: string, ordinal: number, status: 'waiting' | 'running' | 'success') => ({
      id: `tool:turn-a:${id}`, turn_id: 'turn-a', ordinal, kind: 'tool' as const,
      activity: {
        item_id: id, tool_id: id, tool_name: 'terminal.exec', kind: 'tool', status,
        severity: status === 'waiting' ? 'blocking' : 'normal', needs_attention: status === 'waiting',
        requires_approval: status === 'waiting',
      },
    });
    const ordered = [
      { id: 'user:turn-a', turn_id: 'turn-a', ordinal: 1, kind: 'user' as const, text: 'run two tools' },
      { id: 'thinking:turn-a:1', turn_id: 'turn-a', ordinal: 2, kind: 'thinking' as const, text: 'first reasoning', live: true },
      tool('call-1', 3, 'waiting'),
      { id: 'thinking:turn-a:2', turn_id: 'turn-a', ordinal: 4, kind: 'thinking' as const, text: 'second reasoning', live: true },
      tool('call-2', 5, 'waiting'),
      { id: 'assistant:turn-a:1', turn_id: 'turn-a', ordinal: 6, kind: 'assistant' as const, text: 'done', live: true },
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
        ...(index === stages.length - 1 ? { last_outcome: 'completed' as const } : {}),
        items,
        assistant_draft: 'deprecated assistant draft must not render',
        thinking_draft: 'deprecated thinking draft must not render',
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
      thread_id: 'thread-a', view_version: 8, activity: 'active',
      interactions: [
        { id: 'approval-a', kind: 'approval' },
        { id: 'input-a', kind: 'input', signal: { name: 'ask_user', call_id: 'input-a' } },
      ],
    };
    expect(applyFlowerRuntimeCurrentView(summary(), current).status).toBe('waiting_user');
  });

  it('renders accepted busy input only in the typed runtime queue', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 8, activity: 'active',
      items: [{ id: 'user:active', turn_id: 'turn-a', ordinal: 1, kind: 'user', text: 'active work' }],
      queue: [
        { id: 'queue:queued-first', request_key: 'queued-first', input: { text: 'first queued' } },
        { id: 'queue:queued-second', request_key: 'queued-second', input: { text: 'second queued' } },
      ],
    };

    const result = applyFlowerRuntimeCurrentView(summary(), current);
    expect(result.messages.map((message) => message.content)).toEqual(['active work']);
    expect(result.queued_turns).toEqual([
      { queue_id: 'queue:queued-first', prompt: 'first queued', created_at_ms: result.updated_at_ms },
      { queue_id: 'queue:queued-second', prompt: 'second queued', created_at_ms: result.updated_at_ms },
    ]);
    expect(result.queued_turn_count).toBe(2);
  });

  it('keeps declined tools quiet and terminal in their own timeline row', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 9, last_outcome: 'completed',
      items: [{ id: 'tool-a', turn_id: 'turn-a', ordinal: 1, kind: 'tool', activity: {
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
        id: 'tool-a', turn_id: 'turn-a', ordinal: 1, kind: 'tool',
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
      id: 'approval-a', turn_id: 'turn-a', kind: 'approval' as const, tool_call_id: 'call-a', resolved: true,
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
        { id: 'interaction-a', turn_id: 'turn-a', ordinal: 1, kind: 'interaction', interaction },
        {
          id: 'tool-a', turn_id: 'turn-a', ordinal: 2, kind: 'tool', activity: {
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
      id: 'approval-other', turn_id: 'turn-a', kind: 'approval' as const, tool_call_id: 'call-other', resolved: true,
      approved: false,
      approval: { label: 'Other command', tool_name: 'terminal.exec', tool_call_id: 'call-other' },
      resolution: { accepted: true, approved: false },
    };
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 10, last_outcome: 'completed', turn_id: 'turn-a',
      interactions: [interaction],
      items: [
        { id: 'interaction-other', turn_id: 'turn-a', ordinal: 1, kind: 'interaction', interaction },
        {
          id: 'tool-a', turn_id: 'turn-a', ordinal: 2, kind: 'tool', activity: {
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
      items: [{ id: 'interaction-other', turn_id: 'turn-a', ordinal: 1, kind: 'interaction', interaction }],
    });
    expect(withoutCanonicalTool.messages).toEqual([]);
  });

  it('projects typed file-action target references into view-local action controls', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 11, last_outcome: 'completed', turn_id: 'turn-a',
      items: [{
        id: 'tool-entry-a', turn_id: 'turn-a', ordinal: 1, kind: 'tool',
        activity: {
          item_id: 'tool-a', tool_id: 'call-a', tool_name: 'file.read', kind: 'tool',
          status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
          presentation: {
            label: 'app.ts', renderer: 'file',
            target_refs: [{ kind: 'file_action:read_app', label: 'app.ts' }],
            payload: { operation: 'read', display_name: 'app.ts', file_action_id: 'read_app' },
          },
        },
      }],
    };

    const result = applyFlowerRuntimeCurrentView(summary(), current);

    expect(result.messages[0]).toMatchObject({ id: 'tool-entry-a' });
    expect(result.messages[0]?.blocks?.[0]).toMatchObject({
      file_actions: {
        read_app: { action_id: 'read_app', display_name: 'app.ts', can_preview: true, can_browse_directory: true },
      },
    });
  });

  it('orders resolved input answers by question key like the canonical adapter', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 10, last_outcome: 'completed', turn_id: 'turn-a',
      items: [{
        id: 'interaction-answer', turn_id: 'turn-a', ordinal: 1, kind: 'interaction',
        interaction: {
          id: 'input-a', turn_id: 'turn-a', kind: 'input', resolved: true,
          resolution: { accepted: true, input: { zeta: 'second', alpha: 'first' } },
        },
      }],
    };

    const result = applyFlowerRuntimeCurrentView(summary(), current);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ id: 'interaction-answer', role: 'user', content: 'first\nsecond' });
  });

  it('rejects malformed presentation fields from typed activity items', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 11, last_outcome: 'completed', turn_id: 'turn-a',
      items: [{
        id: 'tool-a', turn_id: 'turn-a', ordinal: 1, kind: 'tool',
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
      thread_id: 'thread-a', view_version: 10, activity: 'active', turn_id: 'turn-a',
      interactions: [
        { id: 'approval-a', kind: 'approval', tool_call_id: 'tool-a', resolved: true, approved: false },
        {
          id: 'approval-b', kind: 'approval', tool_call_id: 'tool-b',
          approval: { label: 'second', tool_name: 'terminal.exec', tool_call_id: 'tool-b' },
        },
        { id: 'input-a', kind: 'input', resolved: true },
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
      thread_id: 'thread-a', view_version: 11, activity: 'active', turn_id: 'turn-a',
      interactions: [{
        id: 'approval-a', kind: 'approval', tool_call_id: 'tool-a',
        approval: { label: 'Run command', tool_name: 'terminal.exec', tool_call_id: 'tool-a' },
      }],
    });

    expect(result.status).toBe('waiting_approval');
    expect(result.approval_pending).toBe(true);
    expect(result.approval_pending_count).toBe(1);
    expect(result.approval_actions).toHaveLength(1);
    expect(result.model_io_status).toBeNull();
  });

  it('decodes typed approval targets without exposing Floret target encoding', () => {
    const result = applyFlowerRuntimeCurrentView(summary(), {
      thread_id: 'thread-a', view_version: 12, activity: 'active', turn_id: 'turn-a',
      interactions: [{
        id: 'approval-file', turn_id: 'turn-a', kind: 'approval', tool_call_id: 'tool-file',
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
