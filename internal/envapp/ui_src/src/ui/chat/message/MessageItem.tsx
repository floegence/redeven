// Wraps a single message with avatar, bubble, and footer.

import { Show, createMemo } from 'solid-js';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { useChatContext } from '../ChatProvider';
import type { ChatAvatar, Message } from '../types';
import { MessageAvatar } from './MessageAvatar';
import { MessageBubble } from './MessageBubble';
import { MessageMeta } from './MessageMeta';
import { MessageActions } from './MessageActions';
import { hasVisibleMessageContent } from './messageVisibility';

export interface MessageItemProps {
  message: Message;
  showAvatar?: boolean;
  class?: string;
  activeAssistantStreaming?: boolean;
  transient?: boolean;
}

export const MessageItem: Component<MessageItemProps> = (props) => {
  const ctx = useChatContext();
  const config = ctx.config;

  // Resolve avatar source based on role
  const avatar = (): ChatAvatar | undefined => {
    const cfg = config();
    return props.message.role === 'user' ? cfg.userAvatar : cfg.assistantAvatar;
  };

  const isActiveAssistantStreaming = () => {
    if (typeof props.activeAssistantStreaming === 'boolean') {
      return props.message.role === 'assistant' && props.activeAssistantStreaming;
    }

    if (props.message.role !== 'assistant') return false;

    const currentStreamingId = ctx.streamingMessageId();
    if (currentStreamingId) {
      return currentStreamingId === props.message.id;
    }

    if (props.message.status !== 'streaming') return false;

    // Fallback for snapshots that can restore a streaming message before stream frames arrive.
    const allMessages = ctx.messages();
    for (let i = allMessages.length - 1; i >= 0; i -= 1) {
      const candidate = allMessages[i];
      if (candidate.role === 'assistant' && candidate.status === 'streaming') {
        return candidate.id === props.message.id;
      }
    }
    return false;
  };

  const MessageOrnament = createMemo(() => config().renderMessageOrnament);
  const shouldRenderOrnament = createMemo(() =>
    props.message.role === 'assistant' &&
    isActiveAssistantStreaming() &&
    !!MessageOrnament(),
  );
  const shouldRenderMessage = createMemo(() => hasVisibleMessageContent(props.message) || shouldRenderOrnament());
  const isTransientAssistantMessage = createMemo(() => props.message.role === 'assistant' && props.transient === true);
  const showFooter = createMemo(() =>
    !isTransientAssistantMessage() && !(props.message.role === 'assistant' && isActiveAssistantStreaming()),
  );
  const showStatusRail = createMemo(() => shouldRenderOrnament() || showFooter());

  return (
    <Show when={shouldRenderMessage()}>
      <div
        class={cn(
          'chat-message-item',
          props.message.role === 'user' && 'chat-message-item-user',
          props.message.role === 'assistant' && 'chat-message-item-assistant',
          props.class,
        )}
      >
        <Show when={props.showAvatar !== false}>
          <MessageAvatar
            role={props.message.role}
            avatar={avatar()}
            isStreaming={isActiveAssistantStreaming()}
          />
        </Show>

        <div class="chat-message-content-wrapper">
          <MessageBubble message={props.message} />

          <Show when={showStatusRail()}>
            <div class="chat-message-status-rail">
              <Show when={shouldRenderOrnament() && MessageOrnament()}>
                <div class="chat-message-ornament">
                  <Dynamic
                    component={MessageOrnament()!}
                    message={props.message}
                    isActiveAssistantStreaming={isActiveAssistantStreaming()}
                  />
                </div>
              </Show>

              <Show when={showFooter()}>
                <div class="chat-message-footer">
                  <MessageMeta
                    timestamp={props.message.timestamp}
                    status={props.message.status}
                  />
                  <MessageActions message={props.message} />
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};
