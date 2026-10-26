import type { FlowerTaskFiles } from "./contracts/flowerSurfaceContracts";
import { flowerTurnAdmissionError } from './flowerTurnAdmission';
import { isComputerSafetyAssistanceKind } from './computerAssistance';
import type { FlowerModelCatalogDiscovery } from './contracts/flowerSurfaceContracts';
import type {
  FlowerApprovalCommandResult,
  FlowerCanonicalReferenceOpenRequest,
  FlowerForkThreadInput,
  FlowerLinkedContextPathOpenRequest,
  FlowerModelSourceRecovery,
  FlowerPermissionType,
  FlowerReasoningSelection,
  FlowerResolveHandlerInput,
  FlowerRouterDecision,
  FlowerTurnLaunchInput,
  FlowerTurnLaunchReceipt,
  FlowerWorkingDirectoryEntry,
  FlowerWorkingDirectoryListInput,
  FlowerWorkingDirectoryPathContext,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSubagentDetail,
  FlowerSubagentInputOperation,
  FlowerSubmitApprovalRequest,
  FlowerSubmitInputRequest,
  FlowerSurfaceAdapter,
  FlowerQueuedTurnEditInput,
  FlowerQueuedDraft,
  FlowerQueuedDraftInput,
  FlowerSubmitInputReceipt,
  FlowerSurfaceRuntimeDescriptor,
  FlowerTerminalProcessSnapshot,
  FlowerToolPreview,
  FlowerToolPreviewRequest,
  FlowerThreadActivitySnapshot,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot, FlowerThreadSummary,
  FlowerThreadView,
  FlowerThreadPinMetadata,
  FlowerThreadPinPosition,
  FlowerLiveStreamConnectInput,
  FlowerLiveStreamEnvelope,
  FlowerHistoryRequest, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerRuntimeUpdate, FlowerParentEventQuery, FlowerParentEventPage,
} from './contracts/flowerSurfaceContracts';
import {
  mapFlowerContextCompactions,
  mapFlowerReadStatus,
  mapFlowerSubagents,
  mapFlowerThread, mapFlowerThreadSummary,
  mapFlowerTimelineDecorations,
  mapContextUsage,
  mapModelContext,
  type FlowerLiveThreadMapperOptions,
} from './flowerLiveMapper';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';
import { assembleFlowerLiveEnvelopes, type FlowerLiveTransportFrame } from './flowerLiveWire';

export type RuntimeThreadPinMetadata = Readonly<{
  thread_id: string;
  pinned_at_unix_ms: number;
  pin_rank: number;
  settings_revision: number;
}>;

function mapThreadPinMetadata(value: unknown): FlowerThreadPinMetadata {
  const pin = value as RuntimeThreadPinMetadata | undefined;
  if (!pin || typeof pin.thread_id !== 'string' || !pin.thread_id.trim()
    || ![pin.pinned_at_unix_ms, pin.pin_rank, pin.settings_revision].every((number) => Number.isSafeInteger(number) && number >= 0)) {
    throw new Error('Invalid pinned conversation metadata.');
  }
  return { thread_id: pin.thread_id, pinned_at_ms: pin.pinned_at_unix_ms, pin_rank: pin.pin_rank, settings_revision: pin.settings_revision };
}

type ThreadView = Readonly<{
  thread_id?: string;
  read_status: FlowerThreadReadStatus;
} & Record<string, unknown>>;

type ListThreadsResponse = Readonly<{
  threads?: readonly ThreadView[];
  next_cursor?: string;
}>;

type LoadThreadResponse = Readonly<{
  client_request_id?: string;
  thread?: ThreadView;
  current?: FlowerRuntimeCurrentView;
}>;

type MarkThreadReadResponse = Readonly<{
  read_status: FlowerThreadReadStatus;
}>;

type LoadSubagentDetailResponse = Readonly<{
  detail?: FlowerSubagentDetail;
}>;

type MarkThreadReadInput = Readonly<{
  snapshot: Readonly<{
    activity_revision: number;
  }>;
}>;

export type RuntimeThreadPatchResponse = LoadThreadResponse | { thread: RuntimeThreadPinMetadata; pins: readonly RuntimeThreadPinMetadata[] };

type ThreadPatchInput = Readonly<{
  title?: string;
  model_id?: string;
  pinned?: boolean;
  permission_type?: FlowerPermissionType;
  reasoning_selection?: FlowerReasoningSelection | null;
}>;

export const FLOWER_LIVE_EVENT_WAIT_MS = 10_000;

type RuntimeApprovalSubmitInput = FlowerSubmitApprovalRequest;

export type FlowerRuntimeTransport = Readonly<{
  listThreads(input?: { cursor?: string; limit?: number; signal?: AbortSignal }): Promise<ListThreadsResponse>;
  loadThread(threadID: string, signal: AbortSignal): Promise<unknown>;
  releaseHistory?(threadID: string, input: { observer_id: string; reading_revision: number; subagent?: boolean }): Promise<void>;
  loadHistory?(threadID: string, input: FlowerHistoryRequest, signal: AbortSignal): Promise<unknown>;
  loadActivityValue?(threadID: string, input: import('./contracts/flowerSurfaceContracts').FlowerActivityValueRequest, signal: AbortSignal): Promise<import('./contracts/flowerSurfaceContracts').FlowerActivityValue>;
  loadActivityStructure?(threadID: string, input: import('./contracts/flowerSurfaceContracts').FlowerActivityStructureRequest, signal: AbortSignal): Promise<import('./contracts/flowerSurfaceContracts').FlowerActivityStructurePage>;
  loadActivityField?(threadID: string, input: import('./contracts/flowerSurfaceContracts').FlowerActivityFieldRequest, signal: AbortSignal): Promise<import('./contracts/flowerSurfaceContracts').FlowerActivityFieldChunk>;
  loadHistoryItem?(threadID: string, itemID: string, signal: AbortSignal): Promise<FlowerRuntimeCurrentItem>;
  loadHistoryBody?(threadID: string, input: import('./contracts/flowerSurfaceContracts').FlowerHistoryBodyRequest, signal: AbortSignal): Promise<import('./contracts/flowerSurfaceContracts').FlowerHistoryBodyChunk>;
  connectLiveStream?: (input: FlowerLiveStreamConnectInput) => AsyncIterable<FlowerLiveTransportFrame>;
  readParentEvents?(threadID: string, query: FlowerParentEventQuery, signal?: AbortSignal): Promise<FlowerParentEventPage>;
  loadSubagentDetail(parentThreadID: string, childThreadID: string, input?: FlowerHistoryRequest, signal?: AbortSignal): Promise<LoadSubagentDetailResponse>;
  operateSubagentInput?(parentThreadID: string, childThreadID: string, input: FlowerSubagentInputOperation): Promise<LoadSubagentDetailResponse>;
  loadTaskFiles?(threadID: string, cursor?: string): Promise<FlowerTaskFiles>;
  cleanTaskFiles?(threadID: string): Promise<void>;
  downloadTaskFile?(threadID: string, path: string, working: boolean, signal: AbortSignal): Promise<void>;
  loadToolPreview?(input: FlowerToolPreviewRequest): Promise<FlowerToolPreview>;
  readTerminalProcess?(runID: string, processID: string, input: { after_seq: number }, signal?: AbortSignal): Promise<FlowerTerminalProcessSnapshot>;
  markThreadRead(threadID: string, input: MarkThreadReadInput): Promise<MarkThreadReadResponse>;
  patchThread(threadID: string, input: ThreadPatchInput): Promise<RuntimeThreadPatchResponse>;
  movePinnedThread?(threadID: string, input: FlowerThreadPinPosition): Promise<{ pins: readonly RuntimeThreadPinMetadata[] }>;
  reorderQueuedTurns?(threadID: string, orderedQueueIDs: readonly string[]): Promise<unknown>;
  deleteQueuedTurn?(threadID: string, queueID: string): Promise<unknown>;
  prepareQueuedTurnDraft?(threadID: string, queueID: string, input: FlowerQueuedDraftInput): Promise<FlowerQueuedDraft>;
  takeBackQueuedTurn?(threadID: string, queueID: string, fingerprint: string): Promise<FlowerRuntimeCurrentView>;
  editQueuedTurn?(threadID: string, queueID: string, input: FlowerQueuedTurnEditInput): Promise<unknown>;
  sendQueuedTurnNow?(threadID: string, queueID: string): Promise<unknown>;
  forkThread(threadID: string, input: FlowerForkThreadInput): Promise<LoadThreadResponse>;
  deleteThread?(threadID: string): Promise<void>;
  submitApproval(input: RuntimeApprovalSubmitInput): Promise<FlowerApprovalCommandResult>;
}>;

export type RuntimeFlowerSurfaceAdapterOptions = Readonly<{
  extensions?: FlowerSurfaceAdapter['extensions'];
  runtime: FlowerSurfaceRuntimeDescriptor;
  signal?: AbortSignal;
  canMutate?: boolean;
  transport: FlowerRuntimeTransport;
  mapperOptions: FlowerLiveThreadMapperOptions;
  chatGPTAuth?: FlowerSurfaceAdapter['chatGPTAuth'];
  loadChatGPTAccounts?: FlowerSurfaceAdapter['loadChatGPTAccounts'];
  discoverProviderModels?: FlowerModelCatalogDiscovery;
  loadSettings: FlowerSurfaceAdapter['loadSettings'];
  loadModelDirectory?: FlowerSurfaceAdapter['loadModelDirectory'];
  recoverModelSource?: FlowerSurfaceAdapter['recoverModelSource'];
  subscribeModelDirectory?: FlowerSurfaceAdapter['subscribeModelDirectory'];
  saveDefaultPermission: (permissionType: FlowerPermissionType) => Promise<FlowerSettingsSnapshot>;
  saveComputerUseEnabled?: (enabled: boolean) => Promise<FlowerSettingsSnapshot>;
  saveAutoUpdateModelCatalog?: (enabled: boolean) => Promise<FlowerSettingsSnapshot>;
  saveModelProfile: (draft: FlowerSettingsDraft) => Promise<FlowerSettingsSnapshot>;
  persistDefaultModel: (modelID: string) => Promise<FlowerSettingsSnapshot>;
  saveConversationPreferences?: FlowerSurfaceAdapter['saveConversationPreferences'];
  resolveHandler: (input?: FlowerResolveHandlerInput) => Promise<FlowerRouterDecision>;
  loadAttachmentCapability?: FlowerSurfaceAdapter['loadAttachmentCapability'];
  createAttachmentStagingScope?: FlowerSurfaceAdapter['createAttachmentStagingScope'];
  bindAttachmentStagingScope?: FlowerSurfaceAdapter['bindAttachmentStagingScope'];
  releaseAttachmentStagingScope?: FlowerSurfaceAdapter['releaseAttachmentStagingScope'];
  uploadAttachment?: FlowerSurfaceAdapter['uploadAttachment'];
  deleteStagedAttachment?: FlowerSurfaceAdapter['deleteStagedAttachment'];
  readStagedLongText?: FlowerSurfaceAdapter['readStagedLongText'];
  loadStagedAttachmentPreview?: FlowerSurfaceAdapter['loadStagedAttachmentPreview'];
  previewStagedAttachment?: FlowerSurfaceAdapter['previewStagedAttachment'];
  loadComputerFrame?: FlowerSurfaceAdapter['loadComputerFrame'];
  loadToolImage?: FlowerSurfaceAdapter['loadToolImage'];
  resolveSourceIcon?: FlowerSurfaceAdapter['resolveSourceIcon'];
  loadMessageAttachment?: FlowerSurfaceAdapter['loadMessageAttachment'];
  openMessageFile?: FlowerSurfaceAdapter['openMessageFile'];
  openMessageURL?: FlowerSurfaceAdapter['openMessageURL'];
  loadMessageFile?: FlowerSurfaceAdapter['loadMessageFile'];
  computerFrameRate?: FlowerSurfaceAdapter['computerFrameRate'];
  computerManagement?: FlowerSurfaceAdapter['computerManagement'];
  setComputerViewer?: FlowerSurfaceAdapter['setComputerViewer'];
  inputComputerControl?: FlowerSurfaceAdapter['inputComputerControl'];
  resolveStorageGeneration?: () => Promise<string>;
  launchTurn: (input: FlowerTurnLaunchInput) => Promise<FlowerTurnLaunchReceipt>;
  compactThreadContext?: FlowerSurfaceAdapter['compactThreadContext'];
  manageGoal?: FlowerSurfaceAdapter['manageGoal'];
  retryThread: (threadID: string) => Promise<unknown>;
  stopThread: (threadID: string) => Promise<unknown>;
  submitInput: (input: FlowerSubmitInputRequest) => Promise<FlowerSubmitInputReceipt>;
  directoryFavorites?: FlowerSurfaceAdapter['directoryFavorites'];
  getWorkingDirectoryPathContext?: () => Promise<FlowerWorkingDirectoryPathContext>;
  listWorkingDirectoryEntries?: (input: FlowerWorkingDirectoryListInput) => Promise<readonly FlowerWorkingDirectoryEntry[]>;
  openCanonicalReference?: (request: FlowerCanonicalReferenceOpenRequest) => Promise<void>;
  resolveCanonicalReference?: FlowerSurfaceAdapter['resolveCanonicalReference'];
  openLinkedFilePreview?: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
  openWorkingDirectoryInFileBrowser?: FlowerSurfaceAdapter['openWorkingDirectoryInFileBrowser'];
  openWorkingDirectoryInTerminal?: FlowerSurfaceAdapter['openWorkingDirectoryInTerminal'];
  workingDirectoryActionAvailability?: FlowerSurfaceAdapter['workingDirectoryActionAvailability'];
  openLinkedDirectoryBrowser?: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
  modelSourceRecovery?: FlowerModelSourceRecovery;
  missingThreadID?: string;
  failedToCreateThread?: string;
}>;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function missingThreadIDMessage(options: RuntimeFlowerSurfaceAdapterOptions): string {
  return trim(options.missingThreadID) || 'Missing thread id.';
}

function mapRuntimeThread(thread: ThreadView, options: RuntimeFlowerSurfaceAdapterOptions): FlowerThreadSnapshot {
	return mapFlowerThread(thread, [], options.mapperOptions, thread.read_status);
}

function mapRuntimeThreadDetailBase(thread: ThreadView, options: RuntimeFlowerSurfaceAdapterOptions): FlowerThreadSnapshot {
  return mapRuntimeThread({
    ...thread,
    run_status: 'idle',
    active_run_id: undefined,
    run_progress: undefined,
    cancellation: undefined,
    run_error: undefined,
    run_error_code: undefined,
    run_error_detail: undefined,
  }, options);
}

function mapRuntimeSummaryThread(thread: ThreadView, options: RuntimeFlowerSurfaceAdapterOptions): FlowerThreadSummary {
  const updatedAt = Math.max(0, Math.floor(Number(thread.updated_at_unix_ms ?? 0)));
  const lastMessageAt = Math.max(0, Math.floor(Number(thread.last_message_at_unix_ms ?? updatedAt)));
  return mapFlowerThreadSummary({ ...thread, updated_at_unix_ms: Math.max(updatedAt, lastMessageAt) }, [], options.mapperOptions);
}

function mapHistoryWindow(raw: unknown): NonNullable<FlowerRuntimeCurrentView['window']> {
  const value = raw as NonNullable<FlowerRuntimeCurrentView['window']> | undefined;
  if (!value || typeof value.has_before !== 'boolean' || typeof value.has_after !== 'boolean'
    || value.first_item_id !== undefined && typeof value.first_item_id !== 'string'
    || value.last_item_id !== undefined && typeof value.last_item_id !== 'string') throw new Error('Flower contract error: invalid history window.');
  return value;
}

function mapRuntimeThreadView(raw: unknown, options: RuntimeFlowerSurfaceAdapterOptions): FlowerThreadView {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const current = value.current && typeof value.current === 'object'
    ? value.current as FlowerRuntimeCurrentView
    : undefined;
  const productThread = value.thread && typeof value.thread === 'object'
    ? value.thread as ThreadView
    : undefined;
  if (current && productThread) {
    const base = mapRuntimeThreadDetailBase(productThread, options);
    const bounded = value.window ? { ...current, window: mapHistoryWindow(value.window) } : current;
    const thread = applyFlowerRuntimeCurrentView(base, bounded);
    return { thread, current: bounded };
  }
  throw new Error('Flower thread detail requires product metadata and a typed current view.');
}

function mapRuntimeUpdate(raw: unknown): FlowerRuntimeUpdate {
  const fail = (): never => { throw Object.assign(new Error('Flower live update violates the published contract.'), { code: 'flower_live_contract_error' }); };
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
  const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
  const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value && !Array.from(value).some(character => character.charCodeAt(0) <= 32);
  const value = record(raw);
  if (!identity(value.thread_id) || !integer(value.base_version) || !integer(value.view_version) || value.view_version <= value.base_version
    || value.turn_id !== undefined && !identity(value.turn_id) || value.run_id !== undefined && !identity(value.run_id)) fail();
  const facts = record(value.facts);
  if (!['idle', 'active'].includes(String(facts.activity)) || !integer(facts.queue_count)) fail();
  if (facts.attention !== undefined) {
    const attention = record(facts.attention);
    if (!integer(attention.approval_count) || !integer(attention.input_count)) fail();
  }
  if (facts.activity === 'active' && (!identity(value.turn_id) || !identity(value.run_id))) fail();
  if (value.items !== undefined) {
    if (!Array.isArray(value.items)) fail();
    for (const rawChange of value.items as unknown[]) {
      const change = record(rawChange);
      if (!identity(change.item_id)) fail();
      if (change.kind === 'append') {
        const append = record(change.append);
        if (change.item !== undefined || !integer(append.offset_bytes) || typeof append.text !== 'string') fail();
      } else if (change.kind === 'add' || change.kind === 'replace') {
        const item = record(change.item);
        if (change.append !== undefined || item.id !== change.item_id || !integer(item.ordinal)
          || !['user', 'steering', 'thinking', 'assistant', 'tool', 'interaction', 'goal'].includes(String(item.kind))
          || item.kind !== 'goal' && (!identity(item.turn_id) || !identity(item.run_id))
          || item.text !== undefined && typeof item.text !== 'string' || item.live !== undefined && typeof item.live !== 'boolean') fail();
      } else if (change.kind === 'body') {
        const body = record(change.body);
        if (change.item !== undefined || change.append !== undefined || !integer(body.bytes) || !integer(body.preview_bytes) || body.bytes < body.preview_bytes) fail();
      } else if (change.kind !== 'remove' || change.item !== undefined || change.append !== undefined) fail();
    }
  }
  for (const name of ['item_order', 'turns', 'queue', 'interactions', 'tool_call_previews', 'restored_inputs', 'goal', 'parent_events', 'context']) {
    if (value[name] === undefined) continue;
    const component = record(value[name]);
    if (Object.keys(component).length !== 1 || !Object.hasOwn(component, 'value')) fail();
    if (['item_order', 'turns', 'queue', 'interactions', 'tool_call_previews', 'restored_inputs'].includes(name)
      && component.value !== null && !Array.isArray(component.value)) fail();
    if (name === 'item_order' && (!Array.isArray(component.value) || !component.value.every(identity))) fail();
  }
  const update = value as FlowerRuntimeUpdate;
  if (!update.context) return update;
  const context = record(update.context.value);
  return { ...update, context: { value: {
    ...(Object.hasOwn(context, 'model_context') ? { model_context: mapModelContext(context.model_context) ?? null } : {}),
    ...(Object.hasOwn(context, 'context_usage') ? { context_usage: mapContextUsage(context.context_usage) } : {}),
    ...(Object.hasOwn(context, 'context_compactions') ? { context_compactions: mapFlowerContextCompactions(context.context_compactions) ?? [] } : {}),
    ...(Object.hasOwn(context, 'timeline_decorations') ? { timeline_decorations: mapFlowerTimelineDecorations(context.timeline_decorations) ?? [] } : {}),
  } } };
}

function mapRuntimeLiveStreamEnvelope(raw: unknown, options: RuntimeFlowerSurfaceAdapterOptions): FlowerLiveStreamEnvelope {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const kind = trim(value.kind);
  if (value.schema_version !== 3) throw Object.assign(new Error('Flower live stream returned an unsupported schema version. Refresh or upgrade the application.'), { code: 'flower_live_version_error' });
  if (kind !== 'ready' && kind !== 'summary.batch' && kind !== 'thread.batch' && kind !== 'viewer.read_state' && kind !== 'computer.frame' && kind !== 'computer.status' && kind !== 'model_directory.changed') {
    throw new Error('Flower live stream returned an unsupported envelope.');
  }
  if (kind === 'model_directory.changed') {
    if (Object.keys(value).some(key => key !== 'kind' && key !== 'schema_version' && key !== 'observer_id')) {
      throw new Error('Flower model directory notification is invalid.');
    }
    return { schema_version: 3, kind };
  }
  if (kind === 'ready' && typeof value.baseline_complete !== 'boolean'
    || value.baseline_complete !== undefined && (typeof value.baseline_complete !== 'boolean' || kind !== 'ready' && kind !== 'summary.batch')) {
    throw new Error('Flower live stream returned an invalid baseline boundary.');
  }
  const summaries = Array.isArray(value.summaries)
    ? value.summaries
        .filter((thread): thread is ThreadView => Boolean(thread && typeof thread === 'object'))
        .map((thread) => mapRuntimeSummaryThread(thread, options))
    : undefined;
  const current = value.current && typeof value.current === 'object'
    ? value.current as FlowerRuntimeCurrentView
    : undefined;
  const subagentCurrent = value.subagent_current && typeof value.subagent_current === 'object'
    ? value.subagent_current as FlowerRuntimeCurrentView
    : undefined;
  const contextCompactions = mapFlowerContextCompactions(value.context_compactions);
  const timelineDecorations = mapFlowerTimelineDecorations(value.timeline_decorations);
  const modelContext = mapModelContext(value.model_context);
  const contextUsage = mapContextUsage(value.context_usage);
  const rawFrame = value.computer_frame && typeof value.computer_frame === 'object' ? value.computer_frame as Record<string, unknown> : undefined;
  const computerFrame = rawFrame && typeof rawFrame.session_id === 'string' && typeof rawFrame.target_id === 'string'
    && typeof rawFrame.mime_type === 'string' && Number.isSafeInteger(rawFrame.viewer_revision)
    ? {
      session_id: rawFrame.session_id,
      target_id: rawFrame.target_id,
      viewer_revision: Number(rawFrame.viewer_revision),
      ...(typeof rawFrame.resource_ref === 'string' ? { resource_ref: rawFrame.resource_ref } : {}),
      ...(typeof rawFrame.sha256 === 'string' ? { sha256: rawFrame.sha256 } : {}),
      ...(typeof rawFrame.interaction_id === 'string' ? { interaction_id: rawFrame.interaction_id } : {}),
      ...(typeof rawFrame.frame_id === 'string' ? { frame_id: rawFrame.frame_id } : {}),
      ...(typeof rawFrame.error_code === 'string' ? { error_code: rawFrame.error_code } : {}),
      ...(isComputerSafetyAssistanceKind(rawFrame.assistance_kind) ? { assistance_kind: rawFrame.assistance_kind } : {}),
      mime_type: rawFrame.mime_type,
      ...(Number.isFinite(Number(rawFrame.width)) ? { width: Number(rawFrame.width) } : {}),
      ...(Number.isFinite(Number(rawFrame.height)) ? { height: Number(rawFrame.height) } : {}),
      sequence: Math.max(0, Math.floor(Number(rawFrame.sequence))),
      ...(Number.isFinite(Number(rawFrame.captured_at_ms)) ? { captured_at_ms: Number(rawFrame.captured_at_ms) } : {}),
    }
    : undefined;
  const rawStatus = value.computer_status && typeof value.computer_status === 'object' ? value.computer_status as Record<string, unknown> : undefined;
  const statusReason = typeof rawStatus?.reason_code === 'string' && ['connection_required', 'target_closed', 'source_fault', 'target_unavailable'].includes(rawStatus.reason_code)
    ? rawStatus.reason_code
    : undefined;
  const computerStatus = rawStatus && typeof rawStatus.thread_id === 'string' && typeof rawStatus.target_id === 'string'
    && ['available', 'unavailable', 'changed'].includes(String(rawStatus.state)) && Number.isFinite(Number(rawStatus.at_unix_ms))
    ? {
      thread_id: rawStatus.thread_id,
      ...(typeof rawStatus.interaction_id === 'string' ? { interaction_id: rawStatus.interaction_id } : {}),
      target_id: rawStatus.target_id,
      state: String(rawStatus.state) as 'available' | 'unavailable' | 'changed',
      ...(statusReason ? { reason_code: statusReason } : {}),
      at_unix_ms: Number(rawStatus.at_unix_ms),
    }
    : undefined;
  const update = value.update === undefined ? undefined : mapRuntimeUpdate(value.update);
  const subagentUpdate = value.subagent_update === undefined ? undefined : mapRuntimeUpdate(value.subagent_update);
  if ((update || subagentUpdate) && (kind !== 'thread.batch' || !trim(value.thread_id) || current || subagentCurrent || update && subagentUpdate || update && update.thread_id !== value.thread_id)) {
    throw Object.assign(new Error('Flower live update envelope has conflicting identity or payloads.'), { code: 'flower_live_contract_error' });
  }
  const invalidated = value.history_invalidated === undefined ? undefined : (value.history_invalidated && typeof value.history_invalidated === 'object' ? value.history_invalidated as Record<string, unknown> : {});
  if (invalidated && (kind !== 'thread.batch' || typeof invalidated.thread_id !== 'string' || invalidated.parent_thread_id !== undefined && (typeof invalidated.parent_thread_id !== 'string' || !trim(invalidated.parent_thread_id)) || !trim(invalidated.thread_id) || invalidated.thread_id !== value.thread_id || !Number.isSafeInteger(value.reading_revision) || Number(value.reading_revision) <= 0 || update || subagentUpdate || current || subagentCurrent)) {
    throw Object.assign(new Error('Flower history invalidation is invalid.'), { code: 'flower_live_contract_error' });
  }
  const subagents = mapFlowerSubagents(value.subagents, 'live.subagents');
  return {
    schema_version: Math.floor(Number(value.schema_version)),
    ...(invalidated ? { history_invalidated: { thread_id: trim(invalidated.thread_id), ...(trim(invalidated.parent_thread_id) ? { parent_thread_id: trim(invalidated.parent_thread_id) } : {}) } } : {}),
    ...(value.facts_only === true ? { facts_only: true } : {}),
    ...(typeof value.baseline_complete === 'boolean' ? { baseline_complete: value.baseline_complete } : {}),
    ...(Number.isSafeInteger(value.reading_revision) ? { reading_revision: Number(value.reading_revision) } : {}),
    ...(value.window ? { window: mapHistoryWindow(value.window) } : {}),
    kind,
    ...(trim(value.observer_id) ? { observer_id: trim(value.observer_id) } : {}),
    ...(trim(value.thread_id) ? { thread_id: trim(value.thread_id) } : {}),
    ...(summaries ? { summaries } : {}),
    ...(current ? { current } : {}),
    ...(update ? { update } : {}),
    ...(subagentCurrent ? { subagent_current: subagentCurrent } : {}),
    ...(subagentUpdate ? { subagent_update: subagentUpdate } : {}),
    ...(subagents !== undefined ? { subagents } : {}),
    ...(value.model_context !== undefined ? { model_context: modelContext ?? null } : {}),
    ...(value.context_usage !== undefined ? { context_usage: contextUsage } : {}),
    ...(contextCompactions ? { context_compactions: contextCompactions } : {}),
    ...(timelineDecorations ? { timeline_decorations: timelineDecorations } : {}),
    ...(computerFrame ? { computer_frame: computerFrame } : {}),
    ...(computerStatus ? { computer_status: computerStatus } : {}),
    ...(kind === 'viewer.read_state' ? { read_status: mapFlowerReadStatus(value.read_status) } : {}),
  } as FlowerLiveStreamEnvelope;
}

function mapSubagentDetail(raw: LoadSubagentDetailResponse): FlowerSubagentDetail {
  if (!raw.detail?.current || !raw.detail.summary) throw new Error('Missing subagent detail.');
  const summary = mapFlowerSubagents([raw.detail.summary], 'subagent.detail.summary')?.[0];
  if (!summary) throw new Error('Flower contract error: missing subagent summary.');
  return { ...raw.detail, ...(raw.detail.window ? { window: mapHistoryWindow(raw.detail.window) } : {}), summary, model_context: raw.detail.model_context === undefined ? undefined : mapModelContext(raw.detail.model_context) ?? null, context_usage: raw.detail.context_usage === undefined ? undefined : mapContextUsage(raw.detail.context_usage), context_compactions: mapFlowerContextCompactions(raw.detail.context_compactions), timeline_decorations: mapFlowerTimelineDecorations(raw.detail.timeline_decorations) };
}

export function createRuntimeFlowerSurfaceAdapter(options: RuntimeFlowerSurfaceAdapterOptions): FlowerSurfaceAdapter {
  const loadThread = async (threadID: string, signal: AbortSignal): Promise<FlowerThreadView> => {
    const tid = trim(threadID);
    if (!tid) throw new Error(missingThreadIDMessage(options));
    signal.throwIfAborted();
    const raw = await (options.transport.loadHistory ? options.transport.loadHistory(tid, {}, signal) : options.transport.loadThread(tid, signal));
    signal.throwIfAborted();
    return mapRuntimeThreadView(raw, options);
  };

  const markThreadRead = async (threadID: string, snapshot: FlowerThreadActivitySnapshot): Promise<FlowerThreadReadStatus> => {
    const tid = trim(threadID);
    if (!tid) throw new Error(missingThreadIDMessage(options));
    const result = await options.transport.markThreadRead(tid, {
      snapshot: {
        activity_revision: Math.floor(Number(snapshot.activity_revision)),
      },
    });
    if (!result.read_status) throw new Error('Missing read status.');
    return mapFlowerReadStatus(result.read_status);
  };

  const adapter: FlowerSurfaceAdapter = {
    runtime: options.runtime,
    get canMutate() { return !options.signal?.aborted && options.canMutate !== false; },
    keepLiveWhenHidden: Boolean(options.transport.connectLiveStream),
    loadSettings: options.loadSettings,
    loadModelDirectory: options.loadModelDirectory,
    recoverModelSource: options.recoverModelSource,
    subscribeModelDirectory: options.subscribeModelDirectory,
    chatGPTAuth: options.chatGPTAuth,
    loadChatGPTAccounts: options.loadChatGPTAccounts,
    discoverProviderModels: options.discoverProviderModels,
    saveDefaultPermission: options.saveDefaultPermission,
    ...(options.saveComputerUseEnabled ? { saveComputerUseEnabled: options.saveComputerUseEnabled } : {}),
    ...(options.saveAutoUpdateModelCatalog ? { saveAutoUpdateModelCatalog: options.saveAutoUpdateModelCatalog } : {}),
    saveModelProfile: options.saveModelProfile,
    listThreads: async (read = {}) => {
      const threads = new Map<string, FlowerThreadSnapshot>();
      const signals = [read.signal, options.signal].filter((signal): signal is AbortSignal => signal !== undefined);
      const signal = signals.length ? AbortSignal.any(signals) : undefined;
      const cursors = new Set<string>();
      let cursor = '';
      do {
        signal?.throwIfAborted();
        const result = await options.transport.listThreads({ cursor, limit: 25, signal });
        signal?.throwIfAborted();
        for (const thread of result.threads ?? []) {
          const mapped = mapRuntimeThread(thread, options);
          threads.set(mapped.thread_id, mapped);
        }
        read.onPage?.([...threads.values()]);
        cursor = trim(result.next_cursor);
        if (cursor && cursors.has(cursor)) throw new Error('Conversation pagination did not advance.');
        cursors.add(cursor);
      } while (cursor);
      return [...threads.values()];
    },
    loadThread,
    releaseHistory: options.transport.releaseHistory,
    loadHistory: options.transport.loadHistory ? async (threadID, input, signal) => {
      signal.throwIfAborted();
      const raw = await historyTransportRead(() => options.transport.loadHistory!(threadID, input, signal), signal);
      return mapRuntimeThreadView(raw, options);
    } : undefined,
    loadActivityValue: options.transport.loadActivityValue ? async (threadID, input, signal) =>
      historyTransportRead(() => options.transport.loadActivityValue!(threadID, input, signal), signal) : undefined,
    loadActivityStructure: options.transport.loadActivityStructure ? async (threadID, input, signal) =>
      historyTransportRead(() => options.transport.loadActivityStructure!(threadID, input, signal), signal) : undefined,
    loadActivityField: options.transport.loadActivityField ? async (threadID, input, signal) =>
      historyTransportRead(() => options.transport.loadActivityField!(threadID, input, signal), signal) : undefined,
    loadHistoryItem: options.transport.loadHistoryItem ? async (threadID, itemID, signal) =>
      historyTransportRead(() => options.transport.loadHistoryItem!(threadID, itemID, signal), signal) : undefined,
    loadHistoryBody: options.transport.loadHistoryBody ? async (threadID, input, signal) =>
      historyTransportRead(() => options.transport.loadHistoryBody!(threadID, input, signal), signal) : undefined,
    ...(options.transport.connectLiveStream ? {
      connectLiveStream: async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
        for await (const envelope of assembleFlowerLiveEnvelopes(options.transport.connectLiveStream!(input))) {
          yield mapRuntimeLiveStreamEnvelope(envelope, options);
        }
      },
    } : {}),
    readParentEvents: options.transport.readParentEvents ? (threadID, query, signal) => options.transport.readParentEvents!(threadID, query, signal) : undefined,
    loadSubagentDetail: async (parentThreadID, childThreadID, input, signal) => {
      const parentID = trim(parentThreadID);
      const childID = trim(childThreadID);
      if (!parentID || !childID) throw new Error(missingThreadIDMessage(options));
      return mapSubagentDetail(await options.transport.loadSubagentDetail(parentID, childID, input, signal));
    },
    ...(options.transport.operateSubagentInput ? {
      operateSubagentInput: async (parentThreadID: string, childThreadID: string, input: FlowerSubagentInputOperation) => {
        const parentID = trim(parentThreadID), childID = trim(childThreadID);
        if (!parentID || !childID) throw new Error(missingThreadIDMessage(options));
        return mapSubagentDetail(await options.transport.operateSubagentInput!(parentID, childID, input));
      },
    } : {}),
    markThreadRead,
    renameThread: async (threadID: string, title: string) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      return mapRuntimeThreadView(await options.transport.patchThread(tid, { title }), options);
    },
    setThreadPinned: async (threadID: string, pinned: boolean) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      const result = await options.transport.patchThread(tid, { pinned });
      if (!('pins' in result) || !Array.isArray(result.pins)) throw new Error('Invalid pinned conversation metadata.');
      const pins = result.pins.map(mapThreadPinMetadata);
      const target = mapThreadPinMetadata(result.thread);
      if (target.thread_id !== tid || new Set(pins.map(pin => pin.thread_id)).size !== pins.length
        || !pins.some(pin => pin.thread_id === tid && pin.pinned_at_ms === target.pinned_at_ms
        && pin.pin_rank === target.pin_rank && pin.settings_revision === target.settings_revision)) throw new Error('Invalid pinned conversation metadata.');
      return pins;
    },
    ...(options.transport.movePinnedThread ? {
      movePinnedThread: async (threadID: string, input: FlowerThreadPinPosition) => {
        const result = await options.transport.movePinnedThread!(threadID, input);
        return result.pins.map(mapThreadPinMetadata);
      },
    } : {}),
    setThreadPermissionType: async (threadID: string, permissionType: FlowerPermissionType) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      return mapRuntimeThreadView(
        await options.transport.patchThread(tid, { permission_type: permissionType }),
        options,
      );
    },
    saveConversationPreferences: options.saveConversationPreferences,
    persistDefaultModel: async (modelID) => {
      const mid = trim(modelID);
      if (!mid) throw new Error('Missing model id.');
      return options.persistDefaultModel(mid);
    },
    setThreadModel: async (threadID: string, modelID: string) => {
      const tid = trim(threadID);
      const mid = trim(modelID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      if (!mid) throw new Error('Missing model id.');
      return mapRuntimeThreadView(await options.transport.patchThread(tid, { model_id: mid }), options);
    },
    setThreadReasoningSelection: async (threadID: string, selection: FlowerReasoningSelection | undefined) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      return mapRuntimeThreadView(
        await options.transport.patchThread(tid, { reasoning_selection: selection ?? null }),
        options,
      );
    },
    ...(options.transport.reorderQueuedTurns ? {
      reorderQueuedTurns: async (threadID: string, orderedQueueIDs: readonly string[]) => {
        const tid = trim(threadID);
        const queueIDs = orderedQueueIDs.map(trim);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        if (queueIDs.length < 2 || queueIDs.some((queueID) => !queueID) || new Set(queueIDs).size !== queueIDs.length) {
          throw new Error('Invalid Flower queued turn order.');
        }
        await options.transport.reorderQueuedTurns!(tid, queueIDs);
        return;
      },
    } : {}),
    ...(options.transport.deleteQueuedTurn ? {
      deleteQueuedTurn: async (threadID: string, queueID: string) => {
        const tid = trim(threadID);
        const qid = trim(queueID);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        if (!qid) throw new Error('Missing Flower queued turn id.');
        await options.transport.deleteQueuedTurn!(tid, qid);
        return;
      },
    } : {}),
    ...(options.transport.prepareQueuedTurnDraft && options.transport.takeBackQueuedTurn ? {
      prepareQueuedTurnDraft: (threadID: string, queueID: string, input: FlowerQueuedDraftInput) => options.transport.prepareQueuedTurnDraft!(threadID, queueID, input),
      takeBackQueuedTurn: async (threadID: string, queueID: string, fingerprint: string) => {
        const tid = trim(threadID), qid = trim(queueID);
        for (let attempt = 0; ; attempt++) {
          if (options.signal?.aborted || options.canMutate === false) {
            throw flowerTurnAdmissionError(attempt ? 'unknown' : 'rejected', options.signal?.aborted
              ? new DOMException('Flower lifetime ended.', 'AbortError')
              : new DOMException('Flower access is read-only.', 'NotAllowedError'));
          }
          try {
            return await options.transport.takeBackQueuedTurn!(tid, qid, fingerprint);
          } catch (error) {
            const status = Number((error as { status?: number })?.status ?? 0);
            if ((status >= 400 && status < 500) || (error as { failureKind?: string })?.failureKind === 'response') throw flowerTurnAdmissionError('rejected', error);
            // Reconcile one lost response through the same idempotent removal.
            if (attempt > 0) throw flowerTurnAdmissionError('unknown', error);
          }
        }
      },
    } : {}),
    ...(options.transport.editQueuedTurn ? {
      editQueuedTurn: async (threadID: string, queueID: string, input: FlowerQueuedTurnEditInput) => {
        const tid = trim(threadID), qid = trim(queueID);
        if (!tid || !qid) throw new Error('Missing Flower queue edit identity.');
        try {
          await options.transport.editQueuedTurn!(tid, qid, input);
        } catch (error) {
          const failure = error as { status?: number; failureKind?: string };
          const rejected = failure?.failureKind === 'response' || ((failure?.status ?? 0) >= 400 && (failure?.status ?? 0) < 500);
          throw flowerTurnAdmissionError(rejected ? 'rejected' : 'unknown', error);
        }
      },
    } : {}),
    ...(options.transport.sendQueuedTurnNow ? {
      sendQueuedTurnNow: async (threadID: string, queueID: string) => {
        const tid = trim(threadID);
        const qid = trim(queueID);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        if (!qid) throw new Error('Missing Flower queued turn id.');
        await options.transport.sendQueuedTurnNow!(tid, qid);
        return;
      },
    } : {}),
    forkThread: async (threadID, input) => {
      const tid = trim(threadID);
      const requestID = trim(input.client_request_id);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      if (!requestID) throw new Error('Missing client request id.');
      const threadResp = await options.transport.forkThread(tid, { ...input, client_request_id: requestID });
      if (trim(threadResp.client_request_id) !== requestID) {
        throw new Error('Flower fork returned a different client request identity.');
      }
      const nextID = trim(threadResp.thread?.thread_id);
      if (!nextID || nextID === tid) throw new Error(trim(options.failedToCreateThread) || 'Failed to create Flower chat.');
      return mapRuntimeThread(threadResp.thread!, options);
    },
    ...(options.transport.deleteThread ? {
      deleteThread: async (threadID) => {
        const tid = trim(threadID);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        await options.transport.deleteThread!(tid);
      },
    } : {}),
    resolveHandler: options.resolveHandler,
    ...(options.loadAttachmentCapability ? { loadAttachmentCapability: options.loadAttachmentCapability } : {}),
    ...(options.createAttachmentStagingScope ? { createAttachmentStagingScope: options.createAttachmentStagingScope } : {}),
    ...(options.bindAttachmentStagingScope ? { bindAttachmentStagingScope: options.bindAttachmentStagingScope } : {}),
    ...(options.releaseAttachmentStagingScope ? { releaseAttachmentStagingScope: options.releaseAttachmentStagingScope } : {}),
    ...(options.uploadAttachment ? { uploadAttachment: options.uploadAttachment } : {}),
    ...(options.deleteStagedAttachment ? { deleteStagedAttachment: options.deleteStagedAttachment } : {}),
    ...(options.readStagedLongText ? { readStagedLongText: options.readStagedLongText } : {}),
    ...(options.loadStagedAttachmentPreview ? { loadStagedAttachmentPreview: options.loadStagedAttachmentPreview } : {}),
    ...(options.previewStagedAttachment ? { previewStagedAttachment: options.previewStagedAttachment } : {}),
    ...(options.computerFrameRate ? { computerFrameRate: options.computerFrameRate } : {}),
    ...(options.loadComputerFrame ? { loadComputerFrame: options.loadComputerFrame } : {}),
    ...(options.loadToolImage ? { loadToolImage: options.loadToolImage } : {}),
    ...(options.resolveSourceIcon ? { resolveSourceIcon: options.resolveSourceIcon } : {}),
    ...(options.loadMessageAttachment ? { loadMessageAttachment: options.loadMessageAttachment } : {}),
    ...(options.openMessageFile ? { openMessageFile: options.openMessageFile } : {}),
    ...(options.openMessageURL ? { openMessageURL: options.openMessageURL } : {}),
    ...(options.loadMessageFile ? { loadMessageFile: options.loadMessageFile } : {}),
    ...(options.inputComputerControl ? { inputComputerControl: options.inputComputerControl } : {}),
    ...(options.setComputerViewer ? { setComputerViewer: options.setComputerViewer } : {}),
    ...(options.computerManagement ? { computerManagement: options.computerManagement } : {}),
    ...(options.extensions ? { extensions: options.extensions } : {}),
    resolveStorageGeneration: options.resolveStorageGeneration,
    launchTurn: options.launchTurn,
    ...(options.manageGoal ? { manageGoal: options.manageGoal } : {}),
    ...(options.compactThreadContext ? {
      compactThreadContext: async (threadID, input) => {
        const tid = trim(threadID);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        const current = await options.compactThreadContext!(tid, input);
        if (trim(current.thread_id) !== tid) throw new Error('Flower context compaction returned a different thread.');
        return current;
      },
    } : {}),
    retryThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      await options.retryThread(tid);
      return;
    },
    stopThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      await options.stopThread(tid);
    },
    submitInput: options.submitInput,
    submitApproval: async (input: FlowerSubmitApprovalRequest) => {
      const tid = trim(input.thread_id);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      const interactionID = trim(input.interaction_id);
      const interactionIDs = input.interaction_ids?.map(trim);
      if (interactionIDs !== undefined) {
        if (interactionID || input.reject_all || !interactionIDs.length || interactionIDs.some((id) => !id) || new Set(interactionIDs).size !== interactionIDs.length) {
          throw new Error('Invalid approval interaction selection.');
        }
      } else if (!interactionID && !input.reject_all) throw new Error('Missing approval interaction id.');
      return options.transport.submitApproval({
        thread_id: tid,
        ...(interactionIDs ? { interaction_ids: interactionIDs } : interactionID ? { interaction_id: interactionID } : {}),
        approved: Boolean(input.approved),
        ...(input.reject_all ? { reject_all: true } : {}),
      });
    },
    ...(options.transport.loadTaskFiles ? { loadTaskFiles: (id: string, cursor?: string) => options.transport.loadTaskFiles!(id, cursor) } : {}),
    ...(options.transport.cleanTaskFiles ? { cleanTaskFiles: (id: string) => options.transport.cleanTaskFiles!(id) } : {}),
    ...(options.transport.downloadTaskFile ? { downloadTaskFile: options.transport.downloadTaskFile } : {}),
    ...(options.transport.loadToolPreview ? {
      loadToolPreview: (input) => options.transport.loadToolPreview!(input),
    } : {}),
    ...(options.transport.readTerminalProcess ? {
      readTerminalProcess: async (input, signal) => {
        const runID = trim(input.run_id);
        const processID = trim(input.process_id);
        if (!runID) throw new Error('Missing run id.');
        if (!processID) throw new Error('Missing terminal process id.');
		const afterSeq = Number(input.after_seq);
		if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
		  throw new Error('Invalid terminal output sequence.');
		}
        return options.transport.readTerminalProcess!(runID, processID, {
		  after_seq: afterSeq,
        }, signal);
      },
    } : {}),
    ...(options.directoryFavorites ? { directoryFavorites: options.directoryFavorites } : {}),
    ...(options.getWorkingDirectoryPathContext ? { getWorkingDirectoryPathContext: options.getWorkingDirectoryPathContext } : {}),
    ...(options.listWorkingDirectoryEntries ? { listWorkingDirectoryEntries: options.listWorkingDirectoryEntries } : {}),
    ...(options.openCanonicalReference ? { openCanonicalReference: options.openCanonicalReference } : {}),
    ...(options.resolveCanonicalReference ? { resolveCanonicalReference: options.resolveCanonicalReference } : {}),
    ...(options.openLinkedFilePreview ? { openLinkedFilePreview: options.openLinkedFilePreview } : {}),
    ...(options.openWorkingDirectoryInFileBrowser ? { openWorkingDirectoryInFileBrowser: options.openWorkingDirectoryInFileBrowser } : {}),
    ...(options.openWorkingDirectoryInTerminal ? { openWorkingDirectoryInTerminal: options.openWorkingDirectoryInTerminal } : {}),
    ...(options.workingDirectoryActionAvailability ? { workingDirectoryActionAvailability: options.workingDirectoryActionAvailability } : {}),
    ...(options.openLinkedDirectoryBrowser ? { openLinkedDirectoryBrowser: options.openLinkedDirectoryBrowser } : {}),
    ...(options.modelSourceRecovery ? { modelSourceRecovery: options.modelSourceRecovery } : {}),
  };
  // Read-only affordances and captured commands observe the same current authority.
  const mutations = new Set<keyof FlowerSurfaceAdapter>([
    'operateSubagentInput', 'renameThread', 'setThreadPinned', 'movePinnedThread', 'setThreadPermissionType',
    'setThreadModel', 'setThreadReasoningSelection', 'reorderQueuedTurns', 'deleteQueuedTurn', 'prepareQueuedTurnDraft',
    'takeBackQueuedTurn', 'editQueuedTurn', 'sendQueuedTurnNow', 'forkThread', 'deleteThread',
    'loadAttachmentCapability', 'createAttachmentStagingScope', 'bindAttachmentStagingScope', 'releaseAttachmentStagingScope',
    'uploadAttachment', 'deleteStagedAttachment', 'readStagedLongText', 'loadStagedAttachmentPreview',
    'previewStagedAttachment', 'inputComputerControl', 'manageGoal', 'compactThreadContext',
  ]);
  const requiredMutations = new Set<keyof FlowerSurfaceAdapter>([
    'launchTurn', 'retryThread', 'stopThread', 'submitInput', 'submitApproval',
    'saveDefaultPermission', 'saveComputerUseEnabled', 'saveAutoUpdateModelCatalog',
    'saveModelProfile', 'saveConversationPreferences', 'persistDefaultModel', 'chatGPTAuth',
  ]);
  for (const key of Object.keys(adapter) as (keyof FlowerSurfaceAdapter)[]) {
    const operation = adapter[key];
    if (typeof operation !== 'function' || ['subscribeModelDirectory', 'connectLiveStream', 'workingDirectoryActionAvailability'].includes(key)) continue;
    const guarded = (...args: unknown[]) => {
      if (options.signal?.aborted || ((mutations.has(key) || requiredMutations.has(key)) && options.canMutate === false)) {
        return Promise.reject(options.signal?.aborted ? new DOMException('Flower lifetime ended.', 'AbortError') : new DOMException('Flower access is read-only.', 'NotAllowedError'));
      }
      return (operation as (...input: unknown[]) => unknown)(...args);
    };
    Object.defineProperty(adapter, key, { enumerable: true, get: () => mutations.has(key) && options.canMutate === false ? undefined : guarded });
  }
  return adapter;
}

// Normalize only rejected transport calls. Decoding and presentation execute
// outside this boundary, so their TypeErrors never enter automatic retries.
async function historyTransportRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  try {
    const result = await read();
    signal.throwIfAborted();
    return result;
  } catch (error) {
    signal.throwIfAborted();
    const failure = error as { code?: unknown; status?: unknown; failureKind?: unknown } | null;
    if (error instanceof TypeError && !failure?.code && !failure?.status || failure?.failureKind === 'transport_unknown') {
      throw Object.assign(new Error('Flower history transport is unavailable.', { cause: error }), { code: 'transport' });
    }
    throw error;
  }
}
