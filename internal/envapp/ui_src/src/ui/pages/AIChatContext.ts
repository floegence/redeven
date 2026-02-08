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
  type Setter,
} from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';
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

export type ThreadRunStatus = 'idle' | 'running' | 'success' | 'failed' | 'canceled';

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
  if (status === 'running' || status === 'success' || status === 'failed' || status === 'canceled') {
    return status;
  }
  return 'idle';
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

  // Run state (owned by EnvAIPage but shared to sidebar)
  running: Accessor<boolean>;
  setRunning: Setter<boolean>;
  runningThreadId: Accessor<string | null>;
  setRunningThreadId: Setter<string | null>;
  isThreadRunning: (threadId: string | null | undefined) => boolean;
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

  const [running, setRunning] = createSignal(false);
  const [runningThreadId, setRunningThreadId] = createSignal<string | null>(null);

  // Track when the current local run started so we don't "reconcile" it away based on a stale threads list snapshot.
  //
  // Without this guard, the UI can drop stream events right after a run starts (threads list still says "idle"),
  // causing missing "Working..." state and missing assistant output in the chat view.
  let localRunStartedAtUnixMs = 0;
  let localRunThreadID = '';
  createEffect(() => {
    const isRunning = running();
    const tid = String(runningThreadId() ?? '').trim();

    if (!isRunning) {
      localRunStartedAtUnixMs = 0;
      localRunThreadID = '';
      return;
    }
    if (!tid) return;

    if (localRunThreadID !== tid) {
      localRunThreadID = tid;
      localRunStartedAtUnixMs = Date.now();
      return;
    }
    if (localRunStartedAtUnixMs <= 0) {
      localRunStartedAtUnixMs = Date.now();
    }
  });

  const isThreadRunning = (threadId: string | null | undefined): boolean => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return false;

    if (running() && String(runningThreadId() ?? '').trim() === tid) {
      return true;
    }

    const list = threads()?.threads ?? [];
    const th = list.find((it) => String(it.thread_id ?? '').trim() === tid);
    return normalizeThreadRunStatus(th?.run_status) === 'running';
  };

  // Poll thread list while there is any active run so sidebar status stays fresh.
  createEffect(() => {
    if (protocol.status() !== 'connected' || !aiEnabled()) return;
    const hasRunningThread = running() || (threads()?.threads ?? []).some((t) => normalizeThreadRunStatus(t.run_status) === 'running');
    if (!hasRunningThread) return;

    const timer = window.setInterval(() => {
      bumpThreadsSeq();
    }, 1500);
    onCleanup(() => window.clearInterval(timer));
  });

  // Reconcile local running flag with persisted thread state to avoid stale "Working..." UI.
  createEffect(() => {
    if (protocol.status() !== 'connected') return;

    const localRunning = running();
    const localThreadID = String(runningThreadId() ?? '').trim();

    if (!localRunning) {
      if (localThreadID) setRunningThreadId(null);
      return;
    }
    if (!localThreadID) {
      setRunning(false);
      return;
    }

    const th = (threads()?.threads ?? []).find((it) => String(it.thread_id ?? '').trim() === localThreadID);
    if (!th) return;
    if (normalizeThreadRunStatus(th.run_status) === 'running') return;

    // If the server state is older than the current local run, treat it as stale and do not clear local state.
    const serverUpdatedAt = Number(th.run_updated_at_unix_ms ?? 0);
    if (!Number.isFinite(serverUpdatedAt) || serverUpdatedAt <= 0) return;
    if (localRunStartedAtUnixMs > 0 && serverUpdatedAt < localRunStartedAtUnixMs - 250) return;

    setRunning(false);
    setRunningThreadId(null);
  });

  createEffect(() => {
    if (protocol.status() === 'connected') return;
    setRunning(false);
    setRunningThreadId(null);
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

    const current = activeThreadId();
    if (current && list.threads.some((t) => t.thread_id === current)) return;

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
    running,
    setRunning,
    runningThreadId,
    setRunningThreadId,
    isThreadRunning,
  };
}
