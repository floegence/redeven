import {
  createContext,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type Resource,
} from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import type { Message, StreamEvent } from '@floegence/floe-webapp-core/chat';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type AIRealtimeEvent } from '../protocol/redeven_v1';
import { useEnvContext } from './EnvContext';
import { fetchGatewayJSON } from '../services/gatewayApi';

// ---- API response types (shared between sidebar and main page) ----

export type ModelsResponse = Readonly<{
  default_model: string;
  models: Array<{ id: string; label?: string }>;
}>;

export type SettingsResponse = Readonly<{
  ai: any | null;
}>;

export type ThreadRunStatus = 'idle' | 'accepted' | 'running' | 'waiting_approval' | 'recovering' | 'waiting_user' | 'success' | 'failed' | 'canceled' | 'timed_out';

export type ThreadView = Readonly<{
  thread_id: string;
  title: string;
  model_id?: string;
  run_status?: ThreadRunStatus;
  run_updated_at_unix_ms?: number;
  run_error?: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  last_message_at_unix_ms: number;
  last_message_preview: string;
}>;

export type ListThreadsResponse = Readonly<{
  threads: ThreadView[];
  next_cursor?: string;
}>;

type CreateThreadResponse = Readonly<{
  thread: ThreadView;
}>;

export type ListThreadMessagesResponse = Readonly<{
  messages: any[];
  next_before_id?: number;
  has_more?: boolean;
  total_returned?: number;
}>;

// ---- Persistence helpers ----

const ACTIVE_THREAD_STORAGE_KEY = 'redeven_ai_active_thread_id';
const DRAFT_MODEL_STORAGE_KEY = 'redeven_ai_draft_model_id';

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

function clearPersistedActiveThreadId(): void {
  try {
    localStorage.removeItem(ACTIVE_THREAD_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readPersistedDraftModelId(): string | null {
  try {
    const v = String(localStorage.getItem(DRAFT_MODEL_STORAGE_KEY) ?? '').trim();
    return v || null;
  } catch {
    return null;
  }
}

function persistDraftModelId(modelId: string): void {
  try {
    const v = String(modelId ?? '').trim();
    if (!v) return;
    localStorage.setItem(DRAFT_MODEL_STORAGE_KEY, v);
  } catch {
    // ignore
  }
}

function normalizeThreadRunStatus(raw: string | null | undefined): ThreadRunStatus {
  const status = String(raw ?? '').trim().toLowerCase();
  if (
    status === 'accepted' ||
    status === 'running' ||
    status === 'waiting_approval' ||
    status === 'recovering' ||
    status === 'waiting_user' ||
    status === 'success' ||
    status === 'failed' ||
    status === 'canceled' ||
    status === 'timed_out'
  ) {
    return status;
  }
  return 'idle';
}

function isActiveRunStatus(status: ThreadRunStatus): boolean {
  return status === 'accepted' || status === 'running' || status === 'waiting_approval' || status === 'recovering';
}

// ---- Context value type ----

export interface AIChatContextValue {
  // AI config
  settings: Resource<SettingsResponse | null>;
  aiEnabled: Accessor<boolean>;

  // Models
  models: Resource<ModelsResponse | null>;
  modelsReady: Accessor<boolean>;
  selectedModel: Accessor<string>;
  selectModel: (modelID: string) => void;
  modelOptions: Accessor<Array<{ value: string; label: string }>>;

  // Threads
  threads: Resource<ListThreadsResponse | null>;
  bumpThreadsSeq: () => void;
  activeThreadId: Accessor<string | null>;
  selectThreadId: (threadId: string) => void;
  enterDraftChat: () => void;
  clearActiveThreadPersistence: () => void;
  activeThread: Accessor<ThreadView | null>;
  activeThreadTitle: Accessor<string>;

  // Thread creation (only create on-demand; never create an empty thread on navigation)
  creatingThread: Accessor<boolean>;
  ensureThreadForSend: () => Promise<string | null>;

  // Run state (global realtime source of truth)
  runIdForThread: (threadId: string | null | undefined) => string | null;
  markThreadPendingRun: (threadId: string) => void;
  confirmThreadRun: (threadId: string, runId: string) => void;
  clearThreadPendingRun: (threadId: string) => void;
  clearThreadDraftAssistantMessage: (threadId: string | null | undefined) => void;
  threadDraftAssistantMessage: (threadId: string | null | undefined) => Message | null;
  isThreadRunning: (threadId: string | null | undefined) => boolean;
  onRealtimeEvent: (handler: (event: AIRealtimeEvent) => void) => () => void;
}

// ---- Context ----

export const AIChatContext = createContext<AIChatContextValue>();

export function useAIChatContext(): AIChatContextValue {
  const ctx = useContext(AIChatContext);
  if (!ctx) {
    throw new Error('AIChatContext is missing');
  }
  return ctx;
}

// ---- Factory: create context value (call inside a component) ----

export function createAIChatContextValue(): AIChatContextValue {
  const env = useEnvContext();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const notify = useNotification();

  // Settings resource
  const settingsKey = createMemo<number | null>(() => (protocol.status() === 'connected' ? env.settingsSeq() : null));
  const [settings] = createResource<SettingsResponse | null, number | null>(
    () => settingsKey(),
    async (k) => (k == null ? null : await fetchGatewayJSON<SettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' })),
  );
  const aiEnabled = createMemo(() => !!settings()?.ai);

  // Models resource
  const modelsKey = createMemo<number | null>(() => {
    if (settingsKey() == null) return null;
    if (!aiEnabled()) return null;
    return env.settingsSeq();
  });

  const [models] = createResource<ModelsResponse | null, number | null>(
    () => modelsKey(),
    async (k) => (k == null ? null : await fetchGatewayJSON<ModelsResponse>('/_redeven_proxy/api/ai/models', { method: 'GET' })),
  );

  const modelsReady = createMemo(() => !!models() && !models.loading && !models.error);

  const [draftModelId, setDraftModelId] = createSignal<string>(readPersistedDraftModelId() ?? '');
  const [threadModelOverride, setThreadModelOverride] = createSignal<Record<string, string>>({});

  const allowedModelIDs = createMemo(() => {
    const m = models();
    const set = new Set<string>();
    if (!m) return set;
    for (const it of m.models ?? []) {
      const id = String(it?.id ?? '').trim();
      if (id) set.add(id);
    }
    return set;
  });

  const fallbackModelId = createMemo(() => {
    const m = models();
    if (!m) return '';
    const allowed = allowedModelIDs();
    const def = String(m.default_model ?? '').trim();
    if (def && allowed.has(def)) return def;
    const first = m.models?.[0]?.id ? String(m.models[0].id).trim() : '';
    if (first && allowed.has(first)) return first;
    return '';
  });

  // Keep the persisted draft model valid; fall back to config default when needed.
  createEffect(() => {
    if (!modelsReady()) return;
    const allowed = allowedModelIDs();
    const current = String(draftModelId() ?? '').trim();
    if (current && allowed.has(current)) return;
    const persisted = readPersistedDraftModelId();
    if (persisted && allowed.has(persisted)) {
      setDraftModelId(persisted);
      return;
    }
    const next = fallbackModelId();
    if (next) {
      setDraftModelId(next);
      persistDraftModelId(next);
    }
  });

  const modelOptions = createMemo(() => {
    const m = models();
    if (!m) return [];
    return m.models.map((it) => ({
      value: it.id,
      label: it.label ?? it.id,
    }));
  });

  // Threads resource
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

  const [activeRunByThread, setActiveRunByThread] = createSignal<Record<string, string>>({});
  const [pendingRunByThread, setPendingRunByThread] = createSignal<Record<string, true>>({});
  const [draftAssistantByThread, setDraftAssistantByThread] = createSignal<Record<string, Message>>({});

  const realtimeListeners = new Set<(event: AIRealtimeEvent) => void>();

  const emitRealtimeEvent = (event: AIRealtimeEvent) => {
    for (const handler of realtimeListeners) {
      try {
        handler(event);
      } catch {
        // ignore listener errors
      }
    }
  };

  const runIdForThread = (threadId: string | null | undefined): string | null => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return null;
    const runId = String(activeRunByThread()[tid] ?? '').trim();
    return runId || null;
  };

  const markThreadPendingRun = (threadId: string) => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return;
    setPendingRunByThread((prev) => ({ ...prev, [tid]: true }));
  };

  const confirmThreadRun = (threadId: string, runId: string) => {
    const tid = String(threadId ?? '').trim();
    const rid = String(runId ?? '').trim();
    if (!tid || !rid) return;
    setActiveRunByThread((prev) => ({ ...prev, [tid]: rid }));
    setPendingRunByThread((prev) => {
      if (!prev[tid]) return prev;
      const next = { ...prev };
      delete next[tid];
      return next;
    });
  };

  const clearThreadPendingRun = (threadId: string) => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return;
    setPendingRunByThread((prev) => {
      if (!prev[tid]) return prev;
      const next = { ...prev };
      delete next[tid];
      return next;
    });
  };

  const clearThreadDraftAssistantMessage = (threadId: string | null | undefined) => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return;
    setDraftAssistantByThread((prev) => {
      if (!prev[tid]) return prev;
      const next = { ...prev };
      delete next[tid];
      return next;
    });
  };

  const threadDraftAssistantMessage = (threadId: string | null | undefined): Message | null => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return null;
    return draftAssistantByThread()[tid] ?? null;
  };

  const isThreadRunning = (threadId: string | null | undefined): boolean => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return false;

    if (pendingRunByThread()[tid]) return true;
    if (String(activeRunByThread()[tid] ?? '').trim()) return true;

    const list = threads()?.threads ?? [];
    const th = list.find((it) => String(it.thread_id ?? '').trim() === tid);
    return isActiveRunStatus(normalizeThreadRunStatus(th?.run_status));
  };

  const onRealtimeEvent = (handler: (event: AIRealtimeEvent) => void) => {
    realtimeListeners.add(handler);
    return () => {
      realtimeListeners.delete(handler);
    };
  };

  const applyDraftStreamEvent = (threadId: string, streamEvent: StreamEvent) => {
    const tid = String(threadId ?? '').trim();
    if (!tid || !streamEvent) return;

    const streamType = String((streamEvent as any)?.type ?? '')
      .trim()
      .toLowerCase();
    if (!streamType || streamType === 'lifecycle-phase') return;

    const messageID = String((streamEvent as any)?.messageId ?? '').trim();
    if (!messageID) return;

    const now = Date.now();

    const coerceBlockIndex = (raw: unknown): number => {
      const n = Number(raw ?? 0);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.floor(n));
    };

    const ensureBlocksSize = (blocks: any[], idx: number): any[] => {
      if (idx < blocks.length) return blocks;
      const next = blocks.slice();
      while (next.length <= idx) {
        next.push({ type: 'markdown', content: '' });
      }
      return next;
    };

    const toolCallPlaceholder = () => ({
      type: 'tool-call',
      toolName: '',
      toolId: '',
      args: {},
      status: 'running',
    });

    setDraftAssistantByThread((prev) => {
      const existing = prev[tid];
      const existingID = String((existing as any)?.id ?? '').trim();

      let nextMsg: any = existing;
      let nextBlocks: any[] = Array.isArray((existing as any)?.blocks) ? [...((existing as any).blocks as any[])] : [];
      let changed = false;

      const ensureMessage = () => {
        if (nextMsg && String((nextMsg as any)?.id ?? '').trim() === messageID) return;
        nextMsg = {
          id: messageID,
          role: 'assistant',
          blocks: [],
          status: 'complete',
          timestamp: now,
        } as any;
        nextBlocks = [];
        changed = true;
      };

      if (streamType === 'message-start') {
        if (!existing || existingID !== messageID) {
          nextMsg = {
            id: messageID,
            role: 'assistant',
            blocks: [],
            status: 'complete',
            timestamp: now,
          } as any;
          nextBlocks = [];
          changed = true;
        }
      } else if (streamType === 'block-start') {
        ensureMessage();
        const idx = coerceBlockIndex((streamEvent as any)?.blockIndex);
        nextBlocks = ensureBlocksSize(nextBlocks, idx);
        const blockType = String((streamEvent as any)?.blockType ?? '')
          .trim()
          .toLowerCase();
        const placeholder = blockType === 'tool-call' ? toolCallPlaceholder() : { type: 'markdown', content: '' };
        nextBlocks[idx] = placeholder;
        changed = true;
      } else if (streamType === 'block-delta') {
        ensureMessage();
        const idx = coerceBlockIndex((streamEvent as any)?.blockIndex);
        const delta = String((streamEvent as any)?.delta ?? '');
        if (delta) {
          nextBlocks = ensureBlocksSize(nextBlocks, idx);
          const blk = nextBlocks[idx];
          if (blk && typeof blk === 'object' && typeof (blk as any).content === 'string') {
            nextBlocks[idx] = { ...(blk as any), content: String((blk as any).content ?? '') + delta };
          } else {
            nextBlocks[idx] = { type: 'markdown', content: delta };
          }
          changed = true;
        }
      } else if (streamType === 'block-set') {
        ensureMessage();
        const idx = coerceBlockIndex((streamEvent as any)?.blockIndex);
        nextBlocks = ensureBlocksSize(nextBlocks, idx);
        nextBlocks[idx] = (streamEvent as any)?.block ?? { type: 'markdown', content: '' };
        changed = true;
      } else if (streamType === 'error') {
        ensureMessage();
        changed = true;
      } else if (streamType === 'message-end') {
        ensureMessage();
        changed = true;
      } else {
        return prev;
      }

      if (!changed || !nextMsg) return prev;

      const merged: Message = { ...(nextMsg as any), blocks: nextBlocks } as any;
      return { ...prev, [tid]: merged };
    });
  };

  const applyRealtimeEvent = (event: AIRealtimeEvent) => {
    const tid = String(event.threadId ?? '').trim();
    const rid = String(event.runId ?? '').trim();
    if (!tid) return;

    if (event.eventType === 'transcript_message') {
      // Transcript messages update thread metadata (last message preview / timestamps).
      // Refresh the thread list so sidebar stays in sync without relying on polling.
      bumpThreadsSeq();
      emitRealtimeEvent(event);
      return;
    }
    if (!rid) return;

    if (event.eventType === 'stream_event') {
      const streamEvent = event.streamEvent as StreamEvent | undefined;
      if (streamEvent) applyDraftStreamEvent(tid, streamEvent);
      emitRealtimeEvent(event);
      return;
    }

    const nextStatus = normalizeThreadRunStatus(event.runStatus);
    if (isActiveRunStatus(nextStatus)) {
      setActiveRunByThread((prev) => ({ ...prev, [tid]: rid }));
      clearThreadPendingRun(tid);
    } else {
      setActiveRunByThread((prev) => {
        if (!prev[tid]) return prev;
        const next = { ...prev };
        delete next[tid];
        return next;
      });
      clearThreadPendingRun(tid);
      clearThreadDraftAssistantMessage(tid);
    }

    bumpThreadsSeq();
    emitRealtimeEvent(event);
  };

  createEffect(() => {
    const client = protocol.client();
    if (!client || !aiEnabled()) return;

    let disposed = false;

    const unsub = rpc.ai.onEvent((event) => {
      if (disposed) return;
      applyRealtimeEvent(event);
    });

    void rpc.ai
      .subscribe()
      .then((resp) => {
        if (disposed) return;
        const nextRuns: Record<string, string> = {};
        for (const run of resp.activeRuns ?? []) {
          const tid = String(run.threadId ?? '').trim();
          const rid = String(run.runId ?? '').trim();
          if (!tid || !rid) continue;
          nextRuns[tid] = rid;
        }
        setActiveRunByThread(nextRuns);
        setPendingRunByThread((prev) => {
          if (Object.keys(prev).length === 0) return prev;
          const next = { ...prev };
          for (const tid of Object.keys(nextRuns)) {
            delete next[tid];
          }
          return next;
        });
        bumpThreadsSeq();
      })
      .catch(() => {
        // Best effort: reconnect flow will retry subscription.
      });

    onCleanup(() => {
      disposed = true;
      unsub();
      setActiveRunByThread({});
      setPendingRunByThread({});
      setDraftAssistantByThread({});
    });
  });

  // Poll thread list while there is any active run so sidebar status stays fresh.
  createEffect(() => {
    if (protocol.status() !== 'connected' || !aiEnabled()) return;
    const hasRunningThread =
      Object.keys(activeRunByThread()).length > 0 ||
      Object.keys(pendingRunByThread()).length > 0 ||
      (threads()?.threads ?? []).some((t) => isActiveRunStatus(normalizeThreadRunStatus(t.run_status)));
    if (!hasRunningThread) return;

    const timer = window.setInterval(() => {
      bumpThreadsSeq();
    }, 1500);
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    if (protocol.status() === 'connected') return;
    setActiveRunByThread({});
    setPendingRunByThread({});
    setDraftAssistantByThread({});
  });

  // Reconcile run state with the thread list so UI never gets stuck if realtime events are dropped.
  createEffect(() => {
    if (!aiEnabled()) return;
    const list = threads()?.threads ?? [];
    if (list.length === 0) return;

    const statusByThread = new Map<string, ThreadRunStatus>();
    for (const t of list) {
      const tid = String(t?.thread_id ?? '').trim();
      if (!tid) continue;
      statusByThread.set(tid, normalizeThreadRunStatus(t?.run_status));
    }

    const isTerminal = (status: ThreadRunStatus): boolean =>
      status === 'success' || status === 'failed' || status === 'canceled' || status === 'timed_out' || status === 'waiting_user';

    const active = activeRunByThread();
    const pending = pendingRunByThread();
    const drafts = draftAssistantByThread();

    let nextActive: Record<string, string> | null = null;
    let nextPending: Record<string, true> | null = null;
    let nextDrafts: Record<string, Message> | null = null;

    const clearThread = (tid: string) => {
      if (active[tid]) {
        if (!nextActive) nextActive = { ...active };
        delete nextActive[tid];
      }
      if (pending[tid]) {
        if (!nextPending) nextPending = { ...pending };
        delete nextPending[tid];
      }
      if (drafts[tid]) {
        if (!nextDrafts) nextDrafts = { ...drafts };
        delete nextDrafts[tid];
      }
    };

    for (const tid of Object.keys(active)) {
      const st = statusByThread.get(tid);
      if (!st) continue;
      if (isTerminal(st)) clearThread(tid);
    }
    for (const tid of Object.keys(pending)) {
      const st = statusByThread.get(tid);
      if (!st) continue;
      if (isTerminal(st)) clearThread(tid);
    }
    for (const tid of Object.keys(drafts)) {
      const st = statusByThread.get(tid);
      if (!st) continue;
      if (isTerminal(st)) clearThread(tid);
    }

    if (nextActive) setActiveRunByThread(nextActive);
    if (nextPending) setPendingRunByThread(nextPending);
    if (nextDrafts) setDraftAssistantByThread(nextDrafts);
  });

  // Active thread
  const [activeThreadId, setActiveThreadId] = createSignal<string | null>(null);
  const [draftMode, setDraftMode] = createSignal(false);

  const selectThreadId = (threadId: string) => {
    const id = String(threadId ?? '').trim();
    if (!id) return;
    setDraftMode(false);
    setActiveThreadId(id);
  };

  const enterDraftChat = () => {
    setDraftMode(true);
    setActiveThreadId(null);
  };

  const clearActiveThreadPersistence = () => {
    clearPersistedActiveThreadId();
  };

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

  const selectedModel = createMemo(() => {
    if (!modelsReady()) return '';

    const allowed = allowedModelIDs();
    const fallback = fallbackModelId();

    const tid = String(activeThreadId() ?? '').trim();
    if (!tid) {
      const draft = String(draftModelId() ?? '').trim();
      if (draft && allowed.has(draft)) return draft;
      return fallback;
    }

    const overrides = threadModelOverride();
    const overridden = String(overrides?.[tid] ?? '').trim();
    if (overridden && allowed.has(overridden)) return overridden;

    const th = activeThread();
    const server = String(th?.model_id ?? '').trim();
    if (server && allowed.has(server)) return server;

    return fallback;
  });

  const patchThreadModel = async (threadId: string, nextModelId: string, prevModelId: string | null, silent?: boolean) => {
    const tid = String(threadId ?? '').trim();
    const mid = String(nextModelId ?? '').trim();
    if (!tid || !mid) return;

    try {
      await fetchGatewayJSON<{ thread: ThreadView }>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ model_id: mid }),
      });
      bumpThreadsSeq();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!silent) notify.error('Failed to update model', msg || 'Request failed.');
      setThreadModelOverride((prev) => {
        const next = { ...prev };
        const pv = String(prevModelId ?? '').trim();
        if (pv) next[tid] = pv;
        else delete next[tid];
        return next;
      });
    }
  };

  const selectModel = (modelID: string) => {
    const id = String(modelID ?? '').trim();
    if (!id) return;

    if (!modelsReady()) {
      notify.error('AI unavailable', 'Loading models...');
      return;
    }
    const allowed = allowedModelIDs();
    if (!allowed.has(id)) {
      notify.error('Invalid model', 'This model is not allowed.');
      return;
    }

    const tid = String(activeThreadId() ?? '').trim();
    if (!tid) {
      setDraftModelId(id);
      persistDraftModelId(id);
      return;
    }

    if (protocol.status() !== 'connected') {
      notify.error('Not connected', 'Connecting to agent...');
      return;
    }

    const prev = String(selectedModel() ?? '').trim();
    if (prev === id) return;

    setThreadModelOverride((prevMap) => ({ ...prevMap, [tid]: id }));
    void patchThreadModel(tid, id, prev, false);
  };

  // Clear local overrides once the server state catches up.
  createEffect(() => {
    const overrides = threadModelOverride();
    const keys = Object.keys(overrides);
    if (keys.length === 0) return;

    const list = threads()?.threads ?? [];
    let changed = false;
    const next = { ...overrides };
    for (const tid of keys) {
      const th = list.find((it) => String(it?.thread_id ?? '').trim() === tid);
      if (!th) {
        delete next[tid];
        changed = true;
        continue;
      }
      const server = String(th.model_id ?? '').trim();
      if (server && server === String(overrides[tid] ?? '').trim()) {
        delete next[tid];
        changed = true;
      }
    }
    if (changed) setThreadModelOverride(next);
  });

  // Auto-heal invalid/missing thread model_id by falling back to the current config default.
  const healingLastAttempt = new Map<string, number>();
  createEffect(() => {
    if (protocol.status() !== 'connected') return;
    if (!aiEnabled() || !modelsReady()) return;

    const tid = String(activeThreadId() ?? '').trim();
    const th = activeThread();
    if (!tid || !th) return;

    const overrides = threadModelOverride();
    if (String(overrides?.[tid] ?? '').trim()) return;

    const allowed = allowedModelIDs();
    const server = String(th.model_id ?? '').trim();
    if (server && allowed.has(server)) return;

    const desired = String(fallbackModelId() ?? '').trim();
    if (!desired) return;

    const now = Date.now();
    const last = healingLastAttempt.get(tid) ?? 0;
    if (now-last < 10_000) return;
    healingLastAttempt.set(tid, now);

    setThreadModelOverride((prev) => ({ ...prev, [tid]: desired }));
    void patchThreadModel(tid, desired, '', true);
  });

  // Persist activeThreadId to localStorage
  createEffect(() => {
    const id = activeThreadId();
    if (!id) return;
    persistActiveThreadId(id);
  });

  // Thread creation
  const [creatingThread, setCreatingThread] = createSignal(false);

  const createThread = async (): Promise<ThreadView> => {
    const modelID = String(draftModelId() ?? '').trim();
    const body: any = { title: '' };
    if (modelID) body.model_id = modelID;
    const resp = await fetchGatewayJSON<CreateThreadResponse>('/_redeven_proxy/api/ai/threads', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return resp.thread;
  };

  const ensureThreadForSend = async (): Promise<string | null> => {
    if (protocol.status() !== 'connected') {
      notify.error('Not connected', 'Connecting to agent...');
      return null;
    }
    if (!aiEnabled()) {
      notify.error('AI not configured', 'Open Settings to enable AI.');
      return null;
    }

    const existing = activeThreadId();
    if (existing) {
      setDraftMode(false);
      return existing;
    }

    setCreatingThread(true);
    try {
      const th = await createThread();
      bumpThreadsSeq();
      selectThreadId(th.thread_id);
      return th.thread_id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to create chat', msg || 'Request failed.');
      return null;
    } finally {
      setCreatingThread(false);
    }
  };

  // On initial load: pick the last-used thread (localStorage) or the most recent thread.
  // Do NOT create an empty thread automatically.
  createEffect(() => {
    if (protocol.status() !== 'connected' || !aiEnabled()) {
      setDraftMode(false);
      setActiveThreadId(null);
      return;
    }
    const list = threads();
    if (!list || threads.loading || threads.error) return;

    const current = String(activeThreadId() ?? '').trim();
    if (current) {
      // Active thread is a UI selection state. Do not auto-switch it based on
      // temporary list snapshots (new thread creation / polling lag).
      return;
    }

    if (draftMode()) {
      // User explicitly stays in draft chat; do not auto-select a thread.
      return;
    }

    const persisted = readPersistedActiveThreadId();
    const picked =
      (persisted && list.threads.some((t) => t.thread_id === persisted) ? persisted : null) ||
      (list.threads[0]?.thread_id ? String(list.threads[0].thread_id) : null);

    if (picked) {
      selectThreadId(picked);
      return;
    }

    // No threads yet -> stay in draft chat.
    setActiveThreadId(null);
  });

  return {
    settings,
    aiEnabled,
    models,
    modelsReady,
    selectedModel,
    selectModel,
    modelOptions,
    threads,
    bumpThreadsSeq,
    activeThreadId,
    selectThreadId,
    enterDraftChat,
    clearActiveThreadPersistence,
    activeThread,
    activeThreadTitle,
    creatingThread,
    ensureThreadForSend,
    runIdForThread,
    markThreadPendingRun,
    confirmThreadRun,
    clearThreadPendingRun,
    clearThreadDraftAssistantMessage,
    threadDraftAssistantMessage,
    isThreadRunning,
    onRealtimeEvent,
  };
}
