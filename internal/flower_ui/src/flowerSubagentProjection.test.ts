import { describe, expect, it } from 'vitest';

import type {
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { buildFlowerSubagentPanelItems } from './flowerSubagentProjection';

function activityItem(overrides: Partial<FlowerActivityItem>): FlowerActivityItem {
  return {
    item_id: 'subagents-1',
    tool_id: 'subagents-1',
    tool_name: 'subagents',
    kind: 'tool',
    status: 'success',
    severity: 'quiet',
    needs_attention: false,
    requires_approval: false,
    ...overrides,
  };
}

function timeline(items: readonly FlowerActivityItem[]): FlowerActivityTimelineBlock {
  return {
    type: 'activity-timeline',
    schema_version: 1,
    run_id: 'run-1',
    turn_id: 'turn-1',
    summary: {
      status: 'success',
      severity: 'quiet',
      needs_attention: false,
      total_items: items.length,
      counts: { success: items.length },
    },
    items,
  };
}

function thread(blocks: FlowerThreadSnapshot['messages'][number]['blocks']): FlowerThreadSnapshot {
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
    messages: [{
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      status: 'complete',
      created_at_ms: 20,
      blocks,
    }],
  };
}

describe('buildFlowerSubagentPanelItems', () => {
  it('projects subagents from activity timeline snapshots', () => {
    const items = buildFlowerSubagentPanelItems(thread([timeline([
      activityItem({
        status: 'running',
        payload: {
          action: 'spawn',
          snapshot: {
            thread_id: 'child-1',
            subagent_id: 'child-1',
            task_name: 'Review API',
            agent_type: 'reviewer',
            status: 'running',
            last_message: 'Reading service contracts',
            updated_at_ms: 120,
          },
        },
      }),
    ])]));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      threadID: 'child-1',
      title: 'Review API',
      agentType: 'reviewer',
      status: 'running',
      lastMessage: 'Reading service contracts',
      canOpen: true,
    });
  });

  it('merges later updates and keeps active subagents before settled ones', () => {
    const items = buildFlowerSubagentPanelItems(thread([timeline([
      activityItem({
        item_id: 'spawn-child-1',
        payload: {
          action: 'spawn',
          snapshot: {
            thread_id: 'child-1',
            task_name: 'Implement worker',
            agent_type: 'worker',
            status: 'running',
            updated_at_ms: 100,
          },
        },
      }),
      activityItem({
        item_id: 'wait-child-1',
        payload: {
          action: 'wait',
          items: [{
            thread_id: 'child-1',
            task_name: 'Implement worker',
            agent_type: 'worker',
            status: 'completed',
            last_message: 'Worker handoff ready',
            updated_at_ms: 220,
          }],
        },
      }),
      activityItem({
        item_id: 'spawn-child-2',
        status: 'running',
        payload: {
          action: 'spawn',
          snapshot: {
            thread_id: 'child-2',
            task_name: 'Review tests',
            agent_type: 'reviewer',
            status: 'running',
            updated_at_ms: 180,
          },
        },
      }),
    ])]));

    expect(items.map((item) => [item.threadID, item.status, item.lastMessage])).toEqual([
      ['child-2', 'running', ''],
      ['child-1', 'completed', 'Worker handoff ready'],
    ]);
  });

  it('keeps settled status when updates have the same timestamp', () => {
    const items = buildFlowerSubagentPanelItems(thread([timeline([
      activityItem({
        item_id: 'spawn-child-1',
        payload: {
          action: 'spawn',
          snapshot: {
            thread_id: 'child-1',
            task_name: 'Review prompt contract',
            agent_type: 'reviewer',
            status: 'running',
            updated_at_ms: 100,
          },
        },
      }),
      activityItem({
        item_id: 'wait-child-1',
        payload: {
          action: 'wait',
          items: [{
            thread_id: 'child-1',
            task_name: 'Review prompt contract',
            agent_type: 'reviewer',
            status: 'completed',
            last_message: 'No prompt regressions found.',
            updated_at_ms: 100,
          }],
        },
      }),
    ])]));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      threadID: 'child-1',
      status: 'completed',
      lastMessage: 'No prompt regressions found.',
    });
  });

  it('uses close snapshots to replace older running state', () => {
    const items = buildFlowerSubagentPanelItems(thread([timeline([
      activityItem({
        item_id: 'spawn-child-1',
        status: 'running',
        payload: {
          action: 'spawn',
          snapshot: {
            thread_id: 'child-1',
            subagent_id: 'child-1',
            task_name: 'Review prompt contract',
            agent_type: 'reviewer',
            status: 'running',
            updated_at_ms: 100,
          },
        },
      }),
      activityItem({
        item_id: 'close-child-1',
        payload: {
          action: 'close',
          target: 'child-1',
          closed: true,
          snapshot: {
            thread_id: 'child-1',
            subagent_id: 'child-1',
            task_name: 'Review prompt contract',
            agent_type: 'reviewer',
            status: 'canceled',
            closed: true,
            can_close: false,
            last_message: 'Reviewer handoff archived.',
            updated_at_ms: 220,
          },
        },
      }),
    ])]));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      threadID: 'child-1',
      status: 'canceled',
      lastMessage: 'Reviewer handoff archived.',
    });
  });

  it('does not treat unrelated thread_id payloads as subagents', () => {
    const items = buildFlowerSubagentPanelItems(thread([timeline([
      activityItem({
        tool_name: 'ask_user',
        payload: {
          thread_id: 'parent-thread',
          summary: 'Needs input',
        },
      }),
    ])]));

    expect(items).toEqual([]);
  });

  it('does not treat unrelated nested result ids as subagents', () => {
    const items = buildFlowerSubagentPanelItems(thread([timeline([
      activityItem({
        tool_name: 'web.search',
        payload: {
          items: [{ id: 'result-1', title: 'Search result' }],
        },
      }),
    ])]));

    expect(items).toEqual([]);
  });

  it('does not revive legacy subagent snapshot collection fields', () => {
    const items = buildFlowerSubagentPanelItems(thread([timeline([
      activityItem({
        payload: {
          action: 'wait',
          snapshots: {
            legacy1: {
              thread_id: 'legacy-child-1',
              task_name: 'Legacy snapshot',
              status: 'running',
            },
          },
          snapshots_by_id: {
            legacy2: {
              thread_id: 'legacy-child-2',
              task_name: 'Legacy snapshot map',
              status: 'running',
            },
          },
          subagents: [{
            thread_id: 'legacy-child-3',
            task_name: 'Legacy subagents list',
            status: 'running',
          }],
        },
      }),
    ])]));

    expect(items).toEqual([]);
  });

  it('does not project a child thread lifecycle item as its own subagent', () => {
    const childThread = {
      ...thread([timeline([
        activityItem({
          item_id: 'subagent-lifecycle',
          tool_id: 'subagent-lifecycle',
          tool_name: 'subagents',
          kind: 'control',
          payload: {
            operation: 'subagents',
            action: 'inspect',
            delegation_runtime: 'floret',
            thread_id: 'child-1',
            subagent_id: 'child-1',
            task_name: 'Review API',
            agent_type: 'reviewer',
            status: 'completed',
            last_message: 'Done.',
          },
        }),
      ])]),
      thread_id: 'child-1',
      title: 'Review API',
      owner_kind: 'subagent_projection',
      parent_thread_id: 'parent-thread',
      read_only_reason: 'Localized copy can change.',
    };

    expect(buildFlowerSubagentPanelItems(childThread)).toEqual([]);
  });
});
