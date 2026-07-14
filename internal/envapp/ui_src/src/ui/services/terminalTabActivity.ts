export type TerminalCommandPhase = 'idle' | 'running';
export type TerminalProgramActivityPhase = 'unknown' | 'busy' | 'idle';
export type TerminalTabVisualState = 'none' | 'running' | 'unread';
export type TerminalSessionWorkState = 'idle' | 'running' | 'active';
type TerminalRecentActivityPhase = 'inactive' | 'grace' | 'output';

export type TerminalSessionActivityRuntime = {
  commandPhase: TerminalCommandPhase;
  programActivityPhase: TerminalProgramActivityPhase;
  unread: boolean;
  recentActivityPhase: TerminalRecentActivityPhase;
  pendingLiveOutput: boolean;
  pendingLiveSequences: Map<number, boolean>;
  pendingLiveUnreadCount: number;
  pendingUnsequencedOutput: boolean;
  pendingUnsequencedUnread: boolean;
  outputAttachGeneration: number | undefined;
  settledThroughSequence: number;
  recentActivityTimer: ReturnType<typeof setTimeout> | null;
  pendingOutputTimer: ReturnType<typeof setTimeout> | null;
  visualState: TerminalTabVisualState;
  workState: TerminalSessionWorkState;
};

export interface TerminalTabActivityTrackerOptions {
  publishVisualState: (sessionId: string, state: TerminalTabVisualState) => void;
  publishWorkState?: (sessionId: string, state: TerminalSessionWorkState) => void;
  outputActivityGraceMs?: number;
  outputActivityQuietMs?: number;
  scheduleTimeout?: typeof setTimeout;
  cancelTimeout?: typeof clearTimeout;
}

export interface TerminalTabActivityTracker {
  clearUnread: (sessionId: string) => void;
  handleBell: (sessionId: string, shouldMarkUnread: boolean) => void;
  handleCommandStart: (sessionId: string) => void;
  handleCommandFinish: (sessionId: string, shouldMarkUnread: boolean) => void;
  handlePromptReady: (sessionId: string) => void;
  handleProgramActivity: (sessionId: string, phase: Exclude<TerminalProgramActivityPhase, 'unknown'>) => void;
  handlePendingLiveOutput: (
    sessionId: string,
    opts: { sequence?: number; shouldMarkUnread: boolean },
  ) => void;
  handleOutputCommitted: (
    sessionId: string,
    opts: { source: 'history' | 'live'; sequence?: number },
  ) => void;
  handleOutputCoverage: (
    sessionId: string,
    update: { attachGeneration: number; coveredThroughSequence: number; rebased?: boolean },
  ) => void;
  resetPendingOutput: (sessionId: string, opts?: { preserveUnread?: boolean }) => void;
  handleVisibleOutput: (sessionId: string, opts: { source: 'history' | 'live'; byteLength: number; shouldMarkUnread: boolean }) => void;
  pruneSessions: (activeSessionIds: Set<string>) => void;
  dispose: () => void;
}

const DEFAULT_OUTPUT_ACTIVITY_GRACE_MS = 1_500;
const DEFAULT_OUTPUT_ACTIVITY_QUIET_MS = 3_500;
const MAX_PENDING_LIVE_SEQUENCES = 2048;

function createEmptyRuntime(): TerminalSessionActivityRuntime {
  return {
    commandPhase: 'idle',
    programActivityPhase: 'unknown',
    unread: false,
    recentActivityPhase: 'inactive',
    pendingLiveOutput: false,
    pendingLiveSequences: new Map(),
    pendingLiveUnreadCount: 0,
    pendingUnsequencedOutput: false,
    pendingUnsequencedUnread: false,
    outputAttachGeneration: undefined,
    settledThroughSequence: 0,
    recentActivityTimer: null,
    pendingOutputTimer: null,
    visualState: 'none',
    workState: 'idle',
  };
}

function computeVisualState(runtime: TerminalSessionActivityRuntime): TerminalTabVisualState {
  if (runtime.pendingLiveOutput) {
    return 'running';
  }
  if (runtime.programActivityPhase === 'busy') {
    return 'running';
  }
  if (runtime.commandPhase === 'running' && runtime.recentActivityPhase !== 'inactive') {
    return 'running';
  }
  if (runtime.unread || runtime.pendingLiveUnreadCount > 0 || runtime.pendingUnsequencedUnread) {
    return 'unread';
  }
  return 'none';
}

function computeWorkState(runtime: TerminalSessionActivityRuntime): TerminalSessionWorkState {
  if (runtime.programActivityPhase === 'busy') {
    return 'active';
  }
  if (runtime.commandPhase === 'running') {
    return runtime.recentActivityPhase === 'inactive' ? 'running' : 'active';
  }
  if (runtime.pendingLiveOutput) {
    return 'running';
  }
  if (runtime.recentActivityPhase === 'output') {
    return 'active';
  }
  return 'idle';
}

export function createTerminalTabActivityTracker(
  options: TerminalTabActivityTrackerOptions,
): TerminalTabActivityTracker {
  const graceMs = options.outputActivityGraceMs ?? DEFAULT_OUTPUT_ACTIVITY_GRACE_MS;
  const quietMs = options.outputActivityQuietMs ?? DEFAULT_OUTPUT_ACTIVITY_QUIET_MS;
  const scheduleTimeout = options.scheduleTimeout ?? setTimeout;
  const cancelTimeout = options.cancelTimeout ?? clearTimeout;
  const runtimeBySession = new Map<string, TerminalSessionActivityRuntime>();

  const publishIfNeeded = (sessionId: string, runtime: TerminalSessionActivityRuntime) => {
    const nextState = computeVisualState(runtime);
    if (nextState !== runtime.visualState) {
      runtime.visualState = nextState;
      options.publishVisualState(sessionId, nextState);
    }

    const nextWorkState = computeWorkState(runtime);
    if (nextWorkState !== runtime.workState) {
      runtime.workState = nextWorkState;
      options.publishWorkState?.(sessionId, nextWorkState);
    }
  };

  const clearRecentActivityTimer = (runtime: TerminalSessionActivityRuntime) => {
    if (runtime.recentActivityTimer == null) {
      return;
    }
    cancelTimeout(runtime.recentActivityTimer);
    runtime.recentActivityTimer = null;
  };

  const clearPendingOutputTimer = (runtime: TerminalSessionActivityRuntime) => {
    if (runtime.pendingOutputTimer == null) {
      return;
    }
    cancelTimeout(runtime.pendingOutputTimer);
    runtime.pendingOutputTimer = null;
  };

  const getRuntime = (sessionId: string): TerminalSessionActivityRuntime | null => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) {
      return null;
    }

    let runtime = runtimeBySession.get(normalizedSessionId);
    if (!runtime) {
      runtime = createEmptyRuntime();
      runtimeBySession.set(normalizedSessionId, runtime);
    }
    return runtime;
  };

  const scheduleRecentActivity = (
    sessionId: string,
    runtime: TerminalSessionActivityRuntime,
    phase: Exclude<TerminalRecentActivityPhase, 'inactive'>,
    durationMs: number,
  ) => {
    clearRecentActivityTimer(runtime);
    runtime.recentActivityPhase = phase;
    publishIfNeeded(sessionId, runtime);
    runtime.recentActivityTimer = scheduleTimeout(() => {
      runtime.recentActivityTimer = null;
      if (runtime.recentActivityPhase !== phase) {
        return;
      }
      runtime.recentActivityPhase = 'inactive';
      publishIfNeeded(sessionId, runtime);
    }, durationMs);
  };

  const markUnread = (runtime: TerminalSessionActivityRuntime, shouldMarkUnread: boolean) => {
    if (!shouldMarkUnread) {
      return;
    }
    runtime.unread = true;
  };

  const clearPendingUnread = (runtime: TerminalSessionActivityRuntime) => {
    runtime.pendingLiveUnreadCount = 0;
    for (const sequence of runtime.pendingLiveSequences.keys()) {
      runtime.pendingLiveSequences.set(sequence, false);
    }
    runtime.pendingUnsequencedUnread = false;
  };

  const clearPendingOutput = (runtime: TerminalSessionActivityRuntime) => {
    runtime.pendingLiveOutput = false;
    runtime.pendingLiveSequences.clear();
    runtime.pendingLiveUnreadCount = 0;
    runtime.pendingUnsequencedOutput = false;
    runtime.pendingUnsequencedUnread = false;
  };

  const promotePendingUnread = (runtime: TerminalSessionActivityRuntime) => {
    if (runtime.pendingLiveUnreadCount > 0 || runtime.pendingUnsequencedUnread) {
      runtime.unread = true;
    }
  };

  const resetOutputCoverage = (runtime: TerminalSessionActivityRuntime) => {
    clearPendingOutput(runtime);
    runtime.outputAttachGeneration = undefined;
    runtime.settledThroughSequence = 0;
  };

  const settleThroughCoverage = (
    runtime: TerminalSessionActivityRuntime,
    coveredThroughSequence: number,
  ) => {
    for (const [sequence, shouldMarkUnread] of runtime.pendingLiveSequences) {
      if (sequence > coveredThroughSequence) continue;
      if (shouldMarkUnread) runtime.pendingLiveUnreadCount = Math.max(0, runtime.pendingLiveUnreadCount - 1);
      runtime.pendingLiveSequences.delete(sequence);
    }
    if (runtime.pendingLiveSequences.size === 0 && !runtime.pendingUnsequencedOutput) {
      runtime.pendingLiveOutput = false;
    }
  };

  const settlePendingSequence = (
    runtime: TerminalSessionActivityRuntime,
    sequence: number | undefined,
  ): boolean => {
    if (sequence === undefined) {
      const shouldMarkUnread = runtime.pendingUnsequencedUnread;
      runtime.pendingUnsequencedOutput = false;
      runtime.pendingUnsequencedUnread = false;
      if (runtime.pendingLiveSequences.size === 0) runtime.pendingLiveOutput = false;
      return shouldMarkUnread;
    }
    const shouldMarkUnread = runtime.pendingLiveSequences.get(sequence) === true;
    if (shouldMarkUnread) runtime.pendingLiveUnreadCount = Math.max(0, runtime.pendingLiveUnreadCount - 1);
    runtime.pendingLiveSequences.delete(sequence);
    if (runtime.pendingLiveSequences.size === 0 && !runtime.pendingUnsequencedOutput) {
      runtime.pendingLiveOutput = false;
    }
    return shouldMarkUnread;
  };

  const schedulePendingOutputQuiet = (
    sessionId: string,
    runtime: TerminalSessionActivityRuntime,
  ) => {
    clearPendingOutputTimer(runtime);
    runtime.pendingOutputTimer = scheduleTimeout(() => {
      runtime.pendingOutputTimer = null;
      runtime.pendingLiveOutput = false;
      publishIfNeeded(sessionId, runtime);
    }, quietMs);
  };

  const normalizeSessionId = (sessionId: string): string => String(sessionId ?? '').trim();

  return {
    clearUnread(sessionId: string) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) {
        return;
      }
      const runtime = getRuntime(normalizedSessionId);
      if (!runtime) {
        return;
      }
      if (!runtime.unread) {
        if (runtime.pendingLiveUnreadCount === 0 && !runtime.pendingUnsequencedUnread) return;
      }
      runtime.unread = false;
      clearPendingUnread(runtime);
      publishIfNeeded(normalizedSessionId, runtime);
    },

    handleBell(sessionId: string, shouldMarkUnread: boolean) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId || !shouldMarkUnread) {
        return;
      }
      const runtime = getRuntime(normalizedSessionId);
      if (!runtime) {
        return;
      }
      runtime.unread = true;
      publishIfNeeded(normalizedSessionId, runtime);
    },

    handleCommandStart(sessionId: string) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) {
        return;
      }
      const runtime = getRuntime(normalizedSessionId);
      if (!runtime) {
        return;
      }
      runtime.commandPhase = 'running';
      runtime.programActivityPhase = 'unknown';
      runtime.pendingLiveOutput = false;
      clearPendingOutputTimer(runtime);
      scheduleRecentActivity(normalizedSessionId, runtime, 'grace', graceMs);
    },

    handleCommandFinish(sessionId: string, shouldMarkUnread: boolean) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) {
        return;
      }
      const runtime = getRuntime(normalizedSessionId);
      if (!runtime) {
        return;
      }
      clearRecentActivityTimer(runtime);
      clearPendingOutputTimer(runtime);
      runtime.commandPhase = 'idle';
      runtime.programActivityPhase = 'idle';
      runtime.pendingLiveOutput = false;
      runtime.recentActivityPhase = 'inactive';
      markUnread(runtime, shouldMarkUnread);
      publishIfNeeded(normalizedSessionId, runtime);
    },

    handlePromptReady(sessionId: string) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) {
        return;
      }
      const runtime = getRuntime(normalizedSessionId);
      if (!runtime) {
        return;
      }
      clearRecentActivityTimer(runtime);
      clearPendingOutputTimer(runtime);
      runtime.commandPhase = 'idle';
      runtime.programActivityPhase = 'idle';
      clearPendingOutput(runtime);
      runtime.recentActivityPhase = 'inactive';
      publishIfNeeded(normalizedSessionId, runtime);
    },

    handleProgramActivity(sessionId: string, phase: Exclude<TerminalProgramActivityPhase, 'unknown'>) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) {
        return;
      }
      const runtime = getRuntime(normalizedSessionId);
      if (!runtime) {
        return;
      }
      runtime.programActivityPhase = phase;
      runtime.pendingLiveOutput = false;
      clearPendingOutputTimer(runtime);
      if (phase === 'idle') {
        clearRecentActivityTimer(runtime);
        runtime.recentActivityPhase = 'inactive';
      }
      publishIfNeeded(normalizedSessionId, runtime);
    },

    handlePendingLiveOutput(sessionId: string, opts: { sequence?: number; shouldMarkUnread: boolean }) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) {
        return;
      }
      const runtime = getRuntime(normalizedSessionId);
      if (!runtime) {
        return;
      }
      const sequence = Number.isSafeInteger(opts.sequence) && Number(opts.sequence) > 0
        ? Number(opts.sequence)
        : undefined;
      if (sequence !== undefined && sequence <= runtime.settledThroughSequence) return;
      runtime.pendingLiveOutput = true;
      if (sequence === undefined) {
        runtime.pendingUnsequencedOutput = true;
        runtime.pendingUnsequencedUnread ||= opts.shouldMarkUnread;
      } else {
        const wasUnread = runtime.pendingLiveSequences.get(sequence) === true;
        const shouldMarkUnread = wasUnread || opts.shouldMarkUnread;
        if (!runtime.pendingLiveSequences.has(sequence) && runtime.pendingLiveSequences.size >= MAX_PENDING_LIVE_SEQUENCES) {
          const oldestSequence = runtime.pendingLiveSequences.keys().next().value as number | undefined;
          if (oldestSequence !== undefined) {
            if (runtime.pendingLiveSequences.get(oldestSequence) === true) {
              runtime.pendingLiveUnreadCount = Math.max(0, runtime.pendingLiveUnreadCount - 1);
              runtime.unread = true;
            }
            runtime.pendingLiveSequences.delete(oldestSequence);
          }
        }
        runtime.pendingLiveSequences.set(sequence, shouldMarkUnread);
        if (!wasUnread && shouldMarkUnread) runtime.pendingLiveUnreadCount += 1;
      }
      publishIfNeeded(normalizedSessionId, runtime);
      schedulePendingOutputQuiet(normalizedSessionId, runtime);
    },

    handleOutputCommitted(sessionId: string, opts: { source: 'history' | 'live'; sequence?: number }) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) return;
      const runtime = getRuntime(normalizedSessionId);
      if (!runtime) return;
      const sequence = Number.isSafeInteger(opts.sequence) && Number(opts.sequence) > 0
        ? Number(opts.sequence)
        : undefined;
      const shouldMarkUnread = settlePendingSequence(runtime, sequence);
      if (!runtime.pendingLiveOutput) clearPendingOutputTimer(runtime);
      if (sequence !== undefined) {
        runtime.settledThroughSequence = Math.max(runtime.settledThroughSequence, sequence);
      }
      if (opts.source === 'live') markUnread(runtime, shouldMarkUnread);
      publishIfNeeded(normalizedSessionId, runtime);
    },

    handleOutputCoverage(sessionId, update) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) return;
      const runtime = runtimeBySession.get(normalizedSessionId);
      if (!runtime) return;
      const attachGeneration = Number.isSafeInteger(update.attachGeneration) && update.attachGeneration >= 0
        ? update.attachGeneration
        : 0;
      const coveredThroughSequence = Number.isSafeInteger(update.coveredThroughSequence) && update.coveredThroughSequence >= 0
        ? update.coveredThroughSequence
        : 0;
      const generationChanged = runtime.outputAttachGeneration !== undefined
        && runtime.outputAttachGeneration !== attachGeneration;
      const preserveRunning = runtime.pendingLiveOutput;
      if (update.rebased || generationChanged) {
        clearPendingOutputTimer(runtime);
        promotePendingUnread(runtime);
        clearPendingOutput(runtime);
      }
      runtime.outputAttachGeneration = attachGeneration;
      runtime.settledThroughSequence = update.rebased || generationChanged
        ? coveredThroughSequence
        : Math.max(runtime.settledThroughSequence, coveredThroughSequence);
      settleThroughCoverage(runtime, runtime.settledThroughSequence);
      if (preserveRunning) runtime.pendingLiveOutput = true;
      publishIfNeeded(normalizedSessionId, runtime);
      if ((update.rebased || generationChanged) && runtime.pendingLiveOutput) {
        schedulePendingOutputQuiet(normalizedSessionId, runtime);
      }
    },

    resetPendingOutput(sessionId, opts) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) return;
      const runtime = runtimeBySession.get(normalizedSessionId);
      if (!runtime) return;
      const preserveRunning = runtime.pendingLiveOutput;
      clearPendingOutputTimer(runtime);
      if (opts?.preserveUnread !== false) promotePendingUnread(runtime);
      resetOutputCoverage(runtime);
      if (preserveRunning) runtime.pendingLiveOutput = true;
      publishIfNeeded(normalizedSessionId, runtime);
      if (preserveRunning) schedulePendingOutputQuiet(normalizedSessionId, runtime);
    },

    handleVisibleOutput(sessionId: string, opts: { source: 'history' | 'live'; byteLength: number; shouldMarkUnread: boolean }) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) {
        return;
      }
      if (opts.source !== 'live' || opts.byteLength <= 0) {
        return;
      }
      const runtime = getRuntime(normalizedSessionId);
      if (!runtime) {
        return;
      }
      markUnread(runtime, opts.shouldMarkUnread);
      if (runtime.commandPhase === 'running') {
        scheduleRecentActivity(normalizedSessionId, runtime, 'output', quietMs);
        return;
      }
      scheduleRecentActivity(normalizedSessionId, runtime, 'output', quietMs);
    },

    pruneSessions(activeSessionIds: Set<string>) {
      for (const [sessionId, runtime] of runtimeBySession.entries()) {
        if (activeSessionIds.has(sessionId)) {
          continue;
        }
        clearRecentActivityTimer(runtime);
        clearPendingOutputTimer(runtime);
        runtimeBySession.delete(sessionId);
      }
    },

    dispose() {
      for (const runtime of runtimeBySession.values()) {
        clearRecentActivityTimer(runtime);
        clearPendingOutputTimer(runtime);
      }
      runtimeBySession.clear();
    },
  };
}
