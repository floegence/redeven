import { spawn, type ChildProcessByStdio } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

import {
  type DesktopFlowerHostChatMessage,
  type DesktopFlowerHostSendChatRequest,
  type DesktopFlowerHostSettingsDraft,
  type DesktopFlowerHostSettingsSnapshot,
  type DesktopFlowerHostTargetCache,
  type DesktopFlowerHostThread,
  type DesktopFlowerHostRouterDecision,
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
  attached: boolean;
  stop: () => Promise<void>;
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

function compact(value: unknown): string {
  return String(value ?? '').trim();
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
      const detail = compact(payload?.error);
      throw new Error(`Flower Host request failed with HTTP ${response.status}.${detail ? ` ${detail}` : ''}`);
    }
    if (!payload?.ok) {
      throw new Error(compact(payload?.error) || 'Flower Host request failed.');
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

export async function ensureFlowerHostBridge(args: FlowerHostBridgeArgs): Promise<FlowerHostClient> {
  if (activeClient && !activeClient.attached && !flowerHostClientProcessIsAlive(activeClient)) {
    clientTask = null;
    activeClient = null;
  }
  if (activeClient?.attached) {
    if (await flowerHostClientStatusOK(activeClient)) {
      return activeClient;
    }
    clientTask = null;
    activeClient = null;
  }
  if (!clientTask) {
    clientTask = startFlowerHostBridge(args)
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

async function flowerHostClientStatusOK(client: FlowerHostClient): Promise<boolean> {
  try {
    await requestJSON<unknown>(client, '/v1/status', {}, 2000);
    return true;
  } catch {
    return false;
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
          attached,
          stop: attached ? async () => {
            await secretResolver.close().catch(() => undefined);
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
          } : cleanup,
        };
        if (attached) {
          await requestJSON<unknown>(client, '/v1/status', {}, 2000);
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

export async function sendFlowerHostChatResultViaBridge(args: FlowerHostBridgeArgs & Readonly<{
  request: DesktopFlowerHostSendChatRequest;
}>): Promise<{
  thread?: DesktopFlowerHostThread;
  create_failure?: { error?: { code?: string; message?: string }; fresh_decision?: DesktopFlowerHostRouterDecision | null };
}> {
  const client = await ensureFlowerHostBridge(args);
  const result = await requestJSON<{
    thread?: DesktopFlowerHostThread;
    create_failure?: { error?: { code?: string; message?: string }; fresh_decision?: DesktopFlowerHostRouterDecision | null };
  }>(client, '/v1/chat/send', {
    method: 'POST',
    body: JSON.stringify(args.request),
  });
  return {
    ...(result.thread ? { thread: normalizeBridgeThread(result.thread) } : {}),
    ...(result.create_failure ? { create_failure: result.create_failure } : {}),
  };
}

export async function resolveFlowerHostHandlerViaBridge(args: FlowerHostBridgeArgs & Readonly<{
  request?: Readonly<Record<string, unknown>>;
}>): Promise<DesktopFlowerHostRouterDecision> {
  const client = await ensureFlowerHostBridge(args);
  return requestJSON<DesktopFlowerHostRouterDecision>(client, '/v1/router/resolve', {
    method: 'POST',
    body: JSON.stringify(args.request ?? { thread_kind: 'chat', client_surface: 'flower_surface' }),
  });
}

function normalizeBridgeTargetCache(value: DesktopFlowerHostTargetCache | undefined): DesktopFlowerHostTargetCache {
  return {
    version: 1,
    entries: value?.entries ?? [],
  };
}

function normalizeBridgeThread(thread: DesktopFlowerHostThread): DesktopFlowerHostThread {
  const messages: readonly DesktopFlowerHostChatMessage[] = Array.isArray(thread.messages) ? thread.messages : [];
  const status = [
    'running',
    'waiting_user',
    'waiting_approval',
    'failed',
    'success',
    'read_only',
  ].includes(compact(thread.status))
    ? thread.status
    : 'idle';
  return {
    thread_id: compact(thread.thread_id),
    title: compact(thread.title) || messages[0]?.content?.slice(0, 80) || 'Untitled conversation',
    model_id: compact(thread.model_id),
    created_at_ms: Number(thread.created_at_ms) || Date.now(),
    updated_at_ms: Number(thread.updated_at_ms) || Date.now(),
    status,
    ...(compact(thread.home_host_id) ? { home_host_id: compact(thread.home_host_id) } : {}),
    ...(thread.home_host_kind === 'global' || thread.home_host_kind === 'env_local' ? { home_host_kind: thread.home_host_kind } : {}),
    ...(compact(thread.source_label) ? { source_label: compact(thread.source_label) } : {}),
    ...(Array.isArray(thread.target_labels) ? { target_labels: thread.target_labels } : {}),
    messages,
  };
}
