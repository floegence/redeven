// ThinkingBlock renders reasoning metadata when surfaced by a diagnostic view.

import { Show, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ActivityLine, formatActivityDuration } from '../status/ActivityLine';
import { useI18n } from '../../i18n';

export interface ThinkingBlockProps {
  content?: string;
  duration?: number;
  class?: string;
}

/**
 * Renders reasoning metadata as a quiet activity row.
 */
export const ThinkingBlock: Component<ThinkingBlockProps> = (props) => {
  const i18n = useI18n();
  const [expanded, setExpanded] = createSignal(false);
  const durationText = () => formatActivityDuration(props.duration);
  const hasContent = () => String(props.content ?? '').trim().length > 0;

  return (
    <ActivityLine
      status={hasContent() ? 'success' : 'running'}
      title={i18n.t('chatChrome.thinking')}
      meta={durationText()}
      detail={hasContent() ? undefined : i18n.t('chatChrome.waitingForReasoning')}
      class={cn('chat-thinking-block', props.class)}
      expandable={hasContent()}
      expanded={expanded()}
      onToggle={() => setExpanded((value) => !value)}
    >
      <div class="chat-thinking-body" role="note" aria-label={i18n.t('chatChrome.reasoning')}>
        <Show when={props.content}>
          <div class="chat-thinking-content" style={{ 'white-space': 'pre-wrap' }}>
            {props.content}
          </div>
        </Show>
      </div>
    </ActivityLine>
  );
};
