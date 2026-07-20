import { describe, expect, it } from 'vitest';

import type {
  FlowerApprovalAction,
  FlowerMainToolApprovalAction,
  FlowerInputRequest,
  FlowerSubagentSummary,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { mergeFlowerThreadListRefresh, sameThreadSnapshot } from './flowerThreadListRefresh';

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

function approvalAction(overrides: Partial<FlowerMainToolApprovalAction> = {}): FlowerApprovalAction {
  return {
    action_id: 'approval-1',
    origin: 'main_tool',
    run_id: 'run-1',
    tool_id: 'tool-shell',
    tool_name: 'shell',
    state: 'requested',
    status: 'pending',
    revision: 1,
    version: 1,
    requested_at_ms: 1,
    can_approve: true,
    summary: {
      label: 'Run command',
    },
    ...overrides,
  };
}

function subagentSummary(overrides: Partial<FlowerSubagentSummary> = {}): FlowerSubagentSummary {
  return {
    parent_thread_id: 'thread-selected',
    thread_id: 'thread-child-review',
    task_name: 'Review API',
    task_description: 'Review the public API boundary.',
    status: 'completed',
    can_send_input: false,
    can_interrupt: false,
    can_close: true,
    created_at_ms: 10,
    updated_at_ms: 20,
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

describe('mergeFlowerThreadListRefresh', () => {
  it('preserves loaded queued turn detail when a list summary only owns the count', () => {
    const queuedTurns = [{
      turn_id: 'turn-linked-file',
      prompt: 'Inspect this file',
      created_at_ms: 100,
      context_action: { schema_version: 2 },
    }];
    const existing = thread({
      thread_id: 'thread-selected',
      queued_turn_count: 1,
      queued_turns: queuedTurns,
    });
    const summary = thread({
      ...existing,
      updated_at_ms: 2,
      queued_turn_count: 1,
      queued_turns: undefined,
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [summary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(merged?.queued_turns).toBe(queuedTurns);
  });

  it('clears loaded queued turn detail when the summary count reaches zero', () => {
    const existing = thread({
      thread_id: 'thread-selected',
      queued_turn_count: 1,
      queued_turns: [{ turn_id: 'turn-1', prompt: 'Queued', created_at_ms: 100 }],
    });
    const summary = thread({
      ...existing,
      updated_at_ms: 2,
      queued_turn_count: 0,
      queued_turns: undefined,
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [summary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(merged?.queued_turns).toBeUndefined();
    expect(sameThreadSnapshot(existing, merged!)).toBe(false);
  });

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
      read_status: readStatus('prompt-from-summary'),
      error: undefined,
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [summary], {
      selectedThreadID: 'thread-selected',
      sameThreadSnapshot,
    });

    expect(merged?.title).toBe('Summary title');
    expect(merged?.updated_at_ms).toBe(20);
    expect(merged?.messages).toBe(existing.messages);
    expect(merged?.read_status).toBe(summary.read_status);
    expect(merged?.error).toBe(existing.error);
  });

  it('preserves selected thread subagents when a list summary omits them', () => {
    const existing = thread({
      thread_id: 'thread-selected',
      updated_at_ms: 10,
      messages: [{
        id: 'message-1',
        role: 'assistant',
        content: 'Loaded transcript detail',
        status: 'complete',
        created_at_ms: 10,
      }],
      subagents: [
        subagentSummary({ thread_id: 'thread-child-a', task_name: 'Research A' }),
        subagentSummary({ thread_id: 'thread-child-b', task_name: 'Research B' }),
      ],
    });
    const summaryWithInheritedSubagents = thread({
      ...existing,
      updated_at_ms: 20,
      messages: [],
      subagents: undefined,
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [summaryWithInheritedSubagents], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(merged?.updated_at_ms).toBe(20);
    expect(merged?.messages).toBe(existing.messages);
    expect(merged?.subagents).toBe(existing.subagents);
  });

  it('applies an explicit empty subagents list from a thread-owning refresh', () => {
    const existing = thread({
      thread_id: 'thread-selected',
      messages: [{
        id: 'message-1',
        role: 'assistant',
        content: 'Loaded transcript detail',
        status: 'complete',
        created_at_ms: 10,
      }],
      subagents: [subagentSummary()],
    });
    const refreshed = thread({
      ...existing,
      updated_at_ms: 20,
      messages: [],
      subagents: [],
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [refreshed], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(merged?.subagents).toEqual([]);
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

  it('preserves running live presentation state when a selected list summary omits it', () => {
    const existing = thread({
      thread_id: 'thread-selected',
      status: 'running',
      active_run_id: 'run-1',
      model_io_status: {
        phase: 'streaming',
        run_id: 'run-1',
        updated_at_ms: 20,
      },
      context_usage: {
        run_id: 'run-1',
        phase: 'projected_request',
        input_tokens: 700,
        context_window_tokens: 1000,
        used_ratio: 0.7,
        pressure_status: 'near_threshold',
        updated_at_ms: 21,
      },
      context_compactions: [{
        operation_id: 'compact-1',
        run_id: 'run-1',
        phase: 'start',
        status: 'compacting',
        updated_at_ms: 22,
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
          phase: 'start',
          status: 'compacting',
          updated_at_ms: 22,
        },
      }],
      messages: [{
        id: 'assistant-live',
        role: 'assistant',
        content: '',
        status: 'streaming',
        created_at_ms: 10,
        active_cursor: true,
      }],
    });
    const summary = thread({
      ...existing,
      updated_at_ms: 30,
      messages: [],
      active_run_id: undefined,
      model_io_status: undefined,
      context_usage: undefined,
      context_compactions: undefined,
      timeline_decorations: undefined,
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [summary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(merged?.messages).toBe(existing.messages);
    expect(merged?.active_run_id).toBe(existing.active_run_id);
    expect(merged?.model_io_status).toBe(existing.model_io_status);
    expect(merged?.context_usage).toBe(existing.context_usage);
    expect(merged?.context_compactions).toBe(existing.context_compactions);
    expect(merged?.timeline_decorations).toBe(existing.timeline_decorations);
  });

  it('keeps only the active run context usage when a summary reflects a new run', () => {
    const existing = thread({
      thread_id: 'thread-selected',
      status: 'running',
      active_run_id: 'run-old',
      context_usage: {
        run_id: 'run-old',
        phase: 'projected_request',
        input_tokens: 700,
        context_window_tokens: 1000,
        used_ratio: 0.7,
        pressure_status: 'near_threshold',
        updated_at_ms: 21,
      },
    });
    const summary = thread({
      ...existing,
      active_run_id: 'run-new',
      context_usage: {
        run_id: 'run-new',
        phase: 'projected_request',
        input_tokens: 100,
        context_window_tokens: 1000,
        used_ratio: 0.1,
        pressure_status: 'stable',
        updated_at_ms: 31,
      },
      messages: [],
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [summary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(merged?.active_run_id).toBe('run-new');
    expect(merged?.context_usage?.run_id).toBe('run-new');
    expect(merged?.context_usage?.used_ratio).toBe(0.1);
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

  it('keeps selected live approval detail when a list summary reports running', () => {
    const existing = thread({
      status: 'waiting_approval',
      approval_actions: [approvalAction()],
      approval_queue: {
        generation: 1,
        revision: 1,
        current_action_id: 'approval-1',
        current_position: 1,
        total: 1,
        unresolved_count: 1,
      },
    });
    const waitingSummary = thread({
      ...existing,
      messages: [],
      approval_actions: undefined,
      approval_queue: undefined,
      status: 'waiting_approval',
    });
    const runningSummary = thread({
      ...existing,
      messages: [],
      approval_actions: undefined,
      approval_queue: undefined,
      status: 'running',
    });
    const clearedSummary = thread({
      ...existing,
      messages: [],
      approval_actions: [],
      approval_queue: undefined,
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
    expect(waiting?.approval_queue).toBe(existing.approval_queue);
    expect(running?.status).toBe('waiting_approval');
    expect(running?.approval_actions).toBe(existing.approval_actions);
    expect(running?.approval_queue).toBe(existing.approval_queue);
    expect(cleared?.approval_actions).toEqual([]);
    expect(cleared?.approval_queue).toBeNull();
  });

  it('keeps a ten-item selected approval queue stable across repeated stale summaries', () => {
    const approvals = Array.from({ length: 10 }, (_, index) => approvalAction({
      action_id: `approval-${index + 1}`,
      queue_generation: 1,
      queue_order: index + 1,
      batch_index: index,
      batch_size: 10,
      can_approve: index === 0,
      surface_role: index === 0 ? 'primary_action' : 'locator',
    }));
    const existing = thread({
      thread_id: 'thread-ten-approvals',
      status: 'waiting_approval',
      approval_actions: approvals,
      approval_queue: {
        generation: 1,
        revision: 10,
        current_action_id: 'approval-1',
        current_position: 1,
        total: 10,
        unresolved_count: 10,
      },
    });
    const summary = thread({
      ...existing,
      status: 'running',
      messages: [],
      approval_actions: undefined,
      approval_queue: undefined,
    });

    const first = mergeFlowerThreadListRefresh([existing], [summary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });
    const second = mergeFlowerThreadListRefresh(first, [summary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(first).toBe(second);
    expect(first[0]).toBe(existing);
    expect(first[0]?.status).toBe('waiting_approval');
    expect(first[0]?.approval_actions).toHaveLength(10);
    expect(first[0]?.approval_queue).toBe(existing.approval_queue);
  });

  it('lets non-selected summaries replace stale approval detail', () => {
    const existing = thread({
      thread_id: 'thread-background-approval',
      status: 'waiting_approval',
      approval_actions: [approvalAction()],
      approval_queue: { generation: 1, revision: 1, current_action_id: 'approval-1', current_position: 1, total: 1, unresolved_count: 1 },
    });
    const summary = thread({
      ...existing,
      status: 'running',
      messages: [],
      approval_actions: undefined,
      approval_queue: undefined,
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [summary], {
      selectedThreadID: 'thread-other',
      sameThreadSnapshot,
    });

    expect(merged?.status).toBe('running');
    expect(merged?.approval_actions).toBeUndefined();
    expect(merged?.approval_queue).toBeUndefined();
  });

  it('treats a zero-unresolved queue as an authoritative approval clear', () => {
    const existing = thread({
      status: 'waiting_approval',
      approval_actions: [approvalAction()],
      approval_queue: { generation: 1, revision: 1, current_action_id: 'approval-1', current_position: 1, total: 1, unresolved_count: 1 },
    });
    const clearedQueue = { generation: 1, revision: 2, current_position: 0, total: 1, unresolved_count: 0 };
    const summary = thread({
      ...existing,
      status: 'running',
      messages: [],
      approval_actions: undefined,
      approval_queue: clearedQueue,
    });

    const [merged] = mergeFlowerThreadListRefresh([existing], [summary], {
      selectedThreadID: existing.thread_id,
      sameThreadSnapshot,
    });

    expect(merged?.status).toBe('running');
    expect(merged?.approval_actions).toEqual([]);
    expect(merged?.approval_queue).toBe(clearedQueue);
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
      pendingThreadIDs: [selected.thread_id],
      sameThreadSnapshot,
    });
    const dropped = mergeFlowerThreadListRefresh([selected, other], [other], {
      selectedThreadID: selected.thread_id,
      pendingThreadIDs: ['thread-different'],
      sameThreadSnapshot,
    });

    expect(retained.map((item) => item.thread_id)).toEqual(['thread-other', 'thread-pending-selected']);
    expect(retained[1]).toBe(selected);
    expect(dropped.map((item) => item.thread_id)).toEqual(['thread-other']);
  });
});

describe('sameThreadSnapshot', () => {
  it('treats live model and context presentation changes as distinct snapshots', () => {
    const base = thread({
      status: 'running',
      active_run_id: 'run-1',
      messages: [{
        id: 'assistant-live',
        role: 'assistant',
        content: '',
        status: 'streaming',
        created_at_ms: 10,
        active_cursor: true,
      }],
    });

    expect(sameThreadSnapshot(base, {
      ...base,
      model_io_status: {
        phase: 'waiting_response',
        run_id: 'run-1',
        updated_at_ms: 20,
      },
    })).toBe(false);
    expect(sameThreadSnapshot(base, {
      ...base,
      context_usage: {
        run_id: 'run-1',
        phase: 'projected_request',
        input_tokens: 700,
        context_window_tokens: 1000,
        used_ratio: 0.7,
        pressure_status: 'near_threshold',
        updated_at_ms: 21,
      },
    })).toBe(false);
    expect(sameThreadSnapshot(base, {
      ...base,
      context_compactions: [{
        operation_id: 'compact-1',
        run_id: 'run-1',
        phase: 'start',
        status: 'compacting',
        updated_at_ms: 22,
      }],
    })).toBe(false);
    expect(sameThreadSnapshot(base, {
      ...base,
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
          phase: 'start',
          status: 'compacting',
          updated_at_ms: 22,
        },
      }],
    })).toBe(false);
  });

  it('treats subagent summary changes as distinct snapshots', () => {
    const base = thread({
      subagents: [subagentSummary({ status: 'running', updated_at_ms: 20 })],
    });

    expect(sameThreadSnapshot(base, {
      ...base,
      subagents: [subagentSummary({ status: 'completed', updated_at_ms: 30 })],
    })).toBe(false);
    expect(sameThreadSnapshot(base, {
      ...base,
      subagents: [],
    })).toBe(false);
  });

  it('treats approval queue-only changes as distinct snapshots', () => {
    const base = thread({
      status: 'waiting_approval',
      approval_actions: [approvalAction()],
      approval_queue: { generation: 1, revision: 1, current_action_id: 'approval-1', current_position: 1, total: 2, unresolved_count: 2 },
    });

    expect(sameThreadSnapshot(base, {
      ...base,
      approval_queue: { ...base.approval_queue!, revision: 2, current_position: 2, unresolved_count: 1 },
    })).toBe(false);
    expect(sameThreadSnapshot(base, {
      ...base,
      approval_queue: null,
    })).toBe(false);
  });
});
