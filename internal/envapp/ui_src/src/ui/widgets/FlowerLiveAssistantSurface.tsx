import { Show, createMemo, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import { MessageBubble, StreamingCursor, type ChatAvatar, type Message } from '../chat';
import { hasVisibleMessageContent } from '../chat/message/messageVisibility';
import { MessageFrame } from '../chat/message/MessageFrame';
import { FlowerMessageRunIndicator } from './FlowerMessageRunIndicator';

export interface FlowerLiveAssistantSurfaceProps {
  message: Message | null;
  active: boolean;
  phaseLabel?: string;
  avatar?: ChatAvatar;
  class?: string;
}

const LiveAssistantPlaceholderBubble: Component = () => (
  <div class="chat-message-bubble chat-message-bubble-assistant chat-live-assistant-placeholder-bubble">
    <div class="chat-message-block-slot">
      <div class="chat-markdown-block">
        <div class="chat-markdown-empty-streaming" aria-label="Assistant is responding">
          <StreamingCursor />
        </div>
      </div>
    </div>
  </div>
);

export const FlowerLiveAssistantSurface: Component<FlowerLiveAssistantSurfaceProps> = (props) => {
  const hasRenderableMessage = createMemo(() => !!props.message);
  const hasVisibleAnswer = createMemo(() => !!props.message && hasVisibleMessageContent(props.message));
  const isStreaming = createMemo(() => props.active || props.message?.status === 'streaming');
  const showPlaceholder = createMemo(() => !hasVisibleAnswer() && isStreaming());
  const showSurface = createMemo(() => props.active || hasRenderableMessage());
  const showBubble = createMemo(() => hasVisibleAnswer() || showPlaceholder());

  return (
    <Show when={showSurface()}>
      <MessageFrame
        role="assistant"
        avatar={props.avatar}
        avatarStreaming={isStreaming()}
        class={cn('chat-live-assistant-surface', props.class)}
      >
        <div class="chat-message-content-wrapper">
          <Show when={showBubble()}>
            <Show when={hasVisibleAnswer() && props.message} fallback={<LiveAssistantPlaceholderBubble />}>
              {(message) => (
                <MessageBubble message={message()} />
              )}
            </Show>
          </Show>

          <Show when={props.active}>
            <div class="chat-message-status-rail">
              <div class="chat-message-ornament">
                <FlowerMessageRunIndicator phaseLabel={props.phaseLabel} />
              </div>
            </div>
          </Show>
        </div>
      </MessageFrame>
    </Show>
  );
};
