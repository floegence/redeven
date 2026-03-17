import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import type { MarkdownTail } from '../types';

export interface StreamingMarkdownTailProps {
  tail: MarkdownTail;
  class?: string;
}

export const StreamingMarkdownTail: Component<StreamingMarkdownTailProps> = (props) => {
  if (props.tail.kind !== 'html') return null;

  return (
    <div
      class={cn('chat-markdown-tail', props.class)}
      // eslint-disable-next-line solid/no-innerhtml
      innerHTML={props.tail.html}
    />
  );
};
