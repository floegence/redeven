import { describe, expect, it } from 'vitest';

import { hasVisibleMessageContent, visibleMessageBlocks } from './messageVisibility';
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

    expect(visibleMessageBlocks(message).map(({ block }) => block.type)).toEqual(['markdown']);
    expect(hasVisibleMessageContent(message)).toBe(true);
  });
});
