import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  type DesktopFlowerHostConfig,
  type DesktopFlowerHostProvider,
  type DesktopFlowerHostProviderDraft,
  type DesktopFlowerHostProviderModel,
  type DesktopFlowerHostProviderSecretState,
  type DesktopFlowerHostProviderType,
  type DesktopFlowerHostSendChatRequest,
  type DesktopFlowerHostSettingsDraft,
  type DesktopFlowerHostSettingsSnapshot,
  type DesktopFlowerHostTargetCache,
  type DesktopFlowerHostTargetCacheEntry,
  type DesktopFlowerHostTerminalExecPolicy,
  type DesktopFlowerHostThread,
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
  threadsFile: string;
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
        const { provider_api_key: _providerAPIKey, ...rest } = provider;
        return {
          ...rest,
          provider_api_key: '',
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

function configuredProviderSecretIDs(secrets: DesktopFlowerHostSecretsFile | null): Set<string> {
  const ids = new Set<string>();
  for (const entry of secrets?.providers ?? []) {
    const providerID = compact(entry.provider_id);
    if (providerID && entry.provider_api_key) {
      ids.add(providerID);
    }
  }
  return ids;
}

function providerSecretsByID(secrets: DesktopFlowerHostSecretsFile | null): Map<string, StoredSecret> {
  const out = new Map<string, StoredSecret>();
  for (const entry of secrets?.providers ?? []) {
    const providerID = compact(entry.provider_id);
    if (providerID && entry.provider_api_key) {
      out.set(providerID, entry.provider_api_key);
    }
  }
  return out;
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

function normalizeFlowerHostChatMessage(value: unknown): DesktopFlowerHostThread['messages'][number] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DesktopFlowerHostThread['messages'][number]>;
  const id = compact(candidate.id);
  const role = candidate.role === 'assistant' ? 'assistant' : candidate.role === 'user' ? 'user' : null;
  const content = compact(candidate.content);
  const createdAt = positiveInteger(candidate.created_at_ms) ?? Date.now();
  if (!id || !role || !content) {
    return null;
  }
  return {
    id,
    role,
    content,
    created_at_ms: createdAt,
  };
}

function normalizeFlowerHostThread(value: unknown): DesktopFlowerHostThread | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DesktopFlowerHostThread>;
  const threadID = compact(candidate.thread_id);
  const messages = (Array.isArray(candidate.messages) ? candidate.messages : [])
    .map((message) => normalizeFlowerHostChatMessage(message))
    .filter((message): message is DesktopFlowerHostThread['messages'][number] => message != null);
  if (!threadID || messages.length <= 0) {
    return null;
  }
  const updatedAt = positiveInteger(candidate.updated_at_ms)
    ?? messages.reduce((max, message) => Math.max(max, message.created_at_ms), 0);
  return {
    thread_id: threadID,
    title: compact(candidate.title) || messages[0]?.content.slice(0, 80) || 'Untitled conversation',
    model_id: compact(candidate.model_id),
    created_at_ms: positiveInteger(candidate.created_at_ms) ?? messages[0]?.created_at_ms ?? updatedAt,
    updated_at_ms: updatedAt,
    messages,
  };
}

function normalizeFlowerHostThreadsFile(value: unknown): { version: 1; threads: DesktopFlowerHostThread[] } {
  if (!value || typeof value !== 'object') {
    return { version: 1, threads: [] };
  }
  const candidate = value as { threads?: unknown };
  const threads = (Array.isArray(candidate.threads) ? candidate.threads : [])
    .map((thread) => normalizeFlowerHostThread(thread))
    .filter((thread): thread is DesktopFlowerHostThread => thread != null)
    .sort((left, right) => right.updated_at_ms - left.updated_at_ms || left.thread_id.localeCompare(right.thread_id));
  return { version: 1, threads };
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

export async function listDesktopFlowerHostThreads(
  paths: DesktopFlowerHostPaths,
): Promise<readonly DesktopFlowerHostThread[]> {
  return normalizeFlowerHostThreadsFile(await readJSONFile(paths.threadsFile)).threads;
}

async function saveDesktopFlowerHostThreads(
  paths: DesktopFlowerHostPaths,
  threads: readonly DesktopFlowerHostThread[],
): Promise<void> {
  await writeJSONFile(paths.threadsFile, normalizeFlowerHostThreadsFile({ threads }));
}

export async function loadDesktopFlowerHostSettings(
  paths: DesktopFlowerHostPaths,
): Promise<DesktopFlowerHostSettingsSnapshot> {
  const config = validateDesktopFlowerHostConfig(await readJSONFile(paths.configPath));
  const secrets = await readJSONFile<DesktopFlowerHostSecretsFile>(paths.secretsFile);
  const configuredSecretIDs = configuredProviderSecretIDs(secrets);
  return {
    config,
    provider_secrets: config.providers.map((provider): DesktopFlowerHostProviderSecretState => ({
      provider_id: provider.id,
      provider_api_key_configured: configuredSecretIDs.has(provider.id),
    })),
    target_cache: await loadDesktopFlowerHostTargetCache(paths),
  };
}

function defaultProviderBaseURL(type: DesktopFlowerHostProviderType): string {
  switch (type) {
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'openai':
    default:
      return 'https://api.openai.com/v1';
  }
}

function activeFlowerProvider(config: DesktopFlowerHostConfig): { provider: DesktopFlowerHostProvider; modelName: string } {
  const [providerID, ...modelParts] = compact(config.current_model_id).split('/');
  const modelName = modelParts.join('/');
  const provider = config.providers.find((candidate) => candidate.id === providerID);
  if (!provider || !modelName) {
    throw new Error('Configure a Flower provider and model before starting a chat.');
  }
  return { provider, modelName };
}

function extractOpenAICompatibleText(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const record = value as {
    output_text?: unknown;
    output?: readonly unknown[];
    choices?: readonly { message?: { content?: unknown } }[];
  };
  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text.trim();
  }
  const parts: string[] = [];
  for (const item of record.output ?? []) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const content = (item as { content?: readonly unknown[] }).content;
    for (const block of Array.isArray(content) ? content : []) {
      if (!block || typeof block !== 'object') {
        continue;
      }
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim()) {
        parts.push(text.trim());
      }
    }
  }
  if (parts.length > 0) {
    return parts.join('\n\n');
  }
  const choiceText = record.choices?.[0]?.message?.content;
  return typeof choiceText === 'string' ? choiceText.trim() : '';
}

async function requestOpenAICompatibleChat(args: {
  provider: DesktopFlowerHostProvider;
  modelName: string;
  apiKey: string;
  messages: readonly DesktopFlowerHostThread['messages'][number][];
}): Promise<string> {
  const baseURL = (args.provider.base_url || defaultProviderBaseURL(args.provider.type)).replace(/\/+$/, '');
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: args.modelName,
      messages: args.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    throw new Error(`Flower provider request failed with HTTP ${response.status}.`);
  }
  const text = extractOpenAICompatibleText(payload);
  if (!text) {
    throw new Error('Flower provider returned an empty response.');
  }
  return text;
}

async function requestAnthropicChat(args: {
  provider: DesktopFlowerHostProvider;
  modelName: string;
  apiKey: string;
  messages: readonly DesktopFlowerHostThread['messages'][number][];
}): Promise<string> {
  const baseURL = (args.provider.base_url || defaultProviderBaseURL(args.provider.type)).replace(/\/+$/, '');
  const response = await fetch(`${baseURL}/v1/messages`, {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': args.apiKey,
    },
    body: JSON.stringify({
      model: args.modelName,
      max_tokens: 4096,
      messages: args.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  });
  const payload = await response.json().catch(() => null) as { content?: readonly { text?: unknown }[] } | null;
  if (!response.ok) {
    throw new Error(`Flower provider request failed with HTTP ${response.status}.`);
  }
  const text = (payload?.content ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
    .trim();
  if (!text) {
    throw new Error('Flower provider returned an empty response.');
  }
  return text;
}

async function requestFlowerHostAssistantMessage(args: {
  provider: DesktopFlowerHostProvider;
  modelName: string;
  apiKey: string;
  messages: readonly DesktopFlowerHostThread['messages'][number][];
}): Promise<string> {
  if (args.provider.type === 'anthropic') {
    return requestAnthropicChat(args);
  }
  return requestOpenAICompatibleChat(args);
}

export async function sendDesktopFlowerHostChat(
  paths: DesktopFlowerHostPaths,
  request: DesktopFlowerHostSendChatRequest,
  codec: DesktopFlowerHostSecretCodec,
  now: () => number = () => Date.now(),
  idFactory: () => string = () => crypto.randomUUID(),
): Promise<DesktopFlowerHostThread> {
  const prompt = compact(request.prompt);
  if (!prompt) {
    throw new Error('Flower prompt is required.');
  }
  const snapshot = await loadDesktopFlowerHostSettings(paths);
  const { provider, modelName } = activeFlowerProvider(snapshot.config);
  const secret = providerSecretsByID(await readJSONFile<DesktopFlowerHostSecretsFile>(paths.secretsFile)).get(provider.id);
  if (!secret) {
    throw new Error(`Flower provider "${provider.id}" is missing an API key.`);
  }
  const apiKey = codec.decodeSecret(secret);
  const threads = [...await listDesktopFlowerHostThreads(paths)];
  const threadID = compact(request.thread_id) || `flower_thread_${idFactory()}`;
  const existingIndex = threads.findIndex((thread) => thread.thread_id === threadID);
  const existing = existingIndex >= 0 ? threads[existingIndex] : null;
  const userMessage = {
    id: `msg_${idFactory()}`,
    role: 'user' as const,
    content: prompt,
    created_at_ms: now(),
  };
  const baseMessages = [...existing?.messages ?? [], userMessage];
  const assistantText = await requestFlowerHostAssistantMessage({
    provider,
    modelName,
    apiKey,
    messages: baseMessages,
  });
  const assistantMessage = {
    id: `msg_${idFactory()}`,
    role: 'assistant' as const,
    content: assistantText,
    created_at_ms: now(),
  };
  const nextThread: DesktopFlowerHostThread = {
    thread_id: threadID,
    title: existing?.title || prompt.slice(0, 80),
    model_id: snapshot.config.current_model_id,
    created_at_ms: existing?.created_at_ms ?? userMessage.created_at_ms,
    updated_at_ms: assistantMessage.created_at_ms,
    messages: [...baseMessages, assistantMessage],
  };
  if (existingIndex >= 0) {
    threads[existingIndex] = nextThread;
  } else {
    threads.unshift(nextThread);
  }
  await saveDesktopFlowerHostThreads(paths, threads);
  return nextThread;
}

function draftProviders(draft: DesktopFlowerHostSettingsDraft): readonly DesktopFlowerHostProviderDraft[] {
  return Array.isArray(draft.config?.providers) ? draft.config.providers : [];
}

export async function saveDesktopFlowerHostSettings(
  paths: DesktopFlowerHostPaths,
  draft: DesktopFlowerHostSettingsDraft,
  codec: DesktopFlowerHostSecretCodec,
): Promise<DesktopFlowerHostSettingsSnapshot> {
  const config = validateDesktopFlowerHostConfig({
    ...draft.config,
    providers: draftProviders(draft),
  });
  const existingSecrets = providerSecretsByID(await readJSONFile<DesktopFlowerHostSecretsFile>(paths.secretsFile));
  const draftByProviderID = new Map(draftProviders(draft).map((provider) => [compact(provider.id), provider] as const));
  const nextSecrets: DesktopFlowerHostSecretsFile = {
    version: 1,
    providers: config.providers
      .map((provider) => {
        const providerDraft = draftByProviderID.get(provider.id);
        const mode = normalizeDesktopFlowerHostSecretMode(
          providerDraft?.provider_api_key_mode,
          existingSecrets.has(provider.id) ? 'keep' : 'replace',
        );
        if (mode === 'clear') {
          return null;
        }
        if (mode === 'replace') {
          const typedSecret = compact(providerDraft?.provider_api_key);
          return typedSecret
            ? { provider_id: provider.id, provider_api_key: codec.encodeSecret(typedSecret) }
            : null;
        }
        const existing = existingSecrets.get(provider.id);
        return existing ? { provider_id: provider.id, provider_api_key: existing } : null;
      })
      .filter((entry): entry is { provider_id: string; provider_api_key: StoredSecret } => entry != null),
  };

  await writeJSONFile(paths.configPath, config);
  await writeJSONFile(paths.secretsFile, nextSecrets);
  if (!(await readJSONFile(paths.targetCacheFile))) {
    await saveDesktopFlowerHostTargetCache(paths, { version: 1, entries: [] });
  }
  return loadDesktopFlowerHostSettings(paths);
}
