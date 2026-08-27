import * as childProcess from 'node:child_process';

import type {
  DesktopWSLDiscoverySnapshot,
  DesktopWSLDistribution,
  DesktopWSLDistributionProbe,
} from '../shared/desktopWSL';
import {
  DesktopHostCommandNotFoundError,
  desktopHostCommandEnvironment,
  resolveDesktopHostCommand,
} from './desktopHostCommand';
import { sanitizeDesktopChildEnvironment } from './desktopProcessEnvironment';

const DEFAULT_WSL_COMMAND_TIMEOUT_MS = 15_000;
const REQUIRED_WSL_RUNTIME_COMMANDS = [
  'basename',
  'cat',
  'chmod',
  'cp',
  'date',
  'dirname',
  'grep',
  'gzip',
  'id',
  'kill',
  'mkdir',
  'mktemp',
  'mv',
  'nohup',
  'pwd',
  'rm',
  'sha256sum',
  'sh',
  'sort',
  'tar',
  'tr',
  'uname',
  'wc',
] as const;

export type DesktopWSLCommandRunner = (
  args: readonly string[],
  options?: Readonly<{ stdinData?: Buffer; timeout_ms?: number }>,
) => Promise<Readonly<{ stdout: Buffer; stderr: Buffer }>>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function decodeDesktopWSLCommandOutput(bytes: Buffer): string {
  if (bytes.length === 0) {
    return '';
  }
  const hasUTF16LEBOM = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  let oddNulls = 0;
  let oddBytes = 0;
  for (let index = 1; index < Math.min(bytes.length, 512); index += 2) {
    oddBytes += 1;
    if (bytes[index] === 0) oddNulls += 1;
  }
  const encoding = hasUTF16LEBOM || (oddBytes > 0 && oddNulls / oddBytes >= 0.5)
    ? 'utf16le'
    : 'utf8';
  return bytes.toString(encoding).replace(/^\uFEFF/u, '').replace(/\0/gu, '');
}

function outputLines(bytes: Buffer): readonly string[] {
  return decodeDesktopWSLCommandOutput(bytes)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseWSLVersions(
  bytes: Buffer,
  distributionNames: readonly string[],
): ReadonlyMap<string, 1 | 2> {
  const versions = new Map<string, 1 | 2>();
  const names = [...distributionNames].sort((left, right) => right.length - left.length);
  for (const rawLine of outputLines(bytes)) {
    const line = rawLine.replace(/^\*\s*/u, '');
    const versionMatch = /\s+([12])\s*$/u.exec(line);
    if (!versionMatch) continue;
    const body = line.slice(0, versionMatch.index).trimEnd();
    const name = names.find((candidate) => body === candidate || body.startsWith(`${candidate} `));
    if (!name) continue;
    versions.set(name, Number(versionMatch[1]) as 1 | 2);
  }
  return versions;
}

function registrationStatus(version: 1 | 2 | null): DesktopWSLDistribution['registration_status'] {
  if (version === 2) return 'eligible';
  if (version === 1) return 'wsl1_unsupported';
  return 'version_unknown';
}

export async function discoverDesktopWSLDistributions(
  runCommand?: DesktopWSLCommandRunner,
): Promise<DesktopWSLDiscoverySnapshot> {
  try {
    const runner = runCommand ?? createDesktopWSLCommandRunner();
    const listed = await runner(['--list', '--quiet']);
    const distributionNames = outputLines(listed.stdout);
    if (distributionNames.length === 0) {
      return {
        availability: 'no_distributions',
        distributions: [],
        message: 'WSL is available, but no Linux distribution is installed and initialized.',
      };
    }
    const [verbose, running] = await Promise.all([
      runner(['--list', '--verbose']),
      runner(['--list', '--running', '--quiet']),
    ]);
    const versions = parseWSLVersions(verbose.stdout, distributionNames);
    const runningNames = new Set(outputLines(running.stdout));
    const distributions = distributionNames.map((distributionName): DesktopWSLDistribution => {
      const version = versions.get(distributionName) ?? null;
      return {
        distribution_name: distributionName,
        wsl_version: version,
        state: runningNames.has(distributionName) ? 'running' : 'stopped',
        registration_status: registrationStatus(version),
      };
    });
    return { availability: 'ready', distributions };
  } catch (error) {
    if (error instanceof DesktopHostCommandNotFoundError) {
      return {
        availability: 'wsl_missing',
        distributions: [],
        message: error.message,
      };
    }
    return {
      availability: 'failed',
      distributions: [],
      message: compact(error instanceof Error ? error.message : error) || 'WSL discovery failed.',
    };
  }
}

function exactSingleLine(bytes: Buffer, label: string): string {
  const lines = outputLines(bytes);
  if (lines.length !== 1 || lines[0] === '') {
    throw new Error(`WSL ${label} probe returned an invalid value.`);
  }
  return lines[0]!;
}

export async function probeDesktopWSLDistribution(
  distributionName: string,
  runCommand?: DesktopWSLCommandRunner,
): Promise<DesktopWSLDistributionProbe> {
  const name = compact(distributionName);
  if (name === '' || /[\r\n]/u.test(name)) {
    throw new Error('WSL distribution name must be one non-empty line.');
  }
  const runner = runCommand ?? createDesktopWSLCommandRunner();
  const prefix = ['--distribution', name, '--exec'] as const;
  const [userResult, homeResult, osResult, architectureResult, commandsResult] = await Promise.all([
    runner([...prefix, 'id', '-un']),
    runner([...prefix, 'sh', '-c', 'printf "%s\\n" "$HOME"']),
    runner([...prefix, 'uname', '-s']),
    runner([...prefix, 'uname', '-m']),
    runner([
      ...prefix,
      'sh',
      '-c',
      'for command_name do command -v "$command_name" >/dev/null 2>&1 || printf "%s\\n" "$command_name"; done',
      'redeven-wsl-probe',
      ...REQUIRED_WSL_RUNTIME_COMMANDS,
    ]),
  ]);
  const linuxUser = exactSingleLine(userResult.stdout, 'Linux user');
  const linuxHome = exactSingleLine(homeResult.stdout, 'Linux home');
  const osName = exactSingleLine(osResult.stdout, 'operating system').toLowerCase();
  const architecture = exactSingleLine(architectureResult.stdout, 'architecture').toLowerCase();
  if (osName !== 'linux') {
    throw new Error(`WSL distribution ${name} reported unsupported operating system ${osName}.`);
  }
  if (architecture !== 'x86_64' && architecture !== 'amd64') {
    throw new Error(`WSL distribution ${name} reported unsupported architecture ${architecture}.`);
  }
  if (!linuxHome.startsWith('/') || linuxHome === '/' || linuxHome.startsWith('/mnt/')) {
    throw new Error(`WSL distribution ${name} reported an unsafe Linux home directory.`);
  }
  return {
    distribution_name: name,
    linux_user: linuxUser,
    linux_home: linuxHome,
    architecture: 'amd64',
    missing_commands: outputLines(commandsResult.stdout),
  };
}

export function createDesktopWSLCommandRunner(options: Readonly<{
  wslBinary?: string;
  env?: NodeJS.ProcessEnv;
}> = {}): DesktopWSLCommandRunner {
  const hostEnvironment = sanitizeDesktopChildEnvironment({
    ...process.env,
    ...options.env,
  });
  const resolution = resolveDesktopHostCommand(compact(options.wslBinary) || 'wsl', {
    env: hostEnvironment,
    platform: process.platform,
  });
  return (args, commandOptions = {}) => new Promise((resolve, reject) => {
    const child = childProcess.spawn(resolution.command, [...args], {
      env: desktopHostCommandEnvironment(hostEnvironment),
      stdio: [commandOptions.stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    if (!childStdout || !childStderr) {
      child.kill();
      reject(new Error('WSL command pipes were not created.'));
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timeoutMS = commandOptions.timeout_ms ?? DEFAULT_WSL_COMMAND_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`WSL command timed out after ${timeoutMS} ms.`));
    }, timeoutMS);
    childStdout.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    childStderr.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stdoutBytes = Buffer.concat(stdout);
      const stderrBytes = Buffer.concat(stderr);
      if (exitCode === 0 && !signal) {
        resolve({ stdout: stdoutBytes, stderr: stderrBytes });
        return;
      }
      const diagnostic = compact(decodeDesktopWSLCommandOutput(stderrBytes));
      reject(new Error(diagnostic || (signal ? `WSL command ended with signal ${signal}.` : `WSL command exited with code ${exitCode}.`)));
    });
    if (commandOptions.stdinData) {
      child.stdin?.end(commandOptions.stdinData);
    }
  });
}
