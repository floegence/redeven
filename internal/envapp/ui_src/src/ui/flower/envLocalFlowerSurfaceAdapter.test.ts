import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEnvLocalFlowerSurfaceAdapter } from './envLocalFlowerSurfaceAdapter';
import type { FlowerPermissionType, FlowerSurfaceAdapter } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { projectFlowerLiveBootstrap } from '../../../../../flower_ui/src/flowerLiveReducer';
import { clearLocalAccessResumeToken, writeLocalAccessResumeToken } from '../services/localAccessAuth';

vi.mock('../services/controlplaneApi', () => ({
  getLocalRuntime: vi.fn(async () => null),
}));

const fetchMock = vi.fn();

globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
	fetchMock.mockReset();
	clearLocalAccessResumeToken();
});

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as Response;
}

function errorResponse(code: string, data: unknown): Response {
  return {
    ok: false,
    status: 500,
    text: async () => JSON.stringify({
      ok: false,
      error: 'Thread delete failed.',
      error_code: code,
      data,
    }),
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
    title_status: 'ready',
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
	it('opens staged previews with a one-time local access resume credential', async () => {
		const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
		const open = vi.fn();
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: { location: { href: 'http://127.0.0.1:23998/_redeven_proxy/env/' }, open },
		});
		writeLocalAccessResumeToken('resume_preview_123');
		try {
			const adapter = createEnvLocalFlowerSurfaceAdapter({
				envPublicID: 'env_a',
				envLabel: 'Demo Env',
				rpc: { ai: {} } as any,
			});
			await adapter.previewStagedAttachment?.({
				attachment_id: 'upl_preview_1',
				name: 'notes.txt',
				mime_type: 'text/plain; charset=utf-8',
				size_bytes: 5,
				digest_sha256: 'a'.repeat(64),
				locator: 'attachment://v1/upl_preview_1/notes.txt',
				source: 'file',
				capability_revision: 'capability_1',
			}, 'draft_preview_1');
			expect(open).toHaveBeenCalledWith(
				'http://127.0.0.1:23998/_redeven_proxy/api/ai/uploads/upl_preview_1?draft_id=draft_preview_1&preview=1&redeven_access_resume=resume_preview_123',
				'_blank',
				'noopener,noreferrer',
			);
		} finally {
			clearLocalAccessResumeToken();
			if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
			else Reflect.deleteProperty(globalThis, 'window');
		}
	});

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

  it('deletes a thread with force and validates the accepted receipt', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      operation_id: 'delete_operation_1',
      status: 'pending',
      intent_persisted: true,
    }));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
    });

    await expect(adapter.deleteThread?.('thread /1')).resolves.toEqual({ status: 'pending' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/_redeven_proxy/api/ai/threads/thread%20%2F1?force=true',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('accepts only a complete terminal delete receipt from the fixed machine error', async () => {
    const validReceipt = {
      operation_id: 'delete_operation_1',
      status: 'failed',
      intent_persisted: true,
    };
    fetchMock.mockResolvedValue(errorResponse('AI_THREAD_DELETE_OPERATION_FAILED', validReceipt));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
    });

    await expect(adapter.deleteThread?.('thread_1')).resolves.toEqual({ status: 'failed' });

    fetchMock.mockResolvedValue(errorResponse('AI_THREAD_DELETE_OPERATION_FAILED', {
      ...validReceipt,
      intent_persisted: false,
    }));
    await expect(adapter.deleteThread?.('thread_1')).rejects.toThrow('Flower thread delete returned an invalid receipt.');

    fetchMock.mockResolvedValue(errorResponse('AI_THREAD_DELETE_OPERATION_FAILED', undefined));
    await expect(adapter.deleteThread?.('thread_1')).rejects.toThrow('Flower thread delete returned an invalid receipt.');

    fetchMock.mockResolvedValue(errorResponse('UNKNOWN_DELETE_ERROR', validReceipt));
    await expect(adapter.deleteThread?.('thread_1')).rejects.toMatchObject({
      code: 'UNKNOWN_DELETE_ERROR',
      data: validReceipt,
    });
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
      requestId: 'manual-compact-1',
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

    const sendUserTurn = vi.fn(async () => ({ runId: 'run_1', turnId: 'turn_1', kind: 'start' }));
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

  it('serializes staged attachment ids into the strict turn input without mixing them into linked context', async () => {
    const turnBodies: unknown[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings') {
        return jsonResponse({
          ai: { current_model_id: 'default/gpt-4.1', providers: [] },
          ai_secrets: { provider_api_key_set: {}, web_search_provider_api_key_set: {} },
        });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread_upload/turns' && init?.method === 'POST') {
        turnBodies.push(JSON.parse(String(init.body)));
        const body = turnBodies[0] as { input: { turn_id: string } };
        return jsonResponse({ run_id: 'run_upload', turn_id: body.input.turn_id, kind: 'start' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const uploadAttachment = vi.fn<NonNullable<FlowerSurfaceAdapter['uploadAttachment']>>(async (input) => ({
      attachment_id: 'upl_notes',
      name: input.file.name,
      mime_type: input.file.type,
      size_bytes: input.file.size,
      digest_sha256: 'a'.repeat(64),
      locator: 'attachment://v1/upl_notes/notes.txt',
      source: input.source,
      capability_revision: input.capability_revision,
    }));
    const subscribeThread = vi.fn(async () => ({ runId: '' }));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      uploadAttachment,
      rpc: {
        ai: {
          subscribeThread,
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
      draft_id: 'draft_upload',
      expected_draft_revision: 1,
      prompt: 'review notes',
      attachment_ids: ['upl_notes'],
      context_action: contextAction,
    });

    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(subscribeThread).toHaveBeenCalledWith({ threadId: 'thread_upload' });
    expect(turnBodies[0]).toMatchObject({
      input: {
        text: 'review notes',
        attachments: [{ attachment_id: 'upl_notes' }],
        context_action: contextAction,
      },
    });
    expect((turnBodies[0] as { input: Record<string, unknown> }).input).not.toHaveProperty('attachment_ids');
  });

  it('allows attachment-only admission and rejects a truly empty turn', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings') {
        return jsonResponse({
          ai: { current_model_id: 'default/gpt-4.1', providers: [] },
          ai_secrets: { provider_api_key_set: {}, web_search_provider_api_key_set: {} },
        });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread_upload/turns' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { input: { turn_id: string } };
        return jsonResponse({ run_id: 'run_upload', turn_id: body.input.turn_id, kind: 'start' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: { subscribeThread: vi.fn(async () => ({ runId: '' })) } } as any,
    });
    await expect(adapter.launchTurn({
      thread_id: 'thread_upload',
      draft_id: 'draft_upload',
      expected_draft_revision: 1,
      prompt: '',
      attachment_ids: ['upl_notes'],
    })).resolves.toMatchObject({ thread_id: 'thread_upload', run_id: 'run_upload' });
    await expect(adapter.launchTurn({
      thread_id: 'thread_upload',
      prompt: '',
    })).rejects.toThrow();
  });

  it('serializes a reference-only composer action as valid JSON for prepare and admission', async () => {
    const rawBodies: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
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
      if (url === '/_redeven_proxy/api/ai/composer-drafts/draft_reference/thread' && init?.method === 'POST') {
        rawBodies.push(String(init.body));
        return jsonResponse({ thread_id: 'thread_reference', draft_revision: 2 });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread_reference/turns' && init?.method === 'POST') {
        rawBodies.push(String(init.body));
        const body = JSON.parse(String(init.body)) as { input: { turn_id: string } };
        return jsonResponse({ run_id: 'run_reference', turn_id: body.input.turn_id, kind: 'start' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const subscribeThread = vi.fn(async () => ({ runId: '' }));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: { subscribeThread } } as any,
    });
    const contextAction = {
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      provider: 'flower',
      target: { target_id: 'current', locality: 'auto' },
      source: { surface: 'flower_composer' },
      context: [{ kind: 'file_path', path: '/workspace/src', is_directory: true }],
      presentation: { label: 'Ask Flower', priority: 100 },
    } as const;

    await expect(adapter.launchTurn({
      draft_id: 'draft_reference',
      expected_draft_revision: 1,
      prompt: '',
      context_action: contextAction,
    })).resolves.toMatchObject({
      thread_id: 'thread_reference',
      run_id: 'run_reference',
    });

    expect(rawBodies).toHaveLength(2);
    const [prepareBody, turnBody] = rawBodies.map((body) => JSON.parse(body) as Record<string, unknown>);
    expect(prepareBody).toMatchObject({
      expected_draft_revision: 1,
      context_action: contextAction,
    });
    expect(turnBody).toMatchObject({
      thread_id: 'thread_reference',
      expected_draft_revision: 2,
      input: {
        text: '',
        context_action: contextAction,
      },
    });
    expect(subscribeThread).toHaveBeenCalledWith({ threadId: 'thread_reference' });
  });

  it('passes reasoning selection through create thread and turn launch', async () => {
    const subscribeThread = vi.fn(async () => ({ runId: '' }));
    const createdBodies: unknown[] = [];
    const turnBodies: unknown[] = [];
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
      if (url === '/_redeven_proxy/api/ai/composer-drafts/draft_reasoning/thread' && init?.method === 'POST') {
        createdBodies.push(JSON.parse(String(init.body ?? '{}')));
        return jsonResponse({ thread_id: 'thread_reasoning', draft_revision: 2 });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread_reasoning/turns' && init?.method === 'POST') {
        turnBodies.push(JSON.parse(String(init.body)));
        return jsonResponse({ run_id: 'run_reasoning', turn_id: 'client_reasoning-message', kind: 'start' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: {
        ai: {
          subscribeThread,
        },
      } as any,
    });

    const receipt = await adapter.launchTurn({
      turn_id: 'client_reasoning-message',
      draft_id: 'draft_reasoning',
      expected_draft_revision: 1,
      prompt: 'reason about this',
      reasoning_selection: { level: 'high' },
    });

    expect(receipt.thread_id).toBe('thread_reasoning');
    expect(receipt.turn_id).toBe('client_reasoning-message');
    expect(createdBodies[0]).toMatchObject({
      expected_draft_revision: 1,
      turn_id: 'client_reasoning-message',
      create: {
        model_id: 'default/gpt-5.4',
        reasoning_selection: { level: 'high' },
      },
    });
    expect(turnBodies[0]).toMatchObject({
      thread_id: 'thread_reasoning',
      model: 'default/gpt-5.4',
      input: {
        turn_id: 'client_reasoning-message',
        text: 'reason about this',
        attachments: [],
      },
      options: expect.objectContaining({
        reasoning_selection: { level: 'high' },
      }),
    });
    expect(subscribeThread).toHaveBeenCalledWith({ threadId: 'thread_reasoning' });
  });

  it('rejects a receipt that changes the client-proposed turn identity', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings') {
        return jsonResponse({
          ai: {
            current_model_id: 'default/gpt-5.4',
            providers: [{ id: 'default', type: 'openai', models: [{ model_name: 'gpt-5.4' }] }],
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
      if (url === '/_redeven_proxy/api/ai/threads/thread_existing/turns' && init?.method === 'POST') {
        return jsonResponse({ run_id: 'run_other', turn_id: 'turn_other', kind: 'start' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: {
        ai: {
          subscribeThread: vi.fn(async () => ({ runId: '' })),
        },
      } as any,
    });

    await expect(adapter.launchTurn({
      thread_id: 'thread_existing',
      draft_id: 'draft_existing',
      expected_draft_revision: 1,
      turn_id: 'turn_client',
      prompt: 'send once',
    })).rejects.toMatchObject({
      message: 'Flower turn admission returned a different turn identity.',
      uncertain_admission: { thread_id: 'thread_existing', turn_id: 'turn_client' },
    });
  });

  it('distinguishes definite HTTP rejection from unknown transport and receipt outcomes', async () => {
    let turnOutcome: 'definite' | 'transport' | 'malformed' = 'definite';
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings') {
        return jsonResponse({
          ai: {
            current_model_id: 'default/gpt-5.4',
            providers: [{ id: 'default', type: 'openai', models: [{ model_name: 'gpt-5.4' }] }],
          },
          ai_secrets: { provider_api_key_set: { default: true }, web_search_provider_api_key_set: {} },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models') {
        return jsonResponse({ current_model: 'default/gpt-5.4' });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread_existing/turns' && init?.method === 'POST') {
        if (turnOutcome === 'definite') return errorResponse('turn_rejected', { message: 'Turn rejected.' });
        if (turnOutcome === 'transport') throw new Error('transport disconnected');
        return jsonResponse({ turn_id: 'turn_malformed', kind: 'start' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const createAdapter = () => createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: {
        ai: {
          subscribeThread: vi.fn(async () => ({ runId: '' })),
        },
      } as any,
    });

    const definiteFailure = await createAdapter().launchTurn({
      thread_id: 'thread_existing', draft_id: 'draft_existing', expected_draft_revision: 1,
      turn_id: 'turn_definite', prompt: 'send once',
    }).catch((error: unknown) => error);
    expect(definiteFailure).toMatchObject({ name: 'LocalApiError', code: 'turn_rejected' });
    expect(definiteFailure).not.toHaveProperty('uncertain_admission');

    turnOutcome = 'transport';
    await expect(createAdapter().launchTurn({
      thread_id: 'thread_existing', draft_id: 'draft_existing', expected_draft_revision: 1,
      turn_id: 'turn_transport', prompt: 'send once',
    })).rejects.toMatchObject({
      uncertain_admission: { thread_id: 'thread_existing', turn_id: 'turn_transport' },
    });

    turnOutcome = 'malformed';
    await expect(createAdapter().launchTurn({
      thread_id: 'thread_existing', draft_id: 'draft_existing', expected_draft_revision: 1,
      turn_id: 'turn_malformed', prompt: 'send once',
    })).rejects.toMatchObject({
      message: 'Flower turn admission returned an invalid receipt.',
      uncertain_admission: { thread_id: 'thread_existing', turn_id: 'turn_malformed' },
    });
  });

  it('omits the global current model when launching a turn in an existing thread', async () => {
    const subscribeThread = vi.fn(async () => ({ runId: '' }));
    const turnBodies: unknown[] = [];
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
      if (url === '/_redeven_proxy/api/ai/threads/thread_existing/turns' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        turnBodies.push(body);
        return jsonResponse({ run_id: 'run_existing', turn_id: body.input.turn_id, kind: 'start' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: {
        ai: {
          subscribeThread,
        },
      } as any,
    });

    await adapter.launchTurn({
      thread_id: 'thread_existing',
      draft_id: 'draft_existing',
      expected_draft_revision: 1,
      prompt: 'continue existing thread',
    });

    expect(turnBodies[0]).toEqual(expect.not.objectContaining({
      model: expect.anything(),
    }));
    expect(turnBodies[0]).toEqual(expect.objectContaining({
      thread_id: 'thread_existing',
      input: expect.objectContaining({
        text: 'continue existing thread',
        attachments: [],
      }),
    }));
    expect((turnBodies[0] as { input: Record<string, unknown> }).input).not.toHaveProperty('attachment_ids');
  });

	it('passes reasoning selection through input response continuations', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_waiting/live/bootstrap' && init?.method === 'GET') {
        return jsonResponse(liveBootstrap('thread_waiting', 'running'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const submitRequestUserInputResponse = vi.fn(async () => ({
      runId: 'run_continue',
      turnId: 'turn_continue',
      kind: 'start',
    }));
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

	it('rejects an invalid input response admission receipt before reloading bootstrap', async () => {
		const submitRequestUserInputResponse = vi.fn(async () => ({ runId: 'run_continue', kind: 'start' }));
		const adapter = createEnvLocalFlowerSurfaceAdapter({
			envPublicID: 'env_a',
			envLabel: 'Demo Env',
			rpc: { ai: { submitRequestUserInputResponse } } as any,
		});

		await expect(adapter.submitInput({
			thread_id: 'thread_waiting',
			prompt_id: 'prompt_1',
			answers: { next: { choice_id: 'continue' } },
		})).rejects.toThrow('Flower input response admission returned an invalid receipt.');

		expect(fetchMock).not.toHaveBeenCalled();
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

  it('resolves canonical references by exact identity before invoking host navigation', async () => {
    const openCanonicalReferenceTarget = vi.fn(async () => undefined);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url !== '/_redeven_proxy/api/ai/threads/thread%2Fcanonical/reference-open-target' || init?.method !== 'POST') {
        throw new Error(`unexpected fetch: ${url}`);
      }
      const body = JSON.parse(String(init.body ?? '')) as Record<string, unknown>;
      return jsonResponse(body.reference_id === 'ref-directory'
        ? { kind: 'directory', label: 'Source files', path: '/workspace/src' }
        : { kind: 'file', label: 'main.ts', path: '/workspace/src/main.ts' });
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      openCanonicalReferenceTarget,
    });

    await adapter.openCanonicalReference?.({
      thread_id: ' thread/canonical ',
      turn_id: ' turn-canonical ',
      reference_id: ' ref-file ',
    });
    await adapter.openCanonicalReference?.({
      thread_id: 'thread/canonical',
      turn_id: 'turn-canonical',
      reference_id: 'ref-directory',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1,
      '/_redeven_proxy/api/ai/threads/thread%2Fcanonical/reference-open-target',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ turn_id: 'turn-canonical', reference_id: 'ref-file' }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      turn_id: 'turn-canonical',
      reference_id: 'ref-file',
    });
    expect(openCanonicalReferenceTarget).toHaveBeenNthCalledWith(1, {
      kind: 'file',
      label: 'main.ts',
      path: '/workspace/src/main.ts',
    });
    expect(openCanonicalReferenceTarget).toHaveBeenNthCalledWith(2, {
      kind: 'directory',
      label: 'Source files',
      path: '/workspace/src',
    });
  });

  it('rejects malformed canonical open targets without invoking host navigation', async () => {
    const openCanonicalReferenceTarget = vi.fn(async () => undefined);
    fetchMock.mockResolvedValue(jsonResponse({ kind: 'file', label: 'main.ts', path: '' }));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
      openCanonicalReferenceTarget,
    });

    await expect(adapter.openCanonicalReference?.({
      thread_id: 'thread-canonical',
      turn_id: 'turn-canonical',
      reference_id: 'ref-file',
    })).rejects.toThrow('Flower canonical reference open target is invalid.');
    expect(openCanonicalReferenceTarget).not.toHaveBeenCalled();
  });

  it('exposes queued linked-context host capabilities without changing activity file actions', async () => {
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
