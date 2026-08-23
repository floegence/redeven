import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  containerInspectCommand,
  containerRuntimeExecCommand,
  parseContainerInspectJSON,
} from './containerRuntime';
import type { RuntimeHostAccessExecutor } from './runtimeHostAccess';
import type { DesktopComponentTaskProgress } from '../shared/desktopLauncherIPC';
import type { PreparedComponentBatch } from './managedComponentBatchInstaller';
import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import {
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  desktopSSHAuthority,
} from '../shared/desktopSSH';
import { runtimeLifecycleTargetKey } from './runtimeLifecycleCoordinator';
import type { DesktopSSHRemotePlatform } from './sshReleaseAssets';
import {
  REINSTALL_TARGET_JOURNAL_PHASES,
  reinstallTargetStepProgress,
  type ReinstallTargetJournalPhase,
  type ReinstallTargetProgressPhase,
} from '../shared/desktopReinstallProgress';

export type ReinstallTargetMode = 'wipe_data' | 'preserve_data';

const PREFLIGHT_TTL_MS = 10 * 60 * 1_000;

export type ReinstallTargetSubject = Readonly<{
  environment_id: string;
  operation_key?: string;
  mode?: ReinstallTargetMode;
}>;

export type ReinstallTargetDescriptor = Readonly<{
  environment_id: string;
  label: string;
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  ssh_password?: string;
  affected_environment_ids: readonly string[];
}>;

export type ReinstallTargetProcess = Readonly<{
  pid: number;
  parent_pid?: number;
  process_started_at_unix_ms: number;
  role: string;
  executable_path: string;
  identity_status: 'verified' | 'incomplete';
  stop_authority: 'automatic' | 'blocked';
  reason_code?: string;
}>;

export type ReinstallTargetProcessInventory = Readonly<{
  schema_version: 1;
  target_root: string;
  inventory_digest: string;
  instances: readonly ReinstallTargetProcess[];
  summary: Readonly<{ automatic: number; blocked: number }>;
}>;

export type ReinstallTargetPlatform = DesktopSSHRemotePlatform;

export type ReinstallTargetPreview = Readonly<{
  preflight_id: string;
  operation_key: string;
  environment_id: string;
  label: string;
  target_kind: 'local_host' | 'ssh_host' | 'local_container' | 'ssh_container';
  host_label: string;
  container_id?: string;
  container_engine?: string;
  target_root: string;
  target_exists: boolean;
  affected_environment_ids: readonly string[];
  processes: readonly ReinstallTargetProcess[];
  deleted_data_keys: readonly ReinstallTargetDeletedDataKey[];
  expires_at_unix_ms: number;
  mode: ReinstallTargetMode;
  target_exists_known: boolean;
}>;

export type ReinstallTargetDeletedDataKey =
  | 'gateway_runtime_managed_packages'
  | 'workspace_projects_application_data'
  | 'floret_redevplugin_data'
  | 'trust_identity_catalog_environment_config';

export type ReinstallTargetJournal = Readonly<{
  schema_version: 1;
  preflight_id: string;
  operation_id: string;
  environment_id: string;
  descriptor_fingerprint: string;
  physical_target_fingerprint: string;
  target_root: string;
  quarantine_root: string;
  target_existed: boolean;
  phase: ReinstallTargetJournalPhase;
  affected_environment_ids: readonly string[];
  preview: ReinstallTargetPreview;
  updated_at_unix_ms: number;
}>;

export { reinstallTargetStepProgress };

type CachedPreflight = Readonly<{
  descriptor: ReinstallTargetDescriptor;
  descriptorFingerprint: string;
  physicalTargetFingerprint: string;
  preview: ReinstallTargetPreview;
  operationID: string;
}>;

export type ReinstallTargetCoordinatorDependencies = Readonly<{
  journal_root: string;
  resolve_target: (subject: ReinstallTargetSubject) => Promise<ReinstallTargetDescriptor>;
  resolve_candidates: () => Promise<readonly ReinstallTargetDescriptor[]>;
  create_executor: (descriptor: ReinstallTargetDescriptor) => RuntimeHostAccessExecutor;
  prepare_platform: (
    descriptor: ReinstallTargetDescriptor,
    executor: RuntimeHostAccessExecutor,
  ) => Promise<ReinstallTargetPlatform>;
  prepare_process_session: (
    descriptor: ReinstallTargetDescriptor,
    targetRoot: string,
    executor: RuntimeHostAccessExecutor,
    platform: ReinstallTargetPlatform,
  ) => Promise<
    Readonly<{
      inspect: () => Promise<ReinstallTargetProcessInventory>;
      stop: (inventory: ReinstallTargetProcessInventory) => Promise<ReinstallTargetProcessInventory>;
      close: () => Promise<void>;
    }>
  >;
  mark_in_progress: (descriptor: ReinstallTargetDescriptor, preflightID: string) => Promise<void>;
  close_sessions: (descriptor: ReinstallTargetDescriptor) => Promise<void>;
  clear_desktop_state: (descriptor: ReinstallTargetDescriptor) => Promise<void>;
  prepare_packages?: (
    descriptor: ReinstallTargetDescriptor,
    targetRoot: string,
    operationID: string,
    executor: RuntimeHostAccessExecutor,
    platform: ReinstallTargetPlatform,
    onProgress?: (tasks: readonly DesktopComponentTaskProgress[]) => void,
  ) => Promise<PreparedComponentBatch | null>;
  install_fresh: (
    descriptor: ReinstallTargetDescriptor,
    targetRoot: string,
    onProgress?: (phase: ReinstallTargetProgressPhase, detailKey?: string, tasks?: readonly DesktopComponentTaskProgress[]) => Promise<void>,
    mode?: ReinstallTargetMode,
    preparedBatch?: PreparedComponentBatch | null,
  ) => Promise<void>;
  finalize_install?: (
    descriptor: ReinstallTargetDescriptor,
    targetRoot: string,
    preparedBatch: PreparedComponentBatch,
  ) => Promise<void>;
  rollback_install?: (
    descriptor: ReinstallTargetDescriptor,
    targetRoot: string,
    preparedBatch: PreparedComponentBatch,
  ) => Promise<void>;
  verify_fresh_identity: (descriptor: ReinstallTargetDescriptor, targetRoot: string) => Promise<void>;
  verify_catalog_and_local_ui: (descriptor: ReinstallTargetDescriptor, targetRoot: string) => Promise<void>;
  clear_completed_marker: (descriptor: ReinstallTargetDescriptor) => Promise<void>;
}>;

export class ReinstallTargetCoordinatorError extends Error {
  constructor(
    readonly code:
      | 'reinstall_unsupported'
      | 'reinstall_blocked'
      | 'reinstall_retryable'
      | 'preflight_expired'
      | 'target_changed'
      | 'manual_recovery_required',
    message: string,
    options: Readonly<{ cause?: unknown }> = {},
  ) {
    super(message);
    this.name = 'ReinstallTargetCoordinatorError';
    this.cause = options.cause;
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function isRemoteDefaultRootAlias(value: string): boolean {
  return value === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT || value === '~/.redeven';
}

function descriptorPlacementForFingerprint(
  descriptor: ReinstallTargetDescriptor,
): DesktopRuntimePlacement {
  if (
    descriptor.host_access.kind === 'ssh_host'
    && isRemoteDefaultRootAlias(descriptor.placement.runtime_root)
  ) {
    return {
      ...descriptor.placement,
      runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
    };
  }
  return descriptor.placement;
}

function registeredRootsMatch(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  return isRemoteDefaultRootAlias(left) && isRemoteDefaultRootAlias(right);
}

export function reinstallTargetDescriptorFingerprint(descriptor: ReinstallTargetDescriptor): string {
  // Reinstall authorization is tied only to the registered target coordinate.
  // Release strategy, state probes, labels, and other mutable runtime metadata
  // must never turn a confirmed recovery into a false target-change failure.
  const placement = descriptorPlacementForFingerprint(descriptor);
  const root = placement.kind === 'host_process' || placement.kind === 'container_process'
    ? placement.runtime_root
    : '';
  const identity = descriptor.host_access.kind === 'ssh_host'
    ? ['ssh', desktopSSHAuthority(descriptor.host_access.ssh)]
    : ['local'];
  identity.push(placement.kind, compact(root));
  if (placement.kind === 'container_process') {
    identity.push(placement.container_engine, placement.container_id);
  }
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function legacyReinstallTargetDescriptorFingerprint(descriptor: ReinstallTargetDescriptor): string {
  return crypto.createHash('sha256').update(runtimeLifecycleTargetKey(
    descriptor.host_access,
    descriptorPlacementForFingerprint(descriptor),
  )).digest('hex');
}

function reinstallPhysicalTargetFingerprint(
  descriptor: ReinstallTargetDescriptor,
  canonicalTargetRoot: string,
): string {
  const fingerprintRoot = isRemoteDefaultRootAlias(canonicalTargetRoot)
    ? '<remote-default-root>'
    : canonicalTargetRoot;
  return crypto.createHash('sha256').update(runtimeLifecycleTargetKey(
    descriptor.host_access,
    { ...descriptor.placement, runtime_root: fingerprintRoot },
  )).digest('hex');
}

function reinstallTargetAuthorityKey(descriptor: ReinstallTargetDescriptor): string {
  const host = descriptor.host_access.kind === 'ssh_host'
    ? `ssh:${desktopSSHAuthority(descriptor.host_access.ssh)}`
    : 'local';
  return descriptor.placement.kind === 'container_process'
    ? `${host}:container:${descriptor.placement.container_engine}:${descriptor.placement.container_id}`
    : `${host}:host`;
}

function targetKind(descriptor: ReinstallTargetDescriptor): ReinstallTargetPreview['target_kind'] {
  if (descriptor.host_access.kind === 'local_host') {
    return descriptor.placement.kind === 'container_process' ? 'local_container' : 'local_host';
  }
  return descriptor.placement.kind === 'container_process' ? 'ssh_container' : 'ssh_host';
}

function hostLabel(descriptor: ReinstallTargetDescriptor): string {
  return descriptor.host_access.kind === 'ssh_host'
    ? descriptor.host_access.ssh.ssh_destination
    : 'local_device';
}

async function validateRegisteredContainer(
  descriptor: ReinstallTargetDescriptor,
  executor: RuntimeHostAccessExecutor,
): Promise<void> {
  if (descriptor.placement.kind !== 'container_process') {
    return;
  }
  const inspected = parseContainerInspectJSON(
    descriptor.placement.container_engine,
    (await executor.run(containerInspectCommand(
      descriptor.placement.container_engine,
      descriptor.placement.container_id,
    ))).stdout,
  );
  if (inspected.container_id !== descriptor.placement.container_id) {
    throw new ReinstallTargetCoordinatorError('target_changed', 'The registered container identity changed.');
  }
}

function placementCommand(
  placement: DesktopRuntimePlacement,
  script: string,
  args: readonly string[],
): readonly string[] {
  if (placement.kind === 'host_process') {
    return ['sh', '-c', script, 'redeven-reinstall-target', ...args];
  }
  return containerRuntimeExecCommand({
    engine: placement.container_engine,
    container_id: placement.container_id,
    argv: ['sh', '-c', script, 'redeven-reinstall-target', ...args],
  });
}

const targetPreflightScript = [
  'set -eu',
  'raw="$1"',
  'default_root_token="$2"',
  'if [ "$raw" = "$default_root_token" ]; then raw="${HOME%/}/.redeven"; fi',
  'case "$raw" in',
  '  "~") raw="${HOME:-}" ;;',
  '  "~/"*) raw="${HOME%/}/${raw#??}" ;;',
  'esac',
  'case "$raw" in /*) ;; *) echo "runtime root must be absolute" >&2; exit 40 ;; esac',
  '[ "$raw" != "/" ] || { echo "runtime root is too broad" >&2; exit 40; }',
  'case "$raw" in *"\\n"*|*"\\r"*) echo "runtime root must be one line" >&2; exit 40 ;; esac',
  'parent=$(dirname -- "$raw")',
  'base=$(basename -- "$raw")',
  '[ "$base" != "/" ] || { echo "runtime root is too broad" >&2; exit 40; }',
  '[ -d "$parent" ] || { echo "runtime root parent does not exist" >&2; exit 40; }',
  'parent=$(cd -P -- "$parent" && pwd)',
  'target="${parent%/}/$base"',
  'home=$(cd -P -- "${HOME:?HOME is unavailable}" && pwd)',
  '[ "$target" != "/" ] && [ "$target" != "$home" ] || { echo "runtime root is too broad" >&2; exit 40; }',
  '[ ! -L "$target" ] || { echo "runtime root is a symbolic link" >&2; exit 41; }',
  'exists=0',
  'if [ -e "$target" ]; then [ -d "$target" ] || { echo "runtime root is not a directory" >&2; exit 41; }; exists=1; fi',
  'printf "%s\\n%s\\n%s\\n" "$target" "$exists" "$home"',
].join('\n');

const isolateTargetScript = [
  'set -eu',
  'target="$1"',
  'quarantine="$2"',
  '[ ! -L "$target" ] || { echo "runtime root became a symbolic link" >&2; exit 41; }',
  '# A previous interrupted reinstall is recoverable data, not a new target.',
  'if [ -e "$quarantine" ] || [ -L "$quarantine" ]; then rm -rf -- "$quarantine"; fi',
  'if [ -e "$target" ]; then',
  '  [ -d "$target" ] || { echo "runtime root is not a directory" >&2; exit 41; }',
  '  mv -- "$target" "$quarantine"',
  'fi',
  'mkdir -- "$target"',
  'chmod 700 "$target" 2>/dev/null || true',
].join('\n');

const cleanupQuarantineScript = [
  'set -eu',
  'target="$1"',
  'quarantine="$2"',
  'case "$quarantine" in "$target".redeven-quarantine-*) ;; *) echo "quarantine does not match target" >&2; exit 40 ;; esac',
  '[ ! -L "$quarantine" ] || { echo "quarantine became a symbolic link" >&2; exit 41; }',
  'if [ -e "$quarantine" ]; then [ -d "$quarantine" ] || exit 41; rm -rf -- "$quarantine"; fi',
].join('\n');

function parsePreflightOutput(stdout: string): Readonly<{ root: string; exists: boolean; home?: string }> {
  const lines = String(stdout ?? '').split(/\r?\n/u);
  const root = compact(lines[0]);
  if (!root.startsWith('/') || (lines[1] !== '0' && lines[1] !== '1')) {
    throw new ReinstallTargetCoordinatorError('reinstall_blocked', 'Desktop received an invalid target preflight result.');
  }
  const home = compact(lines[2]);
  return {
    root,
    exists: lines[1] === '1',
    ...(home.startsWith('/') ? { home } : {}),
  };
}

async function confirmedRootMatches(
  descriptor: ReinstallTargetDescriptor,
  expected: string,
  actual: string,
  resolvedHome?: string,
): Promise<boolean> {
  if (expected === actual) {
    return true;
  }
  if (path.resolve(expected) === path.resolve(actual)) {
    return true;
  }
  // Local macOS paths such as /var and /private/var are aliases. Resolve only
  // the local filesystem; remote roots remain exact strings from the target.
  if (descriptor.host_access.kind === 'local_host') {
    try {
      return (await fs.realpath(expected)) === (await fs.realpath(actual));
    } catch {
      try {
        return path.basename(expected) === path.basename(actual)
          && (await fs.realpath(path.dirname(expected))) === (await fs.realpath(path.dirname(actual)));
      } catch {
        return false;
      }
    }
  }
  // SSH stores the default root as a logical token because the remote home
  // directory is unknown until the confirmed account runs the maintenance
  // helper. The helper resolves this token, so an absolute `.../.redeven`
  // result is the same registered target, not a target change.
  const defaultAlias = isRemoteDefaultRootAlias(expected);
  if (defaultAlias && resolvedHome) {
    return actual === `${resolvedHome.replace(/\/+$/u, '')}/.redeven`;
  }
  return defaultAlias
    && actual.startsWith('/')
    && actual !== '/.redeven'
    && path.posix.basename(actual) === '.redeven';
}

function journalFile(root: string, preflightID: string): string {
  return path.join(root, `${preflightID}.json`);
}

export class ReinstallTargetCoordinator {
  private readonly preflights = new Map<string, CachedPreflight>();
  private readonly locks = new Set<string>();

  constructor(private readonly dependencies: ReinstallTargetCoordinatorDependencies) {}

  private async descriptorWithCanonicalAffectedTargets(
    descriptor: ReinstallTargetDescriptor,
    canonicalTargetRoot: string,
    executor: RuntimeHostAccessExecutor,
  ): Promise<ReinstallTargetDescriptor> {
    const authorityKey = reinstallTargetAuthorityKey(descriptor);
    const affected = new Set<string>();
    for (const candidate of await this.dependencies.resolve_candidates()) {
      if (reinstallTargetAuthorityKey(candidate) !== authorityKey) {
        continue;
      }
      try {
        const resolved = parsePreflightOutput((await executor.run(placementCommand(
          candidate.placement,
          targetPreflightScript,
          [candidate.placement.runtime_root, DEFAULT_DESKTOP_SSH_RUNTIME_ROOT],
        ))).stdout);
        if (resolved.root === canonicalTargetRoot) {
          affected.add(candidate.environment_id);
        }
      } catch {
        // An unrelated invalid target on the same host must not widen or block
        // the selected exact root. The selected target is validated separately.
      }
    }
    affected.add(descriptor.environment_id);
    return {
      ...descriptor,
      affected_environment_ids: [...affected].sort(),
    };
  }

  async preview(subject: ReinstallTargetSubject): Promise<ReinstallTargetPreview> {
    const descriptor = await this.dependencies.resolve_target(subject);
    if (!descriptor.placement.runtime_root) {
      throw new ReinstallTargetCoordinatorError('reinstall_unsupported', 'This environment has no independent Desktop-managed runtime root.');
    }
    // Preview is deliberately local-only. The user must see and acknowledge
    // the destructive action before Desktop connects to a host/container or
    // reads any old Redeven state.
    const rawRoot = compact(descriptor.placement.runtime_root);
    const targetRoot = rawRoot === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT ? rawRoot : rawRoot;
    const resolvedDescriptor: ReinstallTargetDescriptor = {
      ...descriptor,
      affected_environment_ids: (await this.dependencies.resolve_candidates())
        .filter((candidate) => (
          reinstallTargetAuthorityKey(candidate) === reinstallTargetAuthorityKey(descriptor)
          && registeredRootsMatch(compact(candidate.placement.runtime_root), rawRoot)
        ))
        .map((candidate) => candidate.environment_id)
        .concat(descriptor.environment_id)
        .filter((id, index, all) => all.indexOf(id) === index)
        .sort(),
    };
    const preflightID = `reinstall_${crypto.randomUUID()}`;
    const operationKey = compact(subject.operation_key) || `reinstall-target:${preflightID}`;
    const operationID = crypto.randomUUID();
    const mode = subject.mode ?? 'wipe_data';
    const preview: ReinstallTargetPreview = {
      preflight_id: preflightID,
      operation_key: operationKey,
      environment_id: descriptor.environment_id,
      label: descriptor.label,
      target_kind: targetKind(descriptor),
      host_label: hostLabel(descriptor),
      ...(descriptor.placement.kind === 'container_process' ? {
        container_id: descriptor.placement.container_id,
        container_engine: descriptor.placement.container_engine,
      } : {}),
      target_root: targetRoot,
      target_exists: false,
      target_exists_known: false,
      affected_environment_ids: [...resolvedDescriptor.affected_environment_ids],
      processes: [],
      deleted_data_keys: mode === 'wipe_data'
        ? [
            'gateway_runtime_managed_packages',
            'workspace_projects_application_data',
            'floret_redevplugin_data',
            'trust_identity_catalog_environment_config',
          ]
        : ['gateway_runtime_managed_packages'],
      expires_at_unix_ms: Date.now() + PREFLIGHT_TTL_MS,
      mode,
    };
    const cached: CachedPreflight = {
      descriptor: resolvedDescriptor,
      descriptorFingerprint: reinstallTargetDescriptorFingerprint(descriptor),
      physicalTargetFingerprint: reinstallPhysicalTargetFingerprint(resolvedDescriptor, targetRoot),
      preview,
      operationID,
    };
    this.preflights.set(preflightID, cached);
    await this.removeSupersededConfirmationJournals(cached.physicalTargetFingerprint);
    await this.writeJournal({
      schema_version: 1,
      preflight_id: preflightID,
      operation_id: operationID,
      environment_id: descriptor.environment_id,
      descriptor_fingerprint: cached.descriptorFingerprint,
      physical_target_fingerprint: cached.physicalTargetFingerprint,
      target_root: targetRoot,
      quarantine_root: `${targetRoot}.redeven-quarantine-${operationID}`,
      target_existed: false,
      phase: 'confirmation',
      affected_environment_ids: [...resolvedDescriptor.affected_environment_ids],
      preview,
      updated_at_unix_ms: Date.now(),
    });
    return preview;
  }

  async execute(
    preflightID: string,
    operationKeyOrProgress?: string | ((phase: ReinstallTargetProgressPhase, detailKey?: string, tasks?: readonly DesktopComponentTaskProgress[]) => void),
    progressListener?: (phase: ReinstallTargetProgressPhase, detailKey?: string, tasks?: readonly DesktopComponentTaskProgress[]) => void,
  ): Promise<ReinstallTargetJournal> {
    const operationKey = typeof operationKeyOrProgress === 'string' ? operationKeyOrProgress : '';
    const onProgress = typeof operationKeyOrProgress === 'function' ? operationKeyOrProgress : progressListener;
    onProgress?.('target_locked');
    const cleanPreflightID = compact(preflightID);
    let persistedPhase: ReinstallTargetJournalPhase = 'confirmation';
    let cached = this.preflights.get(cleanPreflightID);
    if (!cached) {
      const journal = await this.readJournal(cleanPreflightID);
      persistedPhase = journal.phase;
      const descriptor = await this.dependencies.resolve_target({
        environment_id: journal.environment_id,
      });
      cached = {
        descriptor: {
          ...descriptor,
          affected_environment_ids: [...journal.affected_environment_ids],
        },
        descriptorFingerprint: journal.descriptor_fingerprint,
        physicalTargetFingerprint: journal.physical_target_fingerprint,
        preview: journal.preview,
        operationID: journal.operation_id,
      };
      this.preflights.set(cleanPreflightID, cached);
    }
    // A confirmed recovery remains executable after Desktop restart. The
    // journal is durable authority for the operation; its age never revives
    // old processes and never blocks direct cleanup of the exact target.
    if (compact(operationKey) !== '' && compact(operationKey) !== cached.preview.operation_key) {
      throw new ReinstallTargetCoordinatorError('target_changed', 'The reinstall operation does not match the confirmed target.');
    }
    if (persistedPhase === 'installation_verifying' || persistedPhase === 'cleanup') {
      const journal = await this.readJournal(cleanPreflightID);
      await this.resumeCompletion(cleanPreflightID, (phase) => onProgress?.(phase));
      return {
        ...journal,
        phase: 'cleanup',
        updated_at_unix_ms: Date.now(),
      };
    }
    const current = await this.dependencies.resolve_target({
      environment_id: cached.descriptor.environment_id,
    });
    const currentFingerprint = reinstallTargetDescriptorFingerprint(current);
    const legacyFingerprint = legacyReinstallTargetDescriptorFingerprint(current);
    if (currentFingerprint !== cached.descriptorFingerprint && legacyFingerprint !== cached.descriptorFingerprint) {
      throw new ReinstallTargetCoordinatorError('target_changed', 'The registered host, container, or runtime root changed after confirmation.');
    }
    onProgress?.('target_locked');
    let executor: RuntimeHostAccessExecutor | null = null;
    let lockKey = cached.physicalTargetFingerprint;
    let lockKeys: string[] = [];
    const operationID = cached.operationID;
    let quarantineRoot = `${cached.preview.target_root}.redeven-quarantine-${operationID}`;
    let isolated = false;
    let preparedBatch: PreparedComponentBatch | null = null;
    let processSession: Awaited<ReturnType<ReinstallTargetCoordinatorDependencies['prepare_process_session']>> | null =
      null;
    let targetPlatform: ReinstallTargetPlatform | null = null;
    let targetDisruptionStarted = false;
    let installAttempted = false;
    let installFinalized = false;
    let activeDescriptor: ReinstallTargetDescriptor = current;
    let activeTargetRoot = cached.preview.target_root;
    let currentJournal: ReinstallTargetJournal | null = {
      schema_version: 1,
      preflight_id: cached.preview.preflight_id,
      operation_id: operationID,
      environment_id: cached.descriptor.environment_id,
      descriptor_fingerprint: cached.descriptorFingerprint,
      physical_target_fingerprint: cached.physicalTargetFingerprint,
      target_root: cached.preview.target_root,
      quarantine_root: quarantineRoot,
      target_existed: cached.preview.target_exists,
      phase: 'target_locked',
      affected_environment_ids: [...cached.preview.affected_environment_ids],
      preview: cached.preview,
      updated_at_unix_ms: Date.now(),
    };
    const persistPhase = async (phase: ReinstallTargetProgressPhase, detailKey?: string, tasks?: readonly DesktopComponentTaskProgress[]): Promise<void> => {
      if (!currentJournal || phase === 'preflight' || phase === 'confirmation' || phase === 'completed') {
        onProgress?.(phase, detailKey, tasks);
        return;
      }
      currentJournal = {
        ...currentJournal,
        phase,
        updated_at_unix_ms: Date.now(),
      };
      await this.writeJournal(currentJournal);
      onProgress?.(phase, detailKey, tasks);
    };
    try {
      executor = this.dependencies.create_executor(current);
      // Container status and old service state are execution details. The
      // direct channel is the only prerequisite; failures are reported by the
      // concrete command that needs the target.
      await validateRegisteredContainer(current, executor).catch((error) => {
        if (error instanceof ReinstallTargetCoordinatorError && error.code === 'target_changed') {
          throw error;
        }
        return undefined;
      });
      const repeated = parsePreflightOutput((await executor.run(placementCommand(
        current.placement,
        targetPreflightScript,
        [current.placement.runtime_root, DEFAULT_DESKTOP_SSH_RUNTIME_ROOT, 'resume'],
      ))).stdout);
      if (!(await confirmedRootMatches(current, cached.preview.target_root, repeated.root, repeated.home))) {
        throw new ReinstallTargetCoordinatorError('target_changed', 'The runtime root changed after confirmation.');
      }
      quarantineRoot = `${repeated.root}.redeven-quarantine-${operationID}`;
      const currentResolved = await this.descriptorWithCanonicalAffectedTargets(current, repeated.root, executor);
      lockKey = reinstallPhysicalTargetFingerprint(currentResolved, repeated.root);
      lockKeys = [...new Set([cached.physicalTargetFingerprint, lockKey])];
      if (lockKeys.some((candidate) => this.locks.has(candidate))) {
        throw new ReinstallTargetCoordinatorError('reinstall_blocked', 'A reinstall is already running for this physical target.');
      }
      lockKeys.forEach((candidate) => this.locks.add(candidate));
      activeDescriptor = currentResolved;
      activeTargetRoot = repeated.root;
      // Candidate aliases can resolve to a different canonical spelling on
      // the target host. The exact descriptor and root checks above remain
      // authoritative; refresh affected records for the journal.
      currentJournal = {
        schema_version: 1,
        preflight_id: cached.preview.preflight_id,
        operation_id: operationID,
        environment_id: current.environment_id,
        descriptor_fingerprint: cached.descriptorFingerprint,
        physical_target_fingerprint: lockKey,
        target_root: repeated.root,
        quarantine_root: quarantineRoot,
        target_existed: repeated.exists,
        phase: 'target_locked',
        affected_environment_ids: [...currentResolved.affected_environment_ids],
        preview: cached.preview,
        updated_at_unix_ms: Date.now(),
      };
      await this.writeJournal(currentJournal);
      await persistPhase('preparing_maintenance_helper');
      targetPlatform = await this.dependencies.prepare_platform(currentResolved, executor);
      const processSessionTask = this.dependencies
        .prepare_process_session(currentResolved, repeated.root, executor, targetPlatform)
        .catch(() => null);
      const packageBatchTask = this.dependencies.prepare_packages?.(
        currentResolved,
        repeated.root,
        operationID,
        executor,
        targetPlatform,
        (tasks) => {
          onProgress?.('packages_preparing_and_transferring', undefined, tasks);
        },
      ) ?? Promise.resolve(null);
      // Helper and component package staging start together. Reinstall keeps
      // helper failure best-effort, while package failure remains non-destructive.
      processSession = await processSessionTask;
      await persistPhase('packages_preparing_and_transferring');
      preparedBatch = await packageBatchTask;
      await this.dependencies.mark_in_progress(currentResolved, cached.preview.preflight_id).catch(() => undefined);
      await this.dependencies.close_sessions(currentResolved).catch(() => undefined);
      await persistPhase('sessions_closed');
      let inventory: ReinstallTargetProcessInventory | null = null;
      try {
        inventory = await processSession?.inspect() ?? null;
      } catch {
        // A broken or unidentifiable old process is not a reason to preserve a
        // broken installation. Continue with the exact-root cleanup.
      }
      await persistPhase('redeven_processes_stop_attempted');
      if (inventory && inventory.instances.length > 0) {
        try {
          await processSession?.stop(inventory);
        } catch {
          // Best-effort stop. The subsequent filesystem operation is the
          // authority for whether this reinstall can proceed.
        }
      }
      if (cached.preview.mode === 'wipe_data') {
        // The move may partially succeed before the command reports an OS
        // error, so treat this boundary as destructive once it is attempted.
        targetDisruptionStarted = true;
        await executor.run(placementCommand(currentResolved.placement, isolateTargetScript, [repeated.root, quarantineRoot]));
        isolated = true;
      }
      await persistPhase('packages_applying');
      await persistPhase('gateway_and_runtime_starting');
      await this.dependencies.clear_desktop_state(currentResolved);
      const relayInstallProgress = async (
        phase: ReinstallTargetProgressPhase,
        detailKey?: string,
        tasks?: readonly DesktopComponentTaskProgress[],
      ): Promise<void> => {
        if (phase === 'packages_preparing_and_transferring') {
          onProgress?.(phase, detailKey, tasks);
          return;
        }
        await persistPhase(phase, detailKey, tasks);
      };
      installAttempted = true;
      await this.dependencies.install_fresh(currentResolved, repeated.root, relayInstallProgress, cached.preview.mode, preparedBatch);
      await this.dependencies.verify_fresh_identity(currentResolved, repeated.root);
      await this.dependencies.verify_catalog_and_local_ui(currentResolved, repeated.root);
      if (preparedBatch) {
        await this.dependencies.finalize_install?.(currentResolved, repeated.root, preparedBatch);
        installFinalized = true;
      }
      await persistPhase('installation_verifying');
      const verifiedJournal: ReinstallTargetJournal = {
        ...currentJournal,
        phase: 'installation_verifying',
        updated_at_unix_ms: Date.now(),
      };
      currentJournal = verifiedJournal;
      await this.writeJournal(verifiedJournal);
      if (isolated) {
        await executor.run(placementCommand(currentResolved.placement, cleanupQuarantineScript, [
          verifiedJournal.target_root,
          verifiedJournal.quarantine_root,
        ]));
      }
      const completedJournal: ReinstallTargetJournal = {
        ...verifiedJournal,
        phase: 'cleanup',
        updated_at_unix_ms: Date.now(),
      };
      currentJournal = completedJournal;
      await this.writeJournal(completedJournal);
      await persistPhase('cleanup');
      await this.dependencies.clear_completed_marker(currentResolved);
      await fs.rm(journalFile(this.dependencies.journal_root, cached.preview.preflight_id), { force: true });
      this.preflights.delete(cached.preview.preflight_id);
      onProgress?.('completed');
      return completedJournal;
    } catch (error) {
      let recoveryError: unknown = error;
      if (preparedBatch && !installFinalized) {
        let rollbackSucceeded = false;
        let freshProcessesStopped = false;
        if (installAttempted) {
          try {
            if (!executor) {
              throw new Error('The direct maintenance channel is unavailable for failure cleanup.');
            }
            const cleanupSession = processSession ?? await this.dependencies.prepare_process_session(
              activeDescriptor,
              activeTargetRoot,
              executor,
              targetPlatform ?? await this.dependencies.prepare_platform(activeDescriptor, executor),
            );
            processSession = cleanupSession;
            const freshInventory = await cleanupSession.inspect();
            const stoppedFresh = freshInventory.instances.length > 0
              ? await cleanupSession.stop(freshInventory)
              : freshInventory;
            if (stoppedFresh.instances.some((instance) => instance.stop_authority === 'automatic')) {
              throw new Error('Desktop could not stop every verified process from the new managed installation.');
            }
            freshProcessesStopped = true;
          } catch (stopError) {
            recoveryError = new AggregateError([recoveryError, stopError], 'Fresh Redeven processes could not be stopped after installation failure.');
          }
        }
        if (installAttempted && cached.preview.mode === 'preserve_data') {
          try {
            if (!freshProcessesStopped) {
              throw new Error('Fresh Redeven processes are still active; preserving the previous managed directories is unsafe.');
            }
            await this.dependencies.rollback_install?.(activeDescriptor, activeTargetRoot, preparedBatch);
            rollbackSucceeded = true;
          } catch (rollbackError) {
            recoveryError = new AggregateError([error, rollbackError], 'Fresh component verification failed and Desktop could not restore the previous managed directories.');
          }
        }
        if (cached.preview.mode !== 'preserve_data' || !installAttempted || rollbackSucceeded) {
          try {
            await this.dependencies.finalize_install?.(activeDescriptor, activeTargetRoot, preparedBatch);
            installFinalized = true;
          } catch (cleanupError) {
            recoveryError = new AggregateError([recoveryError, cleanupError], 'Desktop could not clean the component staging transaction.');
          }
        }
      }
      if (recoveryError instanceof ReinstallTargetCoordinatorError) {
        throw recoveryError;
      }
      if (!targetDisruptionStarted && !installAttempted && !isolated) {
        await this.dependencies.clear_completed_marker(activeDescriptor).catch(() => undefined);
        await fs.rm(journalFile(this.dependencies.journal_root, cached.preview.preflight_id), { force: true });
        this.preflights.delete(cached.preview.preflight_id);
        throw new ReinstallTargetCoordinatorError(
          'reinstall_retryable',
          `Redeven package preparation or process shutdown did not complete. The existing target was not replaced. ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
          { cause: recoveryError },
        );
      }
      throw new ReinstallTargetCoordinatorError(
        'manual_recovery_required',
        `Fresh Redeven installation failed. The previous installation will not be restarted automatically. ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
      );
    } finally {
      await processSession?.close().catch(() => undefined);
      await executor?.release();
      for (const candidate of lockKeys.length > 0 ? lockKeys : [lockKey]) {
        this.locks.delete(candidate);
      }
    }
  }

  async resumeCompletion(
    preflightID: string,
    onProgress?: (phase: Extract<ReinstallTargetProgressPhase, 'cleanup' | 'completed'>) => void,
  ): Promise<void> {
    const journal = await this.readJournal(preflightID);
    const selected = await this.dependencies.resolve_target({
      environment_id: journal.environment_id,
    });
    const descriptor = {
      ...selected,
      affected_environment_ids: [...journal.affected_environment_ids],
    };
    const selectedFingerprint = reinstallTargetDescriptorFingerprint(selected);
    const selectedLegacyFingerprint = legacyReinstallTargetDescriptorFingerprint(selected);
    if (
      selectedFingerprint !== journal.descriptor_fingerprint
      && selectedLegacyFingerprint !== journal.descriptor_fingerprint
    ) {
      throw new ReinstallTargetCoordinatorError('target_changed', 'The reinstall target changed before completion recovery.');
    }
    const executor = this.dependencies.create_executor(descriptor);
    try {
      if (
        journal.phase !== 'installation_verifying'
        && journal.phase !== 'cleanup'
      ) {
        throw new ReinstallTargetCoordinatorError(
          'manual_recovery_required',
          'The reinstall stopped before verification completed. The isolated old target was preserved for manual recovery.',
        );
      }
      const resolved = parsePreflightOutput((await executor.run(placementCommand(
        descriptor.placement,
        targetPreflightScript,
        [journal.target_root, DEFAULT_DESKTOP_SSH_RUNTIME_ROOT, 'resume'],
      ))).stdout);
      if (!(await confirmedRootMatches(descriptor, journal.target_root, resolved.root, resolved.home))) {
        throw new ReinstallTargetCoordinatorError('target_changed', 'The registered Redeven root changed before completion recovery.');
      }
      const resolvedQuarantineRoot = `${resolved.root}.redeven-quarantine-${journal.operation_id}`;
      const legacyAliasQuarantine = isRemoteDefaultRootAlias(journal.target_root)
        && journal.quarantine_root === `${journal.target_root}.redeven-quarantine-${journal.operation_id}`;
      if (journal.quarantine_root !== resolvedQuarantineRoot && !legacyAliasQuarantine) {
        throw new ReinstallTargetCoordinatorError('target_changed', 'The reinstall quarantine no longer matches the registered Redeven root.');
      }
      if (journal.phase === 'installation_verifying') {
        await executor.run(placementCommand(descriptor.placement, cleanupQuarantineScript, [
          resolved.root,
          resolvedQuarantineRoot,
        ]));
        await this.writeJournal({
          ...journal,
          phase: 'cleanup',
          updated_at_unix_ms: Date.now(),
        });
        onProgress?.('cleanup');
      }
      await this.dependencies.clear_completed_marker(descriptor);
      await fs.rm(journalFile(this.dependencies.journal_root, preflightID), {
        force: true,
      });
      onProgress?.('completed');
    } finally {
      await executor.release();
    }
  }

  /**
   * Read durable journals only. This never probes a target or executes an old
   * Gateway/Runtime binary. Invalid journals remain untouched for recovery.
   */
  async readPersistedJournals(): Promise<readonly ReinstallTargetJournal[]> {
    let entries: readonly string[];
    try {
      entries = await fs.readdir(this.dependencies.journal_root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    const journals: ReinstallTargetJournal[] = [];
    for (const entry of entries.filter((candidate) => candidate.endsWith('.json')).sort()) {
      const preflightID = entry.slice(0, -'.json'.length);
      try {
        journals.push(await this.readJournal(preflightID));
      } catch (error) {
        console.warn('[desktop-reinstall-target] ignoring invalid persisted journal', entry, error);
      }
    }
    return journals;
  }

  private async removeSupersededConfirmationJournals(
    physicalTargetFingerprint: string,
  ): Promise<void> {
    const journals = await this.readPersistedJournals();
    await Promise.all(journals
      .filter((journal) => (
        journal.phase === 'confirmation'
        && journal.physical_target_fingerprint === physicalTargetFingerprint
      ))
      .map((journal) => fs.rm(
        journalFile(this.dependencies.journal_root, journal.preflight_id),
        { force: true },
      )));
  }

  async validatePersistedJournalTarget(journal: ReinstallTargetJournal): Promise<void> {
    const descriptor = await this.dependencies.resolve_target({
      environment_id: journal.environment_id,
    });
    // Hydration only compares the durable registered identity. The physical
    // root may be a remote alias or an old canonical representation; it is
    // re-resolved through the direct maintenance channel when work resumes.
    const descriptorFingerprint = reinstallTargetDescriptorFingerprint(descriptor);
    const legacyFingerprint = legacyReinstallTargetDescriptorFingerprint(descriptor);
    if (descriptorFingerprint !== journal.descriptor_fingerprint && legacyFingerprint !== journal.descriptor_fingerprint) {
      throw new ReinstallTargetCoordinatorError(
        'manual_recovery_required',
        'The registered host, container, or Redeven root changed while this reinstall was paused.',
      );
    }
  }

  private async writeJournal(journal: ReinstallTargetJournal): Promise<void> {
    await fs.mkdir(this.dependencies.journal_root, { recursive: true });
    const file = journalFile(this.dependencies.journal_root, journal.preflight_id);
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(journal, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporary, file);
  }

  private async readJournal(preflightID: string): Promise<ReinstallTargetJournal> {
    const clean = compact(preflightID);
    if (!/^reinstall_[0-9a-f-]{36}$/iu.test(clean)) {
      throw new ReinstallTargetCoordinatorError('preflight_expired', 'Reinstall journal identity is invalid.');
    }
    try {
      const journal = JSON.parse(await fs.readFile(journalFile(this.dependencies.journal_root, clean), 'utf8')) as Partial<ReinstallTargetJournal>;
      if (
        journal.schema_version !== 1
        || journal.preflight_id !== clean
        || !/^[0-9a-f-]{36}$/iu.test(compact(journal.operation_id))
        || compact(journal.environment_id) === ''
        || !/^[0-9a-f]{64}$/iu.test(compact(journal.descriptor_fingerprint))
        || !/^[0-9a-f]{64}$/iu.test(compact(journal.physical_target_fingerprint))
        || (!compact(journal.target_root).startsWith('/') && !isRemoteDefaultRootAlias(compact(journal.target_root)))
        || journal.quarantine_root !== `${journal.target_root}.redeven-quarantine-${journal.operation_id}`
        || !REINSTALL_TARGET_JOURNAL_PHASES.includes(journal.phase as ReinstallTargetJournalPhase)
        || !Array.isArray(journal.affected_environment_ids)
        || !journal.preview
        || journal.preview.preflight_id !== clean
        || compact(journal.preview.operation_key) === ''
        || journal.preview.operation_key !== compact(journal.preview.operation_key)
        || !Array.isArray(journal.preview.deleted_data_keys)
      ) {
        throw new ReinstallTargetCoordinatorError('manual_recovery_required', 'The reinstall journal is invalid. Quarantine was left untouched.');
      }
      return journal as ReinstallTargetJournal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ReinstallTargetCoordinatorError('preflight_expired', 'Reinstall journal is unavailable.');
      }
      if (error instanceof ReinstallTargetCoordinatorError) {
        throw error;
      }
      throw new ReinstallTargetCoordinatorError('manual_recovery_required', 'The reinstall journal could not be read. Quarantine was left untouched.');
    }
  }
}
