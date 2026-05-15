import * as childProcess from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import type { DesktopRuntimeHostAccess } from '../shared/desktopRuntimePlacement';
import type { DesktopSSHEnvironmentDetails } from '../shared/desktopSSH';

export type RuntimeHostCommandResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

export type RuntimeHostAccessExecutor = Readonly<{
  host_access: DesktopRuntimeHostAccess;
  run: (argv: readonly string[], options?: RuntimeHostCommandOptions) => Promise<RuntimeHostCommandResult>;
}>;

export type RuntimeHostCommandOptions = Readonly<{
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdinData?: Buffer;
  signal?: AbortSignal;
}>;

type SpawnedCommand = ChildProcessByStdio<Writable | null, Readable | null, Readable | null>;
type SpawnedStreamingCommand = ChildProcessByStdio<Writable, Readable, Readable>;

export type RuntimeHostStreamingCommand = Readonly<{
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  closed: Promise<void>;
  kill: (signal?: NodeJS.Signals) => void;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function shellQuote(value: string): string {
  if (value === '') {
    return "''";
  }
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function sshTargetArgs(target: DesktopSSHEnvironmentDetails): readonly string[] {
  return [
    ...(target.ssh_port == null ? [] : ['-p', String(target.ssh_port)]),
    target.ssh_destination,
  ];
}

function sshRemoteCommand(argv: readonly string[]): string {
  return argv.map((part) => shellQuote(String(part ?? ''))).join(' ');
}

function sshRemoteEnvPrefix(env: NodeJS.ProcessEnv | undefined): string {
  const entries = Object.entries(env ?? {})
    .map(([key, value]) => [compact(key), value == null ? '' : String(value)] as const)
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key));
  if (entries.length === 0) {
    return '';
  }
  return `env ${entries.map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ')} `;
}

function sshRemoteCommandWithEnv(argv: readonly string[], env: NodeJS.ProcessEnv | undefined): string {
  return `${sshRemoteEnvPrefix(env)}${sshRemoteCommand(argv)}`;
}

function spawnCommand(
  command: string,
  args: readonly string[],
  options: RuntimeHostCommandOptions,
): Promise<RuntimeHostCommandResult> {
  if (compact(command) === '' || args.some((arg) => compact(arg) === '')) {
    return Promise.reject(new Error('Runtime host command argv must be non-empty.'));
  }
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      cwd: compact(options.cwd) || undefined,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: [options.stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      signal: options.signal,
    }) as SpawnedCommand;
    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    if (options.stdinData && child.stdin) {
      child.stdin.end(options.stdinData);
    }
    child.once('close', (exitCode, closeSignal) => {
      if (exitCode === 0 && !closeSignal) {
        resolve({ stdout, stderr });
        return;
      }
      const reason = closeSignal ? `signal ${closeSignal}` : `exit code ${exitCode ?? 'unknown'}`;
      reject(new Error(`${command} failed with ${reason}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

function spawnStreamingCommand(
  command: string,
  args: readonly string[],
  options: RuntimeHostCommandOptions,
): RuntimeHostStreamingCommand {
  if (compact(command) === '' || args.some((arg) => compact(arg) === '')) {
    throw new Error('Runtime host command argv must be non-empty.');
  }
  const child = childProcess.spawn(command, args, {
    cwd: compact(options.cwd) || undefined,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: options.signal,
  }) as SpawnedStreamingCommand;
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, closeSignal) => {
      if (exitCode === 0 && !closeSignal) {
        resolve();
        return;
      }
      const reason = closeSignal ? `signal ${closeSignal}` : `exit code ${exitCode ?? 'unknown'}`;
      reject(new Error(`${command} failed with ${reason}`));
    });
  });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    closed,
    kill: (signal = 'SIGTERM') => {
      child.kill(signal);
    },
  };
}

export function createLocalRuntimeHostExecutor(): RuntimeHostAccessExecutor {
  return {
    host_access: { kind: 'local_host' },
    run: async (argv, options = {}) => {
      if (argv.length === 0) {
        throw new Error('Runtime host command argv must be non-empty.');
      }
      const [command, ...args] = argv.map((part) => compact(part));
      return spawnCommand(command!, args, options);
    },
  };
}

export function spawnLocalRuntimeHostCommand(
  argv: readonly string[],
  options: RuntimeHostCommandOptions = {},
): RuntimeHostStreamingCommand {
  if (argv.length === 0) {
    throw new Error('Runtime host command argv must be non-empty.');
  }
  const [command, ...args] = argv.map((part) => compact(part));
  return spawnStreamingCommand(command!, args, options);
}

export function createSSHRuntimeHostExecutor(
  ssh: DesktopSSHEnvironmentDetails,
  options: Readonly<{
    sshBinary?: string;
  }> = {},
): RuntimeHostAccessExecutor {
  return {
    host_access: { kind: 'ssh_host', ssh },
    run: async (argv, commandOptions = {}) => {
      if (argv.length === 0) {
        throw new Error('Runtime host command argv must be non-empty.');
      }
      const sshBinary = compact(options.sshBinary) || 'ssh';
      const args = [
        '-T',
        '-x',
        '-o',
        `ConnectTimeout=${ssh.connect_timeout_seconds}`,
        ...(ssh.auth_mode === 'key_agent' ? ['-o', 'BatchMode=yes'] : []),
        ...sshTargetArgs(ssh),
        sshRemoteCommandWithEnv(argv, commandOptions.env),
      ];
      return spawnCommand(sshBinary, args, { ...commandOptions, env: undefined });
    },
  };
}

export function spawnSSHRuntimeHostCommand(
  ssh: DesktopSSHEnvironmentDetails,
  argv: readonly string[],
  options: RuntimeHostCommandOptions & Readonly<{
    sshBinary?: string;
  }> = {},
): RuntimeHostStreamingCommand {
  if (argv.length === 0) {
    throw new Error('Runtime host command argv must be non-empty.');
  }
  const sshBinary = compact(options.sshBinary) || 'ssh';
  const args = [
    '-T',
    '-x',
    '-o',
    `ConnectTimeout=${ssh.connect_timeout_seconds}`,
    ...(ssh.auth_mode === 'key_agent' ? ['-o', 'BatchMode=yes'] : []),
    ...sshTargetArgs(ssh),
    sshRemoteCommandWithEnv(argv, options.env),
  ];
  return spawnStreamingCommand(sshBinary, args, { ...options, env: undefined });
}
