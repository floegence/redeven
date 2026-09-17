const tasks = ['form', 'dynamic', 'frame'];
const median = values => { const sorted = values.toSorted((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
export function evaluateComputerBenchmark(report) {
  if (report.scope !== 'production-service-managed-browser' || !report.model || !Number.isInteger(report.repetitions) || report.repetitions < 1 || !Array.isArray(report.measurements)) throw new Error('Invalid benchmark identity');
  const samples = new Map();
  for (const row of report.measurements) {
    if (!tasks.includes(row.task) || !['visual', 'semantic'].includes(row.variant) || !Number.isInteger(row.repetition) || row.repetition < 0 || row.repetition >= report.repetitions || typeof row.success !== 'boolean') throw new Error('Invalid benchmark pair');
    const key = `${row.task}/${row.repetition}/${row.variant}`;
    if (samples.has(key)) throw new Error('Duplicate benchmark sample');
    for (const field of ['model_round_trips', 'model_image_bytes', 'observation_text_bytes', 'provider_input_tokens', 'tool_ms', 'action_wait_ms', 'host_operations', 'reported_foreground_operations', 'total_ms']) {
      if (!Number.isFinite(row[field]) || row[field] < 0) throw new Error(`Missing benchmark metric: ${field}`);
    }
    samples.set(key, row);
  }
  if (samples.size !== tasks.length * report.repetitions * 2) throw new Error('Incomplete benchmark pairs');
  const visual = report.measurements.filter(row => row.variant === 'visual');
  const semantic = report.measurements.filter(row => row.variant === 'semantic');
  const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);
  const reduction = (baseline, optimized) => baseline > 0 ? 1 - optimized / baseline : null;
  const metrics = {
    model_round_trip_reduction: reduction(sum(visual, 'model_round_trips'), sum(semantic, 'model_round_trips')),
    model_image_byte_reduction: reduction(sum(visual, 'model_image_bytes'), sum(semantic, 'model_image_bytes')),
    median_duration_reduction: reduction(median(visual.map(row => row.total_ms)), median(semantic.map(row => row.total_ms))),
    visual_success_rate: visual.filter(row => row.success).length / visual.length,
    semantic_success_rate: semantic.filter(row => row.success).length / semantic.length,
    reported_foreground_operations: sum(report.measurements, 'reported_foreground_operations'),
  };
  const complete = report.repetitions >= 3 && report.measurements.every(row => row.success && row.model_round_trips > 0 && row.provider_input_tokens > 0);
  return { scope: report.scope, model: report.model, complete, metrics,
    performance_targets_passed: complete && metrics.model_round_trip_reduction >= .4 && metrics.model_image_byte_reduction >= .7 && metrics.median_duration_reduction >= .3 && metrics.reported_foreground_operations === 0,
    limitations: ['Headless managed-browser performance only; desktop and extension interaction require separate acceptance.', 'Observation text bytes are measured; provider input tokens cover the full request, not separately attributed observation tokens.', 'Reported foreground operations do not replace real platform focus and pointer qualification.'],
  };
}
