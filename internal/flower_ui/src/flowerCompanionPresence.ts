import type { FlowerThreadListItem } from './contracts/flowerSurfaceContracts';

export type FlowerCompanionThreadListItem = FlowerThreadListItem & Readonly<{
  queued_turn_count?: number;
}>;

export type FlowerCompanionPriorityStatus =
  | 'attention'
  | 'failed'
  | 'running'
  | 'queued'
  | 'canceled'
  | 'completed'
  | 'unavailable'
  | 'idle';

export type FlowerCompanionPresenceProjection = Readonly<{
  priority_status: FlowerCompanionPriorityStatus;
  priority_count: number;
  priority_thread_title?: string;
  attention_count: number;
  unread_failed_count: number;
  running_count: number;
  queued_count: number;
  unread_canceled_count: number;
  unread_completed_count: number;
}>;

type CountKey = Exclude<
  keyof FlowerCompanionPresenceProjection,
  'priority_status' | 'priority_count' | 'priority_thread_title'
>;

const PRIORITIES: readonly Readonly<{
  status: Exclude<FlowerCompanionPriorityStatus, 'unavailable' | 'idle'>;
  count: CountKey;
}>[] = [
  { status: 'attention', count: 'attention_count' },
  { status: 'failed', count: 'unread_failed_count' },
  { status: 'running', count: 'running_count' },
  { status: 'queued', count: 'queued_count' },
  { status: 'canceled', count: 'unread_canceled_count' },
  { status: 'completed', count: 'unread_completed_count' },
];

function priorityCountKey(thread: FlowerCompanionThreadListItem): CountKey | null {
  if (thread.status === 'waiting_user' || thread.status === 'waiting_approval') return 'attention_count';
  if (thread.status === 'failed' && thread.read_status.is_unread) return 'unread_failed_count';
  if (thread.status === 'running') return 'running_count';
  if (Number.isFinite(thread.queued_turn_count) && Number(thread.queued_turn_count) > 0) return 'queued_count';
  if (thread.status === 'canceled' && thread.read_status.is_unread) return 'unread_canceled_count';
  if (thread.status === 'success' && thread.read_status.is_unread) return 'unread_completed_count';
  return null;
}

function canonicalThreadTitle(thread: FlowerCompanionThreadListItem): string | undefined {
  if (thread.title_status !== 'ready') return undefined;
  const title = thread.title.trim();
  return title || undefined;
}

export function projectFlowerCompanionPresence(
  threads: readonly FlowerCompanionThreadListItem[],
  available: boolean,
): FlowerCompanionPresenceProjection {
  const counts: Record<CountKey, number> = {
    attention_count: 0,
    unread_failed_count: 0,
    running_count: 0,
    queued_count: 0,
    unread_canceled_count: 0,
    unread_completed_count: 0,
  };

  for (const thread of threads) {
    const countKey = priorityCountKey(thread);
    if (countKey) counts[countKey] += 1;
  }

  const priority = PRIORITIES.find(({ count }) => counts[count] > 0);
  let priorityThreadTitle: string | undefined;
  if (priority) {
    for (const thread of threads) {
      if (priorityCountKey(thread) !== priority.count) continue;
      priorityThreadTitle = canonicalThreadTitle(thread);
      if (priorityThreadTitle) break;
    }
  }
  return {
    priority_status: priority?.status ?? (available ? 'idle' : 'unavailable'),
    priority_count: priority ? counts[priority.count] : available ? 0 : 1,
    ...(priorityThreadTitle ? { priority_thread_title: priorityThreadTitle } : {}),
    ...counts,
  };
}
