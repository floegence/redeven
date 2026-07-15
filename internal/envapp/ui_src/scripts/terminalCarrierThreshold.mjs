import { createHash } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';

export function assertTerminalCarrierInteractiveLimit({ stage, interactiveMs, maxInteractiveMs }) {
  const limit = Number(maxInteractiveMs) || 0;
  if (limit <= 0) return;

  const duration = Number(interactiveMs);
  if (Number.isFinite(duration) && duration <= limit) return;

  throw new Error(
    `${stage} interactive recovery exceeded the configured fixed-runner limit `
      + `(interactive_ms=${duration}, max_interactive_ms=${limit})`,
  );
}

export function terminalCarrierPercentile(values, percentile) {
  const sorted = values
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const boundedPercentile = Math.min(100, Math.max(0, Number(percentile) || 0));
  const index = Math.max(0, Math.ceil((boundedPercentile / 100) * sorted.length) - 1);
  return sorted[index];
}

export function assertTerminalCarrierP95Limit({ stage, values, maxP95Ms }) {
  const p95Ms = terminalCarrierPercentile(values, 95);
  const limit = Number(maxP95Ms) || 0;
  if (limit <= 0) return p95Ms;
  if (p95Ms !== null && p95Ms <= limit) return p95Ms;
  throw new Error(
    `${stage} p95 exceeded the configured fixed-runner limit `
      + `(p95_ms=${p95Ms}, max_p95_ms=${limit})`,
  );
}

export function assertTerminalCarrierHistoryVisualMatch(baselineVisual, recoveredVisual) {
  const meanGridDelta = recoveredVisual.grid.reduce((total, value, index) => (
    total + Math.abs(value - baselineVisual.grid[index])
  ), 0) / recoveredVisual.grid.length;
  if (baselineVisual.inkRatio < 0.005) {
    throw new Error('baseline terminal history did not produce meaningful canvas content');
  }
  if (recoveredVisual.inkRatio < 0.005 || meanGridDelta > 0.15) {
    throw new Error(
      'recovered terminal canvas does not match the provided history baseline '
        + `(baseline_ink=${baselineVisual.inkRatio.toFixed(4)} `
        + `recovered_ink=${recoveredVisual.inkRatio.toFixed(4)} `
        + `grid_delta=${meanGridDelta.toFixed(4)})`,
    );
  }
  return { meanGridDelta, recoveredInkRatio: recoveredVisual.inkRatio };
}

function normalizeTerminalLayout(layout) {
  const cols = Number(layout?.cols);
  const rows = Number(layout?.rows);
  return Number.isSafeInteger(cols) && cols > 0 && Number.isSafeInteger(rows) && rows > 0
    ? { cols, rows }
    : null;
}

function activeGridCellRatio(visual) {
  if (!Array.isArray(visual?.grid) || visual.grid.length === 0) return 0;
  const activeCells = visual.grid.filter((value) => Number(value) >= 0.01).length;
  return activeCells / visual.grid.length;
}

export function assertTerminalCarrierHistoryVisualEvidence({
  baselineVisual,
  recoveredVisual,
  baselineLayout,
  recoveredLayout,
}) {
  const normalizedBaselineLayout = normalizeTerminalLayout(baselineLayout);
  const normalizedRecoveredLayout = normalizeTerminalLayout(recoveredLayout);
  const layoutsDiffer = normalizedBaselineLayout !== null
    && normalizedRecoveredLayout !== null
    && (
      normalizedBaselineLayout.cols !== normalizedRecoveredLayout.cols
      || normalizedBaselineLayout.rows !== normalizedRecoveredLayout.rows
    );

  if (!layoutsDiffer) {
    return {
      mode: 'same-layout-grid',
      layouts_match: true,
      ...assertTerminalCarrierHistoryVisualMatch(baselineVisual, recoveredVisual),
    };
  }

  const baselineInkRatio = Number(baselineVisual?.inkRatio);
  const recoveredInkRatio = Number(recoveredVisual?.inkRatio);
  const baselineActiveGridRatio = activeGridCellRatio(baselineVisual);
  const recoveredActiveGridRatio = activeGridCellRatio(recoveredVisual);
  if (
    !Number.isFinite(baselineInkRatio)
    || baselineInkRatio < 0.005
    || !Number.isFinite(recoveredInkRatio)
    || recoveredInkRatio < 0.005
    || baselineActiveGridRatio < 0.05
    || recoveredActiveGridRatio < 0.05
  ) {
    throw new Error(
      'terminal history canvas evidence was blank or too sparse for a cross-layout comparison '
        + `(baseline_ink=${baselineInkRatio} recovered_ink=${recoveredInkRatio} `
        + `baseline_active_grid=${baselineActiveGridRatio.toFixed(4)} `
        + `recovered_active_grid=${recoveredActiveGridRatio.toFixed(4)})`,
    );
  }
  const inkRatioScale = Math.max(baselineInkRatio, recoveredInkRatio)
    / Math.min(baselineInkRatio, recoveredInkRatio);
  if (!Number.isFinite(inkRatioScale) || inkRatioScale > 4) {
    throw new Error(
      'terminal history canvas ink distribution diverged across layouts '
        + `(baseline_ink=${baselineInkRatio.toFixed(4)} `
        + `recovered_ink=${recoveredInkRatio.toFixed(4)} scale=${inkRatioScale.toFixed(4)})`,
    );
  }

  return {
    mode: 'different-layout-coarse',
    layouts_match: false,
    meanGridDelta: null,
    recoveredInkRatio,
    baselineActiveGridRatio,
    recoveredActiveGridRatio,
    inkRatioScale,
  };
}

export const requiredFixedTerminalPerformanceMetrics = Object.freeze([
  'terminal_activity_sidebar_presented',
  'terminal_sidebar_presented',
  'terminal_pending_row_painted',
  'terminal_warm_core_switch',
]);

function normalizeFixedTerminalPerformanceMetric(value, { requireSamples = false } = {}) {
  if (!value || typeof value !== 'object') {
    throw new Error('terminal fixed-performance metric must be an object');
  }
  const metric = String(value.metric ?? '').trim();
  const sampleCount = Number(value.sample_count);
  const p95Ms = Number(value.p95_ms);
  const limitMs = Number(value.limit_ms);
  const samplesMs = Array.isArray(value.samples_ms)
    ? value.samples_ms.map((sample) => Number(sample))
    : null;
  if (!metric) throw new Error('terminal fixed-performance metric name is required');
  if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0) {
    throw new Error(`${metric} fixed-performance sample_count must be a positive safe integer`);
  }
  if (!Number.isFinite(p95Ms) || p95Ms < 0) {
    throw new Error(`${metric} fixed-performance p95_ms must be a non-negative finite number`);
  }
  if (!Number.isFinite(limitMs) || limitMs <= 0) {
    throw new Error(`${metric} fixed-performance limit_ms must be a positive finite number`);
  }
  if (requireSamples && samplesMs === null) {
    throw new Error(`${metric} fixed-performance samples_ms are required`);
  }
  if (samplesMs !== null && (
    samplesMs.length !== sampleCount
    || samplesMs.some((sample) => !Number.isFinite(sample) || sample < 0)
  )) {
    throw new Error(`${metric} fixed-performance samples_ms must match sample_count and be non-negative`);
  }
  if (samplesMs !== null) {
    const calculatedP95Ms = terminalCarrierPercentile(samplesMs, 95);
    if (calculatedP95Ms === null || Math.abs(calculatedP95Ms - p95Ms) > 1e-9) {
      throw new Error(
        `${metric} fixed-performance p95_ms does not match samples_ms `
          + `(reported=${p95Ms}, calculated=${calculatedP95Ms})`,
      );
    }
  }
  if (p95Ms > limitMs) {
    throw new Error(
      `${metric} p95 exceeded the configured fixed-runner limit `
        + `(p95_ms=${p95Ms}, limit_ms=${limitMs})`,
    );
  }
  return {
    metric,
    sample_count: sampleCount,
    p95_ms: p95Ms,
    limit_ms: limitMs,
    ...(samplesMs === null ? {} : { samples_ms: samplesMs }),
    status: 'passed',
  };
}

export function parseFixedTerminalPerformanceMetrics(output) {
  const prefix = '[terminal-fixed-performance]';
  const metrics = [];
  const seen = new Set();
  const withoutAnsi = stripVTControlCharacters(String(output ?? ''));
  for (const line of withoutAnsi.split(/\r?\n/)) {
    const prefixIndex = line.indexOf(prefix);
    if (prefixIndex < 0) continue;
    const payload = line.slice(prefixIndex + prefix.length).trim();
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      throw new Error(`terminal fixed-performance metric is not valid JSON: ${payload}`, { cause: error });
    }
    const metric = normalizeFixedTerminalPerformanceMetric(parsed, { requireSamples: true });
    if (seen.has(metric.metric)) {
      throw new Error(`terminal fixed-performance metric was reported more than once: ${metric.metric}`);
    }
    seen.add(metric.metric);
    metrics.push(metric);
  }
  return metrics;
}

export function terminalCarrierSampleMarkerName(stage, sampleIndex) {
  const normalizedStage = String(stage ?? '').trim().replaceAll(/[^a-zA-Z0-9_-]+/g, '-');
  const normalizedSampleIndex = Number(sampleIndex);
  if (!normalizedStage) throw new Error('terminal carrier marker stage is required');
  if (!Number.isSafeInteger(normalizedSampleIndex) || normalizedSampleIndex <= 0) {
    throw new Error('terminal carrier marker sample index must be a positive safe integer');
  }
  return `${normalizedStage}-${normalizedSampleIndex}`;
}

export function terminalPerformanceSourceStateHash({ trackedDiff = '', untrackedEntries = [] } = {}) {
  const normalizedTrackedDiff = Buffer.isBuffer(trackedDiff)
    ? trackedDiff
    : Buffer.from(String(trackedDiff ?? ''));
  const normalizedUntrackedEntries = untrackedEntries.map((entry) => ({
    path: String(entry?.path ?? '').trim(),
    content: Buffer.isBuffer(entry?.content)
      ? entry.content
      : Buffer.from(String(entry?.content ?? '')),
  })).filter((entry) => entry.path).sort((left, right) => left.path.localeCompare(right.path));
  const dirty = normalizedTrackedDiff.length > 0 || normalizedUntrackedEntries.length > 0;
  if (!dirty) return { dirty: false, sha256: null, untrackedFileCount: 0 };

  const hash = createHash('sha256');
  hash.update('tracked-diff\0');
  hash.update(normalizedTrackedDiff);
  for (const entry of normalizedUntrackedEntries) {
    hash.update('\0untracked\0');
    hash.update(entry.path);
    hash.update('\0');
    hash.update(entry.content);
  }
  return {
    dirty: true,
    sha256: hash.digest('hex'),
    untrackedFileCount: normalizedUntrackedEntries.length,
  };
}

export function buildFixedTerminalPerformanceReport({
  browserMetrics,
  carrierReport,
  sourceRevision,
  runner,
}) {
  const normalizedBrowserMetrics = browserMetrics.map((metric) => (
    normalizeFixedTerminalPerformanceMetric(metric, { requireSamples: true })
  ));
  const browserMetricsByName = new Map(normalizedBrowserMetrics.map((metric) => [metric.metric, metric]));
  for (const metric of requiredFixedTerminalPerformanceMetrics) {
    if (!browserMetricsByName.has(metric)) {
      throw new Error(`terminal fixed-performance browser evidence is missing ${metric}`);
    }
  }
  const browserReportMetrics = normalizedBrowserMetrics.map((metric) => (
    metric.metric === 'terminal_activity_sidebar_presented'
      ? { ...metric, scenario: 'preloaded_activity_entry' }
      : metric
  ));
  if (carrierReport?.status !== 'passed') {
    throw new Error(`terminal carrier evidence status is ${String(carrierReport?.status ?? 'missing')}`);
  }
  const carrierSampleCount = Number(carrierReport.shared_prepared_history_summary?.sample_count);
  const carrierP95Ms = Number(carrierReport.shared_prepared_history_summary?.interactive_p95_ms);
  const carrierSamplesMs = Array.isArray(carrierReport.shared_prepared_history_samples)
    ? carrierReport.shared_prepared_history_samples.map((sample) => Number(sample?.interactive_ms))
    : [];
  const carrierLimitMs = Number(
    carrierReport.threshold?.max_shared_prepared_history_p95_ms
      ?? carrierReport.threshold?.max_interactive_ms,
  );
  const carrierPerSampleLimitMs = Number(carrierReport.threshold?.max_interactive_ms) || 0;
  if (carrierPerSampleLimitMs > 0 && carrierSamplesMs.some((sample) => sample > carrierPerSampleLimitMs)) {
    throw new Error(
      'terminal carrier shared prepared-history sample exceeded its configured limit '
        + `(max_sample_ms=${Math.max(...carrierSamplesMs)}, limit_ms=${carrierPerSampleLimitMs})`,
    );
  }
  const carrierMetric = normalizeFixedTerminalPerformanceMetric({
    metric: 'shared_prepared_history_interactive',
    sample_count: carrierSampleCount,
    p95_ms: carrierP95Ms,
    limit_ms: carrierLimitMs,
    samples_ms: carrierSamplesMs,
  }, { requireSamples: true });
  if (carrierReport.shared_prepared_history_samples?.length !== carrierSampleCount) {
    throw new Error(
      'terminal carrier shared prepared-history sample count does not match its summary '
        + `(samples=${carrierReport.shared_prepared_history_samples?.length ?? 'missing'}, summary=${carrierSampleCount})`,
    );
  }

  return {
    schema_version: 2,
    status: 'passed',
    suite: 'redeven_terminal_fixed_performance',
    source_revision: sourceRevision,
    runner,
    browser: {
      status: 'passed',
      metrics: browserReportMetrics,
    },
    carrier: {
      status: 'passed',
      metric: { ...carrierMetric, scenario: 'shared_prepared_history' },
      evidence: carrierReport,
    },
  };
}
