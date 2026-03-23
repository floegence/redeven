// @vitest-environment jsdom

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
});
