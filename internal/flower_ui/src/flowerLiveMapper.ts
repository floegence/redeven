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
  FlowerLiveBootstrap,
  FlowerLiveBlock,
  FlowerLiveEvent,
  FlowerLiveEventsResponse,
  FlowerLiveMaterializedState,
  FlowerLiveMessageCommittedPayload,
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
  FlowerLiveResyncRequiredPayload,
  FlowerModelIOPhase,
  FlowerModelIOStatus,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerThreadStatus,
} from './contracts/flowerSurfaceContracts';

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
const activityKinds = new Set<FlowerActivityKind>(['tool', 'hosted_tool', 'approval', 'control', 'budget']);
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
  const items = Array.isArray(record.items) ? record.items.map(mapActivityItem).filter(isPresent) : [];
  const summary = plainRecordValue(record.summary) ?? {};
  const attention = activityAttentionReasonArray(summary.attention_reasons);
  const fileActions = mapActivityFileActions(record.file_actions);
  return {
    type: 'activity-timeline',
    schema_version: positiveInteger(record.schema_version) ?? 1,
    ...(trim(record.run_id) ? { run_id: trim(record.run_id) } : {}),
    ...(trim(record.thread_id) ? { thread_id: trim(record.thread_id) } : {}),
    ...(trim(record.turn_id) ? { turn_id: trim(record.turn_id) } : {}),
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
  return {
    prompt_id: promptID,
    message_id: messageID,
    tool_id: toolID,
    tool_name: toolName,
    ...(trim(record.reason_code) ? { reason_code: trim(record.reason_code) } : {}),
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
                    ...(trim(action.mode) ? { mode: trim(action.mode) } : {}),
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
    if (typeof block.content !== 'string' || trim(block.content) === '') return null;
    return { type, content: block.content };
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
  return 'complete';
}

export function mapFlowerMessage(raw: unknown): FlowerChatMessage | null {
  const message = recordValue(raw);
  if (!message) return null;
  const id = trim(message.id);
  const role = trim(message.role).toLowerCase();
  if (!id || (role !== 'user' && role !== 'assistant' && role !== 'system')) return null;
  const blocksRaw = Array.isArray(message.blocks) ? message.blocks : [];
  const blocks = blocksRaw.map(mapMessageBlock).filter(isPresent);
  const contextAction = recordValue(message.context_action) ?? recordValue(message.contextAction);
  const blockContent = blocks.map(messageBlockPreviewText).filter(Boolean).join('\n\n');
  const content = blockContent || trim(message.content);
  return {
    id,
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

function mapApprovalAction(raw: unknown): FlowerApprovalAction | null {
  const record = recordValue(raw);
  if (!record) return null;
  const actionID = trim(record.action_id);
  const runID = trim(record.run_id);
  const toolID = trim(record.tool_id);
  if (!actionID || !runID || !toolID) return null;
  const summary = recordValue(record.summary) ?? {};
  return {
    action_id: actionID,
    run_id: runID,
    ...(trim(record.turn_id) ? { turn_id: trim(record.turn_id) } : {}),
    tool_id: toolID,
    tool_name: trim(record.tool_name) || 'tool',
    state: trim(record.state) as FlowerApprovalAction['state'] || 'requested',
    status: trim(record.status) as FlowerApprovalAction['status'] || 'pending',
    revision: Math.max(0, Math.floor(Number(record.revision ?? 0))),
    requested_at_ms: Math.max(0, Math.floor(Number(record.requested_at_unix_ms ?? 0))),
    ...(positiveInteger(record.resolved_at_unix_ms) ? { resolved_at_ms: positiveInteger(record.resolved_at_unix_ms) } : {}),
    ...(positiveInteger(record.expires_at_unix_ms) ? { expires_at_ms: positiveInteger(record.expires_at_unix_ms) } : {}),
    can_approve: Boolean(record.can_approve),
    ...(positiveInteger(record.expected_seq) ? { expected_seq: positiveInteger(record.expected_seq) } : {}),
    ...(trim(record.read_only_reason) ? { read_only_reason: trim(record.read_only_reason) } : {}),
    summary: {
      label: trim(summary.label) || trim(record.tool_name) || 'Tool approval',
      ...(trim(summary.description) ? { description: trim(summary.description) } : {}),
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
}

function mapThreadPatch(raw: unknown): FlowerLiveThreadPatch | null {
  const record = recordValue(raw);
  if (!record) return null;
  const patch = recordValue(record.patch) ?? record;
  const queuedTurnCount = positiveInteger(patch.queued_turn_count);
  const readStatus = patch.read_status === undefined ? null : mapFlowerReadStatus(patch.read_status);
  return {
    ...(trim(patch.thread_id) ? { thread_id: trim(patch.thread_id) } : {}),
    ...(trim(patch.title) ? { title: trim(patch.title) } : {}),
    ...(trim(patch.model_id) ? { model_id: trim(patch.model_id) } : {}),
    ...(patch.model_locked !== undefined ? { model_locked: Boolean(patch.model_locked) } : {}),
    ...(trim(patch.execution_mode) ? { execution_mode: trim(patch.execution_mode) } : {}),
    ...(trim(patch.working_dir) ? { working_dir: trim(patch.working_dir) } : {}),
    ...(queuedTurnCount !== undefined ? { queued_turn_count: queuedTurnCount } : {}),
    ...(trim(patch.run_status) ? { run_status: trim(patch.run_status) } : {}),
    ...(positiveInteger(patch.run_updated_at_unix_ms) ? { run_updated_at_ms: positiveInteger(patch.run_updated_at_unix_ms) } : {}),
    ...(trim(patch.run_error_code) ? { run_error_code: trim(patch.run_error_code) } : {}),
    ...(trim(patch.run_error) ? { run_error: trim(patch.run_error) } : {}),
    ...(patch.waiting_prompt !== undefined ? { waiting_prompt: mapInputRequest(patch.waiting_prompt) } : {}),
    ...(trim(patch.last_context_run_id) ? { last_context_run_id: trim(patch.last_context_run_id) } : {}),
    ...(positiveInteger(patch.pinned_at_unix_ms) ? { pinned_at_ms: positiveInteger(patch.pinned_at_unix_ms) } : {}),
    ...(positiveInteger(patch.created_at_unix_ms) ? { created_at_ms: positiveInteger(patch.created_at_unix_ms) } : {}),
    ...(positiveInteger(patch.updated_at_unix_ms) ? { updated_at_ms: positiveInteger(patch.updated_at_unix_ms) } : {}),
    ...(positiveInteger(patch.last_message_at_unix_ms) ? { last_message_at_ms: positiveInteger(patch.last_message_at_unix_ms) } : {}),
    ...(trim(patch.last_message_preview) ? { last_message_preview: trim(patch.last_message_preview) } : {}),
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
  const approvalsRecord = recordValue(record.approval_actions) ?? {};
  for (const [actionID, value] of Object.entries(approvalsRecord)) {
    const action = mapApprovalAction({ action_id: actionID, ...(recordValue(value) ?? {}) });
    if (action) approvals[actionID] = action;
  }
  const inputsRecord = recordValue(record.input_requests) ?? {};
  for (const [promptID, value] of Object.entries(inputsRecord)) {
    const input = mapInputRequest(value);
    if (input) inputRequests[promptID] = input;
  }
  const modelIO = mapModelIOStatus(record.model_io);

  return {
    thread_patch: mapThreadPatch(record.thread_patch) ?? {},
    runs,
    ...(modelIO ? { model_io: modelIO } : {}),
    approval_actions: approvals,
    input_requests: inputRequests,
  };
}

export function mapFlowerThread(raw: unknown, messages: readonly FlowerChatMessage[], options: FlowerLiveThreadMapperOptions, readStatusRaw?: unknown): FlowerThreadSnapshot {
  const record = recordValue(raw) ?? {};
  const threadID = trim(record.thread_id);
  const status = runStatus(record.run_status);
  const activeRunID = status === 'running' ? trim(record.last_context_run_id) : '';
  const waitingPrompt = record.waiting_prompt !== undefined ? mapInputRequest(record.waiting_prompt) : null;
  const inputRequest = status === 'waiting_user' ? waitingPrompt : null;
  const errorMessage = trim(record.run_error);
  const errorCode = trim(record.run_error_code);
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
    source_label: options.sourceLabel,
    target_labels: options.targetLabels,
    messages,
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
    case 'message.committed':
      {
        const message = mapFlowerMessage(record.message);
        if (!message) {
          throw new Error('Flower contract error: message.committed requires a valid message.');
        }
        return {
          message_id: trim(record.message_id) || message.id,
          message,
        } as FlowerLiveMessageCommittedPayload;
      }
    case 'message.failed':
      return {
        message_id: trim(record.message_id),
        error: trim(record.error),
      } as FlowerLiveMessageFailedPayload;
    case 'activity.updated':
      {
        const activity = mapActivityTimelineBlock(record.activity);
        if (!activity) {
          throw new Error('Flower contract error: activity.updated requires a valid activity timeline block.');
        }
        return {
        run_id: trim(record.run_id),
        message_id: trim(record.message_id),
        block_index: Math.max(0, Math.floor(Number(record.block_index ?? 0))),
          activity,
        };
      }
    case 'approval.requested':
    case 'approval.resolved':
      return { action: mapApprovalAction(record.action) ?? undefined } as FlowerLiveApprovalPayload;
    case 'input.requested':
      return { request: mapInputRequest(record.request) ?? undefined } as FlowerLiveInputRequestedPayload;
    case 'input.resolved':
      return { prompt_id: trim(record.prompt_id) } as FlowerLiveInputResolvedPayload;
    case 'model_io.updated':
      return { status: mapModelIOStatus(record.status) } as FlowerLiveModelIOUpdatedPayload;
    case 'usage.updated':
      return { usage: record.usage && typeof record.usage === 'object' ? record.usage as Record<string, unknown> : {} } as FlowerLiveUsageUpdatedPayload;
    case 'timeline.replaced':
      return {
        messages: Array.isArray(record.messages) ? record.messages.map(mapFlowerMessage).filter(isPresent) : [],
      };
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
  'message.committed',
  'message.failed',
  'activity.updated',
  'approval.requested',
  'approval.resolved',
  'input.requested',
  'input.resolved',
  'model_io.updated',
  'usage.updated',
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
  const timelineMessages = Array.isArray(record.timeline_messages) ? record.timeline_messages.map(mapFlowerMessage).filter(isPresent) : [];
  const thread = mapFlowerThread(record.thread, timelineMessages, options, record.read_status);
  return {
    schema_version: Math.max(0, Math.floor(Number(record.schema_version ?? 0))),
    endpoint_id: trim(record.endpoint_id),
    thread_id: trim(record.thread_id) || thread.thread_id,
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
