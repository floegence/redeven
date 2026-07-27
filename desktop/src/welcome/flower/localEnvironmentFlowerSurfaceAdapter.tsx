import type {
  DesktopSettingsDraft,
  SaveDesktopSettingsResult,
} from '../../shared/settingsIPC';
import type {
  RuntimeFlowerError,
  RuntimeFlowerFailureKind,
  RuntimeFlowerRequest,
  RuntimeFlowerRequestResult,
} from '../../shared/runtimeFlowerIPC';
import type {
  RuntimeFlowerAttachmentCancelResponse,
  RuntimeFlowerAttachmentChunkResponse,
  RuntimeFlowerAttachmentCommitResponse,
  RuntimeFlowerAttachmentPrepareResponse,
  RuntimeFlowerAttachmentProgress,
  RuntimeFlowerAttachmentPreviewResponse,
} from '../../shared/runtimeFlowerAttachmentIPC';
import type {
  FlowerProvider,
  FlowerProviderDraft,
  FlowerProviderModel,
  FlowerPermissionType,
  FlowerRouterDecision,
  FlowerTurnLaunchInput,
  FlowerTurnLaunchReceipt,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSurfaceAdapter,
  FlowerAttachmentUploadInput,
  FlowerAttachmentCapability,
  FlowerAttachmentStagingScope,
  FlowerStagedAttachment,
  FlowerStagedLongTextReadResult,
  FlowerLiveBootstrap,
  FlowerTerminalProcessSnapshot,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerWorkingDirectoryEntry,
  FlowerWorkingDirectoryListInput,
  FlowerWorkingDirectoryPathContext,
} from '../../../../internal/flower_ui/src/contracts/flowerSurfaceContracts';
import {
  createFlowerClientTurnID,
  flowerTurnAdmissionUncertainIdentity,
  flowerTurnAdmissionUncertainFailure,
} from '../../../../internal/flower_ui/src/flowerTurnAdmission';
import type {
  AgentSettingsResponse,
  AIConfig,
  AIModelProfile,
} from '../../../../internal/envapp/ui_src/src/ui/pages/settings/types';
import { requireAskFlowerContextActionEnvelope } from '../../../../internal/envapp/ui_src/src/ui/contextActions/protocol';
import {
  mapFlowerThread,
  mapFlowerLiveBootstrap,
} from '../../../../internal/flower_ui/src/flowerLiveMapper';
import {
  createRuntimeFlowerSurfaceAdapter,
  FLOWER_THREAD_DELETE_OPERATION_FAILED_CODE,
} from '../../../../internal/flower_ui/src/runtimeFlowerSurfaceAdapter';
import {
  normalizeFlowerReasoningCapability,
  serializeFlowerReasoningSelection,
} from '../../../../internal/flower_ui/src/reasoning';
import { normalizeFlowerAttachmentCapability } from '../../../../internal/flower_ui/src/attachments/flowerAttachmentModel';
import {
  createFlowerClientThreadID,
  normalizeFlowerAttachmentStagingScope,
} from '../../../../internal/flower_host_ui/src/flowerAttachmentStaging';

export type DesktopSettingsBridge = Readonly<{
  save: (draft: DesktopSettingsDraft) => Promise<SaveDesktopSettingsResult>;
  requestRuntimeFlower: (request: RuntimeFlowerRequest) => Promise<RuntimeFlowerRequestResult>;
  prepareRuntimeFlowerAttachment: (request: unknown) => Promise<RuntimeFlowerAttachmentPrepareResponse>;
  writeRuntimeFlowerAttachmentChunk: (request: unknown) => Promise<RuntimeFlowerAttachmentChunkResponse>;
  commitRuntimeFlowerAttachment: (request: unknown) => Promise<RuntimeFlowerAttachmentCommitResponse>;
  cancelRuntimeFlowerAttachment: (request: unknown) => Promise<RuntimeFlowerAttachmentCancelResponse>;
  subscribeRuntimeFlowerAttachmentProgress: (listener: (progress: RuntimeFlowerAttachmentProgress) => void) => () => void;
  previewRuntimeFlowerAttachment: (request: unknown) => Promise<RuntimeFlowerAttachmentPreviewResponse>;
  cancel: () => void;
}>;

export type LocalEnvironmentFlowerSurfaceAdapterOptions = Readonly<{
  runtimeDisplayName?: string;
  runtimeSubtitle?: string;
  onSettingsChanged?: () => void | Promise<unknown>;
}>;

type ModelsResponse = Readonly<{
  current_model?: string;
  models?: readonly Readonly<{
    id?: string;
    label?: string;
    context_window?: number;
    max_output_tokens?: number;
    input_modalities?: readonly string[];
    reasoning_capability?: FlowerProviderModel['reasoning_capability'];
  }>[];
}>;

type ThreadReadStatus = FlowerThreadReadStatus;

type ThreadView = Readonly<{
  thread_id?: string;
  read_status: ThreadReadStatus;
} & Record<string, unknown>>;

type SendTurnResponse = Readonly<{
  run_id?: string;
  turn_id?: string;
  kind?: string;
}>;

type LoadThreadResponse = Readonly<{
  thread?: ThreadView;
}>;

type MarkThreadReadResponse = Readonly<{
  read_status: ThreadReadStatus;
}>;

type FlowerSecretPatch = Readonly<{ provider_id: string; api_key: string | null }>;

type RuntimeFSPathContextResponse = Readonly<{
  agent_home_path_abs?: string;
  home_path_abs?: string;
  default_root_id?: string;
  roots?: readonly RuntimeFSRoot[];
}>;

type RuntimeFSRoot = Readonly<{
  id?: string;
  label?: string;
  path?: string;
  path_abs?: string;
  kind?: string;
  permissions?: Readonly<{
    read?: boolean;
    write?: boolean;
  }>;
  hidden?: boolean;
  system?: boolean;
}>;

type RuntimeFSListResponse = Readonly<{
  entries?: readonly RuntimeFSEntry[];
}>;

type RuntimeFSEntry = Readonly<{
  name?: string;
  path?: string;
  is_directory?: boolean;
  isDirectory?: boolean;
  size?: number;
  modified_at?: number;
  modifiedAt?: number;
}>;

const LOCAL_ENVIRONMENT_RUNTIME_ID = 'env:local-environment';
const LOCAL_ENVIRONMENT_LABEL = 'Local Environment';
const LOCAL_ENVIRONMENT_SUBTITLE = 'Uses the Local AI Profile on this Mac';

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function mapRuntimeWorkingDirectoryPathContext(raw: RuntimeFSPathContextResponse): FlowerWorkingDirectoryPathContext {
  const homePath = trim(raw.home_path_abs) || trim(raw.agent_home_path_abs);
  return {
    agentHomePathAbs: trim(raw.agent_home_path_abs) || homePath,
    homePathAbs: homePath,
    defaultRootId: trim(raw.default_root_id),
    roots: (raw.roots ?? []).map((root) => ({
      id: trim(root.id),
      label: trim(root.label),
      pathAbs: trim(root.path_abs) || trim(root.path),
      kind: trim(root.kind),
      permissions: {
        read: root.permissions?.read === true,
        write: root.permissions?.write === true,
      },
      ...(typeof root.hidden === 'boolean' ? { hidden: root.hidden } : {}),
      ...(typeof root.system === 'boolean' ? { system: root.system } : {}),
    })),
  };
}

function mapRuntimeWorkingDirectoryEntry(raw: RuntimeFSEntry): FlowerWorkingDirectoryEntry {
  return {
    name: trim(raw.name),
    path: trim(raw.path),
    isDirectory: raw.is_directory === true || raw.isDirectory === true,
    size: typeof raw.size === 'number' && Number.isFinite(raw.size) ? raw.size : undefined,
    modifiedAt: typeof raw.modified_at === 'number' && Number.isFinite(raw.modified_at)
      ? raw.modified_at
      : typeof raw.modifiedAt === 'number' && Number.isFinite(raw.modifiedAt)
        ? raw.modifiedAt
        : undefined,
  };
}

function mapRuntimeWorkingDirectoryList(raw: RuntimeFSListResponse): readonly FlowerWorkingDirectoryEntry[] {
  return (raw.entries ?? []).map(mapRuntimeWorkingDirectoryEntry);
}

class RuntimeFlowerResponseError extends Error {
  code?: string;
  status?: number;
  retryAfterMs?: number;
  readonly data: unknown;
  readonly failureKind: RuntimeFlowerFailureKind;

  constructor(message: string, failureKind: RuntimeFlowerFailureKind, data?: unknown) {
    super(message);
    this.failureKind = failureKind;
    this.data = data;
  }
}

function runtimeFlowerError(error: RuntimeFlowerError, failureKind: RuntimeFlowerFailureKind): RuntimeFlowerResponseError {
  const out = new RuntimeFlowerResponseError(trim(error.message) || 'Flower request failed.', failureKind, error.data);
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
  stagingScope?: FlowerAttachmentStagingScope,
): Promise<T> {
  const result = await bridge.requestRuntimeFlower({
    method,
    path,
    ...(body === undefined ? {} : { body }),
    ...(stagingScope ? {
      staging_scope_id: stagingScope.staging_scope_id,
      staging_capability: stagingScope.capability,
    } : {}),
  });
  if (!result.ok) {
    throw runtimeFlowerError(result.error, result.failureKind);
  }
  return result.data as T;
}

async function createDesktopAttachmentStagingScope(
  bridge: DesktopSettingsBridge,
  requestedThreadID?: string,
): Promise<FlowerAttachmentStagingScope> {
  const threadID = trim(requestedThreadID) || createFlowerClientThreadID();
  const result = await bridge.requestRuntimeFlower({
    method: 'POST',
    path: '/_redeven_proxy/api/ai/upload-staging-scopes',
    body: { thread_id: threadID },
  });
  if (!result.ok) throw runtimeFlowerError(result.error, result.failureKind);
  return normalizeFlowerAttachmentStagingScope(result.data, result.stagingCapability, threadID);
}

function positiveInteger(raw: unknown): number | undefined {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function normalizePermissionType(raw: unknown): FlowerPermissionType {
  const value = trim(raw).toLowerCase();
  if (value === 'readonly' || value === 'full_access') return value;
  return 'approval_required';
}

function mapProviderModel(model: NonNullable<NonNullable<AIConfig['providers']>[number]['models']>[number]): FlowerProviderModel {
  return {
    model_name: trim(model.model_name),
    ...(trim(model.wire_model_name) ? { wire_model_name: trim(model.wire_model_name) } : {}),
    ...(positiveInteger(model.context_window) ? { context_window: positiveInteger(model.context_window) } : {}),
    ...(positiveInteger(model.max_output_tokens) ? { max_output_tokens: positiveInteger(model.max_output_tokens) } : {}),
    ...(positiveInteger(model.effective_context_window_percent) ? { effective_context_window_percent: positiveInteger(model.effective_context_window_percent) } : {}),
    ...(Array.isArray(model.input_modalities) ? { input_modalities: model.input_modalities.map(trim).filter(Boolean) } : {}),
    ...(normalizeFlowerReasoningCapability(model.reasoning_capability) ? { reasoning_capability: normalizeFlowerReasoningCapability(model.reasoning_capability) } : {}),
    ...(serializeFlowerReasoningSelection(model.default_reasoning_selection) ? { default_reasoning_selection: serializeFlowerReasoningSelection(model.default_reasoning_selection) } : {}),
  };
}

function mapProvider(provider: NonNullable<AIConfig['providers']>[number]): FlowerProvider {
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
  const modelProfile = ai && (ai.providers ?? []).length > 0 && trim(ai.current_model_id)
    ? {
        schema_version: 1 as const,
        current_model_id: trim(ai.current_model_id),
        providers: (ai.providers ?? []).map(mapProvider).filter((provider) => provider.id && provider.models.length > 0),
      }
    : null;
  const providerSecrets = settings.ai_secrets?.provider_api_key_set ?? {};
  const webSecrets = settings.ai_secrets?.web_search_provider_api_key_set ?? {};
  return {
    defaults: { permission_type: normalizePermissionType(ai?.permission_type) },
    model_profile: modelProfile,
    provider_secrets: (modelProfile?.providers ?? []).map((provider) => ({
      provider_id: provider.id,
      provider_api_key_configured: Boolean(providerSecrets[provider.id]),
      web_search_api_key_configured: Boolean(webSecrets[provider.id]),
    })),
  };
}

function draftProviderToAI(provider: FlowerProviderDraft): NonNullable<AIConfig['providers']>[number] {
  return {
    id: trim(provider.id),
    ...(trim(provider.name) ? { name: trim(provider.name) } : {}),
    type: provider.type,
    ...(trim(provider.base_url) ? { base_url: trim(provider.base_url) } : {}),
    ...(provider.web_search ? { web_search: provider.web_search } : {}),
    models: provider.models.map((model) => ({
      model_name: trim(model.model_name),
      ...(trim(model.wire_model_name) ? { wire_model_name: trim(model.wire_model_name) } : {}),
      ...(positiveInteger(model.context_window) ? { context_window: positiveInteger(model.context_window) } : {}),
      ...(positiveInteger(model.max_output_tokens) ? { max_output_tokens: positiveInteger(model.max_output_tokens) } : {}),
      ...(positiveInteger(model.effective_context_window_percent) ? { effective_context_window_percent: positiveInteger(model.effective_context_window_percent) } : {}),
      ...(Array.isArray(model.input_modalities) ? { input_modalities: model.input_modalities.map(trim).filter(Boolean) as Array<'text' | 'image'> } : {}),
      ...(normalizeFlowerReasoningCapability(model.reasoning_capability) ? { reasoning_capability: normalizeFlowerReasoningCapability(model.reasoning_capability) } : {}),
      ...(serializeFlowerReasoningSelection(model.default_reasoning_selection) ? { default_reasoning_selection: serializeFlowerReasoningSelection(model.default_reasoning_selection) } : {}),
    })),
  };
}

export function mapFlowerSettingsDraftToRuntimeBundle(draft: FlowerSettingsDraft): {
  model_profile: AIModelProfile;
  provider_api_key_patches: readonly FlowerSecretPatch[];
  web_search_provider_key_patches: readonly FlowerSecretPatch[];
} {
  const providerAPIKeyPatches: FlowerSecretPatch[] = draft.model_profile.providers.flatMap((provider): FlowerSecretPatch[] => {
    if (provider.provider_api_key === undefined) return [];
    const providerID = trim(provider.id);
    if (!providerID) return [];
    if (provider.provider_api_key === null) return [{ provider_id: providerID, api_key: null }];
    const apiKey = trim(provider.provider_api_key);
    return apiKey ? [{ provider_id: providerID, api_key: apiKey }] : [];
  });
  const webSearchKeyPatches: FlowerSecretPatch[] = draft.model_profile.providers.flatMap((provider): FlowerSecretPatch[] => {
    if (provider.web_search_api_key === undefined) return [];
    const providerID = trim(provider.id);
    if (!providerID) return [];
    if (provider.web_search_api_key === null) return [{ provider_id: providerID, api_key: null }];
    const apiKey = trim(provider.web_search_api_key);
    return apiKey ? [{ provider_id: providerID, api_key: apiKey }] : [];
  });
  return {
    model_profile: {
      current_model_id: trim(draft.model_profile.current_model_id),
      providers: draft.model_profile.providers.map(draftProviderToAI),
    },
    provider_api_key_patches: providerAPIKeyPatches,
    web_search_provider_key_patches: webSearchKeyPatches,
  };
}

export function mapRuntimeFlowerThread(thread: ThreadView): FlowerThreadSnapshot {
  return mapFlowerThread(thread, [], localEnvironmentLiveMapperOptions(), thread.read_status);
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
  const configured = trim(snapshot.model_profile?.current_model_id);
  if (configured) return configured;
  return trim(models.current_model);
}

async function loadSettingsSnapshot(bridge: DesktopSettingsBridge): Promise<FlowerSettingsSnapshot> {
  return mapRuntimeFlowerSettings(await runtimeJSON<AgentSettingsResponse>(bridge, 'GET', '/_redeven_proxy/api/settings'));
}

async function loadModels(bridge: DesktopSettingsBridge): Promise<ModelsResponse> {
  return runtimeJSON<ModelsResponse>(bridge, 'GET', '/_redeven_proxy/api/ai/models');
}

async function loadRuntimeFlowerThread(bridge: DesktopSettingsBridge, threadID: string): Promise<FlowerLiveBootstrap> {
  const tid = trim(threadID);
  if (!tid) throw new Error('Missing thread id.');
  return mapRuntimeFlowerLiveBootstrap(await runtimeJSON<unknown>(bridge, 'GET', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/live/bootstrap`));
}

function localEnvironmentLiveMapperOptions() {
  return {
    runtimeID: LOCAL_ENVIRONMENT_RUNTIME_ID,
    runtimeKind: 'local_environment' as const,
    sourceLabel: LOCAL_ENVIRONMENT_LABEL,
    targetLabels: [LOCAL_ENVIRONMENT_LABEL],
    originEnvPublicID: 'local-environment',
  };
}

function mapRuntimeFlowerLiveBootstrap(raw: unknown): FlowerLiveBootstrap {
  return mapFlowerLiveBootstrap(raw, localEnvironmentLiveMapperOptions());
}

type RuntimeStagedAttachment = Readonly<{
  attachment_id?: unknown;
  display_name?: unknown;
  detected_media_type?: unknown;
  size_bytes?: unknown;
  content_sha256?: unknown;
  logical_locator?: unknown;
  unicode_code_points?: unknown;
  logical_line_count?: unknown;
  source?: unknown;
  capability_revision?: unknown;
  created_at_unix_ms?: unknown;
}>;

function hexDigest(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  return hexDigest(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

function abortError(): Error {
  const error = new Error('Flower attachment upload was cancelled.');
  error.name = 'AbortError';
  return error;
}

function mapRuntimeStagedAttachment(raw: unknown, input: FlowerAttachmentUploadInput): FlowerStagedAttachment {
  const record = raw && typeof raw === 'object' ? raw as RuntimeStagedAttachment : {};
  const attachmentID = trim(record.attachment_id);
  const name = trim(record.display_name);
  const mimeType = trim(record.detected_media_type);
  const digest = trim(record.content_sha256).toLowerCase();
  const locator = trim(record.logical_locator);
  const sizeBytes = Number(record.size_bytes);
  const codePoints = Number(record.unicode_code_points);
  const lines = Number(record.logical_line_count);
  if (!attachmentID || !name || !mimeType || !locator.startsWith('attachment://v1/') || !/^[0-9a-f]{64}$/u.test(digest) ||
      !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error('Flower attachment upload returned invalid metadata.');
  }
  const source = input.source;
  return {
    attachment_id: attachmentID,
    name,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    digest_sha256: digest,
    locator,
    source,
    ...(Number.isSafeInteger(codePoints) && codePoints >= 0 && Number.isSafeInteger(lines) && lines >= 0
      ? { text_stats: { code_points: codePoints, lines } }
      : {}),
    capability_revision: trim(record.capability_revision) || input.capability_revision,
    ...(Number.isSafeInteger(Number(record.created_at_unix_ms)) && Number(record.created_at_unix_ms) > 0
      ? { created_at_unix_ms: Math.floor(Number(record.created_at_unix_ms)) }
      : {}),
  };
}

function mapRuntimeStagedLongText(
  raw: unknown,
  expected: FlowerStagedAttachment,
): FlowerStagedLongTextReadResult {
  const record = raw && typeof raw === 'object' ? raw as Readonly<{
    attachment?: unknown;
    text?: unknown;
    content_sha256?: unknown;
  }> : {};
  const attachment = record.attachment && typeof record.attachment === 'object'
    ? record.attachment as RuntimeStagedAttachment
    : {};
  const attachmentID = trim(attachment.attachment_id);
  const name = trim(attachment.display_name);
  const mimeType = trim(attachment.detected_media_type);
  const digest = trim(record.content_sha256 ?? attachment.content_sha256).toLowerCase();
  const sizeBytes = Number(attachment.size_bytes);
  const text = typeof record.text === 'string' ? record.text : '';
  if (attachmentID !== expected.attachment_id || name !== expected.name || mimeType !== expected.mime_type
    || digest !== expected.digest_sha256 || sizeBytes !== expected.size_bytes) {
    throw new Error('Flower long-text restore returned mismatched attachment metadata.');
  }
  return { attachment: expected, text };
}

async function uploadRuntimeFlowerAttachment(
  bridge: DesktopSettingsBridge,
  input: FlowerAttachmentUploadInput,
): Promise<FlowerStagedAttachment> {
  if (input.signal.aborted) throw abortError();
  const fileBytes = await input.file.arrayBuffer();
  if (input.signal.aborted) throw abortError();
  const canonicalName = input.file.name.normalize('NFC');
  const [contentSHA256, displayNameSHA256] = await Promise.all([
    sha256Hex(fileBytes),
    sha256Hex(new TextEncoder().encode(canonicalName)),
  ]);
  const operationID = trim(input.attempt_id) || trim(input.request_id);
  const unsubscribe = bridge.subscribeRuntimeFlowerAttachmentProgress((progress) => {
    if (progress.operation_id !== operationID) return;
    input.on_progress({
      attempt_id: input.attempt_id,
      loaded: progress.loaded_bytes,
      total: progress.total_bytes,
      indeterminate: false,
    });
  });
  const cancel = () => {
    void bridge.cancelRuntimeFlowerAttachment({ operation_id: operationID });
  };
  input.signal.addEventListener('abort', cancel, { once: true });
  try {
    const prepared = await bridge.prepareRuntimeFlowerAttachment({
      operation_id: operationID,
      upload_request_id: input.request_id,
      staging_scope_id: input.staging_scope.staging_scope_id,
      staging_capability: input.staging_scope.capability,
      source: input.source === 'long_text' ? 'long_text' : 'uploaded_file',
      display_name: canonicalName,
      media_type: trim(input.file.type) || 'application/octet-stream',
      size_bytes: input.file.size,
      content_sha256: contentSHA256,
      display_name_sha256: displayNameSHA256,
    });
    if (!prepared.ok) throw new Error(trim(prepared.message) || 'Desktop could not start the Flower attachment upload.');
    const chunkSize = Math.max(1, Math.floor(Number(prepared.chunk_size_bytes) || 256 * 1024));
    for (let offset = 0; offset < input.file.size; offset += chunkSize) {
      if (input.signal.aborted) throw abortError();
      const chunk = new Uint8Array(await input.file.slice(offset, Math.min(input.file.size, offset + chunkSize)).arrayBuffer());
      const written = await bridge.writeRuntimeFlowerAttachmentChunk({ operation_id: operationID, offset_bytes: offset, chunk });
      if (!written.ok || written.next_offset_bytes !== offset + chunk.byteLength) {
        throw new Error(trim(written.message) || 'Desktop could not stream the Flower attachment.');
      }
    }
    if (input.signal.aborted) throw abortError();
    const committed = await bridge.commitRuntimeFlowerAttachment({ operation_id: operationID });
    if (!committed.ok) {
      if (committed.error) throw runtimeFlowerError(committed.error, committed.failureKind ?? 'local');
      throw new Error('Desktop could not commit the Flower attachment upload.');
    }
    return mapRuntimeStagedAttachment(committed.data, input);
  } catch (error) {
    cancel();
    throw error;
  } finally {
    input.signal.removeEventListener('abort', cancel);
    unsubscribe();
  }
}

export async function launchLocalEnvironmentFlowerTurn(
  bridge: DesktopSettingsBridge,
  input: FlowerTurnLaunchInput,
): Promise<FlowerTurnLaunchReceipt> {
  const prompt = input.prompt;
  const attachmentIDs = (input.attachment_ids ?? []).map(trim).filter(Boolean);
  const contextAction = requireAskFlowerContextActionEnvelope(input.context_action);
  if (!prompt.trim() && attachmentIDs.length === 0 && !contextAction) throw new Error('Enter a message or add an attachment before sending.');
  const snapshot = await loadSettingsSnapshot(bridge);
  const models = await loadModels(bridge);
  const modelID = trim(input.model_id) || currentModelID(snapshot, models);
  if (!modelID) throw new Error('Select a Flower model before starting a chat.');
  const permissionType = normalizePermissionType(input.permission_type ?? snapshot.defaults.permission_type);
  const existingThreadID = trim(input.thread_id);
  const stagingScope = input.staging_scope;
  const threadID = existingThreadID || trim(stagingScope?.thread_id) || createFlowerClientThreadID();
  if (stagingScope && trim(stagingScope.thread_id) !== threadID) {
    throw new Error('Flower attachment staging scope targets a different thread.');
  }
  if (attachmentIDs.length > 0 && !stagingScope) {
    throw new Error('Flower attachments require a staging scope.');
  }
  const proposedTurnID = trim(input.turn_id) || createFlowerClientTurnID();
  let createBody: Record<string, unknown> | undefined;
  if (!existingThreadID) {
    createBody = {
      title: '',
      model_id: modelID,
      permission_type: permissionType,
    };
    const reasoningSelection = serializeFlowerReasoningSelection(input.reasoning_selection);
    if (reasoningSelection) createBody.reasoning_selection = reasoningSelection;
    if (trim(input.working_dir)) {
      createBody.working_dir = trim(input.working_dir);
    }
  }
  try {
    const response = await runtimeJSON<SendTurnResponse>(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/turns`, {
      thread_id: threadID,
      ...(stagingScope ? { staging_scope_id: stagingScope.staging_scope_id } : {}),
      model: modelID,
      input: {
        turn_id: proposedTurnID,
        text: prompt,
        attachments: attachmentIDs.map((attachmentID) => ({ attachment_id: attachmentID })),
        ...(contextAction ? { context_action: contextAction } : {}),
      },
      options: {
        permission_type: permissionType,
        ...(serializeFlowerReasoningSelection(input.reasoning_selection) ? { reasoning_selection: serializeFlowerReasoningSelection(input.reasoning_selection) } : {}),
      },
      ...(createBody ? { create: createBody } : {}),
    }, stagingScope);
    const turnID = trim(response.turn_id);
    const runID = trim(response.run_id);
    const kind = trim(response.kind);
    if (!turnID || !runID || (kind !== 'start' && kind !== 'queued')) {
      throw flowerTurnAdmissionUncertainFailure(
        new Error('Flower turn admission returned an invalid receipt.'),
        threadID,
        proposedTurnID,
      );
    }
    if (proposedTurnID !== turnID) {
      throw flowerTurnAdmissionUncertainFailure(
        new Error('Flower turn admission returned a different turn identity.'),
        threadID,
        proposedTurnID,
      );
    }
    return { thread_id: threadID, turn_id: turnID, run_id: runID, kind };
  } catch (error) {
    if (error instanceof RuntimeFlowerResponseError && error.failureKind !== 'transport_unknown'
      && error.code !== 'runtime_flower_invalid_json') {
      throw error;
    }
    if (flowerTurnAdmissionUncertainIdentity(error)) {
      throw error;
    }
    throw flowerTurnAdmissionUncertainFailure(error, threadID, proposedTurnID);
  }
}

export function createLocalEnvironmentFlowerSurfaceAdapter(
  bridge: DesktopSettingsBridge,
  options: LocalEnvironmentFlowerSurfaceAdapterOptions = {},
): FlowerSurfaceAdapter {
  return createRuntimeFlowerSurfaceAdapter({
    runtime: {
      runtime_id: LOCAL_ENVIRONMENT_RUNTIME_ID,
      runtime_kind: 'local_environment',
      carrier_kind: 'runtime',
      display_name: options.runtimeDisplayName ?? LOCAL_ENVIRONMENT_LABEL,
      subtitle: options.runtimeSubtitle ?? LOCAL_ENVIRONMENT_SUBTITLE,
    },
    transport: {
      listThreads: () => runtimeJSON(bridge, 'GET', '/_redeven_proxy/api/ai/threads?limit=200'),
      loadThread: (threadID) => runtimeJSON(bridge, 'GET', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/live/bootstrap`),
      listThreadLiveEvents: (threadID, afterSeq, limit) => runtimeJSON(
        bridge,
        'GET',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/live/events?after_seq=${afterSeq}&limit=${limit}`,
      ),
      loadSubagentDetail: (parentThreadID, childThreadID, afterOrdinal, limit) => runtimeJSON(
        bridge,
        'GET',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(parentThreadID)}/subagents/${encodeURIComponent(childThreadID)}/detail?after_ordinal=${afterOrdinal}&limit=${limit}`,
      ),
      readTerminalProcess: (runID, processID, input) => {
        const params = new URLSearchParams();
        params.set('after_seq', String(input.after_seq));
        return runtimeJSON<FlowerTerminalProcessSnapshot>(
          bridge,
          'GET',
          `/_redeven_proxy/api/ai/runs/${encodeURIComponent(runID)}/terminal/${encodeURIComponent(processID)}/read?${params.toString()}`,
        );
      },
      markThreadRead: (threadID, body) => runtimeJSON<MarkThreadReadResponse>(
        bridge,
        'POST',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/read`,
        body,
      ),
      patchThread: (threadID, body) => runtimeJSON<LoadThreadResponse>(
        bridge,
        'PATCH',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}`,
        body,
      ),
      forkThread: (threadID) => runtimeJSON<LoadThreadResponse>(
        bridge,
        'POST',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/fork`,
        {},
      ),
      deleteThread: async (threadID) => {
        try {
          return {
            kind: 'success' as const,
            receipt: await runtimeJSON<unknown>(
              bridge,
              'DELETE',
              `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}?force=true`,
            ),
          };
        } catch (error) {
          if (error instanceof RuntimeFlowerResponseError &&
            error.failureKind === 'response' &&
            error.code === FLOWER_THREAD_DELETE_OPERATION_FAILED_CODE) {
            return { kind: 'terminal_failure' as const, receipt: error.data };
          }
          throw error;
        }
      },
      submitApproval: (body) => runtimeJSON(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(body.thread_id)}/approvals`, body),
    },
    mapperOptions: localEnvironmentLiveMapperOptions(),
    loadSettings: () => loadSettingsSnapshot(bridge),
    saveDefaultPermission: async (permissionType) => {
      await runtimeJSON<unknown>(bridge, 'PUT', '/_redeven_proxy/api/ai/default_permission', {
        permission_type: normalizePermissionType(permissionType),
      });
      return loadSettingsSnapshot(bridge);
    },
    saveModelProfile: async (draft) => {
      await runtimeJSON<unknown>(bridge, 'PUT', '/_redeven_proxy/api/ai/provider_bundle', mapFlowerSettingsDraftToRuntimeBundle(draft));
      return loadSettingsSnapshot(bridge);
    },
    persistDefaultModel: async (modelID) => {
      const mid = trim(modelID);
      if (!mid) throw new Error('Missing model id.');
      await runtimeJSON<ModelsResponse>(bridge, 'PUT', '/_redeven_proxy/api/ai/current_model', { model_id: mid });
      const snapshot = await loadSettingsSnapshot(bridge);
      if (options.onSettingsChanged) void Promise.resolve(options.onSettingsChanged()).catch(() => undefined);
      return snapshot;
    },
    getWorkingDirectoryPathContext: async () => mapRuntimeWorkingDirectoryPathContext(
      await runtimeJSON<RuntimeFSPathContextResponse>(bridge, 'GET', '/_redeven_proxy/api/fs/path_context'),
    ),
    listWorkingDirectoryEntries: async (input: FlowerWorkingDirectoryListInput) => mapRuntimeWorkingDirectoryList(
      await runtimeJSON<RuntimeFSListResponse>(bridge, 'POST', '/_redeven_proxy/api/fs/list', {
        path: trim(input.path),
        show_hidden: input.showHidden === true,
      }),
    ),
    resolveHandler: async () => decision(),
    loadAttachmentCapability: async (modelID): Promise<FlowerAttachmentCapability> => {
      const capability = normalizeFlowerAttachmentCapability(await runtimeJSON<unknown>(
        bridge,
        'GET',
        `/_redeven_proxy/api/ai/attachments/capabilities?model_id=${encodeURIComponent(trim(modelID))}`,
      ));
      if (capability.model_id !== trim(modelID)) throw new Error('Flower attachment capability returned a different model identity.');
      return capability;
    },
    createAttachmentStagingScope: (threadID) => createDesktopAttachmentStagingScope(bridge, threadID),
    releaseAttachmentStagingScope: async (scope) => {
      await runtimeJSON<unknown>(
        bridge,
        'DELETE',
        `/_redeven_proxy/api/ai/upload-staging-scopes/${encodeURIComponent(scope.staging_scope_id)}`,
        undefined,
        scope,
      );
    },
    uploadAttachment: (input) => uploadRuntimeFlowerAttachment(bridge, input),
    deleteStagedAttachment: async (attachmentID, scope) => {
      await runtimeJSON<unknown>(
        bridge,
        'DELETE',
        `/_redeven_proxy/api/ai/uploads/${encodeURIComponent(trim(attachmentID))}`,
        undefined,
        scope,
      );
    },
    readStagedLongText: async (attachment, scope) => mapRuntimeStagedLongText(
      await runtimeJSON<unknown>(
        bridge,
        'GET',
        `/_redeven_proxy/api/ai/uploads/${encodeURIComponent(trim(attachment.attachment_id))}/long_text`,
        undefined,
        scope,
      ),
      attachment,
    ),
    previewStagedAttachment: async (attachment, scope) => {
      const result = await bridge.previewRuntimeFlowerAttachment({
        attachment_id: trim(attachment.attachment_id),
        staging_scope_id: scope.staging_scope_id,
        staging_capability: scope.capability,
        display_name: attachment.name,
      });
      if (!result.ok) throw new Error(result.message || 'Desktop could not preview this attachment.');
    },
    launchTurn: async (input: FlowerTurnLaunchInput) => {
      return launchLocalEnvironmentFlowerTurn(bridge, input);
    },
    stopThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error('Missing thread id.');
      await runtimeJSON<unknown>(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/cancel`, {});
      return loadRuntimeFlowerThread(bridge, tid);
    },
    compactThreadContext: async (input) => {
      const tid = trim(input.thread_id);
      if (!tid) throw new Error('Missing thread id.');
      await runtimeJSON<unknown>(
        bridge,
        'POST',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/context/compact`,
        {
          thread_id: tid,
          active_run_id: trim(input.active_run_id) || undefined,
        },
      );
      return loadRuntimeFlowerThread(bridge, tid);
    },
    submitInput: async (input) => {
      const tid = trim(input.thread_id);
      const promptID = trim(input.prompt_id);
      if (!tid) throw new Error('Missing thread id.');
      if (!promptID) throw new Error('Missing input prompt id.');
      const response = await runtimeJSON<SendTurnResponse>(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/input_response`, {
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
          ...(serializeFlowerReasoningSelection(input.reasoning_selection) ? { reasoning_selection: serializeFlowerReasoningSelection(input.reasoning_selection) } : {}),
        },
      });
      if (!trim(response.turn_id) || !trim(response.run_id) || trim(response.kind) !== 'start') {
        throw new Error('Flower input response admission returned an invalid receipt.');
      }
      return loadRuntimeFlowerThread(bridge, tid);
    },
    missingThreadID: 'Missing thread id.',
    failedToCreateThread: 'Failed to create Flower chat.',
  });
}
