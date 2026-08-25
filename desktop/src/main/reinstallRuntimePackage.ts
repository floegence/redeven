import { createHash } from 'node:crypto';

import type { DesktopRuntimePlacement } from '../shared/desktopRuntimePlacement';
import type { DesktopComponentTaskProgress } from '../shared/desktopLauncherIPC';
import { runtimeServiceIsOpenable } from '../shared/runtimeService';
import {
  containerRuntimeDaemonStartCommand,
  containerRuntimeExecCommand,
} from './containerRuntime';
import { parseLaunchReport } from './launchReport';
import type { StartupReport } from './startup';
import {
  DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS,
  DEFAULT_RUNTIME_HOST_TRANSFER_TIMEOUT_MS,
  type RuntimeHostAccessExecutor,
} from './runtimeHostAccess';
import {
  buildManagedSSHStartScript,
} from './sshRuntime';
import {
  MANAGED_RUNTIME_DIRECTORY_MODE,
  MANAGED_RUNTIME_EXECUTABLE_MODE,
  MANAGED_RUNTIME_LINUX_COMPANION_FILENAMES,
  MANAGED_RUNTIME_LINUX_EVIDENCE_FILENAMES,
  MANAGED_RUNTIME_METADATA_MODE,
  MANAGED_RUNTIME_STAMP_FILENAME,
  MANAGED_RUNTIME_STAMP_SCHEMA_VERSION,
} from './managedRuntimeSlot';

export type ReinstallRuntimePackageStrategy = 'desktop_upload' | 'remote_install';

export type ReinstallRuntimePackageProgress = DesktopComponentTaskProgress & Readonly<{
  id: 'runtime';
}>;

export type PreparedReinstallRuntimePackage = Readonly<{
  operation_id: string;
  staging_root: string;
  strategy: ReinstallRuntimePackageStrategy;
  release_tag: string;
  commit: string;
  platform: string;
  architecture: string;
  archive_sha256: string;
  archive_size_bytes: number;
  executable_sha256: string;
}>;

export type ReinstallRuntimeReady = Readonly<{
  startup: StartupReport;
  process_count: 1;
}>;

function commandForPlacement(
  placement: DesktopRuntimePlacement,
  script: string,
  marker: string,
  args: readonly string[],
): readonly string[] {
  const argv = ['sh', '-c', script, marker, ...args];
  return placement.kind === 'host_process'
    ? argv
    : containerRuntimeExecCommand({
        engine: placement.container_engine,
        container_id: placement.container_id,
        argv,
      });
}

const stageScript = [
  'set -eu',
  'umask 077',
  'target_root="$1"; operation_id="$2"; release_tag="$3"; expected_commit="$4"; expected_sha="$5"; expected_size="$6"; strategy="$7"; remote_url="${8:-}"; platform="${9:-}"; architecture="${10:-}"; installed_at_unix_ms="${11:-}"',
  'case "$target_root" in /*) ;; *) echo "target root must be absolute" >&2; exit 3 ;; esac',
  'stage="${target_root}.redeven-staging-${operation_id}-runtime"; [ ! -L "$stage" ] || { echo "staging root is a symbolic link" >&2; exit 4; }; rm -rf -- "$stage"; mkdir -p "$stage/managed/bin"',
  'archive="$stage/package.tar.gz"; if [ "$strategy" = remote_install ]; then curl -fsSL "$remote_url" -o "$archive"; else cat > "$archive"; fi',
  'if command -v sha256sum >/dev/null 2>&1; then actual_sha="$(sha256sum "$archive" | awk "{print \\$1}")"; else actual_sha="$(shasum -a 256 "$archive" | awk "{print \\$1}")"; fi',
  '[ "$actual_sha" = "$expected_sha" ] || { echo "package hash mismatch" >&2; exit 5; }; actual_size="$(wc -c < "$archive" | tr -d " \\n")"; [ "$expected_size" = 0 ] || [ "$actual_size" = "$expected_size" ] || { echo "package size mismatch" >&2; exit 6; }',
  'extract="$stage/extract"; mkdir -p "$extract"; tar --warning=no-unknown-keyword -xzf "$archive" -C "$extract" 2>/dev/null || tar -xzf "$archive" -C "$extract"',
  'binary="$extract/redeven"; [ -x "$binary" ] || { echo "Runtime package binary is missing or not executable" >&2; exit 7; }; version_output="$("$binary" version 2>/dev/null)"',
  'if command -v sha256sum >/dev/null 2>&1; then executable_sha="$(sha256sum "$binary" | awk "{print \\$1}")"; else executable_sha="$(shasum -a 256 "$binary" | awk "{print \\$1}")"; fi',
  'set -- $version_output; [ "${1:-}" = redeven ] || { echo "Runtime package product mismatch" >&2; exit 8; }; reported_release="${2:-}"; reported_commit="${3:-}"; reported_commit="${reported_commit#(}"; reported_commit="${reported_commit%)}"',
  'case "$reported_release" in v*) ;; *) reported_release="v$reported_release" ;; esac; case "$release_tag" in v*) ;; *) release_tag="v$release_tag" ;; esac; [ "$reported_release" = "$release_tag" ] || { echo "package release mismatch" >&2; exit 9; }; [ "$reported_commit" = "$expected_commit" ] || { echo "package commit mismatch" >&2; exit 10; }',
  `cp "$binary" "$stage/managed/bin/redeven"; chmod ${MANAGED_RUNTIME_EXECUTABLE_MODE} "$stage/managed/bin/redeven"`,
  `if [ "$platform" = linux ]; then for companion in ${MANAGED_RUNTIME_LINUX_COMPANION_FILENAMES.join(' ')}; do [ -e "$extract/$companion" ] || { echo "Runtime package companion is missing: $companion" >&2; exit 11; }; cp "$extract/$companion" "$stage/managed/bin/$companion"; done; chmod ${MANAGED_RUNTIME_EXECUTABLE_MODE} "$stage/managed/bin/redevplugin-runtime"; fi`,
  `stamp="$stage/managed/${MANAGED_RUNTIME_STAMP_FILENAME}"`,
  `{ printf "schema_version=${MANAGED_RUNTIME_STAMP_SCHEMA_VERSION}\\nmanaged_by=redeven-desktop\\nslot_release_tag=%s\\ninstall_strategy=%s\\ninstalled_at_unix_ms=%s\\ncommit=%s\\nplatform=%s\\narchitecture=%s\\narchive_sha256=%s\\nexecutable_sha256=%s\\n" "$reported_release" "$strategy" "$installed_at_unix_ms" "$reported_commit" "$platform" "$architecture" "$actual_sha" "$executable_sha"; } > "$stamp"`,
  `chmod ${MANAGED_RUNTIME_DIRECTORY_MODE} "$stage" "$stage/managed" "$stage/managed/bin"`,
  `if [ "$platform" = linux ]; then for metadata in ${MANAGED_RUNTIME_LINUX_EVIDENCE_FILENAMES.join(' ')}; do chmod ${MANAGED_RUNTIME_METADATA_MODE} "$stage/managed/bin/$metadata"; done; fi`,
  `chmod ${MANAGED_RUNTIME_METADATA_MODE} "$stamp"`,
  'rm -rf -- "$extract" "$archive"',
  'printf "staging_root=%s\\narchive_sha256=%s\\narchive_size_bytes=%s\\nexecutable_sha256=%s\\nreported_release_tag=%s\\nreported_commit=%s\\n" "$stage" "$actual_sha" "$actual_size" "$executable_sha" "$reported_release" "$reported_commit"',
].join('\n');

const installScript = [
  `set -eu; umask 077; target_root="$1"; operation_id="$2"; mode="$3"; expected_release="$4"; expected_commit="$5"; package_root="${'${target_root}'}.redeven-staging-${'${operation_id}'}-runtime"; runtime_stage="$package_root/managed"; [ -d "$runtime_stage" ] || { echo "Runtime staging is incomplete" >&2; exit 20; }`,
  `stamp="$runtime_stage/${MANAGED_RUNTIME_STAMP_FILENAME}"; [ -f "$stamp" ] || { echo "managed runtime stamp is missing" >&2; exit 21; }`,
  `grep -Fx "schema_version=${MANAGED_RUNTIME_STAMP_SCHEMA_VERSION}" "$stamp" >/dev/null; grep -Fx "managed_by=redeven-desktop" "$stamp" >/dev/null; grep -Fx "slot_release_tag=$expected_release" "$stamp" >/dev/null; grep -Fx "commit=$expected_commit" "$stamp" >/dev/null`,
  'runtime_live="$target_root/runtime/managed"; rollback_root="$target_root/.managed-runtime-rollback-${operation_id}"; committed_root="$target_root/.managed-runtime-committed-${operation_id}"; mkdir -p "$target_root/runtime"',
  'restore_item() { live="$1"; backup="$2"; absent="$3"; if [ -e "$backup" ] || [ -L "$backup" ]; then rm -rf -- "$live"; mv "$backup" "$live"; elif [ -e "$absent" ]; then rm -rf -- "$live"; fi; }; restore_rollback() { [ -d "$rollback_root" ] || return 0; restore_item "$runtime_live" "$rollback_root/runtime" "$rollback_root/runtime.absent"; rm -rf -- "$rollback_root"; }',
  'if [ -e "$committed_root" ] || [ -L "$committed_root" ]; then rm -rf -- "$committed_root"; fi; if [ "$mode" = preserve_data ]; then restore_rollback; mkdir "$rollback_root"; if [ -e "$runtime_live" ] || [ -L "$runtime_live" ]; then mv "$runtime_live" "$rollback_root/runtime"; else : > "$rollback_root/runtime.absent"; fi; fi',
  `chmod ${MANAGED_RUNTIME_DIRECTORY_MODE} "$target_root/runtime"; rm -rf -- "$runtime_live"; mv "$runtime_stage" "$runtime_live"`,
].join('\n');

const rollbackScript = [
  'set -eu; target_root="$1"; operation_id="$2"; runtime_live="$target_root/runtime/managed"; rollback_root="$target_root/.managed-runtime-rollback-${operation_id}"; committed_root="$target_root/.managed-runtime-committed-${operation_id}"; [ ! -e "$committed_root" ] || { echo "Runtime replacement is already committed" >&2; exit 26; }; [ -d "$rollback_root" ] || exit 0',
  'if [ -e "$rollback_root/runtime" ] || [ -L "$rollback_root/runtime" ]; then rm -rf -- "$runtime_live"; mv "$rollback_root/runtime" "$runtime_live"; elif [ -e "$rollback_root/runtime.absent" ]; then rm -rf -- "$runtime_live"; fi; rm -rf -- "$rollback_root"',
].join('\n');

const cleanupScript = [
  'set -eu; target_root="$1"; operation_id="$2"; rollback_root="$target_root/.managed-runtime-rollback-${operation_id}"; committed_root="$target_root/.managed-runtime-committed-${operation_id}"; if [ -e "$rollback_root" ] || [ -L "$rollback_root" ]; then rm -rf -- "$committed_root"; mv "$rollback_root" "$committed_root"; fi; rm -rf -- "${target_root}.redeven-staging-${operation_id}-runtime" "$committed_root"',
].join('\n');

const statusScript = 'set -eu; target_root="$1"; state_root="$2"; binary="$target_root/runtime/managed/bin/redeven"; [ -x "$binary" ] || { echo "installed Runtime is missing" >&2; exit 30; }; exec "$binary" desktop-runtime-status --state-root "$state_root"';
const inventoryScript = 'set -eu; target_root="$1"; binary="$target_root/runtime/managed/bin/redeven"; [ -x "$binary" ] || { echo "installed Runtime is missing" >&2; exit 30; }; exec "$binary" desktop-target-process-inventory --target-root "$target_root"';

function values(raw: string): ReadonlyMap<string, string> {
  return new Map(String(raw).split(/\r?\n/u).flatMap((line) => {
    const index = line.indexOf('=');
    return index > 0 ? [[line.slice(0, index), line.slice(index + 1)] as const] : [];
  }));
}

function parseStageOutput(raw: string): Readonly<{
  staging_root: string;
  archive_sha256: string;
  archive_size_bytes: number;
  executable_sha256: string;
  reported_release_tag: string;
  reported_commit: string;
}> {
  const parsed = values(raw);
  const evidence = {
    staging_root: parsed.get('staging_root') ?? '',
    archive_sha256: parsed.get('archive_sha256') ?? '',
    archive_size_bytes: Number(parsed.get('archive_size_bytes') ?? ''),
    executable_sha256: parsed.get('executable_sha256') ?? '',
    reported_release_tag: parsed.get('reported_release_tag') ?? '',
    reported_commit: parsed.get('reported_commit') ?? '',
  };
  if (
    evidence.staging_root === ''
    || !/^[a-f0-9]{64}$/u.test(evidence.archive_sha256)
    || !/^[a-f0-9]{64}$/u.test(evidence.executable_sha256)
    || !Number.isSafeInteger(evidence.archive_size_bytes)
    || evidence.archive_size_bytes <= 0
    || evidence.reported_release_tag === ''
    || evidence.reported_commit === ''
  ) {
    throw new Error('Target returned invalid Runtime staging evidence.');
  }
  return evidence;
}

type ProcessInventory = Readonly<{
  schema_version: 1;
  target_root: string;
  inventory_digest: string;
  instances: readonly Readonly<{
    pid: number;
    process_started_at_unix_ms: number;
    role: string;
    executable_path?: string;
    executable_deleted?: boolean;
    identity_status: 'verified' | 'incomplete';
    stop_authority: 'automatic' | 'blocked';
  }>[];
  summary: Readonly<{ automatic: number; blocked: number }>;
}>;

function parseProcessInventory(raw: string): ProcessInventory {
  const value = JSON.parse(String(raw ?? '')) as Partial<ProcessInventory>;
  if (
    value.schema_version !== 1
    || typeof value.target_root !== 'string'
    || !/^[a-f0-9]{64}$/u.test(value.inventory_digest ?? '')
    || !Array.isArray(value.instances)
    || value.instances.some((instance) => (
      !Number.isInteger(instance.pid)
      || instance.pid <= 0
      || !Number.isInteger(instance.process_started_at_unix_ms)
      || instance.process_started_at_unix_ms <= 0
      || typeof instance.role !== 'string'
      || typeof instance.executable_path !== 'string'
      || (instance.identity_status !== 'verified' && instance.identity_status !== 'incomplete')
      || (instance.stop_authority !== 'automatic' && instance.stop_authority !== 'blocked')
    ))
    || !value.summary
    || typeof value.summary.automatic !== 'number'
    || typeof value.summary.blocked !== 'number'
  ) {
    throw new Error('Installed Runtime returned an invalid process inventory.');
  }
  return value as ProcessInventory;
}

function abortableWait(delayMS: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Runtime startup was canceled.', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const finish = (callback: () => void) => {
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const timer = setTimeout(() => finish(resolve), delayMS);
    const abort = () => {
      clearTimeout(timer);
      finish(() => reject(signal?.reason ?? new DOMException('Runtime startup was canceled.', 'AbortError')));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function readReadyStatus(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: DesktopRuntimePlacement;
  target_root: string;
  state_root: string;
  signal?: AbortSignal;
}>): Promise<Readonly<{ startup: StartupReport | null; error: unknown | null }>> {
  try {
    const result = await args.executor.run(commandForPlacement(args.placement, statusScript, 'redeven-reinstall-runtime-status', [
      args.target_root,
      args.state_root,
    ]), {
      ...(args.signal ? { signal: args.signal } : {}),
      timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS,
    });
    const report = parseLaunchReport(result.stdout);
    return {
      startup: report.status !== 'blocked' && runtimeServiceIsOpenable(report.startup.runtime_service)
        ? report.startup
        : null,
      error: report.status === 'blocked' ? new Error(report.message || 'Runtime reported a blocked startup state.') : null,
    };
  } catch (error) {
    return { startup: null, error };
  }
}

async function inspectInstalledRuntime(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: DesktopRuntimePlacement;
  target_root: string;
  signal?: AbortSignal;
}>): Promise<ProcessInventory> {
  const result = await args.executor.run(commandForPlacement(args.placement, inventoryScript, 'redeven-reinstall-runtime-inventory', [
    args.target_root,
  ]), {
    ...(args.signal ? { signal: args.signal } : {}),
    timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS,
  });
  return parseProcessInventory(result.stdout);
}

async function waitForReadyStatus(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: DesktopRuntimePlacement;
  target_root: string;
  state_root: string;
  timeout_ms: number;
  signal?: AbortSignal;
}>): Promise<StartupReport> {
  const deadline = Date.now() + args.timeout_ms;
  let lastError: unknown = null;
  do {
    const status = await readReadyStatus(args);
    if (status.startup) {
      return status.startup;
    }
    lastError = status.error ?? lastError;
    await abortableWait(250, args.signal);
  } while (Date.now() < deadline);
  throw new Error(
    'The freshly installed Runtime did not publish a ready Runtime Service before the startup deadline.',
    lastError === null ? undefined : { cause: lastError },
  );
}

function runtimeStartCommand(
  placement: DesktopRuntimePlacement,
  targetRoot: string,
  stateRoot: string,
): readonly string[] {
  const runtimeBinaryPath = `${targetRoot.replace(/\/$/u, '')}/runtime/managed/bin/redeven`;
  if (placement.kind === 'container_process') {
    return containerRuntimeDaemonStartCommand({
      engine: placement.container_engine,
      container_id: placement.container_id,
      runtime_binary_path: runtimeBinaryPath,
      runtime_root: targetRoot,
      runtime_state_root: stateRoot,
    });
  }
  return [
    'sh',
    '-c',
    buildManagedSSHStartScript(),
    'redeven-reinstall-runtime-start',
    targetRoot,
    stateRoot,
    '',
    `reinstall-${Date.now()}-${process.pid}`,
  ];
}

export async function prepareReinstallRuntimePackage(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: DesktopRuntimePlacement;
  target_root: string;
  operation_id: string;
  release_tag: string;
  commit: string;
  platform: string;
  architecture: string;
  strategy: ReinstallRuntimePackageStrategy;
  archive?: Buffer;
  archive_sha256: string;
  archive_size_bytes?: number;
  remote_url?: string;
  signal?: AbortSignal;
  on_progress?: (progress: ReinstallRuntimePackageProgress) => void;
}>): Promise<PreparedReinstallRuntimePackage> {
  let progressPhase: ReinstallRuntimePackageProgress['phase'] = 'transferring';
  args.on_progress?.({ id: 'runtime', status: 'running', phase: progressPhase, strategy: args.strategy });
  try {
    const digest = args.archive ? createHash('sha256').update(args.archive).digest('hex') : args.archive_sha256;
    if (digest !== args.archive_sha256) {
      throw new Error('Runtime archive digest changed before transfer.');
    }
    const result = await args.executor.run(commandForPlacement(args.placement, stageScript, 'redeven-reinstall-runtime-stage', [
      args.target_root,
      args.operation_id,
      args.release_tag,
      args.commit,
      args.archive_sha256,
      String(args.archive_size_bytes ?? args.archive?.byteLength ?? 0),
      args.strategy,
      args.remote_url ?? '-',
      args.platform,
      args.architecture,
      String(Date.now()),
    ]), {
      ...(args.archive ? { stdinData: args.archive } : {}),
      ...(args.signal ? { signal: args.signal } : {}),
      timeout_ms: DEFAULT_RUNTIME_HOST_TRANSFER_TIMEOUT_MS,
    });
    progressPhase = 'verifying';
    args.on_progress?.({ id: 'runtime', status: 'running', phase: progressPhase, strategy: args.strategy });
    const evidence = parseStageOutput(result.stdout);
    if (evidence.reported_release_tag !== args.release_tag || evidence.reported_commit !== args.commit) {
      throw new Error('Prepared Runtime package identity changed during staging.');
    }
    args.on_progress?.({
      id: 'runtime',
      status: 'succeeded',
      phase: 'ready',
      strategy: args.strategy,
      completed_bytes: evidence.archive_size_bytes,
      total_bytes: evidence.archive_size_bytes,
    });
    return {
      operation_id: args.operation_id,
      staging_root: evidence.staging_root,
      strategy: args.strategy,
      release_tag: evidence.reported_release_tag,
      commit: evidence.reported_commit,
      platform: args.platform,
      architecture: args.architecture,
      archive_sha256: evidence.archive_sha256,
      archive_size_bytes: evidence.archive_size_bytes,
      executable_sha256: evidence.executable_sha256,
    };
  } catch (error) {
    args.on_progress?.({ id: 'runtime', status: 'failed', phase: progressPhase, strategy: args.strategy });
    await cleanupReinstallRuntimePackage(
      args.executor,
      args.placement,
      args.target_root,
      args.operation_id,
      args.signal,
    ).catch(() => undefined);
    throw error;
  }
}

export async function installReinstallRuntimePackage(
  executor: RuntimeHostAccessExecutor,
  placement: DesktopRuntimePlacement,
  targetRoot: string,
  prepared: PreparedReinstallRuntimePackage,
  mode: 'wipe_data' | 'preserve_data',
  signal?: AbortSignal,
): Promise<void> {
  await executor.run(commandForPlacement(placement, installScript, 'redeven-reinstall-runtime-install', [
    targetRoot,
    prepared.operation_id,
    mode,
    prepared.release_tag,
    prepared.commit,
  ]), {
    ...(signal ? { signal } : {}),
    timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS,
  });
}

export async function startReinstallRuntime(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: DesktopRuntimePlacement;
  target_root: string;
  state_root: string;
  signal?: AbortSignal;
}>): Promise<void> {
  const before = await inspectInstalledRuntime(args);
  if (before.summary.blocked !== 0 || before.instances.length > 1) {
    throw new Error('Desktop found conflicting Runtime processes before reinstall startup.');
  }
  if (before.instances.length === 0) {
    await args.executor.run(runtimeStartCommand(args.placement, args.target_root, args.state_root), {
      ...(args.signal ? { signal: args.signal } : {}),
      timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS,
    });
  }
}

export async function verifyReinstallRuntimeReady(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: DesktopRuntimePlacement;
  target_root: string;
  state_root: string;
  startup_timeout_ms?: number;
  signal?: AbortSignal;
}>): Promise<ReinstallRuntimeReady> {
  const startup = await waitForReadyStatus({
    ...args,
    timeout_ms: args.startup_timeout_ms ?? 45_000,
  });
  const finalInventory = await inspectInstalledRuntime(args);
  const binary = `${args.target_root.replace(/\/$/u, '')}/runtime/managed/bin/redeven`;
  const finalInstance = finalInventory.instances[0];
  const runtimeVersion = String(startup.runtime_service?.runtime_version ?? '').trim();
  if (
    finalInventory.target_root !== args.target_root
    || finalInventory.summary.blocked !== 0
    || finalInventory.summary.automatic !== 1
    || finalInventory.instances.length !== 1
    || finalInstance?.pid !== startup.pid
    || (finalInstance?.role !== 'runtime' && finalInstance?.role !== 'target_root_process')
    || finalInstance?.identity_status !== 'verified'
    || finalInstance?.stop_authority !== 'automatic'
    || finalInstance?.executable_deleted === true
    || finalInstance?.executable_path !== binary
    || runtimeVersion === ''
  ) {
    throw new Error('Desktop could not verify one current Runtime process after reinstall startup.');
  }
  return { startup, process_count: 1 };
}

export async function rollbackReinstallRuntimePackage(
  executor: RuntimeHostAccessExecutor,
  placement: DesktopRuntimePlacement,
  targetRoot: string,
  operationID: string,
  signal?: AbortSignal,
): Promise<void> {
  await executor.run(commandForPlacement(placement, rollbackScript, 'redeven-reinstall-runtime-rollback', [
    targetRoot,
    operationID,
  ]), {
    ...(signal ? { signal } : {}),
    timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS,
  });
}

export async function cleanupReinstallRuntimePackage(
  executor: RuntimeHostAccessExecutor,
  placement: DesktopRuntimePlacement,
  targetRoot: string,
  operationID: string,
  signal?: AbortSignal,
): Promise<void> {
  await executor.run(commandForPlacement(placement, cleanupScript, 'redeven-reinstall-runtime-cleanup', [
    targetRoot,
    operationID,
  ]), {
    ...(signal ? { signal } : {}),
    timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS,
  });
}
