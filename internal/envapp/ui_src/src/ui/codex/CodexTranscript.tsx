import { For, Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Tag } from '@floegence/floe-webapp-core/ui';

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
      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-all duration-200 group-hover:bg-primary/20">
        <CodexIcon class="h-5 w-5" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-foreground">Suggested Codex prompt</div>
        <div class="mt-1 text-xs leading-5 text-muted-foreground">{props.prompt}</div>
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
    <div class="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-14 text-center">
      <div class="relative mb-6 inline-flex items-center justify-center">
        <div class="absolute -inset-2 rounded-full bg-primary/8" />
        <div class="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5 shadow-sm">
          <CodexIcon class="h-9 w-9" />
        </div>
      </div>

      <h2 class="text-xl font-semibold text-foreground">{props.title}</h2>
      <p class="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{props.body}</p>

      <div class="mt-8 grid w-full gap-3 md:grid-cols-2">
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

      <div class="mt-6 flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground">
        <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-1">Enter to send</span>
        <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-1">Shift+Enter for newline</span>
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
    <div class="flex flex-wrap items-center gap-2">
      <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
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

function CommandExecutionBody(props: { item: CodexTranscriptItem }) {
  return (
    <div class="space-y-3">
      <div class="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        <div class="border-b border-slate-800 px-4 py-3">
          <div class="text-[11px] uppercase tracking-[0.14em] text-slate-400">Working directory</div>
          <div class="mt-1 truncate font-mono text-xs text-slate-200">{props.item.cwd || 'Working directory unavailable'}</div>
        </div>
        <div class="space-y-3 p-4 font-mono text-xs text-slate-100">
          <div>{props.item.command || 'Command unavailable'}</div>
          <Show when={props.item.aggregated_output}>
            <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-900/80 p-3 text-[11px] text-slate-300">
              {props.item.aggregated_output}
            </pre>
          </Show>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <Show when={typeof props.item.exit_code === 'number'}>
          <Tag variant={props.item.exit_code === 0 ? 'success' : 'error'} tone="soft" size="sm">
            Exit code: {props.item.exit_code}
          </Tag>
        </Show>
        <Show when={typeof props.item.duration_ms === 'number'}>
          <Tag variant="neutral" tone="soft" size="sm">
            {props.item.duration_ms} ms
          </Tag>
        </Show>
      </div>
    </div>
  );
}

function FileChangeBody(props: { item: CodexTranscriptItem }) {
  return (
    <div class="space-y-3">
      <For each={props.item.changes ?? []}>
        {(change) => (
          <div class="rounded-xl border border-border/60 bg-background/80 p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate font-mono text-xs text-foreground">{change.path}</div>
                <Show when={change.move_path}>
                  <div class="mt-1 text-[11px] text-muted-foreground">Move path: {change.move_path}</div>
                </Show>
              </div>
              <Tag variant="success" tone="soft" size="sm">
                {change.kind}
              </Tag>
            </div>
            <pre class="mt-4 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-muted/10 p-3 font-mono text-[11px] text-muted-foreground">
              {change.diff || 'No diff provided.'}
            </pre>
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
        <ul class="list-disc space-y-1 pl-5 text-sm leading-6 text-foreground">
          <For each={props.item.summary}>{(entry) => <li>{entry}</li>}</For>
        </ul>
      </Show>
      <Show when={props.item.text}>
        <pre class="whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-background/80 p-4 text-sm leading-6 text-muted-foreground">
          {props.item.text}
        </pre>
      </Show>
    </div>
  );
}

function TranscriptEvidenceRow(props: { item: CodexTranscriptItem }) {
  return (
    <div class="flex items-start gap-3">
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/80 text-foreground shadow-sm">
        {itemGlyph(props.item)}
      </div>
      <div class="min-w-0 flex-1">
        <div class="rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm">
          <TranscriptMeta
            label={itemTitle(props.item)}
            status={props.item.status}
            extra={
              <Tag variant="neutral" tone="soft" size="sm">
                {displayStatus(props.item.type, 'Event')}
              </Tag>
            }
          />
          <div class="mt-3">
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
              <div class="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">{itemText(props.item)}</div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentMessageRow(props: { item: CodexTranscriptItem }) {
  return (
    <div class="flex items-start gap-3">
      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/80 shadow-sm">
        <CodexIcon class="h-5 w-5" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="rounded-3xl rounded-tl-md border border-border/60 bg-card/85 p-5 shadow-sm">
          <TranscriptMeta
            label="Codex"
            status={props.item.status}
            extra={
              <Tag variant="neutral" tone="soft" size="sm">
                Review response
              </Tag>
            }
          />
          <div class="mt-3 whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground">
            {itemText(props.item)}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserMessageRow(props: { item: CodexTranscriptItem }) {
  return (
    <div class="flex justify-end">
      <div class="max-w-3xl">
        <div class="rounded-3xl rounded-br-md border border-primary/20 bg-primary/[0.08] p-4 shadow-sm">
          <TranscriptMeta
            label="You"
            status={props.item.status}
            extra={
              <Tag variant="neutral" tone="soft" size="sm">
                Review brief
              </Tag>
            }
          />
          <div class="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
            {itemText(props.item)}
          </div>
        </div>
      </div>
    </div>
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
    <div class="mx-auto flex w-full max-w-5xl flex-col">
      <Show
        when={props.items.length > 0}
        fallback={
          <EmptyTranscriptState
            title={props.emptyTitle}
            body={props.emptyBody}
            onSuggestionClick={props.onSuggestionClick}
            suggestionDisabled={props.suggestionDisabled}
          />
        }
      >
        <div class="flex flex-col gap-5 px-4 py-6 lg:px-6">
          <For each={props.items}>{(item) => <TranscriptRow item={item} />}</For>
        </div>
      </Show>
    </div>
  );
}
