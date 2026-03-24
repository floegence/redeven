import { describe, expect, it } from 'vitest';

import type { Message } from '../chat/types';
import {
  carryForwardTransientMessageState,
  projectThreadTranscriptMessages,
  syncSubagentBlocksWithLatest,
} from './aiThreadRenderProjection';
import type { SubagentView } from './aiDataNormalizers';

describe('aiThreadRenderProjection', () => {
  it('keeps optimistic local user messages ahead of settled transcript messages', () => {
    const optimisticUser: Message = {
      id: 'u_local_1',
      role: 'user',
      blocks: [{ type: 'text', content: 'draft turn' }],
      status: 'complete',
      timestamp: 10,
    };
    const transcriptAssistant: Message = {
      id: 'm_ai_1',
      role: 'assistant',
      blocks: [{ type: 'text', content: 'persisted answer' }],
      status: 'complete',
      timestamp: 20,
    };

    const projected = projectThreadTranscriptMessages({
      transcriptMessages: [transcriptAssistant],
      previousRenderedMessages: [optimisticUser],
      subagentById: {},
    });

    expect(projected.map((message: Message) => message.id)).toEqual(['m_ai_1', 'u_local_1']);
  });

  it('carries forward transient tool collapse state during transcript refresh', () => {
    const previousRendered: Message[] = [
      {
        id: 'm_ai_1',
        role: 'assistant',
        blocks: [
          {
            type: 'tool-call',
            toolName: 'web.search',
            toolId: 'tool_1',
            args: {},
            status: 'success',
            collapsed: true,
          },
        ],
        status: 'complete',
        timestamp: 10,
      },
    ];
    const refreshedTranscript: Message[] = [
      {
        id: 'm_ai_1',
        role: 'assistant',
        blocks: [
          {
            type: 'tool-call',
            toolName: 'web.search',
            toolId: 'tool_1',
            args: {},
            status: 'success',
          },
        ],
        status: 'complete',
        timestamp: 11,
      },
    ];

    const carried = carryForwardTransientMessageState(previousRendered, refreshedTranscript);
    expect((carried[0].blocks[0] as any).collapsed).toBe(true);
  });

  it('syncs subagent blocks with the latest derived snapshot', () => {
    const latest: Record<string, SubagentView> = {
      sa_1: {
        subagentId: 'sa_1',
        taskId: 'task_1',
        agentType: 'worker',
        triggerReason: 'delegate',
        status: 'running',
        summary: 'updated summary',
        evidenceRefs: [],
        keyFiles: [],
        openRisks: [],
        nextActions: [],
        history: [],
        stats: {
          steps: 3,
          toolCalls: 1,
          tokens: 50,
          elapsedMs: 2000,
          outcome: '',
        },
        updatedAtUnixMs: 5000,
      },
    };

    const synced = syncSubagentBlocksWithLatest(
      [{
        id: 'm_ai_1',
        role: 'assistant',
        blocks: [{
          type: 'subagent',
          subagentId: 'sa_1',
          taskId: 'task_1',
          agentType: 'worker',
          triggerReason: 'delegate',
          status: 'queued',
          summary: 'old summary',
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
          updatedAtUnixMs: 1000,
        }],
        status: 'complete',
        timestamp: 10,
      }],
      latest,
    );

    expect((synced[0].blocks[0] as any).summary).toBe('updated summary');
    expect((synced[0].blocks[0] as any).status).toBe('running');
  });

  it('does not carry forward prior assistant-only messages that are absent from the settled transcript', () => {
    const previousRendered: Message[] = [
      {
        id: 'm_ai_old',
        role: 'assistant',
        blocks: [{ type: 'markdown', content: 'stale live content' }],
        status: 'complete',
        timestamp: 10,
      },
    ];

    const projected = projectThreadTranscriptMessages({
      transcriptMessages: [],
      previousRenderedMessages: previousRendered,
      subagentById: {},
    });

    expect(projected).toEqual([]);
  });

  it('appends the active live assistant after optimistic local user messages', () => {
    const optimisticUser: Message = {
      id: 'u_local_2',
      role: 'user',
      blocks: [{ type: 'text', content: 'latest optimistic turn' }],
      status: 'complete',
      timestamp: 30,
    };
    const liveAssistant: Message = {
      id: 'm_ai_live_1',
      role: 'assistant',
      blocks: [{ type: 'markdown', content: 'Streaming answer' }],
      status: 'streaming',
      timestamp: 31,
    };

    const projected = projectThreadTranscriptMessages({
      transcriptMessages: [],
      liveAssistantMessage: liveAssistant,
      previousRenderedMessages: [optimisticUser],
      subagentById: {},
    });

    expect(projected.map((message: Message) => message.id)).toEqual(['u_local_2', 'm_ai_live_1']);
  });

  it('suppresses the live assistant once the transcript already contains the same assistant id', () => {
    const transcriptAssistant: Message = {
      id: 'm_ai_live_2',
      role: 'assistant',
      blocks: [{ type: 'markdown', content: 'Persisted answer' }],
      status: 'complete',
      timestamp: 40,
    };
    const liveAssistant: Message = {
      id: 'm_ai_live_2',
      role: 'assistant',
      blocks: [{ type: 'markdown', content: 'Streaming answer' }],
      status: 'streaming',
      timestamp: 39,
    };

    const projected = projectThreadTranscriptMessages({
      transcriptMessages: [transcriptAssistant],
      liveAssistantMessage: liveAssistant,
      previousRenderedMessages: [],
      subagentById: {},
    });

    expect(projected).toEqual([transcriptAssistant]);
  });
});
