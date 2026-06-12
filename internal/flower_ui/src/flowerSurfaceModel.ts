import type {
  FlowerThreadListItem,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';

export function trimString(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function messagePreviewText(message: FlowerThreadSnapshot['messages'][number]): string {
  const fromBlocks = message.blocks
    ?.filter((block) => block.type === 'markdown' || block.type === 'text')
    .map((block) => trimString(block.content))
    .filter(Boolean)
    .join('\n\n');
  return trimString(message.content || fromBlocks);
}

export function projectFlowerThreadListItem(thread: FlowerThreadSnapshot): FlowerThreadListItem {
  const lastMessage = [...thread.messages].reverse().map(messagePreviewText).find(Boolean);
  return {
    thread_id: thread.thread_id,
    title: thread.title,
    model_id: thread.model_id,
    working_dir: thread.working_dir,
    pinned: Number(thread.pinned_at_ms ?? 0) > 0,
    ...(Number(thread.pinned_at_ms ?? 0) > 0 ? { pinned_at_ms: Number(thread.pinned_at_ms) } : {}),
    created_at_ms: thread.created_at_ms,
    updated_at_ms: thread.updated_at_ms,
    preview: lastMessage ?? '',
    status: thread.status,
    source_label: thread.source_label,
    target_labels: thread.target_labels,
  };
}
