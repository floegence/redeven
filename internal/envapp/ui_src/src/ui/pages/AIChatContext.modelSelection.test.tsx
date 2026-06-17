// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAIChatContextValue, normalizeModelsResponse, type AIChatContextValue, type ThreadView } from './AIChatContext';

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

  const envContextState = {
    settingsSeq: () => 0,
  };

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
      settingsSeq: () => envContextState.settingsSeq(),
      aiThreadFocusRequest: () => null,
      consumeAIThreadFocusRequest: () => undefined,
    },
    envContextState,
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
  models: Array<{
    id: string;
    label?: string;
    source?: string;
    source_label?: string;
    context_window?: number;
    max_output_tokens?: number;
    input_modalities?: string[];
    supports_image_input?: boolean;
  }> | null;
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
      activity_revision: 1000,
      last_message_at_unix_ms: 1000,
      activity_signature: 'status:idle\u001factivity:1000',
    },
    read_state: {
      last_seen_activity_revision: 1000,
      last_read_message_at_unix_ms: 1000,
      last_seen_activity_signature: 'status:idle\u001factivity:1000',
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
let modelRequests: number;
let bumpSettingsSeq: () => void;

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
      submitRequestUserInputResponse: vi.fn(async () => ({ kind: 'start' })),
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
    modelRequests = 0;
    const [settingsSeq, setSettingsSeq] = createSignal(0);
    hoisted.envContextState.settingsSeq = settingsSeq;
    bumpSettingsSeq = () => setSettingsSeq((seq) => seq + 1);
    fetchGatewayJSONMock.mockReset();
    fetchGatewayJSONMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings') {
        return structuredClone(settingsState);
      }
      if (url === '/_redeven_proxy/api/ai/models') {
        modelRequests += 1;
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
            read_status: thread.read_status,
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

  it('updates current_model_id immediately when the current draft model changes', async () => {
    const { ctx, dispose } = await renderContext();

    expect(ctx.activeThreadId()).toBeNull();
    expect(ctx.selectedCurrentModel()).toBe('openai/model-a');

    ctx.selectCurrentModel('openai/model-b');

    expect(ctx.selectedCurrentModel()).toBe('openai/model-b');
    await vi.waitFor(() => {
      expect(currentModelRequests).toEqual([{ model_id: 'openai/model-b' }]);
      expect(modelsState.current_model).toBe('openai/model-b');
    });

    dispose();
  });

  it('refreshes model options in the same chat context when settingsSeq changes', async () => {
    const { ctx, dispose } = await renderContext();

    expect(modelRequests).toBe(1);
    expect(ctx.modelOptions().map((item) => item.value)).toEqual(['openai/model-a', 'openai/model-b']);

    modelsState = {
      current_model: 'openai/model-c',
      models: [
        { id: 'openai/model-c', label: 'Model C' },
      ],
    };
    bumpSettingsSeq();

    await vi.waitFor(() => {
      expect(modelRequests).toBe(2);
      expect(ctx.modelOptions().map((item) => item.value)).toEqual(['openai/model-c']);
    });
    expect(ctx.selectedCurrentModel()).toBe('openai/model-c');

    dispose();
  });

  it('keeps Flower available when Desktop model source is connected and remote AI config is missing', async () => {
    settingsState = {
      ai: null,
      ai_runtime: {
        desktop_model_source: {
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
    expect(ctx.modelOptions()[0].source).toBe('runtime_config');
    expect(ctx.modelSourceGroups().map((group) => group.source)).toEqual(['runtime_config']);

    dispose();
  });

  it('normalizes null model lists into an empty model contract', () => {
    const normalized = normalizeModelsResponse({
      current_model: 'desktop:model_missing',
      models: null,
      runtime: {
        desktop_model_source: {
          connected: true,
          available: false,
        },
      },
    });

    expect(normalized.current_model).toBe('desktop:model_missing');
    expect(normalized.models).toEqual([]);
    expect(normalized.runtime?.desktop_model_source?.connected).toBe(true);
  });

  it('keeps the chat context stable when the models API returns null models', async () => {
    modelsState = {
      current_model: '',
      models: null,
    };

    const { ctx, dispose } = await renderContext();

    expect(ctx.modelsReady()).toBe(true);
    expect(ctx.modelOptions()).toEqual([]);
    expect(ctx.modelSourceGroups()).toEqual([]);
    expect(ctx.selectedCurrentModel()).toBe('');
    expect(ctx.selectedSendModel()).toBe('');

    dispose();
  });

  it('groups runtime config and Desktop model sources from the model list', async () => {
    modelsState = {
      current_model: 'remote/model-a',
      models: [
        { id: 'remote/model-a', label: 'Remote A', source: 'runtime_config', source_label: 'Runtime config' },
        { id: 'desktop:model_local_b', label: 'Desktop B', source: 'desktop_model_source', source_label: 'Desktop' },
      ],
    };

    const { ctx, dispose } = await renderContext();

    expect(ctx.modelOptions().map((option) => ({
      value: option.value,
      label: option.label,
      source: option.source,
      sourceLabel: option.sourceLabel,
      inputModalities: option.inputModalities,
      supportsImageInput: option.supportsImageInput,
    }))).toEqual([
      { value: 'remote/model-a', label: 'Remote A', source: 'runtime_config', sourceLabel: 'Runtime config', inputModalities: ['text'], supportsImageInput: false },
      { value: 'desktop:model_local_b', label: 'Desktop B', source: 'desktop_model_source', sourceLabel: 'Desktop', inputModalities: ['text'], supportsImageInput: false },
    ]);
    expect(ctx.modelSourceGroups().map((group) => ({
      source: group.source,
      sourceLabel: group.sourceLabel,
      available: group.available,
      models: group.models.map((model) => model.value),
    }))).toEqual([
      { source: 'runtime_config', sourceLabel: 'Runtime config', available: true, models: ['remote/model-a'] },
      { source: 'desktop_model_source', sourceLabel: 'Desktop', available: true, models: ['desktop:model_local_b'] },
    ]);

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
    expect(ctx.selectedCurrentModel()).toBe('openai/model-a');

    dispose();
  });

  it('rolls back the current model when persisting current_model_id fails', async () => {
    currentModelError = new Error('save failed');
    const { ctx, dispose } = await renderContext();

    ctx.selectCurrentModel('openai/model-b');
    expect(ctx.selectedCurrentModel()).toBe('openai/model-b');

    await vi.waitFor(() => {
      expect(notificationMock.error).toHaveBeenCalledWith('Failed to update current model', 'save failed');
      expect(ctx.selectedCurrentModel()).toBe('openai/model-a');
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

  it('uses the selected current model when creating a new thread', async () => {
    const { ctx, dispose } = await renderContext();

    ctx.selectCurrentModel('openai/model-b');
    await vi.waitFor(() => {
      expect(modelsState.current_model).toBe('openai/model-b');
    });

    const threadId = await ctx.ensureThreadForSend();

    expect(threadId).toBe('thread-created');
    expect(createThreadBodies).toHaveLength(1);
    expect(createThreadBodies[0]?.model_id).toBe('openai/model-b');

    dispose();
  });

  it('does not silently select the first model when current_model is invalid', async () => {
    modelsState = {
      current_model: 'openai/missing',
      models: [
        { id: 'openai/model-a', label: 'Model A' },
        { id: 'openai/model-b', label: 'Model B' },
      ],
    };

    const { ctx, dispose } = await renderContext();

    expect(ctx.selectedCurrentModel()).toBe('');
    expect(ctx.selectedSendModel()).toBe('');

    const threadId = await ctx.ensureThreadForSend();

    expect(threadId).toBeNull();
    expect(createThreadBodies).toEqual([]);
    expect(notificationMock.error).toHaveBeenCalledWith('Missing model', 'Select a Current Model before starting a chat.');

    dispose();
  });
});
