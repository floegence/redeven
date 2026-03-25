import { describe, expect, it } from 'vitest';

import type { Message } from '../chat/types';
import {
  applyStreamEventBatchToLiveRunMessage,
  clearLiveRunMessageIfTranscriptCaughtUp,
  mergeLiveRunSnapshot,
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

  it('keeps an empty streaming assistant message so the live surface can render a placeholder', () => {
    const next = applyStreamEventBatchToLiveRunMessage(null, [
      { type: 'message-start', messageId: 'm_live_2' },
      { type: 'block-start', messageId: 'm_live_2', blockIndex: 0, blockType: 'markdown' },
    ], 1000);

    expect(next?.id).toBe('m_live_2');
    expect(next?.status).toBe('streaming');
    expect(next?.blocks).toEqual([{ type: 'markdown', content: '' }]);
  });

  it('preserves visible answer blocks when a live frame regresses to hidden-only content', () => {
    const current = makeAssistantMessage({
      id: 'm_live_hidden_1',
      blocks: [{ type: 'markdown', content: 'Visible answer' }],
    });

    const next = applyStreamEventBatchToLiveRunMessage(current, [
      { type: 'block-set', messageId: 'm_live_hidden_1', blockIndex: 0, block: { type: 'thinking', content: 'Hidden reasoning' } },
    ], 1001);

    expect(next).toEqual({
      ...current,
      blocks: [{ type: 'markdown', content: 'Visible answer' }],
    });
  });

  it('accepts active-run snapshots as the current live message', () => {
    const snapshot = makeAssistantMessage({
      id: 'm_live_snapshot_1',
      blocks: [{ type: 'markdown', content: 'Recovered snapshot' }],
    });

    expect(mergeLiveRunSnapshot(null, snapshot)).toEqual(snapshot);
  });

  it('preserves richer visible answer blocks when a same-lineage snapshot lags behind', () => {
    const current = makeAssistantMessage({
      id: 'm_live_snapshot_2',
      blocks: [{ type: 'markdown', content: 'Visible answer that should stay on screen' }],
    });
    const snapshot = makeAssistantMessage({
      id: 'm_live_snapshot_2',
      status: 'complete',
      blocks: [{ type: 'markdown', content: 'Visible answer' }],
    });

    expect(mergeLiveRunSnapshot(current, snapshot)).toEqual({
      ...snapshot,
      blocks: [{ type: 'markdown', content: 'Visible answer that should stay on screen' }],
    });
  });

  it('drops completed snapshots that have no visible live-run content', () => {
    const snapshot = makeAssistantMessage({
      id: 'm_live_3',
      status: 'complete',
      blocks: [{ type: 'markdown', content: '' }],
    });

    expect(mergeLiveRunSnapshot(null, snapshot)).toBeNull();
  });

  it('keeps completed snapshots that still contain non-thinking activity blocks', () => {
    const snapshot = makeAssistantMessage({
      id: 'm_live_4',
      status: 'complete',
      blocks: [
        {
          type: 'tool-call',
          toolName: 'terminal.exec',
          toolId: 'tool_1',
          args: {},
          status: 'running',
        },
      ],
    });

    expect(mergeLiveRunSnapshot(null, snapshot)).toEqual(snapshot);
  });

  it('clears the live run once the transcript includes the same message id', () => {
    const current = makeAssistantMessage({
      id: 'm_live_5',
      status: 'complete',
      blocks: [{ type: 'markdown', content: 'Final answer' }],
    });

    const transcript = [
      makeAssistantMessage({
        id: 'm_live_5',
        status: 'complete',
        timestamp: 1001,
        blocks: [{ type: 'markdown', content: 'Final answer' }],
      }),
    ];

    expect(clearLiveRunMessageIfTranscriptCaughtUp(current, transcript)).toBeNull();
  });

  it('treats transcript catch-up as the authoritative render gate for late live snapshots', () => {
    const current = makeAssistantMessage({
      id: 'm_live_6',
      blocks: [{ type: 'markdown', content: 'Late snapshot' }],
    });

    const transcript = [
      makeAssistantMessage({
        id: 'm_live_6',
        status: 'complete',
        timestamp: 1001,
        blocks: [{ type: 'markdown', content: 'Settled transcript' }],
      }),
    ];

    expect(resolveRenderableLiveRunMessage(current, transcript)).toBeNull();
  });
});
