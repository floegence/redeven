// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

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
    const deepSeekModelID = 'desktop:model_deepseek';
    const flashModelID = 'desktop:model_flash';
    const createdBodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/_redeven_proxy/api/settings' && init?.method === 'GET') {
        return jsonResponse({
          ai: null,
          ai_runtime: {
            desktop_model_source: {
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
      if (url === '/_redeven_proxy/api/ai/threads?limit=200' && init?.method === 'GET') {
        return jsonResponse({ threads: [] });
      }
      if (url === '/_redeven_proxy/api/ai/threads' && init?.method === 'POST') {
        createdBodies.push(JSON.parse(String(init.body ?? '{}')));
        return jsonResponse({ thread: { thread_id: 'thread-desktop-e2e', read_status: readStatus() } });
      }
      if (url === '/_redeven_proxy/api/ai/threads/thread-desktop-e2e/live/bootstrap' && init?.method === 'GET') {
        return jsonResponse(liveBootstrap('thread-desktop-e2e', deepSeekModelID));
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? ''}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const subscribeThread = vi.fn(async () => ({ runId: '' }));
    const sendUserTurn = vi.fn(async () => ({ runId: 'run-desktop-e2e', kind: 'start' }));
    const surface = renderSurfaceWithAdapter(createEnvLocalFlowerSurfaceAdapter({
      envPublicID: 'gzcom',
      envLabel: 'gzcom',
      desktopSessionTargetRoute: 'remote_desktop',
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
          sendUserTurn,
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
    (surface.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => sendUserTurn.mock.calls.length === 1);

    expect(createdBodies).toEqual([expect.objectContaining({
      model_id: deepSeekModelID,
      reasoning_selection: { level: 'high' },
    })]);
    expect(sendUserTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-desktop-e2e',
      model: deepSeekModelID,
      options: expect.objectContaining({
        reasoningSelection: { level: 'high' },
      }),
    }));
    expect(subscribeThread).toHaveBeenCalledWith({ threadId: 'thread-desktop-e2e' });
  });
});
