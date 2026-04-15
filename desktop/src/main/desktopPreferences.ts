import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_DESKTOP_LOCAL_UI_BIND, isLoopbackOnlyBind, parseLocalUIBind } from './localUIBind';
import { normalizeLocalUIBaseURL } from './localUIURL';
import type { DesktopSavedEnvironmentSource } from '../shared/desktopConnectionTypes';
import { DEFAULT_DESKTOP_AUTO_LOOPBACK_BIND } from '../shared/desktopAccessModel';
import {
  defaultSavedSSHEnvironmentLabel,
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
  managedEnvironmentProviderID,
  managedEnvironmentProviderOrigin,
  managedEnvironmentPublicID,
  managedEnvironmentSortKey,
  normalizeDesktopLocalEnvironmentName,
  normalizeDesktopNamedEnvironmentName,
  normalizeDesktopProviderEnvironmentID,
  type DesktopManagedEnvironment,
  type DesktopManagedEnvironmentAccess,
  type DesktopManagedEnvironmentPreferredOpenRoute,
} from '../shared/desktopManagedEnvironment';

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

export type DesktopPreferences = Readonly<{
  managed_environments: readonly DesktopManagedEnvironment[];
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
}>;

type ManagedEnvironmentCatalogNormalizationResult = Readonly<{
  environment: DesktopManagedEnvironment | null;
  didCanonicalizeProviderIdentity: boolean;
}>;

type ManagedEnvironmentCatalogCollectionResult = Readonly<{
  environments: readonly DesktopManagedEnvironment[];
  didCanonicalizeProviderIdentity: boolean;
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
  remote_install_dir?: unknown;
  bootstrap_strategy?: unknown;
  release_base_url?: unknown;
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
  remote_install_dir?: unknown;
  bootstrap_strategy?: unknown;
  release_base_url?: unknown;
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
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  created_at_ms?: number;
  updated_at_ms?: number;
  last_used_at_ms?: number;
}>;

export type UpsertDesktopManagedControlPlaneEnvironmentInput = Readonly<{
  environment_id?: string;
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
  label?: string;
  pinned?: boolean;
  preferred_open_route?: 'auto' | 'local_host' | 'remote_desktop';
  created_at_ms?: number;
  updated_at_ms?: number;
  last_used_at_ms?: number;
}>;

export type DeleteManagedEnvironmentResult = Readonly<{
  preferences: DesktopPreferences;
  deleted_environment: DesktopManagedEnvironment | null;
  deleted_state_dir: string;
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
  };
}

export function desktopPreferencesToDraft(
  preferences: DesktopPreferences,
  environmentID?: string,
): DesktopSettingsDraft {
  const environment = (
    (environmentID ? findManagedEnvironmentByID(preferences, environmentID) : null)
    ?? preferences.managed_environments[0]
    ?? createManagedLocalEnvironment('default')
  );
  const access = managedEnvironmentLocalAccess(environment);
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

function sortManagedEnvironments(
  environments: readonly DesktopManagedEnvironment[],
): readonly DesktopManagedEnvironment[] {
  return [...environments].sort((left, right) => {
    const [leftPinned, leftLabel, leftID] = managedEnvironmentSortKey(left);
    const [rightPinned, rightLabel, rightID] = managedEnvironmentSortKey(right);
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
): DesktopSavedSSHEnvironment | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as DesktopSavedSSHEnvironmentFile;
  let details: DesktopSSHEnvironmentDetails;
  try {
    details = {
      ssh_destination: normalizeDesktopSSHDestination(candidate.ssh_destination),
      ssh_port: normalizeDesktopSSHPort(candidate.ssh_port),
      remote_install_dir: normalizeDesktopSSHRemoteInstallDir(candidate.remote_install_dir),
      bootstrap_strategy: normalizeDesktopSSHBootstrapStrategy(candidate.bootstrap_strategy),
      release_base_url: normalizeDesktopSSHReleaseBaseURL(candidate.release_base_url),
    };
  } catch {
    return null;
  }

  const environmentID = compact(candidate.id) || desktopSSHEnvironmentID(details);
  const label = compact(candidate.label) || defaultSavedSSHEnvironmentLabel(details);
  return {
    id: environmentID,
    label,
    ssh_destination: details.ssh_destination,
    ssh_port: details.ssh_port,
    remote_install_dir: details.remote_install_dir,
    bootstrap_strategy: details.bootstrap_strategy,
    release_base_url: details.release_base_url,
    source: normalizeSavedEnvironmentSource(candidate.source, 'saved'),
    pinned: normalizePinned(candidate.pinned),
    last_used_at_ms: normalizeLastUsedAtMS(candidate.last_used_at_ms, fallbackLastUsedAtMS),
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

export function normalizeSavedSSHEnvironments(
  values: readonly unknown[] | null | undefined,
): readonly DesktopSavedSSHEnvironment[] {
  const sourceValues = Array.isArray(values) ? values : [];
  const normalized: DesktopSavedSSHEnvironment[] = [];
  const seenIDs = new Set<string>();

  for (let index = 0; index < sourceValues.length; index += 1) {
    const environment = normalizeSavedSSHEnvironmentCandidate(sourceValues[index], sourceValues.length - index);
    if (!environment || seenIDs.has(environment.id)) {
      continue;
    }
    seenIDs.add(environment.id);
    normalized.push(environment);
  }

  return sortSavedSSHEnvironmentsByLastUsed(normalized).slice(0, MAX_SAVED_SSH_ENVIRONMENTS);
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

function matchesProviderBinding(
  environment: DesktopManagedEnvironment,
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): boolean {
  return (
    managedEnvironmentProviderOrigin(environment) === providerOrigin
    && providerIDMatchesCanonicalIdentity(
      providerOrigin,
      managedEnvironmentProviderID(environment),
      providerID,
    )
    && managedEnvironmentPublicID(environment) === envPublicID
  );
}

function normalizeManagedEnvironmentCollection(
  environments: readonly DesktopManagedEnvironment[],
): readonly DesktopManagedEnvironment[] {
  const seenIDs = new Set<string>();
  const normalized: DesktopManagedEnvironment[] = [];
  for (const environment of environments) {
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

function environmentMatchesControlPlane(
  environment: DesktopManagedEnvironment,
  providerOrigin: string,
  providerID: string,
): boolean {
  return (
    managedEnvironmentProviderOrigin(environment) === providerOrigin
    && providerIDMatchesCanonicalIdentity(
      providerOrigin,
      managedEnvironmentProviderID(environment),
      providerID,
    )
  );
}

function reconcileManagedEnvironmentWithProviderRecord(
  environment: DesktopManagedEnvironment | null,
  controlPlane: DesktopSavedControlPlane,
  providerEnvironment: DesktopProviderEnvironment,
): DesktopManagedEnvironment {
  const providerBinding = createManagedEnvironmentProviderBinding(
    controlPlane.provider.provider_origin,
    providerEnvironment.env_public_id,
    {
      providerID: controlPlane.provider.provider_id,
      remoteWebSupported: true,
      remoteDesktopSupported: true,
    },
  );
  if (!environment) {
    return createManagedControlPlaneEnvironment(
      controlPlane.provider.provider_origin,
      providerEnvironment.env_public_id,
      {
        providerID: controlPlane.provider.provider_id,
        label: providerEnvironment.label,
        createdAtMS: Date.now(),
        updatedAtMS: Date.now(),
      },
    );
  }
  return createManagedEnvironment({
    environmentID: environment.id,
    label: environment.local_hosting ? environment.label : providerEnvironment.label,
    pinned: environment.pinned,
    preferredOpenRoute: environment.preferred_open_route,
    localHosting: environment.local_hosting,
    providerBinding,
    createdAtMS: environment.created_at_ms,
    updatedAtMS: Date.now(),
    lastUsedAtMS: environment.last_used_at_ms,
  });
}

function reconcileManagedEnvironmentsWithControlPlane(
  preferences: DesktopPreferences,
  controlPlane: DesktopSavedControlPlane,
): readonly DesktopManagedEnvironment[] {
  const environmentByKey = new Map<string, DesktopProviderEnvironment>();
  for (const environment of controlPlane.environments) {
    environmentByKey.set(
      providerEnvironmentRecordKey(
        controlPlane.provider.provider_origin,
        controlPlane.provider.provider_id,
        environment.env_public_id,
      ),
      environment,
    );
  }

  const reconciled: DesktopManagedEnvironment[] = [];
  const matchedKeys = new Set<string>();

  for (const environment of preferences.managed_environments) {
    if (!environmentMatchesControlPlane(environment, controlPlane.provider.provider_origin, controlPlane.provider.provider_id)) {
      reconciled.push(environment);
      continue;
    }

    const providerOrigin = managedEnvironmentProviderOrigin(environment);
    const providerID = managedEnvironmentProviderID(environment);
    const envPublicID = managedEnvironmentPublicID(environment);
    if (providerOrigin === '' || providerID === '' || envPublicID === '') {
      reconciled.push(environment);
      continue;
    }

    const recordKey = providerEnvironmentRecordKey(
      controlPlane.provider.provider_origin,
      controlPlane.provider.provider_id,
      envPublicID,
    );
    const providerEnvironment = environmentByKey.get(recordKey) ?? null;
    if (!providerEnvironment) {
      if (environment.local_hosting) {
        reconciled.push(environment);
      }
      continue;
    }

    matchedKeys.add(recordKey);
    reconciled.push(reconcileManagedEnvironmentWithProviderRecord(environment, controlPlane, providerEnvironment));
  }

  for (const providerEnvironment of controlPlane.environments) {
    const recordKey = providerEnvironmentRecordKey(
      controlPlane.provider.provider_origin,
      controlPlane.provider.provider_id,
      providerEnvironment.env_public_id,
    );
    if (matchedKeys.has(recordKey)) {
      continue;
    }
    reconciled.push(reconcileManagedEnvironmentWithProviderRecord(null, controlPlane, providerEnvironment));
  }

  return normalizeManagedEnvironmentCollection(reconciled);
}

function requestedManagedEnvironmentProviderBinding(
  input: UpsertDesktopManagedEnvironmentInput,
): ReturnType<typeof createManagedEnvironmentProviderBinding> | null {
  const providerOrigin = compact(input.provider_origin);
  const providerID = compact(input.provider_id);
  const envPublicID = compact(input.env_public_id);
  if (providerOrigin === '' && providerID === '' && envPublicID === '') {
    return null;
  }
  if (providerOrigin === '' || providerID === '' || envPublicID === '') {
    throw new Error('Control Plane binding requires provider origin, provider ID, and environment ID.');
  }
  return createManagedEnvironmentProviderBinding(providerOrigin, envPublicID, { providerID });
}

function findManagedEnvironmentByProviderBinding(
  preferences: DesktopPreferences,
  providerBinding: ReturnType<typeof createManagedEnvironmentProviderBinding>,
): DesktopManagedEnvironment | null {
  return preferences.managed_environments.find((environment) => matchesProviderBinding(
    environment,
    providerBinding.provider_origin,
    providerBinding.provider_id,
    providerBinding.env_public_id,
  )) ?? null;
}

function localHostingForManagedEnvironment(
  input: UpsertDesktopManagedEnvironmentInput,
  access: DesktopManagedEnvironmentAccess,
  existing: DesktopManagedEnvironment | null,
  providerBinding: ReturnType<typeof createManagedEnvironmentProviderBinding> | null,
  stateRootOverride?: string,
): ReturnType<typeof createManagedEnvironmentLocalHosting> {
  if (providerBinding) {
    const existingStateDir = (
      existing?.local_hosting?.scope.kind === 'controlplane'
      && existing.local_hosting.scope.provider_origin === providerBinding.provider_origin
      && existing.local_hosting.scope.env_public_id === providerBinding.env_public_id
    )
      ? existing.local_hosting.state_dir
      : resolveManagedEnvironmentStateDir({
        providerOrigin: providerBinding.provider_origin,
        envPublicID: providerBinding.env_public_id,
      }, stateRootOverride);
    return createManagedEnvironmentLocalHosting(
      {
        kind: 'controlplane',
        provider_origin: providerBinding.provider_origin,
        provider_key: controlPlaneProviderKeyForOrigin(providerBinding.provider_origin),
        env_public_id: providerBinding.env_public_id,
      },
      {
        access,
        owner: existing?.local_hosting?.owner ?? 'desktop',
        stateDir: existingStateDir,
      },
    );
  }

  const name = normalizeDesktopLocalEnvironmentName(input.name);
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
    },
  );
}

export function upsertManagedEnvironment(
  preferences: DesktopPreferences,
  input: UpsertDesktopManagedEnvironmentInput,
): DesktopPreferences {
  const existingByID = compact(input.environment_id) === ''
    ? null
    : preferences.managed_environments.find((environment) => environment.id === compact(input.environment_id)) ?? null;
  const requestedProviderBinding = requestedManagedEnvironmentProviderBinding(input);
  const existingByProvider = requestedProviderBinding
    ? findManagedEnvironmentByProviderBinding(preferences, requestedProviderBinding)
    : null;
  const existing = existingByID?.local_hosting
    ? existingByID
    : existingByProvider?.local_hosting
      ? existingByProvider
      : existingByID
        ?? existingByProvider
        ?? null;
  const access = input.access ?? (existing ? managedEnvironmentLocalAccess(existing) : defaultDesktopManagedEnvironmentAccess());
  const environmentID = requestedProviderBinding
    ? existingByProvider?.id || desktopManagedControlPlaneEnvironmentID(
      requestedProviderBinding.provider_origin,
      requestedProviderBinding.env_public_id,
    )
    : existingByID?.id || desktopManagedLocalEnvironmentID(normalizeDesktopLocalEnvironmentName(input.name));
  const nextEnvironment = createManagedEnvironment({
    environmentID,
    label: compact(input.label)
      || existingByID?.label
      || existingByProvider?.label
      || (requestedProviderBinding
        ? requestedProviderBinding.env_public_id
        : defaultLocalManagedEnvironmentLabel(normalizeDesktopLocalEnvironmentName(input.name))),
    pinned: input.pinned ?? existingByID?.pinned ?? existingByProvider?.pinned ?? false,
    preferredOpenRoute: existingByID?.preferred_open_route ?? existingByProvider?.preferred_open_route ?? 'auto',
    localHosting: localHostingForManagedEnvironment(input, access, existing, requestedProviderBinding),
    providerBinding: requestedProviderBinding ?? undefined,
    createdAtMS: input.created_at_ms ?? existingByID?.created_at_ms ?? existingByProvider?.created_at_ms ?? Date.now(),
    updatedAtMS: input.updated_at_ms ?? Date.now(),
    lastUsedAtMS: input.last_used_at_ms ?? existingByID?.last_used_at_ms ?? existingByProvider?.last_used_at_ms ?? 0,
  });
  const replacedIDs = new Set<string>([
    environmentID,
    existingByID?.id ?? '',
    existingByProvider?.id ?? '',
  ].filter((value) => value !== ''));
  return {
    ...preferences,
    managed_environments: normalizeManagedEnvironmentCollection([
      nextEnvironment,
      ...preferences.managed_environments.filter((environment) => (
        !replacedIDs.has(environment.id)
        && !(
          requestedProviderBinding
          && matchesProviderBinding(
            environment,
            requestedProviderBinding.provider_origin,
            requestedProviderBinding.provider_id,
            requestedProviderBinding.env_public_id,
          )
        )
      )),
    ]),
  };
}

export function upsertManagedControlPlaneEnvironment(
  preferences: DesktopPreferences,
  input: UpsertDesktopManagedControlPlaneEnvironmentInput,
): DesktopPreferences {
  const providerBinding = createManagedEnvironmentProviderBinding(
    input.provider_origin,
    input.env_public_id,
    { providerID: input.provider_id },
  );
  const providerEnvironmentID = desktopManagedControlPlaneEnvironmentID(input.provider_origin, input.env_public_id);
  const existing = (
    (compact(input.environment_id) !== ''
      ? preferences.managed_environments.find((environment) => environment.id === compact(input.environment_id)) ?? null
      : null)
    ?? preferences.managed_environments.find((environment) => (
      environment.id === providerEnvironmentID
      || matchesProviderBinding(
        environment,
        providerBinding.provider_origin,
        providerBinding.provider_id,
        providerBinding.env_public_id,
      )
    )) ?? null
  );
  const environmentID = compact(input.environment_id) || existing?.id || providerEnvironmentID;
  const nextEnvironment = createManagedControlPlaneEnvironment(input.provider_origin, input.env_public_id, {
    providerID: input.provider_id,
    label: compact(input.label) || existing?.label || compact(input.env_public_id),
    pinned: input.pinned ?? existing?.pinned ?? false,
    preferredOpenRoute: normalizePreferredOpenRoute(
      input.preferred_open_route,
      existing?.preferred_open_route ?? 'auto',
    ),
    localHosting: existing?.local_hosting,
    createdAtMS: input.created_at_ms ?? existing?.created_at_ms ?? Date.now(),
    updatedAtMS: input.updated_at_ms ?? Date.now(),
    lastUsedAtMS: input.last_used_at_ms ?? existing?.last_used_at_ms ?? 0,
    remoteDesktopSupported: true,
    remoteWebSupported: true,
  });
  return {
    ...preferences,
    managed_environments: normalizeManagedEnvironmentCollection([
      {
        ...nextEnvironment,
        id: environmentID,
      },
      ...preferences.managed_environments.filter((environment) => (
        environment.id !== environmentID
        && !matchesProviderBinding(
          environment,
          providerBinding.provider_origin,
          providerBinding.provider_id,
          providerBinding.env_public_id,
        )
      )),
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
  const environmentID = compact(input.environment_id) || desktopSSHEnvironmentID(details);
  const existing = preferences.saved_ssh_environments.find((environment) => (
    environment.id === environmentID
    || (
      environment.ssh_destination === details.ssh_destination
      && environment.ssh_port === details.ssh_port
      && environment.remote_install_dir === details.remote_install_dir
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
    remote_install_dir: details.remote_install_dir,
    bootstrap_strategy: details.bootstrap_strategy,
    release_base_url: details.release_base_url,
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
        || environment.remote_install_dir !== details.remote_install_dir
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

  const nextPreferences = {
    ...preferences,
    control_plane_refresh_tokens: nextRefreshTokens,
    control_planes: controlPlanes,
  };
  return {
    ...nextPreferences,
    managed_environments: reconcileManagedEnvironmentsWithControlPlane(nextPreferences, nextControlPlane),
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
    remote_install_dir: input.remote_install_dir,
    bootstrap_strategy: input.bootstrap_strategy,
    release_base_url: input.release_base_url,
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
  const nextManagedEnvironments = existing.provider_binding
    ? normalizeManagedEnvironmentCollection([
      createManagedControlPlaneEnvironment(
        existing.provider_binding.provider_origin,
        existing.provider_binding.env_public_id,
        {
          providerID: existing.provider_binding.provider_id,
          label: existing.label,
          pinned: existing.pinned,
          preferredOpenRoute: existing.preferred_open_route === 'local_host'
            ? 'remote_desktop'
            : normalizePreferredOpenRoute(existing.preferred_open_route),
          createdAtMS: existing.created_at_ms,
          updatedAtMS: Date.now(),
          lastUsedAtMS: existing.last_used_at_ms,
          remoteWebSupported: existing.provider_binding.remote_web_supported,
          remoteDesktopSupported: existing.provider_binding.remote_desktop_supported,
        },
      ),
      ...preferences.managed_environments.filter((environment) => (
        environment.id !== cleanEnvironmentID
        && !matchesProviderBinding(
          environment,
          existing.provider_binding!.provider_origin,
          existing.provider_binding!.provider_id,
          existing.provider_binding!.env_public_id,
        )
      )),
    ])
    : normalizeManagedEnvironmentCollection(
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
  return {
    ...preferences,
    control_plane_refresh_tokens: nextRefreshTokens,
    control_planes: preferences.control_planes.filter((controlPlane) => (
      desktopControlPlaneKey(controlPlane.provider.provider_origin, controlPlane.provider.provider_id) !== key
    )),
    managed_environments: normalizeManagedEnvironmentCollection(
      preferences.managed_environments.filter((environment) => (
        !environmentMatchesControlPlane(environment, providerOrigin, providerID)
        || Boolean(environment.local_hosting)
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
    environment_id: compact(input.environment_id) || desktopSSHEnvironmentID(input),
    label: compact(input.label),
    ssh_destination: input.ssh_destination,
    ssh_port: input.ssh_port,
    remote_install_dir: input.remote_install_dir,
    bootstrap_strategy: input.bootstrap_strategy,
    release_base_url: input.release_base_url,
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
      didCanonicalizeProviderIdentity: false,
    };
  }
  const candidate = value as DesktopManagedEnvironmentCatalogFile;
  const recordKind = compact(candidate.record_kind);
  if (recordKind !== '' && recordKind !== 'environment') {
    return {
      environment: null,
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
      didCanonicalizeProviderIdentity,
    };
  } catch {
    return {
      environment: null,
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
  const seenIDs = new Set<string>();
  let didCanonicalizeProviderIdentity = false;
  for (const value of values) {
    const result = normalizeManagedEnvironmentCatalogCandidate(
      value,
      passwordsByID,
      canonicalProviderIDsByOrigin,
      stateRootOverride,
    );
    didCanonicalizeProviderIdentity ||= result.didCanonicalizeProviderIdentity;
    const environment = result.environment;
    if (!environment || seenIDs.has(environment.id)) {
      continue;
    }
    seenIDs.add(environment.id);
    normalized.push(environment);
  }
  return {
    environments: ensureDefaultManagedEnvironment(
      normalized.length > 0
        ? normalized
        : [createManagedLocalEnvironment('default', {
            access: legacyAccess,
            stateDir: resolveManagedEnvironmentStateDir({ name: 'default' }, stateRootOverride),
          })],
      legacyAccess,
      stateRootOverride,
    ),
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
    remote_install_dir: environment.remote_install_dir,
    bootstrap_strategy: environment.bootstrap_strategy,
    release_base_url: environment.release_base_url,
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

export async function loadDesktopPreferences(paths: DesktopPreferencesPaths, codec: DesktopSecretCodec): Promise<DesktopPreferences> {
  const preferencesFile = await readJSONFile<DesktopPreferencesFile>(paths.preferencesFile);
  const secretsFile = await readJSONFile<DesktopSecretsFile>(paths.secretsFile);
  const catalogPaths = defaultDesktopCatalogPaths(paths.stateRoot);
  const catalogManagedEnvironments = await readJSONDirectory(catalogPaths.environmentsDir);
  const catalogConnections = await readJSONDirectory(catalogPaths.connectionsDir);
  const catalogProviders = await readJSONDirectory(catalogPaths.providersDir);
  const localUIPasswordConfigured = Boolean(secretsFile?.local_ui_password);
  const localUIPassword = decodeOptionalSecret(codec, secretsFile?.local_ui_password);
  const managedEnvironmentPasswordsByID = decodeManagedEnvironmentPasswords(codec, secretsFile?.managed_environments);
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
    || Number(preferencesFile?.version ?? 0) >= 10
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
  const savedSSHEnvironments = hasCatalogData
    ? normalizeSavedSSHEnvironments(
      catalogConnections.filter((value) => (
        !!value && typeof value === 'object' && compact((value as DesktopConnectionCatalogFile).kind) === 'ssh'
      )),
    )
    : normalizeSavedSSHEnvironments(preferencesFile?.saved_ssh_environments);
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
    : {
      environments: normalizeManagedEnvironments(preferencesFile?.managed_environments, {
        passwordsByID: managedEnvironmentPasswordsByID,
        legacyLocalUIBind: legacyAccess.local_ui_bind,
        legacyLocalUIPassword: legacyAccess.local_ui_password,
        legacyLocalUIPasswordConfigured: legacyAccess.local_ui_password_configured,
        stateRoot: paths.stateRoot,
      }),
      didCanonicalizeProviderIdentity: false,
    };

  const nextPreferences: DesktopPreferences = {
    managed_environments: managedEnvironmentCatalogResult.environments,
    saved_environments: savedEnvironments,
    saved_ssh_environments: savedSSHEnvironments,
    recent_external_local_ui_urls: deriveRecentExternalLocalUIURLs(savedEnvironments),
    control_plane_refresh_tokens: Object.fromEntries(controlPlaneRefreshTokensByKey),
    control_planes: controlPlanes,
  };
  if (!hasCatalogData || managedEnvironmentCatalogResult.didCanonicalizeProviderIdentity) {
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
  const savedEnvironments = normalizeSavedEnvironments(
    preferences.saved_environments,
    preferences.recent_external_local_ui_urls,
  );
  const savedSSHEnvironments = normalizeSavedSSHEnvironments(preferences.saved_ssh_environments);
  const controlPlanes = sortSavedControlPlanes(preferences.control_planes);
  const preferencesFile: DesktopPreferencesFile = {
    version: 10,
  };
  const secretsFile: DesktopSecretsFile = {
    version: 2,
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
  await fs.mkdir(path.dirname(paths.preferencesFile), { recursive: true });
  await fs.mkdir(path.dirname(paths.secretsFile), { recursive: true });
  await fs.writeFile(paths.preferencesFile, `${JSON.stringify(preferencesFile, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(paths.secretsFile, `${JSON.stringify(secretsFile, null, 2)}\n`, { mode: 0o600 });
}
