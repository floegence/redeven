import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const DESKTOP_BUNDLE_MANIFEST_NAME = 'desktop-bundle-manifest.json';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const execFileAsync = promisify(execFile);

export type DesktopBundleArtifact = Readonly<{
  path: string;
  sha256: string;
  size_bytes: number;
  executable: boolean;
}>;

export type DesktopBundle = Readonly<{
  root: string;
  manifest_path: string;
  version: string;
  commit: string;
  platform: 'darwin' | 'linux';
  architecture: 'amd64' | 'arm64';
  gateway: DesktopBundleArtifact;
  runtime_suite: readonly DesktopBundleArtifact[];
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
    relativePath === ''
    || path.basename(relativePath) !== relativePath
    || relativePath === '.'
    || !SHA256_PATTERN.test(digest)
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes <= 0
    || typeof artifact.executable !== 'boolean'
  ) {
    throw new Error(`Desktop bundle ${label} is invalid.`);
  }
  return {
    path: relativePath,
    sha256: digest,
    size_bytes: sizeBytes,
    executable: artifact.executable,
  };
}

async function readRegularFile(filePath: string, label: string): Promise<Readonly<{
  bytes: Buffer;
  mode: number;
}>> {
  const before = await fs.promises.lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new Error(`Desktop bundle ${label} is missing.`);
    }
    throw error;
  });
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`Desktop bundle ${label} must be a regular non-symlink file.`);
  }
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

async function validateArtifact(
  root: string,
  artifact: DesktopBundleArtifact,
  label: string,
): Promise<DesktopBundleArtifact> {
  const absolutePath = path.join(root, artifact.path);
  const file = await readRegularFile(absolutePath, label);
  if (file.bytes.length !== artifact.size_bytes) {
    throw new Error(`Desktop bundle ${label} size does not match its manifest.`);
  }
  const digest = createHash('sha256').update(file.bytes).digest('hex');
  if (digest !== artifact.sha256) {
    throw new Error(`Desktop bundle ${label} digest does not match its manifest.`);
  }
  if (artifact.executable && (file.mode & 0o111) === 0) {
    throw new Error(`Desktop bundle ${label} is not executable.`);
  }
  return { ...artifact, path: absolutePath };
}

async function validateBinaryIdentity(
  filePath: string,
  binaryName: 'redeven' | 'redeven-gateway',
  version: string,
  commit: string,
): Promise<void> {
  let stdout: string;
  try {
    const result = await execFileAsync(filePath, ['version'], {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    stdout = result.stdout;
  } catch (error) {
    throw new Error(`Desktop bundle ${binaryName} identity check failed.`, { cause: error });
  }
  const match = stdout.trim().match(/^(redeven(?:-gateway)?)\s+(\S+)\s+\(([^)]+)\)(?:\s|$)/u);
  if (!match || match[1] !== binaryName) {
    throw new Error(`Desktop bundle ${binaryName} identity is invalid.`);
  }
  if (normalizedVersion(match[2]) !== normalizedVersion(version)) {
    throw new Error(`Desktop bundle ${binaryName} version does not match its manifest.`);
  }
  if (compact(match[3]) !== commit) {
    throw new Error(`Desktop bundle ${binaryName} commit does not match its manifest.`);
  }
}

export async function loadDesktopBundle(options: LoadDesktopBundleOptions): Promise<DesktopBundle> {
  const root = path.resolve(compact(options.root));
  if (compact(options.root) === '') {
    throw new Error('Desktop bundle root is missing.');
  }
  const manifestPath = path.join(root, DESKTOP_BUNDLE_MANIFEST_NAME);
  const manifestFile = await readRegularFile(manifestPath, 'manifest');
  let decoded: unknown;
  try {
    decoded = JSON.parse(manifestFile.bytes.toString('utf8'));
  } catch {
    throw new Error('Desktop bundle manifest is not valid JSON.');
  }
  const manifest = requireObject(decoded, 'manifest');
  requireExactKeys(
    manifest,
    ['architecture', 'commit', 'gateway', 'platform', 'runtime_suite', 'schema_version', 'version'],
    'manifest',
  );
  if (manifest.schema_version !== 1) {
    throw new Error('Desktop bundle manifest schema is unsupported.');
  }
  const version = compact(manifest.version);
  const commit = compact(manifest.commit);
  const platform = compact(manifest.platform);
  const architecture = compact(manifest.architecture);
  if (version === '' || commit === '') {
    throw new Error('Desktop bundle version and commit are required.');
  }
  if (platform !== compact(options.expectedPlatform)) {
    throw new Error(`Desktop bundle platform ${platform || '(missing)'} does not match ${options.expectedPlatform}.`);
  }
  if (architecture !== compact(options.expectedArchitecture)) {
    throw new Error(`Desktop bundle architecture ${architecture || '(missing)'} does not match ${options.expectedArchitecture}.`);
  }
  if (options.expectedVersion && normalizedVersion(version) !== normalizedVersion(options.expectedVersion)) {
    throw new Error(`Desktop bundle version ${version} does not match ${options.expectedVersion}.`);
  }
  if (options.expectedCommit && commit !== compact(options.expectedCommit)) {
    throw new Error(`Desktop bundle commit ${commit} does not match ${options.expectedCommit}.`);
  }
  if ((platform !== 'darwin' && platform !== 'linux') || (architecture !== 'amd64' && architecture !== 'arm64')) {
    throw new Error('Desktop bundle target is unsupported.');
  }
  const gateway = parseArtifact(manifest.gateway, 'Gateway');
  if (gateway.path !== 'redeven-gateway' || !gateway.executable) {
    throw new Error('Desktop bundle Gateway entry is invalid.');
  }
  if (!Array.isArray(manifest.runtime_suite) || manifest.runtime_suite.length === 0) {
    throw new Error('Desktop bundle Runtime suite is missing.');
  }
  const runtimeSuite = manifest.runtime_suite.map((value, index) => parseArtifact(value, `Runtime suite entry ${index + 1}`));
  const runtimeNames = new Set(runtimeSuite.map((artifact) => artifact.path));
  if (runtimeNames.size !== runtimeSuite.length || !runtimeNames.has('redeven')) {
    throw new Error('Desktop bundle Runtime suite inventory is invalid.');
  }
  const runtime = runtimeSuite.find((artifact) => artifact.path === 'redeven');
  if (!runtime?.executable) {
    throw new Error('Desktop bundle Runtime executable entry is invalid.');
  }
  const [validatedGateway, ...validatedRuntimeSuite] = await Promise.all([
    validateArtifact(root, gateway, 'Gateway'),
    ...runtimeSuite.map((artifact) => validateArtifact(root, artifact, `Runtime file ${artifact.path}`)),
  ]);
  const validatedRuntime = validatedRuntimeSuite.find((artifact) => path.basename(artifact.path) === 'redeven');
  if (!validatedRuntime) {
    throw new Error('Desktop bundle Runtime executable entry is missing after validation.');
  }
  await Promise.all([
    validateBinaryIdentity(validatedGateway.path, 'redeven-gateway', version, commit),
    validateBinaryIdentity(validatedRuntime.path, 'redeven', version, commit),
  ]);
  return {
    root,
    manifest_path: manifestPath,
    version: version.startsWith('v') ? version : `v${version}`,
    commit,
    platform,
    architecture,
    gateway: validatedGateway,
    runtime_suite: validatedRuntimeSuite,
  };
}
