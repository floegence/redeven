import type {
  FlowerFileOpenRequest,
  FlowerResolveHandlerInput,
  FlowerRouterDecision,
  FlowerSendMessageInput,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSubmitApprovalRequest,
  FlowerSubmitInputRequest,
  FlowerSurfaceAdapter,
  FlowerSurfaceRuntimeDescriptor,
  FlowerThreadActivitySnapshot,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerLiveBootstrap,
  FlowerLiveEventsResponse,
} from './contracts/flowerSurfaceContracts';
import {
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
  pinned?: boolean;
}>;

type RuntimeApprovalSubmitInput = Readonly<{
  thread_id: string;
  run_id: string;
  action_id: string;
  tool_id: string;
  approved: boolean;
  expected_seq?: number;
  revision?: number;
}>;

export type FlowerRuntimeTransport = Readonly<{
  listThreads(): Promise<ListThreadsResponse>;
  loadThread(threadID: string): Promise<unknown>;
  listThreadLiveEvents(threadID: string, afterSeq: number, limit: number): Promise<unknown>;
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
  sendMessage: (input: FlowerSendMessageInput) => Promise<FlowerLiveBootstrap>;
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

export function createRuntimeFlowerSurfaceAdapter(options: RuntimeFlowerSurfaceAdapterOptions): FlowerSurfaceAdapter {
  const loadThread = async (threadID: string): Promise<FlowerLiveBootstrap> => {
    const tid = trim(threadID);
    if (!tid) throw new Error(missingThreadIDMessage(options));
    return mapRuntimeBootstrap(
      await options.transport.loadThread(tid),
      options,
    );
  };

  const markThreadRead = async (threadID: string, snapshot: FlowerThreadActivitySnapshot): Promise<FlowerLiveBootstrap> => {
    const tid = trim(threadID);
    if (!tid) throw new Error(missingThreadIDMessage(options));
    await options.transport.markThreadRead(tid, {
      snapshot: {
        activity_revision: Math.floor(Number(snapshot.activity_revision)),
        last_message_at_unix_ms: Math.floor(Number(snapshot.last_message_at_unix_ms)),
        activity_signature: trim(snapshot.activity_signature),
        waiting_prompt_id: trim(snapshot.waiting_prompt_id) || undefined,
      },
    });
    return loadThread(tid);
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
    forkThread: async (threadID) => {
      const tid = trim(threadID);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      const threadResp = await options.transport.forkThread(tid);
      const nextID = trim(threadResp.thread?.thread_id);
      if (!nextID) throw new Error(trim(options.failedToCreateThread) || 'Failed to create Flower chat.');
      return loadThread(nextID);
    },
    resolveHandler: options.resolveHandler,
    sendMessage: options.sendMessage,
    submitInput: options.submitInput,
    submitApproval: async (input: FlowerSubmitApprovalRequest) => {
      const tid = trim(input.thread_id);
      if (!tid) throw new Error(missingThreadIDMessage(options));
      await options.transport.submitApproval({
        thread_id: tid,
        run_id: trim(input.run_id),
        action_id: trim(input.action_id),
        tool_id: trim(input.tool_id),
        approved: Boolean(input.approved),
        expected_seq: Math.max(0, Math.floor(Number(input.expected_seq ?? 0))) || undefined,
        revision: Math.max(0, Math.floor(Number(input.revision ?? 0))) || undefined,
      });
    },
    ...(options.openFileBrowser ? { openFileBrowser: options.openFileBrowser } : {}),
    ...(options.openFilePreview ? { openFilePreview: options.openFilePreview } : {}),
  };
}
