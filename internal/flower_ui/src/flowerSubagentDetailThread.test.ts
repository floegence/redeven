import { describe, expect, it } from 'vitest';

import type { FlowerSubagentDetail } from './contracts/flowerSurfaceContracts';
import { projectSubagentDetailThread } from './flowerSubagentDetailThread';

describe('projectSubagentDetailThread', () => {
  it('keeps canonical activity interleaved with surrounding assistant text', () => {
    const detail: FlowerSubagentDetail = {
      summary: {
        parent_thread_id: 'parent-1',
        subagent_id: 'child-1',
        thread_id: 'child-1',
        task_name: 'Research news',
        title: 'Research news',
        agent_type: 'worker',
        status: 'completed',
        can_send_input: false,
        can_interrupt: false,
        can_close: true,
        created_at_ms: 100,
        updated_at_ms: 500,
      },
      timeline: [
        {
          ordinal: 1,
          kind: 'assistant_message',
          created_at_ms: 100,
          message: { role: 'assistant', text: 'I will check sources first.' },
        },
        {
          ordinal: 2,
          kind: 'tool_activity',
          type: 'tool_activity_updated',
          created_at_ms: 200,
          tool_call: { id: 'call-1', name: 'terminal.exec' },
        },
        {
          ordinal: 3,
          kind: 'assistant_message',
          created_at_ms: 300,
          message: { role: 'assistant', text: 'The command found useful headlines.' },
        },
      ],
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
          label: 'python news.py',
          renderer: 'terminal',
        }],
      },
      generated_at_ms: 500,
    };

    const thread = projectSubagentDetailThread(detail, '', '');

    expect(thread?.messages.map((message) => message.blocks?.[0]?.type)).toEqual([
      'markdown',
      'activity-timeline',
      'markdown',
    ]);
    expect(thread?.messages.map((message) => message.created_at_ms)).toEqual([100, 200, 300]);
    expect(thread?.messages[1].blocks?.[0]).toMatchObject({
      type: 'activity-timeline',
      items: [{ tool_id: 'call-1', status: 'success' }],
    });
  });

  it('uses timeline ordinal to place canonical activity when rows share a timestamp', () => {
    const detail: FlowerSubagentDetail = {
      summary: {
        parent_thread_id: 'parent-1',
        subagent_id: 'child-1',
        thread_id: 'child-1',
        task_name: 'Research news',
        title: 'Research news',
        agent_type: 'worker',
        status: 'completed',
        can_send_input: false,
        can_interrupt: false,
        can_close: true,
        created_at_ms: 100,
        updated_at_ms: 500,
      },
      timeline: [
        {
          ordinal: 1,
          kind: 'assistant_message',
          created_at_ms: 200,
          message: { role: 'assistant', text: 'Before the command.' },
        },
        {
          ordinal: 2,
          kind: 'tool_activity',
          type: 'tool_activity_updated',
          created_at_ms: 200,
          tool_call: { id: 'call-1', name: 'terminal.exec' },
        },
        {
          ordinal: 3,
          kind: 'assistant_message',
          created_at_ms: 200,
          message: { role: 'assistant', text: 'After the command.' },
        },
      ],
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
          label: 'python news.py',
          renderer: 'terminal',
        }],
      },
      generated_at_ms: 500,
    };

    const thread = projectSubagentDetailThread(detail, '', '');

    expect(thread?.messages.map((message) => message.blocks?.[0]?.type)).toEqual([
      'markdown',
      'activity-timeline',
      'markdown',
    ]);
    expect(thread?.messages.map((message) => message.content)).toEqual([
      'Before the command.',
      '',
      'After the command.',
    ]);
  });

  it('keeps separate tool phases anchored between assistant messages', () => {
    const detail: FlowerSubagentDetail = {
      summary: {
        parent_thread_id: 'parent-1',
        subagent_id: 'child-1',
        thread_id: 'child-1',
        task_name: 'Research news',
        title: 'Research news',
        agent_type: 'worker',
        status: 'completed',
        can_send_input: false,
        can_interrupt: false,
        can_close: true,
        created_at_ms: 100,
        updated_at_ms: 700,
      },
      timeline: [
        {
          ordinal: 1,
          kind: 'assistant_message',
          created_at_ms: 100,
          message: { role: 'assistant', text: 'A: I will check the first source.' },
        },
        {
          ordinal: 2,
          kind: 'tool_activity',
          type: 'tool_activity_updated',
          created_at_ms: 200,
          tool_call: { id: 'call-1', name: 'terminal.exec' },
        },
        {
          ordinal: 3,
          kind: 'assistant_message',
          created_at_ms: 300,
          message: { role: 'assistant', text: 'B: The first source is useful.' },
        },
        {
          ordinal: 4,
          kind: 'tool_activity',
          type: 'tool_activity_updated',
          created_at_ms: 400,
          tool_call: { id: 'call-2', name: 'terminal.exec' },
        },
        {
          ordinal: 5,
          kind: 'assistant_message',
          created_at_ms: 500,
          message: { role: 'assistant', text: 'C: The second source confirms it.' },
        },
      ],
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
          total_items: 2,
          counts: { success: 2 },
        },
        items: [
          {
            item_id: 'tool:call-1',
            tool_id: 'call-1',
            tool_name: 'terminal.exec',
            kind: 'tool',
            status: 'success',
            severity: 'normal',
            needs_attention: false,
            requires_approval: false,
            label: 'fetch source one',
            renderer: 'terminal',
          },
          {
            item_id: 'tool:call-2',
            tool_id: 'call-2',
            tool_name: 'terminal.exec',
            kind: 'tool',
            status: 'success',
            severity: 'normal',
            needs_attention: false,
            requires_approval: false,
            label: 'fetch source two',
            renderer: 'terminal',
          },
        ],
      },
      generated_at_ms: 700,
    };

    const thread = projectSubagentDetailThread(detail, '', '');

    expect(thread?.messages.map((message) => message.blocks?.[0]?.type)).toEqual([
      'markdown',
      'activity-timeline',
      'markdown',
      'activity-timeline',
      'markdown',
    ]);
    expect(thread?.messages.map((message) => message.content)).toEqual([
      'A: I will check the first source.',
      '',
      'B: The first source is useful.',
      '',
      'C: The second source confirms it.',
    ]);
    const activityBlocks = thread?.messages
      .flatMap((message) => (message.blocks ?? []).filter((block) => block.type === 'activity-timeline')) ?? [];
    expect(activityBlocks).toHaveLength(2);
    expect(activityBlocks[0]).toMatchObject({
      summary: { total_items: 1, counts: { success: 1 } },
      items: [{ tool_id: 'call-1' }],
    });
    expect(activityBlocks[1]).toMatchObject({
      summary: { total_items: 1, counts: { success: 1 } },
      items: [{ tool_id: 'call-2' }],
    });
  });

  it('uses ordinal anchors instead of wall-clock timestamps for visible ordering', () => {
    const detail: FlowerSubagentDetail = {
      summary: {
        parent_thread_id: 'parent-1',
        subagent_id: 'child-1',
        thread_id: 'child-1',
        task_name: 'Research news',
        title: 'Research news',
        agent_type: 'worker',
        status: 'completed',
        can_send_input: false,
        can_interrupt: false,
        can_close: true,
        created_at_ms: 100,
        updated_at_ms: 700,
      },
      timeline: [
        {
          ordinal: 1,
          kind: 'assistant_message',
          created_at_ms: 500,
          message: { role: 'assistant', text: 'A: text with a late timestamp.' },
        },
        {
          ordinal: 2,
          kind: 'tool_activity',
          type: 'tool_activity_updated',
          created_at_ms: 100,
          tool_call: { id: 'call-1', name: 'terminal.exec' },
        },
        {
          ordinal: 3,
          kind: 'assistant_message',
          created_at_ms: 200,
          message: { role: 'assistant', text: 'B: text after the tool by ordinal.' },
        },
      ],
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
          label: 'fetch source one',
          renderer: 'terminal',
        }],
      },
      generated_at_ms: 700,
    };

    const thread = projectSubagentDetailThread(detail, '', '');

    expect(thread?.messages.map((message) => message.content)).toEqual([
      'A: text with a late timestamp.',
      '',
      'B: text after the tool by ordinal.',
    ]);
    expect(thread?.messages.map((message) => message.blocks?.[0]?.type)).toEqual([
      'markdown',
      'activity-timeline',
      'markdown',
    ]);
  });

  it('does not attach unmatched canonical activity items to the first tool anchor', () => {
    const detail: FlowerSubagentDetail = {
      summary: {
        parent_thread_id: 'parent-1',
        subagent_id: 'child-1',
        thread_id: 'child-1',
        task_name: 'Research news',
        title: 'Research news',
        agent_type: 'worker',
        status: 'completed',
        can_send_input: false,
        can_interrupt: false,
        can_close: true,
        created_at_ms: 100,
        updated_at_ms: 500,
      },
      timeline: [
        {
          ordinal: 1,
          kind: 'assistant_message',
          created_at_ms: 100,
          message: { role: 'assistant', text: 'Before the anchored command.' },
        },
        {
          ordinal: 2,
          kind: 'tool_activity',
          type: 'tool_activity_updated',
          created_at_ms: 200,
          tool_call: { id: 'call-1', name: 'terminal.exec' },
        },
        {
          ordinal: 3,
          kind: 'assistant_message',
          created_at_ms: 300,
          message: { role: 'assistant', text: 'After the anchored command.' },
        },
      ],
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
          total_items: 2,
          counts: { success: 2 },
        },
        items: [
          {
            item_id: 'tool:call-1',
            tool_id: 'call-1',
            tool_name: 'terminal.exec',
            kind: 'tool',
            status: 'success',
            severity: 'normal',
            needs_attention: false,
            requires_approval: false,
            label: 'anchored command',
            renderer: 'terminal',
          },
          {
            item_id: 'tool:call-missing',
            tool_id: 'call-missing',
            tool_name: 'terminal.exec',
            kind: 'tool',
            status: 'success',
            severity: 'normal',
            needs_attention: false,
            requires_approval: false,
            label: 'unmatched command',
            renderer: 'terminal',
          },
        ],
      },
      generated_at_ms: 500,
    };

    const thread = projectSubagentDetailThread(detail, '', '');
    const activityBlocks = thread?.messages
      .flatMap((message) => (message.blocks ?? []).filter((block) => block.type === 'activity-timeline')) ?? [];

    expect(activityBlocks).toHaveLength(1);
    expect(activityBlocks[0]).toMatchObject({
      summary: { total_items: 1, counts: { success: 1 } },
      items: [{ tool_id: 'call-1' }],
    });
    expect(JSON.stringify(thread)).not.toContain('call-missing');
    expect(JSON.stringify(thread)).not.toContain('unmatched command');
  });

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

  it('does not render the raw delegated mission prompt as a user message', () => {
    const detail: FlowerSubagentDetail = {
      summary: {
        parent_thread_id: 'parent-1',
        subagent_id: 'child-1',
        thread_id: 'child-1',
        task_name: 'News review',
        title: 'News review',
        task_description: 'Review the latest AI industry news.',
        agent_type: 'worker',
        status: 'completed',
        can_send_input: false,
        can_interrupt: false,
        can_close: true,
        created_at_ms: 100,
        updated_at_ms: 300,
      },
      timeline: [
        {
          ordinal: 1,
          kind: 'user_message',
          created_at_ms: 100,
          metadata: { subagent_prompt_kind: 'delegated_mission' },
          message: {
            role: 'user',
            text: '# Delegated Mission\nYour task: Review the latest AI industry news.\n\n# Operating Contract\nUse tools.',
          },
        },
        {
          ordinal: 2,
          kind: 'assistant_message',
          created_at_ms: 200,
          message: { role: 'assistant', text: 'I found three useful sources.' },
        },
      ],
      generated_at_ms: 350,
    };

    const thread = projectSubagentDetailThread(detail, '', '');

    expect(thread?.messages).toHaveLength(1);
    expect(thread?.messages[0].content).toBe('I found three useful sources.');
    expect(JSON.stringify(thread)).not.toContain('Delegated Mission');
    expect(JSON.stringify(thread)).not.toContain('Operating Contract');
  });

  it('uses delegated mission metadata as the raw prompt filter boundary', () => {
    const baseSummary = {
      parent_thread_id: 'parent-1',
      subagent_id: 'child-1',
      thread_id: 'child-1',
      task_name: 'News review',
      title: 'News review',
      task_description: 'Review the latest AI industry news.',
      agent_type: 'worker',
      status: 'completed',
      can_send_input: false,
      can_interrupt: false,
      can_close: true,
      created_at_ms: 100,
      updated_at_ms: 300,
    };
    const hidden = projectSubagentDetailThread({
      summary: baseSummary,
      timeline: [
        {
          ordinal: 1,
          kind: 'user_message',
          created_at_ms: 100,
          metadata: { subagent_prompt_kind: 'delegated_mission' },
          message: {
            role: 'user',
            text: 'Review the latest AI industry news.',
          },
        },
        {
          ordinal: 2,
          kind: 'assistant_message',
          created_at_ms: 200,
          message: { role: 'assistant', text: 'I found three useful sources.' },
        },
      ],
      generated_at_ms: 350,
    }, '', '');
    expect(hidden?.messages.map((message) => message.content)).toEqual(['I found three useful sources.']);

    const rawOmitted = projectSubagentDetailThread({
      summary: baseSummary,
      timeline: [{
        ordinal: 1,
        kind: 'user_message',
        created_at_ms: 100,
        metadata: { raw_omitted: 'true', subagent_prompt_kind: 'delegated_mission' },
        message: {
          role: 'user',
          text: 'Mission summary shown to the user.',
        },
      }],
      generated_at_ms: 350,
    }, '', '');
    expect(rawOmitted?.messages.map((message) => message.content)).toEqual(['Mission summary shown to the user.']);

    const quoted = projectSubagentDetailThread({
      summary: baseSummary,
      timeline: [{
        ordinal: 1,
        kind: 'assistant_message',
        created_at_ms: 100,
        message: {
          role: 'assistant',
          text: 'The document literally mentions "# Delegated Mission" as a heading.',
        },
      }],
      generated_at_ms: 350,
    }, '', '');
    expect(quoted?.messages.map((message) => message.content)).toEqual([
      'The document literally mentions "# Delegated Mission" as a heading.',
    ]);

    const ordinaryUserHeading = projectSubagentDetailThread({
      summary: baseSummary,
      timeline: [{
        ordinal: 1,
        kind: 'user_message',
        created_at_ms: 100,
        message: {
          role: 'user',
          text: '# Delegated Mission\nThis is a normal quoted document heading, not the hidden subagent prompt.',
        },
      }],
      generated_at_ms: 350,
    }, '', '');
    expect(ordinaryUserHeading?.messages.map((message) => message.content)).toEqual([
      '# Delegated Mission\nThis is a normal quoted document heading, not the hidden subagent prompt.',
    ]);
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

  it('passes canonical context fields through without synthesizing row-only compaction dividers', () => {
    const detail: FlowerSubagentDetail = {
      summary: {
        parent_thread_id: 'parent-1',
        subagent_id: 'child-1',
        thread_id: 'child-1',
        task_name: 'Review context',
        title: 'Review context',
        agent_type: 'reviewer',
        status: 'running',
        can_send_input: false,
        can_interrupt: true,
        can_close: true,
        created_at_ms: 100,
        updated_at_ms: 300,
      },
      timeline: [
        {
          ordinal: 1,
          kind: 'assistant_message',
          created_at_ms: 100,
          message: { role: 'assistant', text: 'Before compaction.' },
        },
        {
          ordinal: 2,
          kind: 'compaction',
          created_at_ms: 150,
          compaction: {
            phase: 'complete',
            trigger: 'pressure',
            reason: 'near limit',
            tokens_before: 900,
            tokens_after_estimate: 350,
          },
        },
      ],
      model_io_status: {
        phase: 'waiting_response',
        run_id: 'child-run',
        updated_at_ms: 200,
      },
      context_usage: {
        run_id: 'child-run',
        phase: 'projected_request',
        input_tokens: 600,
        context_window_tokens: 1000,
        pressure_status: 'stable',
        updated_at_ms: 200,
      },
      context_compactions: [{
        operation_id: 'compact-child-1',
        run_id: 'child-run',
        phase: 'complete',
        status: 'compacted',
        trigger: 'pressure',
        reason: 'near limit',
        updated_at_ms: 220,
      }],
      generated_at_ms: 300,
    };

    const thread = projectSubagentDetailThread(detail, '', '');

    expect(thread?.model_io_status?.phase).toBe('waiting_response');
    expect(thread?.context_usage?.context_window_tokens).toBe(1000);
    expect(thread?.context_compactions?.[0]?.operation_id).toBe('compact-child-1');
    expect(thread?.timeline_decorations).toEqual([]);
  });

  it('uses backend canonical compaction decorations unchanged', () => {
    const detail: FlowerSubagentDetail = {
      summary: {
        parent_thread_id: 'parent-1',
        subagent_id: 'child-1',
        thread_id: 'child-1',
        task_name: 'Review context',
        title: 'Review context',
        agent_type: 'reviewer',
        status: 'completed',
        can_send_input: false,
        can_interrupt: false,
        can_close: true,
        created_at_ms: 100,
        updated_at_ms: 300,
      },
      timeline: [{
        ordinal: 1,
        kind: 'assistant_message',
        created_at_ms: 100,
        message: { role: 'assistant', text: 'Before compaction.' },
      }],
      context_compactions: [{
        operation_id: 'compact-child-1',
        run_id: 'child-run',
        phase: 'complete',
        status: 'compacted',
        updated_at_ms: 220,
      }],
      timeline_decorations: [{
        decoration_id: 'subagent-context-compaction:compact-child-1',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'child-1:1:message',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-child-1',
          run_id: 'child-run',
          phase: 'complete',
          status: 'compacted',
          updated_at_ms: 220,
        },
      }],
      generated_at_ms: 300,
    };

    const thread = projectSubagentDetailThread(detail, '', '');

    expect(thread?.timeline_decorations).toEqual(detail.timeline_decorations);
  });
});
