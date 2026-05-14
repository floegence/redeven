import { spawn, type ChildProcessByStdio } from 'node:child_process';
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
  signal?: AbortSignal;
}>;

type SpawnedCommand = ChildProcessByStdio<Writable | null, Readable | null, Readable | null>;

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

function spawnCommand(
  command: string,
  args: readonly string[],
  options: RuntimeHostCommandOptions,
  stdin: 'pipe' | 'ignore' = 'ignore',
): Promise<RuntimeHostCommandResult> {
  if (compact(command) === '' || args.some((arg) => compact(arg) === '')) {
    return Promise.reject(new Error('Runtime host command argv must be non-empty.'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: compact(options.cwd) || undefined,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: [stdin, 'pipe', 'pipe'],
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
        sshRemoteCommand(argv),
      ];
      return spawnCommand(sshBinary, args, commandOptions);
    },
  };
}
