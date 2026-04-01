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

export type DesktopPreferences = Readonly<{
  local_ui_bind: string;
  local_ui_password: string;
  pending_bootstrap: PendingBootstrap | null;
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

type DesktopPreferencesFile = Readonly<{
  version?: number;
  local_ui_bind?: string;
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

const MAX_RECENT_EXTERNAL_LOCAL_UI_URLS = 5;

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

export function rememberRecentExternalLocalUITarget(
  preferences: DesktopPreferences,
  rawURL: string,
): DesktopPreferences {
  const url = normalizeLocalUIBaseURL(rawURL);
  const recents = normalizeRecentExternalLocalUIURLs([
    url,
    ...preferences.recent_external_local_ui_urls,
  ]);
  return {
    ...preferences,
    recent_external_local_ui_urls: recents,
  };
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

  return {
    ...recovered,
    recent_external_local_ui_urls: normalizeRecentExternalLocalUIURLs(preferencesFile?.recent_external_local_ui_urls),
  };
}

export async function saveDesktopPreferences(
  paths: DesktopPreferencesPaths,
  preferences: DesktopPreferences,
  codec: DesktopSecretCodec,
): Promise<void> {
  const nextPreferences = validateDesktopSettingsDraft(desktopPreferencesToDraft(preferences));
  const preferencesFile: DesktopPreferencesFile = {
    version: 1,
    local_ui_bind: nextPreferences.local_ui_bind,
    recent_external_local_ui_urls: normalizeRecentExternalLocalUIURLs(preferences.recent_external_local_ui_urls),
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
