import type {
  FlowerContextCompaction,
  FlowerContextUsage,
  FlowerModelIOStatus,
  FlowerReasoningCapability,
  FlowerReasoningSelection,
  FlowerThreadActivitySnapshot,
  FlowerThreadSnapshot,
  FlowerTimelineDecoration,
} from './contracts/flowerSurfaceContracts';
import { trimString } from './flowerSurfaceModel';
import { sameFlowerReasoningCapability, sameFlowerReasoningSelection } from './reasoning';

export type FlowerThreadListRefreshOptions = Readonly<{
  selectedThreadID?: string;
  pendingThreadID?: string;
  preserveMissingCurrentThreads?: boolean;
  sameThreadSnapshot: (left: FlowerThreadSnapshot, right: FlowerThreadSnapshot) => boolean;
}>;

function visibleInputRequest(thread: FlowerThreadSnapshot): boolean {
  return thread.status === 'waiting_user' && thread.input_request != null;
}

function visibleApprovalActions(thread: FlowerThreadSnapshot): boolean {
  return thread.status === 'waiting_approval' && (thread.approval_actions?.length ?? 0) > 0;
}

function threadHasLoadedDetail(thread: FlowerThreadSnapshot): boolean {
  return thread.messages.length > 0
    || visibleInputRequest(thread)
    || visibleApprovalActions(thread)
    || thread.error != null;
}

function threadHasLocalActiveState(thread: FlowerThreadSnapshot, pendingThreadID = ''): boolean {
  return trimString(pendingThreadID) === thread.thread_id
    || thread.status === 'running'
    || thread.status === 'waiting_user'
    || thread.status === 'waiting_approval';
}

function selectedThreadShouldSurviveMissingListSummary(
  thread: FlowerThreadSnapshot,
  pendingThreadID = '',
): boolean {
  return threadHasLoadedDetail(thread) || threadHasLocalActiveState(thread, pendingThreadID);
}

function summaryOwnsExistingInputRequest(summary: FlowerThreadSnapshot, existing: FlowerThreadSnapshot): boolean {
  const promptID = trimString(existing.input_request?.prompt_id);
  return summary.input_request === undefined
    && summary.status === 'waiting_user'
    && promptID !== ''
    && trimString(summary.read_status.snapshot.waiting_prompt_id) === promptID;
}

function summaryCanStillShowExistingError(summary: FlowerThreadSnapshot): boolean {
  return summary.status === 'failed'
    || summary.status === 'running'
    || summary.status === 'waiting_user'
    || summary.status === 'waiting_approval';
}

function summaryCanKeepLiveModelState(summary: FlowerThreadSnapshot): boolean {
  return summary.status === 'running';
}

export function mergeFlowerThreadListSummary(
  summary: FlowerThreadSnapshot,
  existing: FlowerThreadSnapshot,
): FlowerThreadSnapshot {
  return {
    ...summary,
    messages: existing.messages,
    ...(summaryCanKeepLiveModelState(summary) && summary.active_run_id === undefined && existing.active_run_id !== undefined ? { active_run_id: existing.active_run_id } : {}),
    ...(summaryCanKeepLiveModelState(summary) && summary.model_io_status === undefined && existing.model_io_status !== undefined ? { model_io_status: existing.model_io_status } : {}),
    ...(summary.context_usage === undefined && existing.context_usage !== undefined ? { context_usage: existing.context_usage } : {}),
    ...(summary.context_compactions === undefined && existing.context_compactions !== undefined ? { context_compactions: existing.context_compactions } : {}),
    ...(summary.timeline_decorations === undefined && existing.timeline_decorations !== undefined ? { timeline_decorations: existing.timeline_decorations } : {}),
    ...(summary.status === 'waiting_approval' && summary.approval_actions === undefined && existing.approval_actions !== undefined ? { approval_actions: existing.approval_actions } : {}),
    ...(summaryOwnsExistingInputRequest(summary, existing) ? { input_request: existing.input_request } : {}),
    ...(summary.error === undefined && existing.error != null && summaryCanStillShowExistingError(summary) ? { error: existing.error } : {}),
  };
}

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

function sameReferenceOrEmpty<T>(left: readonly T[] | undefined, right: readonly T[] | undefined): boolean {
  return left === right || ((left?.length ?? 0) === 0 && (right?.length ?? 0) === 0);
}

function sameOptionalString(left: string | undefined, right: string | undefined): boolean {
  return trimString(left) === trimString(right);
}

function sameOptionalNumber(left: number | undefined, right: number | undefined): boolean {
  return Number(left ?? 0) === Number(right ?? 0);
}

function sameModelIOStatus(left: FlowerModelIOStatus | null | undefined, right: FlowerModelIOStatus | null | undefined): boolean {
  if (left === right) return true;
  if (left == null || right == null) return left == null && right == null;
  return left.phase === right.phase
    && sameOptionalString(left.run_id, right.run_id)
    && sameOptionalNumber(left.step_index, right.step_index)
    && Number(left.updated_at_ms) === Number(right.updated_at_ms);
}

function sameReasoningSelection(left: FlowerReasoningSelection | null | undefined, right: FlowerReasoningSelection | null | undefined): boolean {
  return sameFlowerReasoningSelection(left, right);
}

function sameReasoningCapability(left: FlowerReasoningCapability | null | undefined, right: FlowerReasoningCapability | null | undefined): boolean {
  return sameFlowerReasoningCapability(left, right);
}

function sameContextUsage(left: FlowerContextUsage | null | undefined, right: FlowerContextUsage | null | undefined): boolean {
  if (left === right) return true;
  if (left == null || right == null) return left == null && right == null;
  return sameOptionalString(left.run_id, right.run_id)
    && sameOptionalNumber(left.step_index, right.step_index)
    && left.phase === right.phase
    && sameOptionalNumber(left.input_tokens, right.input_tokens)
    && sameOptionalNumber(left.context_window_tokens, right.context_window_tokens)
    && sameOptionalNumber(left.threshold_tokens, right.threshold_tokens)
    && sameOptionalNumber(left.request_safe_limit_tokens, right.request_safe_limit_tokens)
    && sameOptionalNumber(left.output_headroom_tokens, right.output_headroom_tokens)
    && Number(left.used_ratio ?? 0) === Number(right.used_ratio ?? 0)
    && Number(left.threshold_ratio ?? 0) === Number(right.threshold_ratio ?? 0)
    && left.pressure_status === right.pressure_status
    && sameOptionalString(left.source, right.source)
    && Number(left.updated_at_ms) === Number(right.updated_at_ms);
}

function sameContextCompaction(left: FlowerContextCompaction, right: FlowerContextCompaction): boolean {
  return left.operation_id === right.operation_id
    && sameOptionalString(left.run_id, right.run_id)
    && sameOptionalNumber(left.step_index, right.step_index)
    && left.phase === right.phase
    && left.status === right.status
    && sameOptionalString(left.trigger, right.trigger)
    && sameOptionalString(left.reason, right.reason)
    && sameOptionalString(left.compaction_id, right.compaction_id)
    && sameOptionalNumber(left.compaction_generation, right.compaction_generation)
    && sameOptionalString(left.compaction_window_id, right.compaction_window_id)
    && sameOptionalNumber(left.tokens_before, right.tokens_before)
    && sameOptionalNumber(left.tokens_after_estimate, right.tokens_after_estimate)
    && sameOptionalString(left.error, right.error)
    && Number(left.updated_at_ms) === Number(right.updated_at_ms);
}

function sameContextCompactions(
  left: readonly FlowerContextCompaction[] | undefined,
  right: readonly FlowerContextCompaction[] | undefined,
): boolean {
  if (left === right) return true;
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length
    && leftValues.every((value, index) => {
      const other = rightValues[index];
      return other != null && sameContextCompaction(value, other);
    });
}

function sameTimelineDecoration(left: FlowerTimelineDecoration, right: FlowerTimelineDecoration): boolean {
  return left.decoration_id === right.decoration_id
    && left.kind === right.kind
    && left.anchor.target_kind === right.anchor.target_kind
    && left.anchor.message_id === right.anchor.message_id
    && Number(left.anchor.block_index ?? -1) === Number(right.anchor.block_index ?? -1)
    && sameOptionalString(left.anchor.activity_item_id, right.anchor.activity_item_id)
    && left.anchor.edge === right.anchor.edge
    && Number(left.ordinal) === Number(right.ordinal)
    && sameContextCompaction(left.compaction, right.compaction);
}

function sameTimelineDecorations(
  left: readonly FlowerTimelineDecoration[] | undefined,
  right: readonly FlowerTimelineDecoration[] | undefined,
): boolean {
  if (left === right) return true;
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length
    && leftValues.every((value, index) => {
      const other = rightValues[index];
      return other != null && sameTimelineDecoration(value, other);
    });
}

export function sameThreadSnapshot(left: FlowerThreadSnapshot, right: FlowerThreadSnapshot): boolean {
  return left === right
    || (
      left.thread_id === right.thread_id
      && left.title === right.title
      && left.model_id === right.model_id
      && left.working_dir === right.working_dir
      && Number(left.pinned_at_ms ?? 0) === Number(right.pinned_at_ms ?? 0)
      && left.created_at_ms === right.created_at_ms
      && left.updated_at_ms === right.updated_at_ms
      && left.status === right.status
      && sameOptionalString(left.active_run_id, right.active_run_id)
      && left.source_label === right.source_label
      && sameStringArray(left.target_labels, right.target_labels)
      && readStateKey(left) === readStateKey(right)
      && sameReferenceOrEmpty(left.messages, right.messages)
      && sameModelIOStatus(left.model_io_status, right.model_io_status)
      && sameReasoningSelection(left.reasoning_selection, right.reasoning_selection)
      && sameReasoningCapability(left.reasoning_capability, right.reasoning_capability)
      && sameContextUsage(left.context_usage, right.context_usage)
      && sameContextCompactions(left.context_compactions, right.context_compactions)
      && sameTimelineDecorations(left.timeline_decorations, right.timeline_decorations)
      && sameReferenceOrEmpty(left.approval_actions, right.approval_actions)
      && left.input_request === right.input_request
      && left.error === right.error
    );
}

export function mergeFlowerThreadListRefresh(
  current: readonly FlowerThreadSnapshot[],
  next: readonly FlowerThreadSnapshot[],
  options: FlowerThreadListRefreshOptions,
): readonly FlowerThreadSnapshot[] {
  const selectedID = trimString(options.selectedThreadID);
  const pendingThreadID = trimString(options.pendingThreadID);
  const byID = new Map(current.map((thread) => [thread.thread_id, thread] as const));
  const nextIDs = new Set(next.map((thread) => thread.thread_id));
  const merged = next.map((thread) => {
    const existing = byID.get(thread.thread_id);
    if (!existing) return thread;
    const preserveLoadedDetail = threadHasLoadedDetail(existing) && thread.messages.length === 0;
    const candidate = preserveLoadedDetail ? mergeFlowerThreadListSummary(thread, existing) : thread;
    return options.sameThreadSnapshot(existing, candidate) ? existing : candidate;
  });

  if (options.preserveMissingCurrentThreads) {
    for (const thread of current) {
      if (!nextIDs.has(thread.thread_id)) {
        merged.push(thread);
      }
    }
  } else {
    const selectedThread = current.find((thread) => thread.thread_id === selectedID);
    if (
      selectedThread
      && !nextIDs.has(selectedID)
      && selectedThreadShouldSurviveMissingListSummary(selectedThread, pendingThreadID)
    ) {
      merged.push(selectedThread);
    }
  }

  return current.length === merged.length && current.every((thread, index) => thread === merged[index])
    ? current
    : merged;
}
