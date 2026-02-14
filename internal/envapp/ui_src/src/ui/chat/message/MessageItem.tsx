// Wraps a single message with avatar, bubble, and footer.

import { Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { useChatContext } from '../ChatProvider';
import type { Message } from '../types';
import { MessageAvatar } from './MessageAvatar';
import { MessageBubble } from './MessageBubble';
import { MessageMeta } from './MessageMeta';
import { MessageActions } from './MessageActions';

export interface MessageItemProps {
  message: Message;
  showAvatar?: boolean;
  class?: string;
}

export const MessageItem: Component<MessageItemProps> = (props) => {
  const ctx = useChatContext();
  const config = ctx.config;

  // Resolve avatar source based on role
  const avatarSrc = () => {
    const cfg = config();
    return props.message.role === 'user' ? cfg.userAvatar : cfg.assistantAvatar;
  };

  return (
    <div
      class={cn(
        'chat-message-item',
        props.message.role === 'user' && 'chat-message-item-user',
        props.message.role === 'assistant' && 'chat-message-item-assistant',
        props.class,
      )}
    >
      <Show when={props.showAvatar !== false}>
        <MessageAvatar role={props.message.role} src={avatarSrc()} />
      </Show>

      <div class="chat-message-content-wrapper">
        <MessageBubble message={props.message} />

        <div class="chat-message-footer">
          <MessageMeta
            timestamp={props.message.timestamp}
            status={props.message.status}
          />
          <MessageActions message={props.message} />
        </div>
      </div>
    </div>
  );
};
