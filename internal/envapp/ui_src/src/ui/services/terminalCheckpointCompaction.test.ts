import { describe, expect, it, vi } from 'vitest';

import { createTerminalCheckpointCompactor } from './terminalCheckpointCompaction';

const encoder = new TextEncoder();

describe('terminal checkpoint compaction', () => {
  it('captures and commits only after the same-engine actor applies contiguous output', async () => {
    const order: string[] = [];
    const checkpoint = {
      formatVersion: 1 as const,
      engineId: 'floegence-ghostty-web' as const,
      coveredThroughSequence: 2,
      geometryGeneration: 1,
      parserEpoch: 3,
      cols: 80,
      rows: 24,
      checksumSha256: 'a'.repeat(64),
      stateDigestSha256: 'b'.repeat(64),
      bytes: encoder.encode('checkpoint'),
    };
    const actor = {
      start: vi.fn(async () => { order.push('start'); }),
      append: vi.fn(() => { order.push('append'); }),
      capture: vi.fn(async () => { order.push('capture'); return checkpoint; }),
      dispose: vi.fn(),
    };
    const commit = vi.fn(async () => { order.push('commit'); });
    const compactor = createTerminalCheckpointCompactor({
      captureEveryBytes: 2,
      createActor: () => actor,
      commit,
    });

    compactor.configure({
      sessionId: 'session-1',
      historyGeneration: 3,
      cols: 80,
      rows: 24,
      initialSequence: 0,
    });
    compactor.append([{
      sequence: 1,
      data: encoder.encode('a'),
      geometryGeneration: 1,
      cols: 80,
      rows: 24,
    }, {
      sequence: 2,
      data: encoder.encode('b'),
      geometryGeneration: 1,
      cols: 80,
      rows: 24,
    }]);
    await compactor.settle();

    expect(actor.start).toHaveBeenCalledWith({ cols: 80, rows: 24, parserEpoch: 3, initialSequence: 0 });
    expect(actor.append).toHaveBeenCalledTimes(1);
    expect(actor.capture).toHaveBeenCalledWith(2);
    expect(commit).toHaveBeenCalledWith('session-1', checkpoint);
    expect(order).toEqual(['start', 'append', 'capture', 'commit']);
  });

  it('fails compaction closed without throwing into the live output path', async () => {
    const failure = new Error('checkpoint worker failed');
    const actor = {
      start: vi.fn().mockResolvedValue(undefined),
      append: vi.fn(() => { throw failure; }),
      capture: vi.fn(),
      dispose: vi.fn(),
    };
    const onFailure = vi.fn();
    const compactor = createTerminalCheckpointCompactor({
      captureEveryBytes: 1,
      createActor: () => actor,
      commit: vi.fn(),
      onFailure,
    });
    compactor.configure({
      sessionId: 'session-1', historyGeneration: 1, cols: 80, rows: 24, initialSequence: 0,
    });

    expect(() => compactor.append([{
      sequence: 1,
      data: encoder.encode('live'),
      geometryGeneration: 1,
      cols: 80,
      rows: 24,
    }])).not.toThrow();
    await compactor.settle();

    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(actor.dispose).toHaveBeenCalledTimes(1);
    expect(compactor.getState()).toBe('failed');
  });
});
