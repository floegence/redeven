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
  fetchCodexStatus,
  listCodexThreads,
  openCodexThread,
  respondToCodexRequest,
  startCodexThread,
  startCodexTurn,
} from './api';
import { applyCodexEvent, buildCodexThreadSession } from './state';
import type {
  CodexPendingRequest,
  CodexStatus,
  CodexThread,
  CodexThreadDetail,
  CodexThreadSession,
  CodexTranscriptItem,
} from './types';

type CodexRequestDrafts = Record<string, Record<string, string>>;

export type CodexContextValue = Readonly<{
  status: Accessor<CodexStatus | null | undefined>;
  statusLoading: Accessor<boolean>;
  statusError: Accessor<string | null>;
  hasHostBinary: Accessor<boolean>;
  activeThreadID: Accessor<string | null>;
  activeThread: Accessor<CodexThread | null>;
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
  composerText: Accessor<string>;
  setComposerText: (value: string) => void;
  submitting: Accessor<boolean>;
  refreshingThread: Accessor<boolean>;
  streamError: Accessor<string | null>;
  requestDraftValue: (requestID: string, questionID: string) => string;
  setRequestDraftValue: (requestID: string, questionID: string, value: string) => void;
  selectThread: (threadID: string) => void;
  startNewThreadDraft: () => void;
  refreshSidebar: () => Promise<void>;
  refreshActiveThread: () => Promise<void>;
  sendTurn: () => Promise<void>;
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
  const [preferBlankComposer, setPreferBlankComposer] = createSignal(false);
  const [session, setSession] = createSignal<CodexThreadSession | null>(null);
  const [workingDirDraft, setWorkingDirDraft] = createSignal('');
  const [modelDraft, setModelDraft] = createSignal('');
  const [composerText, setComposerText] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [refreshingThread, setRefreshingThread] = createSignal(false);
  const [requestDrafts, setRequestDrafts] = createSignal<CodexRequestDrafts>({});
  const [streamError, setStreamError] = createSignal<string | null>(null);

  const codexVisible = createMemo(() => layout.sidebarActiveTab() === 'codex');

  const [status, { refetch: refetchStatus }] = createResource(
    () => (codexVisible() ? env.settingsSeq() : null),
    async (settingsSeq) => (settingsSeq === null ? null : fetchCodexStatus()),
  );
  const [threads, { refetch: refetchThreads }] = createResource(
    () => (codexVisible() && !status.loading && status()?.available ? env.settingsSeq() : null),
    async () => (status()?.available ? listCodexThreads(100) : []),
  );
  const [threadDetail, { refetch: refetchThreadDetail }] = createResource(
    () => (codexVisible() ? activeThreadID() : null),
    async (threadID) => (threadID ? openCodexThread(threadID) : null),
  );

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
    if (current && list.some((thread) => thread.id === current)) return;
    if (preferBlankComposer()) return;
    setActiveThreadID(list[0]?.id ?? null);
  });

  createEffect(() => {
    const detail = threadDetail();
    if (!codexVisible()) return;
    if (!detail) {
      setSession(null);
      return;
    }
    setSession(buildCodexThreadSession(detail));
    setStreamError(null);
  });

  createEffect(() => {
    if (!codexVisible()) return;
    const currentSession = session();
    const threadID = String(currentSession?.thread.id ?? '').trim();
    if (!threadID) return;

    const controller = new AbortController();
    setStreamError(null);
    void connectCodexEventStream({
      threadID,
      afterSeq: 0,
      signal: controller.signal,
      onEvent: (event) => {
        setSession((prev) => applyCodexEvent(prev, event));
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
  const activeThread = createMemo<CodexThread | null>(() => session()?.thread ?? null);
  const activeStatus = createMemo(() => String(session()?.active_status ?? activeThread()?.status ?? '').trim());
  const activeStatusFlags = createMemo(() => [...(session()?.active_status_flags ?? activeThread()?.active_flags ?? [])]);
  const threadTitle = createMemo(() => {
    const thread = activeThread();
    if (!thread) return 'New thread';
    return String(thread.name ?? thread.preview ?? '').trim() || 'Untitled thread';
  });

  const selectThread = (threadID: string) => {
    setPreferBlankComposer(false);
    setActiveThreadID(threadID);
  };

  const startNewThreadDraft = () => {
    setPreferBlankComposer(true);
    setActiveThreadID(null);
    setSession(null);
    setStreamError(null);
  };

  const refreshSidebar = async () => {
    try {
      await Promise.all([refetchStatus(), refetchThreads()]);
    } catch (error) {
      notify.error('Refresh failed', error instanceof Error ? error.message : String(error));
    }
  };

  const refreshActiveThread = async () => {
    if (!activeThreadID()) return;
    setRefreshingThread(true);
    try {
      await Promise.all([refetchStatus(), refetchThreads(), refetchThreadDetail()]);
      setStreamError(null);
    } catch (error) {
      notify.error('Refresh failed', error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingThread(false);
    }
  };

  const sendTurn = async () => {
    const message = String(composerText() ?? '').trim();
    if (!message || submitting()) return;
    if (!hasHostBinary()) {
      notify.error('Host Codex not detected', 'Install `codex` on the host machine and refresh diagnostics.');
      return;
    }
    setSubmitting(true);
    try {
      let targetThreadID = String(activeThreadID() ?? '').trim();
      if (!targetThreadID) {
        const thread = await startCodexThread({
          cwd: workingDirDraft(),
          model: modelDraft(),
        });
        targetThreadID = thread.id;
        setPreferBlankComposer(false);
        setActiveThreadID(targetThreadID);
        const bootstrapDetail: CodexThreadDetail = {
          thread,
          pending_requests: [],
          last_event_seq: 0,
          active_status: thread.status,
          active_status_flags: thread.active_flags ?? [],
        };
        setSession(buildCodexThreadSession(bootstrapDetail));
      }
      await startCodexTurn({ threadID: targetThreadID, inputText: message });
      setComposerText('');
      void refetchThreads();
      void refetchThreadDetail();
    } catch (error) {
      notify.error('Send failed', error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const archiveActiveThread = async () => {
    const threadID = String(activeThreadID() ?? '').trim();
    if (!threadID) return;
    try {
      await archiveCodexThread(threadID);
      notify.success('Archived', 'The Codex thread has been archived.');
      startNewThreadDraft();
      await refetchThreads();
    } catch (error) {
      notify.error('Archive failed', error instanceof Error ? error.message : String(error));
    }
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
    activeThreadID,
    activeThread,
    activeStatus,
    activeStatusFlags,
    threadTitle,
    threads: () => threads() ?? [],
    threadsLoading: () => threads.loading,
    transcriptItems,
    pendingRequests,
    workingDirDraft,
    setWorkingDirDraft,
    modelDraft,
    setModelDraft,
    composerText,
    setComposerText,
    submitting,
    refreshingThread,
    streamError,
    requestDraftValue,
    setRequestDraftValue,
    selectThread,
    startNewThreadDraft,
    refreshSidebar,
    refreshActiveThread,
    sendTurn,
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
