import { modelDirectoryWireFixture } from '../../../../internal/envapp/ui_src/src/test/modelDirectoryWireFixture';
import { resolveFlowerProviderModels } from '../../../../internal/flower_ui/src/settings/modelSelection';
import { flowerLiveWireFixture } from '../../../../internal/flower_ui/src/test/flowerLiveWireFixture';
import { describe, expect, it, vi } from 'vitest';

import {
  createLocalEnvironmentFlowerSurfaceAdapter,
  launchLocalEnvironmentFlowerTurn,
  mapFlowerSettingsDraftToRuntimeBundle,
  mapRuntimeFlowerSettings,
  type DesktopSettingsBridge,
} from './localEnvironmentFlowerSurfaceAdapter';
import type { RuntimeFlowerRequest } from '../../shared/runtimeFlowerIPC';
import type { RuntimeFlowerStreamEvent, RuntimeFlowerStreamRequest } from '../../shared/runtimeFlowerIPC';
import type { AgentSettingsResponse } from '../../../../internal/envapp/ui_src/src/ui/pages/settings/types';

const stagingScope = (threadID: string) => ({
  staging_scope_id: `staging_${threadID}`,
  target_id: threadID,
  capability: `secret_${threadID}`,
  expires_at_unix_ms: 10_000,
});

function readStatus(isUnread = false, revision = 2, _status = 'idle') {
  return {
    is_unread: isUnread,
    snapshot: { activity_revision: revision },
    read_state: {
      last_seen_activity_revision: isUnread ? Math.max(0, revision - 1) : revision,
    },
  };
}

function settingsResponse(): AgentSettingsResponse {
  return {
    config_path: '/Users/me/.redeven/local-environment/config.json',
    connection: {
      access_point_origin: '',
      environment_id: 'local-environment',
      agent_instance_id: 'agent-local',
      direct: {
        artifact_provisioned: false,
        expires_at_unix_s: 0,
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
      web_search: { enabled: true, source: 'brave' as const },
      models: [{
          model_name: 'gpt-4.1',
          context_window: 128000,
          max_output_tokens: 16384,
          effective_context_window_percent: 70,
          input_modalities: ['text', 'image'] as const,
        }],
      }],
      permission_type: 'approval_required',
      computer_use_enabled: true,
      auto_update_model_catalog: false,
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
    title_status: 'ready', title_generation: 1,
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

function currentView(overrides: Record<string, unknown> = {}) {
  return {
    thread_id: 'thread-1',
    view_version: 1,
    activity: 'idle',
    run_id: 'run-1',
    items: [],
    queue: [],
    interactions: [],
    ...overrides,
  };
}

function detailView(overrides: Record<string, unknown> = {}, currentOverrides: Record<string, unknown> = {}) {
  const thread = threadView(overrides);
  return { thread, current: currentView({ thread_id: thread.thread_id, ...currentOverrides }) };
}

function bridgeFor(handler: (request: RuntimeFlowerRequest) => unknown | Promise<unknown>): DesktopSettingsBridge {
  let settings = settingsResponse();
  return {
    ...attachmentBridgeStubs(),
    save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
    requestRuntimeFlower: vi.fn(async (request: RuntimeFlowerRequest) => {
      const data = await handler(request);
      if (request.path === '/_redeven_proxy/api/settings') settings = data as AgentSettingsResponse;
      return { ok: true as const, data: request.path.startsWith('/_redeven_proxy/api/ai/models') ? modelDirectoryWireFixture(settings, data as Record<string, unknown>) : data };
    }),
    cancel: vi.fn(),
  };
}

function attachmentBridgeStubs() {
  return {
    load: vi.fn(async () => ({ ok: false as const, error: 'No access fixture' })),
    startRuntimeFlowerStream: vi.fn(async () => ({ ok: true as const, status: 200, content_type: 'text/event-stream' })),
    cancelRuntimeFlowerStream: vi.fn(),
    subscribeRuntimeFlowerStream: vi.fn(() => () => undefined),
    prepareRuntimeFlowerAttachment: vi.fn(async () => ({ ok: false, message: 'not configured' })),
    writeRuntimeFlowerAttachmentChunk: vi.fn(async () => ({ ok: false, message: 'not configured' })),
    commitRuntimeFlowerAttachment: vi.fn(async () => ({ ok: false, failureKind: 'local' as const })),
    cancelRuntimeFlowerAttachment: vi.fn(async () => ({ ok: true, cancelled: true })),
    subscribeRuntimeFlowerAttachmentProgress: vi.fn(() => () => undefined),
    previewRuntimeFlowerAttachment: vi.fn(async () => ({ ok: true })),
  };
}

describe('Local Environment Flower surface adapter', () => {
  it('round-trips Responses continuation through settings and provider bundles', () => {
    const base = settingsResponse();
    const settings: AgentSettingsResponse = { ...base, ai: { ...base.ai, providers: [
      { id: 'openai', type: 'openai', responses_continuation: true, models: [{ model_name: 'gpt-5-mini' }] },
    ] } };
    const snapshot = mapRuntimeFlowerSettings(settings);
    expect(snapshot.model_profile!.providers[0].responses_continuation).toBe(true);
    const bundle = mapFlowerSettingsDraftToRuntimeBundle({ model_profile: snapshot.model_profile! });
    expect(bundle.model_profile.providers[0].responses_continuation).toBe(true);
  });

  it('uses backend model defaults from settings while model IPC is unavailable', async () => {
    const directory = { provider_defaults: { openai_compatible: [{ model_name: 'gpt-4.1', context_window: 128000 }] },
      provider_catalogs: { default: [{ model_name: 'gpt-4.1', context_window: 128000 }] },
      models: [{ id: 'default/gpt-4.1', source: 'runtime_config' as const, provider_id: 'default', model_name: 'gpt-4.1', state: 'ready' as const }],
      sources: [{ id: 'default', kind: 'runtime_config' as const, state: 'ready' as const }],
    };
    const bridge = bridgeFor(request => {
      if (request.path === '/_redeven_proxy/api/settings') return { ...settingsResponse(), ai_models: { current_model: 'default/gpt-4.1', directory } };
      throw new Error('Model IPC is offline.');
    });
    const surfaceAdapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
    const snapshot = await surfaceAdapter.loadSettings();
    expect(snapshot.model_directory?.models[0].state).toBe('ready');
    expect(snapshot.model_profile?.providers[0].model_defaults?.[0].context_window).toBe(128000);
    expect((await surfaceAdapter.loadModelDirectory!(true)).models[0].state).toBe('ready');
    expect(snapshot.defaults.auto_update_model_catalog).toBe(false);
  });

  it('settles stalled model IPC within ten seconds and keeps its late reply out of settings', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: unknown) => void;
      let hang = false;
      const bridge = bridgeFor(request => {
        if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
        if (!hang) return { current_model: 'default/agent', directory: {
          models: [{ id: 'default/agent', label: 'Agent', source: 'runtime_config', provider_id: 'default', model_name: 'agent', state: 'ready' }],
          sources: [{ id: 'default', kind: 'runtime_config', state: 'ready' }],
        } };
        return new Promise(resolve => { finish = resolve; });
      });
      const surfaceAdapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
      await surfaceAdapter.loadSettings();
      await surfaceAdapter.loadModelDirectory!();
      hang = true;
      const read = surfaceAdapter.loadModelDirectory!(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await read).toMatchObject({ checking: false, models: [{ id: 'default/agent', state: 'ready' }] });
      finish({ current_model: 'late/model', directory: { models: [], sources: [] } });
      await vi.advanceTimersByTimeAsync(0);
      expect((await surfaceAdapter.loadSettings()).model_directory?.current_model_id).toBe('default/agent');
    } finally { vi.useRealTimers(); }
  });

  it('updates runtime copy without replacing the adapter or transport', () => {
    let label = 'Local Environment';
    let subtitle = 'Local workspace';
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridgeFor(() => undefined), {
      get runtimeDisplayName() { return label; },
      get runtimeSubtitle() { return subtitle; },
    });
    const transport = adapter.connectLiveStream;
    expect(adapter.runtime.display_name).toBe(label);
    label = 'Updated environment';
    subtitle = 'Updated workspace';
    expect(adapter.runtime.display_name).toBe(label);
    expect(adapter.runtime.subtitle).toBe(subtitle);
    expect(adapter.connectLiveStream).toBe(transport);
  });

  it('refreshes dynamic catalogs without enabling new models or losing missing selections', async () => {
    for (const type of ['ollama', 'openrouter'] as const) {
      const base = settingsResponse();
      const settings: AgentSettingsResponse = { ...base, ai: { ...base.ai, current_model_id: 'dynamic/agent', providers: [{
        id: 'dynamic', type, base_url: 'http://localhost:11434/v1', models: [], model_selection: { selected_models: ['agent'] },
      }] } };
      let available = true;
      const bridge = bridgeFor((request) => {
        if (request.path === '/_redeven_proxy/api/settings') return settings;
        if (request.path.startsWith('/_redeven_proxy/api/ai/models')) {
          return { current_model: 'dynamic/agent', directory: { models: [{
            id: 'dynamic/agent', label: 'Agent', source: 'runtime_config', provider_id: 'dynamic', provider_type: type, model_name: 'agent',
            state: available ? 'ready' : 'unavailable', quantization: 'Q8_0', alias_group: 'digest',
          }], sources: [{ id: 'dynamic', kind: 'runtime_config', state: 'ready' }] } };
        }
        throw new Error(`Unexpected request ${request.path}`);
      });
      const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
      await adapter.loadSettings();
      await adapter.loadModelDirectory!();
      const initial = await adapter.loadSettings();
      expect(initial.model_directory?.models[0].state).toBe('ready');
      expect((await adapter.loadModelDirectory!()).models).toEqual([expect.objectContaining({ model_name: 'agent', alias_group: 'digest', quantization: 'Q8_0', state: 'ready' })]);
      available = false;
      expect((await adapter.loadModelDirectory!(true)).models[0].state).toBe('unavailable');
      const missing = await adapter.loadSettings();
      const bundle = mapFlowerSettingsDraftToRuntimeBundle({ model_profile: { ...missing.model_profile!, providers: missing.model_profile!.providers.map(provider => ({ ...provider, models: resolveFlowerProviderModels(provider) })) } });
      expect(bundle.model_profile.providers[0].model_selection?.selected_models).toEqual(['agent']);
      available = true;
      expect((await adapter.loadModelDirectory!(true)).models[0].state).toBe('ready');
    }
  });

  it('loads local media through the bounded preview route and honors cancellation', async () => {
    const bytes = new Uint8Array([0, 128, 255]);
    const bridge = bridgeFor(() => ({ bytes, mime_type: 'video/mp4' }));
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
    const controller = new AbortController();
    const blob = await adapter.loadMessageFile!({ path: '/project/a b.mp4', signal: controller.signal });
    expect(blob.type).toBe('video/mp4');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(bridge.requestRuntimeFlower).toHaveBeenCalledWith({ method: 'GET', path: '/_redeven_proxy/api/fs/file?path=%2Fproject%2Fa+b.mp4&preview=1' });
    controller.abort();
    await expect(adapter.loadMessageFile!({ path: '/project/a b.mp4', signal: controller.signal })).rejects.toThrow();
  });

  it.each(['image/png', 'text/plain', 'application/pdf'])('loads admitted %s attachments through the exact runtime bridge', async mimeType => {
    const bytes = new Uint8Array([0, 128, 255]);
    const bridge = bridgeFor(() => ({ bytes, mime_type: mimeType }));
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge, { runtimeEnvironmentID: 'environment_1' });
    const controller = new AbortController();
    const input = { url: '/_redeven_proxy/api/ai/uploads/upl_preview?thread_id=thread_1&turn_id=turn_1', signal: controller.signal };
    const blob = await adapter.loadMessageAttachment!(input);
    expect(blob.type).toBe(mimeType);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(bridge.requestRuntimeFlower).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: `${input.url}&preview=1`, environment_id: 'environment_1' });
    controller.abort();
    await expect(adapter.loadMessageAttachment!(input)).rejects.toThrow();
    expect(bridge.requestRuntimeFlower).toHaveBeenCalledTimes(1);
  });
  it('sends relative pin moves through the runtime bridge without loading detail', async () => {
    const pin = { thread_id: 'thread/source', pinned_at_unix_ms: 10, pin_rank: 3, settings_revision: 20 };
    const bridge = bridgeFor(() => ({ pins: [pin] }));
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
    const input = { anchor_thread_id: 'thread/anchor', placement: 'after' as const };
    expect(await adapter.movePinnedThread!('thread/source', input)).toEqual([{ thread_id: pin.thread_id, pinned_at_ms: 10, pin_rank: 3, settings_revision: 20 }]);
    expect(bridge.requestRuntimeFlower).toHaveBeenCalledExactlyOnceWith({ method: 'PATCH', path: '/_redeven_proxy/api/ai/threads/thread%2Fsource/pin-position', body: input });
  });
  it('loads computer media through the Desktop runtime bridge', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const bridge = bridgeFor(() => ({ bytes, mime_type: 'image/png' }));
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
    expect(adapter.loadComputerFrame).toBeTypeOf('function');
    const blob = await adapter.loadComputerFrame!({ thread_id: 'thread-1', target_id: 'browser-main',
      resource_ref: `computer://browser-main/${'a'.repeat(64)}`, sha256: 'a'.repeat(64), signal: new AbortController().signal });
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(bridge.requestRuntimeFlower).toHaveBeenCalledWith({ method: 'GET',
      path: `/_redeven_proxy/api/ai/threads/thread-1/computer-media/browser-main/${'a'.repeat(64)}` });
  });
  it('streams live events through Desktop IPC without the removed long-poll route', async () => {
    let streamListener: ((event: RuntimeFlowerStreamEvent) => void) | undefined;
    const startRuntimeFlowerStream = vi.fn(async (request: RuntimeFlowerStreamRequest) => {
      queueMicrotask(() => {
        const data = flowerLiveWireFixture({ schema_version: 1, kind: 'ready' })[0]!.data;
        streamListener?.({ stream_id: request.stream_id, kind: 'chunk', chunk: new TextEncoder().encode(`data: ${data}\n\n`) });
        streamListener?.({ stream_id: request.stream_id, kind: 'end' });
      });
      return { ok: true as const, status: 200, content_type: 'text/event-stream' };
    });
    const bridge: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower: vi.fn(),
      startRuntimeFlowerStream,
      subscribeRuntimeFlowerStream: vi.fn((listener) => {
        streamListener = listener;
        return () => { streamListener = undefined; };
      }),
      cancel: vi.fn(),
    };
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
    const controller = new AbortController();
    const frames = [];
    for await (const frame of adapter.connectLiveStream!({ signal: controller.signal })) frames.push(frame);

    expect(frames).toEqual([{
      schema_version: 1,
      kind: 'ready',
    }]);
    expect(startRuntimeFlowerStream).toHaveBeenCalledWith(expect.objectContaining({
      path: '/_redeven_proxy/api/ai/flower/stream',
    }));
  });

  it('delivers each current update before the Desktop IPC stream ends', async () => {
    let listener: ((event: RuntimeFlowerStreamEvent) => void) | undefined;
    let id = '';
    const bridge: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower: vi.fn(), cancel: vi.fn(),
      startRuntimeFlowerStream: vi.fn(async request => {
        id = request.stream_id;
        return { ok: true as const, status: 200, content_type: 'text/event-stream' };
      }),
      subscribeRuntimeFlowerStream: vi.fn(receive => { listener = receive; return () => { listener = undefined; }; }),
    };
    const controller = new AbortController();
    const iterator = createLocalEnvironmentFlowerSurfaceAdapter(bridge).connectLiveStream!({ signal: controller.signal })[Symbol.asyncIterator]();
    const first = iterator.next();
    await vi.waitFor(() => expect(id).not.toBe(''));
    for (let index = 0; index < 3; index++) {
      const next = index ? iterator.next() : first;
      const value = { schema_version: 1, kind: 'thread.batch', thread_id: 'thread-1', current: {
        thread_id: 'thread-1', view_version: index + 1, activity: 'active', turn_id: 'turn', run_id: 'run',
        queue: [], interactions: [], items: [{ id: 'reply', kind: 'assistant', ordinal: 1, turn_id: 'turn', run_id: 'run', live: true, text: 'Live reply '.repeat(index + 1) }],
      } };
      for (const frame of flowerLiveWireFixture(value, `update-${index}`)) {
        listener?.({ stream_id: id, kind: 'chunk', chunk: new TextEncoder().encode(`data: ${frame.data}\n\n`) });
      }
      expect(await next).toEqual({ done: false, value });
      expect(listener).toBeDefined();
    }
    listener?.({ stream_id: id, kind: 'end' });
    expect((await iterator.next()).done).toBe(true);
    expect(listener).toBeUndefined();
  });

  it('surfaces an explicit synchronization error from Desktop IPC and closes its reader', async () => {
    let listener: ((event: RuntimeFlowerStreamEvent) => void) | undefined;
    let streamID = '';
    const bridge: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower: vi.fn(), cancel: vi.fn(),
      startRuntimeFlowerStream: vi.fn(async (request) => {
        streamID = request.stream_id;
        return { ok: true as const, status: 200, content_type: 'text/event-stream' };
      }),
      subscribeRuntimeFlowerStream: vi.fn((receive) => { listener = receive; return () => { listener = undefined; }; }),
    };
    const iterator = createLocalEnvironmentFlowerSurfaceAdapter(bridge).connectLiveStream!({ signal: new AbortController().signal })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await vi.waitFor(() => expect(streamID).not.toBe(''));
    listener?.({ stream_id: streamID, kind: 'chunk', chunk: new TextEncoder().encode('event: error\ndata: {"code":"flower_live_sync_error"}\n\n') });
    await expect(pending).rejects.toMatchObject({ code: 'flower_live_sync_error' });
    expect(listener).toBeUndefined();
  });

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

    expect(snapshot.defaults.computer_use_enabled).toBe(true);
    expect(snapshot.defaults.auto_update_model_catalog).toBe(false);
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

  it('exposes the computer-use setting through the Desktop runtime route', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor(async (request) => {
      calls.push(request);
      if (request.method === 'GET' && request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      return {};
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await adapter.saveComputerUseEnabled?.(false);

    expect(calls[0]).toEqual({ method: 'PUT', path: '/_redeven_proxy/api/ai/computer_use', body: { enabled: false } });
    expect(calls.some((request) => request.method === 'GET' && request.path === '/_redeven_proxy/api/settings')).toBe(true);
  });

  it('exposes the opt-in model catalog update setting through the Desktop runtime route', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor(async (request) => {
      calls.push(request);
      if (request.method === 'GET' && request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      return {};
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await adapter.saveAutoUpdateModelCatalog?.(true);

    expect(calls[0]).toEqual({ method: 'PUT', path: '/_redeven_proxy/api/ai/model_catalog_auto_update', body: { enabled: true } });
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

  it('maps runtime threads to runtime ownership metadata', async () => {
    const surface = createLocalEnvironmentFlowerSurfaceAdapter(bridgeFor(() => ({ threads: [threadView()] })));
    const mapped = (await surface.listThreads())[0];

    expect(mapped).toMatchObject({
      thread_id: 'thread-1',
      title_status: 'ready', title_generation: 1,
      home_runtime_id: 'env:local-environment',
      home_runtime_kind: 'local_environment',
      source_label: 'Local Environment',
      target_labels: ['Local Environment'],
    });
    expect(mapped.read_status.is_unread).toBe(false);
  });

  it('maps runtime run_error_code into shared thread error metadata', async () => {
    const mapped = (await createLocalEnvironmentFlowerSurfaceAdapter(bridgeFor(() => ({ threads: [threadView({
      run_status: 'failed',
      run_error_code: 'provider_auth_failed',
      run_error: 'The selected AI provider rejected the saved credentials.',
    })] }))).listThreads())[0];

    expect(mapped.status).toBe('failed');
    expect(mapped.error).toEqual({
      code: 'provider_auth_failed',
      message: 'The selected AI provider rejected the saved credentials.',
    });

    const interrupted = (await createLocalEnvironmentFlowerSurfaceAdapter(bridgeFor(() => ({ threads: [threadView({
      run_status: 'canceled',
      run_error_code: 'runtime_restarted',
      run_error: 'The local runtime restarted before this reply finished.',
    })] }))).listThreads())[0];
    expect(interrupted.status).toBe('canceled');
    expect(interrupted.error).toEqual({
      code: 'runtime_restarted',
      message: 'The local runtime restarted before this reply finished.',
    });
  });

  it('loads settings and threads, then returns the immediate typed current view from Send', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') return { current_model: 'default/gpt-4.1', models: [{ id: 'default/gpt-4.1' }] };
      if (request.path === '/_redeven_proxy/api/ai/threads?limit=200') return { threads: [threadView()] };
      if (request.path === '/_redeven_proxy/api/ai/turns') {
        return {
          client_request_id: 'client_desktop-message',
          thread_id: 'th_desktop_new',
          current: currentView({ thread_id: 'th_desktop_new', activity: 'active', turn_id: 'turn-1' }),
        };
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
      working_dir: '/Volumes/team/redeven',
    });

    expect(receipt).toEqual({
      client_request_id: 'client_desktop-message',
      thread_id: 'th_desktop_new',
      current: currentView({ thread_id: 'th_desktop_new', activity: 'active', turn_id: 'turn-1' }),
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /_redeven_proxy/api/settings',
      'GET /_redeven_proxy/api/ai/models?mode=baseline',
      'GET /_redeven_proxy/api/ai/threads?limit=200',
      'POST /_redeven_proxy/api/ai/turns',
    ]);
    expect(calls.find((call) => call.path === '/_redeven_proxy/api/ai/turns')?.body).toMatchObject({
      staging_scope_id: 'staging_client_desktop-message',
      model: 'default/gpt-4.1',
      input: { text: 'hello', attachments: [] },
      options: {},
      create: { client_request_id: 'client_desktop-message', title: '', model_id: 'default/gpt-4.1', working_dir: '/Volumes/team/redeven' },
    });
    expect(calls.at(-1)).toMatchObject({
      staging_scope_id: 'staging_client_desktop-message',
      staging_capability: 'secret_client_desktop-message',
    });
  });

  it('accepts a new-thread receipt while canonical detail is still unavailable', async () => {
    const bridge = bridgeFor((request) => {
      if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/turns') {
        return {
          client_request_id: 'client-new',
          thread_id: 'thread-new',
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });

    await expect(launchLocalEnvironmentFlowerTurn(bridge, {
      client_request_id: 'client-new',
      prompt: 'send once',
    })).resolves.toEqual({
      client_request_id: 'client-new',
      thread_id: 'thread-new',
    });
  });

  it('rejects an acceptance receipt that changes the echoed client request identity', async () => {
    const bridge = bridgeFor((request) => {
      if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-existing/turns') {
        return {
          client_request_id: 'client-other',
          thread_id: 'thread-existing',
          current: currentView({ thread_id: 'thread-existing', activity: 'active', turn_id: 'turn-other' }),
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });

    await expect(launchLocalEnvironmentFlowerTurn(bridge, {
      thread_id: 'thread-existing',
      client_request_id: 'client-request',
      prompt: 'send once',
    })).rejects.toThrow('Flower send returned an invalid acceptance receipt.');
  });

  it('rejects an existing-thread receipt that changes the thread identity', async () => {
    const bridge = bridgeFor((request) => {
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-existing/turns') {
        return {
          client_request_id: 'client-request',
          thread_id: 'thread-other',
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });

    await expect(launchLocalEnvironmentFlowerTurn(bridge, {
      thread_id: 'thread-existing',
      client_request_id: 'client-request',
      prompt: 'send once',
    })).rejects.toThrow('Flower send returned an invalid acceptance receipt.');
  });

  it('sends the stable client request identity for an existing thread', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const bridge = bridgeFor((request) => {
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-existing/turns') {
        requestBody = request.body as Record<string, unknown>;
        const echoedRequestID = String(requestBody.client_request_id ?? '').trim() || 'send_generated_by_server';
        return {
          client_request_id: echoedRequestID,
          thread_id: 'thread-existing',
          current: currentView({ thread_id: 'thread-other', activity: 'active', turn_id: 'turn-other' }),
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });

    await expect(launchLocalEnvironmentFlowerTurn(bridge, {
      thread_id: 'thread-existing',
      client_request_id: 'client-request',
      prompt: 'send once',
    })).resolves.toEqual({
      client_request_id: 'client-request',
      thread_id: 'thread-existing',
    });
    expect(requestBody).toMatchObject({
      client_request_id: 'client-request',
      input: { text: 'send once', attachments: [] },
    });
    expect(requestBody).not.toHaveProperty('thread_id');
  });

  it.each([
    ['client request identity', { thread_id: 'thread-existing' }],
    ['thread identity', { client_request_id: 'client-request' }],
  ])('rejects an existing-thread receipt missing its %s', async (_label, response) => {
    const bridge = bridgeFor((request) => {
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-existing/turns') return response;
      throw new Error(`unexpected path: ${request.path}`);
    });

    await expect(launchLocalEnvironmentFlowerTurn(bridge, {
      thread_id: 'thread-existing',
      client_request_id: 'client-request',
      prompt: 'send once',
    })).rejects.toThrow('Flower send returned an invalid acceptance receipt.');
  });

  it('propagates runtime command failures without creating local admission state', async () => {
    const requestRuntimeFlower = vi.fn(async (request: RuntimeFlowerRequest) => {
      if (request.path === '/_redeven_proxy/api/settings') {
        return { ok: true as const, data: settingsResponse() };
      }
      if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') {
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
        if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') {
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
      code: 'runtime_flower_transport_error',
      message: 'runtime response lost',
      failureKind: 'transport_unknown',
    });

    const malformedBridge = bridgeFor((request) => {
      if (request.path === '/_redeven_proxy/api/settings') return settingsResponse();
      if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-existing/turns') {
        return { client_request_id: 'client-malformed', thread_id: 'thread-existing' };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    await expect(launchLocalEnvironmentFlowerTurn(malformedBridge, {
      thread_id: 'thread-existing',
      client_request_id: 'client-malformed',
      prompt: 'send once',
    })).resolves.toEqual({
      client_request_id: 'client-malformed',
      thread_id: 'thread-existing',
    });

    const invalidJSONBridge: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower: vi.fn(async (request) => {
        if (request.path === '/_redeven_proxy/api/settings') {
          return { ok: true as const, data: settingsResponse() };
        }
        if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') {
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
            failureKind: 'transport_unknown' as const,
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
    })).rejects.toMatchObject({ code: 'runtime_flower_invalid_json' });
  });

  it('propagates invalid new-thread responses without a second admission identity', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const clientRequestID = 'client-desktop-invalid-json';
    const bridge: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower: vi.fn(async (request) => {
        calls.push(request);
        if (request.path === '/_redeven_proxy/api/settings') {
          return { ok: true as const, data: settingsResponse() };
        }
        if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') {
          return { ok: true as const, data: modelDirectoryWireFixture(settingsResponse(), { current_model: 'default/gpt-4.1' }) };
        }
        if (request.path === '/_redeven_proxy/api/ai/turns') {
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
        throw new Error('unexpected runtime Flower path');
      }),
      cancel: vi.fn(),
    };

    const failure = await launchLocalEnvironmentFlowerTurn(bridge, {
      client_request_id: clientRequestID,
      staging_scope: stagingScope(clientRequestID),
      prompt: 'new conversation',
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: 'Flower returned an invalid JSON response.',
      code: 'runtime_flower_invalid_json',
    });
    expect(failure).not.toHaveProperty('uncertain_admission');
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
        },
      },
    });
  });

  it('updates the current model through runtime Flower IPC', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const onSettingsChanged = vi.fn();
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path.startsWith('/_redeven_proxy/api/ai/models')) return { current_model: 'default/gpt-5.4' };
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
      { method: 'GET', path: '/_redeven_proxy/api/ai/models?mode=baseline' },
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
            path: '/Volumes/team/redeven',
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
      path: '/Volumes/team',
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
      path: '/Volumes/team/redeven',
      isDirectory: true,
      size: 0,
      modifiedAt: 1234,
    }]);
    expect(calls).toEqual([
      { method: 'GET', path: '/_redeven_proxy/api/fs/path_context' },
      {
        method: 'POST',
        path: '/_redeven_proxy/api/fs/list',
        body: { path: '/Volumes/team', show_hidden: true },
      },
    ]);
  });

  it('returns the accepted input current view without issuing a detail reload', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/input_response') {
        return {
          kind: 'accepted',
          consumed_waiting_prompt_id: 'prompt-1',
          current: currentView({ view_version: 3, activity: 'active', turn_id: 'turn-continue' }),
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
      consumed_prompt_id: 'prompt-1',
      current: currentView({ view_version: 3, activity: 'active', turn_id: 'turn-continue' }),
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

  it('rejects an accepted input current view for a different waiting prompt', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/input_response') {
        return {
          kind: 'accepted',
          consumed_waiting_prompt_id: 'prompt-other',
          current: currentView({ view_version: 3, activity: 'active', turn_id: 'turn-continue' }),
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await expect(adapter.submitInput({
      thread_id: 'thread-1',
      prompt_id: 'prompt-1',
      answers: { target: { choice_id: 'staging' } },
    })).rejects.toThrow('Flower input response returned an invalid current view.');

    expect(calls.map((call) => call.path)).toEqual([
      '/_redeven_proxy/api/ai/threads/thread-1/input_response',
    ]);
  });

  it('stops threads through one acknowledgement-only runtime cancel request', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/cancel') return { ok: true };
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await expect(adapter.stopThread('thread-1')).resolves.toBeUndefined();

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /_redeven_proxy/api/ai/threads/thread-1/cancel',
    ]);
    expect(calls[0].body).toEqual({});
  });

  it('retries the canonical provider continuation and loads canonical detail', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/retry') return { ok: true };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1') {
        return detailView({
          run_status: 'running',
          active_run_id: 'run-retry',
          run_progress: { run_id: 'run-retry', turn_id: 'turn-retry', phase: 'retrying' },
        }, {
          view_version: 5,
          activity: 'active',
          run_id: 'run-retry',
          turn_id: 'turn-retry',
          run_progress: { phase: 'retrying' },
        });
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    const detail = await adapter.retryThread(' thread-1 ');

    expect(detail.thread.status).toBe('running');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /_redeven_proxy/api/ai/threads/thread-1/retry',
      'GET /_redeven_proxy/api/ai/threads/thread-1',
    ]);
    expect(calls[0].body).toEqual({});
  });

  it('manages queued inputs through Desktop IPC and reloads canonical detail', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path.startsWith('/_redeven_proxy/api/ai/threads/thread%20%2F1/queue/')) return { ok: true };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread%20%2F1') {
        return detailView({ thread_id: 'thread /1', queued_turn_count: 0, queued_turns: [] }, {
          thread_id: 'thread /1', view_version: 6,
        });
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await adapter.reorderQueuedTurns?.('thread /1', ['queue /2', 'queue /3']);
    await adapter.deleteQueuedTurn?.('thread /1', 'queue /2');
    const bootstrap = await adapter.sendQueuedTurnNow?.('thread /1', 'queue /3');

    expect(bootstrap?.thread.queued_turns).toEqual([]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'PATCH /_redeven_proxy/api/ai/threads/thread%20%2F1/queue/order',
      'GET /_redeven_proxy/api/ai/threads/thread%20%2F1',
      'DELETE /_redeven_proxy/api/ai/threads/thread%20%2F1/queue/queue%20%2F2',
      'GET /_redeven_proxy/api/ai/threads/thread%20%2F1',
      'POST /_redeven_proxy/api/ai/threads/thread%20%2F1/queue/queue%20%2F3/send-now',
      'GET /_redeven_proxy/api/ai/threads/thread%20%2F1',
    ]);
    expect(calls[0].body).toEqual({ ordered_queue_ids: ['queue /2', 'queue /3'] });
  });

  it('deletes threads through the force-only runtime endpoint', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      return { ok: true };
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await expect(adapter.deleteThread?.('thread /1')).resolves.toBeUndefined();
    expect(calls).toEqual([{
      method: 'DELETE',
      path: '/_redeven_proxy/api/ai/threads/thread%20%2F1?force=true',
    }]);
  });

  it('returns the named fork receipt without a second IPC request for details', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      return {
        client_request_id: 'fork-request',
        thread: {
          thread_id: 'fork-result', title: 'Source · Fork', title_status: 'ready', title_generation: 1,
          run_status: 'idle', created_at_unix_ms: 1, updated_at_unix_ms: 2,
          read_status: readStatus(), model_id: 'default/gpt-4.1', working_dir: '/workspace',
        },
      };
    });
    const input = { client_request_id: 'fork-request', title: 'Source · Fork' };
    const result = await createLocalEnvironmentFlowerSurfaceAdapter(bridge).forkThread!('thread /1', input);
    expect(result.thread_id).toBe('fork-result');
    expect(result.title).toBe(input.title);
    expect(calls).toEqual([{ method: 'POST', path: '/_redeven_proxy/api/ai/threads/thread%20%2F1/fork', body: input }]);
  });

  it('propagates synchronous thread deletion failures', async () => {
    const diagnostic = { stage: 'product_cleanup', retryable: true };
    const bridgeForFailure: DesktopSettingsBridge = {
      ...attachmentBridgeStubs(),
      save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
      requestRuntimeFlower: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'AI_THREAD_DELETE_FAILED', message: 'Thread delete failed.', status: 500, data: diagnostic },
        failureKind: 'response' as const,
      })),
      cancel: vi.fn(),
    };

    await expect(createLocalEnvironmentFlowerSurfaceAdapter(
      bridgeForFailure,
    ).deleteThread?.('thread-1')).rejects.toMatchObject({
      code: 'AI_THREAD_DELETE_FAILED',
      data: diagnostic,
      failureKind: 'response',
    });
  });

  it('loads a typed current view from the canonical thread detail endpoint', async () => {
    const bridge = bridgeFor((request) => {
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1') {
        return detailView({
          run_status: 'running',
          active_run_id: 'run-1',
          run_progress: { run_id: 'run-1', turn_id: 'turn-1', phase: 'streaming' },
        }, {
          view_version: 9,
          activity: 'active',
          run_progress: { phase: 'streaming' },
          turn_id: 'turn-1',
          items: [{
            id: 'assistant-live',
            turn_id: 'turn-1',
            run_id: 'run-1',
            kind: 'assistant',
            text: 'working live',
            live: true,
            created_at: '2026-08-12T00:00:42Z',
          }],
        });
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    const snapshot = await adapter.loadThread('thread-1');

    expect(snapshot.thread.status).toBe('running');
    expect(snapshot.thread.messages[0]).toMatchObject({
      id: 'assistant-live',
      role: 'assistant',
      content: 'working live',
      status: 'streaming',
    });
    expect(snapshot.current).toEqual(currentView({
      view_version: 9,
      activity: 'active',
      turn_id: 'turn-1',
      run_progress: { phase: 'streaming' },
      items: [{
        id: 'assistant-live', turn_id: 'turn-1', run_id: 'run-1', kind: 'assistant',
        text: 'working live', live: true, created_at: '2026-08-12T00:00:42Z',
      }],
    }));
  });

  it('submits typed approval decisions through the runtime thread endpoint', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/approvals') {
        return { ok: true, current: currentView({ view_version: 10 }) };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await adapter.submitApproval({
      thread_id: 'thread-1',
      interaction_id: 'appr-1',
      approved: true,
    });

    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/_redeven_proxy/api/ai/threads/thread-1/approvals',
      body: {
        thread_id: 'thread-1',
        interaction_id: 'appr-1',
        approved: true,
      },
    });
  });

  it('launches environment card turns through the shared runtime launch contract', async () => {
    const calls: RuntimeFlowerRequest[] = [];
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
      if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/turns') {
        return {
          client_request_id: 'client-card',
          thread_id: 'th_card',
          current: currentView({ thread_id: 'th_card', activity: 'active', turn_id: 'turn-card' }),
        };
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
      if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/turns') {
        return {
          client_request_id: 'client-reference',
          thread_id: 'th_reference',
          current: currentView({ thread_id: 'th_reference', activity: 'active', turn_id: 'turn-reference' }),
        };
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
      current: { thread_id: 'th_reference', turn_id: 'turn-reference', activity: 'active' },
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
      if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') return { current_model: 'default/gpt-4.1' };
      throw new Error(`unexpected path: ${request.path}`);
    });

    await expect(launchLocalEnvironmentFlowerTurn(bridge, {
      client_request_id: 'client-invalid-context',
      prompt: 'inspect env',
      context_action: {
        schema_version: 2,
        action_id: 'assistant.ask.flower',
        provider: 'other',
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
      if (request.path === '/_redeven_proxy/api/ai/models?mode=baseline') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-upload/turns') {
        return {
          client_request_id: 'client-upload',
          thread_id: 'thread-upload',
          current: currentView({ thread_id: 'thread-upload', activity: 'active', turn_id: 'turn-upload' }),
        };
      }
      throw new Error(`unexpected path: ${request.path}`);
    });

    await expect(launchLocalEnvironmentFlowerTurn(bridge, {
      client_request_id: 'client-upload',
      thread_id: 'thread-upload',
      staging_scope: stagingScope('thread-upload'),
      prompt: '',
      attachment_ids: ['upl_notes'],
    })).resolves.toMatchObject({
      thread_id: 'thread-upload',
      current: { thread_id: 'thread-upload', turn_id: 'turn-upload', activity: 'active' },
    });

    expect(calls.map((call) => call.path)).toEqual([
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

it('reads the restored data generation through the Desktop runtime bridge', async () => {
  const requestRuntimeFlower = vi.fn(async () => ({ ok: true as const, data: { storage_generation: 'b'.repeat(32) } }));
  const bridge: DesktopSettingsBridge = { ...attachmentBridgeStubs(), save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })), requestRuntimeFlower, cancel: vi.fn() };
  const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
  expect(requestRuntimeFlower).not.toHaveBeenCalled();
  await expect(adapter.resolveStorageGeneration?.()).resolves.toBe('b'.repeat(32));
  expect(requestRuntimeFlower).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/_redeven_proxy/api/ai/storage-generation' }));
});

it('admits compaction through the dedicated runtime route without a conversation input', async () => {
  const current = { thread_id: 'thread-compact', view_version: 2, activity: 'active', turn_kind: 'context_compaction' };
  const bridge = bridgeFor(request => {
    expect(request.path).toBe('/_redeven_proxy/api/ai/threads/thread-compact/context/compact');
    expect(request.method).toBe('POST');
    expect(request.body).toEqual({ storage_generation: 'generation', client_request_id: 'compact-key' });
    return { current };
  });
  const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
  expect(await adapter.compactThreadContext!('thread-compact', { storage_generation: 'generation', client_request_id: 'compact-key' })).toEqual(current);
});

it('round-trips disabled providers without discarding their default or secret references', () => {
  const settings = settingsResponse();
  const disabled = { ...settings, ai: { ...settings.ai, providers: settings.ai!.providers!.map(provider => ({ ...provider, enabled: false })) } };
  const snapshot = mapRuntimeFlowerSettings(disabled);
  expect(snapshot.model_profile?.providers[0].enabled).toBe(false);
  const bundle = mapFlowerSettingsDraftToRuntimeBundle({ model_profile: snapshot.model_profile! });
  expect(bundle.model_profile.providers[0].enabled).toBe(false);
  expect(bundle.model_profile.current_model_id).toBe(settings.ai?.current_model_id);
  expect(bundle.provider_api_key_patches).toEqual([]);
});

it('edits full queued content and resolves preview targets through scoped Desktop IPC', async () => {
  const calls: RuntimeFlowerRequest[] = [];
  const bridge = bridgeFor(request => {
    calls.push(request);
    if (request.path.endsWith('/reference-open-target')) return { kind: 'directory', label: 'src', path: '/workspace/src' };
    if (request.method === 'PATCH') return { ok: true };
    return detailView({}, { view_version: 2 });
  });
  const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
  await adapter.editQueuedTurn!('thread-1', 'queue:first', { client_request_id: 'edit-1', expected_input_fingerprint: 'a'.repeat(64), prompt: 'updated', retained_attachment_ids: ['image'], retained_reference_ids: ['directory'], attachment_ids: ['new-image'], staging_scope: stagingScope('thread-1') });
  expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/_redeven_proxy/api/ai/threads/thread-1/queue/queue%3Afirst', body: { client_request_id: 'edit-1', content: { text: 'updated', retained_attachment_ids: ['image'], retained_reference_ids: ['directory'], attachments: [{ attachment_id: 'new-image' }], staging_scope_id: 'staging_thread-1' } }, staging_scope_id: 'staging_thread-1', staging_capability: 'secret_thread-1' });
  expect(JSON.stringify(calls[0].body)).not.toContain('secret');
  await expect(adapter.resolveCanonicalReference!({ thread_id: 'thread-1', queue_id: 'queue:first', reference_id: 'directory' })).resolves.toEqual({ kind: 'directory', label: 'src', path: '/workspace/src' });
  expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/_redeven_proxy/api/ai/threads/thread-1/reference-open-target', body: { queue_id: 'queue:first', reference_id: 'directory' } });
  await expect(adapter.resolveCanonicalReference!({ thread_id: 'thread-1', turn_id: 'turn', queue_id: 'queue:first', reference_id: 'directory' })).rejects.toThrow('exact Flower reference scope');
});

it('prepares queued draft resources and conditionally takes back through Desktop IPC', async () => {
  const calls: RuntimeFlowerRequest[] = [];
  const draft = { prompt: 'Original input', references: [], attachments: [] };
  const current = { thread_id: 'thread-1', view_version: 3, activity: 'active', queue: [] };
  const bridge = bridgeFor(request => {
    calls.push(request);
    return request.path.endsWith('/prepare-edit') ? draft : current;
  });
  const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
  const fingerprint = 'a'.repeat(64);
  await expect(adapter.prepareQueuedTurnDraft!('thread-1', 'queue:first', { expected_input_fingerprint: fingerprint, staging_scope: stagingScope('thread-1') })).resolves.toEqual(draft);
  expect(calls[0]).toMatchObject({ method: 'POST', path: '/_redeven_proxy/api/ai/threads/thread-1/queue/queue%3Afirst/prepare-edit', body: { expected_input_fingerprint: fingerprint, staging_scope_id: 'staging_thread-1' }, staging_scope_id: 'staging_thread-1', staging_capability: 'secret_thread-1' });
  expect(JSON.stringify(calls[0].body)).not.toContain('secret');
  await expect(adapter.takeBackQueuedTurn!('thread-1', 'queue:first', fingerprint)).resolves.toEqual(current);
  expect(calls[1]).toMatchObject({ method: 'POST', path: '/_redeven_proxy/api/ai/threads/thread-1/queue/queue%3Afirst/take-back', body: { expected_input_fingerprint: fingerprint } });
});

it('reads full parent events using the current recipient runtime route', async () => {
 const query = { action: 'read' as const, event_id: 'event' };
 const result = { events: [{ id: 'event', message: '界'.repeat(2700) }] };
 const bridge = bridgeFor(() => result);
 const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
 await expect(adapter.readParentEvents!('parent/id', query)).resolves.toEqual(result);
 expect(bridge.requestRuntimeFlower).toHaveBeenCalledExactlyOnceWith({ method: 'POST', path: '/_redeven_proxy/api/ai/threads/parent%2Fid/subagent-events', body: query });
});

it('maps Goal commands without creating a user Turn and preserves conflict results', async () => {
  const input = { storage_generation: 'generation', client_request_id: 'goal-request', thread_id: 'thread-1', operation: 'set' as const, expected_version: 2, text: 'Verify the result' };
  const result = { client_request_id: input.client_request_id, thread_id: 'thread-1', current: currentView(), goal: { version: 3, text: 'Changed elsewhere', status: 'active', actor: 'user' }, conflict: true };
  const bridge = bridgeFor(request => { expect(request.path).toBe('/_redeven_proxy/api/ai/thread-goal'); expect(request.method).toBe('POST'); expect(request.body).toEqual(input); return result; });
  const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
  expect(await adapter.manageGoal!(input)).toEqual(result);
  expect(bridge.requestRuntimeFlower).toHaveBeenCalledTimes(1);
});

it.each([
  [503, 'AI_GOAL_OUTCOME_UNKNOWN', 'unknown'],
  [500, 'INTERNAL_ERROR', 'unknown'],
  [409, 'AI_STORAGE_RESTORED', 'rejected'],
])('preserves Goal outcome recovery through Desktop for HTTP %s', async (status, code, kind) => {
  const bridge = bridgeFor(() => ({}));
  vi.mocked(bridge.requestRuntimeFlower).mockResolvedValue({ ok: false, error: { code, status, message: 'Goal response unavailable' }, failureKind: 'response' });
  const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);
  await expect(adapter.manageGoal!({ storage_generation: 'generation', client_request_id: 'same-goal-request', thread_id: 'thread', operation: 'set', expected_version: 0, text: 'Verify result' })).rejects.toMatchObject({ admission_kind: kind, code });
});
