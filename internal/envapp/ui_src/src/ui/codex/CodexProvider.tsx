import {
  type Accessor,
  type ParentProps,
  createContext,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  untrack,
  useContext,
} from 'solid-js';
import { useLayout, useNotification } from '@floegence/floe-webapp-core';

import { useEnvContext } from '../pages/EnvContext';
import type {
  FollowBottomRequest,
  FollowBottomRequestReason,
} from '../chat/scroll/createFollowBottomController';
import {
  archiveCodexThread,
  connectCodexEventStream,
  fetchCodexCapabilities,
  fetchCodexStatus,
  forkCodexThread,
  interruptCodexTurn,
  listCodexThreads,
  markCodexThreadRead,
  openCodexThread,
  respondToCodexRequest,
  startCodexThread,
  startCodexReview,
  startCodexTurn,
} from './api';
import {
  CODEX_NEW_THREAD_OWNER,
  codexOwnerIDForThread,
  createCodexDraftController,
  type CodexRuntimeDraft,
} from './draftController';
import { createCodexThreadController } from './threadController';
import { codexUserInputTextSummary, isWorkingStatus } from './presentation';
import {
  resolveCodexApprovalPolicyValue,
  resolveCodexSandboxModeValue,
} from './runtimeDefaults';
import { codexSupportedReasoningEfforts, codexSupportsOperation } from './viewModel';
import type {
  CodexCapabilitiesSnapshot,
  CodexComposerAttachmentDraft,
  CodexComposerMentionDraft,
  CodexOperationName,
  CodexOptimisticUserTurn,
  CodexPendingRequest,
  CodexStatus,
  CodexThread,
  CodexThreadReadStatus,
  CodexThreadTokenUsage,
  CodexThreadRuntimeConfig,
  CodexTranscriptItem,
  CodexUserInputEntry,
} from './types';

type CodexRequestDrafts = Record<string, Record<string, string>>;
type CodexThreadMap = Record<string, CodexThread>;
type CodexOptimisticTurnMap = Record<string, CodexOptimisticUserTurn[]>;
type CodexScrollToBottomReason = FollowBottomRequestReason;
type CodexScrollIntentPolicy = Omit<FollowBottomRequest, 'seq'>;

function codexScrollIntentPolicy(reason: CodexScrollToBottomReason): CodexScrollIntentPolicy {
  switch (reason) {
    case 'send':
    case 'manual':
      return {
        reason,
        source: 'user',
        behavior: 'smooth',
      };
    case 'bootstrap':
    case 'thread_switch':
    default:
      return {
        reason,
        source: 'system',
        behavior: 'auto',
      };
  }
}

function createDraftEntryID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const value = String(reader.result ?? '').trim();
      if (!value) {
        reject(new Error(`Failed to read ${file.name}`));
        return;
      }
      resolve(value);
    };
    reader.readAsDataURL(file);
  });
}

function threadSortTime(thread: CodexThread): number {
  const updated = Number(thread.updated_at_unix_s ?? 0);
  if (updated > 0) return updated;
  const created = Number(thread.created_at_unix_s ?? 0);
  if (created > 0) return created;
  return 0;
}

type ThreadSortRecord = Readonly<{
  thread: CodexThread;
  canonicalIndex: number;
  sortTime: number;
}>;

function sortThreads(threads: readonly CodexThread[]): CodexThread[] {
  return threads
    .map<ThreadSortRecord>((thread, canonicalIndex) => ({
      thread,
      canonicalIndex,
      sortTime: threadSortTime(thread),
    }))
    .sort((left, right) => {
      const sortDelta = right.sortTime - left.sortTime;
      if (sortDelta !== 0) return sortDelta;
      return left.canonicalIndex - right.canonicalIndex;
    })
    .map((entry) => entry.thread);
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function normalizeThreadFlags(values: readonly string[] | null | undefined): string[] {
  return [...(values ?? [])]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

function sameReadStatus(
  left: CodexThreadReadStatus | null | undefined,
  right: CodexThreadReadStatus | null | undefined,
): boolean {
  const normalizedLeft = normalizeCodexThreadReadStatus(left);
  const normalizedRight = normalizeCodexThreadReadStatus(right);
  return (
    normalizedLeft.is_unread === normalizedRight.is_unread &&
    normalizedLeft.snapshot.updated_at_unix_s === normalizedRight.snapshot.updated_at_unix_s &&
    String(normalizedLeft.snapshot.activity_signature ?? '').trim() === String(normalizedRight.snapshot.activity_signature ?? '').trim() &&
    normalizedLeft.read_state.last_read_updated_at_unix_s === normalizedRight.read_state.last_read_updated_at_unix_s &&
    String(normalizedLeft.read_state.last_seen_activity_signature ?? '').trim() === String(normalizedRight.read_state.last_seen_activity_signature ?? '').trim()
  );
}

function sameTurnSummary(left: CodexThread['turns'], right: CodexThread['turns']): boolean {
  const normalizedLeft = Array.isArray(left) ? left : [];
  const normalizedRight = Array.isArray(right) ? right : [];
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((turn, index) => {
    const other = normalizedRight[index];
    if (!other) return false;
    return (
      String(turn.id ?? '').trim() === String(other.id ?? '').trim() &&
      String(turn.status ?? '').trim() === String(other.status ?? '').trim() &&
      String(turn.error?.message ?? '').trim() === String(other.error?.message ?? '').trim() &&
      (turn.items?.length ?? 0) === (other.items?.length ?? 0)
    );
  });
}

function sameThreadSnapshot(left: CodexThread, right: CodexThread): boolean {
  return (
    String(left.id ?? '').trim() === String(right.id ?? '').trim() &&
    String(left.name ?? '').trim() === String(right.name ?? '').trim() &&
    String(left.preview ?? '').trim() === String(right.preview ?? '').trim() &&
    Boolean(left.ephemeral) === Boolean(right.ephemeral) &&
    String(left.model_provider ?? '').trim() === String(right.model_provider ?? '').trim() &&
    Math.floor(Number(left.created_at_unix_s ?? 0) || 0) === Math.floor(Number(right.created_at_unix_s ?? 0) || 0) &&
    Math.floor(Number(left.updated_at_unix_s ?? 0) || 0) === Math.floor(Number(right.updated_at_unix_s ?? 0) || 0) &&
    String(left.status ?? '').trim() === String(right.status ?? '').trim() &&
    String(left.path ?? '').trim() === String(right.path ?? '').trim() &&
    String(left.cwd ?? '').trim() === String(right.cwd ?? '').trim() &&
    String(left.cli_version ?? '').trim() === String(right.cli_version ?? '').trim() &&
    String(left.source ?? '').trim() === String(right.source ?? '').trim() &&
    String(left.agent_nickname ?? '').trim() === String(right.agent_nickname ?? '').trim() &&
    String(left.agent_role ?? '').trim() === String(right.agent_role ?? '').trim() &&
    sameStringList(normalizeThreadFlags(left.active_flags), normalizeThreadFlags(right.active_flags)) &&
    sameReadStatus(left.read_status, right.read_status) &&
    sameTurnSummary(left.turns, right.turns)
  );
}

function reconcileListedThreads(
  previous: readonly CodexThread[] | null | undefined,
  incoming: readonly CodexThread[],
): CodexThread[] {
  const previousByID = new Map<string, CodexThread>();
  for (const thread of previous ?? []) {
    const threadID = String(thread.id ?? '').trim();
    if (!threadID) continue;
    previousByID.set(threadID, thread);
  }
  return incoming.map((thread) => {
    const threadID = String(thread.id ?? '').trim();
    const existing = previousByID.get(threadID);
    if (!existing) return thread;
    return sameThreadSnapshot(existing, thread) ? existing : thread;
  });
}

function patchThreadDisplayFallbacks(
  thread: CodexThread,
  fallbackPreview?: string,
  fallbackCWD?: string,
  fallbackReadStatus?: CodexThreadReadStatus | null,
): CodexThread {
  const normalizedPreview = String(thread.preview ?? '').trim() || String(fallbackPreview ?? '').trim();
  const normalizedCWD = String(thread.cwd ?? '').trim() || String(fallbackCWD ?? '').trim();
  return {
    ...thread,
    preview: normalizedPreview,
    cwd: normalizedCWD,
    read_status: thread.read_status ?? fallbackReadStatus ?? undefined,
  };
}

function isVisibleThread(thread: CodexThread | null | undefined): boolean {
  return String(thread?.status ?? '').trim().toLowerCase() !== 'archived';
}

function findInterruptibleTurnID(thread: CodexThread | null | undefined): string | null {
  const turns = Array.isArray(thread?.turns) ? thread?.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn) continue;
    if (!isWorkingStatus(String(turn.status ?? '').trim())) continue;
    const turnID = String(turn.id ?? '').trim();
    if (turnID) return turnID;
  }
  return null;
}

function normalizeUserTurnText(value: string | null | undefined): string {
  return String(value ?? '').replaceAll('\r\n', '\n').trim();
}

function optimisticTurnComparableText(turn: CodexOptimisticUserTurn): string {
  const summarizedInputs = codexUserInputTextSummary(turn.inputs);
  if (summarizedInputs) return normalizeUserTurnText(summarizedInputs);
  return normalizeUserTurnText(turn.text);
}

function attachmentSignature(entry: CodexUserInputEntry): string {
  return [
    String(entry.type ?? '').trim(),
    String(entry.url ?? '').trim(),
    String(entry.path ?? '').trim(),
    String(entry.name ?? '').trim(),
  ].join('|');
}

function attachmentSignatures(inputs: readonly CodexUserInputEntry[] | null | undefined): string[] {
  return [...(inputs ?? [])]
    .filter((entry) => String(entry.type ?? '').trim() !== 'text')
    .map((entry) => attachmentSignature(entry))
    .filter(Boolean)
    .sort();
}

function sessionContainsOptimisticTurn(
  currentSession: { items_by_id: Record<string, CodexTranscriptItem> },
  optimisticTurn: CodexOptimisticUserTurn,
): boolean {
  const optimisticText = optimisticTurnComparableText(optimisticTurn);
  const optimisticAttachments = attachmentSignatures(optimisticTurn.inputs);
  return Object.values(currentSession.items_by_id).some((item) => (
    item.type === 'userMessage' &&
    normalizeUserTurnText(item.text) === optimisticText &&
    sameStringList(attachmentSignatures(item.inputs), optimisticAttachments)
  ));
}

function buildOptimisticPlaceholderThread(args: {
  threadID: string;
  preview: string;
  modelProvider: string;
  cwd: string;
}): CodexThread {
  const nowUnixSeconds = Math.floor(Date.now() / 1000);
  return {
    id: args.threadID,
    name: '',
    preview: args.preview,
    ephemeral: false,
    model_provider: args.modelProvider,
    created_at_unix_s: nowUnixSeconds,
    updated_at_unix_s: nowUnixSeconds,
    status: 'active',
    active_flags: [],
    cwd: args.cwd,
  };
}

function statusErrorMessage(status: Accessor<CodexStatus | null | undefined> & { error?: unknown }): string | null {
  const payloadError = String(status()?.error ?? '').trim();
  if (payloadError) return payloadError;
  const err = status.error;
  if (!err) return null;
  return err instanceof Error ? err.message : String(err);
}

function runtimeConfigFromDraft(runtime: CodexRuntimeDraft): CodexThreadRuntimeConfig {
  return {
    cwd: runtime.cwd,
    model: runtime.model,
    reasoning_effort: runtime.effort,
    approval_policy: runtime.approvalPolicy,
    sandbox_mode: runtime.sandboxMode,
  };
}

function defaultRuntimeConfig(args: {
  thread?: CodexThread | null;
  runtimeConfig?: CodexThreadRuntimeConfig | null | undefined;
  fallbackCWD?: string | null | undefined;
}): CodexThreadRuntimeConfig {
  const fallbackCWD = String(args.fallbackCWD ?? '').trim();
  return {
    ...(args.runtimeConfig ?? {}),
    cwd: String(args.runtimeConfig?.cwd ?? args.thread?.cwd ?? fallbackCWD).trim(),
    approval_policy: resolveCodexApprovalPolicyValue(args.runtimeConfig?.approval_policy),
    sandbox_mode: resolveCodexSandboxModeValue(args.runtimeConfig?.sandbox_mode),
  };
}

function runtimeConfigKey(config: CodexThreadRuntimeConfig | null | undefined): string {
  return [
    String(config?.cwd ?? '').trim(),
    String(config?.model ?? '').trim(),
    String(config?.reasoning_effort ?? '').trim(),
    String(config?.approval_policy ?? '').trim(),
    String(config?.sandbox_mode ?? '').trim(),
  ].join('\u0001');
}

function normalizeStatusToken(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll('-', '_')
    .replaceAll(' ', '_')
    .toLowerCase();
}

function codexThreadActivitySignature(args: {
  status: string | null | undefined;
  pendingRequests?: readonly CodexPendingRequest[] | null | undefined;
}): string | undefined {
  const tokens: string[] = [];
  const status = normalizeStatusToken(args.status);
  if (status) {
    tokens.push(`status:${status}`);
  }
  const requestIDs = Array.from(new Set(
    [...(args.pendingRequests ?? [])]
      .map((request) => String(request.id ?? '').trim())
      .filter(Boolean),
  )).sort();
  for (const requestID of requestIDs) {
    tokens.push(`request:${requestID}`);
  }
  return tokens.length > 0 ? tokens.join('\u001f') : undefined;
}

function normalizeCodexThreadReadStatus(
  raw: CodexThreadReadStatus | null | undefined,
  thread?: CodexThread | null | undefined,
  pendingRequests?: readonly CodexPendingRequest[] | null | undefined,
): CodexThreadReadStatus {
  const fallbackSnapshot = {
    updated_at_unix_s: Math.max(0, Math.floor(Number(thread?.updated_at_unix_s ?? 0) || 0)),
    activity_signature: codexThreadActivitySignature({
      status: String(thread?.status ?? '').trim(),
      pendingRequests,
    }),
  };
  const snapshot = {
    updated_at_unix_s: Math.max(
      0,
      Math.floor(Number(raw?.snapshot?.updated_at_unix_s ?? fallbackSnapshot.updated_at_unix_s ?? 0) || 0),
    ),
    activity_signature: String(
      raw?.snapshot?.activity_signature ??
      fallbackSnapshot.activity_signature ??
      '',
    ).trim() || undefined,
  };
  const readState = {
    last_read_updated_at_unix_s: Math.max(
      0,
      Math.floor(Number(raw?.read_state?.last_read_updated_at_unix_s ?? snapshot.updated_at_unix_s ?? 0) || 0),
    ),
    last_seen_activity_signature: String(
      raw?.read_state?.last_seen_activity_signature ??
      snapshot.activity_signature ??
      '',
    ).trim() || undefined,
  };
  const inferredUnread = (
    snapshot.updated_at_unix_s > readState.last_read_updated_at_unix_s ||
    (
      !!snapshot.activity_signature &&
      snapshot.activity_signature !== readState.last_seen_activity_signature &&
      !String(readState.last_seen_activity_signature ?? '').startsWith(`${snapshot.activity_signature}\u001f`)
    )
  );
  return {
    is_unread: Boolean(raw?.is_unread ?? inferredUnread),
    snapshot,
    read_state: readState,
  };
}

function patchCodexThreadReadStatus(thread: CodexThread, readStatus: CodexThreadReadStatus): CodexThread {
  return {
    ...thread,
    read_status: {
      ...readStatus,
      snapshot: { ...readStatus.snapshot },
      read_state: { ...readStatus.read_state },
    },
  };
}

function codexThreadNeedsReadMark(readStatus: CodexThreadReadStatus | null | undefined): boolean {
  if (!readStatus) return false;
  if (readStatus.snapshot.updated_at_unix_s > readStatus.read_state.last_read_updated_at_unix_s) {
    return true;
  }
  if (!readStatus.snapshot.activity_signature) return false;
  if (readStatus.snapshot.activity_signature === readStatus.read_state.last_seen_activity_signature) {
    return false;
  }
  return !String(readStatus.read_state.last_seen_activity_signature ?? '').startsWith(`${readStatus.snapshot.activity_signature}\u001f`);
}

function threadShowsRunningIndicator(
  status: string | null | undefined,
  pendingRequests?: readonly CodexPendingRequest[] | null | undefined,
): boolean {
  const normalized = normalizeStatusToken(status);
  if (isWorkingStatus(normalized)) {
    return true;
  }
  if (normalized.includes('approval') || normalized.includes('waiting') || normalized.includes('input')) {
    return true;
  }
  return (pendingRequests?.length ?? 0) > 0;
}

export type CodexContextValue = Readonly<{
  status: Accessor<CodexStatus | null | undefined>;
  statusLoading: Accessor<boolean>;
  statusError: Accessor<string | null>;
  hasHostBinary: Accessor<boolean>;
  hostDisabledReason: Accessor<string>;
  capabilities: Accessor<CodexCapabilitiesSnapshot | null | undefined>;
  capabilitiesLoading: Accessor<boolean>;
  supportsOperation: (operation: CodexOperationName) => boolean;
  activeThreadID: Accessor<string | null>;
  displayedThreadID: Accessor<string | null>;
  activeThread: Accessor<CodexThread | null>;
  activeRuntimeConfig: Accessor<CodexThreadRuntimeConfig>;
  activeTokenUsage: Accessor<CodexThreadTokenUsage | null | undefined>;
  activeOptimisticUserTurns: Accessor<CodexOptimisticUserTurn[]>;
  activeStatus: Accessor<string>;
  activeStatusFlags: Accessor<string[]>;
  activeInterruptTurnID: Accessor<string | null>;
  threadTitle: Accessor<string>;
  threadLoading: Accessor<boolean>;
  activeThreadError: Accessor<string | null>;
  threads: Accessor<CodexThread[]>;
  threadsLoading: Accessor<boolean>;
  isThreadRunning: (threadID: string | null | undefined) => boolean;
  isThreadUnread: (threadID: string | null | undefined) => boolean;
  transcriptItems: Accessor<CodexTranscriptItem[]>;
  pendingRequests: Accessor<CodexPendingRequest[]>;
  workingDirDraft: Accessor<string>;
  setWorkingDirDraft: (value: string) => void;
  modelDraft: Accessor<string>;
  setModelDraft: (value: string) => void;
  effortDraft: Accessor<string>;
  setEffortDraft: (value: string) => void;
  approvalPolicyDraft: Accessor<string>;
  setApprovalPolicyDraft: (value: string) => void;
  sandboxModeDraft: Accessor<string>;
  setSandboxModeDraft: (value: string) => void;
  attachments: Accessor<CodexComposerAttachmentDraft[]>;
  addImageAttachments: (files: readonly File[]) => Promise<void>;
  removeAttachment: (attachmentID: string) => void;
  mentions: Accessor<CodexComposerMentionDraft[]>;
  addFileMentions: (mentions: ReadonlyArray<{
    name: string;
    path: string;
    is_image: boolean;
  }>) => void;
  removeMention: (mentionID: string) => void;
  composerText: Accessor<string>;
  setComposerText: (value: string) => void;
  resetComposer: () => void;
  submitting: Accessor<boolean>;
  streamError: Accessor<string | null>;
  archivingThreadID: Accessor<string | null>;
  forkingThreadID: Accessor<string | null>;
  interruptingTurnID: Accessor<string | null>;
  reviewingThreadID: Accessor<string | null>;
  requestDraftValue: (requestID: string, questionID: string) => string;
  setRequestDraftValue: (requestID: string, questionID: string, value: string) => void;
  selectThread: (threadID: string) => void;
  startNewThreadDraft: () => void;
  refreshSidebar: () => Promise<void>;
  sendTurn: () => Promise<void>;
  archiveThread: (threadID: string) => Promise<void>;
  archiveActiveThread: () => Promise<void>;
  forkActiveThread: () => Promise<void>;
  interruptActiveTurn: () => Promise<void>;
  reviewActiveThread: () => Promise<void>;
  answerRequest: (request: CodexPendingRequest, decision?: string) => Promise<void>;
  scrollToBottomRequest: Accessor<FollowBottomRequest | null>;
  requestScrollToBottom: (reason?: CodexScrollToBottomReason) => void;
}>;

const CodexContext = createContext<CodexContextValue>();

export function CodexProvider(props: ParentProps) {
  const layout = useLayout();
  const notify = useNotification();
  const env = useEnvContext();

  const threadController = createCodexThreadController();
  const draftController = createCodexDraftController();

  const [optimisticThreadsByID, setOptimisticThreadsByID] = createSignal<CodexThreadMap>({});
  const [optimisticTurnsByThreadID, setOptimisticTurnsByThreadID] = createSignal<CodexOptimisticTurnMap>({});
  const [submitting, setSubmitting] = createSignal(false);
  const [requestDrafts, setRequestDrafts] = createSignal<CodexRequestDrafts>({});
  const [streamError, setStreamError] = createSignal<string | null>(null);
  const [archivingThreadID, setArchivingThreadID] = createSignal<string | null>(null);
  const [forkingThreadID, setForkingThreadID] = createSignal<string | null>(null);
  const [interruptingTurnID, setInterruptingTurnID] = createSignal<string | null>(null);
  const [reviewingThreadID, setReviewingThreadID] = createSignal<string | null>(null);
  const [streamBinding, setStreamBinding] = createSignal<Readonly<{ threadID: string; afterSeq: number }> | null>(null);
  const [scrollToBottomRequest, setScrollToBottomRequest] = createSignal<FollowBottomRequest | null>(null);
  const [markingReadKeyByThread, setMarkingReadKeyByThread] = createSignal<Record<string, string>>({});
  let scrollToBottomRequestSeq = 0;

  const codexVisible = createMemo(() => layout.sidebarActiveTab() === 'codex');

  const requestScrollToBottom = (reason: CodexScrollToBottomReason = 'manual'): void => {
    scrollToBottomRequestSeq += 1;
    const policy = codexScrollIntentPolicy(reason);
    setScrollToBottomRequest({
      seq: scrollToBottomRequestSeq,
      ...policy,
    });
  };

  const [status, { refetch: refetchStatus }] = createResource(
    () => (codexVisible() ? env.settingsSeq() : null),
    async (settingsSeq) => (settingsSeq === null ? null : fetchCodexStatus()),
  );
  const [threadsResource, { refetch: refetchThreads, mutate: mutateThreads }] = createResource<CodexThread[], number | null>(
    () => (codexVisible() && !status.loading && status()?.available ? env.settingsSeq() : null),
    async (settingsSeq, info) => {
      if (settingsSeq == null || !status()?.available) return [];
      const incoming = await listCodexThreads({ limit: 100, archived: false });
      return reconcileListedThreads(Array.isArray(info.value) ? info.value : [], incoming);
    },
  );
  const threadListReady = createMemo(() => {
    if (!codexVisible()) return false;
    if (status.loading) return false;
    if (!status()?.available) return true;
    return threadsResource.state === 'ready' || threadsResource.state === 'refreshing';
  });

  const selectedThreadID = createMemo(() => threadController.selectedThreadID());
  const displayedThreadID = createMemo(() => threadController.displayedThreadID());
  const listedThreadsByID = createMemo(() => {
    const next = new Map<string, CodexThread>();
    for (const thread of threadsResource() ?? []) {
      const threadID = String(thread.id ?? '').trim();
      if (!threadID) continue;
      next.set(threadID, thread);
    }
    return next;
  });

  const allThreads = createMemo<CodexThread[]>(() => {
    const merged = new Map<string, CodexThread>();
    for (const [threadID, thread] of listedThreadsByID()) {
      merged.set(threadID, thread);
    }
    for (const [threadID, thread] of Object.entries(optimisticThreadsByID())) {
      if (!threadID) continue;
      merged.set(threadID, thread);
    }
    const selectedThread = String(selectedThreadID() ?? '').trim();
    const displayedThread = String(displayedThreadID() ?? '').trim();
    for (const entry of Object.values(threadController.sessionEntriesByID())) {
      const thread = entry.session.thread;
      const threadID = String(thread.id ?? '').trim();
      if (!threadID) continue;
      const existing = merged.get(threadID);
      const sessionThread = patchThreadDisplayFallbacks(thread, existing?.preview, existing?.cwd, existing?.read_status ?? null);
      if (!existing) {
        merged.set(threadID, sessionThread);
        continue;
      }
      const pinnedThread = threadID === selectedThread || threadID === displayedThread;
      const existingUpdatedAt = Number(existing.updated_at_unix_s ?? 0) || 0;
      const sessionUpdatedAt = Number(sessionThread.updated_at_unix_s ?? 0) || 0;
      if (pinnedThread || sessionUpdatedAt > existingUpdatedAt) {
        merged.set(threadID, sessionThread);
      }
    }
    return sortThreads(Array.from(merged.values()));
  });

  const threads = createMemo<CodexThread[]>(() => allThreads().filter((thread) => isVisibleThread(thread)));

  const threadReadStatusForThread = (threadID: string | null | undefined): CodexThreadReadStatus => {
    const normalizedThreadID = String(threadID ?? '').trim();
    if (!normalizedThreadID) {
      return normalizeCodexThreadReadStatus(undefined, null);
    }

    const thread = (
      threads().find((entry) => entry.id === normalizedThreadID) ??
      threadController.sessionForThread(normalizedThreadID)?.thread ??
      null
    );
    const session = threadController.sessionForThread(normalizedThreadID);
    const pinnedThread = normalizedThreadID === String(selectedThreadID() ?? '').trim()
      || normalizedThreadID === String(displayedThreadID() ?? '').trim();
    const pendingRequests = pinnedThread ? Object.values(session?.pending_requests ?? {}) : [];
    const status = pinnedThread
      ? String(session?.active_status ?? thread?.status ?? '').trim()
      : String(thread?.status ?? session?.thread.status ?? '').trim();

    return normalizeCodexThreadReadStatus(
      thread?.read_status,
      thread ? {
        ...thread,
        updated_at_unix_s: Math.max(
          0,
          Math.floor(Number(thread?.updated_at_unix_s ?? session?.thread.updated_at_unix_s ?? 0) || 0),
        ),
        status,
      } : null,
      pendingRequests,
    );
  };

  const updateThreadReadStatus = (threadID: string, readStatus: CodexThreadReadStatus): void => {
    const normalizedThreadID = String(threadID ?? '').trim();
    if (!normalizedThreadID) return;
    mutateThreads((current) => (
      Array.isArray(current)
        ? current.map((thread) => (
          String(thread.id ?? '').trim() === normalizedThreadID
            ? patchCodexThreadReadStatus(thread, readStatus)
            : thread
        ))
        : current
    ));
    setOptimisticThreadsByID((current) => {
      const existing = current[normalizedThreadID];
      if (!existing) return current;
      return {
        ...current,
        [normalizedThreadID]: patchCodexThreadReadStatus(existing, readStatus),
      };
    });
    threadController.updateSession(normalizedThreadID, (session) => ({
      ...session,
      thread: patchCodexThreadReadStatus(session.thread, readStatus),
    }));
  };

  const markThreadRead = async (threadID: string, readStatus: CodexThreadReadStatus): Promise<void> => {
    const normalizedThreadID = String(threadID ?? '').trim();
    if (!normalizedThreadID || !codexThreadNeedsReadMark(readStatus)) return;

    const requestKey = [
      normalizedThreadID,
      String(readStatus.snapshot.updated_at_unix_s ?? 0),
      String(readStatus.snapshot.activity_signature ?? '').trim(),
    ].join('\u001f');
    if (markingReadKeyByThread()[normalizedThreadID] === requestKey) return;

    setMarkingReadKeyByThread((current) => ({ ...current, [normalizedThreadID]: requestKey }));
    try {
      const nextReadStatus = await markCodexThreadRead({
        threadID: normalizedThreadID,
        snapshot: readStatus.snapshot,
      });
      updateThreadReadStatus(
        normalizedThreadID,
        normalizeCodexThreadReadStatus(nextReadStatus, threadController.sessionForThread(normalizedThreadID)?.thread ?? null),
      );
    } catch {
      // Best effort; upcoming list/detail refreshes will retry as needed.
    } finally {
      setMarkingReadKeyByThread((current) => {
        if (current[normalizedThreadID] !== requestKey) return current;
        const next = { ...current };
        delete next[normalizedThreadID];
        return next;
      });
    }
  };

  const selectedThread = createMemo<CodexThread | null>(() => {
    const threadID = String(selectedThreadID() ?? '').trim();
    if (!threadID) return null;
    return (
      allThreads().find((thread) => thread.id === threadID) ??
      threadController.sessionForThread(threadID)?.thread ??
      null
    );
  });

  const selectedSession = createMemo(() => {
    const threadID = String(selectedThreadID() ?? '').trim();
    if (!threadID) return null;
    return threadController.sessionForThread(threadID);
  });

  const displayedSession = createMemo(() => threadController.displayedSession());

  const activeOwnerID = createMemo(() => (
    String(selectedThreadID() ?? '').trim()
      ? codexOwnerIDForThread(selectedThreadID())
      : CODEX_NEW_THREAD_OWNER
  ));

  const ownerFallbackRuntimeConfig = createMemo<CodexThreadRuntimeConfig>(() => defaultRuntimeConfig({
    thread: selectedThread(),
    runtimeConfig: selectedSession()?.runtime_config,
    fallbackCWD: status()?.agent_home_dir,
  }));

  createEffect(on(
    () => (codexVisible() ? String(status()?.agent_home_dir ?? '').trim() : ''),
    (agentHomeDir) => {
      if (!codexVisible()) return;
      draftController.ensureOwner(
        CODEX_NEW_THREAD_OWNER,
        { cwd: agentHomeDir },
        agentHomeDir,
      );
    },
  ));

  createEffect(on(
    () => (
      codexVisible()
        ? `${activeOwnerID()}::${runtimeConfigKey(ownerFallbackRuntimeConfig())}`
        : ''
    ),
    (signature) => {
      if (!signature) return;
      const ownerID = activeOwnerID();
      const fallback = ownerFallbackRuntimeConfig();
      draftController.ensureOwner(ownerID, fallback, String(fallback.cwd ?? '').trim());
    },
  ));

  const activeOwnerDraft = createMemo(() => draftController.draftForOwner(
    activeOwnerID(),
    ownerFallbackRuntimeConfig(),
    String(ownerFallbackRuntimeConfig().cwd ?? '').trim(),
  ));

  createEffect(on(
    () => {
      if (!codexVisible()) return '';
      const ownerID = activeOwnerID();
      if (ownerID === CODEX_NEW_THREAD_OWNER) return '';
      return `${ownerID}::${String(ownerFallbackRuntimeConfig().cwd ?? '').trim()}`;
    },
    (signature) => {
      if (!signature) return;
      draftController.commitOwnerRuntimeField(
        activeOwnerID(),
        'cwd',
        String(ownerFallbackRuntimeConfig().cwd ?? '').trim(),
        String(ownerFallbackRuntimeConfig().cwd ?? '').trim(),
      );
    },
  ));

  const activeCapabilitiesCWD = createMemo(() => {
    const ownerDraft = draftController.draftsByOwner()[activeOwnerID()];
    return String(
      ownerDraft?.runtime.cwd ||
      ownerFallbackRuntimeConfig().cwd ||
      status()?.agent_home_dir,
    ).trim();
  });

  const [capabilities, { refetch: refetchCapabilities }] = createResource(
    () => {
      if (!codexVisible() || status.loading || !status()?.available) return null;
      return `${env.settingsSeq()}::${activeCapabilitiesCWD()}`;
    },
    async (key) => fetchCodexCapabilities(String(key ?? '').split('::').slice(1).join('::')),
  );

  createEffect(on(
    () => {
      if (!codexVisible()) return '';
      const effectiveConfig = capabilities()?.effective_config;
      const agentHomeDir = String(status()?.agent_home_dir ?? '').trim();
      return `${agentHomeDir}::${runtimeConfigKey({
        ...(effectiveConfig ?? {}),
        cwd: String(effectiveConfig?.cwd ?? agentHomeDir).trim(),
      })}`;
    },
    (signature) => {
      if (!signature) return;
      const effectiveConfig = capabilities()?.effective_config;
      const agentHomeDir = String(status()?.agent_home_dir ?? '').trim();
      draftController.mergeOwnerRuntimeConfig(
        CODEX_NEW_THREAD_OWNER,
        {
          ...(effectiveConfig ?? {}),
          cwd: String(effectiveConfig?.cwd ?? agentHomeDir).trim(),
        },
        agentHomeDir,
      );
    },
  ));

  createEffect(on(
    () => {
      if (!codexVisible()) return '';
      const ownerDraft = activeOwnerDraft();
      return [
        activeOwnerID(),
        String(ownerDraft.runtime.model ?? '').trim(),
        String(ownerDraft.runtime.effort ?? '').trim(),
        String(ownerDraft.runtime.cwd ?? '').trim(),
        codexSupportedReasoningEfforts(capabilities(), ownerDraft.runtime.model).join(','),
      ].join('\u0001');
    },
    (signature) => {
      if (!signature) return;
      const ownerDraft = activeOwnerDraft();
      const supportedEfforts = codexSupportedReasoningEfforts(capabilities(), ownerDraft.runtime.model);
      if (supportedEfforts.length === 0) return;
      const currentEffort = String(ownerDraft.runtime.effort ?? '').trim();
      if (currentEffort && supportedEfforts.includes(currentEffort)) return;
      draftController.setRuntimeField(
        activeOwnerID(),
        'effort',
        supportedEfforts[0],
        false,
        String(ownerDraft.runtime.cwd ?? '').trim(),
      );
    },
  ));

  const upsertOptimisticThread = (thread: CodexThread | null | undefined, fallbackPreview?: string, fallbackCWD?: string, fallbackReadStatus?: CodexThreadReadStatus | null) => {
    const normalizedThreadID = String(thread?.id ?? '').trim();
    if (!normalizedThreadID || !thread) return;
    const normalizedThread = patchThreadDisplayFallbacks(thread, fallbackPreview, fallbackCWD, fallbackReadStatus);
    setOptimisticThreadsByID((current) => ({
      ...current,
      [normalizedThreadID]: normalizedThread,
    }));
  };

  const removeOptimisticThread = (threadID: string) => {
    const normalizedThreadID = String(threadID ?? '').trim();
    if (!normalizedThreadID) return;
    setOptimisticThreadsByID((current) => {
      if (!(normalizedThreadID in current)) return current;
      const next = { ...current };
      delete next[normalizedThreadID];
      return next;
    });
  };

  const appendOptimisticTurn = (optimisticTurn: CodexOptimisticUserTurn) => {
    const threadID = String(optimisticTurn.thread_id ?? '').trim();
    if (!threadID) return;
    setOptimisticTurnsByThreadID((current) => ({
      ...current,
      [threadID]: [...(current[threadID] ?? []), optimisticTurn],
    }));
  };

  const removeOptimisticTurns = (threadID: string, filterOut: ReadonlySet<string>) => {
    const normalizedThreadID = String(threadID ?? '').trim();
    if (!normalizedThreadID || filterOut.size === 0) return;
    setOptimisticTurnsByThreadID((current) => {
      const existing = current[normalizedThreadID] ?? [];
      const nextTurns = existing.filter((turn) => !filterOut.has(turn.id));
      if (nextTurns.length === existing.length) return current;
      if (nextTurns.length === 0) {
        const next = { ...current };
        delete next[normalizedThreadID];
        return next;
      }
      return {
        ...current,
        [normalizedThreadID]: nextTurns,
      };
    });
  };

  createEffect(() => {
    const currentSession = displayedSession();
    if (!currentSession) return;
    const threadID = String(currentSession.thread.id ?? '').trim();
    const optimisticTurns = optimisticTurnsByThreadID()[threadID] ?? [];
    if (optimisticTurns.length === 0) return;
    const matchedTurnIDs = new Set(
      optimisticTurns
        .filter((optimisticTurn) => sessionContainsOptimisticTurn(currentSession, optimisticTurn))
        .map((optimisticTurn) => optimisticTurn.id),
    );
    removeOptimisticTurns(threadID, matchedTurnIDs);
  });

  const loadThreadBootstrap = async (threadID: string) => {
    const token = threadController.beginThreadBootstrap(threadID);
    if (!token) return;
    try {
      const detail = await openCodexThread(threadID);
      if (!threadController.resolveThreadBootstrap(token, detail)) return;
      upsertOptimisticThread(detail.thread);
      draftController.mergeOwnerRuntimeConfig(
        codexOwnerIDForThread(detail.thread.id),
        {
          ...(detail.runtime_config ?? {}),
          cwd: String(detail.runtime_config?.cwd ?? detail.thread.cwd ?? '').trim(),
        },
        String(detail.runtime_config?.cwd ?? detail.thread.cwd ?? '').trim(),
      );
      setStreamError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!threadController.failThreadBootstrap(token, message)) return;
    }
  };

  createEffect(() => {
    if (!codexVisible()) return;
    const current = selectedThread();
    if (current && isVisibleThread(current)) return;
    const list = threads();
    if (list.length === 0) {
      if (!threadListReady()) return;
      if (threadController.blankDraftActive()) return;
      untrack(() => threadController.startNewThreadDraft());
      return;
    }
    if (threadController.blankDraftActive() && !current) return;
    untrack(() => {
      threadController.selectThread(list[0].id);
      requestScrollToBottom('bootstrap');
    });
  });

  createEffect(on(
    () => (codexVisible() ? String(selectedThreadID() ?? '').trim() : ''),
    (threadID) => {
      if (!threadID) return;
      void untrack(() => loadThreadBootstrap(threadID));
    },
  ));

  createEffect(() => {
    const normalizedThreadID = String(selectedThreadID() ?? '').trim();
    if (!normalizedThreadID) return;
    const readStatus = threadReadStatusForThread(normalizedThreadID);
    void markThreadRead(normalizedThreadID, readStatus);
  });

  createEffect(() => {
    if (!codexVisible()) return;
    const threadID = String(displayedThreadID() ?? '').trim();
    if (!threadID) {
      setStreamBinding(null);
      return;
    }
    const entry = threadController.sessionEntryForThread(threadID);
    if (!entry?.session) return;
    setStreamBinding((current) => {
      if (current?.threadID === threadID) return current;
      return {
        threadID,
        afterSeq: Math.max(0, Number(entry.lastBootstrapSeq ?? entry.session.last_applied_seq ?? 0) || 0),
      };
    });
  });

  createEffect(() => {
    if (!codexVisible()) return;
    const binding = streamBinding();
    if (!binding) return;
    const session = untrack(() => threadController.sessionForThread(binding.threadID));
    if (!session) return;

    const controller = new AbortController();
    const initialSession = session;
    setStreamError(null);
    void connectCodexEventStream({
      threadID: binding.threadID,
      afterSeq: binding.afterSeq,
      signal: controller.signal,
      onEvent: (event) => {
        const nextThread = threadController.applyEventToThread(event, initialSession);
        if (nextThread) {
          upsertOptimisticThread(nextThread);
        }
        if (event.type === 'thread_name_updated') {
          void refetchThreads();
        }
      },
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setStreamError(error instanceof Error ? error.message : String(error));
    });

    onCleanup(() => controller.abort());
  });

  const statusError = createMemo(() => statusErrorMessage(status));
  const hostDisabledReason = createMemo(() => {
    if (status()?.available) return '';
    return statusError() || 'Install `codex` on the host machine and refresh diagnostics.';
  });
  const hasHostBinary = createMemo(() => Boolean(status()?.available));
  const supportsOperation = (operation: CodexOperationName): boolean => codexSupportsOperation(capabilities(), operation);
  const isThreadRunning = (threadID: string | null | undefined): boolean => {
    const normalizedThreadID = String(threadID ?? '').trim();
    if (!normalizedThreadID) return false;
    const thread = (
      threads().find((entry) => entry.id === normalizedThreadID) ??
      threadController.sessionForThread(normalizedThreadID)?.thread ??
      null
    );
    const session = threadController.sessionForThread(normalizedThreadID);
    const pinnedThread = normalizedThreadID === String(selectedThreadID() ?? '').trim()
      || normalizedThreadID === String(displayedThreadID() ?? '').trim();
    const pendingRequests = pinnedThread ? Object.values(session?.pending_requests ?? {}) : [];
    const status = pinnedThread
      ? String(session?.active_status ?? thread?.status ?? '').trim()
      : String(thread?.status ?? session?.thread.status ?? '').trim();
    return threadShowsRunningIndicator(status, pendingRequests);
  };
  const isThreadUnread = (threadID: string | null | undefined): boolean => {
    const normalizedThreadID = String(threadID ?? '').trim();
    if (!normalizedThreadID) return false;
    if (normalizedThreadID === String(selectedThreadID() ?? '').trim()) return false;
    return threadReadStatusForThread(normalizedThreadID).is_unread;
  };
  const hasBackgroundRunningThread = createMemo(() => {
    const excludedThreadIDs = new Set(
      [selectedThreadID(), displayedThreadID()]
        .map((threadID) => String(threadID ?? '').trim())
        .filter(Boolean),
    );
    return threads().some((thread) => {
      const threadID = String(thread.id ?? '').trim();
      if (!threadID || excludedThreadIDs.has(threadID)) return false;
      return isThreadRunning(threadID);
    });
  });

  createEffect(() => {
    if (!codexVisible() || status.loading || !hasHostBinary() || !hasBackgroundRunningThread()) return;
    const timer = window.setInterval(() => {
      void refetchThreads();
    }, 1500);
    onCleanup(() => window.clearInterval(timer));
  });

  const activeThread = createMemo<CodexThread | null>(() => (
    selectedSession()?.thread ??
    selectedThread() ??
    displayedSession()?.thread ??
    null
  ));
  const activeInterruptTurnID = createMemo(() => findInterruptibleTurnID(activeThread()));

  const activeRuntimeConfig = createMemo<CodexThreadRuntimeConfig>(() => (
    selectedSession()?.runtime_config ??
    displayedSession()?.runtime_config ??
    ownerFallbackRuntimeConfig() ??
    {}
  ));

  const activeOptimisticUserTurns = createMemo<CodexOptimisticUserTurn[]>(() => {
    const threadID = String(selectedThreadID() ?? displayedThreadID() ?? '').trim();
    if (!threadID) return [];
    return [...(optimisticTurnsByThreadID()[threadID] ?? [])];
  });

  const activeTokenUsage = createMemo<CodexThreadTokenUsage | null | undefined>(() => (
    displayedSession()?.token_usage ??
    null
  ));

  const activeStatus = createMemo(() => {
    if (threadController.threadLoading()) return 'loading';
    return String(
      displayedSession()?.active_status ??
      activeThread()?.status ??
      '',
    ).trim();
  });

  const activeStatusFlags = createMemo(() => {
    if (threadController.threadLoading()) return [];
    return [
      ...(
        displayedSession()?.active_status_flags ??
        activeThread()?.active_flags ??
        []
      ),
    ];
  });

  const threadTitle = createMemo(() => {
    const thread = activeThread();
    if (!thread) return 'New thread';
    return String(thread.name ?? thread.preview ?? '').trim() || 'Untitled thread';
  });

  const transcriptItems = createMemo<CodexTranscriptItem[]>(() => {
    const current = displayedSession();
    if (!current) return [];
    return current.item_order
      .map((itemID) => current.items_by_id[itemID])
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
  });

  const pendingRequests = createMemo<CodexPendingRequest[]>(() => {
    const current = displayedSession();
    if (!current) return [];
    return Object.values(current.pending_requests);
  });

  const workingDirDraft = createMemo(() => activeOwnerDraft().runtime.cwd);
  const modelDraft = createMemo(() => activeOwnerDraft().runtime.model);
  const effortDraft = createMemo(() => activeOwnerDraft().runtime.effort);
  const approvalPolicyDraft = createMemo(() => activeOwnerDraft().runtime.approvalPolicy);
  const sandboxModeDraft = createMemo(() => activeOwnerDraft().runtime.sandboxMode);
  const attachments = createMemo(() => [...activeOwnerDraft().composer.attachments]);
  const mentions = createMemo(() => [...activeOwnerDraft().composer.mentions]);
  const composerText = createMemo(() => activeOwnerDraft().composer.text);

  const setWorkingDirDraft = (value: string) => {
    if (activeOwnerID() !== CODEX_NEW_THREAD_OWNER) {
      return;
    }
    draftController.setRuntimeField(
      activeOwnerID(),
      'cwd',
      value,
      true,
      String(ownerFallbackRuntimeConfig().cwd ?? '').trim(),
    );
  };

  const setModelDraft = (value: string) => {
    draftController.setRuntimeField(
      activeOwnerID(),
      'model',
      value,
      true,
      String(ownerFallbackRuntimeConfig().cwd ?? '').trim(),
    );
  };

  const setEffortDraft = (value: string) => {
    draftController.setRuntimeField(
      activeOwnerID(),
      'effort',
      value,
      true,
      String(ownerFallbackRuntimeConfig().cwd ?? '').trim(),
    );
  };

  const setApprovalPolicyDraft = (value: string) => {
    draftController.setRuntimeField(
      activeOwnerID(),
      'approvalPolicy',
      value,
      true,
      String(ownerFallbackRuntimeConfig().cwd ?? '').trim(),
    );
  };

  const setSandboxModeDraft = (value: string) => {
    draftController.setRuntimeField(
      activeOwnerID(),
      'sandboxMode',
      value,
      true,
      String(ownerFallbackRuntimeConfig().cwd ?? '').trim(),
    );
  };

  const setComposerDraftText = (value: string) => {
    draftController.setComposerText(activeOwnerID(), value);
  };

  const addFileMentions = (mentionSeeds: ReadonlyArray<{
    name: string;
    path: string;
    is_image: boolean;
  }>) => {
    if (mentionSeeds.length === 0) return;
    const mentionsToAppend: CodexComposerMentionDraft[] = mentionSeeds
      .map((entry) => ({
        id: createDraftEntryID(),
        name: String(entry.name ?? '').trim() || 'File',
        path: String(entry.path ?? '').trim(),
        kind: 'file' as const,
        is_image: Boolean(entry.is_image),
      }))
      .filter((entry) => entry.path);
    if (mentionsToAppend.length === 0) return;
    draftController.appendMentions(activeOwnerID(), mentionsToAppend);
  };

  const addImageAttachments = async (files: readonly File[]) => {
    const inputFiles = Array.from(files ?? []);
    if (inputFiles.length === 0) return;
    const nextAttachments: CodexComposerAttachmentDraft[] = [];
    let rejectedCount = 0;
    for (const file of inputFiles) {
      if (!(file instanceof File) || !String(file.type ?? '').startsWith('image/')) {
        rejectedCount += 1;
        continue;
      }
      try {
        const dataURL = await fileToDataURL(file);
        nextAttachments.push({
          id: createDraftEntryID(),
          name: String(file.name ?? 'Image').trim() || 'Image',
          mime_type: String(file.type ?? 'image/*').trim() || 'image/*',
          size_bytes: Math.max(0, Number(file.size ?? 0) || 0),
          data_url: dataURL,
          preview_url: dataURL,
        });
      } catch (error) {
        notify.error('Attachment failed', error instanceof Error ? error.message : String(error));
      }
    }
    if (rejectedCount > 0) {
      notify.error('Unsupported attachment', 'Codex attachments currently support images only.');
    }
    if (nextAttachments.length > 0) {
      draftController.appendAttachments(activeOwnerID(), nextAttachments);
    }
  };

  const removeAttachment = (attachmentID: string) => {
    draftController.removeAttachment(activeOwnerID(), attachmentID);
  };

  const removeMention = (mentionID: string) => {
    draftController.removeMention(activeOwnerID(), mentionID);
  };

  const resetComposer = () => {
    draftController.resetComposer(activeOwnerID());
  };

  const requestDraftValue = (requestID: string, questionID: string) =>
    requestDrafts()[requestID]?.[questionID] ?? '';

  const setRequestDraftValue = (requestID: string, questionID: string, value: string) => {
    setRequestDrafts((current) => ({
      ...current,
      [requestID]: {
        ...(current[requestID] ?? {}),
        [questionID]: value,
      },
    }));
  };

  const selectThread = (threadID: string) => {
    threadController.selectThread(threadID);
    requestScrollToBottom('thread_switch');
  };

  const startNewThreadDraft = () => {
    if (!hasHostBinary()) return;
    threadController.startNewThreadDraft();
    setStreamError(null);
  };

  const refreshSidebar = async () => {
    try {
      await Promise.all([
        refetchStatus(),
        refetchThreads(),
        refetchCapabilities(),
        String(selectedThreadID() ?? '').trim()
          ? loadThreadBootstrap(String(selectedThreadID() ?? '').trim())
          : Promise.resolve(),
      ]);
    } catch (error) {
      notify.error('Refresh failed', error instanceof Error ? error.message : String(error));
    }
  };

  const sendTurn = async () => {
    const ownerID = activeOwnerID();
    const ownerDraft = activeOwnerDraft();
    const message = String(ownerDraft.composer.text ?? '');
    const attachmentInputs: CodexUserInputEntry[] = ownerDraft.composer.attachments.map((attachment) => ({
      type: 'image',
      url: attachment.data_url,
      name: attachment.name,
    }));
    const mentionInputs: CodexUserInputEntry[] = ownerDraft.composer.mentions.map((mention) => ({
      type: 'mention',
      name: mention.name,
      path: mention.path,
    }));
    const optimisticInputs: CodexUserInputEntry[] = [
      ...(message.trim() ? [{ type: 'text', text: message } satisfies CodexUserInputEntry] : []),
      ...attachmentInputs,
      ...mentionInputs,
    ];
    const optimisticPreview = (
      normalizeUserTurnText(codexUserInputTextSummary(optimisticInputs)) ||
      message.trim() ||
      ownerDraft.composer.mentions[0]?.name ||
      ownerDraft.composer.attachments[0]?.name ||
      ''
    );
    if ((!message.trim() && attachmentInputs.length === 0 && mentionInputs.length === 0) || submitting()) return;
    if (!hasHostBinary()) {
      notify.error('Host Codex not detected', hostDisabledReason());
      return;
    }
    if (String(activeThread()?.status ?? '').trim().toLowerCase() === 'archived') {
      notify.error('Thread archived', 'Archived threads are hidden from the conversation list.');
      return;
    }

    setSubmitting(true);
    let targetThreadID = String(selectedThreadID() ?? '').trim();
    const creatingThread = !targetThreadID;
    let targetOwnerID = ownerID;
    let optimisticTurnID = '';
    try {
      const resolvedWorkingDir = String(
        ownerDraft.runtime.cwd ||
        capabilities()?.effective_config?.cwd ||
        activeRuntimeConfig().cwd ||
        status()?.agent_home_dir,
      ).trim();
      if (!targetThreadID) {
        const detail = await startCodexThread({
          cwd: resolvedWorkingDir,
          model: ownerDraft.runtime.model,
          approval_policy: ownerDraft.runtime.approvalPolicy,
          sandbox_mode: ownerDraft.runtime.sandboxMode,
        });
        targetThreadID = detail.thread.id;
        targetOwnerID = codexOwnerIDForThread(targetThreadID);
        draftController.transferOwner(CODEX_NEW_THREAD_OWNER, targetOwnerID);
        threadController.adoptThreadDetail(detail);
        upsertOptimisticThread(detail.thread, optimisticPreview, resolvedWorkingDir);
        draftController.mergeOwnerRuntimeConfig(
          targetOwnerID,
          {
            ...(detail.runtime_config ?? {}),
            cwd: String(detail.runtime_config?.cwd ?? detail.thread.cwd ?? resolvedWorkingDir).trim(),
          },
          resolvedWorkingDir,
        );
        draftController.commitOwnerRuntimeField(
          targetOwnerID,
          'cwd',
          String(detail.runtime_config?.cwd ?? detail.thread.cwd ?? resolvedWorkingDir).trim(),
          resolvedWorkingDir,
        );
      } else {
        targetOwnerID = codexOwnerIDForThread(targetThreadID);
        const existingThread = (
          allThreads().find((thread) => thread.id === targetThreadID) ??
          activeThread() ??
          buildOptimisticPlaceholderThread({
            threadID: targetThreadID,
            preview: optimisticPreview,
            modelProvider: ownerDraft.runtime.model,
            cwd: resolvedWorkingDir,
          })
        );
        threadController.ensureSessionForThread(existingThread, {
          ...runtimeConfigFromDraft(ownerDraft.runtime),
          cwd: resolvedWorkingDir,
        });
        threadController.selectThread(targetThreadID);
      }

      optimisticTurnID = createDraftEntryID();
      appendOptimisticTurn({
        id: optimisticTurnID,
        thread_id: targetThreadID,
        text: message,
        inputs: optimisticInputs,
      });
      threadController.markSessionWorking(targetThreadID);
      requestScrollToBottom('send');

      await startCodexTurn({
        threadID: targetThreadID,
        inputText: message,
        inputs: [...attachmentInputs, ...mentionInputs],
        cwd: creatingThread ? resolvedWorkingDir : undefined,
        model: ownerDraft.runtime.model,
        effort: ownerDraft.runtime.effort,
        approval_policy: ownerDraft.runtime.approvalPolicy,
        sandbox_mode: ownerDraft.runtime.sandboxMode,
      });

      const currentThread = (
        allThreads().find((thread) => thread.id === targetThreadID) ??
        threadController.sessionForThread(targetThreadID)?.thread ??
        null
      );
      if (currentThread) {
        upsertOptimisticThread(currentThread, optimisticPreview, resolvedWorkingDir);
      } else {
        upsertOptimisticThread(
          buildOptimisticPlaceholderThread({
            threadID: targetThreadID,
            preview: optimisticPreview,
            modelProvider: ownerDraft.runtime.model,
            cwd: resolvedWorkingDir,
          }),
          optimisticPreview,
          resolvedWorkingDir,
        );
      }

      draftController.resetComposer(targetOwnerID);
      void refetchThreads();
      void loadThreadBootstrap(targetThreadID);
      void refetchCapabilities();
    } catch (error) {
      if (targetThreadID && optimisticTurnID) {
        removeOptimisticTurns(targetThreadID, new Set([optimisticTurnID]));
      }
      void refetchThreads();
      if (targetThreadID) {
        void loadThreadBootstrap(targetThreadID);
      }
      notify.error('Send failed', error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const archiveThread = async (threadID: string) => {
    const normalizedThreadID = String(threadID ?? '').trim();
    if (!normalizedThreadID) return;
    if (!hasHostBinary()) {
      notify.error('Host Codex not detected', hostDisabledReason());
      return;
    }
    if (!supportsOperation('thread_archive')) {
      notify.error('Action unavailable', 'This Codex host does not support thread archiving from Redeven yet.');
      return;
    }
    setArchivingThreadID(normalizedThreadID);
    try {
      await archiveCodexThread(normalizedThreadID);
      removeOptimisticThread(normalizedThreadID);
      removeOptimisticTurns(
        normalizedThreadID,
        new Set((optimisticTurnsByThreadID()[normalizedThreadID] ?? []).map((turn) => turn.id)),
      );
      draftController.removeOwner(codexOwnerIDForThread(normalizedThreadID));
      threadController.removeThreadState(normalizedThreadID);
      notify.success('Archived', 'The Codex thread has been archived.');
      await refetchThreads();
    } catch (error) {
      notify.error('Archive failed', error instanceof Error ? error.message : String(error));
    } finally {
      setArchivingThreadID((current) => (current === normalizedThreadID ? null : current));
    }
  };

  const archiveActiveThread = async () => {
    await archiveThread(String(selectedThreadID() ?? '').trim());
  };

  const forkActiveThread = async () => {
    const threadID = String(selectedThreadID() ?? '').trim();
    if (!threadID) return;
    if (!hasHostBinary()) {
      notify.error('Host Codex not detected', hostDisabledReason());
      return;
    }
    if (!supportsOperation('thread_fork')) {
      notify.error('Action unavailable', 'This Codex host does not support thread fork from Redeven yet.');
      return;
    }
    setForkingThreadID(threadID);
    try {
      const ownerDraft = activeOwnerDraft();
      const detail = await forkCodexThread({
        thread_id: threadID,
        model: ownerDraft.runtime.model,
        approval_policy: ownerDraft.runtime.approvalPolicy,
        sandbox_mode: ownerDraft.runtime.sandboxMode,
        approvals_reviewer: String(activeRuntimeConfig().approvals_reviewer ?? '').trim(),
      });
      threadController.adoptThreadDetail(detail);
      upsertOptimisticThread(detail.thread);
      draftController.mergeOwnerRuntimeConfig(
        codexOwnerIDForThread(detail.thread.id),
        {
          ...(detail.runtime_config ?? {}),
          cwd: String(detail.runtime_config?.cwd ?? detail.thread.cwd ?? '').trim(),
        },
        String(detail.runtime_config?.cwd ?? detail.thread.cwd ?? '').trim(),
      );
      requestScrollToBottom('bootstrap');
      notify.success('Forked', 'Started a new Codex thread from the current conversation.');
      await refetchThreads();
    } catch (error) {
      notify.error('Fork failed', error instanceof Error ? error.message : String(error));
    } finally {
      setForkingThreadID((current) => (current === threadID ? null : current));
    }
  };

  const interruptActiveTurn = async () => {
    const threadID = String(selectedThreadID() ?? '').trim();
    const turnID = String(activeInterruptTurnID() ?? '').trim();
    if (!threadID || !turnID) return;
    if (!hasHostBinary()) {
      notify.error('Host Codex not detected', hostDisabledReason());
      return;
    }
    if (!supportsOperation('turn_interrupt')) {
      notify.error('Action unavailable', 'This Codex host does not support turn interruption from Redeven yet.');
      return;
    }
    setInterruptingTurnID(turnID);
    try {
      await interruptCodexTurn({
        thread_id: threadID,
        turn_id: turnID,
      });
      notify.success('Interrupted', 'Requested Codex to stop the active turn.');
    } catch (error) {
      notify.error('Interrupt failed', error instanceof Error ? error.message : String(error));
    } finally {
      setInterruptingTurnID((current) => (current === turnID ? null : current));
    }
  };

  const reviewActiveThread = async () => {
    const threadID = String(selectedThreadID() ?? '').trim();
    if (!threadID) return;
    if (!hasHostBinary()) {
      notify.error('Host Codex not detected', hostDisabledReason());
      return;
    }
    if (!supportsOperation('review_start')) {
      notify.error('Action unavailable', 'This Codex host does not support inline review from Redeven yet.');
      return;
    }
    if (String(activeThread()?.status ?? '').trim().toLowerCase() === 'archived') {
      notify.error('Thread archived', 'Archived threads are hidden from the conversation list.');
      return;
    }
    setReviewingThreadID(threadID);
    try {
      const detail = await startCodexReview({
        thread_id: threadID,
        target: 'uncommitted_changes',
      });
      threadController.adoptThreadDetail(detail);
      upsertOptimisticThread(detail.thread);
      requestScrollToBottom('send');
      notify.success('Review started', 'Codex is reviewing the current workspace changes.');
      await refetchThreads();
    } catch (error) {
      notify.error('Review failed', error instanceof Error ? error.message : String(error));
    } finally {
      setReviewingThreadID((current) => (current === threadID ? null : current));
    }
  };

  const answerRequest = async (request: CodexPendingRequest, decision?: string) => {
    try {
      await respondToCodexRequest({
        threadID: request.thread_id,
        requestID: request.id,
        type: request.type,
        decision,
        answers: request.type === 'user_input' ? requestDrafts()[request.id] ?? {} : undefined,
      });
      notify.success('Submitted', 'Codex request response sent.');
    } catch (error) {
      notify.error('Request failed', error instanceof Error ? error.message : String(error));
    }
  };

  const value: CodexContextValue = {
    status,
    statusLoading: () => status.loading,
    statusError,
    hasHostBinary,
    hostDisabledReason,
    capabilities,
    capabilitiesLoading: () => capabilities.loading,
    supportsOperation,
    activeThreadID: selectedThreadID,
    displayedThreadID,
    activeThread,
    activeRuntimeConfig,
    activeOptimisticUserTurns,
    activeTokenUsage,
    activeStatus,
    activeStatusFlags,
    activeInterruptTurnID,
    threadTitle,
    threadLoading: () => threadController.threadLoading(),
    activeThreadError: () => threadController.activeThreadError(),
    threads: () => threads() ?? [],
    threadsLoading: () => threadsResource.loading,
    isThreadRunning,
    isThreadUnread,
    transcriptItems,
    pendingRequests,
    workingDirDraft,
    setWorkingDirDraft,
    modelDraft,
    setModelDraft,
    effortDraft,
    setEffortDraft,
    approvalPolicyDraft,
    setApprovalPolicyDraft,
    sandboxModeDraft,
    setSandboxModeDraft,
    attachments,
    addImageAttachments,
    removeAttachment,
    mentions,
    addFileMentions,
    removeMention,
    composerText,
    setComposerText: setComposerDraftText,
    resetComposer,
    submitting,
    streamError,
    archivingThreadID,
    forkingThreadID,
    interruptingTurnID,
    reviewingThreadID,
    requestDraftValue,
    setRequestDraftValue,
    selectThread,
    startNewThreadDraft,
    refreshSidebar,
    sendTurn,
    archiveThread,
    archiveActiveThread,
    forkActiveThread,
    interruptActiveTurn,
    reviewActiveThread,
    answerRequest,
    scrollToBottomRequest,
    requestScrollToBottom,
  };

  return <CodexContext.Provider value={value}>{props.children}</CodexContext.Provider>;
}

export function useCodexContext(): CodexContextValue {
  const value = useContext(CodexContext);
  if (!value) {
    throw new Error('CodexProvider is required.');
  }
  return value;
}
