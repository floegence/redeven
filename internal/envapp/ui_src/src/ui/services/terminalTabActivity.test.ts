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
