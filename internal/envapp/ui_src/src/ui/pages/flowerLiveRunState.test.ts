import { describe, expect, it } from 'vitest';

import type { Message } from '../chat/types';
import {
  applyStreamEventBatchToLiveRunMessage,
  clearLiveRunMessageIfTranscriptCaughtUp,
  getLiveRunActivityBlockEntries,
  getLiveRunAnswerBlockEntries,
  mergeLiveRunSnapshot,
} from './flowerLiveRunState';

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

  it('keeps answer and activity blocks in separate partitions', () => {
    const message: Message = {
      id: 'm_live_2',
      role: 'assistant',
      status: 'streaming',
      timestamp: 1000,
      blocks: [
        { type: 'markdown', content: 'Visible answer' },
        {
          type: 'tool-call',
          toolName: 'terminal.exec',
          toolId: 'tool_1',
          args: {},
          status: 'running',
        },
      ],
    };

    expect(getLiveRunAnswerBlockEntries(message).map((entry) => entry.index)).toEqual([0]);
    expect(getLiveRunActivityBlockEntries(message).map((entry) => entry.index)).toEqual([1]);
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

  it('keeps an empty streaming assistant message so the live surface can render a placeholder', () => {
    const next = applyStreamEventBatchToLiveRunMessage(null, [
      { type: 'message-start', messageId: 'm_live_6' },
      { type: 'block-start', messageId: 'm_live_6', blockIndex: 0, blockType: 'markdown' },
    ], 1000);

    expect(next?.id).toBe('m_live_6');
    expect(next?.status).toBe('streaming');
    expect(next?.blocks).toEqual([{ type: 'markdown', content: '' }]);
  });
});
