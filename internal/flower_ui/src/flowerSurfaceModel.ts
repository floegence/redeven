import type {
  FlowerThreadListItem,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';

export function trimString(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

export function projectFlowerThreadListItem(thread: FlowerThreadSnapshot): FlowerThreadListItem {
  const lastMessage = [...thread.messages].reverse().find((message) => trimString(message.content));
  return {
    thread_id: thread.thread_id,
    title: thread.title,
    model_id: thread.model_id,
    updated_at_ms: thread.updated_at_ms,
    preview: lastMessage?.content ?? '',
    status: thread.status ?? 'idle',
    source_label: thread.source_label,
    target_labels: thread.target_labels ?? [],
  };
}
