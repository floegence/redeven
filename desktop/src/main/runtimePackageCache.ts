import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
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
  DesktopReleaseAssetError,
  fetchDesktopReleaseAssetBuffer,
  ensureDesktopSSHReleaseArchive,
  ensureDesktopSSHVerifiedReleaseManifest,
  verifyDesktopSSHReleaseAsset,
  type DesktopSSHReleaseFetchPolicy,
  type DesktopSSHReleasePackageKind,
  type DesktopSSHRemotePlatform,
  type DesktopSSHVerifiedReleaseManifest,
} from './sshReleaseAssets';
import {
  DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS,
  DEFAULT_RUNTIME_HOST_TRANSFER_TIMEOUT_MS,
} from './runtimeHostAccess';
import {
  DesktopOperationFailureError,
  desktopOperationFailurePresentation,
} from './desktopOperationFailure';
import { runtimeArchiveEntries, runtimeExecutableFromArchive } from './runtimeArchive';

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
  includeTemporaryEntries?: boolean;
}>;

type LocalCommandResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

type DesktopSourceRuntimePackageCacheEntry = Readonly<{
  schema_version: 'redeven.desktop_source_runtime_package_cache.v1';
  source_root: string;
  source_commit: string;
  package_kind: DesktopSSHReleasePackageKind;
  runtime_release_tag: string;
  redevplugin_release_tag: string;
  platform_id: string;
  rust_toolchain: string;
  manifest_digest: string;
  archive_sha256: string;
}>;

const inFlightReleaseManifests = new Map<string, Promise<DesktopSSHVerifiedReleaseManifest>>();
const inFlightReleaseAssets = new Map<string, Promise<DesktopRuntimePackageCacheEntry>>();
const inFlightSourceRuntimeAssets = new Map<string, Promise<DesktopRuntimeUploadAsset>>();

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

const REDEVPLUGIN_RUNTIME_MANIFEST = 'platform-release-manifest.json';
const REDEVPLUGIN_RUNTIME_RUST_TOOLCHAIN = '1.88.0';
const SOURCE_RUNTIME_CACHE_DIR = 'source-build-cache';
const REDEVPLUGIN_MANIFEST_CACHE_DIR = 'redevplugin-manifests';

function digestText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function digestBuffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceRuntimeCacheKey(args: Readonly<{
  sourceRoot: string;
  sourceCommit: string;
  runtimeReleaseTag: string;
  redevpluginReleaseTag: string;
  platformID: string;
  packageKind: DesktopSSHReleasePackageKind;
  manifestDigest: string;
}>): string {
  return digestText(JSON.stringify({
    source_root: args.sourceRoot,
    source_commit: args.sourceCommit,
    runtime_release_tag: args.runtimeReleaseTag,
    redevplugin_release_tag: args.redevpluginReleaseTag,
    platform_id: args.platformID,
    package_kind: args.packageKind,
    rust_toolchain: REDEVPLUGIN_RUNTIME_RUST_TOOLCHAIN,
    manifest_digest: args.manifestDigest,
  }));
}

function sourceRuntimeCachePaths(cacheRoot: string, key: string): Readonly<{
  directory: string;
  archive: string;
  metadata: string;
}> {
  const directory = path.join(cacheRoot, SOURCE_RUNTIME_CACHE_DIR, key);
  return {
    directory,
    archive: path.join(directory, 'runtime-package.tar.gz'),
    metadata: path.join(directory, 'metadata.json'),
  };
}

function redevpluginManifestCachePath(cacheRoot: string, releaseTag: string): string {
  return path.join(cacheRoot, REDEVPLUGIN_MANIFEST_CACHE_DIR, releaseTag, REDEVPLUGIN_RUNTIME_MANIFEST);
}

async function writePrivateFileAtomically(targetPath: string, data: Buffer | string): Promise<void> {
  const targetDir = path.dirname(targetPath);
  await fs.mkdir(targetDir, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    targetDir,
    `.${path.basename(targetPath)}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`,
  );
  try {
    const handle = await fs.open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function normalizeSourceRuntimeRoot(sourceRoot: string): string {
  return path.resolve(compact(sourceRoot));
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
    timeout_ms?: number;
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
    let settled = false;
    const timeoutMs = Number(options.timeout_ms ?? DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS);
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          if (settled) return;
          child.kill('SIGTERM');
          settled = true;
          const details = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
          reject(new Error(details
            ? `${command} timed out after ${Math.floor(timeoutMs)} ms:\n${details}`
            : `${command} timed out after ${Math.floor(timeoutMs)} ms`));
        }, timeoutMs)
      : undefined;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (isAbortError(error) || options.signal?.aborted) {
        reject(new DOMException('Runtime package preparation was canceled.', 'AbortError'));
        return;
      }
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
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

type RuntimeArchiveEntry = Readonly<{
  name: string;
  data: Buffer;
  mode: number;
}>;

const NATIVE_RUNTIME_COMPANION_FILES = [
  'redevplugin-runtime',
  '.redevplugin-release-artifacts-verified.json',
  'REDEVPLUGIN_THIRD_PARTY_NOTICES.md',
  'REDEVPLUGIN_RUNTIME.spdx.json',
  'redevplugin-runtime.provenance.json',
  'redevplugin-runtime.sig',
  'redevplugin-runtime.pem',
] as const;

function createTarGzip(entries: readonly RuntimeArchiveEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const { name: fileName, data, mode } = entry;
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
    chunks.push(header, data, Buffer.alloc(paddingLength, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(chunks));
}

function createSingleFileTarGzip(fileName: string, data: Buffer, mode: number): Buffer {
  return createTarGzip([{ name: fileName, data, mode }]);
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

async function readReDevPluginReleaseTag(sourceRoot: string, signal?: AbortSignal): Promise<string> {
  const envTag = compact(process.env.REDEVEN_REDEVPLUGIN_RELEASE_TAG);
  if (envTag !== '') {
    return normalizeRuntimeReleaseTag(envTag);
  }
  const goMod = await fs.readFile(path.join(sourceRoot, 'go.mod'), 'utf8').catch(() => '');
  const match = /(?:^|\n)\s*(?:require\s+)?github\.com\/floegence\/redevplugin\/v3\s+(v[0-9]+\.[0-9]+\.[0-9]+)(?:\s|$)/u.exec(goMod);
  if (!match?.[1]) {
    throw new Error('Redeven source go.mod does not declare a ReDevPlugin v3 release.');
  }
  throwIfCanceled(signal);
  return match[1];
}

async function buildSourceRuntimeAssets(sourceRoot: string, signal?: AbortSignal): Promise<void> {
  const scriptPath = path.join(sourceRoot, 'scripts', 'build_assets.sh');
  const scriptStat = await fs.stat(scriptPath).catch(() => null);
  if (!scriptStat?.isFile()) {
    throw new Error(`Redeven asset build script is missing: ${scriptPath}`);
  }
  await runLocalCommand(scriptPath, [], {
    cwd: sourceRoot,
    signal,
    timeout_ms: DEFAULT_RUNTIME_HOST_TRANSFER_TIMEOUT_MS,
  });
}

async function sourceRuntimeBuilderPath(sourceRoot: string): Promise<string> {
  const scriptPath = path.join(sourceRoot, 'scripts', 'build_runtime_binary.sh');
  const scriptStat = await fs.stat(scriptPath).catch(() => null);
  if (!scriptStat?.isFile()) {
    throw new Error(`Redeven runtime build script is missing: ${scriptPath}`);
  }
  return scriptPath;
}

async function checkSourceRuntimeCompiler(
  sourceRoot: string,
  platform: DesktopSSHRemotePlatform,
  signal?: AbortSignal,
): Promise<void> {
  const scriptPath = await sourceRuntimeBuilderPath(sourceRoot);
  await runLocalCommand(scriptPath, [
    '--check-only',
    '--goos', platform.goos,
    '--goarch', platform.goarch,
  ], { cwd: sourceRoot, signal });
}

async function buildSourceRuntimeBinary(args: Readonly<{
  sourceRoot: string;
  commandName: 'redeven' | 'redeven-gateway';
  outputPath: string;
  platform: DesktopSSHRemotePlatform;
  version: string;
  commit: string;
  buildTime: string;
  signal?: AbortSignal;
}>): Promise<void> {
  const scriptPath = await sourceRuntimeBuilderPath(args.sourceRoot);
  await runLocalCommand(scriptPath, [
    '--goos', args.platform.goos,
    '--goarch', args.platform.goarch,
    '--output', args.outputPath,
    '--command', `./cmd/${args.commandName}`,
    '--version', args.version,
    '--commit', args.commit,
    '--build-time', args.buildTime,
  ], {
    cwd: args.sourceRoot,
    signal: args.signal,
    timeout_ms: DEFAULT_RUNTIME_HOST_TRANSFER_TIMEOUT_MS,
  });
}

async function stageSourceRuntimeCompanions(args: Readonly<{
  sourceRoot: string;
  outputRoot: string;
  platform: DesktopSSHRemotePlatform;
  manifestPath: string;
  signal?: AbortSignal;
}>): Promise<void> {
  const scriptPath = path.join(args.sourceRoot, 'scripts', 'stage_redevplugin_release_artifacts.sh');
  const scriptStat = await fs.stat(scriptPath).catch(() => null);
  if (!scriptStat?.isFile()) {
    throw new Error(`ReDevPlugin Runtime staging script is missing: ${scriptPath}`);
  }
  await runLocalCommand(scriptPath, [
    '--dest-dir', path.join(args.outputRoot, 'published-redevplugin'),
    '--redeven-goos', args.platform.goos,
    '--redeven-goarch', args.platform.goarch,
    '--manifest-file', args.manifestPath,
    '--runtime-out', path.join(args.outputRoot, 'redevplugin-runtime'),
  ], {
    cwd: args.sourceRoot,
    signal: args.signal,
    timeout_ms: DEFAULT_RUNTIME_HOST_TRANSFER_TIMEOUT_MS,
  });
}

// Cache reads perform only a cheap identity check; the staging script invokes
// the canonical release contract before it builds or installs the companion.
function validateReDevPluginManifest(data: Buffer, releaseTag: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString('utf8'));
  } catch (error) {
    throw new Error(`ReDevPlugin release manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const record = parsed as Readonly<{ platform_version?: unknown; plugin_api?: unknown; internal_wire?: unknown; artifacts?: unknown }>;
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
  if (record.platform_version !== releaseTag.replace(/^v/u, '')
    || record.plugin_api !== 1
    || record.internal_wire !== 1
    || artifacts.length < 5) {
    throw new Error(`ReDevPlugin release manifest does not match ${releaseTag}.`);
  }
  const names = new Set<string>();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== 'object') {
      throw new Error('ReDevPlugin release manifest contains an invalid artifact.');
    }
    const item = artifact as Readonly<Record<string, unknown>>;
    const name = compact(item.name);
    const sha256 = compact(item.sha256);
    if (name === '' || names.has(name) || !/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new Error('ReDevPlugin release manifest contains an invalid artifact.');
    }
    names.add(name);
  }
  for (const required of [
    'go:github.com/floegence/redevplugin/v3',
    'npm:@floegence/redevplugin-contracts',
    'npm:@floegence/redevplugin-ui',
    'crate:redevplugin-runtime',
    'crate:redevplugin-worker-sdk',
  ]) {
    if (!names.has(required)) {
      throw new Error(`ReDevPlugin release manifest is missing ${required}.`);
    }
  }
}

async function ensureReDevPluginManifest(args: Readonly<{
  cacheRoot: string;
  redevpluginReleaseTag: string;
  fetchPolicy: DesktopSSHReleaseFetchPolicy;
  signal?: AbortSignal;
}>): Promise<Readonly<{ path: string; digest: string }>> {
  const releaseTag = normalizeRuntimeReleaseTag(args.redevpluginReleaseTag);
  const manifestPath = redevpluginManifestCachePath(args.cacheRoot, releaseTag);
  const cached = await fs.readFile(manifestPath).catch(() => null);
  if (cached) {
    try {
      validateReDevPluginManifest(cached, releaseTag);
      return { path: manifestPath, digest: digestBuffer(cached) };
    } catch {
      // The local manifest is incomplete or stale. Fetch one replacement below.
    }
  }

  const sourceURL = `https://github.com/floegence/redevplugin/releases/download/${encodeURIComponent(releaseTag)}/${REDEVPLUGIN_RUNTIME_MANIFEST}`;
  const data = await fetchDesktopReleaseAssetBuffer(sourceURL, {
    ...args.fetchPolicy,
    signal: args.signal,
  });
  throwIfCanceled(args.signal);
  validateReDevPluginManifest(data, releaseTag);
  await writePrivateFileAtomically(manifestPath, data);
  return { path: manifestPath, digest: digestBuffer(data) };
}

function runtimePackageEntryNames(args: Readonly<{
  platform: DesktopSSHRemotePlatform;
  packageKind: DesktopSSHReleasePackageKind;
}>): readonly string[] {
  if (args.packageKind === 'gateway') {
    return ['redeven-gateway'];
  }
  if (args.platform.goos === 'linux' || args.platform.goos === 'darwin') {
    return ['redeven', ...NATIVE_RUNTIME_COMPANION_FILES];
  }
  return ['redeven'];
}

function validateRuntimePackageArchive(
  archiveData: Buffer,
  args: Readonly<{ platform: DesktopSSHRemotePlatform; packageKind: DesktopSSHReleasePackageKind }>,
): void {
  const entries = runtimeArchiveEntries(archiveData);
  const expected = runtimePackageEntryNames(args);
  if (entries.size !== expected.length) {
    throw new Error(`Runtime package archive contains unexpected files (expected ${expected.length}, found ${entries.size}).`);
  }
  for (const name of expected) {
    if (!entries.has(name)) {
      throw new Error(`Runtime package archive is missing ${name}.`);
    }
  }
  if (args.packageKind === 'runtime') {
    runtimeExecutableFromArchive(archiveData);
  }
}

async function readSourceRuntimeCache(args: Readonly<{
  cacheRoot: string;
  key: string;
  sourceRoot: string;
  sourceCommit: string;
  runtimeReleaseTag: string;
  redevpluginReleaseTag: string;
  packageKind: DesktopSSHReleasePackageKind;
  platform: DesktopSSHRemotePlatform;
  manifestDigest: string;
}>): Promise<DesktopRuntimeUploadAsset | null> {
  const paths = sourceRuntimeCachePaths(args.cacheRoot, args.key);
  const [metadataData, archiveData] = await Promise.all([
    fs.readFile(paths.metadata).catch(() => null),
    fs.readFile(paths.archive).catch(() => null),
  ]);
  if (!metadataData || !archiveData) return null;
  try {
    const metadata = JSON.parse(metadataData.toString('utf8')) as DesktopSourceRuntimePackageCacheEntry;
    if (metadata.schema_version !== 'redeven.desktop_source_runtime_package_cache.v1'
      || metadata.source_root !== args.sourceRoot
      || metadata.source_commit !== args.sourceCommit
      || metadata.package_kind !== args.packageKind
      || metadata.runtime_release_tag !== args.runtimeReleaseTag
      || metadata.redevplugin_release_tag !== args.redevpluginReleaseTag
      || metadata.platform_id !== args.platform.platform_id
      || metadata.rust_toolchain !== REDEVPLUGIN_RUNTIME_RUST_TOOLCHAIN
      || metadata.manifest_digest !== args.manifestDigest
      || metadata.archive_sha256 !== digestBuffer(archiveData)) {
      return null;
    }
    validateRuntimePackageArchive(archiveData, args);
    return {
      archiveData,
      cacheEntry: null,
      source: 'source_build_cache',
    };
  } catch {
    return null;
  }
}

async function findSourceRuntimeCache(args: Readonly<{
  cacheRoot: string;
  sourceRoot: string;
  sourceCommit: string;
  runtimeReleaseTag: string;
  redevpluginReleaseTag: string;
  packageKind: DesktopSSHReleasePackageKind;
  platform: DesktopSSHRemotePlatform;
}>): Promise<DesktopRuntimeUploadAsset | null> {
  const root = path.join(args.cacheRoot, SOURCE_RUNTIME_CACHE_DIR);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [] as Dirent[]);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metadataPath = path.join(root, entry.name, 'metadata.json');
    const archivePath = path.join(root, entry.name, 'runtime-package.tar.gz');
    const metadataData = await fs.readFile(metadataPath).catch(() => null);
    const archiveData = await fs.readFile(archivePath).catch(() => null);
    if (!metadataData || !archiveData) continue;
    try {
      const metadata = JSON.parse(metadataData.toString('utf8')) as DesktopSourceRuntimePackageCacheEntry;
      if (metadata.schema_version !== 'redeven.desktop_source_runtime_package_cache.v1'
        || metadata.source_root !== args.sourceRoot
        || metadata.source_commit !== args.sourceCommit
        || metadata.runtime_release_tag !== args.runtimeReleaseTag
        || metadata.redevplugin_release_tag !== args.redevpluginReleaseTag
        || metadata.package_kind !== args.packageKind
        || metadata.platform_id !== args.platform.platform_id
        || metadata.rust_toolchain !== REDEVPLUGIN_RUNTIME_RUST_TOOLCHAIN
        || metadata.archive_sha256 !== digestBuffer(archiveData)) continue;
      if (sourceRuntimeCacheKey({
        sourceRoot: metadata.source_root,
        sourceCommit: metadata.source_commit,
        runtimeReleaseTag: metadata.runtime_release_tag,
        redevpluginReleaseTag: metadata.redevplugin_release_tag,
        platformID: metadata.platform_id,
        packageKind: metadata.package_kind,
        manifestDigest: metadata.manifest_digest,
      }) !== entry.name) continue;
      validateRuntimePackageArchive(archiveData, args);
      return { archiveData, cacheEntry: null, source: 'source_build_cache' };
    } catch {
      // Ignore one damaged cache entry and continue looking for a matching one.
    }
  }
  return null;
}

async function writeSourceRuntimeCache(args: Readonly<{
  cacheRoot: string;
  key: string;
  sourceRoot: string;
  sourceCommit: string;
  runtimeReleaseTag: string;
  redevpluginReleaseTag: string;
  packageKind: DesktopSSHReleasePackageKind;
  platform: DesktopSSHRemotePlatform;
  manifestDigest: string;
  archiveData: Buffer;
}>): Promise<void> {
  validateRuntimePackageArchive(args.archiveData, args);
  const paths = sourceRuntimeCachePaths(args.cacheRoot, args.key);
  const metadata: DesktopSourceRuntimePackageCacheEntry = {
    schema_version: 'redeven.desktop_source_runtime_package_cache.v1',
    source_root: args.sourceRoot,
    source_commit: args.sourceCommit,
    package_kind: args.packageKind,
    runtime_release_tag: args.runtimeReleaseTag,
    redevplugin_release_tag: args.redevpluginReleaseTag,
    platform_id: args.platform.platform_id,
    rust_toolchain: REDEVPLUGIN_RUNTIME_RUST_TOOLCHAIN,
    manifest_digest: args.manifestDigest,
    archive_sha256: digestBuffer(args.archiveData),
  };
  await writePrivateFileAtomically(paths.archive, args.archiveData);
  await writePrivateFileAtomically(paths.metadata, `${JSON.stringify(metadata)}\n`);
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
  if (error instanceof DesktopReleaseAssetError) {
    const code = error.failure_code === 'forbidden'
      ? 'redevplugin_release_asset_forbidden'
      : error.failure_code === 'timeout'
        ? 'redevplugin_release_asset_timeout'
        : 'redevplugin_release_asset_unavailable';
    return new DesktopOperationFailureError(desktopOperationFailurePresentation({
      code,
      title: 'ReDevPlugin release asset unavailable',
      titleKey: 'progress.redevpluginReleaseAssetFailedTitle',
      summary: 'Desktop could not download the verified ReDevPlugin release asset.',
      summaryKey: 'progress.redevpluginReleaseAssetFailedSummary',
      detail: 'The ReDevPlugin release asset was rejected or unavailable before the Runtime package was prepared.',
      detailKey: 'progress.redevpluginReleaseAssetFailedDetail',
      recoveryHint: 'Check network access to the ReDevPlugin release source or use a matching verified local cache, then retry.',
      recoveryHintKey: 'progress.redevpluginReleaseAssetFailedRecoveryHint',
      diagnostics: [{
        channel: 'redevplugin_release_asset',
        label: 'Release asset download',
        text: [
          error.message,
          `url=${error.url}`,
          `status=${error.status ?? 'network'}`,
          `request_id=${error.request_id || 'none'}`,
          `attempts=${error.attempts}`,
        ].join('\n'),
      }],
    }), {
      cause: error,
      runtimeLifecycleStepID: 'preparing_runtime_package',
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  const isGateway = packageKind === 'gateway';
  return new DesktopOperationFailureError(desktopOperationFailurePresentation({
    code: isGateway ? 'gateway_package_prepare_failed' : 'runtime_package_prepare_failed',
    title: isGateway ? 'Gateway package preparation failed' : 'Runtime package preparation failed',
    ...(isGateway ? {} : {
      titleKey: 'progress.runtimePackagePrepareFailedTitle' as const,
      summaryKey: 'progress.runtimePackagePrepareFailedSummary' as const,
      detailKey: 'progress.runtimePackagePrepareFailedDetail' as const,
      recoveryHintKey: 'progress.runtimePackagePrepareFailedRecoveryHint' as const,
    }),
    summary: `Desktop could not prepare the ${platform.platform_label} ${isGateway ? 'Redeven Gateway' : 'Redeven runtime'} package.`,
    detail: `Package preparation failed before Desktop changed the target environment.`,
    recoveryHint: `Check the local package build and retry the ${isGateway ? 'Gateway service' : 'runtime lifecycle'} action.`,
    diagnostics: [{
      channel: isGateway ? 'gateway_package_build' : 'runtime_package_build',
      label: 'Build output',
      text: message,
    }],
  }), {
    cause: error,
    ...(isGateway ? {} : { runtimeLifecycleStepID: 'preparing_runtime_package' as const }),
  });
}

async function prepareSourceRuntimeUploadAsset(args: Readonly<{
  sourceRuntimeRoot: string;
  sourceCommit: string;
  runtimeReleaseTag: string;
  manifestPath?: string;
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
  await checkSourceRuntimeCompiler(sourceRoot, args.platform, args.signal);

  const buildRoot = await fs.mkdtemp(path.join(os.tmpdir(), `redeven-source-${args.packageKind}-`));
  try {
    const buildSourceRoot = await copySourceRuntimeRoot(sourceRoot, buildRoot, args.signal);
    const binaryPath = path.join(buildRoot, commandName);
    const buildTime = compact(process.env.REDEVEN_DESKTOP_BUNDLE_BUILD_TIME)
      || new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
    const commit = args.sourceCommit;
    await buildSourceRuntimeAssets(buildSourceRoot, args.signal);
    await buildSourceRuntimeBinary({
      sourceRoot: buildSourceRoot,
      commandName,
      outputPath: binaryPath,
      platform: args.platform,
      version: args.runtimeReleaseTag,
      commit,
      buildTime,
      signal: args.signal,
    });
    throwIfCanceled(args.signal);
    if (args.packageKind === 'runtime') {
      const suiteRoot = path.join(buildRoot, 'runtime-suite');
      await fs.mkdir(suiteRoot, { recursive: true });
      await stageSourceRuntimeCompanions({
        sourceRoot,
        outputRoot: suiteRoot,
        platform: args.platform,
        manifestPath: args.manifestPath ?? (() => { throw new Error('ReDevPlugin release manifest is required for a Linux Runtime build.'); })(),
        signal: args.signal,
      });
      const entries: RuntimeArchiveEntry[] = [{
        name: commandName,
        data: await fs.readFile(binaryPath),
        mode: 0o755,
      }];
      for (const name of NATIVE_RUNTIME_COMPANION_FILES) {
        entries.push({
          name,
          data: await fs.readFile(path.join(suiteRoot, name)),
          mode: name === 'redevplugin-runtime' ? 0o755 : 0o644,
        });
      }
      return {
        archiveData: createTarGzip(entries),
        cacheEntry: null,
        source: 'source_build',
      };
    }
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
  cacheRoot: string;
  runtimeReleaseTag: string;
  redevpluginReleaseTag: string;
  packageKind: DesktopSSHReleasePackageKind;
  platform: DesktopSSHRemotePlatform;
  manifestPath?: string;
  manifestDigest?: string;
  signal?: AbortSignal;
}>): Promise<DesktopRuntimeUploadAsset | null> {
  throwIfCanceled(args.signal);
  const requestedSourceRoot = compact(args.sourceRuntimeRoot);
  if (requestedSourceRoot === '') {
    return null;
  }
  const sourceRoot = normalizeSourceRuntimeRoot(requestedSourceRoot);
  const sourceCommit = await readSourceRuntimeCommit(sourceRoot, args.signal);
  const manifestDigest = args.manifestDigest ?? 'none';
  const key = sourceRuntimeCacheKey({
    sourceRoot,
    sourceCommit,
    runtimeReleaseTag: args.runtimeReleaseTag,
    redevpluginReleaseTag: args.redevpluginReleaseTag,
    platformID: args.platform.platform_id,
    packageKind: args.packageKind,
    manifestDigest,
  });
  const cacheArgs = {
    cacheRoot: args.cacheRoot,
    key,
    sourceRoot,
    sourceCommit,
    runtimeReleaseTag: args.runtimeReleaseTag,
    redevpluginReleaseTag: args.redevpluginReleaseTag,
    packageKind: args.packageKind,
    platform: args.platform,
    manifestDigest,
  } as const;
  const cached = await readSourceRuntimeCache(cacheArgs);
  if (cached) return cached;

  return onceInFlight(inFlightSourceRuntimeAssets, key, async () => {
    const cachedInside = await readSourceRuntimeCache(cacheArgs);
    if (cachedInside) return cachedInside;
    const built = await prepareSourceRuntimeUploadAsset({
      sourceRuntimeRoot: sourceRoot,
      sourceCommit,
      runtimeReleaseTag: args.runtimeReleaseTag,
      manifestPath: args.manifestPath,
      packageKind: args.packageKind,
      platform: args.platform,
      signal: args.signal,
    });
    await writeSourceRuntimeCache({ ...cacheArgs, archiveData: built.archiveData });
    return built;
  });
}

export function runtimeProcessHelperArchiveFromRuntimePackage(runtimeArchive: Buffer): Buffer {
  return createSingleFileTarGzip('redeven', runtimeExecutableFromArchive(runtimeArchive), 0o700);
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

  const sourceEntries = await readDirectoryIfPresent(policy.cacheRoot);
  await Promise.all(sourceEntries.map(async (sourceEntry) => {
    if (sourceEntry.name === SOURCE_RUNTIME_CACHE_DIR || sourceEntry.name === REDEVPLUGIN_MANIFEST_CACHE_DIR) {
      return;
    }
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
    const fetchPolicy = {
      ...args.fetchPolicy,
      signal: args.signal,
    };
    await pruneDesktopRuntimePackageCache({
      cacheRoot: args.assetCacheRoot,
      activeReleaseTag: runtimeReleaseTag,
      includeTemporaryEntries: false,
    }).catch(() => undefined);

    const sourceRoot = compact(args.sourceRuntimeRoot);
    let redevpluginReleaseTag = 'none';
    let pluginManifest: Readonly<{ path: string; digest: string }> | undefined;
    if (sourceRoot !== '' && packageKind === 'runtime') {
      const normalizedSourceRoot = normalizeSourceRuntimeRoot(sourceRoot);
      redevpluginReleaseTag = await readReDevPluginReleaseTag(normalizedSourceRoot, args.signal);
      const sourceCommit = await readSourceRuntimeCommit(normalizedSourceRoot, args.signal);
      const sourceCacheLookup = {
        cacheRoot: args.assetCacheRoot,
        sourceRoot: normalizedSourceRoot,
        sourceCommit,
        runtimeReleaseTag,
        redevpluginReleaseTag,
        packageKind,
        platform: args.platform,
      } as const;
      try {
        pluginManifest = await ensureReDevPluginManifest({
          cacheRoot: args.assetCacheRoot,
          redevpluginReleaseTag,
          fetchPolicy,
          signal: args.signal,
        });
      } catch (error) {
        if (!(error instanceof DesktopReleaseAssetError)) {
          throw error;
        }
        const cachedSource = await findSourceRuntimeCache(sourceCacheLookup);
        if (cachedSource) return cachedSource;
        throw error;
      }
    }
    const sourceAsset = await ensureSourceRuntimeUploadAsset({
      sourceRuntimeRoot: args.sourceRuntimeRoot ?? '',
      cacheRoot: args.assetCacheRoot,
      runtimeReleaseTag,
      redevpluginReleaseTag,
      packageKind,
      platform: args.platform,
      ...(pluginManifest ? { manifestPath: pluginManifest.path, manifestDigest: pluginManifest.digest } : {}),
      signal: args.signal,
    });
    if (sourceAsset) {
      return sourceAsset;
    }

    const releaseManifest = await ensureReleaseManifest({
      releaseTag: runtimeReleaseTag,
      releaseBaseURL: args.releaseBaseURL,
      cacheRoot: args.assetCacheRoot,
      fetchPolicy,
    });
    const cacheEntry = await ensureReleaseAssetEntry({
      manifest: releaseManifest,
      platform: args.platform,
      packageKind,
      cacheRoot: args.assetCacheRoot,
      fetchPolicy,
    });
    const archiveData = await fs.readFile(cacheEntry.archive_path);
    return {
      archiveData,
      cacheEntry,
      source: 'release_cache',
    };
  } catch (error) {
    if (compact(args.sourceRuntimeRoot) !== '') {
      throw runtimePackagePreparationFailure(error, args.platform, packageKind);
    }
    const isGateway = packageKind === 'gateway';
    throw new DesktopOperationFailureError(desktopOperationFailurePresentation({
      code: isGateway ? 'gateway_package_prepare_failed' : 'runtime_package_prepare_failed',
      title: isGateway ? 'Gateway package preparation failed' : 'Runtime package preparation failed',
      ...(isGateway ? {} : {
        titleKey: 'progress.runtimePackagePrepareFailedTitle' as const,
        summaryKey: 'progress.runtimePackagePrepareFailedSummary' as const,
        detailKey: 'progress.runtimePackagePrepareFailedDetail' as const,
        recoveryHintKey: 'progress.runtimePackagePrepareFailedRecoveryHint' as const,
      }),
      summary: `Desktop could not prepare the ${args.platform.platform_label} ${isGateway ? 'Redeven Gateway' : 'Redeven runtime'} package.`,
      detail: 'Package preparation failed before Desktop changed the target environment.',
      recoveryHint: `Check the verified release source or local cache and retry the ${isGateway ? 'Gateway service' : 'runtime lifecycle'} action.`,
      diagnostics: [{
        channel: isGateway ? 'gateway_package_cache' : 'runtime_package_cache',
        label: 'Package preparation output',
        text: error instanceof Error ? error.message : String(error),
      }],
    }), {
      cause: error,
      ...(isGateway ? {} : { runtimeLifecycleStepID: 'preparing_runtime_package' as const }),
    });
  }
}
