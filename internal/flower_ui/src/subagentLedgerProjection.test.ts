import { describe, expect, it } from 'vitest';

import type { FlowerActivityItem, FlowerActivityStatus } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import { projectSubagentLedgerItems } from './subagentLedgerProjection';

function activityEntry(key: string, timestamp: number, statuses: readonly FlowerActivityStatus[] = ['success']): FlowerTimelineEntry {
  const items: FlowerActivityItem[] = statuses.map((status, index) => ({
    item_id: `${key}-item-${index}`,
    tool_id: `${key}-tool-${index}`,
    tool_name: 'terminal.exec',
    kind: 'tool',
    status,
    severity: status === 'error' ? 'error' : 'quiet',
    needs_attention: status === 'error',
    requires_approval: false,
  }));
  return {
    type: 'message',
    key,
    message: {
      id: key,
      role: 'assistant',
      content: '',
      status: 'complete',
      created_at_ms: timestamp,
    },
    blocks: [{
      type: 'activity',
      key: `${key}:activity`,
      block_index: 0,
      block: {
        type: 'activity-timeline',
        schema_version: 1,
        run_id: 'run-1',
        turn_id: 'turn-1',
        summary: {
          status: statuses.includes('error') ? 'error' : statuses.includes('running') ? 'running' : 'success',
          severity: statuses.includes('error') ? 'error' : 'quiet',
          needs_attention: statuses.includes('error'),
          total_items: items.length,
          counts: Object.fromEntries(statuses.map((status) => [status, statuses.filter((value) => value === status).length])),
        },
        items,
      },
    }],
  };
}

function contentEntry(key: string, content = 'Analysis'): FlowerTimelineEntry {
  return {
    type: 'message',
    key,
    message: {
      id: key,
      role: 'assistant',
      content,
      status: 'complete',
      created_at_ms: 150,
    },
    blocks: [{ type: 'content', key: `${key}:content`, block_index: 0, block_type: 'markdown', content }],
  };
}

function inputRequestEntry(key: string): FlowerTimelineEntry {
  return {
    type: 'input_request',
    key,
    request: {
      prompt_id: key,
      message_id: 'assistant-waiting',
      tool_id: 'ask-user',
      tool_name: 'ask_user',
      questions: [{
        id: 'decision',
        header: 'Decision',
        question: 'Continue?',
        response_mode: 'select',
        choices: [{ choice_id: 'continue', label: 'Continue', kind: 'select' }],
      }],
    },
  };
}

function compactionEntry(key: string): FlowerTimelineEntry {
  return {
    type: 'context_compaction',
    key,
    decoration: {
      decoration_id: key,
      kind: 'context_compaction',
      anchor: { target_kind: 'message', message_id: 'assistant-next', edge: 'before' },
      ordinal: 2,
      compaction: {
        operation_id: key,
        phase: 'complete',
        status: 'compacted',
        updated_at_ms: 180,
      },
    },
  };
}

function errorEntry(key: string): FlowerTimelineEntry {
  return { type: 'error', key, error: { code: 'provider_error', message: 'Provider stopped.' } };
}

describe('projectSubagentLedgerItems', () => {
  it('groups adjacent pure activity entries into one stable batch', () => {
    const items = projectSubagentLedgerItems([
      activityEntry('activity-1', 100),
      activityEntry('activity-2', 200),
      activityEntry('activity-3', 300),
    ]);

    expect(items).toEqual([expect.objectContaining({
      type: 'activity_batch',
      key: 'activity-batch:activity-1',
      itemCount: 3,
      allSucceeded: true,
      firstTimestamp: 100,
      lastTimestamp: 300,
    })]);
  });

  it('uses visible narrative entries as activity phase boundaries', () => {
    const items = projectSubagentLedgerItems([
      activityEntry('activity-1', 100),
      activityEntry('activity-2', 120),
      contentEntry('analysis-1'),
      activityEntry('activity-3', 200),
    ]);

    expect(items.map((item) => [item.type, item.type === 'activity_batch' ? item.itemCount : item.key])).toEqual([
      ['activity_batch', 2],
      ['entry', 'analysis-1'],
      ['activity_batch', 1],
    ]);
  });

  it('uses waiting input, compaction, errors, and failed messages as structural boundaries', () => {
    const failedMessage: FlowerTimelineEntry = {
      type: 'message',
      key: 'failed-message',
      message: {
        id: 'failed-message',
        role: 'assistant',
        content: '',
        status: 'error',
        created_at_ms: 190,
      },
      blocks: [],
    };
    const boundaries = [
      inputRequestEntry('waiting-input'),
      compactionEntry('compaction'),
      errorEntry('thread-error'),
      failedMessage,
    ];
    const entries = boundaries.flatMap((boundary, index) => [
      activityEntry(`activity-before-${index}`, 100 + index * 20),
      boundary,
    ]).concat(activityEntry('activity-after', 300));

    const items = projectSubagentLedgerItems(entries);

    expect(items.map((item) => item.type)).toEqual([
      'activity_batch', 'entry',
      'activity_batch', 'entry',
      'activity_batch', 'entry',
      'activity_batch', 'entry',
      'activity_batch',
    ]);
    expect(items.filter((item) => item.type === 'activity_batch').every((item) => item.itemCount === 1)).toBe(true);
  });

  it('keeps mixed content and activity messages intact as phase boundaries', () => {
    const activity = activityEntry('activity-2', 200);
    const content = contentEntry('mixed-1');
    if (activity.type !== 'message') throw new Error('expected message entry');
    if (content.type !== 'message') throw new Error('expected message entry');
    const mixed: FlowerTimelineEntry = {
      ...content,
      blocks: [
        ...content.blocks,
        ...activity.blocks,
      ],
    };
    const items = projectSubagentLedgerItems([
      activityEntry('activity-1', 100),
      mixed,
      activityEntry('activity-3', 300),
    ]);

    expect(items.map((item) => item.type)).toEqual(['activity_batch', 'entry', 'activity_batch']);
    expect(items[1]).toMatchObject({ type: 'entry', key: 'mixed-1' });
  });

  it('summarizes exceptional activity without hiding its status', () => {
    const [item] = projectSubagentLedgerItems([
      activityEntry('activity-1', 100, ['success']),
      activityEntry('activity-2', 200, ['running', 'error']),
    ]);

    expect(item).toMatchObject({
      type: 'activity_batch',
      itemCount: 3,
      status: 'error',
      allSucceeded: false,
    });
  });

  it('keeps the batch key stable while live activity is appended or settles', () => {
    const running = projectSubagentLedgerItems([
      activityEntry('activity-1', 100, ['success']),
      activityEntry('activity-2', 200, ['running']),
    ])[0];
    const settled = projectSubagentLedgerItems([
      activityEntry('activity-1', 100, ['success']),
      activityEntry('activity-2', 200, ['success']),
      activityEntry('activity-3', 300, ['success']),
    ])[0];

    expect(running).toMatchObject({ key: 'activity-batch:activity-1', itemCount: 2, status: 'running' });
    expect(settled).toMatchObject({ key: 'activity-batch:activity-1', itemCount: 3, status: 'success' });
  });
});
