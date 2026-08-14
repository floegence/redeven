import { describe, expect, it } from 'vitest';

import type { FlowerApprovalAction, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { flowerComposerApprovalAction } from './approvalAction';

const action = (overrides: Partial<FlowerApprovalAction> = {}): FlowerApprovalAction => ({
  action_id: 'approval-1', origin: 'main_tool', run_id: 'turn-1', tool_id: 'tool-1', tool_name: 'terminal.exec',
  state: 'requested', status: 'pending', requested_at_ms: 1, can_approve: true,
  surface_role: 'primary_action', summary: { label: 'terminal.exec' }, ...overrides,
} as FlowerApprovalAction);

const thread = (actions: readonly FlowerApprovalAction[]): FlowerThreadSnapshot => ({
  thread_id: 'thread-1', title: 'Approval', title_status: 'ready', model_id: 'model', working_dir: '/',
  created_at_ms: 1, updated_at_ms: 2, status: 'waiting_approval', source_label: 'Local', target_labels: [], messages: [],
  approval_actions: actions,
  read_status: { is_unread: false, snapshot: { activity_revision: 1, last_message_at_unix_ms: 1, activity_signature: 'a' }, read_state: { last_seen_activity_revision: 1, last_read_message_at_unix_ms: 1, last_seen_activity_signature: 'a' } },
});

describe('flowerComposerApprovalAction', () => {
  it('selects only the actionable current item from the server view', () => {
    const locator = action({ action_id: 'approval-2', tool_id: 'tool-2', surface_role: 'locator', can_approve: false });
    expect(flowerComposerApprovalAction(thread([action(), locator]))?.action_id).toBe('approval-1');
    expect(flowerComposerApprovalAction(thread([locator]))).toBeNull();
  });
});
