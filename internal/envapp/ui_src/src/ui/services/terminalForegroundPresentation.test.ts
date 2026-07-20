import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSessionInfo } from '@floegence/floeterm-terminal-web';

import { createTerminalForegroundPresentationScheduler } from './terminalForegroundPresentation';

const makeSession = (
  id: string,
  foregroundCommand: TerminalSessionInfo['foregroundCommand'],
): TerminalSessionInfo => ({
  id,
  name: id,
  workingDir: `/workspace/${id}`,
  createdAtMs: 1,
  lastActiveAtMs: 1,
  isActive: true,
  foregroundCommand,
});

describe('createTerminalForegroundPresentationScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never presents a command that returns idle before the 140ms threshold', () => {
    const snapshots: ReadonlyMap<string, { displayName: string; revision: number }>[] = [];
    const scheduler = createTerminalForegroundPresentationScheduler({
      publish: (snapshot) => snapshots.push(snapshot),
    });

    scheduler.sync([makeSession('s1', {
      phase: 'running', displayName: 'top', revision: 1, updatedAtMs: 1,
    })]);
    vi.advanceTimersByTime(139);
    scheduler.sync([makeSession('s1', {
      phase: 'idle', displayName: '', revision: 2, updatedAtMs: 2,
    })]);
    vi.advanceTimersByTime(1);

    expect(snapshots).toEqual([]);
    expect(scheduler.getSnapshot().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    scheduler.dispose();
  });

  it('presents running after 140ms, does not postpone the same revision, and restores idle immediately', () => {
    const scheduler = createTerminalForegroundPresentationScheduler({ publish: vi.fn() });
    const running = makeSession('s1', {
      phase: 'running', displayName: 'top', revision: 3, updatedAtMs: 3,
    });

    scheduler.sync([running]);
    vi.advanceTimersByTime(100);
    scheduler.sync([running]);
    vi.advanceTimersByTime(39);
    expect(scheduler.getSnapshot().size).toBe(0);
    vi.advanceTimersByTime(1);
    expect(scheduler.getSnapshot().get('s1')).toEqual({ displayName: 'top', revision: 3 });

    scheduler.sync([makeSession('s1', {
      phase: 'idle', displayName: '', revision: 4, updatedAtMs: 4,
    })]);
    expect(scheduler.getSnapshot().size).toBe(0);
    scheduler.dispose();
  });

  it('uses one timer for 200 sessions and ignores stale revisions', () => {
    const scheduler = createTerminalForegroundPresentationScheduler({ publish: vi.fn() });
    const sessions = Array.from({ length: 200 }, (_, index) => makeSession(`s${index}`, {
      phase: 'running', displayName: 'sleep', revision: 5, updatedAtMs: 5,
    }));

    scheduler.sync(sessions);
    expect(vi.getTimerCount()).toBe(1);
    scheduler.sync(sessions.map((session) => ({
      ...session,
      foregroundCommand: {
        phase: 'idle' as const, displayName: '', revision: 4, updatedAtMs: 6,
      },
    })));
    vi.advanceTimersByTime(140);

    expect(scheduler.getSnapshot().size).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
    scheduler.dispose();
  });
});
