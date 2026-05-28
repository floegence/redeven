import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { useI18n } from '../../i18n';

export interface StreamingShimmerProps {
  class?: string;
}

export const StreamingShimmer: Component<StreamingShimmerProps> = (props) => {
  const i18n = useI18n();
  return (
    <div
      class={cn('streaming-shimmer', props.class)}
      role="status"
      aria-label={i18n.t('chatChrome.assistantIsThinking')}
    >
      <span class="streaming-shimmer-text" aria-hidden="true">{i18n.t('chatChrome.thinkingEllipsis')}</span>
    </div>
  );
};
