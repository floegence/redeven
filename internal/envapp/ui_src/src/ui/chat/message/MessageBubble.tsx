// Renders message blocks inside a styled bubble.

import { For, Show, createMemo } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { Message, MessageBlock } from '../types';
import { BlockRenderer } from '../blocks/BlockRenderer';
import { visibleMessageBlocks } from './messageVisibility';

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

function isStructuredReceiptBlock(block: MessageBlock): boolean {
  return block.type === 'request_user_input_response';
}

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const visibleBlockIndices = createMemo(() => visibleMessageBlocks(props.message));
  const isStructuredReceiptMessage = createMemo(() => (
    props.message.role === 'user'
    && visibleBlockIndices().length > 0
    && visibleBlockIndices().every((index) => {
      const block = props.message.blocks[index];
      return !!block && isStructuredReceiptBlock(block);
    })
  ));

  const slotClass = (block: MessageBlock): string =>
    cn(
      'chat-message-block-slot',
      isCompactToolBlock(block) && 'chat-message-block-slot-compact',
      isStructuredReceiptBlock(block) && 'chat-message-block-slot-receipt',
    );

  return (
    <div
      class={cn(
        'chat-message-bubble',
        props.message.role === 'user' && 'chat-message-bubble-user',
        isStructuredReceiptMessage() && 'chat-message-bubble-receipt',
        props.message.role === 'assistant' && 'chat-message-bubble-assistant',
        props.message.status === 'error' && 'chat-message-bubble-error',
        props.class,
      )}
    >
      <For each={visibleBlockIndices()}>
        {(index) => {
          const block = () => props.message.blocks[index];
          return (
            <div class={slotClass(block()!)}>
              <BlockRenderer
                block={block()!}
                messageId={props.message.id}
                blockIndex={index}
                isStreaming={block()!.type === 'markdown' ? props.message.status === 'streaming' : undefined}
              />
            </div>
          );
        }}
      </For>

      <Show when={props.message.status === 'error' && props.message.error}>
        <div class="chat-message-error">
          <ErrorIcon />
          <span>{props.message.error}</span>
        </div>
      </Show>
    </div>
  );
};
