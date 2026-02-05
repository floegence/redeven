import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, type Component } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { Pencil, Plus, Settings, Sparkles, Stop, Trash } from '@floegence/floe-webapp-core/icons';
import { LoadingOverlay, SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { Button, ConfirmDialog, Dialog, Input, Select, Tooltip } from '@floegence/floe-webapp-core/ui';
import {
  ChatInput,
  ChatProvider,
  VirtualMessageList,
  useChatContext,
  type Attachment,
  type ChatCallbacks,
  type ChatContextValue,
  type Message,
  type StreamEvent,
} from '@floegence/floe-webapp-core/chat';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useEnvContext } from './EnvContext';

import { fetchGatewayJSON } from '../services/gatewayApi';

type ModelsResponse = Readonly<{
  default_model: string;
  models: Array<{ id: string; label?: string }>;
}>;

type SettingsResponse = Readonly<{
  ai: any | null;
}>;

type ThreadView = Readonly<{
  thread_id: string;
  title: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  last_message_at_unix_ms: number;
  last_message_preview: string;
}>;

type ListThreadsResponse = Readonly<{
  threads: ThreadView[];
  next_cursor?: string;
}>;

type CreateThreadResponse = Readonly<{
  thread: ThreadView;
}>;

type ListThreadMessagesResponse = Readonly<{
  messages: Message[];
  next_before_id?: number;
  has_more?: boolean;
  total_returned?: number;
}>;

const ACTIVE_THREAD_STORAGE_KEY = 'redeven_ai_active_thread_id';

function readPersistedActiveThreadId(): string | null {
  try {
    const v = String(localStorage.getItem(ACTIVE_THREAD_STORAGE_KEY) ?? '').trim();
    return v || null;
  } catch {
    return null;
  }
}

function persistActiveThreadId(threadId: string): void {
  try {
    localStorage.setItem(ACTIVE_THREAD_STORAGE_KEY, threadId);
  } catch {
    // ignore
  }
}

function fmtRelativeTime(ms: number): string {
  if (!ms) return 'Never';
  try {
    const now = Date.now();
    const diff = now - ms;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  } catch {
    return String(ms);
  }
}

function createUserMarkdownMessage(markdown: string): Message {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    blocks: [{ type: 'markdown', content: markdown }],
    status: 'complete',
    timestamp: Date.now(),
  };
}

const ChatCapture: Component<{ onReady: (ctx: ChatContextValue) => void }> = (props) => {
  const ctx = useChatContext();
  createEffect(() => props.onReady(ctx));
  return null;
};

function InlineButtonSnakeLoading() {
  return (
    <span class="relative inline-flex w-4 h-4 shrink-0" aria-hidden="true">
      <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-[0.66] origin-center">
        <SnakeLoader size="sm" />
      </span>
    </span>
  );
}

export function EnvAIPage() {
  const env = useEnvContext();
  const protocol = useProtocol();
  const notify = useNotification();

  const settingsKey = createMemo<number | null>(() => (protocol.status() === 'connected' ? env.settingsSeq() : null));
  const [settings] = createResource<SettingsResponse | null, number | null>(
    () => settingsKey(),
    async (k) => (k == null ? null : await fetchGatewayJSON<SettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' })),
  );
  const aiEnabled = createMemo(() => !!settings()?.ai);

  const modelsKey = createMemo<number | null>(() => {
    if (settingsKey() == null) return null;
    if (!aiEnabled()) return null;
    return env.settingsSeq();
  });

  const [models] = createResource<ModelsResponse | null, number | null>(
    () => modelsKey(),
    async (k) => (k == null ? null : await fetchGatewayJSON<ModelsResponse>('/_redeven_proxy/api/ai/models', { method: 'GET' })),
  );

  const [selectedModel, setSelectedModel] = createSignal('');

  const [threadsSeq, setThreadsSeq] = createSignal(0);
  const bumpThreadsSeq = () => setThreadsSeq((n) => n + 1);

  const threadsKey = createMemo<number | null>(() => {
    if (settingsKey() == null) return null;
    if (!aiEnabled()) return null;
    return threadsSeq();
  });

  const [threads] = createResource<ListThreadsResponse | null, number | null>(
    () => threadsKey(),
    async (k) =>
      k == null
        ? null
        : await fetchGatewayJSON<ListThreadsResponse>('/_redeven_proxy/api/ai/threads?limit=200', {
            method: 'GET',
          }),
  );

  const [activeThreadId, setActiveThreadId] = createSignal<string | null>(null);
  const activeThread = createMemo<ThreadView | null>(() => {
    const list = threads();
    const id = activeThreadId();
    if (!list || !id) return null;
    return list.threads.find((t) => t.thread_id === id) ?? null;
  });
  const activeThreadTitle = createMemo(() => {
    const t = activeThread();
    return t?.title?.trim() || 'New chat';
  });

  const [creatingThread, setCreatingThread] = createSignal(false);

  const [renameOpen, setRenameOpen] = createSignal(false);
  const [renameTitle, setRenameTitle] = createSignal('');
  const [renaming, setRenaming] = createSignal(false);

  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  const [messagesLoading, setMessagesLoading] = createSignal(false);

  const [runId, setRunId] = createSignal<string | null>(null);
  const [running, setRunning] = createSignal(false);

  let chat: ChatContextValue | null = null;
  const [chatReady, setChatReady] = createSignal(false);

  let abortCtrl: AbortController | null = null;
  let assistantText = '';
  let lastMessagesReq = 0;

  const modelsReady = createMemo(() => !!models() && !models.loading && !models.error);
  const canInteract = createMemo(
    () => protocol.status() === 'connected' && !running() && aiEnabled() && modelsReady() && !!activeThreadId(),
  );

  createEffect(() => {
    const m = models();
    if (!m) return;
    const current = selectedModel().trim();
    if (!current && m.default_model) {
      setSelectedModel(m.default_model);
    }
  });

  createEffect(() => {
    const id = activeThreadId();
    if (!id) return;
    persistActiveThreadId(id);
  });

  const createThread = async (): Promise<ThreadView> => {
    const resp = await fetchGatewayJSON<CreateThreadResponse>('/_redeven_proxy/api/ai/threads', {
      method: 'POST',
      body: JSON.stringify({ title: '' }),
    });
    return resp.thread;
  };

  // Ensure we always have an active thread when AI is enabled.
  let initInFlight = false;
  createEffect(() => {
    if (protocol.status() !== 'connected' || !aiEnabled()) {
      setActiveThreadId(null);
      return;
    }
    const list = threads();
    if (!list || threads.loading || threads.error) return;

    const current = activeThreadId();
    if (current && list.threads.some((t) => t.thread_id === current)) return;

    const persisted = readPersistedActiveThreadId();
    const picked =
      (persisted && list.threads.some((t) => t.thread_id === persisted) ? persisted : null) ||
      (list.threads[0]?.thread_id ? String(list.threads[0].thread_id) : null);

    if (picked) {
      setActiveThreadId(picked);
      return;
    }

    if (initInFlight) return;
    initInFlight = true;
    void (async () => {
      try {
        const th = await createThread();
        bumpThreadsSeq();
        setActiveThreadId(th.thread_id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notify.error('Failed to create chat', msg || 'Request failed.');
      } finally {
        initInFlight = false;
      }
    })();
  });

  const loadThreadMessages = async (threadId: string): Promise<void> => {
    if (!chat) return;
    const reqNo = ++lastMessagesReq;
    setMessagesLoading(true);
    try {
      const resp = await fetchGatewayJSON<ListThreadMessagesResponse>(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadId)}/messages?limit=500`,
        { method: 'GET' },
      );
      if (reqNo !== lastMessagesReq) return;
      chat.setMessages(resp.messages || []);
    } catch (e) {
      if (reqNo !== lastMessagesReq) return;
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to load chat', msg || 'Request failed.');
      chat.clearMessages();
    } finally {
      if (reqNo === lastMessagesReq) setMessagesLoading(false);
    }
  };

  // Load messages when switching threads (or on initial selection).
  createEffect(() => {
    if (!chatReady()) return;

    if (protocol.status() !== 'connected' || !aiEnabled()) {
      chat?.clearMessages();
      return;
    }

    const tid = activeThreadId();
    assistantText = '';
    chat?.clearMessages();
    if (!tid) return;
    void loadThreadMessages(tid);
  });

  // FileBrowser -> AI context injection (persist into the active thread).
  let lastInjectionSeq = 0;
  createEffect(() => {
    if (!chatReady()) return;
    if (protocol.status() !== 'connected' || !aiEnabled()) return;

    const tid = activeThreadId();
    if (!tid) return;

    const seq = env.aiInjectionSeq();
    if (!seq || seq === lastInjectionSeq) return;
    lastInjectionSeq = seq;

    const md = env.aiInjectionMarkdown();
    if (!md || !md.trim()) return;

    chat?.addMessage(createUserMarkdownMessage(md));

    void (async () => {
      try {
        await fetchGatewayJSON<void>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/messages`, {
          method: 'POST',
          body: JSON.stringify({ role: 'user', text: md, format: 'markdown' }),
        });
        bumpThreadsSeq();
        await loadThreadMessages(tid);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notify.error('Failed to add message', msg || 'Request failed.');
      }
    })();
  });

  const uploadAttachment = async (file: File): Promise<string> => {
    const form = new FormData();
    form.append('file', file);

    const resp = await fetch('/_redeven_proxy/api/ai/uploads', {
      method: 'POST',
      body: form,
      credentials: 'omit',
      cache: 'no-store',
    });

    const text = await resp.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }
    if (!resp.ok) throw new Error(data?.error ?? `HTTP ${resp.status}`);
    if (data?.ok === false) throw new Error(String(data?.error ?? 'Upload failed'));

    const url = String(data?.data?.url ?? '').trim();
    if (!url) throw new Error('Upload failed');
    return url;
  };

  const sendToolApproval = async (_messageId: string, toolId: string, approved: boolean) => {
    const id = runId();
    if (!id) return;
    await fetchGatewayJSON<void>(`/_redeven_proxy/api/ai/runs/${encodeURIComponent(id)}/tool_approvals`, {
      method: 'POST',
      body: JSON.stringify({ tool_id: toolId, approved }),
    });
  };

  const cancel = async (opts?: { skipReload?: boolean }) => {
    const id = runId();
    const tid = activeThreadId();

    abortCtrl?.abort();
    abortCtrl = null;
    setRunning(false);
    setRunId(null);

    try {
      if (id) {
        await fetchGatewayJSON<void>(`/_redeven_proxy/api/ai/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      }
    } catch {
      // best-effort
    }

    if (!opts?.skipReload && tid) {
      bumpThreadsSeq();
      void loadThreadMessages(tid);
    }
  };

  const handleStreamEvent = (ev: StreamEvent) => {
    chat?.handleStreamEvent(ev);

    if (ev.type === 'block-delta' && typeof (ev as any).delta === 'string') {
      assistantText += String((ev as any).delta);
      return;
    }
    if (ev.type === 'message-end') {
      assistantText = '';
      setRunning(false);
      setRunId(null);
      abortCtrl = null;
      bumpThreadsSeq();
      return;
    }
    if (ev.type === 'error') {
      const msg = String((ev as any).error ?? 'AI error');
      notify.error('AI failed', msg);
      assistantText = '';
      setRunning(false);
      setRunId(null);
      abortCtrl = null;
      bumpThreadsSeq();
      return;
    }
  };

  const startRun = async (content: string, attachments: Attachment[]) => {
    if (!chat) {
      notify.error('AI unavailable', 'Chat is not ready.');
      return;
    }
    if (running()) {
      notify.info('AI is busy', 'Please wait for the current run to finish.');
      return;
    }
    if (!aiEnabled()) {
      notify.error('AI not configured', 'Open Settings to enable AI.');
      return;
    }
    if (models.error) {
      const msg = models.error instanceof Error ? models.error.message : String(models.error);
      notify.error('AI unavailable', msg || 'Failed to load models.');
      return;
    }
    const model = selectedModel().trim();
    if (!model) {
      notify.error('Missing model', 'Please select a model.');
      return;
    }

    let tid = activeThreadId();
    if (!tid) {
      try {
        setCreatingThread(true);
        const th = await createThread();
        bumpThreadsSeq();
        tid = th.thread_id;
        setActiveThreadId(tid);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notify.error('Failed to create chat', msg || 'Request failed.');
        return;
      } finally {
        setCreatingThread(false);
      }
    }

    const uploaded = attachments.filter((a) => a.status === 'uploaded' && !!String(a.url ?? '').trim());
    const attIn = uploaded.map((a) => ({
      name: a.file.name,
      mime_type: a.file.type,
      url: String(a.url ?? '').trim(),
    }));

    assistantText = '';
    setRunning(true);

    const userText = String(content ?? '').trim();

    const ac = new AbortController();
    abortCtrl = ac;

    try {
      const body = JSON.stringify({
        thread_id: tid,
        model,
        input: { text: userText, attachments: attIn },
        options: { max_steps: 10 },
      });

      const resp = await fetch('/_redeven_proxy/api/ai/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ac.signal,
        credentials: 'omit',
        cache: 'no-store',
      });

      if (!resp.ok) {
        const raw = await resp.text();
        let msg = raw;
        try {
          const data = raw ? JSON.parse(raw) : null;
          msg = String(data?.error ?? data?.message ?? raw);
        } catch {
          // ignore
        }
        throw new Error(msg || `HTTP ${resp.status}`);
      }

      const rid = String(resp.headers.get('X-Redeven-AI-Run-ID') ?? '').trim();
      if (rid) setRunId(rid);

      // Thread metadata (title/preview) is updated server-side on each persisted message.
      bumpThreadsSeq();

      const stream = resp.body;
      if (!stream) throw new Error('Missing response body');

      const reader = stream.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        for (;;) {
          const idx = buffer.indexOf('\n');
          if (idx < 0) break;
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            handleStreamEvent(JSON.parse(line) as StreamEvent);
          } catch {
            // ignore invalid frames
          }
        }
      }

      // If the stream ended without a terminal event, mark the current message as errored to avoid a stuck UI.
      if (running()) {
        const streamingMessageId = chat.streamingMessageId?.() ?? null;
        if (streamingMessageId) {
          handleStreamEvent({ type: 'error', messageId: streamingMessageId, error: 'AI connection closed.' } as any);
        } else {
          notify.error('AI failed', 'AI connection closed.');
          setRunning(false);
          setRunId(null);
          abortCtrl = null;
        }
      }
    } catch (e) {
      // Abort is a normal control flow when the user clicks "Stop".
      if (e && typeof e === 'object' && (e as any).name === 'AbortError') {
        setRunning(false);
        setRunId(null);
        abortCtrl = null;
        assistantText = '';
        return;
      }

      const msg = e instanceof Error ? e.message : String(e);
      notify.error('AI failed', msg || 'Request failed.');
      setRunning(false);
      setRunId(null);
      abortCtrl = null;
      assistantText = '';
    }
  };

  const callbacks: ChatCallbacks = {
    onSendMessage: async (content, attachments, _addMessage) => {
      if (protocol.status() !== 'connected') {
        notify.error('Not connected', 'Connecting to agent...');
        return;
      }
      await startRun(content, attachments);
    },
    onUploadAttachment: uploadAttachment,
    onToolApproval: sendToolApproval,
  };

  onCleanup(() => {
    abortCtrl?.abort();
    abortCtrl = null;
  });

  const createNewChat = async () => {
    if (protocol.status() !== 'connected') {
      notify.error('Not connected', 'Connecting to agent...');
      return;
    }
    if (!aiEnabled()) {
      notify.error('AI not configured', 'Open Settings to enable AI.');
      return;
    }
    if (running()) {
      await cancel({ skipReload: true });
    }

    setCreatingThread(true);
    try {
      const th = await createThread();
      bumpThreadsSeq();
      setActiveThreadId(th.thread_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to create chat', msg || 'Request failed.');
    } finally {
      setCreatingThread(false);
    }
  };

  const selectThread = async (threadId: string) => {
    const next = String(threadId ?? '').trim();
    if (!next || next === activeThreadId()) return;
    if (running()) {
      await cancel({ skipReload: true });
    }
    setActiveThreadId(next);
  };

  const openRename = () => {
    const t = activeThread();
    setRenameTitle(String(t?.title ?? ''));
    setRenameOpen(true);
  };

  const doRename = async () => {
    const tid = activeThreadId();
    if (!tid) return;

    setRenaming(true);
    try {
      await fetchGatewayJSON<{ thread: ThreadView }>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: renameTitle().trim() }),
      });
      bumpThreadsSeq();
      setRenameOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to rename chat', msg || 'Request failed.');
    } finally {
      setRenaming(false);
    }
  };

  const doDelete = async () => {
    const tid = activeThreadId();
    if (!tid) return;

    setDeleting(true);
    try {
      await fetchGatewayJSON<void>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, { method: 'DELETE' });
      setDeleteOpen(false);
      setActiveThreadId(null);
      chat?.clearMessages();
      bumpThreadsSeq();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to delete chat', msg || 'Request failed.');
    } finally {
      setDeleting(false);
    }
  };

  const modelOptions = createMemo(() => {
    const m = models();
    if (!m) return [];
    return m.models.map((it) => ({
      value: it.id,
      label: it.label ?? it.id,
    }));
  });

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <ChatProvider
        config={{
          placeholder: 'Describe what you want to do...',
          allowAttachments: true,
          maxAttachments: 5,
          maxAttachmentSize: 10 * 1024 * 1024,
        }}
        callbacks={callbacks}
      >
        <ChatCapture
          onReady={(ctx) => {
            chat = ctx;
            setChatReady(true);
          }}
        />

        <Show when={aiEnabled() || settings.loading}>
          <div class="flex h-full min-h-0 overflow-hidden">
            {/* Thread sidebar */}
            <Show when={aiEnabled()}>
              <div class="w-[280px] shrink-0 border-r border-border bg-muted/10 flex flex-col min-h-0">
                <div class="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
                  <div class="text-xs font-medium text-muted-foreground">Chats</div>
                  <Button
                    size="sm"
                    variant="default"
                    icon={Plus}
                    onClick={() => void createNewChat()}
                    disabled={creatingThread() || protocol.status() !== 'connected'}
                    class="h-7"
                  >
                    <Show when={creatingThread()}>
                      <InlineButtonSnakeLoading />
                    </Show>
                    <span class={cn(creatingThread() && 'ml-1')}>New chat</span>
                  </Button>
                </div>

                <div class="flex-1 min-h-0 overflow-auto">
                  <Show when={!threads.loading} fallback={<div class="p-3 text-xs text-muted-foreground">Loading chats...</div>}>
                    <Show
                      when={!threads.error}
                      fallback={
                        <div class="p-3 text-xs text-error">
                          {threads.error instanceof Error ? threads.error.message : String(threads.error)}
                        </div>
                      }
                    >
                      <Show when={(threads()?.threads?.length ?? 0) > 0} fallback={<div class="p-3 text-xs text-muted-foreground">No chats yet</div>}>
                        <For each={threads()?.threads ?? []}>
                          {(t) => (
                            <button
                              type="button"
                              class={cn(
                                'w-full text-left px-3 py-2 border-b border-border/50 hover:bg-muted/40',
                                t.thread_id === activeThreadId() && 'bg-muted/40',
                              )}
                              onClick={() => void selectThread(t.thread_id)}
                            >
                              <div class="flex items-center justify-between gap-2">
                                <div class="text-xs font-medium truncate">{t.title?.trim() || 'New chat'}</div>
                                <div class="text-[10px] text-muted-foreground shrink-0">{fmtRelativeTime(t.updated_at_unix_ms)}</div>
                              </div>
                              <Show when={!!t.last_message_preview?.trim()}>
                                <div class="mt-0.5 text-[11px] text-muted-foreground truncate">{t.last_message_preview}</div>
                              </Show>
                            </button>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </Show>
                </div>
              </div>
            </Show>

            {/* Chat */}
            <div class="flex-1 min-w-0">
              <div class="chat-container h-full">
                {/* Header */}
                <div class="chat-header">
                  <div class="chat-header-title flex items-center gap-2 min-w-0">
                    <Sparkles class="w-4 h-4 text-primary shrink-0" />
                    <span class="truncate">{activeThreadTitle()}</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    {/* Model selector */}
                    <Show when={aiEnabled() && modelOptions().length > 0}>
                      <Select
                        value={selectedModel()}
                        onChange={setSelectedModel}
                        options={modelOptions()}
                        placeholder="Select model..."
                        disabled={models.loading || !!models.error || running()}
                        class="min-w-[140px] max-w-[220px] h-7 text-[11px]"
                      />
                    </Show>

                    {/* Stop button */}
                    <Show when={running()}>
                      <Tooltip content="Stop generation" placement="bottom" delay={0}>
                        <Button
                          size="sm"
                          variant="outline"
                          icon={Stop}
                          onClick={() => void cancel()}
                          class="h-7 px-2 text-error border-error/30 hover:bg-error/10 hover:text-error"
                        >
                          Stop
                        </Button>
                      </Tooltip>
                    </Show>

                    {/* Rename */}
                    <Tooltip content="Rename chat" placement="bottom" delay={0}>
                      <Button
                        size="icon"
                        variant="ghost"
                        icon={Pencil}
                        onClick={() => openRename()}
                        aria-label="Rename"
                        disabled={!activeThreadId() || running()}
                        class="w-7 h-7"
                      />
                    </Tooltip>

                    {/* Delete */}
                    <Tooltip content="Delete chat" placement="bottom" delay={0}>
                      <Button
                        size="icon"
                        variant="ghost"
                        icon={Trash}
                        onClick={() => setDeleteOpen(true)}
                        aria-label="Delete"
                        disabled={!activeThreadId() || running()}
                        class="w-7 h-7 text-error hover:bg-error/10 hover:text-error"
                      />
                    </Tooltip>

                    {/* Settings button */}
                    <Tooltip content="AI Settings" placement="bottom" delay={0}>
                      <Button
                        size="icon"
                        variant="ghost"
                        icon={Settings}
                        onClick={() => env.openSettings('ai')}
                        aria-label="Settings"
                        class="w-7 h-7"
                      />
                    </Tooltip>
                  </div>
                </div>

                {/* Error banner: Settings unavailable */}
                <Show when={settings.error}>
                  <div class="px-4 py-3 text-xs border-b border-border bg-error/5">
                    <div class="flex items-center gap-2 font-medium text-error">
                      <span class="w-1.5 h-1.5 rounded-full bg-error" />
                      Settings are not available
                    </div>
                    <div class="mt-1 text-muted-foreground">
                      {settings.error instanceof Error ? settings.error.message : String(settings.error)}
                    </div>
                  </div>
                </Show>

                {/* Error banner: Models unavailable */}
                <Show when={models.error && aiEnabled()}>
                  <div class="px-4 py-3 text-xs border-b border-border bg-error/5">
                    <div class="flex items-center gap-2 font-medium text-error">
                      <span class="w-1.5 h-1.5 rounded-full bg-error" />
                      AI is not available
                    </div>
                    <div class="mt-1 text-muted-foreground">
                      {models.error instanceof Error ? models.error.message : String(models.error)}
                    </div>
                  </div>
                </Show>

                {/* Message list */}
                <VirtualMessageList class="chat-container-messages" />

                {/* Input area */}
                <ChatInput
                  class="chat-container-input"
                  disabled={!canInteract()}
                  placeholder={aiEnabled() ? 'Type a message...' : 'Configure AI in settings to start...'}
                />
              </div>
            </div>
          </div>
        </Show>

        {/* Empty state: AI not configured */}
        <Show when={settings() && !aiEnabled() && !settings.error && !settings.loading}>
          <div class="flex flex-col items-center justify-center flex-1 p-8 text-center">
            <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Sparkles class="w-8 h-8 text-primary" />
            </div>
            <div class="text-base font-semibold text-foreground mb-2">AI is not configured</div>
            <div class="text-xs text-muted-foreground mb-4 max-w-[280px]">
              Configure an AI provider in settings to start using the AI assistant.
            </div>
            <Button size="sm" variant="default" onClick={() => env.openSettings('ai')}>
              Open Settings
            </Button>
          </div>
        </Show>

        {/* Rename dialog */}
        <Dialog
          open={renameOpen()}
          onOpenChange={(open) => {
            if (!open) {
              setRenameOpen(false);
              setRenameTitle('');
              return;
            }
            setRenameOpen(true);
          }}
          title="Rename Chat"
          footer={
            <div class="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setRenameOpen(false)} disabled={renaming()}>
                Cancel
              </Button>
              <Button size="sm" variant="default" onClick={() => void doRename()} disabled={renaming()}>
                <Show when={renaming()}>
                  <span class="mr-1">
                    <InlineButtonSnakeLoading />
                  </span>
                </Show>
                Save
              </Button>
            </div>
          }
        >
          <div class="space-y-3">
            <div>
              <label class="block text-xs font-medium mb-1">Title</label>
              <Input
                value={renameTitle()}
                onInput={(e) => setRenameTitle(e.currentTarget.value)}
                placeholder="New chat"
                size="sm"
                class="w-full"
              />
              <p class="text-[11px] text-muted-foreground mt-1">This title is visible to everyone in this environment.</p>
            </div>
          </div>
        </Dialog>

        {/* Delete confirmation dialog */}
        <ConfirmDialog
          open={deleteOpen()}
          onOpenChange={setDeleteOpen}
          title="Delete Chat"
          confirmText="Delete"
          variant="destructive"
          loading={deleting()}
          onConfirm={() => void doDelete()}
        >
          <div class="space-y-2">
            <p class="text-sm">
              Delete <span class="font-semibold">"{activeThreadTitle()}"</span>?
            </p>
            <p class="text-xs text-muted-foreground">This cannot be undone.</p>
          </div>
        </ConfirmDialog>
      </ChatProvider>

      <LoadingOverlay visible={protocol.status() !== 'connected'} message="Connecting to agent..." />
      <LoadingOverlay visible={settings.loading && protocol.status() === 'connected'} message="Loading settings..." />
      <LoadingOverlay visible={models.loading && aiEnabled()} message="Loading models..." />
      <LoadingOverlay visible={threads.loading && aiEnabled()} message="Loading chats..." />
      <LoadingOverlay visible={messagesLoading() && aiEnabled()} message="Loading chat..." />
    </div>
  );
}
