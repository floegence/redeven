import { downloadFlowerTaskFile, flowerTaskFilePath, type FlowerTaskFileChunk } from '../../../../internal/envapp/ui_src/src/ui/downloads/flowerTaskFileDownload';
import { createDirectoryFavoritesClient } from '../../../../internal/flower_ui/src/filePicker/directoryFavorites';
import { withFlowerReadDeadline } from '../../../../internal/flower_ui/src/requestDeadline';
import { createFlowerConversationPreferenceClient, prepareFlowerNewConversationInput } from '../../../../internal/flower_ui/src/conversationPreferences';
import type { FlowerConversationPreferences } from '../../../../internal/flower_ui/src/contracts/flowerSurfaceContracts';
import { createFlowerSourceIconResolver } from '../../../../internal/flower_ui/src/chat/markdown/flowerSourceIcons';
import { flowerExtensionsAdapter } from '../../../../internal/flower_ui/host/extensionsAdapter';
import { LOCAL_ENVIRONMENT_FLOWER_RUNTIME_ID as LOCAL_ENVIRONMENT_RUNTIME_ID } from '../../../../internal/flower_ui/src/flowerRuntimeIdentity';
import type { DesktopSecurityRequest, SecurityResult } from '../../shared/runtimeSecurity';
import { computerManagementAdapter } from '../../../../internal/flower_ui/host/computerUseAdapter';
import { computerFramePath } from '../../../../internal/flower_ui/host/computerFramePath';
import { toolImagePath } from '../../../../internal/flower_ui/host/toolImagePath';
import { messageFilePath } from '../../../../internal/flower_ui/host/messageFilePath';
import { messageAttachmentPath } from '../../../../internal/flower_ui/host/messageAttachmentPath';
import { COMPUTER_FRAME_RATE_KEY, computerFrameRate } from '../../../../internal/flower_ui/src/computerViewer';
import type { DesktopCertificateRequest, DesktopCertificateReport } from '../../shared/desktopCertificate';
import { createFlowerModelReadResource, readFlowerModelDirectory, withFlowerModelDirectory, type FlowerModelReadResource } from '../../../../internal/flower_ui/src/modelDirectory';
import { serializeFlowerProvider } from '../../../../internal/flower_ui/src/settings/modelSelection';
import { fetchServerSentEvents } from '@floegence/floe-webapp-boot';
import type {
  DesktopSettingsRequest,
  DesktopSettingsResult,
  SaveDesktopSettingsRequest,
  SaveDesktopSettingsResult,
} from '../../shared/settingsIPC';
import type {
  RuntimeFlowerError,
  RuntimeFlowerMedia,
  RuntimeFlowerFailureKind,
  RuntimeFlowerRequest,
  RuntimeFlowerRequestResult,
  RuntimeFlowerStreamEvent,
  RuntimeFlowerStreamRequest,
  RuntimeFlowerStreamStartResult,
} from '../../shared/runtimeFlowerIPC';
import { isRuntimeFlowerCancellableRead } from '../../shared/runtimeFlowerIPC';
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
  FlowerSubmitInputReceipt,
  FlowerTurnLaunchInput,
  FlowerGoalResult,
  FlowerRuntimeCurrentView,
  FlowerTurnLaunchReceipt,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSurfaceAdapter,
  FlowerAttachmentUploadInput,
  FlowerAttachmentCapability,
  FlowerAttachmentStagingScope,
  FlowerStagedAttachment,
  FlowerStagedLongTextReadResult,
  FlowerSubagentDetail,
  FlowerLiveStreamConnectInput,
  FlowerTerminalProcessSnapshot,
  FlowerToolPreview,
  FlowerThreadReadStatus,
  FlowerWorkingDirectoryEntry,
  FlowerWorkingDirectoryListInput,
  FlowerWorkingDirectoryPathContext,
} from '../../../../internal/flower_ui/src/contracts/flowerSurfaceContracts';
import {
  createFlowerClientRequestID,
} from '../../../../internal/flower_ui/src/flowerRequestIdentity';
import {
  buildFlowerTurnHTTPBody,
  buildFlowerQueuedEditHTTPBody,
  normalizeFlowerTurnLaunchReceipt,
  flowerTurnAdmissionError,
  type FlowerTurnHTTPResponse,
} from '../../../../internal/flower_ui/src/flowerTurnAdmission';
import type {
  AgentSettingsResponse,
  AIConfig,
  AIModelProfile,
} from '../../../../internal/envapp/ui_src/src/ui/pages/settings/types';
import { requireAskFlowerContextActionEnvelope } from '../../../../internal/envapp/ui_src/src/ui/contextActions/protocol';
import {
  createRuntimeFlowerSurfaceAdapter,
  type RuntimeThreadPatchResponse,
} from '../../../../internal/flower_ui/src/runtimeFlowerSurfaceAdapter';
import {
  normalizeFlowerReasoningCapability,
  serializeFlowerReasoningSelection,
} from '../../../../internal/flower_ui/src/reasoning';
import { normalizeFlowerAttachmentCapability } from '../../../../internal/flower_ui/src/attachments/flowerAttachmentModel';
import {
  normalizeFlowerAttachmentStagingScope,
} from '../../../../internal/flower_host_ui/src/flowerAttachmentStaging';

export type DesktopSettingsBridge = Readonly<{
  security?: (request: DesktopSecurityRequest) => Promise<SecurityResult>;
  certificate?: (request: DesktopCertificateRequest) => Promise<DesktopCertificateReport>;
  load: (request: DesktopSettingsRequest) => Promise<DesktopSettingsResult>;
  save: (request: SaveDesktopSettingsRequest) => Promise<SaveDesktopSettingsResult>;
  retryDesktopModels?: () => Promise<boolean>;
  requestRuntimeFlower: (request: RuntimeFlowerRequest) => Promise<RuntimeFlowerRequestResult>;
  cancelRuntimeFlowerRead: (readID: string) => void;
  startRuntimeFlowerStream: (request: RuntimeFlowerStreamRequest) => Promise<RuntimeFlowerStreamStartResult>;
  cancelRuntimeFlowerStream: (streamID: string) => void;
  subscribeRuntimeFlowerStream: (listener: (event: RuntimeFlowerStreamEvent) => void) => () => void;
  prepareRuntimeFlowerAttachment: (request: unknown) => Promise<RuntimeFlowerAttachmentPrepareResponse>;
  writeRuntimeFlowerAttachmentChunk: (request: unknown) => Promise<RuntimeFlowerAttachmentChunkResponse>;
  commitRuntimeFlowerAttachment: (request: unknown) => Promise<RuntimeFlowerAttachmentCommitResponse>;
  cancelRuntimeFlowerAttachment: (request: unknown) => Promise<RuntimeFlowerAttachmentCancelResponse>;
  subscribeRuntimeFlowerAttachmentProgress: (listener: (progress: RuntimeFlowerAttachmentProgress) => void) => () => void;
  previewRuntimeFlowerAttachment: (request: unknown) => Promise<RuntimeFlowerAttachmentPreviewResponse>;
  cancel: (dialogToken: number) => void;
}>;

export type LocalEnvironmentFlowerSurfaceAdapterOptions = Readonly<{
  signal?: AbortSignal;
  openMessageURL?: FlowerSurfaceAdapter['openMessageURL'];
  runtimeEnvironmentID?: string;
  directoryFavoritesClient?: ReturnType<typeof createDirectoryFavoritesClient>;
  modelReadResource?: FlowerModelReadResource;
  runtimeDisplayName?: string;
  runtimeSubtitle?: string;
  onSettingsChanged?: () => void | Promise<unknown>;
}>;

type ThreadReadStatus = FlowerThreadReadStatus;

type ThreadView = Readonly<{
  thread_id?: string;
  read_status: ThreadReadStatus;
} & Record<string, unknown>>;

type SubmitInputResponse = Readonly<{
	  kind?: string;
	  consumed_waiting_prompt_id?: string;
	  current?: FlowerSubmitInputReceipt['current'];
}>;

type LoadThreadResponse = Readonly<{
  client_request_id?: string;
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
  environmentID?: string,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const request: RuntimeFlowerRequest = {
    method,
    path,
    ...(body === undefined ? {} : { body }),
    ...(environmentID ? { environment_id: environmentID } : {}),
    ...(stagingScope ? {
      staging_scope_id: stagingScope.staging_scope_id,
      staging_capability: stagingScope.capability,
    } : {}),
  };
  const readID = signal && isRuntimeFlowerCancellableRead(request) ? crypto.randomUUID() : undefined;
  const cancel = () => { if (readID) bridge.cancelRuntimeFlowerRead(readID); };
  const abortMessage = readID ? 'Flower read was cancelled.' : 'Waiting for the Flower request was cancelled.';
  let abortWait: (() => void) | undefined;
  try {
    const operation = bridge.requestRuntimeFlower({
      ...(readID ? { read_id: readID } : {}),
      ...request,
    });
    const result = await (signal ? Promise.race([operation, new Promise<never>((_, reject) => {
      abortWait = () => { cancel(); reject(new DOMException(abortMessage, 'AbortError')); };
      signal.addEventListener('abort', abortWait, { once: true });
      if (signal.aborted) abortWait();
    })]) : operation);
    signal?.throwIfAborted();
    if (!result.ok) throw runtimeFlowerError(result.error, result.failureKind);
    return result.data as T;
  } finally { if (abortWait) signal?.removeEventListener('abort', abortWait); }
}

export function runtimeFlowerStreamFetch(
  bridge: DesktopSettingsBridge,
  streamID: string,
): typeof globalThis.fetch {
  return async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let settled = false;
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const cleanup = (cancel: boolean) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      init?.signal?.removeEventListener('abort', abort);
      if (cancel) bridge.cancelRuntimeFlowerStream(streamID);
    };
    const abort = () => {
      const reason = init?.signal?.reason instanceof Error
        ? init.signal.reason
        : new DOMException('Flower stream was cancelled.', 'AbortError');
      bodyController?.error(reason);
      cleanup(true);
    };
    const unsubscribe = bridge.subscribeRuntimeFlowerStream((event) => {
      if (event.stream_id !== streamID || settled) return;
      if (event.kind === 'chunk') {
        bodyController?.enqueue(event.chunk);
      } else if (event.kind === 'end') {
        bodyController?.close();
        cleanup(false);
      } else {
        bodyController?.error(new Error(event.message));
        cleanup(false);
      }
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
      },
      cancel() {
        cleanup(true);
      },
    });
    if (init?.signal?.aborted) {
      abort();
      throw init.signal.reason;
    }
    init?.signal?.addEventListener('abort', abort, { once: true });
    const started = await bridge.startRuntimeFlowerStream({ stream_id: streamID, path });
    if (!started.ok) {
      cleanup(false);
      throw runtimeFlowerError(started.error, 'transport_unknown');
    }
    return new Response(body, {
      status: started.status,
      headers: {
        ...(started.content_type ? { 'Content-Type': started.content_type } : {}),
        ...(started.retry_after ? { 'Retry-After': started.retry_after } : {}),
      },
    });
  };
}

async function createDesktopAttachmentStagingScope(
  bridge: DesktopSettingsBridge,
  requestedTargetID?: string,
): Promise<FlowerAttachmentStagingScope> {
  const targetID = trim(requestedTargetID) || createFlowerClientRequestID();
  const result = await bridge.requestRuntimeFlower({
    method: 'POST',
    path: '/_redeven_proxy/api/ai/upload-staging-scopes',
    body: { target_id: targetID },
  });
  if (!result.ok) throw runtimeFlowerError(result.error, result.failureKind);
  return normalizeFlowerAttachmentStagingScope(result.data, result.stagingCapability, targetID);
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
    web_search_enabled: model.web_search_enabled, supports_tools: model.supports_tools,
    display_name: model.display_name, status: model.status,
    model_digest: model.model_digest, quantization: model.quantization, unavailable: model.unavailable,
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
    enabled: provider.enabled,
    id: trim(provider.id),
    ...(trim(provider.name) ? { name: trim(provider.name) } : {}),
    type: provider.type,
    ...(trim(provider.base_url) ? { base_url: trim(provider.base_url) } : {}),
    ...(provider.responses_continuation === true ? { responses_continuation: true } : {}),
    ...(provider.web_search ? { web_search: { ...provider.web_search } } : {}),
    ...(provider.web_fetch ? { web_fetch: { ...provider.web_fetch } } : {}),
    model_selection: provider.model_selection,
    auth_method: provider.auth_method, account_id: provider.account_id,
    models: (provider.models ?? []).map(mapProviderModel).filter(model => model.model_name),
  };
}

export function mapRuntimeFlowerSettings(settings: AgentSettingsResponse): FlowerSettingsSnapshot {
  const ai = settings.ai;
  const modelProfile = ai && (ai.providers ?? []).length > 0
    ? {
        schema_version: 1 as const,
        current_model_id: trim(ai.current_model_id),
        providers: (ai.providers ?? []).map(mapProvider).filter((provider) => provider.id),
      }
    : null;
  const providerSecrets = settings.ai_secrets?.provider_api_key_set ?? {};
  const webSecrets = settings.ai_secrets?.web_search_provider_api_key_set ?? {};
  const snapshot: FlowerSettingsSnapshot = {
    auth_capabilities: settings.auth_capabilities,
    chatgpt_accounts: settings.chatgpt_accounts,
    defaults: {
      permission_type: normalizePermissionType(ai?.permission_type),
      computer_use_enabled: ai?.computer_use_enabled !== false,
      auto_update_model_catalog: ai?.auto_update_model_catalog === true,
    },
    model_profile: modelProfile,
    provider_secrets: (modelProfile?.providers ?? []).map((provider) => ({
      provider_id: provider.id,
      provider_api_key_configured: Boolean(providerSecrets[provider.id]),
      web_search_api_key_configured: Boolean(webSecrets[provider.id]),
    })),
  };
  return settings.ai_models ? withFlowerModelDirectory(snapshot, readFlowerModelDirectory(settings.ai_models)) : snapshot;
}

function draftProviderToAI(provider: FlowerProviderDraft): NonNullable<AIConfig['providers']>[number] {
  return serializeFlowerProvider(provider) as NonNullable<AIConfig['providers']>[number];
}

export function mapFlowerSettingsDraftToRuntimeBundle(draft: FlowerSettingsDraft): {
  auth_schema_version: 1;
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
    auth_schema_version: 1,
    model_profile: {
      current_model_id: trim(draft.model_profile.current_model_id),
      providers: draft.model_profile.providers.map(draftProviderToAI),
    },
    provider_api_key_patches: providerAPIKeyPatches,
    web_search_provider_key_patches: webSearchKeyPatches,
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

export function createDesktopFlowerModelReadResource(bridge: DesktopSettingsBridge, scope: () => string, runtimeEnvironmentID?: string): FlowerModelReadResource {
  return createFlowerModelReadResource({
    scope,
    loadConfiguration: async signal => mapRuntimeFlowerSettings(await runtimeJSON<AgentSettingsResponse>(bridge, 'GET', '/_redeven_proxy/api/settings', undefined, undefined, runtimeEnvironmentID, signal)),
    loadDirectory: async (baseline, signal) => readFlowerModelDirectory(await runtimeJSON(bridge, 'GET', '/_redeven_proxy/api/ai/models' + (baseline ? '?mode=baseline' : ''), undefined, undefined, runtimeEnvironmentID, signal)),
  });
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

// Ask Flower retains this resolved input for an unknown-admission retry. It is
// per request, not personal memory, and never writes preferences.
export async function prepareLocalEnvironmentFlowerTurnInput(
  bridge: DesktopSettingsBridge,
  input: FlowerTurnLaunchInput,
): Promise<FlowerTurnLaunchInput> {
  return prepareFlowerNewConversationInput({
    loadSettings: async () => {
      const [snapshot, preferences] = await Promise.all([
        createDesktopFlowerModelReadResource(bridge, () => 'launch').loadSettings(),
        runtimeJSON<FlowerConversationPreferences>(bridge, 'GET', '/_redeven_proxy/api/ai/conversation_preferences'),
      ]);
      return { ...snapshot, conversation_preferences: preferences };
    },
    getWorkingDirectoryPathContext: async () => mapRuntimeWorkingDirectoryPathContext(await runtimeJSON<RuntimeFSPathContextResponse>(bridge, 'GET', '/_redeven_proxy/api/fs/path_context')),
  }, input);
}

export async function launchLocalEnvironmentFlowerTurn(
  bridge: DesktopSettingsBridge,
  input: FlowerTurnLaunchInput,
  modelReadResource?: FlowerModelReadResource,
  signal?: AbortSignal,
): Promise<FlowerTurnLaunchReceipt> {
  const prompt = input.prompt;
  const attachmentIDs = (input.attachment_ids ?? []).map(trim).filter(Boolean);
  const contextAction = requireAskFlowerContextActionEnvelope(input.context_action);
  if (!prompt.trim() && attachmentIDs.length === 0 && !contextAction) throw new Error('Enter a message or add an attachment before sending.');
  const existingThreadID = trim(input.thread_id);
  const snapshot = !existingThreadID && !trim(input.model_id) ? await (modelReadResource ?? createDesktopFlowerModelReadResource(bridge, () => 'launch')).loadSettings() : null;
  const preferences = snapshot ? await runtimeJSON<FlowerConversationPreferences>(bridge, 'GET', '/_redeven_proxy/api/ai/conversation_preferences') : null;
  const modelID = trim(input.model_id) || trim(preferences?.model_id) || trim(snapshot?.model_directory?.current_model_id) || trim(snapshot?.model_profile?.current_model_id);
  if (!existingThreadID && !modelID) throw new Error('Select a Flower model before starting a chat.');
  const permissionType = trim(input.permission_type)
    ? normalizePermissionType(input.permission_type)
    : undefined;
  const clientRequestID = trim(input.client_request_id);
  if (!clientRequestID) throw new Error('Missing client request id.');
  const stagingScope = input.staging_scope;
  const expectedStagingTargetID = existingThreadID || clientRequestID;
  if (stagingScope && trim(stagingScope.target_id) !== expectedStagingTargetID) {
    throw new Error('Flower attachment staging scope targets a different request.');
  }
  if (attachmentIDs.length > 0 && !stagingScope) {
    throw new Error('Flower attachments require a staging scope.');
  }
  const requestBody = buildFlowerTurnHTTPBody({
    launch: input,
    modelID,
    permissionType,
    contextAction,
    attachmentIDs,
    reasoningSelection: serializeFlowerReasoningSelection(input.reasoning_selection),
  });
  signal?.throwIfAborted();
  const response = await runtimeJSON<FlowerTurnHTTPResponse>(
    bridge,
    'POST',
    existingThreadID
      ? `/_redeven_proxy/api/ai/threads/${encodeURIComponent(existingThreadID)}/turns`
      : '/_redeven_proxy/api/ai/turns',
    requestBody,
    stagingScope,
  );
  return normalizeFlowerTurnLaunchReceipt(response, { clientRequestID, existingThreadID });
}

export function createDesktopDirectoryFavoritesClient(bridge: DesktopSettingsBridge, environmentID?: string) {
  return createDirectoryFavoritesClient((method, path, signal) => runtimeJSON(bridge, method,
    '/_redeven_proxy/api/fs/directory_favorites', path === undefined ? undefined : { path }, undefined, environmentID, signal));
}

export function createLocalEnvironmentFlowerSurfaceAdapter(
  bridge: DesktopSettingsBridge,
  options: LocalEnvironmentFlowerSurfaceAdapterOptions = {},
): FlowerSurfaceAdapter {
  const resource = options.modelReadResource ?? createDesktopFlowerModelReadResource(bridge, () => options.runtimeEnvironmentID ?? 'default', options.runtimeEnvironmentID);
  const preferences = createFlowerConversationPreferenceClient({
    load: signal => runtimeJSON<FlowerConversationPreferences>(bridge, 'GET', '/_redeven_proxy/api/ai/conversation_preferences', undefined, undefined, options.runtimeEnvironmentID, signal),
    patch: patch => runtimeJSON<FlowerConversationPreferences>(bridge, 'PATCH', '/_redeven_proxy/api/ai/conversation_preferences', patch, undefined, options.runtimeEnvironmentID),
  }, { signal: options.signal });
  const loadSettings: FlowerSurfaceAdapter['loadSettings'] = (refresh = false, signal) => withFlowerReadDeadline(async readSignal => {
    const [settings, conversation_preferences] = await Promise.all([resource.loadSettings(refresh), preferences.load(readSignal)]);
    return { ...settings, conversation_preferences };
  }, 'Flower settings read timed out.', signal && options.signal ? AbortSignal.any([signal, options.signal]) : signal ?? options.signal);
  const reloadSettings = () => { resource.invalidate(); return loadSettings(); };
  return createRuntimeFlowerSurfaceAdapter({
    directoryFavorites: failureMessage => options.directoryFavoritesClient?.view(failureMessage),
    signal: options.signal,
    runtime: {
      runtime_id: LOCAL_ENVIRONMENT_RUNTIME_ID,
      runtime_kind: 'local_environment',
      carrier_kind: 'runtime',
      get display_name() { return options.runtimeDisplayName ?? LOCAL_ENVIRONMENT_LABEL; },
      get subtitle() { return options.runtimeSubtitle ?? LOCAL_ENVIRONMENT_SUBTITLE; },
    },
    transport: {
      readParentEvents: (threadID, query, signal) => runtimeJSON(bridge, 'POST', '/_redeven_proxy/api/ai/threads/' + encodeURIComponent(threadID) + '/subagent-events', query, undefined, options.runtimeEnvironmentID, signal),
      listThreads: input => runtimeJSON(bridge, 'GET', '/_redeven_proxy/api/ai/threads?' + new URLSearchParams({ limit: String(input?.limit ?? 25), ...(input?.cursor ? { cursor: input.cursor } : {}) }), undefined, undefined, options.runtimeEnvironmentID, input?.signal),
		loadThread: (threadID, signal) => runtimeJSON(bridge, 'GET', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}`, undefined, undefined, options.runtimeEnvironmentID, signal),
      releaseHistory: async (threadID, input) => { await runtimeJSON(bridge, 'POST', '/_redeven_proxy/api/ai/threads/' + encodeURIComponent(threadID) + '/history-release', input, undefined, options.runtimeEnvironmentID); },
      loadHistory: (threadID, input, signal) => runtimeJSON(bridge, 'POST', '/_redeven_proxy/api/ai/threads/' + encodeURIComponent(threadID) + '/history', input, undefined, options.runtimeEnvironmentID, signal),
      loadActivityValue: (threadID, input, signal) => runtimeJSON(bridge, 'POST', '/_redeven_proxy/api/ai/threads/' + encodeURIComponent(threadID) + '/activity-value', input, undefined, options.runtimeEnvironmentID, signal),
      loadActivityStructure: (threadID, input, signal) => runtimeJSON(bridge, 'POST', '/_redeven_proxy/api/ai/threads/' + encodeURIComponent(threadID) + '/activity-structure', input, undefined, options.runtimeEnvironmentID, signal),
      loadActivityField: (threadID, input, signal) => runtimeJSON(bridge, 'POST', '/_redeven_proxy/api/ai/threads/' + encodeURIComponent(threadID) + '/activity-field', input, undefined, options.runtimeEnvironmentID, signal),
      loadHistoryItem: (threadID, itemID, signal) => runtimeJSON(bridge, 'POST', '/_redeven_proxy/api/ai/threads/' + encodeURIComponent(threadID) + '/history-item', { item_id: itemID }, undefined, options.runtimeEnvironmentID, signal),
      loadHistoryBody: (threadID, input, signal) => runtimeJSON(bridge, 'POST', '/_redeven_proxy/api/ai/threads/' + encodeURIComponent(threadID) + '/history-body', input, undefined, options.runtimeEnvironmentID, signal),
      connectLiveStream: async function* (input: FlowerLiveStreamConnectInput) {
        const path = '/_redeven_proxy/api/ai/flower/stream';
        const streamID = `flower-${globalThis.crypto.randomUUID()}`;
        const streamController = new AbortController();
        const abort = () => streamController.abort(input.signal.reason);
        input.signal.addEventListener('abort', abort, { once: true });
        let activityTimer: ReturnType<typeof setTimeout> | undefined;
        const resetActivityTimer = () => {
          if (activityTimer !== undefined) clearTimeout(activityTimer);
          activityTimer = setTimeout(() => streamController.abort('Flower live stream timed out.'), 45_000);
        };
        try {
          resetActivityTimer();
          for await (const frame of fetchServerSentEvents(path, {
            method: 'GET',
            signal: streamController.signal,
            fetch: runtimeFlowerStreamFetch(bridge, streamID),
            onActivity: resetActivityTimer,
          })) {
            yield frame;
          }
        } finally {
          input.signal.removeEventListener('abort', abort);
          if (activityTimer !== undefined) clearTimeout(activityTimer);
          streamController.abort();
          bridge.cancelRuntimeFlowerStream(streamID);
        }
      },
	      loadSubagentDetail: (parentThreadID, childThreadID, input, signal) => runtimeJSON<Readonly<{ detail?: FlowerSubagentDetail }>>(
	        bridge,
	        input ? 'POST' : 'GET',
	        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(parentThreadID)}/subagents/${encodeURIComponent(childThreadID)}/detail`, input, undefined, options.runtimeEnvironmentID, signal,
	      ),
      operateSubagentInput: (parentThreadID, childThreadID, input) => runtimeJSON<Readonly<{ detail?: FlowerSubagentDetail }>>(
        bridge, 'POST',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(parentThreadID)}/subagents/${encodeURIComponent(childThreadID)}/input`, input,
      ),
      loadTaskFiles: (threadID, cursor) => runtimeJSON(bridge, 'GET', '/_redeven_proxy/api/ai/threads/' + encodeURIComponent(threadID) + '/task-files' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), undefined, undefined, options.runtimeEnvironmentID),
      downloadTaskFile: (threadID, path, working, signal) => downloadFlowerTaskFile(path, offset => runtimeJSON<FlowerTaskFileChunk>(bridge, 'GET', flowerTaskFilePath(threadID,path,working,offset), undefined, undefined, options.runtimeEnvironmentID, signal),signal),
      cleanTaskFiles: async (threadID) => { await runtimeJSON(bridge, 'DELETE', '/_redeven_proxy/api/ai/threads/' + encodeURIComponent(threadID) + '/task-files', undefined, undefined, options.runtimeEnvironmentID); },
      loadToolPreview: (input) => runtimeJSON<FlowerToolPreview>(bridge, 'POST',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(input.thread_id)}/tool-preview`,
        { turn_id: input.turn_id, run_id: input.run_id, tool_call_id: input.tool_call_id },
      ),
      readTerminalProcess: (runID, processID, input, signal) => {
        const params = new URLSearchParams();
        params.set('after_seq', String(input.after_seq));
        return runtimeJSON<FlowerTerminalProcessSnapshot>(
          bridge,
          'GET',
          `/_redeven_proxy/api/ai/runs/${encodeURIComponent(runID)}/terminal/${encodeURIComponent(processID)}/read?${params.toString()}`,
          undefined, undefined, undefined, signal,
        );
      },
      markThreadRead: (threadID, body) => runtimeJSON<MarkThreadReadResponse>(
        bridge,
        'POST',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/read`,
        body,
      ),
      patchThread: (threadID, body) => runtimeJSON<RuntimeThreadPatchResponse>(
        bridge,
        'PATCH',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}`,
        body,
      ),
      movePinnedThread: (threadID, input) => runtimeJSON(
        bridge, 'PATCH', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/pin-position`, input,
      ),
      reorderQueuedTurns: (threadID, orderedQueueIDs) => runtimeJSON(
        bridge,
        'PATCH',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/queue/order`,
        { ordered_queue_ids: orderedQueueIDs },
      ),
      deleteQueuedTurn: (threadID, queueID) => runtimeJSON(
        bridge,
        'DELETE',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/queue/${encodeURIComponent(queueID)}`,
      ),
      prepareQueuedTurnDraft: (threadID, queueID, input) => runtimeJSON(
        bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/queue/${encodeURIComponent(queueID)}/prepare-edit`,
        { expected_input_fingerprint: input.expected_input_fingerprint, ...(input.staging_scope ? { staging_scope_id: input.staging_scope.staging_scope_id } : {}) }, input.staging_scope,
      ),
      takeBackQueuedTurn: (threadID, queueID, fingerprint) => runtimeJSON(
        bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/queue/${encodeURIComponent(queueID)}/take-back`,
        { expected_input_fingerprint: fingerprint },
      ),
      editQueuedTurn: (threadID, queueID, input) => runtimeJSON(
        bridge, 'PATCH', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/queue/${encodeURIComponent(queueID)}`,
        buildFlowerQueuedEditHTTPBody(input), input.staging_scope,
      ),
      sendQueuedTurnNow: (threadID, queueID) => runtimeJSON(
        bridge,
        'POST',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/queue/${encodeURIComponent(queueID)}/send-now`,
      ),
      forkThread: (threadID, body) => runtimeJSON<LoadThreadResponse>(
        bridge,
        'POST',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/fork`,
        body,
      ),
      deleteThread: async (threadID) => {
        await runtimeJSON<unknown>(
          bridge,
          'DELETE',
          `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}?force=true`,
        );
      },
		submitApproval: (body) => runtimeJSON(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(body.thread_id)}/approvals`, body),
    },
    mapperOptions: localEnvironmentLiveMapperOptions(),
    extensions: flowerExtensionsAdapter((method, path, body) => runtimeJSON(bridge, method, path, body, undefined, options.runtimeEnvironmentID), { canInteract: () => true, canAdmin: () => true }),
    loadSettings,
    loadModelDirectory: refresh => resource.loadDirectory(refresh),
    recoverModelSource: async () => { await bridge.retryDesktopModels?.(); },
    subscribeModelDirectory: resource.subscribe,
    loadChatGPTAccounts: () => runtimeJSON(bridge, 'GET', '/_redeven_proxy/api/ai/auth/chatgpt/accounts'),
    chatGPTAuth: async (action, input) => {
      const result = await runtimeJSON<Awaited<ReturnType<NonNullable<FlowerSurfaceAdapter['chatGPTAuth']>>>>(bridge, 'POST', `/_redeven_proxy/api/ai/auth/chatgpt/${action}`, input);
      if (action === 'sign-out' || action === 'remove' || action === 'retry') {
        resource.invalidate();
        options.signal?.throwIfAborted();
        if (options.onSettingsChanged) void Promise.resolve(options.onSettingsChanged()).catch(() => undefined);
      }
      return result;
    },
    discoverProviderModels: (input) => runtimeJSON(bridge, 'POST', '/_redeven_proxy/api/ai/model_catalog', input),
    saveDefaultPermission: async (permissionType) => {
      await runtimeJSON<unknown>(bridge, 'PUT', '/_redeven_proxy/api/ai/default_permission', {
        permission_type: normalizePermissionType(permissionType),
      });
      return reloadSettings();
    },
    saveComputerUseEnabled: async (enabled) => {
      await runtimeJSON<unknown>(bridge, 'PUT', '/_redeven_proxy/api/ai/computer_use', {
        enabled,
      });
      return reloadSettings();
    },
    saveAutoUpdateModelCatalog: async (enabled) => {
      await runtimeJSON<unknown>(bridge, 'PUT', '/_redeven_proxy/api/ai/model_catalog_auto_update', {
        enabled,
      });
      return reloadSettings();
    },
    loadComputerFrame: async (input) => {
      input.signal.throwIfAborted();
      const frame = await runtimeJSON<RuntimeFlowerMedia>(bridge, 'GET',
        computerFramePath(input));
      input.signal.throwIfAborted();
      if (!(frame.bytes instanceof Uint8Array) || frame.mime_type !== 'image/png') {
        throw new Error('Flower returned invalid computer media.');
      }
      return new Blob([new Uint8Array(frame.bytes)], { type: frame.mime_type });
    },
    loadToolImage: async (input) => {
      input.signal.throwIfAborted();
      const image = await runtimeJSON<RuntimeFlowerMedia>(bridge, 'GET', toolImagePath(input));
      input.signal.throwIfAborted();
      if (!(image.bytes instanceof Uint8Array) || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mime_type) || image.bytes.length > (10 << 20)) {
        throw new Error('Image preview is unavailable.');
      }
      return new Blob([new Uint8Array(image.bytes)], { type: image.mime_type });
    },
    loadMessageFile: async ({ path, signal }) => {
      signal.throwIfAborted();
      const media = await runtimeJSON<RuntimeFlowerMedia>(bridge, 'GET', messageFilePath(path), undefined, undefined, options.runtimeEnvironmentID, signal);
      signal.throwIfAborted();
      if (!(media.bytes instanceof Uint8Array)) throw new Error('File preview is unavailable.');
      return new Blob([new Uint8Array(media.bytes)], { type: media.mime_type });
    },
    openMessageURL: options.openMessageURL,
    resolveCanonicalReference: async request => {
      if (Boolean(request.turn_id) === Boolean(request.queue_id)) throw new Error('Missing exact Flower reference scope.');
      const target = await runtimeJSON<{ kind: 'file' | 'directory'; label: string; path: string }>(bridge, 'POST',
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(request.thread_id)}/reference-open-target`,
        { ...(request.turn_id ? { turn_id: request.turn_id } : { queue_id: request.queue_id }), reference_id: request.reference_id }, undefined, options.runtimeEnvironmentID);
      if (!target || (target.kind !== 'file' && target.kind !== 'directory') || !target.path || typeof target.label !== 'string') throw new Error('Invalid Flower reference preview target.');
      return target;
    },
    loadMessageAttachment: async ({ url, signal }) => {
      signal.throwIfAborted();
      const media = await runtimeJSON<RuntimeFlowerMedia>(bridge, 'GET', messageAttachmentPath(url), undefined, undefined, options.runtimeEnvironmentID);
      signal.throwIfAborted();
      if (!(media.bytes instanceof Uint8Array)) throw new Error('Attachment preview is unavailable.');
      return new Blob([new Uint8Array(media.bytes)], { type: media.mime_type });
    },
    computerFrameRate: {
      read: () => computerFrameRate(window.redevenDesktopStateStorage?.getItem(COMPUTER_FRAME_RATE_KEY)),
      write: (fps) => { window.redevenDesktopStateStorage?.setItem(COMPUTER_FRAME_RATE_KEY, String(fps)); },
    },
    inputComputerControl: async (input) => {
      await runtimeJSON(bridge, 'POST', '/_redeven_proxy/api/ai/computer/input', input);
    },
    setComputerViewer: async (input) => { await runtimeJSON(bridge, 'PUT', '/_redeven_proxy/api/ai/computer/view', input); },
    resolveSourceIcon: createFlowerSourceIconResolver(origin => runtimeJSON(bridge, 'GET', '/_redeven_proxy/api/flower/source-icon?' + new URLSearchParams({ origin }), undefined, undefined, options.runtimeEnvironmentID)),
    computerManagement: { ...computerManagementAdapter((method, path, body) => runtimeJSON(bridge, method, path, body, undefined, options.runtimeEnvironmentID), `desktop:${options.runtimeEnvironmentID ?? 'default'}`) },
    saveModelProfile: async (draft) => {
      resource.invalidate();
      const result = await runtimeJSON<{ account_sign_outs?: FlowerSettingsSnapshot['account_sign_outs'] }>(bridge, 'PUT', '/_redeven_proxy/api/ai/provider_bundle', mapFlowerSettingsDraftToRuntimeBundle(draft));
      return { ...await reloadSettings(), account_sign_outs: result.account_sign_outs };
    },
    saveConversationPreferences: async patch => {
      const saved = await preferences.save(patch);
      options.signal?.throwIfAborted();
      if (options.onSettingsChanged) void Promise.resolve(options.onSettingsChanged()).catch(() => undefined);
      return saved;
    },
    persistDefaultModel: async (modelID) => {
      const mid = trim(modelID);
      if (!mid) throw new Error('Missing model id.');
      await preferences.save({ model_id: mid });
      const snapshot = await reloadSettings();
      options.signal?.throwIfAborted();
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
      }, undefined, options.runtimeEnvironmentID),
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
    bindAttachmentStagingScope: async (scope, threadID) => {
      const bound = await runtimeJSON<Omit<FlowerAttachmentStagingScope, 'capability'>>(
        bridge, 'PATCH', '/_redeven_proxy/api/ai/upload-staging-scopes/' + encodeURIComponent(scope.staging_scope_id),
        { expected_target_id: scope.target_id, thread_id: threadID }, scope,
      );
      return { ...bound, capability: scope.capability };
    },
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
    resolveStorageGeneration: async () => {
      const result = await runtimeJSON<{ storage_generation: string }>(bridge, 'GET', '/_redeven_proxy/api/ai/storage-generation');
      if (typeof result.storage_generation !== 'string' || (result.storage_generation && !/^[a-f0-9]{32}$/u.test(result.storage_generation))) throw new Error('Invalid Flower storage generation.');
      return result.storage_generation;
    },
    launchTurn: async (input: FlowerTurnLaunchInput) => {
      return launchLocalEnvironmentFlowerTurn(bridge, input, resource, options.signal);
    },
    manageGoal: async (input) => {
      try {
        return await runtimeJSON<FlowerGoalResult>(bridge, 'POST', '/_redeven_proxy/api/ai/thread-goal', input);
      } catch (error) {
        const rejected = error instanceof RuntimeFlowerResponseError && error.failureKind === 'response'
          && error.code !== 'AI_GOAL_OUTCOME_UNKNOWN' && (error.status ?? 500) < 500;
        throw flowerTurnAdmissionError(rejected ? 'rejected' : 'unknown', error);
      }
    },
    compactThreadContext: async (threadID, input) => {
      try {
        const response = await runtimeJSON<{ current: FlowerRuntimeCurrentView }>(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/context/compact`, input);
        return response.current;
      } catch (error) {
        const rejected = error instanceof RuntimeFlowerResponseError && error.failureKind === 'response'
          && (error.status ?? 500) < 500;
        throw flowerTurnAdmissionError(rejected ? 'rejected' : 'unknown', error);
      }
    },
    retryThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error('Missing thread id.');
		await runtimeJSON<unknown>(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/retry`, {});
	},
    stopThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error('Missing thread id.');
		await runtimeJSON<{ ok: boolean }>(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/cancel`, {});
	},
    submitInput: async (input) => {
      const tid = trim(input.thread_id);
      const promptID = trim(input.prompt_id);
      if (!tid) throw new Error('Missing thread id.');
      if (!promptID) throw new Error('Missing input prompt id.');
      const response = await runtimeJSON<SubmitInputResponse>(bridge, 'POST', `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/input_response`, {
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
		if (
			trim(response.kind) !== 'accepted'
			|| trim(response.consumed_waiting_prompt_id) !== promptID
			|| !response.current
			|| trim(response.current.thread_id) !== tid
			|| Number(response.current.view_version) <= 0
		) {
			throw new Error('Flower input response returned an invalid current view.');
		}
		return {
			thread_id: tid,
			consumed_prompt_id: promptID,
			current: response.current,
		} satisfies FlowerSubmitInputReceipt;
    },
    missingThreadID: 'Missing thread id.',
    failedToCreateThread: 'Failed to create Flower chat.',
  });
}
