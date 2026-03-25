// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { MessageBubble } from './MessageBubble';

afterEach(() => {
  document.body.innerHTML = '';
});

function renderMessageBubble(message: Message): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(() => <MessageBubble message={message} />, host);
  return host;
}

describe('MessageBubble', () => {
  it('uses the neutral receipt bubble for structured input response messages', () => {
    const host = renderMessageBubble({
      id: 'msg-receipt',
      role: 'user',
      status: 'complete',
      timestamp: 0,
      blocks: [
        {
          type: 'request_user_input_response',
          prompt_id: 'prompt-1',
          public_summary: 'Age guess clue: Other.',
        },
      ],
    });

    const bubble = host.querySelector('.chat-message-bubble') as HTMLDivElement | null;
    expect(bubble?.className).toContain('chat-message-bubble-user');
    expect(bubble?.className).toContain('chat-message-bubble-receipt');
    expect(host.textContent).toContain('Input Submitted');
    expect(host.textContent).toContain('Age guess clue: Other.');
  });

  it('keeps ordinary user messages on the primary user bubble surface', () => {
    const host = renderMessageBubble({
      id: 'msg-user',
      role: 'user',
      status: 'complete',
      timestamp: 0,
      blocks: [
        {
          type: 'markdown',
          content: 'Plain user text',
        },
      ],
    });

    const bubble = host.querySelector('.chat-message-bubble') as HTMLDivElement | null;
    expect(bubble?.className).toContain('chat-message-bubble-user');
    expect(bubble?.className).not.toContain('chat-message-bubble-receipt');
  });

  it('keeps the visible markdown slot mounted when streaming content moves to a later raw block index', () => {
    const [message, setMessage] = createSignal<Message>({
      id: 'msg-stream-shift',
      role: 'assistant',
      status: 'streaming',
      timestamp: 0,
      blocks: [
        { type: 'markdown', content: '' },
      ],
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <MessageBubble message={message()} />, host);

    const slotBefore = host.querySelector('.chat-message-block-slot');
    const blockBefore = host.querySelector('.chat-markdown-block');
    expect(slotBefore).toBeTruthy();
    expect(blockBefore).toBeTruthy();

    setMessage({
      ...message(),
      blocks: [
        { type: 'markdown', content: '' },
        { type: 'thinking', content: 'internal' },
        { type: 'markdown', content: 'Visible answer content.' },
      ],
    });

    const slotAfter = host.querySelector('.chat-message-block-slot');
    const blockAfter = host.querySelector('.chat-markdown-block');
    expect(slotAfter).toBe(slotBefore);
    expect(blockAfter).toBe(blockBefore);
    expect(host.querySelectorAll('.chat-message-block-slot')).toHaveLength(1);
  });
});
