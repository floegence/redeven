import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state: {
    threadDetailWaitingPrompt: Record<string, unknown> | null;
  } = {
    threadDetailWaitingPrompt: null,
  };
  const fetchGatewayJSONMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/_redeven_proxy/api/settings')) {
      return {
        ai: {
          current_model_id: 'openai/gpt-5.2',
          execution_policy: { require_user_approval: true, block_dangerous_commands: true },
          terminal_exec_policy: { default_timeout_ms: 120000, max_timeout_ms: 600000 },
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
    if (url.includes('/_redeven_proxy/api/ai/threads/') && (!init || init.method === 'GET')) {
      const threadID = decodeURIComponent(url.split('/').pop() ?? 'thread-1');
      return {
        thread: {
          thread_id: threadID,
          title: 'Loaded Env Flower thread',
          model_id: 'openai/gpt-5.2',
          run_status: state.threadDetailWaitingPrompt ? 'waiting_user' : 'success',
          created_at_unix_ms: 1,
          updated_at_unix_ms: 2,
          ...(state.threadDetailWaitingPrompt ? { waiting_prompt: state.threadDetailWaitingPrompt } : {}),
        },
      };
    }
    if (url.includes('/_redeven_proxy/api/ai/threads?')) {
      return { threads: [{ thread_id: 'thread-1', title: 'Env Flower history', model_id: 'openai/gpt-5.2', run_status: 'success', created_at_unix_ms: 1, updated_at_unix_ms: 2 }] };
    }
    if (url.includes('/_redeven_proxy/api/ai/threads') && init?.method === 'POST') {
      return { thread: { thread_id: 'thread-new', title: 'New Env Flower chat', model_id: 'openai/gpt-5.2', run_status: 'running', created_at_unix_ms: 3, updated_at_unix_ms: 4 } };
    }
    if (url.includes('/_redeven_proxy/api/ai/provider_bundle')) {
      return {};
    }
    return {};
  });

  const sendUserTurnMock = vi.fn(async () => ({ runId: 'run-1', kind: 'start' }));
  const subscribeThreadMock = vi.fn(async () => ({ runId: 'run-subscribe' }));
  const listMessagesMock = vi.fn(async ({ threadId }: { threadId: string }) => ({
    messages: [{
      messageJson: {
        id: `msg-${threadId}`,
        role: 'assistant',
        status: 'complete',
        timestamp: 10,
        blocks: [{ type: 'markdown', content: `Transcript for ${threadId}` }],
      },
    }],
  }));

  return {
    fetchGatewayJSONMock,
    listMessagesMock,
    sendUserTurnMock,
    state,
    subscribeThreadMock,
  };
});

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = (props: any) => <span data-icon class={props.class} />;
  return {
    AlertTriangle: Icon,
    Bot: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    Code: Icon,
    FolderOpen: Icon,
    GitBranch: Icon,
    GripVertical: Icon,
    Pencil: Icon,
    Plus: Icon,
    Refresh: Icon,
    Search: Icon,
    Send: Icon,
    Settings: Icon,
    Shield: Icon,
    Sparkles: Icon,
    Trash: Icon,
    X: Icon,
    Zap: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
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

vi.mock('../services/gatewayApi', () => ({
  fetchGatewayJSON: mocks.fetchGatewayJSONMock,
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    ai: {
      listMessages: mocks.listMessagesMock,
      sendUserTurn: mocks.sendUserTurnMock,
      subscribeThread: mocks.subscribeThreadMock,
    },
  }),
}));

vi.mock('./EnvContext', () => ({
  useEnvContext: () => ({
    env_id: () => 'env-1',
    env: () => ({ name: 'Demo Env' }),
  }),
}));

vi.mock('../i18n', () => {
  const messages: Record<string, string> = {
    'common.actions.refresh': 'Refresh',
    'common.actions.retry': 'Retry',
    'common.actions.settings': 'Settings',
    'flowerChat.composer.describePlaceholder': 'Describe what you need',
    'flowerChat.composer.sendMessage': 'Send message',
    'flowerChat.composer.typeMessagePlaceholder': 'Message Flower',
    'flowerChat.router.conversationsAria': 'Flower conversations',
    'flowerChat.router.conversationsTitle': 'Conversations',
    'flowerChat.router.handlerResolving': 'Finding Flower',
    'flowerChat.router.handlerSelectionLabel': 'Flower',
    'flowerChat.router.handlerUnavailable': 'Flower is unavailable',
    'flowerChat.router.newChat': 'New chat',
    'flowerChat.router.noConversations': 'No conversations yet',
    'flowerChat.router.searchConversations': 'Search conversations',
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

export function registerEnvAIPageSendTests() {
  describe('EnvAIPage FlowerSurface integration', () => {
    beforeEach(() => {
      mocks.fetchGatewayJSONMock.mockClear();
      mocks.sendUserTurnMock.mockClear();
      mocks.subscribeThreadMock.mockClear();
      mocks.listMessagesMock.mockClear();
      mocks.state.threadDetailWaitingPrompt = null;
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('renders the shared Flower layout with New chat, thread history, settings, and handler visibility', async () => {
      const { host, dispose } = await renderPage();
      try {
        expect(host.querySelector('.flower-component-thread-rail')).toBeTruthy();
        expect(host.querySelector('button[aria-label="New chat"]')?.textContent).toContain('New chat');
        const chatHeader = host.querySelector('.flower-host-chat-header');
        expect(chatHeader?.querySelector('.flower-host-chat-header-title')?.textContent).toContain('Describe what you need');
        expect(chatHeader?.textContent).not.toContain('Ready');
        expect(chatHeader?.textContent).not.toContain('Using Flower Host');
        expect(host.querySelector('button[aria-label="Settings"]')).toBeTruthy();
      } finally {
        dispose();
      }
    });

    it('loads full messages when a history thread is selected', async () => {
      const { host, dispose } = await renderPage();
      try {
        (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
        await flush();
        await flush();
        expect(mocks.listMessagesMock).toHaveBeenCalledWith({ threadId: 'thread-1', tail: true, limit: 200 });
        expect(host.textContent).toContain('Transcript for thread-1');
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
        expect(host.querySelector('[data-flower-input-request-card]')).toBeNull();
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
        const sendButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Send message')) as HTMLButtonElement | undefined;
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
