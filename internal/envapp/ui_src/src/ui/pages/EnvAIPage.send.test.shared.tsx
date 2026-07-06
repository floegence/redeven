import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state: {
    omitReadState: boolean;
    liveState: Record<string, unknown>;
    timelineMessages: unknown[] | null;
    threadDetailWaitingPrompt: Record<string, unknown> | null;
  } = {
    omitReadState: false,
    liveState: {
      thread_patch: {},
      runs: {},
      approval_actions: {},
      input_requests: {},
    },
    timelineMessages: null,
    threadDetailWaitingPrompt: null,
  };
  const readStatus = (lastMessageAtUnixMs: number, waitingPromptID = '') => {
    const activityRevision = lastMessageAtUnixMs;
    const activitySignature = waitingPromptID
      ? `status:waiting_user\u001factivity:${activityRevision}\u001fprompt:${waitingPromptID}`
      : `status:success\u001factivity:${activityRevision}`;
    const snapshot = {
      activity_revision: activityRevision,
      last_message_at_unix_ms: lastMessageAtUnixMs,
      activity_signature: activitySignature,
      ...(waitingPromptID ? { waiting_prompt_id: waitingPromptID } : {}),
    };
    return {
      is_unread: false,
      snapshot,
      ...(!state.omitReadState ? {
        read_state: {
          last_seen_activity_revision: activityRevision,
          last_read_message_at_unix_ms: lastMessageAtUnixMs,
          last_seen_activity_signature: activitySignature,
          ...(waitingPromptID ? { last_seen_waiting_prompt_id: waitingPromptID } : {}),
        },
      } : {}),
    };
  };
  const timelineMessagesMock = vi.fn(async ({ threadId }: { threadId: string }): Promise<unknown[]> => [{
    id: `msg-${threadId}`,
    role: 'assistant',
    status: 'complete',
    timestamp: 10,
    blocks: [{ type: 'markdown', content: `Transcript for ${threadId}` }],
  }]);
  const fetchLocalApiJSONMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/file-action-open-target')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
      return {
        path: body.action === 'browse_directory'
          ? '/workspace/env-flower/src'
          : '/workspace/env-flower/src/app.ts',
      };
    }
    if (url.includes('/_redeven_proxy/api/settings')) {
      return {
        ai: {
          current_model_id: 'openai/gpt-5.2',
          permission_type: 'approval_required',
          providers: [{
            id: 'openai',
            name: 'OpenAI',
            type: 'openai',
            models: [{ model_name: 'gpt-5.2', input_modalities: ['text'] }],
          }],
        },
        ai_secrets: {
          provider_api_key_set: { openai: true },
          web_search_provider_api_key_set: {},
        },
      };
    }
    if (url.includes('/_redeven_proxy/api/ai/models')) {
      return { current_model: 'openai/gpt-5.2', models: [{ id: 'openai/gpt-5.2', label: 'GPT 5.2' }] };
    }
    if (url.includes('/_redeven_proxy/api/ai/threads/') && url.includes('/live/events') && (!init || init.method === 'GET')) {
      return { events: [], next_cursor: 0, retained_from_seq: 1 };
    }
    if (url.includes('/_redeven_proxy/api/ai/threads/') && url.endsWith('/live/bootstrap') && (!init || init.method === 'GET')) {
      const match = /\/_redeven_proxy\/api\/ai\/threads\/([^/]+)\/live\/bootstrap$/u.exec(url);
      const threadID = decodeURIComponent(match?.[1] ?? 'thread-1');
      const waitingPromptID = String(state.threadDetailWaitingPrompt?.prompt_id ?? '').trim();
      const thread = {
        thread_id: threadID,
        title: 'Loaded Env Flower thread',
        model_id: 'openai/gpt-5.2',
        run_status: state.threadDetailWaitingPrompt || state.timelineMessages?.some((message) => {
          const record = message && typeof message === 'object' ? message as Record<string, unknown> : {};
          return record.status === 'streaming';
        }) ? 'running' : 'success',
        working_dir: '/workspace/env-flower',
        created_at_unix_ms: 1,
        updated_at_unix_ms: 2,
        read_status: readStatus(2_000, waitingPromptID),
        ...(state.threadDetailWaitingPrompt ? { waiting_prompt: state.threadDetailWaitingPrompt } : {}),
      };
      return {
        schema_version: 1,
        endpoint_id: 'env-app',
        thread_id: threadID,
        cursor: 0,
        retained_from_seq: 1,
        thread,
        timeline_messages: state.timelineMessages ?? await timelineMessagesMock({ threadId: threadID }),
        live_state: state.liveState,
        read_status: thread.read_status,
        generated_at_ms: 12_000,
      };
    }
    if (url.includes('/_redeven_proxy/api/ai/threads?')) {
      return { threads: [{ thread_id: 'thread-1', title: 'Env Flower history', model_id: 'openai/gpt-5.2', run_status: 'success', working_dir: '/workspace/env-flower', created_at_unix_ms: 1, updated_at_unix_ms: 2, read_status: readStatus(2_000) }] };
    }
    if (url.includes('/_redeven_proxy/api/ai/threads/') && init?.method === 'POST' && url.endsWith('/read')) {
      return { read_status: readStatus(2_000) };
    }
    if (url.includes('/_redeven_proxy/api/ai/threads') && init?.method === 'POST') {
      return { thread: { thread_id: 'thread-new', title: 'New Env Flower chat', model_id: 'openai/gpt-5.2', run_status: 'running', working_dir: '/workspace/env-flower', created_at_unix_ms: 3, updated_at_unix_ms: 4, read_status: readStatus(4_000) } };
    }
    if (url.includes('/_redeven_proxy/api/ai/provider_bundle')) {
      return {};
    }
    return {};
  });

  const sendUserTurnMock = vi.fn(async () => ({ runId: 'run-1', kind: 'start' }));
  const subscribeThreadMock = vi.fn(async () => ({ runId: 'run-subscribe' }));
  const openFileBrowserAtPathMock = vi.fn(async () => undefined);
  const openFilePreviewMock = vi.fn(async () => undefined);
  const openFlowerFileBrowserMock = vi.fn(async () => undefined);
  const openFlowerFilePreviewMock = vi.fn(async () => undefined);
  const consumeAIThreadFocusRequestMock = vi.fn(() => undefined);
  const notificationMock = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  };

  return {
    consumeAIThreadFocusRequestMock,
    fetchLocalApiJSONMock,
    timelineMessagesMock,
    openFileBrowserAtPathMock,
    openFilePreviewMock,
    openFlowerFileBrowserMock,
    openFlowerFilePreviewMock,
    notificationMock,
    sendUserTurnMock,
    state,
    subscribeThreadMock,
  };
});

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  useNotification: () => mocks.notificationMock,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = (props: any) => <span data-icon class={props.class} />;
  return {
    AlertTriangle: Icon,
    ArrowUp: Icon,
    Bot: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    Code: Icon,
    Copy: Icon,
    FileText: Icon,
    Folder: Icon,
    FolderOpen: Icon,
    GitBranch: Icon,
    GripVertical: Icon,
    MoreHorizontal: Icon,
    Pencil: Icon,
    Pin: Icon,
    Plus: Icon,
    Refresh: Icon,
    Search: Icon,
    Send: Icon,
    Settings: Icon,
    Shield: Icon,
    Sparkles: Icon,
    Terminal: Icon,
    Trash: Icon,
    X: Icon,
    Zap: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Button: (props: any) => {
    const Icon = props.icon;
    return (
      <button type="button" class={props.class} aria-label={props['aria-label']} disabled={props.disabled} onClick={props.onClick}>
        {Icon ? <Icon /> : null}
        {props.children}
      </button>
    );
  },
  Checkbox: (props: any) => (
    <input type="checkbox" checked={!!props.checked} disabled={props.disabled} onChange={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).checked)} />
  ),
  Dialog: (props: any) => (props.open ? <div role="dialog">{props.children}</div> : null),
  Input: (props: any) => <input class={props.class} value={props.value} placeholder={props.placeholder} onInput={props.onInput} disabled={props.disabled} />,
  ProcessingIndicator: (props: any) => <span class={props.class}>{props.status}</span>,
  Select: (props: any) => (
    <select class={props.class} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange?.((event.currentTarget as HTMLSelectElement).value)}>
      {(props.options ?? []).map((option: any) => <option value={option.value}>{option.label}</option>)}
    </select>
  ),
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
}));

vi.mock('../services/localApi', () => ({
  fetchLocalApiJSON: mocks.fetchLocalApiJSONMock,
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    ai: {
      sendUserTurn: mocks.sendUserTurnMock,
      subscribeThread: mocks.subscribeThreadMock,
    },
  }),
}));

vi.mock('./EnvContext', () => ({
  useEnvContext: () => ({
    env_id: () => 'env-1',
    env: () => ({ name: 'Demo Env' }),
    aiThreadFocusRequest: () => null,
    consumeAIThreadFocusRequest: mocks.consumeAIThreadFocusRequestMock,
    openFileBrowserAtPath: mocks.openFileBrowserAtPathMock,
    openFilePreview: mocks.openFilePreviewMock,
    openFlowerFileBrowser: mocks.openFlowerFileBrowserMock,
    openFlowerFilePreview: mocks.openFlowerFilePreviewMock,
  }),
}));

vi.mock('../i18n', () => {
  const messages: Record<string, string> = {
    'common.actions.cancel': 'Cancel',
    'common.actions.refresh': 'Refresh',
    'common.actions.retry': 'Retry',
    'common.actions.settings': 'Settings',
    'common.actions.stop': 'Stop',
    'chatChrome.thinkingEllipsis': 'Mock thinking...',
    'flowerChat.composer.describePlaceholder': 'Describe what you need',
    'flowerChat.composer.launchTurn': 'Send message',
    'flowerChat.composer.typeMessagePlaceholder': 'Message Flower',
    'flowerChat.model.label': 'Model',
    'flowerChat.router.currentEnvHandler': 'Using this environment',
    'flowerChat.router.currentEnvSource': 'Current environment',
    'flowerChat.router.conversationsAria': 'Flower conversations',
    'flowerChat.router.conversationsTitle': 'Conversations',
    'flowerChat.router.enterMessageBeforeSending': 'Enter a message before sending.',
    'flowerChat.router.envLocalSubtitle': 'Environment-local Flower',
    'flowerChat.router.failedToCreateChat': 'Failed to create Flower chat.',
    'flowerChat.router.handlerBlockedTitle': 'Flower needs attention',
    'flowerChat.router.handlerStartFailedTitle': 'Flower could not start',
    'flowerChat.router.handlerStillStarting': 'Flower is still starting',
    'flowerChat.router.missingThreadID': 'Missing thread id.',
    'flowerChat.router.newChat': 'New chat',
    'flowerChat.router.noConversations': 'No conversations yet',
    'flowerChat.router.searchConversations': 'Search conversations',
    'flowerChat.router.selectModelBeforeChat': 'Select a Flower model before starting a chat.',
    'flowerChat.sidebar.contextMenu.copied': 'Mock {label} copied',
    'flowerChat.sidebar.contextMenu.copyThreadId': 'Mock copy thread ID',
    'flowerChat.sidebar.contextMenu.copyWorkingDirectory': 'Mock copy working directory',
    'flowerChat.sidebar.contextMenu.fork': 'Mock fork',
    'flowerChat.sidebar.contextMenu.label': 'Mock actions for {title}',
    'flowerChat.sidebar.contextMenu.pin': 'Mock pin conversation',
    'flowerChat.sidebar.contextMenu.rename': 'Mock rename',
    'flowerChat.sidebar.contextMenu.threadIdLabel': 'Mock thread ID',
    'flowerChat.sidebar.contextMenu.unpin': 'Mock unpin conversation',
    'flowerChat.sidebar.contextMenu.workingDirectoryLabel': 'Mock working directory',
    'flowerChat.sidebar.delete.aria': 'Delete chat {title}',
    'flowerChat.sidebar.description': 'Mock stable conversation order',
    'flowerChat.sidebar.groups.older': 'Mock older',
    'flowerChat.sidebar.groups.thisWeek': 'Mock this week',
    'flowerChat.sidebar.groups.today': 'Mock today',
    'flowerChat.sidebar.groups.yesterday': 'Mock yesterday',
    'flowerChat.sidebar.pinnedBadge': 'Mock pinned',
    'flowerChat.sidebar.pinnedGroup': 'Mock pinned group',
    'flowerChat.sidebar.rename.nameLabel': 'Mock name',
    'flowerChat.sidebar.rename.title': 'Mock rename conversation',
    'flowerChat.sidebar.save': 'Mock save',
    'flowerChat.sidebar.saving': 'Mock saving...',
    'flowerChat.sidebar.status.done': 'Mock done',
    'flowerChat.sidebar.status.failed': 'Mock failed',
    'flowerChat.sidebar.status.idle': 'Mock idle',
    'flowerChat.sidebar.status.readOnly': 'Mock read only',
    'flowerChat.sidebar.status.running': 'Mock running',
    'flowerChat.sidebar.status.waitingApproval': 'Mock waiting approval',
    'flowerChat.sidebar.status.waitingInput': 'Mock waiting input',
    'flowerChat.sidebar.time.days': 'Mock {count}d',
    'flowerChat.sidebar.time.hours': 'Mock {count}h',
    'flowerChat.sidebar.time.minutes': 'Mock {count}m',
    'flowerChat.sidebar.time.now': 'Mock now',
    'flowerChat.sidebar.untitledChat': 'Mock new chat',
    'flowerChat.sidebar.unread': 'Mock unread',
    'flowerChat.sidebar.working': 'Mock working',
  };
  return {
    useI18n: () => ({
      t: (key: string) => messages[key] ?? key,
      snapshot: () => ({ preference: 'en-US', resolved_locale: 'en-US', source: 'system', system_candidates: ['en-US'] }),
      locale: () => 'en-US',
      localePreference: () => 'en-US',
      source: () => 'browser',
      setLocalePreference: () => undefined,
    }),
  };
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderPage() {
  const mod = await import('./EnvAIPage');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <mod.EnvAIPage />, host);
  await flush();
  await flush();
  return { host, dispose };
}

function mockTimelineMessages(payload: { messages: Array<{ messageJson: unknown }> }) {
  mocks.state.timelineMessages = payload.messages.map((row) => row.messageJson);
}

export function registerEnvAIPageSendTests() {
  describe('EnvAIPage FlowerSurface integration', () => {
    beforeEach(() => {
      mocks.fetchLocalApiJSONMock.mockClear();
      mocks.sendUserTurnMock.mockClear();
      mocks.subscribeThreadMock.mockClear();
      mocks.timelineMessagesMock.mockClear();
      mocks.openFileBrowserAtPathMock.mockClear();
      mocks.openFilePreviewMock.mockClear();
      mocks.openFlowerFileBrowserMock.mockClear();
      mocks.openFlowerFilePreviewMock.mockClear();
      mocks.notificationMock.error.mockClear();
      mocks.notificationMock.info.mockClear();
      mocks.notificationMock.success.mockClear();
      mocks.consumeAIThreadFocusRequestMock.mockClear();
      mocks.state.liveState = {
        thread_patch: {},
        runs: {},
        approval_actions: {},
        input_requests: {},
      };
      mocks.state.timelineMessages = null;
      mocks.state.omitReadState = false;
      mocks.state.threadDetailWaitingPrompt = null;
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('renders the shared Flower layout with New chat, thread history, settings, and model visibility', async () => {
      const { host, dispose } = await renderPage();
      try {
        expect(host.querySelector('.flower-component-thread-rail')).toBeTruthy();
        expect(host.querySelector('button[aria-label="New chat"]')?.textContent).toContain('New chat');
        const chatHeader = host.querySelector('.flower-chat-header');
        expect(chatHeader?.querySelector('.flower-chat-header-title')?.textContent).toContain('Describe what you need');
        expect(chatHeader?.textContent).not.toContain('Ready');
        expect(host.querySelector('.flower-model-selection')?.textContent).toContain('Model');
        expect(host.querySelector('.flower-model-chip')?.textContent).toContain('OpenAI / gpt-5.2');
        expect(host.querySelector('button[aria-label="Settings"]')).toBeTruthy();
      } finally {
        dispose();
      }
    });

    it('loads live bootstrap when a history thread is selected', async () => {
      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(mocks.fetchLocalApiJSONMock).toHaveBeenCalledWith('/_redeven_proxy/api/ai/threads/thread-1/live/bootstrap', { method: 'GET' });
        expect(mocks.timelineMessagesMock).toHaveBeenCalledWith({ threadId: 'thread-1' });
        expect(host.textContent).toContain('Transcript for thread-1');
      } finally {
        dispose();
      }
    });

    it('shows live streaming output when transcript persistence has not caught up', async () => {
      mocks.state.liveState = {
        thread_patch: { run_status: 'running' },
        runs: {
          'run-live': { run_id: 'run-live', status: 'running', message_id: 'msg-live' },
        },
        approval_actions: {},
        input_requests: {},
      };
      mocks.state.timelineMessages = [{
        id: 'msg-live',
        role: 'assistant',
        status: 'streaming',
        live: true,
        active_cursor: true,
        created_at_ms: 12_000,
        blocks: [
          { type: 'markdown', content: 'Live answer recovered from the event stream.' },
        ],
      }];

      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(host.textContent).toContain('Live answer recovered from the event stream.');
        expect(host.querySelector('.flower-model-status-lane')?.textContent).toContain('Mock thinking...');
        expect(host.querySelector('.flower-model-status-text')?.textContent).toBe('Mock thinking...');
        expect(host.querySelector('.flower-model-status-text')?.getAttribute('data-text')).toBe('Mock thinking...');
      } finally {
        dispose();
      }
    });

    it('maps Env-local message blocks into the shared Flower inline transcript', async () => {
      mockTimelineMessages({
        messages: [
          {
            rowId: 1,
            messageJson: {
              id: 'msg-inline',
              role: 'assistant',
              status: 'complete',
              timestamp: 10,
              blocks: [
                { type: 'markdown', content: 'I will inspect the Env workspace.' },
                {
                  type: 'activity-timeline',
                  schema_version: 1,
                  run_id: 'run-inline',
                  turn_id: 'msg-inline',
                  summary: {
                    status: 'success',
                    severity: 'quiet',
                    needs_attention: false,
                    total_items: 1,
                    counts: { success: 1 },
                    duration_ms: 1250,
                  },
                  items: [{
                    item_id: 'tool-read',
                    tool_id: 'tool-read',
                    tool_name: 'terminal.exec',
                    kind: 'tool',
                    status: 'success',
                    severity: 'quiet',
                    needs_attention: false,
                    requires_approval: false,
                    started_at_unix_ms: 10,
                    ended_at_unix_ms: 1260,
                    label: 'pwd',
                    renderer: 'terminal',
                    payload: { command: 'pwd', exit_code: 0 },
                  }],
                },
                { type: 'markdown', content: 'Env workspace inspection is complete.' },
              ],
            } as any,
          },
          {
            rowId: 2,
            messageJson: {
              id: 'msg-activity-only',
              role: 'assistant',
              status: 'complete',
              timestamp: 11,
              blocks: [{
                type: 'activity-timeline',
                schema_version: 1,
                run_id: 'run-activity-only',
                turn_id: 'msg-activity-only',
                summary: {
                  status: 'success',
                  severity: 'quiet',
                  needs_attention: false,
                  total_items: 1,
                  counts: { success: 1 },
                },
                items: [{
                  item_id: 'tool-search',
                  tool_id: 'tool-search',
                  tool_name: 'web.search',
                  kind: 'hosted_tool',
                  status: 'success',
                  severity: 'quiet',
                  needs_attention: false,
                  requires_approval: false,
                  label: 'Flower inline transcript',
                  renderer: 'web_search',
                  payload: { query: 'Flower inline transcript', sources: [] },
                }],
              }],
            } as any,
          },
        ],
      } as any);
      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        const transcriptText = host.textContent ?? '';
        expect(transcriptText.indexOf('I will inspect the Env workspace.')).toBeLessThan(transcriptText.indexOf('pwd'));
        expect(transcriptText.indexOf('pwd')).toBeLessThan(transcriptText.indexOf('Env workspace inspection is complete.'));
        expect(host.querySelectorAll('.flower-activity-inline-row')).toHaveLength(2);
        expect(host.textContent).toContain('pwd');
        expect(host.textContent).toContain('Flower inline transcript');
      } finally {
        dispose();
      }
    });

    it('accepts persisted todo activity payload metadata from runtime transcripts', async () => {
      mockTimelineMessages({
        messages: [{
          rowId: 1,
          messageJson: {
            id: 'msg-todos',
            role: 'assistant',
            status: 'complete',
            timestamp: 10,
            blocks: [{
              type: 'activity-timeline',
              schema_version: 1,
              run_id: 'run-todos',
              summary: {
                status: 'success',
                severity: 'normal',
                needs_attention: false,
                total_items: 1,
                counts: { success: 1 },
              },
              items: [{
                item_id: 'tool-todos',
                tool_id: 'tool-todos',
                tool_name: 'write_todos',
                kind: 'tool',
                status: 'success',
                severity: 'normal',
                needs_attention: false,
                requires_approval: false,
                label: 'Update todos',
                renderer: 'todos',
                payload: {
                  status: 'success',
                  summary: 'todos.updated',
                  details: 'tool execution completed',
                  version: 2,
                  updated_at_unix_ms: 1781519615687,
                  todos: [{ id: '1', content: 'Review AI Agent progress', status: 'completed' }],
                },
              }],
            }, {
              type: 'markdown',
              content: 'Todo-backed answer is visible.',
            }],
          } as any,
        }],
      } as any);

      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(host.textContent).not.toContain('Flower contract error');
        expect(host.textContent).toContain('Update todos');
        expect(host.textContent).toContain('Todo-backed answer is visible.');
      } finally {
        dispose();
      }
    });

    it('rejects malformed Env-local activity target line fields', async () => {
      mockTimelineMessages({
        messages: [
          {
            rowId: 1,
            messageJson: {
              id: 'msg-invalid-activity',
              role: 'assistant',
              status: 'complete',
              timestamp: 10,
              blocks: [{
                type: 'activity-timeline',
                schema_version: 1,
                run_id: 'run-invalid',
                summary: {
                  status: 'success',
                  severity: 'quiet',
                  needs_attention: false,
                  total_items: 1,
                  counts: { success: 1 },
                },
                items: [{
                  item_id: 'tool-invalid',
                  tool_id: 'tool-invalid',
                  tool_name: 'terminal.exec',
                  kind: 'tool',
                  status: 'success',
                  severity: 'quiet',
                  needs_attention: false,
                  requires_approval: false,
                  label: 'pwd',
                  renderer: 'terminal',
                  target_refs: [{ kind: 'file', label: 'app.ts', line: '12' }],
                  payload: { command: 'pwd' },
                }],
              }],
            } as any,
          },
        ],
      } as any);
      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(host.textContent).toContain('Flower contract error: activity_item.target_refs[0].line must be a non-negative integer.');
      } finally {
        dispose();
      }
    });

    it.each([
      ['path', { path: '/workspace/env-flower/src/app.ts' }],
      ['file_path', { file_path: '/workspace/env-flower/src/app.ts' }],
      ['preview_path', { preview_path: '/workspace/env-flower/src/app.ts' }],
      ['root_dir', { root_dir: '/workspace/env-flower' }],
    ])('rejects Env-local activity target ref %s fields that belong to host-only data', async (field, extra) => {
      mockTimelineMessages({
        messages: [
          {
            rowId: 1,
            messageJson: {
              id: `msg-invalid-target-ref-${field}`,
              role: 'assistant',
              status: 'complete',
              timestamp: 10,
              blocks: [{
                type: 'activity-timeline',
                schema_version: 1,
                run_id: `run-invalid-target-ref-${field}`,
                summary: {
                  status: 'success',
                  severity: 'quiet',
                  needs_attention: false,
                  total_items: 1,
                  counts: { success: 1 },
                },
                items: [{
                  item_id: 'tool-invalid-target-ref',
                  tool_id: 'tool-invalid-target-ref',
                  tool_name: 'terminal.exec',
                  kind: 'tool',
                  status: 'success',
                  severity: 'quiet',
                  needs_attention: false,
                  requires_approval: false,
                  label: 'pwd',
                  renderer: 'terminal',
                  target_refs: [{ kind: 'file', label: 'app.ts', ...extra }],
                  payload: { command: 'pwd' },
                }],
              }],
            } as any,
          },
        ],
      } as any);
      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(host.textContent).toContain(`Flower contract error: activity_item.target_refs[0].${field} is not part of the activity target ref contract.`);
      } finally {
        dispose();
      }
    });

    it.each([
      ['cwd', { cwd: '/workspace/env-flower' }],
      ['path', { path: '/workspace/env-flower/src/app.ts' }],
      ['rootDir', { rootDir: '/Users/alice/.codex/skills/frontend-design' }],
    ])('rejects nested Env-local activity payload %s fields that belong to host-only data', async (field, result) => {
      mockTimelineMessages({
        messages: [
          {
            rowId: 1,
            messageJson: {
              id: `msg-invalid-nested-activity-${field}`,
              role: 'assistant',
              status: 'complete',
              timestamp: 10,
              blocks: [{
                type: 'activity-timeline',
                schema_version: 1,
                run_id: `run-invalid-nested-${field}`,
                summary: {
                  status: 'success',
                  severity: 'quiet',
                  needs_attention: false,
                  total_items: 1,
                  counts: { success: 1 },
                },
                items: [{
                  item_id: 'tool-invalid-nested',
                  tool_id: 'tool-invalid-nested',
                  tool_name: 'task_complete',
                  kind: 'tool',
                  status: 'success',
                  severity: 'quiet',
                  needs_attention: false,
                  requires_approval: false,
                  label: 'Done',
                  renderer: 'completion',
                  payload: { result },
                }],
              }],
            } as any,
          },
        ],
      } as any);
      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(host.textContent).toContain(`Flower contract error: activity_item.payload.result.${field} is not part of the nested activity payload contract.`);
      } finally {
        dispose();
      }
    });

    it.each([
      ['path', { path: '/workspace/env-flower/src/app.ts' }],
      ['file_path', { file_path: '/workspace/env-flower/src/app.ts' }],
      ['root_dir', { root_dir: '/workspace/env-flower' }],
    ])('rejects Env-local file action %s fields that belong to host-only data', async (field, extra) => {
      mockTimelineMessages({
        messages: [
          {
            rowId: 1,
            messageJson: {
              id: `msg-invalid-file-action-${field}`,
              role: 'assistant',
              status: 'complete',
              timestamp: 10,
              blocks: [{
                type: 'activity-timeline',
                schema_version: 1,
                run_id: `run-invalid-file-action-${field}`,
                summary: {
                  status: 'success',
                  severity: 'quiet',
                  needs_attention: false,
                  total_items: 1,
                  counts: { success: 1 },
                },
                file_actions: {
                  read_app: {
                    action_id: 'read_app',
                    display_name: 'app.ts',
                    can_preview: true,
                    can_browse_directory: true,
                    ...extra,
                  },
                },
                items: [{
                  item_id: 'tool-invalid-file-action',
                  tool_id: 'tool-invalid-file-action',
                  tool_name: 'file.read',
                  kind: 'tool',
                  status: 'success',
                  severity: 'quiet',
                  needs_attention: false,
                  requires_approval: false,
                  label: 'app.ts',
                  renderer: 'file',
                  payload: { operation: 'read', display_name: 'app.ts', file_action_id: 'read_app' },
                }],
              }],
            } as any,
          },
        ],
      } as any);
      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(host.textContent).toContain(`Flower contract error: activity_timeline.file_actions.read_app.${field} is not part of the file action contract.`);
      } finally {
        dispose();
      }
    });

    it('opens Env file browser and preview from Flower file activity details', async () => {
      mockTimelineMessages({
        messages: [{
          rowId: 1,
          messageJson: {
            id: 'msg-file-read',
            role: 'assistant',
            status: 'complete',
            timestamp: 10,
            blocks: [{
              type: 'activity-timeline',
              schema_version: 1,
              run_id: 'run-file-read',
              summary: {
                status: 'success',
                severity: 'quiet',
                needs_attention: false,
                total_items: 1,
                counts: { success: 1 },
              },
              file_actions: {
                read_app: {
                  action_id: 'read_app',
                  display_name: 'app.ts',
                  can_preview: true,
                  can_browse_directory: true,
                },
              },
              items: [{
                item_id: 'tool-file-read',
                tool_id: 'tool-file-read',
                tool_name: 'file.read',
                kind: 'tool',
                status: 'success',
                severity: 'quiet',
                needs_attention: false,
                requires_approval: false,
                label: 'app.ts#dcbdf9b8c27f#e1703606242a',
                renderer: 'file',
                target_refs: [{ kind: 'file', label: 'app.ts#dcbdf9b8c27f' }],
                payload: {
                  operation: 'read',
                  display_name: 'app.ts',
                  file_action_id: 'read_app',
                  content: 'export const app = true;\n',
                  line_offset: 1,
                  line_count: 1,
                  total_lines: 1,
                },
              }],
            }],
          } as any,
        }],
      } as any);

      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(host.textContent).toContain('Read');
        expect(host.textContent).toContain('app.ts');
        expect(host.textContent).not.toContain('#dcbdf9b8c27f');
        (host.querySelector('[data-flower-activity-item-id="tool-file-read"] .flower-activity-inline-button') as HTMLButtonElement).click();
        await flush();
        const browse = host.querySelector('button[aria-label="Browse folder for app.ts"]') as HTMLButtonElement | null;
        const preview = host.querySelector('button[aria-label="Preview app.ts"]') as HTMLButtonElement | null;
        expect(browse).toBeTruthy();
        expect(preview).toBeTruthy();
        browse?.click();
        preview?.click();
        await flush();
        const request = {
          thread_id: 'thread-1',
          message_id: 'msg-file-read',
          block_index: 0,
          item_id: 'tool-file-read',
          action_id: 'read_app',
        };
        expect(mocks.openFlowerFileBrowserMock).toHaveBeenCalledWith(request);
        expect(mocks.openFlowerFilePreviewMock).toHaveBeenCalledWith(request);
        expect(mocks.openFileBrowserAtPathMock).not.toHaveBeenCalled();
        expect(mocks.openFilePreviewMock).not.toHaveBeenCalled();
      } finally {
        dispose();
      }
    });

    it('renders sanitized use_skill activity payloads', async () => {
      mockTimelineMessages({
        messages: [{
          rowId: 1,
          messageJson: {
            id: 'msg-use-skill',
            role: 'assistant',
            status: 'complete',
            timestamp: 10,
            blocks: [{
              type: 'activity-timeline',
              schema_version: 1,
              run_id: 'run-use-skill',
              summary: {
                status: 'success',
                severity: 'quiet',
                needs_attention: false,
                total_items: 1,
                counts: { success: 1 },
              },
              items: [{
                item_id: 'tool-use-skill',
                tool_id: 'tool-use-skill',
                tool_name: 'use_skill',
                kind: 'tool',
                status: 'success',
                severity: 'quiet',
                needs_attention: false,
                requires_approval: false,
                label: 'frontend-design',
                renderer: 'structured',
                payload: {
                  operation: 'use_skill',
                  name: 'frontend-design',
                  content: 'Loaded frontend design guidance.',
                  content_ref: 'content_123',
                  activation_id: 'act_123',
                },
              }],
            }],
          } as any,
        }],
      } as any);

      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(host.textContent).toContain('frontend-design');
        (host.querySelector('[data-flower-activity-item-id="tool-use-skill"] .flower-activity-inline-button') as HTMLButtonElement).click();
        await flush();
        expect(host.textContent).toContain('Loaded frontend design guidance.');
      } finally {
        dispose();
      }
    });

    it('opens Env file browser and preview from relative apply_patch diff details', async () => {
      mockTimelineMessages({
        messages: [{
          rowId: 1,
          messageJson: {
            id: 'msg-patch',
            role: 'assistant',
            status: 'complete',
            timestamp: 10,
            blocks: [{
              type: 'activity-timeline',
              schema_version: 1,
              run_id: 'run-patch',
              summary: {
                status: 'success',
                severity: 'quiet',
                needs_attention: false,
                total_items: 1,
                counts: { success: 1 },
              },
              file_actions: {
                patch_app: {
                  action_id: 'patch_app',
                  display_name: 'src/app.ts',
                  can_preview: true,
                  can_browse_directory: true,
                },
              },
              items: [{
                item_id: 'tool-patch',
                tool_id: 'tool-patch',
                tool_name: 'apply_patch',
                kind: 'tool',
                status: 'success',
                severity: 'quiet',
                needs_attention: false,
                requires_approval: false,
                label: 'apply_patch',
                renderer: 'patch',
                payload: {
                  operation: 'apply_patch',
                  mutations: [{
                    display_name: 'src/app.ts',
                    file_action_id: 'patch_app',
                    change_type: 'update',
                    additions: 1,
                    deletions: 1,
                    unified_diff: [
                      '--- a/src/app.ts',
                      '+++ b/src/app.ts',
                      '@@ -1,2 +1,2 @@',
                      '-export const oldValue = 1;',
                      '+export const newValue = 2;',
                      ' shared();',
                    ].join('\n'),
                  }],
                },
              }],
            }],
          } as any,
        }],
      } as any);

      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(host.textContent).toContain('Edit');
        expect(host.textContent).toContain('src/app.ts');
        (host.querySelector('[data-flower-activity-item-id="tool-patch"] .flower-activity-inline-button') as HTMLButtonElement).click();
        await flush();
        const browse = host.querySelector('button[aria-label="Browse folder for src/app.ts"]') as HTMLButtonElement | null;
        const preview = host.querySelector('button[aria-label="Preview src/app.ts"]') as HTMLButtonElement | null;
        expect(browse).toBeTruthy();
        expect(preview).toBeTruthy();
        browse?.click();
        preview?.click();
        await flush();
        const request = {
          thread_id: 'thread-1',
          message_id: 'msg-patch',
          block_index: 0,
          item_id: 'tool-patch',
          action_id: 'patch_app',
        };
        expect(mocks.openFlowerFileBrowserMock).toHaveBeenCalledWith(request);
        expect(mocks.openFlowerFilePreviewMock).toHaveBeenCalledWith(request);
        expect(mocks.openFileBrowserAtPathMock).not.toHaveBeenCalled();
        expect(mocks.openFilePreviewMock).not.toHaveBeenCalled();
      } finally {
        dispose();
      }
    });

    it('uses Env-local i18n copy for the shared thread context menu', async () => {
      const { host, dispose } = await renderPage();
      try {
        const card = host.querySelector('[data-thread-id="thread-1"]') as HTMLElement;
        expect(card).toBeTruthy();
        card.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 96,
          clientY: 80,
        }));
        await flush();
        expect(host.textContent).toContain('Mock copy thread ID');
        expect(host.textContent).toContain('Mock copy working directory');
        expect(host.textContent).toContain('Mock fork');
        expect(host.textContent).toContain('Mock pin conversation');
        expect(host.textContent).toContain('Mock rename');
        expect(host.textContent).not.toContain('Copy thread id');
        expect(host.textContent).not.toContain('Copy work directory');
      } finally {
        dispose();
      }
    });

    it('shows a contract error instead of dropping malformed waiting prompts', async () => {
      mocks.state.threadDetailWaitingPrompt = {
        prompt_id: 'prompt-1',
        message_id: 'message-1',
        tool_id: 'tool-1',
        questions: [{
          id: 'next_step',
          header: 'Need input',
          question: 'Choose the next step.',
          response_mode: 'select',
          choices: [{ choice_id: 'continue', label: 'Continue', kind: 'select' }],
        }],
      };
      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(host.textContent).toContain('Flower contract error: waiting_prompt requires prompt_id, message_id, tool_id, and tool_name.');
        expect(host.querySelector('[data-flower-input-request-prompt]')).toBeNull();
      } finally {
        dispose();
      }
    });

    it('requires read_status.read_state from the Env-local local API contract', async () => {
      mocks.state.omitReadState = true;
      const { host, dispose } = await renderPage();
      try {
        await flush();
        await flush();
        expect(host.textContent).toContain('Flower contract error: thread.read_status.read_state is required.');
      } finally {
        dispose();
      }
    });

    it('starts a new Env-local Flower chat through the runtime RPC path', async () => {
      const { host, dispose } = await renderPage();
      try {
        const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
        textarea.value = '你好，Flower';
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
        await flush();
        const sendButton = host.querySelector('button.flower-composer-submit[aria-label="Send message"]') as HTMLButtonElement | null;
        expect(sendButton).toBeTruthy();
        expect(sendButton?.disabled).toBe(false);
        sendButton?.click();
        await flush();
        await flush();
        expect(mocks.subscribeThreadMock).toHaveBeenCalledWith({ threadId: 'thread-new' });
        expect(mocks.sendUserTurnMock).toHaveBeenCalledWith(expect.objectContaining({
          threadId: 'thread-new',
          model: 'openai/gpt-5.2',
          input: { text: '你好，Flower', attachments: [] },
        }));
        expect(host.textContent).toContain('Transcript for thread-new');
      } finally {
        dispose();
      }
    });

    it('does not send while IME composition owns Enter', async () => {
      const { host, dispose } = await renderPage();
      try {
        const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
        textarea.value = '中文输入';
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
        textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }));
        await flush();
        expect(mocks.sendUserTurnMock).not.toHaveBeenCalled();
        textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await flush();
        await flush();
        expect(mocks.sendUserTurnMock).toHaveBeenCalledTimes(1);
      } finally {
        dispose();
      }
    });
  });
}
