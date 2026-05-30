import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Copy, History, Plus, Refresh, Trash, X } from '@floegence/floe-webapp-core/icons';
import { FlowerSoftAuraIcon } from '../icons/FlowerSoftAuraIcon';
import { useNotification } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { SidebarContent, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, Checkbox, ConfirmDialog, Dialog, ProcessingIndicator, SegmentedControl } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { Motion } from 'solid-motionone';
import { fetchGatewayJSON, prepareGatewayRequestInit } from '../services/gatewayApi';
import { Tooltip } from '../primitives/Tooltip';
import { useAIChatContext, type ListThreadsResponse, type ThreadRunStatus, type ThreadView } from './AIChatContext';
import { useEnvContext } from './EnvContext';
import { hasRWXPermissions } from './aiPermissions';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { FloatingContextMenu, type FloatingContextMenuItem } from '../widgets/FloatingContextMenu';
import { writeTextToClipboard } from '../utils/clipboard';
import { useI18n, type I18nHelpers } from '../i18n';
import { projectFlowerThreadListItem } from '../flower/threadList';
import type { FlowerThreadListItem } from '../flower/contracts';

const THREAD_RAIL_CONTENT_CLASS = 'flex h-full min-h-0 flex-col overflow-hidden';
const THREAD_RAIL_SECTION_CLASS = 'min-h-0 flex flex-1 flex-col overflow-hidden [&>div:last-child]:flex [&>div:last-child]:min-h-0 [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:overflow-hidden';
const THREAD_RAIL_SCROLL_CLASS = 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch] [touch-action:pan-y_pinch-zoom]';

// Compact timestamp for the right side of each thread card.
function fmtShortTime(ms: number, i18n: I18nHelpers): string {
  if (!ms) return '';
  try {
    const now = Date.now();
    const diff = now - ms;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) {
      return i18n.formatDateTime(ms, { month: 'numeric', day: 'numeric' });
    }
    if (days > 0) return i18n.t('flowerChat.sidebar.time.days', { count: days });
    if (hours > 0) return i18n.t('flowerChat.sidebar.time.hours', { count: hours });
    if (minutes > 0) return i18n.t('flowerChat.sidebar.time.minutes', { count: minutes });
    return i18n.t('flowerChat.sidebar.time.now');
  } catch {
    return '';
  }
}

// Full timestamp used by the management dialog table.
function fmtDetailTime(ms: number, i18n: I18nHelpers): string {
  if (!ms) return i18n.t('flowerChat.sidebar.time.empty');
  try {
    return i18n.formatDateTime(ms, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return i18n.t('flowerChat.sidebar.time.empty');
  }
}

// Time group type.
type TimeGroup = 'today' | 'yesterday' | 'this_week' | 'older';

type ThreadAgePreset = 'all' | 'older_1d' | 'older_1w' | 'older_1m';
type DeleteThreadResult = 'deleted' | 'busy';

// Group threads by date (only when total count >= 5).
function groupThreadsByDate(threads: ThreadView[]): { group: TimeGroup; threads: ThreadView[] }[] {
  if (threads.length < 5) {
    return [{ group: 'today' as TimeGroup, threads }];
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  // Start of this week (Monday).
  const dayOfWeek = now.getDay();
  const weekStart = todayStart - ((dayOfWeek === 0 ? 6 : dayOfWeek - 1) * 86400000);

  const groups: Record<TimeGroup, ThreadView[]> = {
    today: [],
    yesterday: [],
    this_week: [],
    older: [],
  };

  for (const t of threads) {
    const ts = threadSortTime(t);
    if (ts >= todayStart) {
      groups.today.push(t);
    } else if (ts >= yesterdayStart) {
      groups.yesterday.push(t);
    } else if (ts >= weekStart) {
      groups.this_week.push(t);
    } else {
      groups.older.push(t);
    }
  }

  const order: TimeGroup[] = ['today', 'yesterday', 'this_week', 'older'];
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
    case 'finalizing':
      return 'bg-indigo-500';
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
function statusLabel(status: ThreadRunStatus, i18n: I18nHelpers): string {
  switch (status) {
    case 'accepted': return i18n.t('flowerChat.sidebar.status.queued');
    case 'running': return i18n.t('flowerChat.sidebar.status.running');
    case 'waiting_approval': return i18n.t('flowerChat.sidebar.status.waitingApproval');
    case 'waiting_user': return i18n.t('flowerChat.sidebar.status.waitingInput');
    case 'recovering': return i18n.t('flowerChat.sidebar.status.recovering');
    case 'finalizing': return i18n.t('flowerChat.sidebar.status.finalizing');
    case 'success': return i18n.t('flowerChat.sidebar.status.done');
    case 'failed': return i18n.t('flowerChat.sidebar.status.failed');
    case 'timed_out': return i18n.t('flowerChat.sidebar.status.timedOut');
    case 'canceled': return i18n.t('flowerChat.sidebar.status.canceled');
    default: return '';
  }
}

function timeGroupLabel(group: TimeGroup, i18n: I18nHelpers): string {
  switch (group) {
    case 'today':
      return i18n.t('flowerChat.sidebar.groups.today');
    case 'yesterday':
      return i18n.t('flowerChat.sidebar.groups.yesterday');
    case 'this_week':
      return i18n.t('flowerChat.sidebar.groups.thisWeek');
    case 'older':
      return i18n.t('flowerChat.sidebar.groups.older');
    default:
      return '';
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
    status === 'finalizing' ||
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
  return status === 'accepted' || status === 'running' || status === 'waiting_approval' || status === 'waiting_user' || status === 'recovering' || status === 'finalizing';
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
  const resp = await fetch(url, await prepareGatewayRequestInit({ method: 'DELETE' }));
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
  const i18n = useI18n();

  const permissionReady = () => env.env.state === 'ready';
  const canRWX = createMemo(() => hasRWXPermissions(env.env()));
  const canManageChats = createMemo(() => permissionReady() && canRWX());
  const canOpenFlowerChats = createMemo(() => protocol.status() === 'connected');
  const ensureRWX = (): boolean => {
    if (!permissionReady()) {
      notify.error(i18n.t('shell.notifications.notReadyTitle'), i18n.t('shell.notifications.loadingEnvironmentPermissions'));
      return false;
    }
    if (!canRWX()) {
      notify.error(i18n.t('shell.notifications.permissionDeniedTitle'), i18n.t('shell.notifications.rwxPermissionRequired'));
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
  const [threadContextMenu, setThreadContextMenu] = createSignal<{
    x: number;
    y: number;
    thread: ThreadView;
  } | null>(null);
  let threadContextMenuEl: HTMLDivElement | null = null;
  let managerLoadVersion = 0;

  const openDelete = (threadId: string, title: string) => {
    setDeleteThreadId(threadId);
    setDeleteThreadTitle(String(title ?? '').trim() || i18n.t('flowerChat.sidebar.untitledChat'));
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
      notify.error(i18n.t('flowerChat.sidebar.delete.failedTitle'), msg || i18n.t('flowerChat.errors.requestFailed'));
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
      setManagerError(msg || i18n.t('flowerChat.errors.requestFailed'));
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

  createEffect(() => {
    const menu = threadContextMenu();
    if (!menu) return;

    const closeMenu = () => setThreadContextMenu(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && threadContextMenuEl?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', onKeyDown);
    });
  });

  const openManager = () => {
    setManagerSelection({});
    setManagerAgePreset('all');
    setManagerError('');
    setManagerOpen(true);
  };

  const openThreadContextMenu = (event: MouseEvent, thread: ThreadView) => {
    event.preventDefault();
    event.stopPropagation();

    setThreadContextMenu({
      x: event.clientX,
      y: event.clientY,
      thread,
    });
  };

  const copyThreadContextValue = async (label: string, value: string | null | undefined) => {
    const text = String(value ?? '').trim();
    setThreadContextMenu(null);
    if (!text) {
      notify.error(
        i18n.t('flowerChat.sidebar.contextMenu.copyFailedTitle'),
        i18n.t('flowerChat.sidebar.contextMenu.unavailable', { label }),
      );
      return;
    }

    try {
      await writeTextToClipboard(text);
      notify.success(
        i18n.t('flowerChat.sidebar.contextMenu.copiedTitle'),
        i18n.t('flowerChat.sidebar.contextMenu.copied', { label }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify.error(
        i18n.t('flowerChat.sidebar.contextMenu.copyFailedTitle'),
        message || i18n.t('flowerChat.sidebar.contextMenu.clipboardCopyFailed'),
      );
    }
  };

  const buildThreadContextMenuItems = (menu: NonNullable<ReturnType<typeof threadContextMenu>>): FloatingContextMenuItem[] => [
    {
      id: 'copy-thread-id',
      kind: 'action',
      label: i18n.t('flowerChat.sidebar.contextMenu.copyThreadId'),
      icon: Copy,
      onSelect: () => {
        void copyThreadContextValue(i18n.t('flowerChat.sidebar.contextMenu.threadIdLabel'), menu.thread.thread_id);
      },
    },
    {
      id: 'copy-working-directory',
      kind: 'action',
      label: i18n.t('flowerChat.sidebar.contextMenu.copyWorkingDirectory'),
      icon: Copy,
      disabled: !String(menu.thread.working_dir ?? '').trim(),
      onSelect: () => {
        void copyThreadContextValue(i18n.t('flowerChat.sidebar.contextMenu.workingDirectoryLabel'), menu.thread.working_dir);
      },
    },
  ];

  const managerStatusFor = (thread: ThreadView): ThreadRunStatus => {
    const persisted = normalizeThreadStatus(thread.run_status);
    if (!ctx.isThreadRunning(thread.thread_id)) return persisted;
    if (persisted === 'accepted' || persisted === 'waiting_approval' || persisted === 'recovering' || persisted === 'finalizing') {
      return persisted;
    }
    return 'running';
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
          ? i18n.t('flowerChat.sidebar.bulkDelete.deletedWithForcedDetails', { deleted, forced })
          : i18n.tn('flowerChat.sidebar.bulkDelete.deletedDetails', deleted);
        notify.success(i18n.t('flowerChat.sidebar.bulkDelete.deletedTitle'), details);
        setManagerDeleteConfirmOpen(false);
      } else {
        notify.error(
          i18n.t('flowerChat.sidebar.bulkDelete.someFailedTitle'),
          i18n.t('flowerChat.sidebar.bulkDelete.partialFailed', { deleted, failed }),
        );
      }
    } finally {
      setManagerDeleting(false);
    }
  };

  const threadList = createMemo(() => ctx.threads()?.threads ?? []);
  const flowerThreadById = createMemo(() => {
    const currentEnvPublicId = String(env.env_id() ?? '').trim();
    return new Map(threadList().map((thread) => [
      String(thread.thread_id ?? '').trim(),
      projectFlowerThreadListItem(thread, { currentEnvPublicId }),
    ]));
  });
  const groupedThreads = createMemo(() => groupThreadsByDate(threadList()));
  const showGroupHeaders = createMemo(() => threadList().length >= 5);
  const hasThreadSnapshot = createMemo(() => ctx.threads() != null);
  const showInitialLoading = createMemo(() => ctx.threads.loading && !hasThreadSnapshot());
  const showThreadsError = createMemo(() => !!ctx.threads.error && !hasThreadSnapshot());

  return (
    <>
      <SidebarContent class={THREAD_RAIL_CONTENT_CLASS}>
        {/* Top action buttons */}
        <div class="shrink-0 px-1 pb-1 flex items-center gap-1">
          <Button
            variant="primary"
            size="sm"
            class="flex-1 justify-start gap-2 h-8 shadow-sm"
            icon={Plus}
            onClick={() => ctx.enterDraftChat()}
            disabled={!canOpenFlowerChats()}
          >
            {i18n.t('flowerChat.sidebar.newChat')}
          </Button>
          <Tooltip content={i18n.t('flowerChat.sidebar.manageChats')} placement="bottom" delay={0}>
            <Button
              variant="outline"
              size="icon"
              class="h-8 w-8 border-sidebar-border/60 bg-sidebar hover:bg-sidebar-accent/60 text-sidebar-foreground/80 hover:text-sidebar-foreground transition-all duration-150"
              onClick={openManager}
              disabled={!canOpenFlowerChats()}
              aria-label={i18n.t('flowerChat.sidebar.manageChats')}
            >
              <History class="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        </div>

        <div class="min-h-0 flex flex-1 flex-col overflow-hidden">
          <Show
            when={!showInitialLoading()}
            fallback={
              <div class="px-2.5 py-2 text-xs text-muted-foreground flex items-center gap-2">
                <SnakeLoader size="sm" />
                <span>{i18n.t('flowerChat.sidebar.loadingChats')}</span>
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
                fallback={<EmptyState i18n={i18n} />}
              >
                <SidebarSection title={i18n.t('flowerChat.sidebar.conversations')} class={THREAD_RAIL_SECTION_CLASS}>
                  <div
                    {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
                    data-testid="flower-thread-scroll-region"
                    class={THREAD_RAIL_SCROLL_CLASS}
                  >
                    <div class="flex flex-col gap-0.5">
                      <Index each={groupedThreads()}>
                        {(groupAccessor) => {
                          const group = () => groupAccessor();
                          return (
                            <>
                              <Show when={showGroupHeaders()}>
                                <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40 px-2.5 pt-3 pb-1 select-none">
                                  {timeGroupLabel(group().group, i18n)}
                                </div>
                              </Show>
                              <Index each={group().threads}>
                                {(threadAccessor) => {
                                  const thread = () => threadAccessor();
                                  const threadID = () => thread().thread_id;
                                  return (
                                    <ThreadCard
                                      thread={thread()}
                                      flowerThread={flowerThreadById().get(threadID())}
                                      active={threadID() === ctx.activeThreadId()}
                                      isRunning={ctx.isThreadRunning(threadID())}
                                      unread={ctx.isThreadUnread(threadID())}
                                      connected={protocol.status() === 'connected'}
                                      canDelete={canManageChats()}
                                      i18n={i18n}
                                      onClick={() => {
                                        setThreadContextMenu(null);
                                        ctx.selectThreadId(threadID());
                                      }}
                                      onContextMenu={(event) => openThreadContextMenu(event, thread())}
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
                  </div>
                </SidebarSection>
              </Show>
            </Show>
          </Show>
        </div>
      </SidebarContent>

      {/* Chat manager dialog */}
      <Dialog
        open={managerOpen()}
        onOpenChange={(open) => {
          if (!open) {
            setManagerDeleteConfirmOpen(false);
          }
          setManagerOpen(open);
        }}
        title={i18n.t('flowerChat.sidebar.manager.title')}
        description={i18n.t('flowerChat.sidebar.manager.description')}
        class="max-w-5xl h-[78vh] max-h-[78vh]"
        footer={
          <div class="w-full flex flex-wrap items-center justify-between gap-2">
            <div class="text-xs text-muted-foreground">
              {i18n.tn('flowerChat.sidebar.manager.selectedCount', managerSelectedCount())}
            </div>
            <div class="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                icon={Refresh}
                onClick={() => void loadManagerThreads()}
                disabled={managerLoading() || managerDeleting()}
              >
                {i18n.t('flowerChat.sidebar.manager.refresh')}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                icon={Trash}
                onClick={() => setManagerDeleteConfirmOpen(true)}
                disabled={managerSelectedCount() === 0 || managerDeleting() || protocol.status() !== 'connected'}
              >
                {i18n.t('flowerChat.sidebar.manager.deleteSelected')}
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
                { value: 'all', label: i18n.t('flowerChat.sidebar.manager.filter.all') },
                { value: 'older_1d', label: i18n.t('flowerChat.sidebar.manager.filter.olderOneDay') },
                { value: 'older_1w', label: i18n.t('flowerChat.sidebar.manager.filter.olderOneWeek') },
                { value: 'older_1m', label: i18n.t('flowerChat.sidebar.manager.filter.olderOneMonth') },
              ]}
            />
            <Button
              size="xs"
              variant="outline"
              onClick={() => setFilteredThreadsSelected(true)}
              disabled={managerFilteredThreads().length === 0 || managerLoading()}
            >
              {i18n.t('flowerChat.sidebar.manager.selectFiltered')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={clearManagerSelection}
              disabled={managerSelectedCount() === 0}
            >
              {i18n.t('flowerChat.sidebar.manager.clearSelection')}
            </Button>
            <div class="ml-auto text-xs text-muted-foreground">
              {i18n.t('flowerChat.sidebar.manager.shownTotal', {
                shown: i18n.formatNumber(managerFilteredThreads().length),
                total: i18n.formatNumber(managerThreads().length),
              })}
            </div>
          </div>

          <div class="rounded-md border border-border/70 overflow-hidden flex-1 min-h-0">
            <Show
              when={!managerLoading()}
              fallback={
                <div class="px-3 py-5 text-xs text-muted-foreground flex items-center gap-2">
                  <SnakeLoader size="sm" />
                  <span>{i18n.t('flowerChat.sidebar.loadingChats')}</span>
                </div>
              }
            >
              <Show
                when={!managerError()}
                fallback={<div class="px-3 py-4 text-xs text-error break-words">{managerError()}</div>}
              >
                <Show
                  when={managerThreads().length > 0}
                  fallback={<div class="px-3 py-6 text-xs text-muted-foreground">{i18n.t('flowerChat.sidebar.manager.noChats')}</div>}
                >
                  <Show
                    when={managerFilteredThreads().length > 0}
                    fallback={<div class="px-3 py-6 text-xs text-muted-foreground">{i18n.t('flowerChat.sidebar.manager.noFilterMatches')}</div>}
                  >
                    <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="h-full overflow-auto">
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
                            <th class="w-[52%] py-2 pr-3">{i18n.t('flowerChat.sidebar.manager.tableTitle')}</th>
                            <th class="w-32 py-2 pr-3">{i18n.t('flowerChat.sidebar.manager.tableStatus')}</th>
                            <th class="w-44 py-2 pr-3">{i18n.t('flowerChat.sidebar.manager.tableUpdated')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={managerFilteredThreads()}>
                            {(thread) => {
                              const threadID = thread.thread_id;
                              const selected = () => !!managerSelection()[threadID];
                              const status = () => managerStatusFor(thread);
                              const title = () => thread.title?.trim() || i18n.t('flowerChat.sidebar.untitledChat');
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
                                            {i18n.t('flowerChat.sidebar.manager.active')}
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
                                      <span>{statusLabel(status(), i18n) || i18n.t('flowerChat.sidebar.status.idle')}</span>
                                    </div>
                                  </td>
                                  <td class="py-2.5 pr-3 align-top text-muted-foreground whitespace-nowrap">
                                    {fmtDetailTime(threadSortTime(thread), i18n)}
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
        title={i18n.t('flowerChat.sidebar.bulkDelete.title')}
        confirmText={i18n.tn('flowerChat.sidebar.bulkDelete.confirm', managerSelectedCount())}
        variant="destructive"
        loading={managerDeleting()}
        onConfirm={() => void doBulkDelete()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            {i18n.tn('flowerChat.sidebar.bulkDelete.prompt', managerSelectedCount())}
          </p>
          <Show when={managerSelectedRunningCount() > 0}>
            <p class="text-xs text-muted-foreground">
              {i18n.tn('flowerChat.sidebar.bulkDelete.runningWarning', managerSelectedRunningCount())}
            </p>
          </Show>
          <p class="text-xs text-muted-foreground">{i18n.t('flowerChat.sidebar.delete.cannotUndo')}</p>
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
        title={i18n.t('flowerChat.sidebar.delete.title')}
        confirmText={deleteForce() ? i18n.t('flowerChat.sidebar.delete.forceConfirm') : i18n.t('flowerChat.sidebar.delete.confirm')}
        variant="destructive"
        loading={deleting()}
        onConfirm={() => void doDelete()}
      >
        <div class="space-y-2">
          <p class="text-sm">
            {i18n.t('flowerChat.sidebar.delete.prompt', { title: deleteThreadTitle() })}
          </p>
          <Show when={deleteForce()}>
            <p class="text-xs text-muted-foreground">
              {i18n.t('flowerChat.sidebar.delete.runningWarning')}
            </p>
          </Show>
          <p class="text-xs text-muted-foreground">{i18n.t('flowerChat.sidebar.delete.cannotUndo')}</p>
        </div>
      </ConfirmDialog>

      <Show when={threadContextMenu()} keyed>
        {(menu) => (
          <FloatingContextMenu
            x={menu.x}
            y={menu.y}
            items={buildThreadContextMenuItems(menu)}
            menuRef={(el) => {
              threadContextMenuEl = el;
            }}
          />
        )}
      </Show>
    </>
  );
}

// ---- Thread card component ----

function ThreadCard(props: {
  thread: ThreadView;
  flowerThread?: FlowerThreadListItem;
  active: boolean;
  isRunning: boolean;
  unread: boolean;
  connected: boolean;
  canDelete: boolean;
  i18n: I18nHelpers;
  onClick: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onDelete: () => void;
}) {
  const status = (): ThreadRunStatus => {
    const persisted = normalizeThreadStatus(props.thread.run_status);
    if (!props.isRunning) return persisted;
    if (persisted === 'accepted' || persisted === 'waiting_approval' || persisted === 'recovering' || persisted === 'finalizing') {
      return persisted;
    }
    return 'running';
  };

  const title = () => props.thread.title?.trim() || props.i18n.t('flowerChat.sidebar.untitledChat');
  const preview = () => props.thread.last_message_preview?.trim() || '';
  const flowerMeta = () => {
    const item = props.flowerThread;
    if (!item) return '';
    return String(item.read_only_reason ?? item.source_label ?? item.summary ?? '').trim();
  };
  const timeStr = () => fmtShortTime(props.thread.updated_at_unix_ms, props.i18n);
  const indicatorMode = (): 'running' | 'unread' | 'none' => {
    if (props.isRunning) return 'running';
    if (props.unread) return 'unread';
    return 'none';
  };
  const deleteLabel = () => props.i18n.t('flowerChat.sidebar.delete.aria', { title: title() });

  return (
    <div
      data-thread-id={props.thread.thread_id}
      onContextMenu={props.onContextMenu}
      class={`group relative w-full cursor-pointer rounded-lg border transition-all duration-150 ${
        props.active
          ? 'bg-sidebar-accent text-sidebar-foreground border-border/20 shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
          : 'text-sidebar-foreground/80 border-transparent hover:bg-sidebar-accent/60 hover:border-border/15 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
      }`}
    >
      {/* Left accent bar */}
      <Show when={props.active}>
        <div class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary" />
      </Show>

      <button
        type="button"
        class="flex w-full cursor-pointer items-start gap-2 px-2.5 py-2 pr-11 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
        onClick={props.onClick}
      >
        {/* Status dot */}
        <div class="relative mt-1.5 h-2 w-2 shrink-0" data-thread-indicator={indicatorMode()}>
          <Show when={indicatorMode() === 'running'}>
            <>
              <div
                class={`h-2 w-2 rounded-full ${statusDotClass(status())}`}
                title={statusLabel(status(), props.i18n)}
              />
              <Show when={status() === 'running'}>
                <div class="absolute inset-0 h-2 w-2 rounded-full bg-primary/50 animate-pulse" />
              </Show>
            </>
          </Show>
          <Show when={indicatorMode() === 'unread'}>
            <div class="h-2 w-2 rounded-full bg-primary" title={props.i18n.t('flowerChat.sidebar.unread')} />
          </Show>
        </div>

        {/* Content area */}
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Title row */}
          <div class="flex min-w-0 items-center gap-1">
            <span class="flex-1 truncate text-xs font-medium">{title()}</span>
            <Show when={Number(props.thread.queued_turn_count ?? 0) > 0}>
              <span class="inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary/8 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {props.thread.queued_turn_count}
              </span>
            </Show>
          </div>

          {/* Preview text / running state */}
            <Show when={status() === 'running'} fallback={
              <Show when={!!preview()}>
                <p class="truncate text-[11px] leading-tight text-muted-foreground/50">{preview()}</p>
              </Show>
            }>
              <ProcessingIndicator variant="minimal" status={props.i18n.t('flowerChat.sidebar.working')} class="h-3.5" />
            </Show>
            <Show when={!!flowerMeta()}>
              <p class="truncate text-[10px] leading-tight text-muted-foreground/45">{flowerMeta()}</p>
            </Show>
          </div>
      </button>

      <div class="pointer-events-none absolute right-2.5 top-2 flex h-5 min-w-7 items-center justify-end">
        <Show
          when={props.canDelete}
          fallback={
            <span class="select-none text-[10px] text-muted-foreground/60" aria-hidden="true">
              {timeStr()}
            </span>
          }
        >
          <span
            class="select-none text-[10px] text-muted-foreground/60 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
            aria-hidden="true"
          >
            {timeStr()}
          </span>
          <button
            type="button"
            class="pointer-events-auto absolute inset-0 flex cursor-pointer items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-all duration-150 hover:bg-error/10 hover:text-error focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 group-hover:opacity-100 group-focus-within:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={deleteLabel()}
            disabled={!props.connected}
            onClick={() => props.onDelete()}
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </Show>
      </div>
    </div>
  );
}

// ---- Empty state ----

function EmptyState(props: { i18n: I18nHelpers }) {
  return (
    <div class="px-2.5 py-8 text-center">
      <Motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, easing: 'ease-out' }}
        class="mx-auto mb-3 flex h-14 w-14 items-center justify-center"
      >
        <FlowerSoftAuraIcon class="redeven-flower-soft-aura-lg h-full w-full" />
      </Motion.div>

      <Motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2, easing: 'ease-out' }}
      >
        <p class="text-xs font-medium text-muted-foreground/70">{props.i18n.t('flowerChat.sidebar.noConversationsTitle')}</p>
        <p class="text-[11px] text-muted-foreground/40 mt-1">{props.i18n.t('flowerChat.sidebar.noConversationsDescription')}</p>
      </Motion.div>
    </div>
  );
}
