import { Match, Switch, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import type { MarkdownTail } from './streamingMarkdownModel';
import { AppendOnlyText } from './AppendOnlyText';

export interface StreamingMarkdownTailProps {
  tail: MarkdownTail;
  class?: string;
}

export const StreamingMarkdownTail: Component<StreamingMarkdownTailProps> = (props) => (
  <Switch>
    <Match when={props.tail.kind === 'raw'}>
      <AppendOnlyText text={props.tail.kind === 'raw' ? props.tail.text : ''} class={cn('flower-chat-md-tail', props.class)} />
    </Match>
    <Match when={props.tail.kind === 'html'}>
      <div class={cn('flower-chat-md-tail', props.class)} innerHTML={props.tail.kind === 'html' ? props.tail.html : ''} />
    </Match>
  </Switch>
);
