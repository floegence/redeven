import { describe, expect, it } from 'vitest';

import type {
  FlowerChatMessage,
  FlowerSubagentDetail,
  FlowerSubagentSummary,
} from './contracts/flowerSurfaceContracts';
import { projectSubagentDetailThread } from './flowerSubagentDetailThread';

const baseSummary: FlowerSubagentSummary = {
  parent_thread_id: 'parent-1',
  thread_id: 'child-1',
  task_name: 'Review boundary',
  agent_type: 'reviewer',
  status: 'completed',
  can_send_input: false,
  can_interrupt: false,
  can_close: true,
  created_at_ms: 100,
  updated_at_ms: 500,
};

function message(overrides: Partial<FlowerChatMessage> = {}): FlowerChatMessage {
  return {
    id: 'assistant-turn-1',
    turn_id: 'turn-1',
    thread_id: 'child-1',
    run_id: 'run-1',
    turn_ordinal: 1,
    role: 'assistant',
    content: 'Canonical assistant answer.',
    status: 'complete',
    created_at_ms: 200,
    ...overrides,
  };
}

function detail(overrides: Partial<FlowerSubagentDetail> = {}): FlowerSubagentDetail {
  return {
    summary: baseSummary,
    messages: [message()],
    timeline: [],
    generated_at_ms: 500,
    ...overrides,
  };
}

describe('projectSubagentDetailThread', () => {
  it('uses canonical Floret messages as the complete transcript authority without reordering', () => {
    const projected = projectSubagentDetailThread(detail({
      messages: [
        message({
          id: 'assistant-turn-2',
          turn_id: 'turn-2',
          run_id: 'run-2',
          turn_ordinal: 2,
          content: 'Second answer.',
          created_at_ms: 400,
        }),
        message({
          id: 'user-turn-1',
          role: 'user',
          content: 'Visible follow-up input.',
          created_at_ms: 300,
        }),
        message(),
      ],
    }));

    expect(projected?.messages.map((item) => item.id)).toEqual([
      'assistant-turn-2',
      'user-turn-1',
      'assistant-turn-1',
    ]);
    expect(projected?.messages.map((item) => item.content)).toEqual([
      'Second answer.',
      'Visible follow-up input.',
      'Canonical assistant answer.',
    ]);
  });

  it('preserves canonical blocks and full message content without rebuilding them', () => {
    const fullText = `Complete report ${'evidence section '.repeat(80)}http://arxiv.org/abs/2607.02514v1`;
    const canonical = message({
      content: fullText,
      blocks: [
        { type: 'markdown', content: fullText },
        {
          type: 'activity-timeline',
          schema_version: 1,
          summary: {
            status: 'success',
            severity: 'normal',
            needs_attention: false,
            total_items: 0,
            counts: {},
          },
          items: [],
        },
      ],
    });

    const projected = projectSubagentDetailThread(detail({ messages: [canonical] }));

    expect(projected?.messages).toEqual([canonical]);
    expect(projected?.messages[0].content).toContain('http://arxiv.org/abs/2607.02514v1');
  });

  it('never derives transcript messages from diagnostic timeline metadata or activity', () => {
    const delegatedMission = '# Delegated Mission\nInternal operating contract.';
    const projected = projectSubagentDetailThread(detail({
      messages: [message({ content: 'Visible canonical result.' })],
      timeline: [
        {
          ordinal: 1,
          kind: 'user_message',
          created_at_ms: 100,
          metadata: { subagent_prompt_kind: 'delegated_mission' },
          message: { role: 'user', text: delegatedMission },
        },
        {
          ordinal: 2,
          kind: 'assistant_message',
          created_at_ms: 200,
          message: { role: 'assistant', text: 'Diagnostic-only assistant preview.' },
        },
      ],
      activity: {
        type: 'activity-timeline',
        schema_version: 1,
        run_id: 'run-1',
        thread_id: 'child-1',
        turn_id: 'turn-1',
        summary: {
          status: 'success',
          severity: 'normal',
          needs_attention: false,
          total_items: 1,
          counts: { success: 1 },
        },
        items: [{
          item_id: 'tool:diagnostic-only',
          tool_id: 'diagnostic-only',
          tool_name: 'terminal.exec',
          kind: 'tool',
          status: 'success',
          severity: 'normal',
          needs_attention: false,
          requires_approval: false,
          label: 'diagnostic-only',
          renderer: 'terminal',
        }],
      },
    }));

    expect(projected?.messages.map((item) => item.content)).toEqual(['Visible canonical result.']);
    expect(JSON.stringify(projected)).not.toContain('Delegated Mission');
    expect(JSON.stringify(projected)).not.toContain('Diagnostic-only assistant preview');
    expect(JSON.stringify(projected)).not.toContain('diagnostic-only');
  });

  it('does not synthesize a transcript message from summary fallbacks', () => {
    const projected = projectSubagentDetailThread(detail({
      summary: {
        ...baseSummary,
        status: 'waiting_input',
        last_message: 'Summary is not conversation history.',
        waiting_prompt: 'Diagnostic waiting prompt.',
      },
      messages: [],
    }));

    expect(projected?.status).toBe('waiting_user');
    expect(projected?.messages).toEqual([]);
    expect(JSON.stringify(projected)).not.toContain('Summary is not conversation history.');
    expect(JSON.stringify(projected)).not.toContain('Diagnostic waiting prompt.');
  });

  it('passes canonical context and timeline decorations through unchanged', () => {
    const contextUsage = {
      phase: 'projected_request',
      context_window_tokens: 1000,
      request_safe_limit_tokens: 800,
      projected_input_tokens: 600,
      pressure_status: 'stable',
      used_ratio: 0.6,
      threshold_ratio: 0.85,
      updated_at_ms: 450,
    } as const;
    const compactions = [{
      operation_id: 'compact-1',
      phase: 'complete',
      status: 'compacted',
      tokens_before: 900,
      tokens_after_estimate: 350,
      observed_at_ms: 400,
      updated_at_ms: 400,
    }] as const;
    const decorations = [{
      decoration_id: 'subagent-context-compaction:compact-1',
      kind: 'context_compaction',
      anchor: { target_kind: 'message', message_id: 'assistant-turn-1', edge: 'after' },
      ordinal: 0,
      compaction: compactions[0],
    }] as const;

    const projected = projectSubagentDetailThread(detail({
      context_usage: contextUsage,
      context_compactions: compactions,
      timeline_decorations: decorations,
    }));

    expect(projected?.context_usage).toBe(contextUsage);
    expect(projected?.context_compactions).toBe(compactions);
    expect(projected?.timeline_decorations).toBe(decorations);
  });

  it('maps lifecycle status and rejects incomplete detail identity', () => {
    expect(projectSubagentDetailThread(detail({
      summary: { ...baseSummary, status: 'timed_out' },
    }))?.status).toBe('failed');
    expect(projectSubagentDetailThread(detail({
      summary: { ...baseSummary, status: 'canceled' },
    }))?.status).toBe('canceled');
    expect(projectSubagentDetailThread(detail({
      summary: { ...baseSummary, task_name: '  ' },
    }))).toBeNull();
    expect(projectSubagentDetailThread(null)).toBeNull();
  });
});
