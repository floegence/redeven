import * as childProcess from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import type { DesktopRuntimeHostAccess } from '../shared/desktopRuntimePlacement';
import { desktopSSHAuthority, type DesktopSSHHostAccessDetails } from '../shared/desktopSSH';
import type { DesktopFailureCode, DesktopFailureDiagnostic } from '../shared/desktopOperationFailure';
import {
  DesktopOperationFailureError,
  desktopOperationFailurePresentation,
} from './desktopOperationFailure';

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
type RuntimeHostFailureContext = Readonly<{
  code?: DesktopFailureCode;
  title: string;
  summary: string;
  detail?: string;
  recoveryHint?: string;
  targetLabel?: string;
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

function sshTargetArgs(target: DesktopSSHHostAccessDetails): readonly string[] {
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

function buildSSHPasswordAskPassScript(): string {
  return [
    '#!/bin/sh',
    'set -eu',
    'printf "%s\\n" "${REDEVEN_DESKTOP_SSH_PASSWORD:-}"',
  ].join('\n');
}

async function createSSHPasswordAskPassScript(): Promise<Readonly<{
  scriptPath: string;
  cleanup: () => Promise<void>;
}>> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rdv-host-ssh-'));
  const scriptPath = path.join(tempDir, 'redeven-ssh-password-askpass.sh');
  await fs.writeFile(scriptPath, buildSSHPasswordAskPassScript(), { mode: 0o700 });
  return {
    scriptPath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
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
    child.once('error', (error) => {
      reject(runtimeHostCommandFailure(failureContext, {
        command,
        reason: error.message,
        stdout,
        stderr,
        cause: error,
      }));
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
    child.once('error', (error) => {
      reject(runtimeHostCommandFailure(failureContext, {
        command,
        reason: error.message,
        cause: error,
      }));
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
  ssh: DesktopSSHHostAccessDetails,
  options: Readonly<{
    sshBinary?: string;
    sshPassword?: string;
  }> = {},
): RuntimeHostAccessExecutor {
  return {
    host_access: { kind: 'ssh_host', ssh },
    run: async (argv, commandOptions = {}) => {
      if (argv.length === 0) {
        throw new Error('Runtime host command argv must be non-empty.');
      }
      const sshBinary = compact(options.sshBinary) || 'ssh';
      const sshPassword = compact(options.sshPassword);
      const targetLabel = desktopSSHAuthority(ssh);
      const askPass = ssh.auth_mode === 'password' && sshPassword !== ''
        ? await createSSHPasswordAskPassScript()
        : null;
      const args = [
        '-T',
        '-x',
        '-o',
        `ConnectTimeout=${ssh.connect_timeout_seconds}`,
        ...(ssh.auth_mode === 'key_agent' ? ['-o', 'BatchMode=yes'] : ['-o', 'BatchMode=no', '-o', 'NumberOfPasswordPrompts=1']),
        ...sshTargetArgs(ssh),
        sshRemoteCommandWithEnv(argv, commandOptions.env),
      ];
      try {
        return await spawnCommand(sshBinary, args, {
          ...commandOptions,
          env: askPass
            ? {
                DISPLAY: process.env.DISPLAY || ':0',
                SSH_ASKPASS: askPass.scriptPath,
                SSH_ASKPASS_REQUIRE: 'force',
                REDEVEN_DESKTOP_SSH_PASSWORD: sshPassword,
              }
            : undefined,
        }, {
          title: 'SSH Host Command Failed',
          summary: `SSH command on "${targetLabel}" failed.`,
          detail: 'Desktop could not run the requested runtime management command on this SSH host.',
          recoveryHint: 'Check the SSH host, ~/.ssh/config alias, VPN, network connection, and authentication method.',
          targetLabel,
        });
      } finally {
        await askPass?.cleanup();
      }
    },
  };
}

export function spawnSSHRuntimeHostCommand(
  ssh: DesktopSSHHostAccessDetails,
  argv: readonly string[],
  options: RuntimeHostCommandOptions & Readonly<{
    sshBinary?: string;
    sshPassword?: string;
  }> = {},
): RuntimeHostStreamingCommand {
  if (argv.length === 0) {
    throw new Error('Runtime host command argv must be non-empty.');
  }
  const sshBinary = compact(options.sshBinary) || 'ssh';
  const sshPassword = compact(options.sshPassword);
  const targetLabel = desktopSSHAuthority(ssh);
  const askPass = ssh.auth_mode === 'password' && sshPassword !== ''
    ? (() => {
        const tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'rdv-host-ssh-stream-'));
        const scriptPath = path.join(tempDir, 'redeven-ssh-password-askpass.sh');
        fsSync.writeFileSync(scriptPath, buildSSHPasswordAskPassScript(), { mode: 0o700 });
        return {
          scriptPath,
          cleanup: () => fsSync.rmSync(tempDir, { recursive: true, force: true }),
        };
      })()
    : null;
  const args = [
    '-T',
    '-x',
    '-o',
    `ConnectTimeout=${ssh.connect_timeout_seconds}`,
    ...(ssh.auth_mode === 'key_agent' ? ['-o', 'BatchMode=yes'] : ['-o', 'BatchMode=no', '-o', 'NumberOfPasswordPrompts=1']),
    ...sshTargetArgs(ssh),
    sshRemoteCommandWithEnv(argv, options.env),
  ];
  const command = spawnStreamingCommand(sshBinary, args, {
    ...options,
    env: askPass
      ? {
          DISPLAY: process.env.DISPLAY || ':0',
          SSH_ASKPASS: askPass.scriptPath,
          SSH_ASKPASS_REQUIRE: 'force',
          REDEVEN_DESKTOP_SSH_PASSWORD: sshPassword,
      }
      : undefined,
  }, {
    title: 'SSH Host Command Failed',
    summary: `SSH command on "${targetLabel}" failed.`,
    detail: 'Desktop could not keep the requested runtime management stream open on this SSH host.',
    recoveryHint: 'Check the SSH host, ~/.ssh/config alias, VPN, network connection, and authentication method.',
    targetLabel,
  });
  if (askPass) {
    void command.closed.finally(() => askPass.cleanup()).catch(() => undefined);
  }
  return command;
}
