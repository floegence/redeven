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
import { useI18n, type I18nHelpers } from '../i18n';

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

function itemDelta(item: CodexActivityItem, i18n: I18nHelpers) {
  if (item.kind !== 'file_change') return null;
  const label = i18n.t('codexActivity.linesChanged', {
    additions: item.additions,
    deletions: item.deletions,
  });
  return (
    <span class="codex-activity-item-delta" aria-label={label}>
      <span class="codex-activity-item-additions">+{item.additions}</span>
      <span class="codex-activity-item-deletions">-{item.deletions}</span>
    </span>
  );
}

function groupStatusLabel(i18n: I18nHelpers, group: CodexTranscriptActivityGroupNode): string {
  if (group.status === 'running') return i18n.t('codexActivity.status.working');
  if (group.status === 'failed') return i18n.t('codexActivity.status.needsAttention');
  return i18n.t('codexActivity.status.done');
}

function fileChangeActionLabel(i18n: I18nHelpers, item: Extract<CodexActivityItem, { kind: 'file_change' }>): string {
  switch (item.action) {
    case 'created':
      return i18n.t('codexActivity.fileAction.created');
    case 'deleted':
      return i18n.t('codexActivity.fileAction.deleted');
    case 'renamed':
      return i18n.t('codexActivity.fileAction.renamed');
    case 'edited':
    default:
      return i18n.t('codexActivity.fileAction.edited');
  }
}

function commandMeta(i18n: I18nHelpers, item: Extract<CodexActivityItem, { kind: 'command' }>): string {
  const parts = [
    item.status === 'failed' ? i18n.t('codexActivity.activity.commandFailed') : '',
    typeof item.exitCode === 'number' ? i18n.t('codexActivity.activity.commandExit', { exitCode: item.exitCode }) : '',
    typeof item.durationMs === 'number' ? formatDuration(item.durationMs) : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function formatDuration(ms: number): string {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds >= 10 ? Math.round(seconds) : Number(seconds.toFixed(1))}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function activityItemPlainLabel(i18n: I18nHelpers, item: CodexActivityItem): string {
  switch (item.kind) {
    case 'file_change':
      return `${fileChangeActionLabel(i18n, item)} ${item.path}`;
    case 'command': {
      const meta = commandMeta(i18n, item);
      return meta
        ? i18n.t('codexActivity.activity.ranCommandWithMeta', { command: item.commandPreview, meta })
        : i18n.t('codexActivity.activity.ranCommand', { command: item.commandPreview });
    }
    case 'search':
      if (item.action === 'open_page') {
        return item.query
          ? i18n.t('codexActivity.activity.openedPage', { target: item.query })
          : i18n.t('codexActivity.activity.openedPageFallback');
      }
      if (item.action === 'find_in_page') {
        return item.query
          ? i18n.t('codexActivity.activity.searchedPageFor', { query: item.query })
          : i18n.t('codexActivity.activity.searchedPage');
      }
      return item.query
        ? i18n.t('codexActivity.activity.searchedFor', { query: item.query })
        : i18n.t('codexActivity.activity.searchedWeb');
    case 'plan':
      return i18n.t('codexActivity.activity.plannedNextSteps');
    case 'reasoning':
      return i18n.t('codexActivity.activity.thoughtThroughApproach');
    default:
      return item.label;
  }
}

function activityItemLabel(i18n: I18nHelpers, item: CodexActivityItem) {
  if (item.kind === 'file_change') {
    return (
      <>
        {fileChangeActionLabel(i18n, item)} <span class="codex-activity-file-path">{item.path}</span>
      </>
    );
  }
  return activityItemPlainLabel(i18n, item);
}

function activityGroupHeadline(i18n: I18nHelpers, group: CodexTranscriptActivityGroupNode): string {
  const summary = group.summary;
  const parts: string[] = [];
  if (summary.createdFiles > 0) parts.push(`${i18n.t('codexActivity.fileAction.created')} ${i18n.tn('chatActivity.fileCount', summary.createdFiles)}`);
  if (summary.editedFiles > 0) parts.push(`${i18n.t('codexActivity.fileAction.edited')} ${i18n.tn('chatActivity.fileCount', summary.editedFiles)}`);
  if (summary.deletedFiles > 0) parts.push(`${i18n.t('codexActivity.fileAction.deleted')} ${i18n.tn('chatActivity.fileCount', summary.deletedFiles)}`);
  if (summary.renamedFiles > 0) parts.push(`${i18n.t('codexActivity.fileAction.renamed')} ${i18n.tn('chatActivity.fileCount', summary.renamedFiles)}`);
  if (summary.exploredFiles > 0) parts.push(`${i18n.t('chatActivity.fileOperation.read')} ${i18n.tn('chatActivity.fileCount', summary.exploredFiles)}`);
  if (summary.searches > 0) parts.push(i18n.tn('codexActivity.activity.searchCount', summary.searches));
  if (summary.commands > 0) {
    const commandCount = i18n.tn('codexActivity.activity.commandCount', summary.commands);
    parts.push(summary.failedCommands > 0
      ? `${commandCount}, ${i18n.tn('codexActivity.activity.failedCommandCount', summary.failedCommands)}`
      : commandCount);
  }
  if (summary.hasPlan) parts.push(i18n.t('codexActivity.activity.planned'));
  if (summary.hasReasoning) parts.push(i18n.t('codexActivity.activity.reasoned'));
  return parts.length > 0 ? parts.join(', ') : i18n.t('codexActivity.activity.worked');
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
  const i18n = useI18n();
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
        <span class="codex-activity-group-status">{groupStatusLabel(i18n, props.group)}</span>
        <span class="codex-activity-group-headline">{activityGroupHeadline(i18n, props.group)}</span>
        <Show when={props.group.summary.additions > 0 || props.group.summary.deletions > 0}>
          <span
            class="codex-activity-group-delta"
            aria-label={i18n.t('codexActivity.linesChanged', {
              additions: props.group.summary.additions,
              deletions: props.group.summary.deletions,
            })}
          >
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
                <span class="codex-activity-item-label" title={activityItemPlainLabel(i18n, item)}>
                  {activityItemLabel(i18n, item)}
                </span>
                {itemDelta(item, i18n)}
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
