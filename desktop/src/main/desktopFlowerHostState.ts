import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  type DesktopFlowerHostConfig,
  type DesktopFlowerHostProvider,
  type DesktopFlowerHostProviderDraft,
  type DesktopFlowerHostProviderModel,
  type DesktopFlowerHostProviderSecretState,
  type DesktopFlowerHostProviderType,
  type DesktopFlowerHostSettingsDraft,
  type DesktopFlowerHostSettingsSnapshot,
  type DesktopFlowerHostTargetCache,
  type DesktopFlowerHostTargetCacheEntry,
  type DesktopFlowerHostTerminalExecPolicy,
  normalizeDesktopFlowerHostSecretMode,
} from '../shared/flowerHostSettingsIPC';
import { flowerHostStateLayout } from './statePaths';

type StoredSecret = Readonly<{
  encoding: string;
  data: string;
}>;

type DesktopFlowerHostSecretsFile = Readonly<{
  version?: number;
  providers?: readonly Readonly<{
    provider_id?: unknown;
    provider_api_key?: StoredSecret;
    web_search_api_key?: StoredSecret;
  }>[];
}>;

export type DesktopFlowerHostSecretCodec = Readonly<{
  encodeSecret: (value: string) => StoredSecret;
  decodeSecret: (value: StoredSecret) => string;
}>;

export type FlowerHostSafeStorageLike = Readonly<{
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
}>;

export type DesktopFlowerHostPaths = Readonly<{
  stateRoot: string;
  stateDir: string;
  configPath: string;
  secretsFile: string;
  targetCacheFile: string;
}>;

export type DesktopFlowerHostSecretPersistence = Readonly<{
  config: DesktopFlowerHostConfig;
  commitSecrets: () => Promise<void>;
}>;

const PROVIDER_TYPES = new Set<DesktopFlowerHostProviderType>([
  'openai',
  'anthropic',
  'moonshot',
  'chatglm',
  'deepseek',
  'qwen',
  'openai_compatible',
]);

const DEFAULT_TERMINAL_EXEC_POLICY: DesktopFlowerHostTerminalExecPolicy = {
  default_timeout_ms: 120_000,
  max_timeout_ms: 600_000,
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.round(parsed);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function modelID(providerID: string, modelName: string): string {
  return `${providerID}/${modelName}`;
}

function providerTypeRequiresBaseURL(type: DesktopFlowerHostProviderType): boolean {
  return type === 'moonshot'
    || type === 'chatglm'
    || type === 'deepseek'
    || type === 'qwen'
    || type === 'openai_compatible';
}

function normalizeProviderType(value: unknown): DesktopFlowerHostProviderType {
  const type = compact(value) as DesktopFlowerHostProviderType;
  if (!PROVIDER_TYPES.has(type)) {
    throw new Error(`Invalid Flower provider type: ${type || '(empty)'}.`);
  }
  return type;
}

function validateBaseURL(providerID: string, type: DesktopFlowerHostProviderType, rawBaseURL: unknown): string {
  const baseURL = compact(rawBaseURL);
  if (!baseURL) {
    if (providerTypeRequiresBaseURL(type)) {
      throw new Error(`Flower provider "${providerID}" requires base_url.`);
    }
    return '';
  }
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new Error(`Flower provider "${providerID}" has invalid base_url.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Flower provider "${providerID}" base_url must be http/https.`);
  }
  return baseURL;
}

function normalizeInputModalities(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const modalities = [...new Set(value.map((entry) => compact(entry)).filter(Boolean))];
  return modalities.length > 0 ? modalities : undefined;
}

function normalizeProviderModel(
  providerID: string,
  type: DesktopFlowerHostProviderType,
  value: unknown,
): DesktopFlowerHostProviderModel {
  if (!value || typeof value !== 'object') {
    throw new Error(`Flower provider "${providerID}" has an invalid model.`);
  }
  const candidate = value as Partial<DesktopFlowerHostProviderModel>;
  const modelName = compact(candidate.model_name);
  if (!modelName) {
    throw new Error(`Flower provider "${providerID}" has a model with missing model_name.`);
  }
  if (modelName.includes('/')) {
    throw new Error(`Flower provider "${providerID}" model_name must not contain "/".`);
  }
  const contextWindow = positiveInteger(candidate.context_window);
  if (type === 'openai_compatible' && contextWindow == null) {
    throw new Error(`Flower provider "${providerID}" model "${modelName}" requires context_window.`);
  }
  return {
    model_name: modelName,
    ...(contextWindow == null ? {} : { context_window: contextWindow }),
    ...(positiveInteger(candidate.max_output_tokens) == null ? {} : { max_output_tokens: positiveInteger(candidate.max_output_tokens) }),
    ...(positiveInteger(candidate.effective_context_window_percent) == null ? {} : { effective_context_window_percent: positiveInteger(candidate.effective_context_window_percent) }),
    ...(normalizeInputModalities(candidate.input_modalities) == null ? {} : { input_modalities: normalizeInputModalities(candidate.input_modalities) }),
  };
}

function normalizeProvider(value: unknown): DesktopFlowerHostProvider {
  if (!value || typeof value !== 'object') {
    throw new Error('Flower provider is invalid.');
  }
  const candidate = value as Partial<DesktopFlowerHostProvider>;
  const id = compact(candidate.id);
  if (!id) {
    throw new Error('Flower provider id is required.');
  }
  if (id.includes('/')) {
    throw new Error(`Flower provider "${id}" id must not contain "/".`);
  }
  const type = normalizeProviderType(candidate.type);
  const baseURL = validateBaseURL(id, type, candidate.base_url);
  const models = (Array.isArray(candidate.models) ? candidate.models : [])
    .map((model) => normalizeProviderModel(id, type, model));
  if (models.length <= 0) {
    throw new Error(`Flower provider "${id}" is missing models.`);
  }
  const modelNames = new Set<string>();
  for (const model of models) {
    if (modelNames.has(model.model_name)) {
      throw new Error(`Flower provider "${id}" has duplicate model_name: ${model.model_name}.`);
    }
    modelNames.add(model.model_name);
  }
  return {
    id,
    ...(compact(candidate.name) ? { name: compact(candidate.name) } : {}),
    type,
    ...(baseURL ? { base_url: baseURL } : {}),
    ...(candidate.web_search && typeof candidate.web_search === 'object'
      ? {
          web_search: {
            mode: candidate.web_search.mode === 'openai_builtin' || candidate.web_search.mode === 'brave'
              ? candidate.web_search.mode
              : 'disabled',
          },
        }
      : {}),
    models,
  };
}

function defaultFlowerHostConfig(): DesktopFlowerHostConfig {
  return {
    schema_version: 1,
    enabled: false,
    current_model_id: '',
    execution_policy: {
      require_user_approval: true,
      block_dangerous_commands: true,
    },
    terminal_exec_policy: DEFAULT_TERMINAL_EXEC_POLICY,
    providers: [],
  };
}

export function validateDesktopFlowerHostConfig(value: unknown): DesktopFlowerHostConfig {
  if (!value || typeof value !== 'object') {
    return defaultFlowerHostConfig();
  }
  const candidate = value as Partial<DesktopFlowerHostConfig>;
  const providers = (Array.isArray(candidate.providers) ? candidate.providers : [])
    .map((provider) => normalizeProvider(provider));
  const providerIDs = new Set<string>();
  const availableModelIDs = new Set<string>();
  for (const provider of providers) {
    if (providerIDs.has(provider.id)) {
      throw new Error(`Duplicate Flower provider id: ${provider.id}.`);
    }
    providerIDs.add(provider.id);
    for (const model of provider.models) {
      availableModelIDs.add(modelID(provider.id, model.model_name));
    }
  }
  const currentModelID = compact(candidate.current_model_id);
  const enabled = normalizeBoolean(candidate.enabled, providers.length > 0);
  if ((enabled || providers.length > 0) && !currentModelID) {
    throw new Error('Flower current_model_id is required when providers are configured.');
  }
  if (currentModelID && !availableModelIDs.has(currentModelID)) {
    throw new Error(`Flower current_model_id is not in providers[].models[]: ${currentModelID}.`);
  }
  return {
    schema_version: 1,
    enabled,
    current_model_id: currentModelID,
    execution_policy: {
      require_user_approval: normalizeBoolean(candidate.execution_policy?.require_user_approval, true),
      block_dangerous_commands: normalizeBoolean(candidate.execution_policy?.block_dangerous_commands, true),
    },
    terminal_exec_policy: {
      default_timeout_ms: positiveInteger(candidate.terminal_exec_policy?.default_timeout_ms)
        ?? DEFAULT_TERMINAL_EXEC_POLICY.default_timeout_ms,
      max_timeout_ms: positiveInteger(candidate.terminal_exec_policy?.max_timeout_ms)
        ?? DEFAULT_TERMINAL_EXEC_POLICY.max_timeout_ms,
    },
    providers,
  };
}

export function redactDesktopFlowerHostSettingsDraft(
  draft: DesktopFlowerHostSettingsDraft,
): DesktopFlowerHostSettingsDraft {
  return {
    config: {
      ...draft.config,
      providers: draft.config.providers.map((provider) => {
        const {
          provider_api_key: _providerAPIKey,
          web_search_api_key: _webSearchAPIKey,
          ...rest
        } = provider;
        return {
          ...rest,
          provider_api_key: '',
          web_search_api_key: '',
        };
      }),
    },
  };
}

export function createDesktopFlowerHostPlaintextSecretCodec(): DesktopFlowerHostSecretCodec {
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

export function createDesktopFlowerHostSafeStorageSecretCodec(
  safeStorage: FlowerHostSafeStorageLike | null | undefined,
): DesktopFlowerHostSecretCodec {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    return {
      encodeSecret: () => {
        throw new Error('Secure storage is unavailable; Flower provider secrets were not saved.');
      },
      decodeSecret: () => {
        throw new Error('Secure storage is unavailable; Flower provider secrets cannot be read.');
      },
    };
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

export function defaultDesktopFlowerHostPaths(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  stateRootOverride?: string,
): DesktopFlowerHostPaths {
  return flowerHostStateLayout(env, homedir, stateRootOverride);
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
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid Flower Host state file: ${filePath}. ${error.message}`);
    }
    throw error;
  }
}

async function writeJSONFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function configuredProviderSecretIDs(
  secrets: DesktopFlowerHostSecretsFile | null,
  key: 'provider_api_key' | 'web_search_api_key',
): Set<string> {
  const ids = new Set<string>();
  for (const entry of secrets?.providers ?? []) {
    const providerID = compact(entry.provider_id);
    if (providerID && entry[key]) {
      ids.add(providerID);
    }
  }
  return ids;
}

function providerSecretsByID(
  secrets: DesktopFlowerHostSecretsFile | null,
  key: 'provider_api_key' | 'web_search_api_key',
): Map<string, StoredSecret> {
  const out = new Map<string, StoredSecret>();
  for (const entry of secrets?.providers ?? []) {
    const providerID = compact(entry.provider_id);
    if (providerID && entry[key]) {
      out.set(providerID, entry[key]);
    }
  }
  return out;
}

export async function resolveDesktopFlowerHostSecret(
  paths: DesktopFlowerHostPaths,
  providerID: string,
  key: 'provider_api_key' | 'web_search_api_key',
  codec: DesktopFlowerHostSecretCodec,
): Promise<string> {
  const cleanProviderID = compact(providerID);
  if (!cleanProviderID) {
    throw new Error('Flower provider id is required.');
  }
  const secret = providerSecretsByID(await readJSONFile<DesktopFlowerHostSecretsFile>(paths.secretsFile), key)
    .get(cleanProviderID);
  if (!secret) {
    return '';
  }
  return compact(codec.decodeSecret(secret));
}

function normalizeTargetCacheEntry(value: unknown): DesktopFlowerHostTargetCacheEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DesktopFlowerHostTargetCacheEntry>;
  const targetID = compact(candidate.target_id);
  if (!targetID) {
    return null;
  }
  return {
    target_id: targetID,
    label: compact(candidate.label),
    target_url: compact(candidate.target_url),
    last_seen_at_unix_ms: positiveInteger(candidate.last_seen_at_unix_ms) ?? Date.now(),
    ...(candidate.metadata && typeof candidate.metadata === 'object' && !Array.isArray(candidate.metadata)
      ? { metadata: candidate.metadata }
      : {}),
  };
}

export function normalizeDesktopFlowerHostTargetCache(value: unknown): DesktopFlowerHostTargetCache {
  if (!value || typeof value !== 'object') {
    return { version: 1, entries: [] };
  }
  const candidate = value as Partial<DesktopFlowerHostTargetCache>;
  const entries = (Array.isArray(candidate.entries) ? candidate.entries : [])
    .map((entry) => normalizeTargetCacheEntry(entry))
    .filter((entry): entry is DesktopFlowerHostTargetCacheEntry => entry != null)
    .sort((left, right) => right.last_seen_at_unix_ms - left.last_seen_at_unix_ms || left.target_id.localeCompare(right.target_id));
  return {
    version: 1,
    entries,
  };
}

export async function loadDesktopFlowerHostTargetCache(
  paths: DesktopFlowerHostPaths,
): Promise<DesktopFlowerHostTargetCache> {
  return normalizeDesktopFlowerHostTargetCache(await readJSONFile(paths.targetCacheFile));
}

export async function saveDesktopFlowerHostTargetCache(
  paths: DesktopFlowerHostPaths,
  cache: DesktopFlowerHostTargetCache,
): Promise<void> {
  await writeJSONFile(paths.targetCacheFile, normalizeDesktopFlowerHostTargetCache(cache));
}

export async function loadDesktopFlowerHostSettings(
  paths: DesktopFlowerHostPaths,
): Promise<DesktopFlowerHostSettingsSnapshot> {
  const config = validateDesktopFlowerHostConfig(await readJSONFile(paths.configPath));
  const secrets = await readJSONFile<DesktopFlowerHostSecretsFile>(paths.secretsFile);
  const configuredSecretIDs = configuredProviderSecretIDs(secrets, 'provider_api_key');
  const configuredWebSearchSecretIDs = configuredProviderSecretIDs(secrets, 'web_search_api_key');
  return {
    config,
    provider_secrets: config.providers.map((provider): DesktopFlowerHostProviderSecretState => ({
      provider_id: provider.id,
      provider_api_key_configured: configuredSecretIDs.has(provider.id),
      web_search_api_key_configured: configuredWebSearchSecretIDs.has(provider.id),
    })),
    target_cache: await loadDesktopFlowerHostTargetCache(paths),
  };
}


function draftProviders(draft: DesktopFlowerHostSettingsDraft): readonly DesktopFlowerHostProviderDraft[] {
  return Array.isArray(draft.config?.providers) ? draft.config.providers : [];
}

export async function prepareDesktopFlowerHostSecretPersistence(
  paths: DesktopFlowerHostPaths,
  draft: DesktopFlowerHostSettingsDraft,
  codec: DesktopFlowerHostSecretCodec,
): Promise<DesktopFlowerHostSecretPersistence> {
  const config = validateDesktopFlowerHostConfig({
    ...draft.config,
    providers: draftProviders(draft),
  });
  const existingProviderSecrets = providerSecretsByID(await readJSONFile<DesktopFlowerHostSecretsFile>(paths.secretsFile), 'provider_api_key');
  const existingWebSearchSecrets = providerSecretsByID(await readJSONFile<DesktopFlowerHostSecretsFile>(paths.secretsFile), 'web_search_api_key');
  const draftByProviderID = new Map(draftProviders(draft).map((provider) => [compact(provider.id), provider] as const));
  const nextSecrets: DesktopFlowerHostSecretsFile = {
    version: 1,
    providers: config.providers
      .map((provider) => {
        const providerDraft = draftByProviderID.get(provider.id);
        const providerMode = normalizeDesktopFlowerHostSecretMode(
          providerDraft?.provider_api_key_mode,
          existingProviderSecrets.has(provider.id) ? 'keep' : 'replace',
        );
        const webSearchMode = normalizeDesktopFlowerHostSecretMode(
          providerDraft?.web_search_api_key_mode,
          existingWebSearchSecrets.has(provider.id) ? 'keep' : 'replace',
        );
        const entry: {
          provider_id: string;
          provider_api_key?: StoredSecret;
          web_search_api_key?: StoredSecret;
        } = { provider_id: provider.id };

        if (providerMode === 'replace') {
          const typedSecret = compact(providerDraft?.provider_api_key);
          if (typedSecret) {
            entry.provider_api_key = codec.encodeSecret(typedSecret);
          }
        } else if (providerMode === 'keep') {
          const existing = existingProviderSecrets.get(provider.id);
          if (existing) {
            entry.provider_api_key = existing;
          }
        }

        if (webSearchMode === 'replace') {
          const typedSecret = compact(providerDraft?.web_search_api_key);
          if (typedSecret) {
            entry.web_search_api_key = codec.encodeSecret(typedSecret);
          }
        } else if (webSearchMode === 'keep') {
          const existing = existingWebSearchSecrets.get(provider.id);
          if (existing) {
            entry.web_search_api_key = existing;
          }
        }

        return entry.provider_api_key || entry.web_search_api_key ? entry : null;
      })
      .filter((entry): entry is {
        provider_id: string;
        provider_api_key?: StoredSecret;
        web_search_api_key?: StoredSecret;
      } => entry != null),
  };

  return {
    config,
    commitSecrets: async () => {
      await writeJSONFile(paths.secretsFile, nextSecrets);
      if (!(await readJSONFile(paths.targetCacheFile))) {
        await saveDesktopFlowerHostTargetCache(paths, { version: 1, entries: [] });
      }
    },
  };
}

export async function saveDesktopFlowerHostSettings(
  paths: DesktopFlowerHostPaths,
  draft: DesktopFlowerHostSettingsDraft,
  codec: DesktopFlowerHostSecretCodec,
): Promise<DesktopFlowerHostSettingsSnapshot> {
  const persistence = await prepareDesktopFlowerHostSecretPersistence(paths, draft, codec);
  await writeJSONFile(paths.configPath, persistence.config);
  await persistence.commitSecrets();
  return loadDesktopFlowerHostSettings(paths);
}
