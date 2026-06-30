import type {
  FlowerCompactThreadContextInput,
  FlowerFileOpenRequest,
  FlowerPermissionType,
  FlowerReasoningSelection,
  FlowerResolveHandlerInput,
  FlowerRouterDecision,
  FlowerTurnLaunchInput,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSubagentDetail,
  FlowerSubmitApprovalRequest,
  FlowerSubmitInputRequest,
  FlowerSurfaceAdapter,
  FlowerSurfaceRuntimeDescriptor,
  FlowerTerminalProcessSnapshot,
  FlowerThreadActivitySnapshot,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerLiveBootstrap,
  FlowerLiveEventsResponse,
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

type RuntimeApprovalSubmitBase = Readonly<{
  thread_id: string;
  action_id: string;
  approved: boolean;
  expected_seq?: number;
  revision?: number;
  version?: number;
  surface_epoch?: number;
  idempotency_key?: string;
}>;

type RuntimeApprovalSubmitInput =
  | (RuntimeApprovalSubmitBase & Readonly<{
      origin?: 'main_tool';
      run_id: string;
      tool_id: string;
      delegated_ref?: never;
    }>)
  | (RuntimeApprovalSubmitBase & Readonly<{
      origin: 'delegated_subagent';
      delegated_ref: NonNullable<FlowerSubmitApprovalRequest['delegated_ref']>;
      run_id?: never;
      tool_id?: never;
    }>);

export type FlowerRuntimeTransport = Readonly<{
  listThreads(): Promise<ListThreadsResponse>;
  loadThread(threadID: string): Promise<unknown>;
  listThreadLiveEvents(threadID: string, afterSeq: number, limit: number): Promise<unknown>;
  loadSubagentDetail(parentThreadID: string, childThreadID: string, afterOrdinal: number, limit: number): Promise<LoadSubagentDetailResponse>;
  readTerminalProcess?(runID: string, processID: string, input: { after_seq?: number; wait_ms?: number; max_bytes?: number }): Promise<FlowerTerminalProcessSnapshot>;
  markThreadRead(threadID: string, input: MarkThreadReadInput): Promise<MarkThreadReadResponse>;
  patchThread(threadID: string, input: ThreadPatchInput): Promise<LoadThreadResponse>;
  forkThread(threadID: string): Promise<LoadThreadResponse>;
  submitApproval(input: RuntimeApprovalSubmitInput): Promise<void>;
}>;

export type RuntimeFlowerSurfaceAdapterOptions = Readonly<{
  runtime: FlowerSurfaceRuntimeDescriptor;
  transport: FlowerRuntimeTransport;
  mapperOptions: FlowerLiveThreadMapperOptions;
  loadSettings: () => Promise<FlowerSettingsSnapshot>;
  saveSettings: (draft: FlowerSettingsDraft) => Promise<FlowerSettingsSnapshot>;
  resolveHandler: (input?: FlowerResolveHandlerInput) => Promise<FlowerRouterDecision>;
  launchTurn: (input: FlowerTurnLaunchInput) => Promise<FlowerLiveBootstrap>;
  compactThreadContext: (input: FlowerCompactThreadContextInput) => Promise<FlowerLiveBootstrap>;
  stopThread: (threadID: string) => Promise<FlowerLiveBootstrap>;
  submitInput: (input: FlowerSubmitInputRequest) => Promise<FlowerLiveBootstrap>;
  openFileBrowser?: (request: FlowerFileOpenRequest) => Promise<void>;
  openFilePreview?: (request: FlowerFileOpenRequest) => Promise<void>;
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

function mapSubagentDetail(raw: LoadSubagentDetailResponse): FlowerSubagentDetail {
  if (!raw.detail) throw new Error('Missing subagent detail.');
  return raw.detail;
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
    loadSettings: options.loadSettings,
    saveSettings: options.saveSettings,
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
      return mapRuntimeEvents(
        await options.transport.listThreadLiveEvents(tid, cursor, pageLimit),
      );
    },
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
    renameThread: async (threadID, title) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      const threadResp = await options.transport.patchThread(tid, { title });
      return loadThread(trim(threadResp.thread?.thread_id) || tid);
    },
    setThreadPinned: async (threadID, pinned) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      const threadResp = await options.transport.patchThread(tid, { pinned });
      return loadThread(trim(threadResp.thread?.thread_id) || tid);
    },
    setThreadPermissionType: async (threadID, permissionType) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      const threadResp = await options.transport.patchThread(tid, { permission_type: permissionType });
      return loadThread(trim(threadResp.thread?.thread_id) || tid);
    },
    setThreadModel: async (threadID, modelID) => {
      const tid = trim(threadID);
      const mid = trim(modelID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      if (!mid) throw new Error('Missing model id.');
      const threadResp = await options.transport.patchThread(tid, { model_id: mid });
      return loadThread(trim(threadResp.thread?.thread_id) || tid);
    },
    setThreadReasoningSelection: async (threadID, selection) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      const threadResp = await options.transport.patchThread(tid, { reasoning_selection: selection ?? null });
      return loadThread(trim(threadResp.thread?.thread_id) || tid);
    },
    forkThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      const threadResp = await options.transport.forkThread(tid);
      const nextID = trim(threadResp.thread?.thread_id);
      if (!nextID) throw new Error(trim(options.failedToCreateThread) || 'Failed to create Flower chat.');
      return loadThread(nextID);
    },
    resolveHandler: options.resolveHandler,
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
      const common = {
        thread_id: tid,
        ...(input.origin ? { origin: input.origin } : {}),
        action_id: trim(input.action_id),
        approved: Boolean(input.approved),
        expected_seq: Math.max(0, Math.floor(Number(input.expected_seq ?? 0))) || undefined,
        revision: Math.max(0, Math.floor(Number(input.revision ?? 0))) || undefined,
        version: Math.max(0, Math.floor(Number(input.version ?? 0))) || undefined,
        surface_epoch: Math.max(0, Math.floor(Number(input.surface_epoch ?? 0))) || undefined,
        ...(input.idempotency_key ? { idempotency_key: trim(input.idempotency_key) } : {}),
      };
      if (input.origin === 'delegated_subagent') {
        await options.transport.submitApproval({
          ...common,
          origin: 'delegated_subagent',
          delegated_ref: input.delegated_ref,
        });
        return;
      }
      await options.transport.submitApproval({
        ...common,
        origin: input.origin,
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
        return options.transport.readTerminalProcess!(runID, processID, {
          after_seq: Math.max(0, Math.floor(Number(input.after_seq ?? 0))) || undefined,
          wait_ms: Math.max(0, Math.min(30_000, Math.floor(Number(input.wait_ms ?? 0)))) || undefined,
          max_bytes: Math.max(1, Math.min(1_000_000, Math.floor(Number(input.max_bytes ?? 200_000)))) || undefined,
        });
      },
    } : {}),
    ...(options.openFileBrowser ? { openFileBrowser: options.openFileBrowser } : {}),
    ...(options.openFilePreview ? { openFilePreview: options.openFilePreview } : {}),
  };
}
