import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

const STARTUP_REPORT_POLL_MS = 100;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

type SpawnedAgentProcess = ChildProcessByStdio<null, Readable, Readable>;

export type StartupReport = Readonly<{
  local_ui_url: string;
  local_ui_urls: string[];
  effective_run_mode?: string;
  remote_enabled?: boolean;
  desktop_managed?: boolean;
}>;

export type ManagedAgent = Readonly<{
  child: SpawnedAgentProcess;
  startup: StartupReport;
  reportDir: string;
  reportFile: string;
  stop: () => Promise<void>;
}>;

export type StartManagedAgentArgs = Readonly<{
  executablePath: string;
  tempRoot?: string;
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  onLog?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}>;

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

export function parseStartupReport(raw: string): StartupReport {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const localUIURL = String(parsed.local_ui_url ?? '').trim();
  if (!localUIURL) {
    throw new Error('startup report missing local_ui_url');
  }

  const localUIURLs = Array.isArray(parsed.local_ui_urls)
    ? parsed.local_ui_urls.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];

  return {
    local_ui_url: localUIURL,
    local_ui_urls: localUIURLs.length > 0 ? localUIURLs : [localUIURL],
    effective_run_mode: String(parsed.effective_run_mode ?? '').trim() || undefined,
    remote_enabled: typeof parsed.remote_enabled === 'boolean' ? parsed.remote_enabled : undefined,
    desktop_managed: typeof parsed.desktop_managed === 'boolean' ? parsed.desktop_managed : undefined,
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStartupReport(reportFile: string, child: SpawnedAgentProcess, timeoutMs: number): Promise<StartupReport> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`redeven exited before reporting readiness (exit code: ${child.exitCode})`);
    }
    if (child.signalCode) {
      throw new Error(`redeven exited before reporting readiness (signal: ${child.signalCode})`);
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
      throw new Error('Timed out waiting for redeven desktop startup report.');
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
  const reportDir = await fs.mkdtemp(path.join(args.tempRoot ?? os.tmpdir(), 'redeven-desktop-'));
  const reportFile = path.join(reportDir, 'startup-report.json');
  const child = spawn(args.executablePath, buildManagedAgentArgs(reportFile), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...args.env,
    },
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => args.onLog?.('stdout', chunk));
  child.stderr.on('data', (chunk: string) => args.onLog?.('stderr', chunk));

  try {
    const startup = await waitForStartupReport(reportFile, child, args.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
    return {
      child,
      startup,
      reportDir,
      reportFile,
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
