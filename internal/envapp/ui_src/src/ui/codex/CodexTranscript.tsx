import { For, Show, createEffect, createMemo, createSignal, type Accessor, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ChevronRight, Sparkles } from '@floegence/floe-webapp-core/icons';
import { Tag } from '@floegence/floe-webapp-core/ui';

import { MarkdownBlock } from '../chat/blocks/MarkdownBlock';
import { ShellBlock } from '../chat/blocks/ShellBlock';
import { StreamingCursor } from '../chat/status/StreamingCursor';
import { CodexIcon } from '../icons/CodexIcon';
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

type CodexTranscriptSurfaceMode = 'empty' | 'loading' | 'feed';
type CodexTranscriptSurfaceName = 'empty-state' | 'loading-state';
type CodexTranscriptRenderRow = Readonly<{
  id: string;
  item: CodexTranscriptItem;
  showAssistantAvatar: boolean;
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
  return (
    <div
      class={cn(
        'chat-message-item codex-chat-message-item',
        props.role === 'assistant' ? 'chat-message-item-assistant codex-chat-message-item-assistant' : 'chat-message-item-user codex-chat-message-item-user',
        props.showAvatar ? 'chat-message-item-with-avatar' : 'chat-message-item-without-avatar',
        props.class,
      )}
    >
      <Show when={props.showAvatar}>
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
        {(change) => (
          <div class="chat-code-diff-block codex-chat-diff-block">
            <div class="chat-code-diff-header">
              <div class="chat-code-diff-info">
                <span class="chat-code-diff-filename">{change.path}</span>
                <span class="chat-code-diff-stats">{change.kind}</span>
                <Show when={change.move_path}>
                  <span class="chat-code-diff-stats" title={change.move_path}>→ {change.move_path}</span>
                </Show>
              </div>
            </div>
            <div class="chat-code-diff-content">
              <pre class="codex-chat-diff-pre">{change.diff || 'No diff provided.'}</pre>
            </div>
          </div>
        )}
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

function EvidenceHeader(props: { item: CodexTranscriptItem }) {
  return (
    <div class="codex-chat-evidence-header">
      <span class="codex-chat-evidence-kicker">{itemGlyph(props.item)}</span>
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-foreground">{itemTitle(props.item)}</div>
      </div>
      <Show when={props.item.status}>
        <Tag variant={statusTagVariant(props.item.status)} tone="soft" size="sm">
          {displayStatus(props.item.status)}
        </Tag>
      </Show>
    </div>
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

type CodexAssistantLeadAlignmentVariant = 'markdown' | 'prelude';

interface CodexAssistantLeadAlignment {
  rowClass?: string;
  contentClass?: string;
}

function assistantLeadAlignment(
  variant: CodexAssistantLeadAlignmentVariant,
  enabled: boolean,
): CodexAssistantLeadAlignment {
  if (!enabled) return {};
  return {
    rowClass: 'codex-assistant-lead-aligned-row',
    contentClass: cn(
      'codex-assistant-lead-aligned-content',
      variant === 'markdown'
        ? 'codex-assistant-lead-aligned-content-markdown'
        : 'codex-assistant-lead-aligned-content-prelude',
    ),
  };
}

function AgentMessageRow(props: { item: CodexTranscriptItem; showAvatar?: boolean }) {
  const streaming = () => isWorkingStatus(props.item.status);
  const alignment = assistantLeadAlignment('markdown', Boolean(props.showAvatar));
  return (
    <CodexMessageLane
      role="assistant"
      showAvatar={props.showAvatar}
      class={alignment.rowClass}
      contentClass={alignment.contentClass}
    >
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
  showAvatar: boolean;
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
  const alignment = assistantLeadAlignment('prelude', Boolean(props.state.showAvatar));
  return (
    <CodexMessageLane
      role="assistant"
      showAvatar={props.state.showAvatar}
      class={alignment.rowClass}
      contentClass={alignment.contentClass}
    >
      <Show when={props.state.showPrelude}>
        <PendingAssistantPrelude />
      </Show>
      <Show when={props.state.showWorkingRail}>
        <WorkingStatusRail phaseLabel={props.state.phaseLabel} class="codex-pending-assistant-status-rail" />
      </Show>
    </CodexMessageLane>
  );
}

function WorkingStateRow(props: {
  phaseLabel: string;
  showAvatar?: boolean;
}) {
  return (
    <CodexMessageLane role="assistant" showAvatar={props.showAvatar} class="codex-working-state-row">
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

function hasAssistantMessageInCurrentRun(items: readonly CodexTranscriptItem[], beforeIndex: number): boolean {
  for (let cursor = beforeIndex - 1; cursor >= 0; cursor -= 1) {
    const previous = items[cursor];
    if (!shouldRenderTranscriptItem(previous)) continue;
    if (previous.type === 'userMessage') return false;
    if (previous.type === 'agentMessage') return true;
  }
  return false;
}

function shouldShowAgentAvatar(items: readonly CodexTranscriptItem[], index: number): boolean {
  const item = items[index];
  return Boolean(item && item.type === 'agentMessage' && !hasAssistantMessageInCurrentRun(items, index));
}

function shouldShowWorkingAvatar(items: readonly CodexTranscriptItem[]): boolean {
  return !hasAssistantMessageInCurrentRun(items, items.length);
}

function TranscriptRow(props: {
  item: Accessor<CodexTranscriptItem | null>;
  showAssistantAvatar: Accessor<boolean>;
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
          return <AgentMessageRow item={item()} showAvatar={props.showAssistantAvatar()} />;
        }
        if (item().type === 'commandExecution') {
          return <CommandExecutionRow item={item()} />;
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
  const transcriptRows = createMemo<readonly CodexTranscriptRenderRow[]>(() => {
    const rows: CodexTranscriptRenderRow[] = [];
    props.items.forEach((item, index) => {
      if (!shouldRenderTranscriptItem(item)) return;
      const itemID = String(item.id ?? '').trim();
      if (!itemID) return;
      rows.push({
        id: itemID,
        item,
        showAssistantAvatar: shouldShowAgentAvatar(props.items, index),
      });
    });
    return rows;
  });
  const transcriptRowsByID = createMemo<Record<string, CodexTranscriptRenderRow>>(() => Object.fromEntries(
    transcriptRows().map((row) => [row.id, row]),
  ));
  const transcriptRowOrder = createMemo<string[]>(() => transcriptRows().map((row) => row.id));
  const hasRows = () => transcriptRowOrder().length > 0 || optimisticUserTurns().length > 0 || Boolean(props.showWorkingState);
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
    const showPrelude = showWorkingRail && (
      optimisticUserTurns().length > 0 ||
      !hasAssistantMessageInCurrentRun(props.items, props.items.length)
    );
    return {
      show: showPrelude,
      showAvatar: showPrelude,
      showPrelude,
      showWorkingRail: showPrelude && showWorkingRail,
      phaseLabel: workingPhaseLabel(String(props.workingLabel ?? '').trim() || 'working', props.workingFlags ?? []),
    };
  });
  const showStandaloneWorkingRow = createMemo(() => Boolean(props.showWorkingState) && !pendingAssistantState().show);

  createEffect(() => {
    const visibleReasoningIDs = new Set<string>();
    setReasoningExpandedByID((current) => {
      let next = current;
      let changed = false;
      for (const item of props.items) {
        if (item.type !== 'reasoning' && item.type !== 'plan') continue;
        const itemID = String(item.id ?? '').trim();
        if (!itemID) continue;
        visibleReasoningIDs.add(itemID);
        if (!isWorkingStatus(item.status) || current[itemID] === true) continue;
        if (next === current) next = { ...current };
        next[itemID] = true;
        changed = true;
      }
      for (const itemID of Object.keys(current)) {
        if (visibleReasoningIDs.has(itemID)) continue;
        if (next === current) next = { ...current };
        delete next[itemID];
        changed = true;
      }
      return changed ? next : current;
    });
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
            <For each={optimisticUserTurns()}>
              {(turn) => (
                <div class="codex-transcript-row" data-follow-bottom-anchor-id={`optimistic:${turn.id}`}>
                  <OptimisticUserMessageRow turn={turn} />
                </div>
              )}
            </For>
            <For each={transcriptRowOrder()}>
              {(itemID) => (
                <div class="codex-transcript-row" data-follow-bottom-anchor-id={`item:${itemID}`}>
                  <TranscriptRow
                    item={() => transcriptRowsByID()[itemID]?.item ?? null}
                    showAssistantAvatar={() => Boolean(transcriptRowsByID()[itemID]?.showAssistantAvatar)}
                    reasoningExpanded={Boolean(reasoningExpandedByID()[itemID])}
                    onReasoningExpandedChange={(expanded) => {
                      setReasoningExpandedByID((current) => {
                        if (Boolean(current[itemID]) === expanded) return current;
                        return {
                          ...current,
                          [itemID]: expanded,
                        };
                      });
                    }}
                  />
                </div>
              )}
            </For>
            <Show when={pendingAssistantState().show}>
              <div class="codex-transcript-row" data-follow-bottom-anchor-id="pending-assistant">
                <PendingAssistantRow state={pendingAssistantState()} />
              </div>
            </Show>
            <Show when={showStandaloneWorkingRow()}>
              <div class="codex-transcript-row" data-follow-bottom-anchor-id="working-state">
                <WorkingStateRow
                  phaseLabel={pendingAssistantState().phaseLabel}
                  showAvatar={shouldShowWorkingAvatar(props.items)}
                />
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
