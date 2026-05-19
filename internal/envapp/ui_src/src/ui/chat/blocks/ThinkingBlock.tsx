// ThinkingBlock renders reasoning metadata when surfaced by a diagnostic view.

import { Show, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ActivityLine, formatActivityDuration } from '../status/ActivityLine';

export interface ThinkingBlockProps {
  content?: string;
  duration?: number;
  class?: string;
}

/**
 * Renders reasoning metadata as a quiet activity row.
 */
export const ThinkingBlock: Component<ThinkingBlockProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const durationText = () => formatActivityDuration(props.duration);
  const hasContent = () => String(props.content ?? '').trim().length > 0;

  return (
    <ActivityLine
      status={hasContent() ? 'success' : 'running'}
      title="Thinking"
      meta={durationText()}
      detail={hasContent() ? undefined : 'Waiting for reasoning'}
      class={cn('chat-thinking-block', props.class)}
      expandable={hasContent()}
      expanded={expanded()}
      onToggle={() => setExpanded((value) => !value)}
    >
      <div class="chat-thinking-body" role="note" aria-label="Reasoning">
        <Show when={props.content}>
          <div class="chat-thinking-content" style={{ 'white-space': 'pre-wrap' }}>
            {props.content}
          </div>
        </Show>
      </div>
    </ActivityLine>
  );
};
