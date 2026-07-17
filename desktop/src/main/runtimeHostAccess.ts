import * as childProcess from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import type { DesktopRuntimeHostAccess } from '../shared/desktopRuntimePlacement';
import { desktopSSHAuthority, type DesktopSSHHostAccessDetails } from '../shared/desktopSSH';
import type { DesktopFailureCode, DesktopFailureDiagnostic } from '../shared/desktopOperationFailure';
import {
  DesktopOperationFailureError,
  desktopOperationFailurePresentation,
} from './desktopOperationFailure';
import {
  DesktopHostCommandNotFoundError,
  desktopHostCommandEnvironment,
  isDesktopHostCommandNotFoundError,
  resolveDesktopHostCommand,
} from './desktopHostCommand';
import { sanitizeDesktopChildEnvironment } from './desktopProcessEnvironment';
import type {
  DesktopSSHTransportLease,
  DesktopSSHTransportManager,
} from './sshTransportManager';

export type RuntimeHostCommandResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

export type RuntimeHostAccessExecutor = Readonly<{
  host_access: DesktopRuntimeHostAccess;
  run: (argv: readonly string[], options?: RuntimeHostCommandOptions) => Promise<RuntimeHostCommandResult>;
  release: () => Promise<void>;
}>;

export type RuntimeHostCommandOptions = Readonly<{
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdinData?: Buffer;
  signal?: AbortSignal;
}>;

type SpawnedCommand = ChildProcessByStdio<Writable | null, Readable | null, Readable | null>;
type SpawnedStreamingCommand = ChildProcessByStdio<Writable, Readable, Readable>;
type RuntimeHostFailureContext = Readonly<{
  code?: DesktopFailureCode;
  title: string;
  summary: string;
  detail?: string;
  recoveryHint?: string;
  targetLabel?: string;
}>;
type SpawnPreparation = Readonly<{
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
}>;

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

function commandFailureDiagnostics(args: Readonly<{
  command: string;
  reason: string;
  stdout?: string;
  stderr?: string;
}>): readonly DesktopFailureDiagnostic[] {
  return [
    {
      channel: 'process_exit',
      label: 'Process exit',
      text: args.reason,
    },
    {
      channel: 'command',
      label: 'Command',
      text: args.command,
    },
    {
      channel: 'stdout',
      label: 'Command stdout',
      text: compact(args.stdout),
    },
    {
      channel: 'stderr',
      label: 'Command stderr',
      text: compact(args.stderr),
    },
  ].filter((item) => item.text !== '');
}

function runtimeHostCommandFailure(
  context: RuntimeHostFailureContext,
  args: Readonly<{
    command: string;
    reason: string;
    stdout?: string;
    stderr?: string;
    cause?: unknown;
  }>,
): DesktopOperationFailureError {
  return new DesktopOperationFailureError(desktopOperationFailurePresentation({
    code: context.code ?? 'runtime_host_command_failed',
    title: context.title,
    summary: context.summary,
    detail: context.detail,
    recoveryHint: context.recoveryHint,
    targetLabel: context.targetLabel,
    diagnostics: commandFailureDiagnostics(args),
  }), { cause: args.cause });
}

// IMPORTANT: Host command stdout/stderr are diagnostics. Runtime host access
// must not splice command output into Error.message for UI-facing paths.

function mergedProcessEnvironment(options: RuntimeHostCommandOptions): NodeJS.ProcessEnv {
  return sanitizeDesktopChildEnvironment({
    ...process.env,
    ...options.env,
  });
}

function prepareSpawnCommand(
  command: string,
  args: readonly string[],
  options: RuntimeHostCommandOptions,
): SpawnPreparation {
  const baseEnv = mergedProcessEnvironment(options);
  const resolution = resolveDesktopHostCommand(command, { env: baseEnv });
  return {
    command: resolution.command,
    args,
    env: desktopHostCommandEnvironment(baseEnv),
  };
}

function commandSpawnError(command: string, error: unknown): Error {
  const nodeError = error && typeof error === 'object'
    ? error as NodeJS.ErrnoException
    : null;
  if (nodeError?.code === 'ENOENT') {
    return new DesktopHostCommandNotFoundError(command, []);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function rejectSpawnError(
  reject: (reason?: unknown) => void,
  failureContext: RuntimeHostFailureContext,
  command: string,
  error: unknown,
  output: Readonly<{
    stdout?: string;
    stderr?: string;
  }> = {},
): void {
  const spawnError = commandSpawnError(command, error);
  if (isDesktopHostCommandNotFoundError(spawnError)) {
    reject(spawnError);
    return;
  }
  reject(runtimeHostCommandFailure(failureContext, {
    command,
    reason: spawnError.message,
    stdout: output.stdout,
    stderr: output.stderr,
    cause: spawnError,
  }));
}

function spawnCommand(
  command: string,
  args: readonly string[],
  options: RuntimeHostCommandOptions,
  failureContext: RuntimeHostFailureContext,
): Promise<RuntimeHostCommandResult> {
  if (compact(command) === '' || args.some((arg) => compact(arg) === '')) {
    return Promise.reject(new Error('Runtime host command argv must be non-empty.'));
  }
  let prepared: SpawnPreparation;
  try {
    prepared = prepareSpawnCommand(command, args, options);
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(prepared.command, prepared.args, {
      cwd: compact(options.cwd) || undefined,
      env: prepared.env,
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
    child.once('error', (error) => {
      rejectSpawnError(reject, failureContext, command, error, { stdout, stderr });
    });
    if (options.stdinData && child.stdin) {
      child.stdin.end(options.stdinData);
    }
    child.once('close', (exitCode, closeSignal) => {
      if (exitCode === 0 && !closeSignal) {
        resolve({ stdout, stderr });
        return;
      }
      const reason = closeSignal ? `signal ${closeSignal}` : `exit code ${exitCode ?? 'unknown'}`;
      reject(runtimeHostCommandFailure(failureContext, {
        command,
        reason,
        stdout,
        stderr,
      }));
    });
  });
}

function spawnStreamingCommand(
  command: string,
  args: readonly string[],
  options: RuntimeHostCommandOptions,
  failureContext: RuntimeHostFailureContext,
): RuntimeHostStreamingCommand {
  if (compact(command) === '' || args.some((arg) => compact(arg) === '')) {
    throw new Error('Runtime host command argv must be non-empty.');
  }
  const prepared = prepareSpawnCommand(command, args, options);
  const child = childProcess.spawn(prepared.command, prepared.args, {
    cwd: compact(options.cwd) || undefined,
    env: prepared.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: options.signal,
  }) as SpawnedStreamingCommand;
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', (error) => {
      rejectSpawnError(reject, failureContext, command, error);
    });
    child.once('close', (exitCode, closeSignal) => {
      if (exitCode === 0 && !closeSignal) {
        resolve();
        return;
      }
      const reason = closeSignal ? `signal ${closeSignal}` : `exit code ${exitCode ?? 'unknown'}`;
      reject(runtimeHostCommandFailure(failureContext, {
        command,
        reason,
      }));
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
      return spawnCommand(command!, args, options, {
        title: 'Runtime Host Command Failed',
        summary: 'Desktop could not run the runtime host command on this device.',
        detail: 'The local command did not complete successfully.',
        targetLabel: 'Local Host',
      });
    },
    release: async () => undefined,
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
  return spawnStreamingCommand(command!, args, options, {
    title: 'Runtime Host Command Failed',
    summary: 'Desktop could not run the runtime host command on this device.',
    detail: 'The local streaming command did not complete successfully.',
    targetLabel: 'Local Host',
  });
}

export function createSSHRuntimeHostExecutor(
  transportManager: DesktopSSHTransportManager,
  ssh: DesktopSSHHostAccessDetails,
  options: Readonly<{
    sshBinary?: string;
    sshPassword?: string;
    credentialScope: string;
  }>,
): RuntimeHostAccessExecutor {
  let leaseTask: Promise<DesktopSSHTransportLease> | null = null;
  let released = false;
  const acquireLease = async (signal?: AbortSignal): Promise<DesktopSSHTransportLease> => {
    if (released) {
      throw new Error('SSH runtime host executor has been released.');
    }
    if (!leaseTask) {
      leaseTask = transportManager.acquire({
        target: ssh,
        credentialScope: options.credentialScope,
        sshPassword: options.sshPassword,
        sshBinary: options.sshBinary,
        signal,
      });
    }
    return leaseTask;
  };
  return {
    host_access: { kind: 'ssh_host', ssh },
    run: async (argv, commandOptions = {}) => {
      if (argv.length === 0) {
        throw new Error('Runtime host command argv must be non-empty.');
      }
      const targetLabel = desktopSSHAuthority(ssh);
      try {
        const lease = await acquireLease(commandOptions.signal);
        const result = await lease.run(sshRemoteCommandWithEnv(argv, commandOptions.env), {
          stdinData: commandOptions.stdinData,
          signal: commandOptions.signal,
        });
        if (result.exit_code === 0 && !result.signal) {
          return { stdout: result.stdout, stderr: result.stderr };
        }
        throw runtimeHostCommandFailure({
          title: 'SSH Host Command Failed',
          summary: `SSH command on "${targetLabel}" failed.`,
          detail: 'Desktop could not run the requested runtime management command on this SSH host.',
          recoveryHint: 'Check the SSH host, ~/.ssh/config alias, VPN, network connection, and authentication method.',
          targetLabel,
        }, {
          command: argv.join(' '),
          reason: result.signal ? `signal ${result.signal}` : `exit code ${result.exit_code ?? 'unknown'}`,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      } catch (error) {
        if (error instanceof DesktopOperationFailureError) {
          throw error;
        }
        throw runtimeHostCommandFailure({
          title: 'SSH Host Command Failed',
          summary: `SSH command on "${targetLabel}" failed.`,
          detail: 'Desktop could not run the requested runtime management command on this SSH host.',
          recoveryHint: 'Check the SSH host, ~/.ssh/config alias, VPN, network connection, and authentication method.',
          targetLabel,
        }, {
          command: argv.join(' '),
          reason: error instanceof Error ? error.message : String(error),
          cause: error,
        });
      }
    },
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      await leaseTask?.then((lease) => lease.release()).catch(() => undefined);
    },
  };
}

export async function spawnSSHRuntimeHostCommand(
  transportManager: DesktopSSHTransportManager,
  ssh: DesktopSSHHostAccessDetails,
  argv: readonly string[],
  options: RuntimeHostCommandOptions & Readonly<{
    sshBinary?: string;
    sshPassword?: string;
    credentialScope: string;
  }>,
): Promise<RuntimeHostStreamingCommand> {
  if (argv.length === 0) {
    throw new Error('Runtime host command argv must be non-empty.');
  }
  const targetLabel = desktopSSHAuthority(ssh);
  const lease = await transportManager.acquire({
    target: ssh,
    credentialScope: options.credentialScope,
    sshPassword: options.sshPassword,
    sshBinary: options.sshBinary,
    persistent: true,
    signal: options.signal,
  });
  let command: ReturnType<DesktopSSHTransportLease['stream']>;
  try {
    command = lease.stream(sshRemoteCommandWithEnv(argv, options.env), {
      signal: options.signal,
    });
  } catch (error) {
    await lease.release();
    throw runtimeHostCommandFailure({
      title: 'SSH Host Command Failed',
      summary: `SSH command on "${targetLabel}" failed.`,
      detail: 'Desktop could not keep the requested runtime management stream open on this SSH host.',
      recoveryHint: 'Check the SSH host, ~/.ssh/config alias, VPN, network connection, and authentication method.',
      targetLabel,
    }, {
      command: argv.join(' '),
      reason: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }
  const closed = command.closed.finally(() => lease.release());
  return {
    stdin: command.stdin,
    stdout: command.stdout,
    stderr: command.stderr,
    closed,
    kill: command.kill,
  };
}
