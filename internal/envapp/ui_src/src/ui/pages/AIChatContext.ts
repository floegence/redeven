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
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type AIRealtimeEvent } from '../protocol/redeven_v1';
import { useEnvContext } from './EnvContext';
import { fetchGatewayJSON } from '../services/gatewayApi';
import {
  readRendererScopedUIStorageItem,
  removeRendererScopedUIStorageItem,
  writeRendererScopedUIStorageItem,
} from '../services/uiStorage';
import { hasRWXPermissions } from './aiPermissions';
import {
  normalizeAskUserDraft,
  normalizeAskUserDraftForQuestion,
  normalizeAskUserQuestions,
  type AskUserAction,
  type AskUserChoice,
  type AskUserDraft,
  type AskUserQuestion,
} from '../chat/askUserContract';

// ---- API response types (shared between sidebar and main page) ----

export type ModelsResponse = Readonly<{
  current_model: string;
  models: Array<{ id: string; label?: string; source?: string; source_label?: string }>;
  runtime?: AIRuntimeStatus | null;
}>;

export type AIModelSourceKey = 'runtime_config' | 'desktop_broker';

export type AIModelOption = Readonly<{
  value: string;
  label: string;
  source: AIModelSourceKey;
  sourceLabel: string;
}>;

export type AIModelSourceGroup = Readonly<{
  source: AIModelSourceKey;
  sourceLabel: string;
  available: boolean;
  reason?: string;
  models: readonly AIModelOption[];
}>;

export type AIRuntimeStatus = Readonly<{
  remote_configured?: boolean;
  desktop_broker?: Readonly<{
    binding_state?: string;
    connected?: boolean;
    available?: boolean;
    model_source?: string;
    session_id?: string;
    ssh_runtime_key?: string;
    expires_at_unix_ms?: number;
    model_count?: number;
    missing_key_provider_ids?: string[];
    last_error?: string;
  }> | null;
}>;

export type SettingsResponse = Readonly<{
  ai: any | null;
  ai_runtime?: AIRuntimeStatus | null;
}>;

export type ThreadRunStatus = 'idle' | 'accepted' | 'running' | 'waiting_approval' | 'recovering' | 'finalizing' | 'waiting_user' | 'success' | 'failed' | 'canceled' | 'timed_out';
export type ExecutionMode = 'act' | 'plan';

export type WaitingPromptActionView = AskUserAction;
export type WaitingPromptChoiceView = AskUserChoice;
export type WaitingPromptQuestionView = AskUserQuestion;

export type WaitingPromptView = Readonly<{
  promptId: string;
  messageId: string;
  toolId: string;
  reasonCode?: string;
  requiredFromUser?: string[];
  evidenceRefs?: string[];
  publicSummary?: string;
  containsSecret?: boolean;
  questions?: WaitingPromptQuestionView[];
}>;

export type StructuredPromptAnswerDraft = AskUserDraft;

export type ThreadReadSnapshot = Readonly<{
  last_message_at_unix_ms: number;
  waiting_prompt_id?: string;
}>;

export type ThreadReadState = Readonly<{
  last_read_message_at_unix_ms: number;
  last_seen_waiting_prompt_id?: string;
}>;

export type ThreadReadStatus = Readonly<{
  is_unread: boolean;
  snapshot: ThreadReadSnapshot;
  read_state: ThreadReadState;
}>;

export type ThreadView = Readonly<{
  thread_id: string;
  title: string;
  model_id?: string;
  model_locked?: boolean;
  execution_mode?: ExecutionMode;
  working_dir?: string;
  queued_turn_count?: number;
  run_status?: ThreadRunStatus;
  run_updated_at_unix_ms?: number;
  run_error?: string;
  waiting_prompt?: WaitingPromptView;
  last_context_run_id?: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  last_message_at_unix_ms: number;
  last_message_preview: string;
  read_status?: ThreadReadStatus;
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
const DRAFT_WORKING_DIR_STORAGE_KEY = 'redeven_ai_draft_working_dir';

function readPersistedActiveThreadId(): string | null {
  const v = String(readRendererScopedUIStorageItem(ACTIVE_THREAD_STORAGE_KEY) ?? '').trim();
  return v || null;
}

function persistActiveThreadId(threadId: string): void {
  writeRendererScopedUIStorageItem(ACTIVE_THREAD_STORAGE_KEY, threadId);
}

function clearPersistedActiveThreadId(): void {
  removeRendererScopedUIStorageItem(ACTIVE_THREAD_STORAGE_KEY);
}

function readPersistedDraftWorkingDir(): string | null {
  const v = String(readRendererScopedUIStorageItem(DRAFT_WORKING_DIR_STORAGE_KEY) ?? '').trim();
  return v || null;
}

function persistDraftWorkingDir(path: string): void {
  const v = String(path ?? '').trim();
  if (!v) {
    removeRendererScopedUIStorageItem(DRAFT_WORKING_DIR_STORAGE_KEY);
    return;
  }
  writeRendererScopedUIStorageItem(DRAFT_WORKING_DIR_STORAGE_KEY, v);
}

function normalizeThreadRunStatus(raw: string | null | undefined): ThreadRunStatus {
  const status = String(raw ?? '').trim().toLowerCase();
  if (
    status === 'accepted' ||
    status === 'running' ||
    status === 'waiting_approval' ||
    status === 'recovering' ||
    status === 'finalizing' ||
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

function normalizeExecutionMode(raw: unknown): ExecutionMode {
  const mode = String(raw ?? '').trim().toLowerCase();
  return mode === 'plan' ? 'plan' : 'act';
}

function normalizeWaitingPrompt(raw: any): WaitingPromptView | null {
  if (!raw || typeof raw !== 'object') return null;
  const promptID = String((raw as any).prompt_id ?? (raw as any).promptId ?? '').trim();
  const messageID = String((raw as any).message_id ?? (raw as any).messageId ?? '').trim();
  const toolID = String((raw as any).tool_id ?? (raw as any).toolId ?? '').trim();
  if (!promptID || !messageID || !toolID) return null;
  const questions = normalizeAskUserQuestions((raw as any).questions);
  return {
    promptId: promptID,
    messageId: messageID,
    toolId: toolID,
    reasonCode: String((raw as any).reason_code ?? (raw as any).reasonCode ?? '').trim() || undefined,
    requiredFromUser: Array.isArray((raw as any).required_from_user)
      ? (raw as any).required_from_user.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
      : undefined,
    evidenceRefs: Array.isArray((raw as any).evidence_refs)
      ? (raw as any).evidence_refs.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
      : undefined,
    publicSummary: String((raw as any).public_summary ?? (raw as any).publicSummary ?? '').trim() || undefined,
    containsSecret: Boolean((raw as any).contains_secret ?? (raw as any).containsSecret),
    questions: questions.length > 0 ? questions : undefined,
  };
}

function normalizeThreadReadStatus(raw: any, thread?: ThreadView | null | undefined): ThreadReadStatus {
  const waitingPrompt = normalizeWaitingPrompt((thread as any)?.waiting_prompt);
  const fallbackSnapshot: ThreadReadSnapshot = {
    last_message_at_unix_ms: Math.max(0, Math.floor(Number(thread?.last_message_at_unix_ms ?? 0) || 0)),
    waiting_prompt_id: String(waitingPrompt?.promptId ?? '').trim() || undefined,
  };
  const snapshotRaw = raw && typeof raw === 'object' ? (raw as any).snapshot : null;
  const readStateRaw = raw && typeof raw === 'object' ? (raw as any).read_state : null;
  const snapshot: ThreadReadSnapshot = {
    last_message_at_unix_ms: Math.max(
      0,
      Math.floor(Number(snapshotRaw?.last_message_at_unix_ms ?? fallbackSnapshot.last_message_at_unix_ms ?? 0) || 0),
    ),
    waiting_prompt_id: String(snapshotRaw?.waiting_prompt_id ?? fallbackSnapshot.waiting_prompt_id ?? '').trim() || undefined,
  };
  const readState: ThreadReadState = {
    last_read_message_at_unix_ms: Math.max(
      0,
      Math.floor(Number(readStateRaw?.last_read_message_at_unix_ms ?? snapshot.last_message_at_unix_ms ?? 0) || 0),
    ),
    last_seen_waiting_prompt_id: String(readStateRaw?.last_seen_waiting_prompt_id ?? snapshot.waiting_prompt_id ?? '').trim() || undefined,
  };
  const inferredUnread = (
    snapshot.last_message_at_unix_ms > readState.last_read_message_at_unix_ms ||
    (
      !!snapshot.waiting_prompt_id &&
      snapshot.waiting_prompt_id !== readState.last_seen_waiting_prompt_id
    )
  );
  return {
    is_unread: Boolean(raw?.is_unread ?? inferredUnread),
    snapshot,
    read_state: readState,
  };
}

function patchThreadReadStatus(thread: ThreadView, readStatus: ThreadReadStatus): ThreadView {
  return {
    ...thread,
    read_status: {
      ...readStatus,
      snapshot: { ...readStatus.snapshot },
      read_state: { ...readStatus.read_state },
    },
  };
}

const MODEL_SOURCE_ORDER: readonly AIModelSourceKey[] = ['runtime_config', 'desktop_broker'];

function normalizeAIModelSource(raw: unknown): AIModelSourceKey {
  return String(raw ?? '').trim() === 'desktop_broker' ? 'desktop_broker' : 'runtime_config';
}

function defaultModelSourceLabel(source: AIModelSourceKey): string {
  return source === 'desktop_broker' ? 'Desktop' : 'Remote runtime';
}

function threadNeedsReadMark(readStatus: ThreadReadStatus | null | undefined): boolean {
  if (!readStatus) return false;
  return (
    readStatus.snapshot.last_message_at_unix_ms > readStatus.read_state.last_read_message_at_unix_ms ||
    (
      !!readStatus.snapshot.waiting_prompt_id &&
      readStatus.snapshot.waiting_prompt_id !== readStatus.read_state.last_seen_waiting_prompt_id
    )
  );
}

function isActiveRunStatus(status: ThreadRunStatus): boolean {
  return status === 'accepted' || status === 'running' || status === 'waiting_approval' || status === 'recovering' || status === 'finalizing';
}

// ---- Context value type ----

export interface AIChatContextValue {
  // AI config
  settings: Resource<SettingsResponse | null>;
  aiEnabled: Accessor<boolean>;

  // Models
  models: Resource<ModelsResponse | null>;
  modelsReady: Accessor<boolean>;
  selectedDefaultModel: Accessor<string>;
  selectDefaultModel: (modelID: string) => void;
  selectedThreadModel: Accessor<string>;
  selectThreadModel: (modelID: string) => void;
  selectedSendModel: Accessor<string>;
  activeThreadModelLocked: Accessor<boolean>;
  modelOptions: Accessor<AIModelOption[]>;
  modelSourceGroups: Accessor<AIModelSourceGroup[]>;

  // Threads
  threads: Resource<ListThreadsResponse | null>;
  bumpThreadsSeq: () => void;
  activeThreadId: Accessor<string | null>;
  selectThreadId: (threadId: string) => void;
  enterDraftChat: () => void;
  clearActiveThreadPersistence: () => void;
  activeThread: Accessor<ThreadView | null>;
  activeThreadWaitingPrompt: Accessor<WaitingPromptView | null>;
  activeThreadTitle: Accessor<string>;

  // Thread creation (only create on-demand; never create an empty thread on navigation)
  creatingThread: Accessor<boolean>;
  ensureThreadForSend: (opts?: { executionMode?: ExecutionMode }) => Promise<string | null>;

  // Draft working dir (applies to new chats; locked after thread creation)
  draftWorkingDir: Accessor<string>;
  setDraftWorkingDir: (path: string) => void;

  // Run state (global realtime source of truth)
  runIdForThread: (threadId: string | null | undefined) => string | null;
  lastContextRunIdForThread: (threadId: string | null | undefined) => string | null;
  markThreadPendingRun: (threadId: string) => void;
  confirmThreadRun: (threadId: string, runId: string) => void;
  clearThreadPendingRun: (threadId: string) => void;
  consumeWaitingPrompt: (threadId: string, promptId: string) => void;
  setStructuredPromptDraft: (threadId: string, promptId: string, questionId: string, draft: StructuredPromptAnswerDraft | null) => void;
  getStructuredPromptDrafts: (threadId: string, promptId: string) => Record<string, StructuredPromptAnswerDraft>;
  submitStructuredPromptResponse: (args: {
    threadId: string;
    promptId: string;
    answers: Record<string, StructuredPromptAnswerDraft>;
    messageId?: string;
    text?: string;
    attachments?: Array<{ name: string; mimeType: string; url: string }>;
    expectedRunId?: string;
    sourceFollowupId?: string;
  }) => Promise<{ runId?: string; consumedWaitingPromptId?: string; appliedExecutionMode?: ExecutionMode }>;
  isThreadRunning: (threadId: string | null | undefined) => boolean;
  isThreadUnread: (threadId: string | null | undefined) => boolean;
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

  const permissionReady = createMemo(() => env.env.state === 'ready');
  const canUseFlower = createMemo(() => permissionReady() && hasRWXPermissions(env.env()));

  // Settings resource
  const settingsKey = createMemo<number | null>(() =>
    protocol.status() === 'connected' && canUseFlower() ? env.settingsSeq() : null,
  );
  const [settings] = createResource<SettingsResponse | null, number | null>(
    () => settingsKey(),
    async (k) => (k == null ? null : await fetchGatewayJSON<SettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' })),
  );
  const aiEnabled = createMemo(() => {
    const s = settings();
    if (!s) return false;
    if (s.ai) return true;
    return !!s.ai_runtime?.desktop_broker?.connected;
  });

  // Models resource
  const modelsKey = createMemo<number | null>(() => {
    if (settingsKey() == null) return null;
    if (!aiEnabled()) return null;
    return env.settingsSeq();
  });

  const [models, { mutate: mutateModels }] = createResource<ModelsResponse | null, number | null>(
    () => modelsKey(),
    async (k) => (k == null ? null : await fetchGatewayJSON<ModelsResponse>('/_redeven_proxy/api/ai/models', { method: 'GET' })),
  );

  const modelsReady = createMemo(() => !!models() && !models.loading && !models.error);

  const [draftModelId, setDraftModelId] = createSignal<string>('');
  const [threadModelOverride, setThreadModelOverride] = createSignal<Record<string, string>>({});

  const [draftWorkingDir, setDraftWorkingDirRaw] = createSignal<string>(readPersistedDraftWorkingDir() ?? '');
  const setDraftWorkingDir = (path: string) => {
    const v = String(path ?? '').trim();
    setDraftWorkingDirRaw(v);
    persistDraftWorkingDir(v);
  };

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
    const current = String(m.current_model ?? '').trim();
    if (current && allowed.has(current)) return current;
    const first = m.models?.[0]?.id ? String(m.models[0].id).trim() : '';
    if (first && allowed.has(first)) return first;
    return '';
  });

  // Keep the draft model valid; fall back to current_model when needed.
  createEffect(() => {
    if (!modelsReady()) return;
    const allowed = allowedModelIDs();
    const current = String(draftModelId() ?? '').trim();
    if (current && allowed.has(current)) return;
    const next = fallbackModelId();
    setDraftModelId(next);
  });

  const modelOptions = createMemo<AIModelOption[]>(() => {
    const m = models();
    if (!m) return [];
    return m.models
      .map((it) => {
        const value = String(it.id ?? '').trim();
        const source = normalizeAIModelSource(it.source);
        return {
          value,
          label: String(it.label ?? value).trim() || value,
          source,
          sourceLabel: String(it.source_label ?? '').trim() || defaultModelSourceLabel(source),
        };
      })
      .filter((it) => it.value !== '');
  });

  const modelSourceGroups = createMemo<AIModelSourceGroup[]>(() => {
    const bySource = new Map<AIModelSourceKey, AIModelOption[]>();
    for (const option of modelOptions()) {
      const list = bySource.get(option.source) ?? [];
      list.push(option);
      bySource.set(option.source, list);
    }
    return MODEL_SOURCE_ORDER
      .map((source) => {
        const sourceModels = bySource.get(source) ?? [];
        const first = sourceModels[0];
        return {
          source,
          sourceLabel: first?.sourceLabel || defaultModelSourceLabel(source),
          available: sourceModels.length > 0,
          models: sourceModels,
        };
      })
      .filter((group) => group.available);
  });

  // Threads resource
  const [threadsSeq, setThreadsSeq] = createSignal(0);
  const bumpThreadsSeq = () => setThreadsSeq((n) => n + 1);

  const threadsKey = createMemo<number | null>(() => {
    if (settingsKey() == null) return null;
    if (!aiEnabled()) return null;
    return threadsSeq();
  });

  const [threads, { mutate: mutateThreads }] = createResource<ListThreadsResponse | null, number | null>(
    () => threadsKey(),
    async (k) =>
      k == null
        ? null
        : await fetchGatewayJSON<ListThreadsResponse>('/_redeven_proxy/api/ai/threads?limit=200', {
            method: 'GET',
          }),
  );

  const [activeRunByThread, setActiveRunByThread] = createSignal<Record<string, string>>({});
  const [lastContextRunByThread, setLastContextRunByThread] = createSignal<Record<string, string>>({});
  const [pendingRunByThread, setPendingRunByThread] = createSignal<Record<string, true>>({});
  const [waitingPromptByThread, setWaitingPromptByThread] = createSignal<Record<string, WaitingPromptView | null>>({});
  const [structuredPromptDraftsByPrompt, setStructuredPromptDraftsByPrompt] = createSignal<Record<string, Record<string, StructuredPromptAnswerDraft>>>({});
  const [markingReadKeyByThread, setMarkingReadKeyByThread] = createSignal<Record<string, string>>({});

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

  const lastContextRunIdForThread = (threadId: string | null | undefined): string | null => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return null;
    const override = String(lastContextRunByThread()[tid] ?? '').trim();
    if (override) return override;
    const persisted = String(threadById().get(tid)?.last_context_run_id ?? '').trim();
    return persisted || null;
  };

  const setThreadLastContextRunId = (threadId: string, runId: string) => {
    const tid = String(threadId ?? '').trim();
    const rid = String(runId ?? '').trim();
    if (!tid) return;
    setLastContextRunByThread((prev) => {
      const current = String(prev[tid] ?? '').trim();
      if (!rid) {
        if (!current) return prev;
        const next = { ...prev };
        delete next[tid];
        return next;
      }
      if (current === rid) return prev;
      return {
        ...prev,
        [tid]: rid,
      };
    });
  };

  const threadById = createMemo(() => {
    const map = new Map<string, ThreadView>();
    for (const thread of threads()?.threads ?? []) {
      const tid = String(thread?.thread_id ?? '').trim();
      if (!tid) continue;
      map.set(tid, thread);
    }
    return map;
  });

  const waitingPromptForThread = (threadId: string | null | undefined): WaitingPromptView | null => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return null;

    const realtimeMap = waitingPromptByThread();
    if (Object.prototype.hasOwnProperty.call(realtimeMap, tid)) {
      return realtimeMap[tid] ?? null;
    }

    const th = threadById().get(tid);
    return normalizeWaitingPrompt((th as any)?.waiting_prompt);
  };

  const threadReadStatusForThread = (threadId: string | null | undefined): ThreadReadStatus => {
    const tid = String(threadId ?? '').trim();
    if (!tid) {
      return normalizeThreadReadStatus(null, null);
    }

    const thread = threadById().get(tid);
    const normalized = normalizeThreadReadStatus((thread as any)?.read_status, thread);
    const waitingPromptID = String(waitingPromptForThread(tid)?.promptId ?? '').trim();
    if (!waitingPromptID || waitingPromptID === normalized.snapshot.waiting_prompt_id) {
      return normalized;
    }
    const next = {
      ...normalized,
      snapshot: {
        ...normalized.snapshot,
        waiting_prompt_id: waitingPromptID,
      },
    };
    return {
      ...next,
      is_unread: threadNeedsReadMark(next),
    };
  };

  const updateThreadReadStatus = (threadId: string, readStatus: ThreadReadStatus): void => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return;
    mutateThreads((current) => {
      if (!current) return current;
      let changed = false;
      const nextThreads = current.threads.map((thread) => {
        if (String(thread.thread_id ?? '').trim() !== tid) return thread;
        changed = true;
        return patchThreadReadStatus(thread, readStatus);
      });
      if (!changed) return current;
      return {
        ...current,
        threads: nextThreads,
      };
    });
  };

  const markThreadRead = async (threadId: string, readStatus: ThreadReadStatus): Promise<void> => {
    const tid = String(threadId ?? '').trim();
    if (!tid || !threadNeedsReadMark(readStatus)) return;

    const requestKey = [
      tid,
      String(readStatus.snapshot.last_message_at_unix_ms ?? 0),
      String(readStatus.snapshot.waiting_prompt_id ?? '').trim(),
    ].join('\u001f');
    if (markingReadKeyByThread()[tid] === requestKey) return;

    setMarkingReadKeyByThread((prev) => ({ ...prev, [tid]: requestKey }));
    try {
      const resp = await fetchGatewayJSON<Readonly<{ read_status: ThreadReadStatus }>>(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/read`,
        {
          method: 'POST',
          body: JSON.stringify({
            snapshot: {
              last_message_at_unix_ms: readStatus.snapshot.last_message_at_unix_ms,
              waiting_prompt_id: readStatus.snapshot.waiting_prompt_id,
            },
          }),
        },
      );
      updateThreadReadStatus(tid, normalizeThreadReadStatus(resp?.read_status, threadById().get(tid) ?? null));
    } catch {
      // Best effort; future list refreshes can retry.
    } finally {
      setMarkingReadKeyByThread((prev) => {
        if (prev[tid] !== requestKey) return prev;
        const next = { ...prev };
        delete next[tid];
        return next;
      });
    }
  };

  const waitingPromptKey = (threadId: string, promptId: string): string => {
    const tid = String(threadId ?? '').trim();
    const pid = String(promptId ?? '').trim();
    if (!tid || !pid) return '';
    return `${tid}\u001f${pid}`;
  };

  const clearPendingWaitingChoicesForThread = (threadId: string, keepPromptId?: string) => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return;
    const keep = String(keepPromptId ?? '').trim();
    setStructuredPromptDraftsByPrompt((prev) => {
      let changed = false;
      const next = { ...prev };
      const prefix = `${tid}\u001f`;
      for (const key of Object.keys(next)) {
        if (!key.startsWith(prefix)) continue;
        if (keep && key === `${prefix}${keep}`) continue;
        delete next[key];
        changed = true;
      }
      return changed ? next : prev;
    });
  };

  const setStructuredPromptDraft = (threadId: string, promptId: string, questionId: string, draft: StructuredPromptAnswerDraft | null) => {
    const key = waitingPromptKey(threadId, promptId);
    const qid = String(questionId ?? '').trim();
    if (!key) return;
    if (!qid) return;
    if (!draft) {
      setStructuredPromptDraftsByPrompt((prev) => {
        const current = prev[key];
        if (!current || !Object.prototype.hasOwnProperty.call(current, qid)) return prev;
        const next = { ...prev };
        const promptDrafts = { ...current };
        delete promptDrafts[qid];
        if (Object.keys(promptDrafts).length === 0) delete next[key];
        else next[key] = promptDrafts;
        return next;
      });
      return;
    }
    const normalized = normalizeAskUserDraft(draft);
    setStructuredPromptDraftsByPrompt((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? {}),
        [qid]: normalized,
      },
    }));
  };

  const getStructuredPromptDrafts = (threadId: string, promptId: string): Record<string, StructuredPromptAnswerDraft> => {
    const key = waitingPromptKey(threadId, promptId);
    if (!key) return {};
    return structuredPromptDraftsByPrompt()[key] ?? {};
  };

  const submitStructuredPromptResponse: AIChatContextValue['submitStructuredPromptResponse'] = async (args) => {
    const tid = String(args.threadId ?? '').trim();
    const promptId = String(args.promptId ?? '').trim();
    if (!tid || !promptId) {
      throw new Error('Missing thread or prompt.');
    }
    const model = resolveThreadModelSelection(tid);
    if (!model) {
      throw new Error('Missing model.');
    }
    const waitingPrompt = waitingPromptForThread(tid);
    const questionById = new Map((waitingPrompt?.questions ?? []).map((question) => [question.id, question] as const));
    const answers: Record<string, { choiceId?: string; text?: string }> = {};
    for (const [questionId, draft] of Object.entries(args.answers ?? {})) {
      const qid = String(questionId ?? '').trim();
      if (!qid) continue;
      const question = questionById.get(qid);
      const normalized = question ? normalizeAskUserDraftForQuestion(question, draft) : normalizeAskUserDraft(draft);
      answers[qid] = {
        choiceId: normalized.choiceId,
        text: normalized.text,
      };
    }

    markThreadPendingRun(tid);
    try {
      try {
        await rpc.ai.subscribeThread({ threadId: tid });
      } catch {
        // Best effort.
      }
      const resp = await rpc.ai.submitStructuredPromptResponse({
        threadId: tid,
        model,
        response: {
          promptId,
          answers,
        },
        input: {
          messageId: String(args.messageId ?? '').trim() || undefined,
          text: String(args.text ?? ''),
          attachments: Array.isArray(args.attachments) ? args.attachments : [],
        },
        options: {
          maxSteps: 10,
          mode: activeThread()?.execution_mode ?? 'act',
        },
        expectedRunId: String(args.expectedRunId ?? '').trim() || undefined,
        sourceFollowupId: String(args.sourceFollowupId ?? '').trim() || undefined,
      });
      const consumedPromptId = String(resp.consumedWaitingPromptId ?? '').trim();
      if (consumedPromptId) {
        consumeWaitingPrompt(tid, consumedPromptId);
      }
      const rid = String(resp.runId ?? '').trim();
      if (rid) {
        confirmThreadRun(tid, rid);
      } else {
        clearThreadPendingRun(tid);
      }
      bumpThreadsSeq();
      return {
        runId: rid || undefined,
        consumedWaitingPromptId: consumedPromptId || undefined,
        appliedExecutionMode: resp.appliedExecutionMode,
      };
    } catch (error) {
      clearThreadPendingRun(tid);
      throw error;
    }
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

  const consumeWaitingPrompt = (threadId: string, promptId: string) => {
    const tid = String(threadId ?? '').trim();
    const pid = String(promptId ?? '').trim();
    if (!tid || !pid) return;

    const current = waitingPromptForThread(tid);
    if (!current || String(current.promptId ?? '').trim() !== pid) return;
    setWaitingPromptByThread((prev) => ({ ...prev, [tid]: null }));
    clearPendingWaitingChoicesForThread(tid);
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

  const isThreadUnread = (threadId: string | null | undefined): boolean => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return false;
    if (tid === String(activeThreadId() ?? '').trim()) return false;
    return threadReadStatusForThread(tid).is_unread;
  };

  const onRealtimeEvent = (handler: (event: AIRealtimeEvent) => void) => {
    realtimeListeners.add(handler);
    return () => {
      realtimeListeners.delete(handler);
    };
  };

  const applyRealtimeEvent = (event: AIRealtimeEvent) => {
    const tid = String(event.threadId ?? '').trim();
    const rid = String(event.runId ?? '').trim();
    if (!tid) return;

    if (event.eventType === 'thread_summary') {
      const status = normalizeThreadRunStatus(event.runStatus);
      const activeRunId = String(event.activeRunId ?? '').trim();
      const lastContextRunId = String(event.lastContextRunId ?? '').trim();
      const waitingPrompt = normalizeWaitingPrompt(event.waitingPrompt);

      if (activeRunId && isActiveRunStatus(status)) {
        setActiveRunByThread((prev) => ({ ...prev, [tid]: activeRunId }));
        clearThreadPendingRun(tid);
      } else {
        setActiveRunByThread((prev) => {
          if (!prev[tid]) return prev;
          const next = { ...prev };
          delete next[tid];
          return next;
        });
        clearThreadPendingRun(tid);
      }
      setThreadLastContextRunId(tid, lastContextRunId);
      if (waitingPrompt) {
        clearPendingWaitingChoicesForThread(tid, waitingPrompt.promptId);
      } else {
        clearPendingWaitingChoicesForThread(tid);
      }
      setWaitingPromptByThread((prev) => ({ ...prev, [tid]: waitingPrompt }));

      bumpThreadsSeq();
      emitRealtimeEvent(event);
      return;
    }

    if (event.eventType === 'transcript_message') {
      // Transcript messages update thread metadata (last message preview / timestamps).
      // Refresh the thread list so sidebar stays in sync without relying on polling.
      bumpThreadsSeq();
      emitRealtimeEvent(event);
      return;
    }

    if (event.eventType === 'stream_event') {
      const streamEvent = event.streamEvent as any;
      const streamType = String(streamEvent?.type ?? '').trim().toLowerCase();
      const streamKind = String(event.streamKind ?? '').trim().toLowerCase();
      if (rid && (streamKind === 'context' || streamType === 'context-usage' || streamType === 'context-compaction')) {
        setThreadLastContextRunId(tid, rid);
      }
      emitRealtimeEvent(event);
      return;
    }

    if (!rid) return;

    const nextStatus = normalizeThreadRunStatus(event.runStatus);
    const waitingPrompt = normalizeWaitingPrompt(event.waitingPrompt);
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
    }
    if (waitingPrompt) {
      clearPendingWaitingChoicesForThread(tid, waitingPrompt.promptId);
    } else {
      clearPendingWaitingChoicesForThread(tid);
    }
    setWaitingPromptByThread((prev) => ({ ...prev, [tid]: waitingPrompt }));

    bumpThreadsSeq();
    emitRealtimeEvent(event);
  };

  createEffect(() => {
    const client = protocol.client();
    if (!client || !canUseFlower() || !aiEnabled()) return;

    let disposed = false;

    const unsub = rpc.ai.onEvent((event) => {
      if (disposed) return;
      applyRealtimeEvent(event);
    });

    void rpc.ai
      .subscribeSummary()
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
      setLastContextRunByThread({});
      setPendingRunByThread({});
      setWaitingPromptByThread({});
      setStructuredPromptDraftsByPrompt({});
    });
  });

  // Poll thread list while there is any active run so sidebar status stays fresh.
  createEffect(() => {
    if (protocol.status() !== 'connected' || !canUseFlower() || !aiEnabled()) return;
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
    setLastContextRunByThread({});
    setPendingRunByThread({});
    setWaitingPromptByThread({});
    setStructuredPromptDraftsByPrompt({});
    setMarkingReadKeyByThread({});
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

    let nextActive: Record<string, string> | null = null;
    let nextPending: Record<string, true> | null = null;

    const clearThread = (tid: string) => {
      if (active[tid]) {
        if (!nextActive) nextActive = { ...active };
        delete nextActive[tid];
      }
      if (pending[tid]) {
        if (!nextPending) nextPending = { ...pending };
        delete nextPending[tid];
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

    if (nextActive) setActiveRunByThread(nextActive);
    if (nextPending) setPendingRunByThread(nextPending);
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

  // Allow external send flows (e.g., Ask Flower composer) to force-focus the newly created thread.
  createEffect(() => {
    const seq = env.aiThreadFocusSeq();
    if (seq <= 0) return;

    const tid = String(env.aiThreadFocusId() ?? '').trim();
    if (!tid) return;

    selectThreadId(tid);
    bumpThreadsSeq();
  });

  createEffect(() => {
    const tid = String(activeThreadId() ?? '').trim();
    if (!tid) return;
    const readStatus = threadReadStatusForThread(tid);
    void markThreadRead(tid, readStatus);
  });

  // Subscribe to full-fidelity events for the currently active thread only.
  //
  // Background threads are tracked via subscribeSummary + thread_summary events to avoid
  // flooding the client with assistant delta frames for threads the user is not viewing.
  let lastSubscribeThreadReq = 0;
  createEffect(() => {
    if (protocol.status() !== 'connected' || !canUseFlower() || !aiEnabled()) return;

    const tid = String(activeThreadId() ?? '').trim();
    if (!tid) return;

    const reqNo = ++lastSubscribeThreadReq;
    void rpc.ai
      .subscribeThread({ threadId: tid })
      .then((resp) => {
        if (reqNo !== lastSubscribeThreadReq) return;
        const rid = String(resp.runId ?? '').trim();
        if (rid) {
          confirmThreadRun(tid, rid);
          return;
        }

        setActiveRunByThread((prev) => {
          if (!prev[tid]) return prev;
          const next = { ...prev };
          delete next[tid];
          return next;
        });
        clearThreadPendingRun(tid);
      })
      .catch(() => {
        // Best-effort: reconnect flow will retry subscription.
      });
  });

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
  const activeThreadWaitingPrompt = createMemo<WaitingPromptView | null>(() => waitingPromptForThread(activeThreadId()));
  const activeThreadModelLocked = createMemo(() => !!activeThread()?.model_locked);

  const resolveThreadModelSelection = (threadId: string | null | undefined): string => {
    if (!modelsReady()) return '';

    const tid = String(threadId ?? '').trim();
    if (!tid) return '';

    const allowed = allowedModelIDs();
    const fallback = fallbackModelId();

    const overrides = threadModelOverride();
    const overridden = String(overrides?.[tid] ?? '').trim();
    if (overridden && allowed.has(overridden)) return overridden;

    const th = threadById().get(tid);
    const server = String(th?.model_id ?? '').trim();
    if (server && allowed.has(server)) return server;

    return fallback;
  };

  // Keep the default model for future chats separate from the active thread model.
  const selectedDefaultModel = createMemo(() => {
    if (!modelsReady()) return '';

    const allowed = allowedModelIDs();
    const draft = String(draftModelId() ?? '').trim();
    if (draft && allowed.has(draft)) return draft;

    return fallbackModelId();
  });

  const selectedThreadModel = createMemo(() => resolveThreadModelSelection(activeThreadId()));
  const selectedSendModel = createMemo(() => {
    const tid = String(activeThreadId() ?? '').trim();
    if (tid) return resolveThreadModelSelection(tid);
    return selectedDefaultModel();
  });

  const patchThreadModel = async (threadId: string, nextModelId: string, prevModelId: string | null, silent?: boolean): Promise<boolean> => {
    const tid = String(threadId ?? '').trim();
    const mid = String(nextModelId ?? '').trim();
    if (!tid || !mid) return false;

    try {
      await fetchGatewayJSON<{ thread: ThreadView }>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ model_id: mid }),
      });
      bumpThreadsSeq();
      return true;
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
      return false;
    }
  };

  const patchCurrentModel = async (nextModelId: string, silent?: boolean): Promise<boolean> => {
    const mid = String(nextModelId ?? '').trim();
    if (!mid) return false;
    try {
      const resp = await fetchGatewayJSON<ModelsResponse>('/_redeven_proxy/api/ai/current_model', {
        method: 'PUT',
        body: JSON.stringify({ model_id: mid }),
      });
      setDraftModelId(mid);
      mutateModels(resp);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!silent) notify.error('Failed to update current model', msg || 'Request failed.');
      return false;
    }
  };

  const selectDefaultModel = (modelID: string) => {
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
    const prev = selectedDefaultModel();
    if (prev === id) return;
    setDraftModelId(id);
    void patchCurrentModel(id, false).then((ok) => {
      if (ok) return;
      setDraftModelId(prev);
    });
  };

  const selectThreadModel = (modelID: string) => {
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
    if (!tid) return;
    if (activeThreadModelLocked()) {
      notify.error('Model locked', 'Restart the thread to switch models.');
      return;
    }
    if (isThreadRunning(tid)) {
      notify.error('Model locked', 'Stop the current run before switching models.');
      return;
    }

    if (protocol.status() !== 'connected') {
      notify.error('Not connected', 'Connecting to runtime...');
      return;
    }

    const prev = resolveThreadModelSelection(tid);
    if (prev === id) return;

    setThreadModelOverride((prevMap) => ({ ...prevMap, [tid]: id }));
    // Thread model changes are intentionally thread-scoped. Do not mutate current_model_id here.
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
    if (th.model_locked) return;

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

  const createThread = async (opts?: { executionMode?: ExecutionMode }): Promise<ThreadView> => {
    const modelID = String(selectedDefaultModel() ?? '').trim();
    const body: any = { title: '' };
    if (modelID) body.model_id = modelID;
    if (opts?.executionMode) body.execution_mode = normalizeExecutionMode(opts.executionMode);
    const workingDir = String(draftWorkingDir() ?? '').trim();
    if (workingDir) body.working_dir = workingDir;
    const resp = await fetchGatewayJSON<CreateThreadResponse>('/_redeven_proxy/api/ai/threads', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return resp.thread;
  };

  const ensureThreadForSend = async (opts?: { executionMode?: ExecutionMode }): Promise<string | null> => {
    if (protocol.status() !== 'connected') {
      notify.error('Not connected', 'Connecting to runtime...');
      return null;
    }
    if (!canUseFlower()) {
      notify.error('Permission denied', 'Read/write/execute permission required.');
      return null;
    }
    if (!aiEnabled() || modelOptions().length === 0) {
      const broker = settings()?.ai_runtime?.desktop_broker;
      const missing = broker?.missing_key_provider_ids?.filter(Boolean) ?? [];
      notify.error(
        'AI not configured',
        missing.length > 0
          ? `Desktop has model providers without API keys: ${missing.join(', ')}. Open Local Environment Settings on this computer.`
          : 'Open Runtime Settings or Local Environment Settings to configure a model.',
      );
      return null;
    }

    const existing = activeThreadId();
    if (existing) {
      setDraftMode(false);
      return existing;
    }

    setCreatingThread(true);
    try {
      const th = await createThread(opts);
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
    selectedDefaultModel,
    selectDefaultModel,
    selectedThreadModel,
    selectThreadModel,
    selectedSendModel,
    activeThreadModelLocked,
    modelOptions,
    modelSourceGroups,
    threads,
    bumpThreadsSeq,
    activeThreadId,
    selectThreadId,
    enterDraftChat,
    clearActiveThreadPersistence,
    activeThread,
    activeThreadWaitingPrompt,
    activeThreadTitle,
    creatingThread,
    ensureThreadForSend,
    draftWorkingDir,
    setDraftWorkingDir,
    runIdForThread,
    lastContextRunIdForThread,
    markThreadPendingRun,
    confirmThreadRun,
    clearThreadPendingRun,
    consumeWaitingPrompt,
    setStructuredPromptDraft,
    getStructuredPromptDrafts,
    submitStructuredPromptResponse,
    isThreadRunning,
    isThreadUnread,
    onRealtimeEvent,
  };
}
