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
  setSelectedModel: Setter<string>;
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

  const [selectedModel, setSelectedModel] = createSignal('');
  let lastModelVersion: number | null = null;

  createEffect(() => {
    const m = models();
    const version = modelsKey();
    if (!m || version == null) return;

    const modelIDs = new Set(m.models.map((it) => String(it.id ?? '').trim()).filter((it) => !!it));
    const current = selectedModel().trim();
    const defaultModel = String(m.default_model ?? '').trim();
    const fallback = m.models[0]?.id ? String(m.models[0].id).trim() : '';

    if (lastModelVersion !== version) {
      lastModelVersion = version;
      if (defaultModel && modelIDs.has(defaultModel)) {
        setSelectedModel(defaultModel);
        return;
      }
      setSelectedModel(fallback || '');
      return;
    }

    if (current && modelIDs.has(current)) return;

    if (defaultModel && modelIDs.has(defaultModel)) {
      setSelectedModel(defaultModel);
      return;
    }
    setSelectedModel(fallback || '');
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

  // Persist activeThreadId to localStorage
  createEffect(() => {
    const id = activeThreadId();
    if (!id) return;
    persistActiveThreadId(id);
  });

  // Thread creation
  const [creatingThread, setCreatingThread] = createSignal(false);

  const createThread = async (): Promise<ThreadView> => {
    const resp = await fetchGatewayJSON<CreateThreadResponse>('/_redeven_proxy/api/ai/threads', {
      method: 'POST',
      body: JSON.stringify({ title: '' }),
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
    setSelectedModel,
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
