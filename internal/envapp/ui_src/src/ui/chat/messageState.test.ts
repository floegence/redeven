import { describe, expect, it } from 'vitest';

import type { Message } from './types';
import { applyStreamEventToMessages, upsertMessageById } from './messageState';

describe('messageState', () => {
  it('upserts by id without changing message order', () => {
    const existing: Message[] = [
      { id: 'm1', role: 'user', blocks: [{ type: 'text', content: 'one' }], status: 'complete', timestamp: 1 },
      { id: 'm2', role: 'assistant', blocks: [{ type: 'text', content: 'two' }], status: 'complete', timestamp: 2 },
    ];

    const updated = upsertMessageById(existing, {
      id: 'm2',
      role: 'assistant',
      blocks: [{ type: 'text', content: 'updated' }],
      status: 'complete',
      timestamp: 3,
    });

    expect(updated.map((message) => message.id)).toEqual(['m1', 'm2']);
    expect((updated[1].blocks[0] as any).content).toBe('updated');
  });

  it('applies assistant stream events into a single overlay message', () => {
    const started = applyStreamEventToMessages([], { type: 'message-start', messageId: 'm_ai_1' }, { now: 100 });
    expect(started.consumeOnePrepId).toBe(true);
    expect(started.streamingMessageId).toBe('m_ai_1');
    expect(started.messages).toHaveLength(1);
    expect(started.messages[0].status).toBe('streaming');

    const withDelta = applyStreamEventToMessages(
      started.messages,
      { type: 'block-delta', messageId: 'm_ai_1', blockIndex: 0, delta: 'hello' },
      { currentStreamingMessageId: started.streamingMessageId, now: 110 },
    );
    expect((withDelta.messages[0].blocks[0] as any).content).toBe('hello');

    const withToolBlock = applyStreamEventToMessages(
      withDelta.messages,
      {
        type: 'block-set',
        messageId: 'm_ai_1',
        blockIndex: 1,
        block: { type: 'tool-call', toolName: 'ask_user', toolId: 'tool_1', args: {}, status: 'running' },
      },
      { currentStreamingMessageId: withDelta.streamingMessageId, now: 120 },
    );
    expect(withToolBlock.messages[0].blocks[1]).toMatchObject({
      type: 'tool-call',
      toolName: 'ask_user',
      toolId: 'tool_1',
    });

    const ended = applyStreamEventToMessages(
      withToolBlock.messages,
      { type: 'message-end', messageId: 'm_ai_1' },
      { currentStreamingMessageId: withToolBlock.streamingMessageId, now: 130 },
    );
    expect(ended.streamingMessageId).toBeNull();
    expect(ended.messages[0].status).toBe('complete');
  });
});
