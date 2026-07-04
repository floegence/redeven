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

  it('keeps adjacent todo and subagent activity segments separate', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-adjacent-activity',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 2,
          blocks: [
            activityTimeline({
              run_id: 'run-todos',
              items: [activityItem({
                item_id: 'tool:todos',
                tool_id: 'todos',
                tool_name: 'write_todos',
                renderer: 'todos',
                label: 'Update plan',
                payload: { todos: [{ content: 'Inspect projection', status: 'completed' }] },
              })],
            }),
            activityTimeline({
              run_id: 'run-subagents',
              items: [activityItem({
                item_id: 'tool:subagents',
                tool_id: 'subagents',
                tool_name: 'subagents',
                renderer: 'structured',
                label: 'Research sources',
                payload: { task_name: 'Research sources', status: 'completed' },
              })],
            }),
          ],
        },
      ],
    }));

    const first = entries[0];
    expect(first?.type).toBe('message');
    if (first?.type !== 'message') throw new Error('expected message entry');
    expect(first.blocks.map((block) => block.type)).toEqual(['activity', 'activity']);
    expect(first.blocks.map((block) => (block.type === 'activity' ? block.block.items[0]?.tool_name : ''))).toEqual([
      'write_todos',
      'subagents',
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

  it('inserts context compaction decorations before their anchored message', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Hello',
          status: 'complete',
          created_at_ms: 1,
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Working.',
          status: 'complete',
          created_at_ms: 2,
          blocks: [{ type: 'markdown', content: 'Working.' }],
        },
      ],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-1',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'assistant-1',
          edge: 'before',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-1',
          run_id: 'run-1',
          phase: 'complete',
          status: 'compacted',
          tokens_before: 900,
          tokens_after_estimate: 200,
          updated_at_ms: 3,
        },
      }],
    }));

    expect(entries.map((entry) => entry.type)).toEqual(['message', 'context_compaction', 'message']);
    const divider = entries[1];
    expect(divider?.type).toBe('context_compaction');
    if (divider?.type !== 'context_compaction') throw new Error('expected context compaction entry');
    expect(divider.decoration.compaction.status).toBe('compacted');
  });

  it('inserts context compaction decorations between activity items', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 2,
          blocks: [activityTimeline({
            items: [
              activityItem({ item_id: 'tool-before', label: 'before' }),
              activityItem({ item_id: 'tool-after', label: 'after' }),
            ],
          })],
        },
      ],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-between',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'activity_item',
          message_id: 'assistant-1',
          block_index: 0,
          activity_item_id: 'tool-before',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-between',
          phase: 'start',
          status: 'compacting',
          updated_at_ms: 3,
        },
      }],
    }));

    expect(entries.map((entry) => entry.type)).toEqual(['message', 'context_compaction', 'message']);
    const before = entries[0];
    const after = entries[2];
    expect(before?.type).toBe('message');
    expect(after?.type).toBe('message');
    if (before?.type !== 'message' || after?.type !== 'message') throw new Error('expected split message entries');
    expect(before.blocks[0]?.type).toBe('activity');
    expect(after.blocks[0]?.type).toBe('activity');
    if (before.blocks[0]?.type !== 'activity' || after.blocks[0]?.type !== 'activity') throw new Error('expected activity blocks');
    expect(before.blocks[0].block.items.map((item) => item.item_id)).toEqual(['tool-before']);
    expect(after.blocks[0].block.items.map((item) => item.item_id)).toEqual(['tool-after']);
  });

  it('keeps context compaction anchors stable across empty persisted block placeholders', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          status: 'canceled',
          created_at_ms: 2,
          blocks: [
            { type: 'markdown', content: 'Intro.' },
            { type: 'markdown', content: '' },
            activityTimeline({
              items: [
                activityItem({ item_id: 'tool-before-placeholder', label: 'before' }),
                activityItem({ item_id: 'tool-after-placeholder', label: 'after' }),
              ],
            }),
          ],
        },
      ],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-placeholder-anchor',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'activity_item',
          message_id: 'assistant-1',
          block_index: 2,
          activity_item_id: 'tool-before-placeholder',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-placeholder-anchor',
          phase: 'complete',
          status: 'compacted',
          tokens_before: 26_104,
          tokens_after_estimate: 6_311,
          updated_at_ms: 3,
        },
      }],
    }));

    expect(entries.map((entry) => entry.type)).toEqual(['message', 'context_compaction', 'message']);
    const before = entries[0];
    const divider = entries[1];
    const after = entries[2];
    expect(before?.type).toBe('message');
    expect(divider?.type).toBe('context_compaction');
    expect(after?.type).toBe('message');
    if (before?.type !== 'message' || divider?.type !== 'context_compaction' || after?.type !== 'message') {
      throw new Error('expected split message around compaction divider');
    }
    expect(before.blocks.map((block) => block.type)).toEqual(['content', 'activity']);
    expect(after.blocks[0]?.type).toBe('activity');
    if (after.blocks[0]?.type !== 'activity') throw new Error('expected activity block after divider');
    expect(after.blocks[0].block.items.map((item) => item.item_id)).toEqual(['tool-after-placeholder']);
    expect(divider.decoration.compaction.status).toBe('compacted');
  });

  it('keeps context compaction decorations anchored after the final activity item', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-final-tool',
          role: 'assistant',
          content: '',
          status: 'canceled',
          created_at_ms: 2,
          blocks: [
            { type: 'markdown', content: '' },
            activityTimeline({
              items: [
                activityItem({ item_id: 'tool-before-final', label: 'before' }),
                activityItem({ item_id: 'tool-final', label: 'final' }),
              ],
            }),
          ],
        },
      ],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-final-tool',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'activity_item',
          message_id: 'assistant-final-tool',
          block_index: 1,
          activity_item_id: 'tool-final',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-final-tool',
          phase: 'complete',
          status: 'compacted',
          tokens_before: 25_814,
          tokens_after_estimate: 10_151,
          updated_at_ms: 3,
        },
      }],
    }));

    expect(entries.map((entry) => entry.type)).toEqual(['message', 'context_compaction']);
    const messageEntry = entries[0];
    const divider = entries[1];
    expect(messageEntry?.type).toBe('message');
    expect(divider?.type).toBe('context_compaction');
    if (messageEntry?.type !== 'message' || divider?.type !== 'context_compaction') {
      throw new Error('expected final activity item divider after message');
    }
    expect(messageEntry.blocks[0]?.type).toBe('activity');
    if (messageEntry.blocks[0]?.type !== 'activity') throw new Error('expected activity block before divider');
    expect(messageEntry.blocks[0].block.items.map((item) => item.item_id)).toEqual(['tool-before-final', 'tool-final']);
    expect(divider.decoration.compaction.operation_id).toBe('compact-final-tool');
  });

  it('keeps context compaction anchors on the original block index after multiple empty placeholders', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-natural-compact',
          role: 'assistant',
          content: 'first batch\n\nsecond batch\n\nthird batch',
          status: 'canceled',
          created_at_ms: 2,
          blocks: [
            { type: 'markdown', content: '' },
            activityTimeline({
              items: [activityItem({ item_id: 'tool:preamble', label: 'preamble' })],
            }),
            { type: 'markdown', content: 'first batch' },
            activityTimeline({
              items: [
                activityItem({ item_id: 'tool:first-1', label: 'first 1' }),
                activityItem({ item_id: 'tool:first-2', label: 'first 2' }),
              ],
            }),
            { type: 'markdown', content: 'second batch' },
            activityTimeline({
              items: [activityItem({ item_id: 'tool:second-1', label: 'second 1' })],
            }),
            { type: 'markdown', content: 'third batch' },
            activityTimeline({
              items: [
                activityItem({ item_id: 'tool:third-1', label: 'third 1' }),
                activityItem({ item_id: 'tool:third-final', label: 'third final' }),
              ],
            }),
          ],
        },
      ],
      timeline_decorations: [{
        decoration_id: 'context-compaction:natural-threshold',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'activity_item',
          message_id: 'assistant-natural-compact',
          block_index: 7,
          activity_item_id: 'tool:third-final',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'natural-threshold',
          phase: 'complete',
          status: 'compacted',
          tokens_before: 25_814,
          tokens_after_estimate: 10_151,
          updated_at_ms: 3,
        },
      }],
    }));

    expect(entries.map((entry) => entry.type)).toEqual(['message', 'context_compaction']);
    const messageEntry = entries[0];
    const divider = entries[1];
    expect(messageEntry?.type).toBe('message');
    expect(divider?.type).toBe('context_compaction');
    if (messageEntry?.type !== 'message' || divider?.type !== 'context_compaction') {
      throw new Error('expected divider after final original-index activity item');
    }
    const activityBlocks = messageEntry.blocks.filter((block): block is Extract<typeof block, { type: 'activity' }> => block.type === 'activity');
    expect(activityBlocks.map((block) => block.block_index)).toEqual([1, 3, 5, 7]);
    expect(activityBlocks.at(-1)?.block.items.map((item) => item.item_id)).toEqual(['tool:third-1', 'tool:third-final']);
    expect(divider.decoration.compaction.operation_id).toBe('natural-threshold');
  });

  it('skips context compaction decorations without a valid anchor', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Done.',
          status: 'complete',
          created_at_ms: 2,
          blocks: [{ type: 'markdown', content: 'Done.' }],
        },
      ],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-invalid',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: '',
          edge: 'after',
        },
        ordinal: 3,
        compaction: {
          operation_id: 'compact-invalid',
          phase: 'start',
          status: 'compacting',
          updated_at_ms: 3,
        },
      }],
    }));

    expect(entries.map((entry) => entry.type)).toEqual(['message']);
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

  it('does not keep empty streaming messages without an active cursor', () => {
    const entries = buildFlowerTimelineEntries(thread({
      status: 'running',
      messages: [
        {
          id: 'assistant-streaming-empty',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 2,
        },
      ],
    }));

    expect(entries).toHaveLength(0);
  });

  it('keeps empty active cursor messages visible', () => {
    const entries = buildFlowerTimelineEntries(thread({
      status: 'running',
      messages: [
        {
          id: 'assistant-active-cursor',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 2,
        },
      ],
    }));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe('message');
  });

  it('keeps only the latest active cursor in a running thread', () => {
    const entries = buildFlowerTimelineEntries(thread({
      status: 'running',
      messages: [
        {
          id: 'assistant-old-active',
          role: 'assistant',
          content: 'Older partial output',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 2,
          blocks: [{ type: 'markdown', content: 'Older partial output' }],
        },
        {
          id: 'assistant-empty-stale-active',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 3,
        },
        {
          id: 'assistant-current-active',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 4,
        },
      ],
    }));

    const messages = entries.filter((entry): entry is Extract<typeof entry, { type: 'message' }> => entry.type === 'message');
    expect(messages.map((entry) => entry.message.id)).toEqual(['assistant-old-active', 'assistant-current-active']);
    expect(messages.map((entry) => entry.message.active_cursor === true)).toEqual([false, true]);
  });

  it('preserves canonical running queued send message order while keeping one running cursor', () => {
    const entries = buildFlowerTimelineEntries(thread({
      status: 'running',
      messages: [
        {
          id: 'user-first',
          role: 'user',
          content: 'first request',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'assistant-first',
          role: 'assistant',
          content: 'partial old answer',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'partial old answer' }],
        },
        {
          id: 'user-second',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'assistant-current',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
        },
      ],
    }));

    const messages = entries.filter((entry): entry is Extract<typeof entry, { type: 'message' }> => entry.type === 'message');
    expect(messages.map((entry) => entry.message.id)).toEqual([
      'user-first',
      'assistant-first',
      'user-second',
      'assistant-current',
    ]);
    expect(messages.map((entry) => entry.message.active_cursor === true)).toEqual([false, false, false, true]);
  });

  it('drops stale empty active cursor messages when the thread is no longer running', () => {
    for (const status of ['canceled', 'success', 'waiting_approval'] as const) {
      const entries = buildFlowerTimelineEntries(thread({
        status,
        messages: [
          {
            id: `assistant-stale-cursor-${status}`,
            role: 'assistant',
            content: '',
            status: 'streaming',
            active_cursor: true,
            created_at_ms: 2,
          },
        ],
      }));

      expect(entries, status).toHaveLength(0);
    }
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
          blocks: [{ type: 'markdown', content: 'I need a decision.' }],
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

  it('uses message content as the transcript fallback when structured blocks are absent', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-content-only',
          role: 'assistant',
          content: '**content-only markdown**',
          status: 'complete',
          created_at_ms: 2,
        },
      ],
    }));

    expect(entries).toHaveLength(1);
    const first = entries[0];
    expect(first?.type).toBe('message');
    if (first?.type !== 'message') throw new Error('expected message entry');
    expect(first.blocks).toEqual([{
      type: 'content',
      key: 'assistant-content-only:content',
      block_index: 0,
      block_type: 'markdown',
      content: '**content-only markdown**',
    }]);
  });

  it('prefers structured message blocks over message content fallback', () => {
    const entries = buildFlowerTimelineEntries(thread({
      messages: [
        {
          id: 'assistant-with-blocks',
          role: 'assistant',
          content: 'Older content fallback',
          status: 'complete',
          created_at_ms: 2,
          blocks: [{ type: 'markdown', content: 'Structured answer.' }],
        },
      ],
    }));

    const first = entries[0];
    expect(first?.type).toBe('message');
    if (first?.type !== 'message') throw new Error('expected message entry');
    expect(first.blocks.map((block) => (block.type === 'content' ? block.content : 'activity'))).toEqual(['Structured answer.']);
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
