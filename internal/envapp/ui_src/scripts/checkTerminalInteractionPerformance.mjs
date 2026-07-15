#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFixedTerminalPerformanceReport,
  parseFixedTerminalPerformanceMetrics,
  terminalPerformanceSourceStateHash,
} from './terminalCarrierThreshold.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(uiRoot, '../../..');
const args = process.argv.slice(2).filter((value) => value !== '--');
const reportPath = args[0] || '/tmp/redeven-terminal-fixed-performance.json';
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'redeven-terminal-fixed-performance-'));
const carrierReportPath = path.join(tempDir, 'terminal-carrier.json');

function run(stage, commandArgs, env = process.env) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: uiRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const errorOutput = String(result.stderr ?? '').trim();
    throw new Error(
      `${stage} failed with exit code ${result.status ?? 'unknown'}`
        + (errorOutput ? `\n${errorOutput}` : ''),
    );
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return result.stdout;
}

function runGitBytes(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return result.stdout;
}

function readUntrackedSourceEntries() {
  return runGitBytes(['ls-files', '--others', '--exclude-standard', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((relativePath) => {
      const absolutePath = path.resolve(repoRoot, relativePath);
      const stat = lstatSync(absolutePath);
      return {
        path: relativePath,
        content: stat.isSymbolicLink()
          ? `symlink:${readlinkSync(absolutePath)}`
          : readFileSync(absolutePath),
      };
    });
}

function readSourceRevision() {
  const commit = runGit(['rev-parse', 'HEAD']).trim();
  const workingTreeDiff = runGit(['diff', '--binary', 'HEAD', '--']);
  const sourceState = terminalPerformanceSourceStateHash({
    trackedDiff: workingTreeDiff,
    untrackedEntries: readUntrackedSourceEntries(),
  });
  return {
    commit,
    ci_commit: String(process.env.GITHUB_SHA ?? '').trim() || null,
    dirty: sourceState.dirty,
    working_tree_diff_sha256: sourceState.sha256,
    untracked_file_count: sourceState.untrackedFileCount,
  };
}

function readRunnerIdentity(carrierReport = null) {
  const cpus = os.cpus();
  const provider = process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local';
  return {
    id: String(
      process.env.REDEVEN_PERFORMANCE_RUNNER_ID
        ?? process.env.RUNNER_NAME
        ?? `${process.platform}-${process.arch}-${cpus[0]?.model ?? 'unknown-cpu'}-${cpus.length}`,
    ),
    kind: 'redeven-terminal-fixed-performance',
    provider,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    chromium: carrierReport?.runner?.chromium ?? null,
    cpu_model: cpus[0]?.model ?? null,
    cpu_count: cpus.length,
    total_memory_bytes: os.totalmem(),
    github_run_id: String(process.env.GITHUB_RUN_ID ?? '').trim() || null,
    github_run_attempt: String(process.env.GITHUB_RUN_ATTEMPT ?? '').trim() || null,
  };
}

function writeReport(report) {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

let stage = 'source_revision';
let sourceRevision = null;
let browserMetrics = [];
let carrierReport = null;
try {
  sourceRevision = readSourceRevision();
  stage = 'browser_performance_terminal_surfaces';
  const terminalSurfaceBrowserOutput = run(
    'terminal surface browser performance',
    [
      path.join(uiRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      'vitest.browser.config.ts',
      '--reporter=verbose',
      'src/ui/pages/EnvTerminalPage.browser.test.tsx',
      'src/ui/widgets/TerminalPanel.browser.test.tsx',
    ],
    { ...process.env, VITE_REDEVEN_FIXED_PERF_GATE: '1' },
  );
  browserMetrics = parseFixedTerminalPerformanceMetrics(terminalSurfaceBrowserOutput);

  stage = 'carrier_performance';
  try {
    run('terminal prepared-history performance', [
      path.join(scriptDir, 'checkTerminalRecoveryCarrier.mjs'),
      '--fixture-bytes',
      String(64 * 1024),
      '--max-interactive-ms',
      '150',
      '--max-shared-prepared-p95-ms',
      '150',
      '--shared-prepared-samples',
      '20',
      '--reused-context-samples',
      '0',
      '--fresh-context-samples',
      '0',
      '--report',
      carrierReportPath,
    ]);
  } catch (error) {
    if (existsSync(carrierReportPath)) {
      carrierReport = JSON.parse(readFileSync(carrierReportPath, 'utf8'));
    }
    throw error;
  }
  carrierReport = JSON.parse(readFileSync(carrierReportPath, 'utf8'));

  stage = 'report_assembly';
  const report = buildFixedTerminalPerformanceReport({
    browserMetrics,
    carrierReport,
    sourceRevision,
    runner: readRunnerIdentity(carrierReport),
  });
  writeReport(report);
  process.stdout.write(`terminal fixed-performance report: ${reportPath}\n`);
} catch (error) {
  writeReport({
    schema_version: 2,
    status: 'failed',
    suite: 'redeven_terminal_fixed_performance',
    error_stage: stage,
    error: error instanceof Error ? error.message : String(error),
    source_revision: sourceRevision,
    runner: readRunnerIdentity(carrierReport),
    browser: {
      status: stage.startsWith('browser_performance') ? 'failed' : 'completed',
      metrics: browserMetrics,
    },
    carrier: {
      status: carrierReport?.status ?? (stage === 'carrier_performance' ? 'failed' : 'not_started'),
      evidence: carrierReport,
    },
  });
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
