import { spawn } from 'node:child_process';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { sanitizeDesktopChildEnvironment } from './desktopProcessEnvironment';
import {
  DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS,
  buildDesktopSSHReleaseSourceCacheKey,
  desktopSSHReleasePackageName,
  ensureDesktopSSHReleaseArchive,
  ensureDesktopSSHVerifiedReleaseManifest,
  verifyDesktopSSHReleaseAsset,
  type DesktopSSHReleaseFetchPolicy,
  type DesktopSSHReleasePackageKind,
  type DesktopSSHRemotePlatform,
  type DesktopSSHVerifiedReleaseManifest,
} from './sshReleaseAssets';
import {
  DesktopOperationFailureError,
  desktopOperationFailurePresentation,
} from './desktopOperationFailure';

export type DesktopRuntimePackageCacheKey = Readonly<{
  package_kind: DesktopSSHReleasePackageKind;
  release_tag: string;
  release_base_url: string;
  source_cache_key: string;
  platform_id: DesktopSSHRemotePlatform['platform_id'];
  package_name: string;
}>;

export type DesktopRuntimePackageCacheEntry = Readonly<{
  key: DesktopRuntimePackageCacheKey;
  archive_path: string;
  sha256: string;
  platform: DesktopSSHRemotePlatform;
  from_cache: boolean;
}>;

export type DesktopRuntimeUploadAsset = Readonly<{
  archiveData: Buffer;
  cacheEntry: DesktopRuntimePackageCacheEntry | null;
  source: 'release_cache' | 'source_build' | 'source_build_cache';
}>;

export type DesktopRuntimePackagePrunePolicy = Readonly<{
  cacheRoot: string;
  activeReleaseTag: string;
  legacyCacheRoots?: readonly string[];
  includeTemporaryEntries?: boolean;
}>;

type LocalCommandResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

type DesktopSourceRuntimePackageCacheEntry = Readonly<{
  source_root: string;
  package_kind: DesktopSSHReleasePackageKind;
  runtime_release_tag: string;
  platform_id: string;
  archive_data: Buffer;
}>;

const inFlightReleaseManifests = new Map<string, Promise<DesktopSSHVerifiedReleaseManifest>>();
const inFlightReleaseAssets = new Map<string, Promise<DesktopRuntimePackageCacheEntry>>();
const inFlightSourceRuntimeAssets = new Map<string, Promise<DesktopRuntimeUploadAsset>>();
const sourceRuntimePackageCache = new Map<string, DesktopSourceRuntimePackageCacheEntry>();

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeRuntimeReleaseTag(raw: string): string {
  const clean = compact(raw);
  if (clean === '') {
    throw new Error('Desktop could not resolve the runtime release tag for package caching.');
  }
  return clean.startsWith('v') ? clean : `v${clean}`;
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

function releaseManifestInFlightKey(sourceCacheKey: string, releaseTag: string): string {
  return `manifest:${sourceCacheKey}:${releaseTag}`;
}

function releaseAssetInFlightKey(sourceCacheKey: string, releaseTag: string, platformID: string, packageKind: DesktopSSHReleasePackageKind): string {
  return `asset:${sourceCacheKey}:${releaseTag}:${platformID}:${packageKind}`;
}

function normalizeSourceRuntimeRoot(sourceRoot: string): string {
  return path.resolve(compact(sourceRoot));
}

function sourceRuntimeAssetCacheKey(
  sourceRoot: string,
  releaseTag: string,
  platformID: string,
  packageKind: DesktopSSHReleasePackageKind,
): string {
  return `source:${sourceRoot}:${releaseTag}:${platformID}:${packageKind}`;
}

const sourceRuntimeCopyExcludedSubtrees = [
  'desktop/dist',
  'desktop/release',
  'desktop/.bundle',
  'internal/envapp/ui/dist',
  'internal/codeapp/ui/dist',
] as const;

function isPathWithinSubtree(candidatePath: string, subtreePath: string): boolean {
  return candidatePath === subtreePath || candidatePath.startsWith(`${subtreePath}/`);
}

function sourceRuntimeCopyIncludes(sourceRoot: string, candidatePath: string): boolean {
  const relative = path.relative(sourceRoot, candidatePath);
  if (relative === '') {
    return true;
  }
  const normalized = relative.split(path.sep).join('/');
  const parts = normalized.split('/');
  if (parts.includes('.git') || parts.includes('node_modules')) {
    return false;
  }
  return !sourceRuntimeCopyExcludedSubtrees.some((subtree) => isPathWithinSubtree(normalized, subtree));
}

function onceInFlight<T>(
  entries: Map<string, Promise<T>>,
  key: string,
  create: () => Promise<T>,
): Promise<T> {
  const existing = entries.get(key);
  if (existing) {
    return existing;
  }
  const created = create().finally(() => {
    if (entries.get(key) === created) {
      entries.delete(key);
    }
  });
  entries.set(key, created);
  return created;
}

export function runtimePackageCacheRoot(userDataPath: string): string {
  return path.join(userDataPath, 'runtime-package-cache');
}

export function legacyRuntimePackageCacheRoots(userDataPath: string): readonly string[] {
  return [
    path.join(userDataPath, 'ssh-runtime-cache'),
    path.join(userDataPath, 'runtime-placement-cache'),
  ];
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
      env: sanitizeDesktopChildEnvironment({
        ...process.env,
        ...options.env,
      }),
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

async function copySourceRuntimeRoot(
  sourceRoot: string,
  buildRoot: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfCanceled(signal);
  const buildSourceRoot = path.join(buildRoot, 'source');
  await fs.cp(sourceRoot, buildSourceRoot, {
    recursive: true,
    dereference: false,
    filter: (candidatePath) => {
      throwIfCanceled(signal);
      return sourceRuntimeCopyIncludes(sourceRoot, candidatePath);
    },
  });
  return buildSourceRoot;
}

function runtimePackagePreparationFailure(
  error: unknown,
  platform: DesktopSSHRemotePlatform,
  packageKind: DesktopSSHReleasePackageKind,
): Error {
  if (error instanceof DesktopOperationFailureError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const isGateway = packageKind === 'gateway';
  return new DesktopOperationFailureError(desktopOperationFailurePresentation({
    code: isGateway ? 'gateway_package_prepare_failed' : 'container_runtime_launch_failed',
    title: isGateway ? 'Gateway package preparation failed' : 'Runtime package preparation failed',
    summary: `Desktop could not prepare the ${platform.platform_label} ${isGateway ? 'Redeven Gateway' : 'Redeven runtime'} package.`,
    detail: `The local source ${isGateway ? 'Gateway' : 'runtime'} build failed before Desktop could upload the ${isGateway ? 'Gateway' : 'runtime'} package.`,
    recoveryHint: `Run the Redeven asset build and ${isGateway ? 'Gateway' : 'runtime'} build locally, then retry the ${isGateway ? 'Gateway service' : 'runtime lifecycle'} action.`,
    diagnostics: [{
      channel: isGateway ? 'gateway_package_build' : 'runtime_package_build',
      label: 'Build output',
      text: message,
    }],
  }), {
    cause: error,
    runtimeLifecycleStepID: isGateway ? 'preparing_gateway_package' : 'preparing_runtime_package',
  });
}

async function prepareSourceRuntimeUploadAsset(args: Readonly<{
  sourceRuntimeRoot: string;
  runtimeReleaseTag: string;
  packageKind: DesktopSSHReleasePackageKind;
  platform: DesktopSSHRemotePlatform;
  signal?: AbortSignal;
}>): Promise<DesktopRuntimeUploadAsset> {
  throwIfCanceled(args.signal);
  const sourceRoot = args.sourceRuntimeRoot;
  const commandName = args.packageKind === 'gateway' ? 'redeven-gateway' : 'redeven';
  const commandRoot = path.join(sourceRoot, 'cmd', commandName);
  const commandRootStat = await fs.stat(commandRoot).catch(() => null);
  if (!commandRootStat?.isDirectory()) {
    throw new Error(`Desktop ${args.packageKind} source root is not a Redeven checkout: ${sourceRoot}`);
  }

  const buildRoot = await fs.mkdtemp(path.join(os.tmpdir(), `redeven-source-${args.packageKind}-`));
  try {
    const buildSourceRoot = await copySourceRuntimeRoot(sourceRoot, buildRoot, args.signal);
    const binaryPath = path.join(buildRoot, commandName);
    const buildTime = compact(process.env.REDEVEN_DESKTOP_BUNDLE_BUILD_TIME)
      || new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
    const commit = await readSourceRuntimeCommit(sourceRoot, args.signal);
    await buildSourceRuntimeAssets(buildSourceRoot, args.signal);
    await runLocalCommand('go', [
      'build',
      '-trimpath',
      '-ldflags',
      `-s -w -X main.Version=${args.runtimeReleaseTag} -X main.Commit=${commit} -X main.BuildTime=${buildTime}`,
      '-o',
      binaryPath,
      `./cmd/${commandName}`,
    ], {
      cwd: buildSourceRoot,
      env: {
        GOOS: args.platform.goos,
        GOARCH: args.platform.goarch,
        CGO_ENABLED: '0',
      },
      signal: args.signal,
    });
    throwIfCanceled(args.signal);
    return {
      archiveData: createSingleFileTarGzip(commandName, await fs.readFile(binaryPath), 0o755),
      cacheEntry: null,
      source: 'source_build',
    };
  } finally {
    await fs.rm(buildRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function ensureSourceRuntimeUploadAsset(args: Readonly<{
  sourceRuntimeRoot: string;
  runtimeReleaseTag: string;
  packageKind: DesktopSSHReleasePackageKind;
  platform: DesktopSSHRemotePlatform;
  signal?: AbortSignal;
}>): Promise<DesktopRuntimeUploadAsset | null> {
  throwIfCanceled(args.signal);
  const requestedSourceRoot = compact(args.sourceRuntimeRoot);
  if (requestedSourceRoot === '') {
    return null;
  }
  const sourceRoot = normalizeSourceRuntimeRoot(requestedSourceRoot);
  const key = sourceRuntimeAssetCacheKey(sourceRoot, args.runtimeReleaseTag, args.platform.platform_id, args.packageKind);
  const cached = sourceRuntimePackageCache.get(key);
  if (cached) {
    return {
      archiveData: Buffer.from(cached.archive_data),
      cacheEntry: null,
      source: 'source_build_cache',
    };
  }

  return onceInFlight(inFlightSourceRuntimeAssets, key, async () => {
    const built = await prepareSourceRuntimeUploadAsset({
      sourceRuntimeRoot: sourceRoot,
      runtimeReleaseTag: args.runtimeReleaseTag,
      packageKind: args.packageKind,
      platform: args.platform,
      signal: args.signal,
    });
    sourceRuntimePackageCache.set(key, {
      source_root: sourceRoot,
      package_kind: args.packageKind,
      runtime_release_tag: args.runtimeReleaseTag,
      platform_id: args.platform.platform_id,
      archive_data: Buffer.from(built.archiveData),
    });
    return built;
  });
}

function isRuntimePackageCacheTemporaryName(name: string): boolean {
  return name.startsWith('source-runtime-')
    || /^\.redeven(?:-gateway)?_.*\.tar\.gz\.\d+\.[a-f0-9]+\.tmp$/u.test(name)
    || name.endsWith('.download.tmp');
}

async function readDirectoryIfPresent(dir: string): Promise<readonly Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function pruneTemporaryRuntimePackageCacheEntries(root: string): Promise<void> {
  const entries = await readDirectoryIfPresent(root);
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    if (isRuntimePackageCacheTemporaryName(entry.name)) {
      await fs.rm(entryPath, { recursive: true, force: true });
      return;
    }
    if (entry.isDirectory()) {
      await pruneTemporaryRuntimePackageCacheEntries(entryPath);
    }
  }));
}

async function pruneEmptyDirectory(dir: string): Promise<void> {
  try {
    await fs.rmdir(dir);
  } catch {
    // Directory may be non-empty or already removed by another startup path.
  }
}

export async function pruneDesktopRuntimePackageCache(policy: DesktopRuntimePackagePrunePolicy): Promise<void> {
  const activeReleaseTag = normalizeRuntimeReleaseTag(policy.activeReleaseTag);
  const includeTemporaryEntries = policy.includeTemporaryEntries !== false;
  await Promise.all((policy.legacyCacheRoots ?? []).map((root) => fs.rm(root, { recursive: true, force: true })));

  const sourceEntries = await readDirectoryIfPresent(policy.cacheRoot);
  await Promise.all(sourceEntries.map(async (sourceEntry) => {
    const sourcePath = path.join(policy.cacheRoot, sourceEntry.name);
    if (includeTemporaryEntries && isRuntimePackageCacheTemporaryName(sourceEntry.name)) {
      await fs.rm(sourcePath, { recursive: true, force: true });
      return;
    }
    if (!sourceEntry.isDirectory()) {
      return;
    }
    const releaseEntries = await readDirectoryIfPresent(sourcePath);
    await Promise.all(releaseEntries.map(async (releaseEntry) => {
      const releasePath = path.join(sourcePath, releaseEntry.name);
      if (includeTemporaryEntries && isRuntimePackageCacheTemporaryName(releaseEntry.name)) {
        await fs.rm(releasePath, { recursive: true, force: true });
        return;
      }
      if (!releaseEntry.isDirectory()) {
        return;
      }
      if (releaseEntry.name !== activeReleaseTag) {
        await fs.rm(releasePath, { recursive: true, force: true });
        return;
      }
      if (includeTemporaryEntries) {
        await pruneTemporaryRuntimePackageCacheEntries(releasePath);
      }
    }));
    await pruneEmptyDirectory(sourcePath);
  }));
}

async function ensureReleaseManifest(args: Readonly<{
  releaseTag: string;
  releaseBaseURL: string;
  cacheRoot: string;
  fetchPolicy: DesktopSSHReleaseFetchPolicy;
}>): Promise<DesktopSSHVerifiedReleaseManifest> {
  const sourceCacheKey = buildDesktopSSHReleaseSourceCacheKey(args.releaseBaseURL);
  return onceInFlight(
    inFlightReleaseManifests,
    releaseManifestInFlightKey(sourceCacheKey, args.releaseTag),
    () => ensureDesktopSSHVerifiedReleaseManifest({
      releaseTag: args.releaseTag,
      releaseBaseURL: args.releaseBaseURL,
      cacheRoot: args.cacheRoot,
      fetchPolicy: args.fetchPolicy,
    }),
  );
}

async function ensureReleaseAssetEntry(args: Readonly<{
  manifest: DesktopSSHVerifiedReleaseManifest;
  platform: DesktopSSHRemotePlatform;
  packageKind: DesktopSSHReleasePackageKind;
  cacheRoot: string;
  fetchPolicy: DesktopSSHReleaseFetchPolicy;
}>): Promise<DesktopRuntimePackageCacheEntry> {
  const packageName = desktopSSHReleasePackageName(args.platform, args.packageKind);
  const key = releaseAssetInFlightKey(
    args.manifest.source_cache_key,
    args.manifest.release_tag,
    args.platform.platform_id,
    args.packageKind,
  );
  return onceInFlight(inFlightReleaseAssets, key, async () => {
    const sha256 = args.manifest.sha256_by_asset_name.get(packageName);
    if (!sha256) {
      throw new Error(`SHA256SUMS did not include ${packageName}.`);
    }
    const archivePath = path.join(
      args.cacheRoot,
      args.manifest.source_cache_key,
      args.manifest.release_tag,
      args.platform.platform_id,
      packageName,
    );

    try {
      await verifyDesktopSSHReleaseAsset(archivePath, sha256);
      return {
        key: {
          package_kind: args.packageKind,
          release_tag: args.manifest.release_tag,
          release_base_url: args.manifest.release_base_url,
          source_cache_key: args.manifest.source_cache_key,
          platform_id: args.platform.platform_id,
          package_name: packageName,
        },
        archive_path: archivePath,
        sha256,
        platform: args.platform,
        from_cache: true,
      };
    } catch {
      const asset = await ensureDesktopSSHReleaseArchive({
        manifest: args.manifest,
        platform: args.platform,
        packageKind: args.packageKind,
        packageName,
        cacheRoot: args.cacheRoot,
        fetchPolicy: args.fetchPolicy,
      });
      return {
        key: {
          package_kind: args.packageKind,
          release_tag: asset.release_tag,
          release_base_url: asset.release_base_url,
          source_cache_key: asset.source_cache_key,
          platform_id: asset.platform.platform_id,
          package_name: packageName,
        },
        archive_path: asset.archive_path,
        sha256: asset.sha256,
        platform: asset.platform,
        from_cache: false,
      };
    }
  });
}

export async function prepareDesktopRuntimeUploadAsset(args: Readonly<{
  runtimeReleaseTag: string;
  releaseBaseURL: string;
  assetCacheRoot: string;
  packageKind?: DesktopSSHReleasePackageKind;
  sourceRuntimeRoot?: string;
  platform: DesktopSSHRemotePlatform;
  fetchPolicy: DesktopSSHReleaseFetchPolicy;
  signal?: AbortSignal;
}>): Promise<DesktopRuntimeUploadAsset> {
  const packageKind = args.packageKind ?? 'runtime';
  try {
    throwIfCanceled(args.signal);
    const runtimeReleaseTag = normalizeRuntimeReleaseTag(args.runtimeReleaseTag);
    await pruneDesktopRuntimePackageCache({
      cacheRoot: args.assetCacheRoot,
      activeReleaseTag: runtimeReleaseTag,
      includeTemporaryEntries: false,
    }).catch(() => undefined);

    const sourceAsset = await ensureSourceRuntimeUploadAsset({
      sourceRuntimeRoot: args.sourceRuntimeRoot ?? '',
      runtimeReleaseTag,
      packageKind,
      platform: args.platform,
      signal: args.signal,
    });
    if (sourceAsset) {
      return sourceAsset;
    }

    const fetchPolicy = {
      ...args.fetchPolicy,
      signal: args.signal,
    };
    const manifest = await ensureReleaseManifest({
      releaseTag: runtimeReleaseTag,
      releaseBaseURL: args.releaseBaseURL,
      cacheRoot: args.assetCacheRoot,
      fetchPolicy,
    });
    const cacheEntry = await ensureReleaseAssetEntry({
      manifest,
      platform: args.platform,
      packageKind,
      cacheRoot: args.assetCacheRoot,
      fetchPolicy,
    });
    return {
      archiveData: await fs.readFile(cacheEntry.archive_path),
      cacheEntry,
      source: 'release_cache',
    };
  } catch (error) {
    if (compact(args.sourceRuntimeRoot) !== '') {
      throw runtimePackagePreparationFailure(error, args.platform, packageKind);
    }
    const isGateway = packageKind === 'gateway';
    throw new DesktopOperationFailureError(desktopOperationFailurePresentation({
      code: isGateway ? 'gateway_package_prepare_failed' : 'container_runtime_launch_failed',
      title: isGateway ? 'Gateway package preparation failed' : 'Runtime package preparation failed',
      summary: `Desktop could not prepare the ${args.platform.platform_label} ${isGateway ? 'Redeven Gateway' : 'Redeven runtime'} package.`,
      detail: `Desktop could not resolve a verified ${isGateway ? 'Gateway' : 'runtime'} release archive for the target platform.`,
      recoveryHint: `Check network access to the Redeven release source and retry the ${isGateway ? 'Gateway service' : 'runtime lifecycle'} action.`,
      diagnostics: [{
        channel: isGateway ? 'gateway_package_cache' : 'runtime_package_cache',
        label: 'Package preparation output',
        text: error instanceof Error ? error.message : String(error),
      }],
    }), {
      cause: error,
      runtimeLifecycleStepID: isGateway ? 'preparing_gateway_package' : 'preparing_runtime_package',
    });
  }
}
