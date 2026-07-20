import type {
  FlowerApprovalAction,
  FlowerActivityAttentionReason,
  FlowerActivityApprovalState,
  FlowerActivityChip,
  FlowerActivityFileAction,
  FlowerActivityItem,
  FlowerActivityKind,
  FlowerActivityRenderer,
  FlowerActivitySeverity,
  FlowerActivityStatus,
  FlowerActivityTargetRef,
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerInputRequest,
  FlowerDelegatedApprovalRef,
  FlowerLiveBootstrap,
  FlowerLiveBlock,
  FlowerLiveEvent,
  FlowerLiveEventsResponse,
  FlowerLiveMaterializedState,
  FlowerLiveMessageStartedPayload,
  FlowerLiveMessageBlockDeltaPayload,
  FlowerLiveMessageBlockSetPayload,
  FlowerLiveMessageBlockStartedPayload,
  FlowerLiveMessageFailedPayload,
  FlowerLiveThreadPatch,
  FlowerLiveKind,
  FlowerLiveRunState,
  FlowerLiveRunStartedPayload,
  FlowerLiveRunStatusChangedPayload,
  FlowerLiveApprovalPayload,
  FlowerLiveInputRequestedPayload,
  FlowerLiveInputResolvedPayload,
  FlowerLiveModelIOUpdatedPayload,
  FlowerLiveUsageUpdatedPayload,
  FlowerLiveContextCompactionUpdatedPayload,
  FlowerLiveResyncRequiredPayload,
  FlowerContextCompaction,
  FlowerContextUsage,
  FlowerTimelineAnchor,
  FlowerTimelineDecoration,
  FlowerModelIOPhase,
  FlowerModelIOStatus,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerThreadStatus,
  FlowerPermissionType,
  FlowerSubagentSummary,
} from './contracts/flowerSurfaceContracts';
import {
  normalizeFlowerReasoningCapability,
  normalizeFlowerReasoningSelection,
} from './reasoning';

export type FlowerLiveThreadMapperOptions = Readonly<{
  runtimeID: string;
  runtimeKind: FlowerThreadSnapshot['home_runtime_kind'];
  sourceLabel: string;
  targetLabels: readonly string[];
  originEnvPublicID?: string;
}>;

type FlowerMessageBlock = NonNullable<FlowerChatMessage['blocks']>[number];
type FlowerInputQuestion = FlowerInputRequest['questions'][number];
type FlowerInputChoice = NonNullable<FlowerInputQuestion['choices']>[number];
type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' ? value as JsonRecord : null;
}

function plainRecordValue(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function safeAttachmentURL(value: unknown): string | null {
  const raw = trim(value);
  if (!raw) return null;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

function normalizePermissionType(value: unknown): FlowerPermissionType | undefined {
  const raw = trim(value).toLowerCase();
  if (raw === 'readonly' || raw === 'approval_required' || raw === 'full_access') return raw;
  return undefined;
}

function positiveInteger(raw: unknown): number | undefined {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function unixMs(raw: unknown, field: string): number {
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Flower contract error: ${field} must be a positive unix timestamp.`);
  }
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
}

function runStatus(raw: unknown): FlowerThreadStatus {
  switch (trim(raw).toLowerCase()) {
    case '':
    case 'idle':
      return 'idle';
    case 'accepted':
    case 'running':
    case 'recovering':
    case 'finalizing':
      return 'running';
    case 'waiting_approval':
      return 'waiting_approval';
    case 'waiting_user':
      return 'waiting_user';
    case 'failed':
    case 'timed_out':
      return 'failed';
    case 'canceled':
      return 'canceled';
    case 'read_only':
      return 'read_only';
    case 'success':
      return 'success';
    default:
      throw new Error(`Flower contract error: thread.run_status is unsupported: ${trim(raw) || '<empty>'}.`);
  }
}

function inputResponseMode(raw: unknown): FlowerInputQuestion['response_mode'] {
  const mode = trim(raw);
  if (mode !== 'select' && mode !== 'write' && mode !== 'select_or_write') {
    throw new Error('Flower contract error: waiting_prompt question response_mode is invalid.');
  }
  return mode;
}

function nonNegativeInteger(raw: unknown, field: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw new Error(`Flower contract error: ${field} must be a non-negative integer.`);
  }
  return raw;
}

function integerOrZero(raw: unknown): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function positiveIntegerOrOne(raw: unknown): number {
  const value = Number(raw ?? 1);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function modelIOPhase(raw: unknown): FlowerModelIOPhase | null {
  switch (trim(raw)) {
    case 'preparing':
      return 'preparing';
    case 'waiting_response':
      return 'waiting_response';
    case 'streaming':
      return 'streaming';
    case 'retrying':
      return 'retrying';
    case 'finalizing':
      return 'finalizing';
    default:
      return null;
  }
}

function mapModelIOStatus(raw: unknown): FlowerModelIOStatus | null {
  const record = recordValue(raw);
  if (!record) return null;
  const phase = modelIOPhase(record.phase);
  if (!phase) return null;
  const stepIndex = integerOrZero(record.step_index);
  return {
    phase,
    ...(trim(record.run_id) ? { run_id: trim(record.run_id) } : {}),
    ...(stepIndex > 0 ? { step_index: stepIndex } : {}),
    updated_at_ms: integerOrZero(record.updated_at_ms ?? record.updated_at_unix_ms),
  };
}

function clampRatio(raw: unknown): number | undefined {
  const value = Number(raw ?? Number.NaN);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.min(1, value);
}

function optionalInteger(raw: unknown): number | undefined {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function optionalZeroBasedInteger(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function mapContextUsagePhase(raw: unknown): FlowerContextUsage['phase'] {
  switch (trim(raw)) {
    case 'provider_usage':
      return 'provider_usage';
    case 'projected_request':
    default:
      return 'projected_request';
  }
}

function mapContextPressureStatus(raw: unknown): FlowerContextUsage['pressure_status'] {
  switch (trim(raw)) {
    case 'near_threshold':
      return 'near_threshold';
    case 'will_compact':
      return 'will_compact';
    case 'hard_limit':
      return 'hard_limit';
    case 'estimated':
      return 'estimated';
    case 'stable':
    default:
      return 'stable';
  }
}

function mapContextCompactionPhase(raw: unknown): FlowerContextCompaction['phase'] {
  switch (trim(raw)) {
    case 'start':
      return 'start';
    case 'complete':
      return 'complete';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'noop':
      return 'noop';
    default:
      return 'checkpoint';
  }
}

function mapContextCompactionStatus(raw: unknown): FlowerContextCompaction['status'] {
  switch (trim(raw)) {
    case 'compacting':
      return 'compacting';
    case 'compacted':
      return 'compacted';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'noop':
      return 'noop';
    default:
      return 'checkpoint';
  }
}

function mapContextUsage(raw: unknown): FlowerContextUsage | null {
  const record = recordValue(raw);
  if (!record) return null;
  const phase = mapContextUsagePhase(record.phase);
  const pressureStatus = mapContextPressureStatus(record.pressure_status);
  const updatedAt = integerOrZero(record.updated_at_ms ?? record.updated_at_unix_ms);
  const stepIndex = optionalInteger(record.step_index);
  const inputTokens = optionalInteger(record.input_tokens);
  const contextWindowTokens = optionalInteger(record.context_window_tokens);
  const thresholdTokens = optionalInteger(record.threshold_tokens);
  const requestSafeLimitTokens = optionalInteger(record.request_safe_limit_tokens);
  const outputHeadroomTokens = optionalInteger(record.output_headroom_tokens);
  const usedRatio = clampRatio(record.used_ratio);
  const thresholdRatio = clampRatio(record.threshold_ratio);
  return {
    ...(trim(record.run_id) ? { run_id: trim(record.run_id) } : {}),
    ...(stepIndex ? { step_index: stepIndex } : {}),
    phase,
    ...(inputTokens ? { input_tokens: inputTokens } : {}),
    ...(contextWindowTokens ? { context_window_tokens: contextWindowTokens } : {}),
    ...(thresholdTokens ? { threshold_tokens: thresholdTokens } : {}),
    ...(requestSafeLimitTokens ? { request_safe_limit_tokens: requestSafeLimitTokens } : {}),
    ...(outputHeadroomTokens ? { output_headroom_tokens: outputHeadroomTokens } : {}),
    ...(usedRatio !== undefined ? { used_ratio: usedRatio } : {}),
    ...(thresholdRatio !== undefined ? { threshold_ratio: thresholdRatio } : {}),
    pressure_status: pressureStatus,
    ...(trim(record.source) ? { source: trim(record.source) } : {}),
    updated_at_ms: updatedAt,
  };
}

function mapContextCompaction(raw: unknown): FlowerContextCompaction | null {
  const record = recordValue(raw);
  if (!record) return null;
  const operationID = trim(record.operation_id);
  const phase = mapContextCompactionPhase(record.phase);
  const status = mapContextCompactionStatus(record.status);
  const updatedAt = integerOrZero(record.updated_at_ms ?? record.updated_at_unix_ms);
  if (!operationID) return null;
  const stepIndex = optionalInteger(record.step_index);
  const tokensBefore = optionalInteger(record.tokens_before);
  const tokensAfterEstimate = optionalInteger(record.tokens_after_estimate);
  return {
    operation_id: operationID,
    ...(trim(record.run_id) ? { run_id: trim(record.run_id) } : {}),
    ...(stepIndex ? { step_index: stepIndex } : {}),
    phase,
    status,
    ...(trim(record.trigger) ? { trigger: trim(record.trigger) } : {}),
    ...(trim(record.reason) ? { reason: trim(record.reason) } : {}),
    ...(tokensBefore ? { tokens_before: tokensBefore } : {}),
    ...(tokensAfterEstimate ? { tokens_after_estimate: tokensAfterEstimate } : {}),
    ...(trim(record.error) ? { error: trim(record.error) } : {}),
    updated_at_ms: updatedAt,
  };
}

function mapTimelineAnchor(raw: unknown): FlowerTimelineAnchor | null {
  const record = recordValue(raw);
  if (!record) return null;
  const targetKind = trim(record.target_kind);
  const messageID = trim(record.message_id);
  const edge = trim(record.edge);
  if (!messageID || (edge !== 'before' && edge !== 'after')) return null;
  const blockIndex = optionalZeroBasedInteger(record.block_index);
  const activityItemID = trim(record.activity_item_id);
  if (targetKind === 'message') {
    if (blockIndex !== undefined || activityItemID) return null;
  } else if (targetKind === 'block') {
    if (blockIndex === undefined || activityItemID) return null;
  } else if (targetKind === 'activity_item') {
    if (blockIndex === undefined || !activityItemID) return null;
  } else {
    return null;
  }
  return {
    target_kind: targetKind,
    message_id: messageID,
    ...(blockIndex !== undefined ? { block_index: blockIndex } : {}),
    ...(activityItemID ? { activity_item_id: activityItemID } : {}),
    edge,
  };
}

function mapTimelineDecoration(raw: unknown): FlowerTimelineDecoration | null {
  const record = recordValue(raw);
  if (!record) return null;
  const anchor = mapTimelineAnchor(record.anchor);
  const decorationID = trim(record.decoration_id);
  const kind = trim(record.kind);
  if (!decorationID || !anchor) return null;
  const base = {
    decoration_id: decorationID,
    anchor,
    ordinal: integerOrZero(record.ordinal),
  };
  if (kind === 'context_compaction') {
    const compaction = mapContextCompaction(record.compaction);
    if (!compaction || record.projection_unavailable !== undefined) return null;
    return { ...base, kind, compaction };
  }
  if (kind === 'turn_projection_unavailable') {
    const payload = recordValue(record.projection_unavailable);
    const reason = trim(payload?.reason);
    if (
      record.compaction !== undefined
      || !payload
      || !trim(payload.turn_id)
      || !trim(payload.run_id)
      || !trim(payload.expected_message_id)
      || reason !== 'not_renderable'
      || anchor.target_kind !== 'message'
      || anchor.edge !== 'after'
    ) return null;
    return {
      ...base,
      kind,
      projection_unavailable: {
        turn_id: trim(payload.turn_id),
        run_id: trim(payload.run_id),
        expected_message_id: trim(payload.expected_message_id),
        reason,
      },
    };
  }
  return null;
}

function mapContextCompactions(raw: unknown): readonly FlowerContextCompaction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const compactions = raw.map(mapContextCompaction).filter(isPresent);
  return compactions.length > 0 ? compactions : undefined;
}

function mapContextCompactionsSnapshot(raw: unknown): readonly FlowerContextCompaction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map(mapContextCompaction).filter(isPresent);
}

function mapTimelineDecorations(raw: unknown): readonly FlowerTimelineDecoration[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const decorations = raw.map((value) => {
    const decoration = mapTimelineDecoration(value);
    if (!decoration) {
      throw new Error('Flower contract error: timeline_decorations requires valid decoration payloads.');
    }
    return decoration;
  });
  return decorations.length > 0 ? decorations : undefined;
}

function mapTimelineDecorationsSnapshot(raw: unknown): readonly FlowerTimelineDecoration[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((value) => {
    const decoration = mapTimelineDecoration(value);
    if (!decoration) {
      throw new Error('Flower contract error: timeline_decorations requires valid decoration payloads.');
    }
    return decoration;
  });
}

function stringRecord(raw: unknown): Readonly<Record<string, string>> | undefined {
  const record = plainRecordValue(raw);
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const safeKey = trim(key);
    const safeValue = trim(value);
    if (safeKey && safeValue) out[safeKey] = safeValue;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const activityStatuses = new Set<FlowerActivityStatus>(['pending', 'running', 'waiting', 'success', 'error', 'canceled']);
const activitySeverities = new Set<FlowerActivitySeverity>(['quiet', 'normal', 'warning', 'error', 'blocking']);
const activityKinds = new Set<FlowerActivityKind>(['tool', 'hosted_tool', 'control', 'budget']);
const activityRenderers = new Set<FlowerActivityRenderer>(['structured', 'terminal', 'file', 'patch', 'web_search', 'todos', 'question', 'completion']);
const activityAttentionReasons = new Set<FlowerActivityAttentionReason>(['running', 'waiting', 'approval', 'error']);
const activityApprovalStates = new Set<FlowerActivityApprovalState>(['requested', 'approved', 'rejected', 'timed_out', 'canceled']);

function activityStatus(raw: unknown, field: string): FlowerActivityStatus {
  const value = trim(raw) as FlowerActivityStatus;
  if (!activityStatuses.has(value)) {
    throw new Error(`Flower contract error: ${field} is unsupported: ${trim(raw) || '<empty>'}.`);
  }
  return value;
}

function activitySeverity(raw: unknown, fallback: FlowerActivitySeverity): FlowerActivitySeverity {
  const value = trim(raw) as FlowerActivitySeverity;
  return activitySeverities.has(value) ? value : fallback;
}

function activityKind(raw: unknown): FlowerActivityKind {
  const value = trim(raw) as FlowerActivityKind;
  return activityKinds.has(value) ? value : 'tool';
}

function activityRenderer(raw: unknown): FlowerActivityRenderer | undefined {
  const value = trim(raw) as FlowerActivityRenderer;
  return activityRenderers.has(value) ? value : undefined;
}

function activityAttentionReasonArray(raw: unknown): readonly FlowerActivityAttentionReason[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const values = raw
    .map((value) => trim(value) as FlowerActivityAttentionReason)
    .filter((value) => activityAttentionReasons.has(value));
  return values.length > 0 ? values : undefined;
}

function activityApprovalState(raw: unknown): FlowerActivityApprovalState | undefined {
  const value = trim(raw) as FlowerActivityApprovalState;
  return activityApprovalStates.has(value) ? value : undefined;
}

function activityPolicyToken(key: string): string {
  const source = trim(key);
  let out = '';
  let previousUnderscore = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (char >= 'A' && char <= 'Z') {
      if (index > 0 && !previousUnderscore) {
        out += '_';
      }
      out += char.toLowerCase();
      previousUnderscore = false;
      continue;
    }
    if (char === '-' || char === '.' || char === ':') {
      if (!previousUnderscore) {
        out += '_';
        previousUnderscore = true;
      }
      continue;
    }
    out += char;
    previousUnderscore = char === '_';
  }
  return out.replace(/^_+|_+$/g, '');
}

const activityForbiddenPayloadTokens = new Set([
  'action_path',
  'cwd',
  'directory_path',
  'display_path',
  'file_path',
  'original_file',
  'path',
  'pending_handle',
  'pending_state',
  'pending_tool_result',
  'preview_path',
  'root_dir',
  'stdin',
  'updated_file',
  'workdir',
]);

function assertPublicActivityPayloadKey(path: string, key: string): void {
  if (activityForbiddenPayloadTokens.has(activityPolicyToken(key))) {
    throw new Error(`Flower contract error: ${path}.${key} is not part of the nested activity payload contract.`);
  }
}

function sanitizeActivityPublicValue(value: unknown, path: string): unknown {
  const record = plainRecordValue(value);
  if (record) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      const safeKey = trim(key);
      if (!safeKey) continue;
      assertPublicActivityPayloadKey(path, safeKey);
      out[safeKey] = sanitizeActivityPublicValue(item, `${path}.${safeKey}`);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeActivityPublicValue(item, `${path}[${index}]`));
  }
  return value;
}

function mapActivityPayload(raw: unknown): Readonly<Record<string, unknown>> | undefined {
  const payload = plainRecordValue(raw);
  if (!payload) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const safeKey = trim(key);
    if (!safeKey) continue;
    assertPublicActivityPayloadKey('activity_item.payload', safeKey);
    out[safeKey] = sanitizeActivityPublicValue(value, `activity_item.payload.${safeKey}`);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapActivityChip(raw: unknown): FlowerActivityChip | null {
  const record = plainRecordValue(raw);
  if (!record) return null;
  const kind = trim(record.kind);
  const label = trim(record.label);
  if (!kind || !label) return null;
  return {
    kind,
    label,
    ...(trim(record.value) ? { value: trim(record.value) } : {}),
    ...(trim(record.tone) ? { tone: trim(record.tone) } : {}),
  };
}

function mapActivityTargetRef(raw: unknown, index: number): FlowerActivityTargetRef | null {
  const record = plainRecordValue(raw);
  if (!record) return null;
  const allowed = new Set(['kind', 'label', 'uri', 'line']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`Flower contract error: activity_item.target_refs[${index}].${key} is not part of the activity target ref contract.`);
    }
  }
  const kind = trim(record.kind);
  const label = trim(record.label);
  if (!kind || !label) return null;
  return {
    kind,
    label,
    ...(trim(record.uri) ? { uri: trim(record.uri) } : {}),
    ...(record.line !== undefined ? { line: nonNegativeInteger(record.line, `activity_item.target_refs[${index}].line`) } : {}),
  };
}

function mapActivityTargetRefs(raw: unknown): readonly FlowerActivityTargetRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const refs = raw.map(mapActivityTargetRef).filter(isPresent);
  return refs.length > 0 ? refs : undefined;
}

function mapActivityItem(raw: unknown): FlowerActivityItem | null {
  const record = plainRecordValue(raw);
  if (!record) return null;
  const itemID = trim(record.item_id);
  if (!itemID) return null;
  const chips = Array.isArray(record.chips) ? record.chips.map(mapActivityChip).filter(isPresent) : [];
  const renderer = activityRenderer(record.renderer);
  const targetRefs = mapActivityTargetRefs(record.target_refs);
  const payload = mapActivityPayload(record.payload);
  const metadata = stringRecord(record.metadata);
  const approval = activityApprovalState(record.approval_state);
  const attention = activityAttentionReasonArray(record.attention_reasons);
  return {
    item_id: itemID,
    ...(trim(record.tool_id) ? { tool_id: trim(record.tool_id) } : {}),
    ...(trim(record.tool_name) ? { tool_name: trim(record.tool_name) } : {}),
    kind: activityKind(record.kind),
    status: activityStatus(record.status, 'activity item status'),
    severity: activitySeverity(record.severity, 'normal'),
    needs_attention: Boolean(record.needs_attention),
    ...(attention ? { attention_reasons: attention } : {}),
    requires_approval: Boolean(record.requires_approval),
    ...(approval ? { approval_state: approval } : {}),
    ...(positiveInteger(record.started_at_unix_ms) ? { started_at_unix_ms: positiveInteger(record.started_at_unix_ms) } : {}),
    ...(positiveInteger(record.ended_at_unix_ms) ? { ended_at_unix_ms: positiveInteger(record.ended_at_unix_ms) } : {}),
    ...(trim(record.label) ? { label: trim(record.label) } : {}),
    ...(trim(record.description) ? { description: trim(record.description) } : {}),
    ...(renderer ? { renderer } : {}),
    ...(chips.length > 0 ? { chips } : {}),
    ...(targetRefs ? { target_refs: targetRefs } : {}),
    ...(payload ? { payload } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function mapActivityCounts(raw: unknown): FlowerActivityTimelineBlock['summary']['counts'] {
  const record = plainRecordValue(raw) ?? {};
  const out: Record<string, number> = {};
  for (const key of ['pending', 'running', 'waiting', 'success', 'error', 'canceled', 'approval']) {
    const value = integerOrZero(record[key]);
    if (value > 0) out[key] = value;
  }
  return out;
}

function mapActivityFileAction(raw: unknown, actionKey: string): FlowerActivityFileAction | null {
  const record = plainRecordValue(raw);
  if (!record) return null;
  const allowed = new Set(['action_id', 'display_name', 'can_preview', 'can_browse_directory']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`Flower contract error: activity_timeline.file_actions.${actionKey}.${key} is not part of the file action contract.`);
    }
  }
  const actionID = trim(record.action_id);
  const displayName = trim(record.display_name);
  if (!actionID || !displayName) return null;
  return {
    action_id: actionID,
    display_name: displayName,
    can_preview: Boolean(record.can_preview),
    can_browse_directory: Boolean(record.can_browse_directory),
  };
}

function mapActivityFileActions(raw: unknown): Readonly<Record<string, FlowerActivityFileAction>> | undefined {
  const record = plainRecordValue(raw);
  if (!record) return undefined;
  const out: Record<string, FlowerActivityFileAction> = {};
  for (const [key, value] of Object.entries(record)) {
    const actionKey = trim(key);
    if (!actionKey) continue;
    const action = mapActivityFileAction(value, actionKey);
    if (action) out[actionKey] = action;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapActivityTimelineBlock(raw: unknown): FlowerActivityTimelineBlock | null {
  const record = plainRecordValue(raw);
  if (!record || trim(record.type) !== 'activity-timeline') return null;
  const runID = trim(record.run_id);
  const threadID = trim(record.thread_id);
  const turnID = trim(record.turn_id);
  if (!runID || !threadID || !turnID) return null;
  const items = Array.isArray(record.items) ? record.items.map(mapActivityItem).filter(isPresent) : [];
  const summary = plainRecordValue(record.summary) ?? {};
  const attention = activityAttentionReasonArray(summary.attention_reasons);
  const fileActions = mapActivityFileActions(record.file_actions);
  return {
    type: 'activity-timeline',
    schema_version: positiveInteger(record.schema_version) ?? 1,
    run_id: runID,
    thread_id: threadID,
    turn_id: turnID,
    ...(trim(record.trace_id) ? { trace_id: trim(record.trace_id) } : {}),
    summary: {
      status: activityStatus(summary.status, 'activity summary status'),
      severity: activitySeverity(summary.severity, 'quiet'),
      needs_attention: Boolean(summary.needs_attention),
      ...(attention ? { attention_reasons: attention } : {}),
      total_items: integerOrZero(summary.total_items) || items.length,
      counts: mapActivityCounts(summary.counts),
      ...(positiveInteger(summary.duration_ms) ? { duration_ms: positiveInteger(summary.duration_ms) } : {}),
    },
    items,
    ...(fileActions ? { file_actions: fileActions } : {}),
  };
}

export function mapFlowerReadStatus(raw: unknown): FlowerThreadReadStatus {
  const record = recordValue(raw);
  if (!record) {
    throw new Error('Flower contract error: thread.read_status is required.');
  }
  const snapshot = recordValue(record.snapshot);
  const readState = recordValue(record.read_state);
  if (!snapshot) {
    throw new Error('Flower contract error: thread.read_status.snapshot is required.');
  }
  if (!readState) {
    throw new Error('Flower contract error: thread.read_status.read_state is required.');
  }
  return {
    is_unread: Boolean(record.is_unread),
    snapshot: {
      activity_revision: Math.max(0, Math.floor(Number(snapshot.activity_revision ?? 0))),
      last_message_at_unix_ms: Math.max(0, Math.floor(Number(snapshot.last_message_at_unix_ms ?? 0))),
      activity_signature: trim(snapshot.activity_signature),
      ...(trim(snapshot.waiting_prompt_id) ? { waiting_prompt_id: trim(snapshot.waiting_prompt_id) } : {}),
    },
    read_state: {
      last_seen_activity_revision: Math.max(0, Math.floor(Number(readState.last_seen_activity_revision ?? 0))),
      last_read_message_at_unix_ms: Math.max(0, Math.floor(Number(readState.last_read_message_at_unix_ms ?? 0))),
      last_seen_activity_signature: trim(readState.last_seen_activity_signature),
      ...(trim(readState.last_seen_waiting_prompt_id) ? { last_seen_waiting_prompt_id: trim(readState.last_seen_waiting_prompt_id) } : {}),
    },
  };
}

function mapFlowerSubagentSummary(raw: unknown): FlowerSubagentSummary | null {
  const record = plainRecordValue(raw);
  if (!record) return null;
  const threadID = trim(record.thread_id);
  const taskName = trim(record.task_name);
  if (!threadID || !taskName) return null;
  const createdAtMs = integerOrZero(record.created_at_ms ?? record.created_at_unix_ms);
  const updatedAtMs = integerOrZero(record.updated_at_ms ?? record.updated_at_unix_ms);
  const queuedInputs = integerOrZero(record.queued_inputs);
  return {
    parent_thread_id: trim(record.parent_thread_id),
    thread_id: threadID,
    task_name: taskName,
    ...(trim(record.task_description) ? { task_description: trim(record.task_description) } : {}),
    ...(trim(record.agent_type) ? { agent_type: trim(record.agent_type) } : {}),
    ...(trim(record.context_mode) ? { context_mode: trim(record.context_mode) } : {}),
    status: trim(record.status) || 'unknown',
    ...(trim(record.last_message) ? { last_message: trim(record.last_message) } : {}),
    ...(trim(record.waiting_prompt) ? { waiting_prompt: trim(record.waiting_prompt) } : {}),
    ...(queuedInputs > 0 ? { queued_inputs: queuedInputs } : {}),
    can_send_input: Boolean(record.can_send_input),
    can_interrupt: Boolean(record.can_interrupt),
    can_close: Boolean(record.can_close),
    ...(createdAtMs > 0 ? { created_at_ms: createdAtMs } : {}),
    ...(updatedAtMs > 0 ? { updated_at_ms: updatedAtMs } : {}),
  };
}

function mapFlowerSubagents(raw: unknown, field: string): readonly FlowerSubagentSummary[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`Flower contract error: ${field} must be an array.`);
  }
  return raw
    .map((value) => mapFlowerSubagentSummary(value))
    .filter((value): value is FlowerSubagentSummary => value !== null);
}

function mapInputRequest(prompt: unknown): FlowerInputRequest | null {
  const record = recordValue(prompt);
  if (!record) return null;
  const promptID = trim(record.prompt_id);
  const messageID = trim(record.message_id);
  const toolID = trim(record.tool_id);
  const toolName = trim(record.tool_name);
  const questionsRaw = Array.isArray(record.questions) ? record.questions : [];
  if (!promptID || !messageID || !toolID || !toolName) {
    throw new Error('Flower contract error: waiting_prompt requires prompt_id, message_id, tool_id, and tool_name.');
  }
	if (questionsRaw.length === 0) {
		throw new Error('Flower contract error: waiting_prompt requires at least one question.');
	}
	const reasoningSelection = normalizeFlowerReasoningSelection(record.reasoning_selection);
	return {
		prompt_id: promptID,
		message_id: messageID,
		tool_id: toolID,
		tool_name: toolName,
		...(trim(record.reason_code) ? { reason_code: trim(record.reason_code) } : {}),
		...(reasoningSelection ? { reasoning_selection: reasoningSelection } : {}),
		...(Array.isArray(record.required_from_user) ? { required_from_user: record.required_from_user.map(trim).filter(Boolean) } : {}),
		...(Array.isArray(record.evidence_refs) ? { evidence_refs: record.evidence_refs.map(trim).filter(Boolean) } : {}),
    questions: questionsRaw.map((questionValue): FlowerInputQuestion => {
      const question = recordValue(questionValue) ?? {};
      const responseMode = inputResponseMode(question.response_mode);
      return {
        id: trim(question.id),
        header: trim(question.header),
        question: trim(question.question),
        ...(question.is_secret !== undefined ? { is_secret: Boolean(question.is_secret) } : {}),
        response_mode: responseMode,
        ...(question.choices_exhaustive !== undefined ? { choices_exhaustive: Boolean(question.choices_exhaustive) } : {}),
        ...(trim(question.write_label) ? { write_label: trim(question.write_label) } : {}),
        ...(trim(question.write_placeholder) ? { write_placeholder: trim(question.write_placeholder) } : {}),
        ...(Array.isArray(question.choices) ? {
          choices: question.choices.map((choiceValue): FlowerInputChoice => {
            const choice = recordValue(choiceValue) ?? {};
            return {
              choice_id: trim(choice.choice_id),
              label: trim(choice.label),
              ...(trim(choice.description) ? { description: trim(choice.description) } : {}),
              kind: 'select' as const,
              ...(trim(choice.input_placeholder) ? { input_placeholder: trim(choice.input_placeholder) } : {}),
              ...(Array.isArray(choice.actions) ? {
                actions: choice.actions.map((actionValue) => {
                  const action = recordValue(actionValue) ?? {};
                  return {
                    type: trim(action.type),
                  };
                }).filter((action) => action.type),
              } : {}),
            };
          }).filter((choice) => choice.choice_id && choice.label),
        } : {}),
      };
    }).filter((question) => question.id && question.header && question.question),
    ...(trim(record.public_summary) ? { public_summary: trim(record.public_summary) } : {}),
    ...(record.contains_secret !== undefined ? { contains_secret: Boolean(record.contains_secret) } : {}),
  };
}

function messageBlockPreviewText(block: FlowerMessageBlock): string {
  if (block.type === 'markdown' || block.type === 'text') return trim(block.content);
  return '';
}

function mapLiveBlock(blockValue: unknown): FlowerLiveBlock | null {
  const block = recordValue(blockValue);
  if (!block) return null;
  const type = trim(block.type);
  if (type === 'markdown' || type === 'text' || type === 'thinking') {
    return {
      type,
      ...(typeof block.content === 'string' ? { content: block.content } : {}),
    };
  }
  if (type === 'activity-timeline') {
    const activity = mapActivityTimelineBlock(block.block ?? block);
    return activity ? { type: 'activity-timeline', block: activity } : null;
  }
  return null;
}

function mapMessageBlock(blockValue: unknown): FlowerMessageBlock | null {
  const block = recordValue(blockValue);
  if (!block) return null;
  const type = trim(block?.type);
  if (type === 'markdown' || type === 'text' || type === 'thinking') {
    return { type, content: typeof block.content === 'string' ? block.content : '' };
  }
  if (type === 'image') {
    const src = safeAttachmentURL(block.src);
    if (!src) return null;
    const alt = trim(block.alt);
    return { type: 'image', src, ...(alt ? { alt } : {}) };
  }
  if (type === 'file') {
    const name = trim(block.name);
    const mimeType = trim(block.mimeType);
    const url = safeAttachmentURL(block.url);
    const size = Number(block.size);
    if (!name || !mimeType || !url || !Number.isFinite(size) || size < 0) return null;
    return { type: 'file', name, mimeType, url, size: Math.floor(size) };
  }
  if (type === 'activity-timeline') {
    return mapActivityTimelineBlock(blockValue);
  }
  return null;
}

function mapMessageStatus(raw: unknown): FlowerChatMessage['status'] {
  const status = trim(raw) as FlowerChatMessage['status'];
  if (status === 'sending' || status === 'streaming' || status === 'error' || status === 'complete' || status === 'canceled') {
    return status;
  }
  throw new Error('Flower contract error: timeline message has invalid status.');
}

export function mapFlowerMessage(raw: unknown): FlowerChatMessage {
  const message = recordValue(raw);
  if (!message) throw new Error('Flower contract error: timeline message must be an object.');
  const id = trim(message.id);
  const threadID = trim(message.thread_id);
  const turnID = trim(message.turn_id);
  const runID = trim(message.run_id);
  const role = trim(message.role).toLowerCase();
  if (!id) throw new Error('Flower contract error: timeline message requires id.');
  if (role !== 'user' && role !== 'assistant' && role !== 'system') {
    throw new Error(`Flower contract error: timeline message ${id} has invalid role.`);
  }
  if (!threadID) throw new Error(`Flower contract error: timeline message ${id} requires thread_id.`);
  if (!turnID) throw new Error(`Flower contract error: timeline message ${id} requires turn_id.`);
  if (!runID) throw new Error(`Flower contract error: timeline message ${id} requires run_id.`);
  if (message.blocks !== undefined && !Array.isArray(message.blocks)) {
    throw new Error(`Flower contract error: timeline message ${id} blocks must be an array.`);
  }
  const blocksRaw = Array.isArray(message.blocks) ? message.blocks : [];
  const blocks = blocksRaw.map((block, index) => {
    const mapped = mapMessageBlock(block);
    if (!mapped) throw new Error(`Flower contract error: timeline message ${id} block ${index} is invalid.`);
    if (
      mapped.type === 'activity-timeline'
      && (mapped.thread_id !== threadID || mapped.turn_id !== turnID || mapped.run_id !== runID)
    ) {
      throw new Error(`Flower contract error: timeline message ${id} activity block ${index} has mismatched identity.`);
    }
    return mapped;
  });
  const contextAction = recordValue(message.context_action);
  const blockContent = blocks.map(messageBlockPreviewText).filter(Boolean).join('\n\n');
  const content = blockContent || trim(message.content);
  return {
    id,
    thread_id: threadID,
    turn_id: turnID,
    run_id: runID,
    role,
    content,
    status: mapMessageStatus(message.status),
    created_at_ms: unixMs(message.timestamp ?? message.created_at_ms ?? message.created_at_unix_ms, 'message.timestamp'),
    ...(blocks.length > 0 ? { blocks } : {}),
    ...(contextAction ? { context_action: contextAction } : {}),
    ...(message.live !== undefined ? { live: Boolean(message.live) } : {}),
    ...(message.active_cursor !== undefined ? { active_cursor: Boolean(message.active_cursor) } : {}),
  };
}

function mapFlowerQueuedTurns(raw: unknown): FlowerThreadSnapshot['queued_turns'] {
  if (!Array.isArray(raw)) return undefined;
  const turns = raw.map((value, index) => {
    const record = recordValue(value);
    if (!record) throw new Error(`Flower contract error: queued turn ${index} must be an object.`);
    const turnID = trim(record.turn_id);
    if (!turnID) throw new Error('Flower contract error: queued turn requires turn_id.');
    const contextAction = recordValue(record.context_action);
    return {
      turn_id: turnID,
      prompt: trim(record.text),
      created_at_ms: unixMs(record.created_at_unix_ms, 'queued_turn.created_at_unix_ms'),
      ...(contextAction ? { context_action: contextAction } : {}),
    };
  });
  return turns;
}

function mapApprovalAction(raw: unknown): FlowerApprovalAction | null {
  const record = recordValue(raw);
  if (!record) return null;
  const actionID = trim(record.action_id);
  if (!actionID) return null;
  const rawOrigin = trim(record.origin);
  const origin = rawOrigin === 'delegated_subagent' || rawOrigin === 'control_confirm' ? rawOrigin : 'main_tool';
  const runID = trim(record.run_id);
  const toolID = trim(record.tool_id);
  const summary = recordValue(record.summary) ?? {};
  const delegatedRefRecord = recordValue(record.delegated_ref);
  const rawSurfaceRole = trim(record.surface_role);
  const surfaceRole = rawSurfaceRole === 'primary_action' || rawSurfaceRole === 'locator' || rawSurfaceRole === 'mirror'
    ? rawSurfaceRole as NonNullable<FlowerApprovalAction['surface_role']>
    : origin === 'delegated_subagent' ? 'mirror' : undefined;
  const delegatedRef = delegatedRefRecord ? {
    parent_thread_id: trim(delegatedRefRecord.parent_thread_id),
    parent_run_id: trim(delegatedRefRecord.parent_run_id),
    ...(trim(delegatedRefRecord.parent_turn_id) ? { parent_turn_id: trim(delegatedRefRecord.parent_turn_id) } : {}),
    child_thread_id: trim(delegatedRefRecord.child_thread_id),
    child_run_id: trim(delegatedRefRecord.child_run_id),
    ...(trim(delegatedRefRecord.child_turn_id) ? { child_turn_id: trim(delegatedRefRecord.child_turn_id) } : {}),
    child_tool_call_id: trim(delegatedRefRecord.child_tool_call_id),
    approval_id: trim(delegatedRefRecord.approval_id),
  } : null;
  const validDelegatedRef = delegatedRef && delegatedRef.parent_thread_id && delegatedRef.parent_run_id && delegatedRef.child_thread_id && delegatedRef.child_run_id && delegatedRef.child_tool_call_id && delegatedRef.approval_id
    ? delegatedRef
    : null;
  if (origin === 'main_tool' && (!runID || !toolID)) return null;
  const toolName = trim(record.tool_name) || 'tool';
  const base = {
    action_id: actionID,
    origin,
    ...(trim(record.turn_id) ? { turn_id: trim(record.turn_id) } : {}),
    tool_name: toolName,
    state: trim(record.state) as FlowerApprovalAction['state'] || 'requested',
    status: trim(record.status) as FlowerApprovalAction['status'] || 'pending',
    revision: Math.max(0, Math.floor(Number(record.revision ?? 0))),
    version: positiveInteger(record.version) ?? Math.max(1, Math.floor(Number(record.revision ?? 1))),
    ...(positiveInteger(record.surface_epoch) ? { surface_epoch: positiveInteger(record.surface_epoch) } : {}),
    ...(surfaceRole ? { surface_role: surfaceRole } : {}),
    ...(trim(record.scope) ? { scope: trim(record.scope) } : {}),
    requested_at_ms: Math.max(0, Math.floor(Number(record.requested_at_unix_ms ?? 0))),
    ...(positiveInteger(record.resolved_at_unix_ms) ? { resolved_at_ms: positiveInteger(record.resolved_at_unix_ms) } : {}),
    ...(positiveInteger(record.expires_at_unix_ms) ? { expires_at_ms: positiveInteger(record.expires_at_unix_ms) } : {}),
    can_approve: Boolean(record.can_approve),
    ...(positiveInteger(record.expected_seq) ? { expected_seq: positiveInteger(record.expected_seq) } : {}),
    ...(trim(record.read_only_reason) ? { read_only_reason: trim(record.read_only_reason) } : {}),
    ...(trim(record.delivery_state) ? { delivery_state: trim(record.delivery_state) as FlowerApprovalAction['delivery_state'] } : {}),
    ...(trim(record.child_execution_state) ? { child_execution_state: trim(record.child_execution_state) as FlowerApprovalAction['child_execution_state'] } : {}),
    ...(trim(record.primary_wait_anchor) ? { primary_wait_anchor: trim(record.primary_wait_anchor) } : {}),
    queue_generation: Math.max(0, Math.floor(Number(record.queue_generation ?? 0))),
    queue_order: Math.max(0, Math.floor(Number(record.queue_order ?? 0))),
    batch_index: Math.max(0, Math.floor(Number(record.batch_index ?? 0))),
    batch_size: Math.max(1, Math.floor(Number(record.batch_size ?? 1))),
    summary: {
      label: trim(summary.label) || toolName || 'Tool approval',
      ...(trim(summary.description) ? { description: trim(summary.description) } : {}),
      ...(trim(summary.command) ? { command: trim(summary.command) } : {}),
      ...(trim(summary.cwd) ? { cwd: trim(summary.cwd) } : {}),
      ...(Array.isArray(summary.effects) ? { effects: summary.effects.map(trim).filter(Boolean) } : {}),
      ...(Array.isArray(summary.flags) ? { flags: summary.flags.map(trim).filter(Boolean) } : {}),
      ...(Array.isArray(summary.targets) ? {
        targets: summary.targets.map((targetValue) => {
          const target = recordValue(targetValue) ?? {};
          return {
            kind: trim(target.kind),
            label: trim(target.label),
            ...(trim(target.uri) ? { uri: trim(target.uri) } : {}),
          };
        }).filter((target) => target.kind && target.label),
      } : {}),
    },
  };
  if (origin === 'delegated_subagent') {
    if (!validDelegatedRef) return null;
    const delegatedRef: FlowerDelegatedApprovalRef = validDelegatedRef;
    return {
      ...base,
      origin: 'delegated_subagent',
      delegated_ref: delegatedRef,
    };
  }
  return {
    ...base,
    origin: origin === 'control_confirm' ? 'control_confirm' : 'main_tool',
    run_id: runID,
    tool_id: toolID,
  };
}

function mapApprovalQueue(raw: unknown): FlowerLiveMaterializedState['approval_queue'] {
  if (raw === null) return null;
  const record = recordValue(raw);
  if (!record) return undefined;
  return {
    generation: Math.max(0, Math.floor(Number(record.generation ?? 0))),
    revision: Math.max(0, Math.floor(Number(record.revision ?? 0))),
    ...(trim(record.current_action_id) ? { current_action_id: trim(record.current_action_id) } : {}),
    current_position: Math.max(0, Math.floor(Number(record.current_position ?? 0))),
    total: Math.max(0, Math.floor(Number(record.total ?? 0))),
    unresolved_count: Math.max(0, Math.floor(Number(record.unresolved_count ?? 0))),
  };
}

function mapThreadPatch(raw: unknown): FlowerLiveThreadPatch | null {
  const record = recordValue(raw);
  if (!record) return null;
  const patch = recordValue(record.patch) ?? record;
  const queuedTurnCount = patch.queued_turn_count === undefined
    ? undefined
    : nonNegativeInteger(patch.queued_turn_count, 'thread.patch.queued_turn_count');
  const readStatus = patch.read_status === undefined ? null : mapFlowerReadStatus(patch.read_status);
  const reasoningSelection = hasOwn(patch, 'reasoning_selection') ? normalizeFlowerReasoningSelection(patch.reasoning_selection) ?? null : undefined;
  const reasoningCapability = hasOwn(patch, 'reasoning_capability') ? normalizeFlowerReasoningCapability(patch.reasoning_capability) ?? null : undefined;
  const subagents = mapFlowerSubagents(patch.subagents, 'thread.patch.subagents');
  return {
    ...(trim(patch.thread_id) ? { thread_id: trim(patch.thread_id) } : {}),
    ...(trim(patch.title) ? { title: trim(patch.title) } : {}),
    ...(trim(patch.model_id) ? { model_id: trim(patch.model_id) } : {}),
    ...(normalizePermissionType(patch.permission_type) ? { permission_type: normalizePermissionType(patch.permission_type) } : {}),
    ...(trim(patch.working_dir) ? { working_dir: trim(patch.working_dir) } : {}),
    ...(queuedTurnCount !== undefined ? { queued_turn_count: queuedTurnCount } : {}),
    ...(trim(patch.run_status) ? { run_status: trim(patch.run_status) } : {}),
    ...(positiveInteger(patch.run_updated_at_unix_ms) ? { run_updated_at_ms: positiveInteger(patch.run_updated_at_unix_ms) } : {}),
    ...(trim(patch.run_error_code) ? { run_error_code: trim(patch.run_error_code) } : {}),
    ...(trim(patch.run_error) ? { run_error: trim(patch.run_error) } : {}),
    ...(patch.waiting_prompt !== undefined ? { waiting_prompt: mapInputRequest(patch.waiting_prompt) } : {}),
    ...(trim(patch.active_run_id) ? { active_run_id: trim(patch.active_run_id) } : {}),
    ...(positiveInteger(patch.pinned_at_unix_ms) ? { pinned_at_ms: positiveInteger(patch.pinned_at_unix_ms) } : {}),
    ...(positiveInteger(patch.created_at_unix_ms) ? { created_at_ms: positiveInteger(patch.created_at_unix_ms) } : {}),
    ...(positiveInteger(patch.updated_at_unix_ms) ? { updated_at_ms: positiveInteger(patch.updated_at_unix_ms) } : {}),
    ...(positiveInteger(patch.last_message_at_unix_ms) ? { last_message_at_ms: positiveInteger(patch.last_message_at_unix_ms) } : {}),
    ...(trim(patch.last_message_preview) ? { last_message_preview: trim(patch.last_message_preview) } : {}),
    ...(reasoningSelection !== undefined ? { reasoning_selection: reasoningSelection } : {}),
    ...(reasoningCapability !== undefined ? { reasoning_capability: reasoningCapability } : {}),
    ...(trim(patch.read_only_reason) ? { read_only_reason: trim(patch.read_only_reason) } : {}),
    ...(trim(patch.owner_kind) ? { owner_kind: trim(patch.owner_kind).toLowerCase() } : {}),
    ...(trim(patch.owner_id) ? { owner_id: trim(patch.owner_id) } : {}),
    ...(trim(patch.parent_thread_id) ? { parent_thread_id: trim(patch.parent_thread_id) } : {}),
    ...(subagents !== undefined ? { subagents } : {}),
    ...(readStatus ? { read_status: readStatus } : {}),
  };
}

function mapLiveState(raw: unknown): FlowerLiveMaterializedState {
  const record = recordValue(raw) ?? {};
  const runs: Record<string, FlowerLiveRunState> = {};
  const approvals: Record<string, FlowerApprovalAction> = {};
  const inputRequests: Record<string, FlowerInputRequest> = {};

  const runsRecord = recordValue(record.runs) ?? {};
  for (const [runID, value] of Object.entries(runsRecord)) {
    const run = recordValue(value) ?? {};
    runs[runID] = {
      run_id: trim(run.run_id) || runID,
      status: trim(run.status) || 'running',
      ...(trim(run.message_id) ? { message_id: trim(run.message_id) } : {}),
      ...(run.waiting_prompt !== undefined ? { waiting_prompt: mapInputRequest(run.waiting_prompt) } : {}),
      ...(trim(run.error_code) ? { error_code: trim(run.error_code) } : {}),
      ...(trim(run.error) ? { error: trim(run.error) } : {}),
    };
  }
  const approvalsRecord = record.approval_actions === undefined ? undefined : (recordValue(record.approval_actions) ?? {});
  if (approvalsRecord !== undefined) {
    for (const [actionID, value] of Object.entries(approvalsRecord)) {
      const action = mapApprovalAction({ action_id: actionID, ...(recordValue(value) ?? {}) });
      if (action) approvals[actionID] = action;
    }
  }
  const inputsRecord = recordValue(record.input_requests) ?? {};
  for (const [promptID, value] of Object.entries(inputsRecord)) {
    const input = mapInputRequest(value);
    if (input) inputRequests[promptID] = input;
  }
  const modelIO = mapModelIOStatus(record.model_io);
  const contextUsage = record.context_usage === null ? null : mapContextUsage(record.context_usage);
  const contextCompactions = mapContextCompactionsSnapshot(record.context_compactions);
  const timelineDecorations = mapTimelineDecorationsSnapshot(record.timeline_decorations);
  const approvalQueue = mapApprovalQueue(record.approval_queue);

  return {
    thread_patch: mapThreadPatch(record.thread_patch) ?? {},
    runs,
    ...(modelIO ? { model_io: modelIO } : {}),
    ...(record.context_usage !== undefined ? { context_usage: contextUsage } : {}),
    ...(contextCompactions !== undefined ? { context_compactions: contextCompactions } : {}),
    ...(timelineDecorations !== undefined ? { timeline_decorations: timelineDecorations } : {}),
    ...(approvalsRecord !== undefined ? { approval_actions: approvals } : {}),
    ...(record.approval_queue !== undefined ? { approval_queue: approvalQueue } : {}),
    input_requests: inputRequests,
  };
}

export function mapFlowerThread(raw: unknown, messages: readonly FlowerChatMessage[], options: FlowerLiveThreadMapperOptions, readStatusRaw?: unknown): FlowerThreadSnapshot {
  const record = recordValue(raw) ?? {};
  const threadID = trim(record.thread_id);
  const status = runStatus(record.run_status);
  const activeRunID = status === 'running' || status === 'waiting_approval'
    ? trim(record.active_run_id)
    : '';
  const waitingPrompt = record.waiting_prompt !== undefined ? mapInputRequest(record.waiting_prompt) : null;
  const inputRequest = status === 'waiting_user' ? waitingPrompt : null;
  const errorMessage = trim(record.run_error);
  const errorCode = trim(record.run_error_code);
  const contextUsage = mapContextUsage(record.context_usage);
  const contextCompactions = mapContextCompactions(record.context_compactions);
  const timelineDecorations = mapTimelineDecorations(record.timeline_decorations);
  const subagents = mapFlowerSubagents(record.subagents, 'thread.subagents');
  const queuedTurns = mapFlowerQueuedTurns(record.queued_turns);
  const approvalQueue = mapApprovalQueue(record.approval_queue);
  return {
    thread_id: threadID,
    title: trim(record.title) || trim(record.last_message_preview) || 'Ask Flower',
    model_id: trim(record.model_id),
    working_dir: trim(record.working_dir),
    ...(Number(record.pinned_at_unix_ms ?? 0) > 0 ? { pinned_at_ms: Math.floor(Number(record.pinned_at_unix_ms)) } : {}),
    home_runtime_id: options.runtimeID,
    home_runtime_kind: options.runtimeKind,
    ...(trim(options.originEnvPublicID) ? { origin_env_public_id: trim(options.originEnvPublicID) } : {}),
    created_at_ms: unixMs(record.created_at_unix_ms, 'thread.created_at_unix_ms'),
    updated_at_ms: unixMs(record.updated_at_unix_ms ?? record.last_message_at_unix_ms, 'thread.updated_at_unix_ms'),
    status,
    ...(activeRunID ? { active_run_id: activeRunID } : {}),
    queued_turn_count: nonNegativeInteger(record.queued_turn_count ?? 0, 'thread.queued_turn_count'),
    ...(queuedTurns ? { queued_turns: queuedTurns } : {}),
    ...(normalizePermissionType(record.permission_type) ? { permission_type: normalizePermissionType(record.permission_type) } : {}),
    source_label: options.sourceLabel,
    target_labels: options.targetLabels,
    ...(trim(record.read_only_reason) ? { read_only_reason: trim(record.read_only_reason) } : {}),
    ...(trim(record.owner_kind) ? { owner_kind: trim(record.owner_kind).toLowerCase() } : {}),
    ...(trim(record.owner_id) ? { owner_id: trim(record.owner_id) } : {}),
    ...(trim(record.parent_thread_id) ? { parent_thread_id: trim(record.parent_thread_id) } : {}),
    messages,
    ...(normalizeFlowerReasoningSelection(record.reasoning_selection) ? { reasoning_selection: normalizeFlowerReasoningSelection(record.reasoning_selection) } : {}),
    ...(normalizeFlowerReasoningCapability(record.reasoning_capability) ? { reasoning_capability: normalizeFlowerReasoningCapability(record.reasoning_capability) } : {}),
    ...(contextUsage ? { context_usage: contextUsage } : {}),
    ...(contextCompactions ? { context_compactions: contextCompactions } : {}),
    ...(timelineDecorations ? { timeline_decorations: timelineDecorations } : {}),
    ...(subagents !== undefined ? { subagents } : {}),
    ...(approvalQueue ? { approval_queue: approvalQueue } : {}),
    ...(inputRequest ? { input_request: inputRequest } : {}),
    ...(errorMessage ? { error: { message: errorMessage, ...(errorCode ? { code: errorCode } : {}) } } : {}),
    read_status: mapFlowerReadStatus(readStatusRaw ?? record.read_status),
  };
}

function mapLiveEventPayload(kind: string, payload: unknown): unknown {
  const record = recordValue(payload) ?? {};
  switch (kind) {
    case 'run.started':
      return record as FlowerLiveRunStartedPayload;
    case 'run.status_changed':
      return {
        run_id: trim(record.run_id),
        status: trim(record.status),
        ...(trim(record.error_code) ? { error_code: trim(record.error_code) } : {}),
        ...(trim(record.error) ? { error: trim(record.error) } : {}),
        ...(record.waiting_prompt !== undefined ? { waiting_prompt: mapInputRequest(record.waiting_prompt) } : {}),
      } as FlowerLiveRunStatusChangedPayload;
    case 'thread.patched':
      return mapThreadPatch(record) ? { patch: mapThreadPatch(record) } : { patch: {} };
    case 'message.started':
      return {
        message_id: trim(record.message_id),
        role: 'assistant',
        status: 'streaming',
        created_at_ms: Math.max(0, Math.floor(Number(record.created_at_ms ?? 0))),
      } as FlowerLiveMessageStartedPayload;
    case 'message.block_started':
      return {
        message_id: trim(record.message_id),
        block_index: Math.max(0, Math.floor(Number(record.block_index ?? 0))),
        block_type: trim(record.block_type),
      } as FlowerLiveMessageBlockStartedPayload;
    case 'message.block_delta':
      return {
        message_id: trim(record.message_id),
        block_index: Math.max(0, Math.floor(Number(record.block_index ?? 0))),
        delta: typeof record.delta === 'string' ? record.delta : String(record.delta ?? ''),
      } as FlowerLiveMessageBlockDeltaPayload;
    case 'message.block_set':
      {
        const block = recordValue(record.block);
        const blockType = trim(block?.type);
        const activityBlock = blockType === 'activity-timeline' ? mapActivityTimelineBlock(record.block) : null;
        const mappedBlock = activityBlock
          ? { type: 'activity-timeline', block: activityBlock }
          : mapLiveBlock(record.block);
        return {
        message_id: trim(record.message_id),
        block_index: Math.max(0, Math.floor(Number(record.block_index ?? 0))),
        block: mappedBlock ?? { type: '' },
        } as FlowerLiveMessageBlockSetPayload;
      }
    case 'message.failed':
      return {
        message_id: trim(record.message_id),
        error: trim(record.error),
      } as FlowerLiveMessageFailedPayload;
    case 'approval.requested':
    case 'approval.resolved':
      return {
        action: mapApprovalAction(record.action) ?? undefined,
        ...(mapApprovalQueue(record.approval_queue) ? { approval_queue: mapApprovalQueue(record.approval_queue) } : {}),
      } as FlowerLiveApprovalPayload;
    case 'input.requested':
      return { request: mapInputRequest(record.request) ?? undefined } as FlowerLiveInputRequestedPayload;
    case 'input.resolved':
      return { prompt_id: trim(record.prompt_id) } as FlowerLiveInputResolvedPayload;
    case 'model_io.updated':
      return { status: mapModelIOStatus(record.status) } as FlowerLiveModelIOUpdatedPayload;
    case 'context.usage.updated':
      {
        const usage = mapContextUsage(record.usage);
        if (!usage) {
          throw new Error('Flower contract error: context.usage.updated requires a valid context usage payload.');
        }
        return { usage } as FlowerLiveUsageUpdatedPayload;
      }
    case 'context.compaction.updated':
      {
        const compaction = mapContextCompaction(record.compaction);
        const timelineDecoration = mapTimelineDecoration(record.timeline_decoration);
        if (!compaction) {
          throw new Error('Flower contract error: context.compaction.updated requires a valid context compaction payload.');
        }
        if (!timelineDecoration) {
          throw new Error('Flower contract error: context.compaction.updated requires a valid timeline decoration payload.');
        }
        return { compaction, timeline_decoration: timelineDecoration } as FlowerLiveContextCompactionUpdatedPayload;
      }
    case 'timeline.replaced': {
      if (!Array.isArray(record.messages)) {
        throw new Error('Flower contract error: timeline.replaced requires messages.');
      }
      return {
        messages: record.messages.map(mapFlowerMessage),
        stream_generation: positiveIntegerOrOne(record.stream_generation),
        snapshot_through_seq: integerOrZero(record.snapshot_through_seq),
        ...(record.thread_patch !== undefined ? { thread_patch: mapThreadPatch(record.thread_patch) ?? {} } : {}),
        ...(record.live_state !== undefined ? { live_state: mapLiveState(record.live_state) } : {}),
        ...(record.read_status !== undefined ? { read_status: mapFlowerReadStatus(record.read_status) } : {}),
        ...(record.context_usage !== undefined ? { context_usage: record.context_usage === null ? null : mapContextUsage(record.context_usage) } : {}),
        ...(record.context_compactions !== undefined ? { context_compactions: mapContextCompactionsSnapshot(record.context_compactions) ?? [] } : {}),
        ...(record.timeline_decorations !== undefined ? { timeline_decorations: mapTimelineDecorationsSnapshot(record.timeline_decorations) ?? [] } : {}),
      };
    }
    case 'stream.resync_required':
      return { reason: trim(record.reason) } as FlowerLiveResyncRequiredPayload;
    default:
      return record;
  }
}

const liveKinds = new Set<FlowerLiveKind>([
  'run.started',
  'run.status_changed',
  'thread.patched',
  'message.started',
  'message.block_started',
  'message.block_delta',
  'message.block_set',
  'message.failed',
  'approval.requested',
  'approval.resolved',
  'input.requested',
  'input.resolved',
  'model_io.updated',
  'context.usage.updated',
  'context.compaction.updated',
  'timeline.replaced',
  'stream.resync_required',
]);

function mapLiveKind(raw: unknown): FlowerLiveKind | null {
  const kind = trim(raw) as FlowerLiveKind;
  return liveKinds.has(kind) ? kind : null;
}

function makeLiveEvent<K extends FlowerLiveKind>(
  kind: K,
  base: Omit<FlowerLiveEvent<K>, 'kind' | 'payload'>,
  payload: unknown,
): FlowerLiveEvent<K> {
  return {
    ...base,
    kind,
    payload: mapLiveEventPayload(kind, payload) as FlowerLiveEvent<K>['payload'],
  } as FlowerLiveEvent<K>;
}

export function mapFlowerLiveBootstrap(raw: unknown, options: FlowerLiveThreadMapperOptions): FlowerLiveBootstrap {
  const record = recordValue(raw) ?? {};
  if (!Array.isArray(record.timeline_messages)) {
    throw new Error('Flower contract error: live bootstrap requires timeline_messages.');
  }
  const timelineMessages = record.timeline_messages.map(mapFlowerMessage);
  const thread = mapFlowerThread(record.thread, timelineMessages, options, record.read_status);
  return {
    schema_version: Math.max(0, Math.floor(Number(record.schema_version ?? 0))),
    endpoint_id: trim(record.endpoint_id),
    thread_id: trim(record.thread_id) || thread.thread_id,
    stream_generation: positiveIntegerOrOne(record.stream_generation),
    cursor: Math.max(0, Math.floor(Number(record.cursor ?? 0))),
    retained_from_seq: Math.max(0, Math.floor(Number(record.retained_from_seq ?? 0))),
    thread,
    timeline_messages: timelineMessages,
    live_state: mapLiveState(record.live_state),
    read_status: mapFlowerReadStatus(record.read_status ?? thread.read_status),
    generated_at_ms: Math.max(0, Math.floor(Number(record.generated_at_ms ?? record.generated_at_unix_ms ?? Date.now()))),
  };
}

export function mapFlowerLiveEvents(raw: unknown): FlowerLiveEventsResponse {
  const record = recordValue(raw) ?? {};
  return {
    stream_generation: positiveIntegerOrOne(record.stream_generation),
    events: (Array.isArray(record.events) ? record.events : []).map((eventValue): FlowerLiveEvent | null => {
      const event = recordValue(eventValue) ?? {};
      const kind = mapLiveKind(event.kind);
      const base = {
        schema_version: Math.max(0, Math.floor(Number(event.schema_version ?? 0))),
        seq: Math.max(0, Math.floor(Number(event.seq ?? 0))),
        endpoint_id: trim(event.endpoint_id),
        thread_id: trim(event.thread_id),
        ...(trim(event.run_id) ? { run_id: trim(event.run_id) } : {}),
        ...(trim(event.turn_id) ? { turn_id: trim(event.turn_id) } : {}),
        ...(trim(event.trace_id) ? { trace_id: trim(event.trace_id) } : {}),
        ...(trim(event.step) ? { step: trim(event.step) } : {}),
        at_unix_ms: Math.max(0, Math.floor(Number(event.at_unix_ms ?? 0))),
      };
      return kind ? makeLiveEvent(kind, base, event.payload) : null;
    }).filter((event): event is FlowerLiveEvent => event != null && event.seq > 0 && event.thread_id !== ''),
    next_cursor: Math.max(0, Math.floor(Number(record.next_cursor ?? 0))),
    ...(record.has_more ? { has_more: true } : {}),
    retained_from_seq: Math.max(0, Math.floor(Number(record.retained_from_seq ?? 0))),
  };
}
