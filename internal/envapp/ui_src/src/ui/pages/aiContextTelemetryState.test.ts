import { describe, expect, it } from 'vitest';

import {
  applyContextCompactionToRun,
  applyContextUsageToRun,
  ensureContextTelemetryRun,
  getContextTelemetryRun,
  hasContextTelemetryData,
  selectVisibleContextRunId,
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
    state = applyContextCompactionToRun(state, 'run_2', 'context.compaction.updated', {
      operation_id: 'cmp_1',
      step_index: 0,
      phase: 'start',
      status: 'compacting',
    }, {
      eventId: 8,
      atUnixMs: 710,
    });

    expect(getContextTelemetryRun(state, 'run_2')?.usage?.eventId).toBe(7);
    expect(getContextTelemetryRun(state, 'run_2')?.compactions).toHaveLength(1);
    expect(hasContextTelemetryData(getContextTelemetryRun(state, 'run_2'))).toBe(true);
  });

  it('normalizes structured context usage payloads from Flower live events', () => {
    const state = applyContextUsageToRun({}, 'run_structured', {
      usage: {
        phase: 'projected_request',
        input_tokens: 620,
        context_window_tokens: 1000,
        used_ratio: 0.62,
        source: 'full_request_estimate',
        pressure_status: 'stable',
      },
    }, {
      eventId: 17,
      atUnixMs: 1700,
    });

    const usage = getContextTelemetryRun(state, 'run_structured')?.usage;
    expect(usage?.estimateTokens).toBe(620);
    expect(usage?.contextLimit).toBe(1000);
    expect(usage?.usagePercent).toBe(62);
    expect(usage?.estimateSource).toBe('full_request_estimate');
  });

  it('normalizes structured context compaction updates from Flower live events', () => {
    const state = applyContextCompactionToRun({}, 'run_structured', 'context.compaction.updated', {
      compaction: {
        operation_id: 'op_1',
        phase: 'complete',
        status: 'compacted',
        trigger: 'pre_request',
        reason: 'threshold',
        tokens_before: 920,
        tokens_after_estimate: 210,
      },
    }, {
      eventId: 18,
      atUnixMs: 1800,
    });

    const compaction = getContextTelemetryRun(state, 'run_structured')?.compactions[0];
    expect(compaction?.compactionId).toBe('op_1');
    expect(compaction?.eventType).toBe('context.compaction.updated');
    expect(compaction?.stage).toBe('applied');
    expect(compaction?.strategy).toBe('pre_request');
    expect(compaction?.estimateTokensBefore).toBe(920);
    expect(compaction?.estimateTokensAfter).toBe(210);
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
    const state = applyContextCompactionToRun({}, 'run_5', 'context.compaction.updated', {
      operation_id: 'cmp_5',
      step_index: 1,
      phase: 'complete',
      status: 'compacted',
      strategy: 'summarize_history',
      estimate_tokens_before: 1200,
      estimate_tokens_after: 800,
    }, {
      eventId: 31,
      atUnixMs: 3100,
    });

    const replayed = applyContextCompactionToRun(state, 'run_5', 'context.compaction.updated', {
      operation_id: 'cmp_5',
      step_index: 1,
      phase: 'complete',
      status: 'compacted',
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

  it('keeps showing the stable run until the new live run has telemetry', () => {
    let state: ContextTelemetryByRun = {};
    state = applyContextUsageToRun(state, 'run_old', {
      estimate_tokens: 420,
      context_limit: 1000,
      usage_percent: 42,
    }, {
      eventId: 41,
      atUnixMs: 4100,
    });

    expect(selectVisibleContextRunId(state, 'run_new', 'run_old')).toBe('run_old');

    state = applyContextUsageToRun(state, 'run_new', {
      estimate_tokens: 610,
      context_limit: 1000,
      usage_percent: 61,
    }, {
      eventId: 42,
      atUnixMs: 4200,
    });

    expect(selectVisibleContextRunId(state, 'run_new', 'run_old')).toBe('run_new');
  });
});
