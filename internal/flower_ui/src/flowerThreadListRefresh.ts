import type { FlowerThreadActivitySnapshot, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { trimString } from './flowerSurfaceModel';

export function flowerThreadReadSnapshotKey(snapshot: FlowerThreadActivitySnapshot | null | undefined): string {
  return [
    String(Math.max(0, Math.floor(Number(snapshot?.activity_revision ?? 0)))),
    String(Math.max(0, Math.floor(Number(snapshot?.last_message_at_unix_ms ?? 0)))),
    trimString(snapshot?.activity_signature),
    trimString(snapshot?.waiting_prompt_id),
  ].join('\x1e');
}

function readStateKey(thread: FlowerThreadSnapshot): string {
  return [
    String(thread.read_status.is_unread),
    flowerThreadReadSnapshotKey(thread.read_status.snapshot),
    String(Math.max(0, Math.floor(Number(thread.read_status.read_state.last_seen_activity_revision ?? 0)))),
    String(Math.max(0, Math.floor(Number(thread.read_status.read_state.last_read_message_at_unix_ms ?? 0)))),
    trimString(thread.read_status.read_state.last_seen_activity_signature),
    trimString(thread.read_status.read_state.last_seen_waiting_prompt_id),
  ].join('\x1e');
}

function sameStringArray(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) return true;
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length && leftValues.every((value, index) => value === rightValues[index]);
}

export function sameThreadSnapshot(left: FlowerThreadSnapshot, right: FlowerThreadSnapshot): boolean {
  return left === right || (
    left.thread_id === right.thread_id
    && left.title === right.title
    && left.title_status === right.title_status
    && left.model_id === right.model_id
    && left.working_dir === right.working_dir
    && Number(left.pinned_at_ms ?? 0) === Number(right.pinned_at_ms ?? 0)
    && left.created_at_ms === right.created_at_ms
    && left.updated_at_ms === right.updated_at_ms
    && left.status === right.status
    && trimString(left.active_run_id) === trimString(right.active_run_id)
    && Boolean(left.approval_pending) === Boolean(right.approval_pending)
    && Number(left.approval_pending_count ?? 0) === Number(right.approval_pending_count ?? 0)
    && Number(left.queued_turn_count ?? 0) === Number(right.queued_turn_count ?? 0)
    && left.source_label === right.source_label
    && sameStringArray(left.target_labels, right.target_labels)
    && readStateKey(left) === readStateKey(right)
  );
}
