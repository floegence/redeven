import { Show } from 'solid-js';
import { Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { compactPathLabel, statusTagVariant } from './presentation';
import type { CodexWorkbenchSummary } from './viewModel';

export function CodexHeaderBar(props: {
  summary: CodexWorkbenchSummary;
  canArchive: boolean;
  onArchive: () => void;
}) {
  const shouldShowStatusTag = () => {
    const value = String(props.summary.statusLabel ?? '').trim().toLowerCase();
    return value.length > 0 && value !== 'idle' && value !== 'ready';
  };
  const compactWorkspace = () => compactPathLabel(props.summary.workspaceLabel, 'Workspace');

  return (
    <div data-codex-surface="header" class="codex-page-header border-b border-border/80 bg-background/95 backdrop-blur-md">
      <div class="codex-page-header-main">
        <div class="codex-page-header-summary">
          <CodexIcon class="h-6 w-6 shrink-0" />
          <div class="codex-page-header-thread" title={props.summary.threadTitle}>
            {props.summary.threadTitle}
          </div>
          <Show when={props.summary.workspaceLabel}>
            <div class="codex-page-header-context" title={props.summary.workspaceLabel}>
              {compactWorkspace()}
            </div>
          </Show>
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
          <Button
            size="icon"
            variant="ghost"
            class="codex-page-header-action"
            onClick={props.onArchive}
            disabled={!props.canArchive}
            aria-label="Archive Codex thread"
            title="Archive Codex thread"
          >
            <Trash class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
