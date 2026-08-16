export type TerminalCommandPhase = 'idle' | 'running';
export type TerminalProgramActivityPhase = 'unknown' | 'busy' | 'idle';
export type TerminalTabVisualState = 'none' | 'running' | 'unread';
export type TerminalSessionWorkState = 'idle' | 'running' | 'active';
type TerminalRecentActivityPhase = 'inactive' | 'grace' | 'output';

export type TerminalSemanticWorkObservation = Readonly<{
  executionContext?: Readonly<{
    application?: Readonly<{ kind?: string }>;
    revision?: number;
  }>;
  foregroundCommand?: Readonly<{ revision?: number }>;
  workState?: Readonly<{
    phase?: string;
    source?: string;
    contextRevision?: number;
    foregroundCommandRevision?: number;
    revision?: number;
  }>;
  outputActivity?: Readonly<{
    phase?: string;
    revision?: number;
  }>;
}>;

type TerminalSemanticWorkRuntime = Readonly<{
  contextRevision: number;
  foregroundCommandRevision: number;
  revision: number;
  phase: 'idle' | 'working' | 'waiting_user';
  observedWorking: boolean;
}>;

type TerminalAgentOutputRuntime = Readonly<{
  contextRevision: number;
  foregroundCommandRevision: number;
  revision: number;
  phase: 'streaming' | 'settled';
}>;

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
  semanticWork: TerminalSemanticWorkRuntime | null;
  agentOutput: TerminalAgentOutputRuntime | null;
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
  handlePromptReady: (sessionId: string, shouldMarkUnread: boolean) => void;
  handleProgramActivity: (sessionId: string, phase: Exclude<TerminalProgramActivityPhase, 'unknown'>) => void;
  handleSemanticWorkState: (
    sessionId: string,
    observation: TerminalSemanticWorkObservation,
    shouldMarkUnread: boolean,
  ) => void;
  handleAgentSessionSnapshot: (
    sessionId: string,
    observation: TerminalSemanticWorkObservation,
    shouldMarkUnread: boolean,
  ) => void;
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

export function shouldMarkTerminalSessionUnread(input: Readonly<{
  sessionExists: boolean;
  sessionId: string;
  activeSessionId: string | null;
  terminalFocusOwner: boolean;
  panelHasFocus: boolean;
}>): boolean {
  const sessionId = String(input.sessionId ?? '').trim();
  if (!sessionId || !input.sessionExists) return false;
  return input.activeSessionId !== sessionId
    || !input.terminalFocusOwner
    || !input.panelHasFocus;
}

export function observeTerminalSemanticWorkStates(
  sessions: readonly (TerminalSemanticWorkObservation & Readonly<{ id: string }>)[],
  tracker: Pick<TerminalTabActivityTracker, 'handleSemanticWorkState'>,
  shouldMarkUnread: (sessionId: string) => boolean,
): void {
  for (const session of sessions) {
    tracker.handleSemanticWorkState(session.id, session, shouldMarkUnread(session.id));
  }
}

export function observeTerminalAgentAttentionStates(
  sessions: readonly (TerminalSemanticWorkObservation & Readonly<{ id: string }>)[],
  tracker: Pick<TerminalTabActivityTracker, 'handleAgentSessionSnapshot'>,
  shouldMarkUnread: (sessionId: string) => boolean,
): void {
  for (const session of sessions) {
    tracker.handleAgentSessionSnapshot(session.id, session, shouldMarkUnread(session.id));
  }
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
    semanticWork: null,
    agentOutput: null,
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

  const handleSemanticWorkState = (
    sessionId: string,
    observation: TerminalSemanticWorkObservation,
    shouldMarkUnread: boolean,
  ) => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId || observation.executionContext?.application?.kind !== 'agent_cli') {
      return;
    }
    const contextRevision = observation.executionContext.revision;
    const foregroundCommandRevision = observation.foregroundCommand?.revision;
    const workState = observation.workState;
    const revision = workState?.revision;
    const phase = workState?.phase;
    if (
      workState?.source !== 'semantic'
      || typeof contextRevision !== 'number'
      || !Number.isSafeInteger(contextRevision)
      || typeof foregroundCommandRevision !== 'number'
      || !Number.isSafeInteger(foregroundCommandRevision)
      || typeof revision !== 'number'
      || !Number.isSafeInteger(revision)
      || workState.contextRevision !== contextRevision
      || workState.foregroundCommandRevision !== foregroundCommandRevision
      || (phase !== 'idle' && phase !== 'working' && phase !== 'waiting_user')
    ) {
      return;
    }

    const runtime = getRuntime(normalizedSessionId);
    if (!runtime) return;
    const previous = runtime.semanticWork;
    const sameFence = previous?.contextRevision === contextRevision
      && previous.foregroundCommandRevision === foregroundCommandRevision;
    if (previous && (
      contextRevision < previous.contextRevision
      || foregroundCommandRevision < previous.foregroundCommandRevision
      || revision <= previous.revision
    )) {
      return;
    }
    if (!sameFence) {
      runtime.semanticWork = {
        contextRevision,
        foregroundCommandRevision,
        revision,
        phase,
        observedWorking: phase === 'working',
      };
      return;
    }
    if (!previous) return;

    const completedRound = phase === 'idle' && previous.observedWorking;
    runtime.semanticWork = {
      contextRevision,
      foregroundCommandRevision,
      revision,
      phase,
      observedWorking: phase === 'working'
        || (phase === 'waiting_user' && previous.observedWorking),
    };
    markUnread(runtime, completedRound && shouldMarkUnread);
    publishIfNeeded(normalizedSessionId, runtime);
  };

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

    handlePromptReady(sessionId: string, shouldMarkUnread: boolean) {
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
      const completedWork = runtime.commandPhase === 'running'
        || runtime.pendingLiveOutput
        || runtime.recentActivityPhase !== 'inactive'
        || runtime.programActivityPhase === 'busy';
      runtime.commandPhase = 'idle';
      runtime.programActivityPhase = 'idle';
      // A prompt-ready marker can be the only completion signal for an Agent round.
      promotePendingUnread(runtime);
      clearPendingOutput(runtime);
      runtime.recentActivityPhase = 'inactive';
      markUnread(runtime, shouldMarkUnread && completedWork);
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

    handleSemanticWorkState,

    handleAgentSessionSnapshot(
      sessionId: string,
      observation: TerminalSemanticWorkObservation,
      shouldMarkUnread: boolean,
    ) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (!normalizedSessionId) return;
      const existingRuntime = runtimeBySession.get(normalizedSessionId);
      if (observation.executionContext?.application?.kind !== 'agent_cli') {
        if (!existingRuntime || (!existingRuntime.semanticWork && !existingRuntime.agentOutput)) return;
        existingRuntime.semanticWork = null;
        existingRuntime.agentOutput = null;
        existingRuntime.unread = false;
        publishIfNeeded(normalizedSessionId, existingRuntime);
        return;
      }

      const contextRevision = observation.executionContext.revision;
      const foregroundCommandRevision = observation.foregroundCommand?.revision;
      const workState = observation.workState;
      const outputActivity = observation.outputActivity;
      if (
        typeof contextRevision !== 'number'
        || !Number.isSafeInteger(contextRevision)
        || typeof foregroundCommandRevision !== 'number'
        || !Number.isSafeInteger(foregroundCommandRevision)
      ) {
        return;
      }

      const runtime = getRuntime(normalizedSessionId);
      if (!runtime) return;
      const previousFence = runtime.semanticWork ?? runtime.agentOutput;
      if (previousFence && (
        contextRevision < previousFence.contextRevision
        || foregroundCommandRevision < previousFence.foregroundCommandRevision
      )) {
        return;
      }
      const sameFence = previousFence?.contextRevision === contextRevision
        && previousFence.foregroundCommandRevision === foregroundCommandRevision;
      const outputRevision = outputActivity?.revision;
      const outputPhase = outputActivity?.phase;
      const validOutput = typeof outputRevision === 'number'
        && Number.isSafeInteger(outputRevision)
        && (outputPhase === 'streaming' || outputPhase === 'settled');
      const validSemantic = workState?.source === 'semantic'
        && workState.contextRevision === contextRevision
        && workState.foregroundCommandRevision === foregroundCommandRevision
        && typeof workState.revision === 'number'
        && Number.isSafeInteger(workState.revision)
        && (workState.phase === 'idle' || workState.phase === 'working' || workState.phase === 'waiting_user');

      if (!sameFence) {
        runtime.semanticWork = null;
        runtime.agentOutput = validOutput ? {
          contextRevision,
          foregroundCommandRevision,
          revision: outputRevision,
          phase: outputPhase,
        } : null;
        runtime.unread = false;
        publishIfNeeded(normalizedSessionId, runtime);
        if (validSemantic) handleSemanticWorkState(normalizedSessionId, observation, shouldMarkUnread);
        return;
      }

      if (validSemantic) {
        if (validOutput && (!runtime.agentOutput || outputRevision > runtime.agentOutput.revision)) {
          runtime.agentOutput = {
            contextRevision,
            foregroundCommandRevision,
            revision: outputRevision,
            phase: outputPhase,
          };
        }
        handleSemanticWorkState(normalizedSessionId, observation, shouldMarkUnread);
        return;
      }
      if (runtime.semanticWork || !validOutput) return;
      const previousOutput = runtime.agentOutput;
      if (!previousOutput || outputRevision <= previousOutput.revision) return;
      runtime.agentOutput = {
        contextRevision,
        foregroundCommandRevision,
        revision: outputRevision,
        phase: outputPhase,
      };
      markUnread(runtime, outputPhase === 'streaming'
        && previousOutput.phase !== 'streaming'
        && shouldMarkUnread);
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
