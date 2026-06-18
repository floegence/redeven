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
import { useRedevenRpc, type AIRealtimeEvent, type AIRequestUserInputPrompt } from '../protocol/redeven_v1';
import { useEnvContext } from './EnvContext';
import { fetchLocalApiJSON } from '../services/localApi';
import {
  readRendererScopedUIStorageItem,
  removeRendererScopedUIStorageItem,
  writeRendererScopedUIStorageItem,
} from '../services/uiStorage';
import { hasRWXPermissions } from './aiPermissions';
import {
  normalizeAskUserQuestions,
  type AskUserAction,
  type AskUserChoice,
  type AskUserQuestion,
} from '../chat/askUserContract';

// ---- API response types (shared between sidebar and main page) ----

export type ModelsResponse = Readonly<{
  current_model: string;
  models: AIModelResponseItem[];
  runtime?: AIRuntimeStatus | null;
}>;

export type AIModelResponseItem = Readonly<{
  id: string;
  label?: string;
  source?: string;
  source_label?: string;
  context_window?: number;
  max_output_tokens?: number;
  input_modalities?: string[];
  supports_image_input?: boolean;
}>;

export type AIModelSourceKey = 'runtime_config' | 'desktop_model_source';

export type AIModelOption = Readonly<{
  value: string;
  label: string;
  source: AIModelSourceKey;
  sourceLabel: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities: readonly string[];
  supportsImageInput: boolean;
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
  desktop_model_source?: Readonly<{
    binding_state?: string;
    connected?: boolean;
    available?: boolean;
    model_source?: string;
    session_id?: string;
    expires_at_unix_ms?: number;
    connected_at_unix_ms?: number;
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
  toolName: string;
  reasonCode?: string;
  requiredFromUser?: string[];
  evidenceRefs?: string[];
  publicSummary?: string;
  containsSecret?: boolean;
  questions?: WaitingPromptQuestionView[];
}>;

export type ThreadReadSnapshot = Readonly<{
  activity_revision: number;
  last_message_at_unix_ms: number;
  activity_signature: string;
  waiting_prompt_id?: string;
}>;

export type ThreadReadState = Readonly<{
  last_seen_activity_revision: number;
  last_read_message_at_unix_ms: number;
  last_seen_activity_signature: string;
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
  pinned_at_unix_ms?: number;
  queued_turn_count?: number;
  run_status?: ThreadRunStatus;
  run_updated_at_unix_ms?: number;
  run_error_code?: string;
  run_error?: string;
  waiting_prompt?: unknown;
  last_context_run_id?: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  last_message_at_unix_ms: number;
  last_message_preview: string;
  read_status: ThreadReadStatus;
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

function threadIsWaitingUser(thread: ThreadView | null | undefined): boolean {
  return normalizeThreadRunStatus(thread?.run_status) === 'waiting_user';
}

function normalizeWaitingPromptForThread(thread: ThreadView | null | undefined): WaitingPromptView | null {
  if (!threadIsWaitingUser(thread)) return null;
  return normalizeWaitingPrompt((thread as any)?.waiting_prompt);
}

function normalizeWaitingPrompt(raw: any): WaitingPromptView | null {
  if (!raw || typeof raw !== 'object') return null;
  const promptID = String((raw as any).prompt_id ?? '').trim();
  const messageID = String((raw as any).message_id ?? '').trim();
  const toolID = String((raw as any).tool_id ?? '').trim();
  const toolName = String((raw as any).tool_name ?? '').trim();
  if (!promptID || !messageID || !toolID || !toolName) return null;
  const questions = normalizeAskUserQuestions((raw as any).questions);
  return {
    promptId: promptID,
    messageId: messageID,
    toolId: toolID,
    toolName,
    reasonCode: String((raw as any).reason_code ?? '').trim() || undefined,
    requiredFromUser: Array.isArray((raw as any).required_from_user)
      ? (raw as any).required_from_user.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
      : undefined,
    evidenceRefs: Array.isArray((raw as any).evidence_refs)
      ? (raw as any).evidence_refs.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
      : undefined,
    publicSummary: String((raw as any).public_summary ?? '').trim() || undefined,
    containsSecret: Boolean((raw as any).contains_secret),
    questions: questions.length > 0 ? questions : undefined,
  };
}

function normalizeProtocolWaitingPrompt(raw: AIRequestUserInputPrompt | undefined): WaitingPromptView | null {
  if (!raw) return null;
  const promptID = String(raw.promptId ?? '').trim();
  const messageID = String(raw.messageId ?? '').trim();
  const toolID = String(raw.toolId ?? '').trim();
  const toolName = String(raw.toolName ?? '').trim();
  if (!promptID || !messageID || !toolID || !toolName) return null;
  const questions = Array.isArray(raw.questions)
    ? raw.questions.map((item): WaitingPromptQuestionView | null => {
        const id = String(item?.id ?? '').trim();
        const header = String(item?.header ?? '').trim();
        const question = String(item?.question ?? '').trim();
        const responseMode = item?.responseMode;
        if (!id || !header || !question || (
          responseMode !== 'select' &&
          responseMode !== 'write' &&
          responseMode !== 'select_or_write'
        )) {
          return null;
        }
        const choices = Array.isArray(item.choices)
          ? item.choices.map((choice): WaitingPromptChoiceView | null => {
              const choiceId = String(choice?.choiceId ?? '').trim();
              const label = String(choice?.label ?? '').trim();
              if (!choiceId || !label || choice?.kind !== 'select') return null;
              const actions = Array.isArray(choice.actions)
                ? choice.actions.map((action): WaitingPromptActionView | null => {
                    const type = String(action?.type ?? '').trim().toLowerCase();
                    if (!type) return null;
                    const mode = action?.mode === 'plan' ? 'plan' : action?.mode === 'act' ? 'act' : undefined;
                    return { type, mode };
                  }).filter((action): action is WaitingPromptActionView => action !== null)
                : [];
              return {
                choiceId,
                label,
                description: String(choice.description ?? '').trim() || undefined,
                kind: 'select',
                actions: actions.length > 0 ? actions : undefined,
              };
            }).filter((choice): choice is WaitingPromptChoiceView => choice !== null)
          : [];
        if (responseMode === 'write' && choices.length > 0) return null;
        if ((responseMode === 'select' || responseMode === 'select_or_write') && choices.length === 0) return null;
        if (responseMode === 'select_or_write' && (!String(item.writeLabel ?? '').trim() || !String(item.writePlaceholder ?? '').trim())) return null;
        return {
          id,
          header,
          question,
          isSecret: Boolean(item.isSecret),
          responseMode,
          writeLabel: String(item.writeLabel ?? '').trim() || undefined,
          writePlaceholder: String(item.writePlaceholder ?? '').trim() || undefined,
          choices,
        };
      }).filter((question): question is WaitingPromptQuestionView => question !== null)
    : [];
  if (questions.length === 0) return null;
  return {
    promptId: promptID,
    messageId: messageID,
    toolId: toolID,
    toolName,
    reasonCode: String(raw.reasonCode ?? '').trim() || undefined,
    requiredFromUser: Array.isArray(raw.requiredFromUser)
      ? raw.requiredFromUser.map((item) => String(item ?? '').trim()).filter(Boolean)
      : undefined,
    evidenceRefs: Array.isArray(raw.evidenceRefs)
      ? raw.evidenceRefs.map((item) => String(item ?? '').trim()).filter(Boolean)
      : undefined,
    publicSummary: String(raw.publicSummary ?? '').trim() || undefined,
    containsSecret: Boolean(raw.containsSecret),
    questions,
  };
}

function normalizeNonNegativeInteger(raw: unknown, field: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`AI thread read_status.${field} must be a non-negative number.`);
  }
  return Math.floor(value);
}

function normalizeThreadReadStatus(raw: any): ThreadReadStatus {
  const snapshotRaw = raw && typeof raw === 'object' ? (raw as any).snapshot : null;
  const readStateRaw = raw && typeof raw === 'object' ? (raw as any).read_state : null;
  if (!snapshotRaw || typeof snapshotRaw !== 'object') {
    throw new Error('AI thread read_status.snapshot is required.');
  }
  if (!readStateRaw || typeof readStateRaw !== 'object') {
    throw new Error('AI thread read_status.read_state is required.');
  }
  const activitySignature = String(snapshotRaw.activity_signature ?? '').trim();
  if (!activitySignature) {
    throw new Error('AI thread read_status.snapshot.activity_signature is required.');
  }
  const lastSeenActivitySignature = String(readStateRaw.last_seen_activity_signature ?? '').trim();
  if (typeof readStateRaw.last_seen_activity_signature !== 'string') {
    throw new Error('AI thread read_status.read_state.last_seen_activity_signature must be a string.');
  }
  const snapshot: ThreadReadSnapshot = {
    activity_revision: normalizeNonNegativeInteger(snapshotRaw.activity_revision, 'snapshot.activity_revision'),
    last_message_at_unix_ms: normalizeNonNegativeInteger(snapshotRaw.last_message_at_unix_ms, 'snapshot.last_message_at_unix_ms'),
    activity_signature: activitySignature,
    waiting_prompt_id: String(snapshotRaw.waiting_prompt_id ?? '').trim() || undefined,
  };
  const readState: ThreadReadState = {
    last_seen_activity_revision: normalizeNonNegativeInteger(readStateRaw.last_seen_activity_revision, 'read_state.last_seen_activity_revision'),
    last_read_message_at_unix_ms: normalizeNonNegativeInteger(readStateRaw.last_read_message_at_unix_ms, 'read_state.last_read_message_at_unix_ms'),
    last_seen_activity_signature: lastSeenActivitySignature,
    last_seen_waiting_prompt_id: String(readStateRaw.last_seen_waiting_prompt_id ?? '').trim() || undefined,
  };
  return {
    is_unread: raw.is_unread === true,
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

const MODEL_SOURCE_ORDER: readonly AIModelSourceKey[] = ['runtime_config', 'desktop_model_source'];

function normalizeAIModelSource(raw: unknown): AIModelSourceKey {
  return String(raw ?? '').trim() === 'desktop_model_source' ? 'desktop_model_source' : 'runtime_config';
}

function defaultModelSourceLabel(source: AIModelSourceKey): string {
  return source === 'desktop_model_source' ? 'Desktop' : 'Runtime config';
}

function finiteInteger(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : undefined;
}

function normalizeStringList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function normalizeModelResponseItem(raw: unknown): AIModelResponseItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = String(item.id ?? '').trim();
  if (!id) return null;
  const inputModalities = normalizeStringList(item.input_modalities);
  return {
    id,
    label: String(item.label ?? '').trim() || undefined,
    source: String(item.source ?? '').trim() || undefined,
    source_label: String(item.source_label ?? '').trim() || undefined,
    context_window: finiteInteger(item.context_window),
    max_output_tokens: finiteInteger(item.max_output_tokens),
    input_modalities: inputModalities.length > 0 ? inputModalities : undefined,
    supports_image_input: typeof item.supports_image_input === 'boolean' ? item.supports_image_input : undefined,
  };
}

export function normalizeModelsResponse(raw: unknown): ModelsResponse {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    current_model: String(data.current_model ?? '').trim(),
    models: Array.isArray(data.models)
      ? data.models.map(normalizeModelResponseItem).filter((item): item is AIModelResponseItem => item !== null)
      : [],
    runtime: data.runtime && typeof data.runtime === 'object' ? data.runtime as AIRuntimeStatus : null,
  };
}

function threadNeedsReadMark(readStatus: ThreadReadStatus | null | undefined): boolean {
  if (!readStatus) return false;
  return readStatus.is_unread === true;
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
  selectedCurrentModel: Accessor<string>;
  selectCurrentModel: (modelID: string) => void;
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
    async (k) => (k == null ? null : await fetchLocalApiJSON<SettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' })),
  );
  const aiEnabled = createMemo(() => {
    const s = settings();
    if (!s) return false;
    if (s.ai) return true;
    return !!s.ai_runtime?.desktop_model_source?.connected;
  });

  // Models resource
  const modelsKey = createMemo<number | null>(() => {
    if (settingsKey() == null) return null;
    if (!aiEnabled()) return null;
    return env.settingsSeq();
  });

  const [models, { mutate: mutateModels }] = createResource<ModelsResponse | null, number | null>(
    () => modelsKey(),
    async (k) =>
      k == null
        ? null
        : normalizeModelsResponse(
            await fetchLocalApiJSON<unknown>('/_redeven_proxy/api/ai/models', { method: 'GET' }),
          ),
  );

  const modelsReady = createMemo(() => !!models() && !models.loading && !models.error);

  const [draftCurrentModelId, setDraftCurrentModelId] = createSignal<string>('');
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

  const validCurrentModelId = createMemo(() => {
    const m = models();
    if (!m) return '';
    const allowed = allowedModelIDs();
    const current = String(m.current_model ?? '').trim();
    if (current && allowed.has(current)) return current;
    return '';
  });

  // Keep the draft model aligned with the explicit current_model contract.
  createEffect(() => {
    if (!modelsReady()) return;
    const allowed = allowedModelIDs();
    const current = String(draftCurrentModelId() ?? '').trim();
    if (current && allowed.has(current)) return;
    const next = validCurrentModelId();
    setDraftCurrentModelId(next);
  });

  const modelOptions = createMemo<AIModelOption[]>(() => {
    const m = models();
    if (!m) return [];
    return m.models.map((it) => {
      const value = it.id;
      const source = normalizeAIModelSource(it.source);
      const inputModalities = it.input_modalities ?? ['text'];
      return {
        value,
        label: it.label ?? value,
        source,
        sourceLabel: it.source_label ?? defaultModelSourceLabel(source),
        contextWindow: it.context_window,
        maxOutputTokens: it.max_output_tokens,
        inputModalities,
        supportsImageInput: it.supports_image_input === true || inputModalities.includes('image'),
      };
    }).filter((it) => it.value !== '');
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
        : await fetchLocalApiJSON<ListThreadsResponse>('/_redeven_proxy/api/ai/threads?limit=200', {
            method: 'GET',
          }),
  );

  const [activeRunByThread, setActiveRunByThread] = createSignal<Record<string, string>>({});
  const [lastContextRunByThread, setLastContextRunByThread] = createSignal<Record<string, string>>({});
  const [pendingRunByThread, setPendingRunByThread] = createSignal<Record<string, true>>({});
  const [waitingPromptByThread, setWaitingPromptByThread] = createSignal<Record<string, WaitingPromptView | null>>({});
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

    return normalizeWaitingPromptForThread(threadById().get(tid));
  };

  const threadReadStatusForThread = (threadId: string | null | undefined): ThreadReadStatus | null => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return null;

    const thread = threadById().get(tid);
    if (!thread) return null;
    return normalizeThreadReadStatus(thread.read_status);
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
      String(readStatus.snapshot.activity_revision ?? 0),
      String(readStatus.snapshot.last_message_at_unix_ms ?? 0),
      String(readStatus.snapshot.activity_signature ?? '').trim(),
      String(readStatus.snapshot.waiting_prompt_id ?? '').trim(),
    ].join('\u001f');
    if (markingReadKeyByThread()[tid] === requestKey) return;

    setMarkingReadKeyByThread((prev) => ({ ...prev, [tid]: requestKey }));
    try {
      const resp = await fetchLocalApiJSON<Readonly<{ read_status: ThreadReadStatus }>>(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/read`,
        {
          method: 'POST',
          body: JSON.stringify({
            snapshot: {
              activity_revision: readStatus.snapshot.activity_revision,
              last_message_at_unix_ms: readStatus.snapshot.last_message_at_unix_ms,
              activity_signature: readStatus.snapshot.activity_signature,
              waiting_prompt_id: readStatus.snapshot.waiting_prompt_id,
            },
          }),
        },
      );
      updateThreadReadStatus(tid, normalizeThreadReadStatus(resp?.read_status));
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
    return threadReadStatusForThread(tid)?.is_unread ?? false;
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
      const waitingPrompt = status === 'waiting_user' ? normalizeProtocolWaitingPrompt(event.waitingPrompt) : null;

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
    const waitingPrompt = nextStatus === 'waiting_user' ? normalizeProtocolWaitingPrompt(event.waitingPrompt) : null;
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
    setDraftWorkingDir('');
  };

  createEffect(() => {
    const tid = String(activeThreadId() ?? '').trim();
    if (!tid) return;
    const readStatus = threadReadStatusForThread(tid);
    if (!readStatus) return;
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
    const currentDefault = validCurrentModelId();

    const overrides = threadModelOverride();
    const overridden = String(overrides?.[tid] ?? '').trim();
    if (overridden && allowed.has(overridden)) return overridden;

    const th = threadById().get(tid);
    const server = String(th?.model_id ?? '').trim();
    if (server && allowed.has(server)) return server;

    return currentDefault;
  };

  // Keep the current model for draft chats separate from the active thread model.
  const selectedCurrentModel = createMemo(() => {
    if (!modelsReady()) return '';

    const allowed = allowedModelIDs();
    const draft = String(draftCurrentModelId() ?? '').trim();
    if (draft && allowed.has(draft)) return draft;

    return validCurrentModelId();
  });

  const selectedThreadModel = createMemo(() => resolveThreadModelSelection(activeThreadId()));
  const selectedSendModel = createMemo(() => {
    const tid = String(activeThreadId() ?? '').trim();
    if (tid) return resolveThreadModelSelection(tid);
    return selectedCurrentModel();
  });

  const patchThreadModel = async (threadId: string, nextModelId: string, prevModelId: string | null, silent?: boolean): Promise<boolean> => {
    const tid = String(threadId ?? '').trim();
    const mid = String(nextModelId ?? '').trim();
    if (!tid || !mid) return false;

    try {
      await fetchLocalApiJSON<{ thread: ThreadView }>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, {
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
      const resp = normalizeModelsResponse(
        await fetchLocalApiJSON<unknown>('/_redeven_proxy/api/ai/current_model', {
          method: 'PUT',
          body: JSON.stringify({ model_id: mid }),
        }),
      );
      setDraftCurrentModelId(mid);
      mutateModels(resp);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!silent) notify.error('Failed to update current model', msg || 'Request failed.');
      return false;
    }
  };

  const selectCurrentModel = (modelID: string) => {
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
    const prev = selectedCurrentModel();
    if (prev === id) return;
    setDraftCurrentModelId(id);
    void patchCurrentModel(id, false).then((ok) => {
      if (ok) return;
      setDraftCurrentModelId(prev);
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

  // Auto-heal invalid/missing thread model_id only to the explicit current config default.
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

    const desired = String(validCurrentModelId() ?? '').trim();
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
    const modelID = String(selectedCurrentModel() ?? '').trim();
    const body: any = { title: '' };
    if (modelID) body.model_id = modelID;
    if (opts?.executionMode) body.execution_mode = normalizeExecutionMode(opts.executionMode);
    const workingDir = String(draftWorkingDir() ?? '').trim();
    if (workingDir) body.working_dir = workingDir;
    const resp = await fetchLocalApiJSON<CreateThreadResponse>('/_redeven_proxy/api/ai/threads', {
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
      const modelSource = settings()?.ai_runtime?.desktop_model_source;
      const missing = modelSource?.missing_key_provider_ids?.filter(Boolean) ?? [];
      notify.error(
        'AI not configured',
        missing.length > 0
          ? `Desktop has model providers without API keys: ${missing.join(', ')}. Open Local Environment Settings on this computer.`
          : 'Open Local Environment Settings on this computer to configure the Local AI Profile.',
      );
      return null;
    }

    const existing = activeThreadId();
    if (existing) {
      setDraftMode(false);
      return existing;
    }
    if (!String(selectedCurrentModel() ?? '').trim()) {
      notify.error('Missing model', 'Select a Current Model before starting a chat.');
      return null;
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
    selectedCurrentModel,
    selectCurrentModel,
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
    isThreadRunning,
    isThreadUnread,
    onRealtimeEvent,
  };
}
