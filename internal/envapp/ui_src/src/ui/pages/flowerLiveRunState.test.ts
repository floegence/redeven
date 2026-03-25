import { describe, expect, it } from 'vitest';

import type { Message } from '../chat/types';
import {
  applyStreamEventBatchToLiveRunMessage,
  buildPendingLiveRunMessage,
  clearLiveRunMessageIfTranscriptCaughtUp,
  mergeLiveRunSnapshot,
  resolveDisplayedLiveRunMessage,
  resolveRenderableLiveRunMessage,
} from './flowerLiveRunState';

function makeAssistantMessage(args: Partial<Message> & Pick<Message, 'id'>): Message {
  return {
    id: args.id,
    role: 'assistant',
    status: args.status ?? 'streaming',
    timestamp: args.timestamp ?? 1000,
    blocks: args.blocks ?? [],
    renderKey: args.renderKey,
    sourceMessageId: args.sourceMessageId,
    error: args.error,
  };
}

describe('flowerLiveRunState', () => {
  it('builds a single assistant live message from batched stream events', () => {
    const next = applyStreamEventBatchToLiveRunMessage(null, [
      { type: 'message-start', messageId: 'm_live_1' },
      { type: 'block-start', messageId: 'm_live_1', blockIndex: 0, blockType: 'markdown' },
      { type: 'block-delta', messageId: 'm_live_1', blockIndex: 0, delta: 'Hello Flower' },
    ], 1000);

    expect(next?.id).toBe('m_live_1');
    expect(next?.status).toBe('streaming');
    expect(next?.blocks).toEqual([{ type: 'markdown', content: 'Hello Flower' }]);
  });

  it('binds realtime stream events into the pending display slot without changing the display message id', () => {
    const pending = buildPendingLiveRunMessage({
      messageId: 'm_ai_pending:thread-1',
      renderKey: 'active-run:thread-1',
      timestamp: 1000,
    });

    const next = applyStreamEventBatchToLiveRunMessage(pending, [
      { type: 'message-start', messageId: 'm_live_bound_1' },
      { type: 'block-start', messageId: 'm_live_bound_1', blockIndex: 0, blockType: 'markdown' },
      { type: 'block-delta', messageId: 'm_live_bound_1', blockIndex: 0, delta: 'Bound into the active slot' },
    ], 1001);

    expect(next?.id).toBe('m_ai_pending:thread-1');
    expect(next?.sourceMessageId).toBe('m_live_bound_1');
    expect(next?.renderKey).toBe('active-run:thread-1');
    expect(next?.blocks).toEqual([{ type: 'markdown', content: 'Bound into the active slot' }]);
  });

  it('clears the live run once the transcript includes the same message id', () => {
    const current: Message = {
      id: 'm_live_3',
      role: 'assistant',
      status: 'complete',
      timestamp: 1000,
      blocks: [{ type: 'markdown', content: 'Final answer' }],
    };

    const transcript: Message[] = [
      {
        id: 'm_live_3',
        role: 'assistant',
        status: 'complete',
        timestamp: 1001,
        blocks: [{ type: 'markdown', content: 'Final answer' }],
      },
    ];

    expect(clearLiveRunMessageIfTranscriptCaughtUp(current, transcript)).toBeNull();
  });

  it('clears a stable display slot once the transcript includes its backing source message id', () => {
    const current: Message = {
      id: 'm_ai_pending:thread-1',
      sourceMessageId: 'm_live_3c',
      role: 'assistant',
      status: 'complete',
      timestamp: 1000,
      blocks: [{ type: 'markdown', content: 'Final answer' }],
    };

    const transcript: Message[] = [
      {
        id: 'm_live_3c',
        role: 'assistant',
        status: 'complete',
        timestamp: 1001,
        blocks: [{ type: 'markdown', content: 'Final answer' }],
      },
    ];

    expect(clearLiveRunMessageIfTranscriptCaughtUp(current, transcript)).toBeNull();
  });

  it('treats transcript catch-up as the authoritative render gate for late live snapshots', () => {
    const current = makeAssistantMessage({
      id: 'm_live_3b',
      blocks: [{ type: 'markdown', content: 'Late snapshot' }],
    });

    const transcript: Message[] = [
      makeAssistantMessage({
        id: 'm_live_3b',
        status: 'complete',
        timestamp: 1001,
        blocks: [{ type: 'markdown', content: 'Settled transcript' }],
      }),
    ];

    expect(resolveRenderableLiveRunMessage(current, transcript)).toBeNull();
  });

  it('keeps the last visible answer when the current live frame regresses to hidden-only content', () => {
    const previousDisplayed = makeAssistantMessage({
      id: 'm_ai_pending:thread-1',
      renderKey: 'active-run:thread-1',
      sourceMessageId: 'm_live_hidden_1',
      blocks: [{ type: 'markdown', content: 'Visible answer' }],
    });
    const current = makeAssistantMessage({
      id: 'm_ai_pending:thread-1',
      renderKey: 'active-run:thread-1',
      sourceMessageId: 'm_live_hidden_1',
      blocks: [{ type: 'thinking', content: 'Hidden reasoning' }],
    });

    expect(resolveDisplayedLiveRunMessage({
      current,
      previousDisplayed,
      pending: null,
      transcriptMessages: [],
    })).toEqual(previousDisplayed);
  });

  it('preserves richer visible answer blocks when a same-lineage snapshot lags behind', () => {
    const previousDisplayed = makeAssistantMessage({
      id: 'm_ai_pending:thread-1',
      renderKey: 'active-run:thread-1',
      sourceMessageId: 'm_live_snapshot_lag',
      blocks: [{ type: 'markdown', content: 'Visible answer that should stay on screen' }],
    });
    const current = makeAssistantMessage({
      id: 'm_ai_pending:thread-1',
      renderKey: 'active-run:thread-1',
      sourceMessageId: 'm_live_snapshot_lag',
      status: 'complete',
      blocks: [{ type: 'markdown', content: 'Visible answer' }],
    });

    expect(resolveDisplayedLiveRunMessage({
      current,
      previousDisplayed,
      pending: null,
      transcriptMessages: [],
    })).toEqual({
      ...current,
      blocks: [{ type: 'markdown', content: 'Visible answer that should stay on screen' }],
    });
  });

  it('clears the previously displayed live message once the transcript catches up to its source id', () => {
    const previousDisplayed = makeAssistantMessage({
      id: 'm_ai_pending:thread-1',
      renderKey: 'active-run:thread-1',
      sourceMessageId: 'm_live_caught_up',
      blocks: [{ type: 'markdown', content: 'Visible answer' }],
    });

    expect(resolveDisplayedLiveRunMessage({
      current: null,
      previousDisplayed,
      pending: null,
      transcriptMessages: [
        makeAssistantMessage({
          id: 'm_live_caught_up',
          status: 'complete',
          timestamp: 1001,
          blocks: [{ type: 'markdown', content: 'Settled transcript answer' }],
        }),
      ],
    })).toBeNull();
  });

  it('accepts active-run snapshots as the current live message', () => {
    const snapshot: Message = {
      id: 'm_live_4',
      role: 'assistant',
      status: 'streaming',
      timestamp: 1000,
      blocks: [{ type: 'markdown', content: 'Recovered snapshot' }],
    };

    expect(mergeLiveRunSnapshot(null, snapshot)).toEqual(snapshot);
  });

  it('merges a live snapshot into the pending display slot while preserving the stable display id', () => {
    const current = buildPendingLiveRunMessage({
      messageId: 'm_ai_pending:thread-1',
      renderKey: 'active-run:thread-1',
      timestamp: 1000,
    });
    const snapshot: Message = {
      id: 'm_live_snapshot_1',
      role: 'assistant',
      status: 'streaming',
      timestamp: 1001,
      blocks: [{ type: 'markdown', content: 'Recovered snapshot' }],
    };

    expect(mergeLiveRunSnapshot(current, snapshot)).toEqual({
      id: 'm_ai_pending:thread-1',
      sourceMessageId: 'm_live_snapshot_1',
      renderKey: 'active-run:thread-1',
      role: 'assistant',
      status: 'streaming',
      timestamp: 1001,
      blocks: [{ type: 'markdown', content: 'Recovered snapshot' }],
    });
  });

  it('drops completed snapshots that have no visible live-run content', () => {
    const snapshot: Message = {
      id: 'm_live_5',
      role: 'assistant',
      status: 'complete',
      timestamp: 1000,
      blocks: [{ type: 'markdown', content: '' }],
    };

    expect(mergeLiveRunSnapshot(null, snapshot)).toBeNull();
  });

  it('keeps completed snapshots that still contain non-thinking activity blocks', () => {
    const snapshot: Message = {
      id: 'm_live_5b',
      role: 'assistant',
      status: 'complete',
      timestamp: 1000,
      blocks: [
        {
          type: 'tool-call',
          toolName: 'terminal.exec',
          toolId: 'tool_1',
          args: {},
          status: 'running',
        },
      ],
    };

    expect(mergeLiveRunSnapshot(null, snapshot)).toEqual(snapshot);
  });

  it('keeps an empty streaming assistant message so the live surface can render a placeholder', () => {
    const next = applyStreamEventBatchToLiveRunMessage(null, [
      { type: 'message-start', messageId: 'm_live_6' },
      { type: 'block-start', messageId: 'm_live_6', blockIndex: 0, blockType: 'markdown' },
    ], 1000);

    expect(next?.id).toBe('m_live_6');
    expect(next?.status).toBe('streaming');
    expect(next?.blocks).toEqual([{ type: 'markdown', content: '' }]);
  });

  it('builds a pending live-run placeholder message with a stable render identity', () => {
    expect(buildPendingLiveRunMessage({
      messageId: 'm_pending_1',
      renderKey: 'active-run:thread-1',
      timestamp: 1234,
    })).toEqual({
      id: 'm_pending_1',
      renderKey: 'active-run:thread-1',
      role: 'assistant',
      status: 'streaming',
      timestamp: 1234,
      blocks: [{ type: 'markdown', content: '' }],
    });
  });
});
