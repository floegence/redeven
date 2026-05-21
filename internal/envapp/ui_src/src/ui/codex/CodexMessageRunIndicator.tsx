import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface CodexMessageRunIndicatorProps {
  phaseLabel?: string;
  class?: string;
}

export const CodexMessageRunIndicator: Component<CodexMessageRunIndicatorProps> = (props) => {
  const label = () => String(props.phaseLabel ?? '').trim() || 'Thinking';

  return (
    <div class={cn('codex-message-run-indicator', props.class)} role="status" aria-live="polite">
      <div class="codex-message-run-indicator-surface">
        <span class="codex-message-run-indicator-label">{label()}</span>
      </div>
    </div>
  );
};
