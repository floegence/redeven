import { describe, expect, it } from 'vitest';

import type { FlowerSubagentDetail } from './contracts/flowerSurfaceContracts';
import { projectSubagentDetailThread } from './flowerSubagentDetailThread';

describe('projectSubagentDetailThread', () => {
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
