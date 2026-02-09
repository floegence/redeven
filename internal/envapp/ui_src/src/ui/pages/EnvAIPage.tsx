import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { Motion } from 'solid-motionone';
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
} from '@floegence/floe-webapp-core/chat';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useEnvContext } from './EnvContext';
import { useAIChatContext, type ListThreadMessagesResponse } from './AIChatContext';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { fetchGatewayJSON } from '../services/gatewayApi';

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

// Custom working indicator — neural animation + minimal waveform bars
function ChatWorkingIndicator() {
  const uid = `neural-${Math.random().toString(36).slice(2, 8)}`;

  // Inject SVG via innerHTML to avoid TypeScript SMIL typing friction (animateMotion).
  const svgContent = `
    <defs>
      <filter id="${uid}">
        <feGaussianBlur stdDeviation="1" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <g stroke="var(--primary)" stroke-width="0.8" fill="none">
      <line x1="20" y1="8" x2="20" y2="20" class="processing-neural-line"/>
      <line x1="8" y1="20" x2="20" y2="20" class="processing-neural-line" style="animation-delay:150ms"/>
      <line x1="32" y1="20" x2="20" y2="20" class="processing-neural-line" style="animation-delay:300ms"/>
      <line x1="14" y1="32" x2="20" y2="20" class="processing-neural-line" style="animation-delay:450ms"/>
      <line x1="26" y1="32" x2="20" y2="20" class="processing-neural-line" style="animation-delay:600ms"/>
      <line x1="20" y1="8" x2="8" y2="20" class="processing-neural-line" style="animation-delay:200ms"/>
      <line x1="20" y1="8" x2="32" y2="20" class="processing-neural-line" style="animation-delay:350ms"/>
      <line x1="8" y1="20" x2="14" y2="32" class="processing-neural-line" style="animation-delay:500ms"/>
      <line x1="32" y1="20" x2="26" y2="32" class="processing-neural-line" style="animation-delay:250ms"/>
      <line x1="14" y1="32" x2="26" y2="32" class="processing-neural-line" style="animation-delay:400ms"/>
    </g>
    <g>
      <circle r="1.2" fill="var(--primary)" opacity="0.8"><animateMotion dur="1.5s" repeatCount="indefinite" path="M20,8 L20,20"/></circle>
      <circle r="1.2" fill="var(--primary)" opacity="0.8"><animateMotion dur="1.5s" repeatCount="indefinite" begin="0.3s" path="M8,20 L20,20"/></circle>
      <circle r="1.2" fill="var(--primary)" opacity="0.8"><animateMotion dur="1.5s" repeatCount="indefinite" begin="0.6s" path="M32,20 L20,20"/></circle>
      <circle r="1.2" fill="var(--primary)" opacity="0.8"><animateMotion dur="1.5s" repeatCount="indefinite" begin="0.9s" path="M14,32 L20,20"/></circle>
      <circle r="1.2" fill="var(--primary)" opacity="0.8"><animateMotion dur="1.5s" repeatCount="indefinite" begin="1.2s" path="M26,32 L20,20"/></circle>
    </g>
    <g filter="url(#${uid})">
      <circle cx="20" cy="8" r="2" fill="var(--primary)" class="processing-neural-node"/>
      <circle cx="8" cy="20" r="2" fill="var(--primary)" class="processing-neural-node" style="animation-delay:200ms"/>
      <circle cx="32" cy="20" r="2" fill="var(--primary)" class="processing-neural-node" style="animation-delay:400ms"/>
      <circle cx="14" cy="32" r="2" fill="var(--primary)" class="processing-neural-node" style="animation-delay:600ms"/>
      <circle cx="26" cy="32" r="2" fill="var(--primary)" class="processing-neural-node" style="animation-delay:800ms"/>
      <circle cx="20" cy="20" r="2.5" fill="var(--primary)" class="processing-neural-node" style="animation-delay:100ms"/>
    </g>`;

  return (
    <div class="px-4 py-1.5 shrink-0">
      <div class="inline-flex items-center gap-2.5 px-3 py-2 rounded-xl bg-primary/[0.04] border border-primary/10">
        {/* Neural SVG animation */}
        <svg class="w-7 h-7 shrink-0" viewBox="0 0 40 40" fill="none" innerHTML={svgContent} />

        {/* Status text (shimmer) */}
        <span class="text-xs text-muted-foreground processing-text-shimmer">Working</span>

        {/* Waveform bars (minimal style) */}
        <div class="flex items-end gap-[2px] h-3.5">
          <div class="w-[3px] bg-primary/70 rounded-full processing-bar" style="animation-delay:0ms" />
          <div class="w-[3px] bg-primary/70 rounded-full processing-bar" style="animation-delay:100ms" />
          <div class="w-[3px] bg-primary/70 rounded-full processing-bar" style="animation-delay:200ms" />
          <div class="w-[3px] bg-primary/70 rounded-full processing-bar" style="animation-delay:300ms" />
        </div>
      </div>
    </div>
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
      <Motion.div
        class="text-center mb-8 max-w-lg"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, easing: 'ease-out' }}
      >
        {/* Animated sparkles icon */}
        <div class="relative inline-flex items-center justify-center mb-6">
          <div class="absolute -inset-2 rounded-2xl bg-primary/10 animate-[pulse_3s_ease-in-out_infinite]" />
          <div class="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 flex items-center justify-center border border-primary/20 shadow-sm">
            <Sparkles class="w-8 h-8 text-primary" />
          </div>
        </div>

        <h2 class="text-xl font-semibold text-foreground mb-3">
          Hello! How can I help you today?
        </h2>
        <p class="text-sm text-muted-foreground leading-relaxed">
          I'm your AI assistant. I can help you with code, files, commands, and more.
          Just type a message below or choose from the suggestions.
        </p>
      </Motion.div>

      {/* Suggestions grid */}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        <For each={SUGGESTIONS}>
          {(item, i) => (
            <Motion.button
              type="button"
              onClick={() => props.onSuggestionClick(item.prompt)}
              disabled={props.disabled}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 + i() * 0.08, easing: 'ease-out' }}
              class={cn(
                'group flex items-start gap-3 p-4 rounded-xl border border-border/50',
                'bg-card/50 hover:bg-card hover:border-primary/30 hover:shadow-md hover:shadow-primary/5',
                'text-left transition-all duration-200 active:scale-[0.98]',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-card/50 disabled:hover:border-border/50',
              )}
            >
              <div class="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-200">
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
            </Motion.button>
          )}
        </For>
      </div>

      {/* Keyboard hint */}
      <Motion.div
        class="mt-8 text-xs text-muted-foreground/60 flex items-center gap-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.6 }}
      >
        <span class="flex items-center gap-1.5">
          <kbd class="px-1.5 py-0.5 rounded bg-muted/50 font-mono text-[10px] border border-border/50">Enter</kbd>
          <span>send</span>
        </span>
        <span class="flex items-center gap-1.5">
          <kbd class="px-1.5 py-0.5 rounded bg-muted/50 font-mono text-[10px] border border-border/50">Shift+Enter</kbd>
          <span>newline</span>
        </span>
      </Motion.div>
    </div>
  );
};

// Message list with empty state overlay
interface MessageListWithEmptyStateProps {
  hasMessages: boolean;
  loading?: boolean;
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
      <Show when={!props.hasMessages && !props.loading}>
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
  const rpc = useRedevenRpc();
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
  // Turns true immediately after send to keep instant feedback before run state events arrive.
  const [sendPending, setSendPending] = createSignal(false);

  let chat: ChatContextValue | null = null;
  const [chatReady, setChatReady] = createSignal(false);

  const forceScrollToLatest = () => {
    const scrollBottom = () => {
      const el =
        document.querySelector<HTMLElement>('.chat-message-list-scroll') ??
        document.querySelector<HTMLElement>('.chat-message-list');
      if (!el) return false;
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      return true;
    };

    if (scrollBottom()) return;
    requestAnimationFrame(() => {
      if (scrollBottom()) return;
      requestAnimationFrame(() => {
        void scrollBottom();
      });
    });
  };

  let lastMessagesReq = 0;
  let skipNextThreadLoad = false;
  const replayAppliedByThread = new Map<string, number>();
  const failureNotifiedRuns = new Set<string>();

  const activeThreadRunning = createMemo(() => ai.isThreadRunning(ai.activeThreadId()));
  const canInteract = createMemo(
    () => protocol.status() === 'connected' && !activeThreadRunning() && ai.aiEnabled() && ai.modelsReady(),
  );

  const syncThreadReplay = (threadId: string, opts?: { reset?: boolean }) => {
    if (!chat) return;
    const tid = String(threadId ?? '').trim();
    if (!tid) return;

    if (opts?.reset) {
      replayAppliedByThread.set(tid, 0);
    }

    const events = ai.threadReplayEvents(tid);
    let applied = replayAppliedByThread.get(tid) ?? 0;
    if (applied < 0 || applied > events.length) {
      applied = 0;
    }

    for (let i = applied; i < events.length; i += 1) {
      chat.handleStreamEvent(events[i] as any);
    }
    replayAppliedByThread.set(tid, events.length);

    if (events.length > 0) {
      setHasMessages(true);
    }
  };

  const loadThreadMessages = async (threadId: string): Promise<void> => {
    if (!chat) return;
    const tid = String(threadId ?? '').trim();
    if (!tid) return;

    const reqNo = ++lastMessagesReq;
    setMessagesLoading(true);
    try {
      const resp = await fetchGatewayJSON<ListThreadMessagesResponse>(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/messages?limit=500`,
        { method: 'GET' },
      );
      if (reqNo !== lastMessagesReq) return;

      const messages = resp.messages || [];
      chat.setMessages(messages);
      setHasMessages(messages.length > 0);
      syncThreadReplay(tid, { reset: true });
    } catch (e) {
      if (reqNo !== lastMessagesReq) return;
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to load chat', msg || 'Request failed.');
      chat.clearMessages();
      setHasMessages(false);
      replayAppliedByThread.delete(tid);
    } finally {
      if (reqNo === lastMessagesReq) {
        setMessagesLoading(false);
      }
    }
  };

  const stopRun = () => {
    const tid = String(ai.activeThreadId() ?? '').trim();
    const rid = String(ai.runIdForThread(tid) ?? '').trim();
    if (!tid && !rid) return;

    void rpc.ai
      .cancelRun({ runId: rid || undefined, threadId: rid ? undefined : tid || undefined })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        notify.error('Failed to stop run', msg || 'Request failed.');
      });
  };

  // Load messages when the active thread changes (or on initial selection).
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

    if (!tid) {
      chat?.clearMessages();
      setHasMessages(false);
      return;
    }

    chat?.clearMessages();
    setHasMessages(false);
    replayAppliedByThread.delete(String(tid ?? '').trim());
    void loadThreadMessages(tid);
  });

  createEffect(() => {
    if (!chatReady()) return;

    const unsub = ai.onRealtimeEvent((event) => {
      const tid = String(event.threadId ?? '').trim();
      if (!tid) return;

      if (event.eventType === 'stream_event') {
        if (tid === String(ai.activeThreadId() ?? '').trim()) {
          syncThreadReplay(tid);
        }
        return;
      }

      const status = String(event.runStatus ?? '').trim().toLowerCase();
      if (status === 'running') {
        return;
      }

      replayAppliedByThread.delete(tid);
      if (tid === String(ai.activeThreadId() ?? '').trim()) {
        void loadThreadMessages(tid);
      }

      const runId = String(event.runId ?? '').trim();
      const runError = String(event.runError ?? '').trim();
      if (status === 'failed' && runError && runId && !failureNotifiedRuns.has(runId)) {
        failureNotifiedRuns.add(runId);
        notify.error('AI failed', runError);
      }
    });

    onCleanup(() => {
      unsub();
    });
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
    const tid = String(ai.activeThreadId() ?? '').trim();
    const rid = String(ai.runIdForThread(tid) ?? '').trim();
    if (!rid) return;
    await rpc.ai.approveTool({ runId: rid, toolId, approved });
  };

  const startRun = async (content: string, attachments: Attachment[]) => {
    if (!chat) {
      notify.error('AI unavailable', 'Chat is not ready.');
      setSendPending(false);
      return;
    }
    if (activeThreadRunning()) {
      notify.info('AI is busy', 'Please wait for the current run to finish.');
      setSendPending(false);
      return;
    }
    if (!ai.aiEnabled()) {
      notify.error('AI not configured', 'Open Settings to enable AI.');
      setSendPending(false);
      return;
    }
    if (ai.models.error) {
      const msg = ai.models.error instanceof Error ? ai.models.error.message : String(ai.models.error);
      notify.error('AI unavailable', msg || 'Failed to load models.');
      setSendPending(false);
      return;
    }

    const model = ai.selectedModel().trim();
    if (!model) {
      notify.error('Missing model', 'Please select a model.');
      setSendPending(false);
      return;
    }

    // ChatProvider already rendered the optimistic user message; ensure the message list is visible.
    // sendPending is usually raised by onWillSend, this call keeps attachment-only flows responsive.
    setHasMessages(true);
    setSendPending(true);
    forceScrollToLatest();

    let tid = ai.activeThreadId();
    if (!tid) {
      skipNextThreadLoad = true;
      tid = await ai.ensureThreadForSend();
      skipNextThreadLoad = false;
    }
    if (!tid) {
      setSendPending(false);
      return;
    }

    const userText = String(content ?? '').trim();
    const uploaded = attachments.filter((a) => a.status === 'uploaded' && !!String(a.url ?? '').trim());
    const attIn = uploaded.map((a) => ({
      name: a.file.name,
      mimeType: a.file.type,
      url: String(a.url ?? '').trim(),
    }));

    ai.clearThreadReplay(tid);
    ai.markThreadPendingRun(tid);
    replayAppliedByThread.delete(String(tid ?? '').trim());

    try {
      const resp = await rpc.ai.startRun({
        threadId: tid,
        model,
        input: {
          text: userText,
          attachments: attIn,
        },
        options: { maxSteps: 10 },
      });

      const rid = String(resp.runId ?? '').trim();
      if (rid) {
        ai.confirmThreadRun(tid, rid);
      }
      ai.bumpThreadsSeq();
    } catch (e) {
      ai.clearThreadPendingRun(tid);
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('AI failed', msg || 'Request failed.');
    } finally {
      setSendPending(false);
    }
  };

  const callbacks: ChatCallbacks = {
    onWillSend: () => {
      // Synchronous hook: called right after ChatProvider renders the optimistic user message.
      // Raising sendPending here makes the working indicator appear in the same frame.
      if (import.meta.env.DEV) console.debug('[AI Chat] onWillSend fired at', performance.now().toFixed(1), 'ms');
      setSendPending(true);
      setHasMessages(true);
      forceScrollToLatest();
    },
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

  // Keep the custom working indicator visible from send start until the run fully ends.
  const showWorkingIndicator = () => {
    if (!chatReady()) return false;
    if (!sendPending() && !activeThreadRunning()) return false;
    return true;
  };

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <ChatProvider
        config={{
          placeholder: 'Describe what you want to do...',
          assistantAvatar: '/logo.png',
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
                <div class="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Sparkles class="w-4 h-4 text-primary" />
                </div>
                <span class="truncate font-medium">{ai.activeThreadTitle()}</span>
              </div>
              <div class="flex items-center gap-1.5">
                {/* Model selector */}
                <Show when={ai.aiEnabled() && ai.modelOptions().length > 0}>
                  <Select
                    value={ai.selectedModel()}
                    onChange={(v) => ai.selectModel(String(v ?? '').trim())}
                    options={ai.modelOptions()}
                    placeholder="Select model..."
                    disabled={ai.models.loading || !!ai.models.error || activeThreadRunning()}
                    class="min-w-[140px] max-w-[200px] h-7 text-[11px]"
                  />
                </Show>

                {/* Stop button */}
                <Show when={activeThreadRunning()}>
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
                    disabled={!ai.activeThreadId() || activeThreadRunning()}
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
                      setDeleteForce(activeThreadRunning());
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
              <div class="mx-3 mt-3 px-4 py-3 text-xs rounded-lg bg-error/5 border border-error/20">
                <div class="flex items-center gap-2 font-medium text-error">
                  <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Settings are not available
                </div>
                <div class="mt-1 text-muted-foreground pl-6">
                  {ai.settings.error instanceof Error ? ai.settings.error.message : String(ai.settings.error)}
                </div>
              </div>
            </Show>

            {/* Error banner: Models unavailable */}
            <Show when={ai.models.error && ai.aiEnabled()}>
              <div class="mx-3 mt-3 px-4 py-3 text-xs rounded-lg bg-error/5 border border-error/20">
                <div class="flex items-center gap-2 font-medium text-error">
                  <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  AI is not available
                </div>
                <div class="mt-1 text-muted-foreground pl-6">
                  {ai.models.error instanceof Error ? ai.models.error.message : String(ai.models.error)}
                </div>
              </div>
            </Show>

            {/* Message list with empty state */}
            <MessageListWithEmptyState
              hasMessages={hasMessages()}
              loading={messagesLoading()}
              onSuggestionClick={handleSuggestionClick}
              disabled={!canInteract()}
              class="flex-1 min-h-0"
            />

            {/* Keep indicator mounted and toggle visibility via display to avoid mount/unmount jitter. */}
            <div style={{ display: showWorkingIndicator() ? '' : 'none' }}>
              <ChatWorkingIndicator />
            </div>

            {/* Input area */}
            <ChatInput
              disabled={!canInteract()}
              placeholder={ai.aiEnabled() ? 'Type a message...' : 'Configure AI in settings to start...'}
            />
          </div>
        </Show>

        {/* Empty state: AI not configured */}
        <Show when={ai.settings() && !ai.aiEnabled() && !ai.settings.error && !ai.settings.loading}>
          <Motion.div
            class="flex flex-col items-center justify-center h-full p-8 text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, easing: 'ease-out' }}
          >
            <div class="relative inline-flex items-center justify-center mb-6">
              <div class="absolute -inset-2 rounded-2xl bg-primary/10 animate-[pulse_3s_ease-in-out_infinite]" />
              <div class="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 flex items-center justify-center border border-primary/20 shadow-sm">
                <Sparkles class="w-8 h-8 text-primary" />
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
          </Motion.div>
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
      {/* Show global loading only on first load (no cached data); hide it for background refreshes. */}
      <LoadingOverlay visible={ai.threads.loading && ai.aiEnabled() && !ai.threads()} message="Loading chats..." />
      {/* Do not show message loading overlay while a run is active to avoid flicker. */}
      <LoadingOverlay visible={messagesLoading() && ai.aiEnabled() && !activeThreadRunning()} message="Loading chat..." />
    </div>
  );
}
