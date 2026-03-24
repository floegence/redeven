import { describe, expect, it } from 'vitest';

import { hasNonEmptyVisibleMessageContent, hasVisibleMessageContent, visibleMessageBlocks } from './messageVisibility';
import type { Message } from '../types';

describe('messageVisibility', () => {
  it('hides thinking blocks from the default visible message view', () => {
    const message: Message = {
      id: 'm1',
      role: 'assistant',
      status: 'complete',
      timestamp: 1,
      blocks: [
        { type: 'thinking', content: 'Internal repair chatter.', duration: 1200 },
      ],
    };

    expect(visibleMessageBlocks(message)).toEqual([]);
    expect(hasVisibleMessageContent(message)).toBe(false);
  });

  it('still shows visible markdown when thinking is present in the same message', () => {
    const message: Message = {
      id: 'm2',
      role: 'assistant',
      status: 'complete',
      timestamp: 1,
      blocks: [
        { type: 'thinking', content: 'Internal repair chatter.' },
        { type: 'markdown', content: 'Final visible answer.' },
      ],
    };

    expect(visibleMessageBlocks(message).map((index) => message.blocks[index]?.type)).toEqual(['markdown']);
    expect(hasVisibleMessageContent(message)).toBe(true);
  });

  it('distinguishes streaming placeholder markdown from non-empty visible content', () => {
    const placeholder: Message = {
      id: 'm3',
      role: 'assistant',
      status: 'streaming',
      timestamp: 1,
      blocks: [
        { type: 'markdown', content: '' },
      ],
    };

    expect(hasVisibleMessageContent(placeholder)).toBe(true);
    expect(hasNonEmptyVisibleMessageContent(placeholder)).toBe(false);
  });

  it('hides earlier empty streaming markdown blocks when a later block is renderable', () => {
    const message: Message = {
      id: 'm4',
      role: 'assistant',
      status: 'streaming',
      timestamp: 1,
      blocks: [
        { type: 'markdown', content: '' },
        { type: 'markdown', content: 'Later visible content.' },
      ],
    };

    expect(visibleMessageBlocks(message).map((index) => ({ index, type: message.blocks[index]?.type }))).toEqual([
      { index: 1, type: 'markdown' },
    ]);
  });

  it('keeps only the last empty streaming markdown placeholder when several are present', () => {
    const message: Message = {
      id: 'm5',
      role: 'assistant',
      status: 'streaming',
      timestamp: 1,
      blocks: [
        { type: 'markdown', content: '' },
        { type: 'markdown', content: '' },
      ],
    };

    expect(visibleMessageBlocks(message)).toEqual([1]);
    expect(hasVisibleMessageContent(message)).toBe(true);
    expect(hasNonEmptyVisibleMessageContent(message)).toBe(false);
  });
});
