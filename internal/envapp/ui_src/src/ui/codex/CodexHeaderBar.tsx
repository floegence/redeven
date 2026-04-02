import { Index, Show } from 'solid-js';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { Tooltip } from '../primitives/Tooltip';
import { statusTagVariant } from './presentation';
import type { CodexWorkbenchSummary } from './viewModel';

export type CodexHeaderAction = Readonly<{
  key: string;
  label: string;
  aria_label: string;
  onClick: () => void;
  disabled?: boolean;
  disabled_reason?: string;
}>;

export function CodexHeaderBar(props: {
  summary: CodexWorkbenchSummary;
  actions: readonly CodexHeaderAction[];
}) {
  const shouldShowStatusTag = () => {
    const value = String(props.summary.statusLabel ?? '').trim().toLowerCase();
    return value.length > 0 && value !== 'idle' && value !== 'ready';
  };
  const supplementalTag = () => {
    if (!props.summary.hostReady) {
      return { variant: 'warning' as const, label: 'Install required' };
    }
    if (props.summary.pendingRequestCount > 0) {
      return { variant: 'warning' as const, label: `${props.summary.pendingRequestCount} pending` };
    }
    if (props.summary.statusFlags.length > 0) {
      return { variant: 'info' as const, label: props.summary.statusFlags[0] };
    }
    return null;
  };
  const renderActionButton = (action: CodexHeaderAction) => (
    <Button
      size="sm"
      variant="ghost"
      class="codex-page-header-action shrink-0 cursor-pointer"
      onClick={action.onClick}
      disabled={action.disabled}
      aria-label={action.aria_label}
      title={action.disabled ? action.disabled_reason || action.label : action.label}
    >
      {action.label}
    </Button>
  );

  return (
    <div data-codex-surface="header" class="codex-page-header border-b border-border/80 bg-background/95 backdrop-blur-md">
      <div class="codex-page-header-main">
        <div class="codex-page-header-summary">
          <CodexIcon class="h-7 w-7 shrink-0" />
          <div class="codex-page-header-copy">
            <div class="codex-page-header-thread" title={props.summary.threadTitle}>
              {props.summary.threadTitle}
            </div>
            <Show when={props.summary.contextLabel}>
              <div class="codex-page-header-context">
                <span class="codex-page-header-context-primary">{props.summary.contextLabel}</span>
                <Show when={props.summary.contextDetail}>
                  <span class="codex-page-header-context-secondary">{props.summary.contextDetail}</span>
                </Show>
              </div>
            </Show>
          </div>
        </div>

        <div class="codex-page-header-rail">
          <Show
            when={
              shouldShowStatusTag() ||
              Boolean(supplementalTag())
            }
          >
            <div class="codex-page-header-badges">
              <Show when={shouldShowStatusTag()}>
                <Tag class="codex-page-header-tag cursor-default" variant={statusTagVariant(props.summary.statusLabel)} tone="soft" size="sm">
                  {props.summary.statusLabel}
                </Tag>
              </Show>
              <Show when={supplementalTag()}>
                {(tag) => (
                  <Tag class="codex-page-header-tag cursor-default" variant={tag().variant} tone="soft" size="sm">
                    {tag().label}
                  </Tag>
                )}
              </Show>
            </div>
          </Show>

          <Show when={props.actions.length > 0}>
            <div class="codex-page-header-actions">
              <Index each={props.actions}>
                {(action) => (
                  <Show
                    when={action().disabled && action().disabled_reason}
                    fallback={renderActionButton(action())}
                  >
                    <Tooltip content={action().disabled_reason || ''} placement="bottom" delay={0}>
                      <span class="inline-flex">
                        {renderActionButton(action())}
                      </span>
                    </Tooltip>
                  </Show>
                )}
              </Index>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
