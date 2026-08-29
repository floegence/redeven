import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const DESKTOP_BUNDLE_MANIFEST_NAME = 'desktop-bundle-manifest.json';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const execFileAsync = promisify(execFile);
const NATIVE_RUNTIME_FILES = Object.freeze([
  '.redevplugin-release-artifacts-verified.json',
  'REDEVPLUGIN_RUNTIME.spdx.json',
  'REDEVPLUGIN_THIRD_PARTY_NOTICES.md',
  'redeven',
  'redevplugin-runtime',
  'redevplugin-runtime.pem',
  'redevplugin-runtime.provenance.json',
  'redevplugin-runtime.sig',
].sort((left, right) => left.localeCompare(right)));
const MANAGED_WSL_ARCHIVE_FILES = Object.freeze([
  '.redevplugin-release-artifacts-verified.json',
  'LICENSE',
  'REDEVPLUGIN_RUNTIME.spdx.json',
  'REDEVPLUGIN_THIRD_PARTY_NOTICES.md',
  'THIRD_PARTY_NOTICES.md',
  'redeven',
  'redevplugin-runtime',
  'redevplugin-runtime.pem',
  'redevplugin-runtime.provenance.json',
  'redevplugin-runtime.sig',
].sort((left, right) => left.localeCompare(right)));

export type DesktopBundleArtifact = Readonly<{
  path: string;
  sha256: string;
  size_bytes: number;
  executable: boolean;
}>;

export type DesktopManagedWSLRuntimeAttestation = Readonly<{
  archive_path: 'redeven_linux_amd64.tar.gz';
  archive_sha256: string;
  archive_size_bytes: number;
  platform: 'linux';
  architecture: 'amd64';
  version: string;
  commit: string;
  archive_files: readonly string[];
}>;

export type DesktopBundle = Readonly<{
  root: string;
  manifest_path: string;
  version: string;
  commit: string;
  platform: 'darwin' | 'linux' | 'windows';
  architecture: 'amd64' | 'arm64';
  distribution_kind: 'bundled_host_runtime' | 'managed_wsl_archive';
  provenance: 'packaged_bundle' | 'development_bundle';
  runtime_files: readonly DesktopBundleArtifact[];
  runtime_files_sha256: string;
  managed_wsl_runtime?: DesktopManagedWSLRuntimeAttestation;
  managed_wsl_archive_path?: string;
}>;

type LoadDesktopBundleOptions = Readonly<{
  root: string;
  expectedPlatform: string;
  expectedArchitecture: string;
  expectedVersion?: string;
  expectedCommit?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizedVersion(value: unknown): string {
  const clean = compact(value);
  return clean.startsWith('v') ? clean.slice(1) : clean;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Desktop bundle ${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Desktop bundle ${label} has an unsupported shape.`);
  }
}

function parseArtifact(value: unknown, label: string): DesktopBundleArtifact {
  const artifact = requireObject(value, label);
  requireExactKeys(artifact, ['executable', 'path', 'sha256', 'size_bytes'], label);
  const relativePath = compact(artifact.path);
  const digest = compact(artifact.sha256).toLowerCase().replace(/^sha256:/u, '');
  const sizeBytes = Number(artifact.size_bytes);
  if (
    relativePath === '' || path.basename(relativePath) !== relativePath || relativePath === '.'
    || !SHA256_PATTERN.test(digest) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0
    || typeof artifact.executable !== 'boolean'
  ) {
    throw new Error(`Desktop bundle ${label} is invalid.`);
  }
  return { path: relativePath, sha256: digest, size_bytes: sizeBytes, executable: artifact.executable };
}

function parseManagedWSLRuntimeAttestation(
  value: unknown,
  archive: DesktopBundleArtifact,
  version: string,
  commit: string,
): DesktopManagedWSLRuntimeAttestation {
  const record = requireObject(value, 'managed WSL Runtime attestation');
  requireExactKeys(record, [
    'architecture',
    'archive_files',
    'archive_path',
    'archive_sha256',
    'archive_size_bytes',
    'commit',
    'platform',
    'version',
  ], 'managed WSL Runtime attestation');
  const archivePath = compact(record.archive_path);
  const archiveSHA256 = compact(record.archive_sha256).toLowerCase();
  const archiveSizeBytes = Number(record.archive_size_bytes);
  const archiveFiles = Array.isArray(record.archive_files)
    ? record.archive_files.map((entry) => compact(entry))
    : [];
  if (
    archivePath !== 'redeven_linux_amd64.tar.gz'
    || archiveSHA256 !== archive.sha256
    || archiveSizeBytes !== archive.size_bytes
    || record.platform !== 'linux'
    || record.architecture !== 'amd64'
    || normalizedVersion(record.version) !== normalizedVersion(version)
    || compact(record.commit) !== commit
    || JSON.stringify(archiveFiles) !== JSON.stringify(MANAGED_WSL_ARCHIVE_FILES)
  ) {
    throw new Error('Desktop bundle managed WSL Runtime attestation is invalid.');
  }
  return {
    archive_path: archivePath,
    archive_sha256: archiveSHA256,
    archive_size_bytes: archiveSizeBytes,
    platform: 'linux',
    architecture: 'amd64',
    version: compact(record.version),
    commit,
    archive_files: archiveFiles,
  };
}

async function readRegularFile(filePath: string, label: string): Promise<Readonly<{ bytes: Buffer; mode: number }>> {
  const before = await fs.promises.lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new Error(`Desktop bundle ${label} is missing.`);
    throw error;
  });
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`Desktop bundle ${label} must be a regular non-symlink file.`);
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`Desktop bundle ${label} changed while it was being validated.`);
    }
    return { bytes: await handle.readFile(), mode: opened.mode };
  } finally {
    await handle.close();
  }
}

async function validateArtifact(root: string, artifact: DesktopBundleArtifact, label: string): Promise<DesktopBundleArtifact> {
  const file = await readRegularFile(path.join(root, artifact.path), label);
  if (file.bytes.length !== artifact.size_bytes) throw new Error(`Desktop bundle ${label} size does not match its manifest.`);
  if (createHash('sha256').update(file.bytes).digest('hex') !== artifact.sha256) {
    throw new Error(`Desktop bundle ${label} digest does not match its manifest.`);
  }
  if (artifact.executable && (file.mode & 0o111) === 0) throw new Error(`Desktop bundle ${label} is not executable.`);
  return { ...artifact, path: path.join(root, artifact.path) };
}

async function validateBinaryIdentity(filePath: string, version: string, commit: string): Promise<void> {
  let stdout: string;
  try {
    stdout = (await execFileAsync(filePath, ['version'], { encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024 })).stdout;
  } catch (error) {
    throw new Error('Desktop bundle Runtime identity check failed.', { cause: error });
  }
  const match = stdout.trim().match(/^redeven\s+(\S+)\s+\(([^)]+)\)(?:\s|$)/u);
  if (!match) throw new Error('Desktop bundle Runtime identity output is invalid.');
  if (normalizedVersion(match[1]) !== normalizedVersion(version)) {
    throw new Error(`Desktop bundle Runtime version ${match[1]} does not match manifest version ${version}.`);
  }
  if (compact(match[2]) !== commit) {
    throw new Error(`Desktop bundle Runtime commit ${match[2]} does not match manifest commit ${commit}.`);
  }
}

export async function loadDesktopBundle(options: LoadDesktopBundleOptions): Promise<DesktopBundle> {
  const root = path.resolve(compact(options.root));
  if (compact(options.root) === '') throw new Error('Desktop bundle root is missing.');
  const manifestPath = path.join(root, DESKTOP_BUNDLE_MANIFEST_NAME);
  const manifestFile = await readRegularFile(manifestPath, 'manifest');
  let decoded: unknown;
  try { decoded = JSON.parse(manifestFile.bytes.toString('utf8')); } catch { throw new Error('Desktop bundle manifest is not valid JSON.'); }
  const manifest = requireObject(decoded, 'manifest');
  requireExactKeys(manifest, ['architecture', 'commit', 'distribution_kind', 'managed_wsl_runtime', 'platform', 'provenance', 'runtime_files', 'runtime_files_sha256', 'schema_version', 'version'], 'manifest');
  if (manifest.schema_version !== 4) throw new Error('Desktop bundle manifest schema is unsupported.');
  const version = compact(manifest.version);
  const commit = compact(manifest.commit);
  const platform = compact(manifest.platform);
  const architecture = compact(manifest.architecture);
  const provenance = compact(manifest.provenance);
  const distributionKind = compact(manifest.distribution_kind);
  const filesDigest = compact(manifest.runtime_files_sha256).toLowerCase();
  if (!version || !commit) throw new Error('Desktop bundle version and commit are required.');
  if (platform !== compact(options.expectedPlatform)) throw new Error(`Desktop bundle platform ${platform || '(missing)'} does not match ${options.expectedPlatform}.`);
  if (architecture !== compact(options.expectedArchitecture)) throw new Error(`Desktop bundle architecture ${architecture || '(missing)'} does not match ${options.expectedArchitecture}.`);
  if (options.expectedVersion && normalizedVersion(version) !== normalizedVersion(options.expectedVersion)) throw new Error(`Desktop bundle version ${version} does not match ${options.expectedVersion}.`);
  if (options.expectedCommit && commit !== compact(options.expectedCommit)) throw new Error(`Desktop bundle commit ${commit} does not match ${options.expectedCommit}.`);
  if ((platform !== 'darwin' && platform !== 'linux' && platform !== 'windows') || (architecture !== 'amd64' && architecture !== 'arm64')) throw new Error('Desktop bundle target is unsupported.');
  if (platform === 'windows' && architecture !== 'amd64') throw new Error('Desktop bundle Windows target is unsupported.');
  if ((provenance !== 'packaged_bundle' && provenance !== 'development_bundle') || !/^sha256:[0-9a-f]{64}$/u.test(filesDigest)) throw new Error('Desktop bundle Runtime provenance or digest is invalid.');
  if (!Array.isArray(manifest.runtime_files) || manifest.runtime_files.length === 0) throw new Error('Desktop bundle Runtime files are missing.');
  const runtimeFiles = manifest.runtime_files.map((value, index) => parseArtifact(value, `Runtime file ${index + 1}`));
  if (new Set(runtimeFiles.map((artifact) => artifact.path)).size !== runtimeFiles.length) throw new Error('Desktop bundle Runtime inventory is invalid.');
  const runtime = runtimeFiles.find((artifact) => artifact.path === 'redeven');
  const wslArchive = runtimeFiles.find((artifact) => artifact.path === 'redeven_linux_amd64.tar.gz');
  if (platform === 'windows') {
    if (
      distributionKind !== 'managed_wsl_archive'
      || runtimeFiles.length !== 1
      || !wslArchive
      || wslArchive.executable
    ) {
      throw new Error('Desktop bundle managed WSL archive inventory is invalid.');
    }
  } else {
    const nativeInventory = runtimeFiles.map((artifact) => artifact.path).sort((left, right) => left.localeCompare(right));
    if (
      distributionKind !== 'bundled_host_runtime'
      || !runtime?.executable
      || JSON.stringify(nativeInventory) !== JSON.stringify(NATIVE_RUNTIME_FILES)
    ) {
      throw new Error('Desktop bundle Runtime inventory is invalid.');
    }
  }
  const identity = { schema_version: 1, files: runtimeFiles.map((artifact) => ({ name: artifact.path, sha256: `sha256:${artifact.sha256}`, size_bytes: artifact.size_bytes, executable: artifact.executable })).sort((a, b) => a.name.localeCompare(b.name)) };
  if (`sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}` !== filesDigest) throw new Error('Desktop bundle Runtime digest does not match its manifest.');
  const validated = await Promise.all(runtimeFiles.map((artifact) => validateArtifact(root, artifact, `Runtime file ${artifact.path}`)));
  const validatedRuntime = validated.find((artifact) => path.basename(artifact.path) === 'redeven');
  const validatedWSLArchive = validated.find((artifact) => path.basename(artifact.path) === 'redeven_linux_amd64.tar.gz');
  let managedWSLRuntime: DesktopManagedWSLRuntimeAttestation | undefined;
  if (platform === 'windows') {
    if (!validatedWSLArchive) throw new Error('Desktop bundle managed WSL archive is missing after validation.');
    managedWSLRuntime = parseManagedWSLRuntimeAttestation(manifest.managed_wsl_runtime, wslArchive!, version, commit);
  } else {
    if (manifest.managed_wsl_runtime !== null) {
      throw new Error('Desktop bundle native Runtime must not include a managed WSL attestation.');
    }
    if (!validatedRuntime) throw new Error('Desktop bundle Runtime executable is missing after validation.');
    await validateBinaryIdentity(validatedRuntime.path, version, commit);
  }
  return {
    root,
    manifest_path: manifestPath,
    version: version.startsWith('v') ? version : `v${version}`,
    commit,
    platform,
    architecture,
    distribution_kind: distributionKind as DesktopBundle['distribution_kind'],
    provenance,
    runtime_files: validated,
    runtime_files_sha256: filesDigest,
    ...(managedWSLRuntime ? { managed_wsl_runtime: managedWSLRuntime } : {}),
    ...(validatedWSLArchive ? { managed_wsl_archive_path: validatedWSLArchive.path } : {}),
  };
}
