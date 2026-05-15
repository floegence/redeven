import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import {
  containerInspectCommand,
  containerRuntimePlatformProbeCommand,
  containerRuntimeProbeCommand,
  containerRuntimeUploadedInstallCommand,
  parseContainerInspectJSON,
  parseContainerPlatformProbeOutput,
} from './containerRuntime';
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
} from './runtimeUploadAsset';

export type RuntimePlacementProgressPhase =
  | 'checking_host'
  | 'checking_container'
  | 'detecting_platform'
  | 'checking_runtime'
  | 'preparing_runtime_package'
  | 'installing_runtime'
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
}>;

export type EnsureRuntimePlacementReadyArgs = Readonly<{
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  runtime_release_tag: string;
  release_base_url: string;
  source_runtime_root?: string;
  asset_cache_root: string;
  force_runtime_update?: boolean;
  timeout_ms?: number;
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

function runtimeHostExecutor(hostAccess: DesktopRuntimeHostAccess): RuntimeHostAccessExecutor {
  return hostAccess.kind === 'ssh_host'
    ? createSSHRuntimeHostExecutor(hostAccess.ssh)
    : createLocalRuntimeHostExecutor();
}

function containerUnavailableMessage(
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>,
  status: string,
): string {
  const label = placement.container_label || placement.container_id;
  if (status === 'missing') {
    return `Container ${label} was not found. Choose a running container, then try again.`;
  }
  if (status === 'no_permission') {
    return `Desktop does not have permission to inspect ${label}. Check ${placement.container_engine} access, then try again.`;
  }
  return `Container ${label} is not running. Start it outside Redeven, then refresh and try again.`;
}

async function assertContainerRunning(
  executor: RuntimeHostAccessExecutor,
  placement: Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>,
  signal?: AbortSignal,
): Promise<void> {
  const result = await executor.run(containerInspectCommand(
    placement.container_engine,
    placement.container_id,
  ), { signal });
  const inspected = parseContainerInspectJSON(placement.container_engine, result.stdout);
  if (inspected.status !== 'running') {
    throw new Error(containerUnavailableMessage(placement, inspected.status));
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
    runtime_install_root: placement.runtime_install_root,
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

  const executor = runtimeHostExecutor(args.host_access);
  emitProgress(
    args.on_progress,
    args.host_access.kind === 'ssh_host' ? 'checking_host' : 'checking_container',
    args.host_access.kind === 'ssh_host' ? 'Checking SSH host' : 'Checking container',
    args.host_access.kind === 'ssh_host'
      ? 'Desktop is checking the SSH host and selected running container.'
      : 'Desktop is checking the selected running container.',
  );
  await assertContainerRunning(executor, args.placement, args.signal);

  emitProgress(
    args.on_progress,
    'detecting_platform',
    'Detecting runtime platform',
    'Desktop is checking the container OS and CPU architecture before choosing a runtime package.',
  );
  const platformResult = await executor.run(containerRuntimePlatformProbeCommand({
    engine: args.placement.container_engine,
    container_id: args.placement.container_id,
  }), { signal: args.signal });
  const platform = parseContainerPlatformProbeOutput(platformResult.stdout);

  emitProgress(
    args.on_progress,
    'checking_runtime',
    'Checking container runtime',
    `Desktop is checking for a compatible Redeven ${runtimeReleaseTag} runtime inside the container.`,
  );
  let probe = await probeContainerRuntime(executor, args.placement, runtimeReleaseTag, args.signal);
  const sourceRuntimeRoot = compact(args.source_runtime_root);
  const shouldInstallRuntime = probe.status !== 'ready'
    || args.force_runtime_update === true
    || sourceRuntimeRoot !== '';
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
      engine: args.placement.container_engine,
      container_id: args.placement.container_id,
      runtime_install_root: args.placement.runtime_install_root,
      runtime_release_tag: runtimeReleaseTag,
    }), {
      stdinData: asset.archiveData,
      signal: args.signal,
    });
    probe = await probeContainerRuntime(executor, args.placement, runtimeReleaseTag, args.signal);
  }
  if (probe.status !== 'ready') {
    throw new Error(describeManagedSSHRuntimeProbeResult(probe));
  }
  emitProgress(
    args.on_progress,
    'runtime_ready',
    'Runtime ready',
    describeManagedSSHRuntimeProbeResult(probe),
  );
  return {
    host_access: args.host_access,
    placement: args.placement,
    runtime_binary_path: probe.binary_path,
    probe,
  };
}
