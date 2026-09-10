import type {
  FlowerThreadListItem,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { flowerThreadDisplayTitle } from './flowerThreadTitle';

export function trimString(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

export function flowerThreadHasActiveTurnEvidence(
  thread: FlowerThreadSnapshot | null | undefined,
): boolean {
  if (!thread) return false;
  return Boolean(trimString(thread.active_run_id))
    || Boolean(trimString(thread.run_progress?.run_id))
    || thread.status === 'running'
    || thread.status === 'waiting_approval'
    || thread.status === 'waiting_user';
}

export function flowerThreadIsStopping(thread: Pick<FlowerThreadSnapshot, 'status' | 'cancellation'> | null | undefined): boolean {
  return Boolean(thread?.cancellation) && (thread?.status === 'running' || thread?.status === 'waiting_approval' || thread?.status === 'waiting_user');
}

function messagePreviewText(message: FlowerThreadSnapshot['messages'][number]): string {
  const fromBlocks = message.blocks
    ?.map((block) => (block.type === 'markdown' || block.type === 'text' ? trimString(block.content) : ''))
    .filter(Boolean)
    .join('\n\n');
  return trimString(message.content || fromBlocks);
}

export function projectFlowerThreadListItem(thread: FlowerThreadSnapshot, untitled = ''): FlowerThreadListItem {
  const lastMessage = [...thread.messages].reverse().map(messagePreviewText).find(Boolean);
  return {
    thread_id: thread.thread_id,
    title: flowerThreadDisplayTitle(thread, untitled),
    title_status: thread.title_status,
    model_id: thread.model_id,
    working_dir: thread.working_dir,
    pinned: Number(thread.pinned_at_ms ?? 0) > 0,
    ...(Number(thread.pinned_at_ms ?? 0) > 0 ? { pinned_at_ms: Number(thread.pinned_at_ms) } : {}),
    created_at_ms: thread.created_at_ms,
    updated_at_ms: thread.updated_at_ms,
    preview: lastMessage ?? '',
    status: thread.status,
    cancellation: thread.cancellation,
    ...(thread.approval_pending !== undefined ? { approval_pending: thread.approval_pending } : {}),
    ...(thread.approval_pending_count !== undefined ? { approval_pending_count: thread.approval_pending_count } : {}),
    source_label: thread.source_label,
    target_labels: thread.target_labels,
    ...(trimString(thread.read_only_reason) ? { read_only_reason: trimString(thread.read_only_reason) } : {}),
    read_status: thread.read_status,
  };
}
