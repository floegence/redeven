import type {
  TerminalResourceEstimate,
  TerminalRestorableSnapshot,
} from '@floegence/floeterm-terminal-web';

export const TERMINAL_WORKING_SET_ACTIVE_WINDOW_MS = 2 * 60 * 1000;
export const TERMINAL_WORKING_SET_HIDDEN_DELAY_MS = 10 * 60 * 1000;
export const TERMINAL_WORKING_SET_DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024;
export const TERMINAL_WORKING_SET_MIN_BUDGET_BYTES = 128 * 1024 * 1024;
export const TERMINAL_WORKING_SET_MAX_BUDGET_BYTES = 512 * 1024 * 1024;
export const TERMINAL_WORKING_SET_BURST_MULTIPLIER = 1.5;
export const TERMINAL_SNAPSHOT_POOL_MAX_BYTES = 64 * 1024 * 1024;

export type TerminalWorkingSetInteraction =
  | 'input'
  | 'composition'
  | 'selection'
  | 'search'
  | 'context-menu';

export type TerminalWorkingSetRuntime = Readonly<{
  getResourceEstimate: () => TerminalResourceEstimate;
  isProtected?: () => boolean;
  hibernate: () => Promise<TerminalRestorableSnapshot | null> | TerminalRestorableSnapshot | null;
  resume: (snapshot: TerminalRestorableSnapshot | null) => Promise<void> | void;
}>;

type IdleHandle = number;
type TimerHandle = ReturnType<typeof setTimeout>;

export type TerminalWorkingSetScheduler = Readonly<{
  scheduleIdle: (callback: () => void) => IdleHandle;
  cancelIdle: (handle: IdleHandle) => void;
  setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer: (handle: TimerHandle) => void;
}>;

export type TerminalWorkingSetEntrySnapshot = Readonly<{
  sessionId: string;
  active: boolean;
  warm: boolean;
  desiredWarm: boolean;
  transitioning: boolean;
  lastActivatedAtMs: number;
  recentActivationCount: number;
  estimatedBytes: number;
  snapshotBytes: number;
  snapshotCoveredThroughSequence: number;
  interactions: readonly TerminalWorkingSetInteraction[];
}>;

export type TerminalWorkingSetSnapshot = Readonly<{
  warmBudgetBytes: number;
  burstBudgetBytes: number;
  snapshotBudgetBytes: number;
  estimatedWarmBytes: number;
  snapshotBytes: number;
  pageHidden: boolean;
  entries: readonly TerminalWorkingSetEntrySnapshot[];
}>;

export type TerminalAdaptiveWorkingSetManager = Readonly<{
  register: (sessionId: string, runtime: TerminalWorkingSetRuntime) => () => void;
  setActiveSession: (sessionId: string | null) => void;
  setInteraction: (sessionId: string, interaction: TerminalWorkingSetInteraction, active: boolean) => void;
  setPageHidden: (hidden: boolean) => void;
  evaluate: () => void;
  getSnapshot: () => TerminalWorkingSetSnapshot;
  dispose: () => void;
}>;

type Entry = {
  sessionId: string;
  runtime: TerminalWorkingSetRuntime;
  active: boolean;
  warm: boolean;
  desiredWarm: boolean;
  transition: Promise<void> | null;
  generation: number;
  lastActivatedAtMs: number;
  activationTimesMs: number[];
  estimatedBytes: number;
  interactions: Set<TerminalWorkingSetInteraction>;
};

type StoredSnapshot = {
  value: TerminalRestorableSnapshot;
  byteLength: number;
  lastUsedAtMs: number;
};

export type TerminalAdaptiveWorkingSetOptions = Readonly<{
  deviceMemoryGiB?: number | null;
  now?: () => number;
  scheduler?: Partial<TerminalWorkingSetScheduler>;
}>;

export async function restoreTerminalSnapshotOrReplay(options: Readonly<{
  snapshot: TerminalRestorableSnapshot | null;
  restoreSnapshot: (snapshot: TerminalRestorableSnapshot) => Promise<boolean>;
  replayHistory: () => Promise<void>;
}>): Promise<'snapshot' | 'history'> {
  if (options.snapshot) {
    try {
      if (await options.restoreSnapshot(options.snapshot)) {
        return 'snapshot';
      }
    } catch {
      // Version-incompatible and damaged snapshots use the same reliable history fallback.
    }
  }
  await options.replayHistory();
  return 'history';
}

const defaultScheduleIdle = (callback: () => void): IdleHandle => {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (typeof idleWindow.requestIdleCallback === 'function') {
    return idleWindow.requestIdleCallback(callback, { timeout: 1000 });
  }
  return window.setTimeout(callback, 16);
};

const defaultCancelIdle = (handle: IdleHandle) => {
  const idleWindow = window as Window & {
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof idleWindow.cancelIdleCallback === 'function') {
    idleWindow.cancelIdleCallback(handle);
    return;
  }
  window.clearTimeout(handle);
};

export function resolveTerminalWarmBudgetBytes(deviceMemoryGiB?: number | null): number {
  if (typeof deviceMemoryGiB !== 'number' || !Number.isFinite(deviceMemoryGiB) || deviceMemoryGiB <= 0) {
    return TERMINAL_WORKING_SET_DEFAULT_BUDGET_BYTES;
  }
  const requestedBytes = deviceMemoryGiB * 32 * 1024 * 1024;
  return Math.min(
    TERMINAL_WORKING_SET_MAX_BUDGET_BYTES,
    Math.max(TERMINAL_WORKING_SET_MIN_BUDGET_BYTES, requestedBytes),
  );
}

export function resolveTerminalSnapshotBudgetBytes(warmBudgetBytes: number): number {
  return Math.min(TERMINAL_SNAPSHOT_POOL_MAX_BYTES, Math.floor(warmBudgetBytes / 4));
}

function normalizeSessionId(sessionId: string | null | undefined): string | null {
  const normalized = String(sessionId ?? '').trim();
  return normalized || null;
}

function safeEstimatedBytes(entry: Entry): number {
  try {
    const estimate = entry.runtime.getResourceEstimate();
    const value = Number(estimate.estimatedBytes);
    entry.estimatedBytes = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    entry.estimatedBytes = 0;
  }
  return entry.estimatedBytes;
}

export function createTerminalAdaptiveWorkingSetManager(
  options: TerminalAdaptiveWorkingSetOptions = {},
): TerminalAdaptiveWorkingSetManager {
  const now = options.now ?? Date.now;
  const scheduler: TerminalWorkingSetScheduler = {
    scheduleIdle: options.scheduler?.scheduleIdle ?? defaultScheduleIdle,
    cancelIdle: options.scheduler?.cancelIdle ?? defaultCancelIdle,
    setTimer: options.scheduler?.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs)),
    clearTimer: options.scheduler?.clearTimer ?? ((handle) => clearTimeout(handle)),
  };
  const warmBudgetBytes = resolveTerminalWarmBudgetBytes(options.deviceMemoryGiB);
  const burstBudgetBytes = Math.floor(warmBudgetBytes * TERMINAL_WORKING_SET_BURST_MULTIPLIER);
  const snapshotBudgetBytes = resolveTerminalSnapshotBudgetBytes(warmBudgetBytes);
  const entries = new Map<string, Entry>();
  const snapshots = new Map<string, StoredSnapshot>();

  let activeSessionId: string | null = null;
  let pageHidden = false;
  let hiddenSweepReady = false;
  let hiddenTimer: TimerHandle | null = null;
  let idleHandle: IdleHandle | null = null;
  let disposed = false;

  const dropSnapshot = (sessionId: string) => {
    snapshots.delete(sessionId);
  };

  const trimSnapshotPool = () => {
    let totalBytes = 0;
    for (const snapshot of snapshots.values()) {
      totalBytes += snapshot.byteLength;
    }
    if (totalBytes <= snapshotBudgetBytes) return;

    const oldest = [...snapshots.entries()].sort((left, right) => (
      left[1].lastUsedAtMs - right[1].lastUsedAtMs
    ));
    for (const [sessionId, snapshot] of oldest) {
      snapshots.delete(sessionId);
      totalBytes -= snapshot.byteLength;
      if (totalBytes <= snapshotBudgetBytes) break;
    }
  };

  const storeSnapshot = (sessionId: string, snapshot: TerminalRestorableSnapshot | null) => {
    dropSnapshot(sessionId);
    if (!snapshot) return;
    const byteLength = Number(snapshot.byteLength);
    if (!Number.isFinite(byteLength) || byteLength <= 0 || byteLength > snapshotBudgetBytes) return;
    snapshots.set(sessionId, {
      value: snapshot,
      byteLength: Math.floor(byteLength),
      lastUsedAtMs: now(),
    });
    trimSnapshotPool();
  };

  const reconcile = (entry: Entry) => {
    if (disposed || entry.transition || entry.desiredWarm === entry.warm) return;
    const generation = entry.generation;
    entry.transition = (async () => {
      while (!disposed && entry.generation === generation && entry.desiredWarm !== entry.warm) {
        if (entry.desiredWarm) {
          const stored = snapshots.get(entry.sessionId) ?? null;
          dropSnapshot(entry.sessionId);
          await entry.runtime.resume(stored?.value ?? null);
          if (disposed || entry.generation !== generation) return;
          entry.warm = true;
          safeEstimatedBytes(entry);
          continue;
        }

        const snapshot = await entry.runtime.hibernate();
        if (disposed || entry.generation !== generation) return;
        entry.warm = false;
        entry.estimatedBytes = 0;
        storeSnapshot(entry.sessionId, snapshot);
      }
    })().catch(() => {
      // Runtime recovery owns its user-visible error state. Keep the entry warm so it can be retried on activation.
      entry.warm = true;
      entry.desiredWarm = true;
    }).finally(() => {
      entry.transition = null;
      if (!disposed && entry.generation === generation && entry.desiredWarm !== entry.warm) {
        reconcile(entry);
      }
      if (!disposed && entry.generation === generation) {
        scheduleEvaluation();
      }
    });
  };

  const isProtected = (entry: Entry) => {
    if (entry.active || entry.interactions.size > 0) return true;
    try {
      return entry.runtime.isProtected?.() === true;
    } catch {
      return true;
    }
  };

  const chooseHibernateCandidate = (): Entry | null => {
    const currentTime = now();
    const warmEntries = [...entries.values()].filter((entry) => entry.warm);
    let estimatedWarmBytes = 0;
    for (const entry of warmEntries) {
      estimatedWarmBytes += safeEstimatedBytes(entry);
    }

    const hiddenCandidates = hiddenSweepReady
      ? warmEntries.filter((entry) => !entry.transition && !isProtected(entry))
      : [];
    if (hiddenCandidates.length > 0) {
      return hiddenCandidates.sort((left, right) => left.lastActivatedAtMs - right.lastActivatedAtMs)[0] ?? null;
    }

    if (estimatedWarmBytes <= warmBudgetBytes) return null;
    const beyondBurstBudget = estimatedWarmBytes > burstBudgetBytes;
    const candidates = warmEntries.filter((entry) => {
      if (entry.transition) return false;
      if (isProtected(entry)) return false;
      if (beyondBurstBudget) return true;
      return entry.lastActivatedAtMs <= 0
        || currentTime - entry.lastActivatedAtMs >= TERMINAL_WORKING_SET_ACTIVE_WINDOW_MS;
    });
    return candidates.sort((left, right) => {
      if (left.lastActivatedAtMs !== right.lastActivatedAtMs) {
        return left.lastActivatedAtMs - right.lastActivatedAtMs;
      }
      return left.activationTimesMs.length - right.activationTimesMs.length;
    })[0] ?? null;
  };

  const scheduleEvaluation = () => {
    if (disposed || idleHandle !== null) return;
    idleHandle = scheduler.scheduleIdle(() => {
      idleHandle = null;
      if (disposed) return;
      const candidate = chooseHibernateCandidate();
      if (!candidate) {
        if (hiddenSweepReady) hiddenSweepReady = false;
        return;
      }
      candidate.desiredWarm = false;
      reconcile(candidate);
      scheduleEvaluation();
    });
  };

  const register = (sessionId: string, runtime: TerminalWorkingSetRuntime) => {
    const id = normalizeSessionId(sessionId);
    if (!id || disposed) return () => undefined;
    const previous = entries.get(id);
    if (previous) {
      previous.generation += 1;
      dropSnapshot(id);
    }
    const currentTime = now();
    const entry: Entry = {
      sessionId: id,
      runtime,
      active: activeSessionId === id,
      warm: true,
      desiredWarm: true,
      transition: null,
      generation: (previous?.generation ?? 0) + 1,
      lastActivatedAtMs: previous?.lastActivatedAtMs ?? (activeSessionId === id ? currentTime : 0),
      activationTimesMs: previous?.activationTimesMs ?? [],
      estimatedBytes: 0,
      interactions: previous?.interactions ?? new Set(),
    };
    safeEstimatedBytes(entry);
    entries.set(id, entry);
    scheduleEvaluation();

    return () => {
      if (entries.get(id) !== entry) return;
      entry.generation += 1;
      entries.delete(id);
      dropSnapshot(id);
    };
  };

  const setActiveSession = (sessionId: string | null) => {
    if (disposed) return;
    const nextId = normalizeSessionId(sessionId);
    if (activeSessionId === nextId) return;
    const currentTime = now();
    if (activeSessionId) {
      const previous = entries.get(activeSessionId);
      if (previous) previous.active = false;
    }
    activeSessionId = nextId;
    if (nextId) {
      const entry = entries.get(nextId);
      if (entry) {
        entry.active = true;
        entry.desiredWarm = true;
        entry.lastActivatedAtMs = currentTime;
        entry.activationTimesMs.push(currentTime);
        entry.activationTimesMs = entry.activationTimesMs.filter((value) => (
          currentTime - value <= TERMINAL_WORKING_SET_ACTIVE_WINDOW_MS
        ));
        reconcile(entry);
      }
    }
    scheduleEvaluation();
  };

  const setInteraction = (
    sessionId: string,
    interaction: TerminalWorkingSetInteraction,
    active: boolean,
  ) => {
    if (disposed) return;
    const id = normalizeSessionId(sessionId);
    const entry = id ? entries.get(id) : null;
    if (!entry) return;
    if (active) {
      entry.interactions.add(interaction);
      entry.desiredWarm = true;
      reconcile(entry);
      return;
    }
    entry.interactions.delete(interaction);
    scheduleEvaluation();
  };

  const setPageHidden = (hidden: boolean) => {
    if (disposed || pageHidden === hidden) return;
    pageHidden = hidden;
    hiddenSweepReady = false;
    if (hiddenTimer !== null) {
      scheduler.clearTimer(hiddenTimer);
      hiddenTimer = null;
    }
    if (!hidden) return;
    hiddenTimer = scheduler.setTimer(() => {
      hiddenTimer = null;
      if (disposed || !pageHidden) return;
      hiddenSweepReady = true;
      scheduleEvaluation();
    }, TERMINAL_WORKING_SET_HIDDEN_DELAY_MS);
  };

  const getSnapshot = (): TerminalWorkingSetSnapshot => {
    let estimatedWarmBytes = 0;
    let snapshotBytes = 0;
    for (const stored of snapshots.values()) snapshotBytes += stored.byteLength;
    const entrySnapshots = [...entries.values()].map<TerminalWorkingSetEntrySnapshot>((entry) => {
      const estimatedBytes = entry.warm ? safeEstimatedBytes(entry) : 0;
      estimatedWarmBytes += estimatedBytes;
      const stored = snapshots.get(entry.sessionId);
      const currentTime = now();
      entry.activationTimesMs = entry.activationTimesMs.filter((value) => (
        currentTime - value <= TERMINAL_WORKING_SET_ACTIVE_WINDOW_MS
      ));
      return {
        sessionId: entry.sessionId,
        active: entry.active,
        warm: entry.warm,
        desiredWarm: entry.desiredWarm,
        transitioning: entry.transition !== null,
        lastActivatedAtMs: entry.lastActivatedAtMs,
        recentActivationCount: entry.activationTimesMs.length,
        estimatedBytes,
        snapshotBytes: stored?.byteLength ?? 0,
        snapshotCoveredThroughSequence: stored?.value.coveredThroughSequence ?? 0,
        interactions: [...entry.interactions],
      };
    });
    return {
      warmBudgetBytes,
      burstBudgetBytes,
      snapshotBudgetBytes,
      estimatedWarmBytes,
      snapshotBytes,
      pageHidden,
      entries: entrySnapshots,
    };
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (idleHandle !== null) scheduler.cancelIdle(idleHandle);
    if (hiddenTimer !== null) scheduler.clearTimer(hiddenTimer);
    idleHandle = null;
    hiddenTimer = null;
    for (const entry of entries.values()) entry.generation += 1;
    entries.clear();
    snapshots.clear();
  };

  return {
    register,
    setActiveSession,
    setInteraction,
    setPageHidden,
    evaluate: scheduleEvaluation,
    getSnapshot,
    dispose,
  };
}
