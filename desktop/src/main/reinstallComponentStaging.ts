import { createHash } from 'node:crypto';

import type { DesktopRuntimePlacement } from '../shared/desktopRuntimePlacement';
import { containerRuntimeExecCommand } from './containerRuntime';
import type {
  ManagedComponentTask,
  ManagedComponentTaskProgress,
  PreparedComponent,
} from './managedComponentBatchInstaller';
import type { RuntimeHostAccessExecutor } from './runtimeHostAccess';

function commandForPlacement(
  placement: DesktopRuntimePlacement,
  script: string,
  args: readonly string[],
): readonly string[] {
  const argv = ['sh', '-c', script, 'redeven-component-stage', ...args];
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
  'target_root="$1"',
  'operation_id="$2"',
  'component="$3"',
  'release_tag="$4"',
  'expected_commit="$5"',
  'expected_sha="$6"',
  'expected_size="$7"',
  'strategy="$8"',
  'remote_url="${9:-}"',
  'platform="${10:-}"',
  'architecture="${11:-}"',
  'case "$component" in gateway|runtime) ;; *) echo "invalid component" >&2; exit 2 ;; esac',
  'case "$target_root" in /*) ;; *) echo "target root must be absolute" >&2; exit 3 ;; esac',
  'stage="${target_root}.redeven-staging-${operation_id}-${component}"',
  '[ ! -L "$stage" ] || { echo "staging root is a symbolic link" >&2; exit 4; }',
  'rm -rf -- "$stage"',
  'mkdir -p "$stage/payload/bin"',
  'archive="$stage/package.tar.gz"',
  'if [ "$strategy" = remote_install ]; then curl -fsSL "$remote_url" -o "$archive"; else cat > "$archive"; fi',
  'if command -v sha256sum >/dev/null 2>&1; then actual_sha="$(sha256sum "$archive" | awk "{print \\$1}")"; else actual_sha="$(shasum -a 256 "$archive" | awk "{print \\$1}")"; fi',
  '[ "$actual_sha" = "$expected_sha" ] || { echo "package hash mismatch" >&2; exit 5; }',
  'actual_size="$(wc -c < "$archive" | tr -d " \\n")"',
  'if [ "$expected_size" != 0 ]; then [ "$actual_size" = "$expected_size" ] || { echo "package size mismatch" >&2; exit 6; }; fi',
  'extract="$stage/extract"',
  'mkdir -p "$extract"',
  'tar --warning=no-unknown-keyword -xzf "$archive" -C "$extract" 2>/dev/null || tar -xzf "$archive" -C "$extract"',
  'if [ "$component" = gateway ]; then binary="$extract/redeven-gateway"; product=redeven-gateway; else binary="$extract/redeven"; product=redeven; fi',
  '[ -x "$binary" ] || { echo "package binary is missing or not executable" >&2; exit 7; }',
  'version_output="$("$binary" version 2>/dev/null)"',
  'if command -v sha256sum >/dev/null 2>&1; then executable_sha="$(sha256sum "$binary" | awk "{print \\$1}")"; else executable_sha="$(shasum -a 256 "$binary" | awk "{print \\$1}")"; fi',
  'set -- $version_output',
  '[ "${1:-}" = "$product" ] || { echo "package product mismatch" >&2; exit 8; }',
  'reported_release="${2:-}"',
  'reported_commit="${3:-}"',
  'reported_commit="${reported_commit#(}"',
  'reported_commit="${reported_commit%)}"',
  'case "$reported_release" in v*) ;; *) reported_release="v$reported_release" ;; esac',
  'case "$release_tag" in v*) ;; *) release_tag="v$release_tag" ;; esac',
  '[ "$reported_release" = "$release_tag" ] || { echo "package release mismatch" >&2; exit 9; }',
  '[ "$reported_commit" = "$expected_commit" ] || { echo "package commit mismatch" >&2; exit 10; }',
  'if [ "$component" = gateway ]; then',
  '  cp "$binary" "$stage/payload/bin/redeven-gateway"',
  '  chmod 700 "$stage/payload/bin/redeven-gateway"',
  '  { printf "schema_version=3\\n"; printf "installed_by=redeven-desktop\\n"; printf "slot_release_tag=%s\\n" "$release_tag"; printf "source_commit=%s\\n" "$reported_commit"; printf "install_strategy=%s\\n" "$strategy"; } > "$stage/payload/managed-gateway.stamp"',
  'else',
  '  cp "$binary" "$stage/payload/bin/redeven"',
  '  chmod 700 "$stage/payload/bin/redeven"',
  '  if [ "$platform" = linux ]; then',
  '    for companion in .redevplugin-release-artifacts-verified.json REDEVPLUGIN_THIRD_PARTY_NOTICES.md REDEVPLUGIN_RUNTIME.spdx.json redevplugin-runtime.provenance.json redevplugin-runtime.sig redevplugin-runtime.pem redevplugin-runtime; do',
  '      [ -e "$extract/$companion" ] || { echo "runtime package companion is missing: $companion" >&2; exit 11; }',
  '      cp "$extract/$companion" "$stage/payload/bin/$companion"',
  '    done',
  '    chmod 700 "$stage/payload/bin/redevplugin-runtime"',
  '    chmod 600 "$stage/payload/bin/.redevplugin-release-artifacts-verified.json" "$stage/payload/bin/REDEVPLUGIN_THIRD_PARTY_NOTICES.md" "$stage/payload/bin/REDEVPLUGIN_RUNTIME.spdx.json" "$stage/payload/bin/redevplugin-runtime.provenance.json" "$stage/payload/bin/redevplugin-runtime.sig" "$stage/payload/bin/redevplugin-runtime.pem"',
  '  fi',
  '  { printf "schema_version=2\\n"; printf "managed_by=redeven-desktop\\n"; printf "slot_release_tag=%s\\n" "$release_tag"; printf "install_strategy=%s\\n" "$strategy"; } > "$stage/payload/managed-runtime.stamp"',
  'fi',
  '{ printf "component=%s\\n" "$component"; printf "release_tag=%s\\n" "$release_tag"; printf "commit=%s\\n" "$reported_commit"; printf "platform=%s\\n" "$platform"; printf "architecture=%s\\n" "$architecture"; printf "archive_sha256=%s\\n" "$actual_sha"; printf "executable_sha256=%s\\n" "$executable_sha"; } > "$stage/component.manifest"',
  'rm -rf -- "$extract" "$archive"',
  'printf "staging_root=%s\\narchive_sha256=%s\\narchive_size_bytes=%s\\nexecutable_sha256=%s\\nreported_release_tag=%s\\nreported_commit=%s\\n" "$stage" "$actual_sha" "$actual_size" "$executable_sha" "$reported_release" "$reported_commit"',
].join('\n');

const activateScript = [
  'set -eu',
  'target_root="$1"',
  'operation_id="$2"',
  'mode="$3"',
  'release_tag="$4"',
  'commit="$5"',
  'platform="$6"',
  'architecture="$7"',
  'gateway_archive_sha="$8"',
  'runtime_archive_sha="$9"',
  'gateway_stage="${target_root}.redeven-staging-${operation_id}-gateway/payload"',
  'runtime_stage="${target_root}.redeven-staging-${operation_id}-runtime/payload"',
  '[ -d "$gateway_stage" ] && [ -d "$runtime_stage" ] || { echo "component staging is incomplete" >&2; exit 20; }',
  'gateway_manifest="${target_root}.redeven-staging-${operation_id}-gateway/component.manifest"',
  'runtime_manifest="${target_root}.redeven-staging-${operation_id}-runtime/component.manifest"',
  'for check in "component=gateway:$gateway_manifest" "component=runtime:$runtime_manifest" "release_tag=$release_tag:$gateway_manifest" "release_tag=$release_tag:$runtime_manifest" "commit=$commit:$gateway_manifest" "commit=$commit:$runtime_manifest" "platform=$platform:$gateway_manifest" "platform=$platform:$runtime_manifest" "architecture=$architecture:$gateway_manifest" "architecture=$architecture:$runtime_manifest" "archive_sha256=$gateway_archive_sha:$gateway_manifest" "archive_sha256=$runtime_archive_sha:$runtime_manifest"; do value="${check%:*}"; manifest="${check##*:}"; grep -Fqx "$value" "$manifest" || { echo "component suite manifest mismatch" >&2; exit 23; }; done',
  'gateway_live="$target_root/gateway/managed"',
  'runtime_live="$target_root/runtime/managed"',
  'suite_live="$target_root/managed-suite.manifest"',
  'rollback_root="$target_root/.managed-component-rollback-${operation_id}"',
  'committed_root="$target_root/.managed-component-committed-${operation_id}"',
  'suite_temp="$target_root/.managed-suite.manifest.${operation_id}.tmp"',
  'mkdir -p "$target_root/gateway" "$target_root/runtime"',
  'restore_item() { live="$1"; backup="$2"; absent="$3"; if [ -e "$backup" ] || [ -L "$backup" ]; then rm -rf -- "$live"; mv "$backup" "$live"; elif [ -e "$absent" ]; then rm -rf -- "$live"; fi; }',
  'restore_rollback() { [ -d "$rollback_root" ] || return 0; restore_item "$gateway_live" "$rollback_root/gateway" "$rollback_root/gateway.absent"; restore_item "$runtime_live" "$rollback_root/runtime" "$rollback_root/runtime.absent"; restore_item "$suite_live" "$rollback_root/suite" "$rollback_root/suite.absent"; rm -rf -- "$rollback_root"; }',
  'if [ -e "$committed_root" ] || [ -L "$committed_root" ]; then rm -rf -- "$committed_root"; fi',
  'if [ "$mode" = preserve_data ]; then restore_rollback; fi',
  'rm -f -- "$suite_temp"',
  'if [ "$mode" = preserve_data ]; then',
  '  mkdir "$rollback_root"',
  '  if [ -e "$gateway_live" ] || [ -L "$gateway_live" ]; then mv "$gateway_live" "$rollback_root/gateway"; else : > "$rollback_root/gateway.absent"; fi',
  '  if [ -e "$runtime_live" ] || [ -L "$runtime_live" ]; then mv "$runtime_live" "$rollback_root/runtime"; else : > "$rollback_root/runtime.absent"; fi',
  '  if [ -e "$suite_live" ] || [ -L "$suite_live" ]; then mv "$suite_live" "$rollback_root/suite"; else : > "$rollback_root/suite.absent"; fi',
  'fi',
  'if ! mv "$gateway_stage" "$gateway_live"; then restore_rollback; exit 21; fi',
  'if ! mv "$runtime_stage" "$runtime_live"; then restore_rollback; exit 22; fi',
  'chmod 700 "$gateway_live" "$runtime_live" "$gateway_live/bin" "$runtime_live/bin"',
  'if ! { { printf "schema_version=1\\n"; printf "operation_id=%s\\n" "$operation_id"; printf "release_tag=%s\\n" "$release_tag"; printf "commit=%s\\n" "$commit"; printf "platform=%s\\n" "$platform"; printf "architecture=%s\\n" "$architecture"; printf "gateway_archive_sha256=%s\\n" "$gateway_archive_sha"; printf "runtime_archive_sha256=%s\\n" "$runtime_archive_sha"; } > "$suite_temp" && mv "$suite_temp" "$suite_live"; }; then restore_rollback; exit 24; fi',
].join('\n');

const rollbackScript = [
  'set -eu',
  'target_root="$1"',
  'operation_id="$2"',
  'gateway_live="$target_root/gateway/managed"',
  'runtime_live="$target_root/runtime/managed"',
  'suite_live="$target_root/managed-suite.manifest"',
  'rollback_root="$target_root/.managed-component-rollback-${operation_id}"',
  'committed_root="$target_root/.managed-component-committed-${operation_id}"',
  '[ ! -e "$committed_root" ] && [ ! -L "$committed_root" ] || { echo "managed component replacement is already committed" >&2; exit 26; }',
  '[ -d "$rollback_root" ] || exit 0',
  'restore_item() { live="$1"; backup="$2"; absent="$3"; if [ -e "$backup" ] || [ -L "$backup" ]; then rm -rf -- "$live"; mv "$backup" "$live"; elif [ -e "$absent" ]; then rm -rf -- "$live"; fi; }',
  'restore_item "$gateway_live" "$rollback_root/gateway" "$rollback_root/gateway.absent"',
  'restore_item "$runtime_live" "$rollback_root/runtime" "$rollback_root/runtime.absent"',
  'restore_item "$suite_live" "$rollback_root/suite" "$rollback_root/suite.absent"',
  'rm -rf -- "$rollback_root"',
].join('\n');

const cleanupScript = [
  'set -eu',
  'target_root="$1"',
  'operation_id="$2"',
  'rollback_root="$target_root/.managed-component-rollback-${operation_id}"',
  'committed_root="$target_root/.managed-component-committed-${operation_id}"',
  'if [ -e "$rollback_root" ] || [ -L "$rollback_root" ]; then rm -rf -- "$committed_root"; mv "$rollback_root" "$committed_root"; fi',
  'rm -rf -- "${target_root}.redeven-staging-${operation_id}-gateway" "${target_root}.redeven-staging-${operation_id}-runtime"',
  'rm -rf -- "$committed_root"',
  'rm -f -- "$target_root/.managed-suite.manifest.${operation_id}.tmp"',
].join('\n');

function values(raw: string): ReadonlyMap<string, string> {
  return new Map(String(raw).split(/\r?\n/u).flatMap((line) => {
    const index = line.indexOf('=');
    return index > 0 ? [[line.slice(0, index), line.slice(index + 1)] as const] : [];
  }));
}

function parseStageOutput(raw: string): PreparedComponent['evidence'] & Readonly<{ staging_root: string }> {
  const parsed = values(raw);
  const stagingRoot = parsed.get('staging_root') ?? '';
  const archiveSHA256 = parsed.get('archive_sha256') ?? '';
  const archiveSizeBytes = Number(parsed.get('archive_size_bytes') ?? '');
  const executableSHA256 = parsed.get('executable_sha256') ?? '';
  const reportedReleaseTag = parsed.get('reported_release_tag') ?? '';
  const reportedCommit = parsed.get('reported_commit') ?? '';
  if (!stagingRoot || !/^[a-f0-9]{64}$/u.test(archiveSHA256) || !/^[a-f0-9]{64}$/u.test(executableSHA256) || !Number.isSafeInteger(archiveSizeBytes) || archiveSizeBytes <= 0 || !reportedReleaseTag || !reportedCommit) {
    throw new Error('Target returned invalid component staging evidence.');
  }
  return {
    staging_root: stagingRoot,
    archive_sha256: archiveSHA256,
    archive_size_bytes: archiveSizeBytes,
    executable_sha256: executableSHA256,
    reported_release_tag: reportedReleaseTag,
    reported_commit: reportedCommit,
  };
}

export async function stageManagedComponent(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: DesktopRuntimePlacement;
  target_root: string;
  operation_id: string;
  task: ManagedComponentTask;
  archive?: Buffer;
  archive_sha256: string;
  archive_size_bytes?: number;
  remote_url?: string;
  signal?: AbortSignal;
  on_progress?: (progress: ManagedComponentTaskProgress) => void;
}>): Promise<PreparedComponent> {
  args.on_progress?.({ id: args.task.component, status: 'running', phase: 'transferring', strategy: args.task.strategy });
  const localDigest = args.archive ? createHash('sha256').update(args.archive).digest('hex') : args.archive_sha256;
  if (localDigest !== args.archive_sha256) throw new Error('Desktop component archive digest changed before transfer.');
  const result = await args.executor.run(commandForPlacement(args.placement, stageScript, [
    args.target_root,
    args.operation_id,
    args.task.component,
    args.task.release_tag,
    args.task.commit,
    args.archive_sha256,
    String(args.archive_size_bytes ?? args.archive?.byteLength ?? 0),
    args.task.strategy,
    args.remote_url ?? '-',
    args.task.platform,
    args.task.architecture,
  ]), {
    ...(args.archive ? { stdinData: args.archive } : {}),
    ...(args.signal ? { signal: args.signal } : {}),
  });
  args.on_progress?.({ id: args.task.component, status: 'running', phase: 'verifying', strategy: args.task.strategy });
  const evidence = parseStageOutput(result.stdout);
  args.on_progress?.({
    id: args.task.component,
    status: 'succeeded',
    phase: 'ready',
    strategy: args.task.strategy,
    completed_bytes: evidence.archive_size_bytes,
    total_bytes: evidence.archive_size_bytes,
  });
  return { task: args.task, staging_id: evidence.staging_root, evidence, value: evidence };
}

export async function activateManagedComponentBatch(
  executor: RuntimeHostAccessExecutor,
  placement: DesktopRuntimePlacement,
  targetRoot: string,
  batch: import('./managedComponentBatchInstaller').PreparedComponentBatch,
  mode: 'wipe_data' | 'preserve_data',
): Promise<void> {
  const components = new Map(batch.suite_manifest.components.map((entry) => [entry.component, entry]));
  const gateway = components.get('gateway');
  const runtime = components.get('runtime');
  if (!gateway || !runtime) throw new Error('Managed component suite is incomplete.');
  await executor.run(commandForPlacement(placement, activateScript, [
    targetRoot,
    batch.operation_id,
    mode,
    batch.suite_manifest.release_tag,
    batch.suite_manifest.commit,
    batch.suite_manifest.platform,
    batch.suite_manifest.architecture,
    gateway.archive_sha256,
    runtime.archive_sha256,
  ]));
}

export async function rollbackManagedComponentBatch(
  executor: RuntimeHostAccessExecutor,
  placement: DesktopRuntimePlacement,
  targetRoot: string,
  operationID: string,
): Promise<void> {
  await executor.run(commandForPlacement(placement, rollbackScript, [targetRoot, operationID]));
}

export async function cleanupManagedComponentBatch(
  executor: RuntimeHostAccessExecutor,
  placement: DesktopRuntimePlacement,
  targetRoot: string,
  operationID: string,
): Promise<void> {
  await executor.run(commandForPlacement(placement, cleanupScript, [targetRoot, operationID]));
}

export async function startManagedComponentBatch(
  executor: RuntimeHostAccessExecutor,
  placement: DesktopRuntimePlacement,
  targetRoot: string,
  stateRoot: string,
  operationID: string,
  releaseTag: string,
  commit: string,
  runtimeExecutableSHA256: string,
): Promise<void> {
  const script = [
    'set -eu',
    'target_root="$1"',
    'state_root="$2"',
    'operation_id="$3"',
    'release_tag="$4"',
    'commit="$5"',
    'runtime_sha="$6"',
    'gateway="$target_root/gateway/managed/bin/redeven-gateway"',
    '[ -x "$gateway" ] || { echo "activated Gateway is missing" >&2; exit 30; }',
    'exec "$gateway" service-start --mode managed_environment --state-root "$state_root" --runtime-root "$target_root" --activated-runtime-operation-id "$operation_id" --activated-runtime-version "$release_tag" --activated-runtime-commit "$commit" --activated-runtime-sha256 "$runtime_sha" --enable-profile-write',
  ].join('\n');
  await executor.run(commandForPlacement(placement, script, [targetRoot, stateRoot, operationID, releaseTag, commit, runtimeExecutableSHA256]));
}
