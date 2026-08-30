import { describe, expect, it } from 'vitest';

import type { FlowerApprovalAction, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { flowerDisplayApprovalAction, flowerPendingApprovalActions } from './approvalAction';

const action = (overrides: Partial<FlowerApprovalAction> = {}): FlowerApprovalAction => ({
  action_id: 'approval-1', origin: 'main_tool', run_id: 'turn-1', tool_id: 'tool-1', tool_name: 'terminal.exec',
  state: 'requested', status: 'pending', requested_at_ms: 1, can_approve: true,
  surface_role: 'primary_action', summary: { label: 'terminal.exec' }, ...overrides,
} as FlowerApprovalAction);

const thread = (actions: readonly FlowerApprovalAction[]): FlowerThreadSnapshot => ({
  thread_id: 'thread-1', title: 'Approval', title_status: 'ready', model_id: 'model', working_dir: '/',
  settings_revision: 1,
  created_at_ms: 1, updated_at_ms: 2, status: 'waiting_approval', source_label: 'Local', target_labels: [], messages: [],
  approval_actions: actions,
  read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } },
});

describe('flowerDisplayApprovalAction', () => {
  it('selects only the primary current item from the server view', () => {
    const locator = action({ action_id: 'approval-2', tool_id: 'tool-2', surface_role: 'locator', can_approve: false });
    expect(flowerDisplayApprovalAction(thread([action(), locator]))?.action_id).toBe('approval-1');
    expect(flowerDisplayApprovalAction(thread([locator]))).toBeNull();
  });

  it('keeps a non-actionable primary approval visible for the decision surface', () => {
    const readOnly = action({ can_approve: false, read_only_reason: 'This adapter is read-only.' });
    expect(flowerDisplayApprovalAction(thread([readOnly]))).toMatchObject({
      action_id: 'approval-1',
      can_approve: false,
    });
  });
});

describe('flowerPendingApprovalActions', () => {
  it('returns stable ordered primary approvals without mirrors or locators', () => {
    const first = action({ action_id: 'approval-b', queue_order: 2 });
    const second = action({ action_id: 'approval-a', queue_order: 1 });
    const mirror = action({ action_id: 'approval-mirror', queue_order: 0, surface_role: 'mirror' });
    const locator = action({ action_id: 'approval-locator', queue_order: 3, surface_role: 'locator', can_approve: false });
    const resolved = action({ action_id: 'approval-resolved', queue_order: 4, status: 'resolved', state: 'approved' });

    expect(flowerPendingApprovalActions(thread([first, mirror, resolved, locator, second])).map((candidate) => candidate.action_id))
      .toEqual(['approval-a', 'approval-b']);
  });

  it('uses requested time and action id as deterministic fallbacks', () => {
    const later = action({ action_id: 'approval-b', queue_order: undefined, requested_at_ms: 2 });
    const earlier = action({ action_id: 'approval-a', queue_order: undefined, requested_at_ms: 1 });
    const tie = action({ action_id: 'approval-c', queue_order: undefined, requested_at_ms: 1 });

    expect(flowerPendingApprovalActions(thread([later, tie, earlier])).map((candidate) => candidate.action_id))
      .toEqual(['approval-a', 'approval-c', 'approval-b']);
  });
});
