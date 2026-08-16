import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTerminalTabActivityTracker,
  observeTerminalSemanticWorkStates,
  shouldMarkTerminalSessionUnread,
} from './terminalTabActivity';

function semanticSession(input: Readonly<{
  identity?: 'pi' | 'claude' | 'codex';
  phase: 'idle' | 'working' | 'waiting_user';
  revision: number;
  contextRevision?: number;
  foregroundCommandRevision?: number;
  applicationKind?: 'agent_cli' | 'shell';
  source?: '' | 'semantic';
}>) {
  const contextRevision = input.contextRevision ?? 7;
  const foregroundCommandRevision = input.foregroundCommandRevision ?? 11;
  return {
    executionContext: {
      application: {
        kind: input.applicationKind ?? 'agent_cli',
        identity: input.identity ?? 'codex',
        displayName: input.identity ?? 'codex',
      },
      revision: contextRevision,
    },
    foregroundCommand: { revision: foregroundCommandRevision },
    workState: {
      phase: input.phase,
      source: input.source ?? 'semantic',
      contextRevision,
      foregroundCommandRevision,
      revision: input.revision,
    },
  };
}

function stockAgentSession(input: Readonly<{
  identity?: 'pi' | 'claude' | 'codex';
  outputPhase: 'streaming' | 'settled';
  outputRevision: number;
  contextRevision?: number;
  foregroundCommandRevision?: number;
  applicationKind?: 'agent_cli' | 'shell';
}>) {
  const contextRevision = input.contextRevision ?? 7;
  const foregroundCommandRevision = input.foregroundCommandRevision ?? 11;
  return {
    executionContext: {
      application: {
        kind: input.applicationKind ?? 'agent_cli',
        identity: input.identity ?? 'codex',
        displayName: input.identity ?? 'codex',
      },
      revision: contextRevision,
    },
    foregroundCommand: { revision: foregroundCommandRevision },
    workState: {
      phase: 'unknown',
      source: '',
      contextRevision: 0,
      foregroundCommandRevision: 0,
      revision: 0,
    },
    outputActivity: {
      phase: input.outputPhase,
      revision: input.outputRevision,
    },
  };
}

describe('createTerminalTabActivityTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['pi', 'claude', 'codex'] as const)(
    'tracks a stock %s Agent output batch from streaming until settled',
    (identity) => {
      const published: string[] = [];
      const tracker = createTerminalTabActivityTracker({
        publishVisualState: (_sessionId, state) => published.push(state),
      });

      tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
        identity, outputPhase: 'settled', outputRevision: 1,
      }), true);
      expect(published).toEqual([]);

      tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
        identity, outputPhase: 'streaming', outputRevision: 2,
      }), true);
      expect(published).toEqual(['unread']);

      tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
        identity, outputPhase: 'settled', outputRevision: 3,
      }), true);
      expect(published).toEqual(['unread']);
      tracker.dispose();
    },
  );

  it('treats an initial streaming snapshot and its settle as baseline only', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
    });

    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'streaming', outputRevision: 4,
    }), true);
    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'settled', outputRevision: 5,
    }), true);
    expect(published).toEqual([]);

    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'streaming', outputRevision: 6,
    }), true);
    expect(published).toEqual(['unread']);
    tracker.dispose();
  });

  it('does not restore a cleared unread batch when streaming settles', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
    });
    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'settled', outputRevision: 1,
    }), true);
    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'streaming', outputRevision: 2,
    }), true);
    tracker.clearUnread('session-1');
    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'settled', outputRevision: 3,
    }), true);
    expect(published).toEqual(['unread', 'none']);

    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'streaming', outputRevision: 4,
    }), true);
    expect(published).toEqual(['unread', 'none', 'unread']);
    tracker.dispose();
  });

  it('keeps valid semantic work authoritative over output activity', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
    });
    const semanticWorking = {
      ...stockAgentSession({ outputPhase: 'settled', outputRevision: 1 }),
      workState: semanticSession({ phase: 'working', revision: 1 }).workState,
    };
    const semanticIdle = {
      ...stockAgentSession({ outputPhase: 'streaming', outputRevision: 2 }),
      workState: semanticSession({ phase: 'idle', revision: 2 }).workState,
    };

    tracker.handleAgentSessionSnapshot('session-1', semanticWorking, true);
    tracker.handleAgentSessionSnapshot('session-1', semanticIdle, true);
    expect(published).toEqual(['unread']);
    tracker.dispose();
  });

  it('rejects output replay and resets unread when the Agent fence changes', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
    });
    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'settled', outputRevision: 4,
    }), true);
    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'streaming', outputRevision: 5,
    }), true);
    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'settled', outputRevision: 4,
    }), true);
    expect(published).toEqual(['unread']);

    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'streaming', outputRevision: 6, contextRevision: 8,
    }), true);
    expect(published).toEqual(['unread', 'none']);
    tracker.handleAgentSessionSnapshot('session-1', stockAgentSession({
      outputPhase: 'settled', outputRevision: 7, contextRevision: 8,
    }), true);
    expect(published).toEqual(['unread', 'none']);
    tracker.dispose();
  });

  it('does not use output activity for a focused Agent or ordinary shell', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
    });
    tracker.handleAgentSessionSnapshot('agent', stockAgentSession({
      outputPhase: 'settled', outputRevision: 1,
    }), false);
    tracker.handleAgentSessionSnapshot('agent', stockAgentSession({
      outputPhase: 'streaming', outputRevision: 2,
    }), false);
    tracker.handleAgentSessionSnapshot('shell', stockAgentSession({
      applicationKind: 'shell', outputPhase: 'settled', outputRevision: 1,
    }), true);
    tracker.handleAgentSessionSnapshot('shell', stockAgentSession({
      applicationKind: 'shell', outputPhase: 'streaming', outputRevision: 2,
    }), true);
    expect(published).toEqual([]);
    tracker.dispose();
  });

  it.each(['pi', 'claude', 'codex'] as const)(
    'marks a background %s Agent round unread only after semantic working completes',
    (identity) => {
      const published: string[] = [];
      const tracker = createTerminalTabActivityTracker({
        publishVisualState: (_sessionId, state) => published.push(state),
      });

      tracker.handleSemanticWorkState('session-1', semanticSession({ identity, phase: 'idle', revision: 1 }), true);
      expect(published).toEqual([]);

      tracker.handleSemanticWorkState('session-1', semanticSession({ identity, phase: 'working', revision: 2 }), true);
      expect(published).toEqual([]);

      tracker.handleSemanticWorkState('session-1', semanticSession({ identity, phase: 'idle', revision: 3 }), true);
      expect(published).toEqual(['unread']);
      tracker.dispose();
    },
  );

  it('consumes a focused completion without unread and marks the next background round', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
    });

    tracker.handleSemanticWorkState('session-1', semanticSession({ phase: 'working', revision: 1 }), false);
    tracker.handleSemanticWorkState('session-1', semanticSession({ phase: 'idle', revision: 2 }), false);
    expect(published).toEqual([]);

    tracker.handleSemanticWorkState('session-1', semanticSession({ phase: 'working', revision: 3 }), true);
    tracker.handleSemanticWorkState('session-1', semanticSession({ phase: 'idle', revision: 4 }), true);
    expect(published).toEqual(['unread']);

    tracker.clearUnread('session-1');
    expect(published).toEqual(['unread', 'none']);
    tracker.dispose();
  });

  it('preserves completion eligibility through waiting_user without replacing waiting attention', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
    });

    tracker.handleSemanticWorkState('session-1', semanticSession({ phase: 'working', revision: 1 }), true);
    tracker.handleSemanticWorkState('session-1', semanticSession({ phase: 'waiting_user', revision: 2 }), true);
    expect(published).toEqual([]);

    tracker.handleSemanticWorkState('session-1', semanticSession({ phase: 'idle', revision: 3 }), true);
    expect(published).toEqual(['unread']);
    tracker.dispose();
  });

  it('rejects stale, replayed, unfenced, and non-semantic completion observations', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
    });

    tracker.handleSemanticWorkState('session-1', semanticSession({ phase: 'working', revision: 5 }), true);
    tracker.handleSemanticWorkState('session-1', semanticSession({ phase: 'idle', revision: 5 }), true);
    tracker.handleSemanticWorkState('session-1', semanticSession({ phase: 'idle', revision: 4 }), true);
    tracker.handleSemanticWorkState('session-1', {
      ...semanticSession({ phase: 'idle', revision: 6 }),
      workState: {
        ...semanticSession({ phase: 'idle', revision: 6 }).workState,
        contextRevision: 6,
      },
    }, true);
    tracker.handleSemanticWorkState('session-1', semanticSession({
      applicationKind: 'shell', phase: 'idle', revision: 6,
    }), true);
    tracker.handleSemanticWorkState('session-1', semanticSession({
      phase: 'idle', revision: 6, source: '',
    }), true);
    expect(published).toEqual([]);

    tracker.handleSemanticWorkState('session-1', semanticSession({
      phase: 'working', revision: 1, contextRevision: 8,
    }), true);
    tracker.handleSemanticWorkState('session-1', semanticSession({
      phase: 'idle', revision: 6, contextRevision: 8,
    }), true);
    expect(published).toEqual([]);
    tracker.dispose();
  });

  it('does not treat ordinary terminal output quieting as an Agent completion', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handleSemanticWorkState('session-1', semanticSession({
      applicationKind: 'shell', phase: 'working', revision: 1,
    }), true);
    tracker.handleVisibleOutput('session-1', { source: 'live', byteLength: 8, shouldMarkUnread: false });
    vi.advanceTimersByTime(25);

    expect(published).toEqual([]);
    tracker.dispose();
  });

  it('requires actual terminal-panel focus before treating the active session as read', () => {
    const base = {
      sessionExists: true,
      sessionId: 'session-1',
      activeSessionId: 'session-1',
      terminalFocusOwner: true,
      panelHasFocus: true,
    };

    expect(shouldMarkTerminalSessionUnread(base)).toBe(false);
    expect(shouldMarkTerminalSessionUnread({ ...base, panelHasFocus: false })).toBe(true);
    expect(shouldMarkTerminalSessionUnread({ ...base, terminalFocusOwner: false })).toBe(true);
    expect(shouldMarkTerminalSessionUnread({ ...base, activeSessionId: 'session-2' })).toBe(true);
    expect(shouldMarkTerminalSessionUnread({ ...base, sessionExists: false })).toBe(false);
  });

  it('observes semantic work for a background session without a mounted Runtime', () => {
    const published: Array<{ sessionId: string; state: string }> = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (sessionId, state) => published.push({ sessionId, state }),
    });

    observeTerminalSemanticWorkStates([
      { id: 'background-session', ...semanticSession({ phase: 'working', revision: 1 }) },
    ], tracker, () => true);
    observeTerminalSemanticWorkStates([
      { id: 'background-session', ...semanticSession({ phase: 'idle', revision: 2 }) },
    ], tracker, () => true);

    expect(published).toEqual([{ sessionId: 'background-session', state: 'unread' }]);
    tracker.dispose();
  });

  it('publishes only boundary transitions while repeated live output refreshes the quiet timer', () => {
    const published: Array<{ sessionId: string; state: string }> = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (sessionId, state) => {
        published.push({ sessionId, state });
      },
      outputActivityGraceMs: 15,
      outputActivityQuietMs: 30,
    });

    tracker.handleCommandStart('session-1');
    tracker.handleVisibleOutput('session-1', { source: 'live', byteLength: 8, shouldMarkUnread: true });
    tracker.handleVisibleOutput('session-1', { source: 'live', byteLength: 12, shouldMarkUnread: true });
    tracker.handleVisibleOutput('session-1', { source: 'live', byteLength: 20, shouldMarkUnread: true });

    expect(published).toEqual([
      { sessionId: 'session-1', state: 'running' },
    ]);

    vi.advanceTimersByTime(29);
    expect(published).toEqual([
      { sessionId: 'session-1', state: 'running' },
    ]);

    vi.advanceTimersByTime(1);
    expect(published).toEqual([
      { sessionId: 'session-1', state: 'running' },
      { sessionId: 'session-1', state: 'unread' },
    ]);

    tracker.dispose();
  });

  it('lets a quiet command fall back to none after the grace window when no unread state is pending', () => {
    const published: string[] = [];
    const workStates: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => {
        published.push(state);
      },
      publishWorkState: (_sessionId, state) => {
        workStates.push(state);
      },
      outputActivityGraceMs: 10,
      outputActivityQuietMs: 25,
    });

    tracker.handleCommandStart('session-1');
    expect(published).toEqual(['running']);
    expect(workStates).toEqual(['active']);

    vi.advanceTimersByTime(10);
    expect(published).toEqual(['running', 'none']);
    expect(workStates).toEqual(['active', 'running']);

    tracker.handleCommandFinish('session-1', false);
    expect(published).toEqual(['running', 'none']);
    expect(workStates).toEqual(['active', 'running', 'idle']);

    tracker.dispose();
  });

  it('marks a live prompt-ready completion unread when the session is not being read', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
    });

    tracker.handleCommandStart('session-1');
    tracker.handlePromptReady('session-1', true);

    expect(published).toEqual(['running', 'unread']);
    tracker.dispose();
  });

  it('keeps an initial prompt-ready marker quiet', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
    });

    tracker.handlePromptReady('session-1', true);

    expect(published).toEqual([]);
    tracker.dispose();
  });

  it('promotes provisional unread output before a prompt-ready completion clears it', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: true });
    tracker.handlePromptReady('session-1', false);

    expect(published).toEqual(['running', 'unread']);
    tracker.dispose();
  });

  it('publishes brief active work for live output even when shell lifecycle markers are unavailable', () => {
    const published: string[] = [];
    const workStates: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => {
        published.push(state);
      },
      publishWorkState: (_sessionId, state) => {
        workStates.push(state);
      },
      outputActivityGraceMs: 10,
      outputActivityQuietMs: 25,
    });

    tracker.handleVisibleOutput('session-1', { source: 'live', byteLength: 8, shouldMarkUnread: false });

    expect(published).toEqual([]);
    expect(workStates).toEqual(['active']);

    vi.advanceTimersByTime(25);

    expect(published).toEqual([]);
    expect(workStates).toEqual(['active', 'idle']);

    tracker.dispose();
  });

  it('keeps visible-output activity independent from provisional output settlement', () => {
    const workStates: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: () => undefined,
      publishWorkState: (_sessionId, state) => workStates.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handleVisibleOutput('session-1', { source: 'live', byteLength: 8, shouldMarkUnread: false });
    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: false });
    tracker.handleOutputCommitted('session-1', { source: 'live', sequence: 4 });

    expect(workStates).toEqual(['active', 'running', 'active']);
    vi.advanceTimersByTime(25);
    expect(workStates).toEqual(['active', 'running', 'active', 'idle']);
    tracker.dispose();
  });

  it('shows pending background output as running until ordered output commits', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: true });
    expect(published).toEqual(['running']);

    tracker.handleOutputCommitted('session-1', { source: 'live', sequence: 4 });
    tracker.handleVisibleOutput('session-1', { source: 'live', byteLength: 8, shouldMarkUnread: true });
    expect(published).toEqual(['running', 'unread']);

    tracker.dispose();
  });

  it('falls back from pending background output to unread after the quiet window', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: true });
    vi.advanceTimersByTime(25);

    expect(published).toEqual(['running', 'unread']);
    tracker.dispose();
  });

  it('removes provisional unread state when retained history wins the same sequence', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: true });
    vi.advanceTimersByTime(25);
    expect(published).toEqual(['running', 'unread']);

    tracker.handleOutputCommitted('session-1', { source: 'history', sequence: 4 });
    expect(published).toEqual(['running', 'unread', 'none']);

    tracker.dispose();
  });

  it('settles provisional unread through a coverage-only history page', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: true });
    tracker.handlePendingLiveOutput('session-1', { sequence: 5, shouldMarkUnread: true });
    vi.advanceTimersByTime(25);
    expect(published).toEqual(['running', 'unread']);

    tracker.handleOutputCoverage('session-1', {
      attachGeneration: 1,
      coveredThroughSequence: 5,
    });
    expect(published).toEqual(['running', 'unread', 'none']);

    tracker.dispose();
  });

  it('keeps running continuous when coverage settles before shell semantics commit', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: true });
    tracker.handleOutputCoverage('session-1', {
      attachGeneration: 1,
      coveredThroughSequence: 4,
    });
    tracker.handleCommandStart('session-1');
    tracker.handleOutputCommitted('session-1', { source: 'live', sequence: 4 });

    expect(published).toEqual(['running']);
    tracker.dispose();
  });

  it('preserves provisional unread when the attach generation changes or history rebases', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: true });
    tracker.handleOutputCoverage('session-1', { attachGeneration: 1, coveredThroughSequence: 0 });
    tracker.handleOutputCoverage('session-1', { attachGeneration: 2, coveredThroughSequence: 0 });
    expect(published).toEqual(['running']);
    vi.advanceTimersByTime(25);
    expect(published).toEqual(['running', 'unread']);

    tracker.handlePendingLiveOutput('session-1', { sequence: 8, shouldMarkUnread: true });
    tracker.handleOutputCoverage('session-1', {
      attachGeneration: 2,
      coveredThroughSequence: 2,
      rebased: true,
    });
    expect(published).toEqual(['running', 'unread', 'running']);
    vi.advanceTimersByTime(25);
    expect(published).toEqual(['running', 'unread', 'running', 'unread']);

    tracker.dispose();
  });

  it('does not recreate provisional unread for a sequence already committed before writer completion', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: true });
    tracker.handleOutputCommitted('session-1', { source: 'live', sequence: 4 });
    tracker.clearUnread('session-1');
    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: true });
    vi.advanceTimersByTime(25);

    expect(published).toEqual(['running', 'unread', 'none']);
    tracker.dispose();
  });

  it('resets sequenced and unsequenced provisional output without clearing confirmed unread', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handleVisibleOutput('session-1', { source: 'live', byteLength: 1, shouldMarkUnread: true });
    tracker.handlePendingLiveOutput('session-1', { shouldMarkUnread: true });
    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: true });
    tracker.resetPendingOutput('session-1');

    expect(published).toEqual(['unread', 'running']);
    vi.advanceTimersByTime(25);
    expect(published).toEqual(['unread', 'running', 'unread']);
    tracker.dispose();
  });

  it('drops provisional unread only for an explicit clear-history reset', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    tracker.handlePendingLiveOutput('session-1', { sequence: 4, shouldMarkUnread: true });
    tracker.resetPendingOutput('session-1', { preserveUnread: false });
    vi.advanceTimersByTime(25);

    expect(published).toEqual(['running', 'none']);
    tracker.dispose();
  });

  it('keeps provisional sequence tracking bounded under retained output overflow', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => published.push(state),
      outputActivityQuietMs: 25,
    });

    for (let sequence = 1; sequence <= 2_100; sequence += 1) {
      tracker.handlePendingLiveOutput('session-1', { sequence, shouldMarkUnread: true });
    }
    tracker.handleOutputCoverage('session-1', {
      attachGeneration: 1,
      coveredThroughSequence: 2_100,
    });
    vi.advanceTimersByTime(25);

    expect(published).toEqual(['running', 'unread']);
    tracker.dispose();
  });

  it('keeps explicit busy activity authoritative and falls back to unread on idle', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => {
        published.push(state);
      },
      outputActivityGraceMs: 10,
      outputActivityQuietMs: 25,
    });

    tracker.handleProgramActivity('session-1', 'busy');
    tracker.handleVisibleOutput('session-1', { source: 'live', byteLength: 16, shouldMarkUnread: true });

    expect(published).toEqual(['running']);

    tracker.handleProgramActivity('session-1', 'idle');
    expect(published).toEqual(['running', 'unread']);

    tracker.dispose();
  });

  it('clears unread without disturbing an active running indicator', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => {
        published.push(state);
      },
      outputActivityGraceMs: 10,
      outputActivityQuietMs: 25,
    });

    tracker.handleCommandStart('session-1');
    tracker.handleVisibleOutput('session-1', { source: 'live', byteLength: 10, shouldMarkUnread: true });
    tracker.clearUnread('session-1');

    expect(published).toEqual(['running']);

    vi.advanceTimersByTime(25);
    expect(published).toEqual(['running', 'none']);

    tracker.dispose();
  });

  it('stops pending timers when a session is pruned', () => {
    const published: string[] = [];
    const tracker = createTerminalTabActivityTracker({
      publishVisualState: (_sessionId, state) => {
        published.push(state);
      },
      outputActivityGraceMs: 10,
      outputActivityQuietMs: 25,
    });

    tracker.handleCommandStart('session-1');
    tracker.pruneSessions(new Set());
    vi.advanceTimersByTime(100);

    expect(published).toEqual(['running']);

    tracker.dispose();
  });
});
