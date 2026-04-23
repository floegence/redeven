import { For, Index, Show, createMemo } from 'solid-js';
import { SidebarContent, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, ProcessingIndicator, Tag } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { Tooltip } from '../primitives/Tooltip';
import { REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { useCodexContext } from './CodexProvider';
import {
  displayStatus,
  formatRelativeThreadTime,
  groupThreadsByDate,
  isWorkingStatus,
  threadPreview,
  threadStatusDotClass,
} from './presentation';
import type { CodexThread } from './types';
import { buildCodexSidebarSummary } from './viewModel';

type SidebarThreadGroup = Readonly<{
  group: 'Today' | 'Yesterday' | 'This Week' | 'Older';
  threadIDs: string[];
}>;

const THREAD_RAIL_CONTENT_CLASS = 'codex-sidebar-shell flex h-full min-h-0 flex-col overflow-hidden';
const THREAD_RAIL_SECTION_CLASS = 'min-h-0 flex-1 overflow-hidden [&>div:last-child]:min-h-0 [&>div:last-child]:overflow-hidden';
const THREAD_RAIL_SCROLL_CLASS = 'h-full min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch] [touch-action:pan-y_pinch-zoom]';

function RuntimeSummary() {
  const codex = useCodexContext();
  const summary = createMemo(() => buildCodexSidebarSummary({
    status: codex.status(),
    pendingRequests: codex.pendingRequests(),
    statusError: codex.statusError(),
  }));

  return (
    <div
      data-codex-surface="sidebar-summary"
      class="codex-sidebar-summary shrink-0"
      title={summary().binaryPath || summary().secondaryLabel}
    >
      <div class="flex items-center gap-2">
        <CodexIcon class="h-7 w-7 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <div class="truncate text-sm font-medium text-foreground">Codex</div>
            <Tag variant={summary().hostReady ? 'success' : 'warning'} tone="soft" size="sm">
              {summary().hostLabel}
            </Tag>
          </div>
          <div class="codex-sidebar-summary-copy">{summary().secondaryLabel}</div>
        </div>
        <Show when={summary().pendingRequestCount > 0}>
          <span class="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] text-warning">
            {summary().pendingRequestCount} pending
          </span>
        </Show>
      </div>
    </div>
  );
}

function EmptyState() {
  const codex = useCodexContext();
  return (
    <div data-codex-surface="sidebar-empty" class="codex-sidebar-empty">
      <CodexIcon class="mx-auto mb-3 h-12 w-12" />
      <p class="text-xs font-medium text-muted-foreground/80">
        {codex.hasHostBinary()
          ? 'No conversations yet'
          : 'Codex is not available yet'}
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
  isRunning: boolean;
  unread: boolean;
  actionLabel: string;
  actionAriaLabel: string;
  actionDisabled?: boolean;
  actionDisabledReason?: string;
  onClick: () => void;
  onAction: () => void;
}) {
  const title = () => String(props.thread.name ?? props.thread.preview ?? '').trim() || 'New chat';
  const preview = () => threadPreview(props.thread);
  const timeLabel = () => formatRelativeThreadTime(props.thread.updated_at_unix_s);
  const indicatorMode = (): 'running' | 'unread' | 'none' => {
    if (props.isRunning) return 'running';
    if (props.unread) return 'unread';
    return 'none';
  };

  return (
    <div
      data-thread-id={props.thread.id}
      data-codex-surface="thread-card"
      class={`group relative w-full cursor-pointer rounded-lg border ${
        props.active
          ? 'border-border/20 bg-sidebar-accent text-sidebar-foreground shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
          : 'border-transparent text-sidebar-foreground/80 transition-colors duration-150 hover:border-border/15 hover:bg-sidebar-accent/60 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
      }`}
    >
      <Show when={props.active}>
        <div class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary" />
      </Show>

      <button
        type="button"
        class="flex w-full cursor-pointer items-start gap-2 px-2.5 py-2 pr-11 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
        onClick={props.onClick}
        aria-current={props.active ? 'page' : undefined}
      >
        <div class="relative mt-1.5 h-2 w-2 shrink-0" data-thread-indicator={indicatorMode()}>
          <Show when={indicatorMode() === 'running'}>
            <>
              <div class={`h-2 w-2 rounded-full ${threadStatusDotClass(props.thread.status)}`} title={displayStatus(props.thread.status, 'Idle')} />
              <Show when={isWorkingStatus(props.thread.status)}>
                <div class="absolute inset-0 h-2 w-2 rounded-full bg-primary/50 animate-pulse" />
              </Show>
            </>
          </Show>
          <Show when={indicatorMode() === 'unread'}>
            <div class="h-2 w-2 rounded-full bg-primary" title="Unread" />
          </Show>
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-1">
            <span class="flex-1 truncate text-xs font-medium">{title()}</span>
          </div>
          <Show
            when={props.isRunning}
            fallback={<p class="truncate text-[11px] leading-tight text-muted-foreground/60">{preview()}</p>}
          >
            <ProcessingIndicator variant="minimal" status="Working" class="h-3.5" />
          </Show>
        </div>
      </button>

      <div class="pointer-events-none absolute right-2.5 top-2 flex h-5 min-w-7 items-center justify-end">
        <Show when={props.actionLabel}>
          <span
            class="select-none text-[10px] text-muted-foreground/60 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
            aria-hidden="true"
          >
            {timeLabel()}
          </span>
          <Show when={props.actionDisabled && props.actionDisabledReason} fallback={(
            <button
              type="button"
              class="pointer-events-auto absolute inset-0 flex cursor-pointer items-center justify-center rounded px-1 text-[10px] font-medium text-muted-foreground/70 opacity-0 transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 group-hover:opacity-100 group-focus-within:opacity-100"
              aria-label={props.actionAriaLabel}
              disabled={props.actionDisabled}
              onClick={(event) => {
                event.stopPropagation();
                props.onAction();
              }}
            >
              {props.actionLabel}
            </button>
          )}>
            <Tooltip content={props.actionDisabledReason || ''} placement="bottom" delay={0}>
              <span class="pointer-events-auto absolute inset-0 inline-flex">
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center justify-center rounded px-1 text-[10px] font-medium text-muted-foreground/70 opacity-0 transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-label={props.actionAriaLabel}
                  disabled={props.actionDisabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onAction();
                  }}
                >
                  {props.actionLabel}
                </button>
              </span>
            </Tooltip>
          </Show>
        </Show>
        <Show when={!props.actionLabel}>
          <span class="select-none text-[10px] text-muted-foreground/60" aria-hidden="true">
            {timeLabel()}
          </span>
        </Show>
      </div>
    </div>
  );
}

export function CodexSidebarShell() {
  const codex = useCodexContext();

  const threads = createMemo(() => codex.threads());
  const threadByID = createMemo(() => {
    const next = new Map<string, CodexThread>();
    for (const thread of threads()) {
      const threadID = String(thread.id ?? '').trim();
      if (!threadID) continue;
      next.set(threadID, thread);
    }
    return next;
  });
  const hasThreads = createMemo(() => threads().length > 0);
  const groupedThreads = createMemo<SidebarThreadGroup[]>(() => groupThreadsByDate(threads()).map((group) => ({
    group: group.group,
    threadIDs: group.threads
      .map((thread) => String(thread.id ?? '').trim())
      .filter(Boolean),
  })));
  const showGroupHeaders = createMemo(() => threads().length >= 5);
  const showInitialLoading = createMemo(() => codex.threadsLoading() && !hasThreads());
  const newChatDisabledReason = createMemo(() => codex.hostDisabledReason());
  const renderNewChatButton = () => (
    <Button
      variant="primary"
      size="sm"
      class="h-8 flex-1 cursor-pointer justify-start gap-2 shadow-sm"
      disabled={!codex.hasHostBinary()}
      onClick={codex.startNewThreadDraft}
    >
      New Chat
    </Button>
  );
  return (
    <SidebarContent class={THREAD_RAIL_CONTENT_CLASS}>
      <div class="codex-sidebar-toolbar shrink-0">
        <Show when={!codex.hasHostBinary() && newChatDisabledReason()} fallback={renderNewChatButton()}>
          <Tooltip content={newChatDisabledReason()} placement="top" delay={0}>
            <span class="flex w-full">
              {renderNewChatButton()}
            </span>
          </Tooltip>
        </Show>
      </div>

      <RuntimeSummary />

      <Show when={codex.statusError()}>
        <div class="codex-sidebar-error shrink-0">
          {codex.statusError()}
        </div>
      </Show>

      <div class="min-h-0 flex-1 overflow-hidden">
        <Show
          when={!showInitialLoading()}
          fallback={
            <div class="codex-sidebar-loading">
              Loading chats...
            </div>
          }
        >
          <Show when={hasThreads()} fallback={<EmptyState />}>
            <SidebarSection title="Conversations" class={THREAD_RAIL_SECTION_CLASS}>
              <div
                {...REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_PROPS}
                data-testid="codex-thread-scroll-region"
                class={THREAD_RAIL_SCROLL_CLASS}
              >
                <div class="codex-sidebar-thread-list">
                  <Index each={groupedThreads()}>
                    {(groupAccessor) => {
                      const group = () => groupAccessor();
                      return (
                        <>
                          <Show when={showGroupHeaders()}>
                            <div class="codex-sidebar-group-label">
                              {group().group}
                            </div>
                          </Show>
                          <For each={group().threadIDs}>
                            {(threadID) => {
                              const thread = createMemo(() => threadByID().get(threadID) ?? null);
                              return (
                                <Show when={thread()}>
                                  {(resolvedThread) => (
                                    <ThreadCard
                                      thread={resolvedThread()}
                                      active={threadID === codex.selectedThreadID()}
                                      isRunning={codex.isThreadRunning(threadID)}
                                      unread={codex.isThreadUnread(threadID)}
                                      actionLabel={
                                        codex.supportsOperation('thread_archive')
                                          ? (codex.archivingThreadID() === threadID ? 'Archiving…' : 'Archive')
                                          : ''
                                      }
                                      actionAriaLabel={
                                        `Archive chat ${String(resolvedThread().name ?? resolvedThread().preview ?? threadID).trim() || threadID}`
                                      }
                                      actionDisabled={
                                        !codex.hasHostBinary() || codex.archivingThreadID() === threadID
                                      }
                                      actionDisabledReason={!codex.hasHostBinary() ? codex.hostDisabledReason() : ''}
                                      onClick={() => codex.selectThread(threadID)}
                                      onAction={() => void codex.archiveThread(threadID)}
                                    />
                                  )}
                                </Show>
                              );
                            }}
                          </For>
                        </>
                      );
                    }}
                  </Index>
                </div>
              </div>
            </SidebarSection>
          </Show>
        </Show>
      </div>
    </SidebarContent>
  );
}
