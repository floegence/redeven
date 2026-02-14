// Action buttons (copy, retry) that appear on hover over a message.

import { createSignal, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { useChatContext } from '../ChatProvider';
import type { Message } from '../types';

export interface MessageActionsProps {
  message: Message;
}

/** Extract all text content from message blocks for clipboard copy. */
function extractTextContent(message: Message): string {
  const parts: string[] = [];

  for (const block of message.blocks) {
    switch (block.type) {
      case 'text':
      case 'markdown':
        parts.push(block.content);
        break;
      case 'code':
        parts.push(block.content);
        break;
      case 'shell':
        if (block.command) parts.push(block.command);
        if (block.output) parts.push(block.output);
        break;
      case 'thinking':
        if (block.content) parts.push(block.content);
        break;
      default:
        break;
    }
  }

  return parts.join('\n\n');
}

export const MessageActions: Component<MessageActionsProps> = (props) => {
  const ctx = useChatContext();
  const [copied, setCopied] = createSignal(false);

  async function handleCopy(): Promise<void> {
    const text = extractTextContent(props.message);
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy message text:', err);
    }
  }

  function handleRetry(): void {
    ctx.retryMessage(props.message.id);
  }

  return (
    <div class="chat-message-actions">
      <button
        class="chat-message-action-btn chat-message-action-copy"
        onClick={handleCopy}
        title={copied() ? 'Copied!' : 'Copy'}
        aria-label={copied() ? 'Copied' : 'Copy message'}
      >
        <Show when={copied()} fallback={<CopyIcon />}>
          <CheckIcon />
        </Show>
      </button>

      <Show when={props.message.status === 'error'}>
        <button
          class="chat-message-action-btn chat-message-action-retry"
          onClick={handleRetry}
          title="Retry"
          aria-label="Retry message"
        >
          <RetryIcon />
        </button>
      </Show>
    </div>
  );
};

// -- Inline SVG icon components --

const CopyIcon: Component = () => (
  <svg
    class="chat-action-icon"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon: Component = () => (
  <svg
    class="chat-action-icon"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const RetryIcon: Component = () => (
  <svg
    class="chat-action-icon"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);
