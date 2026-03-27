import { For, Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Tag } from '@floegence/floe-webapp-core/ui';

import { MarkdownBlock } from '../chat/blocks/MarkdownBlock';
import { ShellBlock } from '../chat/blocks/ShellBlock';
import { ThinkingBlock } from '../chat/blocks/ThinkingBlock';
import { StreamingCursor } from '../chat/status/StreamingCursor';
import { CodexIcon } from '../icons/CodexIcon';
import {
  displayStatus,
  itemGlyph,
  itemText,
  itemTitle,
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

function ReasoningBody(props: { item: CodexTranscriptItem }) {
  const detailText = () => {
    const direct = String(props.item.text ?? '').trim();
    if (direct) return direct;
    const content = (props.item.content ?? []).map((entry) => String(entry ?? '').trim()).filter(Boolean);
    if (content.length === 0) return '';
    const summary = (props.item.summary ?? []).map((entry) => String(entry ?? '').trim()).filter(Boolean);
    if (summary.length === content.length && summary.join('\n\n') === content.join('\n\n')) {
      return '';
    }
    return content.join('\n\n');
  };

  return (
    <div class="space-y-3">
      <Show when={(props.item.summary?.length ?? 0) > 0}>
        <ul class="codex-chat-summary-list">
          <For each={props.item.summary}>{(entry) => <li>{entry}</li>}</For>
        </ul>
      </Show>
      <Show when={detailText()}>
        <ThinkingBlock content={detailText()} class="codex-chat-thinking-block" />
      </Show>
    </div>
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
            <Show when={props.item.type === 'reasoning' || props.item.type === 'plan'}>
              <ReasoningBody item={props.item} />
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

function AgentMessageRow(props: { item: CodexTranscriptItem }) {
  return (
    <CodexMessageLane role="assistant" showAvatar>
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
  const normalizedLabel = () => String(props.label ?? '').trim() || 'working';
  return (
    <CodexMessageLane role="assistant">
      <div
        data-codex-working-state="true"
        class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant"
      >
        <div class="codex-working-indicator-card">
          <div class="codex-working-indicator-surface">
            <span class="codex-working-indicator-dots" aria-hidden="true">
              <span class="codex-working-indicator-dot" />
              <span class="codex-working-indicator-dot" />
              <span class="codex-working-indicator-dot" />
            </span>
            <span class="codex-working-indicator-label">Codex is {displayStatus(normalizedLabel())}</span>
            <span class="codex-working-indicator-cursor">
              <StreamingCursor />
            </span>
          </div>
          <Show when={props.flags.length > 0}>
            <div class="mt-2 flex flex-wrap gap-2">
              <For each={props.flags}>
                {(flag) => (
                  <Tag variant="info" tone="soft" size="sm">
                    {flag}
                  </Tag>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </CodexMessageLane>
  );
}

function TranscriptRow(props: { item: CodexTranscriptItem }) {
  if (
    (props.item.type === 'reasoning' || props.item.type === 'plan') &&
    (props.item.summary?.length ?? 0) === 0 &&
    (props.item.content?.length ?? 0) === 0 &&
    !String(props.item.text ?? '').trim()
  ) {
    return null;
  }
  if (
    props.item.type !== 'commandExecution' &&
    props.item.type !== 'fileChange' &&
    props.item.type !== 'userMessage' &&
    props.item.type !== 'agentMessage' &&
    props.item.type !== 'reasoning' &&
    props.item.type !== 'plan' &&
    !itemText(props.item).trim()
  ) {
    return null;
  }
  if (props.item.type === 'userMessage') {
    return <UserMessageRow item={props.item} />;
  }
  if (props.item.type === 'agentMessage') {
    return <AgentMessageRow item={props.item} />;
  }
  return <TranscriptEvidenceRow item={props.item} />;
}

export function CodexTranscript(props: {
  items: readonly CodexTranscriptItem[];
  optimisticUserTurns?: readonly CodexOptimisticUserTurn[];
  showWorkingState?: boolean;
  workingLabel?: string;
  workingFlags?: readonly string[];
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
          <EmptyTranscriptState
            title={props.emptyTitle}
            body={props.emptyBody}
          />
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
            {(item) => (
              <div class="codex-transcript-row">
                <TranscriptRow item={item} />
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
