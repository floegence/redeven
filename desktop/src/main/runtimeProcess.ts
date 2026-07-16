import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

import {
  DesktopOperationFailureError,
  desktopOperationFailurePresentation,
  diagnosticsFromRecentLogs,
} from './desktopOperationFailure';
import { parseLaunchReport, type LaunchBlockedReport, type LaunchReport } from './launchReport';
import { type StartupReport } from './startup';
import {
  runtimeServiceAllowsOpenAttempt,
  runtimeServiceHasActiveWork,
  runtimeServiceOpenReadinessLabel,
  runtimeServiceIsOpenable,
} from '../shared/runtimeService';
import { sanitizeDesktopChildEnvironment } from './desktopProcessEnvironment';
import {
  parseDesktopRuntimeProcessInventory,
  parseDesktopRuntimeProcessStopResult,
  requireDesktopRuntimeProcessReconciliation,
  desktopRuntimeProcessInventoryHasSingleCurrentOwner,
  desktopRuntimeProcessStopTargetCount,
  runtimeProcessCommandErrorFromOutput,
  type DesktopRuntimeProcessInventory,
} from './runtimeProcessInventory';
import type { DesktopRuntimeProcessReconciliation } from '../shared/desktopRuntimeProcessTakeover';

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
  stateRoot?: string;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  runtimeAttachTimeoutMs?: number;
  runtimeStabilityWindowMs?: number;
  runtimeStabilityPollMs?: number;
  desktopOwnerID?: string;
  forceRuntimeUpdate?: boolean;
  runtimeProcessIntent?: 'start' | 'restart' | 'update';
  runtimeProcessReconciliation?: DesktopRuntimeProcessReconciliation;
  beforeRuntimeReplacement?: () => Promise<void>;
  startupSecretsStdin?: string;
  signal?: AbortSignal;
  onProgress?: (progress: ManagedRuntimeProgress) => void;
  onLog?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}>;

export class ManagedRuntimeStartupCleanupError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = 'ManagedRuntimeStartupCleanupError';
  }
}

export type ManagedRuntimeProgressPhase =
  | 'checking_existing_runtime'
  | 'discovering_runtime_instances'
  | 'stopping_runtime_process'
  | 'verifying_runtime_inventory'
  | 'starting_runtime'
  | 'waiting_for_readiness'
  | 'runtime_ready';

export type ManagedRuntimeProgress = Readonly<{
  phase: ManagedRuntimeProgressPhase;
  title: string;
  detail: string;
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

function runtimeAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Runtime lifecycle operation was canceled.', 'AbortError');
}

function throwIfRuntimeAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw runtimeAbortError(signal);
  }
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfRuntimeAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(runtimeAbortError(signal!));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function appendRecentLog(existing: string, chunk: string): string {
  const next = existing + String(chunk ?? '');
  if (next.length <= MAX_RECENT_LOG_CHARS) {
    return next;
  }
  return next.slice(next.length - MAX_RECENT_LOG_CHARS);
}

function emitManagedRuntimeProgress(
  callback: StartManagedRuntimeArgs['onProgress'],
  phase: ManagedRuntimeProgressPhase,
  title: string,
  detail: string,
): void {
  callback?.({
    phase,
    title,
    detail,
  });
}

const LOCAL_RUNTIME_LOG_LABELS: Record<keyof RecentLogs, string> = {
  stderr: 'Runtime stderr',
  stdout: 'Runtime stdout',
};

function readinessFailure(
  message: string,
  logs: RecentLogs,
  options: Readonly<{
    title?: string;
    detail?: string;
    recoveryHint?: string;
  }> = {},
): Error {
  return new DesktopOperationFailureError(desktopOperationFailurePresentation({
    code: 'local_runtime_launch_failed',
    title: options.title ?? 'Local Runtime Start Failed',
    summary: message,
    detail: options.detail,
    recoveryHint: options.recoveryHint,
    diagnostics: diagnosticsFromRecentLogs(logs, LOCAL_RUNTIME_LOG_LABELS),
  }));
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

async function readRuntimeStatus(args: Readonly<{
  executablePath: string;
  stateRoot?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}>): Promise<LaunchReport | null> {
  const executablePath = String(args.executablePath ?? '').trim();
  if (!executablePath) {
    return null;
  }
  const commandArgs = ['desktop-runtime-status'];
  const stateRoot = String(args.stateRoot ?? '').trim();
  if (stateRoot) {
    commandArgs.push('--state-root', stateRoot);
  }
  const timeoutMs = Math.max(100, Math.floor(args.timeoutMs));
  return await new Promise((resolve, reject) => {
    const child = spawn(executablePath, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: args.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGKILL');
      resolve(null);
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        if (stderr.trim()) {
          reject(new Error(stderr.trim()));
          return;
        }
        resolve(null);
        return;
      }
      try {
        resolve(parseLaunchReport(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}

async function runRuntimeProcessCommand(args: Readonly<{
  executablePath: string;
  commandArgs: readonly string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}>): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(args.executablePath, args.commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: args.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('Runtime process command timed out.'));
    }, Math.max(100, args.timeoutMs));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(runtimeProcessCommandErrorFromOutput(
        stdout,
        stderr,
        `Runtime process command exited with code ${code ?? 'unknown'}.`,
      ));
    });
  });
}

export async function inspectLocalManagedRuntimeProcesses(args: Readonly<{
  executablePath: string;
  stateRoot: string;
  desktopOwnerID: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}>): Promise<DesktopRuntimeProcessInventory> {
  return parseDesktopRuntimeProcessInventory(await runRuntimeProcessCommand({
    executablePath: args.executablePath,
    commandArgs: [
      'desktop-runtime-inventory',
      '--runtime-root', args.stateRoot,
      '--state-root', args.stateRoot,
      '--desktop-owner-id', args.desktopOwnerID,
      '--current-executable', args.executablePath,
    ],
    env: args.env,
    timeoutMs: args.timeoutMs ?? DEFAULT_RUNTIME_ATTACH_TIMEOUT_MS,
  }));
}

export async function stopLocalManagedRuntimeProcesses(args: Readonly<{
  executablePath: string;
  stateRoot: string;
  desktopOwnerID: string;
  env: NodeJS.ProcessEnv;
  inventory: DesktopRuntimeProcessInventory;
  timeoutMs: number;
  reconciliation?: DesktopRuntimeProcessReconciliation;
}>): Promise<ReturnType<typeof parseDesktopRuntimeProcessStopResult>> {
  const result = parseDesktopRuntimeProcessStopResult(await runRuntimeProcessCommand({
    executablePath: args.executablePath,
    commandArgs: [
      'desktop-runtime-stop',
      '--runtime-root', args.stateRoot,
      '--state-root', args.stateRoot,
      '--desktop-owner-id', args.desktopOwnerID,
      '--current-executable', args.executablePath,
      '--all-matching',
      '--expected-inventory-digest', args.inventory.inventory_digest,
      '--reconciliation-mode', args.reconciliation?.mode ?? 'automatic',
      '--grace-period', `${Math.max(1, Math.ceil(args.timeoutMs / 1000))}s`,
      '--json',
    ],
    env: args.env,
    timeoutMs: args.timeoutMs + 6_000,
  }));
  if (result.after.instances.length > 0) {
    throw new Error('Desktop could not verify an empty local runtime process inventory.');
  }
  return result;
}

function localManagedRuntimeStop(args: Readonly<{
  executablePath: string;
  stateRoot: string;
  desktopOwnerID: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}>): () => Promise<void> {
  return async () => {
    const inventory = await inspectLocalManagedRuntimeProcesses(args);
    requireDesktopRuntimeProcessReconciliation(inventory);
    if (inventory.instances.length === 0) {
      return;
    }
    await stopLocalManagedRuntimeProcesses({ ...args, inventory });
  };
}

export async function loadManagedRuntimeStartupFromStatus(args: Readonly<{
  executablePath: string;
  stateRoot?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}>): Promise<StartupReport | null> {
  const report = await readRuntimeStatus(args);
  if (!report || report.status === 'blocked') {
    return null;
  }
  return report.startup;
}

async function waitForLaunchReport(
  reportFile: string,
  child: SpawnedRuntimeProcess,
  timeoutMs: number,
  executablePath: string,
  stateRoot: string | undefined,
  env: NodeJS.ProcessEnv,
  runtimeAttachTimeoutMs: number,
  logs: RecentLogs,
  getSpawnError: () => Error | null,
  signal?: AbortSignal,
): Promise<LaunchReport> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    throwIfRuntimeAborted(signal);
    const spawnError = getSpawnError();
    if (spawnError) {
      throw readinessFailure(`Failed to start redeven: ${spawnError.message}`, logs);
    }
    const launchReport = await readLaunchReport(reportFile);
    if (launchReport) {
      return launchReport;
    }
    if (child.exitCode !== null) {
      const attachedStartup = await loadManagedRuntimeStartupFromStatus({
        executablePath,
        stateRoot,
        env,
        timeoutMs: runtimeAttachTimeoutMs,
      });
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
      const attachedStartup = await loadManagedRuntimeStartupFromStatus({
        executablePath,
        stateRoot,
        env,
        timeoutMs: runtimeAttachTimeoutMs,
      });
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
      const attachedStartup = await loadManagedRuntimeStartupFromStatus({
        executablePath,
        stateRoot,
        env,
        timeoutMs: runtimeAttachTimeoutMs,
      });
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
    await delay(STARTUP_REPORT_POLL_MS, signal);
  }
}

async function stopChildProcess(child: SpawnedRuntimeProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode) {
    return;
  }

  const exitResult = new Promise<'exited' | 'timeout'>((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve('exited');
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve('timeout');
    }, timeoutMs);
    child.once('exit', onExit);
  });
  child.kill('SIGTERM');
  const result = await exitResult;
  if (result === 'timeout' && child.exitCode === null) {
    const forcedExit = once(child, 'exit').then(() => undefined);
    child.kill('SIGKILL');
    await forcedExit;
  }
}

async function cleanupManagedRuntimeStartup(args: Readonly<{
  child: SpawnedRuntimeProcess;
  reportDir: string;
  stopTimeoutMs: number;
  reconcileInventory?: (() => Promise<void>) | null;
  cause?: unknown;
}>): Promise<void> {
  const cleanupErrors: Error[] = [];
  try {
    await stopChildProcess(args.child, args.stopTimeoutMs);
  } catch (error) {
    cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
  }
  if (args.reconcileInventory) {
    try {
      await args.reconcileInventory();
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  try {
    await fs.rm(args.reportDir, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
  }
  if (cleanupErrors.length > 0) {
    throw new ManagedRuntimeStartupCleanupError(
      `Desktop could not clean up the local runtime startup: ${cleanupErrors.map((item) => item.message).join('; ')}`,
      { cause: args.cause },
    );
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
  executablePath: string;
  stateRoot?: string;
  env: NodeJS.ProcessEnv;
  probeTimeoutMs: number;
  logs: RecentLogs;
  unavailableMessage: string;
  requireOpenable?: boolean;
}>): Promise<StartupReport> {
  const attachedStartup = await loadManagedRuntimeStartupFromStatus({
    executablePath: args.executablePath,
    stateRoot: args.stateRoot,
    env: args.env,
    timeoutMs: args.probeTimeoutMs,
  });
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
  executablePath: string;
  stateRoot?: string;
  env: NodeJS.ProcessEnv;
  probeTimeoutMs: number;
  openTimeoutMs: number;
  stabilityWindowMs: number;
  pollIntervalMs: number;
  child: SpawnedRuntimeProcess | null;
  logs: RecentLogs;
  getSpawnError?: () => Error | null;
  signal?: AbortSignal;
}>): Promise<StartupReport> {
  const openTimeoutMs = Math.max(0, Math.floor(args.openTimeoutMs));
  const stabilityWindowMs = Math.max(0, Math.floor(args.stabilityWindowMs));
  const pollIntervalMs = Math.max(50, Math.floor(args.pollIntervalMs));
  const openDeadline = Date.now() + openTimeoutMs;
  let stableSince: number | null = null;
  let latestStartup = args.startup;

  for (;;) {
    throwIfRuntimeAborted(args.signal);
    const spawnError = args.getSpawnError?.() ?? null;
    if (spawnError) {
      throw readinessFailure(`Redeven runtime failed during startup readiness checks: ${spawnError.message}`, args.logs);
    }
    const exitFailure = runtimeExitedReadinessFailure(args.child, args.logs);
    if (exitFailure) {
      throw exitFailure;
    }

    latestStartup = await requireAttachableRuntimeReadiness({
      executablePath: args.executablePath,
      stateRoot: args.stateRoot,
      env: args.env,
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
      await delay(pollIntervalMs, args.signal);
      continue;
    }

    stableSince ??= now;
    if (now - stableSince >= stabilityWindowMs) {
      return latestStartup;
    }

    await delay(pollIntervalMs, args.signal);
  }
}

function attachedStop(startup: StartupReport, timeoutMs: number): () => Promise<void> {
  if (startup.desktop_managed !== true) {
    return async () => undefined;
  }
  return async () => {
    throw new Error(
      `Desktop cannot stop managed runtime pid ${Number(startup.pid ?? 0)} without a verified process inventory (timeout ${timeoutMs}ms).`,
    );
  };
}

type ManagedRuntimeAttachPolicy =
  | Readonly<{ action: 'reuse' }>
  | Readonly<{ action: 'replace' }>
  | Readonly<{ action: 'block'; message: string }>;

function managedRuntimeOwnership(
  startup: StartupReport,
  desktopOwnerID: string,
): 'owned' | 'managed_elsewhere' | 'unowned' | 'external' {
  if (startup.desktop_managed !== true) {
    return 'external';
  }
  const cleanDesktopOwnerID = String(desktopOwnerID ?? '').trim();
  const startupOwnerID = String(startup.desktop_owner_id ?? '').trim();
  if (cleanDesktopOwnerID !== '' && startupOwnerID !== '' && startupOwnerID === cleanDesktopOwnerID) {
    return 'owned';
  }
  return startupOwnerID === '' ? 'unowned' : 'managed_elsewhere';
}

function managedRuntimeAttachPolicy(
  startup: StartupReport,
  args: Readonly<{
    desktopOwnerID?: string;
    forceRuntimeUpdate?: boolean;
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

  const runtimeNeedsRestart = ownership === 'unowned';
  if (!runtimeNeedsRestart) {
    return { action: 'reuse' };
  }
  if (args.forceRuntimeUpdate !== true) {
    return {
      action: 'block',
      message: 'This runtime needs an explicit update before Desktop can start it with the bundled runtime.',
    };
  }
  if (runtimeServiceHasActiveWork(startup.runtime_service)) {
    return {
      action: 'block',
      message: ownership === 'unowned'
        ? 'A Desktop-managed runtime without an owner id has active work. Close active runtime work before Desktop restarts it.'
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

async function verifyManagedLocalRuntimeProcessIdentity(args: Readonly<{
  executablePath: string;
  stateRoot?: string;
  desktopOwnerID?: string;
  env: NodeJS.ProcessEnv;
  startup: StartupReport;
  runtimeProcessIntent: 'start' | 'restart' | 'update';
  beforeInventory: DesktopRuntimeProcessInventory | null;
  timeoutMs: number;
}>): Promise<void> {
  const stateRoot = String(args.stateRoot ?? '').trim();
  const desktopOwnerID = String(args.desktopOwnerID ?? '').trim();
  if (!stateRoot || !desktopOwnerID) {
    return;
  }
  const inventory = await inspectLocalManagedRuntimeProcesses({
    executablePath: args.executablePath,
    stateRoot,
    desktopOwnerID,
    env: args.env,
    timeoutMs: args.timeoutMs,
  });
  const instance = inventory.instances[0];
  const expectedVersion = String(args.startup.runtime_service?.runtime_version ?? '').trim();
  const issues = [
    ...(inventory.summary.blocked > 0 ? [`blocked=${inventory.summary.blocked}`] : []),
    ...(inventory.summary.confirmed_takeover > 0 ? [`takeover=${inventory.summary.confirmed_takeover}`] : []),
    ...(!desktopRuntimeProcessInventoryHasSingleCurrentOwner(inventory) ? ['current_owner=invalid'] : []),
    ...(inventory.instances.length !== 1 ? [`instances=${inventory.instances.length}`] : []),
    ...(!instance ? ['instance=missing'] : []),
    ...(instance && instance.pid !== args.startup.pid ? [`pid=${instance.pid}, expected=${args.startup.pid}`] : []),
    ...(instance && instance.desktop_owner_id !== desktopOwnerID ? ['owner=mismatch'] : []),
    ...(instance && instance.state_root !== inventory.scope.state_root ? ['state_root=mismatch'] : []),
    ...(instance && instance.namespace_id !== inventory.scope.namespace_id ? ['namespace=mismatch'] : []),
    ...(instance && expectedVersion !== '' && String(instance.runtime_version ?? '').trim() !== expectedVersion
      ? [`version=${instance.runtime_version ?? 'missing'}, expected=${expectedVersion}`]
      : []),
  ];
  if (
    instance
    && args.runtimeProcessIntent !== 'start'
    && args.beforeInventory?.instances.some((before) => (
      before.pid === instance.pid
      && before.process_started_at_unix_ms === instance.process_started_at_unix_ms
    ))
  ) {
    issues.push('process_identity=unchanged');
  }
  if (issues.length > 0) {
    throw new Error(`Desktop could not verify a single current local runtime process after startup (${issues.join('; ')}).`);
  }
}

async function writeStartupSecretsToStdin(child: SpawnedRuntimeProcess, envelope: string): Promise<void> {
  const stdin = child.stdin;
  if (!stdin || stdin.destroyed || !stdin.writable) {
    throw new Error('redeven stdin pipe is unavailable for Desktop startup secrets');
  }

  await new Promise<void>((resolve, reject) => {
    stdin.write(envelope, (error) => {
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
  throwIfRuntimeAborted(args.signal);
  const mergedEnv = sanitizeDesktopChildEnvironment({
    ...process.env,
    ...args.env,
  });
  const stateRoot = String(args.stateRoot ?? '').trim() || undefined;
  const runtimeAttachTimeoutMs = args.runtimeAttachTimeoutMs ?? DEFAULT_RUNTIME_ATTACH_TIMEOUT_MS;
  const runtimeStabilityWindowMs = args.runtimeStabilityWindowMs ?? DEFAULT_RUNTIME_STABILITY_WINDOW_MS;
  const runtimeStabilityPollMs = args.runtimeStabilityPollMs ?? DEFAULT_RUNTIME_STABILITY_POLL_MS;
  const desktopOwnerID = String(args.desktopOwnerID ?? '').trim();
  const runtimeProcessIntent = args.runtimeProcessIntent
    ?? (args.forceRuntimeUpdate === true ? 'update' : 'start');
  const inventoryStop = stateRoot && desktopOwnerID
    ? localManagedRuntimeStop({
        executablePath: args.executablePath,
        stateRoot,
        desktopOwnerID,
        env: mergedEnv,
        timeoutMs: args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
      })
    : null;
  emitManagedRuntimeProgress(
    args.onProgress,
    'checking_existing_runtime',
    'Checking existing runtime',
    'Desktop is checking whether a verified current local Runtime is already running.',
  );
  let observedInventory: DesktopRuntimeProcessInventory | null = null;
  if (stateRoot && desktopOwnerID) {
    throwIfRuntimeAborted(args.signal);
    emitManagedRuntimeProgress(
      args.onProgress,
      'discovering_runtime_instances',
      'Discovering runtime processes',
      'Desktop is verifying local Runtime process identities.',
    );
    observedInventory = await inspectLocalManagedRuntimeProcesses({
      executablePath: args.executablePath,
      stateRoot,
      desktopOwnerID,
      env: mergedEnv,
      timeoutMs: runtimeAttachTimeoutMs,
    });
    requireDesktopRuntimeProcessReconciliation(observedInventory, args.runtimeProcessReconciliation);
    if (runtimeProcessIntent === 'start' && observedInventory.instances.length > 1) {
      throw readinessFailure(
        `Desktop found ${observedInventory.instances.length} verified local Runtime processes. Restart or update the Runtime before opening it.`,
        { stdout: '', stderr: '' },
      );
    }
    if (runtimeProcessIntent !== 'start') {
      await args.beforeRuntimeReplacement?.();
      throwIfRuntimeAborted(args.signal);
    }
    if (runtimeProcessIntent !== 'start' && observedInventory.instances.length > 0) {
      emitManagedRuntimeProgress(
        args.onProgress,
        'stopping_runtime_process',
        'Stopping Runtime processes',
        `Desktop is stopping ${desktopRuntimeProcessStopTargetCount(observedInventory, args.runtimeProcessReconciliation)} verified local Runtime process(es).`,
      );
      await stopLocalManagedRuntimeProcesses({
        executablePath: args.executablePath,
        stateRoot,
        desktopOwnerID,
        env: mergedEnv,
        inventory: observedInventory,
        timeoutMs: args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
        reconciliation: args.runtimeProcessReconciliation,
      });
      emitManagedRuntimeProgress(
        args.onProgress,
        'verifying_runtime_inventory',
        'Verifying runtime process inventory',
        'Desktop confirmed that no matching local runtime process remains.',
      );
    }
  }
  const existingRuntime = await loadManagedRuntimeStartupFromStatus({
    executablePath: args.executablePath,
    stateRoot,
    env: mergedEnv,
    timeoutMs: runtimeAttachTimeoutMs,
  });
  throwIfRuntimeAborted(args.signal);
  if (existingRuntime) {
    assertRuntimePIDAlive(existingRuntime, { stdout: '', stderr: '' });
    const attachPolicy = managedRuntimeAttachPolicy(existingRuntime, {
      desktopOwnerID: args.desktopOwnerID,
      forceRuntimeUpdate: args.forceRuntimeUpdate,
    });
    if (attachPolicy.action === 'block') {
      throw readinessFailure(attachPolicy.message, { stdout: '', stderr: '' });
    }
    if (attachPolicy.action === 'reuse') {
      emitManagedRuntimeProgress(
        args.onProgress,
        'waiting_for_readiness',
        'Checking runtime readiness',
        'Desktop found a verified current local Runtime and is checking whether it can open the Environment App.',
      );
      if (!runtimeServiceAllowsOpenAttempt(existingRuntime.runtime_service)) {
        assertRuntimeOpenable(existingRuntime, { stdout: '', stderr: '' });
      }
      await verifyManagedLocalRuntimeProcessIdentity({
        executablePath: args.executablePath,
        stateRoot,
        desktopOwnerID,
        env: mergedEnv,
        startup: existingRuntime,
        runtimeProcessIntent,
        beforeInventory: observedInventory,
        timeoutMs: runtimeAttachTimeoutMs,
      });
      emitManagedRuntimeProgress(
        args.onProgress,
        'runtime_ready',
        'Runtime ready',
        'The local runtime is ready to open.',
      );
      return {
        kind: 'ready',
        managedRuntime: {
          child: null,
          startup: existingRuntime,
          reportDir: null,
          reportFile: null,
          attached: true,
          stop: inventoryStop ?? attachedStop(existingRuntime, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS),
        },
        spawned: false,
      };
    }
    await (inventoryStop ?? attachedStop(existingRuntime, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS))();
  }

  if (runtimeProcessIntent === 'start' && observedInventory && observedInventory.instances.length > 0) {
    throw readinessFailure(
      'Desktop found a live local runtime process, but its Runtime Service status is unavailable. Restart or update the runtime before opening it.',
      { stdout: '', stderr: '' },
    );
  }

  emitManagedRuntimeProgress(
    args.onProgress,
    'starting_runtime',
    'Starting runtime',
    'Desktop is launching the bundled Redeven runtime on this device.',
  );
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

  const startupSecretsStdin = String(args.startupSecretsStdin ?? '');
  try {
    throwIfRuntimeAborted(args.signal);
    if (startupSecretsStdin !== '') {
      try {
        await writeStartupSecretsToStdin(child, startupSecretsStdin);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw readinessFailure(`Failed to send redeven Desktop startup secrets: ${message}`, recentLogs);
      }
    } else {
      child.stdin.end();
    }

    emitManagedRuntimeProgress(
      args.onProgress,
      'waiting_for_readiness',
      'Waiting for runtime readiness',
      'Redeven is starting locally and writing its startup report.',
    );
    const launchReport = await waitForLaunchReport(
      reportFile,
      child,
      args.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      args.executablePath,
      stateRoot,
      mergedEnv,
      runtimeAttachTimeoutMs,
      recentLogs,
      () => spawnError,
      args.signal,
    );

    if (launchReport.status === 'blocked') {
      await cleanupManagedRuntimeStartup({
        child,
        reportDir,
        stopTimeoutMs: args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
        reconcileInventory: inventoryStop,
      });
      return {
        kind: 'blocked',
        blocked: launchReport,
        spawned: true,
      };
    }

    const startup = launchReport.startup;
    if (launchReport.status === 'attached') {
      await cleanupManagedRuntimeStartup({
        child,
        reportDir,
        stopTimeoutMs: args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
      });
      const attachedStartup = await requireAttachableRuntimeReadiness({
        executablePath: args.executablePath,
        stateRoot,
        env: mergedEnv,
        probeTimeoutMs: runtimeAttachTimeoutMs,
        logs: recentLogs,
        unavailableMessage: 'Start Runtime did not complete because the attached runtime is no longer online.',
        requireOpenable: false,
      });
      const attachPolicy = managedRuntimeAttachPolicy(attachedStartup, {
        desktopOwnerID: args.desktopOwnerID,
        forceRuntimeUpdate: args.forceRuntimeUpdate,
      });
      if (attachPolicy.action === 'block') {
        throw readinessFailure(attachPolicy.message, recentLogs);
      }
      if (attachPolicy.action === 'replace') {
        await (inventoryStop ?? attachedStop(attachedStartup, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS))();
        return startManagedRuntime(args);
      }
      if (!runtimeServiceAllowsOpenAttempt(attachedStartup.runtime_service)) {
        assertRuntimeOpenable(attachedStartup, recentLogs);
      }
      await verifyManagedLocalRuntimeProcessIdentity({
        executablePath: args.executablePath,
        stateRoot,
        desktopOwnerID,
        env: mergedEnv,
        startup: attachedStartup,
        runtimeProcessIntent,
        beforeInventory: observedInventory,
        timeoutMs: runtimeAttachTimeoutMs,
      });
      emitManagedRuntimeProgress(
        args.onProgress,
        'runtime_ready',
        'Runtime ready',
        'The local runtime is ready to open.',
      );
      return {
        kind: 'ready',
        managedRuntime: {
          child: null,
          startup: attachedStartup,
          reportDir: null,
          reportFile: null,
          attached: true,
          stop: inventoryStop ?? attachedStop(attachedStartup, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS),
        },
        spawned: true,
      };
    }

    if (spawnError || child.exitCode !== null || child.signalCode) {
      const attachedStartup = await loadManagedRuntimeStartupFromStatus({
        executablePath: args.executablePath,
        stateRoot,
        env: mergedEnv,
        timeoutMs: runtimeAttachTimeoutMs,
      });
      if (!attachedStartup) {
        throw readinessFailure(
          'Start Runtime did not complete because the runtime process exited before Desktop could attach.',
          recentLogs,
        );
      }
      await cleanupManagedRuntimeStartup({
        child,
        reportDir,
        stopTimeoutMs: args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
      });
      assertRuntimePIDAlive(attachedStartup, recentLogs);
      const attachPolicy = managedRuntimeAttachPolicy(attachedStartup, {
        desktopOwnerID: args.desktopOwnerID,
        forceRuntimeUpdate: args.forceRuntimeUpdate,
      });
      if (attachPolicy.action === 'block') {
        throw readinessFailure(attachPolicy.message, recentLogs);
      }
      if (attachPolicy.action === 'replace') {
        await (inventoryStop ?? attachedStop(attachedStartup, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS))();
        return startManagedRuntime(args);
      }
      if (!runtimeServiceAllowsOpenAttempt(attachedStartup.runtime_service)) {
        assertRuntimeOpenable(attachedStartup, recentLogs);
      }
      await verifyManagedLocalRuntimeProcessIdentity({
        executablePath: args.executablePath,
        stateRoot,
        desktopOwnerID,
        env: mergedEnv,
        startup: attachedStartup,
        runtimeProcessIntent,
        beforeInventory: observedInventory,
        timeoutMs: runtimeAttachTimeoutMs,
      });
      emitManagedRuntimeProgress(
        args.onProgress,
        'runtime_ready',
        'Runtime ready',
        'The local runtime is ready to open.',
      );
      return {
        kind: 'ready',
        managedRuntime: {
          child: null,
          startup: attachedStartup,
          reportDir: null,
          reportFile: null,
          attached: true,
          stop: inventoryStop ?? attachedStop(attachedStartup, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS),
        },
        spawned: true,
      };
    }

    const stableStartup = await waitForStableRuntimeReadiness({
      startup,
      executablePath: args.executablePath,
      stateRoot,
      env: mergedEnv,
      probeTimeoutMs: runtimeAttachTimeoutMs,
      openTimeoutMs: args.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      stabilityWindowMs: runtimeStabilityWindowMs,
      pollIntervalMs: runtimeStabilityPollMs,
      child,
      logs: recentLogs,
      getSpawnError: () => spawnError,
      signal: args.signal,
    });
    await verifyManagedLocalRuntimeProcessIdentity({
      executablePath: args.executablePath,
      stateRoot,
      desktopOwnerID,
      env: mergedEnv,
      startup: stableStartup,
      runtimeProcessIntent,
      beforeInventory: observedInventory,
      timeoutMs: runtimeAttachTimeoutMs,
    });
    emitManagedRuntimeProgress(
      args.onProgress,
      'runtime_ready',
      'Runtime ready',
      'The local runtime is ready to open.',
    );
    return {
      kind: 'ready',
      managedRuntime: {
        child,
        startup: stableStartup,
        reportDir,
        reportFile,
        attached: false,
        stop: () => cleanupManagedRuntimeStartup({
          child,
          reportDir,
          stopTimeoutMs: args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
          reconcileInventory: inventoryStop,
        }),
      },
      spawned: true,
    };
  } catch (error) {
    if (error instanceof ManagedRuntimeStartupCleanupError) {
      throw error;
    }
    await cleanupManagedRuntimeStartup({
      child,
      reportDir,
      stopTimeoutMs: args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
      reconcileInventory: inventoryStop,
      cause: error,
    });
    throw error;
  }
}

export async function attachManagedRuntimeFromStatus(args: Readonly<{
  executablePath: string;
  stateRoot?: string;
  env?: NodeJS.ProcessEnv;
  runtimeAttachTimeoutMs?: number;
  stopTimeoutMs?: number;
  desktopOwnerID?: string;
}>): Promise<ManagedRuntime | null> {
  const env = sanitizeDesktopChildEnvironment({
    ...process.env,
    ...args.env,
  });
  const stateRoot = String(args.stateRoot ?? '').trim();
  const desktopOwnerID = String(args.desktopOwnerID ?? '').trim();
  const inventoryStop = stateRoot && desktopOwnerID
    ? localManagedRuntimeStop({
        executablePath: args.executablePath,
        stateRoot,
        desktopOwnerID,
        env,
        timeoutMs: args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
      })
    : null;
  const inventory = stateRoot && desktopOwnerID
    ? await inspectLocalManagedRuntimeProcesses({
        executablePath: args.executablePath,
        stateRoot,
        desktopOwnerID,
        env,
        timeoutMs: args.runtimeAttachTimeoutMs ?? DEFAULT_RUNTIME_ATTACH_TIMEOUT_MS,
      })
    : null;
  if (inventory) {
    requireDesktopRuntimeProcessReconciliation(inventory);
  }
  const startup = await loadManagedRuntimeStartupFromStatus({
    executablePath: args.executablePath,
    stateRoot: args.stateRoot,
    env,
    timeoutMs: args.runtimeAttachTimeoutMs ?? DEFAULT_RUNTIME_ATTACH_TIMEOUT_MS,
  });
  if (!startup) {
    if (inventory && inventory.instances.length > 0) {
      throw new Error('Desktop found a live local runtime process, but its Runtime Service status is unavailable.');
    }
    return null;
  }
  return {
    child: null,
    startup,
    reportDir: null,
    reportFile: null,
    attached: true,
    stop: inventoryStop ?? attachedStop(startup, args.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS),
  };
}
