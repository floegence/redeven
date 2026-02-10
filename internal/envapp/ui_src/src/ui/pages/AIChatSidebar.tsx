import { For, Show, createMemo, createSignal } from 'solid-js';
import { MessageSquare, Plus, Sparkles, X } from '@floegence/floe-webapp-core/icons';
import { useNotification } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { SidebarContent, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, ConfirmDialog, ProcessingIndicator } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { Motion } from 'solid-motionone';
import { useAIChatContext, type ThreadRunStatus, type ThreadView } from './AIChatContext';

// 短格式时间戳，用于卡片右侧显示
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

// 时间分组类型
type TimeGroup = 'Today' | 'Yesterday' | 'This Week' | 'Older';

// 按日期分组线程（仅当总数 >= 5 时才分组）
function groupThreadsByDate(threads: ThreadView[]): { group: TimeGroup; threads: ThreadView[] }[] {
  if (threads.length < 5) {
    return [{ group: 'Today' as TimeGroup, threads }];
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  // 本周开始（周一）
  const dayOfWeek = now.getDay();
  const weekStart = todayStart - ((dayOfWeek === 0 ? 6 : dayOfWeek - 1) * 86400000);

  const groups: Record<TimeGroup, ThreadView[]> = {
    'Today': [],
    'Yesterday': [],
    'This Week': [],
    'Older': [],
  };

  for (const t of threads) {
    const ts = t.updated_at_unix_ms || t.created_at_unix_ms || 0;
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

// 状态圆点颜色映射
function statusDotClass(status: ThreadRunStatus): string {
  switch (status) {
    case 'accepted':
    case 'running':
      return 'bg-primary';
    case 'waiting_approval':
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

// 状态文字用于 tooltip
function statusLabel(status: ThreadRunStatus): string {
  switch (status) {
    case 'accepted': return 'Queued';
    case 'running': return 'Running';
    case 'waiting_approval': return 'Waiting Approval';
    case 'recovering': return 'Recovering';
    case 'success': return 'Done';
    case 'failed': return 'Failed';
    case 'timed_out': return 'Timed Out';
    case 'canceled': return 'Canceled';
    default: return '';
  }
}

/**
 * AI chat 侧边栏 – 线程列表
 * 使用 floe-webapp SidebarContent 作为容器，自定义线程卡片渲染
 */
export function AIChatSidebar() {
  const ctx = useAIChatContext();
  const protocol = useProtocol();
  const notify = useNotification();

  // 删除确认对话框状态
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteThreadId, setDeleteThreadId] = createSignal<string | null>(null);
  const [deleteThreadTitle, setDeleteThreadTitle] = createSignal('');
  const [deleteForce, setDeleteForce] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  const openDelete = (threadId: string, title: string) => {
    setDeleteThreadId(threadId);
    setDeleteThreadTitle(String(title ?? '').trim() || 'New chat');
    setDeleteForce(false);
    setDeleteOpen(true);
  };

  const doDelete = async () => {
    const tid = deleteThreadId();
    if (!tid) return;

    setDeleting(true);
    try {
      const force = deleteForce();
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
          setDeleteForce(true);
          return;
        }
        throw new Error(String(data?.error ?? `HTTP ${resp.status}`));
      }
      if (data?.ok === false) throw new Error(String(data?.error ?? 'Request failed'));

      setDeleteOpen(false);
      setDeleteThreadId(null);
      setDeleteForce(false);

      if (tid === ctx.activeThreadId()) {
        ctx.clearActiveThreadPersistence();
        ctx.enterDraftChat();
      }

      ctx.bumpThreadsSeq();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to delete chat', msg || 'Request failed.');
    } finally {
      setDeleting(false);
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
      {/* 顶部 New Chat 按钮 */}
      <div class="px-1 pb-1">
        <Button
          variant="outline"
          size="sm"
          class="w-full justify-start gap-2 h-8 border-sidebar-border/60 bg-sidebar hover:bg-sidebar-accent/60 text-sidebar-foreground/80 hover:text-sidebar-foreground transition-all duration-150"
          icon={Plus}
          onClick={() => ctx.enterDraftChat()}
          disabled={protocol.status() !== 'connected'}
        >
          New Chat
        </Button>
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
                <For each={groupedThreads()}>
                  {(group) => (
                    <>
                      <Show when={showGroupHeaders()}>
                        <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40 px-2.5 pt-3 pb-1 select-none">
                          {group.group}
                        </div>
                      </Show>
                      <For each={group.threads}>
                        {(t) => (
                          <ThreadCard
                            thread={t}
                            active={t.thread_id === ctx.activeThreadId()}
                            isRunning={ctx.isThreadRunning(t.thread_id)}
                            connected={protocol.status() === 'connected'}
                            onClick={() => ctx.selectThreadId(t.thread_id)}
                            onDelete={() => openDelete(t.thread_id, t.title)}
                          />
                        )}
                      </For>
                    </>
                  )}
                </For>
              </div>
            </SidebarSection>
          </Show>
        </Show>
      </Show>

      {/* 删除确认对话框 */}
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

// ---- 线程卡片组件 ----

function ThreadCard(props: {
  thread: ThreadView;
  active: boolean;
  isRunning: boolean;
  connected: boolean;
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
      {/* 左侧 accent bar */}
      <Show when={props.active}>
        <div class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary" />
      </Show>

      {/* 状态圆点 */}
      <div class="relative mt-1.5 shrink-0">
        <div
          class={`w-2 h-2 rounded-full ${statusDotClass(status())}`}
          title={statusLabel(status())}
        />
        {/* running 脉冲动画 */}
        <Show when={status() === 'running'}>
          <div class="absolute inset-0 w-2 h-2 rounded-full bg-primary/50 animate-pulse" />
        </Show>
      </div>

      {/* 内容区 */}
      <div class="flex flex-col gap-0.5 min-w-0 flex-1">
        {/* 标题行 */}
        <div class="flex items-center gap-1">
          <span class="text-xs font-medium truncate flex-1">{title()}</span>
          {/* 时间戳 / hover 时变为删除按钮（用 opacity 替代 display 切换，避免高度跳动） */}
          <div class="shrink-0 w-5 h-5 flex items-center justify-center relative">
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
          </div>
        </div>

        {/* 预览文字 / running 状态 */}
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

// ---- 空状态 ----

function EmptyState() {
  return (
    <div class="px-2.5 py-8 text-center">
      {/* 图标容器 */}
      <Motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, easing: 'ease-out' }}
        class="relative w-14 h-14 rounded-2xl bg-sidebar-accent/80 flex items-center justify-center mx-auto mb-3"
      >
        <MessageSquare class="w-7 h-7 text-muted-foreground/60" />
        {/* Sparkles 装饰 */}
        <Motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.3, easing: 'ease-out' }}
          class="absolute -top-1 -right-1"
        >
          <Sparkles class="w-4 h-4 text-primary/60" />
        </Motion.div>
      </Motion.div>

      {/* 文字 */}
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
