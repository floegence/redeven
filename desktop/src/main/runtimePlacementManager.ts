import {
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
  desktopRuntimePlacementStateRoot,
} from '../shared/desktopRuntimePlacement';
import {
  buildDesktopRuntimeMaintenanceRequirement,
  classifyDesktopRuntimeBlockedLaunchReport,
  desktopRuntimeMaintenanceIsLiveManagementSocketUnreachable,
  type DesktopRuntimeMaintenanceRequirement,
} from '../shared/desktopRuntimeHealth';
import {
  containerInspectCommand,
  CONTAINER_RUNTIME_PROCESS_COMMAND_EXIT_MARKER,
  containerRuntimeCommandFailureStatus,
  containerRuntimeDaemonStartCommand,
  containerRuntimeDaemonStatusCommand,
  containerRuntimePlatformProbeCommand,
  containerRuntimeProcessHelperCommand,
  containerRuntimeProbeCommand,
  containerRuntimeUnavailableMessage,
  containerRuntimeUploadedInstallCommand,
  type DesktopContainerRuntimePlatform,
  parseContainerInspectJSON,
  parseContainerPlatformProbeOutput,
} from './containerRuntime';
import { parseLaunchReport } from './launchReport';
import {
  parseDesktopRuntimeProcessInventory,
  parseDesktopRuntimeProcessStopResult,
  requireDesktopRuntimeProcessReconciliation,
  desktopRuntimeProcessInventoryHasSingleCurrentOwner,
  desktopRuntimeProcessStopTargetCount,
  runtimeProcessCommandErrorFromOutput,
  type DesktopRuntimeProcessInventory,
  type DesktopRuntimeProcessStopResult,
} from './runtimeProcessInventory';
import type { DesktopRuntimeProcessReconciliation } from '../shared/desktopRuntimeProcessTakeover';
import { type StartupReport } from './startup';
import {
  createLocalRuntimeHostExecutor,
  createSSHRuntimeHostExecutor,
  type RuntimeHostAccessExecutor,
} from './runtimeHostAccess';
import type { DesktopSSHTransportManager } from './sshTransportManager';
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
  | 'discovering_runtime_instances'
  | 'stopping_runtime_process'
  | 'verifying_runtime_inventory'
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
  ssh_credential_scope?: string;
  ssh_transport_manager?: DesktopSSHTransportManager;
  runtime_release_tag: string;
  release_base_url: string;
  source_runtime_root?: string;
  asset_cache_root: string;
  force_runtime_update?: boolean;
  runtime_process_intent?: 'start' | 'restart' | 'update';
  runtime_process_reconciliation?: DesktopRuntimeProcessReconciliation;
  runtime_binary_path?: string;
  previous_runtime_pid?: number;
  require_new_daemon?: boolean;
  timeout_ms?: number;
  desktop_owner_id?: string;
  signal?: AbortSignal;
  before_runtime_replacement?: () => Promise<void>;
  on_progress?: (progress: RuntimePlacementProgress) => void;
}>;

type RuntimePackageIntent = 'use_installed' | 'install_if_missing' | 'replace_with_desktop_target';

type ContainerRuntimeProcessCommandArgs = Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>;
  runtime_binary_path: string;
  desktop_owner_id: string;
  runtime_release_tag: string;
  release_base_url: string;
  source_runtime_root?: string;
  asset_cache_root: string;
  platform?: DesktopContainerRuntimePlatform;
  runtime_process_reconciliation?: DesktopRuntimeProcessReconciliation;
  signal?: AbortSignal;
}>;

type ContainerRuntimeProcessCommandOutput = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
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

function managedContainerRuntimeBinaryPath(runtimeRoot: string): string {
  const clean = compact(runtimeRoot).replace(/\/+$/u, '');
  return `${clean || '/'}/runtime/managed/bin/redeven`.replace(/^\/\//u, '/');
}

function parseContainerRuntimeProcessCommandOutput(
  result: Readonly<{ stdout: string; stderr: string }>,
): ContainerRuntimeProcessCommandOutput {
  const lines = String(result.stdout ?? '').split(/\r?\n/u);
  const marker = lines.shift() ?? '';
  if (!marker.startsWith(CONTAINER_RUNTIME_PROCESS_COMMAND_EXIT_MARKER)) {
    throw new Error('Container runtime process helper returned an invalid command envelope.');
  }
  const exitCode = Number(marker.slice(CONTAINER_RUNTIME_PROCESS_COMMAND_EXIT_MARKER.length));
  if (!Number.isInteger(exitCode) || exitCode < 0) {
    throw new Error('Container runtime process helper returned an invalid exit code.');
  }
  return {
    exitCode,
    stdout: lines.join('\n'),
    stderr: String(result.stderr ?? ''),
  };
}

async function runContainerRuntimeProcessCommand(
  args: ContainerRuntimeProcessCommandArgs,
  operation: 'inventory' | 'stop',
  inventoryDigest = '',
  gracePeriodSeconds = 5,
): Promise<string> {
  const commandInput = {
    engine: args.placement.container_engine,
    container_id: args.placement.container_id,
    runtime_root: args.placement.runtime_root,
    runtime_state_root: desktopRuntimePlacementStateRoot(args.placement),
    runtime_binary_path: args.runtime_binary_path,
    desktop_owner_id: compact(args.desktop_owner_id),
  };
  if (!commandInput.desktop_owner_id) {
    throw new Error('Desktop owner id is required for container runtime process reconciliation.');
  }
  let platform = args.platform;
  if (!platform) {
    const platformResult = await args.executor.run(containerRuntimePlatformProbeCommand({
      engine: args.placement.container_engine,
      container_id: args.placement.container_id,
    }), { signal: args.signal });
    platform = parseContainerPlatformProbeOutput(platformResult.stdout);
  }
  const asset = await prepareDesktopRuntimeUploadAsset({
    runtimeReleaseTag: args.runtime_release_tag,
    releaseBaseURL: args.release_base_url,
    assetCacheRoot: args.asset_cache_root,
    sourceRuntimeRoot: compact(args.source_runtime_root) || undefined,
    platform,
    fetchPolicy: runtimeReleaseFetchPolicy(45_000, args.signal),
    signal: args.signal,
  });
  const helperResult = await args.executor.run(containerRuntimeProcessHelperCommand({
    ...commandInput,
    operation,
    inventory_digest: inventoryDigest,
    reconciliation_mode: args.runtime_process_reconciliation?.mode ?? 'automatic',
    grace_period_seconds: gracePeriodSeconds,
  }), {
    stdinData: asset.archiveData,
    signal: args.signal,
  });
  const helperOutput = parseContainerRuntimeProcessCommandOutput(helperResult);
  if (helperOutput.exitCode !== 0) {
    throw runtimeProcessCommandErrorFromOutput(
      helperOutput.stdout,
      helperOutput.stderr,
      `Desktop runtime process helper could not ${operation === 'inventory' ? 'inspect' : 'stop'} the container runtime processes.`,
    );
  }
  return helperOutput.stdout;
}

export async function inspectContainerRuntimeProcesses(
  args: ContainerRuntimeProcessCommandArgs,
): Promise<DesktopRuntimeProcessInventory> {
  return parseDesktopRuntimeProcessInventory(await runContainerRuntimeProcessCommand(args, 'inventory'));
}

export async function stopContainerRuntimeProcesses(
  args: ContainerRuntimeProcessCommandArgs,
  inventory: DesktopRuntimeProcessInventory,
  gracePeriodSeconds = 5,
): Promise<DesktopRuntimeProcessStopResult> {
  const result = parseDesktopRuntimeProcessStopResult(await runContainerRuntimeProcessCommand(
    { ...args, signal: undefined },
    'stop',
    inventory.inventory_digest,
    gracePeriodSeconds,
  ));
  if (result.after.instances.length > 0) {
    throw new Error('Desktop could not verify an empty container runtime process inventory.');
  }
  return result;
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

function runtimeHostExecutor(args: EnsureRuntimePlacementReadyArgs): RuntimeHostAccessExecutor {
  if (args.host_access.kind !== 'ssh_host') {
    return createLocalRuntimeHostExecutor();
  }
  if (!args.ssh_transport_manager) {
    throw new Error('SSH runtime placement requires the Desktop SSH transport manager.');
  }
  return createSSHRuntimeHostExecutor(args.ssh_transport_manager, args.host_access.ssh, {
    sshPassword: args.ssh_password,
    credentialScope: compact(args.ssh_credential_scope),
  });
}

async function waitForContainerRuntimeDaemon(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>;
  runtime_binary_path: string;
  timeout_ms: number;
  runtime_release_tag: string;
  previous_runtime_pid?: number;
  require_new_daemon?: boolean;
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
        runtime_state_root: desktopRuntimePlacementStateRoot(args.placement),
        runtime_binary_path: args.runtime_binary_path,
      }), { signal: args.signal });
      report = parseLaunchReport(result.stdout);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (report?.status !== 'blocked') {
      if (report) {
        const readyPID = Number(report.startup.pid ?? Number.NaN);
        const previousPID = Number(args.previous_runtime_pid ?? Number.NaN);
        if (args.require_new_daemon === true) {
          if (!Number.isInteger(readyPID) || readyPID <= 0) {
            lastError = new Error('Runtime daemon readiness did not include a process pid for replacement verification.');
          } else if (
            Number.isInteger(previousPID)
            && previousPID > 0
            && readyPID === previousPID
          ) {
            lastError = new Error(`Runtime daemon still reports the previous process pid ${previousPID}.`);
          } else {
            return report.startup;
          }
        } else {
          return report.startup;
        }
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
    runtime_state_root: desktopRuntimePlacementStateRoot(args.placement),
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
        slot_release_tag: runtimeReleaseTag,
        reported_release_tag: runtimeReleaseTag,
        target_release_tag: null,
        binary_path: 'redeven',
        stamp_path: '',
        reason: 'host-process runtime bootstrap is handled by the existing host runtime launcher',
      },
    };
  }
  const placement = args.placement;

  const executor = runtimeHostExecutor(args);
  try {
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

  const runtimeProcessIntent = args.runtime_process_intent
    ?? (args.force_runtime_update === true ? 'update' : 'start');
  const packageIntent: RuntimePackageIntent = runtimeProcessIntent === 'update'
    ? 'replace_with_desktop_target'
    : runtimeProcessIntent === 'restart'
      ? 'use_installed'
      : 'install_if_missing';
  let preparedRuntimeAsset: Awaited<ReturnType<typeof prepareDesktopRuntimeUploadAsset>> | null = null;
  if (packageIntent === 'replace_with_desktop_target') {
    emitProgress(
      args.on_progress,
      'preparing_runtime_package',
      'Preparing runtime package',
      `Desktop is preparing the ${platform.platform_label} Redeven ${runtimeReleaseTag} package before stopping the current container runtime.`,
    );
    preparedRuntimeAsset = await prepareDesktopRuntimeUploadAsset({
      runtimeReleaseTag,
      releaseBaseURL: args.release_base_url,
      assetCacheRoot: args.asset_cache_root,
      sourceRuntimeRoot: compact(args.source_runtime_root),
      platform,
      fetchPolicy: runtimeReleaseFetchPolicy(args.timeout_ms ?? 45_000, args.signal),
      signal: args.signal,
    });
  }

  const processCommandArgs: ContainerRuntimeProcessCommandArgs = {
    executor,
    placement,
    runtime_binary_path: compact(args.runtime_binary_path) || managedContainerRuntimeBinaryPath(placement.runtime_root),
    desktop_owner_id: compact(args.desktop_owner_id),
    runtime_release_tag: runtimeReleaseTag,
    release_base_url: args.release_base_url,
    source_runtime_root: args.source_runtime_root,
    asset_cache_root: args.asset_cache_root,
    platform,
    runtime_process_reconciliation: args.runtime_process_reconciliation,
    signal: args.signal,
  };
  emitProgress(
    args.on_progress,
    'discovering_runtime_instances',
    'Discovering runtime processes',
    'Desktop is verifying Runtime process identities inside the selected container.',
  );
  const processInventory = await inspectContainerRuntimeProcesses(processCommandArgs);
  requireDesktopRuntimeProcessReconciliation(processInventory, args.runtime_process_reconciliation);
  if (runtimeProcessIntent === 'start' && processInventory.instances.length > 0) {
    const maintenance = buildDesktopRuntimeMaintenanceRequirement({
      kind: 'runtime_restart_required',
      required_for: 'open',
      recovery_action: 'restart_runtime',
      can_desktop_start: false,
      can_desktop_restart: processInventory.summary.automatic > 0,
      has_active_work: false,
      active_work_label: 'Runtime process reconciliation required',
      target_runtime_version: runtimeReleaseTag,
      message: `Desktop found ${processInventory.instances.length} live container Runtime process(es). Restart or update this Runtime before opening it.`,
    });
    throw new RuntimePlacementMaintenanceRequiredError(maintenance.message, maintenance);
  }
  if (runtimeProcessIntent !== 'start') {
    await args.before_runtime_replacement?.();
  }
  if (runtimeProcessIntent !== 'start' && processInventory.instances.length > 0) {
    if (args.signal?.aborted) {
      throw new DOMException('Runtime process reconciliation was canceled.', 'AbortError');
    }
    emitProgress(
      args.on_progress,
      'stopping_runtime_process',
      'Stopping Runtime processes',
      `Desktop is stopping ${desktopRuntimeProcessStopTargetCount(processInventory, args.runtime_process_reconciliation)} verified Runtime process(es) inside the selected container.`,
    );
    await stopContainerRuntimeProcesses(processCommandArgs, processInventory);
    emitProgress(
      args.on_progress,
      'verifying_runtime_inventory',
      'Verifying runtime process inventory',
      'Desktop confirmed that no matching runtime process remains inside the selected container.',
    );
  }

  emitProgress(
    args.on_progress,
    'checking_runtime',
    'Checking container runtime',
    `Desktop is checking for the current Redeven ${runtimeReleaseTag} Runtime inside the container.`,
  );
  let probe = await probeContainerRuntime(executor, placement, runtimeReleaseTag, args.signal);
  const sourceRuntimeRoot = compact(args.source_runtime_root);
  const shouldReplaceRuntimePackage = packageIntent === 'replace_with_desktop_target';
  if (packageIntent === 'use_installed' && probe.status !== 'ready') {
    const maintenance = buildDesktopRuntimeMaintenanceRequirement({
      kind: 'runtime_update_required',
      required_for: 'open',
      recovery_action: 'update_runtime',
      can_desktop_start: false,
      can_desktop_restart: false,
      has_active_work: false,
      active_work_label: 'Installed runtime package unavailable',
      current_runtime_version: probe.reported_release_tag ?? undefined,
      target_runtime_version: runtimeReleaseTag,
      message: 'Update this container runtime because the installed runtime package required for a version-stable restart is unavailable.',
    });
    throw new RuntimePlacementMaintenanceRequiredError(maintenance.message, maintenance);
  }
  const shouldInstallRuntime = shouldReplaceRuntimePackage || (packageIntent === 'install_if_missing' && probe.status === 'missing_binary');
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
      target_runtime_version: probe.target_release_tag ?? runtimeReleaseTag,
      message: 'Update this container runtime before starting it with the bundled runtime.',
    });
    throw new RuntimePlacementMaintenanceRequiredError(maintenance.message, maintenance);
  }
  if (shouldInstallRuntime) {
    if (!preparedRuntimeAsset) {
      emitProgress(
        args.on_progress,
        'preparing_runtime_package',
        'Preparing runtime package',
        `Desktop is preparing the ${platform.platform_label} Redeven ${runtimeReleaseTag} package for this container.`,
      );
      preparedRuntimeAsset = await prepareDesktopRuntimeUploadAsset({
        runtimeReleaseTag,
        releaseBaseURL: args.release_base_url,
        assetCacheRoot: args.asset_cache_root,
        sourceRuntimeRoot,
        platform,
        fetchPolicy: runtimeReleaseFetchPolicy(args.timeout_ms ?? 45_000, args.signal),
        signal: args.signal,
      });
    }
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
      stdinData: preparedRuntimeAsset.archiveData,
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
    previous_runtime_pid: args.previous_runtime_pid,
    require_new_daemon: args.require_new_daemon,
    signal: args.signal,
  });
  emitProgress(
    args.on_progress,
    'verifying_runtime_inventory',
    'Verifying runtime process inventory',
    'Desktop is confirming the final container runtime process identity.',
  );
  const finalInventory = await inspectContainerRuntimeProcesses({
    ...processCommandArgs,
    runtime_binary_path: probe.binary_path,
    signal: args.signal,
  });
  const finalInstance = finalInventory.instances[0];
  const expectedFinalRuntimeVersion = runtimeProcessIntent === 'update'
    ? runtimeReleaseTag
    : normalizeRuntimeReleaseTag(probe.reported_release_tag ?? startup.runtime_service?.runtime_version ?? runtimeReleaseTag);
  if (
    finalInventory.summary.blocked > 0
    || finalInventory.summary.confirmed_takeover > 0
    || !desktopRuntimeProcessInventoryHasSingleCurrentOwner(finalInventory)
    || finalInventory.instances.length !== 1
    || !finalInstance
    || (Number.isInteger(startup.pid) && Number(startup.pid) > 0 && finalInstance.pid !== startup.pid)
    || finalInstance.desktop_owner_id !== compact(args.desktop_owner_id)
    || finalInstance.state_root !== finalInventory.scope.state_root
    || finalInstance.namespace_id !== finalInventory.scope.namespace_id
    || compact(finalInstance.runtime_version) !== expectedFinalRuntimeVersion
  ) {
    throw new Error('Desktop could not verify a single current container runtime process after startup.');
  }
  if (runtimeProcessIntent !== 'start' && processInventory.instances.some((instance) => (
    instance.pid === finalInstance.pid
    && instance.process_started_at_unix_ms === finalInstance.process_started_at_unix_ms
  ))) {
    throw new Error('Desktop runtime replacement completed without changing the process identity.');
  }
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
  } finally {
    await executor.release();
  }
}
