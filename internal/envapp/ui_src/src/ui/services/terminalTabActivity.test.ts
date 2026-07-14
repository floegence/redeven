import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTerminalTabActivityTracker } from './terminalTabActivity';

describe('createTerminalTabActivityTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('clears pending output when the attach generation changes or history rebases', () => {
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
    expect(published).toEqual(['running', 'none']);

    tracker.handlePendingLiveOutput('session-1', { sequence: 8, shouldMarkUnread: true });
    tracker.handleOutputCoverage('session-1', {
      attachGeneration: 2,
      coveredThroughSequence: 2,
      rebased: true,
    });
    expect(published).toEqual(['running', 'none', 'running']);
    vi.advanceTimersByTime(25);
    expect(published).toEqual(['running', 'none', 'running', 'none']);

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

    expect(published).toEqual(['running', 'none']);
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
