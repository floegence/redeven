import { describe, expect, it } from 'vitest';

import type { FlowerApprovalAction, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { approvalDecisionProjection, flowerComposerApprovalAction } from './approvalDecisionHandoff';

type MainApprovalAction = Exclude<FlowerApprovalAction, { origin: 'delegated_subagent' }>;

const action = (overrides: Partial<MainApprovalAction> = {}): MainApprovalAction => ({
  action_id: 'approval-1',
  origin: 'main_tool',
  run_id: 'run-1',
  tool_id: 'tool-1',
  tool_name: 'terminal.exec',
  state: 'requested',
  status: 'pending',
  revision: 1,
  version: 1,
  surface_role: 'primary_action',
  requested_at_ms: 1,
  can_approve: true,
  summary: { label: 'terminal.exec', command: 'true' },
  ...overrides,
});

const thread = (overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot => ({
  thread_id: 'thread-1',
  title: 'Approval thread',
  model_id: 'default/test',
  working_dir: '/workspace',
  created_at_ms: 1,
  updated_at_ms: 2,
  status: 'waiting_approval',
  source_label: 'Local',
  target_labels: [],
  messages: [],
  approval_actions: [action()],
  approval_queue: {
    generation: 1,
    revision: 1,
    current_action_id: 'approval-1',
    current_position: 1,
    total: 1,
    unresolved_count: 1,
  },
  read_status: {
    is_unread: false,
    snapshot: { activity_revision: 1, last_message_at_unix_ms: 1, activity_signature: 'test' },
    read_state: { last_seen_activity_revision: 1, last_read_message_at_unix_ms: 1, last_seen_activity_signature: 'test' },
  },
  ...overrides,
});

describe('approval decision handoff projection', () => {
  it('selects only the actionable queue head', () => {
    const queued = action({ action_id: 'approval-2', tool_id: 'tool-2', surface_role: 'locator', can_approve: false });
    const snapshot = thread({ approval_actions: [action(), queued] });

    expect(flowerComposerApprovalAction(snapshot)?.action_id).toBe('approval-1');
  });

  it('distinguishes the current action, the promoted action, and a transient promotion gap', () => {
    expect(approvalDecisionProjection(thread(), 'approval-1').kind).toBe('current_action');

    const next = action({ action_id: 'approval-2', tool_id: 'tool-2' });
    expect(approvalDecisionProjection(thread({
      approval_actions: [next],
      approval_queue: { generation: 1, revision: 2, current_action_id: 'approval-2', current_position: 2, total: 2, unresolved_count: 1 },
    }), 'approval-1')).toEqual({ kind: 'next_action', action: next });

    expect(approvalDecisionProjection(thread({
      approval_actions: [action({ action_id: 'approval-2', tool_id: 'tool-2', surface_role: 'locator', can_approve: false })],
      approval_queue: { generation: 1, revision: 2, current_action_id: 'approval-2', current_position: 2, total: 2, unresolved_count: 1 },
    }), 'approval-1').kind).toBe('waiting');
  });

  it('clears only for explicit empty approval state or a terminal thread', () => {
    expect(approvalDecisionProjection(thread({ approval_actions: [], approval_queue: null }), 'approval-1').kind).toBe('queue_cleared');
    expect(approvalDecisionProjection(thread({ approval_actions: [], approval_queue: undefined }), 'approval-1').kind).toBe('queue_cleared');
    expect(approvalDecisionProjection(thread({ status: 'canceled' }), 'approval-1').kind).toBe('thread_terminal');
    expect(approvalDecisionProjection(thread({ approval_actions: undefined, approval_queue: undefined }), 'approval-1').kind).toBe('waiting');
  });
});
