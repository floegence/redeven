import { spawn, type ChildProcessByStdio } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

import {
  type DesktopFlowerHostChatMessage,
  type DesktopFlowerHostChatMessageBlock,
  type DesktopFlowerHostActivityItem,
  type DesktopFlowerHostActivityTimelineBlock,
  type DesktopFlowerHostForkThreadRequest,
  type DesktopFlowerHostInputRequest,
  type DesktopFlowerHostMarkThreadReadRequest,
  type DesktopFlowerHostRenameThreadRequest,
  type DesktopFlowerHostSendChatRequest,
  type DesktopFlowerHostSetThreadPinnedRequest,
  type DesktopFlowerHostSettingsDraft,
  type DesktopFlowerHostSettingsSnapshot,
  type DesktopFlowerHostSubmitInputRequest,
  type DesktopFlowerHostTargetCache,
  type DesktopFlowerHostThread,
  type DesktopFlowerHostRouterDecision,
  type DesktopFlowerHostError,
  type DesktopFlowerHostPresence,
  type DesktopFlowerHostUnavailableHandler,
} from '../shared/flowerHostSettingsIPC';
import type {
  DesktopFlowerHostPaths,
  DesktopFlowerHostSecretCodec,
} from './desktopFlowerHostState';
import {
  prepareDesktopFlowerHostSecretPersistence,
  validateDesktopFlowerHostConfig,
} from './desktopFlowerHostState';
import { startFlowerHostSecretResolver } from './flowerHostSecretResolver';

type FlowerHostProcess = ChildProcessByStdio<null, Readable, Readable>;

type FlowerHostReadyStartupReport = Readonly<{
  status: 'ready';
  host_id: string;
  base_url: string;
  token: string;
  pid?: number;
  attached?: boolean;
}>;

type FlowerHostBlockedStartupReport = Readonly<{
  status: 'blocked';
  code: string;
  message: string;
}>;

type FlowerHostStartupReport = FlowerHostReadyStartupReport | FlowerHostBlockedStartupReport;

type FlowerHostClient = Readonly<{
  baseURL: string;
  token: string;
  child: FlowerHostProcess;
  pid?: number;
  attached: boolean;
  stop: () => Promise<void>;
}>;

type FlowerHostCarrierHealth = Readonly<{
  state: string;
  error?: string;
}>;

type FlowerHostStatusPayload = Readonly<{
  carrier?: FlowerHostCarrierHealth;
}>;

type DesktopFlowerHostInputQuestion = DesktopFlowerHostInputRequest['questions'][number];
type DesktopFlowerHostInputChoice = NonNullable<DesktopFlowerHostInputQuestion['choices']>[number];
type DesktopFlowerHostInputAction = NonNullable<DesktopFlowerHostInputChoice['actions']>[number];

type FlowerHostCreateFailure = Readonly<{
  error: DesktopFlowerHostError;
  fresh_decision?: DesktopFlowerHostRouterDecision | null;
}>;

type FlowerHostBridgeArgs = Readonly<{
  executablePath: string;
  paths: DesktopFlowerHostPaths;
  codec: DesktopFlowerHostSecretCodec;
  openTargetSession?: (request: DesktopFlowerHostTargetSessionRequest) => Promise<DesktopFlowerHostTargetSessionGrant>;
  tempRoot?: string;
  onLog?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}>;

export type DesktopFlowerHostTargetSessionRequest = Readonly<{
  target_id?: unknown;
  provider_origin?: unknown;
  provider_id?: unknown;
  env_public_id?: unknown;
  required_capabilities?: unknown;
  reason?: unknown;
}>;

export type DesktopFlowerHostTargetSessionGrant = Readonly<{
  target_id: string;
  provider_origin: string;
  env_public_id: string;
  grant_client: unknown;
  capabilities: Readonly<{
    can_read: boolean;
    can_write: boolean;
    can_execute: boolean;
  }>;
  expires_at_unix_ms: number;
}>;

const STARTUP_REPORT_POLL_MS = 100;
const FLOWER_HOST_STARTUP_TIMEOUT_MS = 10_000;
const FLOWER_HOST_REQUEST_TIMEOUT_MS = 15_000;
const ATTACHED_FLOWER_HOST_STOP_TIMEOUT_MS = 3_000;
const FLOWER_HOST_ENV_ALLOWLIST = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TMPDIR',
  'USER',
] as const;

let clientTask: Promise<FlowerHostClient> | null = null;
let activeClient: FlowerHostClient | null = null;

class StaleAttachedFlowerHostError extends Error {
  readonly pid: number;

  constructor(pid: number, message: string) {
    super(message);
    this.name = 'StaleAttachedFlowerHostError';
    this.pid = pid;
  }
}

class FlowerHostRequestError extends Error {
  readonly code: string;

  constructor(error: DesktopFlowerHostError) {
    super(error.message);
    this.name = 'FlowerHostRequestError';
    this.code = error.code;
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeFlowerHostErrorPayload(value: unknown, field: string): DesktopFlowerHostError {
  const record = requireBridgeObject(value, field);
  return {
    code: requireBridgeString(record.code, `${field}.code`),
    message: requireBridgeString(record.message, `${field}.message`),
  };
}

function normalizeStartupReport(raw: unknown): FlowerHostStartupReport | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const status = compact(record.status);
  if (status === 'blocked') {
    const code = compact(record.code);
    const message = compact(record.message);
    if (!code || !message) {
      return null;
    }
    return {
      status: 'blocked',
      code,
      message,
    };
  }
  if (status !== 'ready') {
    return null;
  }
  const hostID = compact(record.host_id);
  const baseURL = compact(record.base_url);
  const token = compact(record.token);
  if (!hostID || !baseURL || !token) {
    return null;
  }
  return {
    status: 'ready',
    host_id: hostID,
    base_url: baseURL,
    token,
    ...(Number.isInteger(Number(record.pid)) && Number(record.pid) > 0 ? { pid: Number(record.pid) } : {}),
    attached: Boolean(record.attached),
  };
}

function flowerHostChildEnv(secretResolverTokenEnv: string, secretResolverToken: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of FLOWER_HOST_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {
      env[key] = value;
    }
  }
  env[secretResolverTokenEnv] = secretResolverToken;
  return env;
}

async function readStartupReport(reportFile: string): Promise<FlowerHostStartupReport | null> {
  try {
    return normalizeStartupReport(JSON.parse(await fs.readFile(reportFile, 'utf8')));
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(child: FlowerHostProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode) {
    return;
  }
  child.kill('SIGTERM');
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (await Promise.race([exited, delay(3000).then(() => 'timeout' as const)]) === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

function flowerHostClientProcessIsAlive(client: FlowerHostClient): boolean {
  const child = client.child;
  return child.exitCode === null && !child.signalCode;
}

function createAttachedFlowerHostProcess(): FlowerHostProcess {
  return {
    exitCode: null,
    signalCode: null,
  } as FlowerHostProcess;
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

async function stopAttachedFlowerHostProcess(pid: number, timeoutMs = ATTACHED_FLOWER_HOST_STOP_TIMEOUT_MS): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0 || !processExists(pid)) {
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ESRCH') {
      return;
    }
    throw error;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) {
      return;
    }
    await delay(100);
  }
  if (!processExists(pid)) {
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ESRCH') {
      return;
    }
    throw error;
  }
  const forceDeadline = Date.now() + timeoutMs;
  while (Date.now() < forceDeadline) {
    if (!processExists(pid)) {
      return;
    }
    await delay(100);
  }
  if (processExists(pid)) {
    throw new Error(`Attached Flower Host process ${pid} is still running after stop.`);
  }
}

async function requestJSON<T>(client: FlowerHostClient, pathName: string, init: RequestInit = {}, timeoutMs = FLOWER_HOST_REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${client.baseURL}${pathName}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${client.token}`,
        'content-type': 'application/json',
      },
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: unknown } | null;
    if (!response.ok) {
      if (!payload || typeof payload !== 'object') {
        throw new Error(`Flower Host request failed with HTTP ${response.status}.`);
      }
      const error = normalizeFlowerHostErrorPayload(payload.error, 'error');
      throw new FlowerHostRequestError(error);
    }
    if (!payload?.ok) {
      throw new FlowerHostRequestError(normalizeFlowerHostErrorPayload(payload?.error, 'error'));
    }
    return payload.data as T;
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new Error('Flower Host did not respond in time. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function assertAttachedFlowerHostHealthy(client: FlowerHostClient): Promise<void> {
  const status = await requestJSON<FlowerHostStatusPayload>(client, '/v1/status', {}, 2000);
  const carrierState = compact(status?.carrier?.state);
  if (carrierState === 'ready') {
    return;
  }
  const pid = Number(client.pid ?? Number.NaN);
  const reason = carrierState
    ? `carrier state is ${carrierState}${compact(status?.carrier?.error) ? `: ${compact(status?.carrier?.error)}` : ''}`
    : 'carrier health is missing';
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Attached Flower Host is not reusable because ${reason}, and the startup report did not include a process pid.`);
  }
  throw new StaleAttachedFlowerHostError(pid, `Attached Flower Host is not reusable because ${reason}.`);
}

export async function ensureFlowerHostBridge(args: FlowerHostBridgeArgs): Promise<FlowerHostClient> {
  if (activeClient && !activeClient.attached && !flowerHostClientProcessIsAlive(activeClient)) {
    clientTask = null;
    activeClient = null;
  }
  if (activeClient?.attached) {
    try {
      await assertAttachedFlowerHostHealthy(activeClient);
      return activeClient;
    } catch (error) {
      const client = activeClient;
      clientTask = null;
      activeClient = null;
      await client.stop().catch(() => undefined);
      if (error instanceof StaleAttachedFlowerHostError) {
        await stopAttachedFlowerHostProcess(error.pid);
      }
    }
  }
  if (!clientTask) {
    clientTask = startFlowerHostBridgeWithStaleAttachedRecovery(args)
      .then((client) => {
        activeClient = client;
        return client;
      })
      .catch((error) => {
        clientTask = null;
        activeClient = null;
        throw error;
      });
  }
  return clientTask;
}

async function startFlowerHostBridgeWithStaleAttachedRecovery(args: FlowerHostBridgeArgs): Promise<FlowerHostClient> {
  try {
    return await startFlowerHostBridge(args);
  } catch (error) {
    if (!(error instanceof StaleAttachedFlowerHostError)) {
      throw error;
    }
    await stopAttachedFlowerHostProcess(error.pid);
    return startFlowerHostBridge(args);
  }
}

export async function shutdownFlowerHostBridge(): Promise<void> {
  const client = activeClient ?? await clientTask?.catch(() => null) ?? null;
  clientTask = null;
  activeClient = null;
  if (client) {
    await client.stop();
  }
}

async function startFlowerHostBridge(args: FlowerHostBridgeArgs): Promise<FlowerHostClient> {
  const secretResolver = await startFlowerHostSecretResolver(args.paths, args.codec, args.openTargetSession);
  const tempDir = await fs.mkdtemp(path.join(args.tempRoot ?? os.tmpdir(), 'redeven-flower-host-'));
  const reportFile = path.join(tempDir, 'startup-report.json');
  const secretResolverTokenEnv = 'REDEVEN_FLOWER_HOST_SECRET_RESOLVER_TOKEN';
  const child = spawn(args.executablePath, [
    'flower-host',
    '--state-root',
    args.paths.stateRoot,
    '--bind',
    '127.0.0.1:0',
    '--startup-report-file',
    reportFile,
    '--secret-resolver-url',
    secretResolver.baseURL,
    '--secret-resolver-token-env',
    secretResolverTokenEnv,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: flowerHostChildEnv(secretResolverTokenEnv, secretResolver.token),
  }) as unknown as FlowerHostProcess;

  let spawnError: Error | null = null;
  child.once('error', (error) => {
    spawnError = error instanceof Error ? error : new Error(String(error));
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => args.onLog?.('stdout', chunk));
  child.stderr.on('data', (chunk: string) => args.onLog?.('stderr', chunk));

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    await stopProcess(child).catch(() => undefined);
    await secretResolver.close().catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  };
  child.once('exit', () => {
    if (activeClient?.child === child) {
      clientTask = null;
      activeClient = null;
      void cleanup();
    }
  });

  try {
    const deadline = Date.now() + FLOWER_HOST_STARTUP_TIMEOUT_MS;
    for (;;) {
      if (spawnError) {
        throw spawnError;
      }
      const report = await readStartupReport(reportFile);
      if (report) {
        if (report.status === 'blocked') {
          throw new Error(`${report.code}: ${report.message}`);
        }
        const attached = Boolean(report.attached);
        const clientChild = attached ? createAttachedFlowerHostProcess() : child;
        if (attached) {
          await stopProcess(child).catch(() => undefined);
        }
        const client: FlowerHostClient = {
          baseURL: report.base_url,
          token: report.token,
          child: clientChild,
          ...(report.pid ? { pid: report.pid } : {}),
          attached,
          stop: attached ? async () => {
            await secretResolver.close().catch(() => undefined);
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
          } : cleanup,
        };
        if (attached) {
          try {
            await assertAttachedFlowerHostHealthy(client);
          } catch (error) {
            await secretResolver.close().catch(() => undefined);
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
            throw error;
          }
        }
        return client;
      }
      if (child.exitCode !== null || child.signalCode) {
        throw new Error(`Flower Host exited before becoming ready (${child.exitCode !== null ? `exit code ${child.exitCode}` : `signal ${child.signalCode}`}).`);
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for Flower Host readiness.');
      }
      await delay(STARTUP_REPORT_POLL_MS);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function loadFlowerHostSettingsViaBridge(args: FlowerHostBridgeArgs): Promise<DesktopFlowerHostSettingsSnapshot> {
  const client = await ensureFlowerHostBridge(args);
  const snapshot = await requestJSON<DesktopFlowerHostSettingsSnapshot>(client, '/v1/settings');
  return {
    ...snapshot,
    config: validateDesktopFlowerHostConfig(snapshot.config),
    target_cache: normalizeBridgeTargetCache(snapshot.target_cache),
  };
}

export async function saveFlowerHostSettingsViaBridge(args: FlowerHostBridgeArgs & Readonly<{
  draft: DesktopFlowerHostSettingsDraft;
}>): Promise<DesktopFlowerHostSettingsSnapshot> {
  const persistence = await prepareDesktopFlowerHostSecretPersistence(args.paths, args.draft, args.codec);
  const client = await ensureFlowerHostBridge(args);
  await requestJSON<DesktopFlowerHostSettingsSnapshot>(client, '/v1/settings', {
    method: 'PUT',
    body: JSON.stringify({ config: persistence.config }),
  });
  await persistence.commitSecrets();
  return loadFlowerHostSettingsViaBridge(args);
}

export async function listFlowerHostThreadsViaBridge(args: FlowerHostBridgeArgs): Promise<readonly DesktopFlowerHostThread[]> {
  const client = await ensureFlowerHostBridge(args);
  const result = await requestJSON<{ threads: readonly DesktopFlowerHostThread[] }>(client, '/v1/threads');
  return result.threads.map(normalizeBridgeThread);
}

export async function loadFlowerHostThreadViaBridge(args: FlowerHostBridgeArgs & Readonly<{
  threadID: string;
}>): Promise<DesktopFlowerHostThread> {
  const client = await ensureFlowerHostBridge(args);
  const threadID = compact(args.threadID);
  if (!threadID) {
    throw new Error('Flower thread id is required.');
  }
  const result = await requestJSON<DesktopFlowerHostThread>(client, `/v1/thread/${encodeURIComponent(threadID)}`);
  return normalizeBridgeThread(result);
}

export async function markFlowerHostThreadReadViaBridge(args: FlowerHostBridgeArgs & Readonly<{
  request: DesktopFlowerHostMarkThreadReadRequest;
}>): Promise<DesktopFlowerHostThread> {
  const client = await ensureFlowerHostBridge(args);
  const threadID = compact(args.request.thread_id);
  if (!threadID) {
    throw new Error('Flower thread id is required.');
  }
  const result = await requestJSON<{ thread?: DesktopFlowerHostThread }>(client, `/v1/thread/${encodeURIComponent(threadID)}/read`, {
    method: 'POST',
    body: JSON.stringify({
      snapshot: {
        activity_revision: Math.floor(Number(args.request.snapshot.activity_revision)),
        last_message_at_unix_ms: Math.floor(Number(args.request.snapshot.last_message_at_unix_ms)),
        activity_signature: compact(args.request.snapshot.activity_signature),
        ...(compact(args.request.snapshot.waiting_prompt_id) ? { waiting_prompt_id: compact(args.request.snapshot.waiting_prompt_id) } : {}),
      },
    }),
  });
  if (!result.thread) {
    bridgeContractError('thread_read.thread', 'is required');
  }
  return normalizeBridgeThread(result.thread);
}

export async function renameFlowerHostThreadViaBridge(args: FlowerHostBridgeArgs & Readonly<{
  request: DesktopFlowerHostRenameThreadRequest;
}>): Promise<DesktopFlowerHostThread> {
  const client = await ensureFlowerHostBridge(args);
  const threadID = compact(args.request.thread_id);
  if (!threadID) {
    throw new Error('Flower thread id is required.');
  }
  const result = await requestJSON<{ thread?: DesktopFlowerHostThread }>(client, `/v1/thread/${encodeURIComponent(threadID)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: args.request.title ?? '' }),
  });
  if (!result.thread) {
    bridgeContractError('thread_mutation.thread', 'is required');
  }
  return normalizeBridgeThread(result.thread);
}

export async function setFlowerHostThreadPinnedViaBridge(args: FlowerHostBridgeArgs & Readonly<{
  request: DesktopFlowerHostSetThreadPinnedRequest;
}>): Promise<DesktopFlowerHostThread> {
  const client = await ensureFlowerHostBridge(args);
  const threadID = compact(args.request.thread_id);
  if (!threadID) {
    throw new Error('Flower thread id is required.');
  }
  const result = await requestJSON<{ thread?: DesktopFlowerHostThread }>(client, `/v1/thread/${encodeURIComponent(threadID)}`, {
    method: 'PATCH',
    body: JSON.stringify({ pinned: Boolean(args.request.pinned) }),
  });
  if (!result.thread) {
    bridgeContractError('thread_mutation.thread', 'is required');
  }
  return normalizeBridgeThread(result.thread);
}

export async function forkFlowerHostThreadViaBridge(args: FlowerHostBridgeArgs & Readonly<{
  request: DesktopFlowerHostForkThreadRequest;
}>): Promise<DesktopFlowerHostThread> {
  const client = await ensureFlowerHostBridge(args);
  const threadID = compact(args.request.thread_id);
  if (!threadID) {
    throw new Error('Flower thread id is required.');
  }
  const result = await requestJSON<{ thread?: DesktopFlowerHostThread }>(client, `/v1/thread/${encodeURIComponent(threadID)}/fork`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!result.thread) {
    bridgeContractError('thread_fork.thread', 'is required');
  }
  return normalizeBridgeThread(result.thread);
}

export async function sendFlowerHostChatResultViaBridge(args: FlowerHostBridgeArgs & Readonly<{
  request: DesktopFlowerHostSendChatRequest;
}>): Promise<
  | { thread: DesktopFlowerHostThread }
  | { create_failure: FlowerHostCreateFailure }
> {
  const client = await ensureFlowerHostBridge(args);
  const result = await requestJSON<{
    thread?: DesktopFlowerHostThread;
    create_failure?: unknown;
  }>(client, '/v1/chat/send', {
    method: 'POST',
    body: JSON.stringify(args.request),
  });
  return normalizeBridgeSendChatResult(result);
}

export async function submitFlowerHostInputViaBridge(args: FlowerHostBridgeArgs & Readonly<{
  request: DesktopFlowerHostSubmitInputRequest;
}>): Promise<DesktopFlowerHostThread> {
  const client = await ensureFlowerHostBridge(args);
  const result = await requestJSON<{ thread?: DesktopFlowerHostThread }>(client, '/v1/chat/input', {
    method: 'POST',
    body: JSON.stringify(args.request),
  });
  const thread = result.thread;
  if (!thread) {
    bridgeContractError('chat_input.thread', 'is required');
  }
  return normalizeBridgeThread(thread);
}

export async function resolveFlowerHostHandlerViaBridge(args: FlowerHostBridgeArgs & Readonly<{
  request?: Readonly<Record<string, unknown>>;
}>): Promise<DesktopFlowerHostRouterDecision> {
  const client = await ensureFlowerHostBridge(args);
  const decision = await requestJSON<DesktopFlowerHostRouterDecision>(client, '/v1/router/resolve', {
    method: 'POST',
    body: JSON.stringify(args.request ?? { thread_kind: 'chat', client_surface: 'flower_surface' }),
  });
  return normalizeBridgeRouterDecision(decision, 'decision');
}

function normalizeBridgeMetadata(value: unknown, field: string): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireBridgeObject(value, field);
}

function normalizeBridgeTargetCacheEntry(value: unknown, field: string): DesktopFlowerHostTargetCache['entries'][number] {
  const record = requireBridgeObject(value, field);
  const metadata = normalizeBridgeMetadata(record.metadata, `${field}.metadata`);
  return {
    target_id: requireBridgeString(record.target_id, `${field}.target_id`),
    label: requireBridgeString(record.label, `${field}.label`),
    target_url: requireBridgeString(record.target_url, `${field}.target_url`),
    last_seen_at_unix_ms: requireBridgeTimestamp(record.last_seen_at_unix_ms, `${field}.last_seen_at_unix_ms`),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeBridgeTargetCache(value: unknown): DesktopFlowerHostTargetCache {
  const record = requireBridgeObject(value, 'settings.target_cache');
  const version = Number(record.version);
  if (version !== 1) {
    bridgeContractError('settings.target_cache.version', 'must be 1');
  }
  if (!Array.isArray(record.entries)) {
    bridgeContractError('settings.target_cache.entries', 'must be an array');
  }
  return {
    version: 1,
    entries: record.entries.map((entry, index) => normalizeBridgeTargetCacheEntry(entry, `settings.target_cache.entries[${index}]`)),
  };
}

function bridgeContractError(field: string, reason = 'is invalid'): never {
  throw new Error(`Flower Host response field ${field} ${reason}.`);
}

function requireBridgeObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    bridgeContractError(field);
  }
  return value as Record<string, unknown>;
}

function requireBridgeString(value: unknown, field: string, options: Readonly<{ allowEmpty?: boolean }> = {}): string {
  if (typeof value !== 'string') {
    bridgeContractError(field, 'must be a string');
  }
  const text = value.trim();
  if (!options.allowEmpty && !text) {
    bridgeContractError(field, 'is required');
  }
  return text;
}

function requireBridgeNumber(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    bridgeContractError(field, 'must be a number');
  }
  return number;
}

function optionalBridgeNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireBridgeNumber(value, field);
}

function requireBridgeBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    bridgeContractError(field, 'must be a boolean');
  }
  return value;
}

function optionalBridgeString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireBridgeString(value, field, { allowEmpty: true });
}

function requireBridgeTimestamp(value: unknown, field: string): number {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    bridgeContractError(field, 'must be a positive millisecond timestamp');
  }
  return timestamp;
}

function optionalBridgeTimestamp(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireBridgeTimestamp(value, field);
}

function optionalBridgeBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireBridgeBoolean(value, field);
}

function requireBridgeStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) {
    bridgeContractError(field, 'must be an array');
  }
  return value.map((item, index) => requireBridgeString(item, `${field}[${index}]`));
}

function normalizeBridgeMessageStatus(value: unknown, field: string): DesktopFlowerHostChatMessage['status'] {
  const status = compact(value);
  if (status === 'sending' || status === 'streaming' || status === 'error' || status === 'complete') {
    return status;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(status)}`);
}

function normalizeBridgeMessageRole(value: unknown, field: string): DesktopFlowerHostChatMessage['role'] {
  const role = compact(value);
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(role)}`);
}

function normalizeBridgeHandlerKind(value: unknown, field: string): NonNullable<DesktopFlowerHostRouterDecision['selected_handler']>['handler_kind'] {
  const kind = compact(value);
  if (kind === 'global' || kind === 'env_local') {
    return kind;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(kind)}`);
}

function normalizeBridgeHandlerState(value: unknown, field: string): NonNullable<DesktopFlowerHostRouterDecision['selected_handler']>['state'] {
  const state = compact(value);
  if (state === 'online' || state === 'unreachable') {
    return state;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(state)}`);
}

function normalizeBridgeCarrierKind(value: unknown, field: string): 'desktop' | 'server' | 'runtime' {
  const carrierKind = compact(value);
  if (carrierKind === 'desktop' || carrierKind === 'server' || carrierKind === 'runtime') {
    return carrierKind;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(carrierKind)}`);
}

function normalizeBridgeHandlerRef(value: unknown, field: string): NonNullable<DesktopFlowerHostRouterDecision['selected_handler']> {
  const record = requireBridgeObject(value, field);
  const carrierKind = optionalBridgeString(record.carrier_kind, `${field}.carrier_kind`);
  const selectionSource = optionalBridgeString(record.selection_source, `${field}.selection_source`);
  if (selectionSource !== undefined && selectionSource !== 'router_default' && selectionSource !== 'user_selected') {
    bridgeContractError(`${field}.selection_source`, `has unsupported value ${JSON.stringify(selectionSource)}`);
  }
  return {
    handler_id: requireBridgeString(record.handler_id, `${field}.handler_id`),
    handler_kind: normalizeBridgeHandlerKind(record.handler_kind, `${field}.handler_kind`),
    display_name: requireBridgeString(record.display_name, `${field}.display_name`),
    ...(carrierKind ? { carrier_kind: normalizeBridgeCarrierKind(carrierKind, `${field}.carrier_kind`) } : {}),
    state: normalizeBridgeHandlerState(record.state, `${field}.state`),
    ...(selectionSource ? { selection_source: selectionSource } : {}),
    supports_thread_kinds: requireBridgeStringArray(record.supports_thread_kinds, `${field}.supports_thread_kinds`),
    allowed_target_ids: requireBridgeStringArray(record.allowed_target_ids, `${field}.allowed_target_ids`),
  };
}

function normalizeBridgeUnavailableHandler(value: unknown, field: string): DesktopFlowerHostUnavailableHandler {
  const record = requireBridgeObject(value, field);
  const carrierKind = optionalBridgeString(record.carrier_kind, `${field}.carrier_kind`);
  return {
    handler_id: requireBridgeString(record.handler_id, `${field}.handler_id`),
    handler_kind: normalizeBridgeHandlerKind(record.handler_kind, `${field}.handler_kind`),
    display_name: requireBridgeString(record.display_name, `${field}.display_name`),
    ...(carrierKind ? { carrier_kind: normalizeBridgeCarrierKind(carrierKind, `${field}.carrier_kind`) } : {}),
    state: normalizeBridgeHandlerState(record.state, `${field}.state`),
    disabled_reason: requireBridgeString(record.disabled_reason, `${field}.disabled_reason`),
  };
}

function normalizeBridgeHostPresence(value: unknown, field: string): DesktopFlowerHostPresence {
  const record = requireBridgeObject(value, field);
  const endpoint = requireBridgeObject(record.endpoint, `${field}.endpoint`);
  const baseURL = optionalBridgeString(endpoint.base_url, `${field}.endpoint.base_url`);
  return {
    schema_version: requireBridgeNumber(record.schema_version, `${field}.schema_version`) === 1
      ? 1
      : bridgeContractError(`${field}.schema_version`, 'must be 1'),
    host_id: requireBridgeString(record.host_id, `${field}.host_id`),
    host_kind: normalizeBridgeHandlerKind(record.host_kind, `${field}.host_kind`),
    carrier_kind: normalizeBridgeCarrierKind(record.carrier_kind, `${field}.carrier_kind`),
    display_name: requireBridgeString(record.display_name, `${field}.display_name`),
    state: normalizeBridgeHandlerState(record.state, `${field}.state`),
    endpoint: {
      visibility: requireBridgeString(endpoint.visibility, `${field}.endpoint.visibility`),
      ...(baseURL ? { base_url: baseURL } : {}),
    },
    capabilities: requireBridgeStringArray(record.capabilities, `${field}.capabilities`),
    last_seen_at_unix_ms: requireBridgeTimestamp(record.last_seen_at_unix_ms, `${field}.last_seen_at_unix_ms`),
  };
}

function normalizeBridgeRouterRoute(value: unknown, field: string): DesktopFlowerHostRouterDecision['route'] {
  const route = compact(value);
  if (route === 'flower_host' || route === 'env_local' || route === 'blocked' || route === 'needs_clarification') {
    return route;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(route)}`);
}

function normalizeBridgeDecisionScope(value: unknown, field: string): DesktopFlowerHostRouterDecision['decision_scope'] {
  const record = requireBridgeObject(value, field);
  const threadKind = compact(record.thread_kind);
  if (threadKind !== 'chat' && threadKind !== 'task') {
    bridgeContractError(`${field}.thread_kind`, `has unsupported value ${JSON.stringify(threadKind)}`);
  }
  const contextEnvelopeID = record.context_envelope_id === null
    ? null
    : optionalBridgeString(record.context_envelope_id, `${field}.context_envelope_id`);
  const primaryTargetID = record.primary_target_id === null
    ? null
    : optionalBridgeString(record.primary_target_id, `${field}.primary_target_id`);
  return {
    thread_kind: threadKind,
    ...(contextEnvelopeID !== undefined ? { context_envelope_id: contextEnvelopeID } : {}),
    client_surface: requireBridgeString(record.client_surface, `${field}.client_surface`),
    ...(primaryTargetID !== undefined ? { primary_target_id: primaryTargetID } : {}),
  };
}

function normalizeBridgeUIChip(value: unknown, field: string): DesktopFlowerHostRouterDecision['ui_chips'][number] {
  const record = requireBridgeObject(value, field);
  return {
    kind: requireBridgeString(record.kind, `${field}.kind`),
    label: requireBridgeString(record.label, `${field}.label`),
    tone: requireBridgeString(record.tone, `${field}.tone`),
  };
}

function normalizeBridgeBlocker(value: unknown, field: string): DesktopFlowerHostRouterDecision['blocker'] | undefined {
  if (value === undefined || value === null) {
    return value === null ? null : undefined;
  }
  const record = requireBridgeObject(value, field);
  return {
    code: requireBridgeString(record.code, `${field}.code`),
    message: requireBridgeString(record.message, `${field}.message`),
  };
}

function normalizeBridgeRouterDecision(value: unknown, field: string): DesktopFlowerHostRouterDecision {
  const record = requireBridgeObject(value, field);
  if (!Array.isArray(record.available_handlers)) {
    bridgeContractError(`${field}.available_handlers`, 'must be an array');
  }
  if (!Array.isArray(record.unavailable_handlers)) {
    bridgeContractError(`${field}.unavailable_handlers`, 'must be an array');
  }
  if (!Array.isArray(record.ui_chips)) {
    bridgeContractError(`${field}.ui_chips`, 'must be an array');
  }
  if (!Array.isArray(record.allowed_actions)) {
    bridgeContractError(`${field}.allowed_actions`, 'must be an array');
  }
  const selectedHandler = record.selected_handler === null
    ? null
    : normalizeBridgeHandlerRef(record.selected_handler, `${field}.selected_handler`);
  const handlerSelection = requireBridgeObject(record.handler_selection, `${field}.handler_selection`);
  const lockReason = handlerSelection.lock_reason === null
    ? null
    : optionalBridgeString(handlerSelection.lock_reason, `${field}.handler_selection.lock_reason`);
  const blocker = normalizeBridgeBlocker(record.blocker, `${field}.blocker`);
  const currentTargetID = optionalBridgeString(record.current_target_id, `${field}.current_target_id`);
  const primaryMessage = optionalBridgeString(record.primary_message, `${field}.primary_message`);
  return {
    decision_id: requireBridgeString(record.decision_id, `${field}.decision_id`),
    decision_revision: requireBridgeNumber(record.decision_revision, `${field}.decision_revision`),
    route: normalizeBridgeRouterRoute(record.route, `${field}.route`),
    reason_code: requireBridgeString(record.reason_code, `${field}.reason_code`),
    selected_handler: selectedHandler,
    available_handlers: record.available_handlers.map((handler, index) => normalizeBridgeHandlerRef(handler, `${field}.available_handlers[${index}]`)),
    unavailable_handlers: record.unavailable_handlers.map((handler, index) => normalizeBridgeUnavailableHandler(handler, `${field}.unavailable_handlers[${index}]`)),
    handler_selection: {
      can_switch: requireBridgeBoolean(handlerSelection.can_switch, `${field}.handler_selection.can_switch`),
      ...(lockReason !== undefined ? { lock_reason: lockReason } : {}),
      requires_user_visible_confirmation: requireBridgeBoolean(
        handlerSelection.requires_user_visible_confirmation,
        `${field}.handler_selection.requires_user_visible_confirmation`,
      ),
    },
    decision_scope: normalizeBridgeDecisionScope(record.decision_scope, `${field}.decision_scope`),
    host_presence: normalizeBridgeHostPresence(record.host_presence, `${field}.host_presence`),
    ...(currentTargetID ? { current_target_id: currentTargetID } : {}),
    allowed_actions: requireBridgeStringArray(record.allowed_actions, `${field}.allowed_actions`),
    ui_chips: record.ui_chips.map((chip, index) => normalizeBridgeUIChip(chip, `${field}.ui_chips[${index}]`)),
    ...(primaryMessage ? { primary_message: primaryMessage } : {}),
    ...(blocker !== undefined ? { blocker } : {}),
    created_at_unix_ms: requireBridgeTimestamp(record.created_at_unix_ms, `${field}.created_at_unix_ms`),
  };
}

function normalizeBridgeSendChatResult(value: unknown): { thread: DesktopFlowerHostThread } | { create_failure: FlowerHostCreateFailure } {
  const record = requireBridgeObject(value, 'chat_send');
  const hasThread = record.thread !== undefined && record.thread !== null;
  const hasCreateFailure = record.create_failure !== undefined && record.create_failure !== null;
  if (hasThread === hasCreateFailure) {
    bridgeContractError('chat_send', 'must include exactly one of thread or create_failure');
  }
  if (hasThread) {
    return { thread: normalizeBridgeThread(record.thread as DesktopFlowerHostThread) };
  }
  return { create_failure: normalizeBridgeCreateFailure(record.create_failure, 'create_failure') };
}

function normalizeBridgeCreateFailure(value: unknown, field: string): FlowerHostCreateFailure {
  const record = requireBridgeObject(value, field);
  const freshDecision = record.fresh_decision === null
    ? null
    : record.fresh_decision === undefined
      ? undefined
      : normalizeBridgeRouterDecision(record.fresh_decision, `${field}.fresh_decision`);
  return {
    error: normalizeFlowerHostErrorPayload(record.error, `${field}.error`),
    ...(freshDecision !== undefined ? { fresh_decision: freshDecision } : {}),
  };
}

function normalizeBridgeActivityTimelineBlock(value: unknown, field: string): DesktopFlowerHostActivityTimelineBlock {
  const record = requireBridgeObject(value, field);
  const summary = requireBridgeObject(record.summary, `${field}.summary`);
  if (!Array.isArray(record.items)) {
    bridgeContractError(`${field}.items`, 'must be an array');
  }
  const runID = optionalBridgeString(record.run_id, `${field}.run_id`);
  const threadID = optionalBridgeString(record.thread_id, `${field}.thread_id`);
  const turnID = optionalBridgeString(record.turn_id, `${field}.turn_id`);
  const traceID = optionalBridgeString(record.trace_id, `${field}.trace_id`);
  const attentionReasons = summary.attention_reasons === undefined
    ? undefined
    : normalizeBridgeActivityAttentionReasons(summary.attention_reasons, `${field}.summary.attention_reasons`);
  const durationMS = optionalBridgeNumber(summary.duration_ms, `${field}.summary.duration_ms`);
  return {
    type: 'activity-timeline',
    schema_version: requireBridgeNumber(record.schema_version, `${field}.schema_version`),
    ...(runID ? { run_id: runID } : {}),
    ...(threadID ? { thread_id: threadID } : {}),
    ...(turnID ? { turn_id: turnID } : {}),
    ...(traceID ? { trace_id: traceID } : {}),
    summary: {
      status: normalizeBridgeActivityStatus(summary.status, `${field}.summary.status`),
      severity: normalizeBridgeActivitySeverity(summary.severity, `${field}.summary.severity`),
      needs_attention: requireBridgeBoolean(summary.needs_attention, `${field}.summary.needs_attention`),
      ...(attentionReasons ? { attention_reasons: attentionReasons } : {}),
      total_items: requireBridgeNumber(summary.total_items, `${field}.summary.total_items`),
      counts: normalizeBridgeActivityCounts(summary.counts, `${field}.summary.counts`),
      ...(durationMS !== undefined ? { duration_ms: durationMS } : {}),
    },
    items: record.items.map((item, index) => normalizeBridgeActivityItem(item, `${field}.items[${index}]`)),
  };
}

function normalizeBridgeMessageBlock(block: unknown, field: string): DesktopFlowerHostChatMessageBlock {
  const record = requireBridgeObject(block, field);
  const type = compact(record.type);
  if (type === 'activity-timeline') {
    return normalizeBridgeActivityTimelineBlock(block, field);
  }
  if (type !== 'markdown' && type !== 'text' && type !== 'thinking') {
    bridgeContractError(`${field}.type`, `has unsupported value ${JSON.stringify(type)}`);
  }
  return {
    type,
    ...(record.content === undefined || record.content === null
      ? {}
      : { content: requireBridgeString(record.content, `${field}.content`, { allowEmpty: true }) }),
  };
}

function normalizeBridgeMessage(message: unknown, field: string): DesktopFlowerHostChatMessage {
  const record = requireBridgeObject(message, field);
  const blocks = Array.isArray(record.blocks)
    ? record.blocks.map((block, index) => normalizeBridgeMessageBlock(block, `${field}.blocks[${index}]`))
    : [];
  if (record.blocks !== undefined && !Array.isArray(record.blocks)) {
    bridgeContractError(`${field}.blocks`, 'must be an array');
  }
  const status = normalizeBridgeMessageStatus(record.status, `${field}.status`);
  return {
    id: requireBridgeString(record.id, `${field}.id`),
    role: normalizeBridgeMessageRole(record.role, `${field}.role`),
    content: requireBridgeString(record.content, `${field}.content`, { allowEmpty: true }),
    created_at_ms: requireBridgeTimestamp(record.created_at_ms, `${field}.created_at_ms`),
    status,
    ...(blocks.length > 0 ? { blocks } : {}),
  };
}

function normalizeBridgeActivityStatus(value: unknown, field: string): DesktopFlowerHostActivityTimelineBlock['summary']['status'] {
  const status = compact(value);
  if (
    status === 'pending'
    || status === 'running'
    || status === 'waiting'
    || status === 'success'
    || status === 'error'
    || status === 'canceled'
  ) {
    return status;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(status)}`);
}

function normalizeBridgeActivityKind(value: unknown, field: string): DesktopFlowerHostActivityItem['kind'] {
  const kind = compact(value);
  if (kind === 'tool' || kind === 'hosted_tool' || kind === 'approval' || kind === 'control' || kind === 'budget') {
    return kind;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(kind)}`);
}

function normalizeBridgeActivitySeverity(value: unknown, field: string): DesktopFlowerHostActivityItem['severity'] {
  const severity = compact(value);
  if (severity === 'quiet' || severity === 'normal' || severity === 'warning' || severity === 'error' || severity === 'blocking') {
    return severity;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(severity)}`);
}

function normalizeBridgeActivityAttentionReasons(value: unknown, field: string): NonNullable<DesktopFlowerHostActivityItem['attention_reasons']> {
  if (!Array.isArray(value)) {
    bridgeContractError(field, 'must be an array');
  }
  return value.map((item, index) => {
    const reason = compact(item);
    if (reason === 'running' || reason === 'waiting' || reason === 'approval' || reason === 'error') {
      return reason;
    }
    bridgeContractError(`${field}[${index}]`, `has unsupported value ${JSON.stringify(reason)}`);
  });
}

function normalizeBridgeActivityApprovalState(value: unknown, field: string): DesktopFlowerHostActivityItem['approval_state'] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const state = compact(value);
  if (state === '') {
    return undefined;
  }
  if (state === 'requested' || state === 'approved' || state === 'rejected' || state === 'timed_out' || state === 'canceled') {
    return state;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(state)}`);
}

function normalizeBridgeActivityCounts(value: unknown, field: string): DesktopFlowerHostActivityTimelineBlock['summary']['counts'] {
  const record = requireBridgeObject(value, field);
  const keys = ['pending', 'running', 'waiting', 'success', 'error', 'canceled', 'approval'] as const;
  const out: Record<string, number> = {};
  for (const key of keys) {
    if (record[key] !== undefined) {
      out[key] = requireBridgeNumber(record[key], `${field}.${key}`);
    }
  }
  return out;
}

function normalizeBridgeActivityMetadata(value: unknown, field: string): Readonly<Record<string, string>> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const record = requireBridgeObject(value, field);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    out[key] = requireBridgeString(item, `${field}.${key}`, { allowEmpty: true });
  }
  return out;
}

function normalizeBridgeActivityItem(value: unknown, field: string): DesktopFlowerHostActivityItem {
  const record = requireBridgeObject(value, field);
  const toolID = optionalBridgeString(record.tool_id, `${field}.tool_id`);
  const toolName = optionalBridgeString(record.tool_name, `${field}.tool_name`);
  const attentionReasons = record.attention_reasons === undefined
    ? undefined
    : normalizeBridgeActivityAttentionReasons(record.attention_reasons, `${field}.attention_reasons`);
  const approvalState = normalizeBridgeActivityApprovalState(record.approval_state, `${field}.approval_state`);
  const startedAtUnixMS = optionalBridgeTimestamp(record.started_at_unix_ms, `${field}.started_at_unix_ms`);
  const endedAtUnixMS = optionalBridgeTimestamp(record.ended_at_unix_ms, `${field}.ended_at_unix_ms`);
  const metadata = normalizeBridgeActivityMetadata(record.metadata, `${field}.metadata`);
  return {
    item_id: requireBridgeString(record.item_id, `${field}.item_id`),
    ...(toolID ? { tool_id: toolID } : {}),
    ...(toolName ? { tool_name: toolName } : {}),
    kind: normalizeBridgeActivityKind(record.kind, `${field}.kind`),
    status: normalizeBridgeActivityStatus(record.status, `${field}.status`),
    severity: normalizeBridgeActivitySeverity(record.severity, `${field}.severity`),
    needs_attention: requireBridgeBoolean(record.needs_attention, `${field}.needs_attention`),
    ...(attentionReasons ? { attention_reasons: attentionReasons } : {}),
    requires_approval: requireBridgeBoolean(record.requires_approval, `${field}.requires_approval`),
    ...(approvalState ? { approval_state: approvalState } : {}),
    ...(startedAtUnixMS ? { started_at_unix_ms: startedAtUnixMS } : {}),
    ...(endedAtUnixMS ? { ended_at_unix_ms: endedAtUnixMS } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeBridgeInputAction(value: unknown, field: string): DesktopFlowerHostInputAction {
  const record = requireBridgeObject(value, field);
  const mode = optionalBridgeString(record.mode, `${field}.mode`);
  return {
    type: requireBridgeString(record.type, `${field}.type`),
    ...(mode ? { mode } : {}),
  };
}

function normalizeBridgeInputChoiceKind(value: unknown, field: string): 'select' {
  const kind = compact(value);
  if (kind === 'select') {
    return kind;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(kind)}`);
}

function normalizeBridgeInputResponseMode(value: unknown, field: string): DesktopFlowerHostInputRequest['questions'][number]['response_mode'] {
  const mode = compact(value);
  if (mode === 'select' || mode === 'write' || mode === 'select_or_write') {
    return mode;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(mode)}`);
}

function normalizeBridgeInputChoice(value: unknown, field: string): NonNullable<DesktopFlowerHostInputRequest['questions'][number]['choices']>[number] {
  const record = requireBridgeObject(value, field);
  if (record.actions !== undefined && !Array.isArray(record.actions)) {
    bridgeContractError(`${field}.actions`, 'must be an array');
  }
  const description = optionalBridgeString(record.description, `${field}.description`);
  const inputPlaceholder = optionalBridgeString(record.input_placeholder, `${field}.input_placeholder`);
  const actions = Array.isArray(record.actions)
    ? record.actions.map((action, index) => normalizeBridgeInputAction(action, `${field}.actions[${index}]`))
    : [];
  return {
    choice_id: requireBridgeString(record.choice_id, `${field}.choice_id`),
    label: requireBridgeString(record.label, `${field}.label`),
    ...(description ? { description } : {}),
    kind: normalizeBridgeInputChoiceKind(record.kind, `${field}.kind`),
    ...(inputPlaceholder ? { input_placeholder: inputPlaceholder } : {}),
    ...(actions.length > 0 ? { actions } : {}),
  };
}

function normalizeBridgeInputQuestion(value: unknown, field: string): DesktopFlowerHostInputQuestion {
  const record = requireBridgeObject(value, field);
  if (record.choices !== undefined && !Array.isArray(record.choices)) {
    bridgeContractError(`${field}.choices`, 'must be an array');
  }
  const isSecret = optionalBridgeBoolean(record.is_secret, `${field}.is_secret`);
  const choicesExhaustive = optionalBridgeBoolean(record.choices_exhaustive, `${field}.choices_exhaustive`);
  const writeLabel = optionalBridgeString(record.write_label, `${field}.write_label`);
  const writePlaceholder = optionalBridgeString(record.write_placeholder, `${field}.write_placeholder`);
  const choices = Array.isArray(record.choices)
    ? record.choices.map((choice, index) => normalizeBridgeInputChoice(choice, `${field}.choices[${index}]`))
    : [];
  const responseMode = normalizeBridgeInputResponseMode(record.response_mode, `${field}.response_mode`);
  return {
    id: requireBridgeString(record.id, `${field}.id`),
    header: requireBridgeString(record.header, `${field}.header`),
    question: requireBridgeString(record.question, `${field}.question`),
    ...(isSecret !== undefined ? { is_secret: isSecret } : {}),
    response_mode: responseMode,
    ...(choicesExhaustive !== undefined ? { choices_exhaustive: choicesExhaustive } : {}),
    ...(writeLabel ? { write_label: writeLabel } : {}),
    ...(writePlaceholder ? { write_placeholder: writePlaceholder } : {}),
    ...(choices.length > 0 ? { choices } : {}),
  };
}

function normalizeBridgeInputRequest(value: unknown, field: string): DesktopFlowerHostInputRequest | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const record = requireBridgeObject(value, field);
  if (!Array.isArray(record.questions) || record.questions.length === 0) {
    bridgeContractError(`${field}.questions`, 'must be a non-empty array');
  }
  const reasonCode = optionalBridgeString(record.reason_code, `${field}.reason_code`);
  const publicSummary = optionalBridgeString(record.public_summary, `${field}.public_summary`);
  const containsSecret = optionalBridgeBoolean(record.contains_secret, `${field}.contains_secret`);
  const requiredFromUser = record.required_from_user === undefined
    ? undefined
    : requireBridgeStringArray(record.required_from_user, `${field}.required_from_user`);
  const evidenceRefs = record.evidence_refs === undefined
    ? undefined
    : requireBridgeStringArray(record.evidence_refs, `${field}.evidence_refs`);
  return {
    prompt_id: requireBridgeString(record.prompt_id, `${field}.prompt_id`),
    message_id: requireBridgeString(record.message_id, `${field}.message_id`),
    tool_id: requireBridgeString(record.tool_id, `${field}.tool_id`),
    tool_name: requireBridgeString(record.tool_name, `${field}.tool_name`),
    ...(reasonCode ? { reason_code: reasonCode } : {}),
    ...(requiredFromUser ? { required_from_user: requiredFromUser } : {}),
    ...(evidenceRefs ? { evidence_refs: evidenceRefs } : {}),
    questions: record.questions.map((question, index) => normalizeBridgeInputQuestion(question, `${field}.questions[${index}]`)),
    ...(publicSummary ? { public_summary: publicSummary } : {}),
    ...(containsSecret !== undefined ? { contains_secret: containsSecret } : {}),
  };
}

function normalizeBridgeThreadStatus(value: unknown, field: string): DesktopFlowerHostThread['status'] {
  const status = compact(value);
  if ([
    'idle',
    'running',
    'waiting_user',
    'waiting_approval',
    'failed',
    'success',
    'canceled',
    'read_only',
  ].includes(status)) {
    return status as DesktopFlowerHostThread['status'];
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(status)}`);
}

function normalizeBridgeHostKind(value: unknown, field: string): DesktopFlowerHostThread['home_host_kind'] | undefined {
  if (value === undefined || value === null || compact(value) === '') {
    return undefined;
  }
  const hostKind = compact(value);
  if (hostKind === 'global' || hostKind === 'env_local') {
    return hostKind;
  }
  bridgeContractError(field, `has unsupported value ${JSON.stringify(hostKind)}`);
}

function normalizeBridgeThreadError(value: unknown, field: string): DesktopFlowerHostThread['error'] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const record = requireBridgeObject(value, field);
  const code = optionalBridgeString(record.code, `${field}.code`);
  return {
    message: requireBridgeString(record.message, `${field}.message`),
    ...(code ? { code } : {}),
  };
}

function normalizeBridgeThreadReadStatus(value: unknown, field: string): DesktopFlowerHostThread['read_status'] {
  const record = requireBridgeObject(value, field);
  const snapshot = requireBridgeObject(record.snapshot, `${field}.snapshot`);
  const readState = requireBridgeObject(record.read_state, `${field}.read_state`);
  const activitySignature = requireBridgeString(snapshot.activity_signature, `${field}.snapshot.activity_signature`);
  const lastSeenActivitySignature = requireBridgeString(readState.last_seen_activity_signature, `${field}.read_state.last_seen_activity_signature`, { allowEmpty: true });
  return {
    is_unread: requireBridgeBoolean(record.is_unread, `${field}.is_unread`),
    snapshot: {
      activity_revision: requireBridgeTimestamp(snapshot.activity_revision, `${field}.snapshot.activity_revision`),
      last_message_at_unix_ms: requireBridgeTimestamp(snapshot.last_message_at_unix_ms, `${field}.snapshot.last_message_at_unix_ms`),
      activity_signature: activitySignature,
      ...(compact(snapshot.waiting_prompt_id) ? { waiting_prompt_id: compact(snapshot.waiting_prompt_id) } : {}),
    },
    read_state: {
      last_seen_activity_revision: requireBridgeTimestamp(readState.last_seen_activity_revision, `${field}.read_state.last_seen_activity_revision`),
      last_read_message_at_unix_ms: requireBridgeTimestamp(readState.last_read_message_at_unix_ms, `${field}.read_state.last_read_message_at_unix_ms`),
      last_seen_activity_signature: lastSeenActivitySignature,
      ...(compact(readState.last_seen_waiting_prompt_id) ? { last_seen_waiting_prompt_id: compact(readState.last_seen_waiting_prompt_id) } : {}),
    },
  };
}

function normalizeBridgeThread(thread: DesktopFlowerHostThread): DesktopFlowerHostThread {
  const record = requireBridgeObject(thread, 'thread');
  if (!Array.isArray(record.messages)) {
    bridgeContractError('thread.messages', 'must be an array');
  }
  const messages: readonly DesktopFlowerHostChatMessage[] = record.messages
    .map((message, index) => normalizeBridgeMessage(message, `thread.messages[${index}]`));
  const status = normalizeBridgeThreadStatus(record.status, 'thread.status');
  const error = normalizeBridgeThreadError(record.error, 'thread.error');
  const homeHostKind = normalizeBridgeHostKind(record.home_host_kind, 'thread.home_host_kind');
  const homeHostID = optionalBridgeString(record.home_host_id, 'thread.home_host_id');
  const inputRequest = normalizeBridgeInputRequest(record.input_request, 'thread.input_request');
  const pinnedAtMs = record.pinned_at_ms === undefined || record.pinned_at_ms === null
    ? undefined
    : requireBridgeTimestamp(record.pinned_at_ms, 'thread.pinned_at_ms');
  return {
    thread_id: requireBridgeString(record.thread_id, 'thread.thread_id'),
    title: requireBridgeString(record.title, 'thread.title'),
    model_id: requireBridgeString(record.model_id, 'thread.model_id', { allowEmpty: true }),
    working_dir: requireBridgeString(record.working_dir, 'thread.working_dir', { allowEmpty: true }),
    ...(pinnedAtMs ? { pinned_at_ms: pinnedAtMs } : {}),
    created_at_ms: requireBridgeTimestamp(record.created_at_ms, 'thread.created_at_ms'),
    updated_at_ms: requireBridgeTimestamp(record.updated_at_ms, 'thread.updated_at_ms'),
    status,
    ...(homeHostID ? { home_host_id: homeHostID } : {}),
    ...(homeHostKind ? { home_host_kind: homeHostKind } : {}),
    source_label: requireBridgeString(record.source_label, 'thread.source_label'),
    target_labels: requireBridgeStringArray(record.target_labels, 'thread.target_labels'),
    messages,
    ...(inputRequest ? { input_request: inputRequest } : {}),
    ...(error ? { error } : {}),
    read_status: normalizeBridgeThreadReadStatus(record.read_status, 'thread.read_status'),
  };
}
