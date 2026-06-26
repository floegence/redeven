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
import { projectFlowerLiveBootstrap } from '../../../../internal/flower_ui/src/flowerLiveReducer';

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

function settingsResponse() {
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
      execution_policy: {
        require_user_approval: true,
        block_dangerous_commands: true,
      },
      terminal_exec_policy: {
        default_timeout_ms: 120000,
        max_timeout_ms: 600000,
      },
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
    save: vi.fn(async () => ({ ok: true as const, snapshot: {} as never })),
    requestRuntimeFlower: vi.fn(async (request: RuntimeFlowerRequest) => ({
      ok: true as const,
      data: await handler(request),
    })),
    cancel: vi.fn(),
  };
}

describe('Local Environment Flower surface adapter', () => {
  it('maps runtime settings to the shared Flower snapshot without dropping model metadata', () => {
    const snapshot = mapRuntimeFlowerSettings(settingsResponse());

    expect(snapshot.config.providers[0].models[0]).toEqual({
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
      config: {
        ...mapRuntimeFlowerSettings(settingsResponse()).config,
        providers: [{
          ...mapRuntimeFlowerSettings(settingsResponse()).config.providers[0],
          provider_api_key: 'sk-test',
          web_search_api_key: 'brave-test',
        }],
      },
    };

    expect(mapFlowerSettingsDraftToRuntimeBundle(draft)).toMatchObject({
      ai: {
        current_model_id: 'default/gpt-4.1',
        providers: [{ id: 'default', models: [{ model_name: 'gpt-4.1' }] }],
      },
      provider_api_key_patches: [{ provider_id: 'default', api_key: 'sk-test' }],
      web_search_provider_key_patches: [{ provider_id: 'default', api_key: 'brave-test' }],
    });
  });

  it('sends null secret patches when the settings draft clears provider keys', () => {
    const draft = {
      config: {
        ...mapRuntimeFlowerSettings(settingsResponse()).config,
        providers: [{
          ...mapRuntimeFlowerSettings(settingsResponse()).config.providers[0],
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
      if (request.path === '/_redeven_proxy/api/ai/threads') return { thread: threadView({ thread_id: 'thread-new' }) };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-new/turns') return { run_id: 'run-1', kind: 'start' };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-new/live/bootstrap') {
        return liveBootstrap({ thread_id: 'thread-new' }, [{
            id: 'm1',
            role: 'user',
            status: 'complete',
            timestamp: 1,
            blocks: [{ type: 'text', content: 'hello' }],
        }]);
      }
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await adapter.loadSettings();
    await adapter.listThreads();
    const snapshot = await adapter.launchTurn({ message_id: 'client_desktop-message', prompt: 'hello' });

    expect(snapshot.thread.thread_id).toBe('thread-new');
    expect(snapshot.thread.messages[0].content).toBe('hello');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /_redeven_proxy/api/settings',
      'GET /_redeven_proxy/api/ai/threads?limit=200',
      'GET /_redeven_proxy/api/settings',
      'GET /_redeven_proxy/api/ai/models',
      'POST /_redeven_proxy/api/ai/threads',
      'POST /_redeven_proxy/api/ai/threads/thread-new/turns',
      'GET /_redeven_proxy/api/ai/threads/thread-new/live/bootstrap',
    ]);
    expect(calls.find((call) => call.path === '/_redeven_proxy/api/ai/threads/thread-new/turns')?.body).toMatchObject({
      thread_id: 'thread-new',
      model: 'default/gpt-4.1',
      input: { message_id: 'client_desktop-message', text: 'hello', attachments: [] },
      options: { mode: 'act' },
    });
  });

  it('submits input responses through the runtime thread endpoint', async () => {
    const calls: RuntimeFlowerRequest[] = [];
    const bridge = bridgeFor((request) => {
      calls.push(request);
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/input_response') return { run_id: 'run-1', kind: 'started' };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/live/bootstrap') return liveBootstrap();
      throw new Error(`unexpected path: ${request.path}`);
    });
    const adapter = createLocalEnvironmentFlowerSurfaceAdapter(bridge);

    await adapter.submitInput({
      thread_id: 'thread-1',
      prompt_id: 'prompt-1',
      answers: {
        target: { choice_id: 'staging', text: 'Staging' },
      },
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
      expected_run_id: ' run-1 ',
      source: 'slash_command',
    });

    expect(bootstrap.thread.status).toBe('running');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /_redeven_proxy/api/ai/threads/thread-1/context/compact',
      'GET /_redeven_proxy/api/ai/threads/thread-1/live/bootstrap',
    ]);
    expect(calls[0].body).toEqual({
      thread_id: 'thread-1',
      expected_run_id: 'run-1',
      source: 'slash_command',
    });
  });

  it('loads streaming live state from the canonical live bootstrap endpoint', async () => {
    const bridge = bridgeFor((request) => {
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-1/live/bootstrap') {
        return {
          ...liveBootstrap({ run_status: 'running', cursor: 9 }, [{
            id: 'assistant-live',
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
      run_id: 'run-1',
      action_id: 'appr-1',
      tool_id: 'tool-1',
      approved: true,
      expected_seq: 12,
      revision: 1,
    });

    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/_redeven_proxy/api/ai/threads/thread-1/approvals',
      body: {
        thread_id: 'thread-1',
        run_id: 'run-1',
        action_id: 'appr-1',
        tool_id: 'tool-1',
        approved: true,
        expected_seq: 12,
        revision: 1,
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
      if (request.path === '/_redeven_proxy/api/ai/models') return { current_model: 'default/gpt-4.1' };
      if (request.path === '/_redeven_proxy/api/ai/threads') return { thread: threadView({ thread_id: 'thread-card' }) };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-card/turns') return { run_id: 'run-card', kind: 'start' };
      if (request.path === '/_redeven_proxy/api/ai/threads/thread-card/live/bootstrap') return liveBootstrap({ thread_id: 'thread-card' });
      throw new Error(`unexpected path: ${request.path}`);
    });

    await launchLocalEnvironmentFlowerTurn(bridge, {
      prompt: 'inspect env',
      context_action: contextAction,
      working_dir: '/workspace/redeven',
      attachments: [{
        name: 'notes.txt',
        mime_type: 'text/plain',
        url: 'redeven://uploaded/notes',
      }],
      mode: 'plan',
    });

    expect(calls.find((call) => call.path === '/_redeven_proxy/api/ai/threads')?.body).toMatchObject({
      working_dir: '/workspace/redeven',
      execution_mode: 'plan',
    });
    expect(calls.find((call) => call.path === '/_redeven_proxy/api/ai/threads/thread-card/turns')?.body).toEqual({
      thread_id: 'thread-card',
      model: 'default/gpt-4.1',
      input: {
        text: 'inspect env',
        attachments: [{
          name: 'notes.txt',
          mime_type: 'text/plain',
          url: 'redeven://uploaded/notes',
        }],
        context_action: contextAction,
      },
      options: {
        mode: 'plan',
      },
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
      mode: 'act',
    })).rejects.toThrow('Invalid Flower context action.');

    expect(calls.map((call) => call.path)).toEqual([
      '/_redeven_proxy/api/settings',
      '/_redeven_proxy/api/ai/models',
    ]);
  });
});
