import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import type { MarkdownTail } from './streamingMarkdownModel';
import { AppendOnlyText } from './AppendOnlyText';

export interface StreamingMarkdownTailProps {
  tail: MarkdownTail;
  class?: string;
}

export const StreamingMarkdownTail: Component<StreamingMarkdownTailProps> = (props) => {
  if (props.tail.kind === 'raw') {
    return <AppendOnlyText text={props.tail.text} class={cn('flower-chat-md-tail', props.class)} />;
  }
  if (props.tail.kind !== 'html') return null;
  return (
    <div
      class={cn('flower-chat-md-tail', props.class)}
      innerHTML={props.tail.html}
    />
  );
};
