import type { FlowerApprovalAction, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

export function flowerDisplayApprovalAction(thread: FlowerThreadSnapshot | null | undefined): FlowerApprovalAction | null {
  if (!thread) return null;
  const pending = (thread.approval_actions ?? []).filter((action) => (
    action.status === 'pending' && action.state === 'requested'
  ));
  const action = pending.find((candidate) => candidate.surface_role === 'primary_action') ?? pending[0] ?? null;
  if (!action) return null;
  const primary = action.surface_role === 'primary_action' || !action.surface_role;
  return primary ? action : null;
}
