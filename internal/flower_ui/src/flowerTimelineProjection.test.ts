import { describe, expect, it } from 'vitest';

import type {
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { activityTimelineSignature, buildFlowerTimelineEntries } from './flowerTimelineProjection';

function activityItem(overrides: Partial<FlowerActivityItem> = {}): FlowerActivityItem {
  return {
    item_id: 'tool-1',
    tool_id: 'tool-1',
    tool_name: 'terminal.exec',
    kind: 'tool',
    status: 'success',
    severity: 'quiet',
    needs_attention: false,
    requires_approval: false,
    ...overrides,
  };
}

function activityTimeline(overrides: Partial<FlowerActivityTimelineBlock> = {}): FlowerActivityTimelineBlock {
  const items = overrides.items ?? [activityItem()];
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
      ...overrides.summary,
    },
    items,
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
    updated_at_ms: 2,
    status: 'success',
    source_label: 'This host',
    target_labels: [],
    messages: [],
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

describe('buildFlowerTimelineEntries', () => {
  it('keeps message block order across content, activity, and final content', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'I will inspect.\n\nFinal answer.',
          status: 'complete',
          created_at_ms: 2,
          blocks: [
            { type: 'markdown', content: 'I will inspect.' },
            activityTimeline(),
            { type: 'markdown', content: 'Final answer.' },
          ],
        },
      ],
    }));

    expect(entries).toHaveLength(1);
    const first = entries[0];
    expect(first?.type).toBe('message');
    if (first?.type !== 'message') throw new Error('expected message entry');
    expect(first.blocks.map((block) => block.type)).toEqual(['content', 'activity', 'content']);
    expect(first.blocks.map((block) => (block.type === 'content' ? block.content : block.block.run_id))).toEqual([
      'I will inspect.',
      'run-1',
      'Final answer.',
    ]);
  });

  it('keeps separate activity segments between assistant text blocks', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-ordered',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 2,
          blocks: [
            { type: 'markdown', content: 'I will inspect.' },
            activityTimeline({
              run_id: 'run-terminal',
              items: [activityItem({
                item_id: 'tool-terminal',
                tool_id: 'tool-terminal',
                tool_name: 'terminal.exec',
                renderer: 'terminal',
                label: 'ls -la',
                payload: { command: 'ls -la' },
              })],
            }),
            { type: 'markdown', content: 'Now I will read a file.' },
            activityTimeline({
              run_id: 'run-file',
              items: [activityItem({
                item_id: 'tool-file',
                tool_id: 'tool-file',
                tool_name: 'file.read',
                renderer: 'file',
                label: 'package.json',
                payload: { operation: 'read', display_name: 'package.json' },
              })],
            }),
            { type: 'markdown', content: 'Done.' },
          ],
        },
      ],
    }));

    const first = entries[0];
    expect(first?.type).toBe('message');
    if (first?.type !== 'message') throw new Error('expected message entry');
    expect(first.blocks.map((block) => block.type)).toEqual(['content', 'activity', 'content', 'activity', 'content']);
    expect(first.blocks.map((block) => (block.type === 'activity' ? block.block.items[0]?.label : block.content))).toEqual([
      'I will inspect.',
      'ls -la',
      'Now I will read a file.',
      'package.json',
      'Done.',
    ]);
  });

  it('keeps activity-only assistant messages visible', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-tools',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 2,
          blocks: [activityTimeline()],
        },
      ],
    }));

    expect(entries).toHaveLength(1);
    const first = entries[0];
    expect(first?.type).toBe('message');
    if (first?.type !== 'message') throw new Error('expected message entry');
    expect(first.blocks).toHaveLength(1);
    expect(first.blocks[0]?.type).toBe('activity');
  });

  it('does not render empty activity timeline blocks', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-empty-activity',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 2,
          blocks: [activityTimeline({ items: [], summary: { status: 'success', severity: 'quiet', needs_attention: false, total_items: 0, counts: {} } })],
        },
      ],
    }));

    expect(entries).toHaveLength(0);
  });

  it('appends waiting input and thread errors as transcript entries', () => {
    const entries = buildFlowerTimelineEntries(thread({
      status: 'waiting_user',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'I need a decision.',
          status: 'complete',
          created_at_ms: 2,
        },
      ],
      input_request: {
        prompt_id: 'prompt-1',
        message_id: 'assistant-1',
        tool_id: 'tool-ask',
        tool_name: 'ask_user',
        questions: [
          {
            id: 'choice',
            header: 'Decision',
            question: 'Continue?',
            response_mode: 'select',
            choices: [{ choice_id: 'yes', label: 'Yes', kind: 'select' }],
          },
        ],
      },
      error: {
        code: 'failed',
        message: 'Provider stopped.',
      },
    }));

    expect(entries.map((entry) => entry.type)).toEqual(['message', 'input_request', 'error']);
  });

  it('keeps host-only file action paths out of activity signatures', () => {
    const timeline = activityTimeline({
      file_actions: {
        file_action_1: {
          action_id: 'file_action_1',
          display_name: 'app.ts',
          can_preview: true,
          can_browse_directory: true,
        },
      },
      items: [activityItem({
        item_id: 'file_action_1',
        tool_name: 'file.read',
        renderer: 'file',
        label: 'app.ts',
        payload: { operation: 'read', display_name: 'app.ts', file_action_id: 'file_action_1' },
      })],
    });

    const signature = activityTimelineSignature(timeline);
    expect(signature).toContain('file_action_1');
    expect(signature).toContain('app.ts');
    expect(signature).not.toContain('/workspace/private');
  });

  it('includes file action capabilities in activity signatures', () => {
    const base = activityTimeline({
      file_actions: {
        file_action_1: {
          action_id: 'file_action_1',
          display_name: 'app.ts',
          can_preview: false,
          can_browse_directory: false,
        },
      },
      items: [activityItem({
        item_id: 'file_action_1',
        tool_name: 'file.read',
        renderer: 'file',
        label: 'app.ts',
        payload: { operation: 'read', display_name: 'app.ts', file_action_id: 'file_action_1' },
      })],
    });
    const withPreview = activityTimeline({
      ...base,
      file_actions: {
        file_action_1: {
          action_id: 'file_action_1',
          display_name: 'app.ts',
          can_preview: true,
          can_browse_directory: false,
        },
      },
    });
    const withBrowse = activityTimeline({
      ...base,
      file_actions: {
        file_action_1: {
          action_id: 'file_action_1',
          display_name: 'app.ts',
          can_preview: true,
          can_browse_directory: true,
        },
      },
    });

    expect(activityTimelineSignature(withPreview)).not.toBe(activityTimelineSignature(base));
    expect(activityTimelineSignature(withBrowse)).not.toBe(activityTimelineSignature(withPreview));
  });

  it('keeps nested payloads available without accepting host-only path fields', () => {
    const timeline = activityTimeline({
      items: [activityItem({
        item_id: 'completion-1',
        tool_name: 'task_complete',
        renderer: 'completion',
        payload: { result: { summary: 'done', details: 'ok' } },
      })],
    });

    const signature = activityTimelineSignature(timeline);
    expect(signature).toContain('completion-1');
    expect(signature).toContain('summary');
    expect(signature).not.toContain('cwd');
    expect(signature).not.toContain('workdir');
  });
});
