import type {
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
  FlowerContextCompaction,
  FlowerContextUsage,
  FlowerTimelineAnchor,
  FlowerTimelineDecoration,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerThreadStatus,
  FlowerTitleStatus,
  FlowerPermissionType,
  FlowerSubagentSummary,
} from './contracts/flowerSurfaceContracts';
import { canonicalFlowerThreadSnapshotTitle } from './flowerThreadTitle';
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

function titleStatus(raw: unknown, title: unknown): FlowerTitleStatus {
  switch (trim(raw).toLowerCase()) {
    case '':
      if (!trim(title)) return 'unset';
      break;
    case 'ready': return 'ready';
    case 'failed': return 'failed';
    case 'pending': return 'pending';
  }
  throw new Error(`Flower contract error: title_status may be empty only when title is empty; otherwise it must be pending, ready, or failed; received ${trim(raw) || '<empty>'}.`);
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
  return null;
}

function mapContextCompactions(raw: unknown): readonly FlowerContextCompaction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const compactions = raw.map(mapContextCompaction).filter(isPresent);
  return compactions.length > 0 ? compactions : undefined;
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

const activityStatuses = new Set<FlowerActivityStatus>(['pending', 'running', 'waiting', 'success', 'error', 'declined', 'canceled']);
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
    assertPublicActivityPayloadKey('activity_item.presentation.payload', safeKey);
    out[safeKey] = sanitizeActivityPublicValue(value, `activity_item.presentation.payload.${safeKey}`);
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
      throw new Error(`Flower contract error: activity_item.presentation.target_refs[${index}].${key} is not part of the activity target ref contract.`);
    }
  }
  const kind = trim(record.kind);
  const label = trim(record.label);
  if (!kind || !label) return null;
  return {
    kind,
    label,
    ...(trim(record.uri) ? { uri: trim(record.uri) } : {}),
    ...(record.line !== undefined ? { line: nonNegativeInteger(record.line, `activity_item.presentation.target_refs[${index}].line`) } : {}),
  };
}

function mapActivityTargetRefs(raw: unknown): readonly FlowerActivityTargetRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const refs = raw.map(mapActivityTargetRef).filter(isPresent);
  return refs.length > 0 ? refs : undefined;
}

const activityPresentationKeys = new Set(['label', 'description', 'renderer', 'chips', 'target_refs', 'payload']);

function mapActivityPresentation(raw: unknown): Partial<Pick<FlowerActivityItem, 'label' | 'description' | 'renderer' | 'chips' | 'target_refs' | 'payload'>> {
  if (raw === undefined) return {};
  const record = plainRecordValue(raw);
  if (!record) {
    throw new Error('Flower contract error: activity_item.presentation must be an object.');
  }
  for (const key of Object.keys(record)) {
    if (!activityPresentationKeys.has(key)) {
      throw new Error(`Flower contract error: activity_item.presentation.${key} is not part of the activity presentation contract.`);
    }
  }
  const chips = Array.isArray(record.chips) ? record.chips.map(mapActivityChip).filter(isPresent) : [];
  const renderer = activityRenderer(record.renderer);
  const targetRefs = mapActivityTargetRefs(record.target_refs);
  const payload = mapActivityPayload(record.payload);
  return {
    ...(trim(record.label) ? { label: trim(record.label) } : {}),
    ...(trim(record.description) ? { description: trim(record.description) } : {}),
    ...(renderer ? { renderer } : {}),
    ...(chips.length > 0 ? { chips } : {}),
    ...(targetRefs ? { target_refs: targetRefs } : {}),
    ...(payload ? { payload } : {}),
  };
}

export function mapFlowerActivityItem(raw: unknown): FlowerActivityItem | null {
  const record = plainRecordValue(raw);
  if (!record) return null;
  const itemID = trim(record.item_id);
  if (!itemID) return null;
  for (const key of activityPresentationKeys) {
    if (record[key] !== undefined && record[key] !== null) {
      throw new Error('Flower contract error: activity presentation fields must be nested under presentation.');
    }
  }
  const presentation = mapActivityPresentation(record.presentation);
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
    ...presentation,
    ...(metadata ? { metadata } : {}),
  };
}

function mapActivityCounts(raw: unknown): FlowerActivityTimelineBlock['summary']['counts'] {
  const record = plainRecordValue(raw) ?? {};
  const out: Record<string, number> = {};
  for (const key of ['pending', 'running', 'waiting', 'success', 'error', 'declined', 'canceled', 'approval']) {
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
  const items = Array.isArray(record.items) ? record.items.map(mapFlowerActivityItem).filter(isPresent) : [];
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

function mapMessageReferences(raw: unknown, messageID: string): FlowerChatMessage['references'] {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`Flower contract error: timeline message ${messageID} references must be an array.`);
  }
  const seen = new Set<string>();
  return raw.map((value, index) => {
    const reference = recordValue(value);
    if (!reference) {
      throw new Error(`Flower contract error: timeline message ${messageID} reference ${index} must be an object.`);
    }
    const allowedFields = new Set(['reference_id', 'kind', 'label', 'text', 'truncated']);
    for (const field of Object.keys(reference)) {
      if (!allowedFields.has(field)) {
        throw new Error(`Flower contract error: timeline message ${messageID} reference ${index} contains forbidden field ${field}.`);
      }
    }
    const referenceID = trim(reference.reference_id);
    const kind = trim(reference.kind) as NonNullable<FlowerChatMessage['references']>[number]['kind'];
    const label = trim(reference.label);
    if (!referenceID || !label || !['text', 'file', 'directory', 'terminal', 'process'].includes(kind)) {
      throw new Error(`Flower contract error: timeline message ${messageID} reference ${index} is invalid.`);
    }
    if (seen.has(referenceID)) {
      throw new Error(`Flower contract error: timeline message ${messageID} reference ${referenceID} is duplicated.`);
    }
    if (reference.text !== undefined && typeof reference.text !== 'string') {
      throw new Error(`Flower contract error: timeline message ${messageID} reference ${referenceID} text must be a string.`);
    }
    if (reference.truncated !== undefined && typeof reference.truncated !== 'boolean') {
      throw new Error(`Flower contract error: timeline message ${messageID} reference ${referenceID} truncated must be a boolean.`);
    }
    const fileLike = kind === 'file' || kind === 'directory';
    if (fileLike && Object.prototype.hasOwnProperty.call(reference, 'text')) {
      throw new Error(`Flower contract error: timeline message ${messageID} reference ${referenceID} must not carry host path text.`);
    }
    seen.add(referenceID);
    const text = !fileLike && typeof reference.text === 'string' && reference.text.length > 0 ? reference.text : undefined;
    return fileLike
      ? {
          reference_id: referenceID,
          kind,
          label,
          ...(reference.truncated === true ? { truncated: true } : {}),
        }
      : {
          reference_id: referenceID,
          kind,
          label,
          ...(text !== undefined ? { text } : {}),
          ...(reference.truncated === true ? { truncated: true } : {}),
        };
  });
}

export function mapFlowerMessage(raw: unknown): FlowerChatMessage {
  const message = recordValue(raw);
  if (!message) throw new Error('Flower contract error: timeline message must be an object.');
  const id = trim(message.id);
  const threadID = trim(message.thread_id);
  const turnID = trim(message.turn_id);
  const runID = trim(message.run_id);
  const logicalRequestID = trim(message.logical_request_id);
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
  if (message.references !== undefined && role !== 'user') {
    throw new Error(`Flower contract error: timeline message ${id} references require the user role.`);
  }
  const references = mapMessageReferences(message.references, id);
  const blockContent = blocks.map(messageBlockPreviewText).filter(Boolean).join('\n\n');
  const content = blockContent || trim(message.content);
  return {
    id,
    thread_id: threadID,
    turn_id: turnID,
    run_id: runID,
    ...(logicalRequestID ? { logical_request_id: logicalRequestID } : {}),
    role,
    content,
    status: mapMessageStatus(message.status),
    created_at_ms: unixMs(message.timestamp ?? message.created_at_ms ?? message.created_at_unix_ms, 'message.timestamp'),
    ...(blocks.length > 0 ? { blocks } : {}),
    ...(references && references.length > 0 ? { references } : {}),
    ...(message.live !== undefined ? { live: Boolean(message.live) } : {}),
    ...(message.active_cursor !== undefined ? { active_cursor: Boolean(message.active_cursor) } : {}),
  };
}

function mapFlowerQueuedTurns(raw: unknown): FlowerThreadSnapshot['queued_turns'] {
  if (!Array.isArray(raw)) return undefined;
  const turns = raw.map((value, index) => {
    const record = recordValue(value);
    if (!record) throw new Error(`Flower contract error: queued turn ${index} must be an object.`);
    const queueID = trim(record.queue_id);
    if (!queueID) throw new Error('Flower contract error: queued turn requires queue_id.');
    const contextAction = recordValue(record.context_action);
    if (record.attachments !== undefined && !Array.isArray(record.attachments)) {
      throw new Error(`Flower contract error: queued turn ${index} attachments must be an array.`);
    }
    const attachments = Array.isArray(record.attachments)
      ? record.attachments.map((value, attachmentIndex) => {
          const attachment = recordValue(value);
          const attachmentID = trim(attachment?.attachment_id);
          const name = trim(attachment?.name);
          const mimeType = trim(attachment?.mime_type);
          const sizeBytes = Number(attachment?.size_bytes);
          const locator = trim(attachment?.locator);
          const url = trim(attachment?.url);
          const textStatsRecord = recordValue(attachment?.text_stats);
          const codePoints = Number(textStatsRecord?.code_points);
          const lines = Number(textStatsRecord?.lines);
          if (!attachmentID || !name || !mimeType || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
            throw new Error(`Flower contract error: queued turn ${index} attachment ${attachmentIndex} is invalid.`);
          }
          const textStats = textStatsRecord
            && Number.isFinite(codePoints) && codePoints >= 0
            && Number.isFinite(lines) && lines >= 0
            ? { code_points: Math.floor(codePoints), lines: Math.floor(lines) }
            : undefined;
          return {
            attachment_id: attachmentID,
            name,
            mime_type: mimeType,
            size_bytes: Math.floor(sizeBytes),
            ...(textStats ? { text_stats: textStats } : {}),
            ...(locator ? { locator } : {}),
            ...(url ? { url } : {}),
          };
        })
      : undefined;
    return {
      queue_id: queueID,
      prompt: trim(record.text),
      created_at_ms: unixMs(record.created_at_unix_ms, 'queued_turn.created_at_unix_ms'),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(contextAction ? { context_action: contextAction } : {}),
    };
  });
  return turns;
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
  if (record.approval_pending !== undefined && typeof record.approval_pending !== 'boolean') {
    throw new Error('Flower contract error: thread.approval_pending must be a boolean.');
  }
  const approvalPendingCount = record.approval_pending_count === undefined
    ? undefined
    : nonNegativeInteger(record.approval_pending_count, 'thread.approval_pending_count');
  const thread: FlowerThreadSnapshot = {
    thread_id: threadID,
    title: trim(record.title),
    title_status: titleStatus(record.title_status, record.title),
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
    ...(record.approval_pending !== undefined ? { approval_pending: record.approval_pending } : {}),
    ...(approvalPendingCount !== undefined ? { approval_pending_count: approvalPendingCount } : {}),
    queued_turn_count: nonNegativeInteger(record.queued_turn_count ?? 0, 'thread.queued_turn_count'),
    ...(queuedTurns ? { queued_turns: queuedTurns } : {}),
    ...(normalizePermissionType(record.permission_type) ? { permission_type: normalizePermissionType(record.permission_type) } : {}),
    source_label: options.sourceLabel,
    target_labels: options.targetLabels,
    ...(trim(record.read_only_reason) ? { read_only_reason: trim(record.read_only_reason) } : {}),
    messages,
    ...(normalizeFlowerReasoningSelection(record.reasoning_selection) ? { reasoning_selection: normalizeFlowerReasoningSelection(record.reasoning_selection) } : {}),
    ...(normalizeFlowerReasoningCapability(record.reasoning_capability) ? { reasoning_capability: normalizeFlowerReasoningCapability(record.reasoning_capability) } : {}),
    ...(contextUsage ? { context_usage: contextUsage } : {}),
    ...(contextCompactions ? { context_compactions: contextCompactions } : {}),
    ...(timelineDecorations ? { timeline_decorations: timelineDecorations } : {}),
    ...(subagents !== undefined ? { subagents } : {}),
    ...(inputRequest ? { input_request: inputRequest } : {}),
    ...(errorMessage ? { error: { message: errorMessage, ...(errorCode ? { code: errorCode } : {}) } } : {}),
    read_status: mapFlowerReadStatus(readStatusRaw ?? record.read_status),
  };
  return { ...thread, title: canonicalFlowerThreadSnapshotTitle(thread) };
}
