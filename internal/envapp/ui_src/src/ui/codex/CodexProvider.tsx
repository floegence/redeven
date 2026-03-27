import {
  type Accessor,
  type ParentProps,
  createContext,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  useContext,
} from 'solid-js';
import { useLayout, useNotification } from '@floegence/floe-webapp-core';

import { useEnvContext } from '../pages/EnvContext';
import {
  archiveCodexThread,
  connectCodexEventStream,
  fetchCodexCapabilities,
  fetchCodexStatus,
  listCodexThreads,
  openCodexThread,
  respondToCodexRequest,
  startCodexThread,
  startCodexTurn,
} from './api';
import { applyCodexEvent, buildCodexThreadSession } from './state';
import { codexSupportedReasoningEfforts } from './viewModel';
import type {
  CodexCapabilitiesSnapshot,
  CodexComposerAttachmentDraft,
  CodexPendingRequest,
  CodexStatus,
  CodexThread,
  CodexThreadTokenUsage,
  CodexThreadRuntimeConfig,
  CodexThreadSession,
  CodexTranscriptItem,
  CodexUserInputEntry,
} from './types';

type CodexRequestDrafts = Record<string, Record<string, string>>;
type CodexThreadMap = Record<string, CodexThread>;

function createAttachmentID(): string {
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

function sortThreads(threads: readonly CodexThread[]): CodexThread[] {
  return [...threads].sort((left, right) => threadSortTime(right) - threadSortTime(left));
}

function normalizeOptimisticThread(
  thread: CodexThread,
  fallbackPreview?: string,
  fallbackCWD?: string,
): CodexThread {
  const normalizedPreview = String(thread.preview ?? '').trim() || String(fallbackPreview ?? '').trim();
  const normalizedCWD = String(thread.cwd ?? '').trim() || String(fallbackCWD ?? '').trim();
  const nowUnixSeconds = Math.floor(Date.now() / 1000);
  return {
    ...thread,
    preview: normalizedPreview,
    cwd: normalizedCWD,
    updated_at_unix_s: Math.max(Number(thread.updated_at_unix_s ?? 0) || 0, nowUnixSeconds),
  };
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

export type CodexContextValue = Readonly<{
  status: Accessor<CodexStatus | null | undefined>;
  statusLoading: Accessor<boolean>;
  statusError: Accessor<string | null>;
  hasHostBinary: Accessor<boolean>;
  capabilities: Accessor<CodexCapabilitiesSnapshot | null | undefined>;
  capabilitiesLoading: Accessor<boolean>;
  activeThreadID: Accessor<string | null>;
  activeThread: Accessor<CodexThread | null>;
  activeRuntimeConfig: Accessor<CodexThreadRuntimeConfig>;
  activeTokenUsage: Accessor<CodexThreadTokenUsage | null | undefined>;
  activeStatus: Accessor<string>;
  activeStatusFlags: Accessor<string[]>;
  threadTitle: Accessor<string>;
  threads: Accessor<CodexThread[]>;
  threadsLoading: Accessor<boolean>;
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
  composerText: Accessor<string>;
  setComposerText: (value: string) => void;
  submitting: Accessor<boolean>;
  streamError: Accessor<string | null>;
  requestDraftValue: (requestID: string, questionID: string) => string;
  setRequestDraftValue: (requestID: string, questionID: string, value: string) => void;
  selectThread: (threadID: string) => void;
  startNewThreadDraft: () => void;
  refreshSidebar: () => Promise<void>;
  sendTurn: () => Promise<void>;
  archiveThread: (threadID: string) => Promise<void>;
  archiveActiveThread: () => Promise<void>;
  answerRequest: (request: CodexPendingRequest, decision?: string) => Promise<void>;
}>;

const CodexContext = createContext<CodexContextValue>();

function statusErrorMessage(status: Accessor<CodexStatus | null | undefined> & { error?: unknown }): string | null {
  const payloadError = String(status()?.error ?? '').trim();
  if (payloadError) return payloadError;
  const err = status.error;
  if (!err) return null;
  return err instanceof Error ? err.message : String(err);
}

export function CodexProvider(props: ParentProps) {
  const layout = useLayout();
  const notify = useNotification();
  const env = useEnvContext();

  const [activeThreadID, setActiveThreadID] = createSignal<string | null>(null);
  const [protectedSelectionThreadID, setProtectedSelectionThreadID] = createSignal<string | null>(null);
  const [preferBlankComposer, setPreferBlankComposer] = createSignal(false);
  const [optimisticThreadsByID, setOptimisticThreadsByID] = createSignal<CodexThreadMap>({});
  const [session, setSession] = createSignal<CodexThreadSession | null>(null);
  const [workingDirDraft, setWorkingDirDraft] = createSignal('');
  const [modelDraft, setModelDraft] = createSignal('');
  const [effortDraft, setEffortDraft] = createSignal('');
  const [approvalPolicyDraft, setApprovalPolicyDraft] = createSignal('');
  const [sandboxModeDraft, setSandboxModeDraft] = createSignal('');
  const [attachments, setAttachments] = createSignal<CodexComposerAttachmentDraft[]>([]);
  const [composerText, setComposerText] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [requestDrafts, setRequestDrafts] = createSignal<CodexRequestDrafts>({});
  const [streamError, setStreamError] = createSignal<string | null>(null);
  let lastComposerOwner = '__boot__';

  const codexVisible = createMemo(() => layout.sidebarActiveTab() === 'codex');

  const [status, { refetch: refetchStatus }] = createResource(
    () => (codexVisible() ? env.settingsSeq() : null),
    async (settingsSeq) => (settingsSeq === null ? null : fetchCodexStatus()),
  );
  const [threadsResource, { refetch: refetchThreads }] = createResource(
    () => (codexVisible() && !status.loading && status()?.available ? env.settingsSeq() : null),
    async () => (status()?.available ? listCodexThreads(100) : []),
  );
  const [threadDetail, { refetch: refetchThreadDetail }] = createResource(
    () => (codexVisible() ? activeThreadID() : null),
    async (threadID) => (threadID ? openCodexThread(threadID) : null),
  );
  const [capabilities, { refetch: refetchCapabilities }] = createResource(
    () => {
      if (!codexVisible() || status.loading || !status()?.available) return null;
      return {
        settingsSeq: env.settingsSeq(),
        cwd: String(
          workingDirDraft() ||
          session()?.runtime_config?.cwd ||
          threadDetail()?.runtime_config?.cwd ||
          status()?.agent_home_dir,
        ).trim(),
      };
    },
    async (key) => fetchCodexCapabilities(key.cwd),
  );

  const upsertOptimisticThread = (thread: CodexThread | null | undefined, fallbackPreview?: string, fallbackCWD?: string) => {
    const normalizedThreadID = String(thread?.id ?? '').trim();
    if (!normalizedThreadID || !thread) return;
    const normalizedThread = normalizeOptimisticThread(thread, fallbackPreview, fallbackCWD);
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

  const threads = createMemo<CodexThread[]>(() => {
    const merged = new Map<string, CodexThread>();
    for (const thread of threadsResource() ?? []) {
      const threadID = String(thread.id ?? '').trim();
      if (!threadID) continue;
      merged.set(threadID, thread);
    }
    for (const [threadID, thread] of Object.entries(optimisticThreadsByID())) {
      if (!threadID) continue;
      merged.set(threadID, thread);
    }
    const liveThread = session()?.thread ?? threadDetail()?.thread;
    if (liveThread?.id) {
      merged.set(liveThread.id, normalizeOptimisticThread(liveThread));
    }
    return sortThreads(Array.from(merged.values()));
  });

  const applyRuntimeDrafts = (config: CodexThreadRuntimeConfig | null | undefined) => {
    const fallbackWorkingDir = String(status()?.agent_home_dir ?? '').trim();
    setWorkingDirDraft(String(config?.cwd ?? fallbackWorkingDir).trim());
    setModelDraft(String(config?.model ?? '').trim());
    setEffortDraft(String(config?.reasoning_effort ?? '').trim());
    setApprovalPolicyDraft(String(config?.approval_policy ?? '').trim());
    setSandboxModeDraft(String(config?.sandbox_mode ?? '').trim());
  };

  const resetNewThreadDrafts = () => {
    applyRuntimeDrafts({
      ...(capabilities()?.effective_config ?? {}),
      cwd: String(capabilities()?.effective_config?.cwd ?? status()?.agent_home_dir ?? '').trim(),
    });
  };

  createEffect(() => {
    const currentStatus = status();
    if (!currentStatus) return;
    if (!workingDirDraft()) {
      setWorkingDirDraft(String(currentStatus.agent_home_dir ?? '').trim());
    }
  });

  createEffect(() => {
    if (!codexVisible()) return;
    const list = threads();
    if (!Array.isArray(list)) return;
    const current = String(activeThreadID() ?? '').trim();
    if (current && list.some((thread) => thread.id === current)) {
      if (String(protectedSelectionThreadID() ?? '').trim() === current) {
        setProtectedSelectionThreadID(null);
      }
      return;
    }
    if (current) {
      const protectedThreadID = String(protectedSelectionThreadID() ?? '').trim();
      const currentDetailThreadID = String(threadDetail()?.thread.id ?? '').trim();
      const currentSessionThreadID = String(session()?.thread.id ?? '').trim();
      if (
        protectedThreadID === current ||
        currentDetailThreadID === current ||
        currentSessionThreadID === current ||
        threadDetail.loading
      ) {
        return;
      }
    }
    if (preferBlankComposer()) return;
    setProtectedSelectionThreadID(null);
    setActiveThreadID(list[0]?.id ?? null);
  });

  createEffect(() => {
    const detail = threadDetail();
    if (!codexVisible()) return;
    if (!detail) {
      if (!activeThreadID()) {
        setSession(null);
      }
      return;
    }
    setSession((prev) => {
      const nextSession = buildCodexThreadSession(detail);
      if (
        prev &&
        String(prev.thread.id ?? '').trim() === String(nextSession.thread.id ?? '').trim() &&
        Number(prev.last_applied_seq ?? 0) >= Number(nextSession.last_applied_seq ?? 0)
      ) {
        return prev;
      }
      return nextSession;
    });
    upsertOptimisticThread(detail.thread);
    setStreamError(null);
    applyRuntimeDrafts({
      ...(detail.runtime_config ?? {}),
      cwd: String(detail.runtime_config?.cwd ?? detail.thread.cwd ?? '').trim(),
    });
  });

  createEffect(() => {
    const currentSession = session();
    if (!currentSession) return;
    upsertOptimisticThread(currentSession.thread);
  });

  createEffect(() => {
    if (!codexVisible()) return;
    const owner = String(activeThreadID() ?? '').trim() || '__new__';
    if (owner === lastComposerOwner) return;
    lastComposerOwner = owner;
    setComposerText('');
    setAttachments([]);
  });

  createEffect(() => {
    if (!codexVisible()) return;
    if (activeThreadID()) return;
    const effectiveConfig = capabilities()?.effective_config;
    if (!effectiveConfig) return;
    const agentHomeDir = String(status()?.agent_home_dir ?? '').trim();
    if (!workingDirDraft() || workingDirDraft() === agentHomeDir) {
      setWorkingDirDraft(String(effectiveConfig.cwd ?? agentHomeDir).trim());
    }
    if (!modelDraft()) {
      setModelDraft(String(effectiveConfig.model ?? '').trim());
    }
    if (!effortDraft()) {
      setEffortDraft(String(effectiveConfig.reasoning_effort ?? '').trim());
    }
    if (!approvalPolicyDraft()) {
      setApprovalPolicyDraft(String(effectiveConfig.approval_policy ?? '').trim());
    }
    if (!sandboxModeDraft()) {
      setSandboxModeDraft(String(effectiveConfig.sandbox_mode ?? '').trim());
    }
  });

  createEffect(() => {
    if (!codexVisible()) return;
    const supportedEfforts = codexSupportedReasoningEfforts(capabilities(), modelDraft());
    if (supportedEfforts.length === 0) return;
    const currentEffort = String(effortDraft() ?? '').trim();
    if (currentEffort && supportedEfforts.includes(currentEffort)) return;
    setEffortDraft(supportedEfforts[0]);
  });

  createEffect(() => {
    if (!codexVisible()) return;
    const threadID = String(activeThreadID() ?? '').trim();
    const detail = threadDetail();
    if (!threadID || !detail) return;
    if (String(detail.thread.id ?? '').trim() !== threadID) return;

    const controller = new AbortController();
    let lastAppliedSeq = Math.max(0, Number(detail.last_applied_seq ?? 0) || 0);
    setStreamError(null);
    void connectCodexEventStream({
      threadID,
      afterSeq: lastAppliedSeq,
      signal: controller.signal,
      onEvent: (event) => {
        lastAppliedSeq = Math.max(lastAppliedSeq, Number(event.seq ?? 0) || 0);
        setSession((prev) => applyCodexEvent(prev ?? buildCodexThreadSession(detail), event));
      },
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setStreamError(error instanceof Error ? error.message : String(error));
    });

    onCleanup(() => controller.abort());
  });

  const statusError = createMemo(() => statusErrorMessage(status));
  const hasHostBinary = createMemo(() => !!status()?.available);
  const transcriptItems = createMemo<CodexTranscriptItem[]>(() => {
    const current = session();
    if (!current) return [];
    return current.item_order
      .map((itemID) => current.items_by_id[itemID])
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
  });
  const pendingRequests = createMemo<CodexPendingRequest[]>(() => {
    const current = session();
    if (!current) return [];
    return Object.values(current.pending_requests);
  });
  const activeThread = createMemo<CodexThread | null>(() => {
    const currentSession = session();
    if (currentSession?.thread) return currentSession.thread;
    if (threadDetail()?.thread) return threadDetail()!.thread;
    const currentThreadID = String(activeThreadID() ?? '').trim();
    if (!currentThreadID) return null;
    return threads().find((thread) => thread.id === currentThreadID) ?? null;
  });
  const activeRuntimeConfig = createMemo<CodexThreadRuntimeConfig>(() => (
    session()?.runtime_config ??
    threadDetail()?.runtime_config ??
    {}
  ));
  const activeTokenUsage = createMemo<CodexThreadTokenUsage | null | undefined>(() => (
    session()?.token_usage ??
    threadDetail()?.token_usage ??
    null
  ));
  const activeStatus = createMemo(() => String(
    session()?.active_status ??
    threadDetail()?.active_status ??
    activeThread()?.status ??
    '',
  ).trim());
  const activeStatusFlags = createMemo(() => [
    ...(
      session()?.active_status_flags ??
      threadDetail()?.active_status_flags ??
      activeThread()?.active_flags ??
      []
    ),
  ]);
  const threadTitle = createMemo(() => {
    const thread = activeThread();
    if (!thread) return 'New thread';
    return String(thread.name ?? thread.preview ?? '').trim() || 'Untitled thread';
  });

  const selectThread = (threadID: string) => {
    setPreferBlankComposer(false);
    setProtectedSelectionThreadID(String(threadID ?? '').trim() || null);
    setActiveThreadID(threadID);
  };

  const startNewThreadDraft = () => {
    setPreferBlankComposer(true);
    setProtectedSelectionThreadID(null);
    setActiveThreadID(null);
    setSession(null);
    setStreamError(null);
    setAttachments([]);
    resetNewThreadDrafts();
  };

  const refreshSidebar = async () => {
    try {
      await Promise.all([
        refetchStatus(),
        refetchThreads(),
        refetchCapabilities(),
        activeThreadID() ? refetchThreadDetail() : Promise.resolve(null),
      ]);
    } catch (error) {
      notify.error('Refresh failed', error instanceof Error ? error.message : String(error));
    }
  };

  const removeAttachment = (attachmentID: string) => {
    const targetID = String(attachmentID ?? '').trim();
    if (!targetID) return;
    setAttachments((current) => current.filter((attachment) => attachment.id !== targetID));
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
          id: createAttachmentID(),
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
      setAttachments((current) => [...current, ...nextAttachments]);
    }
  };

  const sendTurn = async () => {
    const message = String(composerText() ?? '');
    const attachmentInputs: CodexUserInputEntry[] = attachments().map((attachment) => ({
      type: 'image',
      url: attachment.data_url,
      name: attachment.name,
    }));
    if ((!message.trim() && attachmentInputs.length === 0) || submitting()) return;
    if (!hasHostBinary()) {
      notify.error('Host Codex not detected', 'Install `codex` on the host machine and refresh diagnostics.');
      return;
    }
    setSubmitting(true);
    try {
      let targetThreadID = String(activeThreadID() ?? '').trim();
      const resolvedWorkingDir = String(
        workingDirDraft() ||
        capabilities()?.effective_config?.cwd ||
        activeRuntimeConfig().cwd ||
        status()?.agent_home_dir,
      ).trim();
      if (!targetThreadID) {
        const detail = await startCodexThread({
          cwd: resolvedWorkingDir,
          model: modelDraft(),
          approval_policy: approvalPolicyDraft(),
          sandbox_mode: sandboxModeDraft(),
        });
        targetThreadID = detail.thread.id;
        setPreferBlankComposer(false);
        setProtectedSelectionThreadID(targetThreadID);
        upsertOptimisticThread(detail.thread, message.trim(), resolvedWorkingDir);
        setActiveThreadID(targetThreadID);
        setSession(buildCodexThreadSession(detail));
        applyRuntimeDrafts({
          ...(detail.runtime_config ?? {}),
          cwd: String(detail.runtime_config?.cwd ?? detail.thread.cwd ?? resolvedWorkingDir).trim(),
        });
      }
      await startCodexTurn({
        threadID: targetThreadID,
        inputText: message,
        inputs: attachmentInputs,
        cwd: resolvedWorkingDir,
        model: modelDraft(),
        effort: effortDraft(),
        approval_policy: approvalPolicyDraft(),
        sandbox_mode: sandboxModeDraft(),
      });
      const currentThread = activeThread();
      if (targetThreadID) {
        upsertOptimisticThread(
          currentThread && currentThread.id === targetThreadID
            ? currentThread
            : buildOptimisticPlaceholderThread({
                threadID: targetThreadID,
                preview: message.trim(),
                modelProvider: String(modelDraft() ?? '').trim(),
                cwd: resolvedWorkingDir,
              }),
          message.trim(),
          resolvedWorkingDir,
        );
      }
      setComposerText('');
      setAttachments([]);
      void refetchThreads();
      void refetchThreadDetail();
      void refetchCapabilities();
    } catch (error) {
      notify.error('Send failed', error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const archiveThread = async (threadID: string) => {
    const normalizedThreadID = String(threadID ?? '').trim();
    if (!normalizedThreadID) return;
    const wasActiveThread = normalizedThreadID === String(activeThreadID() ?? '').trim();
    try {
      await archiveCodexThread(normalizedThreadID);
      removeOptimisticThread(normalizedThreadID);
      notify.success('Archived', 'The Codex thread has been archived.');
      if (wasActiveThread) {
        startNewThreadDraft();
      }
      await refetchThreads();
    } catch (error) {
      notify.error('Archive failed', error instanceof Error ? error.message : String(error));
    }
  };

  const archiveActiveThread = async () => {
    await archiveThread(String(activeThreadID() ?? '').trim());
  };

  const setRequestDraftValue = (requestID: string, questionID: string, value: string) => {
    setRequestDrafts((current) => ({
      ...current,
      [requestID]: {
        ...(current[requestID] ?? {}),
        [questionID]: value,
      },
    }));
  };

  const requestDraftValue = (requestID: string, questionID: string) =>
    requestDrafts()[requestID]?.[questionID] ?? '';

  const answerRequest = async (request: CodexPendingRequest, decision?: string) => {
    if (!session()) return;
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
    capabilities,
    capabilitiesLoading: () => capabilities.loading,
    activeThreadID,
    activeThread,
    activeRuntimeConfig,
    activeTokenUsage,
    activeStatus,
    activeStatusFlags,
    threadTitle,
    threads: () => threads() ?? [],
    threadsLoading: () => threadsResource.loading,
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
    composerText,
    setComposerText,
    submitting,
    streamError,
    requestDraftValue,
    setRequestDraftValue,
    selectThread,
    startNewThreadDraft,
    refreshSidebar,
    sendTurn,
    archiveThread,
    archiveActiveThread,
    answerRequest,
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
