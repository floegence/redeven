import { For, Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Tag } from '@floegence/floe-webapp-core/ui';

import { MarkdownBlock } from '../chat/blocks/MarkdownBlock';
import { ShellBlock } from '../chat/blocks/ShellBlock';
import { ThinkingBlock } from '../chat/blocks/ThinkingBlock';
import { CodexIcon } from '../icons/CodexIcon';
import {
  displayStatus,
  itemGlyph,
  itemText,
  itemTitle,
  statusTagVariant,
} from './presentation';
import type { CodexTranscriptItem } from './types';

const EMPTY_SUGGESTIONS = [
  'Review the current diff and list the riskiest issues first.',
  'Summarize the latest file changes and tell me what still needs review.',
  'Turn this implementation idea into a step-by-step plan with checkpoints.',
  'Inspect the latest command output and explain the likely failure point.',
] as const;

function EmptySuggestion(props: {
  prompt: string;
  onClick: (prompt: string) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onClick(props.prompt)}
      disabled={props.disabled}
      class={cn(
        'group flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border/50 bg-card/40 p-4 text-left transition-all duration-200',
        'hover:border-primary/30 hover:bg-card hover:shadow-lg hover:shadow-primary/5',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border/50 disabled:hover:bg-card/40',
      )}
    >
      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 transition-all duration-200 group-hover:bg-primary/20 group-hover:scale-110">
        <CodexIcon class="h-5 w-5" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="mb-0.5 text-sm font-medium text-foreground">Suggested Codex prompt</div>
        <div class="text-xs leading-relaxed text-muted-foreground">{props.prompt}</div>
      </div>
    </button>
  );
}

function EmptyTranscriptState(props: {
  title: string;
  body: string;
  onSuggestionClick: (prompt: string) => void;
  suggestionDisabled?: boolean;
}) {
  return (
    <div data-codex-surface="empty-state" class="codex-empty-state">
      <div class="codex-empty-hero">
        <div class="relative mb-6 inline-flex items-center justify-center">
          <div class="absolute -inset-2 rounded-full bg-primary/8" />
          <div class="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/8 shadow-sm">
            <CodexIcon class="h-9 w-9 text-primary" />
          </div>
        </div>

        <h2 class="mb-3 text-xl font-semibold text-foreground">{props.title}</h2>
        <p class="text-sm leading-relaxed text-muted-foreground">{props.body}</p>
      </div>

      <div class="codex-empty-suggestions">
        <For each={EMPTY_SUGGESTIONS}>
          {(prompt) => (
            <EmptySuggestion
              prompt={prompt}
              onClick={props.onSuggestionClick}
              disabled={props.suggestionDisabled}
            />
          )}
        </For>
      </div>

      <div class="codex-empty-hint">
        <span class="codex-page-chip codex-page-chip--neutral">Enter to send</span>
        <span class="codex-page-chip codex-page-chip--neutral">Shift+Enter for newline</span>
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
            <CodexIcon class="h-8 w-8" />
          </div>
        </div>
      </Show>
      <div class="chat-message-content-wrapper">
        {props.children}
      </div>
    </div>
  );
}

function TranscriptMeta(props: {
  label: string;
  status?: string | null;
  extra?: JSX.Element;
}) {
  return (
    <div class="codex-chat-transcript-meta">
      <div class="codex-chat-transcript-meta-label">
        {props.label}
      </div>
      <Show when={props.status}>
        <Tag variant={statusTagVariant(props.status)} tone="soft" size="sm">
          {displayStatus(props.status)}
        </Tag>
      </Show>
      {props.extra}
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
  return (
    <div class="space-y-3">
      <Show when={(props.item.summary?.length ?? 0) > 0}>
        <ul class="codex-chat-summary-list">
          <For each={props.item.summary}>{(entry) => <li>{entry}</li>}</For>
        </ul>
      </Show>
      <Show when={props.item.text}>
        <ThinkingBlock content={props.item.text} class="codex-chat-thinking-block" />
      </Show>
    </div>
  );
}

function TranscriptEvidenceRow(props: { item: CodexTranscriptItem }) {
  return (
    <CodexMessageLane role="assistant">
      <div data-codex-item-type={props.item.type} class="chat-message-bubble chat-message-bubble-assistant codex-chat-message-bubble-assistant">
        <div class="codex-chat-evidence-card">
          <TranscriptMeta
            label={itemTitle(props.item)}
            status={props.item.status}
            extra={
              <>
                <span class="codex-chat-evidence-kicker">{itemGlyph(props.item)}</span>
                <Tag variant="neutral" tone="soft" size="sm">
                  {displayStatus(props.item.type, 'Event')}
                </Tag>
              </>
            }
          />
          <div class="mt-3 codex-chat-evidence-body">
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
                props.item.type !== 'plan'
              }
            >
              <MarkdownBlock content={itemText(props.item)} class="codex-chat-markdown-block" />
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
          <MarkdownBlock content={itemText(props.item)} class="codex-chat-markdown-block" />
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
          <MarkdownBlock content={itemText(props.item)} class="codex-chat-markdown-block codex-chat-user-markdown-block" />
        </div>
      </div>
    </CodexMessageLane>
  );
}

function TranscriptRow(props: { item: CodexTranscriptItem }) {
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
  emptyTitle: string;
  emptyBody: string;
  onSuggestionClick: (prompt: string) => void;
  suggestionDisabled?: boolean;
}) {
  return (
    <div data-codex-surface="transcript" class="mx-auto flex w-full max-w-5xl flex-col">
      <Show
        when={props.items.length > 0}
        fallback={(
          <EmptyTranscriptState
            title={props.emptyTitle}
            body={props.emptyBody}
            onSuggestionClick={props.onSuggestionClick}
            suggestionDisabled={props.suggestionDisabled}
          />
        )}
      >
        <div class="codex-transcript-feed">
          <For each={props.items}>
            {(item) => (
              <div class="codex-transcript-row">
                <TranscriptRow item={item} />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
