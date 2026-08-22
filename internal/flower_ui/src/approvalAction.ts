import type { FlowerApprovalAction, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

function pendingPrimaryApproval(action: FlowerApprovalAction): boolean {
  return action.status === 'pending'
    && action.state === 'requested'
    && (action.surface_role === 'primary_action' || !action.surface_role);
}

function compareApprovalActions(left: FlowerApprovalAction, right: FlowerApprovalAction): number {
  const leftQueueOrder = Number.isFinite(left.queue_order) ? Number(left.queue_order) : Number.POSITIVE_INFINITY;
  const rightQueueOrder = Number.isFinite(right.queue_order) ? Number(right.queue_order) : Number.POSITIVE_INFINITY;
  if (leftQueueOrder !== rightQueueOrder) return leftQueueOrder - rightQueueOrder;

  const leftRequestedAt = Number.isFinite(left.requested_at_ms) ? Number(left.requested_at_ms) : Number.POSITIVE_INFINITY;
  const rightRequestedAt = Number.isFinite(right.requested_at_ms) ? Number(right.requested_at_ms) : Number.POSITIVE_INFINITY;
  if (leftRequestedAt !== rightRequestedAt) return leftRequestedAt - rightRequestedAt;

  return left.action_id.localeCompare(right.action_id);
}

export function flowerPendingApprovalActions(thread: FlowerThreadSnapshot | null | undefined): readonly FlowerApprovalAction[] {
  if (!thread) return [];
  return (thread.approval_actions ?? [])
    .filter(pendingPrimaryApproval)
    .slice()
    .sort(compareApprovalActions);
}

export function flowerDisplayApprovalAction(thread: FlowerThreadSnapshot | null | undefined): FlowerApprovalAction | null {
  return flowerPendingApprovalActions(thread)[0] ?? null;
}
