import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { findDeepSeekProvider } from './smoke_flower_deepseek.mjs';
import { evaluateComputerBenchmark } from './computer_benchmark_report.mjs';

assert.equal(process.env.REDEVEN_COMPUTER_BENCHMARK, '1', 'explicit online benchmark opt-in required');
const source = process.env.REDEVEN_COMPUTER_CONFIG_ROOT;
const output = process.env.REDEVEN_COMPUTER_EVIDENCE_DIR;
assert(source && output && path.isAbsolute(source) && path.isAbsolute(output), 'absolute configuration and evidence directories required');
const config = JSON.parse(await readFile(path.join(source, 'config.json'), 'utf8'));
const secrets = JSON.parse(await readFile(path.join(source, 'secrets.json'), 'utf8'));
const { provider, apiKey } = findDeepSeekProvider(config, secrets);
await mkdir(output, { recursive: true, mode: 0o700 });
const measurements = path.join(output, 'measurements.json');
const child = spawn('go', ['test', './internal/ai', '-run', '^TestComputerPairedModelBenchmark$', '-count=1', '-v', '-timeout=70m'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit',
  env: { ...process.env, GOWORK: 'off', REDEVEN_COMPUTER_BENCHMARK_PROVIDER: JSON.stringify(provider), REDEVEN_COMPUTER_BENCHMARK_KEY: apiKey, REDEVEN_COMPUTER_BENCHMARK_OUTPUT: measurements },
});
const [code] = await once(child, 'exit');
assert.equal(code, 0, 'benchmark execution failed');
const report = evaluateComputerBenchmark(JSON.parse(await readFile(measurements, 'utf8')));
await writeFile(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (!report.performance_targets_passed) process.exitCode = 1;
