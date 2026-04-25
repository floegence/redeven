import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ChevronRight, Sparkles } from '@floegence/floe-webapp-core/icons';
import { Tag } from '@floegence/floe-webapp-core/ui';

import { MarkdownBlock } from '../chat/blocks/MarkdownBlock';
import { ShellBlock } from '../chat/blocks/ShellBlock';
import { useVirtualList } from '../chat/hooks/useVirtualList';
import {
  captureViewportAnchor,
  resolveViewportAnchorScrollTop,
  type ViewportAnchor,
} from '../chat/message-list/scrollAnchor';
import type { FollowBottomViewportAnchorResolver } from '../chat/scroll/createFollowBottomController';
import { StreamingCursor } from '../chat/status/StreamingCursor';
import { CodexIcon } from '../icons/CodexIcon';
import { CodexFileChangeDiff } from './CodexFileChangeDiff';
import { CodexMessageRunIndicator } from './CodexMessageRunIndicator';
import { CodexUserMessageContent } from './CodexUserMessageContent';
import {
  displayStatus,
  itemGlyph,
  itemText,
  itemTitle,
  isWorkingStatus,
  statusTagVariant,
} from './presentation';
import type { CodexOptimisticUserTurn, CodexTranscriptItem } from './types';
import type { FollowBottomMode } from '../chat/scroll/createFollowBottomController';

type CodexTranscriptSurfaceMode = 'empty' | 'loading' | 'feed';
type CodexTranscriptSurfaceName = 'empty-state' | 'loading-state';
type CodexTranscriptRowKind = 'optimistic' | 'item' | 'pending_assistant' | 'working_state';
type CodexTranscriptRenderRow = Readonly<{
  id: string;
  kind: CodexTranscriptRowKind;
  anchorId: string;
  estimatedHeightPx: number;
  item?: CodexTranscriptItem;
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
  reasoning: 112,
  plan: 112,
  commandExecution: 76,
  fileChange: 232,
  webSearch: 96,
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

function normalizeExecutionStatus(status: string | null | undefined, exitCode: number | null | undefined): 'running' | 'success' | 'error' {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (normalized.includes('error') || normalized.includes('fail')) return 'error';
  if (normalized === 'running' || normalized === 'inprogress' || normalized === 'in_progress') return 'running';
  if (typeof exitCode === 'number' && exitCode !== 0) return 'error';
  return 'success';
}

function CommandExecutionBody(props: { item: CodexTranscriptItem }) {
  return (
    <ShellBlock
      command={props.item.command || 'Command unavailable'}
      output={props.item.aggregated_output}
      cwd={props.item.cwd}
      durationMs={props.item.duration_ms}
      exitCode={props.item.exit_code}
      status={normalizeExecutionStatus(props.item.status, props.item.exit_code)}
      class="codex-chat-shell-block"
    />
  );
}

function CommandExecutionRow(props: { item: CodexTranscriptItem }) {
  return (
    <CodexMessageLane role="assistant" contentClass="codex-chat-command-content">
      <CommandExecutionBody item={props.item} />
    </CodexMessageLane>
  );
}

function FileChangeBody(props: { item: CodexTranscriptItem }) {
  return (
    <div class="space-y-3">
      <For each={props.item.changes ?? []}>
        {(change) => <CodexFileChangeDiff change={change} />}
      </For>
      <Show when={(props.item.changes?.length ?? 0) === 0}>
        <div class="text-sm text-muted-foreground">No file change details were provided yet.</div>
      </Show>
    </div>
  );
}

function reasoningSummary(item: CodexTranscriptItem): string[] {
  return (item.summary ?? [])
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
}

function reasoningDetail(item: CodexTranscriptItem): string {
  const direct = String(item.text ?? '').trim();
  if (direct) return direct;
  const content = (item.content ?? [])
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
  if (content.length === 0) return '';
  const summary = reasoningSummary(item);
  if (summary.length === content.length && summary.join('\n\n') === content.join('\n\n')) {
    return '';
  }
  return content.join('\n\n');
}

function reasoningMarkdown(item: CodexTranscriptItem): string {
  const sections: string[] = [];
  const summary = reasoningSummary(item);
  if (summary.length > 0) {
    sections.push(summary.map((entry) => `- ${entry}`).join('\n'));
  }
  const detail = reasoningDetail(item);
  if (detail) {
    sections.push(detail);
  }
  return sections.join('\n\n').trim();
}

function reasoningPreview(item: CodexTranscriptItem): string {
  const summary = reasoningSummary(item);
  if (summary.length > 0) return summary[0];
  const detail = reasoningDetail(item);
  if (detail) {
    return detail.replace(/\s+/g, ' ').trim();
  }
  return item.type === 'plan' ? 'Planning next steps' : 'Thinking';
}

function titleCaseStatus(value: string): string {
  return displayStatus(value, 'working')
    .split(' ')
    .map((part) => (part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : ''))
    .join(' ')
    .trim();
}

function workingPhaseLabel(label: string, flags: readonly string[]): string {
  const normalizedLabel = String(label ?? '').trim().toLowerCase();
  const normalizedFlags = [...(flags ?? [])]
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
  switch (selected) {
    case 'planning':
      return 'Planning...';
    case 'finalizing':
      return 'Finalizing...';
    case 'recovering':
      return 'Recovering...';
    case 'waiting approval':
    case 'waiting_approval':
    case 'waitingapproval':
      return 'Waiting for approval...';
    case 'running':
    case 'working':
    case 'active':
    case 'accepted':
    case 'in progress':
    case 'in_progress':
    case 'inprogress':
      return 'Working...';
    default: {
      const titled = titleCaseStatus(selected || 'working');
      return titled.endsWith('...') ? titled : `${titled}...`;
    }
  }
}

function ReasoningRow(props: {
  item: CodexTranscriptItem;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const markdown = createMemo(() => reasoningMarkdown(props.item));
  const preview = createMemo(() => reasoningPreview(props.item));
  const isActive = createMemo(() => isWorkingStatus(props.item.status));
  const bodyId = createMemo(() => `codex-reasoning-body-${props.item.id}`);
  const expanded = () => props.expanded;

  return (
    <CodexMessageLane role="assistant">
      <div
        data-codex-item-type={props.item.type}
        data-codex-reasoning-row="true"
        data-codex-reasoning-expanded={expanded() ? 'true' : 'false'}
        class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant"
      >
        <div class="codex-chat-reasoning-inline">
          <div class="codex-chat-reasoning-copy">
            <button
              type="button"
              class="codex-chat-reasoning-toggle"
              aria-expanded={expanded() ? 'true' : 'false'}
              aria-controls={bodyId()}
              onClick={() => props.onExpandedChange(!expanded())}
            >
              <span class="codex-chat-reasoning-kicker" aria-hidden="true">
                <Sparkles />
              </span>
              <span class="codex-chat-reasoning-preview">{preview()}</span>
              <Show when={isActive()}>
                <span class="codex-chat-reasoning-cursor">
                  <StreamingCursor />
                </span>
              </Show>
              <span class="codex-chat-reasoning-chevron" aria-hidden="true">
                <ChevronRight />
              </span>
            </button>

            <Show when={expanded() && markdown()}>
              <div id={bodyId()} class="codex-chat-reasoning-body">
                <MarkdownBlock
                  content={markdown()}
                  streaming={isActive()}
                  class="codex-chat-markdown-block codex-chat-reasoning-markdown"
                  rendererVariant="codex"
                />
              </div>
            </Show>
          </div>
        </div>
      </div>
    </CodexMessageLane>
  );
}

type CodexWebSearchMetaItem = Readonly<{
  label: string;
  value: string;
  title?: string;
  tone?: 'default' | 'accent';
}>;

function compactWebSearchURL(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '');
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return host;
    if (segments.length === 1) return `${host}/${segments[0]}`;
    return `${host}/.../${segments[segments.length - 1]}`;
  } catch {
    if (normalized.length <= 48) return normalized;
    return `${normalized.slice(0, 22)}...${normalized.slice(-18)}`;
  }
}

function buildWebSearchCard(item: CodexTranscriptItem): Readonly<{
  actionLabel: string;
  primary: string;
  primaryTitle: string;
  meta: CodexWebSearchMetaItem[];
}> {
  const actionType = String(item.action?.type ?? '').trim();
  const query = String(item.query ?? item.action?.query ?? '').trim();
  const queries = Array.isArray(item.action?.queries)
    ? item.action?.queries.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    : [];
  const pattern = String(item.action?.pattern ?? '').trim();
  const url = String(item.action?.url ?? '').trim();
  const compactURL = compactWebSearchURL(url);
  const meta: CodexWebSearchMetaItem[] = [];
  const pushMeta = (
    label: string,
    value: string,
    title?: string,
    tone: CodexWebSearchMetaItem['tone'] = 'default',
  ) => {
    const normalizedLabel = String(label ?? '').trim();
    const normalizedValue = String(value ?? '').trim();
    if (!normalizedLabel || !normalizedValue) return;
    if (meta.some((entry) => entry.label === normalizedLabel && entry.value === normalizedValue)) return;
    meta.push({
      label: normalizedLabel,
      value: normalizedValue,
      title: String(title ?? normalizedValue).trim() || undefined,
      tone,
    });
  };

  if (actionType === 'search') {
    if (queries.length > 1) {
      pushMeta('Across', `${queries.length} queries`, undefined, 'accent');
    }
    return {
      actionLabel: 'Search',
      primary: query || queries[0] || 'Search requested',
      primaryTitle: query || queries[0] || 'Search requested',
      meta,
    };
  }

  if (actionType === 'openPage') {
    return {
      actionLabel: 'Open page',
      primary: compactURL || url || query || 'Page opened',
      primaryTitle: url || compactURL || query || 'Page opened',
      meta,
    };
  }

  if (actionType === 'findInPage') {
    if (compactURL) {
      pushMeta('Page', compactURL, url);
    }
    return {
      actionLabel: 'Find in page',
      primary: pattern || query || compactURL || 'Pattern lookup',
      primaryTitle: pattern || query || url || compactURL || 'Pattern lookup',
      meta,
    };
  }

  if (compactURL) {
    pushMeta('Page', compactURL, url);
  }
  return {
    actionLabel: 'Search',
    primary: query || pattern || compactURL || 'Search requested',
    primaryTitle: query || pattern || url || compactURL || 'Search requested',
    meta,
  };
}

function EvidenceHeader(props: { item: CodexTranscriptItem }) {
  return (
    <div class="codex-chat-evidence-header">
      <span class="codex-chat-evidence-kicker">{itemGlyph(props.item)}</span>
      <div class="codex-chat-evidence-copy">
        <div class="codex-chat-evidence-title">{itemTitle(props.item)}</div>
      </div>
      <Show when={props.item.status}>
        <span class="codex-chat-evidence-status">
          <Tag variant={statusTagVariant(props.item.status)} tone="soft" size="sm">
            {displayStatus(props.item.status)}
          </Tag>
        </span>
      </Show>
    </div>
  );
}

function WebSearchRow(props: { item: CodexTranscriptItem }) {
  const card = createMemo(() => buildWebSearchCard(props.item));
  return (
    <CodexMessageLane role="assistant">
      <div data-codex-item-type={props.item.type} class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant">
        <div class="codex-chat-evidence-card codex-chat-evidence-card-web-search">
          <div class="codex-chat-web-search-shell">
            <span class="codex-chat-web-search-glyph">{itemGlyph(props.item)}</span>
            <div class="codex-chat-web-search-main">
              <div class="codex-chat-web-search-hero">
                <span class="codex-chat-web-search-action-chip">{card().actionLabel}</span>
                <code class="codex-chat-web-search-primary" title={card().primaryTitle}>
                  {card().primary}
                </code>
              </div>
              <Show when={card().meta.length > 0}>
                <div class="codex-chat-web-search-meta">
                  <For each={card().meta}>
                    {(entry) => (
                      <span
                        class={cn(
                          'codex-chat-web-search-meta-item',
                          entry.tone === 'accent' && 'codex-chat-web-search-meta-item-accent',
                        )}
                        title={entry.title}
                      >
                        <span class="codex-chat-web-search-meta-label">{entry.label}</span>
                        <span class="codex-chat-web-search-meta-value">{entry.value}</span>
                      </span>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <Show when={props.item.status}>
              <span class="codex-chat-web-search-status">
                <Tag variant={statusTagVariant(props.item.status)} tone="soft" size="sm">
                  {displayStatus(props.item.status)}
                </Tag>
              </span>
            </Show>
          </div>
        </div>
      </div>
    </CodexMessageLane>
  );
}

function TranscriptEvidenceRow(props: { item: CodexTranscriptItem }) {
  const fallbackText = () => itemText(props.item);
  return (
    <CodexMessageLane role="assistant">
      <div data-codex-item-type={props.item.type} class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant">
        <div class="codex-chat-evidence-card">
          <EvidenceHeader item={props.item} />
          <div class="codex-chat-evidence-body">
            <Show when={props.item.type === 'fileChange'}>
              <FileChangeBody item={props.item} />
            </Show>
            <Show
              when={
                props.item.type !== 'fileChange' &&
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
  const streaming = () => isWorkingStatus(props.item.status);
  return (
    <CodexMessageLane role="assistant">
      <div data-codex-item-type={props.item.type} class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant">
        <div class="codex-chat-message-surface codex-chat-message-surface-assistant">
          <MarkdownBlock
            content={itemText(props.item)}
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
  return (
    <div
      data-codex-pre-output="true"
      class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant codex-pending-assistant-prelude"
    >
      <div class="codex-chat-message-surface codex-chat-message-surface-assistant codex-pending-assistant-prelude-surface">
        <div class="chat-markdown-block codex-chat-markdown-block">
          <div class="chat-markdown-empty-streaming" aria-label="Codex is preparing to respond">
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
    case 'item':
    default: {
      const item = row.item;
      if (!item) return CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
      switch (item.type) {
        case 'userMessage':
          return CODEX_TRANSCRIPT_ROW_HEIGHTS.userMessage;
        case 'agentMessage':
          return CODEX_TRANSCRIPT_ROW_HEIGHTS.agentMessage;
        case 'reasoning':
          return CODEX_TRANSCRIPT_ROW_HEIGHTS.reasoning;
        case 'plan':
          return CODEX_TRANSCRIPT_ROW_HEIGHTS.plan;
        case 'commandExecution':
          return CODEX_TRANSCRIPT_ROW_HEIGHTS.commandExecution;
        case 'fileChange':
          return CODEX_TRANSCRIPT_ROW_HEIGHTS.fileChange;
        case 'webSearch':
          return CODEX_TRANSCRIPT_ROW_HEIGHTS.webSearch;
        default:
          return CODEX_TRANSCRIPT_ROW_HEIGHTS.evidence;
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

function CodexTranscriptMeasuredRow(props: {
  row: Accessor<CodexTranscriptRenderRow | null>;
  reasoningExpandedByID: Accessor<Record<string, boolean>>;
  onReasoningExpandedChange: (rowID: string, expanded: boolean) => void;
  observeRow: (element: HTMLElement, rowID: string) => void;
  unobserveRow: (element: HTMLElement) => void;
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
            class="codex-transcript-row"
            data-follow-bottom-anchor-id={row().anchorId}
          >
            <Show when={row().kind === 'optimistic' && row().optimisticTurn}>
              <OptimisticUserMessageRow turn={row().optimisticTurn!} />
            </Show>
            <Show when={row().kind === 'item' && row().item}>
              <TranscriptRow
                item={() => row().item ?? null}
                reasoningExpanded={Boolean(
                  row().item ? props.reasoningExpandedByID()[row().id] : false,
                )}
                onReasoningExpandedChange={(expanded) => {
                  props.onReasoningExpandedChange(row().id, expanded);
                }}
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

function TranscriptRow(props: {
  item: Accessor<CodexTranscriptItem | null>;
  reasoningExpanded?: boolean;
  onReasoningExpandedChange?: (expanded: boolean) => void;
}) {
  return (
    <Show when={props.item()}>
      {(itemAccessor) => {
        const item = () => itemAccessor();
        if (item().type === 'userMessage') {
          return <UserMessageRow item={item()} />;
        }
        if (item().type === 'agentMessage') {
          return <AgentMessageRow item={item()} />;
        }
        if (item().type === 'commandExecution') {
          return <CommandExecutionRow item={item()} />;
        }
        if (item().type === 'webSearch') {
          return <WebSearchRow item={item()} />;
        }
        if (item().type === 'reasoning' || item().type === 'plan') {
          return (
            <ReasoningRow
              item={item()}
              expanded={Boolean(props.reasoningExpanded)}
              onExpandedChange={(expanded) => props.onReasoningExpandedChange?.(expanded)}
            />
          );
        }
        return <TranscriptEvidenceRow item={item()} />;
      }}
    </Show>
  );
}

export function CodexTranscript(props: {
  rootRef?: (element: HTMLDivElement) => void;
  scrollContainer?: HTMLElement | null;
  onViewportAnchorResolverChange?: (resolver: FollowBottomViewportAnchorResolver | null) => void;
  followBottomMode?: () => FollowBottomMode;
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
  const optimisticUserTurns = createMemo<readonly CodexOptimisticUserTurn[]>(() => props.optimisticUserTurns ?? []);
  const [reasoningExpandedByID, setReasoningExpandedByID] = createSignal<Record<string, boolean>>({});
  const [rowHeightsByID, setRowHeightsByID] = createSignal<Record<string, number>>({});
  const transcriptRowScopeKey = createMemo(() => normalizeTranscriptRowScopeKey(
    props.threadKey ?? optimisticUserTurns()[0]?.thread_id ?? null,
  ));
  const itemRows = createMemo<readonly CodexTranscriptRenderRow[]>(() => {
    const rows: CodexTranscriptRenderRow[] = [];
    props.items.forEach((item) => {
      if (!shouldRenderTranscriptItem(item)) return;
      const itemID = String(item.id ?? '').trim();
      if (!itemID) return;
      const anchorId = `item:${itemID}`;
      const seedRow: CodexTranscriptRenderRow = {
        id: buildScopedTranscriptRowID(transcriptRowScopeKey(), anchorId),
        kind: 'item',
        anchorId,
        item,
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
    const hasAssistantOutput = hasAssistantOutputInCurrentRun(
      props.items,
      props.items.length,
      latestOptimisticBoundaryOrder(optimisticUserTurns()),
    );
    const showPrelude = showWorkingRail && !hasAssistantOutput;
    return {
      show: showPrelude,
      showPrelude,
      showWorkingRail: showPrelude && showWorkingRail,
      phaseLabel: workingPhaseLabel(String(props.workingLabel ?? '').trim() || 'working', props.workingFlags ?? []),
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
  const paddingTopPx = createMemo(() => (virtualized() ? virtualList.paddingTop() : 0));
  const paddingBottomPx = createMemo(() => (virtualized() ? virtualList.paddingBottom() : 0));
  const getTranscriptRowHeight = (index: number): number => {
    const rowID = transcriptRowOrder()[index];
    if (!rowID) return CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
    return rowHeightsByID()[rowID]
      ?? transcriptRowsByID()[rowID]?.estimatedHeightPx
      ?? CODEX_TRANSCRIPT_VIRTUAL_LIST.defaultItemHeight;
  };
  let pausedViewportAnchor: ViewportAnchor | null = null;

  const captureTranscriptViewportAnchor = (scrollContainer: HTMLElement): void => {
    pausedViewportAnchor = captureViewportAnchor({
      messageIds: [...transcriptAnchorOrder()],
      visibleRangeStart: virtualList.visibleRange().start,
      scrollTop: scrollContainer.scrollTop,
      getItemOffset: virtualList.getItemOffset,
      getItemHeight: getTranscriptRowHeight,
    });
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

  createEffect(() => {
    const visibleReasoningRowIDs = new Set<string>();
    setReasoningExpandedByID((current) => {
      let next = current;
      let changed = false;
      for (const row of transcriptRows()) {
        if (row.kind !== 'item') continue;
        const item = row.item;
        if (!item || (item.type !== 'reasoning' && item.type !== 'plan')) continue;
        visibleReasoningRowIDs.add(row.id);
        if (Object.prototype.hasOwnProperty.call(current, row.id)) continue;
        if (next === current) next = { ...current };
        next[row.id] = false;
        changed = true;
      }
      for (const rowID of Object.keys(current)) {
        if (visibleReasoningRowIDs.has(rowID)) continue;
        if (next === current) next = { ...current };
        delete next[rowID];
        changed = true;
      }
      return changed ? next : current;
    });
  });

  createEffect(() => {
    const visibleRowIDs = new Set(transcriptRowOrder());
    setRowHeightsByID((current) => {
      let next = current;
      let changed = false;
      for (const rowID of Object.keys(current)) {
        if (visibleRowIDs.has(rowID)) continue;
        if (next === current) next = { ...current };
        delete next[rowID];
        changed = true;
      }
      return changed ? next : current;
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
        !!scrollContainer &&
        !!pausedViewportAnchor
      );
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
      for (const update of pendingUpdates) {
        const rowIndex = transcriptRowIndexByID().get(update.rowID);
        if (rowIndex === undefined) continue;
        virtualList.setItemHeight(rowIndex, update.nextHeight);
      }
      if (keepViewportAnchor && scrollContainer && pausedViewportAnchor) {
        const nextAnchorScrollTop = resolveViewportAnchorScrollTop(
          pausedViewportAnchor,
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
          <div class="codex-transcript-feed">
            <Show when={paddingTopPx() > 0}>
              <div aria-hidden="true" style={{ height: `${paddingTopPx()}px` }} />
            </Show>
            <For each={visibleRowIDs()}>
              {(rowID) => (
                <CodexTranscriptMeasuredRow
                  row={() => transcriptRowsByID()[rowID] ?? null}
                  reasoningExpandedByID={reasoningExpandedByID}
                  onReasoningExpandedChange={(itemID, expanded) => {
                    setReasoningExpandedByID((current) => {
                      if (Boolean(current[itemID]) === expanded) return current;
                      return {
                        ...current,
                        [itemID]: expanded,
                      };
                    });
                  }}
                  observeRow={observeRow}
                  unobserveRow={unobserveRow}
                />
              )}
            </For>
            <Show when={paddingBottomPx() > 0}>
              <div aria-hidden="true" style={{ height: `${paddingBottomPx()}px` }} />
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
