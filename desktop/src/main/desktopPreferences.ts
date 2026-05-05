import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_DESKTOP_LOCAL_UI_BIND,
  isLoopbackOnlyBind,
  parseLocalUIBind,
} from './localUIBind';
import { normalizeLocalUIBaseURL } from './localUIURL';
import type { DesktopSavedEnvironmentSource } from '../shared/desktopConnectionTypes';
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
  localEnvironmentStateLayout,
  resolveStateRoot,
} from './statePaths';
import {
  createDesktopLocalEnvironmentHosting,
  createDesktopLocalProviderBinding,
  createDesktopLocalEnvironmentState,
  defaultDesktopLocalEnvironmentAccess,
  defaultDesktopLocalEnvironmentLabel,
  LOCAL_ENVIRONMENT_ID,
  localEnvironmentAccess,
  normalizeDesktopLocalEnvironmentName,
  normalizeDesktopProviderEnvironmentID,
  type DesktopLocalEnvironmentState,
  type DesktopLocalEnvironmentAccess,
  type DesktopLocalEnvironmentPreferredOpenRoute,
} from '../shared/desktopLocalEnvironmentState';
import {
  createDesktopProviderEnvironmentRecord,
  defaultDesktopProviderEnvironmentLabel,
  desktopProviderEnvironmentID,
  desktopProviderEnvironmentRemoteCatalogEntryFromPublished,
  providerEnvironmentSortKey,
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

export type DesktopPreferences = Readonly<{
  local_environment: DesktopLocalEnvironmentState;
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
  localEnvironmentFile: string;
  connectionsDir: string;
  providersDir: string;
  providerEnvironmentsDir: string;
}>;

type LocalEnvironmentCatalogNormalizationResult = Readonly<{
  environment: DesktopLocalEnvironmentState | null;
  didCanonicalizeProviderIdentity: boolean;
}>;

type LocalEnvironmentCatalogResult = Readonly<{
  environment: DesktopLocalEnvironmentState;
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
  source?: unknown;
  pinned?: unknown;
  last_used_at_ms?: unknown;
}>;

type DesktopLocalEnvironmentStateCatalogFile = Readonly<{
  schema_version?: unknown;
  record_kind?: unknown;
  id?: unknown;
  label?: unknown;
  pinned?: unknown;
  created_at_ms?: unknown;
  updated_at_ms?: unknown;
  last_used_at_ms?: unknown;
  preferred_open_route?: unknown;
  local_hosting?: Readonly<{
    scope?: Readonly<{
      kind?: unknown;
      name?: unknown;
    }>;
    scope_key?: unknown;
    state_dir?: unknown;
    owner?: unknown;
    access?: Readonly<{
      local_ui_bind?: unknown;
      local_ui_password_configured?: unknown;
    }>;
  }>;
  current_provider_binding?: Readonly<{
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
}>;

type DesktopControlPlaneSecretFile = Readonly<{
  provider_origin?: unknown;
  provider_id?: unknown;
  refresh_token?: StoredSecret;
}>;

type DesktopSecretsFile = Readonly<{
  version?: number;
  local_environment?: DesktopLocalEnvironmentStateSecretFile;
  control_planes?: readonly DesktopControlPlaneSecretFile[];
}>;

type DesktopLocalEnvironmentStateSecretFile = Readonly<{
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

export type UpsertDesktopLocalEnvironmentStateInput = Readonly<{
  environment_id?: string;
  name?: string;
  label?: string;
  pinned?: boolean;
  access?: DesktopLocalEnvironmentAccess;
  created_at_ms?: number;
  updated_at_ms?: number;
  last_used_at_ms?: number;
}>;

export type DeleteLocalEnvironmentResult = Readonly<{
  preferences: DesktopPreferences;
  deleted_environment: DesktopLocalEnvironmentState | null;
  deleted_state_dir: string;
}>;

export type DesktopLocalEnvironmentStateLocalBindConflict = Readonly<{
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
    local_environment: createDesktopLocalEnvironmentState('local'),
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
    localEnvironmentFile: path.join(catalogRoot, 'local-environment.json'),
    connectionsDir: path.join(catalogRoot, 'connections'),
    providersDir: path.join(catalogRoot, 'providers'),
    providerEnvironmentsDir: path.join(catalogRoot, 'provider-environments'),
  };
}

export function desktopPreferencesToDraft(
  preferences: DesktopPreferences,
  environmentID?: string,
): DesktopSettingsDraft {
  const localEnvironment = preferences.local_environment;
  const access = (() => {
    const selectedLocalEnvironment = environmentID ? findLocalEnvironmentByID(preferences, environmentID) : null;
    if (selectedLocalEnvironment) {
      return localEnvironmentAccess(selectedLocalEnvironment);
    }
    return localEnvironmentAccess(localEnvironment);
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

function resolveLocalEnvironmentStateDir(input: Readonly<{
  name?: string;
  providerOrigin?: string;
  envPublicID?: string;
}>, stateRootOverride?: string): string {
  void input;
  return localEnvironmentStateLayout(process.env, os.homedir, stateRootOverride).stateDir;
}

function normalizeLocalEnvironmentAccess(
  localUIBind: unknown,
  localUIPassword: string,
  localUIPasswordConfigured = compact(localUIPassword) !== '',
): DesktopLocalEnvironmentAccess {
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

function normalizeLocalEnvironmentState(
  environment: DesktopLocalEnvironmentState | null | undefined,
  stateRootOverride?: string,
): DesktopLocalEnvironmentState {
  const source = environment ?? null;
  return createDesktopLocalEnvironmentState('local', {
    label: defaultDesktopLocalEnvironmentLabel('local'),
    pinned: source?.pinned,
    access: source?.local_hosting.access,
    preferredOpenRoute: source?.preferred_open_route,
    currentProviderBinding: source?.current_provider_binding,
    owner: source?.local_hosting.owner,
    stateDir: compact(source?.local_hosting.state_dir)
      || resolveLocalEnvironmentStateDir({ name: 'local' }, stateRootOverride),
    currentRuntime: source?.local_hosting.current_runtime,
    createdAtMS: source?.created_at_ms,
    updatedAtMS: source?.updated_at_ms,
    lastUsedAtMS: source?.last_used_at_ms,
  });
}

export function findLocalEnvironmentByID(
  preferences: DesktopPreferences,
  environmentID: string,
): DesktopLocalEnvironmentState | null {
  const cleanEnvironmentID = compact(environmentID);
  if (cleanEnvironmentID === '' || cleanEnvironmentID !== LOCAL_ENVIRONMENT_ID) {
    return null;
  }
  return preferences.local_environment;
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
      source: normalizeSavedEnvironmentSource(candidate.source, 'saved'),
      pinned: normalizePinned(candidate.pinned),
      last_used_at_ms: normalizeLastUsedAtMS(candidate.last_used_at_ms, fallbackLastUsedAtMS),
    },
    didCanonicalize: compact(candidate.id) !== environmentID,
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

function normalizeProviderEnvironmentCatalogCandidate(
  value: unknown,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
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
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
): ProviderEnvironmentNormalizationResult {
  const normalized: DesktopProviderEnvironmentRecord[] = [];
  let didCanonicalizeProviderIdentity = false;
  for (const value of values) {
    const result = normalizeProviderEnvironmentCatalogCandidate(
      value,
      canonicalProviderIDsByOrigin,
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
    preferred_open_route?: DesktopLocalEnvironmentPreferredOpenRoute;
    remote_web_supported?: boolean;
    remote_desktop_supported?: boolean;
    remote_catalog_entry?: DesktopProviderEnvironmentRecord['remote_catalog_entry'] | null;
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
  return createDesktopProviderEnvironmentRecord(input.provider_origin, input.env_public_id, {
    environmentID: existing?.id,
    providerID: input.provider_id || existing?.provider_id || '',
    label,
    pinned,
    preferredOpenRoute,
    remoteWebSupported: input.remote_web_supported ?? existing?.remote_web_supported ?? true,
    remoteDesktopSupported: input.remote_desktop_supported ?? existing?.remote_desktop_supported ?? true,
    remoteCatalogEntry: remoteCatalogEntry ?? undefined,
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
  activeControlPlaneKeys: ReadonlySet<string>,
): boolean {
  const controlPlaneKey = desktopControlPlaneKey(environment.provider_origin, environment.provider_id);
  return activeControlPlaneKeys.has(controlPlaneKey) && (environment.pinned || environment.last_used_at_ms > 0);
}

function reconcileProviderEnvironments(
  input: Readonly<{
    stored: readonly DesktopProviderEnvironmentRecord[];
    controlPlanes: readonly DesktopSavedControlPlane[];
  }>,
): readonly DesktopProviderEnvironmentRecord[] {
  const canonicalProviderIDsByOrigin = buildCanonicalProviderIDByOrigin(input.controlPlanes);
  const activeControlPlaneKeys = new Set(input.controlPlanes.map((controlPlane) => (
    desktopControlPlaneKey(controlPlane.provider.provider_origin, controlPlane.provider.provider_id)
  )));
  const recordsByKey = new Map<string, DesktopProviderEnvironmentRecord>();
  const activeCatalogKeys = new Set<string>();

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
      const existing = recordsByKey.get(key) ?? null;
      recordsByKey.set(key, mergeProviderEnvironmentRecord(existing, {
        provider_origin: controlPlane.provider.provider_origin,
        provider_id: controlPlane.provider.provider_id,
        env_public_id: environment.env_public_id,
        label: environment.label,
        remote_web_supported: true,
        remote_desktop_supported: true,
        remote_catalog_entry: desktopProviderEnvironmentRemoteCatalogEntryFromPublished(environment),
        created_at_ms: controlPlane.last_synced_at_ms || Date.now(),
        updated_at_ms: controlPlane.last_synced_at_ms || Date.now(),
      }));
    }
  }

  return normalizeProviderEnvironmentCollection(
    [...recordsByKey.entries()]
      .filter(([key, environment]) => (
        activeCatalogKeys.has(key) || providerEnvironmentShouldPersistWithoutRemoteCatalog(environment, activeControlPlaneKeys)
      ))
      .map(([, environment]) => environment),
  );
}

function providerEnvironmentBelongsToControlPlane(
  environment: DesktopProviderEnvironmentRecord,
  providerOrigin: string,
  providerID: string,
): boolean {
  const normalizedProviderOrigin = normalizeControlPlaneOrigin(providerOrigin);
  return environment.provider_origin === normalizedProviderOrigin
    && providerIDMatchesCanonicalIdentity(normalizedProviderOrigin, environment.provider_id, providerID);
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
  void providerOrigin;
  return cleanActualProviderID === cleanCanonicalProviderID;
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

function providerEnvironmentRecordKey(
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): string {
  return `${desktopControlPlaneKey(providerOrigin, providerID)}|${normalizeDesktopProviderEnvironmentID(envPublicID)}`;
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
    created_at_ms: environment.created_at_ms,
    updated_at_ms: environment.updated_at_ms,
    last_used_at_ms: environment.last_used_at_ms,
  });
}

export function findLocalEnvironmentLocalBindConflict(
  _preferences: DesktopPreferences,
  _environmentID: string,
): DesktopLocalEnvironmentStateLocalBindConflict | null {
  return null;
}

export function describeLocalEnvironmentLocalBindConflict(
  conflict: DesktopLocalEnvironmentStateLocalBindConflict,
): string {
  const targetLabel = compact(conflict.label) || compact(conflict.environment_id) || 'This environment';
  const conflictingLabel = compact(conflict.conflicting_label) || compact(conflict.conflicting_environment_id) || 'another environment';
  return `${targetLabel} cannot use ${conflict.local_ui_bind} because "${conflictingLabel}" is already configured for ${conflict.conflicting_local_ui_bind}. Choose a different Local UI bind or update that environment first.`;
}

export function upsertLocalEnvironment(
  preferences: DesktopPreferences,
  input: UpsertDesktopLocalEnvironmentStateInput,
): DesktopPreferences {
  const existing = preferences.local_environment;
  const access = input.access ?? (
    existing
      ? localEnvironmentAccess(existing)
      : defaultDesktopLocalEnvironmentAccess()
  );
  const name = normalizeDesktopLocalEnvironmentName(
    compact(input.name)
    || 'local',
  );
  const nextEnvironment = createDesktopLocalEnvironmentState(name, {
    label: defaultDesktopLocalEnvironmentLabel(name),
    pinned: input.pinned ?? existing?.pinned ?? false,
    preferredOpenRoute: existing?.preferred_open_route ?? 'auto',
    currentProviderBinding: existing?.current_provider_binding,
    access,
    owner: existing?.local_hosting.owner ?? 'desktop',
    stateDir: existing?.local_hosting.state_dir
      || resolveLocalEnvironmentStateDir({ name }),
    currentRuntime: existing?.local_hosting.current_runtime,
    createdAtMS: input.created_at_ms ?? existing?.created_at_ms ?? Date.now(),
    updatedAtMS: input.updated_at_ms ?? Date.now(),
    lastUsedAtMS: input.last_used_at_ms ?? existing?.last_used_at_ms ?? 0,
  });
  return {
    ...preferences,
    local_environment: nextEnvironment,
  };
}

export function updateLocalEnvironmentAccess(
  preferences: DesktopPreferences,
  environmentID: string,
  access: DesktopLocalEnvironmentAccess,
): DesktopPreferences {
  const cleanEnvironmentID = compact(environmentID);
  if (cleanEnvironmentID !== LOCAL_ENVIRONMENT_ID) {
    return preferences;
  }
  return {
    ...preferences,
    local_environment: {
      ...preferences.local_environment,
      local_hosting: {
        ...preferences.local_environment.local_hosting,
        access,
      },
      updated_at_ms: Date.now(),
    },
  };
}

export function rememberLocalEnvironmentUse(
  preferences: DesktopPreferences,
  environmentID: string,
  route?: DesktopLocalEnvironmentPreferredOpenRoute,
): DesktopPreferences {
  const cleanEnvironmentID = compact(environmentID);
  if (cleanEnvironmentID !== LOCAL_ENVIRONMENT_ID) {
    return preferences;
  }
  return {
    ...preferences,
    local_environment: {
      ...preferences.local_environment,
      last_used_at_ms: Date.now(),
      preferred_open_route: route === 'local_host' || route === 'remote_desktop'
        ? route
        : preferences.local_environment.preferred_open_route,
      updated_at_ms: Date.now(),
    },
  };
}

export function setLocalEnvironmentPinned(
  preferences: DesktopPreferences,
  environmentID: string,
  pinned: boolean,
): DesktopPreferences {
  const cleanEnvironmentID = compact(environmentID);
  if (cleanEnvironmentID !== LOCAL_ENVIRONMENT_ID) {
    return preferences;
  }
  return {
    ...preferences,
    local_environment: {
      ...preferences.local_environment,
      pinned,
      updated_at_ms: Date.now(),
    },
  };
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
    provider_environments: reconcileProviderEnvironments({
      stored: nextPreferences.provider_environments,
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
    source: 'saved',
    pinned: input.pinned,
    last_used_at_ms: input.last_used_at_ms,
  });
}

export function deleteLocalEnvironment(
  preferences: DesktopPreferences,
  environmentID: string,
): DeleteLocalEnvironmentResult {
  void environmentID;
  return {
    preferences,
    deleted_environment: null,
    deleted_state_dir: '',
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
    provider_environments: normalizeProviderEnvironmentCollection(
      preferences.provider_environments.filter((environment) => (
        !providerEnvironmentBelongsToControlPlane(environment, normalizedProviderOrigin, providerID)
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
    source: 'recent_auto',
    last_used_at_ms: Date.now(),
  });
}

export function localEnvironmentDesktopLaunchKey(preferences: DesktopPreferences): string {
  return JSON.stringify(localEnvironmentAccess(preferences.local_environment));
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
): DesktopLocalEnvironmentAccess {
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

function normalizeLocalEnvironmentCatalogCandidate(
  value: unknown,
  localUIPassword: string,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
  stateRootOverride?: string,
): LocalEnvironmentCatalogNormalizationResult {
  if (!value || typeof value !== 'object') {
    return {
      environment: null,
      didCanonicalizeProviderIdentity: false,
    };
  }
  const candidate = value as DesktopLocalEnvironmentStateCatalogFile;
  const recordKind = compact(candidate.record_kind);
  if (recordKind !== '' && recordKind !== 'local_environment') {
    return {
      environment: null,
      didCanonicalizeProviderIdentity: false,
    };
  }

  let didCanonicalizeProviderIdentity = false;
  const currentProviderBinding = (() => {
    const bindingSource = candidate.current_provider_binding && typeof candidate.current_provider_binding === 'object'
      ? candidate.current_provider_binding
      : null;
    if (!bindingSource) {
      return null;
    }
    const normalizedProviderIdentity = normalizeProviderIdentityForOrigin(
      compact(bindingSource.provider_origin),
      bindingSource.provider_id,
      canonicalProviderIDsByOrigin,
    );
    didCanonicalizeProviderIdentity ||= normalizedProviderIdentity.didCanonicalize;
    try {
      return createDesktopLocalProviderBinding(
        compact(bindingSource.provider_origin),
        compact(bindingSource.env_public_id),
        {
          providerID: normalizedProviderIdentity.providerID,
          remoteWebSupported: bindingSource.remote_web_supported !== false,
          remoteDesktopSupported: bindingSource.remote_desktop_supported !== false,
        },
      );
    } catch {
      return null;
    }
  })();

  const localHostingSource = candidate.local_hosting && typeof candidate.local_hosting === 'object'
    ? candidate.local_hosting
    : null;
  const localHosting = (() => {
    const password = compact(localUIPassword);
    const passwordConfigured = localHostingSource?.access?.local_ui_password_configured === true || password !== '';
    const access = normalizeLocalEnvironmentAccess(
      localHostingSource?.access?.local_ui_bind ?? DEFAULT_DESKTOP_LOCAL_UI_BIND,
      password,
      passwordConfigured,
    );
    const owner = localHostingSource?.owner === 'desktop' || localHostingSource?.owner === 'agent'
      ? localHostingSource.owner
      : 'unknown';
    try {
      const scope = localHostingSource?.scope;
      if (scope && typeof scope === 'object' && scope.kind !== 'local_environment') {
        return null;
      }
      return createDesktopLocalEnvironmentHosting(
        { kind: 'local_environment', name: 'local' },
        {
          access,
          owner,
          stateDir: compact(localHostingSource?.state_dir)
            || localEnvironmentStateLayout(process.env, os.homedir, stateRootOverride).stateDir,
        },
      );
    } catch {
      return null;
    }
  })();

  if (!localHosting) {
    return {
      environment: null,
      didCanonicalizeProviderIdentity,
    };
  }

  try {
    return {
      environment: createDesktopLocalEnvironmentState('local', {
        label: defaultDesktopLocalEnvironmentLabel('local'),
        pinned: normalizePinned(candidate.pinned),
        preferredOpenRoute: normalizePreferredOpenRoute(candidate.preferred_open_route),
        currentProviderBinding: currentProviderBinding ?? undefined,
        access: localHosting.access,
        owner: localHosting.owner,
        stateDir: localHosting.state_dir,
        currentRuntime: localHosting.current_runtime,
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

function normalizeLocalEnvironmentFromCatalog(
  canonicalValue: unknown,
  secretsFile: DesktopSecretsFile | null,
  codec: DesktopSecretCodec,
  canonicalProviderIDsByOrigin: ReadonlyMap<string, string>,
  stateRootOverride?: string,
): LocalEnvironmentCatalogResult {
  let didCanonicalizeProviderIdentity = false;
  const canonicalPassword = decodeOptionalSecret(codec, secretsFile?.local_environment?.local_ui_password)
    || '';
  const canonicalResult = normalizeLocalEnvironmentCatalogCandidate(
    canonicalValue,
    canonicalPassword,
    canonicalProviderIDsByOrigin,
    stateRootOverride,
  );
  didCanonicalizeProviderIdentity ||= canonicalResult.didCanonicalizeProviderIdentity;
  if (canonicalResult.environment) {
    return {
      environment: normalizeLocalEnvironmentState(canonicalResult.environment, stateRootOverride),
      didCanonicalizeProviderIdentity,
    };
  }
  return {
    environment: normalizeLocalEnvironmentState(null, stateRootOverride),
    didCanonicalizeProviderIdentity,
  };
}

function serializeLocalEnvironmentCatalog(environment: DesktopLocalEnvironmentState): DesktopLocalEnvironmentStateCatalogFile {
  const access = localEnvironmentAccess(environment);
  return {
    schema_version: 1,
    record_kind: 'local_environment',
    id: environment.id,
    label: defaultDesktopLocalEnvironmentLabel('local'),
    pinned: environment.pinned,
    created_at_ms: environment.created_at_ms,
    updated_at_ms: environment.updated_at_ms,
    last_used_at_ms: environment.last_used_at_ms,
    preferred_open_route: environment.preferred_open_route,
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
    ...(environment.current_provider_binding
      ? {
          current_provider_binding: {
            provider_origin: environment.current_provider_binding.provider_origin,
            provider_id: environment.current_provider_binding.provider_id,
            env_public_id: environment.current_provider_binding.env_public_id,
            remote_web_supported: environment.current_provider_binding.remote_web_supported,
            remote_desktop_supported: environment.current_provider_binding.remote_desktop_supported,
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
  };
}

export async function loadDesktopPreferences(paths: DesktopPreferencesPaths, codec: DesktopSecretCodec): Promise<DesktopPreferences> {
  const secretsFile = await readJSONFile<DesktopSecretsFile>(paths.secretsFile);
  const catalogPaths = defaultDesktopCatalogPaths(paths.stateRoot);
  const catalogLocalEnvironment = await readJSONFile(catalogPaths.localEnvironmentFile);
  const catalogConnections = await readJSONDirectory(catalogPaths.connectionsDir);
  const catalogProviders = await readJSONDirectory(catalogPaths.providersDir);
  const catalogProviderEnvironments = await readJSONDirectory(catalogPaths.providerEnvironmentsDir);
  const controlPlaneRefreshTokensByKey = decodeDesktopControlPlaneRefreshTokens(codec, secretsFile?.control_planes);

  const hasCurrentCatalogData = (
    catalogLocalEnvironment != null
    || catalogConnections.length > 0
    || catalogProviders.length > 0
    || catalogProviderEnvironments.length > 0
  );
  const savedEnvironments = normalizeSavedEnvironments(
    catalogConnections.filter((value) => (
      !!value && typeof value === 'object' && compact((value as DesktopConnectionCatalogFile).kind) === 'url'
    )),
  );
  const savedSSHEnvironmentResult = collectSavedSSHEnvironmentNormalizationResult(
    catalogConnections.filter((value) => (
      !!value && typeof value === 'object' && compact((value as DesktopConnectionCatalogFile).kind) === 'ssh'
    )),
  );
  const savedSSHEnvironments = savedSSHEnvironmentResult.environments;
  const controlPlanes = normalizeSavedControlPlanes(catalogProviders, controlPlaneRefreshTokensByKey);
  const canonicalProviderIDsByOrigin = buildCanonicalProviderIDByOrigin(controlPlanes);
  const localEnvironmentCatalogResult = normalizeLocalEnvironmentFromCatalog(
    catalogLocalEnvironment,
    secretsFile,
    codec,
    canonicalProviderIDsByOrigin,
    paths.stateRoot,
  );
  const providerEnvironmentCatalogResult = normalizeProviderEnvironmentsFromCatalog(
    catalogProviderEnvironments,
    canonicalProviderIDsByOrigin,
  );
  const providerEnvironments = reconcileProviderEnvironments({
    stored: providerEnvironmentCatalogResult.environments,
    controlPlanes,
  });

  const nextPreferences: DesktopPreferences = {
    local_environment: localEnvironmentCatalogResult.environment,
    provider_environments: providerEnvironments,
    saved_environments: savedEnvironments,
    saved_ssh_environments: savedSSHEnvironments,
    recent_external_local_ui_urls: deriveRecentExternalLocalUIURLs(savedEnvironments),
    control_plane_refresh_tokens: Object.fromEntries(controlPlaneRefreshTokensByKey),
    control_planes: controlPlanes,
  };
  if (
    !hasCurrentCatalogData
    || catalogLocalEnvironment == null
    || localEnvironmentCatalogResult.didCanonicalizeProviderIdentity
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
  const localEnvironment = normalizeLocalEnvironmentState(preferences.local_environment, paths.stateRoot);
  const providerEnvironments = normalizeProviderEnvironmentCollection(preferences.provider_environments);
  const savedEnvironments = normalizeSavedEnvironments(preferences.saved_environments);
  const savedSSHEnvironments = normalizeSavedSSHEnvironments(preferences.saved_ssh_environments);
  const controlPlanes = sortSavedControlPlanes(preferences.control_planes);
  const preferencesFile: DesktopPreferencesFile = {
    version: 13,
  };
  const secretsFile: DesktopSecretsFile = {
    version: 3,
    local_environment: (() => {
      const access = localEnvironmentAccess(localEnvironment);
      if (!access.local_ui_password_configured) {
        return undefined;
      }
      const existingSecret = existingSecretsFile?.local_environment;
      return {
        environment_id: LOCAL_ENVIRONMENT_ID,
        local_ui_password: compact(access.local_ui_password) !== ''
          ? codec.encodeSecret(access.local_ui_password)
          : existingSecret?.local_ui_password,
      };
    })(),
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

  await fs.mkdir(catalogPaths.catalogRoot, { recursive: true });
  await fs.writeFile(
    catalogPaths.localEnvironmentFile,
    `${JSON.stringify(serializeLocalEnvironmentCatalog(localEnvironment), null, 2)}\n`,
    { mode: 0o600 },
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
  await fs.mkdir(path.dirname(paths.preferencesFile), { recursive: true });
  await fs.mkdir(path.dirname(paths.secretsFile), { recursive: true });
  await fs.writeFile(paths.preferencesFile, `${JSON.stringify(preferencesFile, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(paths.secretsFile, `${JSON.stringify(secretsFile, null, 2)}\n`, { mode: 0o600 });
}
