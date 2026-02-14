// TextBlock — simple text display component.

import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface TextBlockProps {
  content: string;
  class?: string;
}

/**
 * Renders plain text content with preserved whitespace formatting.
 */
export const TextBlock: Component<TextBlockProps> = (props) => {
  return (
    <div
      class={cn('chat-text-block', props.class)}
      style={{ 'white-space': 'pre-wrap' }}
    >
      {props.content}
    </div>
  );
};
