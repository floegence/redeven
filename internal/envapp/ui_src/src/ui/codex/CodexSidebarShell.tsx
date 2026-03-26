import { For, Index, Show, createMemo } from 'solid-js';
import { Refresh, Trash } from '@floegence/floe-webapp-core/icons';
import { SidebarContent, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { useCodexContext } from './CodexProvider';
import {
  displayStatus,
  formatRelativeThreadTime,
  groupThreadsByDate,
  threadPreview,
  threadStatusDotClass,
} from './presentation';
import type { CodexThread } from './types';

function RuntimeSummary() {
  const codex = useCodexContext();
  const binaryPath = () => String(codex.status()?.binary_path ?? '').trim();
  const hostSummary = () =>
    binaryPath() || 'Redeven will use the host `codex` binary as soon as it is available on PATH.';

  return (
    <div
      class="mx-1 mb-2 rounded-xl border border-border/60 bg-card/65 px-2.5 py-2 shadow-sm"
      title={hostSummary()}
    >
      <div class="flex items-center gap-2">
        <CodexIcon class="h-6 w-6 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <div class="truncate text-sm font-medium text-foreground">Codex</div>
            <Tag variant={codex.hasHostBinary() ? 'success' : 'warning'} tone="soft" size="sm">
              {codex.hasHostBinary() ? 'Host ready' : 'Install required'}
            </Tag>
          </div>
          <Show when={!codex.hasHostBinary()}>
            <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
              Install the host `codex` binary and refresh to enable Codex chats.
            </div>
          </Show>
        </div>
        <Show when={codex.pendingRequests().length > 0}>
          <span class="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] text-warning">
            {codex.pendingRequests().length} pending
          </span>
        </Show>
      </div>
    </div>
  );
}

function EmptyState() {
  const codex = useCodexContext();

  return (
    <div class="px-2.5 py-8 text-center">
      <CodexIcon class="mx-auto mb-3 h-10 w-10" />
      <p class="text-xs font-medium text-muted-foreground/80">
        {codex.hasHostBinary() ? 'No conversations yet' : 'Codex is not available yet'}
      </p>
      <p class="mt-1 text-[11px] leading-5 text-muted-foreground/50">
        {codex.hasHostBinary()
          ? 'Start a new Codex chat to begin.'
          : 'Install `codex` on the host, then refresh this panel.'}
      </p>
    </div>
  );
}

function ThreadCard(props: {
  thread: CodexThread;
  active: boolean;
  canArchive: boolean;
  onClick: () => void;
  onArchive: () => void;
}) {
  const title = () => String(props.thread.name ?? props.thread.preview ?? '').trim() || 'New chat';
  const preview = () => threadPreview(props.thread);
  const timeLabel = () => formatRelativeThreadTime(props.thread.updated_at_unix_s);
  const archiveLabel = () => `Archive chat ${title()}`;

  return (
    <div
      data-thread-id={props.thread.id}
      class={`group relative w-full cursor-pointer rounded-lg border transition-all duration-150 ${
        props.active
          ? 'border-border/20 bg-sidebar-accent text-sidebar-foreground shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
          : 'border-transparent text-sidebar-foreground/80 hover:border-border/15 hover:bg-sidebar-accent/60 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
      }`}
    >
      <Show when={props.active}>
        <div class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary" />
      </Show>

      <button
        type="button"
        class="flex w-full cursor-pointer items-start gap-2 px-2.5 py-2 pr-11 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
        onClick={props.onClick}
      >
        <div class="relative mt-1.5 h-2 w-2 shrink-0">
          <div class={`h-2 w-2 rounded-full ${threadStatusDotClass(props.thread.status)}`} title={displayStatus(props.thread.status, 'Idle')} />
          <Show when={String(props.thread.status ?? '').trim().toLowerCase() === 'running'}>
            <div class="absolute inset-0 h-2 w-2 rounded-full bg-primary/50 animate-pulse" />
          </Show>
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-1">
            <span class="flex-1 truncate text-xs font-medium">{title()}</span>
            <Show when={props.active}>
              <span class="inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary/8 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                Active
              </span>
            </Show>
          </div>
          <p class="truncate text-[11px] leading-tight text-muted-foreground/60">{preview()}</p>
        </div>
      </button>

      <div class="pointer-events-none absolute right-2.5 top-2 flex h-5 min-w-7 items-center justify-end">
        <Show
          when={props.canArchive}
          fallback={
            <span class="select-none text-[10px] text-muted-foreground/60" aria-hidden="true">
              {timeLabel()}
            </span>
          }
        >
          <span
            class="select-none text-[10px] text-muted-foreground/60 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
            aria-hidden="true"
          >
            {timeLabel()}
          </span>
          <button
            type="button"
            class="pointer-events-auto absolute inset-0 flex cursor-pointer items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-all duration-150 hover:bg-warning/10 hover:text-warning focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-label={archiveLabel()}
            onClick={(event) => {
              event.stopPropagation();
              props.onArchive();
            }}
          >
            <Trash class="h-3.5 w-3.5" />
          </button>
        </Show>
      </div>
    </div>
  );
}

export function CodexSidebarShell() {
  const codex = useCodexContext();

  const groupedThreads = createMemo(() => groupThreadsByDate(codex.threads()));
  const showGroupHeaders = createMemo(() => codex.threads().length >= 5);

  return (
    <SidebarContent>
      <div class="flex items-center gap-1 px-1 pb-1">
        <Button
          variant="primary"
          size="sm"
          class="h-8 flex-1 justify-start gap-2 shadow-sm"
          onClick={codex.startNewThreadDraft}
        >
          New Chat
        </Button>
        <Button
          variant="outline"
          size="icon"
          class="h-8 w-8 border-sidebar-border/60 bg-sidebar text-sidebar-foreground/80 transition-all duration-150 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          onClick={() => void codex.refreshSidebar()}
          disabled={codex.statusLoading()}
          aria-label="Refresh Codex"
        >
          <Refresh class="h-3.5 w-3.5" />
        </Button>
      </div>

      <RuntimeSummary />

      <Show when={codex.statusError()}>
        <div class="mx-1 mb-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
          {codex.statusError()}
        </div>
      </Show>

      <Show
        when={!codex.threadsLoading()}
        fallback={
          <div class="px-2.5 py-2 text-xs text-muted-foreground">
            Loading chats...
          </div>
        }
      >
        <Show when={codex.threads().length > 0} fallback={<EmptyState />}>
          <SidebarSection title="Conversations">
            <div class="flex flex-col gap-0.5">
              <Index each={groupedThreads()}>
                {(groupAccessor) => {
                  const group = () => groupAccessor();
                  return (
                    <>
                      <Show when={showGroupHeaders()}>
                        <div class="select-none px-2.5 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
                          {group().group}
                        </div>
                      </Show>
                      <For each={group().threads}>
                        {(thread) => (
                          <ThreadCard
                            thread={thread}
                            active={thread.id === codex.activeThreadID()}
                            canArchive={thread.id === codex.activeThreadID()}
                            onClick={() => codex.selectThread(thread.id)}
                            onArchive={() => void codex.archiveThread(thread.id)}
                          />
                        )}
                      </For>
                    </>
                  );
                }}
              </Index>
            </div>
          </SidebarSection>
        </Show>
      </Show>
    </SidebarContent>
  );
}
