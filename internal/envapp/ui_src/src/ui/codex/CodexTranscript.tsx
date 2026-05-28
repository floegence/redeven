import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Tag } from '@floegence/floe-webapp-core/ui';

import { MarkdownBlock } from '../chat/blocks/MarkdownBlock';
import { useVirtualList } from '../chat/hooks/useVirtualList';
import {
  captureViewportAnchor,
  resolveViewportAnchorScrollTop,
  type ViewportAnchor,
} from '../chat/message-list/scrollAnchor';
import type { FollowBottomViewportAnchorResolver } from '../chat/scroll/createFollowBottomController';
import { StreamingCursor } from '../chat/status/StreamingCursor';
import { CodexActivityStream, type CodexActivityStreamState } from './CodexActivityStream';
import { CodexIcon } from '../icons/CodexIcon';
import { CodexMessageRunIndicator } from './CodexMessageRunIndicator';
import { CodexUserMessageContent } from './CodexUserMessageContent';
import { useI18n, type I18nHelpers } from '../i18n';
import {
  displayStatus,
  itemGlyph,
  itemText,
  itemTitle,
  isWorkingStatus,
  statusTagVariant,
} from './presentation';
import {
  buildCodexTranscriptDisplayNodes,
  type CodexTranscriptActivityGroupNode,
  type CodexTranscriptDisplayNode,
} from './transcriptDisplayModel';
import type { CodexOptimisticUserTurn, CodexTranscriptItem } from './types';
import type { FollowBottomMode } from '../chat/scroll/createFollowBottomController';

type CodexTranscriptSurfaceMode = 'empty' | 'loading' | 'feed';
type CodexTranscriptSurfaceName = 'empty-state' | 'loading-state';
type CodexTranscriptRowKind = 'optimistic' | 'display_node' | 'pending_assistant' | 'working_state';
type CodexTranscriptRenderRow = Readonly<{
  id: string;
  kind: CodexTranscriptRowKind;
  anchorId: string;
  estimatedHeightPx: number;
  displayNode?: CodexTranscriptDisplayNode;
  optimisticTurn?: CodexOptimisticUserTurn;
  pendingAssistantState?: PendingAssistantVisualState;
  workingPhaseLabel?: string;
}>;
type CodexTranscriptFallbackState = Readonly<{
  mode: Exclude<CodexTranscriptSurfaceMode, 'feed'>;
  surface: CodexTranscriptSurfaceName;
  title: string;
  body: string;
}>;
type CodexTranscriptSurfaceState = CodexTranscriptFallbackState | Readonly<{
  mode: 'feed';
  hasRows: true;
}>;
type WorkingActivityHint = Readonly<{
  priority: number;
  order: number;
  label: string;
}>;
export type CodexTranscriptRowHeightCache = Readonly<{
  readHeights: (rowIDs: readonly string[]) => Record<string, number>;
  writeHeight: (rowID: string, height: number) => void;
}>;

const CODEX_TRANSCRIPT_VIRTUAL_LIST = {
  defaultItemHeight: 128,
  overscan: 10,
  hotWindow: 20,
  warmWindow: 60,
  loadBatchSize: 20,
  loadThreshold: 0,
} as const;

const CODEX_TRANSCRIPT_ROW_HEIGHTS = {
  optimistic: 92,
  pending_assistant: 104,
  working_state: 76,
  userMessage: 92,
  agentMessage: 128,
  activityGroup: 92,
  evidence: 128,
} as const;

function CodexTranscriptStateHero(props: {
  surface: CodexTranscriptSurfaceName;
  title: string;
  body: string;
}) {
  return (
    <div data-codex-surface={props.surface} class="codex-transcript-state">
      <div class="codex-empty-hero">
        <div class="relative mb-4 inline-flex items-center justify-center">
          <div class="codex-empty-ornament">
            <CodexIcon class="h-10 w-10 text-primary" />
          </div>
        </div>

        <h2 class="mb-2 text-lg font-semibold text-foreground">{props.title}</h2>
        <p class="text-sm leading-relaxed text-muted-foreground">{props.body}</p>
      </div>
    </div>
  );
}

function resolveCodexTranscriptSurfaceState(args: {
  hasRows: boolean;
  loading?: boolean;
  loadingTitle?: string;
  loadingBody?: string;
  emptyTitle: string;
  emptyBody: string;
}): CodexTranscriptSurfaceState {
  if (args.hasRows) {
    return { mode: 'feed', hasRows: true };
  }
  if (args.loading) {
    return {
      mode: 'loading',
      surface: 'loading-state',
      title: String(args.loadingTitle ?? '').trim() || 'Loading conversation',
      body: String(args.loadingBody ?? '').trim() || 'Fetching the selected Codex thread.',
    };
  }
  return {
    mode: 'empty',
    surface: 'empty-state',
    title: args.emptyTitle,
    body: args.emptyBody,
  };
}

function CodexMessageLane(props: {
  role: 'assistant' | 'user';
  showAvatar?: boolean;
  class?: string;
  contentClass?: string;
  children: JSX.Element;
}) {
  const showAvatar = props.role === 'assistant' ? false : Boolean(props.showAvatar);
  return (
    <div
      class={cn(
        'chat-message-item codex-chat-message-item',
        props.role === 'assistant' ? 'chat-message-item-assistant codex-chat-message-item-assistant' : 'chat-message-item-user codex-chat-message-item-user',
        showAvatar ? 'chat-message-item-with-avatar' : 'chat-message-item-without-avatar',
        props.role === 'assistant' && 'codex-chat-message-item-assistant-avatarless',
        props.class,
      )}
    >
      <Show when={showAvatar}>
        <div class="chat-message-avatar chat-message-avatar-assistant codex-chat-message-avatar">
          <div class="chat-message-avatar-custom-wrapper">
            <CodexIcon class="block h-full w-full" />
          </div>
        </div>
      </Show>
      <div class={cn('chat-message-content-wrapper', props.contentClass)}>
        {props.children}
      </div>
    </div>
  );
}

function titleCaseStatus(value: string, fallback: string): string {
  return displayStatus(value, fallback)
    .split(' ')
    .map((part) => (part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : ''))
    .join(' ')
    .trim();
}

function localizedStatusLabel(i18n: I18nHelpers, value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return i18n.t('codexActivity.statusLabel.idle');
  if (normalized === 'pending') return i18n.t('chatActivity.status.pending');
  if (normalized === 'running') return i18n.t('chatActivity.status.running');
  if (normalized === 'success' || normalized === 'completed') return i18n.t('chatActivity.status.success');
  if (normalized === 'error' || normalized.includes('fail')) return i18n.t('chatActivity.status.error');
  if (normalized.includes('waiting')) return i18n.t('chatActivity.status.waiting');
  if (isWorkingStatus(normalized)) return i18n.t('codexActivity.statusLabel.working');
  return displayStatus(value, i18n.t('codexActivity.statusLabel.idle'));
}

function basenameFromPath(path: string | null | undefined): string {
  const normalized = String(path ?? '').trim().replace(/\\/g, '/');
  if (!normalized) return '';
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] ?? normalized : normalized;
}

function itemPath(item: CodexTranscriptItem): string {
  return String(item.path ?? '').trim();
}

function itemDisplayFilename(item: CodexTranscriptItem): string {
  const path = itemPath(item);
  return basenameFromPath(path);
}

function fileChangeWorkingLabel(i18n: I18nHelpers, item: CodexTranscriptItem): string {
  const changes = item.changes ?? [];
  if (changes.length !== 1) return i18n.t('codexActivity.working.editingFiles');
  const change = changes[0];
  if (!change) return i18n.t('codexActivity.working.editingFiles');
  const path = String(change.move_path ?? change.path ?? '').trim();
  const name = basenameFromPath(path);
  if (!name) return i18n.t('codexActivity.working.editingFiles');
  const normalized = String(change.kind ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'add':
    case 'added':
    case 'create':
    case 'created':
    case 'new':
    case 'newfile':
    case 'new_file':
    case 'new file':
      return i18n.t('codexActivity.working.creatingFile', { name });
    case 'delete':
    case 'deleted':
    case 'remove':
    case 'removed':
      return i18n.t('codexActivity.working.deletingFile', { name });
    case 'rename':
    case 'renamed':
    case 'move':
    case 'moved':
      return i18n.t('codexActivity.working.renamingFile', { name });
    default:
      return i18n.t('codexActivity.working.editingFile', { name });
  }
}

function itemWorkingActivityHint(i18n: I18nHelpers, item: CodexTranscriptItem): WorkingActivityHint | null {
  if (!isWorkingStatus(item.status)) return null;
  const order = Number(item.order);
  const safeOrder = Number.isFinite(order) ? order : 0;
  const itemType = String(item.type ?? '').trim().toLowerCase();
  switch (itemType) {
    case 'fileread':
    case 'file_read':
    case 'read':
    case 'filepreview':
    case 'file_preview': {
      const name = itemDisplayFilename(item);
      return {
        priority: 80,
        order: safeOrder,
        label: name
          ? i18n.t('codexActivity.working.readingFile', { name })
          : i18n.t('codexActivity.working.readingFiles'),
      };
    }
    case 'filechange':
      return { priority: 80, order: safeOrder, label: fileChangeWorkingLabel(i18n, item) };
    case 'commandexecution':
      return { priority: 70, order: safeOrder, label: i18n.t('codexActivity.working.runningCommand') };
    case 'websearch':
      return { priority: 70, order: safeOrder, label: i18n.t('codexActivity.working.searchingWeb') };
    case 'plan':
      return { priority: 60, order: safeOrder, label: i18n.t('codexActivity.working.planning') };
    case 'reasoning':
      return { priority: 60, order: safeOrder, label: i18n.t('codexActivity.working.thinking') };
    default:
      return null;
  }
}

function latestWorkingActivityLabel(
  i18n: I18nHelpers,
  items: readonly CodexTranscriptItem[],
  optimisticBoundaryOrder: number | null,
): string {
  let selected: WorkingActivityHint | null = null;
  for (const item of items) {
    if (optimisticBoundaryOrder !== null && Number(item.order) <= optimisticBoundaryOrder) continue;
    const hint = itemWorkingActivityHint(i18n, item);
    if (!hint) continue;
    if (
      !selected ||
      hint.priority > selected.priority ||
      (hint.priority === selected.priority && hint.order >= selected.order)
    ) {
      selected = hint;
    }
  }
  return selected?.label ?? '';
}

function lockedPhaseLabel(i18n: I18nHelpers, value: string): string {
  switch (value) {
    case 'finalizing':
      return i18n.t('codexActivity.working.finalizing');
    case 'recovering':
      return i18n.t('codexActivity.working.recovering');
    case 'waiting approval':
    case 'waiting_approval':
    case 'waitingapproval':
      return i18n.t('codexActivity.working.waitingApproval');
    default:
      return '';
  }
}

function workingPhaseLabel(args: {
  i18n: I18nHelpers;
  label: string;
  flags: readonly string[];
  items: readonly CodexTranscriptItem[];
  optimisticBoundaryOrder: number | null;
}): string {
  const normalizedLabel = String(args.label ?? '').trim().toLowerCase();
  const normalizedFlags = [...(args.flags ?? [])]
    .map((entry) => String(entry ?? '').trim().toLowerCase())
    .filter(Boolean);
  const prioritizedFlag = normalizedFlags.find((entry) => {
    return (
      entry === 'planning' ||
      entry === 'finalizing' ||
      entry === 'recovering' ||
      entry === 'waiting approval' ||
      entry === 'waiting_approval' ||
      entry === 'waitingapproval'
    );
  });
  const selected = prioritizedFlag || normalizedLabel;
  const lockedPhase = lockedPhaseLabel(args.i18n, selected);
  if (lockedPhase) return lockedPhase;
  const activityLabel = latestWorkingActivityLabel(args.i18n, args.items, args.optimisticBoundaryOrder);
  if (activityLabel) return activityLabel;
  switch (selected) {
    case 'planning':
      return args.i18n.t('codexActivity.working.planning');
    case 'running':
    case 'working':
    case 'active':
    case 'accepted':
    case 'in progress':
    case 'in_progress':
    case 'inprogress':
      return args.i18n.t('codexActivity.working.thinking');
    default: {
      const fallback = args.i18n.t('codexActivity.working.thinking');
      const titled = titleCaseStatus(selected || 'working', fallback);
      return titled || fallback;
    }
  }
}

function EvidenceHeader(props: { item: CodexTranscriptItem }) {
  const i18n = useI18n();
  return (
    <div class="codex-chat-evidence-header">
      <span class="codex-chat-evidence-kicker">{itemGlyph(props.item)}</span>
      <div class="codex-chat-evidence-copy">
        <div class="codex-chat-evidence-title">{itemTitle(props.item, i18n)}</div>
      </div>
      <Show when={props.item.status}>
        <span class="codex-chat-evidence-status">
          <Tag variant={statusTagVariant(props.item.status)} tone="soft" size="sm">
            {localizedStatusLabel(i18n, props.item.status)}
          </Tag>
        </span>
      </Show>
    </div>
  );
}

function TranscriptEvidenceRow(props: { item: CodexTranscriptItem }) {
  const i18n = useI18n();
  const fallbackText = () => itemText(props.item, i18n);
  return (
    <CodexMessageLane role="assistant">
      <div data-codex-item-type={props.item.type} class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant">
        <div class="codex-chat-evidence-card">
          <EvidenceHeader item={props.item} />
          <div class="codex-chat-evidence-body">
            <Show
              when={
                props.item.type !== 'fileChange' &&
                props.item.type !== 'commandExecution' &&
                props.item.type !== 'webSearch' &&
                props.item.type !== 'reasoning' &&
                props.item.type !== 'plan' &&
                Boolean(fallbackText().trim())
              }
            >
              <MarkdownBlock content={fallbackText()} class="codex-chat-markdown-block" rendererVariant="codex" />
            </Show>
          </div>
        </div>
      </div>
    </CodexMessageLane>
  );
}

function AgentMessageRow(props: { item: CodexTranscriptItem }) {
  const i18n = useI18n();
  const streaming = () => isWorkingStatus(props.item.status);
  return (
    <CodexMessageLane role="assistant">
      <div data-codex-item-type={props.item.type} class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant">
        <div class="codex-chat-message-surface codex-chat-message-surface-assistant">
          <MarkdownBlock
            content={itemText(props.item, i18n)}
            streaming={streaming()}
            class="codex-chat-markdown-block"
            rendererVariant="codex"
          />
        </div>
      </div>
    </CodexMessageLane>
  );
}

function UserMessageRow(props: { item: CodexTranscriptItem }) {
  return (
    <CodexMessageLane role="user">
      <div data-codex-item-type={props.item.type} class="chat-message-bubble chat-message-bubble-user codex-chat-message-bubble-user">
        <div class="codex-chat-message-surface codex-chat-message-surface-user">
          <CodexUserMessageContent inputs={props.item.inputs} fallbackText={props.item.text} />
        </div>
      </div>
    </CodexMessageLane>
  );
}

function OptimisticUserMessageRow(props: { turn: CodexOptimisticUserTurn }) {
  const syntheticItem: CodexTranscriptItem = {
    id: props.turn.id,
    type: 'userMessage',
    text: props.turn.text,
    inputs: props.turn.inputs,
    order: -1,
  };
  return (
    <div data-codex-optimistic-turn-id={props.turn.id}>
      <UserMessageRow item={syntheticItem} />
    </div>
  );
}

interface PendingAssistantVisualState {
  show: boolean;
  showPrelude: boolean;
  showWorkingRail: boolean;
  phaseLabel: string;
}

function PendingAssistantPrelude() {
  const i18n = useI18n();
  return (
    <div
      data-codex-pre-output="true"
      class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant codex-pending-assistant-prelude"
    >
      <div class="codex-chat-message-surface codex-chat-message-surface-assistant codex-pending-assistant-prelude-surface">
        <div class="chat-markdown-block codex-chat-markdown-block">
          <div class="chat-markdown-empty-streaming" aria-label={i18n.t('chatChrome.assistantIsThinking')}>
            <StreamingCursor />
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkingStatusRail(props: { phaseLabel: string; class?: string }) {
  return (
    <div data-codex-working-state="true" class={cn('chat-message-status-rail codex-working-status-rail', props.class)}>
      <div class="chat-message-ornament">
        <div class="codex-working-indicator-card">
          <CodexMessageRunIndicator phaseLabel={props.phaseLabel} />
        </div>
      </div>
    </div>
  );
}

function PendingAssistantRow(props: { state: PendingAssistantVisualState }) {
  return (
    <CodexMessageLane role="assistant">
      <Show when={props.state.showPrelude}>
        <PendingAssistantPrelude />
      </Show>
      <Show when={props.state.showWorkingRail}>
        <WorkingStatusRail phaseLabel={props.state.phaseLabel} class="codex-pending-assistant-status-rail" />
      </Show>
    </CodexMessageLane>
  );
}

function WorkingStateRow(props: { phaseLabel: string }) {
  return (
    <CodexMessageLane role="assistant" class="codex-working-state-row">
      <WorkingStatusRail phaseLabel={props.phaseLabel} />
    </CodexMessageLane>
  );
}

function shouldRenderTranscriptItem(item: CodexTranscriptItem): boolean {
  if (item.type === 'turnDiagnostic') {
    return Boolean(itemText(item).trim());
  }
  if (
    (item.type === 'reasoning' || item.type === 'plan') &&
    (item.summary?.length ?? 0) === 0 &&
    (item.content?.length ?? 0) === 0 &&
    !String(item.text ?? '').trim()
  ) {
    return false;
  }
  if (
    item.type !== 'commandExecution' &&
    item.type !== 'fileChange' &&
    item.type !== 'userMessage' &&
    item.type !== 'agentMessage' &&
    item.type !== 'reasoning' &&
    item.type !== 'plan' &&
    !itemText(item).trim()
  ) {
    return false;
  }
  return true;
}

function isAssistantOwnedTranscriptItem(item: CodexTranscriptItem | null | undefined): boolean {
  return Boolean(item && item.type !== 'userMessage');
}

function latestOptimisticBoundaryOrder(optimisticTurns: readonly CodexOptimisticUserTurn[]): number | null {
  let boundaryOrder: number | null = null;
  for (const optimisticTurn of optimisticTurns) {
    const candidate = Number(optimisticTurn.after_item_order);
    if (!Number.isFinite(candidate)) continue;
    if (boundaryOrder === null || candidate > boundaryOrder) {
      boundaryOrder = candidate;
    }
  }
  return boundaryOrder;
}

function hasAssistantOutputInCurrentRun(
  items: readonly CodexTranscriptItem[],
  beforeIndex: number,
  optimisticBoundaryOrder: number | null = null,
): boolean {
  for (let cursor = beforeIndex - 1; cursor >= 0; cursor -= 1) {
    const previous = items[cursor];
    if (!shouldRenderTranscriptItem(previous)) continue;
    if (optimisticBoundaryOrder !== null && Number(previous.order) <= optimisticBoundaryOrder) return false;
    if (previous.type === 'userMessage') return false;
    if (isAssistantOwnedTranscriptItem(previous)) return true;
  }
  return false;
}

function estimateTranscriptRowHeight(row: CodexTranscriptRenderRow): number {
  switch (row.kind) {
    case 'optimistic':
      return CODEX_TRANSCRIPT_ROW_HEIGHTS.optimistic;
    case 'pending_assistant':
      return CODEX_TRANSCRIPT_ROW_HEIGHTS.pending_assistant;
    case 'working_state':
      return CODEX_TRANSCRIPT_ROW_HEIGHTS.working_state;
    case 'display_node':
    default: {
      const node = row.displayNode;
      if (!node) return CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
      switch (node.kind) {
        case 'message':
          if (node.item.type === 'userMessage') return CODEX_TRANSCRIPT_ROW_HEIGHTS.userMessage;
          if (node.item.type === 'agentMessage') return CODEX_TRANSCRIPT_ROW_HEIGHTS.agentMessage;
          return CODEX_TRANSCRIPT_ROW_HEIGHTS.evidence;
        case 'activity_group':
          return CODEX_TRANSCRIPT_ROW_HEIGHTS.activityGroup;
        case 'attention':
          return CODEX_TRANSCRIPT_ROW_HEIGHTS.evidence;
        default:
          return CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
      }
    }
  }
}

function normalizeTranscriptRowScopeKey(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  return normalized || 'codex-transcript';
}

function buildScopedTranscriptRowID(scopeKey: string, anchorId: string): string {
  return `${scopeKey}::${anchorId}`;
}

function filterMeasuredRowHeights(
  rowIDs: readonly string[],
  heightsByID: Readonly<Record<string, number>>,
): Record<string, number> {
  if (rowIDs.length === 0) return {};
  const nextHeights: Record<string, number> = {};
  for (const rowID of rowIDs) {
    const height = heightsByID[rowID];
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) continue;
    nextHeights[rowID] = height;
  }
  return nextHeights;
}

function sameMeasuredRowHeights(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function CodexTranscriptMeasuredRow(props: {
  row: Accessor<CodexTranscriptRenderRow | null>;
  sourceItems: readonly CodexTranscriptItem[];
  activityStreamState: (group: CodexTranscriptActivityGroupNode) => CodexActivityStreamState;
  setActivityStreamState: (groupID: string, nextState: CodexActivityStreamState) => void;
  observeRow: (element: HTMLElement, rowID: string) => void;
  unobserveRow: (element: HTMLElement) => void;
  class?: string;
  style?: () => JSX.CSSProperties;
}) {
  let rowEl: HTMLDivElement | undefined;

  createEffect(() => {
    const row = props.row();
    const element = rowEl;
    if (!row || !element) return;
    props.observeRow(element, row.id);
    onCleanup(() => {
      props.unobserveRow(element);
    });
  });

  return (
    <Show when={props.row()}>
      {(rowAccessor) => {
        const row = () => rowAccessor();
        return (
          <div
            ref={(element) => {
              rowEl = element;
            }}
            class={cn('codex-transcript-row', props.class)}
            style={props.style?.()}
            data-follow-bottom-anchor-id={row().anchorId}
          >
            <Show when={row().kind === 'optimistic' && row().optimisticTurn}>
              <OptimisticUserMessageRow turn={row().optimisticTurn!} />
            </Show>
            <Show when={row().kind === 'display_node' && row().displayNode}>
              <TranscriptDisplayRow
                node={() => row().displayNode ?? null}
                sourceItems={props.sourceItems}
                activityStreamState={props.activityStreamState}
                setActivityStreamState={props.setActivityStreamState}
              />
            </Show>
            <Show when={row().kind === 'pending_assistant' && row().pendingAssistantState}>
              <PendingAssistantRow state={row().pendingAssistantState!} />
            </Show>
            <Show when={row().kind === 'working_state' && row().workingPhaseLabel}>
              <WorkingStateRow phaseLabel={row().workingPhaseLabel!} />
            </Show>
          </div>
        );
      }}
    </Show>
  );
}

function ActivityGroupRow(props: {
  group: CodexTranscriptActivityGroupNode;
  sourceItems: readonly CodexTranscriptItem[];
  state: CodexActivityStreamState;
  onStateChange: (nextState: CodexActivityStreamState) => void;
}) {
  return (
    <CodexMessageLane role="assistant" class="codex-activity-message-row">
      <CodexActivityStream
        group={props.group}
        sourceItems={props.sourceItems}
        state={props.state}
        onStateChange={props.onStateChange}
      />
    </CodexMessageLane>
  );
}

function TranscriptDisplayRow(props: {
  node: Accessor<CodexTranscriptDisplayNode | null>;
  sourceItems: readonly CodexTranscriptItem[];
  activityStreamState: (group: CodexTranscriptActivityGroupNode) => CodexActivityStreamState;
  setActivityStreamState: (groupID: string, nextState: CodexActivityStreamState) => void;
}) {
  return (
    <Show when={props.node()}>
      {(nodeAccessor) => {
        const node = () => nodeAccessor();
        if (node().kind === 'activity_group') {
          const group = node() as CodexTranscriptActivityGroupNode;
          return (
            <ActivityGroupRow
              group={group}
              sourceItems={props.sourceItems}
              state={props.activityStreamState(group)}
              onStateChange={(nextState) => props.setActivityStreamState(group.id, nextState)}
            />
          );
        }
        const item = () => {
          const current = node();
          return current.kind === 'message' || current.kind === 'attention' ? current.item : null;
        };
        if (item()?.type === 'userMessage') {
          return <UserMessageRow item={item()!} />;
        }
        if (item()?.type === 'agentMessage') {
          return <AgentMessageRow item={item()!} />;
        }
        if (item()) {
          return <TranscriptEvidenceRow item={item()!} />;
        }
        return null;
      }}
    </Show>
  );
}

export function CodexTranscript(props: {
  rootRef?: (element: HTMLDivElement) => void;
  scrollContainer?: HTMLElement | null;
  onViewportAnchorResolverChange?: (resolver: FollowBottomViewportAnchorResolver | null) => void;
  followBottomMode?: () => FollowBottomMode;
  rowHeightCache?: CodexTranscriptRowHeightCache;
  onMeasuredHeightsUpdated?: () => void;
  threadKey?: string;
  items: readonly CodexTranscriptItem[];
  optimisticUserTurns?: readonly CodexOptimisticUserTurn[];
  showWorkingState?: boolean;
  workingLabel?: string;
  workingFlags?: readonly string[];
  loading?: boolean;
  loadingTitle?: string;
  loadingBody?: string;
  emptyTitle: string;
  emptyBody: string;
}) {
  const i18n = useI18n();
  const optimisticUserTurns = createMemo<readonly CodexOptimisticUserTurn[]>(() => props.optimisticUserTurns ?? []);
  const transcriptRowScopeKey = createMemo(() => normalizeTranscriptRowScopeKey(
    props.threadKey ?? optimisticUserTurns()[0]?.thread_id ?? null,
  ));
  const itemRows = createMemo<readonly CodexTranscriptRenderRow[]>(() => {
    const rows: CodexTranscriptRenderRow[] = [];
    const renderableItems = props.items.filter(shouldRenderTranscriptItem);
    buildCodexTranscriptDisplayNodes(renderableItems).forEach((displayNode) => {
      const nodeID = String(displayNode.id ?? '').trim();
      if (!nodeID) return;
      const anchorId = displayNode.kind === 'activity_group' ? nodeID : `item:${nodeID}`;
      const seedRow: CodexTranscriptRenderRow = {
        id: buildScopedTranscriptRowID(transcriptRowScopeKey(), anchorId),
        kind: 'display_node',
        anchorId,
        displayNode,
        estimatedHeightPx: CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight,
      };
      rows.push({
        ...seedRow,
        estimatedHeightPx: estimateTranscriptRowHeight(seedRow),
      });
    });
    return rows;
  });
  const hasRows = () => itemRows().length > 0 || optimisticUserTurns().length > 0 || Boolean(props.showWorkingState);
  const transcriptSurfaceState = createMemo<CodexTranscriptSurfaceState>(() => resolveCodexTranscriptSurfaceState({
    hasRows: hasRows(),
    loading: props.loading,
    loadingTitle: props.loadingTitle,
    loadingBody: props.loadingBody,
    emptyTitle: props.emptyTitle,
    emptyBody: props.emptyBody,
  }));
  const transcriptFallbackState = createMemo<CodexTranscriptFallbackState | null>(() => {
    const state = transcriptSurfaceState();
    return state.mode === 'feed' ? null : state;
  });
  const pendingAssistantState = createMemo<PendingAssistantVisualState>(() => {
    const showWorkingRail = Boolean(props.showWorkingState);
    const optimisticBoundaryOrder = latestOptimisticBoundaryOrder(optimisticUserTurns());
    const hasAssistantOutput = hasAssistantOutputInCurrentRun(
      props.items,
      props.items.length,
      optimisticBoundaryOrder,
    );
    const showPrelude = showWorkingRail && !hasAssistantOutput;
    return {
      show: showPrelude,
      showPrelude,
      showWorkingRail: showPrelude && showWorkingRail,
      phaseLabel: workingPhaseLabel({
        i18n,
        label: String(props.workingLabel ?? '').trim() || 'working',
        flags: props.workingFlags ?? [],
        items: props.items,
        optimisticBoundaryOrder,
      }),
    };
  });
  const showStandaloneWorkingRow = createMemo(() => Boolean(props.showWorkingState) && !pendingAssistantState().show);
  const transcriptRows = createMemo<readonly CodexTranscriptRenderRow[]>(() => {
    const rows: CodexTranscriptRenderRow[] = optimisticUserTurns().map((turn) => {
      const anchorId = `optimistic:${turn.id}`;
      const seedRow: CodexTranscriptRenderRow = {
        id: buildScopedTranscriptRowID(transcriptRowScopeKey(), anchorId),
        kind: 'optimistic',
        anchorId,
        optimisticTurn: turn,
        estimatedHeightPx: CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight,
      };
      return {
        ...seedRow,
        estimatedHeightPx: estimateTranscriptRowHeight(seedRow),
      };
    });

    rows.push(...itemRows());

    if (pendingAssistantState().show) {
      const anchorId = 'pending-assistant';
      const seedRow: CodexTranscriptRenderRow = {
        id: buildScopedTranscriptRowID(transcriptRowScopeKey(), anchorId),
        kind: 'pending_assistant',
        anchorId,
        pendingAssistantState: pendingAssistantState(),
        estimatedHeightPx: CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight,
      };
      rows.push({
        ...seedRow,
        estimatedHeightPx: estimateTranscriptRowHeight(seedRow),
      });
    }

    if (showStandaloneWorkingRow()) {
      const anchorId = 'working-state';
      const seedRow: CodexTranscriptRenderRow = {
        id: buildScopedTranscriptRowID(transcriptRowScopeKey(), anchorId),
        kind: 'working_state',
        anchorId,
        workingPhaseLabel: pendingAssistantState().phaseLabel,
        estimatedHeightPx: CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight,
      };
      rows.push({
        ...seedRow,
        estimatedHeightPx: estimateTranscriptRowHeight(seedRow),
      });
    }

    return rows;
  });
  const transcriptRowsByID = createMemo<Record<string, CodexTranscriptRenderRow>>(() => Object.fromEntries(
    transcriptRows().map((row) => [row.id, row]),
  ));
  const transcriptRowOrder = createMemo<string[]>(() => transcriptRows().map((row) => row.id));
  const transcriptAnchorOrder = createMemo<string[]>(() => transcriptRows().map((row) => row.anchorId));
  const transcriptRowIndexByID = createMemo<Map<string, number>>(() => new Map(
    transcriptRowOrder().map((rowID, index) => [rowID, index]),
  ));
  const transcriptRowIndexByAnchorID = createMemo<Map<string, number>>(() => new Map(
    transcriptRows().map((row, index) => [row.anchorId, index]),
  ));
  const readPersistedRowHeights = (rowIDs: readonly string[]): Record<string, number> => {
    const cachedHeights = props.rowHeightCache?.readHeights(rowIDs);
    if (!cachedHeights) return {};
    return filterMeasuredRowHeights(rowIDs, cachedHeights);
  };
  const [rowHeightsByID, setRowHeightsByID] = createSignal<Record<string, number>>(
    readPersistedRowHeights(transcriptRowOrder()),
  );
  const [activityStreamStateByID, setActivityStreamStateByID] = createSignal<Record<string, CodexActivityStreamState>>({});
  const activityStreamState = (group: CodexTranscriptActivityGroupNode): CodexActivityStreamState => {
    return activityStreamStateByID()[group.id] ?? {
      expanded: group.defaultExpandLevel === 'semi',
      activeDetail: null,
    };
  };
  const setActivityStreamState = (groupID: string, nextState: CodexActivityStreamState): void => {
    setActivityStreamStateByID((current) => ({
      ...current,
      [groupID]: nextState,
    }));
  };
  const virtualized = createMemo(() => Boolean(props.scrollContainer));
  const virtualList = useVirtualList({
    count: () => transcriptRowOrder().length,
    getItemKey: (index: number) => transcriptRowOrder()[index] ?? `codex-row:${index}`,
    getItemHeight: (index: number) => {
      const rowID = transcriptRowOrder()[index];
      if (!rowID) return CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
      return rowHeightsByID()[rowID] ?? transcriptRowsByID()[rowID]?.estimatedHeightPx ?? CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
    },
    config: CODEX_TRANSCRIPT_VIRTUAL_LIST,
  });
  const visibleRowIDs = createMemo<string[]>(() => {
    const order = transcriptRowOrder();
    if (!virtualized()) return order;
    const range = virtualList.visibleRange();
    return order.slice(range.start, range.end);
  });
  const visibleVirtualItems = createMemo(() => (virtualized() ? virtualList.virtualItems() : []));
  const visibleVirtualItemsByID = createMemo(() => new Map(
    visibleVirtualItems().map((item) => [item.key, item]),
  ));
  const visibleVirtualRowIDs = createMemo(() => visibleVirtualItems().map((item) => item.key));
  const virtualFeedHeightPx = createMemo(() => (virtualized() ? virtualList.totalHeight() : 0));
  const getTranscriptRowHeight = (index: number): number => {
    const rowID = transcriptRowOrder()[index];
    if (!rowID) return CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
    return rowHeightsByID()[rowID]
      ?? transcriptRowsByID()[rowID]?.estimatedHeightPx
      ?? CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
  };
  let pausedViewportAnchor: ViewportAnchor | null = null;

  const captureTranscriptViewportAnchor = (scrollContainer: HTMLElement): ViewportAnchor | null => {
    pausedViewportAnchor = captureViewportAnchor({
      messageIds: [...transcriptAnchorOrder()],
      visibleRangeStart: virtualList.visibleRange().start,
      scrollTop: scrollContainer.scrollTop,
      getItemOffset: virtualList.getItemOffset,
      getItemHeight: getTranscriptRowHeight,
    });
    return pausedViewportAnchor;
  };

  const findViewportAnchorIndex = (scrollTop: number): number => {
    const rowCount = transcriptRowOrder().length;
    if (rowCount <= 0) return -1;

    let low = 0;
    let high = rowCount - 1;
    let match = rowCount - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const itemStart = virtualList.getItemOffset(mid);
      const itemEnd = itemStart + Math.max(1, getTranscriptRowHeight(mid));
      if (itemEnd > scrollTop + 0.5) {
        match = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return match;
  };

  const followBottomViewportAnchorResolver: FollowBottomViewportAnchorResolver = {
    capture: () => {
      const scrollContainer = props.scrollContainer ?? null;
      if (!scrollContainer || !virtualized()) return null;
      const anchorIndex = findViewportAnchorIndex(scrollContainer.scrollTop);
      if (anchorIndex < 0) return null;
      const anchorID = transcriptAnchorOrder()[anchorIndex];
      if (!anchorID) return null;
      return {
        id: anchorID,
        topOffsetPx: virtualList.getItemOffset(anchorIndex) - scrollContainer.scrollTop,
      };
    },
    resolveScrollTop: (anchor) => resolveViewportAnchorScrollTop(
      {
        messageId: anchor.id,
        offsetWithinItem: Math.max(0, -anchor.topOffsetPx),
      },
      transcriptRowIndexByAnchorID(),
      virtualList.getItemOffset,
    ),
  };

  createEffect(() => {
    transcriptRowScopeKey();
    pausedViewportAnchor = null;
  });

  createEffect(() => {
    const rowOrder = transcriptRowOrder();
    const cachedHeights = props.rowHeightCache?.readHeights(rowOrder);
    const nextHeights = cachedHeights
      ? filterMeasuredRowHeights(rowOrder, cachedHeights)
      : filterMeasuredRowHeights(rowOrder, untrack(rowHeightsByID));
    setRowHeightsByID((current) => {
      return sameMeasuredRowHeights(current, nextHeights) ? current : nextHeights;
    });
    if (!virtualized()) return;
    const heightUpdates = rowOrder
      .map((rowID, index) => ({ index, height: nextHeights[rowID] ?? 0 }))
      .filter((update) => update.height > 0);
    virtualList.setItemHeights(heightUpdates);
  });

  createEffect(() => {
    const element = props.scrollContainer ?? null;
    virtualList.scrollRef(element);
    if (!element || !virtualized()) return;
    virtualList.containerRef(element);
    virtualList.onScroll();
    untrack(() => captureTranscriptViewportAnchor(element));
    const handleScroll = () => {
      virtualList.onScroll();
      captureTranscriptViewportAnchor(element);
    };
    element.addEventListener('scroll', handleScroll, { passive: true });
    onCleanup(() => {
      element.removeEventListener('scroll', handleScroll);
    });
  });

  createEffect(() => {
    const onResolverChange = props.onViewportAnchorResolverChange;
    if (!onResolverChange) return;
    onResolverChange(virtualized() ? followBottomViewportAnchorResolver : null);
    onCleanup(() => {
      onResolverChange(null);
    });
  });

  const rowResizeTargets = new Map<Element, string>();
  const rowResizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver((entries) => {
      const updates = new Map<string, number>();
      for (const entry of entries) {
        const rowID = rowResizeTargets.get(entry.target);
        if (!rowID) continue;
        const borderBoxHeight = entry.borderBoxSize?.[0]?.blockSize;
        const rectHeight = (entry.target as HTMLElement).getBoundingClientRect().height;
        const rawHeight = borderBoxHeight ?? (rectHeight > 0 ? rectHeight : entry.contentRect.height);
        const nextHeight = Math.max(1, Math.round(rawHeight));
        if (nextHeight <= 0) continue;
        updates.set(rowID, nextHeight);
      }
      if (updates.size === 0) return;
      const currentRowHeights = rowHeightsByID();
      const pendingUpdates: Array<{
        rowID: string;
        nextHeight: number;
      }> = [];
      for (const [rowID, nextHeight] of updates) {
        const fallbackHeight = transcriptRowsByID()[rowID]?.estimatedHeightPx ?? CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
        const hasMeasuredHeight = Object.prototype.hasOwnProperty.call(currentRowHeights, rowID);
        const currentHeight = hasMeasuredHeight
          ? currentRowHeights[rowID]!
          : fallbackHeight;
        if (Math.abs(currentHeight - nextHeight) < 1) continue;
        pendingUpdates.push({ rowID, nextHeight });
      }
      if (pendingUpdates.length === 0) return;
      const scrollContainer = props.scrollContainer ?? null;
      const keepViewportAnchor = (
        virtualized() &&
        props.followBottomMode?.() === 'paused' &&
        !!scrollContainer
      );
      const viewportAnchorBeforeResize = keepViewportAnchor && scrollContainer
        ? pausedViewportAnchor ?? captureTranscriptViewportAnchor(scrollContainer)
        : null;
      let pausedScrollAdjustmentPx = 0;
      if (keepViewportAnchor && scrollContainer) {
        // Absolute-positioned virtual rows need an explicit scroll offset correction when
        // a measured row above the paused viewport changes height.
        const scrollTopBeforeResize = scrollContainer.scrollTop;
        for (const update of pendingUpdates) {
          const rowIndex = transcriptRowIndexByID().get(update.rowID);
          if (rowIndex === undefined) continue;
          const fallbackHeight = transcriptRowsByID()[update.rowID]?.estimatedHeightPx ?? CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
          const oldHeight = currentRowHeights[update.rowID] ?? fallbackHeight;
          const rowBottomBeforeResize = virtualList.getItemOffset(rowIndex) + Math.max(1, oldHeight);
          if (rowBottomBeforeResize > scrollTopBeforeResize + 0.5) continue;
          pausedScrollAdjustmentPx += update.nextHeight - oldHeight;
        }
      }
      setRowHeightsByID((current) => {
        let next = current;
        let changed = false;
        for (const update of pendingUpdates) {
          const fallbackHeight = transcriptRowsByID()[update.rowID]?.estimatedHeightPx ?? CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
          const currentHeight = current[update.rowID] ?? fallbackHeight;
          if (Math.abs(currentHeight - update.nextHeight) < 1) continue;
          if (next === current) next = { ...current };
          next[update.rowID] = update.nextHeight;
          changed = true;
        }
        return changed ? next : current;
      });
      const virtualHeightUpdates: Array<{ index: number; height: number }> = [];
      for (const update of pendingUpdates) {
        props.rowHeightCache?.writeHeight(update.rowID, update.nextHeight);
        const rowIndex = transcriptRowIndexByID().get(update.rowID);
        if (rowIndex === undefined) continue;
        virtualHeightUpdates.push({ index: rowIndex, height: update.nextHeight });
      }
      virtualList.setItemHeights(virtualHeightUpdates);
      props.onMeasuredHeightsUpdated?.();
      if (keepViewportAnchor && scrollContainer && Math.abs(pausedScrollAdjustmentPx) > 0.5) {
        scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop + pausedScrollAdjustmentPx);
        virtualList.onScroll();
        captureTranscriptViewportAnchor(scrollContainer);
      } else if (keepViewportAnchor && scrollContainer && viewportAnchorBeforeResize) {
        const nextAnchorScrollTop = resolveViewportAnchorScrollTop(
          viewportAnchorBeforeResize,
          transcriptRowIndexByAnchorID(),
          virtualList.getItemOffset,
        );
        if (
          nextAnchorScrollTop !== null &&
          Number.isFinite(nextAnchorScrollTop) &&
          Math.abs(nextAnchorScrollTop - scrollContainer.scrollTop) > 0.5
        ) {
          scrollContainer.scrollTop = Math.max(0, nextAnchorScrollTop);
          virtualList.onScroll();
          captureTranscriptViewportAnchor(scrollContainer);
        }
      }
    });

  const observeRow = (element: HTMLElement, rowID: string): void => {
    rowResizeTargets.set(element, rowID);
    rowResizeObserver?.observe(element);
  };

  const unobserveRow = (element: HTMLElement): void => {
    rowResizeTargets.delete(element);
    rowResizeObserver?.unobserve(element);
  };

  onCleanup(() => {
    rowResizeObserver?.disconnect();
  });

  return (
    <div
      ref={props.rootRef}
      data-codex-surface="transcript"
      data-codex-transcript-mode={transcriptSurfaceState().mode}
      class="codex-transcript-shell"
    >
      <Show
        when={transcriptSurfaceState().mode === 'feed'}
        fallback={(
          <Show when={transcriptFallbackState()}>
            {(state) => (
              <CodexTranscriptStateHero
                surface={state().surface}
                title={state().title}
                body={state().body}
              />
            )}
          </Show>
        )}
      >
        <div class="codex-transcript-shell-feed">
          <Show
            when={virtualized()}
            fallback={(
              <div class="codex-transcript-feed">
                <For each={visibleRowIDs()}>
                  {(rowID) => (
	                    <CodexTranscriptMeasuredRow
	                      row={() => transcriptRowsByID()[rowID] ?? null}
	                      sourceItems={props.items}
                        activityStreamState={activityStreamState}
                        setActivityStreamState={setActivityStreamState}
	                      observeRow={observeRow}
	                      unobserveRow={unobserveRow}
	                    />
                  )}
                </For>
              </div>
            )}
          >
            <div
              class="codex-transcript-feed codex-transcript-feed-virtualized"
              data-codex-transcript-virtualized="true"
              style={{ height: `${virtualFeedHeightPx()}px` }}
            >
              <For each={visibleVirtualRowIDs()}>
                {(rowID) => {
                  const rowOffsetPx = createMemo(() => visibleVirtualItemsByID().get(rowID)?.start ?? 0);
                  return (
	                    <CodexTranscriptMeasuredRow
	                      row={() => transcriptRowsByID()[rowID] ?? null}
	                      class="codex-transcript-row-virtualized"
	                      style={() => ({ transform: `translateY(${rowOffsetPx()}px)` })}
	                      sourceItems={props.items}
                        activityStreamState={activityStreamState}
                        setActivityStreamState={setActivityStreamState}
	                      observeRow={observeRow}
	                      unobserveRow={unobserveRow}
	                    />
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
