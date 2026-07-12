import { describe, expect, it, vi } from 'vitest';
import type {
  TerminalResourceEstimate,
  TerminalRestorableSnapshot,
} from '@floegence/floeterm-terminal-web';
import {
  TERMINAL_WORKING_SET_ACTIVE_WINDOW_MS,
  TERMINAL_WORKING_SET_DEFAULT_BUDGET_BYTES,
  TERMINAL_WORKING_SET_HIDDEN_DELAY_MS,
  createTerminalAdaptiveWorkingSetManager,
  restoreTerminalSnapshotOrReplay,
  resolveTerminalSnapshotBudgetBytes,
  resolveTerminalWarmBudgetBytes,
  type TerminalWorkingSetRuntime,
} from './terminalAdaptiveWorkingSet';

const MIB = 1024 * 1024;

function createHarness() {
  let nowMs = 1_000;
  let nextHandle = 1;
  const idleCallbacks = new Map<number, () => void>();
  const timers = new Map<number, { callback: () => void; dueAtMs: number }>();
  const cancelledIdle: number[] = [];
  const clearedTimers: number[] = [];

  const runIdle = () => {
    const next = idleCallbacks.entries().next().value as [number, () => void] | undefined;
    if (!next) return false;
    idleCallbacks.delete(next[0]);
    next[1]();
    return true;
  };

  const advance = (durationMs: number) => {
    nowMs += durationMs;
    let ranTimer = true;
    while (ranTimer) {
      ranTimer = false;
      for (const [handle, timer] of [...timers]) {
        if (timer.dueAtMs > nowMs) continue;
        timers.delete(handle);
        timer.callback();
        ranTimer = true;
      }
    }
  };

  return {
    now: () => nowMs,
    advance,
    runIdle,
    idleCallbacks,
    timers,
    cancelledIdle,
    clearedTimers,
    scheduler: {
      scheduleIdle: (callback: () => void) => {
        const handle = nextHandle++;
        idleCallbacks.set(handle, callback);
        return handle;
      },
      cancelIdle: (handle: number) => {
        cancelledIdle.push(handle);
        idleCallbacks.delete(handle);
      },
      setTimer: (callback: () => void, delayMs: number) => {
        const handle = nextHandle++ as unknown as ReturnType<typeof setTimeout>;
        timers.set(handle as unknown as number, { callback, dueAtMs: nowMs + delayMs });
        return handle;
      },
      clearTimer: (handle: ReturnType<typeof setTimeout>) => {
        clearedTimers.push(handle as unknown as number);
        timers.delete(handle as unknown as number);
      },
    },
  };
}

function resourceEstimate(estimatedBytes: number): TerminalResourceEstimate {
  return {
    bufferBytes: Math.floor(estimatedBytes / 4),
    cellCount: 2_000,
    estimatedBytes,
    rendererType: 'webgl',
  };
}

function restorableSnapshot(byteLength: number, coveredThroughSequence = 10): TerminalRestorableSnapshot {
  return {
    version: 1,
    data: 'snapshot',
    byteLength,
    partial: false,
    coveredThroughSequence,
    cols: 120,
    rows: 32,
    createdAtMs: 1_000,
  };
}

function createRuntime(
  estimatedBytes: number,
  snapshotBytes = 2 * MIB,
): TerminalWorkingSetRuntime & {
  hibernate: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
} {
  return {
    getResourceEstimate: () => resourceEstimate(estimatedBytes),
    hibernate: vi.fn(() => restorableSnapshot(snapshotBytes)),
    resume: vi.fn(async () => undefined),
  };
}

async function settleTransitions() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('terminal adaptive working set budgets', () => {
  it('uses a compatible in-memory snapshot without replaying history', async () => {
    const snapshot = restorableSnapshot(1024, 42);
    const restoreSnapshot = vi.fn().mockResolvedValue(true);
    const replayHistory = vi.fn().mockResolvedValue(undefined);

    await expect(restoreTerminalSnapshotOrReplay({
      snapshot,
      restoreSnapshot,
      replayHistory,
    })).resolves.toBe('snapshot');

    expect(restoreSnapshot).toHaveBeenCalledWith(snapshot);
    expect(replayHistory).not.toHaveBeenCalled();
  });

  it.each(['incompatible', 'damaged'] as const)('falls back to paged history for a %s snapshot', async (mode) => {
    const snapshot = restorableSnapshot(1024, 42);
    const restoreSnapshot = mode === 'incompatible'
      ? vi.fn().mockResolvedValue(false)
      : vi.fn().mockRejectedValue(new Error('damaged snapshot'));
    const replayHistory = vi.fn().mockResolvedValue(undefined);

    await expect(restoreTerminalSnapshotOrReplay({
      snapshot,
      restoreSnapshot,
      replayHistory,
    })).resolves.toBe('history');

    expect(replayHistory).toHaveBeenCalledTimes(1);
  });

  it('replays history directly when the snapshot pool has no entry', async () => {
    const restoreSnapshot = vi.fn().mockResolvedValue(true);
    const replayHistory = vi.fn().mockResolvedValue(undefined);

    await expect(restoreTerminalSnapshotOrReplay({
      snapshot: null,
      restoreSnapshot,
      replayHistory,
    })).resolves.toBe('history');

    expect(restoreSnapshot).not.toHaveBeenCalled();
    expect(replayHistory).toHaveBeenCalledTimes(1);
  });

  it('uses the device-adaptive clamp and the 256 MiB fallback', () => {
    expect(resolveTerminalWarmBudgetBytes(undefined)).toBe(TERMINAL_WORKING_SET_DEFAULT_BUDGET_BYTES);
    expect(resolveTerminalWarmBudgetBytes(1)).toBe(128 * MIB);
    expect(resolveTerminalWarmBudgetBytes(8)).toBe(256 * MIB);
    expect(resolveTerminalWarmBudgetBytes(64)).toBe(512 * MIB);
    expect(resolveTerminalSnapshotBudgetBytes(128 * MIB)).toBe(32 * MIB);
    expect(resolveTerminalSnapshotBudgetBytes(512 * MIB)).toBe(64 * MIB);
  });

  it('keeps every core warm below budget, including more than four cores', async () => {
    const harness = createHarness();
    const manager = createTerminalAdaptiveWorkingSetManager({
      deviceMemoryGiB: 8,
      now: harness.now,
      scheduler: harness.scheduler,
    });
    const runtimes = Array.from({ length: 20 }, () => createRuntime(10 * MIB));
    runtimes.forEach((runtime, index) => manager.register(`session-${index}`, runtime));

    while (harness.runIdle()) await settleTransitions();

    expect(manager.getSnapshot().entries).toHaveLength(20);
    expect(manager.getSnapshot().entries.every((entry) => entry.warm)).toBe(true);
    expect(runtimes.every((runtime) => runtime.hibernate.mock.calls.length === 0)).toBe(true);
  });

  it.each([6, 10, 20])('protects a frequently switched %i-session hot set without a count cap', async (count) => {
    const harness = createHarness();
    const manager = createTerminalAdaptiveWorkingSetManager({
      deviceMemoryGiB: 4,
      now: harness.now,
      scheduler: harness.scheduler,
    });
    const runtimes = Array.from({ length: count }, () => createRuntime(8 * MIB));
    runtimes.forEach((runtime, index) => manager.register(`session-${index}`, runtime));
    for (let round = 0; round < 3; round += 1) {
      for (let index = 0; index < count; index += 1) {
        harness.advance(50);
        manager.setActiveSession(`session-${index}`);
      }
    }

    while (harness.runIdle()) await settleTransitions();

    expect(runtimes.every((runtime) => runtime.hibernate.mock.calls.length === 0)).toBe(true);
    expect(manager.getSnapshot().entries.every((entry) => entry.warm)).toBe(true);
  });
});

describe('terminal adaptive working set eviction', () => {
  it('hibernates the least-recently-used cold inactive core above the soft budget', async () => {
    const harness = createHarness();
    const manager = createTerminalAdaptiveWorkingSetManager({
      deviceMemoryGiB: 4,
      now: harness.now,
      scheduler: harness.scheduler,
    });
    const first = createRuntime(50 * MIB);
    const second = createRuntime(50 * MIB);
    const active = createRuntime(50 * MIB);
    manager.register('first', first);
    manager.register('second', second);
    manager.register('active', active);
    manager.setActiveSession('first');
    harness.advance(1_000);
    manager.setActiveSession('second');
    harness.advance(1_000);
    manager.setActiveSession('active');
    harness.advance(TERMINAL_WORKING_SET_ACTIVE_WINDOW_MS + 1);

    expect(harness.runIdle()).toBe(true);
    await settleTransitions();

    expect(first.hibernate).toHaveBeenCalledTimes(1);
    expect(second.hibernate).not.toHaveBeenCalled();
    expect(active.hibernate).not.toHaveBeenCalled();
  });

  it('protects the two-minute active set between the soft and 150% budgets', async () => {
    const harness = createHarness();
    const manager = createTerminalAdaptiveWorkingSetManager({
      deviceMemoryGiB: 4,
      now: harness.now,
      scheduler: harness.scheduler,
    });
    const runtimes = ['one', 'two', 'three'].map(() => createRuntime(50 * MIB));
    runtimes.forEach((runtime, index) => manager.register(String(index), runtime));
    manager.setActiveSession('0');
    harness.advance(10);
    manager.setActiveSession('1');
    harness.advance(10);
    manager.setActiveSession('2');

    while (harness.runIdle()) await settleTransitions();

    expect(runtimes.every((runtime) => runtime.hibernate.mock.calls.length === 0)).toBe(true);
  });

  it('can reduce a recent inactive set above 150% but never hibernates the current core', async () => {
    const harness = createHarness();
    const manager = createTerminalAdaptiveWorkingSetManager({
      deviceMemoryGiB: 4,
      now: harness.now,
      scheduler: harness.scheduler,
    });
    const runtimes = ['oldest', 'middle', 'active'].map(() => createRuntime(70 * MIB));
    runtimes.forEach((runtime, index) => manager.register(String(index), runtime));
    manager.setActiveSession('0');
    harness.advance(10);
    manager.setActiveSession('1');
    harness.advance(10);
    manager.setActiveSession('2');

    expect(harness.runIdle()).toBe(true);
    await settleTransitions();

    expect(runtimes[0]?.hibernate).toHaveBeenCalledTimes(1);
    expect(runtimes[2]?.hibernate).not.toHaveBeenCalled();
  });

  it.each(['input', 'composition', 'selection', 'search', 'context-menu'] as const)(
    'does not hibernate a core protected by %s interaction',
    async (interaction) => {
      const harness = createHarness();
      const manager = createTerminalAdaptiveWorkingSetManager({
        deviceMemoryGiB: 4,
        now: harness.now,
        scheduler: harness.scheduler,
      });
      const protectedRuntime = createRuntime(100 * MIB);
      const activeRuntime = createRuntime(100 * MIB);
      manager.register('protected', protectedRuntime);
      manager.register('active', activeRuntime);
      manager.setInteraction('protected', interaction, true);
      manager.setActiveSession('active');

      while (harness.runIdle()) await settleTransitions();

      expect(protectedRuntime.hibernate).not.toHaveBeenCalled();
      expect(activeRuntime.hibernate).not.toHaveBeenCalled();
    },
  );
});

describe('terminal adaptive working set snapshots and page visibility', () => {
  it('hibernates inactive cores after ten hidden minutes and does not auto-resume on visibility', async () => {
    const harness = createHarness();
    const manager = createTerminalAdaptiveWorkingSetManager({
      deviceMemoryGiB: 8,
      now: harness.now,
      scheduler: harness.scheduler,
    });
    const inactive = createRuntime(10 * MIB);
    const active = createRuntime(10 * MIB);
    manager.register('inactive', inactive);
    manager.register('active', active);
    manager.setActiveSession('active');
    manager.setPageHidden(true);
    harness.advance(TERMINAL_WORKING_SET_HIDDEN_DELAY_MS - 1);
    while (harness.runIdle()) await settleTransitions();
    expect(inactive.hibernate).not.toHaveBeenCalled();

    harness.advance(1);
    expect(harness.runIdle()).toBe(true);
    await settleTransitions();
    expect(inactive.hibernate).toHaveBeenCalledTimes(1);

    manager.setPageHidden(false);
    await settleTransitions();
    expect(inactive.resume).not.toHaveBeenCalled();
  });

  it('passes an in-memory snapshot to resume and removes it from the pool', async () => {
    const harness = createHarness();
    const manager = createTerminalAdaptiveWorkingSetManager({
      deviceMemoryGiB: 4,
      now: harness.now,
      scheduler: harness.scheduler,
    });
    const sleeping = createRuntime(100 * MIB);
    const active = createRuntime(100 * MIB);
    manager.register('sleeping', sleeping);
    manager.register('active', active);
    manager.setActiveSession('active');
    expect(harness.runIdle()).toBe(true);
    await settleTransitions();
    expect(manager.getSnapshot().snapshotBytes).toBe(2 * MIB);

    manager.setActiveSession('sleeping');
    await settleTransitions();

    expect(sleeping.resume).toHaveBeenCalledTimes(1);
    expect(sleeping.resume.mock.calls[0]?.[0]).toMatchObject({ coveredThroughSequence: 10 });
    expect(manager.getSnapshot().snapshotBytes).toBe(0);
  });

  it('evicts snapshots by LRU within min(64 MiB, warmBudget / 4)', async () => {
    const harness = createHarness();
    const manager = createTerminalAdaptiveWorkingSetManager({
      deviceMemoryGiB: 4,
      now: harness.now,
      scheduler: harness.scheduler,
    });
    const first = createRuntime(70 * MIB, 20 * MIB);
    const second = createRuntime(70 * MIB, 20 * MIB);
    const active = createRuntime(70 * MIB, 20 * MIB);
    manager.register('first', first);
    manager.register('second', second);
    manager.register('active', active);
    manager.setActiveSession('active');

    expect(harness.runIdle()).toBe(true);
    await settleTransitions();
    harness.advance(1);
    while (harness.runIdle()) await settleTransitions();

    const snapshot = manager.getSnapshot();
    expect(snapshot.snapshotBudgetBytes).toBe(32 * MIB);
    expect(snapshot.snapshotBytes).toBeLessThanOrEqual(32 * MIB);
    expect(snapshot.entries.find((entry) => entry.sessionId === 'first')?.snapshotBytes).toBe(0);
    expect(snapshot.entries.find((entry) => entry.sessionId === 'second')?.snapshotBytes).toBe(20 * MIB);
  });

  it('cleans idle callbacks and hidden timers on dispose', () => {
    const harness = createHarness();
    const manager = createTerminalAdaptiveWorkingSetManager({
      now: harness.now,
      scheduler: harness.scheduler,
    });
    manager.register('one', createRuntime(1 * MIB));
    manager.setPageHidden(true);

    manager.dispose();

    expect(harness.idleCallbacks.size).toBe(0);
    expect(harness.timers.size).toBe(0);
    expect(harness.cancelledIdle).toHaveLength(1);
    expect(harness.clearedTimers).toHaveLength(1);
  });

  it('does not hibernate during rapid round trips below budget', async () => {
    const harness = createHarness();
    const manager = createTerminalAdaptiveWorkingSetManager({
      deviceMemoryGiB: 8,
      now: harness.now,
      scheduler: harness.scheduler,
    });
    const runtimes = Array.from({ length: 10 }, () => createRuntime(12 * MIB));
    runtimes.forEach((runtime, index) => manager.register(String(index), runtime));
    for (let index = 0; index < 100; index += 1) {
      manager.setActiveSession(String(index % runtimes.length));
      harness.advance(5);
    }
    while (harness.runIdle()) await settleTransitions();

    expect(runtimes.every((runtime) => runtime.hibernate.mock.calls.length === 0)).toBe(true);
    expect(runtimes.every((runtime) => runtime.resume.mock.calls.length === 0)).toBe(true);
  });
});
