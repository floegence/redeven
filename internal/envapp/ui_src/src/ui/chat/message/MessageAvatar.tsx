// Avatar display for user/assistant messages.

import { Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { MessageRole } from '../types';

export interface MessageAvatarProps {
  role: MessageRole;
  src?: string;
  isStreaming?: boolean;
}

export const MessageAvatar: Component<MessageAvatarProps> = (props) => {
  return (
    <div
      class={cn(
        'chat-message-avatar',
        props.role === 'user' && 'chat-message-avatar-user',
        props.role === 'assistant' && 'chat-message-avatar-assistant',
        props.isStreaming && props.role === 'assistant' && 'chat-message-avatar-streaming',
      )}
    >
      <Show
        when={props.src}
        fallback={
          <span class="chat-message-avatar-fallback">
            {props.role === 'user' ? 'U' : 'AI'}
          </span>
        }
      >
        <span class="chat-message-avatar-image-wrapper">
          <img class="chat-message-avatar-image" src={props.src!} alt={props.role} />
        </span>
      </Show>
    </div>
  );
};
