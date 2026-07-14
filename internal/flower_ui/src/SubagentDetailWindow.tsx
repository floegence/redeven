import type { JSX } from 'solid-js';
import { For, Show, createMemo } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, Bot, ChevronDown, Clock, Refresh } from '@floegence/floe-webapp-core/icons';
import { FloatingWindow } from '@floegence/floe-webapp-core/ui';

import type { FlowerSubagentsCopy } from './copy';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerSubagentPanelStatus } from './flowerSubagentProjection';

type SubagentLedgerKind = 'instruction' | 'constraints' | 'analysis' | 'activity' | 'outcome';

type ActivityEntrySummary = Readonly<{
  count: number;
  allSucceeded: boolean;
}>;

export type SubagentDetailWindowProps = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  status: FlowerSubagentPanelStatus;
  statusLabel: string;
  statusIndicator: JSX.Element;
  agentTypeLabel: string;
  elapsedLabel: string;
  description: string;
  loading: boolean;
  error: string;
  detailAvailable: boolean;
  entries: readonly FlowerTimelineEntry[];
  renderEntry: (entry: FlowerTimelineEntry) => JSX.Element;
  bindScroll: (node: HTMLDivElement) => void;
  onScroll: () => void;
  showScrollToLatest: boolean;
  onScrollToLatest: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetryLoad: () => void;
  modelStatus: JSX.Element | null;
  tailLoading: boolean;
  tailError: string;
  onRetryTail: () => void;
  viewportLeftInset: number;
  zIndex: number;
  threadLoadingLabel: string;
  scrollToLatestLabel: string;
  copy: FlowerSubagentsCopy;
}>;

function entryActivitySummary(entry: FlowerTimelineEntry): ActivityEntrySummary {
  if (entry.type !== 'message') return { count: 0, allSucceeded: false };
  const items = entry.blocks.flatMap((block) => block.type === 'activity' ? block.block.items : []);
  return {
    count: items.length,
    allSucceeded: items.length > 0 && items.every((item) => item.status === 'success'),
  };
}

function entryKind(entry: FlowerTimelineEntry, terminal: boolean, last: boolean): SubagentLedgerKind {
  if (entry.type === 'error') return 'outcome';
  if (entry.type !== 'message') return 'analysis';
  if (entry.message.role === 'user') return 'instruction';
  if (entry.message.role === 'system') return 'constraints';
  if (entryActivitySummary(entry).count > 0 && entry.blocks.every((block) => block.type === 'activity')) return 'activity';
  if (entry.message.status === 'error' || (terminal && last)) return 'outcome';
  return 'analysis';
}

function terminalStatus(status: FlowerSubagentPanelStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled' || status === 'timed_out';
}

function entryTimestamp(entry: FlowerTimelineEntry): number {
  if (entry.type === 'message') return Math.max(0, Number(entry.message.created_at_ms || 0));
  return 0;
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function entryLabel(kind: SubagentLedgerKind, copy: FlowerSubagentsCopy, activityCount: number): string {
  switch (kind) {
    case 'instruction':
      return copy.detailInstructionLabel;
    case 'constraints':
      return copy.detailConstraintsLabel;
    case 'activity':
      return copy.detailActivityLabel(activityCount);
    case 'outcome':
      return copy.detailOutcomeLabel;
    case 'analysis':
    default:
      return copy.detailAnalysisLabel;
  }
}

function ledgerEntry(
  entry: FlowerTimelineEntry,
  index: number,
  entries: readonly FlowerTimelineEntry[],
  props: SubagentDetailWindowProps,
): JSX.Element {
  const summary = entryActivitySummary(entry);
  const kind = entryKind(entry, terminalStatus(props.status), index === entries.length - 1);
  const timestamp = formatTime(entryTimestamp(entry));
  const label = entryLabel(kind, props.copy, summary.count);
  const disclosure = kind === 'instruction' || kind === 'constraints' || kind === 'activity';
  const defaultOpen = kind === 'activity' && !(summary.count > 6 && summary.allSucceeded);

  const header = (
    <div class="flower-subagent-ledger-entry-header">
      <span class="flower-subagent-ledger-entry-label">{label}</span>
      <Show when={timestamp}>
        <time class="flower-subagent-ledger-entry-time" datetime={new Date(entryTimestamp(entry)).toISOString()}>{timestamp}</time>
      </Show>
      <Show when={disclosure}>
        <ChevronDown class="flower-subagent-ledger-entry-chevron h-3.5 w-3.5" aria-hidden="true" />
      </Show>
    </div>
  );

  if (disclosure) {
    return (
      <details
        class={cn('flower-subagent-ledger-entry', `flower-subagent-ledger-entry-${kind}`)}
        data-flower-subagent-ledger-kind={kind}
        data-default-collapsed={defaultOpen ? undefined : 'true'}
        open={defaultOpen}
        role="listitem"
      >
        <summary>{header}</summary>
        <div class="flower-subagent-ledger-entry-body">{props.renderEntry(entry)}</div>
      </details>
    );
  }

  return (
    <section
      class={cn('flower-subagent-ledger-entry', `flower-subagent-ledger-entry-${kind}`)}
      data-flower-subagent-ledger-kind={kind}
      role="listitem"
    >
      {header}
      <div class="flower-subagent-ledger-entry-body">{props.renderEntry(entry)}</div>
    </section>
  );
}

export function SubagentDetailWindow(props: SubagentDetailWindowProps): JSX.Element {
  const modelStatus = createMemo(() => props.modelStatus);
  const showStatusLane = createMemo(() => (
    Boolean(modelStatus())
    || props.tailLoading
    || Boolean(props.tailError)
  ));
  const showDock = createMemo(() => (
    props.hasMore
    || showStatusLane()
  ));

  return (
    <FloatingWindow
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      class="flower-subagent-detail-window"
      defaultSize={{ width: 820, height: 680 }}
      minSize={{ width: 480, height: 360 }}
      viewportInsets={{ top: 56, right: 12, bottom: 12, left: props.viewportLeftInset }}
      resizable
      draggable
      zIndex={props.zIndex}
    >
      <div
        class="flower-subagent-detail-surface"
        data-flower-subagent-detail="open"
        data-flower-subagent-status={props.status}
      >
        <header class="flower-subagent-detail-overview">
          <div class={cn('flower-subagent-detail-signal', `flower-subagent-detail-signal-${props.status}`)} aria-hidden="true">
            <Bot class="h-4 w-4" />
          </div>
          <div class="flower-subagent-detail-overview-copy">
            <div class="flower-subagent-detail-overview-meta">
              <span class={cn('flower-subagent-status-label', `flower-subagent-status-label-${props.status}`)}>
                {props.statusIndicator}
                <span>{props.statusLabel}</span>
              </span>
              <Show when={props.agentTypeLabel}>
                <span class="flower-subagent-detail-agent-type">{props.agentTypeLabel}</span>
              </Show>
              <Show when={props.elapsedLabel}>
                <span class="flower-subagent-detail-elapsed">
                  <Clock class="h-3 w-3" aria-hidden="true" />
                  <span>{props.elapsedLabel}</span>
                </span>
              </Show>
            </div>
            <Show when={props.description}>
              <p class="flower-subagent-detail-description">{props.description}</p>
            </Show>
          </div>
        </header>

        <Show when={props.loading}>
          <div class="flower-subagent-detail-loading" role="status" aria-label={props.threadLoadingLabel}>
            <For each={[0, 1, 2, 3]}>
              {() => (
                <div class="flower-subagent-detail-loading-row">
                  <span />
                  <div><i /><i /></div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={props.error && !props.detailAvailable}>
          <div class="flower-subagent-detail-state flower-subagent-detail-state-error" role="alert">
            <AlertTriangle class="h-4 w-4" />
            <div class="flower-subagent-detail-state-copy">
              <span>{props.error}</span>
              <button type="button" class="flower-subagent-detail-retry" onClick={props.onRetryLoad}>
                <Refresh class="h-3.5 w-3.5" />
                <span>{props.copy.detailRetry}</span>
              </button>
            </div>
          </div>
        </Show>

        <Show when={props.detailAvailable}>
          <Show when={props.error}>
            <div class="flower-subagent-detail-inline-error" role="alert">
              <AlertTriangle class="h-3.5 w-3.5" />
              <span>{props.error}</span>
              <button type="button" onClick={props.onLoadMore}>{props.copy.detailRetry}</button>
            </div>
          </Show>
          <div
            ref={props.bindScroll}
            class="flower-subagent-detail-transcript"
            role="list"
            aria-label={props.copy.detailTimelineLabel}
            onScroll={props.onScroll}
          >
            <div class="flower-subagent-ledger">
              <Show
                when={props.entries.length > 0}
                fallback={<div class="flower-subagent-detail-empty">{props.copy.emptyDescription}</div>}
              >
                <For each={props.entries}>
                  {(entry, index) => ledgerEntry(entry, index(), props.entries, props)}
                </For>
              </Show>
            </div>
            <Show when={props.showScrollToLatest}>
              <div class="flower-subagent-detail-scroll-to-latest">
                <button
                  type="button"
                  class="flower-scroll-to-latest-button"
                  aria-label={props.scrollToLatestLabel}
                  title={props.scrollToLatestLabel}
                  onClick={props.onScrollToLatest}
                >
                  <ChevronDown class="h-4 w-4" />
                </button>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={showDock()}>
          <footer class="flower-subagent-detail-bottom-dock" data-flower-subagent-dock>
            <Show when={props.hasMore}>
              <button
                type="button"
                class="flower-subagent-detail-load-more-button"
                disabled={props.loadingMore || props.tailLoading}
                onClick={props.onLoadMore}
              >
                {props.loadingMore ? props.copy.loadingMore : props.copy.loadMore}
              </button>
            </Show>
            <Show when={showStatusLane()}>
              <div class="flower-subagent-detail-bottom-track">
                <div class="flower-model-status-lane" role="status" aria-live="polite" aria-atomic="true">
                  <Show when={modelStatus()}>{(status) => status()}</Show>
                  <Show when={props.tailLoading}>
                    <span class="flower-subagent-detail-tail-state">
                      <span class="flower-subagent-detail-tail-pulse" aria-hidden="true" />
                      <span>{props.copy.detailSyncing}</span>
                    </span>
                  </Show>
                  <Show when={props.tailError}>
                    <span class="flower-subagent-detail-tail-error">
                      <AlertTriangle class="h-3.5 w-3.5" />
                      <span>{props.tailError}</span>
                      <button type="button" onClick={props.onRetryTail}>{props.copy.detailRetry}</button>
                    </span>
                  </Show>
                </div>
              </div>
            </Show>
          </footer>
        </Show>
      </div>
    </FloatingWindow>
  );
}
