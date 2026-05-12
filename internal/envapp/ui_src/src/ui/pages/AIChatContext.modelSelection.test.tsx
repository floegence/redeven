// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAIChatContextValue, type AIChatContextValue, type ThreadView } from './AIChatContext';

const hoisted = vi.hoisted(() => {
  const envResource: any = (() => ({
    permissions: {
      can_read: true,
      can_write: true,
      can_execute: true,
    },
  })) as any;
  envResource.state = 'ready';
  envResource.loading = false;
  envResource.error = null;

  return {
    notificationMock: {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
    },
    protocolState: {
      status: 'connected' as 'connected' | 'disconnected',
    },
    fetchGatewayJSONMock: vi.fn(),
    envContextValue: {
      env_id: () => 'env-1',
      env: envResource,
      settingsSeq: () => 0,
      aiThreadFocusSeq: () => 0,
      aiThreadFocusId: () => null,
    },
  };
});

const notificationMock = hoisted.notificationMock;
const protocolState = hoisted.protocolState;
const fetchGatewayJSONMock = hoisted.fetchGatewayJSONMock;
const STORAGE_KEYS = [
  'redeven_ai_active_thread_id',
  'redeven_ai_draft_working_dir',
];

type MutableModelsResponse = {
  current_model: string;
  models: Array<{ id: string; label?: string }>;
};

const baseModels = (): MutableModelsResponse => ({
  current_model: 'openai/model-a',
  models: [
    { id: 'openai/model-a', label: 'Model A' },
    { id: 'openai/model-b', label: 'Model B' },
  ],
});

const makeThread = (overrides: Partial<ThreadView> = {}): ThreadView => ({
  thread_id: 'thread-1',
  title: 'Thread 1',
  model_id: 'openai/model-a',
  model_locked: false,
  execution_mode: 'act',
  working_dir: '/workspace',
  queued_turn_count: 0,
  run_status: 'idle',
  created_at_unix_ms: 1000,
  updated_at_unix_ms: 1000,
  last_message_at_unix_ms: 1000,
  last_message_preview: 'preview',
  read_status: {
    is_unread: false,
    snapshot: {
      last_message_at_unix_ms: 1000,
    },
    read_state: {
      last_read_message_at_unix_ms: 1000,
    },
  },
  ...overrides,
});

let modelsState: MutableModelsResponse;
let threadsState: ThreadView[];
let currentModelError: Error | null;
let threadPatchError: Error | null;
let settingsState: any;
let currentModelRequests: Array<{ model_id: string }>;
let threadPatchRequests: Array<{ threadId: string; body: { model_id?: string } }>;
let createThreadBodies: Array<Record<string, unknown>>;

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => hoisted.notificationMock,
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    status: () => hoisted.protocolState.status,
    client: () => ({ id: 'client-1' }),
  }),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    ai: {
      onEvent: () => () => {},
      subscribeSummary: vi.fn(async () => ({ activeRuns: [] })),
      subscribeThread: vi.fn(async () => ({})),
      submitStructuredPromptResponse: vi.fn(async () => ({ kind: 'start' })),
    },
  }),
}));

vi.mock('../services/gatewayApi', () => ({
  fetchGatewayJSON: hoisted.fetchGatewayJSONMock,
}));

vi.mock('./EnvContext', () => ({
  useEnvContext: () => hoisted.envContextValue,
}));

vi.mock('./aiPermissions', () => ({
  hasRWXPermissions: () => true,
}));

async function renderContext(): Promise<{ ctx: AIChatContextValue; dispose: () => void }> {
  let ctx: AIChatContextValue | undefined;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => {
    ctx = createAIChatContextValue();
    return null;
  }, host);

  await vi.waitFor(() => {
    expect(ctx).toBeTruthy();
    expect(ctx?.modelsReady()).toBe(true);
    expect(ctx?.threads.loading).toBe(false);
  });

  return { ctx: ctx!, dispose };
}

function resetStorage(): void {
  const storage = window.localStorage as Record<string, unknown> & {
    removeItem?: (key: string) => void;
  };
  for (const key of STORAGE_KEYS) {
    storage.removeItem?.(key);
    delete storage[key];
  }
}

describe('AIChatContext model selection', () => {
  beforeEach(() => {
    protocolState.status = 'connected';
    modelsState = baseModels();
    threadsState = [];
    currentModelError = null;
    threadPatchError = null;
    settingsState = { ai: { enabled: true } };
    currentModelRequests = [];
    threadPatchRequests = [];
    createThreadBodies = [];
    fetchGatewayJSONMock.mockReset();
    fetchGatewayJSONMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings') {
        return structuredClone(settingsState);
      }
      if (url === '/_redeven_proxy/api/ai/models') {
        return structuredClone(modelsState);
      }
      if (url === '/_redeven_proxy/api/ai/threads?limit=200') {
        return { threads: structuredClone(threadsState) };
      }
      if (url === '/_redeven_proxy/api/ai/current_model') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { model_id?: string };
        currentModelRequests.push({ model_id: String(body.model_id ?? '').trim() });
        if (currentModelError) throw currentModelError;
        modelsState = {
          ...modelsState,
          current_model: String(body.model_id ?? '').trim(),
        };
        return structuredClone(modelsState);
      }
      if (url === '/_redeven_proxy/api/ai/threads' && init?.method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        createThreadBodies.push(body);
        const thread = makeThread({
          thread_id: 'thread-created',
          title: '',
          model_id: String(body.model_id ?? '').trim() || modelsState.current_model,
        });
        threadsState = [thread, ...threadsState];
        return { thread };
      }
      if (url.startsWith('/_redeven_proxy/api/ai/threads/')) {
        if (url.endsWith('/read')) {
          const parts = url.split('/');
          const threadId = decodeURIComponent(parts[parts.length - 2] ?? '');
          const thread = threadsState.find((entry) => entry.thread_id === threadId) ?? makeThread({ thread_id: threadId });
          return {
            read_status: {
              is_unread: false,
              snapshot: thread.read_status?.snapshot ?? { last_message_at_unix_ms: thread.last_message_at_unix_ms },
              read_state: thread.read_status?.snapshot
                ? {
                    last_read_message_at_unix_ms: thread.read_status.snapshot.last_message_at_unix_ms,
                    last_seen_waiting_prompt_id: thread.read_status.snapshot.waiting_prompt_id,
                  }
                : {
                    last_read_message_at_unix_ms: thread.last_message_at_unix_ms,
                  },
            },
          };
        }
        const threadId = decodeURIComponent(url.split('/').pop() ?? '');
        const body = JSON.parse(String(init?.body ?? '{}')) as { model_id?: string };
        threadPatchRequests.push({ threadId, body });
        if (threadPatchError) throw threadPatchError;
        threadsState = threadsState.map((thread) =>
          thread.thread_id === threadId
            ? {
                ...thread,
                model_id: String(body.model_id ?? '').trim() || thread.model_id,
              }
            : thread,
        );
        const updated = threadsState.find((thread) => thread.thread_id === threadId);
        return { thread: updated };
      }
      throw new Error(`Unhandled gateway request: ${url}`);
    });
    notificationMock.error.mockReset();
    notificationMock.info.mockReset();
    notificationMock.success.mockReset();
    resetStorage();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    resetStorage();
  });

  it('updates current_model_id immediately when the draft default model changes', async () => {
    const { ctx, dispose } = await renderContext();

    expect(ctx.activeThreadId()).toBeNull();
    expect(ctx.selectedDefaultModel()).toBe('openai/model-a');

    ctx.selectDefaultModel('openai/model-b');

    expect(ctx.selectedDefaultModel()).toBe('openai/model-b');
    await vi.waitFor(() => {
      expect(currentModelRequests).toEqual([{ model_id: 'openai/model-b' }]);
      expect(modelsState.current_model).toBe('openai/model-b');
    });

    dispose();
  });

  it('keeps Flower available when Desktop broker is connected and remote AI config is missing', async () => {
    settingsState = {
      ai: null,
      ai_runtime: {
        desktop_broker: {
          connected: true,
          available: true,
          model_source: 'desktop_local_environment',
          missing_key_provider_ids: [],
        },
      },
    };

    const { ctx, dispose } = await renderContext();

    expect(ctx.aiEnabled()).toBe(true);
    expect(ctx.modelOptions().map((item) => item.value)).toEqual(['openai/model-a', 'openai/model-b']);
    expect(ctx.modelOptions()[0].source).toBeUndefined();

    dispose();
  });

  it('changes an unlocked thread model without mutating current_model_id', async () => {
    threadsState = [makeThread()];
    const { ctx, dispose } = await renderContext();

    ctx.selectThreadId('thread-1');
    await vi.waitFor(() => {
      expect(ctx.activeThreadId()).toBe('thread-1');
      expect(ctx.selectedThreadModel()).toBe('openai/model-a');
    });

    ctx.selectThreadModel('openai/model-b');

    expect(ctx.selectedThreadModel()).toBe('openai/model-b');
    await vi.waitFor(() => {
      expect(threadPatchRequests).toEqual([{ threadId: 'thread-1', body: { model_id: 'openai/model-b' } }]);
      expect(threadsState[0]?.model_id).toBe('openai/model-b');
    });
    expect(currentModelRequests).toEqual([]);
    expect(ctx.selectedDefaultModel()).toBe('openai/model-a');

    dispose();
  });

  it('rolls back the default model when persisting current_model_id fails', async () => {
    currentModelError = new Error('save failed');
    const { ctx, dispose } = await renderContext();

    ctx.selectDefaultModel('openai/model-b');
    expect(ctx.selectedDefaultModel()).toBe('openai/model-b');

    await vi.waitFor(() => {
      expect(notificationMock.error).toHaveBeenCalledWith('Failed to update current model', 'save failed');
      expect(ctx.selectedDefaultModel()).toBe('openai/model-a');
    });
    expect(modelsState.current_model).toBe('openai/model-a');

    dispose();
  });

  it('rolls back the optimistic thread model when the thread patch fails', async () => {
    threadsState = [makeThread()];
    threadPatchError = new Error('patch failed');
    const { ctx, dispose } = await renderContext();

    ctx.selectThreadId('thread-1');
    await vi.waitFor(() => {
      expect(ctx.activeThreadId()).toBe('thread-1');
    });

    ctx.selectThreadModel('openai/model-b');
    expect(ctx.selectedThreadModel()).toBe('openai/model-b');

    await vi.waitFor(() => {
      expect(notificationMock.error).toHaveBeenCalledWith('Failed to update model', 'patch failed');
      expect(ctx.selectedThreadModel()).toBe('openai/model-a');
    });
    expect(currentModelRequests).toEqual([]);

    dispose();
  });

  it('uses the selected default model when creating a new thread', async () => {
    const { ctx, dispose } = await renderContext();

    ctx.selectDefaultModel('openai/model-b');
    await vi.waitFor(() => {
      expect(modelsState.current_model).toBe('openai/model-b');
    });

    const threadId = await ctx.ensureThreadForSend();

    expect(threadId).toBe('thread-created');
    expect(createThreadBodies).toHaveLength(1);
    expect(createThreadBodies[0]?.model_id).toBe('openai/model-b');

    dispose();
  });
});
