import { Show, type Component, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import type { ChatAvatar, MessageRole } from '../types';
import { MessageAvatar } from './MessageAvatar';

export interface MessageFrameProps {
  role: MessageRole;
  avatar?: ChatAvatar;
  showAvatar?: boolean;
  avatarStreaming?: boolean;
  class?: string;
  children: JSX.Element;
}

export const MessageFrame: Component<MessageFrameProps> = (props) => {
  const showAvatar = () => props.showAvatar ?? props.role === 'assistant';

  return (
    <div
      class={cn(
        'chat-message-item',
        props.role === 'user' && 'chat-message-item-user',
        props.role === 'assistant' && 'chat-message-item-assistant',
        showAvatar() ? 'chat-message-item-with-avatar' : 'chat-message-item-without-avatar',
        props.class,
      )}
    >
      <Show when={showAvatar()}>
        <MessageAvatar
          role={props.role}
          avatar={props.avatar}
          isStreaming={props.avatarStreaming}
        />
      </Show>

      {props.children}
    </div>
  );
};
