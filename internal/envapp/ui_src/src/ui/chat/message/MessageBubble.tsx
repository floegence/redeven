// Renders message blocks inside a styled bubble.

import { Index, Show, createEffect, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Motion } from 'solid-motionone';
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

const IMESSAGE_MAX_STAGGER_INDEX = 4;
const IMESSAGE_STAGGER_SECONDS = 0.026;
const IMESSAGE_ENTER_SECONDS = 0.34;
const IMESSAGE_EASING = 'ease-out';

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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
  // Keep runtime tool surfaces deterministic while stream frames update rapidly.
  if (block.type === 'tool-call' || block.type === 'shell') return false;
  return hasStandaloneBlockPayload(block);
}

function isCompactToolBlock(block: MessageBlock): boolean {
  return block.type === 'tool-call' || block.type === 'shell';
}

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const prefersReducedMotion = readPrefersReducedMotion();
  const [animatedSlots, setAnimatedSlots] = createSignal<Record<number, true>>({});
  let lastMessageId = String(props.message.id ?? '');

  createEffect(() => {
    const currentMessageId = String(props.message.id ?? '');
    if (currentMessageId === lastMessageId) {
      return;
    }
    lastMessageId = currentMessageId;
    setAnimatedSlots({});
  });

  createEffect(() => {
    if (prefersReducedMotion) return;
    if (props.message.role !== 'assistant' || props.message.status !== 'streaming') {
      return;
    }
    const blocks = props.message.blocks;
    setAnimatedSlots((prev) => {
      let changed = false;
      const next: Record<number, true> = { ...prev };
      for (let i = 0; i < blocks.length; i += 1) {
        if (next[i]) continue;
        if (!shouldAnimateStandaloneBlock(props.message, blocks[i])) continue;
        next[i] = true;
        changed = true;
      }
      return changed ? next : prev;
    });
  });

  const shouldAnimateSlot = (blockIndex: number): boolean => {
    if (prefersReducedMotion) return false;
    return !!animatedSlots()[blockIndex];
  };

  const slotEnterDelay = (blockIndex: number): number => {
    return Math.min(blockIndex, IMESSAGE_MAX_STAGGER_INDEX) * IMESSAGE_STAGGER_SECONDS;
  };

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
          <Show
            when={shouldAnimateSlot(index)}
            fallback={
              <div class={slotClass(block())}>
                <BlockRenderer
                  block={block()}
                  messageId={props.message.id}
                  blockIndex={index}
                  isStreaming={block().type === 'markdown' ? props.message.status === 'streaming' : undefined}
                />
              </div>
            }
          >
            <Motion.div
              class={cn(slotClass(block()), 'chat-message-block-slot-imessage')}
              initial={{ opacity: 0, x: 14, y: 10, scale: 0.96, filter: 'blur(2px)' }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' }}
              transition={{
                duration: IMESSAGE_ENTER_SECONDS,
                delay: slotEnterDelay(index),
                easing: IMESSAGE_EASING,
              }}
            >
              <BlockRenderer
                block={block()}
                messageId={props.message.id}
                blockIndex={index}
                isStreaming={block().type === 'markdown' ? props.message.status === 'streaming' : undefined}
              />
            </Motion.div>
          </Show>
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
