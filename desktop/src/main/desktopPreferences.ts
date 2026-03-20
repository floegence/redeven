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

export type DesktopTargetKind = 'managed_local' | 'external_local_ui';

export type DesktopTargetPreferences = Readonly<{
  kind: DesktopTargetKind;
  external_local_ui_url: string;
}>;

export type DesktopPreferences = Readonly<{
  target: DesktopTargetPreferences;
  local_ui_bind: string;
  local_ui_password: string;
  pending_bootstrap: PendingBootstrap | null;
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
  target?: Readonly<{
    kind?: string;
    external_local_ui_url?: string;
  }>;
  local_ui_bind?: string;
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
    target: {
      kind: 'managed_local',
      external_local_ui_url: '',
    },
    local_ui_bind: DEFAULT_DESKTOP_LOCAL_UI_BIND,
    local_ui_password: '',
    pending_bootstrap: null,
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
    target_kind: preferences.target.kind,
    external_local_ui_url: preferences.target.external_local_ui_url,
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

function normalizeTargetKind(raw: unknown): DesktopTargetKind {
  return compact(raw) === 'external_local_ui' ? 'external_local_ui' : 'managed_local';
}

export function activeDesktopTargetKey(preferences: DesktopPreferences): string {
  if (preferences.target.kind === 'external_local_ui') {
    return `external_local_ui:${preferences.target.external_local_ui_url}`;
  }
  return 'managed_local';
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
  const targetKind = normalizeTargetKind(draft.target_kind);
  const externalTargetInput = compact(draft.external_local_ui_url);
  let externalLocalUIURL = '';
  if (externalTargetInput !== '') {
    try {
      externalLocalUIURL = normalizeLocalUIBaseURL(externalTargetInput);
    } catch (error) {
      if (targetKind === 'external_local_ui') {
        throw error;
      }
      externalLocalUIURL = '';
    }
  }
  if (targetKind === 'external_local_ui' && externalLocalUIURL === '') {
    throw new Error('Redeven URL is required when Desktop Target is External Redeven.');
  }

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
    target: {
      kind: targetKind,
      external_local_ui_url: externalLocalUIURL,
    },
    local_ui_bind: localUIBind,
    local_ui_password: localUIPassword,
    pending_bootstrap: pendingBootstrap,
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
    if (nodeError?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function loadDesktopPreferences(paths: DesktopPreferencesPaths, codec: DesktopSecretCodec): Promise<DesktopPreferences> {
  const preferencesFile = await readJSONFile<DesktopPreferencesFile>(paths.preferencesFile);
  const secretsFile = await readJSONFile<DesktopSecretsFile>(paths.secretsFile);

  const targetKind = normalizeTargetKind(preferencesFile?.target?.kind);
  const externalLocalUIURL = compact(preferencesFile?.target?.external_local_ui_url);
  const localUIBind = compact(preferencesFile?.local_ui_bind) || DEFAULT_DESKTOP_LOCAL_UI_BIND;
  const localUIPassword = secretsFile?.local_ui_password ? codec.decodeSecret(secretsFile.local_ui_password) : '';
  const controlplaneURL = compact(preferencesFile?.pending_bootstrap?.controlplane_url);
  const envID = compact(preferencesFile?.pending_bootstrap?.env_id);
  const envToken = secretsFile?.pending_bootstrap?.env_token ? codec.decodeSecret(secretsFile.pending_bootstrap.env_token) : '';

  return validateDesktopSettingsDraft({
    target_kind: targetKind,
    external_local_ui_url: externalLocalUIURL,
    local_ui_bind: localUIBind,
    local_ui_password: localUIPassword,
    controlplane_url: controlplaneURL,
    env_id: envID,
    env_token: envToken,
  });
}

export async function saveDesktopPreferences(
  paths: DesktopPreferencesPaths,
  preferences: DesktopPreferences,
  codec: DesktopSecretCodec,
): Promise<void> {
  const nextPreferences = validateDesktopSettingsDraft(desktopPreferencesToDraft(preferences));
  const preferencesFile: DesktopPreferencesFile = {
    version: 1,
    target: {
      kind: nextPreferences.target.kind,
      external_local_ui_url: nextPreferences.target.external_local_ui_url || undefined,
    },
    local_ui_bind: nextPreferences.local_ui_bind,
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
