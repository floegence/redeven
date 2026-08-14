import { describe, expect, it } from 'vitest';
import type { FlowerRuntimeCurrentView, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';

const summary = (): FlowerThreadSnapshot => ({
  thread_id: 'thread-a', title: 'Product title', title_status: 'ready', model_id: 'deepseek/chat', working_dir: '/',
  created_at_ms: 1, updated_at_ms: 2, status: 'idle', source_label: 'Desktop', target_labels: ['local'],
  messages: [{ id: 'old', role: 'assistant', content: 'old', status: 'complete', created_at_ms: 1 }],
  read_status: { is_unread: false, snapshot: { activity_revision: 0, last_message_at_unix_ms: 0, activity_signature: '' }, read_state: { last_seen_activity_revision: 0, last_read_message_at_unix_ms: 0, last_seen_activity_signature: '' } },
});

describe('applyFlowerRuntimeCurrentView', () => {
  it('keeps product metadata while replacing detail with the typed current view', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 7, activity: 'active', turn_id: 'turn-a',
      items: [{ id: 'user-a', turn_id: 'turn-a', kind: 'user', text: 'hello' }],
      assistant_draft: 'working',
    };
    const result = applyFlowerRuntimeCurrentView(summary(), current);
    expect(result.model_id).toBe('deepseek/chat');
    expect(result.working_dir).toBe('/');
    expect(result.status).toBe('running');
    expect(result.messages.map((message) => message.content)).toEqual(['hello', 'working']);
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
      items: [{ id: 'user:active', turn_id: 'turn-a', kind: 'user', text: 'active work' }],
      queue: [
        { request_key: 'queued-first', input: { text: 'first queued' } },
        { request_key: 'queued-second', input: { text: 'second queued' } },
      ],
    };

    const result = applyFlowerRuntimeCurrentView(summary(), current);
    expect(result.messages.map((message) => message.content)).toEqual(['active work']);
    expect(result.queued_turns).toEqual([
      { queue_id: 'queued-first', prompt: 'first queued', created_at_ms: result.updated_at_ms },
      { queue_id: 'queued-second', prompt: 'second queued', created_at_ms: result.updated_at_ms },
    ]);
    expect(result.queued_turn_count).toBe(2);
  });

  it('keeps declined tools quiet and terminal in their own timeline row', () => {
    const current: FlowerRuntimeCurrentView = {
      thread_id: 'thread-a', view_version: 9, last_outcome: 'completed',
      items: [{ id: 'tool-a', turn_id: 'turn-a', kind: 'tool', activity: {
        item_id: 'tool-a', kind: 'tool', status: 'declined', severity: 'quiet', needs_attention: false,
        requires_approval: true, approval_state: 'rejected',
      } }],
    };
    const result = applyFlowerRuntimeCurrentView(summary(), current);
    expect(result.status).toBe('success');
    expect(result.error).toBeUndefined();
    expect(result.messages[0]?.blocks?.[0]).toMatchObject({ items: [{ status: 'declined', severity: 'quiet', approval_state: 'rejected' }] });
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
});
