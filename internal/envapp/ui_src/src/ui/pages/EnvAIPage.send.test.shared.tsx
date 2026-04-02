import { createContext, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockThread = {
  thread_id: string;
  title?: string;
  model_id?: string;
  execution_mode?: 'act' | 'plan';
  working_dir?: string;
  queued_turn_count?: number;
  run_status?: string;
};

type MockWaitingPrompt = {
  promptId: string;
  messageId: string;
  toolId: string;
  questions?: Array<{
    id: string;
    header: string;
    question: string;
    isSecret?: boolean;
    responseMode?: 'select' | 'write' | 'select_or_write';
    writeLabel?: string;
    writePlaceholder?: string;
    choices?: Array<{
      choiceId: string;
      label: string;
      description?: string;
      kind?: 'select';
    }>;
  }>;
};

const notificationErrorMock = vi.fn();
const notificationInfoMock = vi.fn();
const notificationSuccessMock = vi.fn();

const protocolState = {
  status: 'connected' as 'connected' | 'disconnected',
};
const ACTIVE_RUN_SNAPSHOT_RECOVERY_SETTLE_MS = 380;

const sendUserTurnMock = vi.fn(async (_req: unknown) => ({
  runId: 'run-send-1',
  kind: 'start',
}));
const submitStructuredPromptResponseMock = vi.fn(async (args: unknown) => {
  const tid = String((args as { threadId?: string } | null)?.threadId ?? aiState.activeThreadId ?? '').trim();
  if (tid) {
    aiState.runIdByThread[tid] = 'run-structured-1';
  }
  aiState.waitingPrompt = null;
  if (aiState.activeThread && String(aiState.activeThread.thread_id ?? '').trim() === tid) {
    aiState.activeThread = {
      ...aiState.activeThread,
      run_status: 'running',
    };
  }
  touchRunState();
  return {
    runId: 'run-structured-1',
    consumedWaitingPromptId: 'prompt-1',
    appliedExecutionMode: 'act',
  };
});
const subscribeThreadMock = vi.fn(async (_req: unknown) => ({ runId: 'run-subscribe-1' }));
const listMessagesMock = vi.fn(async (_req: unknown) => ({ messages: [], nextAfterRowId: 0, hasMore: false }));
const getActiveRunSnapshotMock = vi.fn(async (_req: unknown) => ({ ok: false }));
const getPathContextMock = vi.fn(async () => ({ agentHomePathAbs: '/workspace' }));
const setToolCollapsedMock = vi.fn(async () => ({ ok: true }));
const stopThreadMock = vi.fn(async () => ({ ok: true, recoveredFollowups: [] }));
const approveToolMock = vi.fn(async () => ({ ok: true }));

const defaultFetchGatewayJSON: (url: string) => Promise<any> = async (url: string) => {
  if (url.includes('/todos')) {
    return { todos: null };
  }
  if (url.includes('/followups')) {
    return { queued: [], drafts: [], revision: 0, paused_reason: '' };
  }
  if (url.includes('/runs/') && url.includes('/events')) {
    return { events: [], has_more: false, next_cursor: 0 };
  }
  if (url.includes('/validate_working_dir')) {
    return { working_dir: '/workspace' };
  }
  return {};
};

const fetchGatewayJSONMock = vi.fn(defaultFetchGatewayJSON);
const uploadGatewayFileMock = vi.fn(async (_file: File) => '/_redeven_proxy/api/ai/uploads/upl_test');

const gatewayRequestCredentialsMock = vi.fn(async () => 'same-origin');
const prepareGatewayRequestInitMock = vi.fn(async (init: RequestInit = {}) => init);

const envResource = (() => {
  const value = {
    state: 'ready',
    permissions: {
      can_read: true,
      can_write: true,
      can_execute: true,
      can_admin: true,
      is_owner: true,
    },
  };
  const resource = (() => value) as any;
  resource.state = 'ready';
  resource.loading = false;
  resource.error = null;
  resource.latest = value;
  return resource;
})();

const envContextValue = {
  env_id: () => 'env-1',
  env: envResource,
  connect: async () => undefined,
  connecting: () => false,
  connectError: () => null,
  goTab: () => {},
  filesSidebarOpen: () => false,
  setFilesSidebarOpen: () => {},
  toggleFilesSidebar: () => {},
  settingsSeq: () => 0,
  bumpSettingsSeq: () => {},
  openSettings: () => {},
  settingsFocusSeq: () => 0,
  settingsFocusSection: () => null,
  askFlowerIntentSeq: () => 0,
  askFlowerIntent: () => null,
  injectAskFlowerIntent: () => {},
  openAskFlowerComposer: () => {},
  aiThreadFocusSeq: () => 0,
  aiThreadFocusId: () => null,
  focusAIThread: () => {},
};

const aiState = {
  activeThreadId: '' as string,
  activeThread: null as MockThread | null,
  waitingPrompt: null as MockWaitingPrompt | null,
  structuredDrafts: {} as Record<string, { choiceId?: string; text?: string; writeSelected?: boolean }>,
  runIdByThread: {} as Record<string, string>,
  lastContextRunIdByThread: {} as Record<string, string>,
  pendingRunByThread: {} as Record<string, boolean>,
};
const [runStateVersion, setRunStateVersion] = createSignal(0);

const realtimeListeners = new Set<(event: any) => void>();

function touchRunState(): void {
  setRunStateVersion((version) => version + 1);
}

function isMockThreadRunActive(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toLowerCase();
  return normalized === 'accepted'
    || normalized === 'running'
    || normalized === 'waiting_approval'
    || normalized === 'recovering'
    || normalized === 'finalizing';
}

function setMockThreadRunId(threadId: string, runId: string, active: boolean): boolean {
  const tid = String(threadId ?? '').trim();
  if (!tid) return false;
  const rid = String(runId ?? '').trim();
  const previous = String(aiState.runIdByThread[tid] ?? '').trim();

  if (active && rid) {
    if (previous === rid) return false;
    aiState.runIdByThread[tid] = rid;
    return true;
  }

  if (!previous) return false;
  delete aiState.runIdByThread[tid];
  return true;
}

function setMockThreadLastContextRunId(threadId: string, runId: string): boolean {
  const tid = String(threadId ?? '').trim();
  if (!tid) return false;
  const rid = String(runId ?? '').trim();
  const previous = String(aiState.lastContextRunIdByThread[tid] ?? '').trim();

  if (!rid) {
    if (!previous) return false;
    delete aiState.lastContextRunIdByThread[tid];
    return true;
  }

  if (previous === rid) return false;
  aiState.lastContextRunIdByThread[tid] = rid;
  return true;
}

function setMockActiveThreadStatus(threadId: string, status: unknown): boolean {
  const tid = String(threadId ?? '').trim();
  if (!tid || !aiState.activeThread || String(aiState.activeThread.thread_id ?? '').trim() !== tid) {
    return false;
  }

  const normalized = String(status ?? '').trim().toLowerCase();
  const nextStatus = normalized || String(aiState.activeThread.run_status ?? '').trim();
  if (nextStatus === String(aiState.activeThread.run_status ?? '').trim()) {
    return false;
  }

  aiState.activeThread = {
    ...aiState.activeThread,
    run_status: nextStatus,
  };
  return true;
}

function applyMockRealtimeEvent(event: any): void {
  const tid = String(event?.threadId ?? '').trim();
  if (!tid) return;

  let changed = false;
  const eventType = String(event?.eventType ?? '').trim().toLowerCase();

  if (eventType === 'thread_summary') {
    const status = String(event?.runStatus ?? '').trim().toLowerCase();
    const activeRunId = String(event?.activeRunId ?? '').trim();
    const lastContextRunId = String(event?.lastContextRunId ?? '').trim();
    changed = setMockThreadRunId(tid, activeRunId, isMockThreadRunActive(status)) || changed;
    changed = setMockThreadLastContextRunId(tid, lastContextRunId) || changed;
    changed = setMockActiveThreadStatus(tid, status) || changed;
    if (aiState.pendingRunByThread[tid]) {
      delete aiState.pendingRunByThread[tid];
      changed = true;
    }
  } else if (eventType === 'stream_event') {
    const rid = String(event?.runId ?? '').trim();
    const streamKind = String(event?.streamKind ?? '').trim().toLowerCase();
    const streamType = String(event?.streamEvent?.type ?? '').trim().toLowerCase();
    if (rid && (streamKind === 'context' || streamType === 'context-usage' || streamType === 'context-compaction')) {
      changed = setMockThreadLastContextRunId(tid, rid) || changed;
    }
  } else {
    const rid = String(event?.runId ?? '').trim();
    const status = String(event?.runStatus ?? '').trim().toLowerCase();
    if (rid) {
      changed = setMockThreadRunId(tid, rid, isMockThreadRunActive(status)) || changed;
      changed = setMockActiveThreadStatus(tid, status) || changed;
      if (aiState.pendingRunByThread[tid]) {
        delete aiState.pendingRunByThread[tid];
        changed = true;
      }
    }
  }

  if (changed) {
    touchRunState();
  }
}

const aiContextValue = new Proxy({
  settings: { error: null },
  models: { loading: false, error: null },
  threads: { loading: false, error: null },
  aiEnabled: () => true,
  modelsReady: () => true,
  modelOptions: () => [{ value: 'model-test', label: 'Model Test' }],
  selectedDefaultModel: () => 'model-test',
  selectDefaultModel: vi.fn(),
  selectedThreadModel: () => String(aiState.activeThread?.model_id ?? 'model-test').trim() || 'model-test',
  selectThreadModel: vi.fn(),
  selectedSendModel: () => String(aiState.activeThread?.model_id ?? 'model-test').trim() || 'model-test',
  activeThreadModelLocked: () => false,
  activeThreadId: () => aiState.activeThreadId || null,
  activeThread: () => aiState.activeThread,
  activeThreadWaitingPrompt: () => aiState.waitingPrompt,
  getStructuredPromptDrafts: () => aiState.structuredDrafts,
  submitStructuredPromptResponse: submitStructuredPromptResponseMock,
  setStructuredPromptDraft: (_threadId: string, _promptId: string, questionId: string, draft: { choiceId?: string; text?: string; writeSelected?: boolean } | null) => {
    const qid = String(questionId ?? '').trim();
    if (!qid) return;
    if (!draft) {
      delete aiState.structuredDrafts[qid];
      return;
    }
    aiState.structuredDrafts[qid] = {
      choiceId: draft.choiceId,
      text: draft.text,
      writeSelected: draft.writeSelected,
    };
  },
  createThread: async () => ({ thread_id: 'thread-created' }),
  creatingThread: () => false,
  ensureThreadForSend: async () => {
    if (aiState.activeThreadId) return aiState.activeThreadId;
    aiState.activeThreadId = 'thread-created';
    aiState.activeThread = {
      thread_id: 'thread-created',
      title: 'Created thread',
      model_id: 'model-test',
      execution_mode: 'act',
      working_dir: '/workspace',
      queued_turn_count: 0,
      run_status: 'idle',
    };
    return aiState.activeThreadId;
  },
  setDraftMode: () => {},
  draftWorkingDir: () => '/workspace',
  setDraftWorkingDir: () => {},
  markThreadPendingRun: (threadId: string) => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return;
    aiState.pendingRunByThread[tid] = true;
    if (aiState.activeThread && String(aiState.activeThread.thread_id ?? '').trim() === tid) {
      aiState.activeThread = {
        ...aiState.activeThread,
        run_status: 'accepted',
      };
    }
    touchRunState();
  },
  clearThreadPendingRun: (threadId: string) => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return;
    delete aiState.pendingRunByThread[tid];
    if (aiState.activeThread && String(aiState.activeThread.thread_id ?? '').trim() === tid) {
      aiState.activeThread = {
        ...aiState.activeThread,
        run_status: String(aiState.runIdByThread[tid] ?? '').trim() ? 'running' : 'idle',
      };
    }
    touchRunState();
  },
  confirmThreadRun: (threadId: string, runId: string) => {
    const tid = String(threadId ?? '').trim();
    const rid = String(runId ?? '').trim();
    if (!tid || !rid) return;
    aiState.runIdByThread[tid] = rid;
    delete aiState.pendingRunByThread[tid];
    if (aiState.activeThread && String(aiState.activeThread.thread_id ?? '').trim() === tid) {
      aiState.activeThread = {
        ...aiState.activeThread,
        run_status: 'running',
      };
    }
    touchRunState();
  },
  runIdForThread: (threadId: string) => {
    runStateVersion();
    return aiState.runIdByThread[String(threadId ?? '').trim()] ?? null;
  },
  lastContextRunIdForThread: (threadId: string) => {
    runStateVersion();
    return aiState.lastContextRunIdByThread[String(threadId ?? '').trim()] ?? null;
  },
  consumeWaitingPrompt: () => {
    aiState.waitingPrompt = null;
    if (aiState.activeThread) {
      aiState.activeThread = { ...aiState.activeThread, run_status: 'running' };
    }
    touchRunState();
  },
  bumpThreadsSeq: () => {},
  isThreadRunning: (threadId: string | null | undefined) => {
    runStateVersion();
    const tid = String(threadId ?? '').trim();
    if (!tid) return false;
    if (aiState.pendingRunByThread[tid]) return true;
    if (String(aiState.runIdByThread[tid] ?? '').trim()) return true;
    if (aiState.activeThread && String(aiState.activeThread.thread_id ?? '').trim() === tid) {
      return isMockThreadRunActive(aiState.activeThread.run_status);
    }
    return false;
  },
  onRealtimeEvent: (handler: (event: any) => void) => {
    realtimeListeners.add(handler);
    return () => {
      realtimeListeners.delete(handler);
    };
  },
}, {
  get(target, prop) {
    if (prop in target) return target[prop as keyof typeof target];
    return () => undefined;
  },
});

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  useNotification: () => ({
    error: notificationErrorMock,
    info: notificationInfoMock,
    success: notificationSuccessMock,
  }),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    CheckCircle: Icon,
    ChevronUp: Icon,
    Code: Icon,
    FileText: Icon,
    Pencil: Icon,
    Settings: Icon,
    Sparkles: Icon,
    Stop: Icon,
    Terminal: Icon,
    Trash: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: () => <div />,
  SnakeLoader: () => <div />,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button
      type={props.type ?? 'button'}
      class={props.class}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      aria-label={props['aria-label']}
    >
      {props.children}
    </button>
  ),
  ConfirmDialog: (props: any) => (props.open ? <div>{props.children}</div> : null),
  Dialog: (props: any) => (props.open ? <div>{props.children}</div> : null),
  Dropdown: (props: any) => (
    <div data-testid="dropdown">
      {props.trigger}
      <div data-testid="dropdown-items">
        {(props.items ?? []).map((item: any) => (
          <button
            type="button"
            data-testid={`dropdown-item-${item.id}`}
            onClick={() => props.onSelect?.(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  ),
  DirectoryPicker: () => null,
  Input: (props: any) => (
    <input
      class={props.class}
      value={props.value}
      onInput={props.onInput}
      onChange={props.onChange}
      placeholder={props.placeholder}
      disabled={props.disabled}
    />
  ),
  Select: (props: any) => (
    <select
      data-testid={props['data-testid']}
      class={props.class}
      value={props.value}
      disabled={props.disabled}
      title={props.title}
      onChange={(event) => props.onChange?.((event.currentTarget as HTMLSelectElement).value)}
    >
      {props.placeholder ? <option value="">{props.placeholder}</option> : null}
      {(props.options ?? []).map((option: any) => {
        const value = String(option?.value ?? option?.id ?? '').trim();
        return (
          <option value={value}>
            {String(option?.label ?? value)}
          </option>
        );
      })}
    </select>
  ),
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
  Tooltip: (props: any) => <>{props.children}</>,
}));

vi.mock('solid-motionone', () => ({
  Motion: {
    div: (props: any) => <div {...props}>{props.children}</div>,
    button: (props: any) => (
      <button {...props} type={props.type ?? 'button'}>
        {props.children}
      </button>
    ),
  },
}));

vi.mock('@floegence/floe-webapp-protocol', () => {
  class RpcError extends Error {
    code: number;
    constructor(args: { code: number; message?: string }) {
      super(args.message ?? '');
      this.code = args.code;
    }
  }

  return {
    RpcError,
    useProtocol: () => ({
      status: () => protocolState.status,
      client: () => ({ id: 'client-1' }),
      error: () => null,
      connect: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      disconnect: vi.fn(),
    }),
  };
});

vi.mock('./EnvContext', () => ({
  EnvContext: createContext(envContextValue as any),
  useEnvContext: () => envContextValue,
}));

vi.mock('./AIChatContext', () => ({
  AIChatContext: createContext(aiContextValue as any),
  useAIChatContext: () => aiContextValue,
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    fs: {
      getPathContext: getPathContextMock,
    },
    ai: {
      subscribeThread: subscribeThreadMock,
      sendUserTurn: sendUserTurnMock,
      listMessages: listMessagesMock,
      getActiveRunSnapshot: getActiveRunSnapshotMock,
      setToolCollapsed: setToolCollapsedMock,
      stopThread: stopThreadMock,
      approveTool: approveToolMock,
    },
  }),
}));

vi.mock('../services/gatewayApi', () => ({
  fetchGatewayJSON: fetchGatewayJSONMock,
  gatewayRequestCredentials: gatewayRequestCredentialsMock,
  prepareGatewayRequestInit: prepareGatewayRequestInitMock,
  uploadGatewayFile: uploadGatewayFileMock,
}));

vi.mock('./aiPermissions', () => ({
  hasRWXPermissions: () => true,
}));

vi.mock('../widgets/ChatFileBrowserFAB', () => ({
  ChatFileBrowserFAB: () => null,
}));

vi.mock('../icons/FlowerIcon', () => ({
  FlowerIcon: () => <span />,
}));

vi.mock('./aiBlockPresentation', () => ({
  decorateMessageBlocks: (message: unknown) => message,
  decorateStreamEvent: (event: unknown) => event,
}));

function resetScenario() {
  protocolState.status = 'connected';
  fetchGatewayJSONMock.mockImplementation(defaultFetchGatewayJSON);
  uploadGatewayFileMock.mockImplementation(async (_file: File) => '/_redeven_proxy/api/ai/uploads/upl_test');
  prepareGatewayRequestInitMock.mockImplementation(async (init: RequestInit = {}) => init);
  aiContextValue.selectedDefaultModel = () => 'model-test';
  aiContextValue.selectDefaultModel = vi.fn();
  aiContextValue.selectedThreadModel = () => String(aiState.activeThread?.model_id ?? 'model-test').trim() || 'model-test';
  aiContextValue.selectThreadModel = vi.fn();
  aiContextValue.selectedSendModel = () => String(aiState.activeThread?.model_id ?? 'model-test').trim() || 'model-test';
  aiContextValue.activeThreadModelLocked = () => false;
  aiState.activeThreadId = 'thread-1';
  aiState.activeThread = {
    thread_id: 'thread-1',
    title: 'Thread 1',
    model_id: 'model-test',
    execution_mode: 'act',
    working_dir: '/workspace',
    queued_turn_count: 0,
    run_status: 'idle',
  };
  aiState.waitingPrompt = null;
  aiState.structuredDrafts = {};
  aiState.runIdByThread = {};
  aiState.lastContextRunIdByThread = {};
  aiState.pendingRunByThread = {};
  touchRunState();
  realtimeListeners.clear();
}

function emitRealtimeEvent(event: any) {
  applyMockRealtimeEvent(event);
  Array.from(realtimeListeners).forEach((listener) => {
    listener(event);
  });
}

function emitAssistantRealtimeMessageStart(messageId = 'assistant-realtime-1') {
  emitRealtimeEvent({
    threadId: 'thread-1',
    eventType: 'stream_event',
    streamEvent: {
      type: 'message-start',
      messageId,
    },
  });
  emitRealtimeEvent({
    threadId: 'thread-1',
    eventType: 'stream_event',
    streamEvent: {
      type: 'block-start',
      messageId,
      blockIndex: 0,
      blockType: 'markdown',
    },
  });
  return messageId;
}

function emitAssistantRealtimeDelta(messageId: string, delta: string) {
  emitRealtimeEvent({
    threadId: 'thread-1',
    eventType: 'stream_event',
    streamEvent: {
      type: 'block-delta',
      messageId,
      blockIndex: 0,
      delta,
    },
  });
}

function emitAssistantRealtimeBlockSet(messageId: string, blockIndex: number, block: Record<string, unknown>) {
  emitRealtimeEvent({
    threadId: 'thread-1',
    eventType: 'stream_event',
    streamEvent: {
      type: 'block-set',
      messageId,
      blockIndex,
      block,
    },
  });
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(check: () => void): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      check();
      return;
    } catch (err) {
      lastError = err;
      await flushAsync();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function waitForActiveRunSnapshotRecovery(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ACTIVE_RUN_SNAPSHOT_RECOVERY_SETTLE_MS));
  await flushAsync();
}

async function renderPage() {
  const mod = await import('./EnvAIPage');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <mod.EnvAIPage />, host);
  await flushAsync();
  return { host, dispose };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function queuedPanel(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.flower-queued-turns-panel:not(.flower-followups-drafts-panel)');
}

function draftsPanel(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.flower-followups-drafts-panel');
}

function transcriptRegion(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.flower-chat-transcript-main');
}

function bottomDock(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.flower-chat-bottom-dock');
}

function bottomDockSupport(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.flower-chat-bottom-dock-support');
}

function headerActions(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.flower-chat-header-actions');
}

function composerPrimaryRow(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.flower-chat-input-primary-row');
}

function composerMetaRail(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.flower-chat-input-meta-rail');
}

function inputComposer(host: HTMLElement, value: string) {
  const textarea = host.querySelector('textarea');
  expect(textarea).toBeTruthy();
  const element = textarea as HTMLTextAreaElement;
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  return element;
}

function composeTextWithoutInput(host: HTMLElement, value: string) {
  const textarea = host.querySelector('textarea');
  expect(textarea).toBeTruthy();
  const element = textarea as HTMLTextAreaElement;
  element.dispatchEvent(new Event('compositionstart', { bubbles: true }));
  element.value = value;
  element.dispatchEvent(new Event('compositionupdate', { bubbles: true }));
  return element;
}

function makeStreamingAssistantSnapshot(messageId = 'assistant-streaming-1') {
  return {
    ok: true,
    runId: 'run-send-1',
    messageJson: {
      id: messageId,
      role: 'assistant',
      status: 'streaming',
      timestamp: Date.now(),
      blocks: [
        { type: 'markdown', content: '' },
      ],
    },
  };
}

function makeCompletedAssistantTranscriptMessage(messageId = 'assistant-complete-1') {
  return {
    id: messageId,
    role: 'assistant',
    status: 'complete',
    timestamp: Date.now(),
    blocks: [
      { type: 'thinking', content: 'Tracing the live reducer path. Capturing the missing tail.' },
      { type: 'markdown', content: 'Final answer recovered from transcript.' },
    ],
  };
}

function makeCompletedEmptyAssistantMessage(messageId = 'assistant-empty-1') {
  return {
    id: messageId,
    role: 'assistant',
    status: 'complete',
    timestamp: Date.now(),
    blocks: [
      { type: 'markdown', content: '' },
    ],
  };
}

function assistantRunIndicator(host: HTMLElement): HTMLElement | null {
  return liveAssistantSurface(host)?.querySelector('.flower-message-run-indicator')
    ?? host.querySelector('.flower-message-run-indicator');
}

function liveRunPlaceholder(host: HTMLElement): HTMLElement | null {
  return liveAssistantSurface(host)?.querySelector('.chat-markdown-empty-streaming')
    ?? host.querySelector('.chat-markdown-empty-streaming');
}

function liveRunAnswerText(host: HTMLElement): HTMLElement | null {
  return liveAssistantSurface(host)?.querySelector('.chat-streaming-text')
    ?? host.querySelector('.chat-streaming-text');
}

function liveRunTail(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.chat-message-list-tail');
}

function liveAssistantSurface(host: HTMLElement): HTMLElement | null {
  return liveRunTail(host)?.querySelector('.chat-live-assistant-surface')
    ?? host.querySelector('.chat-live-assistant-surface');
}

type SubmitTrigger = 'button' | 'enter';

function clickButton(host: HTMLElement, title: string) {
  const button = Array.from(host.querySelectorAll('button')).find((item) => item.getAttribute('title') === title);
  expect(button).toBeTruthy();
  (button as HTMLButtonElement).click();
}

function submitComposer(host: HTMLElement, trigger: SubmitTrigger, buttonTitle: string) {
  if (trigger === 'button') {
    clickButton(host, buttonTitle);
    return;
  }

  const textarea = host.querySelector('textarea');
  expect(textarea).toBeTruthy();
  textarea!.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  }));
}

export function registerEnvAIPageSendTests() {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resetScenario();

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })),
    });

    const raf = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  describe('EnvAIPage header model controls', () => {
    it('shows a default-model picker for a new chat and wires it to selectDefaultModel', async () => {
      aiState.activeThreadId = '';
      aiState.activeThread = null;
      aiContextValue.modelOptions = () => [
        { value: 'model-test', label: 'Model Test' },
        { value: 'model-next', label: 'Model Next' },
      ];
      aiContextValue.selectedDefaultModel = () => 'model-test';
      aiContextValue.selectDefaultModel = vi.fn();

      const { host, dispose } = await renderPage();
      try {
        const defaultControl = host.querySelector('[data-testid="default-model-control"]');
        const defaultSelect = defaultControl?.querySelector('select') as HTMLSelectElement | null;

        expect(defaultControl).toBeTruthy();
        expect(host.querySelector('[data-testid="thread-model-control"]')).toBeNull();
        expect(host.querySelector('[data-testid="thread-model-locked-badge"]')).toBeNull();

        defaultSelect!.value = 'model-next';
        defaultSelect!.dispatchEvent(new Event('change', { bubbles: true }));

        expect(aiContextValue.selectDefaultModel).toHaveBeenCalledWith('model-next');
      } finally {
        dispose();
      }
    }, 20000);

    it('shows a thread-model picker for an unlocked active thread and wires it to selectThreadModel', async () => {
      aiContextValue.modelOptions = () => [
        { value: 'model-test', label: 'Model Test' },
        { value: 'model-next', label: 'Model Next' },
      ];
      aiContextValue.selectedThreadModel = () => 'model-test';
      aiContextValue.selectThreadModel = vi.fn();
      aiContextValue.activeThreadModelLocked = () => false;

      const { host, dispose } = await renderPage();
      try {
        const threadControl = host.querySelector('[data-testid="thread-model-control"]');
        const threadSelect = threadControl?.querySelector('select') as HTMLSelectElement | null;

        expect(threadControl).toBeTruthy();
        expect(host.querySelector('[data-testid="default-model-control"]')).toBeNull();
        expect(host.querySelector('[data-testid="thread-model-locked-badge"]')).toBeNull();

        threadSelect!.value = 'model-next';
        threadSelect!.dispatchEvent(new Event('change', { bubbles: true }));

        expect(aiContextValue.selectThreadModel).toHaveBeenCalledWith('model-next');
      } finally {
        dispose();
      }
    }, 20000);

    it('shows a locked thread model badge instead of an editable picker', async () => {
      aiState.activeThread = {
        ...(aiState.activeThread ?? {
          thread_id: 'thread-1',
          title: 'Thread 1',
          model_id: 'model-locked',
          execution_mode: 'act',
          working_dir: '/workspace',
          queued_turn_count: 0,
          run_status: 'idle',
        }),
        model_id: 'model-locked',
      };
      aiContextValue.modelOptions = () => [{ value: 'model-locked', label: 'Locked Model' }];
      aiContextValue.selectedThreadModel = () => 'model-locked';
      aiContextValue.activeThreadModelLocked = () => true;

      const { host, dispose } = await renderPage();
      try {
        const lockedBadge = host.querySelector('[data-testid="thread-model-locked-badge"]');

        expect(lockedBadge).toBeTruthy();
        expect(lockedBadge?.textContent).toContain('Locked Model');
        expect(lockedBadge?.textContent).toContain('Locked');
        expect(host.querySelector('[data-testid="thread-model-control"]')).toBeNull();
        expect(host.querySelector('[data-testid="default-model-control"]')).toBeNull();
      } finally {
        dispose();
      }
    });
  });

  describe('EnvAIPage composer send flow', () => {
    it('uses the shared transcript shell for new chat empty state and keeps the composer in the bottom dock', async () => {
      const { host, dispose } = await renderPage();
      try {
        const transcript = transcriptRegion(host);
        const dock = bottomDock(host);
        const textarea = host.querySelector('textarea');

        expect(transcript).toBeTruthy();
        expect(dock).toBeTruthy();
        expect(transcript?.textContent).toContain(`Hello! I'm Flower`);
        expect(dock?.contains(textarea as Node)).toBe(true);
      } finally {
        dispose();
      }
    });

    it('keeps low-frequency header actions inside the overflow menu and renders the compact composer structure', async () => {
      const { host, dispose } = await renderPage();
      try {
        const actions = headerActions(host);
        const primaryRow = composerPrimaryRow(host);
        const metaRail = composerMetaRail(host);

        expect(actions).toBeTruthy();
        expect(actions?.querySelector('[aria-label="Rename"]')).toBeNull();
        expect(actions?.querySelector('[aria-label="Delete"]')).toBeNull();
        expect(actions?.querySelector('[aria-label="Settings"]')).toBeNull();
        expect(actions?.querySelector('[aria-label="More actions"]')).toBeTruthy();
        expect(host.textContent).toContain('Rename chat');
        expect(host.textContent).toContain('Delete chat');
        expect(host.textContent).toContain('AI settings');

        expect(primaryRow).toBeTruthy();
        expect(primaryRow?.querySelector('textarea')).toBeTruthy();
        expect(primaryRow?.querySelector('button[title="Send message"]')).toBeTruthy();
        expect(metaRail).toBeTruthy();
        expect(metaRail?.querySelector('.flower-chat-working-dir-chip')).toBeTruthy();
        expect(metaRail?.querySelector('button[title="Add attachments"]')).toBeTruthy();
        expect(metaRail?.querySelector('button[title="Edit working directory"]')).toBeNull();
        expect(host.querySelector('.chat-input-toolbar-left')).toBeNull();
        expect(host.querySelector('.chat-input-toolbar-right')).toBeNull();
      } finally {
        dispose();
      }
    });

    ([
      { trigger: 'button', label: 'send button', buttonTitle: 'Send message' },
      { trigger: 'enter', label: 'Enter key', buttonTitle: 'Send message' },
    ] as const).forEach(({ trigger, label, buttonTitle }) => {
      it(`sends normal composer messages through sendUserTurn via ${label}`, async () => {
        const { host, dispose } = await renderPage();
        try {
          inputComposer(host, 'hello from Flower');
          submitComposer(host, trigger, buttonTitle);
          await flushAsync();

          expect(sendUserTurnMock).toHaveBeenCalledTimes(1);
          expect(sendUserTurnMock).toHaveBeenCalledWith(expect.objectContaining({
            threadId: 'thread-1',
            model: 'model-test',
            input: expect.objectContaining({
              text: 'hello from Flower',
            }),
          }));
          expect(submitStructuredPromptResponseMock).not.toHaveBeenCalled();
        } finally {
          dispose();
        }
      });
    });

    it('shows the assistant placeholder immediately after send when realtime start arrives', async () => {
      getActiveRunSnapshotMock.mockResolvedValueOnce({ ok: false });

      const { host, dispose } = await renderPage();
      try {
        inputComposer(host, 'show me the pending assistant slot');
        submitComposer(host, 'button', 'Send message');
        await flushAsync();

        const messageId = emitAssistantRealtimeMessageStart('assistant-live-send');
        await flushAsync();

        const assistant = host.querySelector('.chat-message-item-assistant');
        expect(assistant).toBeTruthy();
        expect(liveRunPlaceholder(host)).toBeTruthy();
        emitAssistantRealtimeDelta(messageId, 'Hello');
        await flushAsync();

        await waitForActiveRunSnapshotRecovery();
        expect(getActiveRunSnapshotMock).toHaveBeenCalledTimes(2);
      } finally {
        dispose();
      }
    });

    it('keeps the streaming cursor at the bottom of non-empty assistant output', async () => {
      const { host, dispose } = await renderPage();
      try {
        const messageId = emitAssistantRealtimeMessageStart('assistant-live-cursor');
        await flushAsync();

        emitAssistantRealtimeDelta(messageId, 'Hello Flower');
        await flushAsync();

        await waitFor(() => {
          const block = liveRunAnswerText(host);
          expect(block?.textContent).toContain('Hello Flower');
          expect(host.querySelector('.chat-message-item-assistant .chat-markdown-streaming-cursor-row')).toBeTruthy();
          expect(liveRunPlaceholder(host)).toBeNull();
        });
      } finally {
        dispose();
      }
    });

    it('keeps the active live answer block mounted while batched realtime deltas are applied', async () => {
      const { host, dispose } = await renderPage();
      try {
        const messageId = 'assistant-batched-deltas';
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'message-start',
            messageId,
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-start',
            messageId,
            blockIndex: 0,
            blockType: 'markdown',
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-delta',
            messageId,
            blockIndex: 0,
            delta: 'Hello',
          },
        });
        await flushAsync();

        const firstBlock = liveRunAnswerText(host);
        expect(firstBlock).toBeTruthy();

        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-delta',
            messageId,
            blockIndex: 0,
            delta: ' world',
          },
        });
        await flushAsync();

        const nextBlock = liveRunAnswerText(host);
        expect(nextBlock).toBe(firstBlock);
        await waitFor(() => {
          expect(host.querySelector('.chat-message-item-assistant')?.textContent).toContain('Hello world');
        });
      } finally {
        dispose();
      }
    });

    it('keeps the visible assistant answer on screen when a live frame temporarily regresses to hidden-only content', async () => {
      const { host, dispose } = await renderPage();
      try {
        const messageId = emitAssistantRealtimeMessageStart('assistant-hidden-regression');
        emitAssistantRealtimeDelta(messageId, 'Visible answer');
        await waitFor(() => {
          expect(host.querySelector('.chat-message-item-assistant')?.textContent).toContain('Visible answer');
        });

        const assistantRow = host.querySelector('.chat-message-item-assistant');
        expect(assistantRow).toBeTruthy();

        emitAssistantRealtimeBlockSet(messageId, 0, { type: 'thinking' });
        emitAssistantRealtimeDelta(messageId, 'Hidden reasoning');
        await flushAsync();

        expect(host.querySelector('.chat-message-item-assistant')).toBe(assistantRow);
        expect(host.querySelector('.chat-message-item-assistant')?.textContent).toContain('Visible answer');
        expect(liveRunPlaceholder(host)).toBeNull();

        emitAssistantRealtimeBlockSet(messageId, 0, { type: 'markdown', content: '' });
        await flushAsync();

        expect(host.querySelector('.chat-message-item-assistant')?.textContent).toContain('Visible answer');
        expect(liveRunPlaceholder(host)).toBeNull();

        emitAssistantRealtimeDelta(messageId, 'Visible answer extended');
        await waitFor(() => {
          expect(host.querySelector('.chat-message-item-assistant')?.textContent).toContain('Visible answer extended');
        });
        expect(host.querySelectorAll('.chat-message-item-assistant')).toHaveLength(1);
      } finally {
        dispose();
      }
    });

    it('keeps the inline run indicator mounted across streaming deltas', async () => {
      const { host, dispose } = await renderPage();
      try {
        const messageId = 'assistant-indicator-stability';
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'message-start',
            messageId,
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-start',
            messageId,
            blockIndex: 0,
            blockType: 'markdown',
          },
        });
        await flushAsync();

        const firstIndicator = host.querySelector('.flower-message-run-indicator');
        expect(firstIndicator).toBeTruthy();

        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-delta',
            messageId,
            blockIndex: 0,
            delta: 'Hello Flower',
          },
        });
        await flushAsync();
        await waitFor(() => {
          expect(host.querySelector('.chat-message-item-assistant')?.textContent).toContain('Hello Flower');
        });

        const nextIndicator = host.querySelector('.flower-message-run-indicator');
        expect(nextIndicator).toBe(firstIndicator);
      } finally {
        dispose();
      }
    });

    it('does not leave a ghost streaming cursor above later markdown content when block indices skip ahead', async () => {
      const { host, dispose } = await renderPage();
      try {
        const messageId = 'assistant-gap-cursor';
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'message-start',
            messageId,
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-start',
            messageId,
            blockIndex: 1,
            blockType: 'markdown',
          },
        });
        await flushAsync();

        expect(host.querySelectorAll('.chat-message-item-assistant .chat-markdown-empty-streaming')).toHaveLength(1);

        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-delta',
            messageId,
            blockIndex: 1,
            delta: 'Hello from the latest block',
          },
        });
        await flushAsync();

        expect(host.querySelectorAll('.chat-message-item-assistant .chat-markdown-empty-streaming')).toHaveLength(0);
        await waitFor(() => {
          expect(host.querySelector('.chat-message-item-assistant')?.textContent).toContain('Hello from the latest block');
        });
      } finally {
        dispose();
      }
    });

    it('hides an earlier empty streaming markdown block once a later markdown block starts rendering', async () => {
      const { host, dispose } = await renderPage();
      try {
        const messageId = 'assistant-multi-markdown-cursor';
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'message-start',
            messageId,
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-start',
            messageId,
            blockIndex: 0,
            blockType: 'markdown',
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-start',
            messageId,
            blockIndex: 1,
            blockType: 'markdown',
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-delta',
            messageId,
            blockIndex: 1,
            delta: 'Tail block content',
          },
        });
        await flushAsync();

        expect(host.querySelectorAll('.chat-message-item-assistant .chat-markdown-empty-streaming')).toHaveLength(0);
        await waitFor(() => {
          expect(host.querySelector('.chat-message-item-assistant')?.textContent).toContain('Tail block content');
        });
      } finally {
        dispose();
      }
    });

    it('keeps a single streaming cursor when multiple markdown blocks are visible in the same assistant message', async () => {
      const { host, dispose } = await renderPage();
      try {
        const messageId = 'assistant-single-cursor-owner';
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'message-start',
            messageId,
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-start',
            messageId,
            blockIndex: 0,
            blockType: 'markdown',
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-delta',
            messageId,
            blockIndex: 0,
            delta: 'Intro text',
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-start',
            messageId,
            blockIndex: 1,
            blockType: 'shell',
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-set',
            messageId,
            blockIndex: 1,
            block: {
              type: 'shell',
              command: 'echo hi',
              status: 'success',
              output: 'hi',
            },
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-start',
            messageId,
            blockIndex: 2,
            blockType: 'markdown',
          },
        });
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'block-delta',
            messageId,
            blockIndex: 2,
            delta: 'Tail block content',
          },
        });
        await flushAsync();

        await waitFor(() => {
          expect(host.querySelector('.chat-message-item-assistant')?.textContent).toContain('Intro text');
          expect(host.querySelector('.chat-message-item-assistant')?.textContent).toContain('Tail block content');
          expect(host.querySelectorAll('.chat-message-item-assistant .chat-markdown-streaming-cursor-row')).toHaveLength(1);
        });
      } finally {
        dispose();
      }
    });

    it('keeps thinking blocks hidden from the default transcript view', async () => {
      const { host, dispose } = await renderPage();
      try {
        const messageId = emitAssistantRealtimeMessageStart('assistant-live-reasoning');
        emitAssistantRealtimeBlockSet(messageId, 0, { type: 'thinking' });
        emitAssistantRealtimeDelta(messageId, 'Tracing the live reducer path.');
        await flushAsync();

        const reasoning = host.querySelector('.chat-thinking-block');
        expect(reasoning).toBeNull();
        expect(liveRunPlaceholder(host)).toBeTruthy();
        expect(assistantRunIndicator(host)).toBeTruthy();
      } finally {
        dispose();
      }
    });

    it('falls back to the active run snapshot after send when realtime start is missing', async () => {
      getActiveRunSnapshotMock
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce(makeStreamingAssistantSnapshot('assistant-recovery-send'));

      const { host, dispose } = await renderPage();
      try {
        inputComposer(host, 'recover the pending assistant slot');
        submitComposer(host, 'button', 'Send message');
        await flushAsync();

        expect(host.querySelector('.chat-message-item-assistant')).toBeTruthy();
        expect(assistantRunIndicator(host)).toBeTruthy();
        expect(liveRunPlaceholder(host)).toBeTruthy();

        await waitForActiveRunSnapshotRecovery();

        const assistant = host.querySelector('.chat-message-item-assistant');
        expect(assistant).toBeTruthy();
        expect(liveRunPlaceholder(host)).toBeTruthy();
        expect(getActiveRunSnapshotMock).toHaveBeenCalledTimes(2);
      } finally {
        dispose();
      }
    });

    it('keeps the active assistant render slot mounted while the pending placeholder hands off to realtime streaming', async () => {
      getActiveRunSnapshotMock.mockResolvedValueOnce({ ok: false });

      const { host, dispose } = await renderPage();
      try {
        inputComposer(host, 'hold the active assistant row steady');
        submitComposer(host, 'button', 'Send message');
        await flushAsync();

        expect(host.querySelectorAll('.chat-message-item-assistant')).toHaveLength(1);
        expect(host.querySelector('.chat-message-item-assistant .chat-markdown-block')).toBeTruthy();
        expect(assistantRunIndicator(host)).toBeTruthy();
        expect(liveRunPlaceholder(host)).toBeTruthy();

        const messageId = emitAssistantRealtimeMessageStart('assistant-row-handoff');
        emitAssistantRealtimeDelta(messageId, 'Hello Flower');
        await flushAsync();

        expect(host.querySelectorAll('.chat-message-item-assistant')).toHaveLength(1);
        expect(host.querySelector('.chat-message-item-assistant .chat-markdown-block')).toBeTruthy();
        expect(assistantRunIndicator(host)).toBeTruthy();
        await waitFor(() => {
          expect(host.querySelector('.chat-message-item-assistant')?.textContent).toContain('Hello Flower');
        });
      } finally {
        dispose();
      }
    });

    it('renders the live assistant surface through the non-virtualized transcript tail', async () => {
      getActiveRunSnapshotMock.mockResolvedValueOnce({ ok: false });

      const { host, dispose } = await renderPage();
      try {
        inputComposer(host, 'route the live surface through the transcript tail');
        submitComposer(host, 'button', 'Send message');
        await flushAsync();

        expect(liveRunTail(host)).toBeTruthy();
        expect(liveRunTail(host)?.querySelector('.chat-message-item-assistant')).toBeTruthy();
        expect(assistantRunIndicator(host)).toBeTruthy();
      } finally {
        dispose();
      }
    });

    it('restores the assistant placeholder on initial thread load from active run snapshot', async () => {
      getActiveRunSnapshotMock.mockResolvedValueOnce(makeStreamingAssistantSnapshot('assistant-active-thread'));

      const { host, dispose } = await renderPage();
      try {
        await flushAsync();

        const assistant = host.querySelector('.chat-message-item-assistant');
        expect(assistant).toBeTruthy();
        expect(assistantRunIndicator(host)).toBeTruthy();
        expect(liveRunPlaceholder(host)).toBeTruthy();
      } finally {
        dispose();
      }
    });

    it('does not duplicate a settled assistant when the same-id active snapshot arrives on initial load', async () => {
      const messageId = 'assistant-inline-dedupe';
      listMessagesMock.mockImplementation(async (req: any): Promise<any> => {
        if (req?.tail) {
          return {
            messages: [{ rowId: 1, messageJson: makeCompletedAssistantTranscriptMessage(messageId) }],
            nextAfterRowId: 1,
            hasMore: false,
          };
        }
        return { messages: [], nextAfterRowId: 1, hasMore: false };
      });
      getActiveRunSnapshotMock.mockResolvedValueOnce(makeStreamingAssistantSnapshot(messageId));

      const { host, dispose } = await renderPage();
      try {
        await flushAsync();
        await flushAsync();

        expect(host.querySelectorAll('.chat-message-item-assistant')).toHaveLength(1);
        expect(host.textContent).toContain('Final answer recovered from transcript.');
        expect(liveRunPlaceholder(host)).toBeNull();
        expect(assistantRunIndicator(host)).toBeNull();
      } finally {
        dispose();
      }
    });

    it('does not render completed assistant messages that have no visible content', async () => {
      listMessagesMock.mockImplementation(async (req: any): Promise<any> => {
        if (req?.tail) {
          return { messages: [], nextAfterRowId: 0, hasMore: false };
        }
        if (Number(req?.afterRowId ?? 0) === 0) {
          return {
            messages: [
              {
                rowId: 1,
                messageJson: makeCompletedEmptyAssistantMessage('assistant-empty-complete'),
              },
            ],
            nextAfterRowId: 1,
            hasMore: false,
          };
        }
        return { messages: [], nextAfterRowId: 1, hasMore: false };
      });

      const { host, dispose } = await renderPage();
      try {
        await flushAsync();

        expect(host.querySelector('.chat-message-item-assistant')).toBeNull();
        expect(host.querySelector('.chat-markdown-block')).toBeNull();
      } finally {
        dispose();
      }
    });

    it('converges to the final transcript on terminal thread state after incomplete realtime delivery', async () => {
      listMessagesMock.mockImplementation(async (req: any): Promise<any> => {
        if (req?.tail) {
          return { messages: [], nextAfterRowId: 0, hasMore: false };
        }
        if (Number(req?.afterRowId ?? 0) === 0) {
          return {
            messages: [
              {
                rowId: 1,
                messageJson: makeCompletedAssistantTranscriptMessage('assistant-terminal-recovery'),
              },
            ],
            nextAfterRowId: 1,
            hasMore: false,
          };
        }
        return { messages: [], nextAfterRowId: 1, hasMore: false };
      });

      const { host, dispose } = await renderPage();
      try {
        const messageId = emitAssistantRealtimeMessageStart('assistant-terminal-recovery');
        emitAssistantRealtimeBlockSet(messageId, 0, { type: 'thinking' });
        emitAssistantRealtimeDelta(messageId, 'Tracing the live reducer path.');
        await flushAsync();

        emitRealtimeEvent({
          threadId: 'thread-1',
          runId: 'run-send-1',
          eventType: 'thread_state',
          runStatus: 'success',
          runError: '',
        });
        await flushAsync();
        await flushAsync();

        expect(host.textContent).toContain('Final answer recovered from transcript.');
        expect(liveRunPlaceholder(host)).toBeNull();
      } finally {
        dispose();
      }
    });

    it('renders the live-run indicator on the active inline assistant row after send', async () => {
      getActiveRunSnapshotMock.mockResolvedValueOnce({ ok: false });

      const { host, dispose } = await renderPage();
      try {
        inputComposer(host, 'show the inline run indicator');
        submitComposer(host, 'button', 'Send message');
        await flushAsync();
        emitAssistantRealtimeMessageStart('assistant-indicator-send');
        await flushAsync();

        const assistant = host.querySelector('.chat-message-item-assistant');
        expect(assistant).toBeTruthy();
        expect(assistantRunIndicator(host)).toBeTruthy();
        expect(host.querySelectorAll('.flower-message-run-indicator')).toHaveLength(1);
        expect(host.querySelector('.chat-working-indicator')).toBeNull();
      } finally {
        dispose();
      }
    });

    it('keeps same-run context telemetry visible when realtime context events arrive before send confirmation', async () => {
      const sendDeferred = createDeferred<{ runId: string; kind: string }>();
      sendUserTurnMock.mockImplementationOnce(async () => sendDeferred.promise);

      const { host, dispose } = await renderPage();
      try {
        inputComposer(host, 'show me the context chip continuity');
        submitComposer(host, 'button', 'Send message');
        await flushAsync();

        emitRealtimeEvent({
          threadId: 'thread-1',
          runId: 'run-send-1',
          streamKind: 'context',
          atUnixMs: 1710000000000,
          eventType: 'stream_event',
          streamEvent: {
            type: 'context-usage',
            payload: {
              estimate_tokens: 420,
              context_limit: 1000,
              usage_percent: 42,
            },
          },
        });
        await flushAsync();

        expect(bottomDock(host)?.textContent).toContain('42.0%');

        sendDeferred.resolve({ runId: 'run-send-1', kind: 'start' });
        await flushAsync();

        await waitFor(() => {
          expect(bottomDock(host)?.textContent).toContain('42.0%');
        });
      } finally {
        dispose();
      }
    });

    it('updates the live-run indicator label when lifecycle phase events arrive', async () => {
      getActiveRunSnapshotMock.mockResolvedValueOnce(makeStreamingAssistantSnapshot('assistant-active-thread'));

      const { host, dispose } = await renderPage();
      try {
        expect(assistantRunIndicator(host)).toBeTruthy();

        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'lifecycle-phase',
            phase: 'finalizing',
          },
        });
        await flushAsync();

        expect(assistantRunIndicator(host)?.textContent).toContain('Finalizing...');
      } finally {
        dispose();
      }
    });

    it('does not render the inline run indicator under user messages', async () => {
      getActiveRunSnapshotMock.mockResolvedValueOnce({ ok: false });

      const { host, dispose } = await renderPage();
      try {
        inputComposer(host, 'keep user messages clean');
        submitComposer(host, 'button', 'Send message');
        await flushAsync();
        emitAssistantRealtimeMessageStart('assistant-user-clean');
        await flushAsync();

        const userMessage = host.querySelector('.chat-message-item-user');
        expect(userMessage).toBeTruthy();
        expect(userMessage?.querySelector('.flower-message-run-indicator')).toBeNull();
      } finally {
        dispose();
      }
    });

    it('keeps the list-level working indicator disabled while chat streaming is active', async () => {
      const { host, dispose } = await renderPage();
      try {
        emitRealtimeEvent({
          threadId: 'thread-1',
          eventType: 'stream_event',
          streamEvent: {
            type: 'message-start',
            messageId: 'assistant-realtime-1',
          },
        });
        await flushAsync();

        expect(assistantRunIndicator(host)).toBeTruthy();
        expect(host.querySelector('.chat-working-indicator')).toBeNull();
      } finally {
        dispose();
      }
    });

    it('sends normal composer messages when crypto.randomUUID is unavailable', async () => {
      vi.stubGlobal('crypto', {
        getRandomValues: (buffer: Uint8Array) => {
          for (let index = 0; index < buffer.length; index += 1) {
            buffer[index] = index;
          }
          return buffer;
        },
      } as Crypto);

      const { host, dispose } = await renderPage();
      try {
        inputComposer(host, 'hello from insecure local bind');
        submitComposer(host, 'button', 'Send message');
        await flushAsync();

        expect(sendUserTurnMock).toHaveBeenCalledTimes(1);
        expect(sendUserTurnMock).toHaveBeenCalledWith(expect.objectContaining({
          threadId: 'thread-1',
          model: 'model-test',
          input: expect.objectContaining({
            text: 'hello from insecure local bind',
          }),
        }));
      } finally {
        dispose();
      }
    });

    it('sends composed text through sendUserTurn when the visible textarea value is ahead of input events', async () => {
      const { host, dispose } = await renderPage();
      try {
        const textarea = composeTextWithoutInput(host, '你好，Flower');
        const sendButton = Array.from(host.querySelectorAll('button')).find((item) => item.getAttribute('title') === 'Send message') as HTMLButtonElement | undefined;
        expect(sendButton).toBeTruthy();
        expect(sendButton?.disabled).toBe(false);

        clickButton(host, 'Send message');
        await flushAsync();

        expect(sendUserTurnMock).toHaveBeenCalledTimes(1);
        expect(sendUserTurnMock).toHaveBeenCalledWith(expect.objectContaining({
          input: expect.objectContaining({
            text: '你好，Flower',
          }),
        }));
        expect(textarea.value).toBe('');
      } finally {
        dispose();
      }
    });

    ([
      { trigger: 'button', label: 'send button', buttonTitle: 'Reply now' },
      { trigger: 'enter', label: 'Enter key', buttonTitle: 'Reply now' },
    ] as const).forEach(({ trigger, label, buttonTitle }) => {
      it(`routes waiting-user replies through structured prompt submission via ${label}`, async () => {
        aiState.activeThread = {
          ...(aiState.activeThread as MockThread),
          run_status: 'waiting_user',
        };
        aiState.waitingPrompt = {
          promptId: 'prompt-1',
          messageId: 'assistant-1',
          toolId: 'tool-ask-user',
          questions: [
            {
              id: 'question-1',
              header: 'Clarify',
              question: 'What logs should Flower inspect?',
              isSecret: false,
              responseMode: 'write',
              writeLabel: 'Your answer',
              writePlaceholder: 'Type your answer',
              choices: [],
            },
          ],
        };

        const { host, dispose } = await renderPage();
        try {
          inputComposer(host, 'Please inspect the build logs.');
          const metaRail = composerMetaRail(host);
          expect(metaRail?.textContent).toContain('Queue for later');
          submitComposer(host, trigger, buttonTitle);
          await flushAsync();

          expect(submitStructuredPromptResponseMock).toHaveBeenCalledTimes(1);
          expect(submitStructuredPromptResponseMock).toHaveBeenCalledWith(expect.objectContaining({
            threadId: 'thread-1',
            promptId: 'prompt-1',
            text: '',
            answers: {
              'question-1': {
                text: 'Please inspect the build logs.',
                writeSelected: true,
              },
            },
          }));
          expect(sendUserTurnMock).not.toHaveBeenCalled();
        } finally {
          dispose();
        }
      });
    });

    it('uses composer text as the selected custom write answer when the explicit write choice is already selected', async () => {
      aiState.activeThread = {
        ...(aiState.activeThread as MockThread),
        run_status: 'waiting_user',
      };
      aiState.waitingPrompt = {
        promptId: 'prompt-1',
        messageId: 'assistant-1',
        toolId: 'tool-ask-user',
        questions: [
            {
              id: 'question-1',
              header: 'Situation',
              question: 'Choose the closest situation.',
              isSecret: false,
              responseMode: 'select_or_write',
              writeLabel: 'None of the above',
              writePlaceholder: 'Type another answer',
              choices: [
                { choiceId: 'working', label: 'Already working', kind: 'select' },
                { choiceId: 'studying', label: 'Studying full time', kind: 'select' },
              ],
            },
          ],
        };
      aiState.structuredDrafts = {
        'question-1': {
          writeSelected: true,
        },
      };

      const { host, dispose } = await renderPage();
      try {
        inputComposer(host, 'Working and studying part time.');
        submitComposer(host, 'button', 'Reply now');
        await flushAsync();

        expect(submitStructuredPromptResponseMock).toHaveBeenCalledTimes(1);
        expect(submitStructuredPromptResponseMock).toHaveBeenCalledWith(expect.objectContaining({
          answers: {
            'question-1': {
              text: 'Working and studying part time.',
              writeSelected: true,
            },
          },
        }));
      } finally {
        dispose();
      }
    });

    it('falls back to the active run snapshot after waiting-user submit when realtime start is missing', async () => {
      aiState.activeThread = {
        ...(aiState.activeThread as MockThread),
        run_status: 'waiting_user',
      };
      aiState.waitingPrompt = {
        promptId: 'prompt-1',
        messageId: 'assistant-1',
        toolId: 'tool-ask-user',
        questions: [
            {
              id: 'question-1',
              header: 'Clarify',
              question: 'What logs should Flower inspect?',
              isSecret: false,
              responseMode: 'write',
              writeLabel: 'Your answer',
              writePlaceholder: 'Type your answer',
              choices: [],
            },
          ],
        };
      getActiveRunSnapshotMock
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce(makeStreamingAssistantSnapshot('assistant-waiting-recovery'));

      const { host, dispose } = await renderPage();
      try {
        inputComposer(host, 'Please inspect the build logs.');
        submitComposer(host, 'button', 'Reply now');
        await flushAsync();

        expect(submitStructuredPromptResponseMock).toHaveBeenCalledTimes(1);
        expect(host.querySelector('.chat-message-item-assistant')).toBeTruthy();
        expect(liveRunPlaceholder(host)).toBeTruthy();

        await waitForActiveRunSnapshotRecovery();

        expect(host.querySelector('.chat-message-item-assistant')).toBeTruthy();
        expect(liveRunPlaceholder(host)).toBeTruthy();
        expect(getActiveRunSnapshotMock).toHaveBeenCalledTimes(2);
      } finally {
        dispose();
      }
    });

    ([
      { trigger: 'button', label: 'send button', buttonTitle: 'Reply now' },
      { trigger: 'enter', label: 'Enter key', buttonTitle: 'Reply now' },
    ] as const).forEach(({ trigger, label, buttonTitle }) => {
      it(`keeps ambiguous waiting-user replies blocked via ${label}`, async () => {
        aiState.activeThread = {
          ...(aiState.activeThread as MockThread),
          run_status: 'waiting_user',
        };
        aiState.waitingPrompt = {
          promptId: 'prompt-1',
          messageId: 'assistant-1',
          toolId: 'tool-ask-user',
          questions: [
            {
              id: 'question-1',
              header: 'Scope',
              question: 'Which subsystem should Flower inspect?',
              isSecret: false,
              responseMode: 'write',
              writeLabel: 'Your answer',
              writePlaceholder: 'Type your answer',
              choices: [],
            },
            {
              id: 'question-2',
              header: 'Mode',
              question: 'Should Flower patch or only review?',
              isSecret: false,
              responseMode: 'select',
              choices: [
                { choiceId: 'plan', label: 'Plan', kind: 'select' },
                { choiceId: 'act', label: 'Act', kind: 'select' },
              ],
            },
          ],
        };

        const { host, dispose } = await renderPage();
        try {
          const textarea = inputComposer(host, 'Check the backend service.');
          const replyButton = Array.from(host.querySelectorAll('button')).find((item) => item.getAttribute('title') === 'Reply now') as HTMLButtonElement | undefined;
          expect(replyButton).toBeTruthy();
          expect(replyButton?.disabled).toBe(true);
          expect(host.textContent).toContain('Resolve all requested input fields before replying.');

          submitComposer(host, trigger, buttonTitle);
          await flushAsync();

          expect(submitStructuredPromptResponseMock).not.toHaveBeenCalled();
          expect(sendUserTurnMock).not.toHaveBeenCalled();
          expect(notificationErrorMock).not.toHaveBeenCalled();
          expect(textarea.value).toBe('Check the backend service.');
        } finally {
          dispose();
        }
      });
    });

    it('uses composer text as required option detail when the option is already selected', async () => {
      aiState.activeThread = {
        ...(aiState.activeThread as MockThread),
        run_status: 'waiting_user',
      };
      aiState.waitingPrompt = {
        promptId: 'prompt-1',
        messageId: 'assistant-1',
        toolId: 'tool-ask-user',
        questions: [
            {
              id: 'question-1',
              header: 'Situation',
              question: 'Choose the closest situation.',
              isSecret: false,
              responseMode: 'select_or_write',
              writeLabel: 'Other',
              writePlaceholder: 'Describe your current situation',
              choices: [
                { choiceId: 'working', label: 'Already working', kind: 'select' },
              ],
            },
          ],
        };
      aiState.structuredDrafts = {
        'question-1': {
          writeSelected: true,
        },
      };

      const { host, dispose } = await renderPage();
      try {
        inputComposer(host, 'Working and studying part time.');
        submitComposer(host, 'button', 'Reply now');
        await flushAsync();

        expect(submitStructuredPromptResponseMock).toHaveBeenCalledTimes(1);
        expect(submitStructuredPromptResponseMock).toHaveBeenCalledWith(expect.objectContaining({
          threadId: 'thread-1',
          promptId: 'prompt-1',
          text: '',
          answers: {
            'question-1': {
              text: 'Working and studying part time.',
              writeSelected: true,
            },
          },
        }));
      } finally {
        dispose();
      }
    });

    it('blocks composer text until an explicit custom write choice is selected for mixed-choice questions', async () => {
      aiState.activeThread = {
        ...(aiState.activeThread as MockThread),
        run_status: 'waiting_user',
      };
      aiState.waitingPrompt = {
        promptId: 'prompt-1',
        messageId: 'assistant-1',
        toolId: 'tool-ask-user',
        questions: [
            {
              id: 'question-1',
              header: 'Situation',
              question: 'Choose the closest situation.',
              isSecret: false,
              responseMode: 'select_or_write',
              writeLabel: 'None of the above',
              writePlaceholder: 'Type another answer',
              choices: [
                { choiceId: 'working', label: 'Already working', kind: 'select' },
              ],
            },
          ],
      };

      const { host, dispose } = await renderPage();
      try {
        const replyButton = Array.from(host.querySelectorAll('button')).find((item) => item.getAttribute('title') === 'Reply now') as HTMLButtonElement | undefined;
        expect(replyButton).toBeTruthy();
        inputComposer(host, 'Working and studying part time.');
        await flushAsync();

        expect(replyButton?.disabled).toBe(true);
        expect(host.textContent).toContain('Select one of the requested options before replying.');

        submitComposer(host, 'button', 'Reply now');
        await flushAsync();

        expect(submitStructuredPromptResponseMock).not.toHaveBeenCalled();
        expect(sendUserTurnMock).not.toHaveBeenCalled();
      } finally {
        dispose();
      }
    });
  });

  describe('EnvAIPage queued follow-ups panel visibility', () => {
    it('keeps the queued panel hidden while loading when the thread exposes no queued turns', async () => {
      const followupsDeferred = createDeferred<{ queued: any[]; drafts: any[]; revision: number; paused_reason: string }>();
      fetchGatewayJSONMock.mockImplementation(async (url: string) => {
        if (url.includes('/followups')) {
          return followupsDeferred.promise;
        }
        return defaultFetchGatewayJSON(url);
      });

      const { host, dispose } = await renderPage();
      try {
        expect(queuedPanel(host)).toBeNull();
        expect(host.textContent).not.toContain('Loading queued follow-ups...');
      } finally {
        followupsDeferred.resolve({ queued: [], drafts: [], revision: 0, paused_reason: '' });
        await flushAsync();
        dispose();
      }
    });

    it('shows the queued panel while details are loading when the thread already reports queued turns', async () => {
      aiState.activeThread = {
        ...(aiState.activeThread as MockThread),
        queued_turn_count: 2,
      };
      const followupsDeferred = createDeferred<{ queued: any[]; drafts: any[]; revision: number; paused_reason: string }>();
      fetchGatewayJSONMock.mockImplementation(async (url: string) => {
        if (url.includes('/followups')) {
          return followupsDeferred.promise;
        }
        return defaultFetchGatewayJSON(url);
      });

      const { host, dispose } = await renderPage();
      try {
        expect(queuedPanel(host)).toBeTruthy();
        expect(queuedPanel(host)?.textContent).toContain('Queued follow-ups');
        expect(host.textContent).toContain('Loading queued follow-ups...');
      } finally {
        followupsDeferred.resolve({ queued: [], drafts: [], revision: 0, paused_reason: '' });
        await flushAsync();
        dispose();
      }
    });

    it('renders queued follow-up items after follow-ups load', async () => {
      fetchGatewayJSONMock.mockImplementation(async (url: string) => {
        if (url.includes('/followups')) {
          return {
            queued: [
              {
                followup_id: 'followup-1',
                lane: 'queued',
                message_id: 'message-1',
                text: 'Inspect the deployment logs next.',
                model_id: 'model-test',
                execution_mode: 'act',
                position: 1,
                created_at_unix_ms: 1710000000000,
                attachments: [],
              },
            ],
            drafts: [],
            revision: 1,
            paused_reason: '',
          };
        }
        return defaultFetchGatewayJSON(url);
      });

      const { host, dispose } = await renderPage();
      try {
        expect(queuedPanel(host)).toBeTruthy();
        expect(host.textContent).toContain('Inspect the deployment logs next.');
      } finally {
        dispose();
      }
    });

    it('renders queued and draft follow-ups inside the shared bottom dock support region', async () => {
      fetchGatewayJSONMock.mockImplementation(async (url: string) => {
        if (url.includes('/followups')) {
          return {
            queued: [
              {
                followup_id: 'followup-1',
                lane: 'queued',
                message_id: 'message-1',
                text: 'Inspect the deployment logs next.',
                model_id: 'model-test',
                execution_mode: 'act',
                position: 1,
                created_at_unix_ms: 1710000000000,
                attachments: [],
              },
            ],
            drafts: [
              {
                followup_id: 'draft-1',
                lane: 'draft',
                message_id: 'message-draft-1',
                text: 'Draft the next investigation prompt.',
                model_id: 'model-test',
                execution_mode: 'plan',
                position: 1,
                created_at_unix_ms: 1710000000000,
                attachments: [],
              },
            ],
            revision: 3,
            paused_reason: '',
          };
        }
        return defaultFetchGatewayJSON(url);
      });

      const { host, dispose } = await renderPage();
      try {
        const support = bottomDockSupport(host);
        expect(support).toBeTruthy();
        expect(support?.contains(queuedPanel(host) as Node)).toBe(true);
        expect(support?.contains(draftsPanel(host) as Node)).toBe(true);
      } finally {
        dispose();
      }
    });

    it('does not render a standalone queued panel when an empty queue fails to load', async () => {
      fetchGatewayJSONMock.mockImplementation(async (url: string) => {
        if (url.includes('/followups')) {
          throw new Error('followups unavailable');
        }
        return defaultFetchGatewayJSON(url);
      });

      const { host, dispose } = await renderPage();
      try {
        expect(queuedPanel(host)).toBeNull();
        expect(host.textContent).not.toContain('followups unavailable');
      } finally {
        dispose();
      }
    });

    it('keeps draft follow-ups visible when queued follow-ups are empty', async () => {
      fetchGatewayJSONMock.mockImplementation(async (url: string) => {
        if (url.includes('/followups')) {
          return {
            queued: [],
            drafts: [
              {
                followup_id: 'draft-1',
                lane: 'draft',
                message_id: 'message-draft-1',
                text: 'Draft the next investigation prompt.',
                model_id: 'model-test',
                execution_mode: 'plan',
                position: 1,
                created_at_unix_ms: 1710000000000,
                attachments: [],
              },
            ],
            revision: 2,
            paused_reason: '',
          };
        }
        return defaultFetchGatewayJSON(url);
      });

      const { host, dispose } = await renderPage();
      try {
        expect(draftsPanel(host)).toBeTruthy();
        expect(host.textContent).toContain('Draft follow-ups');
        expect(host.textContent).toContain('Draft the next investigation prompt.');
        expect(queuedPanel(host)).toBeNull();
      } finally {
        dispose();
      }
    });
  });
}
