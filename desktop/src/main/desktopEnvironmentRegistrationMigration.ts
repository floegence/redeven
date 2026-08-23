import path from 'node:path';

import {
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  defaultSavedSSHEnvironmentLabel,
  desktopSSHEnvironmentID,
  normalizeDesktopSSHAuthMode,
  normalizeDesktopSSHBootstrapStrategy,
  normalizeDesktopSSHConnectTimeoutSeconds,
  normalizeDesktopSSHDestination,
  normalizeDesktopSSHEnvironmentDetails,
  normalizeDesktopSSHPort,
  normalizeDesktopSSHReleaseBaseURL,
  normalizeDesktopSSHRuntimeRoot,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  desktopRuntimeTargetID,
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import type { DesktopLocalEnvironmentState } from '../shared/desktopLocalEnvironmentState';
import type { DesktopSavedRuntimeTarget } from './desktopPreferences';

export type LegacyDesktopSSHEnvironmentRegistration = Readonly<DesktopSSHEnvironmentDetails & {
  id: string;
  label: string;
  ssh_password?: string;
  ssh_password_configured?: boolean;
  pinned: boolean;
  auto_runtime_probe_enabled: boolean;
  created_at_ms: number;
  last_used_at_ms: number;
}>;

export type DesktopEnvironmentRegistrationMigration = Readonly<{
  local_environment: DesktopLocalEnvironmentState;
  saved_runtime_targets: readonly DesktopSavedRuntimeTarget[];
  migrated_ssh_environment_ids: readonly string[];
  removed_local_runtime_target_ids: readonly string[];
  changed: boolean;
}>;

export type DesktopEnvironmentRegistrationMigrationJournal = Readonly<{
  schema_version?: unknown;
  phase?: unknown;
  legacy_connections?: readonly unknown[];
  legacy_ssh_secrets?: readonly unknown[];
  migrated_ssh_environment_ids?: readonly unknown[];
  removed_local_runtime_target_ids?: readonly unknown[];
  updated_at_unix_ms?: unknown;
}>;

type LegacySSHEnvironmentCatalogFile = Readonly<{
  kind?: unknown;
  id?: unknown;
  label?: unknown;
  ssh_destination?: unknown;
  ssh_port?: unknown;
  auth_mode?: unknown;
  runtime_root?: unknown;
  bootstrap_strategy?: unknown;
  release_base_url?: unknown;
  connect_timeout_seconds?: unknown;
  pinned?: unknown;
  auto_runtime_probe_enabled?: unknown;
  created_at_ms?: unknown;
  last_used_at_ms?: unknown;
}>;

type LegacySSHEnvironmentSecretFile = Readonly<{
  environment_id?: unknown;
  ssh_password?: unknown;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function runtimeRootsMatch(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const root = compact(value);
    return root === '~/.redeven' || root === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT
      ? DEFAULT_DESKTOP_SSH_RUNTIME_ROOT
      : root;
  };
  return normalize(left) === normalize(right);
}

function localPathIdentity(value: string): string {
  const resolved = path.resolve(value);
  if (process.platform === 'darwin' && (resolved === '/private/var' || resolved.startsWith('/private/var/'))) {
    return resolved.slice('/private'.length);
  }
  return resolved;
}

function legacyTargetMatches(
  target: DesktopSavedRuntimeTarget,
  registration: LegacyDesktopSSHEnvironmentRegistration,
): boolean {
  return target.host_access.kind === 'ssh_host'
    && target.placement.kind === 'host_process'
    && target.host_access.ssh.ssh_destination === registration.ssh_destination
    && target.host_access.ssh.ssh_port === registration.ssh_port
    && runtimeRootsMatch(target.placement.runtime_root, registration.runtime_root);
}

function duplicateLocalTarget(
  target: DesktopSavedRuntimeTarget,
  localEnvironment: DesktopLocalEnvironmentState,
): boolean {
  return target.host_access.kind === 'local_host'
    && target.placement.kind === 'host_process'
    && localPathIdentity(target.placement.runtime_root) === localPathIdentity(localEnvironment.local_hosting.state_dir);
}

/**
 * This is the only decoder for the retired SSH registration schema. The
 * decoded records exist only long enough to cross the one-time migration edge.
 */
export function decodeLegacySSHEnvironmentRegistrations(
  connectionCatalogValues: readonly unknown[],
  secretsFile: unknown,
  migrationJournal: DesktopEnvironmentRegistrationMigrationJournal | null,
  decodeSecret: (value: unknown) => string,
): readonly LegacyDesktopSSHEnvironmentRegistration[] {
  const journalConnections = migrationJournal?.schema_version === 1
    && Array.isArray(migrationJournal.legacy_connections)
    ? migrationJournal.legacy_connections
    : [];
  const journalSecrets = migrationJournal?.schema_version === 1
    && Array.isArray(migrationJournal.legacy_ssh_secrets)
    ? migrationJournal.legacy_ssh_secrets
    : [];
  const persistedSecretEntries = Array.isArray(
    (secretsFile as { saved_ssh_environments?: unknown } | null)?.saved_ssh_environments,
  )
    ? ((secretsFile as { saved_ssh_environments: readonly LegacySSHEnvironmentSecretFile[] }).saved_ssh_environments)
    : [];
  const secretEntries = journalSecrets.length > 0
    ? journalSecrets as readonly LegacySSHEnvironmentSecretFile[]
    : persistedSecretEntries;
  const passwordsByID = new Map<string, string>();
  for (const entry of secretEntries) {
    const environmentID = compact(entry.environment_id);
    if (environmentID === '') continue;
    try {
      const password = compact(decodeSecret(entry.ssh_password));
      if (password !== '') passwordsByID.set(environmentID, password);
    } catch {
      // A malformed retired secret must not prevent migration of the target.
    }
  }

  const registrations: LegacyDesktopSSHEnvironmentRegistration[] = [];
  const seen = new Set<string>();
  const sourceValues = [...connectionCatalogValues, ...journalConnections];
  for (let index = 0; index < sourceValues.length; index += 1) {
    const value = sourceValues[index];
    if (!value || typeof value !== 'object') continue;
    const candidate = value as LegacySSHEnvironmentCatalogFile;
    if (compact(candidate.kind) !== 'ssh') continue;
    let details: DesktopSSHEnvironmentDetails;
    try {
      details = normalizeDesktopSSHEnvironmentDetails({
        ssh_destination: normalizeDesktopSSHDestination(candidate.ssh_destination),
        ssh_port: normalizeDesktopSSHPort(candidate.ssh_port),
        auth_mode: normalizeDesktopSSHAuthMode(candidate.auth_mode),
        runtime_root: normalizeDesktopSSHRuntimeRoot(candidate.runtime_root),
        bootstrap_strategy: normalizeDesktopSSHBootstrapStrategy(candidate.bootstrap_strategy),
        release_base_url: normalizeDesktopSSHReleaseBaseURL(candidate.release_base_url),
        connect_timeout_seconds: normalizeDesktopSSHConnectTimeoutSeconds(candidate.connect_timeout_seconds),
      });
    } catch {
      continue;
    }
    const id = desktopSSHEnvironmentID(details);
    if (seen.has(id)) continue;
    seen.add(id);
    const password = details.auth_mode === 'password' ? passwordsByID.get(id) ?? '' : '';
    registrations.push({
      ...details,
      id,
      label: compact(candidate.label) || defaultSavedSSHEnvironmentLabel(details),
      ssh_password: password,
      ssh_password_configured: password !== '',
      pinned: candidate.pinned === true,
      auto_runtime_probe_enabled: candidate.auto_runtime_probe_enabled === true,
      created_at_ms: positiveInteger(candidate.created_at_ms, Date.now() + index + 1),
      last_used_at_ms: positiveInteger(candidate.last_used_at_ms, sourceValues.length - index),
    });
  }
  return registrations;
}

/**
 * Captures the complete retired source needed to finish a migration after a
 * crash. Normal preference code treats this payload as opaque journal data.
 */
export function legacySSHEnvironmentMigrationJournalSource(
  connectionCatalogValues: readonly unknown[],
  secretsFile: unknown,
): Readonly<{
  legacy_connections: readonly unknown[];
  legacy_ssh_secrets: readonly unknown[];
}> {
  const legacyConnections = connectionCatalogValues.filter((value) => (
    !!value
    && typeof value === 'object'
    && compact((value as LegacySSHEnvironmentCatalogFile).kind) === 'ssh'
  ));
  const legacySecrets = Array.isArray(
    (secretsFile as { saved_ssh_environments?: unknown } | null)?.saved_ssh_environments,
  )
    ? (secretsFile as { saved_ssh_environments: readonly unknown[] }).saved_ssh_environments
    : [];
  return {
    legacy_connections: legacyConnections,
    legacy_ssh_secrets: legacySecrets,
  };
}

export function migrateDesktopEnvironmentRegistrations(input: Readonly<{
  local_environment: DesktopLocalEnvironmentState;
  saved_runtime_targets: readonly DesktopSavedRuntimeTarget[];
  legacy_ssh_environments: readonly LegacyDesktopSSHEnvironmentRegistration[];
  now_unix_ms?: number;
}>): DesktopEnvironmentRegistrationMigration {
  const removedLocalTargets = input.saved_runtime_targets.filter((target) => (
    duplicateLocalTarget(target, input.local_environment)
  ));
  let localEnvironment = removedLocalTargets.reduce((environment, target) => ({
    ...environment,
    pinned: environment.pinned || target.pinned,
    last_used_at_ms: Math.max(environment.last_used_at_ms, target.last_used_at_ms),
  }), input.local_environment);
  let targets = input.saved_runtime_targets.filter((target) => (
    !removedLocalTargets.some((candidate) => candidate.id === target.id)
  ));
  const migratedIDs: string[] = [];
  const now = input.now_unix_ms ?? Date.now();

  for (const registration of input.legacy_ssh_environments) {
    const existing = targets.find((target) => legacyTargetMatches(target, registration)) ?? null;
    const hostAccess: DesktopRuntimeHostAccess = {
      kind: 'ssh_host',
      ssh: {
        ssh_destination: registration.ssh_destination,
        ssh_port: registration.ssh_port,
        auth_mode: registration.auth_mode,
        connect_timeout_seconds: registration.connect_timeout_seconds,
      },
    };
    const placement: DesktopRuntimePlacement = {
      kind: 'host_process',
      runtime_root: registration.runtime_root,
      bootstrap_strategy: registration.bootstrap_strategy,
      release_base_url: registration.release_base_url,
    };
    const existingPassword = compact(existing?.ssh_password);
    const legacyPassword = compact(registration.ssh_password);
    const password = existingPassword || legacyPassword;
    const target: DesktopSavedRuntimeTarget = {
      schema_version: 1,
      id: existing?.id ?? desktopRuntimeTargetID(hostAccess, placement),
      label: existing?.label ?? registration.label,
      host_access: hostAccess,
      placement,
      ssh_password: password,
      ssh_password_configured: password !== '',
      pinned: existing?.pinned === true || registration.pinned,
      auto_runtime_probe_enabled: registration.auto_runtime_probe_enabled,
      created_at_ms: Math.min(existing?.created_at_ms ?? registration.created_at_ms, registration.created_at_ms),
      last_used_at_ms: Math.max(existing?.last_used_at_ms ?? 0, registration.last_used_at_ms),
      updated_at_ms: now,
    };
    targets = [target, ...targets.filter((candidate) => candidate.id !== target.id)];
    migratedIDs.push(registration.id);
  }

  return {
    local_environment: localEnvironment,
    saved_runtime_targets: targets,
    migrated_ssh_environment_ids: migratedIDs,
    removed_local_runtime_target_ids: removedLocalTargets.map((target) => target.id),
    changed: migratedIDs.length > 0 || removedLocalTargets.length > 0,
  };
}
