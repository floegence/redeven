import type {
  FlowerActivityTimelineBlock,
  FlowerApprovalAction,
  FlowerChatMessageBlock,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';

export type ApprovalDecisionHandoffPhase = 'submitting' | 'awaiting_projection';

export type ApprovalDecisionHandoff = Readonly<{
  threadID: string;
  actionID: string;
  decision: 'approve' | 'reject';
  phase: ApprovalDecisionHandoffPhase;
  submittedStreamGeneration: number;
  targetCursor?: number;
}>;

export type ApprovalDecisionProjection =
  | Readonly<{ kind: 'current_action'; action: FlowerApprovalAction }>
  | Readonly<{ kind: 'next_action'; action: FlowerApprovalAction }>
  | Readonly<{ kind: 'queue_cleared' }>
  | Readonly<{ kind: 'thread_terminal' }>
  | Readonly<{ kind: 'waiting' }>;

const TERMINAL_THREAD_STATUSES = new Set<FlowerThreadSnapshot['status']>([
  'failed',
  'success',
  'canceled',
  'read_only',
]);

function pendingRequestedActions(thread: FlowerThreadSnapshot): readonly FlowerApprovalAction[] {
  return (thread.approval_actions ?? []).filter((action) => (
    action.status === 'pending' && action.state === 'requested'
  ));
}

export function flowerComposerApprovalAction(thread: FlowerThreadSnapshot | null | undefined): FlowerApprovalAction | null {
  if (!thread) return null;
  const pending = pendingRequestedActions(thread);
  const currentActionID = String(thread.approval_queue?.current_action_id ?? '').trim();
  const action = currentActionID
    ? pending.find((candidate) => candidate.action_id === currentActionID) ?? null
    : pending.find((candidate) => candidate.surface_role === 'primary_action') ?? (pending.length === 1 ? pending[0]! : null);
  if (!action || !action.can_approve) return null;
  const primary = action.surface_role === 'primary_action'
    || (!action.surface_role && !thread.approval_queue && pending.length === 1);
  if (!primary) return null;
  return action;
}

export function approvalDecisionProjection(
  thread: FlowerThreadSnapshot,
  actionID: string,
): ApprovalDecisionProjection {
  if (TERMINAL_THREAD_STATUSES.has(thread.status)) {
    return { kind: 'thread_terminal' };
  }
  const current = flowerComposerApprovalAction(thread);
  if (current) {
    return current.action_id === actionID
      ? { kind: 'current_action', action: current }
      : { kind: 'next_action', action: current };
  }
  const queue = thread.approval_queue;
  if (queue === null || queue !== undefined && queue.unresolved_count <= 0) {
    return { kind: 'queue_cleared' };
  }
  if (queue === undefined && thread.approval_actions !== undefined && thread.approval_actions.length === 0) {
    return { kind: 'queue_cleared' };
  }
  return { kind: 'waiting' };
}

function optimisticRejectedActivity(
  block: FlowerChatMessageBlock,
  toolID: string,
  decidedAtMs: number,
): FlowerChatMessageBlock {
  if (block.type !== 'activity-timeline') return block;
  let changed = false;
  const items = block.items.map((item) => {
    if (String(item.tool_id ?? '').trim() !== toolID || item.approval_state !== 'requested') return item;
    changed = true;
    return {
      ...item,
      status: 'declined' as const,
      approval_state: 'rejected' as const,
      severity: 'quiet' as const,
      needs_attention: false,
      attention_reasons: [],
      requires_approval: false,
      ended_at_unix_ms: decidedAtMs,
    };
  });
  if (!changed) return block;
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    if (item.requires_approval) counts.approval = (counts.approval ?? 0) + 1;
  }
  const waiting = items.some((item) => item.status === 'waiting' || item.status === 'pending');
  const running = items.some((item) => item.status === 'running');
  const failed = items.some((item) => item.status === 'error');
  const summary: FlowerActivityTimelineBlock['summary'] = {
    ...block.summary,
    status: failed ? 'error' : waiting ? 'waiting' : running ? 'running' : 'declined',
    severity: failed ? 'error' : waiting ? 'warning' : running ? 'normal' : 'quiet',
    needs_attention: items.some((item) => item.needs_attention),
    attention_reasons: [...new Set(items.flatMap((item) => item.attention_reasons ?? []))],
    total_items: items.length,
    counts,
  };
  return { ...block, summary, items };
}

export function optimisticApprovalDecisionProjection(
  thread: FlowerThreadSnapshot,
  action: FlowerApprovalAction,
  approved: boolean,
  decidedAtMs: number,
): FlowerThreadSnapshot {
  const approvalActions = (thread.approval_actions ?? []).filter((item) => item.action_id !== action.action_id);
  const canonicalRemaining = approvalActions
    .filter((item) => item.origin !== 'control_confirm' && item.status === 'pending' && item.state === 'requested')
    .sort((left, right) => Number(left.queue_order ?? 0) - Number(right.queue_order ?? 0));
  const queue = thread.approval_queue;
  const approvalQueue = queue
    ? {
        ...queue,
        current_action_id: canonicalRemaining[0]?.action_id ?? '',
        current_position: canonicalRemaining.length > 0
          ? Math.max(1, Number(canonicalRemaining[0]?.queue_order ?? queue.current_position))
          : 0,
        unresolved_count: canonicalRemaining.length,
      }
    : queue;
  const messages = approved ? thread.messages : thread.messages.map((message) => {
    if (String(message.run_id ?? '').trim() !== String(action.run_id ?? '').trim()) return message;
    const blocks = message.blocks?.map((block) => optimisticRejectedActivity(block, action.tool_id, decidedAtMs));
    return blocks && blocks.some((block, index) => block !== message.blocks?.[index])
      ? { ...message, blocks }
      : message;
  });
  return {
    ...thread,
    messages,
    approval_actions: approvalActions,
    approval_queue: approvalQueue,
    approval_pending: approvalActions.some((item) => item.status === 'pending' && item.state === 'requested'),
    approval_pending_count: approvalActions.filter((item) => item.status === 'pending' && item.state === 'requested').length,
    status: approvalActions.some((item) => item.status === 'pending' && item.state === 'requested')
      ? 'waiting_approval'
      : thread.active_run_id ? 'running' : thread.status,
  };
}
