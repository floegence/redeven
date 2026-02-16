// Renders message blocks inside a styled bubble.

import { Index, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { Message, MessageBlock } from '../types';
import { BlockRenderer } from '../blocks/BlockRenderer';

export interface MessageBubbleProps {
  message: Message;
  class?: string;
}

/** Inline error icon (SVG). */
const ErrorIcon: Component = () => (
  <svg
    class="chat-error-icon"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

function isCompactToolBlock(block: MessageBlock): boolean {
  return block.type === 'tool-call' || block.type === 'shell';
}

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const slotClass = (block: MessageBlock): string =>
    cn(
      'chat-message-block-slot',
      isCompactToolBlock(block) && 'chat-message-block-slot-compact',
    );

  return (
    <div
      class={cn(
        'chat-message-bubble',
        props.message.role === 'user' && 'chat-message-bubble-user',
        props.message.role === 'assistant' && 'chat-message-bubble-assistant',
        props.message.status === 'error' && 'chat-message-bubble-error',
        props.class,
      )}
    >
      <Index each={props.message.blocks}>
        {(block, index) => (
          <div class={slotClass(block())}>
            <BlockRenderer
              block={block()}
              messageId={props.message.id}
              blockIndex={index}
              isStreaming={block().type === 'markdown' ? props.message.status === 'streaming' : undefined}
            />
          </div>
        )}
      </Index>

      <Show when={props.message.status === 'error' && props.message.error}>
        <div class="chat-message-error">
          <ErrorIcon />
          <span>{props.message.error}</span>
        </div>
      </Show>
    </div>
  );
};
