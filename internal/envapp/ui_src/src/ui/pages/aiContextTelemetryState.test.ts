import { describe, expect, it } from 'vitest';

import {
  applyContextCompactionToRun,
  applyContextUsageToRun,
  ensureContextTelemetryRun,
  getContextTelemetryRun,
  hasContextTelemetryData,
  setContextTelemetryCursor,
  type ContextTelemetryByRun,
} from './aiContextTelemetryState';

describe('aiContextTelemetryState', () => {
  it('creates a stable bucket for a bound run id', () => {
    const next = ensureContextTelemetryRun({}, 'run_1');
    expect(next.run_1).toEqual({
      runId: 'run_1',
      usage: null,
      compactions: [],
      cursor: 0,
    });
  });

  it('keeps same-run usage data when an older event arrives later', () => {
    let state: ContextTelemetryByRun = {};
    state = applyContextUsageToRun(state, 'run_1', {
      estimate_tokens: 400,
      context_limit: 1000,
      usage_percent: 40,
    }, {
      eventId: 12,
      atUnixMs: 1200,
    });
    state = applyContextUsageToRun(state, 'run_1', {
      estimate_tokens: 300,
      context_limit: 1000,
      usage_percent: 30,
    }, {
      eventId: 11,
      atUnixMs: 1300,
    });

    expect(getContextTelemetryRun(state, 'run_1')?.usage?.eventId).toBe(12);
    expect(getContextTelemetryRun(state, 'run_1')?.usage?.estimateTokens).toBe(400);
  });

  it('merges same-run compaction events without clearing existing telemetry', () => {
    let state: ContextTelemetryByRun = {};
    state = applyContextUsageToRun(state, 'run_2', {
      estimate_tokens: 420,
      context_limit: 1000,
      usage_percent: 42,
    }, {
      eventId: 7,
      atUnixMs: 700,
    });
    state = applyContextCompactionToRun(state, 'run_2', 'context.compaction.started', {
      compaction_id: 'cmp_1',
      step_index: 0,
    }, {
      eventId: 8,
      atUnixMs: 710,
    });

    expect(getContextTelemetryRun(state, 'run_2')?.usage?.eventId).toBe(7);
    expect(getContextTelemetryRun(state, 'run_2')?.compactions).toHaveLength(1);
    expect(hasContextTelemetryData(getContextTelemetryRun(state, 'run_2'))).toBe(true);
  });

  it('keeps the same state object when an identical usage payload is replayed', () => {
    const state = applyContextUsageToRun({}, 'run_4', {
      estimate_tokens: 420,
      context_limit: 1000,
      usage_percent: 42,
      section_tokens: {
        prompt: 200,
        history: 220,
      },
    }, {
      eventId: 21,
      atUnixMs: 2100,
    });

    const replayed = applyContextUsageToRun(state, 'run_4', {
      estimate_tokens: 420,
      context_limit: 1000,
      usage_percent: 42,
      section_tokens: {
        prompt: 200,
        history: 220,
      },
    }, {
      eventId: 21,
      atUnixMs: 2100,
    });

    expect(replayed).toBe(state);
  });

  it('keeps the same state object when an identical compaction replay arrives', () => {
    const state = applyContextCompactionToRun({}, 'run_5', 'context.compaction.completed', {
      compaction_id: 'cmp_5',
      step_index: 1,
      strategy: 'summarize_history',
      estimate_tokens_before: 1200,
      estimate_tokens_after: 800,
    }, {
      eventId: 31,
      atUnixMs: 3100,
    });

    const replayed = applyContextCompactionToRun(state, 'run_5', 'context.compaction.completed', {
      compaction_id: 'cmp_5',
      step_index: 1,
      strategy: 'summarize_history',
      estimate_tokens_before: 1200,
      estimate_tokens_after: 800,
    }, {
      eventId: 31,
      atUnixMs: 3100,
    });

    expect(replayed).toBe(state);
  });

  it('advances cursors monotonically per run', () => {
    let state: ContextTelemetryByRun = {};
    state = setContextTelemetryCursor(state, 'run_3', 12);
    state = setContextTelemetryCursor(state, 'run_3', 9);

    expect(getContextTelemetryRun(state, 'run_3')?.cursor).toBe(12);
  });
});
