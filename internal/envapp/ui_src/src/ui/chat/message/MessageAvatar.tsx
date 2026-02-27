// Avatar display for user/assistant messages.

import { Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { ChatAvatar, MessageRole } from '../types';

export interface MessageAvatarProps {
  role: MessageRole;
  avatar?: ChatAvatar;
  isStreaming?: boolean;
}

export const MessageAvatar: Component<MessageAvatarProps> = (props) => {
  const hasAvatar = () => {
    if (typeof props.avatar === 'string') {
      return props.avatar.trim().length > 0;
    }
    return typeof props.avatar === 'function';
  };

  const renderCustomAvatar = () => {
    if (typeof props.avatar !== 'function') return null;
    const AvatarRenderer = props.avatar as Exclude<ChatAvatar, string>;
    return <AvatarRenderer role={props.role} />;
  };

  return (
    <div
      class={cn(
        'chat-message-avatar',
        props.role === 'user' && 'chat-message-avatar-user',
        props.role === 'assistant' && 'chat-message-avatar-assistant',
        props.isStreaming && props.role === 'assistant' && 'chat-message-avatar-streaming',
      )}
    >
      <Show when={hasAvatar()} fallback={<span class="chat-message-avatar-fallback">{props.role === 'user' ? 'U' : 'AI'}</span>}>
        <Show
          when={typeof props.avatar === 'string'}
          fallback={<span class="chat-message-avatar-custom-wrapper">{renderCustomAvatar()}</span>}
        >
          <span class="chat-message-avatar-image-wrapper">
            <img class="chat-message-avatar-image" src={String(props.avatar ?? '').trim()} alt={props.role} />
          </span>
        </Show>
      </Show>
    </div>
  );
};
