// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { desktopSessionContextSnapshotFromTarget } from '../../../../../desktop/src/main/desktopSessionContext';
import { buildSSHDesktopTarget } from '../../../../../desktop/src/main/desktopTarget';
import { createEnvLocalFlowerSurfaceAdapter } from './flower/envLocalFlowerSurfaceAdapter';
import {
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

function readStatus(status = 'idle') {
  return {
    is_unread: false,
    snapshot: {
      activity_revision: 1,
      last_message_at_unix_ms: 1,
      activity_signature: `status:${status}`,
    },
    read_state: {
      last_seen_activity_revision: 1,
      last_read_message_at_unix_ms: 1,
      last_seen_activity_signature: `status:${status}`,
    },
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
    schema_version: 1,
    endpoint_id: 'env-gzcom',
    thread_id: threadID,
    cursor: 1,
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
          current_model: deepSeekModelID,
          models: [
            {
              id: deepSeekModelID,
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
              id: flashModelID,
              label: 'Desktop / DeepSeek / deepseek-v4-flash',
              source: 'desktop_model_source',
              context_window: 243200,
              max_output_tokens: 32768,
              input_modalities: ['text'],
            },
          ],
        });
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
      if (url === '/_redeven_proxy/api/ai/threads?limit=200' && init?.method === 'GET') {
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
      const bootstrapMatch = /^\/_redeven_proxy\/api\/ai\/threads\/([^/]+)\/live\/bootstrap$/u.exec(url);
      if (bootstrapMatch && init?.method === 'GET') {
        return jsonResponse(liveBootstrap(decodeURIComponent(bootstrapMatch[1]!), deepSeekModelID));
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? ''}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const subscribeThread = vi.fn(async () => ({ runId: '' }));
    const desktopSession = desktopSessionContextSnapshotFromTarget(buildSSHDesktopTarget({
      ssh_destination: 'gzcom',
      ssh_port: 22,
      auth_mode: 'key_agent',
      runtime_root: 'remote_default',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: '',
    }, {
      forwardedLocalUIURL: 'http://127.0.0.1:41111/',
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

    const modelControl = () => surface.querySelector('[data-flower-composer-control="model_reasoning"]') as HTMLElement | null;
    await waitFor(() => modelControl()?.getAttribute('data-has-reasoning') === 'true');
    expect(surface.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('deepseek-v4-pro');
    expect(surface.querySelector('.flower-reasoning-segment-button')?.textContent).toContain('High');

    (surface.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => surface.querySelectorAll('.flower-model-menu-item').length === 2);
    expect(Array.from(surface.querySelectorAll('.flower-model-menu-item')).map((item) => item.textContent)).toEqual([
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
      options: expect.objectContaining({
        reasoning_selection: { level: 'high' },
      }),
    }));
    expect(turnBodies[0]).not.toHaveProperty('thread_id');
    expect(subscribeThread).not.toHaveBeenCalled();
  });
});
