import { For, Show, createMemo, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ChevronRight, Code, FileText, Search, Sparkles, Terminal } from '@floegence/floe-webapp-core/icons';

import { CodexActivityDetailPanel } from './CodexActivityDetailPanel';
import {
  findCodexActivitySourceItem,
  type CodexActivityDetailRef,
  type CodexActivityItem,
  type CodexTranscriptActivityGroupNode,
} from './transcriptDisplayModel';
import type { CodexTranscriptItem } from './types';

export type CodexActivityStreamState = Readonly<{
  expanded: boolean;
  activeDetail: CodexActivityDetailRef | null;
}>;

function activityIcon(item: CodexActivityItem) {
  switch (item.kind) {
    case 'command':
      return <Terminal />;
    case 'file_change':
    case 'read':
      return <FileText />;
    case 'search':
      return <Search />;
    case 'reasoning':
    case 'plan':
      return <Sparkles />;
    default:
      return <Code />;
  }
}

function itemDelta(item: CodexActivityItem) {
  if (item.kind !== 'file_change') return null;
  return (
    <span class="codex-activity-item-delta" aria-label={`${item.additions} lines added, ${item.deletions} lines removed`}>
      <span class="codex-activity-item-additions">+{item.additions}</span>
      <span class="codex-activity-item-deletions">-{item.deletions}</span>
    </span>
  );
}

function groupStatusLabel(group: CodexTranscriptActivityGroupNode): string {
  if (group.status === 'running') return 'Working';
  if (group.status === 'failed') return 'Needs attention';
  return 'Done';
}

function fileChangeActionLabel(item: Extract<CodexActivityItem, { kind: 'file_change' }>): string {
  switch (item.action) {
    case 'created':
      return 'Created';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'edited':
    default:
      return 'Edited';
  }
}

function activityItemLabel(item: CodexActivityItem) {
  if (item.kind !== 'file_change') return item.label;
  return (
    <>
      {fileChangeActionLabel(item)} <span class="codex-activity-file-path">{item.path}</span>
    </>
  );
}

function sameDetail(left: CodexActivityDetailRef | null, right: CodexActivityDetailRef): boolean {
  if (!left) return false;
  if (left.type !== right.type) return false;
  if ('sourceItemID' in left && 'sourceItemID' in right && left.sourceItemID !== right.sourceItemID) return false;
  if (left.type === 'file_diff' && right.type === 'file_diff') return left.changeIndex === right.changeIndex;
  return true;
}

export function CodexActivityStream(props: {
  group: CodexTranscriptActivityGroupNode;
  sourceItems: readonly CodexTranscriptItem[];
  state: CodexActivityStreamState;
  onStateChange: (state: CodexActivityStreamState) => void;
}) {
  const [expanded, setExpanded] = createSignal(props.state.expanded);
  const [activeDetail, setActiveDetail] = createSignal<CodexActivityDetailRef | null>(props.state.activeDetail);
  const updateState = (nextState: CodexActivityStreamState): void => {
    setExpanded(nextState.expanded);
    setActiveDetail(nextState.activeDetail);
    props.onStateChange(nextState);
  };
  const toggleExpanded = (): void => {
    updateState({
      expanded: !expanded(),
      activeDetail: activeDetail(),
    });
  };
  const toggleDetail = (detail: CodexActivityDetailRef): void => {
    updateState({
      expanded: expanded(),
      activeDetail: sameDetail(activeDetail(), detail) ? null : detail,
    });
  };
  const visibleItems = createMemo(() => expanded() ? props.group.items : []);
  const activeDetailItem = createMemo(() => {
    const detail = activeDetail();
    if (!detail || !('sourceItemID' in detail)) return null;
    return findCodexActivitySourceItem(props.sourceItems, detail.sourceItemID);
  });

  return (
    <div
      class="codex-activity-stream"
      data-codex-activity-group={props.group.status}
      data-codex-activity-expanded={expanded() ? 'true' : 'false'}
    >
      <button
        type="button"
        class="codex-activity-group-trigger"
        aria-expanded={expanded() ? 'true' : 'false'}
        onClick={toggleExpanded}
      >
        <span class="codex-activity-group-glyph" aria-hidden="true">
          <ChevronRight />
        </span>
        <span class="codex-activity-group-status">{groupStatusLabel(props.group)}</span>
        <span class="codex-activity-group-headline">{props.group.summary.headline}</span>
        <Show when={props.group.summary.additions > 0 || props.group.summary.deletions > 0}>
          <span class="codex-activity-group-delta" aria-label={`${props.group.summary.additions} lines added, ${props.group.summary.deletions} lines removed`}>
            <span class="codex-activity-item-additions">+{props.group.summary.additions}</span>
            <span class="codex-activity-item-deletions">-{props.group.summary.deletions}</span>
          </span>
        </Show>
      </button>

      <Show when={visibleItems().length > 0}>
        <div class="codex-activity-item-list">
          <For each={visibleItems()}>
            {(item) => (
              <button
                type="button"
                class={cn(
                  'codex-activity-item',
                  item.status === 'running' && 'codex-activity-item-running',
                  item.status === 'failed' && 'codex-activity-item-failed',
                  sameDetail(activeDetail(), item.detail) && 'codex-activity-item-selected',
                )}
                data-codex-activity-item-kind={item.kind}
                data-codex-activity-source-id={item.sourceItemID}
                onClick={() => toggleDetail(item.detail)}
              >
                <span class="codex-activity-item-icon" aria-hidden="true">{activityIcon(item)}</span>
                <span class="codex-activity-item-label" title={item.label}>
                  {activityItemLabel(item)}
                </span>
                {itemDelta(item)}
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={activeDetail()}>
        {(detail) => (
          <CodexActivityDetailPanel
            detail={detail()}
            item={activeDetailItem()}
            onClose={() => updateState({ expanded: expanded(), activeDetail: null })}
          />
        )}
      </Show>
    </div>
  );
}
