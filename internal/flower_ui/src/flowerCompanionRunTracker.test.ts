import { describe, expect, it } from 'vitest';

import type { FlowerRuntimeCurrentView } from './contracts/flowerSurfaceContracts';
import { FlowerCompanionRunTracker } from './flowerCompanionRunTracker';

function current(overrides: Partial<FlowerRuntimeCurrentView> = {}): FlowerRuntimeCurrentView {
  return {
    thread_id: 'thread-1',
    view_version: 1,
    activity: 'active',
    run_id: 'run-1',
    turn_id: 'turn-1',
    ...overrides,
  };
}

describe('FlowerCompanionRunTracker', () => {
  it('binds one generation to an active run and emits its matching completion', () => {
    const tracker = new FlowerCompanionRunTracker();

    expect(tracker.observe(current())).toMatchObject({ changed: true });
    const generation = tracker.generationFor('thread-1', 'run-1');
    expect(generation).toBeGreaterThan(0);
    expect(tracker.observe(current({ view_version: 2 }))).toEqual({ changed: false });

    const terminal = current({
      view_version: 3,
      activity: 'idle',
      last_outcome: 'completed',
    });
    expect(tracker.observe(terminal)).toEqual({
      changed: true,
      terminalTransition: {
        thread_id: 'thread-1',
        run_id: 'run-1',
        run_generation: generation,
        outcome: 'completed',
      },
    });
    expect(tracker.generationFor('thread-1', 'run-1')).toBeUndefined();
    expect(tracker.observe(terminal)).toEqual({ changed: false });
  });

  it.each([
    ['failed', 'failed'],
    ['cancelled', 'canceled'],
    ['interrupted', 'canceled'],
  ] as const)('maps %s terminal outcome to %s', (lastOutcome, outcome) => {
    const tracker = new FlowerCompanionRunTracker();
    tracker.observe(current());
    const generation = tracker.generationFor('thread-1', 'run-1');

    expect(tracker.observe(current({
      view_version: 2,
      activity: 'idle',
      last_outcome: lastOutcome,
    })).terminalTransition).toEqual({
      thread_id: 'thread-1',
      run_id: 'run-1',
      run_generation: generation,
      outcome,
    });
  });

  it('does not turn initial terminal history or a mismatched run into a receipt', () => {
    const tracker = new FlowerCompanionRunTracker();

    expect(tracker.observe(current({
      activity: 'idle',
      last_outcome: 'completed',
    }))).toEqual({ changed: false });

    tracker.observe(current());
    expect(tracker.observe(current({
      view_version: 2,
      activity: 'idle',
      run_id: 'run-other',
      last_outcome: 'completed',
    }))).toEqual({ changed: false });
    expect(tracker.generationFor('thread-1', 'run-1')).toBeGreaterThan(0);
  });

  it('keeps parallel runs independent and assigns a fresh generation to retries', () => {
    const tracker = new FlowerCompanionRunTracker();
    tracker.observe(current());
    tracker.observe(current({ thread_id: 'thread-2', run_id: 'run-2', turn_id: 'turn-2' }));
    const firstGeneration = tracker.generationFor('thread-1', 'run-1');
    const secondGeneration = tracker.generationFor('thread-2', 'run-2');
    expect(secondGeneration).toBeGreaterThan(firstGeneration ?? 0);

    tracker.observe(current({ view_version: 2, activity: 'idle', last_outcome: 'failed' }));
    tracker.observe(current({ view_version: 3, run_id: 'run-1-retry', turn_id: 'turn-1-retry' }));
    expect(tracker.generationFor('thread-1', 'run-1-retry')).toBeGreaterThan(secondGeneration ?? 0);
    expect(tracker.generationFor('thread-2', 'run-2')).toBe(secondGeneration);
  });
});
