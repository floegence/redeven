import type {
  FlowerApprovalDecisionReceipt,
  FlowerCanonicalReferenceOpenRequest,
  FlowerCompactThreadContextInput,
  FlowerFileOpenRequest,
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
  FlowerSubmitApprovalRequest,
  FlowerSubmitInputRequest,
  FlowerSurfaceAdapter,
  FlowerSubmitInputReceipt,
  FlowerSurfaceRuntimeDescriptor,
  FlowerTerminalProcessSnapshot,
  FlowerThreadActivitySnapshot,
  FlowerThreadDeleteOutcome,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerLiveBootstrap,
  FlowerLiveEventsResponse,
  FlowerLiveStreamConnectInput,
  FlowerLiveStreamEnvelope,
} from './contracts/flowerSurfaceContracts';
import {
  mapFlowerReadStatus,
  mapFlowerLiveBootstrap,
  mapFlowerLiveEvents,
  mapFlowerThread,
  type FlowerLiveThreadMapperOptions,
} from './flowerLiveMapper';

type ThreadView = Readonly<{
  thread_id?: string;
  read_status: FlowerThreadReadStatus;
} & Record<string, unknown>>;

type ListThreadsResponse = Readonly<{
  threads?: readonly ThreadView[];
}>;

type LoadThreadResponse = Readonly<{
  client_request_id?: string;
  thread?: ThreadView;
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
    last_message_at_unix_ms: number;
    activity_signature: string;
    waiting_prompt_id?: string;
  }>;
}>;

type ThreadPatchInput = Readonly<{
  title?: string;
  model_id?: string;
  pinned?: boolean;
  permission_type?: FlowerPermissionType;
  reasoning_selection?: FlowerReasoningSelection | null;
}>;

type ThreadDeleteReceipt = Readonly<{
  operation_id?: unknown;
  status?: unknown;
  intent_persisted?: unknown;
}>;

export const FLOWER_THREAD_DELETE_OPERATION_FAILED_CODE = 'AI_THREAD_DELETE_OPERATION_FAILED';
export const FLOWER_LIVE_EVENT_WAIT_MS = 10_000;

export type FlowerThreadDeleteTransportOutcome = Readonly<
  | { kind: 'success'; receipt: unknown }
  | { kind: 'terminal_failure'; receipt: unknown }
>;

type RuntimeApprovalSubmitBase = Readonly<{
  thread_id: string;
  action_id: string;
  approved: boolean;
  expected_seq?: number;
  revision: number;
  version?: number;
  surface_epoch?: number;
  queue_generation: number;
  queue_revision: number;
  idempotency_key?: string;
}>;

type RuntimeApprovalSubmitInput = RuntimeApprovalSubmitBase & Readonly<{
  origin: FlowerSubmitApprovalRequest['origin'];
  run_id: string;
  tool_id: string;
}>;

export type FlowerRuntimeTransport = Readonly<{
  listThreads(): Promise<ListThreadsResponse>;
  loadThread(threadID: string): Promise<unknown>;
  /** @deprecated Live product surfaces use connectLiveStream. */
  listThreadLiveEvents(threadID: string, afterSeq: number, limit: number): Promise<unknown>;
  connectLiveStream?: (input: FlowerLiveStreamConnectInput) => AsyncIterable<unknown>;
  loadSubagentDetail(parentThreadID: string, childThreadID: string, afterOrdinal: number, limit: number): Promise<LoadSubagentDetailResponse>;
  readTerminalProcess?(runID: string, processID: string, input: { after_seq: number }): Promise<FlowerTerminalProcessSnapshot>;
  markThreadRead(threadID: string, input: MarkThreadReadInput): Promise<MarkThreadReadResponse>;
  patchThread(threadID: string, input: ThreadPatchInput): Promise<LoadThreadResponse>;
  forkThread(threadID: string, input: Readonly<{ client_request_id: string }>): Promise<LoadThreadResponse>;
  deleteThread?(threadID: string): Promise<FlowerThreadDeleteTransportOutcome>;
  submitApproval(input: RuntimeApprovalSubmitInput): Promise<FlowerApprovalDecisionReceipt>;
}>;

export type RuntimeFlowerSurfaceAdapterOptions = Readonly<{
  runtime: FlowerSurfaceRuntimeDescriptor;
  canMutate?: boolean;
  transport: FlowerRuntimeTransport;
  mapperOptions: FlowerLiveThreadMapperOptions;
  loadSettings: () => Promise<FlowerSettingsSnapshot>;
  saveDefaultPermission: (permissionType: FlowerPermissionType) => Promise<FlowerSettingsSnapshot>;
  saveModelProfile: (draft: FlowerSettingsDraft) => Promise<FlowerSettingsSnapshot>;
  persistDefaultModel: (modelID: string) => Promise<FlowerSettingsSnapshot>;
  resolveHandler: (input?: FlowerResolveHandlerInput) => Promise<FlowerRouterDecision>;
  loadAttachmentCapability?: FlowerSurfaceAdapter['loadAttachmentCapability'];
  createAttachmentStagingScope?: FlowerSurfaceAdapter['createAttachmentStagingScope'];
  releaseAttachmentStagingScope?: FlowerSurfaceAdapter['releaseAttachmentStagingScope'];
  uploadAttachment?: FlowerSurfaceAdapter['uploadAttachment'];
  deleteStagedAttachment?: FlowerSurfaceAdapter['deleteStagedAttachment'];
  readStagedLongText?: FlowerSurfaceAdapter['readStagedLongText'];
  previewStagedAttachment?: FlowerSurfaceAdapter['previewStagedAttachment'];
  launchTurn: (input: FlowerTurnLaunchInput) => Promise<FlowerTurnLaunchReceipt>;
  compactThreadContext: (input: FlowerCompactThreadContextInput) => Promise<FlowerLiveBootstrap>;
  stopThread: (threadID: string) => Promise<FlowerLiveBootstrap>;
  submitInput: (input: FlowerSubmitInputRequest) => Promise<FlowerSubmitInputReceipt>;
  getWorkingDirectoryPathContext?: () => Promise<FlowerWorkingDirectoryPathContext>;
  listWorkingDirectoryEntries?: (input: FlowerWorkingDirectoryListInput) => Promise<readonly FlowerWorkingDirectoryEntry[]>;
  openFileBrowser?: (request: FlowerFileOpenRequest) => Promise<void>;
  openFilePreview?: (request: FlowerFileOpenRequest) => Promise<void>;
  openCanonicalReference?: (request: FlowerCanonicalReferenceOpenRequest) => Promise<void>;
  openLinkedFilePreview?: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
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

function mapRuntimeBootstrap(raw: unknown, options: RuntimeFlowerSurfaceAdapterOptions): FlowerLiveBootstrap {
  return mapFlowerLiveBootstrap(raw, options.mapperOptions);
}

function mapRuntimeEvents(raw: unknown): FlowerLiveEventsResponse {
  return mapFlowerLiveEvents(raw);
}

function mapRuntimeLiveStreamEnvelope(raw: unknown): FlowerLiveStreamEnvelope {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const kind = trim(value.kind);
  if (kind !== 'ready' && kind !== 'summary.batch' && kind !== 'thread.batch' && kind !== 'viewer.read_state' && kind !== 'resync_required') {
    throw new Error('Flower live stream returned an unsupported envelope.');
  }
  const streamGeneration = Math.floor(Number(value.stream_generation));
  if (!Number.isSafeInteger(streamGeneration) || streamGeneration <= 0) {
    throw new Error('Flower live stream returned an invalid generation.');
  }
  const mappedEvents = kind === 'summary.batch' || kind === 'thread.batch'
    ? mapRuntimeEvents({
        stream_generation: streamGeneration,
        events: value.events,
        next_cursor: value.through_seq,
        retained_from_seq: value.retained_from_seq,
      }).events
    : undefined;
  return {
    schema_version: Math.floor(Number(value.schema_version)),
    kind,
    stream_generation: streamGeneration,
    ...(trim(value.thread_id) ? { thread_id: trim(value.thread_id) } : {}),
    ...(Number.isSafeInteger(Number(value.from_seq)) ? { from_seq: Math.floor(Number(value.from_seq)) } : {}),
    ...(Number.isSafeInteger(Number(value.through_seq)) ? { through_seq: Math.floor(Number(value.through_seq)) } : {}),
    ...(Number.isSafeInteger(Number(value.retained_from_seq)) ? { retained_from_seq: Math.floor(Number(value.retained_from_seq)) } : {}),
    ...(Number.isSafeInteger(Number(value.summary_through_seq)) ? { summary_through_seq: Math.floor(Number(value.summary_through_seq)) } : {}),
    ...(Number.isSafeInteger(Number(value.summary_retained_from_seq)) ? { summary_retained_from_seq: Math.floor(Number(value.summary_retained_from_seq)) } : {}),
    ...(mappedEvents ? { events: mappedEvents } : {}),
    ...(kind === 'viewer.read_state' ? { read_status: mapFlowerReadStatus(value.read_status) } : {}),
    ...(trim(value.reason) ? { reason: trim(value.reason) } : {}),
  } as FlowerLiveStreamEnvelope;
}

function mapSubagentDetail(raw: LoadSubagentDetailResponse): FlowerSubagentDetail {
  if (!raw.detail) throw new Error('Missing subagent detail.');
  return raw.detail;
}

function mapThreadDeleteReceipt(outcome: FlowerThreadDeleteTransportOutcome): FlowerThreadDeleteOutcome {
  const receipt = outcome?.receipt && typeof outcome.receipt === 'object'
    ? outcome.receipt as ThreadDeleteReceipt
    : null;
  const operationID = trim(receipt?.operation_id);
  const status = trim(receipt?.status);
  const validStatus = outcome?.kind === 'success'
    ? status === 'pending' || status === 'committed'
    : outcome?.kind === 'terminal_failure' && status === 'failed';
  if (!operationID || receipt?.intent_persisted !== true ||
    !validStatus) {
    throw new Error('Flower thread delete returned an invalid receipt.');
  }
  return { status: status as FlowerThreadDeleteOutcome['status'] };
}

export function createRuntimeFlowerSurfaceAdapter(options: RuntimeFlowerSurfaceAdapterOptions): FlowerSurfaceAdapter {
  const loadThread = async (threadID: string): Promise<FlowerLiveBootstrap> => {
    const tid = trim(threadID);
    if (!tid) throw new Error(missingThreadIDMessage(options));
    return mapRuntimeBootstrap(
      await options.transport.loadThread(tid),
      options,
    );
  };

  const markThreadRead = async (threadID: string, snapshot: FlowerThreadActivitySnapshot): Promise<FlowerThreadReadStatus> => {
    const tid = trim(threadID);
    if (!tid) throw new Error(missingThreadIDMessage(options));
    const result = await options.transport.markThreadRead(tid, {
      snapshot: {
        activity_revision: Math.floor(Number(snapshot.activity_revision)),
        last_message_at_unix_ms: Math.floor(Number(snapshot.last_message_at_unix_ms)),
        activity_signature: trim(snapshot.activity_signature),
        waiting_prompt_id: trim(snapshot.waiting_prompt_id) || undefined,
      },
    });
    if (!result.read_status) throw new Error('Missing read status.');
    return mapFlowerReadStatus(result.read_status);
  };

  return {
    runtime: options.runtime,
    canMutate: options.canMutate !== false,
    loadSettings: options.loadSettings,
    saveDefaultPermission: options.saveDefaultPermission,
    saveModelProfile: options.saveModelProfile,
    listThreads: async () => {
      const result = await options.transport.listThreads();
      return (result.threads ?? []).map((thread) => mapRuntimeThread(thread, options));
    },
    loadThread,
    listThreadLiveEvents: async (threadID, afterSeq, limit = 100) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      const cursor = Math.max(0, Math.floor(Number(afterSeq) || 0));
      const pageLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 100)));
      return mapRuntimeEvents(await options.transport.listThreadLiveEvents(tid, cursor, pageLimit));
    },
    ...(options.transport.connectLiveStream ? {
      connectLiveStream: async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
        for await (const envelope of options.transport.connectLiveStream!(input)) {
          yield mapRuntimeLiveStreamEnvelope(envelope);
        }
      },
    } : {}),
    loadSubagentDetail: async (parentThreadID, childThreadID, afterOrdinal = 0, limit = 200) => {
      const parentID = trim(parentThreadID);
      const childID = trim(childThreadID);
      if (!parentID || !childID) throw new Error(missingThreadIDMessage(options));
      return mapSubagentDetail(await options.transport.loadSubagentDetail(
        parentID,
        childID,
        Math.max(0, Math.floor(Number(afterOrdinal) || 0)),
        Math.max(1, Math.min(500, Math.floor(Number(limit) || 200))),
      ));
    },
    markThreadRead,
    ...(options.canMutate === false ? {} : {
      renameThread: async (threadID: string, title: string) => {
        const tid = trim(threadID);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        const threadResp = await options.transport.patchThread(tid, { title });
        return loadThread(trim(threadResp.thread?.thread_id) || tid);
      },
      setThreadPinned: async (threadID: string, pinned: boolean) => {
        const tid = trim(threadID);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        const threadResp = await options.transport.patchThread(tid, { pinned });
        return loadThread(trim(threadResp.thread?.thread_id) || tid);
      },
      setThreadPermissionType: async (threadID: string, permissionType: FlowerPermissionType) => {
        const tid = trim(threadID);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        const threadResp = await options.transport.patchThread(tid, { permission_type: permissionType });
        return loadThread(trim(threadResp.thread?.thread_id) || tid);
      },
    }),
    persistDefaultModel: async (modelID) => {
      const mid = trim(modelID);
      if (!mid) throw new Error('Missing model id.');
      return options.persistDefaultModel(mid);
    },
    ...(options.canMutate === false ? {} : {
      setThreadModel: async (threadID: string, modelID: string) => {
        const tid = trim(threadID);
        const mid = trim(modelID);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        if (!mid) throw new Error('Missing model id.');
        const threadResp = await options.transport.patchThread(tid, { model_id: mid });
        return loadThread(trim(threadResp.thread?.thread_id) || tid);
      },
      setThreadReasoningSelection: async (threadID: string, selection: FlowerReasoningSelection | undefined) => {
        const tid = trim(threadID);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        const threadResp = await options.transport.patchThread(tid, { reasoning_selection: selection ?? null });
        return loadThread(trim(threadResp.thread?.thread_id) || tid);
      },
      forkThread: async (threadID: string, clientRequestID: string) => {
        const tid = trim(threadID);
        const requestID = trim(clientRequestID);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        if (!requestID) throw new Error('Missing client request id.');
        const threadResp = await options.transport.forkThread(tid, { client_request_id: requestID });
        if (trim(threadResp.client_request_id) !== requestID) {
          throw new Error('Flower fork returned a different client request identity.');
        }
        const nextID = trim(threadResp.thread?.thread_id);
        if (!nextID) throw new Error(trim(options.failedToCreateThread) || 'Failed to create Flower chat.');
        return loadThread(nextID);
      },
    }),
    ...(options.canMutate !== false && options.transport.deleteThread ? {
      deleteThread: async (threadID) => {
        const tid = trim(threadID);
        if (!tid) throw new Error(missingThreadIDMessage(options));
        return mapThreadDeleteReceipt(await options.transport.deleteThread!(tid));
      },
    } : {}),
    resolveHandler: options.resolveHandler,
    ...(options.canMutate !== false && options.loadAttachmentCapability ? { loadAttachmentCapability: options.loadAttachmentCapability } : {}),
    ...(options.canMutate !== false && options.createAttachmentStagingScope ? { createAttachmentStagingScope: options.createAttachmentStagingScope } : {}),
    ...(options.canMutate !== false && options.releaseAttachmentStagingScope ? { releaseAttachmentStagingScope: options.releaseAttachmentStagingScope } : {}),
    ...(options.canMutate !== false && options.uploadAttachment ? { uploadAttachment: options.uploadAttachment } : {}),
    ...(options.canMutate !== false && options.deleteStagedAttachment ? { deleteStagedAttachment: options.deleteStagedAttachment } : {}),
    ...(options.canMutate !== false && options.readStagedLongText ? { readStagedLongText: options.readStagedLongText } : {}),
    ...(options.canMutate !== false && options.previewStagedAttachment ? { previewStagedAttachment: options.previewStagedAttachment } : {}),
    launchTurn: options.launchTurn,
    compactThreadContext: async (input) => {
      const tid = trim(input.thread_id);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      return options.compactThreadContext({
        thread_id: tid,
        active_run_id: trim(input.active_run_id) || undefined,
      });
    },
    stopThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      return options.stopThread(tid);
    },
    submitInput: options.submitInput,
    submitApproval: async (input: FlowerSubmitApprovalRequest) => {
      const tid = trim(input.thread_id);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      const origin = trim(input.origin) as FlowerSubmitApprovalRequest['origin'];
      if (origin !== 'main_tool' && origin !== 'delegated_subagent' && origin !== 'control_confirm') {
        throw new Error('Invalid approval origin.');
      }
      const revision = Number(input.revision);
      if (!Number.isSafeInteger(revision) || revision <= 0) {
        throw new Error('Invalid approval revision.');
      }
      const queueGeneration = Number(input.queue_generation);
      const queueRevision = Number(input.queue_revision);
      if (!Number.isSafeInteger(queueGeneration) || queueGeneration <= 0 ||
        !Number.isSafeInteger(queueRevision) || queueRevision <= 0) {
        throw new Error('Invalid approval queue authority.');
      }
      const common = {
        thread_id: tid,
        origin,
        action_id: trim(input.action_id),
        approved: Boolean(input.approved),
        expected_seq: Math.max(0, Math.floor(Number(input.expected_seq ?? 0))) || undefined,
        revision,
        version: Math.max(0, Math.floor(Number(input.version ?? 0))) || undefined,
        surface_epoch: Math.max(0, Math.floor(Number(input.surface_epoch ?? 0))) || undefined,
        queue_generation: queueGeneration,
        queue_revision: queueRevision,
        ...(input.idempotency_key ? { idempotency_key: trim(input.idempotency_key) } : {}),
      };
      return options.transport.submitApproval({
        ...common,
        run_id: trim(input.run_id),
        tool_id: trim(input.tool_id),
      });
    },
    ...(options.transport.readTerminalProcess ? {
      readTerminalProcess: async (input) => {
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
        });
      },
    } : {}),
    ...(options.getWorkingDirectoryPathContext ? { getWorkingDirectoryPathContext: options.getWorkingDirectoryPathContext } : {}),
    ...(options.listWorkingDirectoryEntries ? { listWorkingDirectoryEntries: options.listWorkingDirectoryEntries } : {}),
    ...(options.openFileBrowser ? { openFileBrowser: options.openFileBrowser } : {}),
    ...(options.openFilePreview ? { openFilePreview: options.openFilePreview } : {}),
    ...(options.openCanonicalReference ? { openCanonicalReference: options.openCanonicalReference } : {}),
    ...(options.openLinkedFilePreview ? { openLinkedFilePreview: options.openLinkedFilePreview } : {}),
    ...(options.openLinkedDirectoryBrowser ? { openLinkedDirectoryBrowser: options.openLinkedDirectoryBrowser } : {}),
    ...(options.modelSourceRecovery ? { modelSourceRecovery: options.modelSourceRecovery } : {}),
  };
}
