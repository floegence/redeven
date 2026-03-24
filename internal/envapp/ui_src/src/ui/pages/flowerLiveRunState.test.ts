import { describe, expect, it } from 'vitest';

import type { Message } from '../chat/types';
import {
  applyStreamEventBatchToLiveRunMessage,
  clearLiveRunMessageIfTranscriptCaughtUp,
  mergeLiveRunSnapshot,
  resolveRenderableLiveRunMessage,
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

  it('treats transcript catch-up as the authoritative render gate for late live snapshots', () => {
    const current: Message = {
      id: 'm_live_3b',
      role: 'assistant',
      status: 'streaming',
      timestamp: 1000,
      blocks: [{ type: 'markdown', content: 'Late snapshot' }],
    };

    const transcript: Message[] = [
      {
        id: 'm_live_3b',
        role: 'assistant',
        status: 'complete',
        timestamp: 1001,
        blocks: [{ type: 'markdown', content: 'Settled transcript' }],
      },
    ];

    expect(resolveRenderableLiveRunMessage(current, transcript)).toBeNull();
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
});
