// Avatar display for user/assistant messages.

import { Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { MessageRole } from '../types';

export interface MessageAvatarProps {
  role: MessageRole;
  src?: string;
}

export const MessageAvatar: Component<MessageAvatarProps> = (props) => {
  return (
    <div
      class={cn(
        'chat-message-avatar',
        props.role === 'user' && 'chat-message-avatar-user',
        props.role === 'assistant' && 'chat-message-avatar-assistant',
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
        <img class="chat-message-avatar-image" src={props.src!} alt={props.role} />
      </Show>
    </div>
  );
};
