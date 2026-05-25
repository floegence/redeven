import {
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import {
  buildDesktopRuntimeMaintenanceRequirement,
  classifyDesktopRuntimeBlockedLaunchReport,
  desktopRuntimeMaintenanceIsLiveManagementSocketUnreachable,
  type DesktopRuntimeMaintenanceRequirement,
} from '../shared/desktopRuntimeHealth';
import {
  containerInspectCommand,
  containerRuntimeCommandFailureStatus,
  containerRuntimeDaemonStartCommand,
  containerRuntimeDaemonStatusCommand,
  containerRuntimePlatformProbeCommand,
  containerRuntimeProbeCommand,
  containerRuntimeUnavailableMessage,
  containerRuntimeUploadedInstallCommand,
  parseContainerInspectJSON,
  parseContainerPlatformProbeOutput,
} from './containerRuntime';
import { parseLaunchReport } from './launchReport';
import { type StartupReport } from './startup';
import {
  createLocalRuntimeHostExecutor,
  createSSHRuntimeHostExecutor,
  type RuntimeHostAccessExecutor,
} from './runtimeHostAccess';
import {
  describeManagedSSHRuntimeProbeResult,
  parseManagedSSHRuntimeProbeResult,
  type DesktopSSHRemoteRuntimeProbeResult,
} from './sshRuntime';
import {
  prepareDesktopRuntimeUploadAsset,
  runtimeReleaseFetchPolicy,
} from './runtimePackageCache';

export type RuntimePlacementProgressPhase =
  | 'checking_host'
  | 'checking_container'
  | 'detecting_platform'
  | 'checking_runtime'
  | 'preparing_runtime_package'
  | 'installing_runtime'
  | 'starting_runtime_daemon'
  | 'waiting_runtime_daemon'
  | 'runtime_ready';

export type RuntimePlacementProgress = Readonly<{
  phase: RuntimePlacementProgressPhase;
  title: string;
  detail: string;
}>;

export type ReadyRuntimePlacement = Readonly<{
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  runtime_binary_path: string;
  probe: DesktopSSHRemoteRuntimeProbeResult;
  startup?: StartupReport;
}>;

export class RuntimePlacementMaintenanceRequiredError extends Error {
  readonly maintenance: DesktopRuntimeMaintenanceRequirement;

  constructor(message: string, maintenance: DesktopRuntimeMaintenanceRequirement) {
    super(message);
    this.name = 'RuntimePlacementMaintenanceRequiredError';
    this.maintenance = maintenance;
  }
}

export class RuntimePlacementReadinessTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimePlacementReadinessTimeoutError';
  }
}

export type EnsureRuntimePlacementReadyArgs = Readonly<{
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  ssh_password?: string;
  runtime_release_tag: string;
  release_base_url: string;
  source_runtime_root?: string;
  asset_cache_root: string;
  force_runtime_update?: boolean;
  timeout_ms?: number;
  desktop_owner_id?: string;
  signal?: AbortSignal;
  on_progress?: (progress: RuntimePlacementProgress) => void;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeRuntimeReleaseTag(raw: string): string {
  const clean = compact(raw);
  if (clean === '') {
    throw new Error('Desktop could not resolve the runtime release tag for placement bootstrap.');
  }
  return clean.startsWith('v') ? clean : `v${clean}`;
}

function emitProgress(
  callback: EnsureRuntimePlacementReadyArgs['on_progress'],
  phase: RuntimePlacementProgressPhase,
  title: string,
  detail: string,
): void {
  callback?.({
    phase,
    title,
    detail,
  });
}

function runtimeHostExecutor(hostAccess: DesktopRuntimeHostAccess, sshPassword?: string): RuntimeHostAccessExecutor {
  return hostAccess.kind === 'ssh_host'
    ? createSSHRuntimeHostExecutor(hostAccess.ssh, { sshPassword })
    : createLocalRuntimeHostExecutor();
}

async function waitForContainerRuntimeDaemon(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>;
  runtime_binary_path: string;
  timeout_ms: number;
  runtime_release_tag: string;
  signal?: AbortSignal;
}>): Promise<StartupReport> {
  const deadline = Date.now() + Math.max(1_000, args.timeout_ms);
  let lastError: Error | null = null;
  for (;;) {
    let report: ReturnType<typeof parseLaunchReport> | null = null;
    try {
      const result = await args.executor.run(containerRuntimeDaemonStatusCommand({
        engine: args.placement.container_engine,
        container_id: args.placement.container_id,
        runtime_root: args.placement.runtime_root,
        runtime_binary_path: args.runtime_binary_path,
      }), { signal: args.signal });
      report = parseLaunchReport(result.stdout);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (report?.status !== 'blocked') {
      if (report) {
        return report.startup;
      }
    } else {
      lastError = new Error(report.message);
      const classification = classifyDesktopRuntimeBlockedLaunchReport(report, {
        target_runtime_version: args.runtime_release_tag,
      });
      if (
        classification.kind === 'restart_required'
        && desktopRuntimeMaintenanceIsLiveManagementSocketUnreachable(classification.maintenance)
      ) {
        lastError = new Error(classification.maintenance.message);
      } else if (classification.kind === 'restart_required' || classification.kind === 'update_required') {
        throw new RuntimePlacementMaintenanceRequiredError(
          classification.maintenance.message,
          classification.maintenance,
        );
      }
      if (classification.kind === 'unverified') {
        throw new Error(classification.message);
      }
    }
    if (Date.now() >= deadline) {
      throw new RuntimePlacementReadinessTimeoutError(
        `Runtime daemon did not become ready before timeout.${lastError ? ` ${lastError.message}` : ''}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function startContainerRuntimeDaemon(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>;
  runtime_binary_path: string;
  desktop_owner_id: string;
  signal?: AbortSignal;
}>): Promise<void> {
  await args.executor.run(containerRuntimeDaemonStartCommand({
    engine: args.placement.container_engine,
    container_id: args.placement.container_id,
    runtime_root: args.placement.runtime_root,
    runtime_binary_path: args.runtime_binary_path,
    desktop_owner_id: compact(args.desktop_owner_id),
  }), { signal: args.signal });
}

async function assertContainerRunning(
  executor: RuntimeHostAccessExecutor,
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>,
  signal?: AbortSignal,
): Promise<void> {
  let inspected: ReturnType<typeof parseContainerInspectJSON>;
  try {
    const result = await executor.run(containerInspectCommand(
      placement.container_engine,
      placement.container_id,
    ), { signal });
    inspected = parseContainerInspectJSON(placement.container_engine, result.stdout);
  } catch (error) {
    const status = containerRuntimeCommandFailureStatus(error);
    throw new Error(containerRuntimeUnavailableMessage(placement, status));
  }
  if (inspected.status !== 'running') {
    throw new Error(containerRuntimeUnavailableMessage(placement, inspected.status));
  }
}

async function probeContainerRuntime(
  executor: RuntimeHostAccessExecutor,
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>,
  runtimeReleaseTag: string,
  signal?: AbortSignal,
): Promise<DesktopSSHRemoteRuntimeProbeResult> {
  const result = await executor.run(containerRuntimeProbeCommand({
    engine: placement.container_engine,
    container_id: placement.container_id,
    runtime_root: placement.runtime_root,
    runtime_release_tag: runtimeReleaseTag,
  }), { signal });
  return parseManagedSSHRuntimeProbeResult(result.stdout);
}

export async function ensureRuntimePlacementReady(
  args: EnsureRuntimePlacementReadyArgs,
): Promise<ReadyRuntimePlacement> {
  const runtimeReleaseTag = normalizeRuntimeReleaseTag(args.runtime_release_tag);
  if (args.placement.kind !== 'container_process') {
    return {
      host_access: args.host_access,
      placement: args.placement,
      runtime_binary_path: 'redeven',
      probe: {
        status: 'ready',
        expected_release_tag: runtimeReleaseTag,
        reported_release_tag: runtimeReleaseTag,
        binary_path: 'redeven',
        stamp_path: '',
        reason: 'host-process runtime bootstrap is handled by the existing host runtime launcher',
      },
    };
  }
  const placement = args.placement;

  const executor = runtimeHostExecutor(args.host_access, args.ssh_password);
  emitProgress(
    args.on_progress,
    args.host_access.kind === 'ssh_host' ? 'checking_host' : 'checking_container',
    args.host_access.kind === 'ssh_host' ? 'Checking SSH host' : 'Checking container',
    args.host_access.kind === 'ssh_host'
      ? 'Desktop is checking the SSH host and selected running container.'
      : 'Desktop is checking the selected running container.',
  );
  await assertContainerRunning(executor, placement, args.signal);
  if (args.host_access.kind === 'ssh_host') {
    emitProgress(
      args.on_progress,
      'checking_container',
      'Checking container',
      'Desktop is checking the selected running container through the SSH host.',
    );
  }

  emitProgress(
    args.on_progress,
    'detecting_platform',
    'Detecting runtime platform',
    'Desktop is checking the container OS and CPU architecture before choosing a runtime package.',
  );
  const platformResult = await executor.run(containerRuntimePlatformProbeCommand({
    engine: placement.container_engine,
    container_id: placement.container_id,
  }), { signal: args.signal });
  const platform = parseContainerPlatformProbeOutput(platformResult.stdout);

  emitProgress(
    args.on_progress,
    'checking_runtime',
    'Checking container runtime',
    `Desktop is checking for a compatible Redeven ${runtimeReleaseTag} runtime inside the container.`,
  );
  let probe = await probeContainerRuntime(executor, placement, runtimeReleaseTag, args.signal);
  const sourceRuntimeRoot = compact(args.source_runtime_root);
  const shouldReplaceRuntimePackage = args.force_runtime_update === true;
  const shouldInstallRuntime = probe.status === 'missing_binary' || shouldReplaceRuntimePackage;
  if (
    probe.status !== 'ready'
    && probe.status !== 'missing_binary'
    && !shouldReplaceRuntimePackage
  ) {
    const maintenance = buildDesktopRuntimeMaintenanceRequirement({
      kind: 'runtime_update_required',
      required_for: 'open',
      recovery_action: 'update_runtime',
      can_desktop_start: false,
      can_desktop_restart: true,
      has_active_work: false,
      active_work_label: 'No active work',
      current_runtime_version: probe.reported_release_tag ?? undefined,
      target_runtime_version: probe.expected_release_tag,
      message: 'Update this container runtime before starting it with the bundled runtime.',
    });
    throw new RuntimePlacementMaintenanceRequiredError(maintenance.message, maintenance);
  }
  if (shouldInstallRuntime) {
    emitProgress(
      args.on_progress,
      'preparing_runtime_package',
      'Preparing runtime package',
      `Desktop is preparing the ${platform.platform_label} Redeven ${runtimeReleaseTag} package for this container.`,
    );
    const asset = await prepareDesktopRuntimeUploadAsset({
      runtimeReleaseTag,
      releaseBaseURL: args.release_base_url,
      assetCacheRoot: args.asset_cache_root,
      sourceRuntimeRoot,
      platform,
      fetchPolicy: runtimeReleaseFetchPolicy(args.timeout_ms ?? 45_000, args.signal),
      signal: args.signal,
    });
    emitProgress(
      args.on_progress,
      'installing_runtime',
      'Installing runtime in container',
      `Desktop is installing Redeven ${runtimeReleaseTag} inside the running container.`,
    );
    await executor.run(containerRuntimeUploadedInstallCommand({
      engine: placement.container_engine,
      container_id: placement.container_id,
      runtime_root: placement.runtime_root,
      runtime_release_tag: runtimeReleaseTag,
    }), {
      stdinData: asset.archiveData,
      signal: args.signal,
    });
    probe = await probeContainerRuntime(executor, placement, runtimeReleaseTag, args.signal);
  }
  if (probe.status !== 'ready') {
    throw new Error(describeManagedSSHRuntimeProbeResult(probe));
  }
  emitProgress(
    args.on_progress,
    'starting_runtime_daemon',
    'Starting runtime daemon',
    'Desktop is starting the long-running Redeven runtime daemon inside the selected container.',
  );
  await startContainerRuntimeDaemon({
    executor,
    placement,
    runtime_binary_path: probe.binary_path,
    desktop_owner_id: compact(args.desktop_owner_id),
    signal: args.signal,
  });
  emitProgress(
    args.on_progress,
    'waiting_runtime_daemon',
    'Waiting for runtime daemon',
    'Desktop is waiting for the runtime daemon health check before enabling Open.',
  );
  const startup = await waitForContainerRuntimeDaemon({
    executor,
    placement,
    runtime_binary_path: probe.binary_path,
    timeout_ms: args.timeout_ms ?? 45_000,
    runtime_release_tag: runtimeReleaseTag,
    signal: args.signal,
  });
  emitProgress(
    args.on_progress,
    'runtime_ready',
    'Runtime daemon ready',
    'The runtime daemon is running. Open will connect Desktop to it.',
  );
  return {
    host_access: args.host_access,
    placement,
    runtime_binary_path: probe.binary_path,
    probe,
    startup,
  };
}
