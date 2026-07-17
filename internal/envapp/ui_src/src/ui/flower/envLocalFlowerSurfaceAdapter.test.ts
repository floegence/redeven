import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEnvLocalFlowerSurfaceAdapter } from './envLocalFlowerSurfaceAdapter';
import type { FlowerPermissionType } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
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

const DESKTOP_MODEL_ID = `desktop:model_${'a'.repeat(64)}`;

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
    permission_type: 'approval_required' as FlowerPermissionType,
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
  it.each([
    ['missing_keys', {
      binding_state: 'bound', connected: true, available: false, model_count: 0, missing_key_provider_ids: ['openai'],
    }],
    ['empty', {
      binding_state: 'bound', connected: true, available: false, model_count: 0, missing_key_provider_ids: [],
    }],
    ['connecting', {
      binding_state: 'connecting', connected: false, available: false, model_count: 0,
    }],
    ['unbound', {
      binding_state: 'unbound', connected: false, available: false, model_count: 0,
    }],
    ['expired', {
      binding_state: 'expired', connected: false, available: false, model_count: 0,
    }],
    ['error', {
      binding_state: 'error', connected: false, available: false, model_count: 0, last_error: 'Desktop source disconnected',
    }],
  ] as const)('maps Desktop source state %s without contradictory readiness fields', async (expectedState, source) => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: { permission_type: 'approval_required' },
          ai_runtime: { desktop_model_source: source },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models' && init?.method === 'GET') {
        return jsonResponse({ models: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      desktopSessionTargetRoute: 'remote_desktop',
    });

    const sourceStatus = (await adapter.loadSettings()).model_source;

    expect(sourceStatus).toMatchObject({
      kind: 'desktop_model_source',
      state: expectedState,
      label: 'Desktop',
    });
    expect(sourceStatus).not.toHaveProperty('ready');
    expect(sourceStatus).not.toHaveProperty('model_count');
  });

  it('maps a missing Runtime Desktop capability to unsupported', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      ai: { permission_type: 'approval_required' },
      ai_runtime: {},
    }));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      desktopSessionTargetRoute: 'remote_desktop',
    });

    expect((await adapter.loadSettings()).model_source).toEqual({
      kind: 'desktop_model_source',
      state: 'unsupported',
      label: 'Desktop',
    });
  });

  it('rejects a Desktop catalog entry from an unexpected source', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: { permission_type: 'approval_required' },
          ai_runtime: {
            desktop_model_source: {
              binding_state: 'bound', connected: true, available: true, model_count: 3,
            },
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models' && init?.method === 'GET') {
        return jsonResponse({
          current_model: DESKTOP_MODEL_ID,
          models: [
            { id: DESKTOP_MODEL_ID, label: 'Desktop / Valid', source: 'desktop_model_source' },
            { id: `desktop:model_${'b'.repeat(64)}`, label: 'Wrong source', source: 'runtime_config' },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      desktopSessionTargetRoute: 'remote_desktop',
    });

    expect((await adapter.loadSettings()).model_source).toEqual({
      kind: 'desktop_model_source',
      state: 'error',
      label: 'Desktop',
      diagnostic_message: 'Desktop model catalog contains an invalid model source.',
    });
  });

  it('rejects a Desktop catalog entry with an invalid opaque id', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: { permission_type: 'approval_required' },
          ai_runtime: {
            desktop_model_source: {
              binding_state: 'bound', connected: true, available: true, model_count: 1,
            },
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models' && init?.method === 'GET') {
        return jsonResponse({
          models: [{ id: 'desktop:model_legacy', source: 'desktop_model_source' }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      desktopSessionTargetRoute: 'remote_desktop',
    });

    expect((await adapter.loadSettings()).model_source).toEqual({
      kind: 'desktop_model_source',
      state: 'error',
      label: 'Desktop',
      diagnostic_message: 'Desktop model catalog contains an invalid opaque model id.',
    });
  });

  it('reports model catalog request failures as Desktop source errors', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: { permission_type: 'approval_required' },
          ai_runtime: {
            desktop_model_source: {
              binding_state: 'bound', connected: true, available: true, model_count: 1,
            },
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models' && init?.method === 'GET') {
        throw new Error('catalog unavailable');
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      desktopSessionTargetRoute: 'remote_desktop',
    });

    expect((await adapter.loadSettings()).model_source).toEqual({
      kind: 'desktop_model_source',
      state: 'error',
      label: 'Desktop',
      diagnostic_message: 'catalog unavailable',
    });
  });

  it('rejects a malformed Desktop model catalog response', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: { permission_type: 'approval_required' },
          ai_runtime: {
            desktop_model_source: {
              binding_state: 'bound', connected: true, available: true, model_count: 1,
            },
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models' && init?.method === 'GET') {
        return jsonResponse({ models: 'invalid' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      desktopSessionTargetRoute: 'remote_desktop',
    });

    expect((await adapter.loadSettings()).model_source).toEqual({
      kind: 'desktop_model_source',
      state: 'error',
      label: 'Desktop',
      diagnostic_message: 'Desktop model catalog response is invalid.',
    });
  });

  it('loads permission-only settings without requesting runtime models', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: { permission_type: 'readonly' },
          ai_runtime: { remote_configured: false },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
    });

    const snapshot = await adapter.loadSettings();

    expect(snapshot.defaults.permission_type).toBe('readonly');
    expect(snapshot.model_profile).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith('/_redeven_proxy/api/ai/models', expect.anything());
  });

  it('keeps a disconnected Desktop model source in the settings contract', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: { permission_type: 'approval_required' },
          ai_runtime: {
            desktop_model_source: {
              binding_state: 'error',
              connected: false,
              available: false,
              model_source: 'desktop_local_environment',
              model_count: 0,
              last_error: 'Desktop source disconnected',
            },
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      desktopSessionTargetRoute: 'remote_desktop',
    });

    const snapshot = await adapter.loadSettings();

    expect(snapshot.model_profile).toBeNull();
    expect(snapshot.model_source).toMatchObject({
      kind: 'desktop_model_source',
      state: 'error',
      diagnostic_message: 'Desktop source disconnected',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the remote model profile and Desktop catalog together for remote Desktop sessions', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: {
            current_model_id: 'remote/gpt-5.4',
            permission_type: 'approval_required',
            providers: [{
              id: 'remote',
              name: 'Remote Provider',
              type: 'openai',
              models: [{ model_name: 'gpt-5.4', context_window: 400000 }],
            }],
          },
          ai_secrets: {
            provider_api_key_set: { remote: true },
            web_search_provider_api_key_set: { remote: false },
          },
          ai_runtime: {
            desktop_model_source: {
              binding_state: 'bound',
              connected: true,
              available: true,
              model_source: 'desktop_local_environment',
              model_count: 1,
              missing_key_provider_ids: [],
            },
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models' && init?.method === 'GET') {
        return jsonResponse({
          current_model: 'remote/gpt-5.4',
          models: [
            {
              id: 'remote/gpt-5.4',
              label: 'Remote Provider / gpt-5.4',
              source: 'runtime_config',
            },
            {
              id: DESKTOP_MODEL_ID,
              label: 'Desktop / Local Model',
              source: 'desktop_model_source',
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      desktopSessionTargetRoute: 'remote_desktop',
    });

    const snapshot = await adapter.loadSettings();

    expect(snapshot.model_profile).toMatchObject({
      current_model_id: 'remote/gpt-5.4',
      providers: [expect.objectContaining({ id: 'remote' })],
    });
    expect(snapshot.provider_secrets).toEqual([expect.objectContaining({
      provider_id: 'remote',
      provider_api_key_configured: true,
    })]);
    expect(snapshot.model_source).toMatchObject({
      kind: 'desktop_model_source',
      state: 'ready',
    });
    if (snapshot.model_source?.state !== 'ready') throw new Error('Expected ready Desktop model source.');
    expect(snapshot.model_source.current_model_id).toBeUndefined();
    expect(snapshot.model_source.models).toEqual([
      expect.objectContaining({ id: DESKTOP_MODEL_ID }),
    ]);
  });

  it.each(['local_host', undefined] as const)(
    'ignores unbound Desktop diagnostics for %s sessions',
    async (desktopSessionTargetRoute) => {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
          return jsonResponse({
            ai: {
              current_model_id: 'remote/gpt-5.4',
              providers: [{
                id: 'remote',
                type: 'openai',
                models: [{ model_name: 'gpt-5.4' }],
              }],
            },
            ai_secrets: {
              provider_api_key_set: { remote: true },
              web_search_provider_api_key_set: {},
            },
            ai_runtime: {
              desktop_model_source: {
                binding_state: 'unbound',
                connected: false,
                available: false,
                model_source: 'desktop_local_environment',
                model_count: 0,
              },
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      const adapter = createEnvLocalFlowerSurfaceAdapter({
        envPublicID: 'env_a',
        envLabel: 'Demo Env',
        rpc: { ai: {} } as any,
        desktopSessionTargetRoute,
      });

      const snapshot = await adapter.loadSettings();

      expect(snapshot.model_profile?.current_model_id).toBe('remote/gpt-5.4');
      expect(snapshot.model_source).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

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

  it('returns the approval decision receipt from the local API', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_receipt/approvals' && init?.method === 'POST') {
        return jsonResponse({ ok: true, current_cursor: 42 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
    });

    const receipt = await adapter.submitApproval({
      thread_id: 'thread_receipt',
      origin: 'main_tool',
      run_id: 'run_receipt',
      action_id: 'approval_receipt',
      tool_id: 'tool_receipt',
      approved: true,
      expected_seq: 40,
      revision: 1,
      version: 1,
      surface_epoch: 1,
      queue_generation: 1,
      queue_revision: 1,
    });

    expect(receipt).toEqual({ ok: true, current_cursor: 42 });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      thread_id: 'thread_receipt',
      action_id: 'approval_receipt',
      approved: true,
    });
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

  it('maps connected Desktop models into the read-only Flower model source catalog', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: null,
          ai_runtime: {
            desktop_model_source: {
              binding_state: 'bound',
              connected: true,
              available: true,
              model_source: 'desktop_local_environment',
              model_count: 2,
              missing_key_provider_ids: [],
            },
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models' && init?.method === 'GET') {
        return jsonResponse({
          current_model: DESKTOP_MODEL_ID,
          models: [
            {
              id: DESKTOP_MODEL_ID,
              label: 'Desktop / DeepSeek / deepseek-v4-pro',
              source: 'desktop_model_source',
              context_window: 950000,
              max_output_tokens: 384000,
              input_modalities: ['text'],
              reasoning_capability: {
                kind: 'effort',
                supported_levels: ['high', 'max'],
                default_level: 'high',
                wire_shape: 'deepseek_reasoning_effort',
              },
            },
            {
              id: `desktop:model_${'f'.repeat(64)}`,
              label: 'Desktop / Plain',
              source: 'desktop_model_source',
              context_window: 128000,
              max_output_tokens: 4096,
              input_modalities: ['text', 'image'],
            },
            {
              id: 'runtime/local-only',
              label: 'Runtime only',
              source: 'runtime_config',
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      desktopSessionTargetRoute: 'remote_desktop',
    });

    const snapshot = await adapter.loadSettings();

    expect(snapshot.model_profile).toBeNull();
    expect(snapshot.model_source?.state).toBe('ready');
    if (snapshot.model_source?.state !== 'ready') throw new Error('Expected ready Desktop model source.');
    expect(snapshot.model_source.current_model_id).toBe(DESKTOP_MODEL_ID);
    expect(snapshot.model_source).toMatchObject({
      kind: 'desktop_model_source',
      state: 'ready',
    });
    expect(snapshot.model_source.models).toEqual([
      expect.objectContaining({
        id: DESKTOP_MODEL_ID,
        context_window: 950000,
        reasoning_capability: expect.objectContaining({
          supported_levels: ['high', 'max'],
          default_level: 'high',
        }),
      }),
      expect.objectContaining({
        id: `desktop:model_${'f'.repeat(64)}`,
        input_modalities: ['text', 'image'],
      }),
    ]);
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

  it('uploads pending files explicitly without mixing upload URLs into linked context', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings') {
        return jsonResponse({
          ai: { current_model_id: 'default/gpt-4.1', providers: [] },
          ai_secrets: { provider_api_key_set: {}, web_search_provider_api_key_set: {} },
        });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread_upload/live/bootstrap' && init?.method === 'GET') {
        return jsonResponse(liveBootstrap('thread_upload', 'running'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const uploadAttachment = vi.fn(async () => '/_redeven_proxy/api/ai/uploads/upl_notes');
    const sendUserTurn = vi.fn(async (_request: any) => ({ runId: 'run_upload', kind: 'start' }));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      uploadAttachment,
      rpc: {
        ai: {
          subscribeThread: vi.fn(async () => ({ runId: '' })),
          sendUserTurn,
        },
      } as any,
    });
    const contextAction = {
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      provider: 'flower',
      target: { target_id: 'current', locality: 'auto' },
      source: { surface: 'file_preview' },
      context: [{ kind: 'file_path', path: '/workspace/notes.txt', is_directory: false }],
      presentation: { label: 'Ask Flower', priority: 100 },
    };

    await adapter.launchTurn({
      thread_id: 'thread_upload',
      prompt: 'review notes',
      pending_files: [{ name: 'notes.txt', type: 'text/plain' } as File],
      context_action: contextAction,
    });

    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    const request = sendUserTurn.mock.calls[0]?.[0];
    expect(request.input.attachments).toEqual([{
      name: 'notes.txt',
      mimeType: 'text/plain',
      url: '/_redeven_proxy/api/ai/uploads/upl_notes',
    }]);
    expect(request.input.contextAction).toEqual(contextAction);
    expect(JSON.stringify(request.input.contextAction)).not.toContain('/_redeven_proxy/api/ai/uploads');
  });

  it('blocks pending files when upload support is missing or upload fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/settings') {
        return jsonResponse({
          ai: { current_model_id: 'default/gpt-4.1', providers: [] },
          ai_secrets: { provider_api_key_set: {}, web_search_provider_api_key_set: {} },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const pendingFile = { name: 'notes.txt', type: 'text/plain' } as File;
    const sendWithoutUploader = vi.fn();
    const withoutUploader = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: { sendUserTurn: sendWithoutUploader } } as any,
    });
    await expect(withoutUploader.launchTurn({
      thread_id: 'thread_upload',
      prompt: 'review notes',
      pending_files: [pendingFile],
    })).rejects.toThrow('Attachment upload is unavailable for this Flower surface.');
    expect(sendWithoutUploader).not.toHaveBeenCalled();

    const sendAfterFailure = vi.fn();
    const uploadFailure = new Error('upload failed');
    const withFailingUploader = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      uploadAttachment: vi.fn(async () => { throw uploadFailure; }),
      rpc: { ai: { sendUserTurn: sendAfterFailure } } as any,
    });
    await expect(withFailingUploader.launchTurn({
      thread_id: 'thread_upload',
      prompt: 'review notes',
      pending_files: [pendingFile],
    })).rejects.toThrow('upload failed');
    expect(sendAfterFailure).not.toHaveBeenCalled();
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
    expect(createdBodies[0]).toMatchObject({
      model_id: 'default/gpt-5.4',
      reasoning_selection: { level: 'high' },
    });
    expect(sendUserTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_reasoning',
      model: 'default/gpt-5.4',
      input: expect.objectContaining({
        messageId: 'client_reasoning-message',
      }),
      options: expect.objectContaining({
        reasoningSelection: { level: 'high' },
      }),
    }));
    expect(subscribeThread).toHaveBeenCalledWith({ threadId: 'thread_reasoning' });
  });

  it('omits the global current model when launching a turn in an existing thread', async () => {
    const subscribeThread = vi.fn(async () => ({ runId: '' }));
    const sendUserTurn = vi.fn(async () => ({ runId: 'run_existing', kind: 'start' }));
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings') {
        return jsonResponse({
          ai: {
            current_model_id: 'default/global-model',
            providers: [{
              id: 'default',
              type: 'openai',
              models: [{ model_name: 'global-model' }],
            }],
          },
          ai_secrets: {
            provider_api_key_set: { default: true },
            web_search_provider_api_key_set: {},
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread_existing/live/bootstrap' && init?.method === 'GET') {
        return jsonResponse(liveBootstrap('thread_existing', 'running'));
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

    await adapter.launchTurn({
      thread_id: 'thread_existing',
      prompt: 'continue existing thread',
    });

    expect(sendUserTurn).toHaveBeenCalledWith(expect.not.objectContaining({
      model: expect.anything(),
    }));
    expect(sendUserTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_existing',
    }));
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

	it('patches a thread permission type through the local API', async () => {
		const patchBodies: unknown[] = [];
		fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
			if (url === '/_redeven_proxy/api/ai/threads/thread_permission' && init?.method === 'PATCH') {
				patchBodies.push(JSON.parse(String(init.body ?? '{}')));
				return jsonResponse({ thread: { thread_id: 'thread_permission', read_status: readStatus('running') } });
			}
			if (url === '/_redeven_proxy/api/ai/threads/thread_permission/live/bootstrap' && init?.method === 'GET') {
				const bootstrap = liveBootstrap('thread_permission', 'running');
				bootstrap.thread = {
					...bootstrap.thread,
					permission_type: 'full_access',
				};
				return jsonResponse(bootstrap);
			}
			throw new Error(`unexpected fetch: ${url}`);
		});
		const adapter = createEnvLocalFlowerSurfaceAdapter({
			envPublicID: 'env_a',
			envLabel: 'Demo Env',
			rpc: { ai: {} } as any,
		});

		const live = await adapter.setThreadPermissionType?.('thread_permission', 'full_access');

		expect(patchBodies).toEqual([{ permission_type: 'full_access' }]);
		expect(live?.thread.permission_type).toBe('full_access');
	});

  it('patches a thread model through the local API', async () => {
    const patchBodies: unknown[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_model' && init?.method === 'PATCH') {
        patchBodies.push(JSON.parse(String(init.body ?? '{}')));
        return jsonResponse({ thread: { thread_id: 'thread_model', read_status: readStatus('idle') } });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread_model/live/bootstrap' && init?.method === 'GET') {
        const bootstrap = liveBootstrap('thread_model', 'idle');
        bootstrap.thread = {
          ...bootstrap.thread,
          model_id: 'default/gpt-5.4',
        };
        return jsonResponse(bootstrap);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
    });

    const live = await adapter.setThreadModel?.('thread_model', 'default/gpt-5.4');

    expect(patchBodies).toEqual([{ model_id: 'default/gpt-5.4' }]);
    expect(live?.thread.model_id).toBe('default/gpt-5.4');
  });

  it('updates the current model through the local API and refreshes settings', async () => {
    const currentModelBodies: unknown[] = [];
    const onSettingsChanged = vi.fn();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/current_model' && init?.method === 'PUT') {
        currentModelBodies.push(JSON.parse(String(init.body ?? '{}')));
        return jsonResponse({ current_model: 'default/gpt-5.4', models: [{ id: 'default/gpt-5.4' }] });
      }
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: {
            current_model_id: 'default/gpt-5.4',
            providers: [{
              id: 'default',
              type: 'openai',
              models: [{ model_name: 'gpt-5.4' }],
            }],
          },
          ai_secrets: {
            provider_api_key_set: { default: true },
            web_search_provider_api_key_set: {},
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models' && init?.method === 'GET') {
        return jsonResponse({ current_model: 'default/gpt-5.4', models: [{ id: 'default/gpt-5.4' }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      onSettingsChanged,
    });

    const snapshot = await adapter.persistDefaultModel('default/gpt-5.4');

    expect(currentModelBodies).toEqual([{ model_id: 'default/gpt-5.4' }]);
    expect(snapshot.model_profile?.current_model_id).toBe('default/gpt-5.4');
    expect(onSettingsChanged).toHaveBeenCalledTimes(1);
  });

  it('rejects Desktop models from the persisted Env default path', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: {
            current_model_id: 'remote/gpt-5.4',
            providers: [{
              id: 'remote',
              type: 'openai',
              models: [{ model_name: 'gpt-5.4' }],
            }],
          },
          ai_secrets: {
            provider_api_key_set: { remote: true },
            web_search_provider_api_key_set: {},
          },
          ai_runtime: {
            desktop_model_source: {
              binding_state: 'bound',
              connected: true,
              available: true,
              model_count: 1,
            },
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models' && init?.method === 'GET') {
        return jsonResponse({
          current_model: DESKTOP_MODEL_ID,
          models: [{ id: DESKTOP_MODEL_ID, source: 'desktop_model_source' }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      desktopSessionTargetRoute: 'remote_desktop',
      rpc: { ai: {} } as any,
    });

    await expect(adapter.persistDefaultModel(DESKTOP_MODEL_ID)).rejects.toThrow(
      'Model is not part of the environment profile.',
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/_redeven_proxy/api/ai/current_model',
      expect.anything(),
    );
  });

  it('exposes linked-context host capabilities without changing activity file actions', async () => {
    const openFilePreview = vi.fn(async () => undefined);
    const openFileBrowser = vi.fn(async () => undefined);
    const openLinkedFilePreview = vi.fn(async () => undefined);
    const openLinkedDirectoryBrowser = vi.fn(async () => undefined);
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      openFilePreview,
      openFileBrowser,
      openLinkedFilePreview,
      openLinkedDirectoryBrowser,
    });
    const linkedRequest = {
      path: '/workspace/src/app.ts',
      thread_id: 'thread_1',
      message_id: 'message_1',
      context_index: 0,
      source_surface: 'file_preview' as const,
      target: 'current',
    };

    await adapter.openLinkedFilePreview?.(linkedRequest);
    await adapter.openLinkedDirectoryBrowser?.({ ...linkedRequest, path: '/workspace/src' });

    expect(openLinkedFilePreview).toHaveBeenCalledWith(linkedRequest);
    expect(openLinkedDirectoryBrowser).toHaveBeenCalledWith({ ...linkedRequest, path: '/workspace/src' });
    expect(openFilePreview).not.toHaveBeenCalled();
    expect(openFileBrowser).not.toHaveBeenCalled();
  });
});
