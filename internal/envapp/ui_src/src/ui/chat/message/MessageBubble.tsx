// Renders message blocks inside a styled bubble.

import { Index, Show, createEffect, createSignal } from 'solid-js';
import type { Accessor, Component } from 'solid-js';
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

function hasStandaloneBlockPayload(block: MessageBlock): boolean {
  switch (block.type) {
    case 'text':
    case 'markdown':
      return false;
    case 'tool-call':
      return String(block.toolName ?? '').trim().length > 0;
    case 'shell':
      return String(block.command ?? '').trim().length > 0 || String(block.output ?? '').trim().length > 0;
    case 'todos':
      return block.version > 0 || block.todos.length > 0;
    case 'sources':
      return block.sources.length > 0;
    case 'code':
      return String(block.content ?? '').length > 0;
    case 'code-diff':
      return String(block.oldCode ?? '').length > 0 || String(block.newCode ?? '').length > 0;
    case 'checklist':
      return block.items.length > 0;
    case 'image':
      return String(block.src ?? '').trim().length > 0;
    case 'file':
      return String(block.name ?? '').trim().length > 0;
    case 'svg':
    case 'mermaid':
      return String(block.content ?? '').trim().length > 0;
    case 'thinking':
      return String(block.content ?? '').trim().length > 0 || Number(block.duration ?? 0) > 0;
    default:
      return false;
  }
}

function shouldAnimateStandaloneBlock(message: Message, block: MessageBlock): boolean {
  if (message.role !== 'assistant') return false;
  if (message.status !== 'streaming') return false;
  return hasStandaloneBlockPayload(block);
}

interface MessageBlockSlotProps {
  message: Message;
  block: Accessor<MessageBlock>;
  blockIndex: number;
}

const MessageBlockSlot: Component<MessageBlockSlotProps> = (props) => {
  const [animateIn, setAnimateIn] = createSignal(false);

  createEffect(() => {
    if (animateIn()) return;
    if (shouldAnimateStandaloneBlock(props.message, props.block())) {
      setAnimateIn(true);
    }
  });

  const enterStyle = () =>
    animateIn()
      ? ({ '--chat-stream-block-enter-delay': `${Math.min(props.blockIndex, 4) * 24}ms` } as Record<string, string>)
      : undefined;

  return (
    <div
      class={cn('chat-message-block-slot', animateIn() && 'chat-message-block-slot-imessage-enter')}
      style={enterStyle()}
    >
      <BlockRenderer
        block={props.block()}
        messageId={props.message.id}
        blockIndex={props.blockIndex}
        isStreaming={props.message.status === 'streaming'}
      />
    </div>
  );
};

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
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
          <MessageBlockSlot
            message={props.message}
            block={block}
            blockIndex={index}
          />
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
