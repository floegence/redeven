import { FLOWER_CONTEXT_CATEGORIES, type FlowerContextBreakdown } from './contracts/flowerSurfaceContracts';
import { mapFlowerProviderRequestProgress } from './providerRequestProgress';
import { mapFlowerCitationSources } from './chat/markdown/flowerCitations';
import { threadTitleSnapshot } from './threadTitleSnapshot';
import type {
  FlowerActivityAttentionReason,
  FlowerActivityApprovalState,
  FlowerActivityChip,
  FlowerActivityItem,
  FlowerActivityKind,
  FlowerActivityRenderer,
  FlowerActivitySeverity,
  FlowerActivityStatus,
  FlowerActivityTargetRef,
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerContextCompaction,
  FlowerContextUsage,
  FlowerModelContext,
  FlowerContextSample,
  FlowerTimelineAnchor,
  FlowerTimelineDecoration,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerThreadCancellation,
  FlowerThreadStatus,
  FlowerTitleStatus,
  FlowerPermissionType,
  FlowerRunProgress,
  FlowerRunProgressPhase,
  FlowerSubagentSummary,
} from './contracts/flowerSurfaceContracts';
import { safeFlowerAttachmentURL } from './attachments/flowerAttachmentPresentation';
import {
  normalizeFlowerReasoningCapability,
  normalizeFlowerReasoningSelection,
} from './reasoning';
import { inputResponseVisibleText, mapFlowerInputResponseBlock } from './inputResponse';

export type FlowerLiveThreadMapperOptions = Readonly<{
  runtimeID: string;
  runtimeKind: FlowerThreadSnapshot['home_runtime_kind'];
  sourceLabel: string;
  targetLabels: readonly string[];
  originEnvPublicID?: string;
}>;

type FlowerMessageBlock = NonNullable<FlowerChatMessage['blocks']>[number];
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

function runProgressPhase(raw: unknown): FlowerRunProgressPhase {
  switch (trim(raw)) {
    case 'preparing':
    case 'waiting_response':
    case 'streaming':
    case 'retrying':
    case 'finalizing':
    case 'tool_execution':
      return trim(raw) as FlowerRunProgressPhase;
    default:
      throw new Error(`Flower contract error: thread.run_progress.phase is unsupported: ${trim(raw) || '<empty>'}.`);
  }
}

function mapRunProgress(raw: unknown, activeRunID: string): FlowerRunProgress | null {
  if (raw === undefined || raw === null) return null;
  const record = recordValue(raw);
  if (!record) throw new Error('Flower contract error: thread.run_progress must be an object.');
  const runID = trim(record.run_id);
  const turnID = trim(record.turn_id);
  if (!runID || !turnID || runID !== activeRunID) {
    throw new Error('Flower contract error: thread.run_progress requires exact active run and turn identity.');
  }
  const retry = record.retry;
  return { run_id: runID, turn_id: turnID, phase: runProgressPhase(record.phase), ...(retry ? { retry: mapRunRetry(retry) } : {}),
    ...(record.request ? { request: mapFlowerProviderRequestProgress(record.request, record.sampled_at_ms), sampled_at_ms: Number(record.sampled_at_ms) } : {}),
  };
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

function mapRunRetry(raw: unknown): FlowerRunProgress['retry'] {
  const value = recordValue(raw);
  if (!value || typeof value.retry !== 'number' || typeof value.max_retries !== 'number' || typeof value.next_attempt_at !== 'string' || typeof value.reason !== 'string') {
    throw new Error('Flower contract error: run_progress.retry is invalid.');
  }
  if (!Number.isInteger(value.retry) || value.retry < 1 || !Number.isInteger(value.max_retries) || value.max_retries < value.retry || !Number.isFinite(Date.parse(value.next_attempt_at))) {
    throw new Error('Flower contract error: run_progress.retry has invalid bounds.');
  }
  return { retry: value.retry, max_retries: value.max_retries, next_attempt_at: value.next_attempt_at, reason: value.reason, ...(typeof value.replaced_attempt_id === 'string' ? { replaced_attempt_id: value.replaced_attempt_id } : {}), ...(typeof value.replaced_attempt_epoch === 'number' ? { replaced_attempt_epoch: value.replaced_attempt_epoch } : {}) };
}

function mapContextUsagePhase(raw: unknown): FlowerContextSample['phase'] {
  switch (trim(raw)) {
    case 'provider_usage':
      return 'provider_usage';
    case 'projected_request':
      return 'projected_request';
    default:
      throw new Error('context sample has an invalid phase');
  }
}

function mapContextPressureStatus(raw: unknown): FlowerContextSample['pressure_status'] {
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
      return 'stable';
    default:
      throw new Error('context sample has an invalid pressure status');
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

export function mapModelContext(raw: unknown): FlowerModelContext | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid canonical model context.');
  const record = raw as Record<string, unknown>;
  const snapshot = record.snapshot as Record<string, unknown> | undefined;
  if (!snapshot || !Array.isArray(snapshot.sections) || snapshot.sections.length > 128
    || typeof record.entry_id !== 'string' || !record.entry_id
    || !Number.isSafeInteger(record.path_depth) || Number(record.path_depth) < 1
    || typeof record.updated_at !== 'string' || !Number.isFinite(Date.parse(record.updated_at))
    || typeof record.turn_id !== 'string' || typeof record.run_id !== 'string') throw new Error('Invalid canonical model context.');
  const keys = new Set<string>();
  const sections = snapshot.sections.map((value: unknown) => {
    const section = value as Record<string, unknown>;
    if (!section || typeof section.key !== 'string' || !section.key || keys.has(section.key)
      || typeof section.title !== 'string' || typeof section.text !== 'string'
      || Array.from(section.text).length > 64000) throw new Error('Invalid model context section.');
    keys.add(section.key);
    return { key: section.key, title: section.title, text: section.text };
  });
  if (new TextEncoder().encode(JSON.stringify({ sections }).replace(/[<>&]/g, char => '\\u00' + char.charCodeAt(0).toString(16))).length > 256 * 1024) throw new Error('Model context exceeds capacity.');
  const changes = (field: 'changed_keys' | 'removed_keys'): string[] => {
    const value = record[field];
    if (!Array.isArray(value) || value.length > 128 || !value.every(key => typeof key === 'string' && key.length > 0)
      || new Set(value).size !== value.length) throw new Error('Invalid model context changes.');
    return value;
  };
  const requestIdentity = (field: 'used_by_request_id' | 'used_by_turn_id' | 'used_by_run_id'): string | undefined => {
    const value = record[field];
    if (value !== undefined && (typeof value !== 'string' || !value)) throw new Error('Invalid model context request identity.');
    return value as string | undefined;
  };
  if (record.used_at !== undefined && (typeof record.used_at !== 'string' || !Number.isFinite(Date.parse(record.used_at)))) throw new Error('Invalid model context request time.');
  return {
    snapshot: { sections }, entry_id: record.entry_id, path_depth: Number(record.path_depth),
    turn_id: record.turn_id, run_id: record.run_id, updated_at: record.updated_at,
    changed_keys: changes('changed_keys'), removed_keys: changes('removed_keys'),
    used_by_request_id: requestIdentity('used_by_request_id'), used_by_turn_id: requestIdentity('used_by_turn_id'),
    used_by_run_id: requestIdentity('used_by_run_id'), used_at: record.used_at as string | undefined,
  };
}

export function mapContextUsage(raw: unknown): FlowerContextUsage | null {
  const record = recordValue(raw);
  if (!record) return null;
  if ('phase' in record) throw new Error('context_usage requires a measurement/estimate snapshot');
  const mapTokens = (raw: unknown, label: string) => {
    const tokens = plainRecordValue(raw);
    if (!tokens) return undefined;
    return {
      input_tokens: nonNegativeInteger(tokens.input_tokens, `${label}.input_tokens`),
      output_tokens: nonNegativeInteger(tokens.output_tokens, `${label}.output_tokens`),
      cache_read_tokens: nonNegativeInteger(tokens.cache_read_tokens, `${label}.cache_read_tokens`),
      cache_write_tokens: nonNegativeInteger(tokens.cache_write_tokens, `${label}.cache_write_tokens`),
    };
  };
  const threadUsage = mapTokens(record.thread_usage, 'context_usage.thread_usage');
  const recentRequestUsage = mapTokens(record.recent_request_usage, 'context_usage.recent_request_usage');
  const confirmed = mapContextSample(record.confirmed);
  const estimate = mapContextSample(record.estimate);
  if (confirmed && confirmed.phase !== 'provider_usage') throw new Error('confirmed context requires model usage');
  return {
    ...(confirmed ? { confirmed } : {}),
    ...(estimate ? { estimate } : {}),
    ...(threadUsage ? { thread_usage: threadUsage } : {}),
    ...(recentRequestUsage ? { recent_request_usage: recentRequestUsage } : {}),
  };
}

function mapContextBreakdown(raw: unknown): FlowerContextBreakdown | undefined {
  if (raw === undefined || raw === null) return undefined;
  const record = recordValue(raw);
  if (!record || !trim(record.source)) throw new Error('context breakdown requires an estimate source');
  const result: { source: string; tokenizer?: string; quality?: 'token_estimate' | 'relative_weight' } & Partial<Record<typeof FLOWER_CONTEXT_CATEGORIES[number], number>> = { source: trim(record.source) };
  if (record.quality !== undefined) {
    if (record.quality !== 'token_estimate' && record.quality !== 'relative_weight') throw new Error('invalid context quality');
    result.quality = record.quality;
  }
  if (record.tokenizer !== undefined) {
    if (typeof record.tokenizer !== 'string') throw new Error('invalid context tokenizer');
    result.tokenizer = record.tokenizer;
  }
  if (result.quality === 'token_estimate' && (!result.tokenizer || Number(record.attachment_tokens ?? 0) > 0)) throw new Error('incomplete context vocabulary coverage');
  for (const key of FLOWER_CONTEXT_CATEGORIES) {
    if (record[key] === undefined) continue;
    const value = record[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid context breakdown tokens');
    result[key] = value;
  }
  if (record.details !== undefined) {
    const details = recordValue(record.details);
    if (!details || !Array.isArray(details.items)) throw new Error('invalid context attribution');
    const seen = new Set<string>();
    const sums = { tool_definition: 0, model_context: 0 };
    const items = details.items.map((raw: unknown) => {
      const item = recordValue(raw);
      if (!item || (item.category !== 'tool_definition' && item.category !== 'model_context')
        || typeof item.key !== 'string' || (item.category === 'tool_definition' && !item.key)
        || (item.source !== undefined && typeof item.source !== 'string')
        || (item.namespace !== undefined && typeof item.namespace !== 'string')
        || typeof item.tokens !== 'number' || !Number.isSafeInteger(item.tokens) || item.tokens < 0
        || (item.category === 'model_context' && (item.source || item.namespace))) throw new Error('invalid context attribution item');
      const category = item.category as 'tool_definition' | 'model_context';
      const key = JSON.stringify([category, item.key, item.source ?? '', item.namespace ?? '']);
      if (seen.has(key)) throw new Error('duplicate context attribution');
      seen.add(key);
      sums[category] += item.tokens;
      if (!Number.isSafeInteger(sums[category])) throw new Error('context attribution overflow');
      return { category, key: item.key, tokens: item.tokens,
        ...(item.source ? { source: item.source as string } : {}),
        ...(item.namespace ? { namespace: item.namespace as string } : {}),
      };
    });
    if (sums.tool_definition !== (result.tool_definition_tokens ?? 0) || sums.model_context !== (result.model_context_tokens ?? 0)) throw new Error('context attribution totals disagree');
    return { ...result, details: { items } };
  }
  return result;
}

function mapContextSample(raw: unknown): FlowerContextSample | null {
  const record = recordValue(raw);
  if (!record) return null;
  const breakdown = mapContextBreakdown(record.breakdown);
  const phase = mapContextUsagePhase(record.phase);
  const pressureStatus = mapContextPressureStatus(record.pressure_status);
  const updatedAt = integerOrZero(record.updated_at_ms ?? record.updated_at_unix_ms);
  const stepIndex = optionalInteger(record.step_index);
  const inputTokens = optionalZeroBasedInteger(record.input_tokens);
  const contextWindowTokens = optionalInteger(record.context_window_tokens);
  const thresholdTokens = optionalInteger(record.threshold_tokens);
  const requestSafeLimitTokens = optionalInteger(record.request_safe_limit_tokens);
  const outputHeadroomTokens = optionalInteger(record.output_headroom_tokens);
  const outputControl = record.output_control;
  const requestOutputTokens = record.request_output_tokens === undefined ? undefined : nonNegativeInteger(record.request_output_tokens, 'request_output_tokens');
  const safetyMarginTokens = record.safety_margin_tokens === undefined ? undefined : nonNegativeInteger(record.safety_margin_tokens, 'safety_margin_tokens');
  if (outputControl !== undefined && outputControl !== 'client' && outputControl !== 'server') throw new Error('Invalid output control');
  if (!outputControl && ((requestOutputTokens ?? 0) > 0 || (safetyMarginTokens ?? 0) > 0)) throw new Error('Output budget requires control mode');
  if ((safetyMarginTokens ?? 0) > 4096) throw new Error('Invalid safety margin');
  if (outputControl === 'server' && (requestOutputTokens ?? 0) > 0) throw new Error('Server output cannot claim a client limit');
  const usedRatio = clampRatio(record.used_ratio);
  const thresholdRatio = clampRatio(record.threshold_ratio);
  return {
    ...(trim(record.run_id) ? { run_id: trim(record.run_id) } : {}),
    ...(stepIndex ? { step_index: stepIndex } : {}),
    phase,
    ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
    ...(breakdown ? { breakdown } : {}),
    ...(contextWindowTokens ? { context_window_tokens: contextWindowTokens } : {}),
    ...(thresholdTokens ? { threshold_tokens: thresholdTokens } : {}),
    ...(requestSafeLimitTokens ? { request_safe_limit_tokens: requestSafeLimitTokens } : {}),
    ...(outputHeadroomTokens ? { output_headroom_tokens: outputHeadroomTokens } : {}),
    ...(outputControl ? { output_control: outputControl } : {}),
    ...(requestOutputTokens !== undefined ? { request_output_tokens: requestOutputTokens } : {}),
    ...(safetyMarginTokens !== undefined ? { safety_margin_tokens: safetyMarginTokens } : {}),
    ...(usedRatio !== undefined ? { used_ratio: usedRatio } : {}),
    ...(thresholdRatio !== undefined ? { threshold_ratio: thresholdRatio } : {}),
    pressure_status: pressureStatus,
    ...(trim(record.source) ? { source: trim(record.source) } : {}),
    updated_at_ms: updatedAt,
  };
}

export function mergeFlowerContextUsage(
  previous: FlowerContextUsage | null | undefined,
  incoming: FlowerContextUsage,
): FlowerContextUsage {
  if (incoming.thread_usage || !previous?.thread_usage) return incoming;
  return {
    ...incoming,
    thread_usage: previous.thread_usage,
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

export function mapFlowerContextCompactions(raw: unknown): readonly FlowerContextCompaction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const compactions = raw.map(mapContextCompaction).filter(isPresent);
  return compactions.length > 0 ? compactions : undefined;
}

export function mapFlowerTimelineDecorations(raw: unknown): readonly FlowerTimelineDecoration[] | undefined {
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
const activityRenderers = new Set<FlowerActivityRenderer>(['structured', 'terminal', 'file', 'patch', 'web_search', 'web_fetch', 'todos', 'question', 'subagent', 'subagent_operation', 'computer', 'browser']);
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

const structuredActivityRowKeys = new Set(['title', 'meta', 'content', 'format', 'language', 'truncated', 'target']);
const structuredActivityRowFormats = new Set(['text', 'markdown', 'code']);
const structuredActivityRowLimit = 200;
const webFetchActivityPayloadKeys = new Set([
  'url', 'final_url', 'status_code', 'content_type', 'format', 'content_preview', 'preview_truncated',
  'bytes_read', 'truncated', 'status', 'error',
]);
const webFetchActivityPreviewMaxCharacters = 2_000;
const subagentOperationActions = new Set(['spawn', 'wait', 'list', 'inspect', 'send_input', 'close', 'close_all']);
const subagentOperationPayloadKeys = new Set(['action', 'status', 'targets', 'requested_count', 'completed_count', 'missing_count', 'timed_out', 'error']);
const subagentOperationTargetKeys = new Set(['thread_id', 'task_name', 'task_description', 'status']);
const subagentOperationTargetLimit = 200;

function mapSubagentOperationActivityPayload(payload: JsonRecord): Readonly<Record<string, unknown>> {
  for (const key of Object.keys(payload)) {
    if (!subagentOperationPayloadKeys.has(key)) {
      throw new Error(`Flower contract error: activity_item.presentation.payload.${key} is not part of the Subagent operation contract.`);
    }
  }
  const action = trim(payload.action);
  if (!subagentOperationActions.has(action)) {
    throw new Error(`Flower contract error: activity_item.presentation.payload.action is unsupported: ${action || '<empty>'}.`);
  }
  const out: Record<string, unknown> = { action };
  const status = trim(payload.status);
  if (status) out.status = status;
  if (payload.targets !== undefined) {
    if (!Array.isArray(payload.targets) || payload.targets.length > subagentOperationTargetLimit) {
      throw new Error(`Flower contract error: activity_item.presentation.payload.targets must contain at most ${subagentOperationTargetLimit} entries.`);
    }
    const seen = new Set<string>();
    out.targets = payload.targets.map((value, index) => {
      const target = plainRecordValue(value);
      if (!target) {
        throw new Error(`Flower contract error: activity_item.presentation.payload.targets[${index}] must be an object.`);
      }
      for (const key of Object.keys(target)) {
        if (!subagentOperationTargetKeys.has(key)) {
          throw new Error(`Flower contract error: activity_item.presentation.payload.targets[${index}].${key} is unsupported.`);
        }
      }
      const threadID = trim(target.thread_id);
      const taskName = trim(target.task_name);
      if (!threadID && !taskName) {
        throw new Error(`Flower contract error: activity_item.presentation.payload.targets[${index}] requires thread_id or task_name.`);
      }
      if (threadID) {
        if (seen.has(threadID)) {
          throw new Error(`Flower contract error: activity_item.presentation.payload.targets[${index}].thread_id is duplicated.`);
        }
        seen.add(threadID);
      }
      const taskDescription = trim(target.task_description);
      const targetStatus = trim(target.status);
      return {
        ...(threadID ? { thread_id: threadID } : {}),
        ...(taskName ? { task_name: taskName } : {}),
        ...(taskDescription ? { task_description: taskDescription } : {}),
        ...(targetStatus ? { status: targetStatus } : {}),
      };
    });
  }
  for (const key of ['requested_count', 'completed_count', 'missing_count'] as const) {
    if (payload[key] !== undefined) out[key] = nonNegativeInteger(payload[key], `activity_item.presentation.payload.${key}`);
  }
  if (payload.timed_out !== undefined) {
    if (typeof payload.timed_out !== 'boolean') {
      throw new Error('Flower contract error: activity_item.presentation.payload.timed_out must be a boolean.');
    }
    out.timed_out = payload.timed_out;
  }
  if (payload.error !== undefined) {
    out.error = sanitizeActivityPublicValue(payload.error, 'activity_item.presentation.payload.error');
  }
  return out;
}

function mapStructuredActivityRows(raw: unknown, field: string): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(raw)) {
    throw new Error(`Flower contract error: activity_item.presentation.payload.${field} must be an array.`);
  }
  if (raw.length > structuredActivityRowLimit) {
    throw new Error(`Flower contract error: activity_item.presentation.payload.${field} exceeds ${structuredActivityRowLimit} rows.`);
  }
  return raw.map((value, index) => {
    const row = plainRecordValue(value);
    if (!row) {
      throw new Error(`Flower contract error: activity_item.presentation.payload.${field}[${index}] must be an object.`);
    }
    for (const key of Object.keys(row)) {
      if (!structuredActivityRowKeys.has(key)) {
        throw new Error(`Flower contract error: activity_item.presentation.payload.${field}[${index}].${key} is not part of the structured activity row contract.`);
      }
    }
    const title = trim(row.title);
    const meta = trim(row.meta);
    const content = typeof row.content === 'string' ? row.content : '';
    const language = trim(row.language);
    if (language && !/^[a-zA-Z0-9_+#.-]{1,64}$/u.test(language)) throw new Error(`Flower contract error: ${field}[${index}].language is invalid.`);
    if (row.truncated !== undefined && typeof row.truncated !== 'boolean') throw new Error(`Flower contract error: ${field}[${index}].truncated must be a boolean.`);
    const format = trim(row.format) || 'text';
    if (!structuredActivityRowFormats.has(format)) {
      throw new Error(`Flower contract error: activity_item.presentation.payload.${field}[${index}].format is unsupported.`);
    }
    if (!title && !meta && !content) {
      throw new Error(`Flower contract error: activity_item.presentation.payload.${field}[${index}] must contain display content.`);
    }
    if ((format === 'code' ? new TextEncoder().encode(content).length > 65536 : Array.from(content).length > 8000)) {
      throw new Error(`Flower contract error: ${field}[${index}].content exceeds the structured activity limit.`);
    }
    return {
      ...(row.target !== undefined ? {target:mapActivityTargetRef(row.target,index)} : {}),
      ...(language ? { language } : {}),
      ...(row.truncated !== undefined ? { truncated: row.truncated as boolean } : {}),
      ...(title ? { title } : {}),
      ...(meta ? { meta } : {}),
      ...(content ? { content } : {}),
      format,
    };
  });
}

function mapActivityPayload(raw: unknown, renderer?: FlowerActivityRenderer): Readonly<Record<string, unknown>> | undefined {
  if (!renderer) return undefined;
  const payload = plainRecordValue(raw);
  if (!payload) return undefined;
  if (renderer === 'subagent_operation') return mapSubagentOperationActivityPayload(payload);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const safeKey = trim(key);
    if (!safeKey) continue;
    if (renderer === 'web_fetch' && !webFetchActivityPayloadKeys.has(safeKey)) {
      throw new Error(`Flower contract error: activity_item.presentation.payload.${safeKey} is not part of the Web Fetch contract.`);
    }
    assertPublicActivityPayloadKey('activity_item.presentation.payload', safeKey);
    if (renderer === 'web_fetch') {
      if (safeKey === 'content_preview') {
        if (typeof value !== 'string' || Array.from(value).length > webFetchActivityPreviewMaxCharacters) {
          throw new Error(`Flower contract error: activity_item.presentation.payload.content_preview exceeds ${webFetchActivityPreviewMaxCharacters} characters.`);
        }
        out[safeKey] = value.replace(/\r\n?/gu, '\n');
        continue;
      }
      if (safeKey === 'preview_truncated') {
        if (typeof value !== 'boolean') {
          throw new Error('Flower contract error: activity_item.presentation.payload.preview_truncated must be a boolean.');
        }
        out[safeKey] = value;
        continue;
      }
    }
    if (safeKey === 'rows_provided' && typeof value !== 'boolean') throw new Error('Flower contract error: rows_provided must be a boolean.');
    if (safeKey === 'mutations' && Array.isArray(value)) {
      out[safeKey]=value.map((entry,index) => {
        const mutation=plainRecordValue(entry) ?? {};const {target,...rest}=mutation;
        return {...sanitizeActivityPublicValue(rest,'activity_item.presentation.payload.mutations') as Record<string,unknown>, ...(target !== undefined ? {target:mapActivityTargetRef(target,index)} : {})};
      });
      continue;
    }
    out[safeKey] = safeKey === 'rows' || safeKey === 'inputs'
      ? mapStructuredActivityRows(value, safeKey)
      : sanitizeActivityPublicValue(value, `activity_item.presentation.payload.${safeKey}`);
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
  const allowed = new Set(['kind', 'label', 'uri', 'resource_ref', 'path', 'line']);
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
    ...(record.path !== undefined ? {path: navigationPath(record.path,kind)} : {}),
    ...(trim(record.uri) ? { uri: trim(record.uri) } : {}),
    ...(trim(record.resource_ref) ? { resource_ref: trim(record.resource_ref) } : {}),
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
  const payload = mapActivityPayload(record.payload, renderer);
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
    },
    read_state: {
      last_seen_activity_revision: Math.max(0, Math.floor(Number(readState.last_seen_activity_revision ?? 0))),
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
    ...threadTitleSnapshot({
      title: trim(record.title),
      title_status: titleStatus(record.title_status, record.title),
      title_generation: record.title_generation as number,
    }),
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

export function mapFlowerSubagents(raw: unknown, field: string): readonly FlowerSubagentSummary[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`Flower contract error: ${field} must be an array.`);
  }
  return raw
    .map((value) => mapFlowerSubagentSummary(value))
    .filter((value): value is FlowerSubagentSummary => value !== null);
}

function messageBlockPreviewText(block: FlowerMessageBlock): string {
  if (block.type === 'markdown' || block.type === 'text') return trim(block.content);
  if (block.type === 'input-response') return inputResponseVisibleText(block);
  return '';
}

function mapMessageBlock(blockValue: unknown): FlowerMessageBlock | null {
  const block = recordValue(blockValue);
  if (!block) return null;
  const type = trim(block?.type);
  if (type === 'markdown' || type === 'text' || type === 'thinking') {
    return { type, content: typeof block.content === 'string' ? block.content : '', ...(block.sources ? { sources: mapFlowerCitationSources(block.sources) } : {}) };
  }
  if (type === 'image') {
    const src = safeFlowerAttachmentURL(block.src);
    if (!src) return null;
    const alt = trim(block.alt);
    return { type: 'image', src, ...(alt ? { alt } : {}) };
  }
  if (type === 'file') {
    const name = trim(block.name);
    const mimeType = trim(block.mimeType);
    const url = safeFlowerAttachmentURL(block.url);
    const size = Number(block.size);
    if (!name || !mimeType || !Number.isFinite(size) || size < 0) return null;
    return { type: 'file', name, mimeType, ...(url ? { url } : {}), size: Math.floor(size) };
  }
  if (type === 'input-response') {
    return mapFlowerInputResponseBlock(blockValue);
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
    const allowedFields = new Set(['reference_id', 'kind', 'label', 'text', 'truncated', 'referenced_thread_id']);
    for (const field of Object.keys(reference)) {
      if (!allowedFields.has(field)) {
        throw new Error(`Flower contract error: timeline message ${messageID} reference ${index} contains forbidden field ${field}.`);
      }
    }
    const referenceID = trim(reference.reference_id);
    const kind = trim(reference.kind) as NonNullable<FlowerChatMessage['references']>[number]['kind'];
    const label = trim(reference.label);
    if (!referenceID || !label || !['thread', 'text', 'file', 'directory', 'terminal', 'process'].includes(kind)) {
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
    if (kind === 'thread') {
      if (typeof reference.referenced_thread_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(reference.referenced_thread_id)
        || typeof reference.text !== 'string' || !reference.text) throw new Error('Flower contract error: invalid thread reference.');
      seen.add(referenceID);
      return { reference_id: referenceID, kind, referenced_thread_id: reference.referenced_thread_id, label, text: reference.text,
        ...(reference.truncated === true ? { truncated: true } : {}) };
    }
    if (reference.referenced_thread_id !== undefined) throw new Error('Flower contract error: unexpected referenced thread identity.');
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
  const content = blockContent || (typeof message.content === 'string' ? message.content : '');
  return {
    id,
    thread_id: threadID,
    turn_id: turnID,
    run_id: runID,
    ...(logicalRequestID ? { logical_request_id: logicalRequestID } : {}),
    role,
    ...(role === 'assistant' && message.sources ? { sources: mapFlowerCitationSources(message.sources) } : {}),
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
      ...(trim(record.request_key) ? { request_key: trim(record.request_key) } : {}),
      prompt: trim(record.text),
      created_at_ms: unixMs(record.created_at_unix_ms, 'queued_turn.created_at_unix_ms'),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(contextAction ? { context_action: contextAction } : {}),
    };
  });
  return turns;
}

export function mapFlowerCancellation(raw: unknown, threadID: string, runID = '', turnID = ''): FlowerThreadCancellation | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = recordValue(raw);
  if (!value || value.thread_id !== threadID || !trim(value.turn_id) || !trim(value.run_id)
    || (runID && value.run_id !== runID) || (turnID && value.turn_id !== turnID)
    || !trim(value.source) || !['immediate', 'graceful'].includes(trim(value.mode))
    || !trim(value.requested_at) || !Number.isFinite(Date.parse(trim(value.requested_at)))) {
    throw new Error('Flower contract error: cancellation requires an exact execution identity and request time.');
  }
  return { thread_id: threadID, turn_id: trim(value.turn_id), run_id: trim(value.run_id), source: trim(value.source), mode: value.mode as FlowerThreadCancellation['mode'], requested_at: trim(value.requested_at) };
}

export function mapFlowerThread(raw: unknown, messages: readonly FlowerChatMessage[], options: FlowerLiveThreadMapperOptions, readStatusRaw?: unknown): FlowerThreadSnapshot {
  const record = recordValue(raw) ?? {};
  const threadID = trim(record.thread_id);
  const status = runStatus(record.run_status);
  const activeRunID = status === 'running' || status === 'waiting_approval' || status === 'waiting_user'
    ? trim(record.active_run_id)
    : '';
  if ((status === 'running' || status === 'waiting_approval' || status === 'waiting_user') && !activeRunID) {
    throw new Error('Flower contract error: an active thread requires active_run_id.');
  }
  const progress = mapRunProgress(record.run_progress, activeRunID);
  if (status === 'running' && !progress) {
    throw new Error('Flower contract error: a running thread summary requires run_progress.');
  }
  const errorMessage = trim(record.run_error);
  const errorCode = trim(record.run_error_code);
  const modelContext = mapModelContext(record.model_context);
  const contextUsage = mapContextUsage(record.context_usage);
  const contextCompactions = mapFlowerContextCompactions(record.context_compactions);
  const timelineDecorations = mapFlowerTimelineDecorations(record.timeline_decorations);
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
    ...threadTitleSnapshot({
      title: trim(record.title),
      title_status: titleStatus(record.title_status, record.title),
      title_generation: record.title_generation as number,
    }),
    pin_rank: nonNegativeInteger(record.pin_rank ?? 0, 'thread.pin_rank'),
    model_id: trim(record.model_id),
    working_dir: trim(record.working_dir),
    ...(Number(record.pinned_at_unix_ms ?? 0) > 0 ? { pinned_at_ms: Math.floor(Number(record.pinned_at_unix_ms)) } : {}),
    settings_revision: nonNegativeInteger(record.settings_revision ?? 0, 'thread.settings_revision'),
    home_runtime_id: options.runtimeID,
    home_runtime_kind: options.runtimeKind,
    ...(trim(options.originEnvPublicID) ? { origin_env_public_id: trim(options.originEnvPublicID) } : {}),
    created_at_ms: unixMs(record.created_at_unix_ms, 'thread.created_at_unix_ms'),
    updated_at_ms: unixMs(record.updated_at_unix_ms ?? record.last_message_at_unix_ms, 'thread.updated_at_unix_ms'),
    status,
    ...(activeRunID ? { active_run_id: activeRunID } : {}),
    ...(progress ? { run_progress: progress } : {}),
    cancellation: mapFlowerCancellation(record.cancellation, threadID, activeRunID),
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
    ...(modelContext ? { model_context: modelContext } : {}),
    ...(contextUsage ? { context_usage: contextUsage } : {}),
    ...(contextCompactions ? { context_compactions: contextCompactions } : {}),
    ...(timelineDecorations ? { timeline_decorations: timelineDecorations } : {}),
    ...(subagents !== undefined ? { subagents } : {}),
    ...(errorMessage ? { error: { message: errorMessage, ...(trim(record.run_error_detail) ? { detail: trim(record.run_error_detail) } : {}), ...(errorCode ? { code: errorCode } : {}) } } : {}),
    read_status: mapFlowerReadStatus(readStatusRaw ?? record.read_status),
  };
  return thread;
}

function navigationPath(value: unknown, kind: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value !== value.trim()
    || value.includes('\0') || /[\r\n]/u.test(value) || Array.from(value).length > 500
    || !['file', 'directory'].includes(kind)) {
    throw new Error('Flower contract error: invalid navigation target path.');
  }
  return value;
}
