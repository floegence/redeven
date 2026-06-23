import { DEFAULT_FLOWER_SURFACE_COPY, type FlowerThreadListCopy, type FlowerThreadTimeGroup } from '../copy';
import type { FlowerThreadListItem, FlowerThreadStatus } from '../contracts/flowerSurfaceContracts';

type TimeGroup = FlowerThreadTimeGroup;

export type FlowerThreadIndicator = Readonly<{
  visual: 'none' | 'wave' | 'dot';
  attention: 'none' | 'unread';
  actionRequired: boolean;
  ariaStatus: string;
  title: string;
}>;

export type FlowerThreadGroup =
  | Readonly<{ kind: 'pinned'; threads: FlowerThreadListItem[] }>
  | Readonly<{ kind: 'time'; group: TimeGroup; threads: FlowerThreadListItem[] }>;

function threadGroupTime(thread: FlowerThreadListItem): number {
  return thread.created_at_ms;
}

export function groupFlowerThreadsByDate(threads: readonly FlowerThreadListItem[]): { group: TimeGroup; threads: FlowerThreadListItem[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const dayOfWeek = now.getDay();
  const weekStart = todayStart - ((dayOfWeek === 0 ? 6 : dayOfWeek - 1) * 86_400_000);
  const groups: Record<TimeGroup, FlowerThreadListItem[]> = {
    today: [],
    yesterday: [],
    this_week: [],
    older: [],
  };
  for (const thread of threads) {
    const ts = threadGroupTime(thread);
    if (ts >= todayStart) {
      groups.today.push(thread);
    } else if (ts >= yesterdayStart) {
      groups.yesterday.push(thread);
    } else if (ts >= weekStart) {
      groups.this_week.push(thread);
    } else {
      groups.older.push(thread);
    }
  }
  return (['today', 'yesterday', 'this_week', 'older'] as const)
    .filter((group) => groups[group].length > 0)
    .map((group) => ({ group, threads: groups[group] }));
}

export function groupFlowerThreadItems(threads: readonly FlowerThreadListItem[]): FlowerThreadGroup[] {
  const pinned = threads
    .filter((thread) => thread.pinned)
    .sort((a, b) => (b.pinned_at_ms ?? 0) - (a.pinned_at_ms ?? 0) || b.created_at_ms - a.created_at_ms || a.thread_id.localeCompare(b.thread_id));
  const regular = threads
    .filter((thread) => !thread.pinned)
    .sort((a, b) => b.created_at_ms - a.created_at_ms || a.thread_id.localeCompare(b.thread_id));
  const out: FlowerThreadGroup[] = [];
  if (pinned.length > 0) {
    out.push({ kind: 'pinned', threads: pinned });
  }
  out.push(...groupFlowerThreadsByDate(regular).map((group) => ({ kind: 'time' as const, ...group })));
  return out;
}

export function filterFlowerThreadItems(threads: readonly FlowerThreadListItem[], query: string): FlowerThreadListItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return threads as FlowerThreadListItem[];
  return threads.filter((thread) => [
    thread.title,
    thread.preview,
    thread.model_id,
    thread.source_label,
    thread.read_only_reason,
    ...thread.target_labels,
  ].join(' ').toLowerCase().includes(needle));
}

function threadCanShowUnreadDot(status: FlowerThreadStatus): boolean {
  return status === 'success' || status === 'failed' || status === 'canceled';
}

function threadShowsUnreadDot(item: FlowerThreadListItem, active: boolean): boolean {
  return !active && item.read_status.is_unread === true && threadCanShowUnreadDot(item.status);
}

export function flowerThreadIndicator(
  item: FlowerThreadListItem,
  active: boolean,
  copy: FlowerThreadListCopy = DEFAULT_FLOWER_SURFACE_COPY.threadList,
): FlowerThreadIndicator {
  const showUnreadDot = threadShowsUnreadDot(item, active);
  const statusIndicator = (
    ariaStatus: string,
    visual: FlowerThreadIndicator['visual'],
    actionRequired = false,
  ): FlowerThreadIndicator => ({
    visual,
    attention: showUnreadDot ? 'unread' : 'none',
    actionRequired,
    ariaStatus,
    title: showUnreadDot ? `${ariaStatus}, ${copy.unread}` : ariaStatus,
  });
  switch (item.status) {
    case 'running':
      return {
        visual: 'wave',
        attention: 'none',
        actionRequired: false,
        ariaStatus: copy.statuses.running,
        title: copy.statuses.running,
      };
    case 'waiting_user':
      return statusIndicator(copy.statuses.waiting_user, 'none', true);
    case 'waiting_approval':
      return statusIndicator(copy.statuses.waiting_approval, 'none', true);
    case 'success':
      return statusIndicator(copy.statuses.success, showUnreadDot ? 'dot' : 'none');
    case 'failed':
      return statusIndicator(copy.statuses.failed, showUnreadDot ? 'dot' : 'none');
    case 'canceled':
      return statusIndicator(copy.statuses.canceled, showUnreadDot ? 'dot' : 'none');
    case 'read_only':
      return statusIndicator(copy.statuses.read_only, 'none');
    default:
      return statusIndicator(copy.statuses.idle, 'none');
  }
}
