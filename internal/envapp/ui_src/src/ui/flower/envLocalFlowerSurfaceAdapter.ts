import { flowerExtensionsAdapter } from '../../../../../flower_ui/host/extensionsAdapter';
import { computerManagementAdapter } from '../../../../../flower_ui/host/computerUseAdapter';
import { computerFramePath } from '../../../../../flower_ui/host/computerFramePath';
import { messageFilePath } from '../../../../../flower_ui/host/messageFilePath';
import { COMPUTER_FRAME_RATE_KEY, computerFrameRate } from '../../../../../flower_ui/src/computerViewer';
import type { FlowerComputerFrameSource } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { readUIStorageItem, writeUIStorageItem } from '../services/uiStorage';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createFlowerModelReadResource, readFlowerModelDirectory, withFlowerModelDirectory, type FlowerModelReadResource } from '../../../../../flower_ui/src/modelDirectory';
import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import { readSessionEvents } from '../services/sessionHTTP';
import {
  fetchLocalApiJSON,
  fetchLocalApiJSONResponse,
  LocalApiError,
  prepareLocalApiRequestInit,
  uploadLocalApiAttachment,
} from '../services/localApi';
import type { AgentSettingsResponse, AIConfig, AIModelProfile } from '../pages/settings/types';
import { updateDefaultAIPermission } from '../services/aiDefaultPermission';
import type {
  FlowerApprovalCommandResult,
  FlowerAttachmentUploadInput,
  FlowerAttachmentCapability,
  FlowerAttachmentStagingScope,
  FlowerCanonicalReferenceOpenRequest,
  FlowerProvider,
  FlowerProviderModel,
  FlowerPermissionType,
  FlowerRouterDecision,
  FlowerTurnLaunchInput,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerModelDirectory,
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
  type RuntimeThreadPatchResponse,
} from '../../../../../flower_ui/src/runtimeFlowerSurfaceAdapter';
import {
  createFlowerClientRequestID,
} from '../../../../../flower_ui/src/flowerRequestIdentity';
import {
  buildFlowerTurnHTTPBody,
  flowerTurnAdmissionError,
  normalizeFlowerTurnLaunchReceipt,
  type FlowerTurnHTTPResponse,
} from '../../../../../flower_ui/src/flowerTurnAdmission';
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
  revealHostApplication?: (applicationID: string) => void;
  envLabel: string;
  desktopSessionTargetRoute?: 'local_host' | 'remote_desktop';
  rpc: RedevenV1Rpc;
  canMutate?: boolean;
  canManageExtensions?: () => boolean;
  settingsRevision?: () => number;
  modelReadResource?: FlowerModelReadResource;
  isAvailable?: () => boolean;
  copy?: EnvLocalFlowerSurfaceAdapterCopy;
  onSettingsChanged?: () => void | Promise<unknown>;
  uploadAttachment?: FlowerSurfaceAdapter['uploadAttachment'];
  openMessageFile?: FlowerSurfaceAdapter['openMessageFile'];
  openFileBrowser?: FlowerSurfaceAdapter['openFileBrowser'];
  openFilePreview?: FlowerSurfaceAdapter['openFilePreview'];
  openCanonicalReferenceTarget?: (target: FlowerCanonicalReferenceNavigationTarget) => Promise<void>;
  openLinkedFilePreview?: FlowerSurfaceAdapter['openLinkedFilePreview'];
  openWorkingDirectoryInFileBrowser?: FlowerSurfaceAdapter['openWorkingDirectoryInFileBrowser'];
  openWorkingDirectoryInTerminal?: FlowerSurfaceAdapter['openWorkingDirectoryInTerminal'];
  workingDirectoryActionAvailability?: FlowerSurfaceAdapter['workingDirectoryActionAvailability'];
  openLinkedDirectoryBrowser?: FlowerSurfaceAdapter['openLinkedDirectoryBrowser'];
  retryModelSource?: () => Promise<void>;
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

type ThreadView = Readonly<{
  thread_id?: string;
  read_status: ThreadReadStatus;
} & Record<string, unknown>>;

type ThreadReadStatus = FlowerThreadReadStatus;

type LoadThreadResponse = Readonly<{
  client_request_id?: string;
  thread?: ThreadView;
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

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  return bytesToHex(sha256(view));
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

async function loadEnvComputerFrame(input: FlowerComputerFrameSource & Readonly<{ signal: AbortSignal }>): Promise<Blob> {
  const init = await prepareLocalApiRequestInit({ method: 'GET', signal: input.signal });
  const response = await fetch(
    computerFramePath(input),
    init,
  );
  if (!response.ok) throw new LocalApiError({ message: 'Computer frame is unavailable.', status: response.status });
  const body = await response.blob();
  if (!body.type.startsWith('image/')) throw new Error('Computer frame returned an unsupported media type.');
  return body;
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
    id: trim(provider.id),
    ...(trim(provider.name) ? { name: trim(provider.name) } : {}),
    type: provider.type,
    ...(trim(provider.base_url) ? { base_url: trim(provider.base_url) } : {}),
    ...(provider.web_search ? { web_search: { mode: provider.web_search.mode ?? 'disabled' } } : {}),
    model_selection: provider.model_selection,
    models: (provider.models ?? []).map(mapProviderModel).filter((model) => model.model_name),
  };
}

export function mapEnvFlowerSettings(settings: AgentSettingsResponse): FlowerSettingsSnapshot {
  const ai = settings.ai;
  const modelProfile = ai && (ai.providers ?? []).length > 0 && trim(ai.current_model_id)
    ? {
        schema_version: 1 as const,
        current_model_id: trim(ai.current_model_id),
        providers: (ai.providers ?? []).map(mapProvider).filter((provider) => provider.id),
      }
    : null;
  const providerSecrets = settings.ai_secrets?.provider_api_key_set ?? {};
  const webSecrets = settings.ai_secrets?.web_search_provider_api_key_set ?? {};
  return {
    defaults: {
      permission_type: normalizePermissionType(ai?.permission_type),
      computer_use_enabled: ai?.computer_use_enabled !== false,
    },
    model_profile: modelProfile,
    provider_secrets: (modelProfile?.providers ?? []).map((provider) => ({
      provider_id: provider.id,
      provider_api_key_configured: Boolean(providerSecrets[provider.id]),
      web_search_api_key_configured: Boolean(webSecrets[provider.id]),
    })),
  };
}

async function draftToModelProfile(draft: FlowerSettingsDraft): Promise<AIModelProfile> {
  const { serializeFlowerProvider } = await import('../../../../../flower_ui/src/settings/modelSelection');
  return {
    current_model_id: trim(draft.model_profile.current_model_id),
    providers: draft.model_profile.providers.map((provider) => serializeFlowerProvider(provider) as NonNullable<AIConfig['providers']>[number]),
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

export function createEnvFlowerModelReadResource(scope: () => string): FlowerModelReadResource {
  return createFlowerModelReadResource({
    scope,
    loadConfiguration: async () => mapEnvFlowerSettings(await fetchLocalApiJSON<AgentSettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET', signal: AbortSignal.timeout(6_000) })),
    loadDirectory: async baseline => readFlowerModelDirectory(await fetchLocalApiJSON('/_redeven_proxy/api/ai/models' + (baseline ? '?mode=baseline' : ''), { method: 'GET', signal: AbortSignal.timeout(6_000) })),
  });
}

function visibleDirectory(directory: FlowerModelDirectory, exposeDesktop: boolean): FlowerModelDirectory {
  if (exposeDesktop) return directory;
  return { ...directory, current_model_id: directory.current_model_id.startsWith('desktop:') ? '' : directory.current_model_id,
    models: directory.models.filter(model => model.source !== 'desktop_model_source'),
    sources: directory.sources.filter(source => source.kind !== 'desktop_model_source'),
  };
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

  const resource = options.modelReadResource ?? createEnvFlowerModelReadResource(() => String(options.settingsRevision?.() ?? 0));
  const directoryForSurface = (directory: FlowerModelDirectory) => visibleDirectory(directory, options.desktopSessionTargetRoute === 'remote_desktop');
  const loadSettings = async () => {
    const snapshot = await resource.loadSettings();
    if (options.isAvailable?.() === false) throw new DOMException('Flower settings load cancelled.', 'AbortError');
    return withFlowerModelDirectory(snapshot, directoryForSurface(snapshot.model_directory!));
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
        for await (const frame of readSessionEvents('/_redeven_proxy/api/ai/flower/stream', {
          method: 'GET', signal: input.signal,
        })) {
          yield JSON.parse(frame.data) as unknown;
        }
      },
      loadSubagentDetail: (parentThreadID, childThreadID) => fetchLocalApiJSON(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(parentThreadID)}/subagents/${encodeURIComponent(childThreadID)}/detail`,
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
      patchThread: (threadID, body) => fetchLocalApiJSON<RuntimeThreadPatchResponse>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
      movePinnedThread: (threadID, input) => fetchLocalApiJSON(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/pin-position`,
        { method: 'PATCH', body: JSON.stringify(input) },
      ),
      reorderQueuedTurns: (threadID, orderedQueueIDs) => fetchLocalApiJSON(
		`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/queue/order`,
        {
          method: 'PATCH',
		  body: JSON.stringify({ ordered_queue_ids: orderedQueueIDs }),
        },
      ),
      deleteQueuedTurn: (threadID, queueID) => fetchLocalApiJSON(
		`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/queue/${encodeURIComponent(queueID)}`,
        { method: 'DELETE' },
      ),
      promoteQueuedTurn: (threadID, queueID) => fetchLocalApiJSON(
		`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/queue/${encodeURIComponent(queueID)}/promote`,
        { method: 'POST' },
      ),
      forkThread: (threadID, body) => fetchLocalApiJSON<LoadThreadResponse>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/fork`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      deleteThread: async (threadID) => {
        await fetchLocalApiJSON<unknown>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}?force=true`, {
          method: 'DELETE',
        });
      },
      submitApproval: (body) => fetchLocalApiJSON<FlowerApprovalCommandResult>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(body.thread_id)}/approvals`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    },
    mapperOptions: envLiveMapperOptions(options),
    extensions: flowerExtensionsAdapter((method, path, body) => fetchLocalApiJSON(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { canInteract: () => options.isAvailable?.() ?? true, canAdmin: () => options.canManageExtensions?.() ?? false }),
    loadSettings,
    loadModelDirectory: async refresh => directoryForSurface(await resource.loadDirectory(refresh)),
    subscribeModelDirectory: listener => resource.subscribe(directory => listener(directoryForSurface(directory))),
    discoverProviderModels: (input) => fetchLocalApiJSON('/_redeven_proxy/api/ai/model_catalog', { method: 'POST', body: JSON.stringify(input) }),
    saveDefaultPermission: async (permissionType) => {
      await updateDefaultAIPermission(normalizePermissionType(permissionType));
      resource.invalidate();
      const snapshot = await loadSettings();
      if (options.onSettingsChanged) void Promise.resolve(options.onSettingsChanged()).catch(() => undefined);
      return snapshot;
    },
    computerManagement: { ...computerManagementAdapter((method, path, body, signal) => fetchLocalApiJSON(path, { method, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), `environment:${options.envPublicID}`, options.revealHostApplication) },
    saveComputerUseEnabled: async (enabled) => {
      await fetchLocalApiJSON<unknown>('/_redeven_proxy/api/ai/computer_use', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      resource.invalidate();
      const snapshot = await loadSettings();
      if (options.onSettingsChanged) void Promise.resolve(options.onSettingsChanged()).catch(() => undefined);
      return snapshot;
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
          model_profile: await draftToModelProfile(draft),
          provider_api_key_patches: providerAPIKeyPatches,
          web_search_provider_key_patches: webSearchKeyPatches,
        }),
      });
      resource.invalidate();
      return loadSettings();
    },
    persistDefaultModel: async (modelID) => {
      const mid = trim(modelID);
      if (!mid) throw new Error('Missing model id.');
      if (mid.startsWith('desktop:')) throw new Error('Model is not part of the environment profile.');
      await fetchLocalApiJSON<unknown>('/_redeven_proxy/api/ai/current_model', {
        method: 'PUT',
        body: JSON.stringify({ model_id: mid }),
      });
      resource.invalidate();
      const snapshot = await loadSettings();
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
    loadComputerFrame: loadEnvComputerFrame,
    loadMessageFile: async ({ path, signal }) => {
      const response = await fetch(messageFilePath(path), await prepareLocalApiRequestInit({ method: 'GET', signal }));
      if (!response.ok) throw new Error('File preview is unavailable.');
      return response.blob();
    },
    computerFrameRate: {
      read: () => computerFrameRate(readUIStorageItem(COMPUTER_FRAME_RATE_KEY)),
      write: (fps) => writeUIStorageItem(COMPUTER_FRAME_RATE_KEY, String(fps)),
    },
    inputComputerControl: async (input) => {
      await fetchLocalApiJSON('/_redeven_proxy/api/ai/computer/input', { method: 'POST', body: JSON.stringify(input) });
    },
    setComputerViewer: async (input) => { await fetchLocalApiJSON('/_redeven_proxy/api/ai/computer/view', { method: 'PUT', body: JSON.stringify(input) }); },
    resolveStorageGeneration: async () => {
      const result = await fetchLocalApiJSON<{ storage_generation: string }>('/_redeven_proxy/api/ai/storage-generation', { method: 'GET' });
      if (typeof result.storage_generation !== 'string' || (result.storage_generation && !/^[a-f0-9]{32}$/u.test(result.storage_generation))) throw new Error('Invalid Flower storage generation.');
      return result.storage_generation;
    },
    launchTurn: async (input: FlowerTurnLaunchInput) => {
      const copy = adapterCopy(options);
      const prompt = input.prompt;
      const attachmentIDs = (input.attachment_ids ?? []).map(trim).filter(Boolean);
      const contextAction = requireAskFlowerContextActionEnvelope(input.context_action);
      if (!prompt.trim() && attachmentIDs.length === 0 && !contextAction) throw new Error(copy.enterMessageBeforeSending);
      const existingThreadID = trim(input.thread_id);
      const snapshot = !existingThreadID && !trim(input.model_id) ? await loadSettings() : null;
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
      let turnModelID = trim(input.model_id);
      if (!existingThreadID) {
        turnModelID = turnModelID || trim(snapshot?.model_directory?.current_model_id) || trim(snapshot?.model_profile?.current_model_id);
        if (!turnModelID) throw new Error(copy.selectModelBeforeChat);
      }
      const stagingHeaders = stagingScope ? flowerAttachmentStagingHeaders(stagingScope) : undefined;
      const requestBody = buildFlowerTurnHTTPBody({
        launch: input,
        modelID: turnModelID,
        permissionType,
        contextAction,
        attachmentIDs,
        reasoningSelection: serializeFlowerReasoningSelection(input.reasoning_selection),
      });
      let response: FlowerTurnHTTPResponse;
      try {
        response = await fetchLocalApiJSON<FlowerTurnHTTPResponse>(
          existingThreadID
            ? `/_redeven_proxy/api/ai/threads/${encodeURIComponent(existingThreadID)}/turns`
            : '/_redeven_proxy/api/ai/turns',
          {
            method: 'POST',
            ...(stagingHeaders ? { headers: stagingHeaders } : {}),
            body: JSON.stringify(requestBody),
          },
        );
      } catch (error) {
        if (error instanceof LocalApiError) {
          const responseWasUnusable = error.code === 'INVALID_JSON_RESPONSE'
            && error.status >= 200
            && error.status < 300;
          throw flowerTurnAdmissionError(responseWasUnusable ? 'unknown' : 'rejected', error);
        }
        throw flowerTurnAdmissionError('unknown', error, 'Flower response was not received.');
      }
      return normalizeFlowerTurnLaunchReceipt(response, { clientRequestID, existingThreadID });
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
      await fetchLocalApiJSON<{ ok: boolean }>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/cancel`, {
        method: 'POST',
      });
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
    ...(options.openMessageFile ? { openMessageFile: options.openMessageFile } : {}),
    ...(options.openFileBrowser ? { openFileBrowser: options.openFileBrowser } : {}),
    ...(options.openFilePreview ? { openFilePreview: options.openFilePreview } : {}),
    ...(openCanonicalReference ? { openCanonicalReference } : {}),
    ...(options.openLinkedFilePreview ? { openLinkedFilePreview: options.openLinkedFilePreview } : {}),
    ...(options.openWorkingDirectoryInFileBrowser ? { openWorkingDirectoryInFileBrowser: options.openWorkingDirectoryInFileBrowser } : {}),
    ...(options.openWorkingDirectoryInTerminal ? { openWorkingDirectoryInTerminal: options.openWorkingDirectoryInTerminal } : {}),
    ...(options.workingDirectoryActionAvailability ? { workingDirectoryActionAvailability: options.workingDirectoryActionAvailability } : {}),
    ...(options.openLinkedDirectoryBrowser ? { openLinkedDirectoryBrowser: options.openLinkedDirectoryBrowser } : {}),
    retryModelSource: async () => {
      resource.invalidate();
      try {
        await options.retryModelSource?.();
      } finally {
        // Recovery can overlap an existing refresh; discard every pre-recovery result.
        resource.invalidate();
      }
    },
    ...(options.modelSourceRecovery ? { modelSourceRecovery: options.modelSourceRecovery } : {}),
  });
}
