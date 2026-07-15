import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertTerminalCarrierHistoryVisualEvidence,
  assertTerminalCarrierHistoryVisualMatch,
  assertTerminalCarrierInteractiveLimit,
  assertTerminalCarrierP95Limit,
  buildFixedTerminalPerformanceReport,
  parseFixedTerminalPerformanceMetrics,
  terminalCarrierSampleMarkerName,
  terminalPerformanceSourceStateHash,
  terminalCarrierPercentile,
} from './terminalCarrierThreshold.mjs';

test('allows disabled and in-budget terminal carrier samples', () => {
  assert.doesNotThrow(() => assertTerminalCarrierInteractiveLimit({
    stage: 'shared_prepared_history',
    interactiveMs: 500,
    maxInteractiveMs: 0,
  }));
  assert.doesNotThrow(() => assertTerminalCarrierInteractiveLimit({
    stage: 'shared_prepared_history',
    interactiveMs: 150,
    maxInteractiveMs: 150,
  }));
});

test('rejects an over-budget shared prepared-history sample with diagnostics', () => {
  assert.throws(
    () => assertTerminalCarrierInteractiveLimit({
      stage: 'shared_prepared_history',
      interactiveMs: 150.1,
      maxInteractiveMs: 150,
    }),
    /shared_prepared_history.*interactive_ms=150\.1.*max_interactive_ms=150/,
  );
});

test('calculates a nearest-rank terminal carrier percentile', () => {
  assert.equal(terminalCarrierPercentile([], 95), null);
  assert.equal(terminalCarrierPercentile([4, 1, 3, 2], 50), 2);
  assert.equal(terminalCarrierPercentile(Array.from({ length: 20 }, (_, index) => index + 1), 95), 19);
});

test('calculates the carrier p95 independently from the separate per-sample gate', () => {
  const nineteenFastSamples = Array.from({ length: 19 }, (_, index) => index + 20);
  assert.equal(assertTerminalCarrierP95Limit({
    stage: 'shared_prepared_history',
    values: [...nineteenFastSamples, 1106.9],
    maxP95Ms: 150,
  }), 38);
  assert.throws(
    () => assertTerminalCarrierP95Limit({
      stage: 'shared_prepared_history',
      values: [...nineteenFastSamples.slice(0, 18), 160, 1106.9],
      maxP95Ms: 150,
    }),
    /shared_prepared_history.*p95_ms=160.*max_p95_ms=150/,
  );
});

test('compares shared prepared-history canvas evidence against the same-sample panel baseline', () => {
  const match = assertTerminalCarrierHistoryVisualMatch(
    { inkRatio: 0.3, grid: [0.1, 0.2, 0.3] },
    { inkRatio: 0.29, grid: [0.1, 0.22, 0.28] },
  );
  assert.ok(Math.abs(match.meanGridDelta - (0.04 / 3)) < Number.EPSILON);
  assert.equal(match.recoveredInkRatio, 0.29);
  assert.throws(
    () => assertTerminalCarrierHistoryVisualMatch(
      { inkRatio: 0.3, grid: [0.1, 0.2] },
      { inkRatio: 0.25, grid: [0.5, 0.6] },
    ),
    /provided history baseline.*grid_delta=0\.4000/,
  );
});

test('uses strict grid evidence only when the terminal layouts match', () => {
  const match = assertTerminalCarrierHistoryVisualEvidence({
    baselineVisual: { inkRatio: 0.3, grid: [0.1, 0.2, 0.3] },
    recoveredVisual: { inkRatio: 0.29, grid: [0.1, 0.22, 0.28] },
    baselineLayout: { cols: 120, rows: 40 },
    recoveredLayout: { cols: 120, rows: 40 },
  });

  assert.equal(match.mode, 'same-layout-grid');
  assert.equal(match.layouts_match, true);
  assert.ok(Math.abs(match.meanGridDelta - (0.04 / 3)) < Number.EPSILON);
  assert.throws(
    () => assertTerminalCarrierHistoryVisualEvidence({
      baselineVisual: { inkRatio: 0.3, grid: [0.1, 0.2] },
      recoveredVisual: { inkRatio: 0.25, grid: [0.5, 0.6] },
      baselineLayout: { cols: 120, rows: 40 },
      recoveredLayout: { cols: 120, rows: 40 },
    }),
    /provided history baseline.*grid_delta=0\.4000/,
  );
});

test('uses nonblank coarse evidence when terminal geometry changes across surfaces', () => {
  const evidence = assertTerminalCarrierHistoryVisualEvidence({
    baselineVisual: { inkRatio: 0.1415, grid: [0.02, 0.15, 0.4, 0.01] },
    recoveredVisual: { inkRatio: 0.2543, grid: [0.4, 0.02, 0.1, 0.3] },
    baselineLayout: { cols: 160, rows: 44 },
    recoveredLayout: { cols: 96, rows: 28 },
  });

  assert.equal(evidence.mode, 'different-layout-coarse');
  assert.equal(evidence.layouts_match, false);
  assert.equal(evidence.meanGridDelta, null);
  assert.ok(evidence.inkRatioScale < 2);
  assert.throws(
    () => assertTerminalCarrierHistoryVisualEvidence({
      baselineVisual: { inkRatio: 0.1415, grid: [0.02, 0.15, 0.4, 0.01] },
      recoveredVisual: { inkRatio: 0.001, grid: [0, 0, 0, 0] },
      baselineLayout: { cols: 160, rows: 44 },
      recoveredLayout: { cols: 96, rows: 28 },
    }),
    /blank or too sparse/,
  );
});

test('creates a unique shared prepared-history input marker for every sample', () => {
  assert.equal(
    terminalCarrierSampleMarkerName('input-shared-prepared-history', 1),
    'input-shared-prepared-history-1',
  );
  assert.equal(
    terminalCarrierSampleMarkerName('input-shared-prepared-history', 20),
    'input-shared-prepared-history-20',
  );
  assert.throws(
    () => terminalCarrierSampleMarkerName('input-shared-prepared-history', 0),
    /positive safe integer/,
  );
});

test('binds dirty source revisions to tracked and untracked content deterministically', () => {
  assert.deepEqual(terminalPerformanceSourceStateHash(), {
    dirty: false,
    sha256: null,
    untrackedFileCount: 0,
  });

  const first = terminalPerformanceSourceStateHash({
    trackedDiff: 'tracked change',
    untrackedEntries: [
      { path: 'z.test.ts', content: 'second' },
      { path: 'a.test.ts', content: 'first' },
    ],
  });
  const reordered = terminalPerformanceSourceStateHash({
    trackedDiff: 'tracked change',
    untrackedEntries: [
      { path: 'a.test.ts', content: 'first' },
      { path: 'z.test.ts', content: 'second' },
    ],
  });
  const changed = terminalPerformanceSourceStateHash({
    trackedDiff: 'tracked change',
    untrackedEntries: [
      { path: 'a.test.ts', content: 'changed' },
      { path: 'z.test.ts', content: 'second' },
    ],
  });

  assert.equal(first.dirty, true);
  assert.equal(first.untrackedFileCount, 2);
  assert.equal(first.sha256, reordered.sha256);
  assert.notEqual(first.sha256, changed.sha256);
});

test('parses structured browser p95 evidence while ignoring ordinary Vitest output', () => {
  const metrics = parseFixedTerminalPerformanceMetrics([
    'RUN v4.1.8',
    '[terminal-fixed-performance] {"metric":"terminal_activity_sidebar_presented","samples_ms":[20,24.1],"sample_count":2,"p95_ms":24.1,"limit_ms":100}',
    '\u001B[32m[terminal-fixed-performance] {"metric":"terminal_sidebar_presented","samples_ms":[20,21.4],"sample_count":2,"p95_ms":21.4,"limit_ms":100}\u001B[39m',
    '[terminal-fixed-performance] {"metric":"terminal_pending_row_painted","samples_ms":[17,18.2],"sample_count":2,"p95_ms":18.2,"limit_ms":32}',
    '[terminal-fixed-performance] {"metric":"terminal_warm_core_switch","samples_ms":[18,18.8],"sample_count":2,"p95_ms":18.8,"limit_ms":50}',
  ].join('\n'));

  assert.deepEqual(metrics, [
    {
      metric: 'terminal_activity_sidebar_presented',
      sample_count: 2,
      p95_ms: 24.1,
      limit_ms: 100,
      samples_ms: [20, 24.1],
      status: 'passed',
    },
    {
      metric: 'terminal_sidebar_presented',
      sample_count: 2,
      p95_ms: 21.4,
      limit_ms: 100,
      samples_ms: [20, 21.4],
      status: 'passed',
    },
    {
      metric: 'terminal_pending_row_painted',
      sample_count: 2,
      p95_ms: 18.2,
      limit_ms: 32,
      samples_ms: [17, 18.2],
      status: 'passed',
    },
    {
      metric: 'terminal_warm_core_switch',
      sample_count: 2,
      p95_ms: 18.8,
      limit_ms: 50,
      samples_ms: [18, 18.8],
      status: 'passed',
    },
  ]);
});

test('builds one fixed-performance report with browser, carrier, revision, and runner evidence', () => {
  const browserMetrics = parseFixedTerminalPerformanceMetrics([
    '[terminal-fixed-performance] {"metric":"terminal_activity_sidebar_presented","samples_ms":[20,24.1],"sample_count":2,"p95_ms":24.1,"limit_ms":100}',
    '[terminal-fixed-performance] {"metric":"terminal_sidebar_presented","samples_ms":[20,21.4],"sample_count":2,"p95_ms":21.4,"limit_ms":100}',
    '[terminal-fixed-performance] {"metric":"terminal_pending_row_painted","samples_ms":[17,18.2],"sample_count":2,"p95_ms":18.2,"limit_ms":32}',
    '[terminal-fixed-performance] {"metric":"terminal_warm_core_switch","samples_ms":[18,18.8],"sample_count":2,"p95_ms":18.8,"limit_ms":50}',
  ].join('\n'));
  const carrierReport = {
    status: 'passed',
    threshold: { max_interactive_ms: 150 },
    shared_prepared_history_summary: { sample_count: 2, interactive_p95_ms: 59.9 },
    shared_prepared_history_samples: [
      { sample_index: 1, interactive_ms: 41.2 },
      { sample_index: 2, interactive_ms: 59.9 },
    ],
  };
  const sourceRevision = { commit: '0123456789abcdef', dirty: true, working_tree_diff_sha256: 'abc' };
  const runner = { id: 'test-runner', chromium: '140.0' };

  const report = buildFixedTerminalPerformanceReport({
    browserMetrics,
    carrierReport,
    sourceRevision,
    runner,
  });

  assert.equal(report.schema_version, 2);
  assert.equal(report.status, 'passed');
  assert.equal(report.source_revision, sourceRevision);
  assert.equal(report.runner, runner);
  assert.equal(report.browser.metrics.length, 4);
  assert.equal(report.browser.metrics[0].scenario, 'preloaded_activity_entry');
  assert.deepEqual(report.carrier.metric, {
    metric: 'shared_prepared_history_interactive',
    sample_count: 2,
    p95_ms: 59.9,
    limit_ms: 150,
    samples_ms: [41.2, 59.9],
    status: 'passed',
    scenario: 'shared_prepared_history',
  });
  assert.equal(report.carrier.evidence, carrierReport);
});

test('rejects incomplete or internally inconsistent fixed-performance evidence', () => {
  const incompleteBrowserMetrics = parseFixedTerminalPerformanceMetrics([
    '[terminal-fixed-performance] {"metric":"terminal_activity_sidebar_presented","samples_ms":[20,24.1],"sample_count":2,"p95_ms":24.1,"limit_ms":100}',
    '[terminal-fixed-performance] {"metric":"terminal_sidebar_presented","samples_ms":[20,21.4],"sample_count":2,"p95_ms":21.4,"limit_ms":100}',
    '[terminal-fixed-performance] {"metric":"terminal_pending_row_painted","samples_ms":[17,18.2],"sample_count":2,"p95_ms":18.2,"limit_ms":32}',
  ].join('\n'));
  const carrierReport = {
    status: 'passed',
    threshold: { max_interactive_ms: 150 },
    shared_prepared_history_summary: { sample_count: 2, interactive_p95_ms: 59.9 },
    shared_prepared_history_samples: [{ sample_index: 1 }],
  };

  assert.throws(
    () => buildFixedTerminalPerformanceReport({
      browserMetrics: incompleteBrowserMetrics,
      carrierReport,
      sourceRevision: {},
      runner: {},
    }),
    /missing terminal_warm_core_switch/,
  );
  assert.throws(
    () => parseFixedTerminalPerformanceMetrics([
      '[terminal-fixed-performance] {"metric":"terminal_sidebar_presented","samples_ms":[20,21.4],"sample_count":2,"p95_ms":21.4,"limit_ms":100}',
      '[terminal-fixed-performance] {"metric":"terminal_sidebar_presented","samples_ms":[19,20],"sample_count":2,"p95_ms":20,"limit_ms":100}',
    ].join('\n')),
    /reported more than once/,
  );
  assert.throws(
    () => parseFixedTerminalPerformanceMetrics(
      '[terminal-fixed-performance] {"metric":"terminal_sidebar_presented","samples_ms":[200,210],"sample_count":2,"p95_ms":20,"limit_ms":100}',
    ),
    /p95_ms does not match samples_ms/,
  );
  assert.throws(
    () => buildFixedTerminalPerformanceReport({
      browserMetrics: [
        { metric: 'terminal_activity_sidebar_presented', samples_ms: [20, 24.1], sample_count: 2, p95_ms: 24.1, limit_ms: 100 },
        { metric: 'terminal_sidebar_presented', samples_ms: [20, 21.4], sample_count: 2, p95_ms: 21.4, limit_ms: 100 },
        { metric: 'terminal_pending_row_painted', samples_ms: [17, 18.2], sample_count: 2, p95_ms: 18.2, limit_ms: 32 },
        { metric: 'terminal_warm_core_switch', samples_ms: [18, 18.8], sample_count: 2, p95_ms: 18.8, limit_ms: 50 },
      ],
      carrierReport,
      sourceRevision: {},
      runner: {},
    }),
    /samples_ms must match sample_count|sample count does not match/,
  );
});
