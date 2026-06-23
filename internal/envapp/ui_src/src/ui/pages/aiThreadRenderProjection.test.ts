import { describe, expect, it } from 'vitest';

import type { Message } from '../chat/types';
import {
  carryForwardTransientMessageState,
  projectThreadTranscriptMessages,
} from './aiThreadRenderProjection';

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
    });

    expect(projected.map((message: Message) => message.id)).toEqual(['m_ai_1', 'u_local_1']);
  });

  it('carries forward optimistic activity approval state during transcript refresh', () => {
    const previousRendered: Message[] = [
      {
        id: 'm_ai_1',
        role: 'assistant',
        blocks: [
          {
            type: 'activity-timeline',
            schema_version: 1,
            run_id: 'run_1',
            turn_id: 'm_ai_1',
            summary: {
              status: 'running',
              severity: 'normal',
              needs_attention: true,
              total_items: 1,
              counts: { running: 1, approval: 1 },
            },
            items: [{
              item_id: 'tool_1',
              tool_id: 'tool_1',
              tool_name: 'file.edit',
              kind: 'tool',
              status: 'running',
              severity: 'normal',
              needs_attention: true,
              label: 'Edited file',
              requires_approval: true,
              approval_state: 'approved',
            }],
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
            type: 'activity-timeline',
            schema_version: 1,
            run_id: 'run_1',
            turn_id: 'm_ai_1',
            summary: {
              status: 'waiting',
              severity: 'blocking',
              needs_attention: true,
              total_items: 1,
              counts: { waiting: 1, approval: 1 },
            },
            items: [{
              item_id: 'tool_1',
              tool_id: 'tool_1',
              tool_name: 'file.edit',
              kind: 'tool',
              status: 'pending',
              severity: 'normal',
              needs_attention: true,
              label: 'Edited file',
              requires_approval: true,
              approval_state: 'requested',
            }],
          },
        ],
        status: 'complete',
        timestamp: 11,
      },
    ];

    const carried = carryForwardTransientMessageState(previousRendered, refreshedTranscript);
    expect((carried[0].blocks[0] as any).items[0].approval_state).toBe('approved');
    expect((carried[0].blocks[0] as any).items[0].status).toBe('running');
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
    });

    expect(projected).toEqual([]);
  });

  it('keeps transcript projection scoped to settled transcript semantics only', () => {
    const previousRendered: Message[] = [
      {
        id: 'm_ai_live_3',
        renderKey: 'active-run:thread-3',
        role: 'assistant',
        blocks: [{ type: 'markdown', content: 'Streaming answer' }],
        status: 'streaming',
        timestamp: 50,
      },
      {
        id: 'u_local_3',
        role: 'user',
        blocks: [{ type: 'text', content: 'optimistic user turn' }],
        status: 'complete',
        timestamp: 49,
      },
    ];

    const projected = projectThreadTranscriptMessages({
      transcriptMessages: [],
      previousRenderedMessages: previousRendered,
    });

    expect(projected.map((message: Message) => message.id)).toEqual(['u_local_3']);
  });
});
