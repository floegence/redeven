// @vitest-environment jsdom

import { createSignal } from 'solid-js';
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
        isActiveAssistantStreaming && <div data-testid="assistant-ornament">Working</div>
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

    expect(host.querySelector('.chat-message-status-rail')).toBeTruthy();
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

    expect(host.querySelector('.chat-message-status-rail')).toBeTruthy();
    expect(host.querySelector('[data-testid="assistant-ornament"]')).toBeNull();
    expect(host.querySelector('.chat-message-footer')).toBeTruthy();
  });

  it('renders only the assistant avatar while keeping user rows in the shared transcript lane', () => {
    const assistantHost = renderMessageItem({
      id: 'msg-assistant-avatar',
      role: 'assistant',
      status: 'complete',
      timestamp: 0,
      blocks: [{ type: 'markdown', content: 'Assistant reply' }],
    });

    expect(assistantHost.querySelector('.chat-message-avatar-assistant')).toBeTruthy();

    const userHost = renderMessageItem({
      id: 'msg-user-no-avatar',
      role: 'user',
      status: 'complete',
      timestamp: 0,
      blocks: [{ type: 'text', content: 'User reply' }],
    });

    expect(userHost.querySelector('.chat-message-item-user')?.className).toContain('chat-message-item-without-avatar');
    expect(userHost.querySelector('.chat-message-avatar-user')).toBeNull();
  });

  it('keeps the assistant row node mounted when a pending placeholder becomes visible streaming content', () => {
    const [message, setMessage] = createSignal<Message>({
      id: 'msg-pending',
      role: 'assistant',
      status: 'streaming',
      timestamp: 0,
      blocks: [{ type: 'markdown', content: '' }],
    });
    currentMessages = [message()];

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <MessageItem message={message()} />, host);

    const rowBefore = host.querySelector('.chat-message-item-assistant');
    expect(rowBefore).toBeTruthy();

    const nextMessage: Message = {
      id: 'msg-live',
      role: 'assistant',
      status: 'streaming',
      timestamp: 0,
      blocks: [{ type: 'markdown', content: 'Hello Flower' }],
    };
    currentMessages = [nextMessage];
    setMessage(nextMessage);

    const rowAfter = host.querySelector('.chat-message-item-assistant');
    expect(rowAfter).toBe(rowBefore);
  });
});
