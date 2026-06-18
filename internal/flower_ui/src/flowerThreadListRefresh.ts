import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { trimString } from './flowerSurfaceModel';

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

export function mergeFlowerThreadListSummary(
  summary: FlowerThreadSnapshot,
  existing: FlowerThreadSnapshot,
): FlowerThreadSnapshot {
  return {
    ...summary,
    messages: existing.messages,
    ...(summary.status === 'waiting_approval' && summary.approval_actions === undefined && existing.approval_actions !== undefined ? { approval_actions: existing.approval_actions } : {}),
    ...(summaryOwnsExistingInputRequest(summary, existing) ? { input_request: existing.input_request } : {}),
    ...(summary.error === undefined && existing.error != null && summaryCanStillShowExistingError(summary) ? { error: existing.error } : {}),
  };
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
