import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  containerInspectCommand,
  containerRuntimeExecCommand,
  parseContainerInspectJSON,
} from './containerRuntime';
import type { RuntimeHostAccessExecutor } from './runtimeHostAccess';
import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import {
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  desktopSSHAuthority,
} from '../shared/desktopSSH';
import { runtimeLifecycleTargetKey } from './runtimeLifecycleCoordinator';

const PREFLIGHT_TTL_MS = 10 * 60 * 1_000;

export type ReinstallTargetSubject = Readonly<{
  environment_id: string;
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

export type ReinstallTargetPreview = Readonly<{
  preflight_id: string;
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
  deleted_data: readonly string[];
  expires_at_unix_ms: number;
}>;

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
  phase:
    | 'target_quarantined'
    | 'catalog_and_local_ui_verified'
    | 'quarantine_cleaned';
  affected_environment_ids: readonly string[];
  updated_at_unix_ms: number;
}>;

export type ReinstallTargetProgressPhase =
  | 'preflight'
  | 'target_locked'
  | 'sessions_closed'
  | 'maintenance_helper_uploaded'
  | 'redeven_processes_inventory'
  | 'redeven_processes_stopping'
  | 'redeven_processes_verified_stopped'
  | 'target_quarantined'
  | 'fresh_components_installed'
  | 'fresh_gateway_and_runtime_started'
  | 'fresh_identity_verified'
  | 'catalog_and_local_ui_verified'
  | 'quarantine_cleaned'
  | 'completed';

type CachedPreflight = Readonly<{
  descriptor: ReinstallTargetDescriptor;
  descriptorFingerprint: string;
  physicalTargetFingerprint: string;
  preview: ReinstallTargetPreview;
}>;

export type ReinstallTargetCoordinatorDependencies = Readonly<{
  journal_root: string;
  resolve_target: (subject: ReinstallTargetSubject) => Promise<ReinstallTargetDescriptor>;
  resolve_candidates: () => Promise<readonly ReinstallTargetDescriptor[]>;
  create_executor: (descriptor: ReinstallTargetDescriptor) => RuntimeHostAccessExecutor;
  inspect_processes: (
    descriptor: ReinstallTargetDescriptor,
    targetRoot: string,
    executor: RuntimeHostAccessExecutor,
  ) => Promise<ReinstallTargetProcessInventory>;
  stop_processes: (
    descriptor: ReinstallTargetDescriptor,
    targetRoot: string,
    inventory: ReinstallTargetProcessInventory,
    executor: RuntimeHostAccessExecutor,
  ) => Promise<ReinstallTargetProcessInventory>;
  mark_in_progress: (descriptor: ReinstallTargetDescriptor, preflightID: string) => Promise<void>;
  close_sessions: (descriptor: ReinstallTargetDescriptor) => Promise<void>;
  clear_desktop_state: (descriptor: ReinstallTargetDescriptor) => Promise<void>;
  install_fresh: (descriptor: ReinstallTargetDescriptor, targetRoot: string) => Promise<void>;
  verify_fresh_identity: (descriptor: ReinstallTargetDescriptor, targetRoot: string) => Promise<void>;
  verify_catalog_and_local_ui: (descriptor: ReinstallTargetDescriptor, targetRoot: string) => Promise<void>;
  clear_completed_marker: (descriptor: ReinstallTargetDescriptor) => Promise<void>;
}>;

export class ReinstallTargetCoordinatorError extends Error {
  constructor(
    readonly code:
      | 'reinstall_unsupported'
      | 'reinstall_blocked'
      | 'preflight_expired'
      | 'target_changed'
      | 'manual_recovery_required',
    message: string,
  ) {
    super(message);
    this.name = 'ReinstallTargetCoordinatorError';
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function reinstallTargetDescriptorFingerprint(descriptor: ReinstallTargetDescriptor): string {
  return crypto.createHash('sha256').update(runtimeLifecycleTargetKey(
    descriptor.host_access,
    descriptor.placement,
  )).digest('hex');
}

function reinstallPhysicalTargetFingerprint(
  descriptor: ReinstallTargetDescriptor,
  canonicalTargetRoot: string,
): string {
  return crypto.createHash('sha256').update(runtimeLifecycleTargetKey(
    descriptor.host_access,
    { ...descriptor.placement, runtime_root: canonicalTargetRoot },
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
    : 'This device';
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
  if (inspected.container_id !== descriptor.placement.container_id || inspected.status !== 'running') {
    throw new ReinstallTargetCoordinatorError('target_changed', 'The registered container identity or running state changed.');
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
  'for prior in "$target".redeven-quarantine-*; do',
  '  [ -e "$prior" ] || [ -L "$prior" ] || continue',
  '  echo "previous reinstall quarantine requires manual recovery" >&2',
  '  exit 42',
  'done',
  'printf "%s\\n%s\\n" "$target" "$exists"',
].join('\n');

const isolateTargetScript = [
  'set -eu',
  'target="$1"',
  'quarantine="$2"',
  '[ ! -L "$target" ] || { echo "runtime root became a symbolic link" >&2; exit 41; }',
  '[ ! -e "$quarantine" ] && [ ! -L "$quarantine" ] || { echo "quarantine already exists" >&2; exit 42; }',
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

function parsePreflightOutput(stdout: string): Readonly<{ root: string; exists: boolean }> {
  const lines = String(stdout ?? '').split(/\r?\n/u);
  const root = compact(lines[0]);
  if (!root.startsWith('/') || (lines[1] !== '0' && lines[1] !== '1')) {
    throw new ReinstallTargetCoordinatorError('reinstall_blocked', 'Desktop received an invalid target preflight result.');
  }
  return { root, exists: lines[1] === '1' };
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
    const executor = this.dependencies.create_executor(descriptor);
    try {
      await validateRegisteredContainer(descriptor, executor);
      const target = parsePreflightOutput((await executor.run(placementCommand(
        descriptor.placement,
        targetPreflightScript,
        [descriptor.placement.runtime_root, DEFAULT_DESKTOP_SSH_RUNTIME_ROOT],
      ))).stdout);
      const resolvedDescriptor = await this.descriptorWithCanonicalAffectedTargets(descriptor, target.root, executor);
      const inventory = await this.dependencies.inspect_processes(resolvedDescriptor, target.root, executor);
      if (inventory.summary.blocked > 0) {
        throw new ReinstallTargetCoordinatorError('reinstall_blocked', 'Desktop found a Redeven process whose identity could not be safely verified.');
      }
      const preflightID = `reinstall_${crypto.randomUUID()}`;
      const preview: ReinstallTargetPreview = {
        preflight_id: preflightID,
        environment_id: descriptor.environment_id,
        label: descriptor.label,
        target_kind: targetKind(descriptor),
        host_label: hostLabel(descriptor),
        ...(descriptor.placement.kind === 'container_process' ? {
          container_id: descriptor.placement.container_id,
          container_engine: descriptor.placement.container_engine,
        } : {}),
        target_root: target.root,
        target_exists: target.exists,
        affected_environment_ids: [...resolvedDescriptor.affected_environment_ids],
        processes: [...inventory.instances],
        deleted_data: [
          'Gateway, Runtime, Local UI, and managed packages',
          'Workspace, projects, and application data',
          'Floret and ReDevPlugin data',
          'Trust, tokens, identity, Catalog, and environment configuration',
        ],
        expires_at_unix_ms: Date.now() + PREFLIGHT_TTL_MS,
      };
      this.preflights.set(preflightID, {
        descriptor: resolvedDescriptor,
        descriptorFingerprint: reinstallTargetDescriptorFingerprint(descriptor),
        physicalTargetFingerprint: reinstallPhysicalTargetFingerprint(resolvedDescriptor, target.root),
        preview,
      });
      return preview;
    } catch (error) {
      if (error instanceof ReinstallTargetCoordinatorError) {
        throw error;
      }
      console.error('[desktop-reinstall-target] preflight failed', error, error instanceof Error && 'presentation' in error
        ? (error as Error & { presentation?: unknown }).presentation
        : undefined);
      throw new ReinstallTargetCoordinatorError(
        'reinstall_blocked',
        'Desktop could not safely validate the registered host, container, Redeven root, or process inventory.',
      );
    } finally {
      await executor.release();
    }
  }

  async execute(
    preflightID: string,
    onProgress?: (phase: ReinstallTargetProgressPhase) => void,
  ): Promise<ReinstallTargetJournal> {
    onProgress?.('preflight');
    const cached = this.preflights.get(compact(preflightID));
    if (!cached || cached.preview.expires_at_unix_ms < Date.now()) {
      this.preflights.delete(compact(preflightID));
      throw new ReinstallTargetCoordinatorError('preflight_expired', 'Reinstall preflight expired. Review the target again.');
    }
    const current = await this.dependencies.resolve_target({ environment_id: cached.descriptor.environment_id });
    if (reinstallTargetDescriptorFingerprint(current) !== cached.descriptorFingerprint) {
      throw new ReinstallTargetCoordinatorError('target_changed', 'The registered host, container, or runtime root changed after confirmation.');
    }
    if (this.locks.has(cached.physicalTargetFingerprint)) {
      throw new ReinstallTargetCoordinatorError('reinstall_blocked', 'A reinstall is already running for this physical target.');
    }
    this.locks.add(cached.physicalTargetFingerprint);
    onProgress?.('target_locked');
    let executor: RuntimeHostAccessExecutor | null = null;
    const operationID = crypto.randomUUID();
    const quarantineRoot = `${cached.preview.target_root}.redeven-quarantine-${operationID}`;
    let isolated = false;
    try {
      executor = this.dependencies.create_executor(current);
      await validateRegisteredContainer(current, executor);
      const repeated = parsePreflightOutput((await executor.run(placementCommand(
        current.placement,
        targetPreflightScript,
        [current.placement.runtime_root, DEFAULT_DESKTOP_SSH_RUNTIME_ROOT],
      ))).stdout);
      if (repeated.root !== cached.preview.target_root || repeated.exists !== cached.preview.target_exists) {
        throw new ReinstallTargetCoordinatorError('target_changed', 'The runtime root changed after confirmation.');
      }
      const currentResolved = await this.descriptorWithCanonicalAffectedTargets(current, repeated.root, executor);
      if (
        reinstallPhysicalTargetFingerprint(currentResolved, repeated.root) !== cached.physicalTargetFingerprint
        || JSON.stringify(currentResolved.affected_environment_ids) !== JSON.stringify(cached.descriptor.affected_environment_ids)
      ) {
        throw new ReinstallTargetCoordinatorError('target_changed', 'The physical target records changed after confirmation.');
      }
      await this.dependencies.mark_in_progress(currentResolved, cached.preview.preflight_id);
      await this.dependencies.close_sessions(currentResolved);
      onProgress?.('sessions_closed');
      onProgress?.('maintenance_helper_uploaded');
      onProgress?.('redeven_processes_inventory');
      const inventory = await this.dependencies.inspect_processes(currentResolved, repeated.root, executor);
      if (inventory.summary.blocked > 0) {
        throw new ReinstallTargetCoordinatorError('reinstall_blocked', 'Desktop found a Redeven process whose identity could not be safely verified.');
      }
      const afterStop = inventory.instances.length > 0
        ? await (async () => {
            onProgress?.('redeven_processes_stopping');
            return this.dependencies.stop_processes(currentResolved, repeated.root, inventory, executor);
          })()
        : inventory;
      if (afterStop.instances.length > 0) {
        throw new ReinstallTargetCoordinatorError('reinstall_blocked', 'Desktop could not verify that every old Redeven process stopped.');
      }
      onProgress?.('redeven_processes_verified_stopped');
      await executor.run(placementCommand(currentResolved.placement, isolateTargetScript, [repeated.root, quarantineRoot]));
      isolated = true;
      onProgress?.('target_quarantined');
      const journal: ReinstallTargetJournal = {
        schema_version: 1,
        preflight_id: cached.preview.preflight_id,
        operation_id: operationID,
        environment_id: current.environment_id,
        descriptor_fingerprint: cached.descriptorFingerprint,
        physical_target_fingerprint: cached.physicalTargetFingerprint,
        target_root: repeated.root,
        quarantine_root: quarantineRoot,
        target_existed: repeated.exists,
        phase: 'target_quarantined',
        affected_environment_ids: [...currentResolved.affected_environment_ids],
        updated_at_unix_ms: Date.now(),
      };
      await this.writeJournal(journal);
      await this.dependencies.clear_desktop_state(currentResolved);
      await this.dependencies.install_fresh(currentResolved, repeated.root);
      onProgress?.('fresh_components_installed');
      onProgress?.('fresh_gateway_and_runtime_started');
      await this.dependencies.verify_fresh_identity(currentResolved, repeated.root);
      onProgress?.('fresh_identity_verified');
      await this.dependencies.verify_catalog_and_local_ui(currentResolved, repeated.root);
      const verifiedJournal: ReinstallTargetJournal = {
        ...journal,
        phase: 'catalog_and_local_ui_verified',
        updated_at_unix_ms: Date.now(),
      };
      await this.writeJournal(verifiedJournal);
      onProgress?.('catalog_and_local_ui_verified');
      await executor.run(placementCommand(currentResolved.placement, cleanupQuarantineScript, [
        verifiedJournal.target_root,
        verifiedJournal.quarantine_root,
      ]));
      const completedJournal: ReinstallTargetJournal = {
        ...verifiedJournal,
        phase: 'quarantine_cleaned',
        updated_at_unix_ms: Date.now(),
      };
      await this.writeJournal(completedJournal);
      onProgress?.('quarantine_cleaned');
      await this.dependencies.clear_completed_marker(currentResolved);
      await fs.rm(journalFile(this.dependencies.journal_root, cached.preview.preflight_id), { force: true });
      this.preflights.delete(cached.preview.preflight_id);
      onProgress?.('completed');
      return completedJournal;
    } catch (error) {
      if (error instanceof ReinstallTargetCoordinatorError) {
        throw error;
      }
      if (!isolated) {
        throw new ReinstallTargetCoordinatorError(
          'reinstall_blocked',
          'Desktop could not safely stop Redeven processes and replace the registered target.',
        );
      }
      throw new ReinstallTargetCoordinatorError(
        'manual_recovery_required',
        `Fresh Redeven installation failed. The old target remains quarantined and will not be restarted. ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await executor?.release();
      this.locks.delete(cached.physicalTargetFingerprint);
    }
  }

  async resumeCompletion(
    preflightID: string,
    onProgress?: (phase: Extract<ReinstallTargetProgressPhase, 'quarantine_cleaned' | 'completed'>) => void,
  ): Promise<void> {
    const journal = await this.readJournal(preflightID);
    const selected = await this.dependencies.resolve_target({ environment_id: journal.environment_id });
    const descriptor = { ...selected, affected_environment_ids: [...journal.affected_environment_ids] };
    if (
      reinstallTargetDescriptorFingerprint(selected) !== journal.descriptor_fingerprint
      || reinstallPhysicalTargetFingerprint(descriptor, journal.target_root) !== journal.physical_target_fingerprint
    ) {
      throw new ReinstallTargetCoordinatorError('target_changed', 'The reinstall target changed before completion recovery.');
    }
    const executor = this.dependencies.create_executor(descriptor);
    try {
      if (journal.phase === 'catalog_and_local_ui_verified') {
        await executor.run(placementCommand(descriptor.placement, cleanupQuarantineScript, [
          journal.target_root,
          journal.quarantine_root,
        ]));
        await this.writeJournal({
          ...journal,
          phase: 'quarantine_cleaned',
          updated_at_unix_ms: Date.now(),
        });
        onProgress?.('quarantine_cleaned');
      }
      await this.dependencies.clear_completed_marker(descriptor);
      await fs.rm(journalFile(this.dependencies.journal_root, preflightID), { force: true });
      onProgress?.('completed');
    } finally {
      await executor.release();
    }
  }

  private async writeJournal(journal: ReinstallTargetJournal): Promise<void> {
    await fs.mkdir(this.dependencies.journal_root, { recursive: true });
    const file = journalFile(this.dependencies.journal_root, journal.preflight_id);
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(journal, null, 2), { encoding: 'utf8', mode: 0o600 });
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
        || !compact(journal.target_root).startsWith('/')
        || journal.quarantine_root !== `${journal.target_root}.redeven-quarantine-${journal.operation_id}`
        || !(
          journal.phase === 'catalog_and_local_ui_verified'
          || journal.phase === 'quarantine_cleaned'
        )
        || !Array.isArray(journal.affected_environment_ids)
      ) {
        throw new ReinstallTargetCoordinatorError('manual_recovery_required', 'The reinstall journal is invalid. Quarantine was left untouched.');
      }
      return journal as ReinstallTargetJournal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ReinstallTargetCoordinatorError('preflight_expired', 'Reinstall journal is unavailable.');
      }
      throw error;
    }
  }
}
