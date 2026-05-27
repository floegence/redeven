import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface StreamingShimmerProps {
  class?: string;
}

export const StreamingShimmer: Component<StreamingShimmerProps> = (props) => (
  <div
    class={cn('streaming-shimmer', props.class)}
    role="status"
    aria-label="Assistant is thinking"
  >
    <span class="streaming-shimmer-text" aria-hidden="true">Thinking...</span>
  </div>
);
