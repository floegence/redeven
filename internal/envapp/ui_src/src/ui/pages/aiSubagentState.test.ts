import { describe, expect, it } from 'vitest';

import type { Message } from '../chat/types';
import type { SubagentView } from './aiDataNormalizers';
import {
  deriveSubagentViewsFromMessages,
  sameSubagentViewContent,
  sameSubagentViewMap,
} from './aiSubagentState';

function makeSubagentView(summary = 'summary'): SubagentView {
  return {
    subagentId: 'sa_1',
    taskId: 'task_1',
    agentType: 'worker',
    triggerReason: 'delegate',
    status: 'running',
    summary,
    evidenceRefs: [],
    keyFiles: [],
    openRisks: [],
    nextActions: [],
    history: [],
    stats: {
      steps: 1,
      toolCalls: 0,
      tokens: 10,
      elapsedMs: 100,
      outcome: '',
    },
    updatedAtUnixMs: 1000,
  };
}

describe('aiSubagentState', () => {
  it('derives the latest subagent snapshot from transcript messages and subagents tool results', () => {
    const messages: Message[] = [
      {
        id: 'm_ai_1',
        role: 'assistant',
        status: 'complete',
        timestamp: 100,
        blocks: [{
          type: 'subagent',
          subagentId: 'sa_1',
          taskId: 'task_1',
          agentType: 'worker',
          triggerReason: 'delegate',
          status: 'queued',
          summary: 'queued summary',
          evidenceRefs: [],
          keyFiles: [],
          openRisks: [],
          nextActions: [],
          history: [],
          stats: {
            steps: 0,
            toolCalls: 0,
            tokens: 0,
            elapsedMs: 0,
            outcome: '',
          },
          updatedAtUnixMs: 100,
        }],
      },
      {
        id: 'm_ai_2',
        role: 'assistant',
        status: 'complete',
        timestamp: 200,
        blocks: [{
          type: 'tool-call',
          toolName: 'subagents',
          toolId: 'tool_1',
          status: 'success',
          args: { action: 'create', title: 'Worker title' },
          result: {
            subagent_id: 'sa_1',
            task_id: 'task_1',
            agent_type: 'worker',
            trigger_reason: 'delegate',
            status: 'running',
            result: 'running summary',
            updated_at_ms: 200,
          },
        } as any],
      },
    ];

    const derived = deriveSubagentViewsFromMessages(messages);

    expect(derived.sa_1).toMatchObject({
      subagentId: 'sa_1',
      status: 'running',
      summary: 'running summary',
      title: 'Worker title',
    });
  });

  it('compares subagent view maps by semantic content', () => {
    const left = { sa_1: makeSubagentView() };
    const right = { sa_1: makeSubagentView() };
    const changed = { sa_1: makeSubagentView('changed summary') };

    expect(sameSubagentViewContent(left.sa_1, right.sa_1)).toBe(true);
    expect(sameSubagentViewMap(left, right)).toBe(true);
    expect(sameSubagentViewMap(left, changed)).toBe(false);
  });

  it('treats structured fields as equal regardless of object key order', () => {
    const left = {
      ...makeSubagentView(),
      outputSchema: {
        type: 'object',
        properties: {
          alpha: { type: 'string' },
          beta: { type: 'number' },
        },
        required: ['alpha', 'beta'],
      },
    };
    const right = {
      ...makeSubagentView(),
      outputSchema: {
        required: ['alpha', 'beta'],
        properties: {
          beta: { type: 'number' },
          alpha: { type: 'string' },
        },
        type: 'object',
      },
    };

    expect(sameSubagentViewContent(left, right)).toBe(true);
  });
});
