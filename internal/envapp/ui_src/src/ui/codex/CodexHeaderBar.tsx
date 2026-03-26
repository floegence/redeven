import { Show } from 'solid-js';
import { Refresh, Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { statusTagVariant } from './presentation';
import type { CodexWorkbenchSummary } from './viewModel';

export function CodexHeaderBar(props: {
  summary: CodexWorkbenchSummary;
  refreshing: boolean;
  canRefresh: boolean;
  canArchive: boolean;
  onRefresh: () => void;
  onArchive: () => void;
}) {
  return (
    <div data-codex-surface="header" class="codex-page-header border-b border-border/80 bg-background/95 backdrop-blur-md">
      <div class="codex-page-header-main">
        <div class="codex-page-header-title">
          <div class="flex min-w-0 items-center gap-3">
            <CodexIcon class="h-8 w-8 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-semibold text-foreground">{props.summary.threadTitle}</div>
              <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                Dedicated Codex review shell with isolated thread state.
              </div>
            </div>
          </div>

          <div class="codex-page-header-meta">
            <Show when={props.summary.workspaceLabel}>
              <span class="codex-page-chip codex-page-chip--neutral" title={props.summary.workspaceLabel}>
                <span class="codex-page-chip-label">Workspace</span>
                <span class="codex-page-chip-value codex-page-chip-value--path">{props.summary.workspaceLabel}</span>
              </span>
            </Show>
            <Show when={props.summary.latestActivityLabel}>
              <span class="codex-page-chip codex-page-chip--neutral">
                <span class="codex-page-chip-label">Updated</span>
                <span class="codex-page-chip-value">{props.summary.latestActivityLabel}</span>
              </span>
            </Show>
          </div>
        </div>

        <div class="codex-page-header-actions">
          <Tag variant={statusTagVariant(props.summary.statusLabel)} tone="soft" size="sm">
            {props.summary.statusLabel}
          </Tag>
          <Show when={props.summary.modelLabel}>
            <Tag variant="neutral" tone="soft" size="sm">
              {props.summary.modelLabel}
            </Tag>
          </Show>
          <Tag variant={props.summary.hostReady ? 'success' : 'warning'} tone="soft" size="sm">
            {props.summary.hostReady ? 'Host ready' : 'Install required'}
          </Tag>
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
            size="sm"
            variant="ghost"
            onClick={props.onRefresh}
            disabled={!props.canRefresh}
          >
            <Refresh class="mr-1 h-4 w-4" />
            {props.refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onArchive}
            disabled={!props.canArchive}
          >
            <Trash class="mr-1 h-4 w-4" />
            Archive
          </Button>
        </div>
      </div>
    </div>
  );
}
