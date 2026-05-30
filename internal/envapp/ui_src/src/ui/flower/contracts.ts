export type FlowerHostKind = 'global' | 'env_local';

export type FlowerCarrierKind = 'desktop' | 'server';

export type FlowerHostPresenceState =
  | 'online'
  | 'offline'
  | 'stale'
  | 'degraded'
  | 'auth_required'
  | 'capability_missing';

export type FlowerRoute =
  | 'flower_host'
  | 'env_local'
  | 'blocked'
  | 'needs_clarification';

export type FlowerRouterReasonCode =
  | 'host_available'
  | 'host_unavailable'
  | 'current_env_only'
  | 'cross_env_requires_flower_host'
  | 'target_ambiguous'
  | 'target_unreachable'
  | 'target_unauthorized'
  | 'thread_read_only';

export type FlowerChipKind = 'host' | 'source' | 'targets' | 'mode';

export type FlowerChipTone = 'normal' | 'muted' | 'warning' | 'danger';

export type FlowerUIChip = Readonly<{
  kind: FlowerChipKind;
  label: string;
  tone: FlowerChipTone;
}>;

export type FlowerHostPresenceView = Readonly<{
  host_id: string;
  host_kind: FlowerHostKind;
  carrier_kind?: FlowerCarrierKind;
  state: FlowerHostPresenceState;
}>;

export type FlowerActionDangerLevel = 'normal' | 'write' | 'destructive' | 'admin';

export type FlowerActionPresentationHint =
  | 'primary'
  | 'secondary'
  | 'decision_card'
  | 'primary_footer'
  | 'thread_row'
  | 'menu_item';

export type FlowerActionViewModel = Readonly<{
  kind: string;
  label: string;
  enabled: boolean;
  disabled_reason?: string;
  requires_confirmation: boolean;
  danger_level: FlowerActionDangerLevel;
  presentation_hint: FlowerActionPresentationHint;
}>;

export type FlowerRouterDecision = Readonly<{
  decision_id: string;
  route: FlowerRoute;
  reason_code: FlowerRouterReasonCode;
  host_presence: FlowerHostPresenceView | null;
  current_target_id?: string;
  allowed_actions: readonly string[];
  ui_chips: readonly FlowerUIChip[];
  primary_message?: string;
  blocker?: Readonly<{
    code: FlowerRouterReasonCode;
    message: string;
  }> | null;
}>;

export type FlowerAccessState =
  | 'available_here'
  | 'available_on_flower_host'
  | 'on_another_host'
  | 'read_only'
  | 'archived';

export type FlowerRunState =
  | 'idle'
  | 'context_ready'
  | 'running'
  | 'needs_clarification'
  | 'planning_write'
  | 'awaiting_approval'
  | 'applying'
  | 'blocked'
  | 'completed';

export type FlowerTransferPlanState =
  | 'none'
  | 'building'
  | 'ready'
  | 'blocked'
  | 'expired'
  | 'applying'
  | 'partially_completed'
  | 'failed'
  | 'succeeded';

export type FlowerApprovalState = 'not_required' | 'pending' | 'approved' | 'expired' | 'rejected';

export type FlowerUIState = Readonly<{
  thread_id?: string;
  access_state: FlowerAccessState;
  read_only_reason?: string;
  router_state: FlowerRoute;
  host_presence_state: FlowerHostPresenceState;
  run_state: FlowerRunState;
  transfer_plan_state: FlowerTransferPlanState;
  approval_state: FlowerApprovalState;
  primary_action: FlowerActionViewModel | null;
  secondary_actions: readonly FlowerActionViewModel[];
}>;

export type FlowerThreadKind = 'chat' | 'task' | 'handoff' | 'archived';

export type FlowerThreadListItem = Readonly<{
  thread_id: string;
  title: string;
  kind: FlowerThreadKind;
  home_host_id: string;
  home_host_kind: FlowerHostKind;
  access_state: FlowerAccessState;
  read_only_reason?: string;
  summary?: string;
  source_label?: string;
  target_labels: readonly string[];
  last_message_preview?: string;
  last_activity_at_unix_ms: number;
  primary_action: FlowerActionViewModel;
  secondary_actions: readonly FlowerActionViewModel[];
}>;

export type FlowerSurfacePresentationKind = 'global_panel' | 'standalone_window' | 'workbench_embedded';

export type FlowerSurfaceSourceContainerKind =
  | 'flower_host_shell'
  | 'env_app_topbar'
  | 'env_app_context_action'
  | 'workbench';

export type FlowerSurfaceInstance = Readonly<{
  surface_id: string;
  thread_id?: string;
  presentation_kind: FlowerSurfacePresentationKind;
  host_id?: string;
  source_container: Readonly<{
    kind: FlowerSurfaceSourceContainerKind;
    env_public_id?: string;
    workbench_id?: string;
  }>;
  layout: Readonly<{
    dock?: 'left' | 'right' | 'bottom';
    width_px?: number;
    height_px?: number;
    is_pinned?: boolean;
  }>;
  state: 'active' | 'inactive';
}>;

export type FlowerActivityKind =
  | 'understand_context'
  | 'target_rank'
  | 'target_connect'
  | 'source_scan'
  | 'destination_preview'
  | 'transfer_plan'
  | 'approval'
  | 'transfer_apply'
  | 'tool_call'
  | 'handoff';

export type FlowerActivityStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'canceled';

export type FlowerActivityEvent = Readonly<{
  activity_id: string;
  run_id: string;
  kind: FlowerActivityKind;
  target_ids: readonly string[];
  status: FlowerActivityStatus;
  started_at_unix_ms: number;
  ended_at_unix_ms?: number;
  user_visible_summary: string;
  reason_code?: string;
  diagnostic_ref?: string;
}>;

export type FlowerTransferPlanItemKind = 'file' | 'directory' | 'symlink' | 'unknown';

export type FlowerTransferPreviewStatus =
  | 'new'
  | 'same'
  | 'replace'
  | 'conflict'
  | 'skipped_by_policy'
  | 'blocked'
  | 'unreadable';

export type FlowerTransferItemDecision = 'add' | 'replace' | 'skip' | 'review' | 'block';

export type FlowerTransferExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'canceled';

export type FlowerTransferPlanItem = Readonly<{
  item_id: string;
  path: string;
  relative_path: string;
  item_kind: FlowerTransferPlanItemKind;
  source_hash?: string;
  destination_hash?: string;
  source_size?: number;
  destination_size?: number;
  preview_status: FlowerTransferPreviewStatus;
  decision: FlowerTransferItemDecision;
  policy_ref?: string;
  blocked_reason?: string;
  execution_status: FlowerTransferExecutionStatus;
}>;

export type FlowerTransferExecutionItemResult = Readonly<{
  item_id: string;
  path: string;
  status: FlowerTransferExecutionStatus;
  bytes_written: number;
  error_code?: string;
  error_message?: string;
}>;

export type FlowerTransferApplyDisabledReason =
  | 'none'
  | 'plan_building'
  | 'plan_hash_expired'
  | 'thread_read_only'
  | 'destination_write_denied'
  | 'blocked_items_present'
  | 'job_running'
  | 'job_finished';

export type FlowerTransferPreviewModel = Readonly<{
  plan_id: string;
  plan_hash: string;
  summary: Readonly<{
    source_label: string;
    destination_label: string;
    file_count: number;
    total_bytes: number;
    conflict_count: number;
    blocked_count: number;
  }>;
  items: readonly FlowerTransferPlanItem[];
  apply_state: Readonly<{
    enabled: boolean;
    disabled_reason: FlowerTransferApplyDisabledReason;
  }>;
}>;

export function createFlowerAction(params: {
  kind: string;
  label: string;
  enabled?: boolean;
  disabledReason?: string;
  requiresConfirmation?: boolean;
  dangerLevel?: FlowerActionDangerLevel;
  presentationHint?: FlowerActionPresentationHint;
}): FlowerActionViewModel {
  const enabled = params.enabled ?? true;
  return {
    kind: params.kind,
    label: params.label,
    enabled,
    disabled_reason: enabled ? '' : String(params.disabledReason ?? '').trim(),
    requires_confirmation: params.requiresConfirmation ?? false,
    danger_level: params.dangerLevel ?? 'normal',
    presentation_hint: params.presentationHint ?? 'secondary',
  };
}

const CHIP_ORDER: Record<FlowerChipKind, number> = {
  host: 0,
  source: 1,
  targets: 2,
  mode: 3,
};

export function normalizeFlowerUIChips(chips: readonly FlowerUIChip[]): FlowerUIChip[] {
  return [...chips].sort((a, b) => CHIP_ORDER[a.kind] - CHIP_ORDER[b.kind]);
}

export function buildFlowerRouterDecision(params: {
  decisionId: string;
  route: FlowerRoute;
  reasonCode: FlowerRouterReasonCode;
  hostPresence?: FlowerHostPresenceView | null;
  currentTargetId?: string;
  allowedActions?: readonly string[];
  uiChips: readonly FlowerUIChip[];
  primaryMessage?: string;
  blocker?: FlowerRouterDecision['blocker'];
}): FlowerRouterDecision {
  return {
    decision_id: params.decisionId,
    route: params.route,
    reason_code: params.reasonCode,
    host_presence: params.hostPresence ?? null,
    current_target_id: params.currentTargetId,
    allowed_actions: params.allowedActions ?? [],
    ui_chips: normalizeFlowerUIChips(params.uiChips),
    primary_message: params.primaryMessage,
    blocker: params.blocker ?? null,
  };
}

export function deriveTransferApplyState(params: {
  planBuilding?: boolean;
  planHashExpired?: boolean;
  threadReadOnly?: boolean;
  destinationWriteDenied?: boolean;
  jobRunning?: boolean;
  jobFinished?: boolean;
  items: readonly Pick<FlowerTransferPlanItem, 'decision' | 'preview_status'>[];
}): FlowerTransferPreviewModel['apply_state'] {
  if (params.planBuilding) return { enabled: false, disabled_reason: 'plan_building' };
  if (params.planHashExpired) return { enabled: false, disabled_reason: 'plan_hash_expired' };
  if (params.threadReadOnly) return { enabled: false, disabled_reason: 'thread_read_only' };
  if (params.destinationWriteDenied) return { enabled: false, disabled_reason: 'destination_write_denied' };
  if (params.jobRunning) return { enabled: false, disabled_reason: 'job_running' };
  if (params.jobFinished) return { enabled: false, disabled_reason: 'job_finished' };
  const hasBlockedItems = params.items.some((item) => item.decision === 'block' || item.preview_status === 'blocked');
  if (hasBlockedItems) return { enabled: false, disabled_reason: 'blocked_items_present' };
  return { enabled: true, disabled_reason: 'none' };
}

export function createFlowerSurfaceInstance(params: {
  surfaceId: string;
  presentationKind: FlowerSurfacePresentationKind;
  sourceContainerKind: FlowerSurfaceSourceContainerKind;
  threadId?: string;
  hostId?: string;
  envPublicId?: string;
  workbenchId?: string;
  dock?: 'left' | 'right' | 'bottom';
  widthPx?: number;
  heightPx?: number;
  isPinned?: boolean;
  active?: boolean;
}): FlowerSurfaceInstance {
  return {
    surface_id: params.surfaceId,
    thread_id: params.threadId,
    presentation_kind: params.presentationKind,
    host_id: params.hostId,
    source_container: {
      kind: params.sourceContainerKind,
      env_public_id: params.envPublicId,
      workbench_id: params.workbenchId,
    },
    layout: {
      dock: params.dock,
      width_px: params.widthPx,
      height_px: params.heightPx,
      is_pinned: params.isPinned,
    },
    state: params.active === false ? 'inactive' : 'active',
  };
}
