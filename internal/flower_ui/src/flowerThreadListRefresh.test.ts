import { describe, expect, it } from 'vitest';

import type {
  FlowerApprovalAction,
  FlowerInputRequest,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { mergeFlowerThreadListRefresh } from './flowerThreadListRefresh';

function readStatus(waitingPromptID = ''): FlowerThreadReadStatus {
  return {
    is_unread: false,
    snapshot: {
      activity_revision: 1,
      last_message_at_unix_ms: 1,
      activity_signature: 'sig-1',
      ...(waitingPromptID ? { waiting_prompt_id: waitingPromptID } : {}),
    },
    read_state: {
      last_seen_activity_revision: 1,
      last_read_message_at_unix_ms: 1,
      last_seen_activity_signature: 'sig-1',
    },
  };
}

function inputRequest(promptID: string): FlowerInputRequest {
  return {
    prompt_id: promptID,
    message_id: `message-${promptID}`,
    tool_id: 'tool-ask-user',
    tool_name: 'ask_user',
    questions: [{
      id: 'answer',
      header: 'Answer',
      question: 'Choose an answer',
      response_mode: 'write',
    }],
  };
}

function approvalAction(overrides: Partial<FlowerApprovalAction> = {}): FlowerApprovalAction {
  return {
    action_id: 'approval-1',
    run_id: 'run-1',
    tool_id: 'tool-shell',
    tool_name: 'shell',
    state: 'requested',
    status: 'pending',
    revision: 1,
    requested_at_ms: 1,
    can_approve: true,
    summary: {
      label: 'Run command',
    },
    ...overrides,
  };
}

function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-1',
    title: 'Thread',
    model_id: 'openai/gpt-5.2',
    working_dir: '/workspace',
    created_at_ms: 1,
    updated_at_ms: 1,
    status: 'idle',
    source_label: 'Local',
    target_labels: [],
    messages: [],
    read_status: readStatus(),
    ...overrides,
  };
}

const sameThreadSnapshot = (left: FlowerThreadSnapshot, right: FlowerThreadSnapshot): boolean => (
  JSON.stringify(left) === JSON.stringify(right)
);

describe('mergeFlowerThreadListRefresh', () => {
  it('keeps selected transcript detail while applying list-owned metadata', () => {
    const existing = thread({
      thread_id: 'thread-selected',
      title: 'Loaded title',
      status: 'running',
      updated_at_ms: 10,
      messages: [{
        id: 'message-1',
        role: 'assistant',
        content: 'Loaded transcript detail',
        status: 'complete',
        created_at_ms: 10,
      }],
      error: {
        code: 'provider_error',
        message: 'Loaded structured error',
      },
    });
    const summary = thread({
      ...existing,
      title: 'Summary title',
      updated_at_ms: 20,
      messages: [],
      error: undefined,
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [summary], {
      selectedThreadID: 'thread-selected',
      sameThreadSnapshot,
    });

    expect(merged?.title).toBe('Summary title');
    expect(merged?.updated_at_ms).toBe(20);
    expect(merged?.messages).toBe(existing.messages);
    expect(merged?.error).toBe(existing.error);
  });

  it('uses refreshed transcript detail when a selected refresh carries messages', () => {
    const existing = thread({
      thread_id: 'thread-selected',
      status: 'running',
      messages: [{
        id: 'message-old',
        role: 'assistant',
        content: 'Old transcript detail',
        status: 'streaming',
        created_at_ms: 10,
      }],
    });
    const refreshedMessages = [{
      id: 'message-new',
      role: 'assistant' as const,
      content: 'Fresh transcript detail',
      status: 'complete' as const,
      created_at_ms: 20,
    }];
    const refreshed = thread({
      ...existing,
      status: 'success',
      updated_at_ms: 20,
      messages: refreshedMessages,
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [refreshed], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(merged).toBe(refreshed);
    expect(merged?.messages).toBe(refreshedMessages);
    expect(merged?.messages[0]?.content).toBe('Fresh transcript detail');
  });

  it('clears old errors when a terminal summary no longer carries one', () => {
    const existing = thread({
      status: 'failed',
      messages: [{
        id: 'message-1',
        role: 'assistant',
        content: 'Loaded transcript detail',
        status: 'complete',
        created_at_ms: 10,
      }],
      error: {
        code: 'provider_error',
        message: 'Loaded structured error',
      },
    });
    const successSummary = thread({
      ...existing,
      status: 'success',
      messages: [],
      error: undefined,
    });
    const explicitClearSummary = thread({
      ...existing,
      status: 'running',
      messages: [],
      error: null,
    });

    const [success] = mergeFlowerThreadListRefresh([existing], [successSummary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });
    const [explicitClear] = mergeFlowerThreadListRefresh([existing], [explicitClearSummary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(success?.messages).toBe(existing.messages);
    expect(success?.error).toBeUndefined();
    expect(explicitClear?.messages).toBe(existing.messages);
    expect(explicitClear?.error).toBeNull();
  });

  it('preserves only the input request still named by the list read snapshot', () => {
    const existing = thread({
      status: 'waiting_user',
      input_request: inputRequest('prompt-current'),
      read_status: readStatus('prompt-current'),
    });
    const currentPromptSummary = thread({
      ...existing,
      messages: [],
      input_request: undefined,
      read_status: readStatus('prompt-current'),
    });
    const stalePromptSummary = thread({
      ...existing,
      messages: [],
      input_request: undefined,
      read_status: readStatus('prompt-next'),
    });
    const clearedPromptSummary = thread({
      ...existing,
      messages: [],
      input_request: null,
      read_status: readStatus('prompt-current'),
    });

    const [currentPrompt] = mergeFlowerThreadListRefresh([existing], [currentPromptSummary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });
    const [stalePrompt] = mergeFlowerThreadListRefresh([existing], [stalePromptSummary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });
    const [clearedPrompt] = mergeFlowerThreadListRefresh([existing], [clearedPromptSummary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(currentPrompt?.input_request).toBe(existing.input_request);
    expect(stalePrompt?.input_request).toBeUndefined();
    expect(clearedPrompt?.input_request).toBeNull();
  });

  it('uses input, approval, and error detail when the list refresh explicitly includes them', () => {
    const existing = thread({
      status: 'waiting_user',
      input_request: inputRequest('prompt-old'),
      approval_actions: [approvalAction({ action_id: 'approval-old' })],
      error: {
        code: 'old_error',
        message: 'Old error',
      },
      read_status: readStatus('prompt-new'),
    });
    const summaryInput = inputRequest('prompt-new');
    const summaryApproval = approvalAction({ action_id: 'approval-new' });
    const summary = thread({
      ...existing,
      status: 'waiting_approval',
      input_request: summaryInput,
      approval_actions: [summaryApproval],
      error: {
        code: 'new_error',
        message: 'New error',
      },
      read_status: readStatus('prompt-new'),
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [summary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(merged?.input_request).toBe(summaryInput);
    expect(merged?.approval_actions).toEqual([summaryApproval]);
    expect(merged?.error).toBe(summary.error);
  });

  it('keeps approval actions only while the summary status is waiting for approval', () => {
    const existing = thread({
      status: 'waiting_approval',
      approval_actions: [approvalAction()],
    });
    const waitingSummary = thread({
      ...existing,
      messages: [],
      approval_actions: undefined,
      status: 'waiting_approval',
    });
    const runningSummary = thread({
      ...existing,
      messages: [],
      approval_actions: undefined,
      status: 'running',
    });
    const clearedSummary = thread({
      ...existing,
      messages: [],
      approval_actions: [],
      status: 'waiting_approval',
    });

    const [waiting] = mergeFlowerThreadListRefresh([existing], [waitingSummary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });
    const [running] = mergeFlowerThreadListRefresh([existing], [runningSummary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });
    const [cleared] = mergeFlowerThreadListRefresh([existing], [clearedSummary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(waiting?.approval_actions).toBe(existing.approval_actions);
    expect(running?.approval_actions).toBeUndefined();
    expect(cleared?.approval_actions).toEqual([]);
  });

  it('retains an active selected thread that is missing from a transient list result', () => {
    const selected = thread({
      thread_id: 'thread-selected',
      status: 'running',
      messages: [{
        id: 'message-selected',
        role: 'assistant',
        content: 'Still visible',
        status: 'streaming',
        created_at_ms: 1,
      }],
    });
    const other = thread({ thread_id: 'thread-other' });

    const merged = mergeFlowerThreadListRefresh([selected, other], [other], {
      selectedThreadID: selected.thread_id,
      sameThreadSnapshot,
    });

    expect(merged.map((item) => item.thread_id)).toEqual(['thread-other', 'thread-selected']);
    expect(merged[1]).toBe(selected);
  });

  it('retains a selected pending thread missing from a transient list result', () => {
    const selected = thread({
      thread_id: 'thread-pending-selected',
      status: 'idle',
      messages: [],
    });
    const other = thread({ thread_id: 'thread-other' });

    const retained = mergeFlowerThreadListRefresh([selected, other], [other], {
      selectedThreadID: selected.thread_id,
      pendingThreadID: selected.thread_id,
      sameThreadSnapshot,
    });
    const dropped = mergeFlowerThreadListRefresh([selected, other], [other], {
      selectedThreadID: selected.thread_id,
      pendingThreadID: 'thread-different',
      sameThreadSnapshot,
    });

    expect(retained.map((item) => item.thread_id)).toEqual(['thread-other', 'thread-pending-selected']);
    expect(retained[1]).toBe(selected);
    expect(dropped.map((item) => item.thread_id)).toEqual(['thread-other']);
  });
});
