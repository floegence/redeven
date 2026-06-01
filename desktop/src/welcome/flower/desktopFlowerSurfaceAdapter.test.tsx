import { describe, expect, it, vi } from 'vitest';

import {
  createDesktopFlowerSurfaceAdapter,
  mapDesktopFlowerSnapshot,
  mapDesktopFlowerThread,
  mapFlowerSettingsDraftToDesktop,
  type DesktopSettingsBridge,
} from './desktopFlowerSurfaceAdapter';
import type { DesktopFlowerHostSettingsSnapshot, DesktopFlowerHostThread } from '../../shared/flowerHostSettingsIPC';

function desktopSnapshot(): DesktopFlowerHostSettingsSnapshot {
  return {
    config: {
      schema_version: 1,
      enabled: true,
      current_model_id: 'default/gpt-4.1',
      execution_policy: {
        require_user_approval: true,
        block_dangerous_commands: true,
      },
      terminal_exec_policy: {
        default_timeout_ms: 120_000,
        max_timeout_ms: 600_000,
      },
      providers: [
        {
          id: 'default',
          type: 'openai_compatible',
          base_url: 'https://api.example.test/v1',
          web_search: { mode: 'brave' },
          models: [
            {
              model_name: 'gpt-4.1',
              context_window: 128_000,
              max_output_tokens: 16_384,
              effective_context_window_percent: 70,
              input_modalities: ['text', 'image'],
            },
          ],
        },
      ],
    },
    provider_secrets: [
      {
        provider_id: 'default',
        provider_api_key_configured: true,
        web_search_api_key_configured: true,
      },
    ],
    target_cache: {
      version: 1,
      entries: [
        {
          target_id: 'env-b',
          label: 'Env B',
          target_url: 'https://env-b.example.test',
          last_seen_at_unix_ms: 10,
          metadata: {
            source: 'desktop-cache',
          },
        },
      ],
    },
  };
}

function desktopThread(): DesktopFlowerHostThread {
  return {
    thread_id: 'thread-1',
    title: 'Conversation',
    model_id: 'default/gpt-4.1',
    created_at_ms: 1,
    updated_at_ms: 2,
    messages: [
      { id: 'm1', role: 'user', content: 'hello', created_at_ms: 1 },
      { id: 'm2', role: 'assistant', content: 'hi', created_at_ms: 2 },
    ],
  };
}

function desktopDecision() {
  return {
    decision_id: 'decision-1',
    decision_revision: 1,
    route: 'flower_host' as const,
    reason_code: 'host_available',
    selected_handler: {
      handler_id: 'flower-host',
      handler_kind: 'global' as const,
      display_name: 'Flower Host',
      carrier_kind: 'desktop' as const,
      state: 'online' as const,
      selection_source: 'router_default' as const,
      supports_thread_kinds: ['chat'],
      allowed_target_ids: [],
    },
    available_handlers: [],
    handler_selection: {
      can_switch: false,
      requires_user_visible_confirmation: true,
    },
    decision_scope: {
      thread_kind: 'chat' as const,
      client_surface: 'flower_surface',
    },
    ui_chips: [],
    blocker: null,
  };
}

describe('Flower surface adapter for the host', () => {
  it('maps Desktop settings to the shared Flower snapshot without dropping model metadata', () => {
    const snapshot = mapDesktopFlowerSnapshot(desktopSnapshot());

    expect(snapshot.config.providers[0].models[0]).toEqual({
      model_name: 'gpt-4.1',
      context_window: 128_000,
      max_output_tokens: 16_384,
      effective_context_window_percent: 70,
      input_modalities: ['text', 'image'],
    });
    expect(snapshot.target_cache.entries[0].metadata).toEqual({
      source: 'desktop-cache',
    });
  });

  it('maps shared settings drafts back to Desktop IPC payloads', () => {
    const desktopDraft = mapFlowerSettingsDraftToDesktop({
      config: {
        ...mapDesktopFlowerSnapshot(desktopSnapshot()).config,
        providers: [
          {
            ...mapDesktopFlowerSnapshot(desktopSnapshot()).config.providers[0],
            provider_api_key: 'secret',
            provider_api_key_mode: 'replace',
            web_search_api_key: 'brave-secret',
            web_search_api_key_mode: 'replace',
          },
        ],
      },
    });

    expect(desktopDraft.config.providers[0]).toMatchObject({
      id: 'default',
      provider_api_key: 'secret',
      provider_api_key_mode: 'replace',
      web_search_api_key: 'brave-secret',
      web_search_api_key_mode: 'replace',
    });
  });

  it('routes load, list, save, and send through Desktop settings IPC only', async () => {
    const loadFlowerHostSettings = vi.fn(async () => ({ ok: true as const, snapshot: desktopSnapshot() }));
    const saveFlowerHostSettings = vi.fn(async () => ({ ok: true as const, snapshot: desktopSnapshot() }));
    const listFlowerHostThreads = vi.fn(async () => ({ ok: true as const, threads: [desktopThread()] }));
    const resolveFlowerHostHandler = vi.fn(async () => ({ ok: true as const, decision: desktopDecision() }));
    const sendFlowerHostChat = vi.fn(async () => ({ ok: true as const, thread: desktopThread() }));
    const bridge: DesktopSettingsBridge = {
      save: vi.fn(),
      cancel: vi.fn(),
      loadFlowerHostSettings,
      saveFlowerHostSettings,
      listFlowerHostThreads,
      loadFlowerHostThread: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      resolveFlowerHostHandler,
      sendFlowerHostChat,
    };
    const adapter = createDesktopFlowerSurfaceAdapter(bridge);

    await expect(adapter.loadSettings()).resolves.toMatchObject({ config: { current_model_id: 'default/gpt-4.1' } });
    await expect(adapter.listThreads()).resolves.toHaveLength(1);
    await expect(adapter.saveSettings({
      config: {
        ...mapDesktopFlowerSnapshot(desktopSnapshot()).config,
        providers: [],
      },
    })).resolves.toMatchObject({ config: { current_model_id: 'default/gpt-4.1' } });
    await expect(adapter.resolveHandler()).resolves.toMatchObject({ decision_id: 'decision-1' });
    await expect(adapter.sendMessage({ prompt: 'hello' })).resolves.toMatchObject({ thread_id: 'thread-1' });

    expect(loadFlowerHostSettings).toHaveBeenCalledTimes(1);
    expect(saveFlowerHostSettings).toHaveBeenCalledTimes(1);
    expect(listFlowerHostThreads).toHaveBeenCalledTimes(1);
    expect(resolveFlowerHostHandler).toHaveBeenCalledTimes(1);
    expect(sendFlowerHostChat).toHaveBeenCalledWith({ thread_id: undefined, prompt: 'hello' });
  });

  it('passes the visible handler decision when creating a new host thread', async () => {
    const decision = desktopDecision();
    const sendFlowerHostChat = vi.fn(async () => ({ ok: true as const, thread: desktopThread() }));
    const bridge: DesktopSettingsBridge = {
      save: vi.fn(),
      cancel: vi.fn(),
      loadFlowerHostSettings: vi.fn(async () => ({ ok: true as const, snapshot: desktopSnapshot() })),
      saveFlowerHostSettings: vi.fn(async () => ({ ok: true as const, snapshot: desktopSnapshot() })),
      listFlowerHostThreads: vi.fn(async () => ({ ok: true as const, threads: [] })),
      loadFlowerHostThread: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      resolveFlowerHostHandler: vi.fn(async () => ({ ok: true as const, decision })),
      sendFlowerHostChat,
    };
    const adapter = createDesktopFlowerSurfaceAdapter(bridge);

    await adapter.sendMessage({ prompt: 'hello', decision });

    expect(sendFlowerHostChat).toHaveBeenCalledWith({
      thread_id: undefined,
      prompt: 'hello',
      decision_id: 'decision-1',
      decision_revision: 1,
      selected_handler_id: 'flower-host',
      thread_kind: 'chat',
      primary_target_id: undefined,
      client_surface: 'flower_surface',
    });
  });

  it('preserves fresh handler decisions returned by create failures', async () => {
    const decision = desktopDecision();
    const sendFlowerHostChat = vi.fn(async () => ({
      ok: false as const,
      error: 'DECISION_REVISION_EXPIRED: Flower handler selection is no longer current.',
      fresh_decision: decision,
    }));
    const bridge: DesktopSettingsBridge = {
      save: vi.fn(),
      cancel: vi.fn(),
      loadFlowerHostSettings: vi.fn(async () => ({ ok: true as const, snapshot: desktopSnapshot() })),
      saveFlowerHostSettings: vi.fn(async () => ({ ok: true as const, snapshot: desktopSnapshot() })),
      listFlowerHostThreads: vi.fn(async () => ({ ok: true as const, threads: [] })),
      loadFlowerHostThread: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      resolveFlowerHostHandler: vi.fn(async () => ({ ok: true as const, decision })),
      sendFlowerHostChat,
    };
    const adapter = createDesktopFlowerSurfaceAdapter(bridge);

    await expect(adapter.sendMessage({ prompt: 'hello', decision })).rejects.toMatchObject({
      message: 'DECISION_REVISION_EXPIRED: Flower handler selection is no longer current.',
      fresh_decision: decision,
    });
  });

  it('projects Desktop threads into shared Flower thread snapshots', () => {
    expect(mapDesktopFlowerThread({ ...desktopThread(), status: 'running' })).toMatchObject({
      thread_id: 'thread-1',
      status: 'running',
      source_label: 'this host',
      target_labels: [],
      messages: [
        { id: 'm1', role: 'user', content: 'hello' },
        { id: 'm2', role: 'assistant', content: 'hi' },
      ],
    });
  });
});
