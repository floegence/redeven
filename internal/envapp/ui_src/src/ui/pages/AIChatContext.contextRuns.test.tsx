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
    realtimeHandler: null as ((event: any) => void) | null,
    envContextValue: {
      env_id: () => 'env-1',
      env: envResource,
      settingsSeq: () => 0,
      aiThreadFocusSeq: () => 0,
      aiThreadFocusId: () => null,
    },
  };
});

const fetchGatewayJSONMock = hoisted.fetchGatewayJSONMock;
const protocolState = hoisted.protocolState;

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
  ...overrides,
});

let threadsState: ThreadView[];

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
      onEvent: (handler: (event: any) => void) => {
        hoisted.realtimeHandler = handler;
        return () => {
          if (hoisted.realtimeHandler === handler) {
            hoisted.realtimeHandler = null;
          }
        };
      },
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
    expect(ctx?.threads.loading).toBe(false);
  });

  return { ctx: ctx!, dispose };
}

describe('AIChatContext context run tracking', () => {
  beforeEach(() => {
    protocolState.status = 'connected';
    threadsState = [makeThread({ last_context_run_id: 'run_saved' })];
    hoisted.realtimeHandler = null;
    fetchGatewayJSONMock.mockReset();
    fetchGatewayJSONMock.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/settings') {
        return { ai: { enabled: true } };
      }
      if (url === '/_redeven_proxy/api/ai/models') {
        return {
          current_model: 'openai/model-a',
          models: [{ id: 'openai/model-a', label: 'Model A' }],
        };
      }
      if (url === '/_redeven_proxy/api/ai/threads?limit=200') {
        return { threads: structuredClone(threadsState) };
      }
      throw new Error(`Unhandled gateway request: ${url}`);
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('prefers realtime context runs over the persisted thread field and retains the persisted fallback', async () => {
    const { ctx, dispose } = await renderContext();

    try {
      await vi.waitFor(() => {
        expect(ctx.lastContextRunIdForThread('thread-1')).toBe('run_saved');
      });

      hoisted.realtimeHandler?.({
        eventType: 'stream_event',
        endpointId: 'env-1',
        threadId: 'thread-1',
        runId: 'run_live',
        atUnixMs: 1200,
        streamKind: 'context',
        streamEvent: {
          type: 'context-usage',
          payload: {
            estimate_tokens: 200,
            context_limit: 1000,
          },
        },
      });

      await Promise.resolve();
      expect(ctx.lastContextRunIdForThread('thread-1')).toBe('run_live');

      hoisted.realtimeHandler?.({
        eventType: 'thread_summary',
        endpointId: 'env-1',
        threadId: 'thread-1',
        runId: '',
        atUnixMs: 1300,
        runStatus: 'success',
        lastContextRunId: 'run_terminal',
      });

      await Promise.resolve();
      expect(ctx.lastContextRunIdForThread('thread-1')).toBe('run_terminal');
    } finally {
      dispose();
    }
  });
});
