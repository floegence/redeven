import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEnvLocalFlowerSurfaceAdapter } from './envLocalFlowerSurfaceAdapter';
import { projectFlowerLiveBootstrap } from '../../../../../flower_ui/src/flowerLiveReducer';

vi.mock('../services/controlplaneApi', () => ({
  getLocalRuntime: vi.fn(async () => null),
}));

const fetchMock = vi.fn();

globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
});

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as Response;
}

function readStatus(status = 'idle') {
  return {
    is_unread: false,
    snapshot: {
      activity_revision: 2,
      last_message_at_unix_ms: 2,
      activity_signature: `status:${status}`,
    },
    read_state: {
      last_seen_activity_revision: 2,
      last_read_message_at_unix_ms: 2,
      last_seen_activity_signature: `status:${status}`,
    },
  };
}

function liveBootstrap(threadID: string, status = 'canceled') {
  const thread = {
    thread_id: threadID,
    title: 'Stopped thread',
    model_id: 'default/gpt-4.1',
    run_status: status,
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
    last_message_at_unix_ms: 2,
    read_status: readStatus(status),
  };
  return {
    schema_version: 1,
    endpoint_id: 'env-a',
    thread_id: threadID,
    cursor: 3,
    retained_from_seq: 1,
    thread,
    timeline_messages: [],
    live_state: {
      thread_patch: {},
      runs: {},
      approval_actions: {},
      input_requests: {},
    },
    read_status: thread.read_status,
    generated_at_ms: 10_000,
  };
}

describe('Env local Flower surface adapter', () => {
  it('maps live bootstrap context telemetry into the shared Flower surface state', async () => {
    const bootstrap = liveBootstrap('thread_context', 'running');
    bootstrap.live_state = {
      ...bootstrap.live_state,
      runs: { run_context: { run_id: 'run_context', status: 'running' } },
      model_io: {
        phase: 'streaming',
        run_id: 'run_context',
        updated_at_ms: 10_010,
      },
      context_usage: {
        run_id: 'run_context',
        phase: 'projected_request',
        input_tokens: 620,
        context_window_tokens: 1000,
        used_ratio: 0.62,
        pressure_status: 'stable',
        updated_at_ms: 10_011,
      },
      context_compactions: [{
        operation_id: 'compact-context',
        run_id: 'run_context',
        phase: 'complete',
        status: 'compacted',
        tokens_before: 900,
        tokens_after_estimate: 200,
        updated_at_ms: 10_012,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-context',
        kind: 'context_compaction',
        anchor: {
          target_kind: 'message',
          message_id: 'assistant-context',
          edge: 'after',
        },
        ordinal: 0,
        compaction: {
          operation_id: 'compact-context',
          run_id: 'run_context',
          phase: 'complete',
          status: 'compacted',
          tokens_before: 900,
          tokens_after_estimate: 200,
          updated_at_ms: 10_012,
        },
      }],
    } as typeof bootstrap.live_state;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_context/live/bootstrap' && init?.method === 'GET') {
        return jsonResponse(bootstrap);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
    });

    const mapped = projectFlowerLiveBootstrap(await adapter.loadThread('thread_context'));

    expect(mapped.active_run_id).toBe('run_context');
    expect(mapped.model_io_status?.run_id).toBe('run_context');
    expect(mapped.context_usage).toMatchObject({
      run_id: 'run_context',
      input_tokens: 620,
      pressure_status: 'stable',
    });
    expect(mapped.context_compactions?.[0]).toMatchObject({
      operation_id: 'compact-context',
      status: 'compacted',
    });
    expect(mapped.timeline_decorations?.[0]).toMatchObject({
      kind: 'context_compaction',
      compaction: { operation_id: 'compact-context' },
    });
  });

  it('stops a thread through RPC and reloads the live bootstrap', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_1/live/bootstrap' && init?.method === 'GET') {
        return jsonResponse(liveBootstrap('thread_1'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const stopThread = vi.fn(async () => ({ ok: true }));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: {
        ai: {
          stopThread,
        },
      } as any,
    });

    const bootstrap = await adapter.stopThread('thread_1');

    expect(stopThread).toHaveBeenCalledWith({ threadId: 'thread_1' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/_redeven_proxy/api/ai/threads/thread_1/live/bootstrap',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(bootstrap.thread.thread_id).toBe('thread_1');
    expect(bootstrap.thread.status).toBe('canceled');
  });

  it('compacts a thread through RPC and reloads the live bootstrap', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_compact/live/bootstrap' && init?.method === 'GET') {
        return jsonResponse(liveBootstrap('thread_compact', 'running'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const compactThreadContext = vi.fn(async () => ({
      operationId: 'manual-compact-1',
      kind: 'accepted',
    }));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: {
        ai: {
          compactThreadContext,
        },
      } as any,
    });

    const bootstrap = await adapter.compactThreadContext({
      thread_id: ' thread_compact ',
      active_run_id: ' run_compact ',
    });

    expect(compactThreadContext).toHaveBeenCalledWith({
      threadId: 'thread_compact',
      activeRunId: 'run_compact',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/_redeven_proxy/api/ai/threads/thread_compact/live/bootstrap',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(bootstrap.thread.thread_id).toBe('thread_compact');
    expect(bootstrap.thread.status).toBe('running');
  });

  it('rejects invalid explicit context actions instead of dropping linked context', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/settings') {
        return jsonResponse({
          ai: {
            current_model_id: 'default/gpt-4.1',
            providers: [{
              id: 'default',
              type: 'openai_compatible',
              models: [{ model_name: 'gpt-4.1' }],
            }],
          },
          ai_secrets: {
            provider_api_key_set: { default: true },
            web_search_provider_api_key_set: {},
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models') {
        return jsonResponse({ current_model: 'default/gpt-4.1' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sendUserTurn = vi.fn(async () => ({ runId: 'run_1', kind: 'start' }));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: {
        ai: {
          subscribeThread: vi.fn(async () => ({ runId: '' })),
          sendUserTurn,
        },
      } as any,
    });

    await expect(adapter.launchTurn({
      prompt: 'inspect env',
      thread_id: 'thread_1',
      context_action: {
        schema_version: 2,
        action_id: 'assistant.ask.flower',
        provider: 'codex',
        target: { target_id: 'current', locality: 'auto' },
        source: { surface: 'file_browser' },
        context: [],
        presentation: { label: 'Ask Flower', priority: 100 },
      },
    })).rejects.toThrow('Invalid Flower context action.');
    expect(sendUserTurn).not.toHaveBeenCalled();
  });

  it('passes reasoning selection through create thread and turn launch', async () => {
    const subscribeThread = vi.fn(async () => ({ runId: '' }));
    const sendUserTurn = vi.fn(async () => ({ runId: 'run_reasoning', kind: 'start' }));
    const createdBodies: unknown[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings') {
        return jsonResponse({
          ai: {
            current_model_id: 'default/gpt-5.4',
            providers: [{
              id: 'default',
              type: 'openai',
              models: [{
                model_name: 'gpt-5.4',
                reasoning_capability: {
                  kind: 'effort',
                  supported_levels: ['low', 'medium', 'high'],
                  default_level: 'medium',
                  wire_shape: 'openai_responses_reasoning_effort',
                  source_urls: ['https://developers.openai.com/api/docs/guides/reasoning'],
                  source_checked_at: '2026-06-23',
                  fixture: 'openai_responses_reasoning_effort',
                },
                default_reasoning_selection: { level: 'medium' },
              }],
            }],
          },
          ai_secrets: {
            provider_api_key_set: { default: true },
            web_search_provider_api_key_set: {},
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models') {
        return jsonResponse({ current_model: 'default/gpt-5.4' });
      }
      if (url === '/_redeven_proxy/api/ai/threads' && init?.method === 'POST') {
        createdBodies.push(JSON.parse(String(init.body ?? '{}')));
        return jsonResponse({ thread: { thread_id: 'thread_reasoning', read_status: readStatus('idle') } });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread_reasoning/live/bootstrap' && init?.method === 'GET') {
        return jsonResponse(liveBootstrap('thread_reasoning', 'running'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: {
        ai: {
          subscribeThread,
          sendUserTurn,
        },
      } as any,
    });

    const live = await adapter.launchTurn({
      message_id: 'client_reasoning-message',
      prompt: 'reason about this',
      reasoning_selection: { level: 'high' },
    });

    expect(live.thread.thread_id).toBe('thread_reasoning');
    expect(createdBodies[0]).not.toHaveProperty('reasoning_selection');
    expect(sendUserTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_reasoning',
      input: expect.objectContaining({
        messageId: 'client_reasoning-message',
      }),
      options: expect.objectContaining({
        reasoningSelection: { level: 'high' },
      }),
    }));
    expect(subscribeThread).toHaveBeenCalledWith({ threadId: 'thread_reasoning' });
  });

	it('passes reasoning selection through input response continuations', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_waiting/live/bootstrap' && init?.method === 'GET') {
        return jsonResponse(liveBootstrap('thread_waiting', 'running'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const submitRequestUserInputResponse = vi.fn(async () => ({ runId: 'run_continue', kind: 'start' }));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: {
        ai: {
          submitRequestUserInputResponse,
        },
      } as any,
    });

    const live = await adapter.submitInput({
      thread_id: 'thread_waiting',
      prompt_id: 'prompt_1',
      answers: { next: { choice_id: 'continue' } },
      reasoning_selection: { level: 'high' },
    });

    expect(live.thread.thread_id).toBe('thread_waiting');
    expect(submitRequestUserInputResponse).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_waiting',
      options: expect.objectContaining({
        reasoningSelection: { level: 'high' },
      }),
		}));
	});

	it('sends null when resetting thread reasoning selection', async () => {
		const patchBodies: unknown[] = [];
		fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
			if (url === '/_redeven_proxy/api/ai/threads/thread_reasoning' && init?.method === 'PATCH') {
				patchBodies.push(JSON.parse(String(init.body ?? '{}')));
				return jsonResponse({ thread: { thread_id: 'thread_reasoning', read_status: readStatus('idle') } });
			}
			if (url === '/_redeven_proxy/api/ai/threads/thread_reasoning/live/bootstrap' && init?.method === 'GET') {
				return jsonResponse(liveBootstrap('thread_reasoning', 'idle'));
			}
			throw new Error(`unexpected fetch: ${url}`);
		});
		const adapter = createEnvLocalFlowerSurfaceAdapter({
			envPublicID: 'env_a',
			envLabel: 'Demo Env',
			rpc: { ai: {} } as any,
		});

		await adapter.setThreadReasoningSelection?.('thread_reasoning', undefined);

		expect(patchBodies).toEqual([{ reasoning_selection: null }]);
	});
});
