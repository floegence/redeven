import http from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import {
  createLocalEnvironmentFlowerSurfaceAdapter,
  launchLocalEnvironmentFlowerTurn,
  mapFlowerSettingsDraftToRuntimeBundle,
  mapRuntimeFlowerSettings,
  mapRuntimeFlowerThread,
  type DesktopSettingsBridge,
} from './localEnvironmentFlowerSurfaceAdapter';
import type { RuntimeFlowerRequest } from '../../shared/runtimeFlowerIPC';
import {
  parseRuntimeFlowerJSON,
  requestRuntimeFlowerHTTP,
  runtimeFlowerInvalidJSONError,
} from '../../main/runtimeFlowerHTTP';
import { projectFlowerLiveBootstrap } from '../../../../internal/flower_ui/src/flowerLiveReducer';
import type { AgentSettingsResponse } from '../../../../internal/envapp/ui_src/src/ui/pages/settings/types';

const stagingScope = (threadID: string) => ({
  staging_scope_id: `staging_${threadID}`,
  target_id: threadID,
  capability: `secret_${threadID}`,
  expires_at_unix_ms: 10_000,
});

function readStatus(isUnread = false, revision = 2, status = 'idle') {
  const signature = `status:${status}\u001factivity:${revision}`;
  return {
    is_unread: isUnread,
    snapshot: {
      activity_revision: revision,
      last_message_at_unix_ms: revision,
      activity_signature: signature,
    },
    read_state: {
      last_seen_activity_revision: isUnread ? Math.max(0, revision - 1) : revision,
      last_read_message_at_unix_ms: isUnread ? Math.max(0, revision - 1) : revision,
      last_seen_activity_signature: isUnread ? `status:${status}\u001factivity:${Math.max(0, revision - 1)}` : signature,
    },
  };
}

function settingsResponse(): AgentSettingsResponse {
  return {
    config_path: '/Users/me/.redeven/local-environment/config.json',
    connection: {
      controlplane_base_url: '',
      environment_id: 'local-environment',
      agent_instance_id: 'agent-local',
      direct: {
        ws_url: '',
        channel_id: '',
        channel_init_expire_at_unix_s: 0,
        default_suite: 0,
        e2ee_psk_set: false,
      },
    },
    runtime: { agent_home_dir: '/Users/me/.redeven/local-environment', shell: '/bin/zsh' },
    logging: { log_format: 'plain', log_level: 'info' },
    codespaces: { code_server_port_min: 0, code_server_port_max: 0 },
    permission_policy: null,
    ai: {
      current_model_id: 'default/gpt-4.1',
      providers: [{
        id: 'default',
        type: 'openai_compatible' as const,
      base_url: 'https://api.example.test/v1',
      web_search: { mode: 'brave' as const },
      models: [{
          model_name: 'gpt-4.1',
          context_window: 128000,
          max_output_tokens: 16384,
          effective_context_window_percent: 70,
          input_modalities: ['text', 'image'] as const,
        }],
      }],
      permission_type: 'approval_required',
    },
    ai_secrets: {
      provider_api_key_set: { default: true },
      web_search_provider_api_key_set: { default: true },
    },
  };
}

function threadView(overrides: Record<string, unknown> = {}) {
  return {
    thread_id: 'thread-1',
    title: 'Conversation',
    title_status: 'ready',
    model_id: 'default/gpt-4.1',
    run_status: 'idle',
    working_dir: '/workspace/redeven',
    pinned_at_unix_ms: 123,
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
    last_message_at_unix_ms: 2,
    last_message_preview: 'hi',
    read_status: readStatus(false),
    ...overrides,
  };
}

function liveBootstrap(overrides: Record<string, unknown> = {}, messages: unknown[] = []) {
  const thread = threadView(overrides);
  const cursor = Number(overrides.cursor ?? 0);
  return {
    schema_version: 1,
    endpoint_id: 'local-environment',
    thread_id: thread.thread_id,
    cursor,
    retained_from_seq: 1,
    thread,
    timeline_messages: messages,
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

function bridgeFor(handler: (request: RuntimeFlowerRequest) => unknown | Promise<unknown>): DesktopSettingsBridge {
  return {
    ...attachmentBridgeStubs(),
    save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
    requestRuntimeFlower: vi.fn(async (request: RuntimeFlowerRequest) => ({
      ok: true as const,
      data: await handler(request),
    })),
    cancel: vi.fn(),
  };
}

function attachmentBridgeStubs() {
  return {
    prepareRuntimeFlowerAttachment: vi.fn(async () => ({ ok: false, message: 'not configured' })),
    writeRuntimeFlowerAttachmentChunk: vi.fn(async () => ({ ok: false, message: 'not configured' })),
    commitRuntimeFlowerAttachment: vi.fn(async () => ({ ok: false, failureKind: 'local' as const })),
    cancelRuntimeFlowerAttachment: vi.fn(async () => ({ ok: true, cancelled: true })),
    subscribeRuntimeFlowerAttachmentProgress: vi.fn(() => () => undefined),
    previewRuntimeFlowerAttachment: vi.fn(async () => ({ ok: true })),
  };
}

describe('Local Environment Flower surface adapter', () => {
  it('creates and releases attachment staging scopes without putting capabilities in URL or body', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const requestRuntimeFlower = vi.fn(async (request: RuntimeFlowerRequest) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/upload-staging-scopes') {
        return {
          ok: true as const,
          data: {
            staging_scope_id: 'staging_thread-staged',
            target_id: 'thread-staged',
            expires_at_unix_ms: 123_456,
          },
          stagingCapability: 'secret-from-response-header',
        };
      }
      if (request.path === '/_redeven_proxy/api/ai/upload-staging-scopes/staging_thread-staged') {
        return { ok: true as const, data: null };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const bridge: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower,
      cancel: vi.fn(),
    };
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    const scope = await adapter.createAttachmentStagingScope?.('thread-staged');
    expect(scope).toEqual({
      staging_scope_id: 'staging_thread-staged',
      target_id: 'thread-staged',
      capability: 'secret-from-response-header',
      expires_at_unix_ms: 123_456,
    });
    await adapter.releaseAttachmentStagingScope?.(scope!);

    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/_redeven_proxy/api/ai/upload-staging-scopes',
      body: { target_id: 'thread-staged' },
    });
    expect(calls[1]).toEqual({
      method: 'DELETE',
      path: '/_redeven_proxy/api/ai/upload-staging-scopes/staging_thread-staged',
      staging_scope_id: 'staging_thread-staged',
      staging_capability: 'secret-from-response-header',
    });
    expect(JSON.stringify(calls[0])).not.toContain('secret-from-response-header');
    expect(calls[1]?.path).not.toContain('secret-from-response-header');
    expect(calls[1]).not.toHaveProperty('body');
  });

  it('rejects attachment staging responses that target another thread', async () => {
    const bridge: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower: vi.fn(async () => ({
        ok: true as const,
        data: {
          staging_scope_id: 'staging_wrong',
          thread_id: 'thread-other',
          expires_at_unix_ms: 123_456,
        },
        stagingCapability: 'secret-from-response-header',
      })),
      cancel: vi.fn(),
    };

    await expect(createLocalEnvironmentFlowerSurfaceAdapter(bridge)
      .createAttachmentStagingScope?.('thread-requested')).rejects.toThrow('invalid');
  });

  it('maps runtime settings to the shared Flower snapshot without dropping model metadata', () => {
    const snapshot = mapRuntimeFlowerSettings(settingsResponse());

    expect(snapshot.model_profile?.providers[0].models[0]).toEqual({
      model_name: 'gpt-4.1',
      context_window: 128000,
      max_output_tokens: 16384,
      effective_context_window_percent: 70,
      input_modalities: ['text', 'image'],
    });
    expect(snapshot.provider_secrets).toEqual([{
      provider_id: 'default',
      provider_api_key_configured: true,
      web_search_api_key_configured: true,
    }]);
  });

  it('builds provider bundle updates for the runtime gateway', () => {
    const draft = {
      model_profile: {
        ...mapRuntimeFlowerSettings(settingsResponse()).model_profile!,
        providers: [{
          ...mapRuntimeFlowerSettings(settingsResponse()).model_profile!.providers[0],
          provider_api_key: 'sk-test',
          web_search_api_key: 'brave-test',
        }],
      },
    };

    expect(mapFlowerSettingsDraftToRuntimeBundle(draft)).toMatchObject({
      model_profile: {
        current_model_id: 'default/gpt-4.1',
        providers: [{ id: 'default', models: [{ model_name: 'gpt-4.1' }] }],
      },
      provider_api_key_patches: [{ provider_id: 'default', api_key: 'sk-test' }],
      web_search_provider_key_patches: [{ provider_id: 'default', api_key: 'brave-test' }],
    });
  });

  it('sends null secret patches when the settings draft clears provider keys', () => {
    const draft = {
      model_profile: {
        ...mapRuntimeFlowerSettings(settingsResponse()).model_profile!,
        providers: [{
          ...mapRuntimeFlowerSettings(settingsResponse()).model_profile!.providers[0],
          provider_api_key: null,
          web_search_api_key: null,
        }],
      },
    };

    expect(mapFlowerSettingsDraftToRuntimeBundle(draft)).toMatchObject({
      provider_api_key_patches: [{ provider_id: 'default', api_key: null }],
      web_search_provider_key_patches: [{ provider_id: 'default', api_key: null }],
    });
  });

  it('maps runtime threads to runtime ownership metadata', () => {
    const mapped = mapRuntimeFlowerThread(threadView());

    expect(mapped).toMatchObject({
      thread_id: 'thread-1',
      title_status: 'ready',
      home_runtime_id: 'env:local-environment',
      home_runtime_kind: 'local_environment',
      source_label: 'Local Environment',
      target_labels: ['Local Environment'],
    });
    expect(mapped.read_status.is_unread).toBe(false);
  });

  it('maps runtime run_error_code into shared thread error metadata', () => {
    const mapped = mapRuntimeFlowerThread(threadView({
      run_status: 'failed',
      run_error_code: 'provider_auth_failed',
      run_error: 'The selected AI provider rejected the saved credentials.',
    }));

    expect(mapped.status).toBe('failed');
    expect(mapped.error).toEqual({
      code: 'provider_auth_failed',
      message: 'The selected AI provider rejected the saved credentials.',
    });

    const interrupted = mapRuntimeFlowerThread(threadView({
      run_status: 'canceled',
      run_error_code: 'runtime_restarted',
      run_error: 'The local runtime restarted before this reply finished.',
    }));
    expect(interrupted.status).toBe('canceled');
    expect(interrupted.error).toEqual({
      code: 'runtime_restarted',
      message: 'The local runtime restarted before this reply finished.',
    });
  });

  it('loads settings, models, threads, live bootstrap, and sends runs through runtime Flower IPC', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      if (request.path === '/_redeven_proxy/api/ai/models') return { current_model: 'default/gpt-4.1', models: [{ id: 'default/gpt-4.1' }] };
      if (request.path === '/_redeven_proxy/api/ai/threads?limit=200') return { threads: [threadView()] };
      if (request.path === '/_redeven_proxy/api/ai/turns') {
        return { client_request_id: 'client_desktop-message', thread_id: 'th_desktop_new', turn_id: 'turn-1', run_id: 'run-1', kind: 'start' };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await adapter.loadSettings();
    await adapter.listThreads();
    const receipt = await adapter.launchTurn({
      client_request_id: 'client_desktop-message',
      staging_scope: stagingScope('client_desktop-message'),
      prompt: 'hello',
    });

    expect(receipt).toEqual({
      client_request_id: 'client_desktop-message',
      thread_id: 'th_desktop_new',
      turn_id: 'turn-1',
      run_id: 'run-1',
      kind: 'start',
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /_redeven_proxy/api/settings',
      'GET /_redeven_proxy/api/ai/threads?limit=200',
      'GET /_redeven_proxy/api/settings',
      'GET /_redeven_proxy/api/ai/models',
      'POST /_redeven_proxy/api/ai/turns',
    ]);
    expect(calls.find((call) => call.path === '/_redeven_proxy/api/ai/turns')?.body).toMatchObject({
      staging_scope_id: 'staging_client_desktop-message',
      model: 'default/gpt-4.1',
      input: { text: 'hello', attachments: [] },
      options: { permission_type: 'approval_required' },
      create: { client_request_id: 'client_desktop-message', title: '', model_id: 'default/gpt-4.1', permission_type: 'approval_required' },
    });
    expect(calls.at(-1)).toMatchObject({
      staging_scope_id: 'staging_client_desktop-message',
      staging_capability: 'secret_client_desktop-message',
    });
  });

  it('rejects a receipt that changes the echoed client request identity', async () => {
    const bridge = bridgeFor((request) => {
      if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      if (request.path === '/_redeven_proxy/api/ai/models') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-existing/turns') {
        return { client_request_id: 'client-other', thread_id: 'thread-existing', turn_id: 'turn-other', run_id: 'run-other', kind: 'start' };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });

    await expect(launchLocalEnvironmentFlowerTurn(bridge, {
      thread_id: 'thread-existing',
      client_request_id: 'client-request',
      prompt: 'send once',
    })).rejects.toMatchObject({
      message: 'Flower turn admission returned an invalid receipt.',
      uncertain_admission: { client_request_id: 'client-request', thread_id: 'thread-existing' },
    });
  });

  it('restores a definite runtime rejection but preserves uncertain transport and receipt failures', async () => {
    const requestRuntimeFlower = vi.fn(async (request: RuntimeFlowerRequest) => {
      if (request.path === '/_redeven_proxy/api/settings') {
        return { ok: true as const, data: settingsResponse() };
      }
      if (request.path === '/_redeven_proxy/api/ai/models') {
        return { ok: true as const, data: { current_model: 'default/gpt-4.1' } };
      }
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-existing/turns') {
        return {
          ok: false as const,
          error: { code: 'turn_rejected', message: 'Turn rejected.', status: 409 },
          failureKind: 'response' as const,
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const definiteBridge: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower,
      cancel: vi.fn(),
    };
    const definiteFailure = await launchLocalEnvironmentFlowerTurn(definiteBridge, {
      thread_id: 'thread-existing',
      client_request_id: 'client-definite',
      prompt: 'send once',
    }).catch((error: unknown) => error);
    expect(definiteFailure).toMatchObject({ message: 'Turn rejected.', code: 'turn_rejected', status: 409 });
    expect(definiteFailure).not.toHaveProperty('uncertain_admission');

    const transportBridge: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower: vi.fn(async (request) => {
        if (request.path === '/_redeven_proxy/api/settings') {
          return { ok: true as const, data: settingsResponse() };
        }
        if (request.path === '/_redeven_proxy/api/ai/models') {
          return { ok: true as const, data: { current_model: 'default/gpt-4.1' } };
        }
        if (request.path === '/_redeven_proxy/api/ai/threads/thread-existing/turns') {
          return {
            ok: false as const,
            error: { code: 'runtime_flower_transport_error', message: 'runtime response lost' },
            failureKind: 'transport_unknown' as const,
          };
        }
        throw new Error(`unexpected path: ${request.path}`);
      }),
      cancel: vi.fn(),
    };
    await expect(launchLocalEnvironmentFlowerTurn(transportBridge, {
      thread_id: 'thread-existing',
      client_request_id: 'client-transport',
      prompt: 'send once',
    })).rejects.toMatchObject({
      uncertain_admission: { client_request_id: 'client-transport', thread_id: 'thread-existing' },
    });

    const malformedBridge = bridgeFor((request) => {
      if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      if (request.path === '/_redeven_proxy/api/ai/models') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-existing/turns') {
        return { turn_id: 'turn-malformed', kind: 'start' };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    await expect(launchLocalEnvironmentFlowerTurn(malformedBridge, {
      thread_id: 'thread-existing',
      client_request_id: 'client-malformed',
      prompt: 'send once',
    })).rejects.toMatchObject({
      message: 'Flower turn admission returned an invalid receipt.',
      uncertain_admission: { client_request_id: 'client-malformed', thread_id: 'thread-existing' },
    });

    const invalidJSONBridge: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower: vi.fn(async (request) => {
        if (request.path === '/_redeven_proxy/api/settings') {
          return { ok: true as const, data: settingsResponse() };
        }
        if (request.path === '/_redeven_proxy/api/ai/models') {
          return { ok: true as const, data: { current_model: 'default/gpt-4.1' } };
        }
        if (request.path === '/_redeven_proxy/api/ai/threads/thread-existing/turns') {
          return {
            ok: false as const,
            error: {
              code: 'runtime_flower_invalid_json',
              message: 'Flower returned an invalid JSON response.',
              status: 200,
            },
            failureKind: 'response' as const,
          };
        }
        throw new Error(`unexpected path: ${request.path}`);
      }),
      cancel: vi.fn(),
    };
    await expect(launchLocalEnvironmentFlowerTurn(invalidJSONBridge, {
      thread_id: 'thread-existing',
      client_request_id: 'client-invalid-json',
      prompt: 'send once',
    })).rejects.toMatchObject({
      code: 'runtime_flower_invalid_json',
      uncertain_admission: { client_request_id: 'client-invalid-json', thread_id: 'thread-existing' },
    });
  });

  it.each([
    ['empty response', ''],
    ['HTML response', '<!doctype html><title>proxy error</title>'],
    ['malformed JSON response', '{"ok":true'],
  ])('preserves exact new-thread admission identity for an invalid %s', async (_label, responseBody) => {
    const calls: RuntimeFlowerRequest[] = [];
    let receivedTurnBody: unknown;
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      request.on('end', () => {
        receivedTurnBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(responseBody);
      });
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('test server did not expose a TCP address'));
          return;
        }
        resolve(address.port);
      });
    });
    const clientRequestID = 'client-desktop-invalid-json';
    const bridge: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower: vi.fn(async (request) => {
        calls.push(request);
        if (request.path === '/_redeven_proxy/api/settings') {
          return { ok: true as const, data: settingsResponse() };
        }
        if (request.path === '/_redeven_proxy/api/ai/models') {
          return { ok: true as const, data: { current_model: 'default/gpt-4.1' } };
        }
        if (request.path === '/_redeven_proxy/api/ai/turns') {
          const response = await requestRuntimeFlowerHTTP(
            new URL(request.path, 'http://127.0.0.1:' + String(port)),
            request,
          );
          const parsed = parseRuntimeFlowerJSON(response.body);
          const invalidJSONError = runtimeFlowerInvalidJSONError(response, parsed);
          if (!invalidJSONError) {
            return { ok: true as const, data: parsed };
          }
          return {
            ok: false as const,
            error: invalidJSONError,
            failureKind: 'response' as const,
          };
        }
        throw new Error('unexpected runtime Flower path');
      }),
      cancel: vi.fn(),
    };

    try {
      const failure = await launchLocalEnvironmentFlowerTurn(bridge, {
        client_request_id: clientRequestID,
        staging_scope: stagingScope(clientRequestID),
        prompt: 'new conversation',
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        message: 'Flower returned an invalid JSON response.',
        code: 'runtime_flower_invalid_json',
        uncertain_admission: { client_request_id: clientRequestID },
      });
      expect((failure as Error).message.toLowerCase()).not.toBe('invalid json');
      const turnRequest = calls.find((call) => call.method === 'POST' && call.path.endsWith('/turns'));
      expect(turnRequest).toMatchObject({
        path: '/_redeven_proxy/api/ai/turns',
        staging_scope_id: 'staging_client-desktop-invalid-json',
        body: {
          staging_scope_id: 'staging_client-desktop-invalid-json',
          input: { text: 'new conversation', attachments: [] },
          create: {
            client_request_id: clientRequestID,
            title: '',
            model_id: 'default/gpt-4.1',
            permission_type: 'approval_required',
          },
        },
      });
      expect(receivedTurnBody).toEqual(turnRequest?.body);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('updates the current model through runtime Flower IPC', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const onSettingsChanged = vi.fn();
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/current_model') {
        return { current_model: 'default/gpt-5.4', models: [{ id: 'default/gpt-5.4' }] };
      }
      if (request.path === '/_redeven_proxy/api/settings') {
        const settings = settingsResponse();
        const provider = settings.ai?.providers?.[0];
        return {
          ...settings,
          ai: settings.ai && provider
            ? {
                ...settings.ai,
                current_model_id: 'default/gpt-5.4',
                providers: [{
                  ...provider,
                  models: [{ model_name: 'gpt-5.4' }],
                }],
              }
            : settings.ai,
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge, { onSettingsChanged });

    const snapshot = await adapter.persistDefaultModel('default/gpt-5.4');

    expect(calls).toEqual([
      {
        method: 'PUT',
        path: '/_redeven_proxy/api/ai/current_model',
        body: { model_id: 'default/gpt-5.4' },
      },
      { method: 'GET', path: '/_redeven_proxy/api/settings' },
    ]);
    expect(snapshot.model_profile?.current_model_id).toBe('default/gpt-5.4');
    expect(onSettingsChanged).toHaveBeenCalledTimes(1);
  });

  it('loads working directory picker data through read-only runtime FS IPC', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/fs/path_context') {
        return {
          agent_home_path_abs: '/Users/alice/.redeven/local-environment',
          home_path_abs: '/Users/alice',
          default_root_id: 'home',
          roots: [{
            id: 'home',
            label: 'Home',
            path_abs: '/Users/alice',
            kind: 'home',
            permissions: { read: true, write: true },
          }],
        };
      }
      if (request.path === '/_redeven_proxy/api/fs/list') {
        return {
          entries: [{
            name: 'redeven',
            path: '/Users/alice/redeven',
            is_directory: true,
            size: 0,
            modified_at: 1234,
          }],
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    const context = await adapter.getWorkingDirectoryPathContext?.();
    const entries = await adapter.listWorkingDirectoryEntries?.({
      path: '/Users/alice',
      showHidden: true,
    });

    expect(context).toEqual({
      agentHomePathAbs: '/Users/alice/.redeven/local-environment',
      homePathAbs: '/Users/alice',
      defaultRootId: 'home',
      roots: [{
        id: 'home',
        label: 'Home',
        pathAbs: '/Users/alice',
        kind: 'home',
        permissions: { read: true, write: true },
      }],
    });
    expect(entries).toEqual([{
      name: 'redeven',
      path: '/Users/alice/redeven',
      isDirectory: true,
      size: 0,
      modifiedAt: 1234,
    }]);
    expect(calls).toEqual([
      { method: 'GET', path: '/_redeven_proxy/api/fs/path_context' },
      {
        method: 'POST',
        path: '/_redeven_proxy/api/fs/list',
        body: { path: '/Users/alice', show_hidden: true },
      },
    ]);
  });

  it('returns the input admission receipt without reloading live bootstrap', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/input_response') {
        return {
          turn_id: 'turn-continue',
          run_id: 'run-1',
          kind: 'start',
          consumed_waiting_prompt_id: 'prompt-1',
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    const receipt = await adapter.submitInput({
      thread_id: 'thread-1',
      prompt_id: 'prompt-1',
      answers: {
        target: { choice_id: 'staging', text: 'Staging' },
      },
    });

    expect(receipt).toEqual({
      thread_id: 'thread-1',
      turn_id: 'turn-continue',
      run_id: 'run-1',
      consumed_prompt_id: 'prompt-1',
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/_redeven_proxy/api/ai/threads/thread-1/input_response',
      body: {
        thread_id: 'thread-1',
        response: {
          prompt_id: 'prompt-1',
          answers: {
            target: { choice_id: 'staging', text: 'Staging' },
          },
        },
      },
    });
    expect(calls.map((call) => call.path)).toEqual([
      '/_redeven_proxy/api/ai/threads/thread-1/input_response',
    ]);
  });

  it('rejects an input admission receipt for a different waiting prompt', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/input_response') {
        return {
          turn_id: 'turn-continue',
          run_id: 'run-1',
          kind: 'start',
          consumed_waiting_prompt_id: 'prompt-other',
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await expect(adapter.submitInput({
      thread_id: 'thread-1',
      prompt_id: 'prompt-1',
      answers: { target: { choice_id: 'staging' } },
    })).rejects.toThrow('Flower input response admission returned an invalid receipt.');

    expect(calls.map((call) => call.path)).toEqual([
      '/_redeven_proxy/api/ai/threads/thread-1/input_response',
    ]);
  });

  it('stops threads through the runtime cancel endpoint and reloads live bootstrap', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/cancel') return { ok: true };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/live/bootstrap') return liveBootstrap({ run_status: 'canceled' });
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    const bootstrap = await adapter.stopThread('thread-1');

    expect(bootstrap.thread.status).toBe('canceled');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /_redeven_proxy/api/ai/threads/thread-1/cancel',
      'GET /_redeven_proxy/api/ai/threads/thread-1/live/bootstrap',
    ]);
    expect(calls[0].body).toEqual({});
  });

  it('deletes threads through the force-only runtime endpoint', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      return {
        operation_id: 'delete_operation_1',
        status: 'committed',
        intent_persisted: true,
      };
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await expect(adapter.deleteThread?.('thread /1')).resolves.toEqual({ status: 'committed' });
    expect(calls).toEqual([{
      method: 'DELETE',
      path: '/_redeven_proxy/api/ai/threads/thread%20%2F1?force=true',
    }]);
  });

  it('accepts only response-scoped terminal delete receipts with the fixed machine error', async () => {
    const validReceipt = {
      operation_id: 'delete_operation_1',
      status: 'failed',
      intent_persisted: true,
    };
    const bridgeForFailure = (code: string, data: unknown, failureKind: 'response' | 'local' = 'response'): DesktopSettingsBridge => ({
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower: vi.fn(async () => ({
        ok: false as const,
        error: { code, message: 'Thread delete failed.', status: 500, data },
        failureKind,
      })),
      cancel: vi.fn(),
    });

    await expect(createLocalEnvironmentFlowerSurfaceAdapter(
      bridgeForFailure('AI_THREAD_DELETE_OPERATION_FAILED', validReceipt),
    ).deleteThread?.('thread-1')).resolves.toEqual({ status: 'failed' });

    await expect(createLocalEnvironmentFlowerSurfaceAdapter(
      bridgeForFailure('AI_THREAD_DELETE_OPERATION_FAILED', { ...validReceipt, operation_id: '' }),
    ).deleteThread?.('thread-1')).rejects.toThrow('Flower thread delete returned an invalid receipt.');

    await expect(createLocalEnvironmentFlowerSurfaceAdapter(
      bridgeForFailure('AI_THREAD_DELETE_OPERATION_FAILED', undefined),
    ).deleteThread?.('thread-1')).rejects.toThrow('Flower thread delete returned an invalid receipt.');

    await expect(createLocalEnvironmentFlowerSurfaceAdapter(
      bridgeForFailure('UNKNOWN_DELETE_ERROR', validReceipt),
    ).deleteThread?.('thread-1')).rejects.toMatchObject({ code: 'UNKNOWN_DELETE_ERROR', data: validReceipt });

    await expect(createLocalEnvironmentFlowerSurfaceAdapter(
      bridgeForFailure('AI_THREAD_DELETE_OPERATION_FAILED', validReceipt, 'local'),
    ).deleteThread?.('thread-1')).rejects.toMatchObject({
      code: 'AI_THREAD_DELETE_OPERATION_FAILED',
      failureKind: 'local',
    });
  });

  it('compacts threads through the runtime compact endpoint and reloads live bootstrap', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/context/compact') {
        return { operation_id: 'manual-compact-1', kind: 'accepted' };
      }
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/live/bootstrap') {
        return liveBootstrap({ run_status: 'running' });
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    const bootstrap = await adapter.compactThreadContext({
      thread_id: ' thread-1 ',
      active_run_id: ' run-1 ',
    });

    expect(bootstrap.thread.status).toBe('running');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /_redeven_proxy/api/ai/threads/thread-1/context/compact',
      'GET /_redeven_proxy/api/ai/threads/thread-1/live/bootstrap',
    ]);
    expect(calls[0].body).toEqual({
      thread_id: 'thread-1',
      active_run_id: 'run-1',
    });
  });

  it('loads streaming live state from the canonical live bootstrap endpoint', async () => {
    const bridge = bridgeFor((request) => {
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/live/bootstrap') {
        return {
          ...liveBootstrap({ run_status: 'running', cursor: 9 }, [{
            id: 'assistant-live',
            thread_id: 'thread-1',
            turn_id: 'turn-1',
            run_id: 'run-1',
            role: 'assistant',
            status: 'streaming',
            created_at_ms: 42_000,
            active_cursor: true,
            blocks: [{ type: 'markdown', content: 'working live' }],
          }]),
          cursor: 9,
          live_state: {
            thread_patch: { run_status: 'running' },
            runs: {
              'run-1': { run_id: 'run-1', status: 'running', message_id: 'assistant-live' },
            },
            model_io: {
              phase: 'streaming',
              run_id: 'run-1',
              updated_at_ms: 42_001,
            },
            context_usage: {
              run_id: 'run-1',
              phase: 'projected_request',
              input_tokens: 620,
              context_window_tokens: 1000,
              used_ratio: 0.62,
              pressure_status: 'stable',
              updated_at_ms: 42_002,
            },
            context_compactions: [{
              operation_id: 'compact-1',
              run_id: 'run-1',
              phase: 'complete',
              status: 'compacted',
              tokens_before: 900,
              tokens_after_estimate: 200,
              updated_at_ms: 42_003,
            }],
            timeline_decorations: [{
              decoration_id: 'context-compaction:compact-1',
              kind: 'context_compaction',
              anchor: {
                target_kind: 'message',
                message_id: 'assistant-live',
                edge: 'after',
              },
              ordinal: 0,
              compaction: {
                operation_id: 'compact-1',
                run_id: 'run-1',
                phase: 'complete',
                status: 'compacted',
                tokens_before: 900,
                tokens_after_estimate: 200,
                updated_at_ms: 42_003,
              },
            }],
            approval_actions: {},
            input_requests: {},
          },
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    const snapshot = await adapter.loadThread('thread-1');

    expect(snapshot.thread.status).toBe('running');
    const projected = projectFlowerLiveBootstrap(snapshot);
    expect(projected.messages[0]).toMatchObject({
      id: 'assistant-live',
      role: 'assistant',
      content: 'working live',
      status: 'streaming',
      active_cursor: true,
    });
    expect(projected.active_run_id).toBe('run-1');
    expect(projected.model_io_status?.run_id).toBe('run-1');
    expect(projected.context_usage).toMatchObject({
      run_id: 'run-1',
      input_tokens: 620,
      pressure_status: 'stable',
    });
    expect(projected.context_compactions?.[0]).toMatchObject({
      operation_id: 'compact-1',
      status: 'compacted',
    });
    expect(projected.timeline_decorations?.[0]).toMatchObject({
      kind: 'context_compaction',
      compaction: { operation_id: 'compact-1' },
    });
    expect(snapshot.cursor).toBe(9);
  });

  it('submits approval decisions with live sequence and revision through the runtime thread endpoint', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/approvals') return { ok: true };
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await adapter.submitApproval({
      thread_id: 'thread-1',
      origin: 'main_tool',
      run_id: 'run-1',
      action_id: 'appr-1',
      tool_id: 'tool-1',
      approved: true,
      expected_seq: 12,
      revision: 1,
      queue_generation: 3,
      queue_revision: 4,
    });

    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/_redeven_proxy/api/ai/threads/thread-1/approvals',
      body: {
        thread_id: 'thread-1',
        origin: 'main_tool',
        run_id: 'run-1',
        action_id: 'appr-1',
        tool_id: 'tool-1',
        approved: true,
        expected_seq: 12,
        revision: 1,
        queue_generation: 3,
        queue_revision: 4,
      },
    });
  });

  it('launches environment card turns through the shared runtime launch contract', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    let acceptedTurnID = '';
    const contextAction = {
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      provider: 'flower',
      target: {
        target_id: 'local:local',
        locality: 'auto',
      },
      source: {
        surface: 'desktop_welcome_environment_card',
        surface_id: 'local',
      },
      execution_context: {
        current_target_id: 'local:local',
        runtime_hint: 'auto',
        session_source: 'local_runtime',
      },
      context: [{
        kind: 'text_snapshot',
        title: 'Local Environment',
        detail: 'Local · Ready',
        content: 'Environment: Local Environment\nKind: local_environment\nEnvironment ID: local',
      }],
      presentation: {
        label: 'Ask Flower',
        priority: 100,
      },
    };
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      if (request.path === '/_redeven_proxy/api/ai/models') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/turns') {
        acceptedTurnID = 'turn-card';
        return { client_request_id: 'client-card', thread_id: 'th_card', turn_id: acceptedTurnID, run_id: 'run-card', kind: 'start' };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });

    await launchLocalEnvironmentFlowerTurn(bridge, {
      client_request_id: 'client-card',
      staging_scope: stagingScope('client-card'),
      prompt: 'inspect env',
      context_action: contextAction,
      working_dir: '/workspace/redeven',
      attachment_ids: ['upl_notes'],
      permission_type: 'readonly',
    });

    expect(calls.find((call) => call.path === '/_redeven_proxy/api/ai/turns')?.body).toMatchObject({
      staging_scope_id: 'staging_client-card',
      create: {
        client_request_id: 'client-card',
        working_dir: '/workspace/redeven',
        permission_type: 'readonly',
      },
    });
    expect(calls.find((call) => call.path === '/_redeven_proxy/api/ai/turns')?.body).toEqual({
      staging_scope_id: 'staging_client-card',
      model: 'default/gpt-4.1',
      input: {
        text: 'inspect env',
        attachments: [{ attachment_id: 'upl_notes' }],
        context_action: contextAction,
      },
      options: {
        permission_type: 'readonly',
      },
      create: {
        client_request_id: 'client-card',
        title: '',
        model_id: 'default/gpt-4.1',
        permission_type: 'readonly',
        working_dir: '/workspace/redeven',
      },
    });
  });

  it('admits a reference-only Flower composer turn through the Desktop bridge', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const contextAction = {
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      provider: 'flower',
      target: { target_id: 'current', locality: 'auto' },
      source: { surface: 'flower_composer' },
      context: [{ kind: 'file_path', path: '/workspace/main.ts', is_directory: false }],
      presentation: { label: 'Ask Flower', priority: 100 },
    } as const;
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      if (request.path === '/_redeven_proxy/api/ai/models') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/turns') {
        return { client_request_id: 'client-reference', thread_id: 'th_reference', turn_id: 'turn-reference', run_id: 'run-reference', kind: 'start' };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });

    await expect(launchLocalEnvironmentFlowerTurn(bridge, {
      client_request_id: 'client-reference',
      staging_scope: stagingScope('client-reference'),
      prompt: '',
      context_action: contextAction,
    })).resolves.toMatchObject({
      thread_id: 'th_reference',
      run_id: 'run-reference',
    });

    expect(calls.find((call) => call.path === '/_redeven_proxy/api/ai/turns')?.body)
      .toMatchObject({
        staging_scope_id: 'staging_client-reference',
        input: { text: '', attachments: [], context_action: contextAction },
        create: { client_request_id: 'client-reference', model_id: 'default/gpt-4.1' },
      });
  });

  it('rejects invalid explicit context actions instead of dropping linked context', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      if (request.path === '/_redeven_proxy/api/ai/models') return { current_model: 'default/gpt-4.1' };
      throw new Error(`unexpected path: ${request.path}`);
    });

    await expect(launchLocalEnvironmentFlowerTurn(bridge, {
      client_request_id: 'client-invalid-context',
      prompt: 'inspect env',
      context_action: {
        schema_version: 2,
        action_id: 'assistant.ask.flower',
        provider: 'codex',
        target: { target_id: 'local:local', locality: 'auto' },
        source: { surface: 'desktop_welcome_environment_card' },
        context: [],
        presentation: { label: 'Ask Flower', priority: 100 },
      },
    })).rejects.toThrow('Invalid Flower context action.');

    expect(calls).toEqual([]);
  });

  it('admits an attachment-only turn from a previously staged upload', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      if (request.path === '/_redeven_proxy/api/ai/models') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-upload/turns') {
        return { turn_id: 'turn-upload', run_id: 'run-upload', kind: 'start' };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });

    await expect(launchLocalEnvironmentFlowerTurn(bridge, {
      client_request_id: 'client-upload',
      thread_id: 'thread-upload',
      staging_scope: stagingScope('thread-upload'),
      prompt: '',
      attachment_ids: ['upl_notes'],
    })).resolves.toMatchObject({ thread_id: 'thread-upload', run_id: 'run-upload' });

    expect(calls.map((call) => call.path)).toEqual([
      '/_redeven_proxy/api/settings',
      '/_redeven_proxy/api/ai/models',
      '/_redeven_proxy/api/ai/threads/thread-upload/turns',
    ]);
  });

  it('previews staged attachments through authenticated Desktop IPC only', async () => {
    const previewRuntimeFlowerAttachment = vi.fn(async () => ({ ok: true as const }));
    const bridge = {
      ...bridgeFor(() => ({})),
      previewRuntimeFlowerAttachment,
    };
    const directOpen = vi.fn();
    vi.stubGlobal('open', directOpen);
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
    const attachment = {
      attachment_id: 'upl_preview_notes',
      name: '../release-notes.txt',
      mime_type: 'text/plain',
      size_bytes: 13,
      digest_sha256: 'c'.repeat(64),
      locator: 'attachment://v1/upl_preview_notes/release-notes.txt',
      source: 'file' as const,
      capability_revision: 'capability-1',
    };

    await expect(adapter.previewStagedAttachment?.(attachment, stagingScope('thread-preview'))).resolves.toBeUndefined();
    expect(previewRuntimeFlowerAttachment).toHaveBeenCalledWith({
      attachment_id: 'upl_preview_notes',
      staging_scope_id: 'staging_thread-preview',
      staging_capability: 'secret_thread-preview',
      display_name: '../release-notes.txt',
    });
    expect(directOpen).not.toHaveBeenCalled();
  });

  it('surfaces Desktop attachment preview failures', async () => {
    const bridge = {
      ...bridgeFor(() => ({})),
      previewRuntimeFlowerAttachment: vi.fn(async () => ({ ok: false as const, message: 'Preview access expired.' })),
    };
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await expect(adapter.previewStagedAttachment?.({
      attachment_id: 'upl_preview_expired',
      name: 'notes.txt',
      mime_type: 'text/plain',
      size_bytes: 5,
      digest_sha256: 'd'.repeat(64),
      locator: 'attachment://v1/upl_preview_expired/notes.txt',
      source: 'file',
      capability_revision: 'capability-1',
    }, stagingScope('thread-preview'))).rejects.toThrow('Preview access expired.');
  });
});
