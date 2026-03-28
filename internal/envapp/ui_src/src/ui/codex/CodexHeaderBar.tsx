import { Show } from 'solid-js';
import { Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { Tooltip } from '../primitives/Tooltip';
import { statusTagVariant } from './presentation';
import type { CodexWorkbenchSummary } from './viewModel';

export function CodexHeaderBar(props: {
  summary: CodexWorkbenchSummary;
  canArchive: boolean;
  archiveDisabledReason?: string;
  onArchive: () => void;
}) {
  const shouldShowStatusTag = () => {
    const value = String(props.summary.statusLabel ?? '').trim().toLowerCase();
    return value.length > 0 && value !== 'idle' && value !== 'ready';
  };
  const renderArchiveButton = () => (
    <Button
      size="icon"
      variant="ghost"
      class="codex-page-header-action"
      onClick={props.onArchive}
      disabled={!props.canArchive}
      aria-label="Archive Codex thread"
      title={props.canArchive ? 'Archive Codex thread' : props.archiveDisabledReason || 'Archive unavailable'}
    >
      <Trash class="h-3.5 w-3.5" />
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
          <Show when={shouldShowStatusTag()}>
            <Tag variant={statusTagVariant(props.summary.statusLabel)} tone="soft" size="sm">
              {props.summary.statusLabel}
            </Tag>
          </Show>
          <Show when={!props.summary.hostReady}>
            <Tag variant="warning" tone="soft" size="sm">
              Install required
            </Tag>
          </Show>
          <Show when={props.summary.pendingRequestCount > 0}>
            <Tag variant="warning" tone="soft" size="sm">
              {props.summary.pendingRequestCount} pending
            </Tag>
          </Show>
          <Show when={props.summary.statusFlags.length > 0}>
            <Tag variant="info" tone="soft" size="sm">
              {props.summary.statusFlags[0]}
            </Tag>
          </Show>
          <Show when={!props.canArchive && props.archiveDisabledReason} fallback={renderArchiveButton()}>
            <Tooltip content={props.archiveDisabledReason || ''} placement="bottom" delay={0}>
              <span class="inline-flex">
                {renderArchiveButton()}
              </span>
            </Tooltip>
          </Show>
        </div>
      </div>
    </div>
  );
}
