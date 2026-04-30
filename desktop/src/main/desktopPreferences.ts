import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_DESKTOP_LOCAL_UI_BIND,
  isLoopbackOnlyBind,
  localUIBindsConflict,
  parseLocalUIBind,
} from './localUIBind';
import { normalizeLocalUIBaseURL } from './localUIURL';
import type { DesktopSavedEnvironmentSource } from '../shared/desktopConnectionTypes';
import { DEFAULT_DESKTOP_AUTO_LOOPBACK_BIND } from '../shared/desktopAccessModel';
import {
  defaultSavedSSHEnvironmentLabel,
  normalizeDesktopSSHAuthMode,
  desktopSSHEnvironmentID,
  normalizeDesktopSSHBootstrapStrategy,
  normalizeDesktopSSHEnvironmentDetails,
  normalizeDesktopSSHPort,
  normalizeDesktopSSHReleaseBaseURL,
  normalizeDesktopSSHRemoteInstallDir,
  normalizeDesktopSSHDestination,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  desktopControlPlaneKey,
  normalizeControlPlaneDisplayLabel,
  normalizeControlPlaneOrigin,
  normalizeDesktopControlPlaneAccount,
  normalizeDesktopControlPlaneProvider,
  normalizeDesktopProviderEnvironmentList,
  type DesktopControlPlaneAccount,
  type DesktopControlPlaneProvider,
  type DesktopProviderEnvironment,
} from '../shared/controlPlaneProvider';
import {
  normalizeDesktopLocalUIPasswordMode,
  type DesktopLocalUIPasswordMode,
  type DesktopSettingsDraft,
} from '../shared/settingsIPC';
import {
  controlPlaneManagedStateLayout,
  controlPlaneProviderKeyForOrigin,
  localManagedStateLayout,
  namedManagedStateLayout,
  resolveStateRoot,
} from './statePaths';
import {
  createManagedControlPlaneEnvironment,
  createManagedEnvironment,
  createManagedEnvironmentLocalHosting,
  createManagedEnvironmentProviderBinding,
  createManagedLocalEnvironment,
  defaultDesktopManagedEnvironmentAccess,
  defaultLocalManagedEnvironmentLabel,
  desktopManagedControlPlaneEnvironmentID,
  desktopManagedLocalEnvironmentID,
  managedEnvironmentLocalAccess,
  managedEnvironmentSortKey,
  normalizeDesktopLocalEnvironmentName,
  normalizeDesktopNamedEnvironmentName,
  normalizeDesktopProviderEnvironmentID,
  type DesktopManagedEnvironment,
  type DesktopManagedEnvironmentAccess,
  type DesktopManagedEnvironmentPreferredOpenRoute,
} from '../shared/desktopManagedEnvironment';
import {
  createDesktopProviderEnvironmentLocalRuntime,
  createDesktopProviderEnvironmentRecord,
  defaultDesktopProviderEnvironmentLabel,
  desktopProviderEnvironmentID,
  desktopProviderEnvironmentRemoteCatalogEntryFromPublished,
  providerEnvironmentLocalAccess,
  providerEnvironmentSortKey,
  type DesktopProviderEnvironmentLocalRuntime,
  type DesktopProviderEnvironmentRecord,
} from '../shared/desktopProviderEnvironment';

export type DesktopSavedEnvironment = Readonly<{
  id: string;
  label: string;
  local_ui_url: string;
  source: DesktopSavedEnvironmentSource;
  pinned: boolean;
  last_used_at_ms: number;
}>;

export type DesktopSavedSSHEnvironment = Readonly<DesktopSSHEnvironmentDetails & {
  id: string;
  label: string;
  source: DesktopSavedEnvironmentSource;
  pinned: boolean;
  last_used_at_ms: number;
}>;

export type DesktopSavedControlPlane = Readonly<{
  provider: DesktopControlPlaneProvider;
  account: DesktopControlPlaneAccount;
  environments: readonly DesktopProviderEnvironment[];
  display_label: string;
  last_synced_at_ms: number;
}>;

export type DesktopProviderEnvironmentPreference = Readonly<{
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
  pinned: boolean;
  last_used_at_ms: number;
}>;

export type DesktopPreferences = Readonly<{
  managed_environments: readonly DesktopManagedEnvironment[];
  provider_environments: readonly DesktopProviderEnvironmentRecord[];
  saved_environments: readonly DesktopSavedEnvironment[];
  saved_ssh_environments: readonly DesktopSavedSSHEnvironment[];
  recent_external_local_ui_urls: readonly string[];
  control_plane_refresh_tokens: Readonly<Record<string, string>>;
  control_planes: readonly DesktopSavedControlPlane[];
}>;

export type DesktopPreferencesPaths = Readonly<{
  preferencesFile: string;
  secretsFile: string;
  stateRoot: string;
}>;

type DesktopCatalogPaths = Readonly<{
  stateRoot: string;
  catalogRoot: string;
  environmentsDir: string;
  connectionsDir: string;
  providersDir: string;
  providerEnvironmentsDir: string;
  providerEnvironmentPreferencesDir: string;
}>;

type ManagedEnvironmentCatalogNormalizationResult = Readonly<{
  environment: DesktopManagedEnvironment | null;
  providerEnvironmentPreference: DesktopProviderEnvironmentPreference | null;
  didCanonicalizeProviderIdentity: boolean;
}>;

type ManagedEnvironmentCatalogCollectionResult = Readonly<{
  environments: readonly DesktopManagedEnvironment[];
  legacyProviderEnvironments: readonly DesktopManagedEnvironment[];
  providerEnvironmentPreferences: readonly DesktopProviderEnvironmentPreference[];
  didCanonicalizeProviderIdentity: boolean;
}>;

type ProviderEnvironmentNormalizationResult = Readonly<{
  environments: readonly DesktopProviderEnvironmentRecord[];
  didCanonicalizeProviderIdentity: boolean;
}>;

type SavedSSHEnvironmentCandidateNormalizationResult = Readonly<{
  environment: DesktopSavedSSHEnvironment | null;
  didCanonicalize: boolean;
}>;

type SavedSSHEnvironmentNormalizationResult = Readonly<{
  environments: readonly DesktopSavedSSHEnvironment[];
  didCanonicalize: boolean;
}>;

type StoredSecret = Readonly<{
  encoding: string;
  data: string;
}>;

type DesktopSavedEnvironmentFile = Readonly<{
  id?: unknown;
  label?: unknown;
  local_ui_url?: unknown;
  source?: unknown;
  pinned?: unknown;
  last_used_at_ms?: unknown;
}>;

type DesktopSavedSSHEnvironmentFile = Readonly<{
  id?: unknown;
  label?: unknown;
  ssh_destination?: unknown;
  ssh_port?: unknown;
  auth_mode?: unknown;
  remote_install_dir?: unknown;
  bootstrap_strategy?: unknown;
  release_base_url?: unknown;
  environment_instance_id?: unknown;
  source?: unknown;
  pinned?: unknown;
  last_used_at_ms?: unknown;
}>;

type DesktopManagedEnvironmentFile = Readonly<{
  id?: unknown;
  kind?: unknown;
  label?: unknown;
  name?: unknown;
  provider_origin?: unknown;
  provider_id?: unknown;
  env_public_id?: unknown;
  pinned?: unknown;
  created_at_ms?: unknown;
  updated_at_ms?: unknown;
  last_used_at_ms?: unknown;
  local_ui_bind?: unknown;
}>;

type DesktopManagedEnvironmentCatalogFile = Readonly<{
  schema_version?: unknown;
  record_kind?: unknown;
  id?: unknown;
  label?: unknown;
  pinned?: unknown;
  created_at_ms?: unknown;
  updated_at_ms?: unknown;
  last_used_at_ms?: unknown;
  preferred_open_route?: unknown;
  identity?: Readonly<{
    kind?: unknown;
    local_name?: unknown;
    provider_origin?: unknown;
    provider_id?: unknown;
    env_public_id?: unknown;
  }>;
  local_hosting?: Readonly<{
    scope?: Readonly<{
      kind?: unknown;
      name?: unknown;
      provider_origin?: unknown;
      provider_key?: unknown;
      env_public_id?: unknown;
    }>;
    scope_key?: unknown;
    state_dir?: unknown;
    owner?: unknown;
    access?: Readonly<{
      local_ui_bind?: unknown;
      local_ui_password_configured?: unknown;
    }>;
  }>;
  provider_binding?: Readonly<{
    provider_origin?: unknown;
    provider_id?: unknown;
    env_public_id?: unknown;
    remote_web_supported?: unknown;
    remote_desktop_supported?: unknown;
  }>;
}>;

type DesktopConnectionCatalogFile = Readonly<{
  schema_version?: unknown;
  record_kind?: unknown;
  kind?: unknown;
  id?: unknown;
  label?: unknown;
  local_ui_url?: unknown;
  ssh_destination?: unknown;
  ssh_port?: unknown;
  auth_mode?: unknown;
  remote_install_dir?: unknown;
  bootstrap_strategy?: unknown;
  release_base_url?: unknown;
  environment_instance_id?: unknown;
  source?: unknown;
  pinned?: unknown;
  last_used_at_ms?: unknown;
}>;

type DesktopProviderCatalogFile = Readonly<{
  schema_version?: unknown;
  record_kind?: unknown;
  provider?: unknown;
  account?: DesktopControlPlaneAccountFile;
  environments?: readonly unknown[];
  display_label?: unknown;
  last_synced_at_ms?: unknown;
}>;

type DesktopProviderEnvironmentPreferenceCatalogFile = Readonly<{
  schema_version?: unknown;
  record_kind?: unknown;
  provider_origin?: unknown;
  provider_id?: unknown;
  env_public_id?: unknown;
  pinned?: unknown;
  last_used_at_ms?: unknown;
}>;

type DesktopProviderEnvironmentCatalogFile = Readonly<{
  schema_version?: unknown;
  record_kind?: unknown;
  id?: unknown;
  provider_origin?: unknown;
  provider_id?: unknown;
  env_public_id?: unknown;
  label?: unknown;
  pinned?: unknown;
  created_at_ms?: unknown;
  updated_at_ms?: unknown;
  last_used_at_ms?: unknown;
  preferred_open_route?: unknown;
  remote_web_supported?: unknown;
  remote_desktop_supported?: unknown;
  remote_catalog_entry?: Readonly<{
    environment_url?: unknown;
    description?: unknown;
    namespace_public_id?: unknown;
    namespace_name?: unknown;
    status?: unknown;
    lifecycle_status?: unknown;
    last_seen_at_unix_ms?: unknown;
  }>;
  local_runtime?: Readonly<{
    owner?: unknown;
    state_scope?: Readonly<{
      provider_origin?: unknown;
      provider_key?: unknown;
      env_public_id?: unknown;
      scope_key?: unknown;
      state_dir?: unknown;
    }>;
    access?: Readonly<{
      local_ui_bind?: unknown;
      local_ui_password_configured?: unknown;
    }>;
  }>;
}>;

type DesktopControlPlaneAccountFile = Readonly<{
  user_public_id?: unknown;
  user_display_name?: unknown;
  authorization_expires_at_unix_ms?: unknown;
}>;

type DesktopControlPlaneFile = Readonly<{
  provider?: unknown;
  account?: DesktopControlPlaneAccountFile;
  environments?: readonly unknown[];
  display_label?: unknown;
  last_synced_at_ms?: unknown;
}>;

type DesktopPreferencesFile = Readonly<{
  version?: number;
  local_ui_bind?: string;
  managed_environments?: readonly unknown[];
  provider_environment_preferences?: readonly unknown[];
  saved_environments?: readonly DesktopSavedEnvironmentFile[];
  saved_ssh_environments?: readonly DesktopSavedSSHEnvironmentFile[];
  recent_external_local_ui_urls?: readonly unknown[];
  control_planes?: readonly DesktopControlPlaneFile[];
}>;

type DesktopControlPlaneSecretFile = Readonly<{
  provider_origin?: unknown;
  provider_id?: unknown;
  refresh_token?: StoredSecret;
}>;

type DesktopSecretsFile = Readonly<{
  version?: number;
  local_ui_password?: StoredSecret;
  managed_environments?: readonly unknown[];
  provider_environments?: readonly unknown[];
  control_planes?: readonly DesktopControlPlaneSecretFile[];
}>;

type DesktopManagedEnvironmentSecretFile = Readonly<{
  environment_id?: unknown;
  local_ui_password?: StoredSecret;
}>;

export type DesktopSecretCodec = Readonly<{
  encodeSecret: (value: string) => StoredSecret;
  decodeSecret: (value: StoredSecret) => string;
}>;

export type SafeStorageLike = Readonly<{
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
}>;

export type UpsertDesktopManagedEnvironmentInput = Readonly<{
  environment_id?: string;
  name?: string;
  label?: string;
  pinned?: boolean;
  access?: DesktopManagedEnvironmentAccess;
  created_at_ms?: number;
  updated_at_ms?: number;
  last_used_at_ms?: number;
}>;

export type UpsertDesktopProviderEnvironmentLocalRuntimeInput = Readonly<{
  environment_id?: string;
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
  label?: string;
  pinned?: boolean;
  access?: DesktopManagedEnvironmentAccess;
  created_at_ms?: number;
  updated_at_ms?: number;
  last_used_at_ms?: number;
}>;

export type DeleteManagedEnvironmentResult = Readonly<{
  preferences: DesktopPreferences;
  deleted_environment: DesktopManagedEnvironment | null;
  deleted_state_dir: string;
}>;

export type DeleteProviderEnvironmentResult = Readonly<{
  preferences: DesktopPreferences;
  deleted_environment: DesktopProviderEnvironmentRecord | null;
  deleted_state_dir: string;
}>;

export type DesktopManagedEnvironmentLocalBindConflict = Readonly<{
  environment_id: string;
  label: string;
  local_ui_bind: string;
  conflicting_environment_id: string;
  conflicting_label: string;
  conflicting_local_ui_bind: string;
}>;

export type UpsertDesktopSavedEnvironmentInput = Readonly<{
  environment_id: string;
  label: string;
  local_ui_url: string;
  source?: DesktopSavedEnvironmentSource;
  pinned?: boolean;
  last_used_at_ms?: number;
}>;

export type UpsertDesktopSavedSSHEnvironmentInput = Readonly<DesktopSSHEnvironmentDetails & {
  environment_id: string;
  label: string;
  source?: DesktopSavedEnvironmentSource;
  pinned?: boolean;
  last_used_at_ms?: number;
}>;

export type UpsertDesktopSavedControlPlaneInput = Readonly<{
  provider: DesktopControlPlaneProvider;
  account: DesktopControlPlaneAccount;
  environments?: readonly DesktopProviderEnvironment[];
  display_label?: string;
  last_synced_at_ms?: number;
  refresh_token?: string;
}>;

const MAX_RECENT_EXTERNAL_LOCAL_UI_URLS = 5;
const MAX_SAVED_ENVIRONMENTS = 20;
const MAX_SAVED_SSH_ENVIRONMENTS = 20;

export function createPlaintextSecretCodec(): DesktopSecretCodec {
  return {
    encodeSecret: (value) => ({
      encoding: 'plain',
      data: String(value ?? ''),
    }),
    decodeSecret: (value) => {
      if (!value || value.encoding !== 'plain') {
        throw new Error('unsupported secret encoding');
      }
      return String(value.data ?? '');
    },
  };
}

export function createSafeStorageSecretCodec(safeStorage: SafeStorageLike | null | undefined): DesktopSecretCodec {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    return createPlaintextSecretCodec();
  }

  return {
    encodeSecret: (value) => ({
      encoding: 'safe_storage',
      data: safeStorage.encryptString(String(value ?? '')).toString('base64'),
    }),
    decodeSecret: (secret) => {
      if (!secret || secret.encoding !== 'safe_storage') {
        throw new Error('unsupported secret encoding');
      }
      return safeStorage.decryptString(Buffer.from(String(secret.data ?? ''), 'base64'));
    },
  };
}

export function defaultDesktopPreferences(): DesktopPreferences {
  return {
    managed_environments: [createManagedLocalEnvironment('default')],
    provider_environments: [],
    saved_environments: [],
    saved_ssh_environments: [],
    recent_external_local_ui_urls: [],
    control_plane_refresh_tokens: {},
    control_planes: [],
  };
}

function normalizeSavedEnvironmentSource(
  value: unknown,
  fallback: DesktopSavedEnvironmentSource = 'saved',
): DesktopSavedEnvironmentSource {
  return value === 'recent_auto' ? 'recent_auto' : fallback;
}

export function defaultDesktopPreferencesPaths(
  userDataDir: string,
  options: Readonly<{ stateRoot?: string }> = {},
): DesktopPreferencesPaths {
  return {
    preferencesFile: path.join(userDataDir, 'desktop-preferences.json'),
    secretsFile: path.join(userDataDir, 'desktop-secrets.json'),
    stateRoot: resolveStateRoot(process.env, os.homedir, options.stateRoot),
  };
}

function defaultDesktopCatalogPaths(stateRootOverride?: string): DesktopCatalogPaths {
  const stateRoot = resolveStateRoot(process.env, os.homedir, stateRootOverride);
  const catalogRoot = path.join(stateRoot, 'catalog');
  return {
    stateRoot,
    catalogRoot,
    environmentsDir: path.join(catalogRoot, 'environments'),
    connectionsDir: path.join(catalogRoot, 'connections'),
    providersDir: path.join(catalogRoot, 'providers'),
    providerEnvironmentsDir: path.join(catalogRoot, 'provider-environments'),
    providerEnvironmentPreferencesDir: path.join(catalogRoot, 'provider-environment-preferences'),
  };
}

export function desktopPreferencesToDraft(
  preferences: DesktopPreferences,
  environmentID?: string,
): DesktopSettingsDraft {
  const access = (() => {
    const managedEnvironment = environmentID ? findManagedEnvironmentByID(preferences, environmentID) : null;
    if (managedEnvironment) {
      return managedEnvironmentLocalAccess(managedEnvironment);
    }
    const providerEnvironment = environmentID ? findProviderEnvironmentByID(preferences, environmentID) : null;
    if (providerEnvironment) {
      return providerEnvironmentLocalAccess(providerEnvironment);
    }
    return managedEnvironmentLocalAccess(
      preferences.managed_environments[0]
      ?? createManagedLocalEnvironment('default'),
    );
  })();
  return {
    local_ui_bind: access.local_ui_bind,
    local_ui_password: '',
    local_ui_password_mode: access.local_ui_password_configured ? 'keep' : 'replace',
  };
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeLastUsedAtMS(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  return fallback;
}

export function desktopEnvironmentID(rawURL: string): string {
  return normalizeLocalUIBaseURL(rawURL);
}

export function defaultSavedEnvironmentLabel(rawURL: string): string {
  const normalizedURL = normalizeLocalUIBaseURL(rawURL);
  try {
    const parsed = new URL(normalizedURL);
    return parsed.host || normalizedURL;
  } catch {
    return normalizedURL;
  }
}

function sortSavedEnvironmentsByLastUsed(
  environments: readonly DesktopSavedEnvironment[],
): readonly DesktopSavedEnvironment[] {
  return [...environments].sort((left, right) => (
    (left.pinned ? 0 : 1) - (right.pinned ? 0 : 1)
    || right.last_used_at_ms - left.last_used_at_ms
    || left.label.localeCompare(right.label)
    || left.local_ui_url.localeCompare(right.local_ui_url)
  ));
}

function sortSavedSSHEnvironmentsByLastUsed(
  environments: readonly DesktopSavedSSHEnvironment[],
): readonly DesktopSavedSSHEnvironment[] {
  return [...environments].sort((left, right) => (
    (left.pinned ? 0 : 1) - (right.pinned ? 0 : 1)
    || right.last_used_at_ms - left.last_used_at_ms
    || left.label.localeCompare(right.label)
    || left.ssh_destination.localeCompare(right.ssh_destination)
    || String(left.ssh_port ?? '').localeCompare(String(right.ssh_port ?? ''))
    || left.remote_install_dir.localeCompare(right.remote_install_dir)
    || left.environment_instance_id.localeCompare(right.environment_instance_id)
  ));
}

function sortSavedControlPlanes(
  controlPlanes: readonly DesktopSavedControlPlane[],
): readonly DesktopSavedControlPlane[] {
  return [...controlPlanes].sort((left, right) => (
    right.last_synced_at_ms - left.last_synced_at_ms
    || left.provider.display_name.localeCompare(right.provider.display_name)
    || left.provider.provider_origin.localeCompare(right.provider.provider_origin)
  ));
}

function sortProviderEnvironmentPreferences(
  preferences: readonly DesktopProviderEnvironmentPreference[],
): readonly DesktopProviderEnvironmentPreference[] {
  return [...preferences].sort((left, right) => (
    (left.pinned ? 0 : 1) - (right.pinned ? 0 : 1)
    || right.last_used_at_ms - left.last_used_at_ms
    || left.provider_origin.localeCompare(right.provider_origin)
    || left.provider_id.localeCompare(right.provider_id)
    || left.env_public_id.localeCompare(right.env_public_id)
  ));
}

function sortManagedEnvironments(
  environments: readonly DesktopManagedEnvironment[],
): readonly DesktopManagedEnvironment[] {
  return [...environments].sort((left, right) => {
    const [leftPinned, leftLabel, leftID] = managedEnvironmentSortKey(left);
    const [rightPinned, rightLabel, rightID] = managedEnvironmentSortKey(right);
    return leftPinned - rightPinned || leftLabel.localeCompare(rightLabel) || leftID.localeCompare(rightID);
  });
}

function sortProviderEnvironments(
  environments: readonly DesktopProviderEnvironmentRecord[],
): readonly DesktopProviderEnvironmentRecord[] {
  return [...environments].sort((left, right) => {
    const [leftPinned, leftLabel, leftID] = providerEnvironmentSortKey(left);
    const [rightPinned, rightLabel, rightID] = providerEnvironmentSortKey(right);
    return leftPinned - rightPinned || leftLabel.localeCompare(rightLabel) || leftID.localeCompare(rightID);
  });
}

function normalizePinned(value: unknown): boolean {
  return value === true;
}

function normalizePreferredOpenRoute(
  value: unknown,
  fallback: 'auto' | 'local_host' | 'remote_desktop' = 'auto',
): 'auto' | 'local_host' | 'remote_desktop' {
  return value === 'local_host' || value === 'remote_desktop' || value === 'auto' ? value : fallback;
}

function resolveManagedEnvironmentStateDir(input: Readonly<{
  name?: string;
  providerOrigin?: string;
  envPublicID?: string;
}>, stateRootOverride?: string): string {
  const envPublicID = compact(input.envPublicID);
  const providerOrigin = compact(input.providerOrigin);
  if (providerOrigin !== '' && envPublicID !== '') {
    return controlPlaneManagedStateLayout(providerOrigin, envPublicID, process.env, os.homedir, stateRootOverride).stateDir;
  }
  const name = compact(input.name);
  if (name !== '') {
    return localManagedStateLayout(name, process.env, os.homedir, stateRootOverride).stateDir;
  }
  return '';
}

function normalizeManagedEnvironmentAccess(
  localUIBind: unknown,
  localUIPassword: string,
  localUIPasswordConfigured = compact(localUIPassword) !== '',
): DesktopManagedEnvironmentAccess {
  const draft = validateDesktopSettingsDraft({
    local_ui_bind: compact(localUIBind) || DEFAULT_DESKTOP_LOCAL_UI_BIND,
    local_ui_password: localUIPassword,
    local_ui_password_mode: localUIPasswordConfigured && compact(localUIPassword) === '' ? 'keep' : compact(localUIPassword) === '' ? 'replace' : 'keep',
  }, {
    currentLocalUIPassword: localUIPassword,
    currentLocalUIPasswordConfigured: localUIPasswordConfigured,
  });
  return draft;
}

function decodeManagedEnvironmentPasswords(
  codec: DesktopSecretCodec,
  values: readonly unknown[] | null | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(values)) {
    return out;
  }

  for (const value of values) {
    const candidate = value as DesktopManagedEnvironmentSecretFile;
    const environmentID = compact(candidate?.environment_id);
    const localUIPassword = decodeOptionalSecret(codec, candidate?.local_ui_password);
    if (environmentID === '' || compact(localUIPassword) === '') {
      continue;
    }
    out.set(environmentID, localUIPassword);
  }
  return out;
}

function normalizeManagedEnvironmentCandidate(
  value: unknown,
  passwordsByID: ReadonlyMap<string, string>,
  stateRootOverride?: string,
): DesktopManagedEnvironment | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as DesktopManagedEnvironmentFile;
  const kind = compact(candidate.kind).toLowerCase();
  const createdAtMS = normalizeLastUsedAtMS(candidate.created_at_ms, Date.now());
  const updatedAtMS = normalizeLastUsedAtMS(candidate.updated_at_ms, createdAtMS);
  const lastUsedAtMS = normalizeLastUsedAtMS(candidate.last_used_at_ms, 0);

  if (kind === 'controlplane') {
    try {
      const environmentID = compact(candidate.id)
        || desktopManagedControlPlaneEnvironmentID(
          compact(candidate.provider_origin),
          compact(candidate.env_public_id),
        );
      const localUIPassword = String(passwordsByID.get(environmentID) ?? '');
      const providerOrigin = compact(candidate.provider_origin);
      const envPublicID = compact(candidate.env_public_id);
      const layout = controlPlaneManagedStateLayout(
        providerOrigin,
        envPublicID,
        process.env,
        os.homedir,
        stateRootOverride,
      );
      const scopeParts = layout.scopeKey.split('/');
      return createManagedControlPlaneEnvironment(
        providerOrigin,
        envPublicID,
        {
          localHosting: createManagedEnvironmentLocalHosting(
            {
              kind: 'controlplane',
              provider_origin: providerOrigin,
              provider_key: scopeParts[1] ?? '',
              env_public_id: envPublicID,
            },
            {
              access: normalizeManagedEnvironmentAccess(candidate.local_ui_bind, localUIPassword),
              owner: 'desktop',
              stateDir: layout.stateDir,
            },
          ),
          providerID: compact(candidate.provider_id),
          label: compact(candidate.label),
          pinned: normalizePinned(candidate.pinned),
          createdAtMS,
          updatedAtMS,
          lastUsedAtMS,
        },
      );
    } catch {
      return null;
    }
  }

  if (kind === 'local') {
    const name = normalizeDesktopLocalEnvironmentName(candidate.name);
    const environmentID = compact(candidate.id) || desktopManagedLocalEnvironmentID(name);
    const localUIPassword = String(passwordsByID.get(environmentID) ?? '');
    try {
      return createManagedLocalEnvironment(name, {
        label: compact(candidate.label) || defaultLocalManagedEnvironmentLabel(name),
        pinned: normalizePinned(candidate.pinned),
        createdAtMS,
        updatedAtMS,
        lastUsedAtMS,
        access: normalizeManagedEnvironmentAccess(candidate.local_ui_bind, localUIPassword),
      });
    } catch {
      return null;
    }
  }

  return null;
}

function ensureDefaultManagedEnvironment(
  environments: readonly DesktopManagedEnvironment[],
  legacyAccess?: DesktopManagedEnvironmentAccess,
  stateRootOverride?: string,
): readonly DesktopManagedEnvironment[] {
  const defaultID = desktopManagedLocalEnvironmentID('default');
  if (environments.some((environment) => environment.id === defaultID)) {
    return sortManagedEnvironments(environments);
  }
  return sortManagedEnvironments([
    createManagedLocalEnvironment('default', {
      access: legacyAccess,
      stateDir: resolveManagedEnvironmentStateDir({ name: 'default' }, stateRootOverride),
    }),
    ...environments,
  ]);
}

export function normalizeManagedEnvironments(
  values: readonly unknown[] | null | undefined,
  options: Readonly<{
    passwordsByID?: ReadonlyMap<string, string>;
    legacyLocalUIBind?: string;
    legacyLocalUIPassword?: string;
    legacyLocalUIPasswordConfigured?: boolean;
    stateRoot?: string;
  }> = {},
): readonly DesktopManagedEnvironment[] {
  const passwordsByID = options.passwordsByID ?? new Map<string, string>();
  const sourceValues = Array.isArray(values) ? values : [];
  const normalized: DesktopManagedEnvironment[] = [];
  const seenIDs = new Set<string>();

  for (const value of sourceValues) {
    const environment = normalizeManagedEnvironmentCandidate(value, passwordsByID, options.stateRoot);
    if (!environment || seenIDs.has(environment.id)) {
      continue;
    }
    seenIDs.add(environment.id);
    normalized.push(environment);
  }

  const legacyAccess = normalizeManagedEnvironmentAccess(
    options.legacyLocalUIBind ?? DEFAULT_DESKTOP_LOCAL_UI_BIND,
    options.legacyLocalUIPasswordConfigured === true ? options.legacyLocalUIPassword ?? '' : '',
  );
  return ensureDefaultManagedEnvironment(normalized, legacyAccess, options.stateRoot);
}

export function findManagedEnvironmentByID(
  preferences: DesktopPreferences,
  environmentID: string,
): DesktopManagedEnvironment | null {
  const cleanEnvironmentID = compact(environmentID);
  if (cleanEnvironmentID === '') {
    return null;
  }
  return preferences.managed_environments.find((environment) => environment.id === cleanEnvironmentID) ?? null;
}

export function findProviderEnvironmentByID(
  preferences: DesktopPreferences,
  environmentID: string,
): DesktopProviderEnvironmentRecord | null {
  const cleanEnvironmentID = compact(environmentID);
  if (cleanEnvironmentID === '') {
    return null;
  }
  return preferences.provider_environments.find((environment) => environment.id === cleanEnvironmentID) ?? null;
}

function normalizeSavedEnvironmentCandidate(
  value: unknown,
  fallbackLastUsedAtMS: number,
): DesktopSavedEnvironment | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as DesktopSavedEnvironmentFile;
  let normalizedURL = '';
  try {
    normalizedURL = normalizeLocalUIBaseURL(compact(candidate.local_ui_url));
  } catch {
    return null;
  }

  const environmentID = compact(candidate.id) || desktopEnvironmentID(normalizedURL);
  const label = compact(candidate.label) || defaultSavedEnvironmentLabel(normalizedURL);
  return {
    id: environmentID,
    label,
    local_ui_url: normalizedURL,
    source: normalizeSavedEnvironmentSource(candidate.source, 'saved'),
    pinned: normalizePinned(candidate.pinned),
    last_used_at_ms: normalizeLastUsedAtMS(candidate.last_used_at_ms, fallbackLastUsedAtMS),
  };
}

function normalizeSavedSSHEnvironmentCandidate(
  value: unknown,
  fallbackLastUsedAtMS: number,
): SavedSSHEnvironmentCandidateNormalizationResult {
  if (!value || typeof value !== 'object') {
    return {
      environment: null,
      didCanonicalize: false,
    };
  }

  const candidate = value as DesktopSavedSSHEnvironmentFile;
  let details: DesktopSSHEnvironmentDetails;
  try {
    details = normalizeDesktopSSHEnvironmentDetails({
      ssh_destination: normalizeDesktopSSHDestination(candidate.ssh_destination),
      ssh_port: normalizeDesktopSSHPort(candidate.ssh_port),
      auth_mode: normalizeDesktopSSHAuthMode(candidate.auth_mode),
      remote_install_dir: normalizeDesktopSSHRemoteInstallDir(candidate.remote_install_dir),
      bootstrap_strategy: normalizeDesktopSSHBootstrapStrategy(candidate.bootstrap_strategy),
      release_base_url: normalizeDesktopSSHReleaseBaseURL(candidate.release_base_url),
      environment_instance_id: candidate.environment_instance_id,
    });
  } catch {
    return {
      environment: null,
      didCanonicalize: false,
    };
  }

  const environmentID = desktopSSHEnvironmentID(details);
  const label = compact(candidate.label) || defaultSavedSSHEnvironmentLabel(details);
  return {
    environment: {
      id: environmentID,
      label,
      ssh_destination: details.ssh_destination,
      ssh_port: details.ssh_port,
      auth_mode: details.auth_mode,
      remote_install_dir: details.remote_install_dir,
      bootstrap_strategy: details.bootstrap_strategy,
      release_base_url: details.release_base_url,
      environment_instance_id: details.environment_instance_id,
      source: normalizeSavedEnvironmentSource(candidate.source, 'saved'),
      pinned: normalizePinned(candidate.pinned),
      last_used_at_ms: normalizeLastUsedAtMS(candidate.last_used_at_ms, fallbackLastUsedAtMS),
    },
    didCanonicalize: compact(candidate.id) !== environmentID
      || compact(candidate.environment_instance_id) !== details.environment_instance_id,
  };
}

function normalizeSavedControlPlaneCandidate(
  value: unknown,
  refreshTokensByKey: ReadonlyMap<string, string>,
  fallbackLastSyncedAtMS: number,
): DesktopSavedControlPlane | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as DesktopControlPlaneFile;
  const provider = normalizeDesktopControlPlaneProvider(candidate.provider);
  if (!provider) {
    return null;
  }

  let refreshToken = '';
  try {
    refreshToken = String(refreshTokensByKey.get(desktopControlPlaneKey(provider.provider_origin, provider.provider_id)) ?? '');
  } catch {
    return null;
  }
  if (compact(refreshToken) === '') {
    return null;
  }

  const account = normalizeDesktopControlPlaneAccount(candidate.account, {
    provider,
  });
  if (!account) {
    return null;
  }

  return {
    provider,
    account,
    environments: normalizeDesktopProviderEnvironmentList({ environments: candidate.environments }, { provider }),
    display_label: normalizeControlPlaneDisplayLabel(candidate.display_label, provider.provider_origin),
    last_synced_at_ms: normalizeLastUsedAtMS(candidate.last_synced_at_ms, fallbackLastSyncedAtMS),
  };
}

function legacyRecentURLsToSavedEnvironments(values: readonly unknown[]): readonly DesktopSavedEnvironment[] {
  if (values.length <= 0) {
    return [];
  }

  const converted: DesktopSavedEnvironment[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const clean = compact(values[index]);
    if (clean === '') {
      continue;
    }
    try {
      const normalizedURL = normalizeLocalUIBaseURL(clean);
      converted.push({
        id: desktopEnvironmentID(normalizedURL),
        label: defaultSavedEnvironmentLabel(normalizedURL),
        local_ui_url: normalizedURL,
        source: 'recent_auto',
        pinned: false,
        last_used_at_ms: values.length - index,
      });
    } catch {
      // Ignore malformed legacy entries during migration.
    }
  }
  return converted;
}

export function normalizeRecentExternalLocalUIURLs(values: readonly unknown[] | null | undefined): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = compact(value);
    if (clean === '') {
      continue;
    }
    let url = '';
    try {
      url = normalizeLocalUIBaseURL(clean);
    } catch {
      continue;
    }
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    normalized.push(url);
    if (normalized.length >= MAX_RECENT_EXTERNAL_LOCAL_UI_URLS) {
      break;
    }
  }
  return normalized;
}

export function normalizeSavedEnvironments(
  values: readonly unknown[] | null | undefined,
  legacyRecentURLs: readonly unknown[] | null | undefined = null,
): readonly DesktopSavedEnvironment[] {
  const sourceValues = Array.isArray(values) ? values : [];
  const normalized: DesktopSavedEnvironment[] = [];
  const seenURLs = new Set<string>();

  for (let index = 0; index < sourceValues.length; index += 1) {
    const environment = normalizeSavedEnvironmentCandidate(sourceValues[index], sourceValues.length - index);
    if (!environment || seenURLs.has(environment.local_ui_url)) {
      continue;
    }
    seenURLs.add(environment.local_ui_url);
    normalized.push(environment);
  }

  if (normalized.length <= 0 && Array.isArray(legacyRecentURLs)) {
    for (const environment of legacyRecentURLsToSavedEnvironments(legacyRecentURLs)) {
      if (seenURLs.has(environment.local_ui_url)) {
        continue;
      }
      seenURLs.add(environment.local_ui_url);
      normalized.push(environment);
    }
  }

  return sortSavedEnvironmentsByLastUsed(normalized).slice(0, MAX_SAVED_ENVIRONMENTS);
}

function collectSavedSSHEnvironmentNormalizationResult(
  values: readonly unknown[] | null | undefined,
): SavedSSHEnvironmentNormalizationResult {
  const sourceValues = Array.isArray(values) ? values : [];
  const normalized: DesktopSavedSSHEnvironment[] = [];
  const seenIDs = new Set<string>();
  let didCanonicalize = false;

  for (let index = 0; index < sourceValues.length; index += 1) {
    const result = normalizeSavedSSHEnvironmentCandidate(sourceValues[index], sourceValues.length - index);
    didCanonicalize ||= result.didCanonicalize;
    if (!result.environment || seenIDs.has(result.environment.id)) {
      continue;
    }
    seenIDs.add(result.environment.id);
    normalized.push(result.environment);
  }

  return {
    environments: sortSavedSSHEnvironmentsByLastUsed(normalized).slice(0, MAX_SAVED_SSH_ENVIRONMENTS),
    didCanonicalize,
  };
}

export function normalizeSavedSSHEnvironments(
  values: readonly unknown[] | null | undefined,
): readonly DesktopSavedSSHEnvironment[] {
  return collectSavedSSHEnvironmentNormalizationResult(values).environments;
}

function decodeDesktopControlPlaneRefreshTokens(
  codec: DesktopSecretCodec,
  values: readonly DesktopControlPlaneSecretFile[] | null | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(values)) {
    return out;
  }

  for (const value of values) {
    const providerOrigin = compact(value?.provider_origin);
    const providerID = compact(value?.provider_id);
    const refreshToken = decodeOptionalSecret(codec, value?.refresh_token);
    if (providerOrigin === '' || providerID === '' || compact(refreshToken) === '') {
      continue;
    }
    try {
      out.set(desktopControlPlaneKey(providerOrigin, providerID), compact(refreshToken));
    } catch {
      // Ignore malformed secret entries during recovery.
    }
  }
  return out;
}

export function normalizeSavedControlPlanes(
  values: readonly unknown[] | null | undefined,
  refreshTokensByKey: ReadonlyMap<string, string>,
): readonly DesktopSavedControlPlane[] {
  const sourceValues = Array.isArray(values) ? values : [];
  const normalized: DesktopSavedControlPlane[] = [];
  const seenKeys = new Set<string>();

  for (let index = 0; index < sourceValues.length; index += 1) {
    const controlPlane = normalizeSavedControlPlaneCandidate(
      sourceValues[index],
      refreshTokensByKey,
      sourceValues.length - index,
    );
    if (!controlPlane) {
      continue;
    }
    const key = desktopControlPlaneKey(controlPlane.provider.provider_origin, controlPlane.provider.provider_id);
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    normalized.push(controlPlane);
  }

  return sortSavedControlPlanes(normalized);
}

function normalizeProviderEnvironmentRemoteCatalogEntry(
  value: unknown,
): DesktopProviderEnvironmentRecord['remote_catalog_entry'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as NonNullable<DesktopProviderEnvironmentCatalogFile['remote_catalog_entry']>;
  const entry = {
    environment_url: compact(candidate.environment_url),
    description: compact(candidate.description),
    namespace_public_id: compact(candidate.namespace_public_id),
    namespace_name: compact(candidate.namespace_name),
    status: compact(candidate.status),
    lifecycle_status: compact(candidate.lifecycle_status),
    last_seen_at_unix_ms: normalizeLastUsedAtMS(candidate.last_seen_at_unix_ms, 0),
  };
  return (
    entry.environment_url !== ''
    || entry.description !== ''
    || entry.namespace_public_id !== ''
    || entry.namespace_name !== ''
    || entry.status !== ''
    || entry.lifecycle_status !== ''
    || entry.last_seen_at_unix_ms > 0
  )
    ? entry
    : undefined;
}

function providerEnvironmentLocalRuntimeFromManagedEnvironment(
  environment: DesktopManagedEnvironment,
): DesktopProviderEnvironmentLocalRuntime | undefined {
  if (!environment.local_hosting || !environment.provider_binding) {
    return undefined;
  }
  return createDesktopProviderEnvironmentLocalRuntime(
    environment.provider_binding.provider_origin,
    environment.provider_binding.env_public_id,
    {
      access: environment.local_hosting.access,
      owner: environment.local_hosting.owner,
      stateDir: environment.local_hosting.state_dir,
      currentRuntime: environment.local_hosting.current_runtime,
    },
  );
}

function normalizeProviderEnvironmentCatalogCandidate(
  value: unknown,
  passwordsByID: ReadonlyMap<string, string>,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
  stateRootOverride?: string,
): Readonly<{
  environment: DesktopProviderEnvironmentRecord | null;
  didCanonicalizeProviderIdentity: boolean;
}> {
  if (!value || typeof value !== 'object') {
    return {
      environment: null,
      didCanonicalizeProviderIdentity: false,
    };
  }
  const candidate = value as DesktopProviderEnvironmentCatalogFile;
  const recordKind = compact(candidate.record_kind);
  if (recordKind !== '' && recordKind !== 'provider_environment') {
    return {
      environment: null,
      didCanonicalizeProviderIdentity: false,
    };
  }
  const providerOrigin = compact(candidate.provider_origin);
  const envPublicID = compact(candidate.env_public_id);
  const normalizedProviderIdentity = normalizeProviderIdentityForOrigin(
    providerOrigin,
    candidate.provider_id,
    canonicalProviderIDsByOrigin,
  );
  if (providerOrigin === '' || envPublicID === '' || normalizedProviderIdentity.providerID === '') {
    return {
      environment: null,
      didCanonicalizeProviderIdentity: normalizedProviderIdentity.didCanonicalize,
    };
  }
  const environmentID = compact(candidate.id)
    || desktopProviderEnvironmentID(providerOrigin, envPublicID);
  const password = String(passwordsByID.get(environmentID) ?? '');
  const localRuntime = (() => {
    if (!candidate.local_runtime || typeof candidate.local_runtime !== 'object') {
      return undefined;
    }
    const stateScope = candidate.local_runtime.state_scope;
    const runtimeProviderOrigin = compact(stateScope?.provider_origin) || providerOrigin;
    const runtimeEnvPublicID = compact(stateScope?.env_public_id) || envPublicID;
    const layout = controlPlaneManagedStateLayout(
      runtimeProviderOrigin,
      runtimeEnvPublicID,
      process.env,
      os.homedir,
      stateRootOverride,
    );
    const passwordConfigured = candidate.local_runtime.access?.local_ui_password_configured === true || compact(password) !== '';
    const access = normalizeManagedEnvironmentAccess(
      candidate.local_runtime.access?.local_ui_bind ?? DEFAULT_DESKTOP_LOCAL_UI_BIND,
      password,
      passwordConfigured,
    );
    const owner = candidate.local_runtime.owner === 'desktop' || candidate.local_runtime.owner === 'agent'
      ? candidate.local_runtime.owner
      : 'unknown';
    return createDesktopProviderEnvironmentLocalRuntime(runtimeProviderOrigin, runtimeEnvPublicID, {
      access,
      owner,
      stateDir: compact(stateScope?.state_dir) || layout.stateDir,
    });
  })();
  try {
    return {
      environment: createDesktopProviderEnvironmentRecord(providerOrigin, envPublicID, {
        environmentID,
        providerID: normalizedProviderIdentity.providerID,
        label: compact(candidate.label),
        pinned: normalizePinned(candidate.pinned),
        preferredOpenRoute: normalizePreferredOpenRoute(candidate.preferred_open_route),
        remoteWebSupported: candidate.remote_web_supported !== false,
        remoteDesktopSupported: candidate.remote_desktop_supported !== false,
        remoteCatalogEntry: normalizeProviderEnvironmentRemoteCatalogEntry(candidate.remote_catalog_entry),
        localRuntime,
        createdAtMS: normalizeLastUsedAtMS(candidate.created_at_ms, Date.now()),
        updatedAtMS: normalizeLastUsedAtMS(candidate.updated_at_ms, Date.now()),
        lastUsedAtMS: normalizeLastUsedAtMS(candidate.last_used_at_ms, 0),
      }),
      didCanonicalizeProviderIdentity: normalizedProviderIdentity.didCanonicalize,
    };
  } catch {
    return {
      environment: null,
      didCanonicalizeProviderIdentity: normalizedProviderIdentity.didCanonicalize,
    };
  }
}

function normalizeProviderEnvironmentCollection(
  environments: readonly DesktopProviderEnvironmentRecord[],
): readonly DesktopProviderEnvironmentRecord[] {
  const seenIDs = new Set<string>();
  const normalized: DesktopProviderEnvironmentRecord[] = [];
  for (const environment of environments) {
    if (seenIDs.has(environment.id)) {
      continue;
    }
    seenIDs.add(environment.id);
    normalized.push(environment);
  }
  return sortProviderEnvironments(normalized);
}

function normalizeProviderEnvironmentsFromCatalog(
  values: readonly unknown[],
  passwordsByID: ReadonlyMap<string, string>,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
  stateRootOverride?: string,
): ProviderEnvironmentNormalizationResult {
  const normalized: DesktopProviderEnvironmentRecord[] = [];
  let didCanonicalizeProviderIdentity = false;
  for (const value of values) {
    const result = normalizeProviderEnvironmentCatalogCandidate(
      value,
      passwordsByID,
      canonicalProviderIDsByOrigin,
      stateRootOverride,
    );
    didCanonicalizeProviderIdentity ||= result.didCanonicalizeProviderIdentity;
    if (!result.environment) {
      continue;
    }
    normalized.push(result.environment);
  }
  return {
    environments: normalizeProviderEnvironmentCollection(normalized),
    didCanonicalizeProviderIdentity,
  };
}

function mergeProviderEnvironmentRecord(
  existing: DesktopProviderEnvironmentRecord | null,
  input: Readonly<{
    provider_origin: string;
    provider_id: string;
    env_public_id: string;
    label?: string;
    pinned?: boolean;
    preferred_open_route?: DesktopManagedEnvironmentPreferredOpenRoute;
    remote_web_supported?: boolean;
    remote_desktop_supported?: boolean;
    remote_catalog_entry?: DesktopProviderEnvironmentRecord['remote_catalog_entry'] | null;
    local_runtime?: DesktopProviderEnvironmentLocalRuntime | null;
    created_at_ms?: number;
    updated_at_ms?: number;
    last_used_at_ms?: number;
  }>,
): DesktopProviderEnvironmentRecord {
  const label = compact(input.label) || existing?.label || defaultDesktopProviderEnvironmentLabel(input.env_public_id);
  const pinned = input.pinned ?? existing?.pinned ?? false;
  const preferredOpenRoute = input.preferred_open_route ?? existing?.preferred_open_route ?? 'auto';
  const remoteCatalogEntry = input.remote_catalog_entry === undefined
    ? existing?.remote_catalog_entry
    : input.remote_catalog_entry ?? undefined;
  const localRuntime = input.local_runtime === undefined
    ? existing?.local_runtime
    : input.local_runtime ?? undefined;
  return createDesktopProviderEnvironmentRecord(input.provider_origin, input.env_public_id, {
    environmentID: existing?.id,
    providerID: input.provider_id || existing?.provider_id || '',
    label,
    pinned,
    preferredOpenRoute,
    remoteWebSupported: input.remote_web_supported ?? existing?.remote_web_supported ?? true,
    remoteDesktopSupported: input.remote_desktop_supported ?? existing?.remote_desktop_supported ?? true,
    remoteCatalogEntry: remoteCatalogEntry ?? undefined,
    localRuntime,
    createdAtMS: existing?.created_at_ms ?? input.created_at_ms ?? Date.now(),
    updatedAtMS: Math.max(
      existing?.updated_at_ms ?? 0,
      input.updated_at_ms ?? 0,
      existing?.created_at_ms ?? 0,
      input.created_at_ms ?? 0,
      1,
    ),
    lastUsedAtMS: Math.max(existing?.last_used_at_ms ?? 0, input.last_used_at_ms ?? 0),
  });
}

function providerEnvironmentShouldPersistWithoutRemoteCatalog(
  environment: DesktopProviderEnvironmentRecord,
): boolean {
  return Boolean(environment.local_runtime) || environment.pinned || environment.last_used_at_ms > 0;
}

function reconcileProviderEnvironments(
  input: Readonly<{
    stored: readonly DesktopProviderEnvironmentRecord[];
    legacyPreferences: readonly DesktopProviderEnvironmentPreference[];
    legacyManagedEnvironments: readonly DesktopManagedEnvironment[];
    controlPlanes: readonly DesktopSavedControlPlane[];
  }>,
): readonly DesktopProviderEnvironmentRecord[] {
  const canonicalProviderIDsByOrigin = buildCanonicalProviderIDByOrigin(input.controlPlanes);
  const recordsByKey = new Map<string, DesktopProviderEnvironmentRecord>();
  const activeCatalogKeys = new Set<string>();

  const upsert = (
    source: Readonly<{
      provider_origin: string;
      provider_id: string;
      env_public_id: string;
      label?: string;
      pinned?: boolean;
      preferred_open_route?: DesktopManagedEnvironmentPreferredOpenRoute;
      remote_web_supported?: boolean;
      remote_desktop_supported?: boolean;
      remote_catalog_entry?: DesktopProviderEnvironmentRecord['remote_catalog_entry'];
      local_runtime?: DesktopProviderEnvironmentLocalRuntime;
      created_at_ms?: number;
      updated_at_ms?: number;
      last_used_at_ms?: number;
    }>,
  ): void => {
    const key = providerEnvironmentRecordKey(
      source.provider_origin,
      source.provider_id,
      source.env_public_id,
    );
    const existing = recordsByKey.get(key) ?? null;
    recordsByKey.set(key, mergeProviderEnvironmentRecord(existing, source));
  };

  for (const environment of input.stored) {
    const canonicalEnvironment = canonicalizeProviderEnvironmentIdentity(environment, canonicalProviderIDsByOrigin);
    recordsByKey.set(
      providerEnvironmentRecordKey(
        canonicalEnvironment.provider_origin,
        canonicalEnvironment.provider_id,
        canonicalEnvironment.env_public_id,
      ),
      canonicalEnvironment,
    );
  }

  for (const controlPlane of input.controlPlanes) {
    for (const environment of controlPlane.environments) {
      const key = providerEnvironmentRecordKey(
        controlPlane.provider.provider_origin,
        controlPlane.provider.provider_id,
        environment.env_public_id,
      );
      activeCatalogKeys.add(key);
      upsert({
        provider_origin: controlPlane.provider.provider_origin,
        provider_id: controlPlane.provider.provider_id,
        env_public_id: environment.env_public_id,
        label: environment.label,
        remote_web_supported: true,
        remote_desktop_supported: true,
        remote_catalog_entry: desktopProviderEnvironmentRemoteCatalogEntryFromPublished(environment),
        created_at_ms: controlPlane.last_synced_at_ms || Date.now(),
        updated_at_ms: controlPlane.last_synced_at_ms || Date.now(),
      });
    }
  }

  for (const preference of input.legacyPreferences) {
    upsert({
      provider_origin: preference.provider_origin,
      provider_id: preference.provider_id,
      env_public_id: preference.env_public_id,
      pinned: preference.pinned,
      last_used_at_ms: preference.last_used_at_ms,
      updated_at_ms: preference.last_used_at_ms,
    });
  }

  for (const environment of input.legacyManagedEnvironments) {
    if (!environment.provider_binding || !environment.local_hosting) {
      continue;
    }
    const normalizedProviderIdentity = normalizeProviderIdentityForOrigin(
      environment.provider_binding.provider_origin,
      environment.provider_binding.provider_id,
      canonicalProviderIDsByOrigin,
    );
    upsert({
      provider_origin: environment.provider_binding.provider_origin,
      provider_id: normalizedProviderIdentity.providerID || environment.provider_binding.provider_id,
      env_public_id: environment.provider_binding.env_public_id,
      label: environment.label,
      pinned: environment.pinned,
      preferred_open_route: environment.preferred_open_route,
      remote_web_supported: environment.provider_binding.remote_web_supported,
      remote_desktop_supported: environment.provider_binding.remote_desktop_supported,
      local_runtime: providerEnvironmentLocalRuntimeFromManagedEnvironment(environment),
      created_at_ms: environment.created_at_ms,
      updated_at_ms: environment.updated_at_ms,
      last_used_at_ms: environment.last_used_at_ms,
    });
  }

  return normalizeProviderEnvironmentCollection(
    [...recordsByKey.entries()]
      .filter(([key, environment]) => (
        activeCatalogKeys.has(key) || providerEnvironmentShouldPersistWithoutRemoteCatalog(environment)
      ))
      .map(([, environment]) => environment),
  );
}

function normalizeProviderEnvironmentPreferenceCandidate(
  value: unknown,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
): DesktopProviderEnvironmentPreference | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as DesktopProviderEnvironmentPreferenceCatalogFile;
  const providerOrigin = compact(candidate.provider_origin);
  const envPublicID = compact(candidate.env_public_id);
  const normalizedProviderIdentity = normalizeProviderIdentityForOrigin(
    providerOrigin,
    candidate.provider_id,
    canonicalProviderIDsByOrigin,
  );
  if (providerOrigin === '' || envPublicID === '' || normalizedProviderIdentity.providerID === '') {
    return null;
  }
  try {
    return createProviderEnvironmentPreference(
      providerOrigin,
      normalizedProviderIdentity.providerID,
      envPublicID,
      {
        pinned: normalizePinned(candidate.pinned),
        lastUsedAtMS: normalizeLastUsedAtMS(candidate.last_used_at_ms, 0),
      },
    );
  } catch {
    return null;
  }
}

export function normalizeProviderEnvironmentPreferences(
  values: readonly unknown[] | null | undefined,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
): readonly DesktopProviderEnvironmentPreference[] {
  const sourceValues = Array.isArray(values) ? values : [];
  const normalized: DesktopProviderEnvironmentPreference[] = [];
  const seenKeys = new Set<string>();
  for (const value of sourceValues) {
    const preference = normalizeProviderEnvironmentPreferenceCandidate(value, canonicalProviderIDsByOrigin);
    if (!preference) {
      continue;
    }
    const key = providerEnvironmentRecordKey(
      preference.provider_origin,
      preference.provider_id,
      preference.env_public_id,
    );
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    normalized.push(preference);
  }
  return sortProviderEnvironmentPreferences(normalized);
}

export function deriveRecentExternalLocalUIURLs(
  savedEnvironments: readonly DesktopSavedEnvironment[],
): readonly string[] {
  return normalizeRecentExternalLocalUIURLs(
    sortSavedEnvironmentsByLastUsed(
      savedEnvironments.filter((environment) => environment.source === 'saved' || environment.source === 'recent_auto'),
    ).map((environment) => environment.local_ui_url),
  );
}

function legacyProviderIDForOrigin(providerOrigin: string): string {
  try {
    return controlPlaneProviderKeyForOrigin(providerOrigin);
  } catch {
    return '';
  }
}

function providerIDMatchesCanonicalIdentity(
  providerOrigin: string,
  actualProviderID: string,
  canonicalProviderID: string,
): boolean {
  const cleanActualProviderID = compact(actualProviderID);
  const cleanCanonicalProviderID = compact(canonicalProviderID);
  if (cleanActualProviderID === '' || cleanCanonicalProviderID === '') {
    return false;
  }
  return (
    cleanActualProviderID === cleanCanonicalProviderID
    || cleanActualProviderID === legacyProviderIDForOrigin(providerOrigin)
  );
}

function buildCanonicalProviderIDByOrigin(
  controlPlanes: readonly DesktopSavedControlPlane[],
): ReadonlyMap<string, string> {
  const canonicalProviderIDsByOrigin = new Map<string, string>();
  const conflictedOrigins = new Set<string>();
  for (const controlPlane of controlPlanes) {
    const providerOrigin = controlPlane.provider.provider_origin;
    const providerID = controlPlane.provider.provider_id;
    if (conflictedOrigins.has(providerOrigin)) {
      continue;
    }
    const existingProviderID = canonicalProviderIDsByOrigin.get(providerOrigin);
    if (!existingProviderID) {
      canonicalProviderIDsByOrigin.set(providerOrigin, providerID);
      continue;
    }
    if (existingProviderID !== providerID) {
      canonicalProviderIDsByOrigin.delete(providerOrigin);
      conflictedOrigins.add(providerOrigin);
    }
  }
  return canonicalProviderIDsByOrigin;
}

function canonicalProviderIDForOrigin(
  providerOrigin: string,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
): string {
  try {
    return compact(canonicalProviderIDsByOrigin.get(normalizeControlPlaneOrigin(providerOrigin)) ?? '');
  } catch {
    return '';
  }
}

function normalizeProviderIdentityForOrigin(
  providerOrigin: string,
  providerID: unknown,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
): Readonly<{
  providerID: string;
  didCanonicalize: boolean;
}> {
  const cleanProviderID = compact(providerID);
  if (cleanProviderID === '') {
    return {
      providerID: '',
      didCanonicalize: false,
    };
  }

  const canonicalProviderID = canonicalProviderIDForOrigin(providerOrigin, canonicalProviderIDsByOrigin);
  if (
    canonicalProviderID === ''
    || cleanProviderID === canonicalProviderID
    || cleanProviderID !== legacyProviderIDForOrigin(providerOrigin)
  ) {
    return {
      providerID: cleanProviderID,
      didCanonicalize: false,
    };
  }

  return {
    providerID: canonicalProviderID,
    didCanonicalize: true,
  };
}

function normalizeManagedEnvironmentCollection(
  environments: readonly DesktopManagedEnvironment[],
): readonly DesktopManagedEnvironment[] {
  const seenIDs = new Set<string>();
  const normalized: DesktopManagedEnvironment[] = [];
  for (const environment of environments) {
    if (!environment.local_hosting || environment.provider_binding) {
      continue;
    }
    if (seenIDs.has(environment.id)) {
      continue;
    }
    seenIDs.add(environment.id);
    normalized.push(environment);
  }
  return ensureDefaultManagedEnvironment(normalized);
}

function providerEnvironmentRecordKey(
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): string {
  return `${desktopControlPlaneKey(providerOrigin, providerID)}|${normalizeDesktopProviderEnvironmentID(envPublicID)}`;
}

function createProviderEnvironmentPreference(
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
  options: Readonly<{
    pinned?: boolean;
    lastUsedAtMS?: number;
  }> = {},
): DesktopProviderEnvironmentPreference {
  return {
    provider_origin: normalizeControlPlaneOrigin(providerOrigin),
    provider_id: compact(providerID),
    env_public_id: normalizeDesktopProviderEnvironmentID(envPublicID),
    pinned: options.pinned === true,
    last_used_at_ms: normalizeLastUsedAtMS(options.lastUsedAtMS, 0),
  };
}

function normalizeProviderEnvironmentPreferenceCollection(
  preferences: readonly DesktopProviderEnvironmentPreference[],
): readonly DesktopProviderEnvironmentPreference[] {
  const seenKeys = new Set<string>();
  const normalized: DesktopProviderEnvironmentPreference[] = [];
  for (const preference of preferences) {
    const key = providerEnvironmentRecordKey(
      preference.provider_origin,
      preference.provider_id,
      preference.env_public_id,
    );
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    normalized.push(preference);
  }
  return sortProviderEnvironmentPreferences(normalized);
}

function canonicalizeProviderEnvironmentIdentity(
  environment: DesktopProviderEnvironmentRecord,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
): DesktopProviderEnvironmentRecord {
  const normalizedProviderIdentity = normalizeProviderIdentityForOrigin(
    environment.provider_origin,
    environment.provider_id,
    canonicalProviderIDsByOrigin,
  );
  if (!normalizedProviderIdentity.didCanonicalize) {
    return environment;
  }
  return mergeProviderEnvironmentRecord(environment, {
    provider_origin: environment.provider_origin,
    provider_id: normalizedProviderIdentity.providerID,
    env_public_id: environment.env_public_id,
    label: environment.label,
    pinned: environment.pinned,
    preferred_open_route: environment.preferred_open_route,
    remote_web_supported: environment.remote_web_supported,
    remote_desktop_supported: environment.remote_desktop_supported,
    remote_catalog_entry: environment.remote_catalog_entry,
    local_runtime: environment.local_runtime,
    created_at_ms: environment.created_at_ms,
    updated_at_ms: environment.updated_at_ms,
    last_used_at_ms: environment.last_used_at_ms,
  });
}

export function findManagedEnvironmentLocalBindConflict(
  preferences: DesktopPreferences,
  environmentID: string,
): DesktopManagedEnvironmentLocalBindConflict | null {
  const targetManagedEnvironment = findManagedEnvironmentByID(preferences, environmentID);
  const targetProviderEnvironment = findProviderEnvironmentByID(preferences, environmentID);
  const target = targetManagedEnvironment ?? targetProviderEnvironment;
  const targetBind = targetManagedEnvironment?.local_hosting?.access.local_ui_bind
    ?? targetProviderEnvironment?.local_runtime?.access.local_ui_bind
    ?? '';
  if (!target || targetBind === '') {
    return null;
  }

  for (const candidate of [
    ...preferences.managed_environments.map((environment) => ({
      id: environment.id,
      label: environment.label,
      local_ui_bind: environment.local_hosting?.access.local_ui_bind ?? '',
    })),
    ...preferences.provider_environments.map((environment) => ({
      id: environment.id,
      label: environment.label,
      local_ui_bind: environment.local_runtime?.access.local_ui_bind ?? '',
    })),
  ]) {
    if (candidate.id === target.id || candidate.local_ui_bind === '') {
      continue;
    }
    if (!localUIBindsConflict(targetBind, candidate.local_ui_bind)) {
      continue;
    }
    return {
      environment_id: target.id,
      label: target.label,
      local_ui_bind: targetBind,
      conflicting_environment_id: candidate.id,
      conflicting_label: candidate.label,
      conflicting_local_ui_bind: candidate.local_ui_bind,
    };
  }
  return null;
}

export function describeManagedEnvironmentLocalBindConflict(
  conflict: DesktopManagedEnvironmentLocalBindConflict,
): string {
  const targetLabel = compact(conflict.label) || compact(conflict.environment_id) || 'This environment';
  const conflictingLabel = compact(conflict.conflicting_label) || compact(conflict.conflicting_environment_id) || 'another environment';
  return `${targetLabel} cannot use ${conflict.local_ui_bind} because "${conflictingLabel}" is already configured for ${conflict.conflicting_local_ui_bind}. Choose a different Local UI bind or update that environment first.`;
}

function localHostingForManagedEnvironment(
  input: UpsertDesktopManagedEnvironmentInput,
  access: DesktopManagedEnvironmentAccess,
  existing: DesktopManagedEnvironment | null,
  stateRootOverride?: string,
): ReturnType<typeof createManagedEnvironmentLocalHosting> {
  const existingLocalName = existing?.local_hosting?.scope.kind === 'local'
    ? existing.local_hosting.scope.name
    : '';
  const name = normalizeDesktopLocalEnvironmentName(input.name || existingLocalName);
  const existingStateDir = (
    existing?.local_hosting?.scope.kind === 'local'
    && existing.local_hosting.scope.name === name
  )
    ? existing.local_hosting.state_dir
    : resolveManagedEnvironmentStateDir({ name }, stateRootOverride);
  return createManagedEnvironmentLocalHosting(
    { kind: 'local', name },
    {
      access,
      owner: existing?.local_hosting?.owner ?? 'desktop',
      stateDir: existingStateDir,
      currentRuntime: existing?.local_hosting?.current_runtime,
    },
  );
}

export function upsertManagedEnvironment(
  preferences: DesktopPreferences,
  input: UpsertDesktopManagedEnvironmentInput,
): DesktopPreferences {
  const existing = compact(input.environment_id) === ''
    ? null
    : preferences.managed_environments.find((environment) => environment.id === compact(input.environment_id)) ?? null;
  const access = input.access ?? (
    existing
      ? managedEnvironmentLocalAccess(existing)
      : defaultDesktopManagedEnvironmentAccess()
  );
  const name = normalizeDesktopLocalEnvironmentName(
    compact(input.name)
    || (existing?.local_hosting?.scope.kind === 'local'
      ? existing.local_hosting.scope.name
      : ''),
  );
  const environmentID = existing?.id || desktopManagedLocalEnvironmentID(name);
  const nextEnvironment = createManagedEnvironment({
    environmentID,
    label: compact(input.label)
      || existing?.label
      || defaultLocalManagedEnvironmentLabel(name),
    pinned: input.pinned ?? existing?.pinned ?? false,
    preferredOpenRoute: existing?.preferred_open_route ?? 'auto',
    localHosting: localHostingForManagedEnvironment(
      input,
      access,
      existing,
    ),
    createdAtMS: input.created_at_ms ?? existing?.created_at_ms ?? Date.now(),
    updatedAtMS: input.updated_at_ms ?? Date.now(),
    lastUsedAtMS: input.last_used_at_ms ?? existing?.last_used_at_ms ?? 0,
  });
  const replacedIDs = new Set<string>([
    environmentID,
    existing?.id ?? '',
  ].filter((value) => value !== ''));
  return {
    ...preferences,
    managed_environments: normalizeManagedEnvironmentCollection([
      nextEnvironment,
      ...preferences.managed_environments.filter((environment) => (
        !replacedIDs.has(environment.id)
      )),
    ]),
  };
}

export function upsertProviderEnvironmentLocalRuntime(
  preferences: DesktopPreferences,
  input: UpsertDesktopProviderEnvironmentLocalRuntimeInput,
): DesktopPreferences {
  const providerOrigin = normalizeControlPlaneOrigin(input.provider_origin);
  const providerID = compact(input.provider_id);
  const envPublicID = normalizeDesktopProviderEnvironmentID(input.env_public_id);
  const existing = (
    (input.environment_id ? findProviderEnvironmentByID(preferences, input.environment_id) : null)
    ?? findProviderEnvironmentByIdentity(preferences, providerOrigin, providerID, envPublicID)
  );
  const localRuntime = createDesktopProviderEnvironmentLocalRuntime(providerOrigin, envPublicID, {
    access: input.access ?? providerEnvironmentLocalAccess(existing ?? createDesktopProviderEnvironmentRecord(providerOrigin, envPublicID, { providerID })),
    owner: existing?.local_runtime?.owner ?? 'desktop',
    stateDir: existing?.local_runtime?.scope.state_dir
      || controlPlaneManagedStateLayout(providerOrigin, envPublicID, process.env, os.homedir).stateDir,
    currentRuntime: existing?.local_runtime?.current_runtime,
  });
  const nextEnvironment = mergeProviderEnvironmentRecord(existing, {
    provider_origin: providerOrigin,
    provider_id: providerID,
    env_public_id: envPublicID,
    label: compact(input.label) || existing?.label || envPublicID,
    pinned: input.pinned ?? existing?.pinned ?? false,
    preferred_open_route: existing?.preferred_open_route ?? 'auto',
    remote_web_supported: existing?.remote_web_supported ?? true,
    remote_desktop_supported: existing?.remote_desktop_supported ?? true,
    remote_catalog_entry: existing?.remote_catalog_entry,
    local_runtime: localRuntime,
    created_at_ms: input.created_at_ms ?? existing?.created_at_ms ?? Date.now(),
    updated_at_ms: input.updated_at_ms ?? Date.now(),
    last_used_at_ms: input.last_used_at_ms ?? existing?.last_used_at_ms ?? 0,
  });
  return {
    ...preferences,
    provider_environments: normalizeProviderEnvironmentCollection([
      nextEnvironment,
      ...preferences.provider_environments.filter((environment) => environment.id !== nextEnvironment.id),
    ]),
  };
}

export function updateManagedEnvironmentAccess(
  preferences: DesktopPreferences,
  environmentID: string,
  access: DesktopManagedEnvironmentAccess,
): DesktopPreferences {
  const cleanEnvironmentID = compact(environmentID);
  return {
    ...preferences,
    managed_environments: normalizeManagedEnvironmentCollection(
      preferences.managed_environments.map((environment) => (
        environment.id === cleanEnvironmentID && environment.local_hosting
          ? {
              ...environment,
              local_hosting: {
                ...environment.local_hosting,
                access,
              },
              updated_at_ms: Date.now(),
            }
          : environment
      )),
    ),
  };
}

export function updateProviderEnvironmentAccess(
  preferences: DesktopPreferences,
  environmentID: string,
  access: DesktopManagedEnvironmentAccess,
): DesktopPreferences {
  const cleanEnvironmentID = compact(environmentID);
  return {
    ...preferences,
    provider_environments: normalizeProviderEnvironmentCollection(
      preferences.provider_environments.map((environment) => (
        environment.id === cleanEnvironmentID && environment.local_runtime
          ? mergeProviderEnvironmentRecord(environment, {
              provider_origin: environment.provider_origin,
              provider_id: environment.provider_id,
              env_public_id: environment.env_public_id,
              label: environment.label,
              pinned: environment.pinned,
              preferred_open_route: environment.preferred_open_route,
              remote_web_supported: environment.remote_web_supported,
              remote_desktop_supported: environment.remote_desktop_supported,
              remote_catalog_entry: environment.remote_catalog_entry,
              local_runtime: {
                ...environment.local_runtime,
                access,
              },
              created_at_ms: environment.created_at_ms,
              updated_at_ms: Date.now(),
              last_used_at_ms: environment.last_used_at_ms,
            })
          : environment
      )),
    ),
  };
}

export function rememberManagedEnvironmentUse(
  preferences: DesktopPreferences,
  environmentID: string,
  route?: DesktopManagedEnvironmentPreferredOpenRoute,
): DesktopPreferences {
  const cleanEnvironmentID = compact(environmentID);
  return {
    ...preferences,
    managed_environments: ensureDefaultManagedEnvironment(
      preferences.managed_environments.map((environment) => (
        environment.id === cleanEnvironmentID
          ? {
              ...environment,
              last_used_at_ms: Date.now(),
              preferred_open_route: route === 'local_host' || route === 'remote_desktop'
                ? route
                : environment.preferred_open_route,
              updated_at_ms: Date.now(),
            }
          : environment
      )),
    ),
  };
}

export function setManagedEnvironmentPinned(
  preferences: DesktopPreferences,
  environmentID: string,
  pinned: boolean,
): DesktopPreferences {
  const cleanEnvironmentID = compact(environmentID);
  return {
    ...preferences,
    managed_environments: ensureDefaultManagedEnvironment(
      preferences.managed_environments.map((environment) => (
        environment.id === cleanEnvironmentID
          ? {
              ...environment,
              pinned,
              updated_at_ms: Date.now(),
            }
          : environment
      )),
    ),
  };
}

function findProviderEnvironmentByIdentity(
  preferences: DesktopPreferences,
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): DesktopProviderEnvironmentRecord | null {
  return preferences.provider_environments.find((environment) => (
    environment.provider_origin === providerOrigin
    && providerIDMatchesCanonicalIdentity(providerOrigin, environment.provider_id, providerID)
    && environment.env_public_id === envPublicID
  )) ?? null;
}

function updateProviderEnvironmentRecordByID(
  preferences: DesktopPreferences,
  input: Readonly<{
    environment_id: string;
    pinned?: boolean;
    last_used_at_ms?: number;
  }>,
): DesktopPreferences {
  const existing = findProviderEnvironmentByID(preferences, input.environment_id);
  if (!existing) {
    return preferences;
  }
  const nextEnvironment = mergeProviderEnvironmentRecord(existing, {
    provider_origin: existing.provider_origin,
    provider_id: existing.provider_id,
    env_public_id: existing.env_public_id,
    label: existing.label,
    pinned: input.pinned ?? existing.pinned,
    preferred_open_route: existing.preferred_open_route,
    remote_web_supported: existing.remote_web_supported,
    remote_desktop_supported: existing.remote_desktop_supported,
    remote_catalog_entry: existing.remote_catalog_entry,
    local_runtime: existing.local_runtime,
    created_at_ms: existing.created_at_ms,
    updated_at_ms: Date.now(),
    last_used_at_ms: input.last_used_at_ms ?? existing.last_used_at_ms,
  });
  return {
    ...preferences,
    provider_environments: normalizeProviderEnvironmentCollection([
      nextEnvironment,
      ...preferences.provider_environments.filter((environment) => environment.id !== nextEnvironment.id),
    ]),
  };
}

export function rememberProviderEnvironmentUse(
  preferences: DesktopPreferences,
  environmentID: string,
): DesktopPreferences {
  return updateProviderEnvironmentRecordByID(preferences, {
    environment_id: environmentID,
    last_used_at_ms: Date.now(),
  });
}

export function setProviderEnvironmentPinned(
  preferences: DesktopPreferences,
  environmentID: string,
  pinned: boolean,
): DesktopPreferences {
  return updateProviderEnvironmentRecordByID(preferences, {
    environment_id: environmentID,
    pinned,
  });
}

export function upsertSavedEnvironment(
  preferences: DesktopPreferences,
  input: UpsertDesktopSavedEnvironmentInput,
): DesktopPreferences {
  const normalizedURL = normalizeLocalUIBaseURL(input.local_ui_url);
  const environmentID = compact(input.environment_id) || desktopEnvironmentID(normalizedURL);
  const existing = preferences.saved_environments.find((environment) => (
    environment.id === environmentID || environment.local_ui_url === normalizedURL
  ));
  const label = compact(input.label) || existing?.label || defaultSavedEnvironmentLabel(normalizedURL);
  const requestedSource = input.source;
  const source: DesktopSavedEnvironmentSource = existing?.source === 'saved' || requestedSource === 'saved'
    ? 'saved'
    : normalizeSavedEnvironmentSource(requestedSource, existing?.source ?? 'saved');
  const nextEnvironment: DesktopSavedEnvironment = {
    id: environmentID,
    label,
    local_ui_url: normalizedURL,
    source,
    pinned: input.pinned ?? existing?.pinned ?? false,
    last_used_at_ms: normalizeLastUsedAtMS(input.last_used_at_ms, Date.now()),
  };

  const savedEnvironments = sortSavedEnvironmentsByLastUsed([
    nextEnvironment,
    ...preferences.saved_environments.filter((environment) => (
      environment.id !== environmentID && environment.local_ui_url !== normalizedURL
    )),
  ]).slice(0, MAX_SAVED_ENVIRONMENTS);

  return {
    ...preferences,
    saved_environments: savedEnvironments,
    recent_external_local_ui_urls: deriveRecentExternalLocalUIURLs(savedEnvironments),
  };
}

export function upsertSavedSSHEnvironment(
  preferences: DesktopPreferences,
  input: UpsertDesktopSavedSSHEnvironmentInput,
): DesktopPreferences {
  const details = normalizeDesktopSSHEnvironmentDetails(input);
  const environmentID = desktopSSHEnvironmentID(details);
  const existing = preferences.saved_ssh_environments.find((environment) => (
    environment.id === environmentID
    || (
      environment.ssh_destination === details.ssh_destination
      && environment.ssh_port === details.ssh_port
      && environment.auth_mode === details.auth_mode
      && environment.remote_install_dir === details.remote_install_dir
      && environment.environment_instance_id === details.environment_instance_id
    )
  ));
  const label = compact(input.label) || existing?.label || defaultSavedSSHEnvironmentLabel(details);
  const requestedSource = input.source;
  const source: DesktopSavedEnvironmentSource = existing?.source === 'saved' || requestedSource === 'saved'
    ? 'saved'
    : normalizeSavedEnvironmentSource(requestedSource, existing?.source ?? 'saved');
  const nextEnvironment: DesktopSavedSSHEnvironment = {
    id: environmentID,
    label,
    ssh_destination: details.ssh_destination,
    ssh_port: details.ssh_port,
    auth_mode: details.auth_mode,
    remote_install_dir: details.remote_install_dir,
    bootstrap_strategy: details.bootstrap_strategy,
    release_base_url: details.release_base_url,
    environment_instance_id: details.environment_instance_id,
    source,
    pinned: input.pinned ?? existing?.pinned ?? false,
    last_used_at_ms: normalizeLastUsedAtMS(input.last_used_at_ms, Date.now()),
  };

  const savedSSHEnvironments = sortSavedSSHEnvironmentsByLastUsed([
    nextEnvironment,
    ...preferences.saved_ssh_environments.filter((environment) => (
      environment.id !== environmentID
      && (
        environment.ssh_destination !== details.ssh_destination
        || environment.ssh_port !== details.ssh_port
        || environment.auth_mode !== details.auth_mode
        || environment.remote_install_dir !== details.remote_install_dir
        || environment.environment_instance_id !== details.environment_instance_id
      )
    )),
  ]).slice(0, MAX_SAVED_SSH_ENVIRONMENTS);

  return {
    ...preferences,
    saved_ssh_environments: savedSSHEnvironments,
  };
}

export function upsertSavedControlPlane(
  preferences: DesktopPreferences,
  input: UpsertDesktopSavedControlPlaneInput,
): DesktopPreferences {
  const key = desktopControlPlaneKey(input.provider.provider_origin, input.provider.provider_id);
  const existing = preferences.control_planes.find((controlPlane) => (
    desktopControlPlaneKey(controlPlane.provider.provider_origin, controlPlane.provider.provider_id) === key
  )) ?? null;
  const nextControlPlane: DesktopSavedControlPlane = {
    provider: input.provider,
    account: input.account,
    environments: input.environments ?? [],
    display_label: normalizeControlPlaneDisplayLabel(
      input.display_label ?? existing?.display_label,
      input.provider.provider_origin,
    ),
    last_synced_at_ms: normalizeLastUsedAtMS(input.last_synced_at_ms, Date.now()),
  };
  const nextRefreshTokens = {
    ...preferences.control_plane_refresh_tokens,
  };
  const refreshToken = compact(input.refresh_token);
  if (refreshToken !== '') {
    nextRefreshTokens[key] = refreshToken;
  }
  const controlPlanes = sortSavedControlPlanes([
    nextControlPlane,
    ...preferences.control_planes.filter((controlPlane) => (
      desktopControlPlaneKey(controlPlane.provider.provider_origin, controlPlane.provider.provider_id) !== key
    )),
  ]);

  const nextPreferences: DesktopPreferences = {
    ...preferences,
    control_plane_refresh_tokens: nextRefreshTokens,
    control_planes: controlPlanes,
  };
  return {
    ...nextPreferences,
    managed_environments: normalizeManagedEnvironmentCollection(nextPreferences.managed_environments),
    provider_environments: reconcileProviderEnvironments({
      stored: nextPreferences.provider_environments,
      legacyPreferences: [],
      legacyManagedEnvironments: nextPreferences.managed_environments.filter((environment) => (
        Boolean(environment.provider_binding) && Boolean(environment.local_hosting)
      )),
      controlPlanes,
    }),
  };
}

export function setSavedEnvironmentPinned(
  preferences: DesktopPreferences,
  input: Readonly<{
    environment_id: string;
    label: string;
    local_ui_url: string;
    pinned: boolean;
    last_used_at_ms?: number;
  }>,
): DesktopPreferences {
  return upsertSavedEnvironment(preferences, {
    environment_id: input.environment_id,
    label: input.label,
    local_ui_url: input.local_ui_url,
    source: 'saved',
    pinned: input.pinned,
    last_used_at_ms: input.last_used_at_ms,
  });
}

export function setSavedSSHEnvironmentPinned(
  preferences: DesktopPreferences,
  input: Readonly<{
    environment_id: string;
    label: string;
    pinned: boolean;
    last_used_at_ms?: number;
  }> & DesktopSSHEnvironmentDetails,
): DesktopPreferences {
  return upsertSavedSSHEnvironment(preferences, {
    environment_id: input.environment_id,
    label: input.label,
    ssh_destination: input.ssh_destination,
    ssh_port: input.ssh_port,
    auth_mode: input.auth_mode,
    remote_install_dir: input.remote_install_dir,
    bootstrap_strategy: input.bootstrap_strategy,
    release_base_url: input.release_base_url,
    environment_instance_id: input.environment_instance_id,
    source: 'saved',
    pinned: input.pinned,
    last_used_at_ms: input.last_used_at_ms,
  });
}

export function deleteManagedEnvironment(
  preferences: DesktopPreferences,
  environmentID: string,
): DeleteManagedEnvironmentResult {
  const cleanEnvironmentID = compact(environmentID);
  const existing = findManagedEnvironmentByID(preferences, cleanEnvironmentID);
  if (!existing || !existing.local_hosting) {
    return {
      preferences,
      deleted_environment: null,
      deleted_state_dir: '',
    };
  }

  const deletedStateDir = compact(existing.local_hosting.state_dir);
  const nextManagedEnvironments = normalizeManagedEnvironmentCollection(
    preferences.managed_environments.filter((environment) => environment.id !== cleanEnvironmentID),
  );

  return {
    preferences: {
      ...preferences,
      managed_environments: nextManagedEnvironments,
    },
    deleted_environment: existing,
    deleted_state_dir: deletedStateDir,
  };
}

export function deleteProviderEnvironmentLocalRuntime(
  preferences: DesktopPreferences,
  environmentID: string,
): DeleteProviderEnvironmentResult {
  const cleanEnvironmentID = compact(environmentID);
  const existing = findProviderEnvironmentByID(preferences, cleanEnvironmentID);
  if (!existing?.local_runtime) {
    return {
      preferences,
      deleted_environment: null,
      deleted_state_dir: '',
    };
  }
  const deletedStateDir = compact(existing.local_runtime.scope.state_dir);
  const nextProviderEnvironments = preferences.provider_environments.flatMap((environment) => {
    if (environment.id !== cleanEnvironmentID) {
      return [environment];
    }
    const nextEnvironment = mergeProviderEnvironmentRecord(environment, {
      provider_origin: environment.provider_origin,
      provider_id: environment.provider_id,
      env_public_id: environment.env_public_id,
      label: environment.label,
      pinned: environment.pinned,
      preferred_open_route: environment.preferred_open_route,
      remote_web_supported: environment.remote_web_supported,
      remote_desktop_supported: environment.remote_desktop_supported,
      remote_catalog_entry: environment.remote_catalog_entry,
      local_runtime: null,
      created_at_ms: environment.created_at_ms,
      updated_at_ms: Date.now(),
      last_used_at_ms: environment.last_used_at_ms,
    });
    return nextEnvironment.remote_catalog_entry || nextEnvironment.pinned || nextEnvironment.last_used_at_ms > 0
      ? [nextEnvironment]
      : [];
  });
  return {
    preferences: {
      ...preferences,
      provider_environments: reconcileProviderEnvironments({
        stored: nextProviderEnvironments,
        legacyPreferences: [],
        legacyManagedEnvironments: [],
        controlPlanes: preferences.control_planes,
      }),
    },
    deleted_environment: existing,
    deleted_state_dir: deletedStateDir,
  };
}

export function deleteSavedEnvironment(
  preferences: DesktopPreferences,
  environmentID: string,
): DesktopPreferences {
  const cleanEnvironmentID = compact(environmentID);
  const savedEnvironments = preferences.saved_environments.filter((environment) => environment.id !== cleanEnvironmentID);
  return {
    ...preferences,
    saved_environments: savedEnvironments,
    recent_external_local_ui_urls: deriveRecentExternalLocalUIURLs(savedEnvironments),
  };
}

export function deleteSavedSSHEnvironment(
  preferences: DesktopPreferences,
  environmentID: string,
): DesktopPreferences {
  const cleanEnvironmentID = compact(environmentID);
  return {
    ...preferences,
    saved_ssh_environments: preferences.saved_ssh_environments.filter((environment) => environment.id !== cleanEnvironmentID),
  };
}

export function deleteSavedControlPlane(
  preferences: DesktopPreferences,
  providerOrigin: string,
  providerID: string,
): DesktopPreferences {
  const key = desktopControlPlaneKey(providerOrigin, providerID);
  const nextRefreshTokens = {
    ...preferences.control_plane_refresh_tokens,
  };
  delete nextRefreshTokens[key];
  const normalizedProviderOrigin = normalizeControlPlaneOrigin(providerOrigin);
  return {
    ...preferences,
    control_plane_refresh_tokens: nextRefreshTokens,
    control_planes: preferences.control_planes.filter((controlPlane) => (
      desktopControlPlaneKey(controlPlane.provider.provider_origin, controlPlane.provider.provider_id) !== key
    )),
    managed_environments: normalizeManagedEnvironmentCollection(preferences.managed_environments),
    provider_environments: normalizeProviderEnvironmentCollection(
      preferences.provider_environments.filter((environment) => (
        !(
          environment.provider_origin === normalizedProviderOrigin
          && providerIDMatchesCanonicalIdentity(normalizedProviderOrigin, environment.provider_id, providerID)
          && !environment.local_runtime
        )
      )),
    ),
  };
}

export function rememberRecentExternalLocalUITarget(
  preferences: DesktopPreferences,
  rawURL: string,
): DesktopPreferences {
  return upsertSavedEnvironment(preferences, {
    environment_id: desktopEnvironmentID(rawURL),
    label: '',
    local_ui_url: rawURL,
    source: 'recent_auto',
    last_used_at_ms: Date.now(),
  });
}

export function rememberRecentSSHEnvironmentTarget(
  preferences: DesktopPreferences,
  input: DesktopSSHEnvironmentDetails & Readonly<{ label?: string; environment_id?: string }>,
): DesktopPreferences {
  return upsertSavedSSHEnvironment(preferences, {
    environment_id: compact(input.environment_id),
    label: compact(input.label),
    ssh_destination: input.ssh_destination,
    ssh_port: input.ssh_port,
    auth_mode: input.auth_mode,
    remote_install_dir: input.remote_install_dir,
    bootstrap_strategy: input.bootstrap_strategy,
    release_base_url: input.release_base_url,
    environment_instance_id: input.environment_instance_id,
    source: 'recent_auto',
    last_used_at_ms: Date.now(),
  });
}

export function managedDesktopLaunchKey(preferences: DesktopPreferences): string {
  const environment = preferences.managed_environments[0] ?? createManagedLocalEnvironment('default');
  return JSON.stringify(managedEnvironmentLocalAccess(environment));
}

type ValidateDesktopSettingsDraftOptions = Readonly<{
  currentLocalUIPassword?: string;
  currentLocalUIPasswordConfigured?: boolean;
}>;

function resolveLocalUIPasswordFromDraft(
  draft: DesktopSettingsDraft,
  options?: ValidateDesktopSettingsDraftOptions,
): Readonly<{
  local_ui_password: string;
  local_ui_password_configured: boolean;
  local_ui_password_mode: DesktopLocalUIPasswordMode;
}> {
  const currentLocalUIPassword = String(options?.currentLocalUIPassword ?? '');
  const currentLocalUIPasswordConfigured = options?.currentLocalUIPasswordConfigured === true;
  const typedLocalUIPassword = String(draft.local_ui_password ?? '');
  const localUIPasswordMode = normalizeDesktopLocalUIPasswordMode(
    draft.local_ui_password_mode,
    currentLocalUIPasswordConfigured ? 'keep' : 'replace',
  );

  switch (localUIPasswordMode) {
    case 'keep':
      return {
        local_ui_password: currentLocalUIPassword,
        local_ui_password_configured: currentLocalUIPasswordConfigured,
        local_ui_password_mode: localUIPasswordMode,
      };
    case 'clear':
      return {
        local_ui_password: '',
        local_ui_password_configured: false,
        local_ui_password_mode: localUIPasswordMode,
      };
    default:
      return {
        local_ui_password: typedLocalUIPassword,
        local_ui_password_configured: compact(typedLocalUIPassword) !== '',
        local_ui_password_mode: localUIPasswordMode,
      };
  }
}

export function validateDesktopSettingsDraft(
  draft: DesktopSettingsDraft,
  options?: ValidateDesktopSettingsDraftOptions,
): DesktopManagedEnvironmentAccess {
  const localUIBind = compact(draft.local_ui_bind);
  if (!localUIBind) {
    throw new Error('Local UI bind address is required.');
  }

  const bind = parseLocalUIBind(localUIBind);
  const passwordState = resolveLocalUIPasswordFromDraft(draft, options);
  if (!isLoopbackOnlyBind(bind) && !passwordState.local_ui_password_configured) {
    throw new Error('Non-loopback Local UI binds require a Local UI password.');
  }

  return {
    local_ui_bind: localUIBind,
    local_ui_password: passwordState.local_ui_password,
    local_ui_password_configured: passwordState.local_ui_password_configured,
  };
}

async function readJSONFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function decodeOptionalSecret(codec: DesktopSecretCodec, secret: StoredSecret | null | undefined): string {
  if (!secret) {
    return '';
  }
  try {
    return String(codec.decodeSecret(secret) ?? '');
  } catch {
    return '';
  }
}

function recoverLocalUIBind(raw: unknown): string {
  const value = compact(raw);
  if (value === '') {
    return DEFAULT_DESKTOP_LOCAL_UI_BIND;
  }
  try {
    parseLocalUIBind(value);
    return value;
  } catch {
    return DEFAULT_DESKTOP_LOCAL_UI_BIND;
  }
}

function isLegacyDesktopPreferencesVersion(version: unknown): boolean {
  const numeric = Number(version);
  return !Number.isInteger(numeric) || numeric < 3;
}

function shouldMigrateLegacyAutoLoopbackBind(bind: string, version: unknown): boolean {
  return bind === DEFAULT_DESKTOP_AUTO_LOOPBACK_BIND && isLegacyDesktopPreferencesVersion(version);
}

function recoverDesktopPreferencesDraft(
  draft: Partial<DesktopSettingsDraft>,
  options: Readonly<{ preferencesVersion?: unknown }> = {},
): DesktopSettingsDraft {
  let localUIBind = recoverLocalUIBind(draft.local_ui_bind);
  if (shouldMigrateLegacyAutoLoopbackBind(localUIBind, options.preferencesVersion)) {
    localUIBind = DEFAULT_DESKTOP_LOCAL_UI_BIND;
  }
  const localUIPassword = String(draft.local_ui_password ?? '');
  const localUIPasswordMode = normalizeDesktopLocalUIPasswordMode(
    draft.local_ui_password_mode,
    compact(localUIPassword) !== '' ? 'replace' : 'replace',
  );
  try {
    const bind = parseLocalUIBind(localUIBind);
    const passwordWillBeConfigured = localUIPasswordMode === 'keep'
      || (localUIPasswordMode === 'replace' && compact(localUIPassword) !== '');
    if (!isLoopbackOnlyBind(bind) && !passwordWillBeConfigured) {
      localUIBind = DEFAULT_DESKTOP_LOCAL_UI_BIND;
    }
  } catch {
    localUIBind = DEFAULT_DESKTOP_LOCAL_UI_BIND;
  }

  return {
    local_ui_bind: localUIBind,
    local_ui_password: localUIPassword,
    local_ui_password_mode: localUIPasswordMode,
  };
}

function catalogRecordPath(dir: string, id: string): string {
  return path.join(dir, `${encodeURIComponent(id)}.json`);
}

async function readJSONDirectory(dirPath: string): Promise<readonly unknown[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readJSONFile(path.join(dirPath, entry.name))));
    return records.filter((value) => value != null);
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeCatalogRecords(
  dirPath: string,
  records: Readonly<Record<string, unknown>>,
): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
  const expectedNames = new Set<string>();
  await Promise.all(Object.entries(records).map(async ([id, value]) => {
    const filePath = catalogRecordPath(dirPath, id);
    expectedNames.add(path.basename(filePath));
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }));
  const existing = await fs.readdir(dirPath, { withFileTypes: true });
  await Promise.all(existing.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.json') || expectedNames.has(entry.name)) {
      return;
    }
    await fs.rm(path.join(dirPath, entry.name), { force: true });
  }));
}

function normalizeManagedEnvironmentCatalogCandidate(
  value: unknown,
  passwordsByID: ReadonlyMap<string, string>,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
  stateRootOverride?: string,
): ManagedEnvironmentCatalogNormalizationResult {
  if (!value || typeof value !== 'object') {
    return {
      environment: null,
      providerEnvironmentPreference: null,
      didCanonicalizeProviderIdentity: false,
    };
  }
  const candidate = value as DesktopManagedEnvironmentCatalogFile;
  const recordKind = compact(candidate.record_kind);
  if (recordKind !== '' && recordKind !== 'environment') {
    return {
      environment: null,
      providerEnvironmentPreference: null,
      didCanonicalizeProviderIdentity: false,
    };
  }

  let didCanonicalizeProviderIdentity = false;
  const providerBinding = (() => {
    if (!candidate.provider_binding || typeof candidate.provider_binding !== 'object') {
      return null;
    }
    const normalizedProviderIdentity = normalizeProviderIdentityForOrigin(
      compact(candidate.provider_binding.provider_origin),
      candidate.provider_binding.provider_id,
      canonicalProviderIDsByOrigin,
    );
    didCanonicalizeProviderIdentity ||= normalizedProviderIdentity.didCanonicalize;
    try {
      return createManagedEnvironmentProviderBinding(
        compact(candidate.provider_binding.provider_origin),
        compact(candidate.provider_binding.env_public_id),
        {
          providerID: normalizedProviderIdentity.providerID,
          remoteWebSupported: candidate.provider_binding.remote_web_supported !== false,
          remoteDesktopSupported: candidate.provider_binding.remote_desktop_supported !== false,
        },
      );
    } catch {
      return null;
    }
  })();

  const localHosting = (() => {
    if (!candidate.local_hosting || typeof candidate.local_hosting !== 'object') {
      return null;
    }
    const scope = candidate.local_hosting.scope;
    if (!scope || typeof scope !== 'object') {
      return null;
    }
    const password = String(passwordsByID.get(compact(candidate.id)) ?? '');
    const passwordConfigured = candidate.local_hosting.access?.local_ui_password_configured === true || compact(password) !== '';
    const access = normalizeManagedEnvironmentAccess(
      candidate.local_hosting.access?.local_ui_bind ?? DEFAULT_DESKTOP_LOCAL_UI_BIND,
      password,
      passwordConfigured,
    );
    const owner = candidate.local_hosting.owner === 'desktop' || candidate.local_hosting.owner === 'agent'
      ? candidate.local_hosting.owner
      : 'unknown';
    try {
      if (scope.kind === 'named') {
        const name = normalizeDesktopNamedEnvironmentName(scope.name);
        return createManagedEnvironmentLocalHosting(
          { kind: 'named', name },
          {
            access,
            owner,
            stateDir: compact(candidate.local_hosting.state_dir)
              || namedManagedStateLayout(name, process.env, os.homedir, stateRootOverride).stateDir,
          },
        );
      }
      if (scope.kind === 'controlplane') {
        const providerOrigin = compact(scope.provider_origin) || providerBinding?.provider_origin || '';
        const envPublicID = compact(scope.env_public_id) || providerBinding?.env_public_id || '';
        const layout = controlPlaneManagedStateLayout(
          providerOrigin,
          envPublicID,
          process.env,
          os.homedir,
          stateRootOverride,
        );
        const scopeParts = layout.scopeKey.split('/');
        return createManagedEnvironmentLocalHosting(
          {
            kind: 'controlplane',
            provider_origin: providerOrigin,
            provider_key: compact(scope.provider_key) || scopeParts[1] || '',
            env_public_id: envPublicID,
          },
          {
            access,
            owner,
            stateDir: compact(candidate.local_hosting.state_dir) || layout.stateDir,
          },
        );
      }
      const name = normalizeDesktopLocalEnvironmentName(scope.name);
      return createManagedEnvironmentLocalHosting(
        { kind: 'local', name },
        {
          access,
          owner,
          stateDir: compact(candidate.local_hosting.state_dir)
            || localManagedStateLayout(name, process.env, os.homedir, stateRootOverride).stateDir,
        },
      );
    } catch {
      return null;
    }
  })();

  if (!providerBinding && !localHosting) {
    return {
      environment: null,
      providerEnvironmentPreference: null,
      didCanonicalizeProviderIdentity,
    };
  }

  const providerEnvironmentPreference = providerBinding
    ? createProviderEnvironmentPreference(
      providerBinding.provider_origin,
      providerBinding.provider_id,
      providerBinding.env_public_id,
      {
        pinned: normalizePinned(candidate.pinned),
        lastUsedAtMS: normalizeLastUsedAtMS(candidate.last_used_at_ms, 0),
      },
    )
    : null;

  if (providerBinding && !localHosting) {
    return {
      environment: null,
      providerEnvironmentPreference,
      didCanonicalizeProviderIdentity,
    };
  }

  try {
    return {
      environment: createManagedEnvironment({
        environmentID: compact(candidate.id) || undefined,
        label: compact(candidate.label) || undefined,
        pinned: normalizePinned(candidate.pinned),
        preferredOpenRoute: normalizePreferredOpenRoute(candidate.preferred_open_route),
        identity: candidate.identity?.kind === 'provisional_local'
          ? {
              kind: 'provisional_local',
              local_name: normalizeDesktopLocalEnvironmentName(candidate.identity.local_name),
            }
          : undefined,
        localHosting: localHosting ?? undefined,
        providerBinding: providerBinding ?? undefined,
        createdAtMS: normalizeLastUsedAtMS(candidate.created_at_ms, Date.now()),
        updatedAtMS: normalizeLastUsedAtMS(candidate.updated_at_ms, Date.now()),
        lastUsedAtMS: normalizeLastUsedAtMS(candidate.last_used_at_ms, 0),
      }),
      providerEnvironmentPreference,
      didCanonicalizeProviderIdentity,
    };
  } catch {
    return {
      environment: null,
      providerEnvironmentPreference,
      didCanonicalizeProviderIdentity,
    };
  }
}

function normalizeManagedEnvironmentsFromCatalog(
  values: readonly unknown[],
  passwordsByID: ReadonlyMap<string, string>,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
  legacyAccess?: DesktopManagedEnvironmentAccess,
  stateRootOverride?: string,
): ManagedEnvironmentCatalogCollectionResult {
  const normalized: DesktopManagedEnvironment[] = [];
  const legacyProviderEnvironments: DesktopManagedEnvironment[] = [];
  const providerEnvironmentPreferences: DesktopProviderEnvironmentPreference[] = [];
  const seenIDs = new Set<string>();
  const seenProviderPreferenceKeys = new Set<string>();
  let didCanonicalizeProviderIdentity = false;
  for (const value of values) {
    const result = normalizeManagedEnvironmentCatalogCandidate(
      value,
      passwordsByID,
      canonicalProviderIDsByOrigin,
      stateRootOverride,
    );
    didCanonicalizeProviderIdentity ||= result.didCanonicalizeProviderIdentity;
    const providerEnvironmentPreference = result.providerEnvironmentPreference;
    if (providerEnvironmentPreference) {
      const preferenceKey = providerEnvironmentRecordKey(
        providerEnvironmentPreference.provider_origin,
        providerEnvironmentPreference.provider_id,
        providerEnvironmentPreference.env_public_id,
      );
      if (!seenProviderPreferenceKeys.has(preferenceKey)) {
        seenProviderPreferenceKeys.add(preferenceKey);
        providerEnvironmentPreferences.push(providerEnvironmentPreference);
      }
    }
    const environment = result.environment;
    if (!environment || seenIDs.has(environment.id)) {
      continue;
    }
    seenIDs.add(environment.id);
    normalized.push(environment);
    if (environment.provider_binding && environment.local_hosting) {
      legacyProviderEnvironments.push(environment);
    }
  }
  return {
    environments: normalizeManagedEnvironmentCollection(
      normalized.length > 0
        ? normalized
        : [createManagedLocalEnvironment('default', {
            access: legacyAccess,
            stateDir: resolveManagedEnvironmentStateDir({ name: 'default' }, stateRootOverride),
          })],
    ),
    legacyProviderEnvironments,
    providerEnvironmentPreferences: normalizeProviderEnvironmentPreferenceCollection(providerEnvironmentPreferences),
    didCanonicalizeProviderIdentity,
  };
}

function serializeManagedEnvironmentCatalog(environment: DesktopManagedEnvironment): DesktopManagedEnvironmentCatalogFile {
  const access = managedEnvironmentLocalAccess(environment);
  return {
    schema_version: 1,
    record_kind: 'environment',
    id: environment.id,
    label: environment.label,
    pinned: environment.pinned,
    created_at_ms: environment.created_at_ms,
    updated_at_ms: environment.updated_at_ms,
    last_used_at_ms: environment.last_used_at_ms,
    preferred_open_route: environment.preferred_open_route,
    identity: environment.identity.kind === 'provisional_local'
      ? {
          kind: 'provisional_local',
          local_name: environment.identity.local_name,
        }
      : {
          kind: 'provider',
          provider_origin: environment.identity.provider_origin,
          provider_id: environment.identity.provider_id,
          env_public_id: environment.identity.env_public_id,
        },
    ...(environment.local_hosting
      ? {
          local_hosting: {
            scope: environment.local_hosting.scope,
            scope_key: environment.local_hosting.scope_key,
            state_dir: environment.local_hosting.state_dir,
            owner: environment.local_hosting.owner,
            access: {
              local_ui_bind: access.local_ui_bind,
              local_ui_password_configured: access.local_ui_password_configured,
            },
          },
        }
      : {}),
    ...(environment.provider_binding
      ? {
          provider_binding: {
            provider_origin: environment.provider_binding.provider_origin,
            provider_id: environment.provider_binding.provider_id,
            env_public_id: environment.provider_binding.env_public_id,
            remote_web_supported: environment.provider_binding.remote_web_supported,
            remote_desktop_supported: environment.provider_binding.remote_desktop_supported,
          },
        }
      : {}),
  };
}

function serializeSavedEnvironmentCatalog(environment: DesktopSavedEnvironment): DesktopConnectionCatalogFile {
  return {
    schema_version: 1,
    record_kind: 'connection',
    kind: 'url',
    id: environment.id,
    label: environment.label,
    local_ui_url: environment.local_ui_url,
    source: environment.source,
    pinned: environment.pinned,
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function serializeSavedSSHEnvironmentCatalog(environment: DesktopSavedSSHEnvironment): DesktopConnectionCatalogFile {
  return {
    schema_version: 1,
    record_kind: 'connection',
    kind: 'ssh',
    id: environment.id,
    label: environment.label,
    ssh_destination: environment.ssh_destination,
    ssh_port: environment.ssh_port,
    auth_mode: environment.auth_mode,
    remote_install_dir: environment.remote_install_dir,
    bootstrap_strategy: environment.bootstrap_strategy,
    release_base_url: environment.release_base_url,
    environment_instance_id: environment.environment_instance_id,
    source: environment.source,
    pinned: environment.pinned,
    last_used_at_ms: environment.last_used_at_ms,
  };
}

function serializeSavedControlPlaneCatalog(controlPlane: DesktopSavedControlPlane): DesktopProviderCatalogFile {
  return {
    schema_version: 1,
    record_kind: 'provider',
    provider: {
      protocol_version: controlPlane.provider.protocol_version,
      provider_id: controlPlane.provider.provider_id,
      display_name: controlPlane.provider.display_name,
      provider_origin: controlPlane.provider.provider_origin,
      documentation_url: controlPlane.provider.documentation_url,
    },
    account: {
      user_public_id: controlPlane.account.user_public_id,
      user_display_name: controlPlane.account.user_display_name,
      authorization_expires_at_unix_ms: controlPlane.account.authorization_expires_at_unix_ms,
    },
    display_label: controlPlane.display_label,
    environments: controlPlane.environments.map((environment) => ({
      env_public_id: environment.env_public_id,
      name: environment.label,
      environment_url: environment.environment_url,
      description: environment.description,
      namespace_public_id: environment.namespace_public_id,
      namespace_name: environment.namespace_name,
      status: environment.status,
      lifecycle_status: environment.lifecycle_status,
      last_seen_at_unix_ms: environment.last_seen_at_unix_ms,
    })),
    last_synced_at_ms: controlPlane.last_synced_at_ms,
  };
}

function serializeProviderEnvironmentCatalog(
  environment: DesktopProviderEnvironmentRecord,
): DesktopProviderEnvironmentCatalogFile {
  const access = providerEnvironmentLocalAccess(environment);
  return {
    schema_version: 1,
    record_kind: 'provider_environment',
    id: environment.id,
    provider_origin: environment.provider_origin,
    provider_id: environment.provider_id,
    env_public_id: environment.env_public_id,
    label: environment.label,
    pinned: environment.pinned,
    created_at_ms: environment.created_at_ms,
    updated_at_ms: environment.updated_at_ms,
    last_used_at_ms: environment.last_used_at_ms,
    preferred_open_route: environment.preferred_open_route,
    remote_web_supported: environment.remote_web_supported,
    remote_desktop_supported: environment.remote_desktop_supported,
    ...(environment.remote_catalog_entry
      ? {
          remote_catalog_entry: environment.remote_catalog_entry,
        }
      : {}),
    ...(environment.local_runtime
      ? {
          local_runtime: {
            owner: environment.local_runtime.owner,
            state_scope: {
              provider_origin: environment.local_runtime.scope.provider_origin,
              provider_key: environment.local_runtime.scope.provider_key,
              env_public_id: environment.local_runtime.scope.env_public_id,
              scope_key: environment.local_runtime.scope.scope_key,
              state_dir: environment.local_runtime.scope.state_dir,
            },
            access: {
              local_ui_bind: access.local_ui_bind,
              local_ui_password_configured: access.local_ui_password_configured,
            },
          },
        }
      : {}),
  };
}

export async function loadDesktopPreferences(paths: DesktopPreferencesPaths, codec: DesktopSecretCodec): Promise<DesktopPreferences> {
  const preferencesFile = await readJSONFile<DesktopPreferencesFile>(paths.preferencesFile);
  const secretsFile = await readJSONFile<DesktopSecretsFile>(paths.secretsFile);
  const catalogPaths = defaultDesktopCatalogPaths(paths.stateRoot);
  const catalogManagedEnvironments = await readJSONDirectory(catalogPaths.environmentsDir);
  const catalogConnections = await readJSONDirectory(catalogPaths.connectionsDir);
  const catalogProviders = await readJSONDirectory(catalogPaths.providersDir);
  const catalogProviderEnvironments = await readJSONDirectory(catalogPaths.providerEnvironmentsDir);
  const catalogProviderEnvironmentPreferences = await readJSONDirectory(catalogPaths.providerEnvironmentPreferencesDir);
  const localUIPasswordConfigured = Boolean(secretsFile?.local_ui_password);
  const localUIPassword = decodeOptionalSecret(codec, secretsFile?.local_ui_password);
  const managedEnvironmentPasswordsByID = decodeManagedEnvironmentPasswords(codec, secretsFile?.managed_environments);
  const providerEnvironmentPasswordsByID = new Map<string, string>([
    ...managedEnvironmentPasswordsByID,
    ...decodeManagedEnvironmentPasswords(codec, secretsFile?.provider_environments),
  ]);
  const controlPlaneRefreshTokensByKey = decodeDesktopControlPlaneRefreshTokens(codec, secretsFile?.control_planes);
  const legacyAccess = validateDesktopSettingsDraft(recoverDesktopPreferencesDraft({
    local_ui_bind: preferencesFile?.local_ui_bind ?? DEFAULT_DESKTOP_LOCAL_UI_BIND,
    local_ui_password: '',
    local_ui_password_mode: localUIPasswordConfigured ? 'keep' : 'replace',
  }, {
    preferencesVersion: preferencesFile?.version,
  }), {
    currentLocalUIPassword: localUIPassword,
    currentLocalUIPasswordConfigured: localUIPasswordConfigured,
  });

  const hasCatalogData = (
    catalogManagedEnvironments.length > 0
    || catalogConnections.length > 0
    || catalogProviders.length > 0
    || catalogProviderEnvironments.length > 0
    || catalogProviderEnvironmentPreferences.length > 0
    || Number(preferencesFile?.version ?? 0) >= 11
  );

  const savedEnvironments = hasCatalogData
    ? normalizeSavedEnvironments(
      catalogConnections.filter((value) => (
        !!value && typeof value === 'object' && compact((value as DesktopConnectionCatalogFile).kind) === 'url'
      )),
    )
    : normalizeSavedEnvironments(
      preferencesFile?.saved_environments,
      preferencesFile?.recent_external_local_ui_urls,
    );
  const savedSSHEnvironmentResult = hasCatalogData
    ? collectSavedSSHEnvironmentNormalizationResult(
      catalogConnections.filter((value) => (
        !!value && typeof value === 'object' && compact((value as DesktopConnectionCatalogFile).kind) === 'ssh'
      )),
    )
    : collectSavedSSHEnvironmentNormalizationResult(preferencesFile?.saved_ssh_environments);
  const savedSSHEnvironments = savedSSHEnvironmentResult.environments;
  const controlPlanes = hasCatalogData
    ? normalizeSavedControlPlanes(catalogProviders, controlPlaneRefreshTokensByKey)
    : normalizeSavedControlPlanes(
      preferencesFile?.control_planes,
      controlPlaneRefreshTokensByKey,
    );
  const canonicalProviderIDsByOrigin = buildCanonicalProviderIDByOrigin(controlPlanes);
  const managedEnvironmentCatalogResult = hasCatalogData
    ? normalizeManagedEnvironmentsFromCatalog(
      catalogManagedEnvironments,
      managedEnvironmentPasswordsByID,
      canonicalProviderIDsByOrigin,
      legacyAccess,
      paths.stateRoot,
    )
    : (() => {
      const legacyManagedEnvironments = normalizeManagedEnvironments(preferencesFile?.managed_environments, {
        passwordsByID: managedEnvironmentPasswordsByID,
        legacyLocalUIBind: legacyAccess.local_ui_bind,
        legacyLocalUIPassword: legacyAccess.local_ui_password,
        legacyLocalUIPasswordConfigured: legacyAccess.local_ui_password_configured,
        stateRoot: paths.stateRoot,
      });
      return {
        environments: normalizeManagedEnvironmentCollection(legacyManagedEnvironments),
        legacyProviderEnvironments: legacyManagedEnvironments.filter((environment) => (
          Boolean(environment.provider_binding) && Boolean(environment.local_hosting)
        )),
        providerEnvironmentPreferences: [],
        didCanonicalizeProviderIdentity: false,
      } satisfies ManagedEnvironmentCatalogCollectionResult;
    })();
  const providerEnvironmentCatalogResult = hasCatalogData
    ? normalizeProviderEnvironmentsFromCatalog(
      catalogProviderEnvironments,
      providerEnvironmentPasswordsByID,
      canonicalProviderIDsByOrigin,
      paths.stateRoot,
    )
    : {
      environments: [],
      didCanonicalizeProviderIdentity: false,
    } satisfies ProviderEnvironmentNormalizationResult;
  const legacyProviderEnvironmentPreferences = hasCatalogData
    ? normalizeProviderEnvironmentPreferences(
      catalogProviderEnvironmentPreferences.length > 0
        ? catalogProviderEnvironmentPreferences
        : managedEnvironmentCatalogResult.providerEnvironmentPreferences,
      canonicalProviderIDsByOrigin,
    )
    : normalizeProviderEnvironmentPreferences(
      preferencesFile?.provider_environment_preferences,
      canonicalProviderIDsByOrigin,
    );
  const providerEnvironments = reconcileProviderEnvironments({
    stored: providerEnvironmentCatalogResult.environments,
    legacyPreferences: legacyProviderEnvironmentPreferences,
    legacyManagedEnvironments: managedEnvironmentCatalogResult.legacyProviderEnvironments,
    controlPlanes,
  });

  const nextPreferences: DesktopPreferences = {
    managed_environments: managedEnvironmentCatalogResult.environments,
    provider_environments: providerEnvironments,
    saved_environments: savedEnvironments,
    saved_ssh_environments: savedSSHEnvironments,
    recent_external_local_ui_urls: deriveRecentExternalLocalUIURLs(savedEnvironments),
    control_plane_refresh_tokens: Object.fromEntries(controlPlaneRefreshTokensByKey),
    control_planes: controlPlanes,
  };
  if (
    !hasCatalogData
    || managedEnvironmentCatalogResult.didCanonicalizeProviderIdentity
    || providerEnvironmentCatalogResult.didCanonicalizeProviderIdentity
    || savedSSHEnvironmentResult.didCanonicalize
  ) {
    await saveDesktopPreferences(paths, nextPreferences, codec);
  }
  return nextPreferences;
}

export async function saveDesktopPreferences(
  paths: DesktopPreferencesPaths,
  preferences: DesktopPreferences,
  codec: DesktopSecretCodec,
): Promise<void> {
  const catalogPaths = defaultDesktopCatalogPaths(paths.stateRoot);
  const existingSecretsFile = await readJSONFile<DesktopSecretsFile>(paths.secretsFile);
  const managedEnvironments = ensureDefaultManagedEnvironment(preferences.managed_environments);
  const providerEnvironments = normalizeProviderEnvironmentCollection(preferences.provider_environments);
  const savedEnvironments = normalizeSavedEnvironments(
    preferences.saved_environments,
    preferences.recent_external_local_ui_urls,
  );
  const savedSSHEnvironments = normalizeSavedSSHEnvironments(preferences.saved_ssh_environments);
  const controlPlanes = sortSavedControlPlanes(preferences.control_planes);
  const preferencesFile: DesktopPreferencesFile = {
    version: 13,
  };
  const secretsFile: DesktopSecretsFile = {
    version: 3,
    managed_environments: managedEnvironments.flatMap((environment) => {
      const access = managedEnvironmentLocalAccess(environment);
      if (!access.local_ui_password_configured || !environment.local_hosting) {
        return [];
      }
      const existingSecret = Array.isArray(existingSecretsFile?.managed_environments)
        ? (existingSecretsFile!.managed_environments as readonly DesktopManagedEnvironmentSecretFile[])
          .find((entry) => compact(entry.environment_id) === environment.id)
        : null;
      return [{
        environment_id: environment.id,
        local_ui_password: compact(access.local_ui_password) !== ''
          ? codec.encodeSecret(access.local_ui_password)
          : existingSecret?.local_ui_password,
      }];
    }),
    provider_environments: providerEnvironments.flatMap((environment) => {
      const access = providerEnvironmentLocalAccess(environment);
      if (!access.local_ui_password_configured || !environment.local_runtime) {
        return [];
      }
      const existingSecret = Array.isArray(existingSecretsFile?.provider_environments)
        ? (existingSecretsFile.provider_environments as readonly DesktopManagedEnvironmentSecretFile[])
          .find((entry) => compact(entry.environment_id) === environment.id)
        : null;
      return [{
        environment_id: environment.id,
        local_ui_password: compact(access.local_ui_password) !== ''
          ? codec.encodeSecret(access.local_ui_password)
          : existingSecret?.local_ui_password,
      }];
    }),
    control_planes: controlPlanes.flatMap((controlPlane) => {
      const refreshToken = compact(preferences.control_plane_refresh_tokens[
        desktopControlPlaneKey(controlPlane.provider.provider_origin, controlPlane.provider.provider_id)
      ]);
      if (refreshToken === '') {
        return [];
      }
      return [{
        provider_origin: controlPlane.provider.provider_origin,
        provider_id: controlPlane.provider.provider_id,
        refresh_token: codec.encodeSecret(refreshToken),
      }];
    }),
  };

  await writeCatalogRecords(
    catalogPaths.environmentsDir,
    Object.fromEntries(managedEnvironments.map((environment) => [
      environment.id,
      serializeManagedEnvironmentCatalog(environment),
    ])),
  );
  await writeCatalogRecords(
    catalogPaths.connectionsDir,
    Object.fromEntries([
      ...savedEnvironments.map((environment) => [environment.id, serializeSavedEnvironmentCatalog(environment)] as const),
      ...savedSSHEnvironments.map((environment) => [environment.id, serializeSavedSSHEnvironmentCatalog(environment)] as const),
    ]),
  );
  await writeCatalogRecords(
    catalogPaths.providersDir,
    Object.fromEntries(controlPlanes.map((controlPlane) => [
      desktopControlPlaneKey(controlPlane.provider.provider_origin, controlPlane.provider.provider_id),
      serializeSavedControlPlaneCatalog(controlPlane),
    ])),
  );
  await writeCatalogRecords(
    catalogPaths.providerEnvironmentsDir,
    Object.fromEntries(providerEnvironments.map((environment) => [
      environment.id,
      serializeProviderEnvironmentCatalog(environment),
    ])),
  );
  await writeCatalogRecords(
    catalogPaths.providerEnvironmentPreferencesDir,
    {},
  );
  await fs.mkdir(path.dirname(paths.preferencesFile), { recursive: true });
  await fs.mkdir(path.dirname(paths.secretsFile), { recursive: true });
  await fs.writeFile(paths.preferencesFile, `${JSON.stringify(preferencesFile, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(paths.secretsFile, `${JSON.stringify(secretsFile, null, 2)}\n`, { mode: 0o600 });
}
