import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack, type Component } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import {
  Code,
  FileText,
  Pencil,
  Settings,
  Sparkles,
  Stop,
  Terminal,
  Trash,
  Zap,
} from '@floegence/floe-webapp-core/icons';
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
import { useAIChatContext, type ListThreadMessagesResponse } from './AIChatContext';
import { fetchGatewayJSON } from '../services/gatewayApi';

const RUN_IDLE_TIMEOUT_MS = 120_000;
const RUN_MAX_WALL_TIME_MS = 15 * 60_000;
const RUN_WATCHDOG_TICK_MS = 2_000;
const STOP_FALLBACK_MS = 2_000;

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

// Suggestion item for empty chat state
interface SuggestionItem {
  icon: Component<{ class?: string }>;
  title: string;
  description: string;
  prompt: string;
}

const SUGGESTIONS: SuggestionItem[] = [
  {
    icon: Code,
    title: 'Explain code',
    description: 'Understand how a piece of code works',
    prompt: 'Can you explain this code to me?',
  },
  {
    icon: Terminal,
    title: 'Run commands',
    description: 'Execute shell commands and scripts',
    prompt: 'Help me run a command to check disk usage',
  },
  {
    icon: FileText,
    title: 'Analyze files',
    description: 'Read and understand file contents',
    prompt: 'Can you help me analyze my project files?',
  },
  {
    icon: Zap,
    title: 'Automate tasks',
    description: 'Create scripts and workflows',
    prompt: 'Help me automate a repetitive task',
  },
];

// Empty chat state component with welcome message and suggestions
interface EmptyChatProps {
  onSuggestionClick: (prompt: string) => void;
  disabled?: boolean;
}

const EmptyChat: Component<EmptyChatProps> = (props) => {
  return (
    <div class="flex-1 flex flex-col items-center justify-center p-8 overflow-auto">
      {/* Welcome section */}
      <div class="text-center mb-8 max-w-lg">
        {/* Animated sparkles icon */}
        <div class="relative inline-flex items-center justify-center mb-6">
          <div class="absolute inset-0 rounded-full bg-primary/20 animate-[pulse_3s_ease-in-out_infinite]" />
          <div class="relative w-20 h-20 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center border border-primary/20">
            <Sparkles class="w-10 h-10 text-primary" />
          </div>
        </div>

        <h2 class="text-xl font-semibold text-foreground mb-3">
          Hello! How can I help you today?
        </h2>
        <p class="text-sm text-muted-foreground leading-relaxed">
          I'm your AI assistant. I can help you with code, files, commands, and more.
          Just type a message below or choose from the suggestions.
        </p>
      </div>

      {/* Suggestions grid */}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        <For each={SUGGESTIONS}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onSuggestionClick(item.prompt)}
              disabled={props.disabled}
              class={cn(
                'group flex items-start gap-3 p-4 rounded-xl border border-border/50',
                'bg-card/50 hover:bg-card hover:border-primary/30 hover:shadow-sm',
                'text-left transition-all duration-200',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-card/50 disabled:hover:border-border/50',
              )}
            >
              <div class="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <item.icon class="w-5 h-5 text-primary" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-foreground mb-0.5">
                  {item.title}
                </div>
                <div class="text-xs text-muted-foreground leading-relaxed">
                  {item.description}
                </div>
              </div>
            </button>
          )}
        </For>
      </div>

      {/* Keyboard hint */}
      <div class="mt-8 text-xs text-muted-foreground/70 flex items-center gap-2">
        <span class="px-1.5 py-0.5 rounded bg-muted/50 font-mono text-[10px]">Enter</span>
        <span>to send a message</span>
      </div>
    </div>
  );
};

// Message list with empty state overlay
interface MessageListWithEmptyStateProps {
  hasMessages: boolean;
  onSuggestionClick: (prompt: string) => void;
  disabled?: boolean;
  class?: string;
}

const MessageListWithEmptyState: Component<MessageListWithEmptyStateProps> = (props) => {
  return (
    <div class={cn('relative flex-1 min-h-0', props.class)}>
      <Show when={props.hasMessages}>
        <VirtualMessageList class="h-full" />
      </Show>
      <Show when={!props.hasMessages}>
        <EmptyChat
          onSuggestionClick={props.onSuggestionClick}
          disabled={props.disabled}
        />
      </Show>
    </div>
  );
};

/**
 * AI chat page — renders only the chat area (header + messages + input).
 * The thread sidebar is managed by Shell's native sidebar via AIChatSidebar.
 */
export function EnvAIPage() {
  const env = useEnvContext();
  const protocol = useProtocol();
  const notify = useNotification();
  const ai = useAIChatContext();

  const [renameOpen, setRenameOpen] = createSignal(false);
  const [renameTitle, setRenameTitle] = createSignal('');
  const [renaming, setRenaming] = createSignal(false);

  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteForce, setDeleteForce] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  const [messagesLoading, setMessagesLoading] = createSignal(false);
  const [hasMessages, setHasMessages] = createSignal(false);

  const [runId, setRunId] = createSignal<string | null>(null);

  let chat: ChatContextValue | null = null;
  const [chatReady, setChatReady] = createSignal(false);

  let abortCtrl: AbortController | null = null;
  let assistantText = '';
  let lastMessagesReq = 0;
  let skipNextThreadLoad = false;
  let runThreadId: string | null = null;
  let runStartedAtMs = 0;
  let lastStreamAtMs = 0;
  let watchdogToken = 0;
  let watchdogTimer: number | null = null;
  let stopFallbackTimer: number | null = null;

  const canInteract = createMemo(
    () => protocol.status() === 'connected' && !ai.running() && ai.aiEnabled() && ai.modelsReady(),
  );

  const stopWatchdog = () => {
    watchdogToken++;
    if (watchdogTimer != null) {
      window.clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    if (stopFallbackTimer != null) {
      window.clearTimeout(stopFallbackTimer);
      stopFallbackTimer = null;
    }
  };

  const touchWatchdog = () => {
    lastStreamAtMs = Date.now();
  };

  const startWatchdog = () => {
    stopWatchdog();
    const token = ++watchdogToken;
    runStartedAtMs = Date.now();
    lastStreamAtMs = runStartedAtMs;

    const tick = () => {
      if (token !== watchdogToken) return;
      if (!untrack(ai.running)) return;

      const now = Date.now();
      if (now - runStartedAtMs > RUN_MAX_WALL_TIME_MS) {
        void forceEndRun('Timed out.', { cancelServer: true });
        return;
      }
      if (now - lastStreamAtMs > RUN_IDLE_TIMEOUT_MS) {
        void forceEndRun('Disconnected.', { cancelServer: true });
        return;
      }
      watchdogTimer = window.setTimeout(tick, RUN_WATCHDOG_TICK_MS);
    };

    watchdogTimer = window.setTimeout(tick, RUN_WATCHDOG_TICK_MS);
  };

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
      const messages = resp.messages || [];
      chat.setMessages(messages);
      setHasMessages(messages.length > 0);
    } catch (e) {
      if (reqNo !== lastMessagesReq) return;
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to load chat', msg || 'Request failed.');
      chat.clearMessages();
      setHasMessages(false);
    } finally {
      if (reqNo === lastMessagesReq) setMessagesLoading(false);
    }
  };

  const requestServerCancel = (rid: string | null, tid: string | null) => {
    const run = String(rid ?? '').trim();
    const thread = String(tid ?? '').trim();
    if (run) {
      void fetchGatewayJSON<void>(`/_redeven_proxy/api/ai/runs/${encodeURIComponent(run)}/cancel`, { method: 'POST' }).catch(() => {});
      return;
    }
    if (thread) {
      void fetchGatewayJSON<void>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(thread)}/cancel`, { method: 'POST' }).catch(() => {});
    }
  };

  const abortLocalRun = (opts?: { cancelServer?: boolean }) => {
    stopWatchdog();
    if (opts?.cancelServer) {
      requestServerCancel(runId(), runThreadId);
    }
    abortCtrl?.abort();
    abortCtrl = null;
    assistantText = '';
    runThreadId = null;
    ai.setRunning(false);
    setRunId(null);
  };

  const forceEndRun = async (notice: string, opts?: { cancelServer?: boolean }) => {
    stopWatchdog();
    if (opts?.cancelServer) {
      requestServerCancel(runId(), runThreadId || ai.activeThreadId());
    }
    abortCtrl?.abort();
    abortCtrl = null;

    const mid = chat?.streamingMessageId?.() ?? null;
    if (mid) {
      const prefix = assistantText.trim() ? '\n\n' : '';
      handleStreamEvent({ type: 'block-delta', messageId: mid, blockIndex: 0, delta: `${prefix}${notice}` } as any);
      handleStreamEvent({ type: 'message-end', messageId: mid } as any);
      return;
    }

    // Fallback when we don't have a streaming message id (e.g. request failed before message-start).
    chat?.addMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      blocks: [{ type: 'markdown', content: notice }],
      status: 'complete',
      timestamp: Date.now(),
    } as any);
    setHasMessages(true);
    assistantText = '';
    runThreadId = null;
    ai.setRunning(false);
    setRunId(null);
    ai.bumpThreadsSeq();
  };

  const stopRun = () => {
    requestServerCancel(runId(), runThreadId || ai.activeThreadId());
    if (stopFallbackTimer != null) window.clearTimeout(stopFallbackTimer);
    stopFallbackTimer = window.setTimeout(() => {
      if (!untrack(ai.running)) return;
      void forceEndRun('Canceled.', { cancelServer: false });
    }, STOP_FALLBACK_MS);
  };

  // Load messages when the active thread changes (or on initial selection).
  // If a run is in progress, cancel it first before switching.
  createEffect(() => {
    if (!chatReady()) return;

    if (protocol.status() !== 'connected' || !ai.aiEnabled()) {
      chat?.clearMessages();
      setHasMessages(false);
      return;
    }

    const tid = ai.activeThreadId();

    // Draft -> thread promotion: keep the optimistic user message rendered by ChatProvider.
    if (skipNextThreadLoad && tid) {
      skipNextThreadLoad = false;
      return;
    }

    // Cancel running state without re-tracking `running` signal
    if (untrack(ai.running)) {
      abortLocalRun({ cancelServer: true });
    }

    assistantText = '';
    chat?.clearMessages();
    setHasMessages(false);
    if (!tid) return;
    void loadThreadMessages(tid);
  });

  // FileBrowser -> AI context injection (persist into the active thread).
  let lastInjectionSeq = 0;
  createEffect(() => {
    if (!chatReady()) return;
    if (protocol.status() !== 'connected' || !ai.aiEnabled()) return;

    const seq = env.aiInjectionSeq();
    if (!seq || seq === lastInjectionSeq) return;
    lastInjectionSeq = seq;

    const md = env.aiInjectionMarkdown();
    if (!md || !md.trim()) return;

    void (async () => {
      let tid = ai.activeThreadId();
      if (!tid) {
        tid = await ai.ensureThreadForSend();
      }
      if (!tid) return;

      chat?.addMessage(createUserMarkdownMessage(md));
      setHasMessages(true);

      try {
        await fetchGatewayJSON<void>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/messages`, {
          method: 'POST',
          body: JSON.stringify({ role: 'user', text: md, format: 'markdown' }),
        });
        ai.bumpThreadsSeq();
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

  const handleStreamEvent = (ev: StreamEvent) => {
    touchWatchdog();
    chat?.handleStreamEvent(ev);

    if (ev.type === 'block-delta' && typeof (ev as any).delta === 'string') {
      assistantText += String((ev as any).delta);
      return;
    }
    if (ev.type === 'message-end') {
      stopWatchdog();
      assistantText = '';
      runThreadId = null;
      ai.setRunning(false);
      setRunId(null);
      abortCtrl = null;
      ai.bumpThreadsSeq();
      setHasMessages(true);
      return;
    }
    if (ev.type === 'error') {
      stopWatchdog();
      const msg = String((ev as any).error ?? 'AI error');
      notify.error('AI failed', msg);
      assistantText = '';
      runThreadId = null;
      ai.setRunning(false);
      setRunId(null);
      abortCtrl = null;
      ai.bumpThreadsSeq();
      return;
    }
  };

  const startRun = async (content: string, attachments: Attachment[]) => {
    if (!chat) {
      notify.error('AI unavailable', 'Chat is not ready.');
      return;
    }
    if (ai.running()) {
      notify.info('AI is busy', 'Please wait for the current run to finish.');
      return;
    }
    if (!ai.aiEnabled()) {
      notify.error('AI not configured', 'Open Settings to enable AI.');
      return;
    }
    if (ai.models.error) {
      const msg = ai.models.error instanceof Error ? ai.models.error.message : String(ai.models.error);
      notify.error('AI unavailable', msg || 'Failed to load models.');
      return;
    }
    const model = ai.selectedModel().trim();
    if (!model) {
      notify.error('Missing model', 'Please select a model.');
      return;
    }

    // ChatProvider already rendered the optimistic user message; ensure the message list is visible.
    setHasMessages(true);

    let tid = ai.activeThreadId();
    if (!tid) {
      skipNextThreadLoad = true;
      tid = await ai.ensureThreadForSend();
      skipNextThreadLoad = false;
    }
    if (!tid) return;

    const uploaded = attachments.filter((a) => a.status === 'uploaded' && !!String(a.url ?? '').trim());
    const attIn = uploaded.map((a) => ({
      name: a.file.name,
      mime_type: a.file.type,
      url: String(a.url ?? '').trim(),
    }));

    assistantText = '';
    runThreadId = tid;
    setRunId(null);
    ai.setRunning(true);
    startWatchdog();

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
      ai.bumpThreadsSeq();

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
      buffer += decoder.decode();
      if (buffer.trim()) {
        // Best-effort: handle a trailing frame without a newline.
        const tail = buffer.trim();
        buffer = '';
        try {
          handleStreamEvent(JSON.parse(tail) as StreamEvent);
        } catch {
          // ignore
        }
      }

      // If the stream ended without a terminal event, end locally to avoid a stuck UI.
      if (ai.running()) {
        await forceEndRun('Disconnected.', { cancelServer: true });
      }
    } catch (e) {
      // Abort is a normal control flow when the user clicks "Stop".
      if (e && typeof e === 'object' && (e as any).name === 'AbortError') {
        stopWatchdog();
        ai.setRunning(false);
        setRunId(null);
        abortCtrl = null;
        assistantText = '';
        runThreadId = null;
        return;
      }

      const msg = e instanceof Error ? e.message : String(e);
      notify.error('AI failed', msg || 'Request failed.');
      stopWatchdog();
      ai.setRunning(false);
      setRunId(null);
      abortCtrl = null;
      assistantText = '';
      runThreadId = null;
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

  const openRename = () => {
    const t = ai.activeThread();
    setRenameTitle(String(t?.title ?? ''));
    setRenameOpen(true);
  };

  const doRename = async () => {
    const tid = ai.activeThreadId();
    if (!tid) return;

    setRenaming(true);
    try {
      await fetchGatewayJSON<{ thread: any }>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: renameTitle().trim() }),
      });
      ai.bumpThreadsSeq();
      setRenameOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to rename chat', msg || 'Request failed.');
    } finally {
      setRenaming(false);
    }
  };

  const doDelete = async () => {
    const tid = ai.activeThreadId();
    if (!tid) return;
    const force = deleteForce();

    setDeleting(true);
    try {
      if (force && untrack(ai.running)) {
        // We'll delete the thread anyway; stop the local stream immediately.
        abortLocalRun({ cancelServer: false });
      }

      const url = `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}${force ? '?force=true' : ''}`;
      const resp = await fetch(url, { method: 'DELETE', credentials: 'omit', cache: 'no-store' });
      const text = await resp.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // ignore
      }
      if (!resp.ok) {
        if (resp.status === 409 && !force) {
          setDeleteForce(true);
          return;
        }
        throw new Error(String(data?.error ?? `HTTP ${resp.status}`));
      }
      if (data?.ok === false) throw new Error(String(data?.error ?? 'Request failed'));

      setDeleteOpen(false);
      setDeleteForce(false);
      ai.clearActiveThreadPersistence();
      ai.enterDraftChat();
      chat?.clearMessages();
      setHasMessages(false);
      ai.bumpThreadsSeq();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to delete chat', msg || 'Request failed.');
    } finally {
      setDeleting(false);
    }
  };

  // Handle suggestion click from empty state
  const handleSuggestionClick = (prompt: string) => {
    if (!canInteract()) return;
    void startRun(prompt, []);
  };

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

        <Show when={ai.aiEnabled() || ai.settings.loading}>
          {/* Chat area — sidebar is managed by Shell */}
          <div class="flex-1 min-w-0 flex flex-col h-full">
            {/* Header */}
            <div class="chat-header border-b border-border bg-background/95 backdrop-blur-sm">
              <div class="chat-header-title flex items-center gap-2 min-w-0">
                <Sparkles class="w-4 h-4 text-primary shrink-0" />
                <span class="truncate font-medium">{ai.activeThreadTitle()}</span>
              </div>
              <div class="flex items-center gap-1.5">
                {/* Model selector */}
                <Show when={ai.aiEnabled() && ai.modelOptions().length > 0}>
                  <Select
                    value={ai.selectedModel()}
                    onChange={ai.setSelectedModel}
                    options={ai.modelOptions()}
                    placeholder="Select model..."
                    disabled={ai.models.loading || !!ai.models.error || ai.running()}
                    class="min-w-[140px] max-w-[200px] h-7 text-[11px]"
                  />
                </Show>

                {/* Stop button */}
                <Show when={ai.running()}>
                  <Tooltip content="Stop generation" placement="bottom" delay={0}>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={Stop}
                      onClick={() => stopRun()}
                      class="h-7 px-2 text-error border-error/30 hover:bg-error/10 hover:text-error"
                    >
                      Stop
                    </Button>
                  </Tooltip>
                </Show>

                <div class="w-px h-5 bg-border mx-1" />

                {/* Rename */}
                <Tooltip content="Rename chat" placement="bottom" delay={0}>
                  <Button
                    size="icon"
                    variant="ghost"
                    icon={Pencil}
                    onClick={() => openRename()}
                    aria-label="Rename"
                    disabled={!ai.activeThreadId() || ai.running()}
                    class="w-7 h-7"
                  />
                </Tooltip>

                {/* Delete */}
                <Tooltip content="Delete chat" placement="bottom" delay={0}>
                  <Button
                    size="icon"
                    variant="ghost"
                    icon={Trash}
                    onClick={() => {
                      setDeleteForce(untrack(ai.running));
                      setDeleteOpen(true);
                    }}
                    aria-label="Delete"
                    disabled={!ai.activeThreadId()}
                    class="w-7 h-7 text-muted-foreground hover:text-error hover:bg-error/10"
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
            <Show when={ai.settings.error}>
              <div class="px-4 py-3 text-xs border-b border-border bg-error/5">
                <div class="flex items-center gap-2 font-medium text-error">
                  <span class="w-1.5 h-1.5 rounded-full bg-error" />
                  Settings are not available
                </div>
                <div class="mt-1 text-muted-foreground">
                  {ai.settings.error instanceof Error ? ai.settings.error.message : String(ai.settings.error)}
                </div>
              </div>
            </Show>

            {/* Error banner: Models unavailable */}
            <Show when={ai.models.error && ai.aiEnabled()}>
              <div class="px-4 py-3 text-xs border-b border-border bg-error/5">
                <div class="flex items-center gap-2 font-medium text-error">
                  <span class="w-1.5 h-1.5 rounded-full bg-error" />
                  AI is not available
                </div>
                <div class="mt-1 text-muted-foreground">
                  {ai.models.error instanceof Error ? ai.models.error.message : String(ai.models.error)}
                </div>
              </div>
            </Show>

            {/* Message list with empty state */}
            <MessageListWithEmptyState
              hasMessages={hasMessages()}
              onSuggestionClick={handleSuggestionClick}
              disabled={!canInteract()}
              class="flex-1 min-h-0"
            />

            {/* Input area */}
            <ChatInput
              class="chat-container-input border-t border-border"
              disabled={!canInteract()}
              placeholder={ai.aiEnabled() ? 'Type a message...' : 'Configure AI in settings to start...'}
            />
          </div>
        </Show>

        {/* Empty state: AI not configured */}
        <Show when={ai.settings() && !ai.aiEnabled() && !ai.settings.error && !ai.settings.loading}>
          <div class="flex flex-col items-center justify-center h-full p-8 text-center">
            <div class="relative inline-flex items-center justify-center mb-6">
              <div class="absolute inset-0 rounded-full bg-primary/20 animate-[pulse_3s_ease-in-out_infinite]" />
              <div class="relative w-20 h-20 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center border border-primary/20">
                <Sparkles class="w-10 h-10 text-primary" />
              </div>
            </div>
            <div class="text-lg font-semibold text-foreground mb-2">AI is not configured</div>
            <div class="text-sm text-muted-foreground mb-6 max-w-[320px]">
              Configure an AI provider in settings to start using the AI assistant.
            </div>
            <Button size="md" variant="default" onClick={() => env.openSettings('ai')}>
              <Settings class="w-4 h-4 mr-2" />
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
              <label class="block text-xs font-medium mb-1.5">Title</label>
              <Input
                value={renameTitle()}
                onInput={(e) => setRenameTitle(e.currentTarget.value)}
                placeholder="New chat"
                size="sm"
                class="w-full"
              />
              <p class="text-[11px] text-muted-foreground mt-1.5">
                This title is visible to everyone in this environment.
              </p>
            </div>
          </div>
        </Dialog>

        {/* Delete confirmation dialog */}
        <ConfirmDialog
          open={deleteOpen()}
          onOpenChange={(open) => {
            setDeleteOpen(open);
            if (!open) setDeleteForce(false);
          }}
          title="Delete Chat"
          confirmText={deleteForce() ? 'Force Delete' : 'Delete'}
          variant="destructive"
          loading={deleting()}
          onConfirm={() => void doDelete()}
        >
          <div class="space-y-2">
            <p class="text-sm">
              Delete <span class="font-semibold">"{ai.activeThreadTitle()}"</span>?
            </p>
            <Show when={deleteForce()}>
              <p class="text-xs text-muted-foreground">
                This chat is running. Deleting will stop the run and delete the thread.
              </p>
            </Show>
            <p class="text-xs text-muted-foreground">This cannot be undone.</p>
          </div>
        </ConfirmDialog>
      </ChatProvider>

      <LoadingOverlay visible={protocol.status() !== 'connected'} message="Connecting to agent..." />
      <LoadingOverlay visible={ai.settings.loading && protocol.status() === 'connected'} message="Loading settings..." />
      <LoadingOverlay visible={ai.models.loading && ai.aiEnabled()} message="Loading models..." />
      <LoadingOverlay visible={ai.threads.loading && ai.aiEnabled()} message="Loading chats..." />
      <LoadingOverlay visible={messagesLoading() && ai.aiEnabled()} message="Loading chat..." />
    </div>
  );
}
