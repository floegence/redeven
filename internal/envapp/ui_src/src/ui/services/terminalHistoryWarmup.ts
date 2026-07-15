import type {
  PagedTerminalHistoryPage,
  PreparedPagedTerminalHistory,
  PagedTerminalHistoryRequest,
} from '@floegence/floeterm-terminal-web/history';

export type TerminalHistoryWarmupSession = Readonly<{
  id: string;
  isActive: boolean;
  lastActiveAtMs?: number;
}>;

export type TerminalHistoryWarmupEvent = Readonly<{
  event: 'start' | 'ready' | 'skipped' | 'evicted' | 'paused' | 'complete';
  sessionId?: string;
  pageCount?: number;
  byteLength?: number;
  durationMs?: number;
  reason?: string;
}>;

export type TerminalHistoryWarmup = Readonly<{
  syncSessions: (sessions: readonly TerminalHistoryWarmupSession[]) => void;
  start: () => void;
  request: (sessionId: string, priority?: 'background' | 'interactive') => Promise<PreparedPagedTerminalHistory | null>;
  invalidate: (sessionId: string, reason?: string) => void;
  setPageActive: (active: boolean) => void;
  setPageHidden: (hidden: boolean) => void;
  get: (sessionId: string) => PreparedPagedTerminalHistory | null;
  getSnapshot: () => Readonly<{ queued: number; inFlight: number; cached: number; bytes: number }>;
  dispose: () => void;
}>;

type Task = {
  sessionId: string;
  priority: 'background' | 'interactive';
  revision: number;
  controller: AbortController;
  promise: Promise<PreparedPagedTerminalHistory | null>;
  resolve: (value: PreparedPagedTerminalHistory | null) => void;
  settled: boolean;
};

type CacheEntry = {
  seed: PreparedPagedTerminalHistory;
  byteLength: number;
  lastActiveAtMs: number;
  lastUsedAtMs: number;
};

export type TerminalHistoryWarmupOptions = Readonly<{
  budgetBytes: number;
  saveData?: boolean;
  now?: () => number;
  fetchPage: (sessionId: string, request: PagedTerminalHistoryRequest) => Promise<PagedTerminalHistoryPage>;
  yieldControl?: () => Promise<void>;
  onEvent?: (event: TerminalHistoryWarmupEvent) => void;
}>;

const DEFAULT_PAGE_BYTES = 512 * 1024;
let prepareHistoryPromise: Promise<typeof import('@floegence/floeterm-terminal-web/history')['preparePagedTerminalHistory']> | null = null;

function loadPreparePagedTerminalHistory() {
  if (!prepareHistoryPromise) {
    prepareHistoryPromise = import('@floegence/floeterm-terminal-web/history')
      .then((module) => module.preparePagedTerminalHistory)
      .catch((error) => {
        prepareHistoryPromise = null;
        throw error;
      });
  }
  return prepareHistoryPromise;
}

function defaultYieldControl(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function normalizeSessionId(value: string): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function terminalHistoryWarmupErrorReason(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'error';
  const code = String((error as { code?: unknown }).code ?? '').trim();
  return /^[a-z0-9_-]+$/i.test(code) ? code : 'error';
}

export function createTerminalHistoryWarmup(options: TerminalHistoryWarmupOptions): TerminalHistoryWarmup {
  const now = options.now ?? Date.now;
  const yieldControl = options.yieldControl ?? defaultYieldControl;
  const budgetBytes = Math.max(0, Math.floor(Number(options.budgetBytes) || 0));
  const sessions = new Map<string, TerminalHistoryWarmupSession>();
  const revisions = new Map<string, number>();
  const queue: Task[] = [];
  const inFlight = new Map<string, Task>();
  const cache = new Map<string, CacheEntry>();
  let cachedBytes = 0;
  let running: Task | null = null;
  let started = false;
  let pageActive = true;
  let pageHidden = false;
  let disposed = false;
  let physicalFetchTail: Promise<void> = Promise.resolve();
  let physicalFetchOwner: Task | null = null;

  const emit = (event: TerminalHistoryWarmupEvent) => options.onEvent?.(event);

  const revisionFor = (sessionId: string): number => revisions.get(sessionId) ?? 0;

  const serializedFetchPage = (
    task: Task,
    request: PagedTerminalHistoryRequest,
  ): Promise<PagedTerminalHistoryPage> => {
    const operation = physicalFetchTail.then(async () => {
      if (request.signal.aborted) {
        const error = new Error('The history request was cancelled.');
        error.name = 'AbortError';
        throw error;
      }
      physicalFetchOwner = task;
      try {
        return await options.fetchPage(task.sessionId, request);
      } finally {
        if (physicalFetchOwner === task) physicalFetchOwner = null;
      }
    });
    physicalFetchTail = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const settleTask = (task: Task, value: PreparedPagedTerminalHistory | null) => {
    if (task.settled) return;
    task.settled = true;
    task.resolve(value);
  };

  const dropCache = (sessionId: string, reason?: string) => {
    const entry = cache.get(sessionId);
    if (!entry) return;
    cache.delete(sessionId);
    cachedBytes -= entry.byteLength;
    emit({ event: 'evicted', sessionId, byteLength: entry.byteLength, reason });
  };

  const abortTask = (task: Task, reason: string) => {
    task.controller.abort(reason);
    const index = queue.indexOf(task);
    if (index >= 0) queue.splice(index, 1);
    if (inFlight.get(task.sessionId) === task) inFlight.delete(task.sessionId);
    settleTask(task, null);
  };

  const availableBudgetFor = (candidate: TerminalHistoryWarmupSession): number => {
    let available = budgetBytes - cachedBytes;
    for (const [sessionId, entry] of cache) {
      if (
        sessionId !== candidate.id
        && entry.lastActiveAtMs <= (candidate.lastActiveAtMs ?? 0)
      ) {
        available += entry.byteLength;
      }
    }
    return Math.max(0, Math.min(budgetBytes, available));
  };

  const taskLastActiveAtMs = (task: Task): number => sessions.get(task.sessionId)?.lastActiveAtMs ?? 0;

  const sortQueuedTasks = () => {
    queue.sort((left, right) => {
      if (left.priority !== right.priority) return left.priority === 'interactive' ? -1 : 1;
      if (left.priority === 'interactive') return 0;
      return taskLastActiveAtMs(right) - taskLastActiveAtMs(left)
        || left.sessionId.localeCompare(right.sessionId);
    });
  };

  const stopQueuedBackgroundTasksForBudget = (candidate: TerminalHistoryWarmupSession) => {
    const candidateLastActiveAtMs = candidate.lastActiveAtMs ?? 0;
    for (const task of [...queue]) {
      if (task.priority !== 'background') continue;
      if (taskLastActiveAtMs(task) > candidateLastActiveAtMs) continue;
      emit({ event: 'skipped', sessionId: task.sessionId, reason: 'budget' });
      abortTask(task, 'budget exhausted');
    }
  };

  const evictFor = (candidate: TerminalHistoryWarmupSession, byteLength: number): boolean => {
    if (byteLength > budgetBytes) return false;
    while (cachedBytes + byteLength > budgetBytes) {
      const older = [...cache.entries()]
        .filter(([sessionId, entry]) => (
          sessionId !== candidate.id
          && entry.lastActiveAtMs <= (candidate.lastActiveAtMs ?? 0)
        ))
        .sort((left, right) => left[1].lastUsedAtMs - right[1].lastUsedAtMs)[0];
      if (!older) return false;
      dropCache(older[0], 'budget');
    }
    return true;
  };

  const admit = (task: Task, seed: PreparedPagedTerminalHistory): boolean => {
    const candidate = sessions.get(task.sessionId);
    if (!candidate || !candidate.isActive || revisionFor(task.sessionId) !== task.revision) return false;
    const byteLength = Math.max(0, Math.floor(Number(seed.byteLength) || 0));
    if (byteLength === 0 && !seed.complete) return false;
    if (!evictFor(candidate, byteLength)) return false;
    dropCache(task.sessionId, 'replace');
    cache.set(task.sessionId, {
      seed,
      byteLength,
      lastActiveAtMs: candidate.lastActiveAtMs ?? 0,
      lastUsedAtMs: now(),
    });
    cachedBytes += byteLength;
    return true;
  };

  const pump = () => {
    if (disposed || !started || !pageActive || pageHidden || running) return;
    const next = queue.shift();
    if (!next) {
      emit({ event: 'complete' });
      return;
    }
    const candidate = sessions.get(next.sessionId);
    if (!candidate?.isActive || revisionFor(next.sessionId) !== next.revision) {
      abortTask(next, 'ineligible');
      pump();
      return;
    }
    const candidateBudgetBytes = availableBudgetFor(candidate);
    if (candidateBudgetBytes <= 0) {
      emit({ event: 'skipped', sessionId: next.sessionId, reason: 'budget' });
      abortTask(next, 'budget exhausted');
      stopQueuedBackgroundTasksForBudget(candidate);
      pump();
      return;
    }
    running = next;
    const startedAt = now();
    emit({ event: 'start', sessionId: next.sessionId });
    void (async () => {
      try {
        const preparePagedTerminalHistory = await loadPreparePagedTerminalHistory();
        if (next.controller.signal.aborted) throw next.controller.signal.reason;
        const seed = await preparePagedTerminalHistory({
          fetchPage: (request) => serializedFetchPage(next, request),
          maxBytes: Math.min(candidateBudgetBytes, DEFAULT_PAGE_BYTES * 64),
          signal: next.controller.signal,
          yieldControl,
        });
        if (next.controller.signal.aborted || !admit(next, seed)) {
          const reason = next.controller.signal.aborted ? 'cancelled' : 'budget';
          emit({ event: 'skipped', sessionId: next.sessionId, reason });
          if (reason === 'budget') stopQueuedBackgroundTasksForBudget(candidate);
          settleTask(next, null);
        } else {
          emit({
            event: 'ready',
            sessionId: next.sessionId,
            pageCount: seed.pageCount,
            byteLength: seed.byteLength,
            durationMs: Math.max(0, now() - startedAt),
          });
          settleTask(next, seed);
        }
      } catch (error) {
        if (!next.controller.signal.aborted) {
          emit({
            event: 'skipped',
            sessionId: next.sessionId,
            reason: terminalHistoryWarmupErrorReason(error),
          });
        }
        settleTask(next, null);
      } finally {
        if (running === next) running = null;
        if (inFlight.get(next.sessionId) === next) inFlight.delete(next.sessionId);
        pump();
      }
    })();
  };

  const enqueue = (sessionId: string, priority: 'background' | 'interactive'): Task | null => {
    const candidate = sessions.get(sessionId);
    if (!candidate?.isActive || options.saveData) return null;
    const existing = inFlight.get(sessionId);
    if (existing) {
      if (priority === 'interactive') {
        existing.priority = 'interactive';
        const index = queue.indexOf(existing);
        if (index > 0) {
          queue.splice(index, 1);
          queue.unshift(existing);
        }
      }
      return existing;
    }
    let resolve!: (value: PreparedPagedTerminalHistory | null) => void;
    const promise = new Promise<PreparedPagedTerminalHistory | null>((nextResolve) => {
      resolve = nextResolve;
    });
    const task: Task = {
      sessionId,
      priority,
      revision: revisionFor(sessionId),
      controller: new AbortController(),
      promise,
      resolve,
      settled: false,
    };
    inFlight.set(sessionId, task);
    if (priority === 'interactive') queue.unshift(task);
    else {
      queue.push(task);
      sortQueuedTasks();
    }
    return task;
  };

  const enqueueEligibleBackgroundTasks = () => {
    if (disposed || !started || options.saveData || !pageActive || pageHidden) return;
    const candidates = [...sessions.values()]
      .filter((candidate) => candidate.isActive && !cache.has(candidate.id) && !inFlight.has(candidate.id))
      .sort((left, right) => (right.lastActiveAtMs ?? 0) - (left.lastActiveAtMs ?? 0));
    for (const candidate of candidates) enqueue(candidate.id, 'background');
    sortQueuedTasks();
  };

  const api: TerminalHistoryWarmup = {
    syncSessions(nextSessions) {
      const nextIds = new Set<string>();
      for (const candidate of nextSessions) {
        const id = normalizeSessionId(candidate.id);
        if (!id) continue;
        nextIds.add(id);
        sessions.set(id, { ...candidate, id });
        const cached = cache.get(id);
        if (cached) cached.lastActiveAtMs = candidate.lastActiveAtMs ?? 0;
        if (!candidate.isActive) api.invalidate(id, 'dormant');
      }
      for (const id of [...sessions.keys()]) {
        if (!nextIds.has(id)) {
          api.invalidate(id, 'removed');
          sessions.delete(id);
        }
      }
      enqueueEligibleBackgroundTasks();
      pump();
    },
    start() {
      if (disposed || options.saveData) return;
      started = true;
      enqueueEligibleBackgroundTasks();
      pump();
    },
    request(sessionId, priority = 'interactive') {
      const id = normalizeSessionId(sessionId);
      if (!id || options.saveData) return Promise.resolve(null);
      if (priority === 'background') started = true;
      const cached = cache.get(id);
      if (cached) {
        cached.lastUsedAtMs = now();
        return Promise.resolve(cached.seed);
      }
      const existing = inFlight.get(id);
      if (!existing && priority === 'interactive') return Promise.resolve(null);
      if (
        priority === 'interactive'
        && existing
        && running
        && running !== existing
      ) {
        // The physical RPC already issued for another session may not observe
        // AbortSignal. Never make a visible attach wait behind that background
        // or interactive request; drop this seed attempt and use the normal
        // recovery path. A background owner can also be cancelled, while an
        // interactive owner keeps its own visible recovery intact.
        if (running.priority === 'background') abortTask(running, 'interactive bypass');
        abortTask(existing, 'interactive bypass');
        return Promise.resolve(null);
      }
      if (
        priority === 'interactive'
        && existing
        && running === existing
        && physicalFetchOwner
        && physicalFetchOwner !== existing
        && physicalFetchOwner.controller.signal.aborted
      ) {
        // The logical task was requeued after pause/resume, but its first
        // physical page is still serialized behind an old cancelled RPC that
        // cannot observe AbortSignal. Visible recovery must fail open instead
        // of waiting for that abandoned request to settle.
        abortTask(existing, 'interactive physical bypass');
        return Promise.resolve(null);
      }
      const task = enqueue(id, priority);
      if (!task) return Promise.resolve(null);
      if (priority === 'interactive' && running && running !== task && running.priority === 'background') {
        abortTask(running, 'interactive promotion');
      }
      started = true;
      pump();
      return task.promise;
    },
    invalidate(sessionId, reason = 'invalidated') {
      const id = normalizeSessionId(sessionId);
      if (!id) return;
      revisions.set(id, revisionFor(id) + 1);
      dropCache(id, reason);
      const task = inFlight.get(id);
      if (task) abortTask(task, reason);
    },
    setPageActive(active) {
      if (pageActive === active) return;
      pageActive = active;
      if (!active) {
        for (const task of [...inFlight.values()]) {
          abortTask(task, 'surface inactive');
        }
        queue.splice(0, queue.length);
        emit({ event: 'paused', reason: 'surface inactive' });
      } else {
        enqueueEligibleBackgroundTasks();
        pump();
      }
    },
    setPageHidden(hidden) {
      if (pageHidden === hidden) return;
      pageHidden = hidden;
      if (hidden) {
        for (const task of [...inFlight.values()]) {
          abortTask(task, 'page hidden');
        }
        queue.splice(0, queue.length);
        emit({ event: 'paused', reason: 'page hidden' });
      } else {
        enqueueEligibleBackgroundTasks();
        pump();
      }
    },
    get(sessionId) {
      return cache.get(String(sessionId ?? '').trim())?.seed ?? null;
    },
    getSnapshot() {
      return { queued: queue.length, inFlight: inFlight.size, cached: cache.size, bytes: cachedBytes };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const task of [...inFlight.values()]) abortTask(task, 'disposed');
      queue.splice(0, queue.length);
      cache.clear();
      sessions.clear();
      cachedBytes = 0;
    },
  };

  return api;
}
