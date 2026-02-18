import { For, Index, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { History, Plus, Refresh, Sparkles, Trash, X } from '@floegence/floe-webapp-core/icons';
import { FlowerIcon } from '../icons/FlowerIcon';
import { useNotification } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { SidebarContent, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, Checkbox, ConfirmDialog, Dialog, ProcessingIndicator, SegmentedControl, Tooltip } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { Motion } from 'solid-motionone';
import { fetchGatewayJSON } from '../services/gatewayApi';
import { useAIChatContext, type ListThreadsResponse, type ThreadRunStatus, type ThreadView } from './AIChatContext';
import { useEnvContext } from './EnvContext';
import { hasRWXPermissions } from './aiPermissions';

// Compact timestamp for the right side of each thread card.
function fmtShortTime(ms: number): string {
  if (!ms) return '';
  try {
    const now = Date.now();
    const diff = now - ms;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) {
      const d = new Date(ms);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return 'now';
  } catch {
    return '';
  }
}

// Full timestamp used by the management dialog table.
function fmtDetailTime(ms: number): string {
  if (!ms) return '-';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '-';
  }
}

// Time group type.
type TimeGroup = 'Today' | 'Yesterday' | 'This Week' | 'Older';

type ThreadAgePreset = 'all' | 'older_1d' | 'older_1w' | 'older_1m';
type DeleteThreadResult = 'deleted' | 'busy';

// Group threads by date (only when total count >= 5).
function groupThreadsByDate(threads: ThreadView[]): { group: TimeGroup; threads: ThreadView[] }[] {
  if (threads.length < 5) {
    return [{ group: 'Today' as TimeGroup, threads }];
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  // Start of this week (Monday).
  const dayOfWeek = now.getDay();
  const weekStart = todayStart - ((dayOfWeek === 0 ? 6 : dayOfWeek - 1) * 86400000);

  const groups: Record<TimeGroup, ThreadView[]> = {
    'Today': [],
    'Yesterday': [],
    'This Week': [],
    'Older': [],
  };

  for (const t of threads) {
    const ts = threadSortTime(t);
    if (ts >= todayStart) {
      groups['Today'].push(t);
    } else if (ts >= yesterdayStart) {
      groups['Yesterday'].push(t);
    } else if (ts >= weekStart) {
      groups['This Week'].push(t);
    } else {
      groups['Older'].push(t);
    }
  }

  const order: TimeGroup[] = ['Today', 'Yesterday', 'This Week', 'Older'];
  return order.filter((g) => groups[g].length > 0).map((g) => ({ group: g, threads: groups[g] }));
}

// Status dot color mapping.
function statusDotClass(status: ThreadRunStatus): string {
  switch (status) {
    case 'accepted':
    case 'running':
      return 'bg-primary';
    case 'waiting_approval':
      return 'bg-amber-500';
    case 'waiting_user':
      return 'bg-amber-500';
    case 'recovering':
      return 'bg-sky-500';
    case 'success':
      return 'bg-emerald-500';
    case 'failed':
    case 'timed_out':
      return 'bg-error';
    case 'canceled':
      return 'bg-muted-foreground/50';
    default:
      return 'bg-muted-foreground/30';
  }
}

// Status label used for tooltip text.
function statusLabel(status: ThreadRunStatus): string {
  switch (status) {
    case 'accepted': return 'Queued';
    case 'running': return 'Running';
    case 'waiting_approval': return 'Waiting Approval';
    case 'waiting_user': return 'Waiting Input';
    case 'recovering': return 'Recovering';
    case 'success': return 'Done';
    case 'failed': return 'Failed';
    case 'timed_out': return 'Timed Out';
    case 'canceled': return 'Canceled';
    default: return '';
  }
}

function threadSortTime(thread: ThreadView): number {
  const updated = Number(thread.updated_at_unix_ms || 0);
  if (updated > 0) return updated;
  const created = Number(thread.created_at_unix_ms || 0);
  if (created > 0) return created;
  return 0;
}

function normalizeThreadStatus(raw: string | null | undefined): ThreadRunStatus {
  const status = String(raw ?? '').trim().toLowerCase();
  if (
    status === 'accepted' ||
    status === 'running' ||
    status === 'waiting_approval' ||
    status === 'waiting_user' ||
    status === 'recovering' ||
    status === 'success' ||
    status === 'failed' ||
    status === 'canceled' ||
    status === 'timed_out'
  ) {
    return status as ThreadRunStatus;
  }
  return 'idle';
}

function isActiveThreadStatus(status: ThreadRunStatus): boolean {
  return status === 'accepted' || status === 'running' || status === 'waiting_approval' || status === 'waiting_user' || status === 'recovering';
}

function normalizeThreadAgePreset(value: string): ThreadAgePreset {
  const v = String(value ?? '').trim();
  if (v === 'older_1d' || v === 'older_1w' || v === 'older_1m') return v;
  return 'all';
}

function threadMatchesAgePreset(thread: ThreadView, preset: ThreadAgePreset, nowUnixMs: number): boolean {
  if (preset === 'all') return true;
  const ts = threadSortTime(thread);
  if (!ts) return false;
  const ageMs = nowUnixMs - ts;
  if (preset === 'older_1d') return ageMs >= 86400000;
  if (preset === 'older_1w') return ageMs >= 7 * 86400000;
  if (preset === 'older_1m') return ageMs >= 30 * 86400000;
  return true;
}

async function requestDeleteThread(threadID: string, force: boolean): Promise<DeleteThreadResult> {
  const tid = String(threadID ?? '').trim();
  if (!tid) throw new Error('missing thread_id');

  const url = `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}${force ? '?force=true' : ''}`;
  const resp = await fetch(url, { method: 'DELETE', credentials: 'omit', cache: 'no-store' });
  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!resp.ok) {
    if (resp.status === 409 && !force) {
      return 'busy';
    }
    throw new Error(String(data?.error ?? `HTTP ${resp.status}`));
  }
  if (data?.ok === false) {
    throw new Error(String(data?.error ?? 'Request failed'));
  }
  return 'deleted';
}

async function loadAllThreads(): Promise<ThreadView[]> {
  const out: ThreadView[] = [];
  const seen = new Set<string>();
  const pageLimit = 200;
  let cursor = '';

  for (let page = 0; page < 50; page += 1) {
    const params = new URLSearchParams();
    params.set('limit', String(pageLimit));
    if (cursor) params.set('cursor', cursor);

    const result = await fetchGatewayJSON<ListThreadsResponse>(`/_redeven_proxy/api/ai/threads?${params.toString()}`, { method: 'GET' });
    const list = Array.isArray(result.threads) ? result.threads : [];

    for (const thread of list) {
      const tid = String(thread.thread_id ?? '').trim();
      if (!tid || seen.has(tid)) continue;
      seen.add(tid);
      out.push(thread);
    }

    const nextCursor = String(result.next_cursor ?? '').trim();
    if (!nextCursor || list.length < pageLimit || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return out;
}

/**
 * AI chat sidebar thread list.
 * Uses floe-webapp SidebarContent as the container with custom thread card rendering.
 */
export function AIChatSidebar() {
  const ctx = useAIChatContext();
  const env = useEnvContext();
  const protocol = useProtocol();
  const notify = useNotification();

  const permissionReady = () => env.env.state === 'ready';
  const canRWX = createMemo(() => hasRWXPermissions(env.env()));
  const canManageChats = createMemo(() => permissionReady() && canRWX());
  const ensureRWX = (): boolean => {
    if (!permissionReady()) {
      notify.error('Not ready', 'Loading environment permissions...');
      return false;
    }
    if (!canRWX()) {
      notify.error('Permission denied', 'Read/write/execute permission required.');
      return false;
    }
    return true;
  };

  // Single delete confirmation dialog state.
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteThreadId, setDeleteThreadId] = createSignal<string | null>(null);
  const [deleteThreadTitle, setDeleteThreadTitle] = createSignal('');
  const [deleteForce, setDeleteForce] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  // Manager dialog state.
  const [managerOpen, setManagerOpen] = createSignal(false);
  const [managerLoading, setManagerLoading] = createSignal(false);
  const [managerError, setManagerError] = createSignal('');
  const [managerThreads, setManagerThreads] = createSignal<ThreadView[]>([]);
  const [managerAgePreset, setManagerAgePreset] = createSignal<ThreadAgePreset>('all');
  const [managerSelection, setManagerSelection] = createSignal<Record<string, true>>({});
  const [managerDeleteConfirmOpen, setManagerDeleteConfirmOpen] = createSignal(false);
  const [managerDeleting, setManagerDeleting] = createSignal(false);
  let managerLoadVersion = 0;

  const openDelete = (threadId: string, title: string) => {
    setDeleteThreadId(threadId);
    setDeleteThreadTitle(String(title ?? '').trim() || 'New chat');
    setDeleteForce(false);
    setDeleteOpen(true);
  };

  const doDelete = async () => {
    const tid = String(deleteThreadId() ?? '').trim();
    if (!tid) return;
    if (!ensureRWX()) return;

    setDeleting(true);
    try {
      const force = deleteForce();
      const result = await requestDeleteThread(tid, force);
      if (result === 'busy') {
        setDeleteForce(true);
        return;
      }

      setDeleteOpen(false);
      setDeleteThreadId(null);
      setDeleteForce(false);

      if (tid === ctx.activeThreadId()) {
        ctx.clearActiveThreadPersistence();
        ctx.enterDraftChat();
      }

      setManagerThreads((prev) => prev.filter((thread) => thread.thread_id !== tid));
      setManagerSelection((prev) => {
        if (!prev[tid]) return prev;
        const next = { ...prev };
        delete next[tid];
        return next;
      });
      ctx.bumpThreadsSeq();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to delete chat', msg || 'Request failed.');
    } finally {
      setDeleting(false);
    }
  };

  const loadManagerThreads = async () => {
    const version = ++managerLoadVersion;
    setManagerLoading(true);
    setManagerError('');

    try {
      const list = await loadAllThreads();
      if (version !== managerLoadVersion) return;

      const sorted = [...list].sort((a, b) => threadSortTime(b) - threadSortTime(a));
      setManagerThreads(sorted);
      setManagerSelection((prev) => {
        const valid = new Set(sorted.map((thread) => thread.thread_id));
        const next: Record<string, true> = {};
        for (const tid of Object.keys(prev)) {
          if (valid.has(tid)) next[tid] = true;
        }
        return next;
      });
    } catch (e) {
      if (version !== managerLoadVersion) return;
      const msg = e instanceof Error ? e.message : String(e);
      setManagerError(msg || 'Request failed.');
    } finally {
      if (version === managerLoadVersion) {
        setManagerLoading(false);
      }
    }
  };

  createEffect(() => {
    if (!managerOpen()) return;
    void loadManagerThreads();
  });

  const openManager = () => {
    setManagerSelection({});
    setManagerAgePreset('all');
    setManagerError('');
    setManagerOpen(true);
  };

  const managerStatusFor = (thread: ThreadView): ThreadRunStatus => {
    if (ctx.isThreadRunning(thread.thread_id)) return 'running';
    return normalizeThreadStatus(thread.run_status);
  };

  const managerFilteredThreads = createMemo(() => {
    const preset = managerAgePreset();
    const list = managerThreads();
    if (preset === 'all') return list;
    const now = Date.now();
    return list.filter((thread) => threadMatchesAgePreset(thread, preset, now));
  });

  const managerSelectedThreads = createMemo(() => {
    const selected = managerSelection();
    return managerThreads().filter((thread) => !!selected[thread.thread_id]);
  });

  const managerSelectedCount = createMemo(() => managerSelectedThreads().length);
  const managerFilteredSelectedCount = createMemo(() => {
    const selected = managerSelection();
    let count = 0;
    for (const thread of managerFilteredThreads()) {
      if (selected[thread.thread_id]) count += 1;
    }
    return count;
  });
  const managerHasFilteredSelection = createMemo(() => managerFilteredSelectedCount() > 0);
  const managerAllFilteredSelected = createMemo(() => {
    const visible = managerFilteredThreads();
    if (visible.length === 0) return false;
    return managerFilteredSelectedCount() === visible.length;
  });
  const managerSelectedRunningCount = createMemo(() => {
    let count = 0;
    for (const thread of managerSelectedThreads()) {
      if (isActiveThreadStatus(managerStatusFor(thread))) count += 1;
    }
    return count;
  });

  const setManagerThreadSelected = (threadID: string, checked: boolean) => {
    const tid = String(threadID ?? '').trim();
    if (!tid) return;
    setManagerSelection((prev) => {
      const next = { ...prev };
      if (checked) {
        next[tid] = true;
      } else {
        delete next[tid];
      }
      return next;
    });
  };

  const setFilteredThreadsSelected = (checked: boolean) => {
    const visibleIDs = managerFilteredThreads().map((thread) => thread.thread_id);
    if (visibleIDs.length === 0) return;

    setManagerSelection((prev) => {
      const next = { ...prev };
      for (const tid of visibleIDs) {
        if (checked) {
          next[tid] = true;
        } else {
          delete next[tid];
        }
      }
      return next;
    });
  };

  const clearManagerSelection = () => {
    setManagerSelection({});
  };

  const doBulkDelete = async () => {
    const targets = managerSelectedThreads();
    if (targets.length === 0) {
      setManagerDeleteConfirmOpen(false);
      return;
    }
    if (!ensureRWX()) {
      setManagerDeleteConfirmOpen(false);
      return;
    }

    setManagerDeleting(true);
    try {
      let deleted = 0;
      let forced = 0;
      let failed = 0;
      const deletedIDs = new Set<string>();

      for (const thread of targets) {
        const tid = String(thread.thread_id ?? '').trim();
        if (!tid) continue;

        try {
          const result = await requestDeleteThread(tid, false);
          if (result === 'busy') {
            await requestDeleteThread(tid, true);
            forced += 1;
          }
          deleted += 1;
          deletedIDs.add(tid);
        } catch {
          failed += 1;
        }
      }

      if (deletedIDs.size > 0) {
        const activeID = String(ctx.activeThreadId() ?? '').trim();
        if (activeID && deletedIDs.has(activeID)) {
          ctx.clearActiveThreadPersistence();
          ctx.enterDraftChat();
        }

        setManagerThreads((prev) => prev.filter((thread) => !deletedIDs.has(thread.thread_id)));
        setManagerSelection((prev) => {
          const next = { ...prev };
          for (const tid of deletedIDs) {
            delete next[tid];
          }
          return next;
        });
        ctx.bumpThreadsSeq();
      }

      if (failed === 0) {
        const details = forced > 0
          ? `Deleted ${deleted} chats. ${forced} running chats were force deleted.`
          : `Deleted ${deleted} chats.`;
        notify.success('Chats deleted', details);
        setManagerDeleteConfirmOpen(false);
      } else {
        notify.error('Some chats were not deleted', `${deleted} deleted, ${failed} failed.`);
      }
    } finally {
      setManagerDeleting(false);
    }
  };

  const threadList = createMemo(() => ctx.threads()?.threads ?? []);
  const groupedThreads = createMemo(() => groupThreadsByDate(threadList()));
  const showGroupHeaders = createMemo(() => threadList().length >= 5);
  const hasThreadSnapshot = createMemo(() => ctx.threads() != null);
  const showInitialLoading = createMemo(() => ctx.threads.loading && !hasThreadSnapshot());
  const showThreadsError = createMemo(() => !!ctx.threads.error && !hasThreadSnapshot());

  return (
    <SidebarContent>
      {/* Top action buttons */}
      <div class="px-1 pb-1 flex items-center gap-1">
        <Button
          variant="primary"
          size="sm"
          class="flex-1 justify-start gap-2 h-8 shadow-sm"
          icon={Plus}
          onClick={() => ctx.enterDraftChat()}
          disabled={protocol.status() !== 'connected' || !canManageChats()}
        >
          New Chat
        </Button>
        <Tooltip content="Manage chats" placement="bottom" delay={0}>
          <Button
            variant="outline"
            size="icon"
            class="h-8 w-8 border-sidebar-border/60 bg-sidebar hover:bg-sidebar-accent/60 text-sidebar-foreground/80 hover:text-sidebar-foreground transition-all duration-150"
            onClick={openManager}
            disabled={protocol.status() !== 'connected' || !canManageChats()}
            aria-label="Manage chats"
          >
            <History class="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
      </div>

      <Show
        when={!showInitialLoading()}
        fallback={
          <div class="px-2.5 py-2 text-xs text-muted-foreground flex items-center gap-2">
            <SnakeLoader size="sm" />
            <span>Loading chats...</span>
          </div>
        }
      >
        <Show
          when={!showThreadsError()}
          fallback={
            <div class="px-2.5 py-2 text-xs text-error">
              {ctx.threads.error instanceof Error ? ctx.threads.error.message : String(ctx.threads.error)}
            </div>
          }
        >
          <Show
            when={threadList().length > 0}
            fallback={<EmptyState />}
          >
            <SidebarSection title="Conversations">
              <div class="flex flex-col gap-0.5">
                <Index each={groupedThreads()}>
                  {(groupAccessor) => {
                    const group = () => groupAccessor();
                    return (
                      <>
                        <Show when={showGroupHeaders()}>
                          <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40 px-2.5 pt-3 pb-1 select-none">
                            {group().group}
                          </div>
                        </Show>
                        <Index each={group().threads}>
                          {(threadAccessor) => {
                            const thread = () => threadAccessor();
                            const threadID = () => thread().thread_id;
                            return (
                              <ThreadCard
                                thread={thread()}
                                active={threadID() === ctx.activeThreadId()}
                                isRunning={ctx.isThreadRunning(threadID())}
                                connected={protocol.status() === 'connected'}
                                canDelete={canManageChats()}
                                onClick={() => ctx.selectThreadId(threadID())}
                                onDelete={() => openDelete(threadID(), thread().title)}
                              />
                            );
                          }}
                        </Index>
                      </>
                    );
                  }}
                </Index>
              </div>
            </SidebarSection>
          </Show>
        </Show>
      </Show>

      {/* Chat manager dialog */}
      <Dialog
        open={managerOpen()}
        onOpenChange={(open) => {
          if (!open) {
            setManagerDeleteConfirmOpen(false);
          }
          setManagerOpen(open);
        }}
        title="Manage chats"
        description="View all conversations, filter by age, and delete in batches."
        class="max-w-5xl h-[78vh] max-h-[78vh]"
        footer={
          <div class="w-full flex flex-wrap items-center justify-between gap-2">
            <div class="text-xs text-muted-foreground">
              {managerSelectedCount()} selected
            </div>
            <div class="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                icon={Refresh}
                onClick={() => void loadManagerThreads()}
                disabled={managerLoading() || managerDeleting()}
              >
                Refresh
              </Button>
              <Button
                size="sm"
                variant="destructive"
                icon={Trash}
                onClick={() => setManagerDeleteConfirmOpen(true)}
                disabled={managerSelectedCount() === 0 || managerDeleting() || protocol.status() !== 'connected'}
              >
                Delete Selected
              </Button>
            </div>
          </div>
        }
      >
        <div class="h-full min-h-0 flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <SegmentedControl
              value={managerAgePreset()}
              onChange={(value) => setManagerAgePreset(normalizeThreadAgePreset(value))}
              size="sm"
              options={[
                { value: 'all', label: 'All' },
                { value: 'older_1d', label: '1d+' },
                { value: 'older_1w', label: '1w+' },
                { value: 'older_1m', label: '1m+' },
              ]}
            />
            <Button
              size="xs"
              variant="outline"
              onClick={() => setFilteredThreadsSelected(true)}
              disabled={managerFilteredThreads().length === 0 || managerLoading()}
            >
              Select Filtered
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={clearManagerSelection}
              disabled={managerSelectedCount() === 0}
            >
              Clear Selection
            </Button>
            <div class="ml-auto text-xs text-muted-foreground">
              {managerFilteredThreads().length} shown / {managerThreads().length} total
            </div>
          </div>

          <div class="rounded-md border border-border/70 overflow-hidden flex-1 min-h-0">
            <Show
              when={!managerLoading()}
              fallback={
                <div class="px-3 py-5 text-xs text-muted-foreground flex items-center gap-2">
                  <SnakeLoader size="sm" />
                  <span>Loading chats...</span>
                </div>
              }
            >
              <Show
                when={!managerError()}
                fallback={<div class="px-3 py-4 text-xs text-error break-words">{managerError()}</div>}
              >
                <Show
                  when={managerThreads().length > 0}
                  fallback={<div class="px-3 py-6 text-xs text-muted-foreground">No chats found.</div>}
                >
                  <Show
                    when={managerFilteredThreads().length > 0}
                    fallback={<div class="px-3 py-6 text-xs text-muted-foreground">No chats match this filter.</div>}
                  >
                    <div class="h-full overflow-auto">
                      <table class="w-full table-fixed text-xs">
                        <thead class="sticky top-0 bg-card/95 backdrop-blur-sm text-muted-foreground">
                          <tr class="text-left border-b border-border/70">
                            <th class="w-10 py-2 pl-3 pr-2">
                              <Checkbox
                                checked={managerAllFilteredSelected()}
                                indeterminate={!managerAllFilteredSelected() && managerHasFilteredSelection()}
                                onChange={(checked) => setFilteredThreadsSelected(checked)}
                                disabled={managerFilteredThreads().length === 0}
                              />
                            </th>
                            <th class="w-[52%] py-2 pr-3">Title</th>
                            <th class="w-32 py-2 pr-3">Status</th>
                            <th class="w-44 py-2 pr-3">Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={managerFilteredThreads()}>
                            {(thread) => {
                              const threadID = thread.thread_id;
                              const selected = () => !!managerSelection()[threadID];
                              const status = () => managerStatusFor(thread);
                              const title = () => thread.title?.trim() || 'New chat';
                              const preview = () => thread.last_message_preview?.trim() || '';

                              return (
                                <tr class={`border-b border-border/50 last:border-b-0 ${selected() ? 'bg-muted/40' : ''}`}>
                                  <td class="py-2.5 pl-3 pr-2 align-top">
                                    <Checkbox
                                      checked={selected()}
                                      onChange={(checked) => setManagerThreadSelected(threadID, checked)}
                                    />
                                  </td>
                                  <td class="w-[52%] py-2.5 pr-3 align-top">
                                    <div class="min-w-0 max-w-full">
                                      <div class="flex items-center gap-2 min-w-0">
                                        <button
                                          type="button"
                                          class="block w-full text-xs font-medium truncate text-left hover:underline"
                                          onClick={() => {
                                            ctx.selectThreadId(threadID);
                                            setManagerOpen(false);
                                          }}
                                          title={title()}
                                        >
                                          {title()}
                                        </button>
                                        <Show when={threadID === ctx.activeThreadId()}>
                                          <span class="text-[10px] rounded border border-primary/30 bg-primary/10 text-primary px-1.5 py-0.5">
                                            Active
                                          </span>
                                        </Show>
                                      </div>
                                      <Show when={!!preview()}>
                                        <p class="text-[11px] text-muted-foreground/70 truncate mt-0.5">{preview()}</p>
                                      </Show>
                                    </div>
                                  </td>
                                  <td class="py-2.5 pr-3 align-top">
                                    <div class="inline-flex items-center gap-1.5 text-muted-foreground">
                                      <span class={`w-1.5 h-1.5 rounded-full ${statusDotClass(status())}`} />
                                      <span>{statusLabel(status()) || 'Idle'}</span>
                                    </div>
                                  </td>
                                  <td class="py-2.5 pr-3 align-top text-muted-foreground whitespace-nowrap">
                                    {fmtDetailTime(threadSortTime(thread))}
                                  </td>
                                </tr>
                              );
                            }}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </Show>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </Dialog>

      {/* Batch delete confirmation */}
      <ConfirmDialog
        open={managerDeleteConfirmOpen()}
        onOpenChange={(open) => {
          if (!open) {
            setManagerDeleteConfirmOpen(false);
            return;
          }
          if (managerSelectedCount() > 0) {
            setManagerDeleteConfirmOpen(true);
          }
        }}
        title="Delete Selected Chats"
        confirmText={`Delete ${managerSelectedCount()} Chat${managerSelectedCount() === 1 ? '' : 's'}`}
        variant="destructive"
        loading={managerDeleting()}
        onConfirm={() => void doBulkDelete()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            Delete <span class="font-semibold">{managerSelectedCount()} selected chats</span>?
          </p>
          <Show when={managerSelectedRunningCount() > 0}>
            <p class="text-xs text-muted-foreground">
              {managerSelectedRunningCount()} running chats will be force deleted.
            </p>
          </Show>
          <p class="text-xs text-muted-foreground">This cannot be undone.</p>
        </div>
      </ConfirmDialog>

      {/* Single delete confirmation dialog */}
      <ConfirmDialog
        open={deleteOpen()}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteOpen(false);
            setDeleteThreadId(null);
            setDeleteThreadTitle('');
            setDeleteForce(false);
            return;
          }
          setDeleteOpen(true);
        }}
        title="Delete Chat"
        confirmText={deleteForce() ? 'Force Delete' : 'Delete'}
        variant="destructive"
        loading={deleting()}
        onConfirm={() => void doDelete()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            Delete <span class="font-semibold">"{deleteThreadTitle()}"</span>?
          </p>
          <Show when={deleteForce()}>
            <p class="text-xs text-muted-foreground">
              This chat is running. Deleting will stop the run and delete the thread.
            </p>
          </Show>
          <p class="text-xs text-muted-foreground">This cannot be undone.</p>
        </div>
      </ConfirmDialog>
    </SidebarContent>
  );
}

// ---- Thread card component ----

function ThreadCard(props: {
  thread: ThreadView;
  active: boolean;
  isRunning: boolean;
  connected: boolean;
  canDelete: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const status = (): ThreadRunStatus => {
    if (props.isRunning) return 'running';
    const raw = String(props.thread.run_status ?? '').trim().toLowerCase();
    if (
      raw === 'accepted' ||
      raw === 'running' ||
      raw === 'waiting_approval' ||
      raw === 'recovering' ||
      raw === 'waiting_user' ||
      raw === 'success' ||
      raw === 'failed' ||
      raw === 'canceled' ||
      raw === 'timed_out'
    ) {
      return raw as ThreadRunStatus;
    }
    return 'idle';
  };

  const title = () => props.thread.title?.trim() || 'New chat';
  const preview = () => props.thread.last_message_preview?.trim() || '';
  const timeStr = () => fmtShortTime(props.thread.updated_at_unix_ms);

  return (
    <button
      type="button"
      class={`group relative flex items-start gap-2 w-full rounded-lg px-2.5 py-2 text-left transition-all duration-150 cursor-pointer border ${
        props.active
          ? 'bg-sidebar-accent text-sidebar-foreground border-border/20 shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
          : 'text-sidebar-foreground/80 border-transparent hover:bg-sidebar-accent/60 hover:border-border/15 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
      }`}
      onClick={props.onClick}
    >
      {/* Left accent bar */}
      <Show when={props.active}>
        <div class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary" />
      </Show>

      {/* Status dot */}
      <div class="relative mt-1.5 shrink-0">
        <div
          class={`w-2 h-2 rounded-full ${statusDotClass(status())}`}
          title={statusLabel(status())}
        />
        {/* Running pulse animation */}
        <Show when={status() === 'running'}>
          <div class="absolute inset-0 w-2 h-2 rounded-full bg-primary/50 animate-pulse" />
        </Show>
      </div>

      {/* Content area */}
      <div class="flex flex-col gap-0.5 min-w-0 flex-1">
        {/* Title row */}
        <div class="flex items-center gap-1">
          <span class="text-xs font-medium truncate flex-1">{title()}</span>
          {/* Timestamp / switches to delete button on hover (opacity avoids layout jump). */}
          <div class="shrink-0 w-5 h-5 flex items-center justify-center relative">
            <Show
              when={props.canDelete}
              fallback={
                <span class="text-[10px] text-muted-foreground/60 pointer-events-none select-none">
                  {timeStr()}
                </span>
              }
            >
              <span class="text-[10px] text-muted-foreground/60 transition-opacity duration-150 group-hover:opacity-0 pointer-events-none select-none">
                {timeStr()}
              </span>
              <div
                role="button"
                tabIndex={0}
                class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded text-muted-foreground/60 hover:text-error hover:bg-error/10 transition-all duration-150 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (props.connected) props.onDelete();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    if (props.connected) props.onDelete();
                  }
                }}
                title="Delete chat"
              >
                <X class="w-3.5 h-3.5" />
              </div>
            </Show>
          </div>
        </div>

        {/* Preview text / running state */}
        <Show when={status() === 'running'} fallback={
          <Show when={!!preview()}>
            <p class="text-[11px] text-muted-foreground/50 truncate leading-tight">{preview()}</p>
          </Show>
        }>
          <ProcessingIndicator variant="minimal" status="Working" class="h-3.5" />
        </Show>
      </div>
    </button>
  );
}

// ---- Empty state ----

function EmptyState() {
  return (
    <div class="px-2.5 py-8 text-center">
      {/* Icon container */}
      <Motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, easing: 'ease-out' }}
        class="relative w-14 h-14 rounded-2xl bg-sidebar-accent/80 flex items-center justify-center mx-auto mb-3"
      >
        <FlowerIcon class="w-7 h-7" />
        {/* Sparkles decoration */}
        <Motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.3, easing: 'ease-out' }}
          class="absolute -top-1 -right-1"
        >
          <Sparkles class="w-4 h-4 text-primary/60" />
        </Motion.div>
      </Motion.div>

      {/* Text */}
      <Motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2, easing: 'ease-out' }}
      >
        <p class="text-xs font-medium text-muted-foreground/70">No conversations yet</p>
        <p class="text-[11px] text-muted-foreground/40 mt-1">Start a new chat to begin</p>
      </Motion.div>
    </div>
  );
}
