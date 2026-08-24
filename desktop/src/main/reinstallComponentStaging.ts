import { createHash } from 'node:crypto';

import type { DesktopRuntimePlacement } from '../shared/desktopRuntimePlacement';
import { containerRuntimeExecCommand } from './containerRuntime';
import type { ManagedComponentTask, ManagedComponentTaskProgress, PreparedComponent, PreparedComponentBatch } from './managedComponentBatchInstaller';
import {
  DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS,
  DEFAULT_RUNTIME_HOST_TRANSFER_TIMEOUT_MS,
  type RuntimeHostAccessExecutor,
} from './runtimeHostAccess';

function commandForPlacement(placement: DesktopRuntimePlacement, script: string, args: readonly string[]): readonly string[] {
  const argv = ['sh', '-c', script, 'redeven-runtime-stage', ...args];
  return placement.kind === 'host_process' ? argv : containerRuntimeExecCommand({ engine: placement.container_engine, container_id: placement.container_id, argv });
}

const stageScript = [
  'set -eu',
  'target_root="$1"; operation_id="$2"; release_tag="$3"; expected_commit="$4"; expected_sha="$5"; expected_size="$6"; strategy="$7"; remote_url="${8:-}"; platform="${9:-}"',
  'case "$target_root" in /*) ;; *) echo "target root must be absolute" >&2; exit 3 ;; esac',
  'stage="${target_root}.redeven-staging-${operation_id}-runtime"; [ ! -L "$stage" ] || { echo "staging root is a symbolic link" >&2; exit 4; }; rm -rf -- "$stage"; mkdir -p "$stage/payload/bin"',
  'archive="$stage/package.tar.gz"; if [ "$strategy" = remote_install ]; then curl -fsSL "$remote_url" -o "$archive"; else cat > "$archive"; fi',
  'if command -v sha256sum >/dev/null 2>&1; then actual_sha="$(sha256sum "$archive" | awk "{print \\$1}")"; else actual_sha="$(shasum -a 256 "$archive" | awk "{print \\$1}")"; fi',
  '[ "$actual_sha" = "$expected_sha" ] || { echo "package hash mismatch" >&2; exit 5; }; actual_size="$(wc -c < "$archive" | tr -d " \\n")"; [ "$expected_size" = 0 ] || [ "$actual_size" = "$expected_size" ] || { echo "package size mismatch" >&2; exit 6; }',
  'extract="$stage/extract"; mkdir -p "$extract"; tar --warning=no-unknown-keyword -xzf "$archive" -C "$extract" 2>/dev/null || tar -xzf "$archive" -C "$extract"',
  'binary="$extract/redeven"; [ -x "$binary" ] || { echo "Runtime package binary is missing or not executable" >&2; exit 7; }; version_output="$($binary version 2>/dev/null)"',
  'if command -v sha256sum >/dev/null 2>&1; then executable_sha="$(sha256sum "$binary" | awk "{print \\$1}")"; else executable_sha="$(shasum -a 256 "$binary" | awk "{print \\$1}")"; fi',
  'set -- $version_output; [ "${1:-}" = redeven ] || { echo "Runtime package product mismatch" >&2; exit 8; }; reported_release="${2:-}"; reported_commit="${3:-}"; reported_commit="${reported_commit#(}"; reported_commit="${reported_commit%)}"',
  'case "$reported_release" in v*) ;; *) reported_release="v$reported_release" ;; esac; case "$release_tag" in v*) ;; *) release_tag="v$release_tag" ;; esac; [ "$reported_release" = "$release_tag" ] || { echo "package release mismatch" >&2; exit 9; }; [ "$reported_commit" = "$expected_commit" ] || { echo "package commit mismatch" >&2; exit 10; }',
  'cp "$binary" "$stage/payload/bin/redeven"; chmod 700 "$stage/payload/bin/redeven"',
  'if [ "$platform" = linux ]; then for companion in .redevplugin-release-artifacts-verified.json REDEVPLUGIN_THIRD_PARTY_NOTICES.md REDEVPLUGIN_RUNTIME.spdx.json redevplugin-runtime.provenance.json redevplugin-runtime.sig redevplugin-runtime.pem redevplugin-runtime; do [ -e "$extract/$companion" ] || { echo "Runtime package companion is missing: $companion" >&2; exit 11; }; cp "$extract/$companion" "$stage/payload/bin/$companion"; done; chmod 700 "$stage/payload/bin/redevplugin-runtime"; fi',
  '{ printf "component=runtime\\nrelease_tag=%s\\ncommit=%s\\nplatform=%s\\narchitecture=%s\\narchive_sha256=%s\\nexecutable_sha256=%s\\n" "$release_tag" "$reported_commit" "$platform" "${10:-}" "$actual_sha" "$executable_sha"; } > "$stage/component.manifest"; rm -rf -- "$extract" "$archive"',
  'printf "staging_root=%s\\narchive_sha256=%s\\narchive_size_bytes=%s\\nexecutable_sha256=%s\\nreported_release_tag=%s\\nreported_commit=%s\\n" "$stage" "$actual_sha" "$actual_size" "$executable_sha" "$reported_release" "$reported_commit"',
].join('\n');

const activateScript = [
  'set -eu; target_root="$1"; operation_id="$2"; mode="$3"; runtime_stage="${target_root}.redeven-staging-${operation_id}-runtime/payload"; [ -d "$runtime_stage" ] || { echo "Runtime staging is incomplete" >&2; exit 20; }',
  'runtime_live="$target_root/runtime/managed"; rollback_root="$target_root/.managed-runtime-rollback-${operation_id}"; committed_root="$target_root/.managed-runtime-committed-${operation_id}"; mkdir -p "$target_root/runtime"',
  'restore_item() { live="$1"; backup="$2"; absent="$3"; if [ -e "$backup" ] || [ -L "$backup" ]; then rm -rf -- "$live"; mv "$backup" "$live"; elif [ -e "$absent" ]; then rm -rf -- "$live"; fi; }; restore_rollback() { [ -d "$rollback_root" ] || return 0; restore_item "$runtime_live" "$rollback_root/runtime" "$rollback_root/runtime.absent"; rm -rf -- "$rollback_root"; }',
  'if [ -e "$committed_root" ] || [ -L "$committed_root" ]; then rm -rf -- "$committed_root"; fi; if [ "$mode" = preserve_data ]; then restore_rollback; mkdir "$rollback_root"; if [ -e "$runtime_live" ] || [ -L "$runtime_live" ]; then mv "$runtime_live" "$rollback_root/runtime"; else : > "$rollback_root/runtime.absent"; fi; fi',
  'rm -rf -- "$runtime_live"; mv "$runtime_stage" "$runtime_live"; chmod 700 "$runtime_live" "$runtime_live/bin"',
].join('\n');

const rollbackScript = [
  'set -eu; target_root="$1"; operation_id="$2"; runtime_live="$target_root/runtime/managed"; rollback_root="$target_root/.managed-runtime-rollback-${operation_id}"; committed_root="$target_root/.managed-runtime-committed-${operation_id}"; [ ! -e "$committed_root" ] || { echo "Runtime replacement is already committed" >&2; exit 26; }; [ -d "$rollback_root" ] || exit 0',
  'if [ -e "$rollback_root/runtime" ] || [ -L "$rollback_root/runtime" ]; then rm -rf -- "$runtime_live"; mv "$rollback_root/runtime" "$runtime_live"; elif [ -e "$rollback_root/runtime.absent" ]; then rm -rf -- "$runtime_live"; fi; rm -rf -- "$rollback_root"',
].join('\n');

const cleanupScript = [
  'set -eu; target_root="$1"; operation_id="$2"; rollback_root="$target_root/.managed-runtime-rollback-${operation_id}"; committed_root="$target_root/.managed-runtime-committed-${operation_id}"; if [ -e "$rollback_root" ] || [ -L "$rollback_root" ]; then rm -rf -- "$committed_root"; mv "$rollback_root" "$committed_root"; fi; rm -rf -- "${target_root}.redeven-staging-${operation_id}-runtime" "$committed_root"',
].join('\n');

function values(raw: string): ReadonlyMap<string, string> {
  return new Map(String(raw).split(/\r?\n/u).flatMap((line) => { const index = line.indexOf('='); return index > 0 ? [[line.slice(0, index), line.slice(index + 1)] as const] : []; }));
}

function parseStageOutput(raw: string): PreparedComponent['evidence'] & Readonly<{ staging_root: string }> {
  const parsed = values(raw);
  const evidence = { staging_root: parsed.get('staging_root') ?? '', archive_sha256: parsed.get('archive_sha256') ?? '', archive_size_bytes: Number(parsed.get('archive_size_bytes') ?? ''), executable_sha256: parsed.get('executable_sha256') ?? '', reported_release_tag: parsed.get('reported_release_tag') ?? '', reported_commit: parsed.get('reported_commit') ?? '' };
  if (!evidence.staging_root || !/^[a-f0-9]{64}$/u.test(evidence.archive_sha256) || !/^[a-f0-9]{64}$/u.test(evidence.executable_sha256) || !Number.isSafeInteger(evidence.archive_size_bytes) || evidence.archive_size_bytes <= 0 || !evidence.reported_release_tag || !evidence.reported_commit) throw new Error('Target returned invalid Runtime staging evidence.');
  return evidence;
}

export async function stageManagedComponent(args: Readonly<{ executor: RuntimeHostAccessExecutor; placement: DesktopRuntimePlacement; target_root: string; operation_id: string; task: ManagedComponentTask; archive?: Buffer; archive_sha256: string; archive_size_bytes?: number; remote_url?: string; signal?: AbortSignal; on_progress?: (progress: ManagedComponentTaskProgress) => void }>): Promise<PreparedComponent> {
  args.on_progress?.({ id: args.task.component, status: 'running', phase: 'transferring', strategy: args.task.strategy });
  const digest = args.archive ? createHash('sha256').update(args.archive).digest('hex') : args.archive_sha256;
  if (digest !== args.archive_sha256) throw new Error('Runtime archive digest changed before transfer.');
  const result = await args.executor.run(commandForPlacement(args.placement, stageScript, [args.target_root, args.operation_id, args.task.release_tag, args.task.commit, args.archive_sha256, String(args.archive_size_bytes ?? args.archive?.byteLength ?? 0), args.task.strategy, args.remote_url ?? '-', args.task.platform, args.task.architecture]), { ...(args.archive ? { stdinData: args.archive } : {}), ...(args.signal ? { signal: args.signal } : {}), timeout_ms: DEFAULT_RUNTIME_HOST_TRANSFER_TIMEOUT_MS });
  args.on_progress?.({ id: args.task.component, status: 'running', phase: 'verifying', strategy: args.task.strategy });
  const evidence = parseStageOutput(result.stdout);
  args.on_progress?.({ id: args.task.component, status: 'succeeded', phase: 'ready', strategy: args.task.strategy, completed_bytes: evidence.archive_size_bytes, total_bytes: evidence.archive_size_bytes });
  return { task: args.task, staging_id: evidence.staging_root, evidence, value: evidence };
}

export async function activateManagedComponentBatch(executor: RuntimeHostAccessExecutor, placement: DesktopRuntimePlacement, targetRoot: string, batch: PreparedComponentBatch, mode: 'wipe_data' | 'preserve_data', signal?: AbortSignal): Promise<void> {
  const runtime = batch.runtime_manifest.components.find((entry) => entry.component === 'runtime');
  if (!runtime) throw new Error('Managed Runtime component is unavailable.');
  await executor.run(commandForPlacement(placement, activateScript, [targetRoot, batch.operation_id, mode]), { ...(signal ? { signal } : {}), timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS });
}

export async function rollbackManagedComponentBatch(executor: RuntimeHostAccessExecutor, placement: DesktopRuntimePlacement, targetRoot: string, operationID: string, signal?: AbortSignal): Promise<void> { await executor.run(commandForPlacement(placement, rollbackScript, [targetRoot, operationID]), { ...(signal ? { signal } : {}), timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS }); }
export async function cleanupManagedComponentBatch(executor: RuntimeHostAccessExecutor, placement: DesktopRuntimePlacement, targetRoot: string, operationID: string, signal?: AbortSignal): Promise<void> { await executor.run(commandForPlacement(placement, cleanupScript, [targetRoot, operationID]), { ...(signal ? { signal } : {}), timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS }); }

export async function startManagedComponentBatch(executor: RuntimeHostAccessExecutor, placement: DesktopRuntimePlacement, targetRoot: string, stateRoot: string, _operationID: string, _releaseTag: string, _commit: string, _runtimeExecutableSHA256: string, signal?: AbortSignal): Promise<void> {
  const script = 'set -eu; target_root="$1"; state_root="$2"; binary="$target_root/runtime/managed/bin/redeven"; [ -x "$binary" ] || { echo "installed Runtime is missing" >&2; exit 30; }; if command -v setsid >/dev/null 2>&1; then setsid "$binary" run --state-root "$state_root" --mode desktop --presentation machine --local-ui-bind 127.0.0.1:0 </dev/null >/dev/null 2>&1 & else nohup "$binary" run --state-root "$state_root" --mode desktop --presentation machine --local-ui-bind 127.0.0.1:0 </dev/null >/dev/null 2>&1 & fi';
  await executor.run(commandForPlacement(placement, script, [targetRoot, stateRoot]), { ...(signal ? { signal } : {}), timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS });
}
