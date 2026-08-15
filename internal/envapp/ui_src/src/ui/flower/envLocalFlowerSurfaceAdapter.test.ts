import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEnvLocalFlowerSurfaceAdapter } from './envLocalFlowerSurfaceAdapter';
import type {
  FlowerAttachmentStagingScope,
  FlowerApprovalCommandResult,
  FlowerPermissionType,
  FlowerSurfaceAdapter,
} from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
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

function stagingScope(targetID: string): FlowerAttachmentStagingScope {
  return {
    staging_scope_id: `staging_${targetID}`,
    target_id: targetID,
    capability: `secret_${targetID}`,
    expires_at_unix_ms: 10_000,
  };
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
    title_status: 'ready',
    model_id: 'default/gpt-4.1',
    status,
    permission_type: 'approval_required' as FlowerPermissionType,
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
    last_message_at_unix_ms: 2,
    read_status: readStatus(status),
  };
  return {
    thread,
    current: {
      thread_id: threadID,
      view_version: 3,
      activity: status === 'running' ? 'active' : 'idle',
      ...(status === 'canceled' ? { last_outcome: 'cancelled' } : {}),
      items: [],
      queue: [],
      interactions: [],
    },
  };
}

function typedCommandResponse(
  clientRequestID: string,
  threadID: string,
  turnID: string,
  text = '',
) {
  return {
    client_request_id: clientRequestID,
    thread_id: threadID,
    current: {
      thread_id: threadID,
      view_version: 1,
      activity: 'active',
      turn_id: turnID,
      items: [{
        id: `user:${clientRequestID}`,
        turn_id: turnID,
        kind: 'user',
        text,
      }],
      queue: [],
      interactions: [],
    },
  };
}

describe('Env local Flower surface adapter', () => {
	it('deletes a canonical queued turn through the queue route before reloading detail', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ ok: true }))
			.mockResolvedValueOnce(jsonResponse(liveBootstrap('thread/delete', 'running')));
		const adapter = createEnvLocalFlowerSurfaceAdapter({
			envPublicID: 'env_a',
			envLabel: 'Demo Env',
			rpc: { ai: {} } as any,
		});

		await adapter.deleteQueuedTurn?.('thread/delete', 'queue/middle');

		expect(fetchMock).toHaveBeenNthCalledWith(1,
			'/_redeven_proxy/api/ai/threads/thread%2Fdelete/queue/queue%2Fmiddle',
			expect.objectContaining({ method: 'DELETE' }),
		);
			expect(fetchMock).toHaveBeenNthCalledWith(2,
				'/_redeven_proxy/api/ai/threads/thread%2Fdelete',
			expect.objectContaining({ method: 'GET' }),
		);
	});

	it('does not retain the legacy live polling transport', () => {
		const adapter = createEnvLocalFlowerSurfaceAdapter({
			envPublicID: 'env_a',
			envLabel: 'Demo Env',
			rpc: { ai: {} } as any,
		});

		expect('listThreadLiveEvents' in adapter).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('aborts an inactive SSE stream and releases the reader after 45 seconds', async () => {
		vi.useFakeTimers();
		let cancelled = false;
		fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => {
				cancelled = true;
				reject(new DOMException('aborted', 'AbortError'));
			}, { once: true });
		}));
		const adapter = createEnvLocalFlowerSurfaceAdapter({
			envPublicID: 'env_a', envLabel: 'Demo Env', rpc: { ai: {} } as any,
		});
		const controller = new AbortController();
		const iterator = adapter.connectLiveStream!({
			signal: controller.signal,
		})[Symbol.asyncIterator]();
		let failure: unknown;
		const pending = iterator.next().catch((error) => { failure = error; });
		await vi.advanceTimersByTimeAsync(45_000);
		await pending;
		expect(failure).toBeTruthy();
		expect(cancelled).toBe(true);
		vi.useRealTimers();
	});

	it('cancels the fetch-SSE reader immediately when the caller aborts', async () => {
		let cancelled = false;
		fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => {
				cancelled = true;
				reject(new DOMException('aborted', 'AbortError'));
			}, { once: true });
		}));
		const controller = new AbortController();
		const adapter = createEnvLocalFlowerSurfaceAdapter({
			envPublicID: 'env_a', envLabel: 'Demo Env', rpc: { ai: {} } as any,
		});
		const iterator = adapter.connectLiveStream!({
			signal: controller.signal,
		})[Symbol.asyncIterator]();
		const pending = iterator.next();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		controller.abort();
		await expect(pending).rejects.toThrow();
		expect(cancelled).toBe(true);
	});

	it('consumes one cancellable workspace fetch-SSE stream without replay cursors', async () => {
		fetchMock.mockResolvedValue(new Response(
			'data: {"schema_version":1,"kind":"ready","summaries":[]}\n\n',
			{ status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
		));
		const adapter = createEnvLocalFlowerSurfaceAdapter({
			envPublicID: 'env_a',
			envLabel: 'Demo Env',
			rpc: { ai: {} } as any,
		});
		const controller = new AbortController();
		const frames = [];
		for await (const frame of adapter.connectLiveStream!({
			signal: controller.signal,
		})) frames.push(frame);

		expect(frames).toEqual([expect.objectContaining({ kind: 'ready', summaries: [] })]);
		const url = String(fetchMock.mock.calls[0]?.[0]);
		expect(url).toContain('/_redeven_proxy/api/ai/flower/stream?');
		expect(url).not.toContain('thread_id=');
		expect(url).not.toContain('thread_after_seq=');
		expect(url).not.toContain('summary_after_seq=');
		expect(url).not.toContain('thread_generation=');
		expect(url).not.toContain('summary_generation=');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('creates and releases attachment staging scopes without exposing the capability', async () => {
		fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
			if (url === '/_redeven_proxy/api/ai/upload-staging-scopes' && init?.method === 'POST') {
				return {
					ok: true,
					status: 200,
					headers: new Headers({ 'Upload-Staging-Capability': 'secret-from-response-header' }),
					text: async () => JSON.stringify({
						data: {
							staging_scope_id: 'staging_thread-staged',
							target_id: 'thread-staged',
							expires_at_unix_ms: 123_456,
						},
					}),
				} as Response;
			}
			if (url === '/_redeven_proxy/api/ai/upload-staging-scopes/staging_thread-staged' && init?.method === 'DELETE') {
				return {
					ok: true,
					status: 204,
					headers: new Headers(),
					text: async () => '',
				} as Response;
			}
			throw new Error(`unexpected fetch: ${url}`);
		});
		const adapter = createEnvLocalFlowerSurfaceAdapter({
			envPublicID: 'env_a',
			envLabel: 'Demo Env',
			rpc: { ai: {} } as any,
		});

		const scope = await adapter.createAttachmentStagingScope?.('thread-staged');
		expect(scope).toEqual({
			staging_scope_id: 'staging_thread-staged',
			target_id: 'thread-staged',
			capability: 'secret-from-response-header',
			expires_at_unix_ms: 123_456,
		});
		await adapter.releaseAttachmentStagingScope?.(scope!);

		const createBody = String(fetchMock.mock.calls[0]?.[1]?.body);
		expect(JSON.parse(createBody)).toEqual({ target_id: 'thread-staged' });
		expect(createBody).not.toContain('secret-from-response-header');
		const releaseURL = String(fetchMock.mock.calls[1]?.[0]);
		const releaseInit = fetchMock.mock.calls[1]?.[1];
		expect(releaseURL).toBe('/_redeven_proxy/api/ai/upload-staging-scopes/staging_thread-staged');
		expect(releaseURL).not.toContain('secret-from-response-header');
		expect(releaseInit?.body).toBeUndefined();
		const releaseHeaders = new Headers(releaseInit?.headers);
		expect(releaseHeaders.get('Upload-Staging-Capability')).toBe('secret-from-response-header');
		expect(releaseHeaders.get('Upload-Staging-Scope-ID')).toBeNull();
	});

	it('rejects attachment staging responses that target another thread', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers({ 'Upload-Staging-Capability': 'secret-from-response-header' }),
			text: async () => JSON.stringify({
			data: {
					staging_scope_id: 'staging_wrong',
					target_id: 'thread-other',
					expires_at_unix_ms: 123_456,
				},
			}),
		} as Response);
		const adapter = createEnvLocalFlowerSurfaceAdapter({
			envPublicID: 'env_a',
			envLabel: 'Demo Env',
			rpc: { ai: {} } as any,
		});

		await expect(adapter.createAttachmentStagingScope?.('thread-requested')).rejects.toThrow('invalid');
	});

	it('opens staged previews through an authenticated object URL without exposing credentials', async () => {
		const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
		const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
		const previousRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
		const open = vi.fn();
		const createObjectURL = vi.fn(() => 'blob:flower-preview');
		const revokeObjectURL = vi.fn();
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: {
				location: { href: 'http://127.0.0.1:23998/_redeven_proxy/env/' },
				open,
				setTimeout: vi.fn(),
			},
		});
		Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
		Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
		writeLocalAccessResumeToken('resume_preview_123');
		try {
			fetchMock.mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'text/plain' }),
				blob: async () => new Blob(['notes'], { type: 'text/plain' }),
			} as Response);
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
			}, stagingScope('thread_preview'));
			expect(fetchMock).toHaveBeenCalledWith(
				'/_redeven_proxy/api/ai/uploads/upl_preview_1',
				expect.objectContaining({ method: 'GET' }),
			);
			const previewHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
			expect(previewHeaders.get('Upload-Staging-Scope-ID')).toBe('staging_thread_preview');
			expect(previewHeaders.get('Upload-Staging-Capability')).toBe('secret_thread_preview');
			expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('secret_thread_preview');
			expect(open).toHaveBeenCalledWith('blob:flower-preview', '_blank', 'noopener,noreferrer');
			expect(createObjectURL).toHaveBeenCalledOnce();
		} finally {
			clearLocalAccessResumeToken();
			if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
			else Reflect.deleteProperty(globalThis, 'window');
			if (previousCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', previousCreateObjectURL);
			else Reflect.deleteProperty(URL, 'createObjectURL');
			if (previousRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', previousRevokeObjectURL);
			else Reflect.deleteProperty(URL, 'revokeObjectURL');
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

  it('deduplicates settings and model catalog reads across concurrent initial launches', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: {
            current_model_id: 'default/gpt-5.4',
            permission_type: 'approval_required',
            providers: [{ id: 'default', type: 'openai', models: [{ model_name: 'gpt-5.4' }] }],
          },
          ai_secrets: {
            provider_api_key_set: { default: true },
            web_search_provider_api_key_set: {},
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/models' && init?.method === 'GET') {
        return jsonResponse({ current_model: 'default/gpt-5.4' });
      }
      if (url === '/_redeven_proxy/api/ai/turns' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          create: { client_request_id: string };
          input: { text?: string };
        };
        const suffix = body.create.client_request_id;
        return jsonResponse(typedCommandResponse(
          suffix,
          `thread_${suffix}`,
          `turn_${suffix}`,
          body.input.text,
        ));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: { subscribeThread: vi.fn(async () => ({ runId: '' })) } } as any,
    });

    await Promise.all([
      adapter.loadSettings(),
      adapter.launchTurn({ client_request_id: 'client_cache_a', prompt: 'first' }),
      adapter.launchTurn({ client_request_id: 'client_cache_b', prompt: 'second' }),
    ]);

    expect(fetchMock.mock.calls.filter(([url]) => url === '/_redeven_proxy/api/settings')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/_redeven_proxy/api/ai/models')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/_redeven_proxy/api/ai/turns')).toHaveLength(2);
  });

  it('invalidates the settings cache after saving the default permission', async () => {
    let permissionType: FlowerPermissionType = 'approval_required';
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({ ai: { permission_type: permissionType } });
      }
      if (url === '/_redeven_proxy/api/ai/default_permission' && init?.method === 'PUT') {
        permissionType = 'full_access';
        return jsonResponse({});
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
    });

    await adapter.loadSettings();
    await adapter.loadSettings();
    const updated = await adapter.saveDefaultPermission!('full_access');

    expect(updated.defaults.permission_type).toBe('full_access');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/_redeven_proxy/api/settings')).toHaveLength(2);
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

  it('maps typed current detail into the shared Flower surface state', async () => {
    const bootstrap = {
      ...liveBootstrap('thread_context', 'running'),
      current: {
        thread_id: 'thread_context',
        view_version: 11,
        activity: 'active' as const,
        turn_id: 'turn_context',
        items: [
          { id: 'user:req-context', turn_id: 'turn_context', kind: 'user' as const, text: 'Inspect context' },
          { id: 'assistant:turn-context', turn_id: 'turn_context', kind: 'assistant' as const, text: 'Working' },
        ],
        queue: [],
        interactions: [],
      },
    };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_context' && init?.method === 'GET') {
        return jsonResponse(bootstrap);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
    });

    const mapped = await adapter.loadThread('thread_context');

    expect(mapped.current.view_version).toBe(11);
    expect(mapped.thread.status).toBe('running');
    expect(mapped.thread.active_run_id).toBe('turn_context');
    expect(mapped.thread.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'user:req-context', role: 'user', content: 'Inspect context' }),
      expect.objectContaining({ id: 'assistant:turn-context', role: 'assistant', content: 'Working' }),
    ]));
  });

  it('stops a thread through RPC and reloads the live bootstrap', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_1' && init?.method === 'GET') {
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
      '/_redeven_proxy/api/ai/threads/thread_1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(bootstrap.thread.thread_id).toBe('thread_1');
    expect(bootstrap.thread.status).toBe('canceled');
  });

  it('retries only the canonical provider continuation and reloads live bootstrap', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_retry/retry' && init?.method === 'POST') {
        return jsonResponse({ ok: true });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread_retry' && init?.method === 'GET') {
        return jsonResponse(liveBootstrap('thread_retry', 'running'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
    });

    const bootstrap = await adapter.retryThread(' thread_retry ');

    expect(fetchMock).toHaveBeenNthCalledWith(1,
      '/_redeven_proxy/api/ai/threads/thread_retry/retry',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      '/_redeven_proxy/api/ai/threads/thread_retry',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(bootstrap.thread.status).toBe('running');
  });

  it('deletes a thread with force through the synchronous contract', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
    });

    await expect(adapter.deleteThread?.('thread /1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/_redeven_proxy/api/ai/threads/thread%20%2F1?force=true',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('returns the typed current view from the local approval API', async () => {
    const result: FlowerApprovalCommandResult = {
      ok: true,
      current: { thread_id: 'thread_receipt', view_version: 42, activity: 'active', interactions: [{ id: 'approval_receipt', kind: 'approval', resolved: true, approved: true }] },
    };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_receipt/approvals' && init?.method === 'POST') {
        return jsonResponse(result);
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
      interaction_id: 'approval_receipt',
      approved: true,
    });

    expect(receipt).toEqual(result);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      thread_id: 'thread_receipt',
      interaction_id: 'approval_receipt',
      approved: true,
    });
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
      client_request_id: 'client_invalid_context',
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
    const turnHeaders: HeadersInit[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings') {
        return jsonResponse({
          ai: { current_model_id: 'default/gpt-4.1', providers: [] },
          ai_secrets: { provider_api_key_set: {}, web_search_provider_api_key_set: {} },
        });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread_upload/turns' && init?.method === 'POST') {
        turnBodies.push(JSON.parse(String(init.body)));
        turnHeaders.push(init.headers ?? {});
        return jsonResponse(typedCommandResponse('client_upload', 'thread_upload', 'turn_upload', 'review notes'));
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
      client_request_id: 'client_upload',
      thread_id: 'thread_upload',
      staging_scope: stagingScope('thread_upload'),
      prompt: 'review notes',
      attachment_ids: ['upl_notes'],
      context_action: contextAction,
    });

    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(subscribeThread).not.toHaveBeenCalled();
    expect(turnBodies[0]).toMatchObject({
      thread_id: 'thread_upload',
      staging_scope_id: 'staging_thread_upload',
      input: {
        text: 'review notes',
        attachments: [{ attachment_id: 'upl_notes' }],
        context_action: contextAction,
      },
    });
    expect(new Headers(turnHeaders[0]).get('Upload-Staging-Capability')).toBe('secret_thread_upload');
    expect(JSON.stringify(turnBodies[0])).not.toContain('secret_thread_upload');
    expect(turnBodies[0]).not.toHaveProperty('draft_id');
    expect(turnBodies[0]).not.toHaveProperty('expected_draft_revision');
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
        return jsonResponse(typedCommandResponse('client_upload', 'thread_upload', 'turn_upload'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: { subscribeThread: vi.fn(async () => ({ runId: '' })) } } as any,
    });
    await expect(adapter.launchTurn({
      client_request_id: 'client_upload',
      thread_id: 'thread_upload',
      staging_scope: stagingScope('thread_upload'),
      prompt: '',
      attachment_ids: ['upl_notes'],
    })).resolves.toMatchObject({
      thread_id: 'thread_upload',
      current: { turn_id: 'turn_upload' },
    });
    await expect(adapter.launchTurn({
      client_request_id: 'client_empty',
      thread_id: 'thread_upload',
      prompt: '',
    })).rejects.toThrow();
  });

  it('serializes a reference-only composer action in one create-and-admit request', async () => {
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
      if (url === '/_redeven_proxy/api/ai/turns' && init?.method === 'POST') {
        rawBodies.push(String(init.body));
        return jsonResponse(typedCommandResponse('client_reference', 'thread_reference', 'turn_reference'));
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
      client_request_id: 'client_reference',
      staging_scope: stagingScope('client_reference'),
      prompt: '',
      context_action: contextAction,
    })).resolves.toMatchObject({
      thread_id: 'thread_reference',
      current: { turn_id: 'turn_reference' },
    });

    expect(rawBodies).toHaveLength(1);
    const [turnBody] = rawBodies.map((body) => JSON.parse(body) as Record<string, unknown>);
    expect(turnBody).toMatchObject({
      staging_scope_id: 'staging_client_reference',
      create: {
        client_request_id: 'client_reference',
        model_id: 'default/gpt-4.1',
        permission_type: 'approval_required',
      },
      input: {
        text: '',
        context_action: contextAction,
      },
    });
    expect(subscribeThread).not.toHaveBeenCalled();
  });

  it('sends the stable client request id for an existing thread turn', async () => {
    let body: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/threads/thread_existing/turns' && init?.method === 'POST') {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(typedCommandResponse('client_existing_send', 'thread_existing', 'turn_existing', 'hello'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: { ai: {} } as any,
    });

    await adapter.launchTurn({
      client_request_id: 'client_existing_send',
      thread_id: 'thread_existing',
      prompt: 'hello',
    });

    expect(body).toMatchObject({
      client_request_id: 'client_existing_send',
      thread_id: 'thread_existing',
      input: { text: 'hello' },
    });
  });

  it('passes reasoning selection through create thread and turn launch', async () => {
    const subscribeThread = vi.fn(async () => ({ runId: '' }));
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
      if (url === '/_redeven_proxy/api/ai/turns' && init?.method === 'POST') {
        turnBodies.push(JSON.parse(String(init.body)));
        return jsonResponse(typedCommandResponse(
          'client_reasoning',
          'thread_reasoning',
          'turn_reasoning',
          'reason about this',
        ));
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
      client_request_id: 'client_reasoning',
      staging_scope: stagingScope('client_reasoning'),
      prompt: 'reason about this',
      reasoning_selection: { level: 'high' },
    });

    expect(receipt.thread_id).toBe('thread_reasoning');
    expect(receipt.current.turn_id).toBe('turn_reasoning');
    expect(turnBodies[0]).toMatchObject({
      staging_scope_id: 'staging_client_reasoning',
      create: {
        client_request_id: 'client_reasoning',
        model_id: 'default/gpt-5.4',
        reasoning_selection: { level: 'high' },
      },
      model: 'default/gpt-5.4',
      input: {
        text: 'reason about this',
        attachments: [],
      },
      options: expect.objectContaining({
        reasoning_selection: { level: 'high' },
      }),
    });
    expect(subscribeThread).not.toHaveBeenCalled();
  });

  it('rejects a current view that changes the echoed client request identity', async () => {
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
        return jsonResponse(typedCommandResponse('client_other', 'thread_existing', 'turn_other', 'send once'));
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
      client_request_id: 'client_existing',
      thread_id: 'thread_existing',
      prompt: 'send once',
    })).rejects.toMatchObject({
      message: 'Flower send returned an invalid current view.',
    });
  });

  it('reports command rejection, transport failure, and invalid current views directly', async () => {
    let turnOutcome: 'definite' | 'transport' | 'malformed' | 'invalid_json' = 'definite';
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
        if (turnOutcome === 'invalid_json') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            text: async () => '<html>not json</html>',
          } as Response;
        }
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
      client_request_id: 'client_definite',
      thread_id: 'thread_existing',
      prompt: 'send once',
    }).catch((error: unknown) => error);
    expect(definiteFailure).toMatchObject({ name: 'LocalApiError', code: 'turn_rejected' });
    expect(definiteFailure).not.toHaveProperty('uncertain_admission');

    turnOutcome = 'transport';
    await expect(createAdapter().launchTurn({
      client_request_id: 'client_transport',
      thread_id: 'thread_existing',
      prompt: 'send once',
    })).rejects.toThrow('transport disconnected');

    turnOutcome = 'malformed';
    await expect(createAdapter().launchTurn({
      client_request_id: 'client_malformed',
      thread_id: 'thread_existing',
      prompt: 'send once',
    })).rejects.toMatchObject({
      message: 'Flower send returned an invalid current view.',
    });

    turnOutcome = 'invalid_json';
    await expect(createAdapter().launchTurn({
      client_request_id: 'client_invalid_json',
      thread_id: 'thread_existing',
      prompt: 'send once',
    })).rejects.toMatchObject({
      code: 'INVALID_JSON_RESPONSE',
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
        return jsonResponse(typedCommandResponse(
          'client_existing',
          'thread_existing',
          'turn_existing',
          'continue existing thread',
        ));
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
      client_request_id: 'client_existing',
      thread_id: 'thread_existing',
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

	it('submits input responses through the HTTP admission path without waiting for RPC notifications', async () => {
		const inputBodies: unknown[] = [];
		fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
				if (url === '/_redeven_proxy/api/ai/threads/thread_waiting/input_response' && init?.method === 'POST') {
					inputBodies.push(JSON.parse(String(init.body ?? '{}')));
					return jsonResponse({
						kind: 'accepted',
						consumed_waiting_prompt_id: 'prompt_1',
						current: typedCommandResponse(
							'input:prompt_1',
							'thread_waiting',
							'turn_continue',
						).current,
					});
			}
			throw new Error(`input admission must not perform another request: ${url}`);
		});
		const submitRequestUserInputResponse = vi.fn(async () => {
			throw new Error('structured input admission must not share the realtime RPC stream');
		});
		const subscribeThread = vi.fn(async () => ({}));
    const adapter = createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'env_a',
      envLabel: 'Demo Env',
      rpc: {
        ai: {
          submitRequestUserInputResponse,
			subscribeThread,
        },
      } as any,
    });

    const receipt = await adapter.submitInput({
      thread_id: 'thread_waiting',
      prompt_id: 'prompt_1',
      answers: { next: { choice_id: 'continue' } },
      reasoning_selection: { level: 'high' },
    });

    expect(receipt).toEqual({
      thread_id: 'thread_waiting',
      consumed_prompt_id: 'prompt_1',
      current: expect.objectContaining({
        turn_id: 'turn_continue',
        thread_id: 'thread_waiting',
      }),
    });
		expect(submitRequestUserInputResponse).not.toHaveBeenCalled();
		expect(subscribeThread).not.toHaveBeenCalled();
		expect(inputBodies).toEqual([{
			response: {
				prompt_id: 'prompt_1',
				answers: { next: { choice_id: 'continue' } },
			},
			input: { text: '', attachments: [] },
			options: { reasoning_selection: { level: 'high' } },
		}]);
	});

	it('rejects an invalid HTTP input response admission receipt before reloading bootstrap', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ run_id: 'run_continue', kind: 'start' }));
		const submitRequestUserInputResponse = vi.fn(async () => {
			throw new Error('structured input admission must not use RPC');
		});
		const adapter = createEnvLocalFlowerSurfaceAdapter({
			envPublicID: 'env_a',
			envLabel: 'Demo Env',
			rpc: { ai: { submitRequestUserInputResponse } } as any,
		});

		await expect(adapter.submitInput({
			thread_id: 'thread_waiting',
			prompt_id: 'prompt_1',
			answers: { next: { choice_id: 'continue' } },
		})).rejects.toThrow('Flower input response returned an invalid current view.');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(submitRequestUserInputResponse).not.toHaveBeenCalled();
	});

	it('sends null when resetting thread reasoning selection', async () => {
		const patchBodies: unknown[] = [];
		fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
			if (url === '/_redeven_proxy/api/ai/threads/thread_reasoning' && init?.method === 'PATCH') {
				patchBodies.push(JSON.parse(String(init.body ?? '{}')));
				return jsonResponse({ thread: { thread_id: 'thread_reasoning', read_status: readStatus('idle') } });
			}
      if (url === '/_redeven_proxy/api/ai/threads/thread_reasoning' && init?.method === 'GET') {
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
      if (url === '/_redeven_proxy/api/ai/threads/thread_permission' && init?.method === 'GET') {
					const detail = liveBootstrap('thread_permission', 'running');
					detail.thread = {
						...detail.thread,
						permission_type: 'full_access',
					};
					return jsonResponse(detail);
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
      if (url === '/_redeven_proxy/api/ai/threads/thread_model' && init?.method === 'GET') {
        const detail = liveBootstrap('thread_model', 'idle');
        detail.thread = {
          ...detail.thread,
          model_id: 'default/gpt-5.4',
        };
        return jsonResponse(detail);
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
