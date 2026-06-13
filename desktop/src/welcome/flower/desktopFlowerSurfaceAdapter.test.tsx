import { describe, expect, it, vi } from 'vitest';

import {
  createDesktopFlowerSurfaceAdapter,
  mapDesktopFlowerSnapshot,
  mapDesktopFlowerThread,
  mapFlowerSettingsDraftToDesktop,
  type DesktopSettingsBridge,
} from './desktopFlowerSurfaceAdapter';
import type { DesktopFlowerHostInputRequest, DesktopFlowerHostSettingsSnapshot, DesktopFlowerHostThread, DesktopFlowerHostThreadReadStatus } from '../../shared/flowerHostSettingsIPC';

function desktopReadStatus(isUnread = false, revision = 2, status = 'idle'): DesktopFlowerHostThreadReadStatus {
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
    working_dir: '/workspace/redeven',
    pinned_at_ms: 123,
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'idle',
    source_label: 'this host',
    target_labels: [],
    read_status: desktopReadStatus(false),
    messages: [
      { id: 'm1', role: 'user', content: 'hello', status: 'complete', created_at_ms: 1 },
      { id: 'm2', role: 'assistant', content: 'hi', status: 'complete', created_at_ms: 2 },
    ],
  };
}

function desktopActivityTimeline() {
  return {
    type: 'activity-timeline' as const,
    schema_version: 1,
    run_id: 'run-1',
    turn_id: 'm-streaming',
    summary: {
      status: 'success' as const,
      severity: 'quiet' as const,
      needs_attention: false,
      total_items: 2,
      counts: { success: 2 },
    },
    items: [
      {
        item_id: 'tool-terminal',
        tool_id: 'tool-terminal',
        tool_name: 'terminal.exec',
        kind: 'tool' as const,
        status: 'success' as const,
        severity: 'quiet' as const,
        needs_attention: false,
        requires_approval: false,
      },
      {
        item_id: 'tool-done',
        tool_id: 'tool-done',
        tool_name: 'task_complete',
        kind: 'control' as const,
        status: 'success' as const,
        severity: 'quiet' as const,
        needs_attention: false,
        requires_approval: false,
      },
    ],
  };
}

function desktopInputRequest(): DesktopFlowerHostInputRequest {
  return {
    prompt_id: 'prompt-ask-user',
    message_id: 'message-ask-user',
    tool_id: 'tool-ask-user',
    tool_name: 'ask_user',
    reason_code: 'needs_user_choice',
    required_from_user: ['target'],
    evidence_refs: ['m1'],
    public_summary: 'Choose a target.',
    contains_secret: false,
    questions: [
      {
        id: 'target',
        header: 'Deployment target',
        question: 'Where should Flower deploy this change?',
        response_mode: 'select_or_write',
        choices_exhaustive: false,
        write_label: 'Other target',
        write_placeholder: 'Type another target',
        choices: [
          {
            choice_id: 'staging',
            label: 'Staging',
            description: 'Use the validation environment.',
            kind: 'select',
            actions: [
              {
                type: 'set_mode',
                mode: 'act',
              },
            ],
          },
        ],
      },
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
    unavailable_handlers: [],
    handler_selection: {
      can_switch: false,
      requires_user_visible_confirmation: true,
    },
    decision_scope: {
      thread_kind: 'chat' as const,
      client_surface: 'flower_surface',
    },
    host_presence: {
      schema_version: 1 as const,
      host_id: 'flower-host',
      host_kind: 'global' as const,
      carrier_kind: 'desktop' as const,
      display_name: 'Flower Host',
      state: 'online' as const,
      endpoint: { visibility: 'local' },
      capabilities: ['chat'],
      last_seen_at_unix_ms: 1_700_000_000_000,
    },
    allowed_actions: ['start_thread'],
    ui_chips: [],
    blocker: null,
    created_at_unix_ms: 1_700_000_000_000,
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
    const submitFlowerHostInput = vi.fn(async () => ({ ok: true as const, thread: desktopThread() }));
    const markFlowerHostThreadRead = vi.fn(async (request) => ({ ok: true as const, thread: { ...desktopThread(), read_status: desktopReadStatus(false, request.snapshot.activity_revision, 'idle') } }));
    const renameFlowerHostThread = vi.fn(async () => ({ ok: true as const, thread: { ...desktopThread(), title: 'Renamed' } }));
    const setFlowerHostThreadPinned = vi.fn(async () => ({ ok: true as const, thread: { ...desktopThread(), pinned_at_ms: 456 } }));
    const forkFlowerHostThread = vi.fn(async () => ({ ok: true as const, thread: { ...desktopThread(), thread_id: 'thread-fork' } }));
    const bridge: DesktopSettingsBridge = {
      save: vi.fn(),
      cancel: vi.fn(),
      loadFlowerHostSettings,
      saveFlowerHostSettings,
      listFlowerHostThreads,
      loadFlowerHostThread: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      markFlowerHostThreadRead,
      renameFlowerHostThread,
      setFlowerHostThreadPinned,
      forkFlowerHostThread,
      resolveFlowerHostHandler,
      sendFlowerHostChat,
      submitFlowerHostInput,
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
    const markSnapshot = desktopThread().read_status.snapshot;
    await expect(adapter.markThreadRead('thread-1', markSnapshot)).resolves.toMatchObject({ thread_id: 'thread-1', read_status: { is_unread: false } });
    expect(markFlowerHostThreadRead).toHaveBeenCalledWith({ thread_id: 'thread-1', snapshot: markSnapshot });
    await expect(adapter.renameThread?.('thread-1', 'Renamed')).resolves.toMatchObject({ title: 'Renamed' });
    await expect(adapter.setThreadPinned?.('thread-1', true)).resolves.toMatchObject({ pinned_at_ms: 456 });
    await expect(adapter.forkThread?.('thread-1')).resolves.toMatchObject({ thread_id: 'thread-fork' });
    await expect(adapter.submitInput({
      thread_id: 'thread-1',
      prompt_id: 'prompt-1',
      answers: {
        target: { choice_id: 'staging' },
      },
    })).resolves.toMatchObject({ thread_id: 'thread-1' });

    expect(loadFlowerHostSettings).toHaveBeenCalledTimes(1);
    expect(saveFlowerHostSettings).toHaveBeenCalledTimes(1);
    expect(listFlowerHostThreads).toHaveBeenCalledTimes(1);
    expect(resolveFlowerHostHandler).toHaveBeenCalledTimes(1);
    expect(sendFlowerHostChat).toHaveBeenCalledWith({ thread_id: undefined, prompt: 'hello' });
    expect(markFlowerHostThreadRead).toHaveBeenCalledWith({ thread_id: 'thread-1', snapshot: markSnapshot });
    expect(renameFlowerHostThread).toHaveBeenCalledWith({ thread_id: 'thread-1', title: 'Renamed' });
    expect(setFlowerHostThreadPinned).toHaveBeenCalledWith({ thread_id: 'thread-1', pinned: true });
    expect(forkFlowerHostThread).toHaveBeenCalledWith({ thread_id: 'thread-1' });
    expect(submitFlowerHostInput).toHaveBeenCalledWith({
      thread_id: 'thread-1',
      prompt_id: 'prompt-1',
      answers: {
        target: { choice_id: 'staging' },
      },
    });
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
      markFlowerHostThreadRead: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      renameFlowerHostThread: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      setFlowerHostThreadPinned: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      forkFlowerHostThread: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      resolveFlowerHostHandler: vi.fn(async () => ({ ok: true as const, decision })),
      sendFlowerHostChat,
      submitFlowerHostInput: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
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
      error: {
        code: 'DECISION_REVISION_EXPIRED',
        message: 'Flower handler selection is no longer current.',
      },
      fresh_decision: decision,
    }));
    const bridge: DesktopSettingsBridge = {
      save: vi.fn(),
      cancel: vi.fn(),
      loadFlowerHostSettings: vi.fn(async () => ({ ok: true as const, snapshot: desktopSnapshot() })),
      saveFlowerHostSettings: vi.fn(async () => ({ ok: true as const, snapshot: desktopSnapshot() })),
      listFlowerHostThreads: vi.fn(async () => ({ ok: true as const, threads: [] })),
      loadFlowerHostThread: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      markFlowerHostThreadRead: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      renameFlowerHostThread: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      setFlowerHostThreadPinned: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      forkFlowerHostThread: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
      resolveFlowerHostHandler: vi.fn(async () => ({ ok: true as const, decision })),
      sendFlowerHostChat,
      submitFlowerHostInput: vi.fn(async () => ({ ok: true as const, thread: desktopThread() })),
    };
    const adapter = createDesktopFlowerSurfaceAdapter(bridge);

    await expect(adapter.sendMessage({ prompt: 'hello', decision })).rejects.toMatchObject({
      code: 'DECISION_REVISION_EXPIRED',
      message: 'Flower handler selection is no longer current.',
      fresh_decision: decision,
    });
  });

  it('projects Desktop threads into shared Flower thread snapshots', () => {
    expect(mapDesktopFlowerThread({
      ...desktopThread(),
      status: 'running',
      home_host_id: 'flower-host',
      home_host_kind: 'global',
    })).toMatchObject({
      thread_id: 'thread-1',
      working_dir: '/workspace/redeven',
      pinned_at_ms: 123,
      status: 'running',
      read_status: { is_unread: false },
      home_host_id: 'flower-host',
      home_host_kind: 'global',
      source_label: 'this host',
      target_labels: [],
      messages: [
        { id: 'm1', role: 'user', content: 'hello', status: 'complete' },
        { id: 'm2', role: 'assistant', content: 'hi', status: 'complete' },
      ],
    });
  });

  it('preserves Desktop read status in shared thread snapshots', () => {
    expect(mapDesktopFlowerThread({ ...desktopThread(), read_status: desktopReadStatus(true) }).read_status.is_unread).toBe(true);
    expect(mapDesktopFlowerThread({ ...desktopThread(), read_status: desktopReadStatus(false) }).read_status.is_unread).toBe(false);
  });

  it('preserves streaming blocks, activity timelines, and run errors from Desktop IPC', () => {
    const mapped = mapDesktopFlowerThread({
      ...desktopThread(),
      status: 'failed',
      messages: [
        {
          id: 'm-streaming',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 3,
          blocks: [
            { type: 'thinking', content: 'Checking context.' },
            { type: 'markdown', content: 'Partial answer' },
            desktopActivityTimeline(),
          ],
        },
      ],
      error: {
        code: 'failed',
        message: 'provider rejected request',
      },
    });

    expect(mapped.messages[0]).toMatchObject({
      status: 'streaming',
      blocks: [
        { type: 'thinking', content: 'Checking context.' },
        { type: 'markdown', content: 'Partial answer' },
        expect.objectContaining({
          type: 'activity-timeline',
          run_id: 'run-1',
          summary: expect.objectContaining({
            status: 'success',
            total_items: 2,
          }),
        }),
      ],
    });
    expect(mapped.messages[0]?.blocks?.[2]).toMatchObject({
      type: 'activity-timeline',
      run_id: 'run-1',
      summary: {
        status: 'success',
        severity: 'quiet',
        needs_attention: false,
        total_items: 2,
        counts: { success: 2 },
      },
      items: [
        expect.objectContaining({ item_id: 'tool-terminal', tool_name: 'terminal.exec' }),
        expect.objectContaining({ item_id: 'tool-done', tool_name: 'task_complete' }),
      ],
    });
    expect(mapped.read_status.is_unread).toBe(false);
    expect(mapped.error).toEqual({
      code: 'failed',
      message: 'provider rejected request',
    });
  });

  it('preserves structured input requests from Desktop IPC', () => {
    const mapped = mapDesktopFlowerThread({
      ...desktopThread(),
      status: 'waiting_user',
      input_request: desktopInputRequest(),
    });

    expect(mapped.input_request).toEqual({
      prompt_id: 'prompt-ask-user',
      message_id: 'message-ask-user',
      tool_id: 'tool-ask-user',
      tool_name: 'ask_user',
      reason_code: 'needs_user_choice',
      required_from_user: ['target'],
      evidence_refs: ['m1'],
      public_summary: 'Choose a target.',
      contains_secret: false,
      questions: [
        {
          id: 'target',
          header: 'Deployment target',
          question: 'Where should Flower deploy this change?',
          response_mode: 'select_or_write',
          choices_exhaustive: false,
          write_label: 'Other target',
          write_placeholder: 'Type another target',
          choices: [
            {
              choice_id: 'staging',
              label: 'Staging',
              description: 'Use the validation environment.',
              kind: 'select',
              actions: [
                {
                  type: 'set_mode',
                  mode: 'act',
                },
              ],
            },
          ],
        },
      ],
    });
  });
});
