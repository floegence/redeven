import { spawn, type ChildProcessByStdio, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

import {
  DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS,
  desktopSSHAuthority,
  normalizeDesktopSSHHostAccessDetails,
  type DesktopSSHHostAccessDetails,
} from '../shared/desktopSSH';
import { sanitizeDesktopChildEnvironment } from './desktopProcessEnvironment';

const DEFAULT_IDLE_CLOSE_MS = 90_000;
const DEFAULT_READY_POLL_MS = 100;

type SpawnedSSHProcess = ChildProcessByStdio<Writable | null, Readable | null, Readable>;

export type DesktopSSHCommandResult = Readonly<{
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;

export type DesktopSSHStreamingCommand = Readonly<{
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  result: Promise<DesktopSSHCommandResult>;
  closed: Promise<void>;
  kill: (signal?: NodeJS.Signals) => void;
}>;

export type SSHCommandOptions = Readonly<{
  stdinData?: Buffer;
  signal?: AbortSignal;
  onStderr?: (chunk: string) => void;
}>;

export type SSHStreamOptions = Readonly<{
  signal?: AbortSignal;
  onStderr?: (chunk: string) => void;
}>;

export type SSHTransportAcquireInput = Readonly<{
  target: DesktopSSHHostAccessDetails;
  credentialScope: string;
  sshPassword?: string;
  sshBinary?: string;
  readyTimeoutMs?: number;
  persistent?: boolean;
  signal?: AbortSignal;
}>;

export type DesktopSSHTransportLease = Readonly<{
  generation: number;
  target: DesktopSSHHostAccessDetails;
  run: (command: string, options?: SSHCommandOptions) => Promise<DesktopSSHCommandResult>;
  stream: (command: string, options?: SSHStreamOptions) => DesktopSSHStreamingCommand;
  release: () => Promise<void>;
}>;

export interface DesktopSSHTransportManager {
  acquire(input: SSHTransportAcquireInput): Promise<DesktopSSHTransportLease>;
  dispose(): Promise<void>;
}

export class DesktopSSHTransportInterruptedError extends Error {
  constructor(
    readonly targetLabel: string,
    readonly generation: number,
    readonly commandResult?: DesktopSSHCommandResult,
    readonly checkResult?: DesktopSSHCommandResult,
  ) {
    super(`SSH transport to "${targetLabel}" was interrupted.`);
    this.name = 'DesktopSSHTransportInterruptedError';
  }
}

export class DesktopSSHTransportUnavailableError extends Error {
  constructor(message: string, readonly stderr = '') {
    super(message);
    this.name = 'DesktopSSHTransportUnavailableError';
  }
}

export class DesktopSSHTransportAuthenticationError extends DesktopSSHTransportUnavailableError {
  constructor(message: string, stderr = '') {
    super(message, stderr);
    this.name = 'DesktopSSHTransportAuthenticationError';
  }
}

export class DesktopSSHRemoteCommandError extends Error {
  constructor(
    readonly targetLabel: string,
    readonly generation: number,
    readonly commandResult: DesktopSSHCommandResult,
  ) {
    super(`SSH command on "${targetLabel}" exited without interrupting the reusable transport.`);
    this.name = 'DesktopSSHRemoteCommandError';
  }
}

type DesktopSSHTransportManagerDependencies = Readonly<{
  spawnProcess: typeof spawn;
  mkdtemp: typeof fs.mkdtemp;
  writeFile: typeof fs.writeFile;
  rm: typeof fs.rm;
  tempRoot: string;
  setTimer: typeof setTimeout;
  clearTimer: typeof clearTimeout;
  now: () => number;
}>;

type TransportEntry = {
  key: string;
  target: DesktopSSHHostAccessDetails;
  credentialScope: string;
  password: string;
  sshBinary: string;
  tempDir: string;
  controlSocketPath: string;
  askPassScriptPath?: string;
  generation: number;
  master: SpawnedSSHProcess | null;
  masterStderr: string;
  connectTask: Promise<void> | null;
  waiters: number;
  leases: number;
  persistentLeases: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
};

type ManagerOptions = Readonly<{
  idleCloseMs?: number;
  readyPollMs?: number;
  dependencies?: Partial<DesktopSSHTransportManagerDependencies>;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function delay(
  deps: DesktopSSHTransportManagerDependencies,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Canceled.', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = deps.setTimer(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      deps.clearTimer(timer);
      reject(signal?.reason ?? new DOMException('Canceled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function waitForTask<T>(
  task: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    return task;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Canceled.', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException('Canceled.', 'AbortError'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void task.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function targetArgs(target: DesktopSSHHostAccessDetails): string[] {
  return [
    ...(target.ssh_port == null ? [] : ['-p', String(target.ssh_port)]),
    target.ssh_destination,
  ];
}

function transportKey(
  target: DesktopSSHHostAccessDetails,
  sshBinary: string,
  credentialScope: string,
): string {
  return JSON.stringify([
    sshBinary,
    target.ssh_destination,
    target.ssh_port ?? 'default',
    target.auth_mode,
    target.auth_mode === 'password' ? credentialScope : 'key-agent',
  ]);
}

function authArgs(target: DesktopSSHHostAccessDetails): string[] {
  return target.auth_mode === 'key_agent'
    ? ['-o', 'BatchMode=yes']
    : ['-o', 'BatchMode=no', '-o', 'NumberOfPasswordPrompts=3'];
}

function sharedArgs(entry: TransportEntry): string[] {
  return [
    '-T',
    '-x',
    '-o', `ConnectTimeout=${entry.target.connect_timeout_seconds}`,
    '-o', 'RequestTTY=no',
    '-o', 'ForwardX11=no',
    '-o', 'ForwardX11Trusted=no',
    '-o', 'ForwardAgent=no',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    ...authArgs(entry.target),
    '-S', entry.controlSocketPath,
  ];
}

function spawnEnvironment(entry: TransportEntry): NodeJS.ProcessEnv {
  const env = sanitizeDesktopChildEnvironment(process.env);
  if (entry.target.auth_mode !== 'password' || !entry.askPassScriptPath) {
    return env;
  }
  return {
    ...env,
    DISPLAY: process.env.DISPLAY || ':0',
    SSH_ASKPASS: entry.askPassScriptPath,
    SSH_ASKPASS_REQUIRE: 'force',
    REDEVEN_DESKTOP_SSH_PASSWORD: entry.password,
  };
}

function spawnOptions(entry: TransportEntry, signal?: AbortSignal): SpawnOptions {
  return {
    env: spawnEnvironment(entry),
    signal,
  };
}

function processAlive(process: SpawnedSSHProcess | null): process is SpawnedSSHProcess {
  return Boolean(process && process.exitCode === null && !process.signalCode);
}

function appendRecent(existing: string, chunk: string): string {
  const next = existing + chunk;
  return next.length <= 8_000 ? next : next.slice(next.length - 8_000);
}

function transportUnavailableError(message: string, stderr: string): DesktopSSHTransportUnavailableError {
  return /(?:permission denied|authentication failed|too many authentication failures)/iu.test(stderr)
    ? new DesktopSSHTransportAuthenticationError(message, stderr)
    : new DesktopSSHTransportUnavailableError(message, stderr);
}

function buildAskPassScript(): string {
  return [
    '#!/bin/sh',
    'set -eu',
    'printf "%s\\n" "${REDEVEN_DESKTOP_SSH_PASSWORD:-}"',
  ].join('\n');
}

function createDependencies(options: ManagerOptions): DesktopSSHTransportManagerDependencies {
  return {
    spawnProcess: spawn,
    mkdtemp: fs.mkdtemp,
    writeFile: fs.writeFile,
    rm: fs.rm,
    tempRoot: os.tmpdir(),
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    now: Date.now,
    ...options.dependencies,
  };
}

export class DefaultDesktopSSHTransportManager implements DesktopSSHTransportManager {
  private readonly entries = new Map<string, TransportEntry>();
  private readonly entryTasks = new Map<string, Promise<TransportEntry>>();
  private readonly deps: DesktopSSHTransportManagerDependencies;
  private readonly idleCloseMs: number;
  private readonly readyPollMs: number;
  private disposed = false;

  constructor(options: ManagerOptions = {}) {
    this.deps = createDependencies(options);
    this.idleCloseMs = options.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS;
    this.readyPollMs = options.readyPollMs ?? DEFAULT_READY_POLL_MS;
  }

  async acquire(input: SSHTransportAcquireInput): Promise<DesktopSSHTransportLease> {
    if (this.disposed) {
      throw new DesktopSSHTransportUnavailableError('Desktop SSH transport manager is disposed.');
    }
    if (input.signal?.aborted) {
      throw input.signal.reason ?? new DOMException('Canceled.', 'AbortError');
    }
    const target = normalizeDesktopSSHHostAccessDetails(input.target);
    const sshBinary = compact(input.sshBinary) || 'ssh';
    const credentialScope = compact(input.credentialScope);
    if (target.auth_mode === 'password' && credentialScope === '') {
      throw new Error('Password SSH transport requires an explicit credential scope.');
    }
    const password = compact(input.sshPassword);
    const key = transportKey(target, sshBinary, credentialScope);
    let entry = await this.getOrCreateEntry({ key, target, credentialScope, password, sshBinary });
    if (entry && entry.password !== password) {
      if (entry.leases > 0) {
        throw new DesktopSSHTransportUnavailableError('SSH credentials changed while the transport is in use.');
      }
      await this.closeEntry(entry);
      entry = await this.getOrCreateEntry({ key, target, credentialScope, password, sshBinary });
    }
    if (entry.idleTimer) {
      this.deps.clearTimer(entry.idleTimer);
      entry.idleTimer = null;
    }
    entry.waiters += 1;
    try {
      await waitForTask(this.ensureConnected(entry, input.readyTimeoutMs), input.signal);
    } catch (error) {
      if (entry.waiters === 1 && entry.leases === 0) {
        await this.closeEntry(entry, true);
      }
      throw error;
    } finally {
      entry.waiters = Math.max(0, entry.waiters - 1);
    }
    entry.leases += 1;
    if (input.persistent === true) {
      entry.persistentLeases += 1;
    }
    return this.createLease(entry, input.persistent === true);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await Promise.allSettled([...this.entryTasks.values()]);
    await Promise.allSettled([...this.entries.values()].map((entry) => this.closeEntry(entry, true)));
    this.entries.clear();
    this.entryTasks.clear();
  }

  private async getOrCreateEntry(input: Readonly<{
    key: string;
    target: DesktopSSHHostAccessDetails;
    credentialScope: string;
    password: string;
    sshBinary: string;
  }>): Promise<TransportEntry> {
    const existing = this.entries.get(input.key);
    if (existing) {
      return existing;
    }
    const pending = this.entryTasks.get(input.key);
    if (pending) {
      return pending;
    }
    const task = this.createEntry(input).then(async (entry) => {
      if (this.disposed) {
        await this.closeEntry(entry, true);
        throw new DesktopSSHTransportUnavailableError('Desktop SSH transport manager is disposed.');
      }
      this.entries.set(input.key, entry);
      return entry;
    }).finally(() => {
      this.entryTasks.delete(input.key);
    });
    this.entryTasks.set(input.key, task);
    return task;
  }

  private async createEntry(input: Readonly<{
    key: string;
    target: DesktopSSHHostAccessDetails;
    credentialScope: string;
    password: string;
    sshBinary: string;
  }>): Promise<TransportEntry> {
    const tempDir = await this.deps.mkdtemp(path.join(this.deps.tempRoot, 'rdv-ssh-transport-'));
    const askPassScriptPath = input.target.auth_mode === 'password'
      ? path.join(tempDir, 'askpass.sh')
      : undefined;
    if (askPassScriptPath) {
      await this.deps.writeFile(askPassScriptPath, buildAskPassScript(), { mode: 0o700 });
    }
    return {
      ...input,
      tempDir,
      controlSocketPath: path.join(tempDir, 'm.sock'),
      askPassScriptPath,
      generation: 0,
      master: null,
      masterStderr: '',
      connectTask: null,
      waiters: 0,
      leases: 0,
      persistentLeases: 0,
      idleTimer: null,
      closing: false,
    };
  }

  private async ensureConnected(
    entry: TransportEntry,
    readyTimeoutMs = Math.max(
      1_000,
      (entry.target.connect_timeout_seconds ?? DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS) * 1_000 + 1_000,
    ),
  ): Promise<void> {
    if (processAlive(entry.master)) {
      return;
    }
    if (entry.connectTask) {
      return entry.connectTask;
    }
    entry.connectTask = this.connect(entry, readyTimeoutMs).finally(() => {
      entry.connectTask = null;
    });
    return entry.connectTask;
  }

  private async connect(entry: TransportEntry, readyTimeoutMs: number): Promise<void> {
    if (entry.closing || this.disposed) {
      throw new DesktopSSHTransportUnavailableError('Desktop SSH transport is closing.');
    }
    await this.deps.rm(entry.controlSocketPath, { force: true }).catch(() => undefined);
    entry.generation += 1;
    entry.masterStderr = '';
    const master = this.deps.spawnProcess(entry.sshBinary, [
      ...sharedArgs(entry),
      '-M',
      '-N',
      '-o', 'ControlMaster=yes',
      '-o', 'ControlPersist=no',
      ...targetArgs(entry.target),
    ], {
      ...spawnOptions(entry),
      stdio: ['ignore', 'ignore', 'pipe'],
    }) as SpawnedSSHProcess;
    entry.master = master;
    master.stderr.setEncoding('utf8');
    master.stderr.on('data', (chunk: string) => {
      entry.masterStderr = appendRecent(entry.masterStderr, chunk);
    });
    master.once('error', (error) => {
      if ((error as NodeJS.ErrnoException)?.code !== 'ABORT_ERR') {
        entry.masterStderr = appendRecent(
          entry.masterStderr,
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    });
    master.once('close', () => {
      if (entry.master === master) {
        entry.master = null;
        entry.generation += 1;
      }
    });
    const deadline = this.deps.now() + Math.max(1, readyTimeoutMs);
    for (;;) {
      if (!processAlive(master)) {
        throw transportUnavailableError(
          `SSH connection to "${desktopSSHAuthority(entry.target)}" exited before the control socket became ready.`,
          entry.masterStderr,
        );
      }
      const check = await this.runProcess(entry, [
        ...sharedArgs(entry),
        '-O', 'check',
        ...targetArgs(entry.target),
      ]);
      if (check.exit_code === 0 && processAlive(master)) {
        return;
      }
      if (this.deps.now() >= deadline) {
        master.kill('SIGTERM');
        throw transportUnavailableError(
          `Timed out waiting for SSH control connection to "${desktopSSHAuthority(entry.target)}".`,
          compact(check.stderr) !== ''
            ? `[ssh -O check]\n${check.stderr}`
            : entry.masterStderr,
        );
      }
      await delay(this.deps, this.readyPollMs);
    }
  }

  private createLease(entry: TransportEntry, persistent: boolean): DesktopSSHTransportLease {
    const generation = entry.generation;
    let released = false;
    const assertCurrent = () => {
      if (
        released
        || entry.closing
        || entry.generation !== generation
        || !processAlive(entry.master)
      ) {
        throw new DesktopSSHTransportInterruptedError(desktopSSHAuthority(entry.target), generation);
      }
    };
    return {
      generation,
      target: entry.target,
      run: async (command, options = {}) => {
        assertCurrent();
        const result = await this.runProcess(entry, [
          ...sharedArgs(entry),
          ...targetArgs(entry.target),
          command,
        ], options.stdinData, options.signal, options.onStderr);
        if (result.exit_code !== 0) {
          const check = await this.runProcess(entry, [
            ...sharedArgs(entry),
            '-O', 'check',
            ...targetArgs(entry.target),
          ], undefined, options.signal);
          if (
            entry.generation !== generation
            || !processAlive(entry.master)
            || check.exit_code !== 0
          ) {
            throw new DesktopSSHTransportInterruptedError(
              desktopSSHAuthority(entry.target),
              generation,
              result,
              check,
            );
          }
        }
        return result;
      },
      stream: (command, options = {}) => {
        assertCurrent();
        let terminationRequested = false;
        const child = this.deps.spawnProcess(entry.sshBinary, [
          ...sharedArgs(entry),
          ...targetArgs(entry.target),
          command,
        ], {
          ...spawnOptions(entry, options.signal),
          stdio: ['pipe', 'pipe', 'pipe'],
        }) as ChildProcessByStdio<Writable, Readable, Readable>;
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => options.onStderr?.(chunk));
        const result = new Promise<DesktopSSHCommandResult>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', (exitCode, closeSignal) => {
            resolve({
              exit_code: exitCode,
              signal: closeSignal,
              stdout: '',
              stderr: '',
            });
          });
        });
        const closed = result.then(async (commandResult) => {
          if (terminationRequested) {
            return;
          }
          if (commandResult.exit_code === 0 && !commandResult.signal) {
            return;
          }
          if (entry.generation !== generation || !processAlive(entry.master)) {
            throw new DesktopSSHTransportInterruptedError(
              desktopSSHAuthority(entry.target),
              generation,
              commandResult,
            );
          }
          const check = await this.runProcess(entry, [
            ...sharedArgs(entry),
            '-O', 'check',
            ...targetArgs(entry.target),
          ]);
          if (entry.generation !== generation || !processAlive(entry.master) || check.exit_code !== 0) {
            throw new DesktopSSHTransportInterruptedError(
              desktopSSHAuthority(entry.target),
              generation,
              commandResult,
              check,
            );
          }
          throw new DesktopSSHRemoteCommandError(
            desktopSSHAuthority(entry.target),
            generation,
            commandResult,
          );
        });
        return {
          stdin: child.stdin,
          stdout: child.stdout,
          stderr: child.stderr,
          result,
          closed,
          kill: (signal = 'SIGTERM') => {
            terminationRequested = true;
            child.kill(signal);
          },
        };
      },
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        entry.leases = Math.max(0, entry.leases - 1);
        if (persistent) {
          entry.persistentLeases = Math.max(0, entry.persistentLeases - 1);
        }
        if (entry.leases === 0 && !entry.closing && !this.disposed) {
          entry.idleTimer = this.deps.setTimer(() => {
            entry.idleTimer = null;
            void this.closeEntry(entry);
          }, this.idleCloseMs);
        }
      },
    };
  }

  private runProcess(
    entry: TransportEntry,
    args: readonly string[],
    stdinData?: Buffer,
    signal?: AbortSignal,
    onStderr?: (chunk: string) => void,
  ): Promise<DesktopSSHCommandResult> {
    return new Promise((resolve, reject) => {
      let child: SpawnedSSHProcess;
      try {
        child = this.deps.spawnProcess(entry.sshBinary, args, {
          ...spawnOptions(entry, signal),
          stdio: [stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        }) as SpawnedSSHProcess;
      } catch (error) {
        reject(error);
        return;
      }
      let stdout = '';
      let stderr = '';
      let spawnError: Error | null = null;
      child.once('error', (error) => {
        spawnError = error instanceof Error ? error : new Error(String(error));
      });
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        onStderr?.(chunk);
      });
      if (stdinData) {
        child.stdin?.end(stdinData);
      }
      child.once('close', (exitCode, closeSignal) => {
        if (spawnError) {
          reject(spawnError);
          return;
        }
        resolve({
          exit_code: exitCode,
          signal: closeSignal,
          stdout,
          stderr,
        });
      });
    });
  }

  private async closeEntry(entry: TransportEntry, force = false): Promise<void> {
    if (entry.closing || (!force && entry.leases > 0)) {
      return;
    }
    entry.closing = true;
    if (entry.idleTimer) {
      this.deps.clearTimer(entry.idleTimer);
      entry.idleTimer = null;
    }
    const master = entry.master;
    entry.master = null;
    if (processAlive(master)) {
      const closed = new Promise<void>((resolve) => master.once('close', () => resolve()));
      master.kill('SIGTERM');
      await closed;
    }
    await this.deps.rm(entry.tempDir, { recursive: true, force: true }).catch(() => undefined);
    if (this.entries.get(entry.key) === entry) {
      this.entries.delete(entry.key);
    }
  }
}
