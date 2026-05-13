import { spawn, type ChildProcessByStdio } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

const STARTUP_REPORT_POLL_MS = 100;
const DEFAULT_BROKER_STARTUP_TIMEOUT_MS = 8_000;
const DEFAULT_BROKER_STOP_TIMEOUT_MS = 3_000;
const TOKEN_ENV_NAME = 'REDEVEN_DESKTOP_AI_BROKER_TOKEN';

type BrokerProcess = ChildProcessByStdio<null, Readable, Readable>;

export type DesktopAIBrokerStartupReport = Readonly<{
  status: 'ready';
  url: string;
  pid: number;
  configured?: boolean;
  model_count?: number;
  missing_key_provider_ids?: readonly string[];
}>;

export type ManagedDesktopAIBroker = Readonly<{
  url: string;
  token: string;
  sessionID: string;
  expiresAtUnixMs: number;
  configured: boolean;
  modelCount: number;
  missingKeyProviderIDs: readonly string[];
  stop: () => Promise<void>;
}>;

export type StartDesktopAIBrokerArgs = Readonly<{
  executablePath: string;
  stateRoot: string;
  runtimeKey: `ssh:${string}`;
  tempRoot?: string;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  signal?: AbortSignal;
  onLog?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}>;

function brokerStartupCanceledError(): DOMException {
  return new DOMException('Desktop AI Broker startup was canceled.', 'AbortError');
}

function throwIfBrokerStartupCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw brokerStartupCanceledError();
  }
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfBrokerStartupCanceled(signal);
  let abort: (() => void) | null = null;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    abort = () => {
      clearTimeout(timer);
      reject(brokerStartupCanceledError());
    };
    signal?.addEventListener('abort', abort, { once: true });
  }).finally(() => {
    if (abort) {
      signal?.removeEventListener('abort', abort);
    }
  });
}

function normalizeReport(raw: unknown): DesktopAIBrokerStartupReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const status = String(v.status ?? '').trim();
  const url = String(v.url ?? '').trim();
  const pid = Number(v.pid ?? Number.NaN);
  if (status !== 'ready' || !url || !Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  const missing = Array.isArray(v.missing_key_provider_ids)
    ? v.missing_key_provider_ids.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  return {
    status: 'ready',
    url,
    pid,
    configured: Boolean(v.configured),
    model_count: Number.isFinite(Number(v.model_count)) ? Number(v.model_count) : 0,
    missing_key_provider_ids: missing,
  };
}

async function readStartupReport(reportFile: string): Promise<DesktopAIBrokerStartupReport | null> {
  try {
    const raw = await fs.readFile(reportFile, 'utf8');
    return normalizeReport(JSON.parse(raw));
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function stopProcess(child: BrokerProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode) {
    return;
  }
  child.kill('SIGTERM');
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const timedOut = delay(timeoutMs).then(() => 'timeout' as const);
  if (await Promise.race([exited, timedOut]) === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

export async function startDesktopAIBroker(args: StartDesktopAIBrokerArgs): Promise<ManagedDesktopAIBroker> {
  throwIfBrokerStartupCanceled(args.signal);
  const tempDir = await fs.mkdtemp(path.join(args.tempRoot ?? os.tmpdir(), 'redeven-ai-broker-'));
  const reportFile = path.join(tempDir, 'startup-report.json');
  const token = randomBytes(32).toString('base64url');
  const sessionID = `broker_${randomBytes(12).toString('hex')}`;
  const expiresAtUnixMs = Date.now() + 12 * 60 * 60 * 1000;
  const child = spawn(args.executablePath, [
    'desktop-ai-broker',
    '--state-root',
    args.stateRoot,
    '--bind',
    '127.0.0.1:0',
    '--token-env',
    TOKEN_ENV_NAME,
    '--session-id',
    sessionID,
    '--ssh-runtime-key',
    args.runtimeKey,
    '--expires-at-unix-ms',
    String(expiresAtUnixMs),
    '--startup-report-file',
    reportFile,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    signal: args.signal,
    env: {
      ...process.env,
      [TOKEN_ENV_NAME]: token,
    },
  }) as unknown as BrokerProcess;

  let spawnError: Error | null = null;
  child.once('error', (error) => {
    if (args.signal?.aborted || (error as Partial<Error> & Readonly<{ code?: string }>)?.name === 'AbortError') {
      spawnError = brokerStartupCanceledError();
      return;
    }
    spawnError = error instanceof Error ? error : new Error(String(error));
  });
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => args.onLog?.('stdout', chunk));
  child.stderr?.on('data', (chunk: string) => args.onLog?.('stderr', chunk));

  const cleanup = async () => {
    await stopProcess(child, args.stopTimeoutMs ?? DEFAULT_BROKER_STOP_TIMEOUT_MS).catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    const deadline = Date.now() + (args.startupTimeoutMs ?? DEFAULT_BROKER_STARTUP_TIMEOUT_MS);
    for (;;) {
      throwIfBrokerStartupCanceled(args.signal);
      if (spawnError) throw spawnError;
      const report = await readStartupReport(reportFile);
      if (report) {
        return {
          url: report.url,
          token,
          sessionID,
          expiresAtUnixMs,
          configured: report.configured === true,
          modelCount: Math.max(0, Math.floor(Number(report.model_count ?? 0))),
          missingKeyProviderIDs: report.missing_key_provider_ids ?? [],
          stop: cleanup,
        };
      }
      if (child.exitCode !== null || child.signalCode) {
        throw new Error(`Desktop AI Broker exited before reporting readiness (${child.exitCode !== null ? `exit code ${child.exitCode}` : `signal ${child.signalCode}`}).`);
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for Desktop AI Broker readiness.');
      }
      await delay(STARTUP_REPORT_POLL_MS, args.signal);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
}
