import { describe, expect, it } from 'vitest';

import type {
  FlowerSubagentSummary,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { buildFlowerSubagentPanelItems, presentSubagentTaskName } from './flowerSubagentProjection';

function summary(overrides: Partial<FlowerSubagentSummary>): FlowerSubagentSummary {
  const threadID = String(overrides.thread_id ?? 'child-1');
  return {
    parent_thread_id: 'parent-thread',
    thread_id: threadID,
    task_name: 'Review API',
    task_description: 'Review the public API boundary.',
    agent_type: 'reviewer',
    status: 'completed',
    can_send_input: false,
    can_interrupt: false,
    can_close: false,
    created_at_ms: 100,
    updated_at_ms: 200,
    ...overrides,
  };
}

function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'parent-thread',
    title: 'Parent',
    model_id: 'openai/gpt-5.2',
    working_dir: '/workspace/redeven',
    created_at_ms: 1,
    updated_at_ms: 20,
    status: 'idle',
    source_label: 'Local',
    target_labels: [],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 1, last_message_at_unix_ms: 20, activity_signature: 'sig' },
      read_state: { last_seen_activity_revision: 1, last_read_message_at_unix_ms: 20, last_seen_activity_signature: 'sig' },
    },
    messages: [],
    subagents: [],
    ...overrides,
  };
}

describe('buildFlowerSubagentPanelItems', () => {
  it('shows completed children from thread.subagents after a restart snapshot', () => {
    const items = buildFlowerSubagentPanelItems(thread({
      messages: [],
      subagents: [
        summary({ thread_id: 'child-1', task_name: 'Review API', status: 'completed', updated_at_ms: 410 }),
        summary({ thread_id: 'child-2', task_name: 'Check tests', status: 'completed', updated_at_ms: 420 }),
        summary({ thread_id: 'child-3', task_name: 'Audit docs', status: 'completed', updated_at_ms: 430 }),
        summary({ thread_id: 'child-4', task_name: 'Verify UX', status: 'completed', updated_at_ms: 440 }),
      ],
    }));

    expect(items).toHaveLength(4);
    expect(items.map((item) => item.threadID)).toEqual(['child-4', 'child-3', 'child-2', 'child-1']);
    expect(items.every((item) => item.canOpen)).toBe(true);
    expect(items.map((item) => item.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
  });

  it('keeps active subagents before terminal children and sorts each group by update time', () => {
    const items = buildFlowerSubagentPanelItems(thread({
      subagents: [
        summary({ thread_id: 'done-new', task_name: 'Done new', status: 'completed', updated_at_ms: 500 }),
        summary({ thread_id: 'running-old', task_name: 'Running old', status: 'running', updated_at_ms: 100 }),
        summary({ thread_id: 'waiting-new', task_name: 'Waiting new', status: 'waiting_input', updated_at_ms: 300 }),
        summary({ thread_id: 'queued-newest', task_name: 'Queued newest', status: 'queued', updated_at_ms: 600 }),
        summary({ thread_id: 'failed-old', task_name: 'Failed old', status: 'failed', updated_at_ms: 100 }),
        summary({ thread_id: 'done-old', task_name: 'Done old', status: 'completed', updated_at_ms: 200 }),
      ],
    }));

    expect(items.map((item) => [item.threadID, item.status])).toEqual([
      ['waiting-new', 'waiting_input'],
      ['running-old', 'running'],
      ['queued-newest', 'queued'],
      ['failed-old', 'failed'],
      ['done-new', 'completed'],
      ['done-old', 'completed'],
    ]);
  });

  it('does not scan transcript activity blocks for subagent panel state', () => {
    const items = buildFlowerSubagentPanelItems(thread({
      messages: [{
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        status: 'complete',
        created_at_ms: 20,
        blocks: [{
          type: 'activity-timeline',
          schema_version: 1,
          run_id: 'run-1',
          turn_id: 'turn-1',
          summary: { status: 'success', severity: 'quiet', needs_attention: false, total_items: 1, counts: { success: 1 } },
          items: [{
            item_id: 'subagent:legacy',
            tool_id: 'subagents',
            tool_name: 'subagents',
            kind: 'tool',
            status: 'success',
            severity: 'quiet',
            needs_attention: false,
            requires_approval: false,
            payload: {
              thread_id: 'legacy-child',
              task_name: 'Legacy child',
              status: 'running',
            },
          }],
        }],
      }],
      subagents: [],
    }));

    expect(items).toEqual([]);
  });

  it('does not project a child thread as its own panel item', () => {
    const childThread = thread({
      thread_id: 'child-1',
      parent_thread_id: 'parent-thread',
      subagents: [
        summary({
          parent_thread_id: 'parent-thread',
          thread_id: 'child-1',
          task_name: 'Review API',
          status: 'completed',
        }),
      ],
    });

    expect(buildFlowerSubagentPanelItems(childThread)).toEqual([]);
  });

  it('normalizes public summary fields without exposing raw message content on panel items', () => {
    const items = buildFlowerSubagentPanelItems(thread({
      subagents: [
        summary({
          thread_id: 'child-1',
          task_name: 'Review prompts',
          task_description: 'Review prompt copy.',
          status: 'closed',
          last_message: 'Raw handoff text stays out of the panel projection.',
          waiting_prompt: 'Raw prompt text stays out too.',
        }),
      ],
    }));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      threadID: 'child-1',
      title: 'Review prompts',
      displayName: 'Review Prompts',
      taskDescription: 'Review prompt copy.',
      status: 'canceled',
      action: 'inspect',
      canOpen: true,
    });
    expect(items[0] as Record<string, unknown>).not.toHaveProperty('lastMessage');
    expect(items[0] as Record<string, unknown>).not.toHaveProperty('waitingPrompt');
  });

  it('requires task_name and preserves a non-English canonical name without guessing', () => {
    const items = buildFlowerSubagentPanelItems(thread({
      subagents: [
        summary({
          thread_id: 'child-review',
          task_name: '检查安全边界',
          agent_type: 'reviewer',
        }),
        summary({
          thread_id: 'child-worker',
          task_name: '',
          agent_type: 'worker',
        }),
      ],
    }));

    expect(items.map((item) => item.displayName)).toEqual(['检查安全边界']);
  });
});

describe('presentSubagentTaskName', () => {
  it('humanizes legacy task names and preserves technical initialisms', () => {
    expect(presentSubagentTaskName('ai_research')).toBe('AI Research');
    expect(presentSubagentTaskName('ai_oss_projects')).toBe('AI OSS Projects');
    expect(presentSubagentTaskName('ai-industry-news')).toBe('AI Industry News');
    expect(presentSubagentTaskName('APIContractReview')).toBe('API Contract Review');
    expect(presentSubagentTaskName('检查安全边界')).toBe('检查安全边界');
  });

  it('limits display names to five words and 48 characters', () => {
    expect(presentSubagentTaskName('review the public API contract implementation details')).toBe('Review The Public API Contract');
    expect(presentSubagentTaskName('supercalifragilisticexpialidocioussupercalifragilistic review')).toHaveLength(48);
  });
});
