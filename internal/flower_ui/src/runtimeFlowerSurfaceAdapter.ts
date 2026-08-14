import type {
  FlowerApprovalCommandResult,
  FlowerCanonicalReferenceOpenRequest,
  FlowerFileOpenRequest,
  FlowerLinkedContextPathOpenRequest,
  FlowerModelSourceRecovery,
  FlowerPermissionType,
  FlowerReasoningSelection,
  FlowerRetryEffectRequest,
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
  FlowerThreadView,
  FlowerLiveStreamConnectInput,
  FlowerLiveStreamEnvelope,
  FlowerRuntimeCurrentView,
} from './contracts/flowerSurfaceContracts';
import {
  mapFlowerReadStatus,
  mapFlowerThread,
  type FlowerLiveThreadMapperOptions,
} from './flowerLiveMapper';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';

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

type RuntimeApprovalSubmitInput = Readonly<{
  thread_id: string;
  interaction_id: string;
  approved: boolean;
  reject_all?: boolean;
}>;

export type FlowerRuntimeTransport = Readonly<{
  listThreads(): Promise<ListThreadsResponse>;
  loadThread(threadID: string): Promise<unknown>;
  connectLiveStream?: (input: FlowerLiveStreamConnectInput) => AsyncIterable<unknown>;
  loadSubagentDetail(parentThreadID: string, childThreadID: string, afterOrdinal: number, limit: number): Promise<LoadSubagentDetailResponse>;
  readTerminalProcess?(runID: string, processID: string, input: { after_seq: number }): Promise<FlowerTerminalProcessSnapshot>;
  markThreadRead(threadID: string, input: MarkThreadReadInput): Promise<MarkThreadReadResponse>;
  patchThread(threadID: string, input: ThreadPatchInput): Promise<LoadThreadResponse>;
  reorderQueuedTurns?(threadID: string, orderedQueueIDs: readonly string[]): Promise<unknown>;
  deleteQueuedTurn?(threadID: string, queueID: string): Promise<unknown>;
  promoteQueuedTurn?(threadID: string, queueID: string): Promise<unknown>;
  forkThread(threadID: string, input: Readonly<{ client_request_id: string }>): Promise<LoadThreadResponse>;
  deleteThread?(threadID: string): Promise<FlowerThreadDeleteTransportOutcome>;
  submitApproval(input: RuntimeApprovalSubmitInput): Promise<FlowerApprovalCommandResult>;
  retryEffect(input: FlowerRetryEffectRequest): Promise<unknown>;
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
  loadStagedAttachmentPreview?: FlowerSurfaceAdapter['loadStagedAttachmentPreview'];
  previewStagedAttachment?: FlowerSurfaceAdapter['previewStagedAttachment'];
  launchTurn: (input: FlowerTurnLaunchInput) => Promise<FlowerTurnLaunchReceipt>;
  retryThread: (threadID: string) => Promise<unknown>;
  stopThread: (threadID: string) => Promise<unknown>;
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
	const { waiting_prompt: _waitingPrompt, ...summary } = thread;
	return mapFlowerThread(summary, [], options.mapperOptions, thread.read_status);
}

function mapRuntimeSummaryThread(thread: ThreadView, options: RuntimeFlowerSurfaceAdapterOptions): FlowerThreadSnapshot {
	const { waiting_prompt: _waitingPrompt, ...summary } = thread;
	const updatedAt = Math.max(0, Math.floor(Number(thread.updated_at_unix_ms ?? 0)));
  const lastMessageAt = Math.max(0, Math.floor(Number(thread.last_message_at_unix_ms ?? updatedAt)));
  const activityRevision = Math.max(updatedAt, lastMessageAt);
  const readStatus = thread.read_status ?? {
    is_unread: false,
    snapshot: {
      activity_revision: activityRevision,
      last_message_at_unix_ms: lastMessageAt,
      activity_signature: '',
    },
    read_state: {
      last_seen_activity_revision: activityRevision,
      last_read_message_at_unix_ms: lastMessageAt,
      last_seen_activity_signature: '',
    },
  };
	return mapFlowerThread(summary, [], options.mapperOptions, readStatus);
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
    const base = mapRuntimeThread(productThread, options);
    const thread = applyFlowerRuntimeCurrentView(base, current);
    return { thread, current };
  }
  throw new Error('Flower thread detail requires product metadata and a typed current view.');
}

function mapRuntimeLiveStreamEnvelope(raw: unknown, options: RuntimeFlowerSurfaceAdapterOptions): FlowerLiveStreamEnvelope {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const kind = trim(value.kind);
  if (kind !== 'ready' && kind !== 'summary.batch' && kind !== 'thread.batch' && kind !== 'viewer.read_state') {
    throw new Error('Flower live stream returned an unsupported envelope.');
  }
  const summaries = Array.isArray(value.summaries)
    ? value.summaries
        .filter((thread): thread is ThreadView => Boolean(thread && typeof thread === 'object'))
        .map((thread) => mapRuntimeSummaryThread(thread, options))
    : undefined;
  const current = value.current && typeof value.current === 'object'
    ? value.current as FlowerRuntimeCurrentView
    : undefined;
  return {
    schema_version: Math.floor(Number(value.schema_version)),
    kind,
    ...(trim(value.thread_id) ? { thread_id: trim(value.thread_id) } : {}),
    ...(summaries ? { summaries } : {}),
    ...(current ? { current } : {}),
    ...(kind === 'viewer.read_state' ? { read_status: mapFlowerReadStatus(value.read_status) } : {}),
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
  const loadThread = async (threadID: string): Promise<FlowerThreadView> => {
    const tid = trim(threadID);
    if (!tid) throw new Error(missingThreadIDMessage(options));
    return mapRuntimeThreadView(
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

  const adapter: FlowerSurfaceAdapter = {
    runtime: options.runtime,
    canMutate: options.canMutate !== false,
    keepLiveWhenHidden: Boolean(options.transport.connectLiveStream),
    loadSettings: options.loadSettings,
    saveDefaultPermission: options.saveDefaultPermission,
    saveModelProfile: options.saveModelProfile,
    listThreads: async () => {
      const result = await options.transport.listThreads();
      return (result.threads ?? []).map((thread) => mapRuntimeThread(thread, options));
    },
    loadThread,
    ...(options.transport.connectLiveStream ? {
      connectLiveStream: async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
        for await (const envelope of options.transport.connectLiveStream!(input)) {
          yield mapRuntimeLiveStreamEnvelope(envelope, options);
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
        await options.transport.patchThread(tid, { pinned });
        return undefined;
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
      ...(options.transport.reorderQueuedTurns ? {
        reorderQueuedTurns: async (threadID: string, orderedQueueIDs: readonly string[]) => {
          const tid = trim(threadID);
          const queueIDs = orderedQueueIDs.map(trim);
          if (!tid) throw new Error(missingThreadIDMessage(options));
          if (queueIDs.length < 2 || queueIDs.some((queueID) => !queueID) || new Set(queueIDs).size !== queueIDs.length) {
            throw new Error('Invalid Flower queued turn order.');
          }
          await options.transport.reorderQueuedTurns!(tid, queueIDs);
          return loadThread(tid);
        },
      } : {}),
      ...(options.transport.deleteQueuedTurn ? {
        deleteQueuedTurn: async (threadID: string, queueID: string) => {
          const tid = trim(threadID);
          const qid = trim(queueID);
          if (!tid) throw new Error(missingThreadIDMessage(options));
          if (!qid) throw new Error('Missing Flower queued turn id.');
          await options.transport.deleteQueuedTurn!(tid, qid);
          return loadThread(tid);
        },
      } : {}),
      ...(options.transport.promoteQueuedTurn ? {
        promoteQueuedTurn: async (threadID: string, queueID: string) => {
          const tid = trim(threadID);
          const qid = trim(queueID);
          if (!tid) throw new Error(missingThreadIDMessage(options));
          if (!qid) throw new Error('Missing Flower queued turn id.');
          await options.transport.promoteQueuedTurn!(tid, qid);
          return loadThread(tid);
        },
      } : {}),
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
    ...(options.canMutate !== false && options.loadStagedAttachmentPreview ? { loadStagedAttachmentPreview: options.loadStagedAttachmentPreview } : {}),
    ...(options.canMutate !== false && options.previewStagedAttachment ? { previewStagedAttachment: options.previewStagedAttachment } : {}),
    launchTurn: options.launchTurn,
    retryThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      await options.retryThread(tid);
      return loadThread(tid);
    },
    retryEffect: async (input) => {
      const tid = trim(input.thread_id);
      const effectAttemptID = trim(input.effect_attempt_id);
      const toolCallID = trim(input.tool_call_id);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      if (!effectAttemptID || !toolCallID) throw new Error('Missing effect retry identity.');
      await options.transport.retryEffect({
        thread_id: tid,
        effect_attempt_id: effectAttemptID,
        tool_call_id: toolCallID,
        acknowledge_unknown_risk: true,
      });
    },
    stopThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      await options.stopThread(tid);
      return loadThread(tid);
    },
    submitInput: options.submitInput,
    submitApproval: async (input: FlowerSubmitApprovalRequest) => {
      const tid = trim(input.thread_id);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      const interactionID = trim(input.interaction_id);
      if (!interactionID) throw new Error('Missing approval interaction id.');
      return options.transport.submitApproval({
        thread_id: tid,
        interaction_id: interactionID,
        approved: Boolean(input.approved),
        ...(input.reject_all ? { reject_all: true } : {}),
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
  return adapter;
}
