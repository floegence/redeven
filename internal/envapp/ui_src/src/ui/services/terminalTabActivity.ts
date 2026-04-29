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
  activityTimer: ReturnType<typeof setTimeout> | null;
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
  handleVisibleOutput: (sessionId: string, opts: { source: 'history' | 'live'; byteLength: number; shouldMarkUnread: boolean }) => void;
  pruneSessions: (activeSessionIds: Set<string>) => void;
  dispose: () => void;
}

const DEFAULT_OUTPUT_ACTIVITY_GRACE_MS = 1_500;
const DEFAULT_OUTPUT_ACTIVITY_QUIET_MS = 3_500;

function createEmptyRuntime(): TerminalSessionActivityRuntime {
  return {
    commandPhase: 'idle',
    programActivityPhase: 'unknown',
    unread: false,
    recentActivityPhase: 'inactive',
    activityTimer: null,
    visualState: 'none',
    workState: 'idle',
  };
}

function computeVisualState(runtime: TerminalSessionActivityRuntime): TerminalTabVisualState {
  if (runtime.programActivityPhase === 'busy') {
    return 'running';
  }
  if (runtime.commandPhase === 'running' && runtime.recentActivityPhase !== 'inactive') {
    return 'running';
  }
  if (runtime.unread) {
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

  const clearActivityTimer = (runtime: TerminalSessionActivityRuntime) => {
    if (runtime.activityTimer == null) {
      return;
    }
    cancelTimeout(runtime.activityTimer);
    runtime.activityTimer = null;
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
    clearActivityTimer(runtime);
    runtime.recentActivityPhase = phase;
    publishIfNeeded(sessionId, runtime);
    runtime.activityTimer = scheduleTimeout(() => {
      runtime.activityTimer = null;
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
        return;
      }
      runtime.unread = false;
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
      clearActivityTimer(runtime);
      runtime.commandPhase = 'idle';
      runtime.programActivityPhase = 'idle';
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
      clearActivityTimer(runtime);
      runtime.commandPhase = 'idle';
      runtime.programActivityPhase = 'idle';
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
      if (phase === 'idle') {
        clearActivityTimer(runtime);
        runtime.recentActivityPhase = 'inactive';
      }
      publishIfNeeded(normalizedSessionId, runtime);
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
        clearActivityTimer(runtime);
        runtimeBySession.delete(sessionId);
      }
    },

    dispose() {
      for (const runtime of runtimeBySession.values()) {
        clearActivityTimer(runtime);
      }
      runtimeBySession.clear();
    },
  };
}
