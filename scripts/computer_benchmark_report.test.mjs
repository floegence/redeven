import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateComputerBenchmark } from './computer_benchmark_report.mjs';
const fixture = () => ({ scope: 'production-service-managed-browser', model: 'fixture', repetitions: 3,
  measurements: ['form', 'dynamic', 'frame'].flatMap(task => [0, 1, 2].flatMap(repetition => ['visual', 'semantic'].map(variant => ({ task, repetition, variant, success: true,
    model_round_trips: variant === 'visual' ? 10 : 3, model_image_bytes: variant === 'visual' ? 10000 : 1000, total_ms: variant === 'visual' ? 10000 : 4000,
    provider_input_tokens: 1000, observation_text_bytes: 1000, tool_ms: 100, action_wait_ms: 10, host_operations: 10, reported_foreground_operations: 0,
  })))),
});
test('paired thresholds require complete successful samples and measured provider usage', () => {
  const report = fixture(); assert.equal(evaluateComputerBenchmark(report).performance_targets_passed, true);
  report.measurements[0].success = false; assert.equal(evaluateComputerBenchmark(report).performance_targets_passed, false);
  report.measurements[0].success = true; report.measurements[0].provider_input_tokens = 0;
  assert.equal(evaluateComputerBenchmark(report).complete, false);
});
test('missing, duplicate and invalid pairs cannot produce performance claims', () => {
  const missing = fixture(); missing.measurements.pop(); assert.throws(() => evaluateComputerBenchmark(missing), /Incomplete/u);
  const duplicate = fixture(); duplicate.measurements.push(duplicate.measurements[0]); assert.throws(() => evaluateComputerBenchmark(duplicate), /Duplicate/u);
  const zero = fixture(); for (const row of zero.measurements) row.model_image_bytes = 0;
  assert.equal(evaluateComputerBenchmark(zero).performance_targets_passed, false);
});
