import fs from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_DESKTOP_LOCAL_UI_BIND, isLoopbackOnlyBind, parseLocalUIBind } from './localUIBind';
import { normalizeLocalUIBaseURL } from './localUIURL';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';

export type PendingBootstrap = Readonly<{
  controlplane_url: string;
  env_id: string;
  env_token: string;
}>;

export type DesktopSavedEnvironment = Readonly<{
  id: string;
  label: string;
  local_ui_url: string;
  last_used_at_ms: number;
}>;

export type DesktopPreferences = Readonly<{
  local_ui_bind: string;
  local_ui_password: string;
  pending_bootstrap: PendingBootstrap | null;
  saved_environments: readonly DesktopSavedEnvironment[];
  recent_external_local_ui_urls: readonly string[];
}>;

export type DesktopPreferencesPaths = Readonly<{
  preferencesFile: string;
  secretsFile: string;
}>;

type StoredSecret = Readonly<{
  encoding: string;
  data: string;
}>;

type DesktopSavedEnvironmentFile = Readonly<{
  id?: unknown;
  label?: unknown;
  local_ui_url?: unknown;
  last_used_at_ms?: unknown;
}>;

type DesktopPreferencesFile = Readonly<{
  version?: number;
  local_ui_bind?: string;
  saved_environments?: readonly DesktopSavedEnvironmentFile[];
  recent_external_local_ui_urls?: readonly unknown[];
  pending_bootstrap?: Readonly<{
    controlplane_url?: string;
    env_id?: string;
  }>;
}>;

type DesktopSecretsFile = Readonly<{
  version?: number;
  local_ui_password?: StoredSecret;
  pending_bootstrap?: Readonly<{
    env_token?: StoredSecret;
  }>;
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

export type UpsertDesktopSavedEnvironmentInput = Readonly<{
  environment_id: string;
  label: string;
  local_ui_url: string;
  last_used_at_ms?: number;
}>;

const MAX_RECENT_EXTERNAL_LOCAL_UI_URLS = 5;
const MAX_SAVED_ENVIRONMENTS = 20;

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
    local_ui_bind: DEFAULT_DESKTOP_LOCAL_UI_BIND,
    local_ui_password: '',
    pending_bootstrap: null,
    saved_environments: [],
    recent_external_local_ui_urls: [],
  };
}

export function defaultDesktopPreferencesPaths(userDataDir: string): DesktopPreferencesPaths {
  return {
    preferencesFile: path.join(userDataDir, 'desktop-preferences.json'),
    secretsFile: path.join(userDataDir, 'desktop-secrets.json'),
  };
}

export function desktopPreferencesToDraft(preferences: DesktopPreferences): DesktopSettingsDraft {
  return {
    local_ui_bind: preferences.local_ui_bind,
    local_ui_password: preferences.local_ui_password,
    controlplane_url: preferences.pending_bootstrap?.controlplane_url ?? '',
    env_id: preferences.pending_bootstrap?.env_id ?? '',
    env_token: preferences.pending_bootstrap?.env_token ?? '',
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
    right.last_used_at_ms - left.last_used_at_ms
    || left.label.localeCompare(right.label)
    || left.local_ui_url.localeCompare(right.local_ui_url)
  ));
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
    last_used_at_ms: normalizeLastUsedAtMS(candidate.last_used_at_ms, fallbackLastUsedAtMS),
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

export function deriveRecentExternalLocalUIURLs(
  savedEnvironments: readonly DesktopSavedEnvironment[],
): readonly string[] {
  return normalizeRecentExternalLocalUIURLs(
    sortSavedEnvironmentsByLastUsed(savedEnvironments).map((environment) => environment.local_ui_url),
  );
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
  const nextEnvironment: DesktopSavedEnvironment = {
    id: environmentID,
    label,
    local_ui_url: normalizedURL,
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

export function rememberRecentExternalLocalUITarget(
  preferences: DesktopPreferences,
  rawURL: string,
): DesktopPreferences {
  return upsertSavedEnvironment(preferences, {
    environment_id: desktopEnvironmentID(rawURL),
    label: '',
    local_ui_url: rawURL,
    last_used_at_ms: Date.now(),
  });
}

export function managedDesktopLaunchKey(preferences: DesktopPreferences): string {
  const pendingBootstrap = preferences.pending_bootstrap;
  return JSON.stringify({
    local_ui_bind: preferences.local_ui_bind,
    local_ui_password: preferences.local_ui_password,
    controlplane_url: pendingBootstrap?.controlplane_url ?? '',
    env_id: pendingBootstrap?.env_id ?? '',
    env_token: pendingBootstrap?.env_token ?? '',
  });
}

function normalizeControlplaneURL(raw: string): string {
  const clean = compact(raw);
  if (!clean) {
    return '';
  }
  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error('Control plane URL must be a valid absolute URL.');
  }
  if (!parsed.protocol || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error('Control plane URL must start with http:// or https://.');
  }
  return parsed.toString().replace(/\/$/u, '');
}

export function validateDesktopSettingsDraft(draft: DesktopSettingsDraft): DesktopPreferences {
  const localUIBind = compact(draft.local_ui_bind);
  if (!localUIBind) {
    throw new Error('Local UI bind address is required.');
  }

  const bind = parseLocalUIBind(localUIBind);
  const localUIPassword = String(draft.local_ui_password ?? '');
  if (!isLoopbackOnlyBind(bind) && compact(localUIPassword) === '') {
    throw new Error('Non-loopback Local UI binds require a Local UI password.');
  }

  const controlplaneURL = compact(draft.controlplane_url);
  const envID = compact(draft.env_id);
  const envToken = String(draft.env_token ?? '');
  const hasBootstrap = controlplaneURL !== '' || envID !== '' || compact(envToken) !== '';

  let pendingBootstrap: PendingBootstrap | null = null;
  if (hasBootstrap) {
    if (controlplaneURL === '') {
      throw new Error('Control plane URL is required when bootstrap settings are provided.');
    }
    if (envID === '') {
      throw new Error('Environment ID is required when bootstrap settings are provided.');
    }
    if (compact(envToken) === '') {
      throw new Error('Environment token is required when bootstrap settings are provided.');
    }
    pendingBootstrap = {
      controlplane_url: normalizeControlplaneURL(controlplaneURL),
      env_id: envID,
      env_token: compact(envToken),
    };
  }

  return {
    local_ui_bind: localUIBind,
    local_ui_password: localUIPassword,
    pending_bootstrap: pendingBootstrap,
    saved_environments: [],
    recent_external_local_ui_urls: [],
  };
}

export function clearPendingBootstrap(preferences: DesktopPreferences): DesktopPreferences {
  return {
    ...preferences,
    pending_bootstrap: null,
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

function recoverPendingBootstrap(
  controlplaneURLRaw: unknown,
  envIDRaw: unknown,
  envTokenRaw: unknown,
): PendingBootstrap | null {
  const controlplaneURL = compact(controlplaneURLRaw);
  const envID = compact(envIDRaw);
  const envToken = compact(envTokenRaw);
  if (controlplaneURL === '' && envID === '' && envToken === '') {
    return null;
  }
  if (controlplaneURL === '' || envID === '' || envToken === '') {
    return null;
  }
  try {
    return {
      controlplane_url: normalizeControlplaneURL(controlplaneURL),
      env_id: envID,
      env_token: envToken,
    };
  } catch {
    return null;
  }
}

function recoverDesktopPreferencesDraft(draft: Partial<DesktopSettingsDraft>): DesktopSettingsDraft {
  let localUIBind = recoverLocalUIBind(draft.local_ui_bind);
  const localUIPassword = String(draft.local_ui_password ?? '');
  try {
    const bind = parseLocalUIBind(localUIBind);
    if (!isLoopbackOnlyBind(bind) && compact(localUIPassword) === '') {
      localUIBind = DEFAULT_DESKTOP_LOCAL_UI_BIND;
    }
  } catch {
    localUIBind = DEFAULT_DESKTOP_LOCAL_UI_BIND;
  }

  const pendingBootstrap = recoverPendingBootstrap(draft.controlplane_url, draft.env_id, draft.env_token);

  return {
    local_ui_bind: localUIBind,
    local_ui_password: localUIPassword,
    controlplane_url: pendingBootstrap?.controlplane_url ?? '',
    env_id: pendingBootstrap?.env_id ?? '',
    env_token: pendingBootstrap?.env_token ?? '',
  };
}

export async function loadDesktopPreferences(paths: DesktopPreferencesPaths, codec: DesktopSecretCodec): Promise<DesktopPreferences> {
  const preferencesFile = await readJSONFile<DesktopPreferencesFile>(paths.preferencesFile);
  const secretsFile = await readJSONFile<DesktopSecretsFile>(paths.secretsFile);

  const recovered = validateDesktopSettingsDraft(recoverDesktopPreferencesDraft({
    local_ui_bind: preferencesFile?.local_ui_bind ?? DEFAULT_DESKTOP_LOCAL_UI_BIND,
    local_ui_password: decodeOptionalSecret(codec, secretsFile?.local_ui_password),
    controlplane_url: preferencesFile?.pending_bootstrap?.controlplane_url ?? '',
    env_id: preferencesFile?.pending_bootstrap?.env_id ?? '',
    env_token: decodeOptionalSecret(codec, secretsFile?.pending_bootstrap?.env_token),
  }));

  const savedEnvironments = normalizeSavedEnvironments(
    preferencesFile?.saved_environments,
    preferencesFile?.recent_external_local_ui_urls,
  );

  return {
    ...recovered,
    saved_environments: savedEnvironments,
    recent_external_local_ui_urls: deriveRecentExternalLocalUIURLs(savedEnvironments),
  };
}

export async function saveDesktopPreferences(
  paths: DesktopPreferencesPaths,
  preferences: DesktopPreferences,
  codec: DesktopSecretCodec,
): Promise<void> {
  const nextPreferences = validateDesktopSettingsDraft(desktopPreferencesToDraft(preferences));
  const savedEnvironments = normalizeSavedEnvironments(
    preferences.saved_environments,
    preferences.recent_external_local_ui_urls,
  );
  const recentExternalLocalUIURLs = deriveRecentExternalLocalUIURLs(savedEnvironments);

  const preferencesFile: DesktopPreferencesFile = {
    version: 2,
    local_ui_bind: nextPreferences.local_ui_bind,
    saved_environments: savedEnvironments.map((environment) => ({
      id: environment.id,
      label: environment.label,
      local_ui_url: environment.local_ui_url,
      last_used_at_ms: environment.last_used_at_ms,
    })),
    recent_external_local_ui_urls: recentExternalLocalUIURLs,
    pending_bootstrap: nextPreferences.pending_bootstrap
      ? {
          controlplane_url: nextPreferences.pending_bootstrap.controlplane_url,
          env_id: nextPreferences.pending_bootstrap.env_id,
        }
      : undefined,
  };
  const secretsFile: DesktopSecretsFile = {
    version: 1,
    local_ui_password: compact(nextPreferences.local_ui_password) !== ''
      ? codec.encodeSecret(nextPreferences.local_ui_password)
      : undefined,
    pending_bootstrap: nextPreferences.pending_bootstrap
      ? {
          env_token: codec.encodeSecret(nextPreferences.pending_bootstrap.env_token),
        }
      : undefined,
  };

  await fs.mkdir(path.dirname(paths.preferencesFile), { recursive: true });
  await fs.mkdir(path.dirname(paths.secretsFile), { recursive: true });
  await fs.writeFile(paths.preferencesFile, `${JSON.stringify(preferencesFile, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(paths.secretsFile, `${JSON.stringify(secretsFile, null, 2)}\n`, { mode: 0o600 });
}
