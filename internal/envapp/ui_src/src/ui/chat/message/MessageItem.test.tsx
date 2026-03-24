// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../types';
import { MessageItem } from './MessageItem';

const retryMessageMock = vi.hoisted(() => vi.fn());

let currentMessages: Message[] = [];
let currentStreamingMessageId: string | null = null;

vi.mock('../ChatProvider', () => ({
  useChatContext: () => ({
    config: () => ({
      renderMessageOrnament: ({ isActiveAssistantStreaming }: { isActiveAssistantStreaming: boolean }) => (
        isActiveAssistantStreaming ? <div data-testid="assistant-ornament">Working</div> : <></>
      ),
    }),
    streamingMessageId: () => currentStreamingMessageId,
    messages: () => currentMessages,
    retryMessage: retryMessageMock,
  }),
}));

beforeEach(() => {
  currentMessages = [];
  currentStreamingMessageId = null;
  retryMessageMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

function renderMessageItem(message: Message): HTMLDivElement {
  currentMessages = [message];
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(() => <MessageItem message={message} />, host);
  return host;
}

describe('MessageItem', () => {
  it('hides footer affordances while the active assistant message is still streaming', () => {
    const message: Message = {
      id: 'msg-streaming',
      role: 'assistant',
      status: 'streaming',
      timestamp: 0,
      blocks: [{ type: 'markdown', content: 'Hello Flower' }],
    };
    currentStreamingMessageId = 'msg-streaming';

    const host = renderMessageItem(message);

    expect(host.querySelector('[data-testid="assistant-ornament"]')).toBeTruthy();
    expect(host.querySelector('.chat-message-footer')).toBeNull();
  });

  it('restores footer affordances once the assistant message is settled', () => {
    const message: Message = {
      id: 'msg-complete',
      role: 'assistant',
      status: 'complete',
      timestamp: 0,
      blocks: [{ type: 'markdown', content: 'Settled response' }],
    };

    const host = renderMessageItem(message);

    expect(host.querySelector('[data-testid="assistant-ornament"]')).toBeNull();
    expect(host.querySelector('.chat-message-footer')).toBeTruthy();
  });
});
