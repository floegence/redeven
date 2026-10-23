// @vitest-environment jsdom

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { desktopSessionContextSnapshotFromTarget } from '../../../../../desktop/src/main/desktopSessionContext';
import { buildSSHDesktopTarget } from '../../../../../desktop/src/main/desktopTarget';
import { createEnvLocalFlowerSurfaceAdapter } from './flower/envLocalFlowerSurfaceAdapter';
import { modelDirectoryWireFixture } from '../test/modelDirectoryWireFixture';
import { flowerLiveWireFixture } from '../../../../flower_ui/src/test/flowerLiveWireFixture';
import { bindSessionHTTP } from './services/sessionHTTP';
import {
  composerModelTrigger,
  renderSurfaceWithAdapter,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as Response;
}

function readStatus(_status = 'idle') {
  return {
    is_unread: false,
    snapshot: { activity_revision: 1 },
    read_state: { last_seen_activity_revision: 1 },
  };
}

function liveBootstrap(threadID: string, modelID: string) {
  const thread = {
    thread_id: threadID,
    title: 'Desktop model source E2E',
    model_id: modelID,
    reasoning_selection: { level: 'high' },
    reasoning_capability: {
      kind: 'effort',
      supported_levels: ['high', 'max'],
      default_level: 'high',
      wire_shape: 'deepseek_reasoning_effort',
    },
    run_status: 'running',
    permission_type: 'approval_required',
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
    last_message_at_unix_ms: 2,
    read_status: readStatus('running'),
  };
  return {
    thread: { ...thread, title_status: 'ready', title_generation: 1, settings_revision: 1 },
    current: { thread_id: threadID, view_version: 1, activity: 'active', turn_id: 'turn-desktop', run_id: 'run-desktop', run_progress: { phase: 'preparing' }, items: [], interactions: [], queue: [] },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Flower Desktop model source E2E', () => {
  it('projects the read-only catalog and sends the opaque model with reasoning on the first turn', async () => {
    const deepSeekModelID = `desktop:model_${'1'.repeat(64)}`;
    const flashModelID = `desktop:model_${'2'.repeat(64)}`;
    const turnBodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/ai/conversation_preferences' && init?.method === 'GET') {
        return jsonResponse({ revision: 0, reasoning_by_model: {} });
      }
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: null,
          ai_runtime: {
            desktop_model_source: {
              binding_state: 'bound',
              connected: true,
              configured: true,
              available: true,
              model_source: 'desktop_local_environment',
              model_count: 2,
              missing_key_provider_ids: [],
            },
          },
        });
      }
      if (url === '/_redeven_proxy/api/ai/storage-generation' && init?.method === 'GET') {
        return jsonResponse({ storage_generation: 'a'.repeat(32) });
      }
      if ((url === '/_redeven_proxy/api/ai/models' || url === '/_redeven_proxy/api/ai/models?mode=baseline') && init?.method === 'GET') {
        return jsonResponse(modelDirectoryWireFixture({ ai: null }, {
          current_model: deepSeekModelID,
          models: [
            {
              id: deepSeekModelID,
              label: 'Desktop / DeepSeek / deepseek-v4-pro',
              source: 'desktop_model_source',
              context_window: 950000,
              max_output_tokens: 384000,
              input_modalities: ['text'],
              default_reasoning_selection: { level: 'high' },
              reasoning_capability: {
                kind: 'effort',
                supported_levels: ['high', 'max'],
                default_level: 'high',
                wire_shape: 'deepseek_reasoning_effort',
              },
            },
            {
              id: flashModelID,
              label: 'Desktop / DeepSeek / deepseek-v4-flash',
              source: 'desktop_model_source',
              context_window: 243200,
              max_output_tokens: 32768,
              input_modalities: ['text'],
            },
          ],
        }));
      }
      if (url === `/_redeven_proxy/api/ai/attachments/capabilities?model_id=${encodeURIComponent(deepSeekModelID)}` && init?.method === 'GET') {
        return jsonResponse({
          model_id: deepSeekModelID,
          revision: 'desktop-model-source-e2e',
          enabled: true,
          max_count: 20,
          max_item_bytes: 25 * 1024 * 1024,
          max_turn_bytes: 100 * 1024 * 1024,
          supports_long_text: true,
          media_types: [{ media_type: 'text/plain', mode: 'tool_read' }],
        });
      }
      if (url === '/_redeven_proxy/api/ai/threads?limit=25' && init?.method === 'GET') {
        return jsonResponse({ threads: [] });
      }
      if (url === '/_redeven_proxy/api/ai/turns' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { create?: { client_request_id?: string } };
        turnBodies.push(body);
        return jsonResponse({
          client_request_id: body.create?.client_request_id,
          thread_id: `th_${'3'.repeat(24)}`,
          turn_id: `turn_${'4'.repeat(24)}`,
          run_id: `run_${'5'.repeat(24)}`,
          kind: 'start',
        });
      }
      const bootstrapMatch = /^\/_redeven_proxy\/api\/ai\/threads\/([^/]+)$/u.exec(url);
      if (bootstrapMatch && init?.method === 'GET') {
        return jsonResponse(liveBootstrap(decodeURIComponent(bootstrapMatch[1]!), deepSeekModelID));
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? ''}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    onTestFinished(bindSessionHTTP({
      fetch: fetchMock as unknown as typeof fetch,
      events: async function* (_path, options) {
        yield* flowerLiveWireFixture({ schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [] });
        if (!options?.signal?.aborted) await new Promise<void>(resolve => options?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      },
    }));

    const subscribeThread = vi.fn(async () => ({ runId: '' }));
    const desktopSession = desktopSessionContextSnapshotFromTarget(buildSSHDesktopTarget({
      ssh_destination: 'gzcom',
      ssh_port: 22,
      auth_mode: 'key_agent',
      runtime_root: 'remote_default',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: '',
    }, {
      label: 'gzcom',
    }));
    expect(desktopSession?.target_route).toBe('remote_desktop');

    const surface = renderSurfaceWithAdapter(createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'gzcom',
      envLabel: 'gzcom',
      desktopSessionTargetRoute: desktopSession?.target_route,
      rpc: {
        fs: {
          getPathContext: vi.fn(async () => ({
            agentHomePathAbs: '/root',
            homePathAbs: '/root',
            defaultRootId: 'home',
            roots: [{
              id: 'home',
              label: 'Home',
              pathAbs: '/root',
              kind: 'home',
              permissions: { read: true, write: true },
            }],
          })),
        },
        ai: {
          subscribeThread,
        },
      } as any,
    }));

    const trigger = await composerModelTrigger(surface);
    const modelControl = () => trigger.closest('[data-flower-composer-control="model_reasoning"]') as HTMLElement | null;
    await waitFor(() => modelControl()?.getAttribute('data-has-reasoning') === 'true');
    expect(surface.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('deepseek-v4-pro');
    expect(modelControl()?.querySelector('.flower-reasoning-segment-button')?.textContent).toContain('High');

    trigger.click();
    await waitFor(() => document.querySelectorAll('.flower-model-menu-item').length === 2);
    expect(Array.from(document.querySelectorAll('.flower-model-menu-item')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('deepseek-v4-pro'),
      expect.stringContaining('deepseek-v4-flash'),
    ]);

    const textarea = surface.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'verify Desktop model capability';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const submit = surface.querySelector('.flower-composer-submit') as HTMLButtonElement;
    await waitFor(() => submit.disabled === false);
    submit.click();
    await waitFor(() => turnBodies.length === 1);

    expect(turnBodies[0]).toEqual(expect.objectContaining({
      create: expect.objectContaining({
        model_id: deepSeekModelID,
        reasoning_selection: { level: 'high' },
      }),
    }));
    expect(turnBodies[0]).toEqual(expect.objectContaining({
      model: deepSeekModelID,
      storage_generation: 'a'.repeat(32),
      options: expect.objectContaining({
        reasoning_selection: { level: 'high' },
      }),
    }));
    expect(turnBodies[0]).not.toHaveProperty('thread_id');
    expect(subscribeThread).not.toHaveBeenCalled();
  });
});
