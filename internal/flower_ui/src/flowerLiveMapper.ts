import type {
  FlowerApprovalAction,
  FlowerChatMessage,
  FlowerLiveActiveRun,
  FlowerInputRequest,
  FlowerThreadLiveSnapshot,
  FlowerThreadLiveUpdate,
  FlowerThreadLiveUpdatesResponse,
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

export function mapFlowerReadStatus(raw: unknown): FlowerThreadReadStatus {
  const record = recordValue(raw);
  if (!record) {
    throw new Error('Flower contract error: read_status is required.');
  }
  const snapshot = recordValue(record.snapshot);
  const readState = recordValue(record.read_state);
  if (!snapshot || !readState) {
    throw new Error('Flower contract error: read_status snapshot/read_state are required.');
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
  if (!promptID || !messageID || !toolID || !toolName || questionsRaw.length === 0) return null;
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

function blockText(blockValue: unknown): string {
  const block = recordValue(blockValue);
  if (!block) return '';
  switch (trim(block?.type)) {
    case 'text':
    case 'markdown':
    case 'code':
    case 'svg':
    case 'mermaid':
      return trim(block.content);
    case 'shell':
      return [block.command, block.output].map(trim).filter(Boolean).join('\n');
    case 'file':
      return trim(block.name);
    case 'activity-timeline':
    case 'thinking':
      return '';
    default:
      return trim(block?.content);
  }
}

function mapMessageBlock(blockValue: unknown): FlowerMessageBlock | null {
  const block = recordValue(blockValue);
  if (!block) return null;
  const type = trim(block?.type);
  if (type === 'markdown' || type === 'text' || type === 'thinking') {
    return trim(block.content) ? { type, content: trim(block.content) } : null;
  }
  if (type === 'activity-timeline') {
    return blockValue as FlowerMessageBlock;
  }
  const content = blockText(blockValue);
  return content ? { type: 'text', content } : null;
}

export function mapFlowerMessage(raw: unknown): FlowerChatMessage | null {
  const message = recordValue(raw);
  if (!message) return null;
  const id = trim(message.id);
  const role = trim(message.role).toLowerCase();
  if (!id || (role !== 'user' && role !== 'assistant' && role !== 'system')) return null;
  const blocksRaw = Array.isArray(message.blocks) ? message.blocks : [];
  const blocks = blocksRaw.map(mapMessageBlock).filter(isPresent);
  return {
    id,
    role,
    content: blocksRaw.map(blockText).filter(Boolean).join('\n\n'),
    status: trim(message.status) as FlowerChatMessage['status'] || 'complete',
    created_at_ms: unixMs(message.timestamp ?? message.created_at_ms, 'message.timestamp'),
    ...(blocks.length > 0 ? { blocks } : {}),
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

export function mapFlowerThread(raw: unknown, messages: readonly FlowerChatMessage[], options: FlowerLiveThreadMapperOptions, readStatusRaw?: unknown): FlowerThreadSnapshot {
  const record = recordValue(raw) ?? {};
  const threadID = trim(record.thread_id);
  const status = runStatus(record.run_status);
  const inputRequest = status === 'waiting_user' ? mapInputRequest(record.waiting_prompt) : null;
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
    source_label: options.sourceLabel,
    target_labels: options.targetLabels,
    messages,
    ...(inputRequest ? { input_request: inputRequest } : {}),
    ...(errorMessage ? { error: { message: errorMessage, ...(errorCode ? { code: errorCode } : {}) } } : {}),
    read_status: mapFlowerReadStatus(readStatusRaw ?? record.read_status),
  };
}

function mapActiveRun(raw: unknown): FlowerLiveActiveRun | null {
  const record = recordValue(raw);
  if (!record) return null;
  return {
    run_id: trim(record.run_id),
    status: runStatus(record.status),
    message: mapFlowerMessage(record.message),
    ...(record.waiting_prompt !== undefined ? { input_request: mapInputRequest(record.waiting_prompt) } : {}),
    approval_actions: Array.isArray(record.approval_actions) ? record.approval_actions.map(mapApprovalAction).filter(isPresent) : [],
    last_event_seq: Math.max(0, Math.floor(Number(record.last_event_seq ?? 0))),
  };
}

export function mapFlowerLiveSnapshot(raw: unknown, options: FlowerLiveThreadMapperOptions): FlowerThreadLiveSnapshot {
  const record = recordValue(raw) ?? {};
  const thread = recordValue(record.thread);
  const messages = Array.isArray(record.messages) ? record.messages.map(mapFlowerMessage).filter(isPresent) : [];
  return {
    thread: mapFlowerThread(record.thread, messages, options, record.read_status ?? thread?.read_status),
    ...(record.active_run ? { active_run: mapActiveRun(record.active_run) } : {}),
    ...(record.read_status ? { read_status: mapFlowerReadStatus(record.read_status) } : {}),
    event_cursor: Math.max(0, Math.floor(Number(record.event_cursor ?? 0))),
    generated_at_ms: Math.max(0, Math.floor(Number(record.generated_at_unix_ms ?? Date.now()))),
  };
}

export function mapFlowerLiveUpdates(raw: unknown, options: FlowerLiveThreadMapperOptions): FlowerThreadLiveUpdatesResponse {
  const record = recordValue(raw) ?? {};
  return {
    updates: (Array.isArray(record.updates) ? record.updates : []).map((updateValue): FlowerThreadLiveUpdate => {
      const update = recordValue(updateValue) ?? {};
      const thread = recordValue(update.thread);
      return {
        seq: Math.max(0, Math.floor(Number(update.seq ?? 0))),
        thread_id: trim(update.thread_id),
        kind: trim(update.kind) as FlowerThreadLiveUpdate['kind'],
        at_ms: Math.max(0, Math.floor(Number(update.at_unix_ms ?? 0))),
        ...(update.thread ? { thread: mapFlowerThread(update.thread, [], options, update.read_status ?? thread?.read_status) } : {}),
        ...(update.message ? { message: mapFlowerMessage(update.message) ?? undefined } : {}),
        ...(update.active_run ? { active_run: mapActiveRun(update.active_run) } : {}),
        ...(update.clear_active_run ? { clear_active_run: true } : {}),
        ...(update.read_status ? { read_status: mapFlowerReadStatus(update.read_status) } : {}),
        ...(trim(update.resync_reason) ? { resync_reason: trim(update.resync_reason) } : {}),
      };
    }).filter((update: FlowerThreadLiveUpdate) => update.seq > 0 && update.thread_id && update.kind),
    next_cursor: Math.max(0, Math.floor(Number(record.next_cursor ?? 0))),
    ...(record.has_more ? { has_more: true } : {}),
  };
}
