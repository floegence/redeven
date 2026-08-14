import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import { fetchServerSentEvents } from '@floegence/floe-webapp-boot';
import {
  fetchLocalApiJSON,
  fetchLocalApiJSONResponse,
  LocalApiError,
  prepareLocalApiRequestInit,
  uploadLocalApiAttachment,
} from '../services/localApi';
import type { AgentSettingsResponse, AIConfig, AIModelProfile } from '../pages/settings/types';
import type {
  FlowerApprovalCommandResult,
  FlowerAttachmentUploadInput,
  FlowerAttachmentCapability,
  FlowerAttachmentStagingScope,
  FlowerCanonicalReferenceOpenRequest,
  FlowerProvider,
  FlowerProviderDraft,
  FlowerProviderModel,
  FlowerPermissionType,
  FlowerRouterDecision,
  FlowerTurnLaunchInput,
  FlowerTurnLaunchReceipt,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerModelSourceModel,
  FlowerModelSourceRecovery,
  FlowerSurfaceAdapter,
  FlowerSubmitInputReceipt,
  FlowerStagedAttachment,
  FlowerStagedLongTextReadResult,
  FlowerTerminalProcessSnapshot,
  FlowerThreadReadStatus,
  FlowerLiveStreamConnectInput,
} from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { FlowerCanonicalReferenceNavigationTarget } from './linkedContextNavigation';
import { requireAskFlowerContextActionEnvelope } from '../contextActions/protocol';
import {
  createRuntimeFlowerSurfaceAdapter,
  FLOWER_THREAD_DELETE_OPERATION_FAILED_CODE,
} from '../../../../../flower_ui/src/runtimeFlowerSurfaceAdapter';
import {
  createFlowerClientRequestID,
} from '../../../../../flower_ui/src/flowerRequestIdentity';
import {
  normalizeFlowerReasoningCapability,
  serializeFlowerReasoningSelection,
} from '../../../../../flower_ui/src/reasoning';
import { normalizeFlowerAttachmentCapability } from '../../../../../flower_ui/src/attachments/flowerAttachmentModel';
import {
  flowerAttachmentStagingHeaders,
  flowerStagingCapabilityHeaderName,
  normalizeFlowerAttachmentStagingScope,
} from '../../../../../flower_host_ui/src/flowerAttachmentStaging';
type EnvLocalFlowerSurfaceAdapterOptions = Readonly<{
  envPublicID: string;
  envLabel: string;
  desktopSessionTargetRoute?: 'local_host' | 'remote_desktop';
  rpc: RedevenV1Rpc;
  canMutate?: boolean;
  copy?: EnvLocalFlowerSurfaceAdapterCopy;
  onSettingsChanged?: () => void | Promise<unknown>;
  uploadAttachment?: FlowerSurfaceAdapter['uploadAttachment'];
  openFileBrowser?: FlowerSurfaceAdapter['openFileBrowser'];
  openFilePreview?: FlowerSurfaceAdapter['openFilePreview'];
  openCanonicalReferenceTarget?: (target: FlowerCanonicalReferenceNavigationTarget) => Promise<void>;
  openLinkedFilePreview?: FlowerSurfaceAdapter['openLinkedFilePreview'];
  openLinkedDirectoryBrowser?: FlowerSurfaceAdapter['openLinkedDirectoryBrowser'];
  modelSourceRecovery?: FlowerModelSourceRecovery;
}>;

export type EnvLocalFlowerSurfaceAdapterCopy = Readonly<{
  currentEnvironment: string;
  usingCurrentEnvironment: string;
  environmentLocalSubtitle: string;
  missingThreadID: string;
  enterMessageBeforeSending: string;
  selectModelBeforeChat: string;
  failedToCreateChat: string;
}>;

type ModelsResponse = Readonly<{
  current_model?: string;
  models?: readonly Readonly<{
    id?: string;
    label?: string;
    source?: string;
    context_window?: number;
    max_output_tokens?: number;
    input_modalities?: readonly string[];
    reasoning_capability?: FlowerProviderModel['reasoning_capability'];
  }>[];
}>;

type DesktopModelCatalogLoad =
  | Readonly<{ state: 'loaded'; response: ModelsResponse }>
  | Readonly<{ state: 'failed'; message: string }>;

const DESKTOP_MODEL_SOURCE_ID_PATTERN = /^desktop:model_[0-9a-f]{64}$/;

type ThreadView = Readonly<{
  thread_id?: string;
  read_status: ThreadReadStatus;
} & Record<string, unknown>>;

type ThreadReadStatus = FlowerThreadReadStatus;

type LoadThreadResponse = Readonly<{
  client_request_id?: string;
  thread?: ThreadView;
}>;

type SendTurnResponse = Readonly<{
  client_request_id?: string;
  thread_id?: string;
  run_id?: string;
  turn_id?: string;
  queue_id?: string;
  kind?: string;
  current?: FlowerTurnLaunchReceipt['current'];
}>;

type SubmitInputResponse = Readonly<{
  kind?: string;
  consumed_waiting_prompt_id?: string;
  current?: FlowerSubmitInputReceipt['current'];
}>;

type MarkThreadReadResponse = Readonly<{
  read_status: ThreadReadStatus;
}>;
type FlowerSecretPatch = Readonly<{ provider_id: string; api_key: string | null }>;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function hexDigest(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  return hexDigest(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

async function uploadEnvLocalFlowerAttachment(input: FlowerAttachmentUploadInput): Promise<FlowerStagedAttachment> {
  if (input.signal.aborted) {
    const error = new Error('Attachment upload was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
  const canonicalName = input.file.name.normalize('NFC');
  const [contentSHA256, displayNameSHA256] = await Promise.all([
    input.file.arrayBuffer().then(sha256Hex),
    sha256Hex(new TextEncoder().encode(canonicalName)),
  ]);
  const response = await uploadLocalApiAttachment({
    file: new File([input.file], canonicalName, { type: input.file.type }),
    source: input.source === 'long_text' ? 'long_text' : 'uploaded_file',
    requestID: input.request_id,
    stagingScopeID: input.staging_scope.staging_scope_id,
    stagingCapability: input.staging_scope.capability,
    contentSHA256,
    displayNameSHA256,
    signal: input.signal,
    onProgress: (loaded, total) => input.on_progress({
      attempt_id: input.attempt_id,
      loaded,
      ...(total === undefined ? {} : { total }),
      indeterminate: total === undefined,
    }),
  });
  const attachmentID = trim(response.attachment_id);
  const name = trim(response.display_name);
  const mimeType = trim(response.detected_media_type);
  const digest = trim(response.content_sha256).toLowerCase();
  const locator = trim(response.logical_locator);
  const sizeBytes = Number(response.size_bytes);
  if (!attachmentID || !name || !mimeType || !locator.startsWith('attachment://v1/') || !/^[0-9a-f]{64}$/u.test(digest) ||
      !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error('Attachment upload returned invalid metadata.');
  }
  const codePoints = Number(response.unicode_code_points);
  const lines = Number(response.logical_line_count);
  return {
    attachment_id: attachmentID,
    name,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    digest_sha256: digest,
    locator,
    source: input.source,
    ...(Number.isSafeInteger(codePoints) && codePoints >= 0 && Number.isSafeInteger(lines) && lines >= 0
      ? { text_stats: { code_points: codePoints, lines } }
      : {}),
    capability_revision: trim(response.capability_revision) || input.capability_revision,
    ...(Number.isSafeInteger(Number(response.created_at_unix_ms)) && Number(response.created_at_unix_ms) > 0
      ? { created_at_unix_ms: Math.floor(Number(response.created_at_unix_ms)) }
      : {}),
  };
}

function mapEnvStagedLongText(raw: unknown, expected: FlowerStagedAttachment): FlowerStagedLongTextReadResult {
  const record = raw && typeof raw === 'object' ? raw as Readonly<{
    attachment?: unknown;
    text?: unknown;
    content_sha256?: unknown;
  }> : {};
  const attachment = record.attachment && typeof record.attachment === 'object'
    ? record.attachment as Readonly<{
      attachment_id?: unknown;
      display_name?: unknown;
      detected_media_type?: unknown;
      size_bytes?: unknown;
      content_sha256?: unknown;
    }>
    : {};
  const digest = trim(record.content_sha256 ?? attachment.content_sha256).toLowerCase();
  if (trim(attachment.attachment_id) !== expected.attachment_id
    || trim(attachment.display_name) !== expected.name
    || trim(attachment.detected_media_type) !== expected.mime_type
    || Number(attachment.size_bytes) !== expected.size_bytes
    || digest !== expected.digest_sha256
    || typeof record.text !== 'string') {
    throw new Error('Flower long-text restore returned mismatched attachment metadata.');
  }
  return { attachment: expected, text: record.text };
}

async function createEnvAttachmentStagingScope(targetID?: string): Promise<FlowerAttachmentStagingScope> {
  const resolvedTargetID = trim(targetID) || createFlowerClientRequestID();
  const response = await fetchLocalApiJSONResponse<unknown>(
    '/_redeven_proxy/api/ai/upload-staging-scopes',
    { method: 'POST', body: JSON.stringify({ target_id: resolvedTargetID }) },
  );
  return normalizeFlowerAttachmentStagingScope(
    response.data,
    response.headers.get(flowerStagingCapabilityHeaderName()),
    resolvedTargetID,
  );
}

async function releaseEnvAttachmentStagingScope(scope: FlowerAttachmentStagingScope): Promise<void> {
  const headers = flowerAttachmentStagingHeaders(scope);
  await fetchLocalApiJSON<unknown>(
    `/_redeven_proxy/api/ai/upload-staging-scopes/${encodeURIComponent(scope.staging_scope_id)}`,
    { method: 'DELETE', headers: { 'Upload-Staging-Capability': headers['Upload-Staging-Capability'] } },
  );
}

async function loadEnvStagedAttachmentPreview(
  attachment: FlowerStagedAttachment,
  scope: FlowerAttachmentStagingScope,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(
    `/_redeven_proxy/api/ai/uploads/${encodeURIComponent(trim(attachment.attachment_id))}`,
    await prepareLocalApiRequestInit({
      method: 'GET',
      signal,
      headers: { ...flowerAttachmentStagingHeaders(scope), Accept: '*/*' },
    }),
  );
  if (!response.ok) {
    throw new LocalApiError({
      message: `Attachment preview failed with HTTP ${response.status}.`,
      status: response.status,
      code: 'ATTACHMENT_PREVIEW_FAILED',
    });
  }
  const contentType = trim(response.headers.get('content-type')).toLowerCase();
  const safeType = contentType === 'application/pdf'
    || contentType === 'image/png'
    || contentType === 'image/jpeg'
    || contentType === 'image/gif'
    || contentType === 'image/webp'
    || contentType === 'text/plain'
    || contentType === 'text/plain; charset=utf-8';
  if (!safeType) throw new Error('Flower returned an unsupported attachment preview content type.');
  return response.blob();
}

async function previewEnvStagedAttachment(
  attachment: FlowerStagedAttachment,
  scope: FlowerAttachmentStagingScope,
): Promise<void> {
  const objectURL = URL.createObjectURL(await loadEnvStagedAttachmentPreview(attachment, scope));
  window.open(objectURL, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 60_000);
}

function parseCanonicalReferenceOpenTarget(raw: unknown): FlowerCanonicalReferenceNavigationTarget {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Flower canonical reference open target is invalid.');
  }
  const target = raw as Record<string, unknown>;
  const kind = trim(target.kind);
  const path = trim(target.path);
  if ((kind !== 'file' && kind !== 'directory') || !path || (target.label !== undefined && typeof target.label !== 'string')) {
    throw new Error('Flower canonical reference open target is invalid.');
  }
  return {
    kind,
    label: trim(target.label),
    path,
  };
}

function adapterCopy(options: EnvLocalFlowerSurfaceAdapterOptions): EnvLocalFlowerSurfaceAdapterCopy {
  return {
    currentEnvironment: options.copy?.currentEnvironment ?? 'This environment',
    usingCurrentEnvironment: options.copy?.usingCurrentEnvironment ?? 'Using this environment',
    environmentLocalSubtitle: options.copy?.environmentLocalSubtitle ?? 'Environment-local Flower',
    missingThreadID: options.copy?.missingThreadID ?? 'Missing thread id.',
    enterMessageBeforeSending: options.copy?.enterMessageBeforeSending ?? 'Enter a message before sending.',
    selectModelBeforeChat: options.copy?.selectModelBeforeChat ?? 'Select a Flower model before starting a chat.',
    failedToCreateChat: options.copy?.failedToCreateChat ?? 'Failed to create Flower chat.',
  };
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

function mapDesktopModels(models: ModelsResponse): readonly FlowerModelSourceModel[] {
  const sourceModels = (models.models ?? []).flatMap((model) => {
    const id = trim(model.id);
    if (trim(model.source) !== 'desktop_model_source') {
      if (DESKTOP_MODEL_SOURCE_ID_PATTERN.test(id)) {
        throw new Error('Desktop model catalog contains an invalid model source.');
      }
      return [];
    }
    if (!DESKTOP_MODEL_SOURCE_ID_PATTERN.test(id)) {
      throw new Error('Desktop model catalog contains an invalid opaque model id.');
    }
    const reasoningCapability = normalizeFlowerReasoningCapability(model.reasoning_capability);
    return [{
      id,
      label: trim(model.label) || id,
      ...(positiveInteger(model.context_window) ? { context_window: positiveInteger(model.context_window) } : {}),
      ...(positiveInteger(model.max_output_tokens) ? { max_output_tokens: positiveInteger(model.max_output_tokens) } : {}),
      ...(Array.isArray(model.input_modalities) ? { input_modalities: model.input_modalities.map(trim).filter(Boolean) } : {}),
      ...(reasoningCapability ? { reasoning_capability: reasoningCapability } : {}),
    }];
  });
  if (new Set(sourceModels.map((model) => model.id)).size !== sourceModels.length) {
    throw new Error('Desktop model catalog contains duplicate opaque model ids.');
  }
  return sourceModels;
}

function mapDesktopModelSource(
  settings: AgentSettingsResponse,
  catalog?: DesktopModelCatalogLoad,
): FlowerSettingsSnapshot['model_source'] {
  const source = settings.ai_runtime?.desktop_model_source;
  if (!source || trim(source.binding_state) === 'unsupported') {
    return { kind: 'desktop_model_source', state: 'unsupported', label: 'Desktop' };
  }
  const bindingState = trim(source.binding_state);
  if (bindingState === 'connecting' || bindingState === 'unbound' || bindingState === 'expired') {
    return { kind: 'desktop_model_source', state: bindingState, label: 'Desktop' };
  }
  if (bindingState === 'error') {
    const diagnosticMessage = trim(source.last_error);
    return {
      kind: 'desktop_model_source',
      state: 'error',
      label: 'Desktop',
      ...(diagnosticMessage ? { diagnostic_message: diagnosticMessage } : {}),
    };
  }
  if (bindingState !== 'bound' || source.connected !== true) {
    return {
      kind: 'desktop_model_source',
      state: 'error',
      label: 'Desktop',
      diagnostic_message: 'Desktop model source returned an invalid binding contract.',
    };
  }
  const missingKeyProviderIDs = (source.missing_key_provider_ids ?? []).map(trim).filter(Boolean);
  if (missingKeyProviderIDs.length > 0) {
    return {
      kind: 'desktop_model_source',
      state: 'missing_keys',
      label: 'Desktop',
      missing_key_provider_ids: missingKeyProviderIDs,
    };
  }
  if (catalog?.state === 'failed') {
    return {
      kind: 'desktop_model_source',
      state: 'error',
      label: 'Desktop',
      diagnostic_message: catalog.message,
    };
  }
  if (!catalog) {
    return {
      kind: 'desktop_model_source',
      state: 'error',
      label: 'Desktop',
      diagnostic_message: 'Desktop model catalog was not loaded.',
    };
  }
  try {
    const sourceModels = mapDesktopModels(catalog.response);
    const [firstModel, ...remainingModels] = sourceModels;
    if (!firstModel) {
      return { kind: 'desktop_model_source', state: 'empty', label: 'Desktop' };
    }
    const currentModelCandidate = trim(catalog.response.current_model);
    const currentModel = sourceModels.some((model) => model.id === currentModelCandidate)
      ? currentModelCandidate
      : '';
    return {
      kind: 'desktop_model_source',
      state: 'ready',
      label: 'Desktop',
      models: [firstModel, ...remainingModels],
      ...(currentModel ? { current_model_id: currentModel } : {}),
    };
  } catch (error) {
    return {
      kind: 'desktop_model_source',
      state: 'error',
      label: 'Desktop',
      diagnostic_message: error instanceof Error ? error.message : String(error),
    };
  }
}

function mapSettings(
  settings: AgentSettingsResponse,
  catalog?: DesktopModelCatalogLoad,
  exposeDesktopModelSource = false,
): FlowerSettingsSnapshot {
  const ai = settings.ai;
  const externalModelSource = exposeDesktopModelSource ? mapDesktopModelSource(settings, catalog) : undefined;
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
    ...(externalModelSource ? { model_source: externalModelSource } : {}),
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

function draftToModelProfile(draft: FlowerSettingsDraft): AIModelProfile {
  return {
    current_model_id: trim(draft.model_profile.current_model_id),
    providers: draft.model_profile.providers.map(draftProviderToAI),
  };
}

function envLiveMapperOptions(options: EnvLocalFlowerSurfaceAdapterOptions) {
  const copy = adapterCopy(options);
  const envID = trim(options.envPublicID) || 'current';
  const envLabel = trim(options.envLabel) || copy.currentEnvironment;
  return {
    runtimeID: `env:${envID}`,
    runtimeKind: 'env_local' as const,
    sourceLabel: envLabel,
    targetLabels: [envLabel],
    originEnvPublicID: envID,
  };
}

function decision(options: EnvLocalFlowerSurfaceAdapterOptions): FlowerRouterDecision {
  const copy = adapterCopy(options);
  const envID = trim(options.envPublicID) || 'current';
  const envLabel = trim(options.envLabel) || copy.currentEnvironment;
  const now = Date.now();
  return {
    decision_id: `env-local-${envID}-${now}`,
    decision_revision: 1,
    route: 'env_local',
    reason_code: 'current_env_only',
    selected_handler: {
      handler_id: `env:${envID}`,
      handler_kind: 'env_local',
      display_name: envLabel,
      carrier_kind: 'runtime',
      state: 'online',
      selection_source: 'router_default',
      supports_thread_kinds: ['chat', 'task'],
    },
    available_handlers: [],
    unavailable_handlers: [],
    handler_selection: {
      can_switch: false,
      lock_reason: 'env_local_surface',
      requires_user_visible_confirmation: true,
    },
    decision_scope: {
      thread_kind: 'chat',
      client_surface: 'env_app_flower_surface',
    },
    runtime_presence: {
      schema_version: 1,
      runtime_id: `env:${envID}`,
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: envLabel,
      state: 'online',
      endpoint: { visibility: 'runtime' },
      capabilities: ['chat', 'task'],
      last_seen_at_unix_ms: now,
    },
    allowed_actions: ['start_thread'],
    ui_chips: [
      { kind: 'runtime', label: copy.usingCurrentEnvironment, tone: 'normal' },
      { kind: 'source', label: envLabel, tone: 'normal' },
    ],
    blocker: null,
    created_at_unix_ms: now,
  };
}

async function loadSettingsSnapshot(
  options: EnvLocalFlowerSurfaceAdapterOptions,
  loadCatalog: () => Promise<ModelsResponse> = loadModels,
): Promise<FlowerSettingsSnapshot> {
  const settings = await fetchLocalApiJSON<AgentSettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' });
  const exposeDesktopModelSource = options.desktopSessionTargetRoute === 'remote_desktop';
  const desktopModelSource = settings.ai_runtime?.desktop_model_source;
  let catalog: DesktopModelCatalogLoad | undefined;
  if (
    exposeDesktopModelSource
    && trim(desktopModelSource?.binding_state) === 'bound'
    && desktopModelSource?.connected === true
    && (desktopModelSource.missing_key_provider_ids ?? []).length === 0
  ) {
    try {
      catalog = { state: 'loaded', response: await loadDesktopModelCatalog(loadCatalog) };
    } catch (error) {
      catalog = { state: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  }
  return mapSettings(settings, catalog, exposeDesktopModelSource);
}

async function loadModels(): Promise<ModelsResponse> {
  return fetchLocalApiJSON<ModelsResponse>('/_redeven_proxy/api/ai/models', { method: 'GET' });
}

async function loadDesktopModelCatalog(loadCatalog: () => Promise<unknown> = loadModels): Promise<ModelsResponse> {
  const raw = await loadCatalog();
  if (!raw || typeof raw !== 'object') {
    throw new Error('Desktop model catalog response is invalid.');
  }
  const candidate = raw as ModelsResponse;
  if (!Array.isArray(candidate.models) || candidate.models.some((model) => !model || typeof model !== 'object')) {
    throw new Error('Desktop model catalog response is invalid.');
  }
  return candidate;
}

function currentModelID(snapshot: FlowerSettingsSnapshot, models: ModelsResponse): string {
  const configured = trim(snapshot.model_profile?.current_model_id);
  if (configured) return configured;
  return trim(models.current_model);
}

function profileContainsModel(snapshot: FlowerSettingsSnapshot, modelID: string): boolean {
  const mid = trim(modelID);
  return snapshot.model_profile?.providers.some((provider) => (
    provider.models.some((model) => `${trim(provider.id)}/${trim(model.model_name)}` === mid)
  )) ?? false;
}

export function createEnvLocalFlowerSurfaceAdapter(options: EnvLocalFlowerSurfaceAdapterOptions): FlowerSurfaceAdapter {
  const copy = adapterCopy(options);
  const openCanonicalReferenceTarget = options.openCanonicalReferenceTarget;
  const openCanonicalReference = openCanonicalReferenceTarget
    ? async (request: FlowerCanonicalReferenceOpenRequest): Promise<void> => {
        const threadID = trim(request.thread_id);
        const turnID = trim(request.turn_id);
        const referenceID = trim(request.reference_id);
        if (!threadID) throw new Error(copy.missingThreadID);
        if (!turnID) throw new Error('Missing Flower turn id.');
        if (!referenceID) throw new Error('Missing Flower reference id.');
        const target = parseCanonicalReferenceOpenTarget(await fetchLocalApiJSON<unknown>(
          `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/reference-open-target`,
          {
            method: 'POST',
            body: JSON.stringify({
              turn_id: turnID,
              reference_id: referenceID,
            }),
          },
        ));
        await openCanonicalReferenceTarget(target);
      }
    : undefined;

  const cacheTTLMS = 5_000;
  let settingsRevision = 0;
  let modelsRevision = 0;
  let settingsCache: Readonly<{ value: FlowerSettingsSnapshot; expiresAtMS: number }> | null = null;
  let modelsCache: Readonly<{ value: ModelsResponse; expiresAtMS: number }> | null = null;
  let settingsRequest: Promise<FlowerSettingsSnapshot> | null = null;
  let modelsRequest: Promise<ModelsResponse> | null = null;
  const loadCachedModels = (): Promise<ModelsResponse> => {
    const now = Date.now();
    if (modelsCache && modelsCache.expiresAtMS > now) return Promise.resolve(modelsCache.value);
    if (modelsRequest) return modelsRequest;
    const revision = modelsRevision;
    const request = loadModels().then((value) => {
      if (revision === modelsRevision) modelsCache = { value, expiresAtMS: Date.now() + cacheTTLMS };
      return value;
    }).finally(() => {
      if (modelsRequest === request) modelsRequest = null;
    });
    modelsRequest = request;
    return request;
  };
  const loadCachedSettings = (): Promise<FlowerSettingsSnapshot> => {
    const now = Date.now();
    if (settingsCache && settingsCache.expiresAtMS > now) return Promise.resolve(settingsCache.value);
    if (settingsRequest) return settingsRequest;
    const revision = settingsRevision;
    const request = loadSettingsSnapshot(options, loadCachedModels).then((value) => {
      if (revision === settingsRevision) settingsCache = { value, expiresAtMS: Date.now() + cacheTTLMS };
      return value;
    }).finally(() => {
      if (settingsRequest === request) settingsRequest = null;
    });
    settingsRequest = request;
    return request;
  };
  const invalidateSettingsCache = () => {
    settingsRevision += 1;
    modelsRevision += 1;
    settingsCache = null;
    modelsCache = null;
    settingsRequest = null;
    modelsRequest = null;
  };

  return createRuntimeFlowerSurfaceAdapter({
    runtime: {
      runtime_id: `env:${trim(options.envPublicID) || 'current'}`,
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: trim(options.envLabel) || copy.currentEnvironment,
      subtitle: copy.environmentLocalSubtitle,
    },
    canMutate: options.canMutate !== false,
    transport: {
      listThreads: () => fetchLocalApiJSON('/_redeven_proxy/api/ai/threads?limit=200', { method: 'GET' }),
      loadThread: (threadID) => fetchLocalApiJSON<unknown>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}`, { method: 'GET' }),
      connectLiveStream: async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<unknown> {
        // Workspace SSE owns observation for every thread. Selection and
        // recovery are client cache concerns; never send replay cursors.
        const params = new URLSearchParams();
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
          const init = await prepareLocalApiRequestInit({ method: 'GET', signal: streamController.signal });
          for await (const frame of fetchServerSentEvents(`/_redeven_proxy/api/ai/flower/stream?${params.toString()}`, {
            ...init,
            signal: streamController.signal,
            onActivity: resetActivityTimer,
          })) {
            yield JSON.parse(frame.data) as unknown;
          }
        } finally {
          input.signal.removeEventListener('abort', abort);
          if (activityTimer !== undefined) clearTimeout(activityTimer);
          streamController.abort();
        }
      },
      loadSubagentDetail: (parentThreadID, childThreadID, afterOrdinal, limit) => fetchLocalApiJSON(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(parentThreadID)}/subagents/${encodeURIComponent(childThreadID)}/detail?after_ordinal=${afterOrdinal}&limit=${limit}`,
        { method: 'GET' },
      ),
      readTerminalProcess: (runID, processID, input) => {
        const params = new URLSearchParams();
        params.set('after_seq', String(input.after_seq));
        return fetchLocalApiJSON<FlowerTerminalProcessSnapshot>(
          `/_redeven_proxy/api/ai/runs/${encodeURIComponent(runID)}/terminal/${encodeURIComponent(processID)}/read?${params.toString()}`,
          { method: 'GET' },
        );
      },
      markThreadRead: (threadID, body) => fetchLocalApiJSON<MarkThreadReadResponse>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/read`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      patchThread: (threadID, body) => fetchLocalApiJSON<LoadThreadResponse>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
      reorderQueuedTurns: (threadID, orderedQueueIDs) => fetchLocalApiJSON(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/followups/order`,
        {
          method: 'PATCH',
          body: JSON.stringify({ lane: 'queued', ordered_followup_ids: orderedQueueIDs }),
        },
      ),
      deleteQueuedTurn: (threadID, queueID) => fetchLocalApiJSON(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/followups/${encodeURIComponent(queueID)}`,
        { method: 'DELETE' },
      ),
      promoteQueuedTurn: (threadID, queueID) => fetchLocalApiJSON(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/followups/${encodeURIComponent(queueID)}/promote`,
        { method: 'POST' },
      ),
      forkThread: (threadID, body) => fetchLocalApiJSON<LoadThreadResponse>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/fork`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      deleteThread: async (threadID) => {
        try {
          return {
            kind: 'success' as const,
            receipt: await fetchLocalApiJSON<unknown>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}?force=true`, {
              method: 'DELETE',
            }),
          };
        } catch (error) {
          if (error instanceof LocalApiError && error.code === FLOWER_THREAD_DELETE_OPERATION_FAILED_CODE) {
            return { kind: 'terminal_failure' as const, receipt: error.data };
          }
          throw error;
        }
      },
      submitApproval: (body) => fetchLocalApiJSON<FlowerApprovalCommandResult>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(body.thread_id)}/approvals`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      retryEffect: (body) => fetchLocalApiJSON(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(body.thread_id)}/retry_effect`, {
        method: 'POST',
        body: JSON.stringify({
          effect_attempt_id: body.effect_attempt_id,
          tool_call_id: body.tool_call_id,
          acknowledge_unknown_risk: true,
        }),
      }),
    },
    mapperOptions: envLiveMapperOptions(options),
    loadSettings: loadCachedSettings,
    saveDefaultPermission: async (permissionType) => {
      await fetchLocalApiJSON<unknown>('/_redeven_proxy/api/ai/default_permission', {
        method: 'PUT',
        body: JSON.stringify({ permission_type: normalizePermissionType(permissionType) }),
      });
      invalidateSettingsCache();
      return loadCachedSettings();
    },
    saveModelProfile: async (draft) => {
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
      await fetchLocalApiJSON<unknown>('/_redeven_proxy/api/ai/provider_bundle', {
        method: 'PUT',
        body: JSON.stringify({
          model_profile: draftToModelProfile(draft),
          provider_api_key_patches: providerAPIKeyPatches,
          web_search_provider_key_patches: webSearchKeyPatches,
        }),
      });
      invalidateSettingsCache();
      return loadCachedSettings();
    },
    persistDefaultModel: async (modelID) => {
      const mid = trim(modelID);
      if (!mid) throw new Error('Missing model id.');
      const current = await loadCachedSettings();
      if (!profileContainsModel(current, mid)) throw new Error('Model is not part of the environment profile.');
      await fetchLocalApiJSON<ModelsResponse>('/_redeven_proxy/api/ai/current_model', {
        method: 'PUT',
        body: JSON.stringify({ model_id: mid }),
      });
      invalidateSettingsCache();
      const snapshot = await loadCachedSettings();
      if (options.onSettingsChanged) void Promise.resolve(options.onSettingsChanged()).catch(() => undefined);
      return snapshot;
    },
    getWorkingDirectoryPathContext: () => options.rpc.fs.getPathContext(),
    listWorkingDirectoryEntries: async (input) => {
      const response = await options.rpc.fs.list({
        path: trim(input.path),
        showHidden: input.showHidden === true,
      });
      return response.entries;
    },
    resolveHandler: async () => decision(options),
    loadAttachmentCapability: async (modelID): Promise<FlowerAttachmentCapability> => {
      const capability = normalizeFlowerAttachmentCapability(await fetchLocalApiJSON<unknown>(
        `/_redeven_proxy/api/ai/attachments/capabilities?model_id=${encodeURIComponent(trim(modelID))}`,
        { method: 'GET' },
      ));
      if (capability.model_id !== trim(modelID)) throw new Error('Flower attachment capability returned a different model identity.');
      return capability;
    },
    createAttachmentStagingScope: createEnvAttachmentStagingScope,
    releaseAttachmentStagingScope: releaseEnvAttachmentStagingScope,
    uploadAttachment: options.uploadAttachment ?? uploadEnvLocalFlowerAttachment,
    deleteStagedAttachment: async (attachmentID, scope) => {
      await fetchLocalApiJSON<unknown>(
        `/_redeven_proxy/api/ai/uploads/${encodeURIComponent(trim(attachmentID))}`,
        { method: 'DELETE', headers: flowerAttachmentStagingHeaders(scope) },
      );
    },
    readStagedLongText: async (attachment, scope) => mapEnvStagedLongText(
      await fetchLocalApiJSON<unknown>(
        `/_redeven_proxy/api/ai/uploads/${encodeURIComponent(trim(attachment.attachment_id))}/long_text`,
        { method: 'GET', headers: flowerAttachmentStagingHeaders(scope) },
      ),
      attachment,
    ),
    loadStagedAttachmentPreview: (attachment, scope, signal) => loadEnvStagedAttachmentPreview(attachment, scope, signal),
    previewStagedAttachment: previewEnvStagedAttachment,
    launchTurn: async (input: FlowerTurnLaunchInput) => {
      const copy = adapterCopy(options);
      const prompt = input.prompt;
      const attachmentIDs = (input.attachment_ids ?? []).map(trim).filter(Boolean);
      const contextAction = requireAskFlowerContextActionEnvelope(input.context_action);
      if (!prompt.trim() && attachmentIDs.length === 0 && !contextAction) throw new Error(copy.enterMessageBeforeSending);
      const existingThreadID = trim(input.thread_id);
      const [snapshot, models] = await Promise.all([
        existingThreadID ? Promise.resolve<FlowerSettingsSnapshot | null>(null) : loadCachedSettings(),
        existingThreadID ? Promise.resolve<ModelsResponse | null>(null) : loadCachedModels(),
      ]);
      const permissionType = snapshot || trim(input.permission_type)
        ? normalizePermissionType(input.permission_type ?? snapshot?.defaults.permission_type)
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
      let turnModelID = trim(input.model_id);
      let createBody: Record<string, unknown> | undefined;
      if (!existingThreadID) {
        if (!models) throw new Error('Flower model catalog is unavailable.');
        turnModelID = turnModelID || currentModelID(snapshot!, models);
        if (!turnModelID) throw new Error(copy.selectModelBeforeChat);
        createBody = {
          client_request_id: clientRequestID,
          title: '',
          model_id: turnModelID,
          permission_type: permissionType,
        };
        const reasoningSelection = serializeFlowerReasoningSelection(input.reasoning_selection);
        if (reasoningSelection) {
          createBody.reasoning_selection = reasoningSelection;
        }
        if (trim(input.working_dir)) {
          createBody.working_dir = trim(input.working_dir);
        }
      }
      const stagingHeaders = stagingScope ? flowerAttachmentStagingHeaders(stagingScope) : undefined;
        const endpoint = existingThreadID
          ? `/_redeven_proxy/api/ai/threads/${encodeURIComponent(existingThreadID)}/turns`
          : '/_redeven_proxy/api/ai/turns';
        const response = await fetchLocalApiJSON<SendTurnResponse>(
          endpoint,
          {
            method: 'POST',
            ...(stagingHeaders ? { headers: stagingHeaders } : {}),
            body: JSON.stringify({
              client_request_id: clientRequestID,
              ...(existingThreadID ? { thread_id: existingThreadID } : {}),
              ...(stagingScope ? { staging_scope_id: stagingScope.staging_scope_id } : {}),
              ...(turnModelID ? { model: turnModelID } : {}),
              input: {
                text: prompt,
                attachments: attachmentIDs.map((attachmentID) => ({ attachment_id: attachmentID })),
                ...(contextAction ? { context_action: contextAction } : {}),
              },
              options: {
                ...(permissionType ? { permission_type: permissionType } : {}),
                ...(serializeFlowerReasoningSelection(input.reasoning_selection) ? { reasoning_selection: serializeFlowerReasoningSelection(input.reasoning_selection) } : {}),
              },
              ...(createBody ? { create: createBody } : {}),
            }),
          },
        );
        const responseClientRequestID = trim(response.client_request_id);
        const responseThreadID = trim(response.thread_id) || existingThreadID;
        const current = response.current;
        const currentValid = Boolean(
          current
          && trim(current.thread_id) === responseThreadID
          && Number.isFinite(Number(current.view_version))
          && Number(current.view_version) > 0,
        );
        const clientIdentityValid = existingThreadID
          ? !responseClientRequestID || responseClientRequestID === clientRequestID
          : responseClientRequestID === clientRequestID;
        if (!responseThreadID || !clientIdentityValid || !currentValid) {
          throw new Error('Flower send returned an invalid current view.');
        }
      return { client_request_id: clientRequestID, thread_id: responseThreadID, current: current! };
    },
    retryThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(adapterCopy(options).missingThreadID);
      await fetchLocalApiJSON(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/retry`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
    stopThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(adapterCopy(options).missingThreadID);
      await options.rpc.ai.stopThread({ threadId: tid });
    },
    submitInput: async (input) => {
      const tid = trim(input.thread_id);
      const promptID = trim(input.prompt_id);
      if (!tid) throw new Error(adapterCopy(options).missingThreadID);
      if (!promptID) throw new Error('Missing input prompt id.');
      const reasoningSelection = serializeFlowerReasoningSelection(input.reasoning_selection);
      const response = await fetchLocalApiJSON<SubmitInputResponse>(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/input_response`,
        {
          method: 'POST',
          body: JSON.stringify({
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
              ...(reasoningSelection ? { reasoning_selection: reasoningSelection } : {}),
            },
          }),
        },
      );
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
    missingThreadID: copy.missingThreadID,
    failedToCreateThread: copy.failedToCreateChat,
    ...(options.openFileBrowser ? { openFileBrowser: options.openFileBrowser } : {}),
    ...(options.openFilePreview ? { openFilePreview: options.openFilePreview } : {}),
    ...(openCanonicalReference ? { openCanonicalReference } : {}),
    ...(options.openLinkedFilePreview ? { openLinkedFilePreview: options.openLinkedFilePreview } : {}),
    ...(options.openLinkedDirectoryBrowser ? { openLinkedDirectoryBrowser: options.openLinkedDirectoryBrowser } : {}),
    ...(options.modelSourceRecovery ? { modelSourceRecovery: options.modelSourceRecovery } : {}),
  });
}
