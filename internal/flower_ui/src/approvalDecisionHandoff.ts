import type { FlowerApprovalAction, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

export type ApprovalDecisionHandoffPhase = 'submitting' | 'awaiting_projection';

export type ApprovalDecisionHandoff = Readonly<{
  threadID: string;
  actionID: string;
  frozenAction: FlowerApprovalAction;
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
