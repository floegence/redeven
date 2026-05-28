// Compact working indicator shown while the assistant is processing.

import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ActivityLine } from './ActivityLine';
import { useI18n } from '../../i18n';

export interface WorkingIndicatorProps {
  class?: string;
}

export const WorkingIndicator: Component<WorkingIndicatorProps> = (props) => {
  const i18n = useI18n();
  return <ActivityLine status="running" title={i18n.t('chatChrome.thinking')} class={cn('chat-working-indicator', props.class)} />;
};
