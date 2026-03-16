import { createContext } from 'solid-js';
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
  prompt_id: string;
  message_id: string;
  tool_id: string;
  questions?: Array<{
    id: string;
    header: string;
    question: string;
    is_other?: boolean;
    is_secret?: boolean;
    options?: Array<{ option_id: string; label: string; description?: string }>;
  }>;
};

const notificationErrorMock = vi.fn();
const notificationInfoMock = vi.fn();
const notificationSuccessMock = vi.fn();

const protocolState = {
  status: 'connected' as 'connected' | 'disconnected',
};

const sendUserTurnMock = vi.fn(async (_req: unknown) => ({
  runId: 'run-send-1',
  kind: 'start',
}));
const submitStructuredPromptResponseMock = vi.fn(async (_args: unknown) => ({
  runId: 'run-structured-1',
  consumedWaitingPromptId: 'prompt-1',
  appliedExecutionMode: 'act',
}));
const subscribeThreadMock = vi.fn(async (_req: unknown) => ({ runId: 'run-subscribe-1' }));
const listMessagesMock = vi.fn(async (_req: unknown) => ({ messages: [], nextAfterRowId: 0, hasMore: false }));
const getActiveRunSnapshotMock = vi.fn(async (_req: unknown) => ({ ok: false }));
const getPathContextMock = vi.fn(async () => ({ agentHomePathAbs: '/workspace' }));
const setToolCollapsedMock = vi.fn(async () => ({ ok: true }));
const stopThreadMock = vi.fn(async () => ({ ok: true, recoveredFollowups: [] }));
const approveToolMock = vi.fn(async () => ({ ok: true }));

const fetchGatewayJSONMock = vi.fn(async (url: string) => {
  if (url.includes('/todos')) {
    return { todos: null };
  }
  if (url.includes('/followups')) {
    return { queued: [], drafts: [], revision: 0, paused_reason: '' };
  }
  if (url.includes('/context_events')) {
    return { events: [], has_more: false, next_cursor: 0 };
  }
  if (url.includes('/validate_working_dir')) {
    return { working_dir: '/workspace' };
  }
  return {};
});

const gatewayRequestCredentialsMock = vi.fn(async () => 'same-origin');

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
  structuredDrafts: {} as Record<string, { selectedOptionId?: string; answers: string[] }>,
  runIdByThread: {} as Record<string, string>,
};

const aiContextValue = new Proxy({
  settings: { error: null },
  models: { loading: false, error: null },
  threads: { loading: false, error: null },
  aiEnabled: () => true,
  modelsReady: () => true,
  modelOptions: () => [{ id: 'model-test', label: 'Model Test' }],
  selectedModel: () => 'model-test',
  activeThreadId: () => aiState.activeThreadId || null,
  activeThread: () => aiState.activeThread,
  activeThreadWaitingPrompt: () => aiState.waitingPrompt,
  getStructuredPromptDrafts: () => aiState.structuredDrafts,
  submitStructuredPromptResponse: submitStructuredPromptResponseMock,
  setStructuredPromptDraft: () => {},
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
  markThreadPendingRun: () => {},
  clearThreadPendingRun: () => {},
  confirmThreadRun: (_threadId: string, runId: string) => {
    const tid = String(aiState.activeThreadId ?? '').trim();
    if (!tid) return;
    aiState.runIdByThread[tid] = runId;
  },
  runIdForThread: (threadId: string) => aiState.runIdByThread[String(threadId ?? '').trim()] ?? null,
  consumeWaitingPrompt: () => {
    aiState.waitingPrompt = null;
    if (aiState.activeThread) {
      aiState.activeThread = { ...aiState.activeThread, run_status: 'running' };
    }
  },
  bumpThreadsSeq: () => {},
  isThreadRunning: () => false,
  onRealtimeEvent: () => () => {},
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
  DirectoryPicker: () => null,
  Input: (props: any) => (
    <input
      value={props.value}
      onInput={props.onInput}
      onChange={props.onChange}
      placeholder={props.placeholder}
      disabled={props.disabled}
    />
  ),
  Select: () => <div />,
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
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderPage() {
  const mod = await import('./EnvAIPage');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <mod.EnvAIPage />, host);
  await flushAsync();
  return { host, dispose };
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

type SubmitTrigger = 'button' | 'enter';

function clickButton(host: HTMLElement, title: string) {
  const button = Array.from(host.querySelectorAll('button')).find((item) => item.getAttribute('title') === title);
  expect(button).toBeTruthy();
  button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

  describe('EnvAIPage composer send flow', () => {
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
          prompt_id: 'prompt-1',
          message_id: 'assistant-1',
          tool_id: 'tool-ask-user',
          questions: [
            {
              id: 'question-1',
              header: 'Clarify',
              question: 'What logs should Flower inspect?',
              is_other: true,
              is_secret: false,
              options: [],
            },
          ],
        };

        const { host, dispose } = await renderPage();
        try {
          inputComposer(host, 'Please inspect the build logs.');
          submitComposer(host, trigger, buttonTitle);
          await flushAsync();

          expect(submitStructuredPromptResponseMock).toHaveBeenCalledTimes(1);
          expect(submitStructuredPromptResponseMock).toHaveBeenCalledWith(expect.objectContaining({
            threadId: 'thread-1',
            promptId: 'prompt-1',
            text: '',
            answers: {
              'question-1': {
                answers: ['Please inspect the build logs.'],
              },
            },
          }));
          expect(sendUserTurnMock).not.toHaveBeenCalled();
        } finally {
          dispose();
        }
      });
    });

    ([
      { trigger: 'button', label: 'send button', buttonTitle: 'Reply now' },
      { trigger: 'enter', label: 'Enter key', buttonTitle: 'Reply now' },
    ] as const).forEach(({ trigger, label, buttonTitle }) => {
      it(`restores the draft when a waiting-user reply is ambiguous via ${label}`, async () => {
        aiState.activeThread = {
          ...(aiState.activeThread as MockThread),
          run_status: 'waiting_user',
        };
        aiState.waitingPrompt = {
          prompt_id: 'prompt-1',
          message_id: 'assistant-1',
          tool_id: 'tool-ask-user',
          questions: [
            {
              id: 'question-1',
              header: 'Scope',
              question: 'Which subsystem should Flower inspect?',
              is_other: true,
              is_secret: false,
              options: [],
            },
            {
              id: 'question-2',
              header: 'Mode',
              question: 'Should Flower patch or only review?',
              is_other: false,
              is_secret: false,
              options: [
                { option_id: 'plan', label: 'Plan' },
                { option_id: 'act', label: 'Act' },
              ],
            },
          ],
        };

        const { host, dispose } = await renderPage();
        try {
          const textarea = inputComposer(host, 'Check the backend service.');
          submitComposer(host, trigger, buttonTitle);
          await flushAsync();

          expect(submitStructuredPromptResponseMock).not.toHaveBeenCalled();
          expect(sendUserTurnMock).not.toHaveBeenCalled();
          expect(notificationErrorMock).toHaveBeenCalledWith('Input required', 'Resolve all requested input fields before replying.');
          expect(textarea.value).toBe('Check the backend service.');
        } finally {
          dispose();
        }
      });
    });
  });
}
