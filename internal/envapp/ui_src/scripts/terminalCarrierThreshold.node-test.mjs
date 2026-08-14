import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertFixedTerminalPerformanceBrowserMode,
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
    stage: 'semantic_multi_view',
    interactiveMs: 500,
    maxInteractiveMs: 0,
  }));
  assert.doesNotThrow(() => assertTerminalCarrierInteractiveLimit({
    stage: 'semantic_multi_view',
    interactiveMs: 150,
    maxInteractiveMs: 150,
  }));
});

test('rejects an over-budget semantic multi-view sample with diagnostics', () => {
  assert.throws(
    () => assertTerminalCarrierInteractiveLimit({
      stage: 'semantic_multi_view',
      interactiveMs: 150.1,
      maxInteractiveMs: 150,
    }),
    /semantic_multi_view.*interactive_ms=150\.1.*max_interactive_ms=150/,
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
    stage: 'semantic_multi_view',
    values: [...nineteenFastSamples, 1106.9],
    maxP95Ms: 150,
  }), 38);
  assert.throws(
    () => assertTerminalCarrierP95Limit({
      stage: 'semantic_multi_view',
      values: [...nineteenFastSamples.slice(0, 18), 160, 1106.9],
      maxP95Ms: 150,
    }),
    /semantic_multi_view.*p95_ms=160.*max_p95_ms=150/,
  );
});

test('creates a unique semantic multi-view input marker for every sample', () => {
  assert.equal(
    terminalCarrierSampleMarkerName('semantic-multi-view-input', 1),
    'semantic-multi-view-input-1',
  );
  assert.equal(
    terminalCarrierSampleMarkerName('semantic-multi-view-input', 20),
    'semantic-multi-view-input-20',
  );
  assert.throws(
    () => terminalCarrierSampleMarkerName('semantic-multi-view-input', 0),
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
    '[terminal-fixed-performance] {"metric":"terminal_semantic_presentation_paint","samples_ms":[20,24.1],"sample_count":2,"p95_ms":24.1,"limit_ms":100}',
    '[terminal-fixed-performance] {"metric":"terminal_semantic_input_dispatch","samples_ms":[17,18.2],"sample_count":2,"p95_ms":18.2,"limit_ms":32}',
    '[terminal-fixed-performance] {"metric":"terminal_semantic_resize_settle","samples_ms":[18,18.8],"sample_count":2,"p95_ms":18.8,"limit_ms":150}',
  ].join('\n'));
  const carrierReport = {
    status: 'passed',
    runner: { browser_mode: 'headless' },
    threshold: { max_multi_view_p95_ms: 150 },
    multi_view_summary: { sample_count: 2, interactive_p95_ms: 59.9 },
    multi_view_samples: [
      { sample_index: 1, interactive_ms: 41.2 },
      { sample_index: 2, interactive_ms: 59.9 },
    ],
  };
  const sourceRevision = { commit: '0123456789abcdef', dirty: true, working_tree_diff_sha256: 'abc' };
  const runner = { id: 'test-runner', chromium: '140.0', browser_mode: 'headless' };

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
  assert.equal(report.browser.metrics.length, 3);
  assert.deepEqual(report.carrier.metric, {
    metric: 'semantic_multi_view_interactive',
    sample_count: 2,
    p95_ms: 59.9,
    limit_ms: 150,
    samples_ms: [41.2, 59.9],
    status: 'passed',
    scenario: 'semantic_multi_view',
  });
  assert.equal(report.carrier.evidence, carrierReport);
});

test('accepts one semantic multi-view scheduling outlier when the complete p95 stays in budget', () => {
  const samplesMs = [
    114.8, 120.9, 136.6, 138.1, 139.2, 140.1, 141.3, 142.5, 143.2, 144.1,
    145.2, 146.3, 147.1, 147.8, 148.2, 148.6, 148.9, 149.1, 149.2, 151.5,
  ];
  const browserMetrics = [
    { metric: 'terminal_semantic_presentation_paint', samples_ms: [8], sample_count: 1, p95_ms: 8, limit_ms: 100 },
    { metric: 'terminal_semantic_input_dispatch', samples_ms: [8], sample_count: 1, p95_ms: 8, limit_ms: 32 },
    { metric: 'terminal_semantic_resize_settle', samples_ms: [8], sample_count: 1, p95_ms: 8, limit_ms: 150 },
  ];
  const carrierReport = {
    status: 'passed',
    runner: { browser_mode: 'headless' },
    threshold: { max_multi_view_p95_ms: 150 },
    multi_view_summary: { sample_count: 20, interactive_p95_ms: 149.2 },
    multi_view_samples: samplesMs.map((interactive_ms, index) => ({
      sample_index: index + 1,
      interactive_ms,
    })),
  };

  assert.doesNotThrow(() => buildFixedTerminalPerformanceReport({
    browserMetrics,
    carrierReport,
    sourceRevision: {},
    runner: { browser_mode: 'headless' },
  }));
});

test('rejects incomplete or internally inconsistent fixed-performance evidence', () => {
  const incompleteBrowserMetrics = parseFixedTerminalPerformanceMetrics([
    '[terminal-fixed-performance] {"metric":"terminal_semantic_presentation_paint","samples_ms":[20,24.1],"sample_count":2,"p95_ms":24.1,"limit_ms":100}',
    '[terminal-fixed-performance] {"metric":"terminal_semantic_input_dispatch","samples_ms":[17,18.2],"sample_count":2,"p95_ms":18.2,"limit_ms":32}',
  ].join('\n'));
  const carrierReport = {
    status: 'passed',
    runner: { browser_mode: 'headless' },
    threshold: { max_multi_view_p95_ms: 150 },
    multi_view_summary: { sample_count: 2, interactive_p95_ms: 59.9 },
    multi_view_samples: [{ sample_index: 1 }],
  };

  assert.throws(
    () => buildFixedTerminalPerformanceReport({
      browserMetrics: incompleteBrowserMetrics,
      carrierReport,
      sourceRevision: {},
      runner: { browser_mode: 'headless' },
    }),
    /missing terminal_semantic_resize_settle/,
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
        { metric: 'terminal_semantic_presentation_paint', samples_ms: [20, 24.1], sample_count: 2, p95_ms: 24.1, limit_ms: 100 },
        { metric: 'terminal_semantic_input_dispatch', samples_ms: [17, 18.2], sample_count: 2, p95_ms: 18.2, limit_ms: 32 },
        { metric: 'terminal_semantic_resize_settle', samples_ms: [18, 18.8], sample_count: 2, p95_ms: 18.8, limit_ms: 150 },
      ],
      carrierReport,
      sourceRevision: {},
      runner: { browser_mode: 'headless' },
    }),
    /samples_ms must match sample_count|sample count does not match/,
  );
});

test('binds fixed-performance runner identity to the carrier browser mode', () => {
  assert.equal(assertFixedTerminalPerformanceBrowserMode({
    runner: { browser_mode: 'headless' },
    carrierReport: { runner: { browser_mode: 'headless' } },
  }), 'headless');
  assert.throws(
    () => assertFixedTerminalPerformanceBrowserMode({
      runner: { browser_mode: 'headless' },
      carrierReport: { runner: {} },
    }),
    /carrier evidence runner browser_mode is required/,
  );
  assert.throws(
    () => assertFixedTerminalPerformanceBrowserMode({
      runner: { browser_mode: 'headless' },
      carrierReport: { runner: { browser_mode: 'headed' } },
    }),
    /browser mode does not match carrier evidence/,
  );
});
