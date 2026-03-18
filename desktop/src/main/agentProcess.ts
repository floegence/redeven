import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { defaultRuntimeStatePath, loadAttachableRuntimeState } from './runtimeState';
import { type StartupReport, parseStartupReport } from './startup';

const STARTUP_REPORT_POLL_MS = 100;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_RUNTIME_ATTACH_TIMEOUT_MS = 1_500;
const MAX_RECENT_LOG_CHARS = 8_000;

type SpawnedAgentProcess = ChildProcessByStdio<null, Readable, Readable>;

export type ManagedAgent = Readonly<{
  child: SpawnedAgentProcess | null;
  startup: StartupReport;
  reportDir: string | null;
  reportFile: string | null;
  attached: boolean;
  stop: () => Promise<void>;
}>;

export type StartManagedAgentArgs = Readonly<{
  executablePath: string;
  tempRoot?: string;
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  runtimeStateFile?: string;
  runtimeAttachTimeoutMs?: number;
  onLog?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}>;

type RecentLogs = {
  stdout: string;
  stderr: string;
};

export function buildManagedAgentArgs(startupReportFile: string): string[] {
  return [
    'run',
    '--mode',
    'desktop',
    '--desktop-managed',
    '--local-ui-bind',
    '127.0.0.1:0',
    '--startup-report-file',
    startupReportFile,
  ];
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function appendRecentLog(existing: string, chunk: string): string {
  const next = existing + String(chunk ?? '');
  if (next.length <= MAX_RECENT_LOG_CHARS) {
    return next;
  }
  return next.slice(next.length - MAX_RECENT_LOG_CHARS);
}

function formatRecentLogs(logs: RecentLogs): string {
  const sections: string[] = [];
  const stderr = logs.stderr.trim();
  const stdout = logs.stdout.trim();
  if (stderr) {
    sections.push(`stderr:\n${stderr}`);
  }
  if (stdout) {
    sections.push(`stdout:\n${stdout}`);
  }
  return sections.join('\n\n');
}

function readinessFailure(message: string, logs: RecentLogs): Error {
  const details = formatRecentLogs(logs);
  if (!details) {
    return new Error(message);
  }
  return new Error(`${message}\n\n${details}`);
}

async function waitForStartupReport(
  reportFile: string,
  child: SpawnedAgentProcess,
  timeoutMs: number,
  runtimeStateFile: string,
  runtimeAttachTimeoutMs: number,
  logs: RecentLogs,
  getSpawnError: () => Error | null,
): Promise<StartupReport> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const spawnError = getSpawnError();
    if (spawnError) {
      throw readinessFailure(`Failed to start redeven: ${spawnError.message}`, logs);
    }
    if (child.exitCode !== null) {
      const attachedStartup = await loadAttachableRuntimeState(runtimeStateFile, runtimeAttachTimeoutMs);
      if (attachedStartup) {
        return attachedStartup;
      }
      throw readinessFailure(`redeven exited before reporting readiness (exit code: ${child.exitCode})`, logs);
    }
    if (child.signalCode) {
      const attachedStartup = await loadAttachableRuntimeState(runtimeStateFile, runtimeAttachTimeoutMs);
      if (attachedStartup) {
        return attachedStartup;
      }
      throw readinessFailure(`redeven exited before reporting readiness (signal: ${child.signalCode})`, logs);
    }
    try {
      const raw = await fs.readFile(reportFile, 'utf8');
      return parseStartupReport(raw);
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
    if (Date.now() >= deadline) {
      const attachedStartup = await loadAttachableRuntimeState(runtimeStateFile, runtimeAttachTimeoutMs);
      if (attachedStartup) {
        return attachedStartup;
      }
      throw readinessFailure('Timed out waiting for redeven desktop startup report.', logs);
    }
    await delay(STARTUP_REPORT_POLL_MS);
  }
}

async function stopChildProcess(child: SpawnedAgentProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode) {
    return;
  }

  child.kill('SIGTERM');
  const exitPromise = once(child, 'exit').then(() => undefined);
  const timeoutPromise = delay(timeoutMs).then(() => 'timeout' as const);
  const result = await Promise.race([exitPromise, timeoutPromise]);
  if (result === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL');
    await exitPromise;
  }
}

export async function startManagedAgent(args: StartManagedAgentArgs): Promise<ManagedAgent> {
  const mergedEnv = {
    ...process.env,
    ...args.env,
  };
  const runtimeStateFile = String(args.runtimeStateFile ?? '').trim() || defaultRuntimeStatePath(mergedEnv);
  const runtimeAttachTimeoutMs = args.runtimeAttachTimeoutMs ?? DEFAULT_RUNTIME_ATTACH_TIMEOUT_MS;
  const existingRuntime = await loadAttachableRuntimeState(runtimeStateFile, runtimeAttachTimeoutMs);
  if (existingRuntime) {
    return {
      child: null,
      startup: existingRuntime,
      reportDir: null,
      reportFile: null,
      attached: true,
      stop: async () => undefined,
    };
  }

  const reportDir = await fs.mkdtemp(path.join(args.tempRoot ?? os.tmpdir(), 'redeven-desktop-'));
  const reportFile = path.join(reportDir, 'startup-report.json');
  const child = spawn(args.executablePath, buildManagedAgentArgs(reportFile), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: mergedEnv,
  });
  let spawnError: Error | null = null;
  const recentLogs: RecentLogs = { stdout: '', stderr: '' };

  child.once('error', (error) => {
    spawnError = error instanceof Error ? error : new Error(String(error));
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    recentLogs.stdout = appendRecentLog(recentLogs.stdout, chunk);
    args.onLog?.('stdout', chunk);
  });
  child.stderr.on('data', (chunk: string) => {
    recentLogs.stderr = appendRecentLog(recentLogs.stderr, chunk);
    args.onLog?.('stderr', chunk);
  });

  try {
    const startup = await waitForStartupReport(
      reportFile,
      child,
      args.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      runtimeStateFile,
      runtimeAttachTimeoutMs,
      recentLogs,
      () => spawnError,
    );
    if (spawnError || child.exitCode !== null || child.signalCode) {
      await fs.rm(reportDir, { recursive: true, force: true }).catch(() => undefined);
      return {
        child: null,
        startup,
        reportDir: null,
        reportFile: null,
        attached: true,
        stop: async () => undefined,
      };
    }
    return {
      child,
      startup,
      reportDir,
      reportFile,
      attached: false,
      stop: async () => {
        await stopChildProcess(child, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
        await fs.rm(reportDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await stopChildProcess(child, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS).catch(() => undefined);
    await fs.rm(reportDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
