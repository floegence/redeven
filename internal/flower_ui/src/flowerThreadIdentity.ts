import type {
  FlowerThreadActivitySnapshot,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { trimString } from './flowerSurfaceModel';

export function flowerReadSnapshotKey(snapshot: FlowerThreadActivitySnapshot | null | undefined): string {
  return [
    String(Math.max(0, Math.floor(Number(snapshot?.activity_revision ?? 0)))),
    String(Math.max(0, Math.floor(Number(snapshot?.last_message_at_unix_ms ?? 0)))),
    trimString(snapshot?.activity_signature),
    trimString(snapshot?.waiting_prompt_id),
  ].join('\x1e');
}

export function flowerReadStateKey(thread: FlowerThreadSnapshot): string {
  return [
    String(thread.read_status.is_unread),
    flowerReadSnapshotKey(thread.read_status.snapshot),
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

function sameReferenceOrEmpty<T>(left: readonly T[] | undefined, right: readonly T[] | undefined): boolean {
  return left === right || ((left?.length ?? 0) === 0 && (right?.length ?? 0) === 0);
}

function sameReferenceOrNullish<T>(left: T | null | undefined, right: T | null | undefined): boolean {
  return left === right || (left == null && right == null);
}

export function sameFlowerThreadSnapshot(left: FlowerThreadSnapshot, right: FlowerThreadSnapshot): boolean {
  return left === right
    || (
      left.thread_id === right.thread_id
      && left.title === right.title
      && left.model_id === right.model_id
      && left.working_dir === right.working_dir
      && Number(left.pinned_at_ms ?? 0) === Number(right.pinned_at_ms ?? 0)
      && (left.home_runtime_id ?? '') === (right.home_runtime_id ?? '')
      && (left.home_runtime_kind ?? '') === (right.home_runtime_kind ?? '')
      && (left.origin_env_public_id ?? '') === (right.origin_env_public_id ?? '')
      && left.created_at_ms === right.created_at_ms
      && left.updated_at_ms === right.updated_at_ms
      && left.status === right.status
      && left.source_label === right.source_label
      && sameStringArray(left.target_labels, right.target_labels)
      && flowerReadStateKey(left) === flowerReadStateKey(right)
      && sameReferenceOrEmpty(left.messages, right.messages)
      && sameReferenceOrEmpty(left.approval_actions, right.approval_actions)
      && sameReferenceOrNullish(left.input_request, right.input_request)
      && sameReferenceOrNullish(left.error, right.error)
    );
}

export function reuseUnchangedFlowerThreadSnapshot(
  existing: FlowerThreadSnapshot,
  candidate: FlowerThreadSnapshot,
): FlowerThreadSnapshot {
  return sameFlowerThreadSnapshot(existing, candidate) ? existing : candidate;
}
