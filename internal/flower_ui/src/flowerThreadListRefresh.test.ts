import { describe, expect, it } from 'vitest';

import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { mergeFlowerThreadListRefresh, mergeFlowerThreadListSummary } from './flowerThreadListRefresh';

function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-1',
    title: 'Thread',
    model_id: 'openai/gpt-5.2',
    working_dir: '/workspace',
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'success',
    source_label: 'This host',
    target_labels: [],
    messages: [{
      id: 'assistant-1',
      role: 'assistant',
      content: 'Loaded detail',
      status: 'complete',
      created_at_ms: 2,
    }],
    read_status: {
      is_unread: false,
      snapshot: {
        activity_revision: 1,
        last_message_at_unix_ms: 2,
        activity_signature: 'activity:1',
      },
      read_state: {
        last_seen_activity_revision: 1,
        last_read_message_at_unix_ms: 2,
        last_seen_activity_signature: 'activity:1',
      },
    },
    ...overrides,
  };
}

describe('mergeFlowerThreadListRefresh', () => {
  it('keeps the selected thread object when only another thread changes', () => {
    const selected = thread({ thread_id: 'selected', title: 'Selected thread' });
    const background = thread({ thread_id: 'background', title: 'Background', updated_at_ms: 2 });
    const selectedSummary = {
      ...selected,
      target_labels: [],
      messages: [],
      input_request: undefined,
      error: undefined,
    };
    const backgroundChanged = {
      ...background,
      updated_at_ms: 3,
      messages: [],
      input_request: undefined,
      error: undefined,
    };

    const merged = mergeFlowerThreadListRefresh([selected, background], [selectedSummary, backgroundChanged], {
      selectedThreadID: 'selected',
    });

    expect(merged[0]).toBe(selected);
    expect(merged[1]).not.toBe(background);
  });

  it('preserves loaded summary details while detail reload is pending', () => {
    const existing = thread({
      status: 'waiting_approval',
      approval_actions: [{
        action_id: 'approval-1',
        run_id: 'run-1',
        tool_id: 'tool-1',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        requested_at_ms: 2,
        can_approve: true,
        summary: { label: 'Run terminal command' },
      }],
    });
    const summary = thread({
      messages: [],
      input_request: undefined,
      error: undefined,
      status: 'waiting_approval',
      updated_at_ms: 3,
    });

    const merged = mergeFlowerThreadListSummary(summary, existing);

    expect(merged.messages).toBe(existing.messages);
    expect(merged.approval_actions).toBe(existing.approval_actions);
    expect(merged.input_request).toBeUndefined();
  });

  it('preserves loaded failure details only while the summary remains failed', () => {
    const existing = thread({
      status: 'failed',
      error: { code: 'failed', message: 'Provider failed.' },
    });
    const failedSummary = thread({
      messages: [],
      input_request: undefined,
      error: undefined,
      status: 'failed',
      updated_at_ms: 3,
    });
    const successSummary = {
      ...failedSummary,
      status: 'success' as const,
      updated_at_ms: 4,
    };

    expect(mergeFlowerThreadListSummary(failedSummary, existing).error).toBe(existing.error);
    expect(mergeFlowerThreadListSummary(successSummary, existing).error).toBeUndefined();
  });

  it('drops stale approval actions when the summary is no longer waiting for approval', () => {
    const existing = thread({
      status: 'waiting_approval',
      approval_actions: [{
        action_id: 'approval-1',
        run_id: 'run-1',
        tool_id: 'tool-1',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        requested_at_ms: 2,
        can_approve: true,
        summary: { label: 'Run terminal command' },
      }],
    });
    const summary = thread({
      messages: [],
      approval_actions: [],
      input_request: undefined,
      error: undefined,
      status: 'running',
      updated_at_ms: 3,
    });

    const merged = mergeFlowerThreadListSummary(summary, existing);

    expect(merged.approval_actions).toEqual([]);
  });

  it('treats null summary prompt and error fields as summary-only absence', () => {
    const existing = thread({
      status: 'failed',
      error: { code: 'failed', message: 'Provider failed.' },
    });
    const summary = thread({
      messages: [],
      input_request: null,
      error: null,
      status: 'failed',
      updated_at_ms: 3,
    });

    const merged = mergeFlowerThreadListRefresh([existing], [summary]);

    expect(merged[0]?.messages).toBe(existing.messages);
    expect(merged[0]?.error).toBe(existing.error);
  });

  it('drops stale input requests when a summary-only refresh reports a terminal thread', () => {
    const existing = thread({
      status: 'waiting_user',
      input_request: {
        prompt_id: 'prompt-1',
        message_id: 'assistant-1',
        tool_id: 'tool-ask',
        tool_name: 'ask_user',
        questions: [],
      },
    });
    const summary = thread({
      messages: [],
      input_request: undefined,
      error: undefined,
      status: 'success',
      updated_at_ms: 3,
    });

    const merged = mergeFlowerThreadListSummary(summary, existing);

    expect(merged.input_request).toBeUndefined();
  });

  it('preserves waiting input requests only while the summary is still waiting for the user', () => {
    const existing = thread({
      status: 'waiting_user',
      input_request: {
        prompt_id: 'prompt-1',
        message_id: 'assistant-1',
        tool_id: 'tool-ask',
        tool_name: 'ask_user',
        questions: [],
      },
    });
    const waitingSummary = thread({
      messages: [],
      input_request: undefined,
      error: undefined,
      status: 'waiting_user',
      updated_at_ms: 3,
      read_status: {
        ...existing.read_status,
        snapshot: {
          ...existing.read_status.snapshot,
          waiting_prompt_id: 'prompt-1',
        },
      },
    });
    const runningSummary = {
      ...waitingSummary,
      status: 'running' as const,
      updated_at_ms: 4,
    };

    expect(mergeFlowerThreadListSummary(waitingSummary, existing).input_request).toBe(existing.input_request);
    expect(mergeFlowerThreadListSummary(runningSummary, existing).input_request).toBeUndefined();
  });

  it('drops stale input requests when the waiting prompt id changes', () => {
    const existing = thread({
      status: 'waiting_user',
      input_request: {
        prompt_id: 'prompt-old',
        message_id: 'assistant-1',
        tool_id: 'tool-ask',
        tool_name: 'ask_user',
        questions: [],
      },
    });
    const summary = thread({
      messages: [],
      input_request: undefined,
      error: undefined,
      status: 'waiting_user',
      updated_at_ms: 3,
      read_status: {
        ...existing.read_status,
        snapshot: {
          ...existing.read_status.snapshot,
          waiting_prompt_id: 'prompt-new',
        },
      },
    });

    expect(mergeFlowerThreadListSummary(summary, existing).input_request).toBeUndefined();
  });

  it('preserves approval-only selected details during summary-only refreshes', () => {
    const selected = thread({
      thread_id: 'selected-approval',
      status: 'waiting_approval',
      messages: [],
      approval_actions: [{
        action_id: 'approval-1',
        run_id: 'run-1',
        tool_id: 'tool-1',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        requested_at_ms: 2,
        can_approve: true,
        summary: { label: 'Run terminal command' },
      }],
    });
    const summary = thread({
      ...selected,
      messages: [],
      approval_actions: [],
      input_request: undefined,
      error: undefined,
      status: 'waiting_approval',
      updated_at_ms: 3,
    });

    const merged = mergeFlowerThreadListRefresh([selected], [summary], {
      selectedThreadID: 'selected-approval',
    });

    expect(merged[0]?.approval_actions).toBe(selected.approval_actions);
  });

  it('retains missing selected active threads until list summaries catch up', () => {
    const selected = thread({ thread_id: 'selected-running', status: 'running' });
    const other = thread({ thread_id: 'other' });

    const merged = mergeFlowerThreadListRefresh([selected, other], [other], {
      selectedThreadID: 'selected-running',
    });

    expect(merged).toContain(selected);
  });
});
