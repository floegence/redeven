// Animated "working" dots indicator shown while the assistant is processing.

import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface WorkingIndicatorProps {
  class?: string;
}

export const WorkingIndicator: Component<WorkingIndicatorProps> = (props) => {
  return (
    <div class={cn('chat-working-indicator', props.class)}>
      <div class="chat-working-dots">
        <span class="chat-working-dot" />
        <span class="chat-working-dot" />
        <span class="chat-working-dot" />
      </div>
      <span>Thinking...</span>
    </div>
  );
};
