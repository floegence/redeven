import { describe, expect, it } from 'vitest';

import {
  createUIPresentationEventRecorder,
  subscribeUIPresentationTransactions,
} from './uiPresentationTransactions';

describe('uiPresentationTransactions', () => {
  it('records structured source and target values without inspecting payload content', () => {
    const events: unknown[] = [];
    const unsubscribe = subscribeUIPresentationTransactions((event) => events.push(event));
    const record = createUIPresentationEventRecorder<string, { source: string }>({
      surface: 'flower',
      source: (event) => event.metadata?.source ?? 'unknown',
      target: (threadID) => `thread:${threadID}`,
    });

    record({
      phase: 'requested',
      value: 'thread-1',
      metadata: { source: 'thread-list' },
      transactionId: 7,
      startedAt: 10,
      timestamp: 12,
      elapsedMs: 2,
    });
    unsubscribe();

    expect(events).toEqual([expect.objectContaining({
      surface: 'flower',
      source: 'thread-list',
      target: 'thread:thread-1',
      phase: 'requested',
      startedAt: 10,
      timestamp: 12,
      elapsedMs: 2,
    })]);
  });
});
