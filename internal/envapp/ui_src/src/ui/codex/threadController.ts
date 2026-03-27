import { createMemo, createSignal, type Accessor } from 'solid-js';

import {
  applyCodexEvent,
  buildCodexThreadSession,
  buildEmptyCodexThreadSession,
} from './state';
import { isWorkingStatus } from './presentation';
import type {
  CodexEvent,
  CodexThread,
  CodexThreadDetail,
  CodexThreadRuntimeConfig,
  CodexThreadSession,
} from './types';

export type CodexThreadBootstrapStatus = 'idle' | 'loading' | 'ready' | 'error';

export type CodexThreadLoadToken = Readonly<{
  threadID: string;
  requestID: string;
}>;

export type CodexThreadSessionEntry = Readonly<{
  threadID: string;
  session: CodexThreadSession;
  lastBootstrapSeq: number;
  lastTouchedAt: number;
  bootstrapStatus: CodexThreadBootstrapStatus;
  bootstrapError: string | null;
}>;

function createRequestID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function touchTimestamp(): number {
  return Date.now();
}

function normalizeThreadID(threadID: string | null | undefined): string {
  return String(threadID ?? '').trim();
}

function shouldPreferExistingSession(existing: CodexThreadSession, incoming: CodexThreadSession): boolean {
  if (normalizeThreadID(existing.thread.id) !== normalizeThreadID(incoming.thread.id)) {
    return false;
  }
  const existingSeq = Number(existing.last_applied_seq ?? 0) || 0;
  const incomingSeq = Number(incoming.last_applied_seq ?? 0) || 0;
  if (existingSeq > incomingSeq) return true;
  if (existingSeq < incomingSeq) return false;
  if (existing.item_order.length > incoming.item_order.length) return true;
  if (existing.item_order.length < incoming.item_order.length) return false;
  return isWorkingStatus(existing.active_status) && !isWorkingStatus(incoming.active_status);
}

function mergeBootstrapSession(
  existing: CodexThreadSession | null | undefined,
  incoming: CodexThreadSession,
): CodexThreadSession {
  if (!existing) return incoming;
  const preferExisting = shouldPreferExistingSession(existing, incoming);
  const base = preferExisting ? existing : incoming;
  const other = preferExisting ? incoming : existing;
  const existingSeq = Number(existing.last_applied_seq ?? 0) || 0;
  const incomingSeq = Number(incoming.last_applied_seq ?? 0) || 0;
  const keepWorkingStatus = existingSeq === incomingSeq && isWorkingStatus(existing.active_status) && !isWorkingStatus(base.active_status);
  return {
    ...base,
    runtime_config: {
      ...other.runtime_config,
      ...base.runtime_config,
    },
    token_usage: base.token_usage ?? other.token_usage,
    last_applied_seq: Math.max(existingSeq, incomingSeq),
    active_status: keepWorkingStatus ? existing.active_status : base.active_status,
    active_status_flags: keepWorkingStatus ? [...existing.active_status_flags] : [...base.active_status_flags],
    thread: {
      ...other.thread,
      ...base.thread,
      status: keepWorkingStatus ? existing.thread.status : base.thread.status,
      active_flags: keepWorkingStatus ? [...(existing.thread.active_flags ?? [])] : [...(base.thread.active_flags ?? [])],
      updated_at_unix_s: Math.max(
        Number(existing.thread.updated_at_unix_s ?? 0) || 0,
        Number(incoming.thread.updated_at_unix_s ?? 0) || 0,
      ),
    },
  };
}

function makeSessionEntry(
  threadID: string,
  session: CodexThreadSession,
  bootstrapStatus: CodexThreadBootstrapStatus,
  bootstrapError: string | null,
  lastBootstrapSeq?: number,
): CodexThreadSessionEntry {
  return {
    threadID,
    session,
    lastBootstrapSeq: Math.max(0, Number(lastBootstrapSeq ?? session.last_applied_seq ?? 0) || 0),
    lastTouchedAt: touchTimestamp(),
    bootstrapStatus,
    bootstrapError,
  };
}

export function createCodexThreadController() {
  const [selectedThreadID, setSelectedThreadID] = createSignal<string | null>(null);
  const [displayedThreadID, setDisplayedThreadID] = createSignal<string | null>(null);
  const [loadingThreadID, setLoadingThreadID] = createSignal<string | null>(null);
  const [blankDraftActive, setBlankDraftActive] = createSignal(false);
  const [sessionEntriesByID, setSessionEntriesByID] = createSignal<Record<string, CodexThreadSessionEntry>>({});
  const [threadErrorsByID, setThreadErrorsByID] = createSignal<Record<string, string>>({});
  const [loadToken, setLoadToken] = createSignal<CodexThreadLoadToken | null>(null);

  const displayedSessionEntry = createMemo<CodexThreadSessionEntry | null>(() => {
    const threadID = normalizeThreadID(displayedThreadID());
    if (!threadID) return null;
    return sessionEntriesByID()[threadID] ?? null;
  });
  const displayedSession = createMemo<CodexThreadSession | null>(() => displayedSessionEntry()?.session ?? null);
  const activeThreadError = createMemo<string | null>(() => {
    const threadID = normalizeThreadID(selectedThreadID());
    if (!threadID) return null;
    return threadErrorsByID()[threadID] ?? null;
  });
  const threadLoading = createMemo<boolean>(() => {
    const threadID = normalizeThreadID(selectedThreadID());
    if (!threadID) return false;
    if (normalizeThreadID(loadingThreadID()) !== threadID) return false;
    return normalizeThreadID(displayedThreadID()) !== threadID;
  });

  const sessionEntryForThread = (threadID: string | null | undefined): CodexThreadSessionEntry | null => {
    const normalizedThreadID = normalizeThreadID(threadID);
    if (!normalizedThreadID) return null;
    return sessionEntriesByID()[normalizedThreadID] ?? null;
  };

  const sessionForThread = (threadID: string | null | undefined): CodexThreadSession | null =>
    sessionEntryForThread(threadID)?.session ?? null;

  const cacheSession = (
    session: CodexThreadSession,
    bootstrapStatus: CodexThreadBootstrapStatus = 'ready',
    bootstrapError: string | null = null,
    lastBootstrapSeq?: number,
  ) => {
    const threadID = normalizeThreadID(session.thread.id);
    if (!threadID) return;
    setSessionEntriesByID((current) => ({
      ...current,
      [threadID]: makeSessionEntry(threadID, session, bootstrapStatus, bootstrapError, lastBootstrapSeq),
    }));
  };

  const ensureSessionForThread = (
    thread: CodexThread,
    runtimeConfig: CodexThreadRuntimeConfig | null | undefined,
  ): CodexThreadSession => {
    const threadID = normalizeThreadID(thread.id);
    const existing = sessionEntryForThread(threadID);
    if (existing?.session) {
      return existing.session;
    }
    const session = buildEmptyCodexThreadSession({
      thread,
      runtime_config: runtimeConfig ?? {},
      active_status: String(thread.status ?? '').trim(),
      active_status_flags: [...(thread.active_flags ?? [])],
    });
    cacheSession(session, 'ready', null, session.last_applied_seq);
    return session;
  };

  const markSessionWorking = (threadID: string) => {
    const normalizedThreadID = normalizeThreadID(threadID);
    if (!normalizedThreadID) return;
    setSessionEntriesByID((current) => {
      const entry = current[normalizedThreadID];
      if (!entry) return current;
      const nextStatus = isWorkingStatus(entry.session.active_status) ? entry.session.active_status : 'active';
      return {
        ...current,
        [normalizedThreadID]: {
          ...entry,
          lastTouchedAt: touchTimestamp(),
          session: {
            ...entry.session,
            active_status: nextStatus,
            thread: {
              ...entry.session.thread,
              status: nextStatus,
              updated_at_unix_s: Math.max(
                Number(entry.session.thread.updated_at_unix_s ?? 0) || 0,
                Math.floor(Date.now() / 1000),
              ),
            },
          },
        },
      };
    });
  };

  const updateSession = (
    threadID: string,
    updater: (session: CodexThreadSession) => CodexThreadSession,
  ) => {
    const normalizedThreadID = normalizeThreadID(threadID);
    if (!normalizedThreadID) return;
    setSessionEntriesByID((current) => {
      const entry = current[normalizedThreadID];
      if (!entry) return current;
      return {
        ...current,
        [normalizedThreadID]: {
          ...entry,
          lastTouchedAt: touchTimestamp(),
          session: updater(entry.session),
        },
      };
    });
  };

  const selectThread = (threadID: string) => {
    const normalizedThreadID = normalizeThreadID(threadID);
    if (!normalizedThreadID) return;
    const existing = sessionEntryForThread(normalizedThreadID);
    setBlankDraftActive(false);
    setSelectedThreadID(normalizedThreadID);
    setLoadingThreadID(existing?.session ? null : normalizedThreadID);
    setDisplayedThreadID(existing?.session ? normalizedThreadID : null);
  };

  const startNewThreadDraft = () => {
    setBlankDraftActive(true);
    setSelectedThreadID(null);
    setDisplayedThreadID(null);
    setLoadingThreadID(null);
    setLoadToken(null);
  };

  const beginThreadBootstrap = (threadID: string): CodexThreadLoadToken | null => {
    const normalizedThreadID = normalizeThreadID(threadID);
    if (!normalizedThreadID) return null;
    const token = {
      threadID: normalizedThreadID,
      requestID: createRequestID(),
    };
    const existing = sessionEntryForThread(normalizedThreadID);
    setBlankDraftActive(false);
    setLoadToken(token);
    setThreadErrorsByID((current) => {
      if (!(normalizedThreadID in current)) return current;
      const next = { ...current };
      delete next[normalizedThreadID];
      return next;
    });
    setSessionEntriesByID((current) => {
      if (!existing?.session) return current;
      return {
        ...current,
        [normalizedThreadID]: {
          ...existing,
          bootstrapStatus: 'loading',
          bootstrapError: null,
          lastTouchedAt: touchTimestamp(),
        },
      };
    });
    setLoadingThreadID(existing?.session ? null : normalizedThreadID);
    if (!existing?.session) {
      setDisplayedThreadID(null);
    }
    return token;
  };

  const isCurrentLoadToken = (token: CodexThreadLoadToken | null | undefined): boolean => {
    const current = loadToken();
    return Boolean(
      token &&
      current &&
      normalizeThreadID(token.threadID) === normalizeThreadID(current.threadID) &&
      normalizeThreadID(token.requestID) === normalizeThreadID(current.requestID),
    );
  };

  const resolveThreadBootstrap = (token: CodexThreadLoadToken, detail: CodexThreadDetail): boolean => {
    if (!isCurrentLoadToken(token)) return false;
    const threadID = normalizeThreadID(detail.thread.id);
    const existing = sessionEntryForThread(threadID);
    const incomingSession = buildCodexThreadSession(detail);
    const nextSession = mergeBootstrapSession(existing?.session, incomingSession);
    cacheSession(nextSession, 'ready', null, detail.last_applied_seq);
    setSelectedThreadID(threadID);
    setDisplayedThreadID(threadID);
    setLoadingThreadID(null);
    setBlankDraftActive(false);
    return true;
  };

  const failThreadBootstrap = (token: CodexThreadLoadToken, errorMessage: string): boolean => {
    if (!isCurrentLoadToken(token)) return false;
    const threadID = normalizeThreadID(token.threadID);
    const existing = sessionEntryForThread(threadID);
    if (existing?.session) {
      setSessionEntriesByID((current) => ({
        ...current,
        [threadID]: {
          ...existing,
          bootstrapStatus: 'error',
          bootstrapError: errorMessage,
          lastTouchedAt: touchTimestamp(),
        },
      }));
      setDisplayedThreadID(threadID);
    } else {
      setDisplayedThreadID(null);
    }
    setThreadErrorsByID((current) => ({
      ...current,
      [threadID]: errorMessage,
    }));
    setLoadingThreadID(null);
    return true;
  };

  const applyEventToThread = (event: CodexEvent, fallbackSession: CodexThreadSession | null | undefined): CodexThread | null => {
    const threadID = normalizeThreadID(event.thread_id);
    if (!threadID) return null;
    let nextThread: CodexThread | null = null;
    setSessionEntriesByID((current) => {
      const existing = current[threadID];
      const baseSession = existing?.session ?? fallbackSession ?? null;
      if (!baseSession) return current;
      const nextSession = applyCodexEvent(baseSession, event);
      if (!nextSession) return current;
      nextThread = nextSession.thread;
      return {
        ...current,
        [threadID]: makeSessionEntry(
          threadID,
          nextSession,
          'ready',
          null,
          Number(existing?.lastBootstrapSeq ?? fallbackSession?.last_applied_seq ?? 0) || 0,
        ),
      };
    });
    return nextThread;
  };

  const adoptThreadDetail = (detail: CodexThreadDetail) => {
    const session = buildCodexThreadSession(detail);
    cacheSession(session, 'ready', null, detail.last_applied_seq);
    setSelectedThreadID(session.thread.id);
    setDisplayedThreadID(session.thread.id);
    setLoadingThreadID(null);
    setBlankDraftActive(false);
  };

  const removeThreadState = (threadID: string) => {
    const normalizedThreadID = normalizeThreadID(threadID);
    if (!normalizedThreadID) return;
    setSessionEntriesByID((current) => {
      if (!(normalizedThreadID in current)) return current;
      const next = { ...current };
      delete next[normalizedThreadID];
      return next;
    });
    setThreadErrorsByID((current) => {
      if (!(normalizedThreadID in current)) return current;
      const next = { ...current };
      delete next[normalizedThreadID];
      return next;
    });
    if (normalizeThreadID(selectedThreadID()) === normalizedThreadID) {
      startNewThreadDraft();
      return;
    }
    if (normalizeThreadID(displayedThreadID()) === normalizedThreadID) {
      setDisplayedThreadID(null);
    }
    if (normalizeThreadID(loadingThreadID()) === normalizedThreadID) {
      setLoadingThreadID(null);
    }
  };

  return {
    selectedThreadID,
    displayedThreadID,
    loadingThreadID,
    blankDraftActive,
    sessionEntriesByID: sessionEntriesByID as Accessor<Record<string, CodexThreadSessionEntry>>,
    displayedSession,
    displayedSessionEntry,
    activeThreadError,
    threadLoading,
    sessionEntryForThread,
    sessionForThread,
    cacheSession,
    ensureSessionForThread,
    markSessionWorking,
    updateSession,
    selectThread,
    startNewThreadDraft,
    beginThreadBootstrap,
    resolveThreadBootstrap,
    failThreadBootstrap,
    applyEventToThread,
    adoptThreadDetail,
    removeThreadState,
  };
}
