import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Tag } from '@floegence/floe-webapp-core/ui';

import { MarkdownBlock } from '../chat/blocks/MarkdownBlock';
import { ShellBlock } from '../chat/blocks/ShellBlock';
import { StreamingCursor } from '../chat/status/StreamingCursor';
import { CodexIcon } from '../icons/CodexIcon';
import { CodexMessageRunIndicator } from './CodexMessageRunIndicator';
import {
  displayStatus,
  itemGlyph,
  itemText,
  itemTitle,
  isWorkingStatus,
  statusTagVariant,
} from './presentation';
import type { CodexOptimisticUserTurn, CodexTranscriptItem, CodexUserInputEntry } from './types';

function EmptyTranscriptState(props: {
  title: string;
  body: string;
}) {
  return (
    <div data-codex-surface="empty-state" class="codex-empty-state">
      <div class="codex-empty-hero">
        <div class="relative mb-4 inline-flex items-center justify-center">
          <div class="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary/14 to-primary/8 shadow-sm">
            <CodexIcon class="h-10 w-10 text-primary" />
          </div>
        </div>

        <h2 class="mb-2 text-lg font-semibold text-foreground">{props.title}</h2>
        <p class="text-sm leading-relaxed text-muted-foreground">{props.body}</p>
      </div>
    </div>
  );
}

function LoadingTranscriptState(props: {
  title: string;
  body: string;
}) {
  return (
    <div data-codex-surface="loading-state" class="codex-empty-state">
      <div class="codex-empty-hero">
        <div class="relative mb-4 inline-flex items-center justify-center">
          <div class="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary/14 to-primary/8 shadow-sm">
            <CodexIcon class="h-10 w-10 text-primary" />
          </div>
        </div>

        <h2 class="mb-2 text-lg font-semibold text-foreground">{props.title}</h2>
        <p class="text-sm leading-relaxed text-muted-foreground">{props.body}</p>
      </div>
    </div>
  );
}

function CodexMessageLane(props: {
  role: 'assistant' | 'user';
  showAvatar?: boolean;
  children: JSX.Element;
}) {
  return (
    <div
      class={cn(
        'chat-message-item codex-chat-message-item',
        props.role === 'assistant' ? 'chat-message-item-assistant codex-chat-message-item-assistant' : 'chat-message-item-user codex-chat-message-item-user',
        props.showAvatar ? 'chat-message-item-with-avatar' : 'chat-message-item-without-avatar',
      )}
    >
      <Show when={props.showAvatar}>
        <div class="chat-message-avatar chat-message-avatar-assistant codex-chat-message-avatar">
          <div class="chat-message-avatar-custom-wrapper">
            <CodexIcon class="h-10 w-10" />
          </div>
        </div>
      </Show>
      <div class="chat-message-content-wrapper">
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

function ThinkingGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.125 9.188 5.03l3.112.42-2.248 2.067.547 3.045L8 9.96l-2.599 1.601.547-3.045L3.7 5.45l3.112-.42L8 2.125Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m6 3.75 4 4.25-4 4.25"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function ReasoningRow(props: { item: CodexTranscriptItem }) {
  const markdown = createMemo(() => reasoningMarkdown(props.item));
  const preview = createMemo(() => reasoningPreview(props.item));
  const isActive = createMemo(() => isWorkingStatus(props.item.status));
  const [expanded, setExpanded] = createSignal(false);

  createEffect<boolean | undefined>((wasActive) => {
    const active = isActive();
    if (wasActive === undefined) {
      setExpanded(active);
      return active;
    }
    if (!wasActive && active) {
      setExpanded(true);
    } else if (wasActive && !active) {
      setExpanded(false);
    }
    return active;
  });

  return (
    <CodexMessageLane role="assistant">
      <div
        data-codex-item-type={props.item.type}
        data-codex-reasoning-row="true"
        data-codex-reasoning-expanded={expanded() ? 'true' : 'false'}
        class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant"
      >
        <div class="codex-chat-reasoning-card">
          <button
            type="button"
            class="codex-chat-reasoning-toggle"
            aria-expanded={expanded() ? 'true' : 'false'}
            onClick={() => setExpanded((current) => !current)}
          >
            <span class="codex-chat-reasoning-kicker">
              <ThinkingGlyph />
            </span>
            <span class="codex-chat-reasoning-preview">{preview()}</span>
            <Show when={isActive()}>
              <span class="codex-chat-reasoning-cursor">
                <StreamingCursor />
              </span>
            </Show>
            <span class="codex-chat-reasoning-chevron" aria-hidden="true">
              <ChevronGlyph />
            </span>
          </button>

          <Show when={expanded() && markdown()}>
            <div class="codex-chat-reasoning-body">
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
            <Show when={props.item.type === 'commandExecution'}>
              <CommandExecutionBody item={props.item} />
            </Show>
            <Show when={props.item.type === 'fileChange'}>
              <FileChangeBody item={props.item} />
            </Show>
            <Show
              when={
                props.item.type !== 'commandExecution' &&
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

function AgentMessageRow(props: { item: CodexTranscriptItem; showAvatar?: boolean }) {
  return (
    <CodexMessageLane role="assistant" showAvatar={props.showAvatar}>
      <div data-codex-item-type={props.item.type} class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant">
        <div class="codex-chat-message-surface codex-chat-message-surface-assistant">
          <MarkdownBlock content={itemText(props.item)} class="codex-chat-markdown-block" rendererVariant="codex" />
        </div>
      </div>
    </CodexMessageLane>
  );
}

function imageInputs(item: CodexTranscriptItem): CodexUserInputEntry[] {
  return (item.inputs ?? []).filter((entry) => String(entry.type ?? '').trim() === 'image');
}

function localImageInputs(item: CodexTranscriptItem): CodexUserInputEntry[] {
  return (item.inputs ?? []).filter((entry) => String(entry.type ?? '').trim() === 'local_image');
}

function UserMessageRow(props: { item: CodexTranscriptItem }) {
  const images = () => imageInputs(props.item);
  const localImages = () => localImageInputs(props.item);
  const body = () => String(itemText(props.item) ?? '').trim();

  return (
    <CodexMessageLane role="user">
      <div data-codex-item-type={props.item.type} class="chat-message-bubble chat-message-bubble-user codex-chat-message-bubble-user">
        <div class="codex-chat-message-surface codex-chat-message-surface-user">
          <Show when={images().length > 0}>
            <div class="codex-chat-inline-attachments">
              <For each={images()}>
                {(entry, index) => (
                  <img
                    class="codex-chat-inline-image"
                    src={entry.url}
                    alt={entry.name || `Attachment ${index() + 1}`}
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </For>
            </div>
          </Show>

          <Show when={localImages().length > 0}>
            <div class="codex-chat-inline-local-attachments">
              <For each={localImages()}>
                {(entry) => (
                  <span class="codex-chat-inline-local-attachment" title={entry.path}>
                    {entry.path}
                  </span>
                )}
              </For>
            </div>
          </Show>

          <Show when={body()}>
            <MarkdownBlock content={body()} class="codex-chat-markdown-block codex-chat-user-markdown-block" rendererVariant="codex" />
          </Show>
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

function WorkingStateRow(props: {
  label: string;
  flags: readonly string[];
}) {
  const phaseLabel = () => workingPhaseLabel(props.label, props.flags);
  return (
    <CodexMessageLane role="assistant">
      <div
        data-codex-working-state="true"
        class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant"
      >
        <div class="codex-working-indicator-card">
          <CodexMessageRunIndicator phaseLabel={phaseLabel()} />
        </div>
      </div>
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

function shouldShowAgentAvatar(items: readonly CodexTranscriptItem[], index: number): boolean {
  const item = items[index];
  if (!item || item.type !== 'agentMessage') return false;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = items[cursor];
    if (!shouldRenderTranscriptItem(previous)) continue;
    if (previous.type === 'userMessage') return true;
    if (previous.type === 'agentMessage') return false;
  }
  return true;
}

function TranscriptRow(props: { item: CodexTranscriptItem; showAssistantAvatar?: boolean }) {
  if (!shouldRenderTranscriptItem(props.item)) {
    return null;
  }
  if (props.item.type === 'userMessage') {
    return <UserMessageRow item={props.item} />;
  }
  if (props.item.type === 'agentMessage') {
    return <AgentMessageRow item={props.item} showAvatar={props.showAssistantAvatar} />;
  }
  if (props.item.type === 'reasoning' || props.item.type === 'plan') {
    return <ReasoningRow item={props.item} />;
  }
  return <TranscriptEvidenceRow item={props.item} />;
}

export function CodexTranscript(props: {
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
  const optimisticUserTurns = () => [...(props.optimisticUserTurns ?? [])];
  const hasRows = () => props.items.length > 0 || optimisticUserTurns().length > 0 || Boolean(props.showWorkingState);
  return (
    <div data-codex-surface="transcript" class="mx-auto flex w-full max-w-5xl flex-col">
      <Show
        when={hasRows()}
        fallback={(
          <Show
            when={props.loading}
            fallback={(
              <EmptyTranscriptState
                title={props.emptyTitle}
                body={props.emptyBody}
              />
            )}
          >
            <LoadingTranscriptState
              title={String(props.loadingTitle ?? '').trim() || 'Loading conversation'}
              body={String(props.loadingBody ?? '').trim() || 'Fetching the selected Codex thread.'}
            />
          </Show>
        )}
      >
        <div class="codex-transcript-feed">
          <For each={optimisticUserTurns()}>
            {(turn) => (
              <div class="codex-transcript-row">
                <OptimisticUserMessageRow turn={turn} />
              </div>
            )}
          </For>
          <For each={props.items}>
            {(item, index) => (
              <div class="codex-transcript-row">
                <TranscriptRow item={item} showAssistantAvatar={shouldShowAgentAvatar(props.items, index())} />
              </div>
            )}
          </For>
          <Show when={props.showWorkingState}>
            <div class="codex-transcript-row">
              <WorkingStateRow
                label={String(props.workingLabel ?? '').trim() || 'working'}
                flags={props.workingFlags ?? []}
              />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
