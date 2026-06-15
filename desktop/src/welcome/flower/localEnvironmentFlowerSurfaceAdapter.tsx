import type {
  DesktopSettingsDraft,
  SaveDesktopSettingsResult,
} from '../../shared/settingsIPC';
import type {
  RuntimeFlowerError,
  RuntimeFlowerRequest,
  RuntimeFlowerRequestResult,
} from '../../shared/runtimeFlowerIPC';
import type {
  FlowerActivityChip,
  FlowerActivityRenderer,
  FlowerActivityTargetRef,
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerChatMessageBlock,
  FlowerInputRequest,
  FlowerInputRequestQuestion,
  FlowerProvider,
  FlowerProviderDraft,
  FlowerProviderModel,
  FlowerRouterDecision,
  FlowerSendMessageInput,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSurfaceAdapter,
  FlowerThreadActivitySnapshot,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerThreadStatus,
} from '../../../../internal/flower_ui/src/contracts/flowerSurfaceContracts';
import type {
  AgentSettingsResponse,
  AIConfig,
} from '../../../../internal/envapp/ui_src/src/ui/pages/settings/types';
import type {
  Message,
  MessageBlock,
} from '../../../../internal/envapp/ui_src/src/ui/chat/types';

export type DesktopSettingsBridge = Readonly<{
  save: (draft: DesktopSettingsDraft) => Promise<SaveDesktopSettingsResult>;
  requestRuntimeFlower: (request: RuntimeFlowerRequest) => Promise<RuntimeFlowerRequestResult>;
  cancel: () => void;
}>;

export type LocalEnvironmentFlowerSurfaceAdapterOptions = Readonly<{
  runtimeDisplayName?: string;
  runtimeSubtitle?: string;
}>;

type ModelsResponse = Readonly<{
  current_model?: string;
  models?: readonly Readonly<{
    id?: string;
    label?: string;
    context_window?: number;
    max_output_tokens?: number;
    input_modalities?: readonly string[];
  }>[];
}>;

type ThreadReadStatus = FlowerThreadReadStatus;

type ThreadWaitingPrompt = Readonly<{
  prompt_id?: string;
  message_id?: string;
  tool_id?: string;
  tool_name?: string;
  reason_code?: string;
  required_from_user?: readonly string[];
  evidence_refs?: readonly string[];
  public_summary?: string;
  contains_secret?: boolean;
  questions?: readonly Readonly<{
    id?: string;
    header?: string;
    question?: string;
    is_secret?: boolean;
    response_mode?: string;
    choices_exhaustive?: boolean;
    write_label?: string;
    write_placeholder?: string;
    choices?: readonly Readonly<{
      choice_id?: string;
      label?: string;
      description?: string;
      kind?: string;
      input_placeholder?: string;
      actions?: readonly Readonly<{
        type?: string;
        mode?: string;
      }>[];
    }>[];
  }>[];
}>;

type ThreadView = Readonly<{
  thread_id?: string;
  title?: string;
  model_id?: string;
  run_status?: string;
  run_error_code?: string;
  run_error?: string;
  working_dir?: string;
  pinned_at_unix_ms?: number;
  created_at_unix_ms?: number;
  updated_at_unix_ms?: number;
  last_message_at_unix_ms?: number;
  last_message_preview?: string;
  waiting_prompt?: ThreadWaitingPrompt;
  read_status: ThreadReadStatus;
}>;

type ListThreadsResponse = Readonly<{
  threads?: readonly ThreadView[];
}>;

type CreateThreadResponse = Readonly<{
  thread?: ThreadView;
}>;

type LoadThreadResponse = Readonly<{
  thread?: ThreadView;
}>;

type ListThreadMessagesResponse = Readonly<{
  messages?: readonly unknown[];
}>;

type MarkThreadReadResponse = Readonly<{
  read_status: ThreadReadStatus;
}>;

type FlowerInputResponseMode = NonNullable<FlowerInputRequestQuestion['response_mode']>;
type FlowerSecretPatch = Readonly<{ provider_id: string; api_key: string | null }>;

const LOCAL_ENVIRONMENT_RUNTIME_ID = 'env:local-environment';
const LOCAL_ENVIRONMENT_LABEL = 'Local Environment';
const LOCAL_ENVIRONMENT_SUBTITLE = 'Uses the Local AI Profile on this Mac';

const FLOWER_ACTIVITY_RENDERERS = new Set<FlowerActivityRenderer>([
  'structured',
  'terminal',
  'file',
  'patch',
  'web_search',
  'todos',
  'question',
  'completion',
]);

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function flowerContractError(message: string): never {
  throw new Error(`Flower contract error: ${message}`);
}

function runtimeFlowerError(error: RuntimeFlowerError): Error & { code?: string; status?: number; retryAfterMs?: number } {
  const out = new Error(trim(error.message) || 'Flower request failed.') as Error & { code?: string; status?: number; retryAfterMs?: number };
  if (trim(error.code)) out.code = trim(error.code);
  if (typeof error.status === 'number') out.status = error.status;
  if (typeof error.retryAfterMs === 'number') out.retryAfterMs = error.retryAfterMs;
  return out;
}

async function runtimeJSON<T>(
  bridge: DesktopSettingsBridge,
  method: RuntimeFlowerRequest['method'],
  path: string,
  body?: unknown,
): Promise<T> {
  const result = await bridge.requestRuntimeFlower({
    method,
    path,
    ...(body === undefined ? {} : { body }),
  });
  if (!result.ok) {
    throw runtimeFlowerError(result.error);
  }
  return result.data as T;
}

function positiveInteger(raw: unknown): number | undefined {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function unixMs(raw: unknown, field: string): number {
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    flowerContractError(`${field} must be a positive unix timestamp.`);
  }
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
}

function defaultConfig(): FlowerSettingsSnapshot['config'] {
  return {
    schema_version: 1,
    current_model_id: '',
    execution_policy: {
      require_user_approval: true,
      block_dangerous_commands: true,
    },
    terminal_exec_policy: {
      default_timeout_ms: 120000,
      max_timeout_ms: 600000,
    },
    providers: [],
  };
}

function mapProviderModel(model: NonNullable<AIConfig['providers'][number]['models']>[number]): FlowerProviderModel {
  return {
    model_name: trim(model.model_name),
    ...(positiveInteger(model.context_window) ? { context_window: positiveInteger(model.context_window) } : {}),
    ...(positiveInteger(model.max_output_tokens) ? { max_output_tokens: positiveInteger(model.max_output_tokens) } : {}),
    ...(positiveInteger(model.effective_context_window_percent) ? { effective_context_window_percent: positiveInteger(model.effective_context_window_percent) } : {}),
    ...(Array.isArray(model.input_modalities) ? { input_modalities: model.input_modalities.map(trim).filter(Boolean) } : {}),
  };
}

function mapProvider(provider: AIConfig['providers'][number]): FlowerProvider {
  return {
    id: trim(provider.id),
    ...(trim(provider.name) ? { name: trim(provider.name) } : {}),
    type: provider.type,
    ...(trim(provider.base_url) ? { base_url: trim(provider.base_url) } : {}),
    ...(provider.web_search ? { web_search: { mode: provider.web_search.mode ?? 'disabled' } } : {}),
    models: (provider.models ?? []).map(mapProviderModel).filter((model) => model.model_name),
  };
}

export function mapRuntimeFlowerSettings(settings: AgentSettingsResponse): FlowerSettingsSnapshot {
  const ai = settings.ai;
  const config = ai
    ? {
        schema_version: 1 as const,
        current_model_id: trim(ai.current_model_id),
        execution_policy: {
          require_user_approval: ai.execution_policy?.require_user_approval ?? true,
          block_dangerous_commands: ai.execution_policy?.block_dangerous_commands ?? true,
        },
        terminal_exec_policy: {
          default_timeout_ms: positiveInteger(ai.terminal_exec_policy?.default_timeout_ms) ?? 120000,
          max_timeout_ms: positiveInteger(ai.terminal_exec_policy?.max_timeout_ms) ?? 600000,
        },
        providers: (ai.providers ?? []).map(mapProvider).filter((provider) => provider.id && provider.models.length > 0),
      }
    : defaultConfig();
  const providerSecrets = settings.ai_secrets?.provider_api_key_set ?? {};
  const webSecrets = settings.ai_secrets?.web_search_provider_api_key_set ?? {};
  return {
    config,
    provider_secrets: config.providers.map((provider) => ({
      provider_id: provider.id,
      provider_api_key_configured: Boolean(providerSecrets[provider.id]),
      web_search_api_key_configured: Boolean(webSecrets[provider.id]),
    })),
  };
}

function draftProviderToAI(provider: FlowerProviderDraft): AIConfig['providers'][number] {
  return {
    id: trim(provider.id),
    ...(trim(provider.name) ? { name: trim(provider.name) } : {}),
    type: provider.type,
    ...(trim(provider.base_url) ? { base_url: trim(provider.base_url) } : {}),
    ...(provider.web_search ? { web_search: provider.web_search } : {}),
    models: provider.models.map((model) => ({
      model_name: trim(model.model_name),
      ...(positiveInteger(model.context_window) ? { context_window: positiveInteger(model.context_window) } : {}),
      ...(positiveInteger(model.max_output_tokens) ? { max_output_tokens: positiveInteger(model.max_output_tokens) } : {}),
      ...(positiveInteger(model.effective_context_window_percent) ? { effective_context_window_percent: positiveInteger(model.effective_context_window_percent) } : {}),
      ...(Array.isArray(model.input_modalities) ? { input_modalities: model.input_modalities.map(trim).filter(Boolean) as Array<'text' | 'image'> } : {}),
    })),
  };
}

export function mapFlowerSettingsDraftToRuntimeBundle(draft: FlowerSettingsDraft): {
  ai: AIConfig;
  provider_api_key_patches: readonly FlowerSecretPatch[];
  web_search_provider_key_patches: readonly FlowerSecretPatch[];
} {
  const providerAPIKeyPatches: FlowerSecretPatch[] = draft.config.providers.flatMap((provider): FlowerSecretPatch[] => {
    if (provider.provider_api_key === undefined) return [];
    const providerID = trim(provider.id);
    if (!providerID) return [];
    if (provider.provider_api_key === null) return [{ provider_id: providerID, api_key: null }];
    const apiKey = trim(provider.provider_api_key);
    return apiKey ? [{ provider_id: providerID, api_key: apiKey }] : [];
  });
  const webSearchKeyPatches: FlowerSecretPatch[] = draft.config.providers.flatMap((provider): FlowerSecretPatch[] => {
    if (provider.web_search_api_key === undefined) return [];
    const providerID = trim(provider.id);
    if (!providerID) return [];
    if (provider.web_search_api_key === null) return [{ provider_id: providerID, api_key: null }];
    const apiKey = trim(provider.web_search_api_key);
    return apiKey ? [{ provider_id: providerID, api_key: apiKey }] : [];
  });
  return {
    ai: {
      current_model_id: trim(draft.config.current_model_id),
      execution_policy: {
        require_user_approval: draft.config.execution_policy.require_user_approval,
        block_dangerous_commands: draft.config.execution_policy.block_dangerous_commands,
      },
      terminal_exec_policy: {
        default_timeout_ms: draft.config.terminal_exec_policy.default_timeout_ms,
        max_timeout_ms: draft.config.terminal_exec_policy.max_timeout_ms,
      },
      providers: draft.config.providers.map(draftProviderToAI),
    },
    provider_api_key_patches: providerAPIKeyPatches,
    web_search_provider_key_patches: webSearchKeyPatches,
  };
}

function readStatus(thread: ThreadView): ThreadReadStatus {
  if (!thread.read_status || typeof thread.read_status !== 'object') {
    flowerContractError('thread.read_status is required.');
  }
  if (typeof thread.read_status.is_unread !== 'boolean') {
    flowerContractError('thread.read_status.is_unread must be a boolean.');
  }
  if (!thread.read_status.snapshot || typeof thread.read_status.snapshot !== 'object') {
    flowerContractError('thread.read_status.snapshot is required.');
  }
  const lastMessageAtUnixMs = Number(thread.read_status.snapshot.last_message_at_unix_ms ?? 0);
  if (!Number.isFinite(lastMessageAtUnixMs) || lastMessageAtUnixMs < 0) {
    flowerContractError('thread.read_status.snapshot.last_message_at_unix_ms must be a non-negative number.');
  }
  const activityRevision = Number(thread.read_status.snapshot.activity_revision);
  if (!Number.isFinite(activityRevision) || activityRevision < 0) {
    flowerContractError('thread.read_status.snapshot.activity_revision must be a non-negative number.');
  }
  const activitySignature = trim(thread.read_status.snapshot.activity_signature);
  if (!activitySignature) {
    flowerContractError('thread.read_status.snapshot.activity_signature is required.');
  }
  if (!thread.read_status.read_state || typeof thread.read_status.read_state !== 'object') {
    flowerContractError('thread.read_status.read_state is required.');
  }
  const lastReadMessageAtUnixMs = Number(thread.read_status.read_state.last_read_message_at_unix_ms ?? -1);
  if (!Number.isFinite(lastReadMessageAtUnixMs) || lastReadMessageAtUnixMs < 0) {
    flowerContractError('thread.read_status.read_state.last_read_message_at_unix_ms must be a non-negative number.');
  }
  const lastSeenActivityRevision = Number(thread.read_status.read_state.last_seen_activity_revision);
  if (!Number.isFinite(lastSeenActivityRevision) || lastSeenActivityRevision < 0) {
    flowerContractError('thread.read_status.read_state.last_seen_activity_revision must be a non-negative number.');
  }
  const lastSeenActivitySignature = trim(thread.read_status.read_state.last_seen_activity_signature);
  if (typeof thread.read_status.read_state.last_seen_activity_signature !== 'string') {
    flowerContractError('thread.read_status.read_state.last_seen_activity_signature must be a string.');
  }
  return {
    is_unread: thread.read_status.is_unread,
    snapshot: {
      activity_revision: Math.floor(activityRevision),
      last_message_at_unix_ms: Math.floor(lastMessageAtUnixMs),
      activity_signature: activitySignature,
      ...(trim(thread.read_status.snapshot.waiting_prompt_id) ? { waiting_prompt_id: trim(thread.read_status.snapshot.waiting_prompt_id) } : {}),
    },
    read_state: {
      last_seen_activity_revision: Math.floor(lastSeenActivityRevision),
      last_read_message_at_unix_ms: Math.floor(lastReadMessageAtUnixMs),
      last_seen_activity_signature: lastSeenActivitySignature,
      ...(trim(thread.read_status.read_state.last_seen_waiting_prompt_id) ? { last_seen_waiting_prompt_id: trim(thread.read_status.read_state.last_seen_waiting_prompt_id) } : {}),
    },
  };
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
      flowerContractError(`thread.run_status is unsupported: ${trim(raw) || '<empty>'}.`);
  }
}

function normalizeActivityRenderer(value: unknown, field: string): FlowerActivityRenderer | undefined {
  const renderer = trim(value);
  if (!renderer) return undefined;
  if (FLOWER_ACTIVITY_RENDERERS.has(renderer as FlowerActivityRenderer)) {
    return renderer as FlowerActivityRenderer;
  }
  flowerContractError(`${field} is unsupported: ${renderer}.`);
}

function requireActivityString(value: unknown, field: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') {
    flowerContractError(`${field} must be a string.`);
  }
  const text = value.trim();
  if (!allowEmpty && !text) {
    flowerContractError(`${field} is required.`);
  }
  if (text.length > maxLength) {
    flowerContractError(`${field} must be at most ${maxLength} characters.`);
  }
  return text;
}

function optionalActivityString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireActivityString(value, field, maxLength, true);
}

function requireActivityToken(value: unknown, field: string, maxLength: number): string {
  const token = requireActivityString(value, field, maxLength);
  if (!/^[A-Za-z0-9_.:-]+$/.test(token)) {
    flowerContractError(`${field} must be a token up to ${maxLength} characters.`);
  }
  return token;
}

function validateActivityPayloadKey(key: string, field: string) {
  if (key.length > 80 || !/^[A-Za-z0-9_.:-]+$/.test(key)) {
    flowerContractError(`${field} must use token keys up to 80 characters.`);
  }
}

function normalizeActivityJSONValue(value: unknown, field: string, depth: number): unknown {
  if (depth > 8) {
    flowerContractError(`${field} exceeds maximum depth.`);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 8000) {
      flowerContractError(`${field} must be at most 8000 characters.`);
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      flowerContractError(`${field} must be a finite number.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeActivityJSONValue(item, `${field}[${index}]`, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      validateActivityPayloadKey(key, `${field}.${key}`);
      out[key] = normalizeActivityJSONValue(item, `${field}.${key}`, depth + 1);
    }
    return out;
  }
  flowerContractError(`${field} must be JSON-compatible.`);
}

function normalizeActivityPayload(value: unknown, field: string): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    flowerContractError(`${field} must be an object.`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    validateActivityPayloadKey(key, `${field}.${key}`);
    out[key] = normalizeActivityJSONValue(item, `${field}.${key}`, 1);
  }
  return out;
}

function normalizeActivityChips(value: unknown, field: string): readonly FlowerActivityChip[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    flowerContractError(`${field} must be an array.`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      flowerContractError(`${field}[${index}] must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const chipValue = optionalActivityString(record.value, `${field}[${index}].value`, 120);
    const tone = record.tone === undefined || record.tone === null
      ? undefined
      : requireActivityToken(record.tone, `${field}[${index}].tone`, 32);
    return {
      kind: requireActivityToken(record.kind, `${field}[${index}].kind`, 64),
      label: requireActivityString(record.label, `${field}[${index}].label`, 120),
      ...(chipValue ? { value: chipValue } : {}),
      ...(tone ? { tone } : {}),
    };
  });
}

function normalizeActivityTargetRefs(value: unknown, field: string): readonly FlowerActivityTargetRef[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    flowerContractError(`${field} must be an array.`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      flowerContractError(`${field}[${index}] must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const uri = optionalActivityString(record.uri, `${field}[${index}].uri`, 1000);
    if (uri && !uri.startsWith('http://') && !uri.startsWith('https://') && !uri.startsWith('artifact://')) {
      flowerContractError(`${field}[${index}].uri must use http, https, or artifact scheme.`);
    }
    const line = record.line === undefined || record.line === null ? undefined : record.line;
    if (line !== undefined && (typeof line !== 'number' || !Number.isInteger(line) || line < 0)) {
      flowerContractError(`${field}[${index}].line must be a non-negative integer.`);
    }
    const targetPath = optionalActivityString(record.path, `${field}[${index}].path`, 500);
    return {
      kind: requireActivityToken(record.kind, `${field}[${index}].kind`, 64),
      label: requireActivityString(record.label, `${field}[${index}].label`, 240),
      ...(uri ? { uri } : {}),
      ...(targetPath ? { path: targetPath } : {}),
      ...(typeof line === 'number' ? { line } : {}),
    };
  });
}

function blockText(block: MessageBlock): string {
  switch (block.type) {
    case 'text':
    case 'markdown':
    case 'code':
    case 'svg':
    case 'mermaid':
      return trim(block.content);
    case 'code-diff':
      return [block.oldCode, block.newCode].map(trim).filter(Boolean).join('\n\n');
    case 'shell':
      return [block.command, block.output].map(trim).filter(Boolean).join('\n');
    case 'file':
      return trim(block.name);
    case 'checklist':
      return block.items.map((item) => item.text).map(trim).filter(Boolean).join('\n');
    case 'todos':
      return block.todos.map((item) => item.content).map(trim).filter(Boolean).join('\n');
    case 'sources':
      return block.sources.map((item) => item.title || item.url).map(trim).filter(Boolean).join('\n');
    case 'thinking':
      return '';
    default:
      return '';
  }
}

function mapActivityTimelineBlock(block: Extract<MessageBlock, { type: 'activity-timeline' }>): FlowerActivityTimelineBlock {
  return {
    type: 'activity-timeline',
    schema_version: block.schema_version,
    ...(trim(block.run_id) ? { run_id: trim(block.run_id) } : {}),
    ...(trim(block.thread_id) ? { thread_id: trim(block.thread_id) } : {}),
    ...(trim(block.turn_id) ? { turn_id: trim(block.turn_id) } : {}),
    ...(trim(block.trace_id) ? { trace_id: trim(block.trace_id) } : {}),
    summary: {
      status: block.summary.status,
      severity: block.summary.severity,
      needs_attention: Boolean(block.summary.needs_attention),
      ...(Array.isArray(block.summary.attention_reasons) && block.summary.attention_reasons.length > 0 ? { attention_reasons: block.summary.attention_reasons } : {}),
      total_items: Math.max(0, Math.floor(Number(block.summary.total_items ?? block.items.length))),
      counts: { ...block.summary.counts },
      ...(positiveInteger(block.summary.duration_ms) ? { duration_ms: positiveInteger(block.summary.duration_ms) } : {}),
    },
    items: block.items.map((item) => {
      const renderer = normalizeActivityRenderer(item.renderer, 'activity_item.renderer');
      const payload = normalizeActivityPayload(item.payload, 'activity_item.payload');
      const chips = normalizeActivityChips(item.chips, 'activity_item.chips');
      const targetRefs = normalizeActivityTargetRefs(item.target_refs, 'activity_item.target_refs');
      return {
        item_id: trim(item.item_id),
        ...(trim(item.tool_id) ? { tool_id: trim(item.tool_id) } : {}),
        ...(trim(item.tool_name) ? { tool_name: trim(item.tool_name) } : {}),
        kind: item.kind,
        status: item.status,
        severity: item.severity ?? 'normal',
        needs_attention: Boolean(item.needs_attention),
        ...(Array.isArray(item.attention_reasons) && item.attention_reasons.length > 0 ? { attention_reasons: item.attention_reasons } : {}),
        requires_approval: Boolean(item.requires_approval),
        ...(item.approval_state ? { approval_state: item.approval_state } : {}),
        ...(positiveInteger(item.started_at_unix_ms) ? { started_at_unix_ms: positiveInteger(item.started_at_unix_ms) } : {}),
        ...(positiveInteger(item.ended_at_unix_ms) ? { ended_at_unix_ms: positiveInteger(item.ended_at_unix_ms) } : {}),
        ...(trim(item.label) ? { label: trim(item.label) } : {}),
        ...(trim(item.description) ? { description: trim(item.description) } : {}),
        ...(renderer ? { renderer } : {}),
        ...(chips && chips.length > 0 ? { chips } : {}),
        ...(targetRefs && targetRefs.length > 0 ? { target_refs: targetRefs } : {}),
        ...(payload ? { payload } : {}),
        ...(item.metadata ? { metadata: Object.fromEntries(Object.entries(item.metadata).map(([key, value]) => [trim(key), trim(value)]).filter(([key, value]) => key && value)) } : {}),
      };
    }).filter((item) => item.item_id),
  };
}

function mapMessageBlock(block: MessageBlock): FlowerChatMessageBlock | null {
  switch (block.type) {
    case 'markdown':
    case 'text':
    case 'thinking':
      return trim(block.content) ? { type: block.type, content: trim(block.content) } : null;
    case 'activity-timeline':
      return mapActivityTimelineBlock(block);
    default: {
      const content = blockText(block);
      return content ? { type: 'text', content } : null;
    }
  }
}

function messageText(message: Message): string {
  return message.blocks.map(blockText).filter(Boolean).join('\n\n');
}

function mapRuntimeMessage(raw: unknown): FlowerChatMessage | null {
  const message = raw as Partial<Message>;
  const id = trim(message.id);
  const role = trim(message.role).toLowerCase();
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];
  if (!id || (role !== 'user' && role !== 'assistant' && role !== 'system')) return null;
  const mappedBlocks = blocks
    .map((block) => mapMessageBlock(block as MessageBlock))
    .filter((block): block is FlowerChatMessageBlock => block !== null);
  return {
    id,
    role,
    content: messageText({ ...(message as Message), blocks: blocks as MessageBlock[] }),
    status: message.status ?? 'complete',
    created_at_ms: unixMs(message.timestamp, 'message.timestamp'),
    ...(mappedBlocks.length > 0 ? { blocks: mappedBlocks } : {}),
  };
}

function mapWaitingPrompt(prompt: ThreadWaitingPrompt | undefined): FlowerInputRequest | null {
  if (!prompt) return null;
  const promptID = trim(prompt.prompt_id);
  const messageID = trim(prompt.message_id);
  const toolID = trim(prompt.tool_id);
  const toolName = trim(prompt.tool_name);
  if (!promptID || !messageID || !toolID || !toolName) {
    flowerContractError('waiting_prompt requires prompt_id, message_id, tool_id, and tool_name.');
  }
  const rawQuestions = prompt.questions ?? [];
  if (rawQuestions.length === 0) {
    flowerContractError('waiting_prompt.questions must be a non-empty array.');
  }
  const questions = rawQuestions.map((question, questionIndex) => {
    const id = trim(question.id);
    const header = trim(question.header);
    const text = trim(question.question);
    if (!id || !header || !text) {
      flowerContractError(`waiting_prompt.questions[${questionIndex}] requires id, header, and question.`);
    }
    const responseMode = trim(question.response_mode);
    if (responseMode !== 'select' && responseMode !== 'write' && responseMode !== 'select_or_write') {
      flowerContractError(`waiting_prompt.questions[${questionIndex}].response_mode is invalid.`);
    }
    const normalizedResponseMode: FlowerInputResponseMode = responseMode;
    const choices = (question.choices ?? []).map((choice, choiceIndex) => {
      const choiceID = trim(choice.choice_id);
      const label = trim(choice.label);
      const kind = trim(choice.kind);
      if (!choiceID || !label || kind !== 'select') {
        flowerContractError(`waiting_prompt.questions[${questionIndex}].choices[${choiceIndex}] is incomplete.`);
      }
      const actions = (choice.actions ?? []).map((action, actionIndex) => {
        const type = trim(action.type);
        if (!type) {
          flowerContractError(`waiting_prompt.questions[${questionIndex}].choices[${choiceIndex}].actions[${actionIndex}].type is required.`);
        }
        return {
          type,
          ...(trim(action.mode) ? { mode: trim(action.mode) } : {}),
        };
      });
      return {
        choice_id: choiceID,
        label,
        ...(trim(choice.description) ? { description: trim(choice.description) } : {}),
        kind: 'select' as const,
        ...(trim(choice.input_placeholder) ? { input_placeholder: trim(choice.input_placeholder) } : {}),
        ...(actions.length > 0 ? { actions } : {}),
      };
    });
    if ((normalizedResponseMode === 'select' || normalizedResponseMode === 'select_or_write') && choices.length === 0) {
      flowerContractError(`waiting_prompt.questions[${questionIndex}] requires choices for ${normalizedResponseMode}.`);
    }
    return {
      id,
      header,
      question: text,
      ...(question.is_secret !== undefined ? { is_secret: Boolean(question.is_secret) } : {}),
      response_mode: normalizedResponseMode,
      ...(question.choices_exhaustive !== undefined ? { choices_exhaustive: Boolean(question.choices_exhaustive) } : {}),
      ...(trim(question.write_label) ? { write_label: trim(question.write_label) } : {}),
      ...(trim(question.write_placeholder) ? { write_placeholder: trim(question.write_placeholder) } : {}),
      ...(choices.length > 0 ? { choices } : {}),
    };
  });
  return {
    prompt_id: promptID,
    message_id: messageID,
    tool_id: toolID,
    tool_name: toolName,
    ...(trim(prompt.reason_code) ? { reason_code: trim(prompt.reason_code) } : {}),
    ...(Array.isArray(prompt.required_from_user) ? { required_from_user: prompt.required_from_user.map(trim).filter(Boolean) } : {}),
    ...(Array.isArray(prompt.evidence_refs) ? { evidence_refs: prompt.evidence_refs.map(trim).filter(Boolean) } : {}),
    questions,
    ...(trim(prompt.public_summary) ? { public_summary: trim(prompt.public_summary) } : {}),
    ...(prompt.contains_secret !== undefined ? { contains_secret: Boolean(prompt.contains_secret) } : {}),
  };
}

export function mapRuntimeFlowerThread(thread: ThreadView, messages: readonly FlowerChatMessage[] = []): FlowerThreadSnapshot {
  const threadID = trim(thread.thread_id);
  const title = trim(thread.title) || trim(thread.last_message_preview) || 'Ask Flower';
  const status = runStatus(thread.run_status);
  const inputRequest = status === 'waiting_user' ? mapWaitingPrompt(thread.waiting_prompt) : null;
  const errorMessage = trim(thread.run_error);
  const errorCode = trim(thread.run_error_code);
  return {
    thread_id: threadID,
    title,
    model_id: trim(thread.model_id),
    working_dir: trim(thread.working_dir),
    ...(Number(thread.pinned_at_unix_ms ?? 0) > 0 ? { pinned_at_ms: Math.floor(Number(thread.pinned_at_unix_ms)) } : {}),
    home_runtime_id: LOCAL_ENVIRONMENT_RUNTIME_ID,
    home_runtime_kind: 'local_environment',
    origin_env_public_id: 'local-environment',
    created_at_ms: unixMs(thread.created_at_unix_ms, 'thread.created_at_unix_ms'),
    updated_at_ms: unixMs(thread.updated_at_unix_ms ?? thread.last_message_at_unix_ms, 'thread.updated_at_unix_ms'),
    status,
    source_label: LOCAL_ENVIRONMENT_LABEL,
    target_labels: [LOCAL_ENVIRONMENT_LABEL],
    messages,
    ...(inputRequest ? { input_request: inputRequest } : {}),
    ...(errorMessage ? { error: { message: errorMessage, ...(errorCode ? { code: errorCode } : {}) } } : {}),
    read_status: readStatus(thread),
  };
}

function decision(): FlowerRouterDecision {
  const now = Date.now();
  return {
    decision_id: `local-environment-${now}`,
    decision_revision: 1,
    route: 'flower',
    reason_code: 'local_environment_runtime',
    selected_handler: {
      handler_id: LOCAL_ENVIRONMENT_RUNTIME_ID,
      handler_kind: 'local_environment',
      display_name: LOCAL_ENVIRONMENT_LABEL,
      carrier_kind: 'runtime',
      state: 'online',
      selection_source: 'router_default',
      supports_thread_kinds: ['chat', 'task'],
    },
    available_handlers: [],
    unavailable_handlers: [],
    handler_selection: {
      can_switch: false,
      lock_reason: 'local_environment_runtime',
      requires_user_visible_confirmation: false,
    },
    decision_scope: {
      thread_kind: 'chat',
      client_surface: 'welcome_flower_surface',
    },
    runtime_presence: {
      schema_version: 1,
      runtime_id: LOCAL_ENVIRONMENT_RUNTIME_ID,
      runtime_kind: 'local_environment',
      carrier_kind: 'runtime',
      display_name: LOCAL_ENVIRONMENT_LABEL,
      state: 'online',
      endpoint: { visibility: 'runtime' },
      capabilities: ['chat', 'task'],
      last_seen_at_unix_ms: now,
    },
    allowed_actions: ['start_thread'],
    ui_chips: [
      { kind: 'runtime', label: LOCAL_ENVIRONMENT_LABEL, tone: 'normal' },
      { kind: 'source', label: 'Local AI Profile', tone: 'normal' },
    ],
    blocker: null,
    created_at_unix_ms: now,
  };
}

function currentModelID(snapshot: FlowerSettingsSnapshot, models: ModelsResponse): string {
  const configured = trim(snapshot.config.current_model_id);
  if (configured) return configured;
  return trim(models.current_model);
}

async function loadSettingsSnapshot(bridge: DesktopSettingsBridge): Promise<FlowerSettingsSnapshot> {
  return mapRuntimeFlowerSettings(await runtimeJSON<AgentSettingsResponse>(bridge, 'GET', '/_redeven_proxy/api/settings'));
}

async function loadModels(bridge: DesktopSettingsBridge): Promise<ModelsResponse> {
  return runtimeJSON<ModelsResponse>(bridge, 'GET', '/_redeven_proxy/api/ai/models');
}

async function loadRuntimeFlowerThread(bridge: DesktopSettingsBridge, threadID: string): Promise<FlowerThreadSnapshot> {
  const tid = trim(threadID);
  if (!tid) throw new Error('Missing thread id.');
  const threadResp = await runtimeJSON<LoadThreadResponse>(bridge, 'GET', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`);
  if (!threadResp.thread) flowerContractError('thread is required.');
  const messagesResp = await runtimeJSON<ListThreadMessagesResponse>(bridge, 'GET', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/messages?limit=200`);
  const messages = (messagesResp.messages ?? [])
    .map(mapRuntimeMessage)
    .filter((item): item is FlowerChatMessage => item !== null);
  return mapRuntimeFlowerThread(threadResp.thread, messages);
}

export async function sendLocalEnvironmentFlowerPrompt(
  bridge: DesktopSettingsBridge,
  input: Readonly<{
    threadID?: string;
    prompt: string;
    contextAction?: unknown;
  }>,
): Promise<FlowerThreadSnapshot> {
  const prompt = trim(input.prompt);
  if (!prompt) throw new Error('Enter a message before sending.');
  const snapshot = await loadSettingsSnapshot(bridge);
  const models = await loadModels(bridge);
  const modelID = currentModelID(snapshot, models);
  if (!modelID) throw new Error('Select a Flower model before starting a chat.');
  let threadID = trim(input.threadID);
  if (!threadID) {
    const created = await runtimeJSON<CreateThreadResponse>(bridge, 'POST', '/_redeven_proxy/api/ai/threads', {
      title: '',
      model_id: modelID,
      execution_mode: 'act',
    });
    threadID = trim(created.thread?.thread_id);
  }
  if (!threadID) throw new Error('Failed to create Flower chat.');
  await runtimeJSON<unknown>(bridge, 'POST', '/_redeven_proxy/api/ai/runs', {
    thread_id: threadID,
    model: modelID,
    input: {
      text: prompt,
      attachments: [],
      ...(input.contextAction ? { context_action: input.contextAction } : {}),
    },
    options: {
      max_steps: 10,
      mode: 'act',
    },
  });
  return loadRuntimeFlowerThread(bridge, threadID);
}

export function createLocalEnvironmentFlowerSurfaceAdapter(
  bridge: DesktopSettingsBridge,
  options: LocalEnvironmentFlowerSurfaceAdapterOptions = {},
): FlowerSurfaceAdapter {
  const loadThread = async (threadID: string): Promise<FlowerThreadSnapshot> => {
    return loadRuntimeFlowerThread(bridge, threadID);
  };

  const markThreadRead = async (threadID: string, snapshot: FlowerThreadActivitySnapshot): Promise<FlowerThreadSnapshot> => {
    const tid = trim(threadID);
    if (!tid) throw new Error('Missing thread id.');
    const out = await runtimeJSON<MarkThreadReadResponse>(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/read`, {
      snapshot: {
        activity_revision: Math.floor(Number(snapshot.activity_revision)),
        last_message_at_unix_ms: Math.floor(Number(snapshot.last_message_at_unix_ms)),
        activity_signature: trim(snapshot.activity_signature),
        waiting_prompt_id: trim(snapshot.waiting_prompt_id) || undefined,
      },
    });
    readStatus({
      thread_id: tid,
      created_at_unix_ms: 1,
      updated_at_unix_ms: 1,
      read_status: out.read_status,
    });
    return loadThread(tid);
  };

  return {
    runtime: {
      runtime_id: LOCAL_ENVIRONMENT_RUNTIME_ID,
      runtime_kind: 'local_environment',
      carrier_kind: 'runtime',
      display_name: options.runtimeDisplayName ?? LOCAL_ENVIRONMENT_LABEL,
      subtitle: options.runtimeSubtitle ?? LOCAL_ENVIRONMENT_SUBTITLE,
    },
    loadSettings: () => loadSettingsSnapshot(bridge),
    saveSettings: async (draft) => {
      await runtimeJSON<unknown>(bridge, 'PUT', '/_redeven_proxy/api/ai/provider_bundle', mapFlowerSettingsDraftToRuntimeBundle(draft));
      return loadSettingsSnapshot(bridge);
    },
    listThreads: async () => {
      const result = await runtimeJSON<ListThreadsResponse>(bridge, 'GET', '/_redeven_proxy/api/ai/threads?limit=200');
      return (result.threads ?? []).map((thread) => mapRuntimeFlowerThread(thread));
    },
    loadThread,
    markThreadRead,
    renameThread: async (threadID, title) => {
      const tid = trim(threadID);
      if (!tid) throw new Error('Missing thread id.');
      const threadResp = await runtimeJSON<LoadThreadResponse>(bridge, 'PATCH', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, { title });
      return loadThread(trim(threadResp.thread?.thread_id) || tid);
    },
    setThreadPinned: async (threadID, pinned) => {
      const tid = trim(threadID);
      if (!tid) throw new Error('Missing thread id.');
      const threadResp = await runtimeJSON<LoadThreadResponse>(bridge, 'PATCH', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, { pinned });
      return loadThread(trim(threadResp.thread?.thread_id) || tid);
    },
    forkThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error('Missing thread id.');
      const threadResp = await runtimeJSON<LoadThreadResponse>(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/fork`, {});
      const nextID = trim(threadResp.thread?.thread_id);
      if (!nextID) throw new Error('Failed to create Flower chat.');
      return loadThread(nextID);
    },
    resolveHandler: async () => decision(),
    sendMessage: async (input: FlowerSendMessageInput) => {
      return sendLocalEnvironmentFlowerPrompt(bridge, {
        threadID: input.thread_id,
        prompt: input.prompt,
      });
    },
    submitInput: async (input) => {
      const tid = trim(input.thread_id);
      const promptID = trim(input.prompt_id);
      if (!tid) throw new Error('Missing thread id.');
      if (!promptID) throw new Error('Missing input prompt id.');
      await runtimeJSON<unknown>(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/input_response`, {
        thread_id: tid,
        response: {
          prompt_id: promptID,
          answers: Object.fromEntries(Object.entries(input.answers).map(([questionID, answer]) => [
            questionID,
            {
              choice_id: trim(answer.choice_id) || undefined,
              text: trim(answer.text) || undefined,
            },
          ])),
        },
        input: {
          text: '',
          attachments: [],
        },
        options: {
          max_steps: 10,
          mode: 'act',
        },
      });
      return loadThread(tid);
    },
  };
}
