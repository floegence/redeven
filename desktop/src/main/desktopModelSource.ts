import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';

const STARTUP_REPORT_POLL_MS = 100;
const DEFAULT_MODEL_SOURCE_STARTUP_TIMEOUT_MS = 8_000;
const DEFAULT_MODEL_SOURCE_STOP_TIMEOUT_MS = 3_000;
const TOKEN_ENV_NAME = 'REDEVEN_DESKTOP_MODEL_SOURCE_RUNTIME_CONTROL_TOKEN';

type ModelSourceProcess = ChildProcessByStdio<null, Readable, Readable>;

export type DesktopModelSourceStartupReport = Readonly<{
  status: 'connected';
  session_id: string;
  pid: number;
  configured?: boolean;
  model_count?: number;
  missing_key_provider_ids?: readonly string[];
}>;

export type ManagedDesktopModelSource = Readonly<{
  sessionID: string;
  expiresAtUnixMs: number;
  configured: boolean;
  modelCount: number;
  missingKeyProviderIDs: readonly string[];
  stop: () => Promise<void>;
}>;

export type StartDesktopModelSourceArgs = Readonly<{
  executablePath: string;
  stateRoot: string;
  runtimeControl: DesktopRuntimeControlEndpoint;
  tempRoot?: string;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  signal?: AbortSignal;
  onLog?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}>;

function modelSourceStartupCanceledError(): DOMException {
  return new DOMException('Desktop model source startup was canceled.', 'AbortError');
}

function throwIfModelSourceStartupCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw modelSourceStartupCanceledError();
  }
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfModelSourceStartupCanceled(signal);
  let abort: (() => void) | null = null;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    abort = () => {
      clearTimeout(timer);
      reject(modelSourceStartupCanceledError());
    };
    signal?.addEventListener('abort', abort, { once: true });
  }).finally(() => {
    if (abort) {
      signal?.removeEventListener('abort', abort);
    }
  });
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeReport(raw: unknown, expectedSessionID: string): DesktopModelSourceStartupReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const status = compact(v.status);
  const sessionID = compact(v.session_id);
  const pid = Number(v.pid ?? Number.NaN);
  if (status !== 'connected' || sessionID !== expectedSessionID || !Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  const missing = Array.isArray(v.missing_key_provider_ids)
    ? v.missing_key_provider_ids.map((item) => compact(item)).filter(Boolean)
    : [];
  return {
    status: 'connected',
    session_id: sessionID,
    pid,
    configured: Boolean(v.configured),
    model_count: Number.isFinite(Number(v.model_count)) ? Number(v.model_count) : 0,
    missing_key_provider_ids: missing,
  };
}

async function readStartupReport(reportFile: string, expectedSessionID: string): Promise<DesktopModelSourceStartupReport | null> {
  try {
    const raw = await fs.readFile(reportFile, 'utf8');
    return normalizeReport(JSON.parse(raw), expectedSessionID);
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function stopProcess(child: ModelSourceProcess, timeoutMs: number): Promise<void> {
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

export async function startDesktopModelSource(args: StartDesktopModelSourceArgs): Promise<ManagedDesktopModelSource> {
  throwIfModelSourceStartupCanceled(args.signal);
  const runtimeControl = args.runtimeControl;
  const runtimeControlBaseURL = compact(runtimeControl.base_url);
  const desktopOwnerID = compact(runtimeControl.desktop_owner_id);
  const token = compact(runtimeControl.token);
  if (!runtimeControlBaseURL || !desktopOwnerID || !token) {
    throw new Error('Runtime Control endpoint is missing Desktop model source connection fields.');
  }

  const tempDir = await fs.mkdtemp(path.join(args.tempRoot ?? os.tmpdir(), 'redeven-model-source-'));
  const reportFile = path.join(tempDir, 'startup-report.json');
  const sessionID = `dms_${randomBytes(12).toString('hex')}`;
  const expiresAtUnixMs = Date.now() + 12 * 60 * 60 * 1000;
  const child = spawn(args.executablePath, [
    'desktop-model-source',
    '--state-root',
    args.stateRoot,
    '--runtime-control-url',
    runtimeControlBaseURL,
    '--runtime-control-token-env',
    TOKEN_ENV_NAME,
    '--desktop-owner-id',
    desktopOwnerID,
    '--session-id',
    sessionID,
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
  }) as unknown as ModelSourceProcess;

  let spawnError: Error | null = null;
  child.once('error', (error) => {
    if (args.signal?.aborted || (error as Partial<Error> & Readonly<{ code?: string }>)?.name === 'AbortError') {
      spawnError = modelSourceStartupCanceledError();
      return;
    }
    spawnError = error instanceof Error ? error : new Error(String(error));
  });
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => args.onLog?.('stdout', chunk));
  child.stderr?.on('data', (chunk: string) => args.onLog?.('stderr', chunk));

  const cleanup = async () => {
    await stopProcess(child, args.stopTimeoutMs ?? DEFAULT_MODEL_SOURCE_STOP_TIMEOUT_MS).catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    const deadline = Date.now() + (args.startupTimeoutMs ?? DEFAULT_MODEL_SOURCE_STARTUP_TIMEOUT_MS);
    for (;;) {
      throwIfModelSourceStartupCanceled(args.signal);
      if (spawnError) throw spawnError;
      const report = await readStartupReport(reportFile, sessionID);
      if (report) {
        return {
          sessionID,
          expiresAtUnixMs,
          configured: report.configured === true,
          modelCount: Math.max(0, Math.floor(Number(report.model_count ?? 0))),
          missingKeyProviderIDs: report.missing_key_provider_ids ?? [],
          stop: cleanup,
        };
      }
      if (child.exitCode !== null || child.signalCode) {
        throw new Error(`Desktop model source exited before connecting (${child.exitCode !== null ? `exit code ${child.exitCode}` : `signal ${child.signalCode}`}).`);
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for Desktop model source connection.');
      }
      await delay(STARTUP_REPORT_POLL_MS, args.signal);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
}
