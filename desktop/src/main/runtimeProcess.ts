import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { parseLaunchReport, type LaunchBlockedReport, type LaunchReport } from './launchReport';
import { defaultRuntimeStatePath, loadAttachableRuntimeState } from './runtimeState';
import { type StartupReport } from './startup';
import {
  runtimeServiceHasActiveWork,
  runtimeServiceMatchesIdentity,
  runtimeServiceNeedsRuntimeUpdate,
  runtimeServiceOpenReadinessLabel,
  runtimeServiceIsOpenable,
  type RuntimeServiceIdentity,
} from '../shared/runtimeService';

const STARTUP_REPORT_POLL_MS = 100;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_RUNTIME_ATTACH_TIMEOUT_MS = 1_500;
const DEFAULT_RUNTIME_STABILITY_WINDOW_MS = 1_200;
const DEFAULT_RUNTIME_STABILITY_POLL_MS = 250;
const MAX_RECENT_LOG_CHARS = 8_000;

type SpawnedRuntimeProcess = ChildProcessByStdio<Writable, Readable, Readable>;

export type ManagedRuntime = Readonly<{
  child: SpawnedRuntimeProcess | null;
  startup: StartupReport;
  reportDir: string | null;
  reportFile: string | null;
  attached: boolean;
  stop: () => Promise<void>;
}>;

export type StartManagedRuntimeArgs = Readonly<{
  executablePath: string;
  runtimeArgs: string[];
  tempRoot?: string;
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  runtimeStateFile?: string;
  runtimeAttachTimeoutMs?: number;
  runtimeStabilityWindowMs?: number;
  runtimeStabilityPollMs?: number;
  desktopOwnerID?: string;
  expectedRuntimeIdentity?: RuntimeServiceIdentity | null;
  passwordStdin?: string;
  onLog?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}>;

export type ManagedRuntimeLaunch = Readonly<
  | {
      kind: 'ready';
      managedRuntime: ManagedRuntime;
      spawned: boolean;
    }
  | {
      kind: 'blocked';
      blocked: LaunchBlockedReport;
      spawned: boolean;
    }
>;

export function launchStartedFreshManagedRuntime(launch: ManagedRuntimeLaunch): boolean {
  return launch.kind === 'ready' && launch.spawned && !launch.managedRuntime.attached;
}

type RecentLogs = {
  stdout: string;
  stderr: string;
};

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

async function readLaunchReport(reportFile: string): Promise<LaunchReport | null> {
  try {
    const raw = await fs.readFile(reportFile, 'utf8');
    return parseLaunchReport(raw);
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function waitForLaunchReport(
  reportFile: string,
  child: SpawnedRuntimeProcess,
  timeoutMs: number,
  runtimeStateFile: string,
  runtimeAttachTimeoutMs: number,
  logs: RecentLogs,
  getSpawnError: () => Error | null,
): Promise<LaunchReport> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const spawnError = getSpawnError();
    if (spawnError) {
      throw readinessFailure(`Failed to start redeven: ${spawnError.message}`, logs);
    }
    const launchReport = await readLaunchReport(reportFile);
    if (launchReport) {
      return launchReport;
    }
    if (child.exitCode !== null) {
      const attachedStartup = await loadAttachableRuntimeState(runtimeStateFile, runtimeAttachTimeoutMs);
      if (attachedStartup) {
        return {
          status: 'attached',
          startup: attachedStartup,
        };
      }
      const finalReport = await readLaunchReport(reportFile);
      if (finalReport) {
        return finalReport;
      }
      throw readinessFailure(`redeven exited before reporting readiness (exit code: ${child.exitCode})`, logs);
    }
    if (child.signalCode) {
      const attachedStartup = await loadAttachableRuntimeState(runtimeStateFile, runtimeAttachTimeoutMs);
      if (attachedStartup) {
        return {
          status: 'attached',
          startup: attachedStartup,
        };
      }
      const finalReport = await readLaunchReport(reportFile);
      if (finalReport) {
        return finalReport;
      }
      throw readinessFailure(`redeven exited before reporting readiness (signal: ${child.signalCode})`, logs);
    }
    if (Date.now() >= deadline) {
      const attachedStartup = await loadAttachableRuntimeState(runtimeStateFile, runtimeAttachTimeoutMs);
      if (attachedStartup) {
        return {
          status: 'attached',
          startup: attachedStartup,
        };
      }
      const finalReport = await readLaunchReport(reportFile);
      if (finalReport) {
        return finalReport;
      }
      throw readinessFailure('Timed out waiting for redeven desktop launch report.', logs);
    }
    await delay(STARTUP_REPORT_POLL_MS);
  }
}

async function stopChildProcess(child: SpawnedRuntimeProcess, timeoutMs: number): Promise<void> {
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

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    return nodeError?.code === 'EPERM';
  }
}

function runtimeExitedReadinessFailure(
  child: SpawnedRuntimeProcess | null,
  logs: RecentLogs,
): Error | null {
  if (!child) {
    return null;
  }
  if (child.exitCode !== null) {
    return readinessFailure(
      `Redeven runtime exited during startup readiness checks (exit code: ${child.exitCode}).`,
      logs,
    );
  }
  if (child.signalCode) {
    return readinessFailure(
      `Redeven runtime exited during startup readiness checks (signal: ${child.signalCode}).`,
      logs,
    );
  }
  return null;
}

function runtimePIDExited(startup: StartupReport): boolean {
  if (startup.desktop_managed !== true) {
    return false;
  }
  const pid = Number(startup.pid ?? Number.NaN);
  return Number.isInteger(pid) && pid > 0 && !processExists(pid);
}

function runtimeReportsStoppablePID(startup: StartupReport): boolean {
  const pid = Number(startup.pid ?? Number.NaN);
  return Number.isInteger(pid) && pid > 0;
}

function assertRuntimePIDAlive(startup: StartupReport, logs: RecentLogs): void {
  if (!runtimePIDExited(startup)) {
    return;
  }
  throw readinessFailure(
    'Start Runtime found a stale desktop-managed runtime process.',
    logs,
  );
}

function runtimeOpenReadinessFailure(startup: StartupReport, logs: RecentLogs): Error | null {
  if (runtimeServiceIsOpenable(startup.runtime_service)) {
    return null;
  }
  const readiness = startup.runtime_service?.open_readiness;
  const message = runtimeServiceOpenReadinessLabel(startup.runtime_service);
  if (readiness?.state === 'blocked') {
    return readinessFailure(`Redeven runtime is not openable: ${message}`, logs);
  }
  return readinessFailure(`Redeven runtime is not ready to open yet: ${message}`, logs);
}

function assertRuntimeOpenable(startup: StartupReport, logs: RecentLogs): void {
  const failure = runtimeOpenReadinessFailure(startup, logs);
  if (failure) {
    throw failure;
  }
}

async function requireAttachableRuntimeReadiness(args: Readonly<{
  runtimeStateFile: string;
  probeTimeoutMs: number;
  logs: RecentLogs;
  unavailableMessage: string;
  requireOpenable?: boolean;
}>): Promise<StartupReport> {
  const attachedStartup = await loadAttachableRuntimeState(args.runtimeStateFile, args.probeTimeoutMs);
  if (!attachedStartup) {
    throw readinessFailure(args.unavailableMessage, args.logs);
  }
  assertRuntimePIDAlive(attachedStartup, args.logs);
  if (args.requireOpenable !== false) {
    assertRuntimeOpenable(attachedStartup, args.logs);
  }
  return attachedStartup;
}

async function waitForStableRuntimeReadiness(args: Readonly<{
  startup: StartupReport;
  runtimeStateFile: string;
  probeTimeoutMs: number;
  openTimeoutMs: number;
  stabilityWindowMs: number;
  pollIntervalMs: number;
  child: SpawnedRuntimeProcess | null;
  logs: RecentLogs;
  getSpawnError?: () => Error | null;
}>): Promise<StartupReport> {
  const openTimeoutMs = Math.max(0, Math.floor(args.openTimeoutMs));
  const stabilityWindowMs = Math.max(0, Math.floor(args.stabilityWindowMs));
  const pollIntervalMs = Math.max(50, Math.floor(args.pollIntervalMs));
  const openDeadline = Date.now() + openTimeoutMs;
  let stableSince: number | null = null;
  let latestStartup = args.startup;

  for (;;) {
    const spawnError = args.getSpawnError?.() ?? null;
    if (spawnError) {
      throw readinessFailure(`Redeven runtime failed during startup readiness checks: ${spawnError.message}`, args.logs);
    }
    const exitFailure = runtimeExitedReadinessFailure(args.child, args.logs);
    if (exitFailure) {
      throw exitFailure;
    }

    latestStartup = await requireAttachableRuntimeReadiness({
      runtimeStateFile: args.runtimeStateFile,
      probeTimeoutMs: args.probeTimeoutMs,
      logs: args.logs,
      unavailableMessage: 'Start Runtime did not complete because the runtime process did not stay online.',
      requireOpenable: false,
    });
    const openReadinessFailure = runtimeOpenReadinessFailure(latestStartup, args.logs);
    const now = Date.now();
    if (openReadinessFailure) {
      stableSince = null;
      if (latestStartup.runtime_service?.open_readiness?.state === 'blocked' || now >= openDeadline) {
        throw openReadinessFailure;
      }
      await delay(pollIntervalMs);
      continue;
    }

    stableSince ??= now;
    if (now - stableSince >= stabilityWindowMs) {
      return latestStartup;
    }

    await delay(pollIntervalMs);
  }
}

async function stopAttachedProcess(pid: number, timeoutMs: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0 || !processExists(pid)) {
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ESRCH') {
      return;
    }
    throw error;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) {
      return;
    }
    await delay(100);
  }

  if (!processExists(pid)) {
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ESRCH') {
      return;
    }
    throw error;
  }
}

function attachedStop(startup: StartupReport, timeoutMs: number): () => Promise<void> {
  const pid = Number(startup.pid ?? Number.NaN);
  if (!Number.isInteger(pid) || pid <= 0) {
    return async () => undefined;
  }
  return async () => {
    await stopAttachedProcess(pid, timeoutMs);
  };
}

type ManagedRuntimeAttachPolicy =
  | Readonly<{ action: 'reuse' }>
  | Readonly<{ action: 'replace' }>
  | Readonly<{ action: 'block'; message: string }>;

function managedRuntimeOwnership(
  startup: StartupReport,
  desktopOwnerID: string,
): 'owned' | 'managed_elsewhere' | 'legacy_unleased' | 'external' {
  if (startup.desktop_managed !== true) {
    return 'external';
  }
  const cleanDesktopOwnerID = String(desktopOwnerID ?? '').trim();
  const startupOwnerID = String(startup.desktop_owner_id ?? '').trim();
  if (cleanDesktopOwnerID !== '' && startupOwnerID !== '' && startupOwnerID === cleanDesktopOwnerID) {
    return 'owned';
  }
  return startupOwnerID === '' ? 'legacy_unleased' : 'managed_elsewhere';
}

function managedRuntimeAttachPolicy(
  startup: StartupReport,
  args: Readonly<{
    desktopOwnerID?: string;
    expectedRuntimeIdentity?: RuntimeServiceIdentity | null;
  }>,
): ManagedRuntimeAttachPolicy {
  const ownership = managedRuntimeOwnership(startup, String(args.desktopOwnerID ?? ''));
  if (ownership === 'external') {
    return { action: 'reuse' };
  }
  if (ownership === 'managed_elsewhere') {
    return {
      action: 'block',
      message: 'The running Desktop-managed runtime is owned by another Desktop instance.',
    };
  }

  const runtimeNeedsRestart = ownership === 'legacy_unleased'
    || runtimeServiceNeedsRuntimeUpdate(startup.runtime_service)
    || !runtimeServiceMatchesIdentity(startup.runtime_service, args.expectedRuntimeIdentity);
  if (!runtimeNeedsRestart) {
    return { action: 'reuse' };
  }
  if (runtimeServiceHasActiveWork(startup.runtime_service)) {
    return {
      action: 'block',
      message: ownership === 'legacy_unleased'
        ? 'An older Desktop-managed runtime has active work. Close active runtime work before Desktop restarts it.'
        : 'The Desktop-managed runtime needs to restart before opening, but active work is still running.',
    };
  }
  if (!runtimeReportsStoppablePID(startup)) {
    return {
      action: 'block',
      message: 'The Desktop-managed runtime needs to restart before opening, but it did not report a process id Desktop can stop.',
    };
  }
  return { action: 'replace' };
}

async function writePasswordToStdin(child: SpawnedRuntimeProcess, password: string): Promise<void> {
  const stdin = child.stdin;
  if (!stdin || stdin.destroyed || !stdin.writable) {
    throw new Error('redeven stdin pipe is unavailable for password-stdin startup');
  }

  await new Promise<void>((resolve, reject) => {
    stdin.write(`${password}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      stdin.end((endError?: Error | null) => {
        if (endError) {
          reject(endError);
          return;
        }
        resolve();
      });
    });
  });
}

export async function startManagedRuntime(args: StartManagedRuntimeArgs): Promise<ManagedRuntimeLaunch> {
  const mergedEnv = {
    ...process.env,
    ...args.env,
  };
  const runtimeStateFile = String(args.runtimeStateFile ?? '').trim() || defaultRuntimeStatePath(mergedEnv);
  const runtimeAttachTimeoutMs = args.runtimeAttachTimeoutMs ?? DEFAULT_RUNTIME_ATTACH_TIMEOUT_MS;
  const runtimeStabilityWindowMs = args.runtimeStabilityWindowMs ?? DEFAULT_RUNTIME_STABILITY_WINDOW_MS;
  const runtimeStabilityPollMs = args.runtimeStabilityPollMs ?? DEFAULT_RUNTIME_STABILITY_POLL_MS;
  const existingRuntime = await loadAttachableRuntimeState(runtimeStateFile, runtimeAttachTimeoutMs);
  if (existingRuntime) {
    assertRuntimePIDAlive(existingRuntime, { stdout: '', stderr: '' });
    const attachPolicy = managedRuntimeAttachPolicy(existingRuntime, {
      desktopOwnerID: args.desktopOwnerID,
      expectedRuntimeIdentity: args.expectedRuntimeIdentity,
    });
    if (attachPolicy.action === 'block') {
      throw readinessFailure(attachPolicy.message, { stdout: '', stderr: '' });
    }
    if (attachPolicy.action === 'reuse') {
      assertRuntimeOpenable(existingRuntime, { stdout: '', stderr: '' });
      return {
        kind: 'ready',
        managedRuntime: {
          child: null,
          startup: existingRuntime,
          reportDir: null,
          reportFile: null,
          attached: true,
          stop: attachedStop(existingRuntime, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS),
        },
        spawned: false,
      };
    }
    await attachedStop(existingRuntime, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)();
  }

  const reportDir = await fs.mkdtemp(path.join(args.tempRoot ?? os.tmpdir(), 'redeven-desktop-'));
  const reportFile = path.join(reportDir, 'startup-report.json');
  const child = spawn(args.executablePath, [...args.runtimeArgs, '--startup-report-file', reportFile], {
    stdio: ['pipe', 'pipe', 'pipe'],
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

  const passwordStdin = String(args.passwordStdin ?? '');
  if (passwordStdin !== '') {
    try {
      await writePasswordToStdin(child, passwordStdin);
    } catch (error) {
      await stopChildProcess(child, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS).catch(() => undefined);
      await fs.rm(reportDir, { recursive: true, force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw readinessFailure(`Failed to send redeven startup password: ${message}`, recentLogs);
    }
  } else {
    child.stdin.end();
  }

  try {
    const launchReport = await waitForLaunchReport(
      reportFile,
      child,
      args.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      runtimeStateFile,
      runtimeAttachTimeoutMs,
      recentLogs,
      () => spawnError,
    );

    if (launchReport.status === 'blocked') {
      await stopChildProcess(child, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS).catch(() => undefined);
      await fs.rm(reportDir, { recursive: true, force: true }).catch(() => undefined);
      return {
        kind: 'blocked',
        blocked: launchReport,
        spawned: true,
      };
    }

    const startup = launchReport.startup;
    if (launchReport.status === 'attached') {
      await stopChildProcess(child, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS).catch(() => undefined);
      await fs.rm(reportDir, { recursive: true, force: true }).catch(() => undefined);
      const attachedStartup = await requireAttachableRuntimeReadiness({
        runtimeStateFile,
        probeTimeoutMs: runtimeAttachTimeoutMs,
        logs: recentLogs,
        unavailableMessage: 'Start Runtime did not complete because the attached runtime is no longer online.',
        requireOpenable: false,
      });
      const attachPolicy = managedRuntimeAttachPolicy(attachedStartup, {
        desktopOwnerID: args.desktopOwnerID,
        expectedRuntimeIdentity: args.expectedRuntimeIdentity,
      });
      if (attachPolicy.action === 'block') {
        throw readinessFailure(attachPolicy.message, recentLogs);
      }
      if (attachPolicy.action === 'replace') {
        await attachedStop(attachedStartup, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)();
        return startManagedRuntime(args);
      }
      assertRuntimeOpenable(attachedStartup, recentLogs);
      return {
        kind: 'ready',
        managedRuntime: {
          child: null,
          startup: attachedStartup,
          reportDir: null,
          reportFile: null,
          attached: true,
          stop: attachedStop(attachedStartup, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS),
        },
        spawned: true,
      };
    }

    if (spawnError || child.exitCode !== null || child.signalCode) {
      const attachedStartup = await loadAttachableRuntimeState(runtimeStateFile, runtimeAttachTimeoutMs);
      if (!attachedStartup) {
        throw readinessFailure(
          'Start Runtime did not complete because the runtime process exited before Desktop could attach.',
          recentLogs,
        );
      }
      await fs.rm(reportDir, { recursive: true, force: true }).catch(() => undefined);
      assertRuntimePIDAlive(attachedStartup, recentLogs);
      const attachPolicy = managedRuntimeAttachPolicy(attachedStartup, {
        desktopOwnerID: args.desktopOwnerID,
        expectedRuntimeIdentity: args.expectedRuntimeIdentity,
      });
      if (attachPolicy.action === 'block') {
        throw readinessFailure(attachPolicy.message, recentLogs);
      }
      if (attachPolicy.action === 'replace') {
        await attachedStop(attachedStartup, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)();
        return startManagedRuntime(args);
      }
      assertRuntimeOpenable(attachedStartup, recentLogs);
      return {
        kind: 'ready',
        managedRuntime: {
          child: null,
          startup: attachedStartup,
          reportDir: null,
          reportFile: null,
          attached: true,
          stop: attachedStop(attachedStartup, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS),
        },
        spawned: true,
      };
    }

    const stableStartup = await waitForStableRuntimeReadiness({
      startup,
      runtimeStateFile,
      probeTimeoutMs: runtimeAttachTimeoutMs,
      openTimeoutMs: args.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      stabilityWindowMs: runtimeStabilityWindowMs,
      pollIntervalMs: runtimeStabilityPollMs,
      child,
      logs: recentLogs,
      getSpawnError: () => spawnError,
    });
    return {
      kind: 'ready',
      managedRuntime: {
        child,
        startup: stableStartup,
        reportDir,
        reportFile,
        attached: false,
        stop: async () => {
          await stopChildProcess(child, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
          await fs.rm(reportDir, { recursive: true, force: true });
        },
      },
      spawned: true,
    };
  } catch (error) {
    await stopChildProcess(child, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS).catch(() => undefined);
    await fs.rm(reportDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function attachManagedRuntimeFromStateFile(args: Readonly<{
  runtimeStateFile: string;
  runtimeAttachTimeoutMs?: number;
  stopTimeoutMs?: number;
}>): Promise<ManagedRuntime | null> {
  const runtimeStateFile = String(args.runtimeStateFile ?? '').trim();
  if (runtimeStateFile === '') {
    return null;
  }
  const startup = await loadAttachableRuntimeState(
    runtimeStateFile,
    args.runtimeAttachTimeoutMs ?? DEFAULT_RUNTIME_ATTACH_TIMEOUT_MS,
  );
  if (!startup) {
    return null;
  }
  return {
    child: null,
    startup,
    reportDir: null,
    reportFile: null,
    attached: true,
    stop: attachedStop(startup, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS),
  };
}
