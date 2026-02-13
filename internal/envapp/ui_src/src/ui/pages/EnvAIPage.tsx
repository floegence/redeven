import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { Motion } from 'solid-motionone';
import {
  Code,
  FileText,
  Pencil,
  Settings,
  Sparkles,
  MessageSquare,
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
import { decorateMessageForTerminalExec, decorateStreamEventForTerminalExec } from './aiTerminalExecPresentation';

function createUserMarkdownMessage(markdown: string): Message {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    blocks: [{ type: 'markdown', content: markdown }],
    status: 'complete',
    timestamp: Date.now(),
  };
}

type ExecutionMode = 'act' | 'plan';

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

type ThreadTodoItem = Readonly<{
  id: string;
  content: string;
  status: TodoStatus;
  note?: string;
}>;

type ThreadTodosView = Readonly<{
  version: number;
  updated_at_unix_ms: number;
  todos: ThreadTodoItem[];
}>;

const EXECUTION_MODE_STORAGE_KEY = 'redeven_ai_execution_mode';

function normalizeExecutionMode(raw: unknown): ExecutionMode {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === 'act' ? 'act' : 'plan';
}

function readPersistedExecutionMode(): ExecutionMode {
  try {
    return normalizeExecutionMode(localStorage.getItem(EXECUTION_MODE_STORAGE_KEY));
  } catch {
    return 'plan';
  }
}

function persistExecutionMode(mode: ExecutionMode): void {
  try {
    localStorage.setItem(EXECUTION_MODE_STORAGE_KEY, normalizeExecutionMode(mode));
  } catch {
    // ignore
  }
}

function normalizeTodoStatus(raw: unknown): TodoStatus {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'in_progress' || value === 'completed' || value === 'cancelled') {
    return value;
  }
  return 'pending';
}

function todoStatusLabel(status: TodoStatus): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
}

function todoStatusBadgeClass(status: TodoStatus): string {
  switch (status) {
    case 'in_progress':
      return 'bg-primary/10 text-primary border-primary/20';
    case 'completed':
      return 'bg-success/10 text-success border-success/20';
    case 'cancelled':
      return 'bg-muted text-muted-foreground border-border';
    default:
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20';
  }
}

function normalizeThreadTodosView(raw: unknown): ThreadTodosView {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const listRaw = Array.isArray(source.todos) ? source.todos : [];
  const todos: ThreadTodoItem[] = [];
  listRaw.forEach((entry, index) => {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const content = String(item.content ?? '').trim();
    if (!content) return;
    const id = String(item.id ?? '').trim() || `todo_${index + 1}`;
    const note = String(item.note ?? '').trim();
    todos.push({
      id,
      content,
      status: normalizeTodoStatus(item.status),
      note: note || undefined,
    });
  });

  return {
    version: Math.max(0, Number(source.version ?? 0) || 0),
    updated_at_unix_ms: Math.max(0, Number(source.updated_at_unix_ms ?? 0) || 0),
    todos,
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
function ChatWorkingIndicator(props: { phaseLabel?: string }) {
  const uid = `neural-${Math.random().toString(36).slice(2, 8)}`;

  const baseNodes = [
    { x: 20, y: 8 },
    { x: 8, y: 20 },
    { x: 32, y: 20 },
    { x: 14, y: 32 },
    { x: 26, y: 32 },
    { x: 20, y: 20 },
  ];

  const nodeAnimParams = [
    { ax: 2.6, ay: 2.2, fx: 1.55, fy: 1.35, px: 0, py: 0.4 },
    { ax: 2.3, ay: 2.6, fx: 1.4, fy: 1.6, px: 0.7, py: 0.2 },
    { ax: 2.3, ay: 2.6, fx: 1.4, fy: 1.6, px: 1.9, py: 0.5 },
    { ax: 2.6, ay: 2.2, fx: 1.55, fy: 1.35, px: 0.4, py: 1.1 },
    { ax: 2.6, ay: 2.2, fx: 1.55, fy: 1.35, px: 1.3, py: 0.9 },
    { ax: 0, ay: 0, fx: 0, fy: 0, px: 0, py: 0 },
  ];

  const toCenterConnections: Array<[number, number]> = [[0, 5], [1, 5], [2, 5], [3, 5], [4, 5]];
  const toCenterDelays = [0, 0.22, 0.44, 0.66, 0.88];

  const sideConnections: Array<[number, number]> = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4]];
  const sideDelays = [120, 210, 300, 150, 240];

  const [nodePositions, setNodePositions] = createSignal(baseNodes.map((n) => ({ x: n.x, y: n.y })));

  createEffect(() => {
    let animationId = 0;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = (currentTime - startTime) / 1000;
      setNodePositions(
        baseNodes.map((base, i) => {
          const p = nodeAnimParams[i];
          return {
            x: base.x + Math.sin(elapsed * p.fx + p.px) * p.ax,
            y: base.y + Math.sin(elapsed * p.fy + p.py) * p.ay,
          };
        }),
      );
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    onCleanup(() => cancelAnimationFrame(animationId));
  });

  return (
    <div class="px-4 py-1.5 shrink-0">
      <div class="inline-flex items-center gap-2.5 px-3 py-2 rounded-xl bg-primary/[0.04] border border-primary/10">
        {/* Neural SVG animation */}
        <svg class="w-7 h-7 shrink-0" viewBox="0 0 40 40" fill="none">
          <defs>
            <filter id={uid}>
              <feGaussianBlur stdDeviation="1" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <style>
            {`@keyframes ${uid}-draw { from { stroke-dashoffset: 1; stroke-opacity: 0.15; } to { stroke-dashoffset: 0; stroke-opacity: 0.7; } }`}
          </style>

          <g stroke="var(--primary)" stroke-width="0.8" fill="none">
            <For each={toCenterConnections}>
              {([from, to], i) => (
                <line
                  x1={nodePositions()[from].x}
                  y1={nodePositions()[from].y}
                  x2={nodePositions()[to].x}
                  y2={nodePositions()[to].y}
                  pathLength="1"
                  stroke-dasharray="1"
                  stroke-dashoffset="1"
                  style={{ animation: `${uid}-draw 1.15s linear ${toCenterDelays[i()]}s infinite` }}
                />
              )}
            </For>
            <For each={sideConnections}>
              {([from, to], i) => (
                <line
                  x1={nodePositions()[from].x}
                  y1={nodePositions()[from].y}
                  x2={nodePositions()[to].x}
                  y2={nodePositions()[to].y}
                  class="processing-neural-line"
                  style={`animation-delay:${sideDelays[i()]}ms`}
                />
              )}
            </For>
          </g>

          <g>
            <For each={toCenterConnections}>
              {([from, to], i) => (
                <circle r="1.2" fill="var(--primary)" opacity="0.8">
                  <animateMotion
                    dur="1.05s"
                    repeatCount="indefinite"
                    begin={`${toCenterDelays[i()]}s`}
                    path={`M${nodePositions()[from].x},${nodePositions()[from].y} L${nodePositions()[to].x},${nodePositions()[to].y}`}
                  />
                </circle>
              )}
            </For>
          </g>

          <g filter={`url(#${uid})`}>
            <For each={nodePositions()}>
              {(node, i) => (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={i() === 5 ? 2.5 : 2}
                  fill="var(--primary)"
                  class="processing-neural-node"
                  style={`animation-delay:${[0, 200, 400, 600, 800, 100][i()]}ms`}
                />
              )}
            </For>
          </g>
        </svg>

        {/* Status text (shimmer) */}
        <span class="text-xs text-muted-foreground processing-text-shimmer">{String(props.phaseLabel ?? "").trim() || "Working"}</span>

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

function ExecutionModeToggle(props: {
  value: ExecutionMode;
  disabled?: boolean;
  onChange: (mode: ExecutionMode) => void;
}) {
  const btnClass = (active: boolean) => {
    const base = 'px-2.5 py-1 text-[11px] font-medium rounded-md transition-all duration-150';
    if (active) return `${base} bg-background text-foreground shadow-sm border border-border`;
    return `${base} text-muted-foreground hover:text-foreground hover:bg-muted/50`;
  };

  return (
    <div class={cn('inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5 bg-muted/40', props.disabled && 'opacity-60 pointer-events-none')}>
      <button
        type="button"
        class={btnClass(props.value === 'plan')}
        onClick={() => props.onChange('plan')}
        title="Planning-first mode with soft guidance; execution may still happen based on policy"
      >
        Plan
      </button>
      <button
        type="button"
        class={btnClass(props.value === 'act')}
        onClick={() => props.onChange('act')}
        title="Execution-first mode for direct tool actions"
      >
        Act
      </button>
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
  const [todosLoading, setTodosLoading] = createSignal(false);
  const [todosError, setTodosError] = createSignal('');
  const [threadTodos, setThreadTodos] = createSignal<ThreadTodosView | null>(null);
  const [hasMessages, setHasMessages] = createSignal(false);
  // Turns true immediately after send to keep instant feedback before run state events arrive.
  const [sendPending, setSendPending] = createSignal(false);
  const [executionMode, setExecutionMode] = createSignal<ExecutionMode>(readPersistedExecutionMode());

  let chat: ChatContextValue | null = null;
  const [chatReady, setChatReady] = createSignal(false);

  const FOLLOW_BOTTOM_THRESHOLD_PX = 24;
  let autoFollowEnabled = true;
  let followScrollRafPending = false;

  const getMessageListScroller = () =>
    document.querySelector<HTMLElement>('.chat-message-list-scroll') ??
    document.querySelector<HTMLElement>('.chat-message-list');

  const isNearBottom = (el: HTMLElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_BOTTOM_THRESHOLD_PX;

  const enableAutoFollow = () => {
    autoFollowEnabled = true;
  };

  const forceScrollToLatest = () => {
    const scrollBottom = () => {
      const el = getMessageListScroller();
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

  const scheduleFollowScrollToLatest = () => {
    const scroller = getMessageListScroller();
    if (scroller) {
      if (isNearBottom(scroller)) {
        autoFollowEnabled = true;
      } else {
        autoFollowEnabled = false;
      }
    }

    if (!autoFollowEnabled || followScrollRafPending) {
      return;
    }

    followScrollRafPending = true;
    requestAnimationFrame(() => {
      followScrollRafPending = false;
      if (!autoFollowEnabled) return;
      forceScrollToLatest();
    });
  };

  let lastMessagesReq = 0;
  let lastTodosReq = 0;
  let skipNextThreadLoad = false;
  const replayAppliedByThread = new Map<string, number>();
  const failureNotifiedRuns = new Set<string>();
  const [runPhaseLabel, setRunPhaseLabel] = createSignal('Working');
  const activeThreadTodos = createMemo(() => threadTodos()?.todos ?? []);
  const unresolvedTodoCount = createMemo(() =>
    activeThreadTodos().filter((item) => item.status === 'pending' || item.status === 'in_progress').length,
  );
  const todoUpdatedLabel = createMemo(() => {
    const updatedAt = Number(threadTodos()?.updated_at_unix_ms ?? 0);
    if (!updatedAt) return '';
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  const normalizeLifecyclePhase = (raw: unknown): string => {
    const v = String(raw ?? '').trim().toLowerCase();
    switch (v) {
      case 'planning':
      case 'start':
        return 'planning';
      case 'executing_tools':
      case 'tool_call':
      case 'tool':
        return 'executing_tools';
      case 'synthesizing':
      case 'synthesis':
        return 'synthesizing';
      case 'finalizing':
      case 'end':
      case 'finish':
      case 'ended':
        return 'finalizing';
      default:
        return '';
    }
  };

  const lifecyclePhaseLabel = (phase: string): string => {
    switch (phase) {
      case 'planning':
        return 'Planning...';
      case 'executing_tools':
        return 'Executing tools...';
      case 'synthesizing':
        return 'Synthesizing answer...';
      case 'finalizing':
        return 'Finalizing...';
      default:
        return 'Working';
    }
  };

  const activeThreadRunning = createMemo(() => ai.isThreadRunning(ai.activeThreadId()));
  const canInteract = createMemo(
    () => protocol.status() === 'connected' && !activeThreadRunning() && ai.aiEnabled() && ai.modelsReady(),
  );
  const updateExecutionMode = (nextMode: ExecutionMode) => {
    const next = normalizeExecutionMode(nextMode);
    setExecutionMode(next);
    persistExecutionMode(next);
  };

  const isTerminalRunStatus = (status: string) =>
    status === 'success' || status === 'failed' || status === 'canceled' || status === 'timed_out';

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
      chat.handleStreamEvent(decorateStreamEventForTerminalExec(events[i] as any) as any);
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

      const messages = (resp.messages || []).map((message) => decorateMessageForTerminalExec(message as Message));
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

  const loadThreadTodos = async (
    threadId: string,
    opts?: {
      silent?: boolean;
      notifyError?: boolean;
    },
  ): Promise<void> => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return;

    const reqNo = ++lastTodosReq;
    const silent = !!opts?.silent;
    const notifyError = opts?.notifyError !== false;
    if (!silent) {
      setTodosLoading(true);
    }

    try {
      const resp = await fetchGatewayJSON<{ todos: unknown }>(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/todos`,
        { method: 'GET' },
      );
      if (reqNo !== lastTodosReq) return;

      setThreadTodos(normalizeThreadTodosView(resp.todos));
      setTodosError('');
    } catch (e) {
      if (reqNo !== lastTodosReq) return;
      const msg = e instanceof Error ? e.message : String(e);
      setThreadTodos(null);
      setTodosError(msg || 'Request failed.');
      if (!silent && notifyError) {
        notify.error('Failed to load tasks', msg || 'Request failed.');
      }
    } finally {
      if (!silent) {
        setTodosLoading(false);
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
      setRunPhaseLabel('Working');
      setThreadTodos(null);
      setTodosError('');
      setTodosLoading(false);
      return;
    }

    const tid = ai.activeThreadId();
    enableAutoFollow();

    // Draft -> thread promotion: keep the optimistic user message rendered by ChatProvider.
    if (skipNextThreadLoad && tid) {
      skipNextThreadLoad = false;
      void loadThreadTodos(tid, { silent: true, notifyError: false });
      return;
    }

    if (!tid) {
      chat?.clearMessages();
      setHasMessages(false);
      setRunPhaseLabel('Working');
      setThreadTodos(null);
      setTodosError('');
      setTodosLoading(false);
      return;
    }

    chat?.clearMessages();
    setHasMessages(false);
    setRunPhaseLabel('Working');
    setThreadTodos(null);
    setTodosError('');
    setTodosLoading(true);
    replayAppliedByThread.delete(String(tid ?? '').trim());
    void loadThreadMessages(tid);
    void loadThreadTodos(tid, { silent: false, notifyError: false });
  });

  createEffect(() => {
    if (!chatReady()) return;

    const unsub = ai.onRealtimeEvent((event) => {
      const tid = String(event.threadId ?? '').trim();
      if (!tid) return;

      if (event.eventType === 'stream_event') {
        const streamEvent = event.streamEvent as any;
        const streamType = String(streamEvent?.type ?? '').trim().toLowerCase();
        if (streamType === 'lifecycle-phase') {
          if (tid === String(ai.activeThreadId() ?? '').trim()) {
            const normalizedPhase = normalizeLifecyclePhase(streamEvent?.phase ?? event.diag?.phase);
            if (normalizedPhase) {
              setRunPhaseLabel(lifecyclePhaseLabel(normalizedPhase));
            }
          }
          return;
        }
        if (tid === String(ai.activeThreadId() ?? '').trim()) {
          const block = streamEvent?.block as any;
          const blockType = String(block?.type ?? '').trim().toLowerCase();
          const toolName = String(block?.toolName ?? '').trim();
          const toolStatus = String(block?.status ?? '').trim().toLowerCase();
          if (streamType === 'block-set' && blockType === 'tool-call' && toolName === 'write_todos' && toolStatus === 'success') {
            void loadThreadTodos(tid, { silent: true, notifyError: false });
          }
        }
        if (tid === String(ai.activeThreadId() ?? '').trim()) {
          syncThreadReplay(tid);
          scheduleFollowScrollToLatest();
        }
        return;
      }

      const status = String(event.runStatus ?? '').trim().toLowerCase();
      if (!isTerminalRunStatus(status)) {
        return;
      }

      replayAppliedByThread.delete(tid);
      if (tid === String(ai.activeThreadId() ?? '').trim()) {
        setRunPhaseLabel('Working');
        void loadThreadMessages(tid);
        void loadThreadTodos(tid, { silent: true, notifyError: false });
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

  createEffect(() => {
    if (!chatReady()) return;
    const tid = String(ai.activeThreadId() ?? '').trim();
    if (!tid || !activeThreadRunning()) return;

    void loadThreadTodos(tid, { silent: true, notifyError: false });
    const timer = window.setInterval(() => {
      void loadThreadTodos(tid, { silent: true, notifyError: false });
    }, 1600);

    onCleanup(() => {
      window.clearInterval(timer);
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
    setRunPhaseLabel('Planning...');
    enableAutoFollow();
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
        options: { maxSteps: 10, mode: executionMode() },
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
      setRunPhaseLabel('Planning...');
      enableAutoFollow();
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
            <div class="chat-header border-b border-border bg-background/95 backdrop-blur-sm max-sm:flex-col max-sm:items-stretch max-sm:gap-2">
              <div class="chat-header-title flex items-center gap-2 min-w-0 w-full sm:w-auto">
                <div class="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <MessageSquare class="w-4 h-4 text-primary" />
                </div>
                <span class="truncate font-medium">{ai.activeThreadTitle()}</span>
              </div>
              <div class="w-full sm:w-auto flex items-center justify-between gap-2 sm:justify-start sm:gap-1.5">
                <div class="min-w-0 flex items-center gap-1.5">
                  {/* Model selector */}
                  <Show when={ai.aiEnabled() && ai.modelOptions().length > 0}>
                    <Select
                      value={ai.selectedModel()}
                      onChange={(v) => ai.selectModel(String(v ?? '').trim())}
                      options={ai.modelOptions()}
                      placeholder="Select model..."
                      disabled={ai.models.loading || !!ai.models.error || activeThreadRunning()}
                      class="ai-model-select-trigger min-w-[120px] max-w-[160px] sm:min-w-[140px] sm:max-w-[200px] h-7 text-[11px]"
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
                        class="h-7 px-2 max-sm:w-7 max-sm:px-0 text-error border-error/30 hover:bg-error/10 hover:text-error"
                      >
                        <span class="max-sm:hidden">Stop</span>
                      </Button>
                    </Tooltip>
                  </Show>
                </div>

                <div class="shrink-0 flex items-center gap-1.5">
                  <div class="hidden sm:block w-px h-5 bg-border mx-1" />

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

            <Show when={ai.activeThreadId()}>
              <div class="mx-3 mt-3 px-3 py-2.5 rounded-lg border border-border/70 bg-card/60">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-xs font-medium text-foreground">Tasks</div>
                  <div class="text-[11px] text-muted-foreground">
                    {unresolvedTodoCount()} open
                  </div>
                </div>

                <Show when={!todosLoading() || activeThreadTodos().length > 0} fallback={
                  <div class="mt-2 text-[11px] text-muted-foreground">Loading tasks...</div>
                }>
                  <Show when={!todosError()} fallback={
                    <div class="mt-2 text-[11px] text-error">{todosError()}</div>
                  }>
                    <Show when={activeThreadTodos().length > 0} fallback={
                      <div class="mt-2 text-[11px] text-muted-foreground">No tasks yet. The agent can update tasks with `write_todos`.</div>
                    }>
                      <div class="mt-2 space-y-1.5 max-h-44 overflow-auto pr-1">
                        <For each={activeThreadTodos()}>
                          {(item) => (
                            <div class="rounded-md border border-border/60 bg-background/70 px-2 py-1.5">
                              <div class="flex items-center gap-2">
                                <span class={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium', todoStatusBadgeClass(item.status))}>
                                  {todoStatusLabel(item.status)}
                                </span>
                                <span class="text-xs text-foreground leading-relaxed break-words">{item.content}</span>
                              </div>
                              <Show when={item.note}>
                                <div class="mt-1 text-[11px] text-muted-foreground leading-relaxed break-words">
                                  {item.note}
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    <div class="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Version {threadTodos()?.version ?? 0}</span>
                      <span>{todoUpdatedLabel() ? `Updated ${todoUpdatedLabel()}` : ''}</span>
                    </div>
                  </Show>
                </Show>
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
              <ChatWorkingIndicator phaseLabel={runPhaseLabel()} />
            </div>

            <div class="px-4 pt-0.5 pb-2 flex items-center justify-between gap-3">
              <span class="text-[11px] text-muted-foreground">Execution mode</span>
              <ExecutionModeToggle
                value={executionMode()}
                disabled={activeThreadRunning()}
                onChange={(mode) => updateExecutionMode(mode)}
              />
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
