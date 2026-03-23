// ThinkingBlock renders user-visible model reasoning with optional duration metadata.

import { Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Sparkles } from '@floegence/floe-webapp-core/icons';

export interface ThinkingBlockProps {
  content?: string;
  duration?: number;
  class?: string;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Renders an AI thinking indicator, optionally showing the thinking content
 * and the time taken.
 */
export const ThinkingBlock: Component<ThinkingBlockProps> = (props) => {
  return (
    <div class={cn('chat-thinking-block', props.class)} role="note" aria-label="Reasoning">
      <Sparkles class="chat-thinking-icon" aria-hidden="true" />

      <div class="chat-thinking-body">
        <Show when={props.duration !== undefined}>
          <div class="chat-thinking-meta">
            <span class="chat-thinking-duration">
              {formatDuration(props.duration!)}
            </span>
          </div>
        </Show>

        <Show when={props.content}>
          <div class="chat-thinking-content" style={{ 'white-space': 'pre-wrap' }}>
            {props.content}
          </div>
        </Show>
      </div>
    </div>
  );
};
