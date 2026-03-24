import { describe, expect, it } from 'vitest';

import type { Message } from '../chat/types';
import {
  carryForwardTransientMessageState,
  projectThreadRenderMessages,
  pruneConvergedOverlayMessages,
  syncSubagentBlocksWithLatest,
} from './aiThreadRenderProjection';
import type { SubagentView } from './aiDataNormalizers';

describe('aiThreadRenderProjection', () => {
  it('keeps optimistic local user messages ahead of overlay assistant messages', () => {
    const optimisticUser: Message = {
      id: 'u_local_1',
      role: 'user',
      blocks: [{ type: 'text', content: 'draft turn' }],
      status: 'complete',
      timestamp: 10,
    };
    const overlayAssistant: Message = {
      id: 'm_ai_1',
      role: 'assistant',
      blocks: [{ type: 'text', content: 'streamed answer' }],
      status: 'streaming',
      timestamp: 20,
    };

    const projected = projectThreadRenderMessages({
      transcriptMessages: [],
      overlayMessages: [overlayAssistant],
      previousRenderedMessages: [optimisticUser],
      subagentById: {},
    });

    expect(projected.map((message) => message.id)).toEqual(['u_local_1', 'm_ai_1']);
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

  it('drops converged overlay messages after transcript catches up', () => {
    const transcript: Message[] = [
      { id: 'm_ai_1', role: 'assistant', blocks: [{ type: 'text', content: 'persisted' }], status: 'complete', timestamp: 20 },
    ];
    const overlay: Message[] = [
      { id: 'm_ai_1', role: 'assistant', blocks: [{ type: 'text', content: 'overlay' }], status: 'complete', timestamp: 21 },
      { id: 'm_ai_2', role: 'assistant', blocks: [{ type: 'text', content: 'still live' }], status: 'streaming', timestamp: 22 },
    ];

    const pruned = pruneConvergedOverlayMessages(transcript, overlay);
    expect(pruned.map((message) => message.id)).toEqual(['m_ai_2']);
  });
});
