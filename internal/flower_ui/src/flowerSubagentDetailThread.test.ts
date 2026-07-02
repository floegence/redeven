import { describe, expect, it } from 'vitest';

import type { FlowerSubagentDetail } from './contracts/flowerSurfaceContracts';
import { projectSubagentDetailThread } from './flowerSubagentDetailThread';

describe('projectSubagentDetailThread', () => {
  it('renders canonical subagent activity as the only tool activity block', () => {
    const detail: FlowerSubagentDetail = {
      summary: {
        parent_thread_id: 'parent-1',
        subagent_id: 'child-1',
        thread_id: 'child-1',
        task_name: 'Weather south',
        title: 'Weather south',
        agent_type: 'worker',
        status: 'completed',
        can_send_input: false,
        can_interrupt: false,
        can_close: true,
        created_at_ms: 100,
        updated_at_ms: 300,
      },
      timeline: [{
        ordinal: 4,
        kind: 'tool_activity',
        type: 'tool_activity_updated',
        created_at_ms: 220,
        tool_call: {
          id: 'call-1',
          name: 'terminal.exec',
          args_hash: 'args-hash',
        },
      }],
      activity: {
        type: 'activity-timeline',
        schema_version: 1,
        run_id: 'child-run',
        thread_id: 'child-1',
        turn_id: 'child-turn',
        summary: {
          status: 'success',
          severity: 'normal',
          needs_attention: false,
          total_items: 1,
          counts: { success: 1 },
        },
        items: [{
          item_id: 'tool:call-1',
          tool_id: 'call-1',
          tool_name: 'terminal.exec',
          kind: 'tool',
          status: 'success',
          severity: 'normal',
          needs_attention: false,
          requires_approval: false,
          label: 'python weather.py',
          renderer: 'terminal',
        }],
      },
      generated_at_ms: 350,
    };

    const thread = projectSubagentDetailThread(detail, '', '');

    const activityBlocks = thread?.messages.flatMap((message) => (message.blocks ?? []).filter((block) => block.type === 'activity-timeline')) ?? [];
    expect(activityBlocks).toHaveLength(1);
    expect(activityBlocks[0]).toMatchObject({
      summary: { status: 'success' },
      items: [{ tool_id: 'call-1', status: 'success' }],
    });
    expect(JSON.stringify(thread)).not.toContain('"status":"running"');
  });

  it('projects summary-only subagent detail into the shared message transcript', () => {
    const detail: FlowerSubagentDetail = {
      summary: {
        parent_thread_id: 'parent-1',
        subagent_id: 'child-1',
        thread_id: 'child-1',
        task_name: 'Review API',
        title: 'Review API',
        agent_type: 'reviewer',
        status: 'waiting_input',
        waiting_prompt: 'Waiting for a permitted non-approval path.',
        can_send_input: false,
        can_interrupt: false,
        can_close: true,
        created_at_ms: 100,
        updated_at_ms: 200,
      },
      timeline: [],
      generated_at_ms: 250,
    };

    const thread = projectSubagentDetailThread(detail, '', '');

    expect(thread?.messages).toHaveLength(1);
    expect(thread?.messages[0]).toMatchObject({
      role: 'assistant',
      content: 'Waiting for a permitted non-approval path.',
      status: 'complete',
    });
    expect(thread?.messages[0].blocks).toEqual([
      { type: 'text', content: 'Waiting for a permitted non-approval path.' },
    ]);
    expect(thread?.owner_kind).toBeUndefined();
    expect(thread?.read_only_reason).toContain('parent Flower thread');
  });
});
