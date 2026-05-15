import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS,
  ensureDesktopSSHReleaseAsset,
  type DesktopSSHReleaseFetchPolicy,
  type DesktopSSHRemotePlatform,
} from './sshReleaseAssets';

export type DesktopRuntimeUploadAsset = Readonly<{
  archiveData: Buffer;
}>;

type LocalCommandResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function isAbortError(error: unknown): boolean {
  const candidate = error as Partial<Error> & Readonly<{ code?: string }>;
  return candidate?.name === 'AbortError' || candidate?.code === 'ABORT_ERR';
}

function throwIfCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Runtime package preparation was canceled.', 'AbortError');
  }
}

async function runLocalCommand(
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  }>,
): Promise<LocalCommandResult> {
  throwIfCanceled(options.signal);
  return new Promise<LocalCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
    });
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
      if (isAbortError(error) || options.signal?.aborted) {
        reject(new DOMException('Runtime package preparation was canceled.', 'AbortError'));
        return;
      }
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      if (options.signal?.aborted) {
        reject(new DOMException('Runtime package preparation was canceled.', 'AbortError'));
        return;
      }
      if (exitCode === 0 && !signal) {
        resolve({ stdout, stderr });
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${exitCode ?? 'unknown'}`;
      const details = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      reject(new Error(details ? `${command} failed with ${reason}:\n${details}` : `${command} failed with ${reason}`));
    });
  });
}

function writeTarOctal(header: Buffer, value: number, offset: number, length: number): void {
  const text = Math.max(0, Math.floor(value)).toString(8).padStart(length - 1, '0').slice(-(length - 1));
  header.write(text, offset, length - 1, 'ascii');
  header[offset + length - 1] = 0;
}

function createSingleFileTarGzip(fileName: string, data: Buffer, mode: number): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(fileName, 0, Math.min(Buffer.byteLength(fileName), 100), 'ascii');
  writeTarOctal(header, mode, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, data.length, 124, 12);
  writeTarOctal(header, Math.floor(Date.now() / 1_000), 136, 12);
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar', 257, 5, 'ascii');
  header[262] = 0;
  header.write('00', 263, 2, 'ascii');

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumText = checksum.toString(8).padStart(6, '0').slice(-6);
  header.write(checksumText, 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;

  const paddingLength = (512 - (data.length % 512)) % 512;
  return gzipSync(Buffer.concat([
    header,
    data,
    Buffer.alloc(paddingLength, 0),
    Buffer.alloc(1024, 0),
  ]));
}

async function readSourceRuntimeCommit(sourceRoot: string, signal?: AbortSignal): Promise<string> {
  const envCommit = compact(process.env.REDEVEN_DESKTOP_BUNDLE_COMMIT);
  if (envCommit !== '') {
    return envCommit;
  }
  try {
    const result = await runLocalCommand('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: sourceRoot, signal });
    return compact(result.stdout) || 'unknown';
  } catch {
    throwIfCanceled(signal);
    return 'unknown';
  }
}

async function buildSourceRuntimeAssets(sourceRoot: string, signal?: AbortSignal): Promise<void> {
  const scriptPath = path.join(sourceRoot, 'scripts', 'build_assets.sh');
  const scriptStat = await fs.stat(scriptPath).catch(() => null);
  if (!scriptStat?.isFile()) {
    throw new Error(`Redeven asset build script is missing: ${scriptPath}`);
  }
  await runLocalCommand(scriptPath, [], { cwd: sourceRoot, signal });
}

async function prepareSourceRuntimeUploadAsset(args: Readonly<{
  sourceRuntimeRoot: string;
  runtimeReleaseTag: string;
  assetCacheRoot: string;
  platform: DesktopSSHRemotePlatform;
  signal?: AbortSignal;
}>): Promise<DesktopRuntimeUploadAsset | null> {
  throwIfCanceled(args.signal);
  const sourceRoot = compact(args.sourceRuntimeRoot);
  if (sourceRoot === '') {
    return null;
  }
  const commandRoot = path.join(sourceRoot, 'cmd', 'redeven');
  const commandRootStat = await fs.stat(commandRoot).catch(() => null);
  if (!commandRootStat?.isDirectory()) {
    throw new Error(`Desktop runtime source root is not a Redeven checkout: ${sourceRoot}`);
  }

  await fs.mkdir(args.assetCacheRoot, { recursive: true });
  const buildRoot = await fs.mkdtemp(path.join(args.assetCacheRoot, 'source-runtime-'));
  try {
    const binaryPath = path.join(buildRoot, 'redeven');
    const buildTime = compact(process.env.REDEVEN_DESKTOP_BUNDLE_BUILD_TIME)
      || new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
    const commit = await readSourceRuntimeCommit(sourceRoot, args.signal);
    await buildSourceRuntimeAssets(sourceRoot, args.signal);
    await runLocalCommand('go', [
      'build',
      '-trimpath',
      '-ldflags',
      `-s -w -X main.Version=${args.runtimeReleaseTag} -X main.Commit=${commit} -X main.BuildTime=${buildTime}`,
      '-o',
      binaryPath,
      './cmd/redeven',
    ], {
      cwd: sourceRoot,
      env: {
        GOOS: args.platform.goos,
        GOARCH: args.platform.goarch,
        CGO_ENABLED: '0',
      },
      signal: args.signal,
    });
    throwIfCanceled(args.signal);
    return {
      archiveData: createSingleFileTarGzip('redeven', await fs.readFile(binaryPath), 0o755),
    };
  } finally {
    await fs.rm(buildRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function runtimeReleaseFetchPolicy(
  timeoutMs: number,
  signal?: AbortSignal,
): DesktopSSHReleaseFetchPolicy {
  return {
    timeout_ms: Math.max(1, Math.floor(Math.max(timeoutMs, DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS))),
    signal,
  };
}

export async function prepareDesktopRuntimeUploadAsset(args: Readonly<{
  runtimeReleaseTag: string;
  releaseBaseURL: string;
  assetCacheRoot: string;
  sourceRuntimeRoot?: string;
  platform: DesktopSSHRemotePlatform;
  fetchPolicy: DesktopSSHReleaseFetchPolicy;
  signal?: AbortSignal;
}>): Promise<DesktopRuntimeUploadAsset> {
  try {
    throwIfCanceled(args.signal);
    const sourceAsset = await prepareSourceRuntimeUploadAsset({
      sourceRuntimeRoot: args.sourceRuntimeRoot ?? '',
      runtimeReleaseTag: args.runtimeReleaseTag,
      assetCacheRoot: args.assetCacheRoot,
      platform: args.platform,
      signal: args.signal,
    });
    if (sourceAsset) {
      return sourceAsset;
    }
    const asset = await ensureDesktopSSHReleaseAsset({
      releaseTag: args.runtimeReleaseTag,
      releaseBaseURL: args.releaseBaseURL,
      platform: args.platform,
      cacheRoot: args.assetCacheRoot,
      fetchPolicy: {
        ...args.fetchPolicy,
        signal: args.signal,
      },
    });
    return {
      archiveData: await fs.readFile(asset.archive_path),
    };
  } catch (error) {
    throw new Error(
      `Desktop could not prepare the ${args.platform.platform_label} Redeven runtime package: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
