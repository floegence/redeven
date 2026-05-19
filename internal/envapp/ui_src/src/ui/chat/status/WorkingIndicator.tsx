// Compact working indicator shown while the assistant is processing.

import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ActivityLine } from './ActivityLine';

export interface WorkingIndicatorProps {
  class?: string;
}

export const WorkingIndicator: Component<WorkingIndicatorProps> = (props) => {
  return <ActivityLine status="running" title="Thinking" class={cn('chat-working-indicator', props.class)} />;
};
