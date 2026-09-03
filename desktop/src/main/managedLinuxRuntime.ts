import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';

import {
  parseDesktopRuntimeProcessInventory,
  parseDesktopRuntimeProcessStopResult,
  requireDesktopRuntimeProcessIdentity,
  desktopRuntimeProcessInventoryHasSingleCurrent,
  type DesktopRuntimeProcessInventory,
  type DesktopRuntimeProcessStopResult,
} from './runtimeProcessInventory';
import { parseAvailableLaunchReport } from './launchReport';
import { desktopOperationFailureFromBlockedLaunchReport } from './runtimeBlockedLaunchFailure';
import { classifyDesktopRuntimeBlockedLaunchReport } from '../shared/desktopRuntimeHealth';
import {
  buildManagedSSHActivatePreparedRuntimeScript,
  buildManagedSSHReportReadScript,
  buildManagedSSHRuntimeProbeScript,
  buildManagedSSHRuntimeProcessCommandScript,
  buildManagedSSHRuntimeStatusScript,
  buildManagedSSHStartScript,
  buildManagedSSHUploadedInstallScript,
  describeManagedSSHRuntimeProbeResult,
  parseManagedSSHRuntimeProbeResult,
  type DesktopSSHRemoteRuntimeProbeResult,
  type DesktopSSHRuntimeStatusProbe,
} from './sshRuntime';
import { prepareDesktopRuntimeUploadAsset } from './runtimePackageCache';
import { resolveDesktopSSHRemotePlatform } from './sshReleaseAssets';
import type { RuntimeHostAccessExecutor } from './runtimeHostAccess';
import type { RuntimePlacementProgress } from './runtimePlacementManager';
import type { StartupReport } from './startup';

const DEFAULT_MANAGED_LINUX_START_TIMEOUT_MS = 45_000;
const DEFAULT_MANAGED_LINUX_POLL_INTERVAL_MS = 200;

export type ManagedLinuxRuntimeProcessSession = Readonly<{
  inspect: () => Promise<DesktopRuntimeProcessInventory>;
  stop: (
    inventory: DesktopRuntimeProcessInventory,
    gracePeriodSeconds?: number,
  ) => Promise<DesktopRuntimeProcessStopResult>;
}>;

export type EnsureManagedLinuxRuntimeArgs = Readonly<{
  executor: RuntimeHostAccessExecutor;
  runtime_root: string;
  runtime_state_root: string;
  runtime_release_tag: string;
  release_base_url: string;
  asset_cache_root: string;
  source_runtime_root?: string;
  managed_runtime_archive_path?: string;
  runtime_process_intent: 'start' | 'restart' | 'update';
  signal?: AbortSignal;
  timeout_ms?: number;
  before_runtime_replacement?: () => Promise<void>;
  on_progress?: (progress: RuntimePlacementProgress) => void;
}>;

export type ManagedLinuxRuntimeReady = Readonly<{
  runtime_binary_path: string;
  probe: DesktopSSHRemoteRuntimeProbeResult;
  startup: StartupReport;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeReleaseTag(value: string): string {
  const tag = compact(value);
  if (tag === '') throw new Error('Managed Linux Runtime release tag is required.');
  return tag.startsWith('v') ? tag : `v${tag}`;
}

function shellCommand(script: string, marker: string, args: readonly string[] = []): readonly string[] {
  return ['sh', '-c', script, marker, ...args];
}

function emit(
  callback: EnsureManagedLinuxRuntimeArgs['on_progress'],
  phase: RuntimePlacementProgress['phase'],
  title: string,
  detail: string,
): void {
  callback?.({ phase, title, detail });
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Managed Linux Runtime operation was canceled.', 'AbortError');
  }
}

function delay(delayMS: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMS);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException('Managed Linux Runtime operation was canceled.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function probeManagedLinuxRuntime(
  executor: RuntimeHostAccessExecutor,
  runtimeRoot: string,
  runtimeReleaseTag: string,
  signal?: AbortSignal,
): Promise<DesktopSSHRemoteRuntimeProbeResult> {
  const result = await executor.run(shellCommand(
    buildManagedSSHRuntimeProbeScript(),
    'redeven-managed-linux-runtime-probe',
    [runtimeRoot, normalizeReleaseTag(runtimeReleaseTag)],
  ), { signal });
  return parseManagedSSHRuntimeProbeResult(result.stdout);
}

export async function probeManagedLinuxRuntimeStatus(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  runtime_root: string;
  runtime_state_root: string;
  runtime_release_tag: string;
  signal?: AbortSignal;
}>): Promise<DesktopSSHRuntimeStatusProbe> {
  try {
    const probe = await probeManagedLinuxRuntime(
      args.executor,
      args.runtime_root,
      args.runtime_release_tag,
      args.signal,
    );
    if (probe.status !== 'ready') {
      return {
        status: 'not_running',
        message: probe.status === 'missing_binary'
          ? 'Redeven Runtime is not installed in this managed Linux Environment.'
          : describeManagedSSHRuntimeProbeResult(probe),
      };
    }
    const result = await args.executor.run(shellCommand(
      buildManagedSSHRuntimeStatusScript(),
      'redeven-managed-linux-runtime-status',
      [args.runtime_root, args.runtime_state_root, normalizeReleaseTag(args.runtime_release_tag)],
    ), { signal: args.signal });
    const report = parseAvailableLaunchReport(result.stdout);
    if (!report) {
      return { status: 'not_running', message: 'Redeven Runtime is not running in this managed Linux Environment.' };
    }
    return report.status === 'blocked'
      ? { status: 'blocked', report }
      : { status: 'ready', startup: report.startup };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      failure: {
        code: 'runtime_host_command_failed',
        severity: 'error',
        title: 'Managed Linux Runtime Status Unavailable',
        summary: 'Desktop could not verify the managed Linux Runtime status.',
        detail: error instanceof Error ? error.message : String(error),
        diagnostics: [],
      },
    };
  }
}

export function openManagedLinuxRuntimeProcessSession(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  runtime_root: string;
  runtime_state_root: string;
  signal?: AbortSignal;
}>): ManagedLinuxRuntimeProcessSession {
  const run = async (
    operation: 'inventory' | 'stop',
    inventoryDigest = '',
    gracePeriodSeconds = 5,
  ): Promise<string> => {
    const result = await args.executor.run(shellCommand(
      buildManagedSSHRuntimeProcessCommandScript(),
      'redeven-managed-linux-runtime-process',
      [
        args.runtime_root,
        args.runtime_state_root,
        'managed',
        operation,
        inventoryDigest,
        `${Math.max(1, Math.ceil(gracePeriodSeconds))}s`,
      ],
    ), { signal: args.signal });
    return result.stdout;
  };
  return {
    inspect: async () => parseDesktopRuntimeProcessInventory(await run('inventory')),
    stop: async (inventory, gracePeriodSeconds = 5) => {
      const stopped = parseDesktopRuntimeProcessStopResult(
        await run('stop', inventory.inventory_digest, gracePeriodSeconds),
      );
      if (stopped.after.instances.length > 0) {
        throw new Error('Desktop could not verify an empty managed Linux Runtime process inventory.');
      }
      return stopped;
    },
  };
}

async function installUploadedRuntime(args: EnsureManagedLinuxRuntimeArgs): Promise<DesktopSSHRemoteRuntimeProbeResult> {
  const platform = resolveDesktopSSHRemotePlatform('linux', 'x86_64');
  emit(
    args.on_progress,
    'preparing_runtime_package',
    'Preparing Linux Runtime package',
    `Desktop is preparing the verified ${platform.platform_label} ${normalizeReleaseTag(args.runtime_release_tag)} Runtime package.`,
  );
  const managedArchivePath = compact(args.managed_runtime_archive_path);
  const archiveData = managedArchivePath !== ''
    ? await fs.readFile(managedArchivePath)
    : (await prepareDesktopRuntimeUploadAsset({
        runtimeReleaseTag: args.runtime_release_tag,
        releaseBaseURL: args.release_base_url,
        assetCacheRoot: args.asset_cache_root,
        sourceRuntimeRoot: args.source_runtime_root,
        platform,
        fetchPolicy: {
          timeout_ms: Math.max(1_000, args.timeout_ms ?? DEFAULT_MANAGED_LINUX_START_TIMEOUT_MS),
          signal: args.signal,
        },
        signal: args.signal,
      })).archiveData;
  if (archiveData.length === 0) {
    throw new Error('Managed Linux Runtime archive is empty.');
  }
  emit(
    args.on_progress,
    'runtime_package_ready',
    'Linux Runtime package ready',
    'Desktop verified the Linux Runtime archive before transferring it to the managed host.',
  );
  const tempResult = await args.executor.run(shellCommand(
    'set -eu\numask 077\nmktemp -d "${TMPDIR:-/tmp}/redeven-desktop-upload.XXXXXX"',
    'redeven-managed-linux-create-upload-dir',
  ), { signal: args.signal });
  const uploadRoot = compact(tempResult.stdout);
  if (uploadRoot === '') throw new Error('Managed Linux host returned an empty upload directory.');
  const archivePath = `${uploadRoot}/redeven_linux_amd64.tar.gz`;
  let stagingRoot = '';
  try {
    await args.executor.run(shellCommand(
      'set -eu\ncat > "$1"',
      'redeven-managed-linux-upload',
      [archivePath],
    ), {
      stdinData: archiveData,
      signal: args.signal,
      timeout_ms: 10 * 60_000,
    });
    emit(
      args.on_progress,
      'installing_runtime',
      'Installing Linux Runtime',
      'The managed Linux host is unpacking and validating the uploaded Runtime package.',
    );
    const install = await args.executor.run(shellCommand(
      buildManagedSSHUploadedInstallScript(),
      'redeven-managed-linux-install',
      [args.runtime_root, normalizeReleaseTag(args.runtime_release_tag), archivePath, uploadRoot],
    ), { signal: args.signal, timeout_ms: 10 * 60_000 });
    stagingRoot = install.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
    if (!stagingRoot.includes('.staging.')) {
      throw new Error('Managed Linux Runtime installation did not return a valid staging path.');
    }
    await args.executor.run(shellCommand(
      buildManagedSSHActivatePreparedRuntimeScript(),
      'redeven-managed-linux-activate',
      [args.runtime_root, normalizeReleaseTag(args.runtime_release_tag), stagingRoot],
    ), { signal: args.signal });
    stagingRoot = '';
  } finally {
    await args.executor.run(shellCommand(
      'set -eu\nrm -rf "$1" "$2"',
      'redeven-managed-linux-cleanup',
      [uploadRoot, stagingRoot],
    ), { signal: args.signal }).catch(() => undefined);
  }
  const probe = await probeManagedLinuxRuntime(
    args.executor,
    args.runtime_root,
    args.runtime_release_tag,
    args.signal,
  );
  if (probe.status !== 'ready') {
    throw new Error(describeManagedSSHRuntimeProbeResult(probe));
  }
  return probe;
}

async function waitForStartupReport(args: EnsureManagedLinuxRuntimeArgs, sessionToken: string): Promise<StartupReport> {
  const deadline = Date.now() + Math.max(1_000, args.timeout_ms ?? DEFAULT_MANAGED_LINUX_START_TIMEOUT_MS);
  for (;;) {
    abortIfNeeded(args.signal);
    const report = await args.executor.run(shellCommand(
      buildManagedSSHReportReadScript(),
      'redeven-managed-linux-read-report',
      [args.runtime_root, args.runtime_state_root, sessionToken],
    ), { signal: args.signal });
    const launch = parseAvailableLaunchReport(report.stdout);
    if (launch?.status === 'blocked') {
      const classification = classifyDesktopRuntimeBlockedLaunchReport(launch, {
        target_runtime_version: args.runtime_release_tag,
      });
      const failure = desktopOperationFailureFromBlockedLaunchReport({
        report: launch,
        classification,
        targetLabel: args.runtime_root,
      });
      if (failure) {
        throw failure;
      }
      throw new Error(`Managed Linux Runtime startup was blocked (${launch.code}): ${launch.message}`);
    }
    if (launch) return launch.startup;
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the managed Linux Runtime startup report.');
    }
    await delay(DEFAULT_MANAGED_LINUX_POLL_INTERVAL_MS, args.signal);
  }
}

export async function ensureManagedLinuxRuntimeReady(
  args: EnsureManagedLinuxRuntimeArgs,
): Promise<ManagedLinuxRuntimeReady> {
  abortIfNeeded(args.signal);
  emit(args.on_progress, 'checking_host', 'Checking managed Linux host', 'Desktop is checking the selected Linux host and managed Runtime slot.');
  let probe = await probeManagedLinuxRuntime(
    args.executor,
    args.runtime_root,
    args.runtime_release_tag,
    args.signal,
  );
  if (args.runtime_process_intent !== 'start') {
    await args.before_runtime_replacement?.();
  }
  if (probe.status !== 'ready' || args.runtime_process_intent === 'update') {
    probe = await installUploadedRuntime(args);
  }
  const processSession = openManagedLinuxRuntimeProcessSession({
    executor: args.executor,
    runtime_root: args.runtime_root,
    runtime_state_root: args.runtime_state_root,
    signal: args.signal,
  });
  emit(args.on_progress, 'discovering_runtime_instances', 'Discovering Runtime processes', 'Desktop is verifying exact managed Runtime process identities.');
  const before = await processSession.inspect();
  requireDesktopRuntimeProcessIdentity(before);
  if (args.runtime_process_intent === 'start' && desktopRuntimeProcessInventoryHasSingleCurrent(before)) {
    const status = await probeManagedLinuxRuntimeStatus({
      executor: args.executor,
      runtime_root: args.runtime_root,
      runtime_state_root: args.runtime_state_root,
      runtime_release_tag: args.runtime_release_tag,
      signal: args.signal,
    });
    const instance = before.instances[0];
    if (status.status !== 'ready') {
      if (status.status === 'blocked') {
        const failure = desktopOperationFailureFromBlockedLaunchReport({
          report: status.report,
          targetLabel: args.runtime_root,
          targetRuntimeVersion: args.runtime_release_tag,
        });
        if (failure) {
          throw failure;
        }
      }
      throw new Error(
        (status.status === 'blocked' ? status.report.message : status.message)
        || 'Desktop could not attach to the verified managed Linux Runtime process.',
      );
    }
    if (!instance || (status.startup.pid && status.startup.pid !== instance.pid)) {
      throw new Error('Desktop could not match the managed Linux Runtime status to the verified process identity.');
    }
    emit(args.on_progress, 'runtime_ready', 'Runtime ready', 'Desktop attached to the verified managed Linux Runtime for the private Desktop Bridge.');
    return {
      runtime_binary_path: probe.binary_path,
      probe,
      startup: status.startup,
    };
  }
  if (args.runtime_process_intent !== 'start') {
    if (before.instances.length > 0) {
      emit(args.on_progress, 'stopping_runtime_process', 'Stopping Runtime processes', 'Desktop is stopping only the verified Runtime processes for this managed Linux target.');
      await processSession.stop(before);
      emit(args.on_progress, 'verifying_runtime_stopped', 'Verifying Runtime stopped', 'Desktop verified that the previous managed Runtime process is no longer running.');
    }
  } else if (before.instances.length > 0 || before.summary.blocked > 0) {
    throw new Error('Managed Linux Runtime has an ambiguous process inventory; use Restart Runtime before opening it.');
  }
  const sessionToken = randomBytes(8).toString('hex');
  emit(args.on_progress, 'starting_runtime_daemon', 'Starting Runtime', 'Desktop is starting the managed Linux Runtime without requiring systemd.');
  await args.executor.run(shellCommand(
    buildManagedSSHStartScript(),
    'redeven-managed-linux-start',
    [args.runtime_root, args.runtime_state_root, normalizeReleaseTag(args.runtime_release_tag), sessionToken],
  ), { signal: args.signal });
  emit(args.on_progress, 'waiting_runtime_daemon', 'Waiting for Runtime', 'Desktop is waiting for the Runtime startup report.');
  const startup = await waitForStartupReport(args, sessionToken);
  emit(args.on_progress, 'verifying_runtime_inventory', 'Verifying Runtime process', 'Desktop is checking the final Runtime process identity.');
  const after = await processSession.inspect();
  const instance = after.instances[0];
  if (
    !desktopRuntimeProcessInventoryHasSingleCurrent(after)
    || after.instances.length !== 1
    || !instance
    || (startup.pid && instance.pid !== startup.pid)
  ) {
    throw new Error('Desktop could not verify one current managed Linux Runtime process after startup.');
  }
  emit(args.on_progress, 'runtime_ready', 'Runtime ready', 'The managed Linux Runtime is ready for the private Desktop Bridge.');
  return {
    runtime_binary_path: probe.binary_path,
    probe,
    startup,
  };
}
