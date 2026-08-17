import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  canonicalDesktopSSHReleaseTag,
  verifyDesktopSSHReleaseManifestSignature,
} from './sshReleaseTrust';

export const PUBLIC_REDEVEN_RELEASE_BASE_URL = 'https://github.com/floegence/redeven/releases';
export const DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS = 30_000;

export type DesktopSSHReleasePackageKind = 'runtime' | 'gateway';

export type DesktopSSHRemotePlatform = Readonly<{
  goos: 'linux' | 'darwin';
  goarch: 'amd64' | 'arm64';
  platform_id: 'linux_amd64' | 'linux_arm64' | 'darwin_amd64' | 'darwin_arm64';
  release_package_name: string;
  platform_label: string;
}>;

export type DesktopSSHResolvedReleaseAsset = Readonly<{
  release_tag: string;
  release_base_url: string;
  source_cache_key: string;
  platform: DesktopSSHRemotePlatform;
  archive_path: string;
  sha256: string;
}>;

export type DesktopSSHVerifiedReleaseManifest = Readonly<{
  release_tag: string;
  release_base_url: string;
  source_cache_key: string;
  sums_text: string;
  sha256_by_asset_name: ReadonlyMap<string, string>;
}>;

export type DesktopSSHReleaseFetchPolicy = Readonly<{
  timeout_ms: number;
  signal?: AbortSignal;
}>;

type EnsureDesktopSSHReleaseAssetArgs = Readonly<{
  releaseTag: string;
  releaseBaseURL: string;
  platform: DesktopSSHRemotePlatform;
  cacheRoot: string;
  fetchPolicy?: DesktopSSHReleaseFetchPolicy;
}>;

type EnsureDesktopSSHVerifiedReleaseManifestArgs = Readonly<{
  releaseTag: string;
  releaseBaseURL: string;
  cacheRoot: string;
  fetchPolicy?: DesktopSSHReleaseFetchPolicy;
}>;

export type DesktopSSHSignedReleaseJSONAsset = Readonly<{
  json_text: string;
  signature: string;
  certificate: string;
}>;

type EnsureDesktopSSHReleaseArchiveArgs = Readonly<{
  manifest: DesktopSSHVerifiedReleaseManifest;
  platform: DesktopSSHRemotePlatform;
  packageKind?: DesktopSSHReleasePackageKind;
  packageName?: string;
  cacheRoot: string;
  fetchPolicy?: DesktopSSHReleaseFetchPolicy;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function releaseBaseURL(rawURL: string): string {
  const clean = compact(rawURL);
  if (clean === '') {
    return PUBLIC_REDEVEN_RELEASE_BASE_URL;
  }
  const parsed = new URL(clean);
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/u, '');
}

function parseRemoteUnameOS(rawOS: string): 'linux' {
  const clean = compact(rawOS).toLowerCase();
  if (clean === 'linux') {
    return 'linux';
  }
  throw new Error(`Unsupported remote operating system for SSH bootstrap: ${rawOS}`);
}

function parseRemoteUnameArch(rawArch: string): 'amd64' | 'arm64' {
  const clean = compact(rawArch).toLowerCase();
  switch (clean) {
    case 'x86_64':
    case 'amd64':
      return 'amd64';
    case 'aarch64':
    case 'arm64':
      return 'arm64';
    default:
      throw new Error(`Unsupported remote architecture for SSH bootstrap: ${rawArch}`);
  }
}

export function resolveDesktopSSHRemotePlatform(rawOS: string, rawArch: string): DesktopSSHRemotePlatform {
  const goos = parseRemoteUnameOS(rawOS);
  const goarch = parseRemoteUnameArch(rawArch);
  const platformID: DesktopSSHRemotePlatform['platform_id'] = goarch === 'amd64'
    ? 'linux_amd64'
    : 'linux_arm64';
  return {
    goos,
    goarch,
    platform_id: platformID,
    release_package_name: `redeven_${goos}_${goarch}.tar.gz`,
    platform_label: `${goos}/${goarch}`,
  };
}

export function desktopSSHReleasePackageName(
  platform: Pick<DesktopSSHRemotePlatform, 'goos' | 'goarch'>,
  packageKind: DesktopSSHReleasePackageKind = 'runtime',
): string {
  const prefix = packageKind === 'gateway' ? 'redeven-gateway' : 'redeven';
  return `${prefix}_${platform.goos}_${platform.goarch}.tar.gz`;
}

export function buildDesktopSSHReleaseAssetURL(
  rawReleaseBaseURL: string,
  releaseTag: string,
  assetName: string,
): string {
  const canonicalReleaseTag = canonicalDesktopSSHReleaseTag(releaseTag);
  return `${releaseBaseURL(rawReleaseBaseURL)}/download/${encodeURIComponent(canonicalReleaseTag)}/${encodeURIComponent(assetName)}`;
}

export function buildDesktopSSHReleaseSourceCacheKey(rawReleaseBaseURL: string): string {
  const normalizedBaseURL = releaseBaseURL(rawReleaseBaseURL);
  const { hostname, pathname } = new URL(normalizedBaseURL);
  const slug = `${hostname}${pathname}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48) || 'release-source';
  const digest = createHash('sha256').update(normalizedBaseURL).digest('hex').slice(0, 16);
  return `${slug}-${digest}`;
}

function parseDesktopSSHReleaseSHA256Map(sumsText: string): ReadonlyMap<string, string> {
  const sha256ByAssetName = new Map<string, string>();
  for (const rawLine of String(sumsText ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/u.exec(line);
    if (!match) {
      continue;
    }
    sha256ByAssetName.set(match[2], match[1].toLowerCase());
  }
  return sha256ByAssetName;
}

export function parseDesktopSSHReleaseSHA256(
  sumsText: string,
  assetName: string,
): string {
  const sha256 = parseDesktopSSHReleaseSHA256Map(sumsText).get(assetName);
  if (sha256) {
    return sha256;
  }
  throw new Error(`SHA256SUMS did not include ${assetName}.`);
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const file = await fs.readFile(filePath);
  hash.update(file);
  return hash.digest('hex');
}

export async function verifyDesktopSSHReleaseAsset(
  filePath: string,
  expectedSHA256: string,
): Promise<void> {
  const actual = await sha256File(filePath);
  if (actual !== expectedSHA256.toLowerCase()) {
    throw new Error(`Release asset checksum mismatch for ${path.basename(filePath)}.`);
  }
}

function normalizeFetchPolicy(fetchPolicy?: DesktopSSHReleaseFetchPolicy): DesktopSSHReleaseFetchPolicy {
  const timeoutMs = Number(fetchPolicy?.timeout_ms ?? DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('Desktop SSH release fetch timeout must be a positive integer.');
  }
  return {
    timeout_ms: timeoutMs,
    signal: fetchPolicy?.signal,
  };
}

function releaseFetchCanceledError(): DOMException {
  return new DOMException('SSH runtime startup was canceled while downloading release assets.', 'AbortError');
}

function throwIfReleaseFetchCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw releaseFetchCanceledError();
  }
}

async function withFetchedReleaseAsset<T>(
  sourceURL: string,
  fetchPolicy: DesktopSSHReleaseFetchPolicy | undefined,
  consume: (response: Response, signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  const policy = normalizeFetchPolicy(fetchPolicy);
  throwIfReleaseFetchCanceled(policy.signal);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, policy.timeout_ms);
  const abort = () => controller.abort();
  policy.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(sourceURL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}) for ${sourceURL}`);
    }
    throwIfReleaseFetchCanceled(policy.signal);
    const result = await consume(response, policy.signal);
    throwIfReleaseFetchCanceled(policy.signal);
    return result;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException | DOMException | undefined;
    if (policy.signal?.aborted) {
      throw releaseFetchCanceledError();
    }
    if (timedOut || nodeError?.name === 'TimeoutError') {
      throw new Error(`Timed out after ${policy.timeout_ms}ms downloading ${sourceURL}`);
    }
    if (nodeError?.name === 'AbortError') {
      throw releaseFetchCanceledError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
    policy.signal?.removeEventListener('abort', abort);
  }
}

async function downloadURLToPath(
  sourceURL: string,
  targetPath: string,
  fetchPolicy?: DesktopSSHReleaseFetchPolicy,
): Promise<void> {
  const data = await withFetchedReleaseAsset(sourceURL, fetchPolicy, async (response, signal) => {
    const buffer = Buffer.from(await response.arrayBuffer());
    throwIfReleaseFetchCanceled(signal);
    return buffer;
  });
  await writePrivateFileAtomically(targetPath, data);
}

async function writePrivateFileAtomically(targetPath: string, data: Buffer | string): Promise<void> {
  const targetDir = path.dirname(targetPath);
  await fs.mkdir(targetDir, { recursive: true, mode: 0o700 });
  const tempPath = path.join(targetDir, `.${path.basename(targetPath)}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(tempPath, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, targetPath);
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function downloadText(sourceURL: string, fetchPolicy?: DesktopSSHReleaseFetchPolicy): Promise<string> {
  return withFetchedReleaseAsset(sourceURL, fetchPolicy, async (response, signal) => {
    const text = await response.text();
    throwIfReleaseFetchCanceled(signal);
    return text;
  });
}

async function downloadBuffer(sourceURL: string, fetchPolicy?: DesktopSSHReleaseFetchPolicy): Promise<Buffer> {
  return withFetchedReleaseAsset(sourceURL, fetchPolicy, async (response, signal) => {
    const data = Buffer.from(await response.arrayBuffer());
    throwIfReleaseFetchCanceled(signal);
    return data;
  });
}

async function readOptionalBuffer(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

export function verifyDesktopSSHReleaseManifest(args: Readonly<{
  releaseTag: string;
  releaseBaseURL: string;
  sumsText: string;
  signature: Buffer | string;
  certificate: Buffer | string;
}>): DesktopSSHVerifiedReleaseManifest {
  const releaseTag = canonicalDesktopSSHReleaseTag(args.releaseTag);
  const baseURL = releaseBaseURL(args.releaseBaseURL);
  verifyDesktopSSHReleaseManifestSignature({
    releaseTag,
    sumsText: args.sumsText,
    signature: args.signature,
    certificate: args.certificate,
  });
  return {
    release_tag: releaseTag,
    release_base_url: baseURL,
    source_cache_key: buildDesktopSSHReleaseSourceCacheKey(baseURL),
    sums_text: args.sumsText,
    sha256_by_asset_name: parseDesktopSSHReleaseSHA256Map(args.sumsText),
  };
}

export async function ensureDesktopSSHVerifiedReleaseManifest(
  args: EnsureDesktopSSHVerifiedReleaseManifestArgs,
): Promise<DesktopSSHVerifiedReleaseManifest> {
  const releaseTag = canonicalDesktopSSHReleaseTag(args.releaseTag);
  const baseURL = releaseBaseURL(args.releaseBaseURL);
  const sourceCacheKey = buildDesktopSSHReleaseSourceCacheKey(baseURL);
  const cacheDir = path.join(args.cacheRoot, sourceCacheKey, releaseTag);
  const sumsPath = path.join(cacheDir, 'SHA256SUMS');
  const signaturePath = path.join(cacheDir, 'SHA256SUMS.sig');
  const certificatePath = path.join(cacheDir, 'SHA256SUMS.pem');

  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });

  const cachedSums = await readOptionalBuffer(sumsPath);
  const cachedSignature = await readOptionalBuffer(signaturePath);
  const cachedCertificate = await readOptionalBuffer(certificatePath);
  if (cachedSums && cachedSignature && cachedCertificate) {
    try {
      return verifyDesktopSSHReleaseManifest({
        releaseTag,
        releaseBaseURL: baseURL,
        sumsText: cachedSums.toString('utf8'),
        signature: cachedSignature,
        certificate: cachedCertificate,
      });
    } catch {
      // Re-download the manifest bundle if any cached verification material is stale or corrupted.
    }
  }

  const [sumsText, signature, certificate] = await Promise.all([
    downloadText(buildDesktopSSHReleaseAssetURL(baseURL, releaseTag, 'SHA256SUMS'), args.fetchPolicy),
    downloadBuffer(buildDesktopSSHReleaseAssetURL(baseURL, releaseTag, 'SHA256SUMS.sig'), args.fetchPolicy),
    downloadBuffer(buildDesktopSSHReleaseAssetURL(baseURL, releaseTag, 'SHA256SUMS.pem'), args.fetchPolicy),
  ]);
  const manifest = verifyDesktopSSHReleaseManifest({
    releaseTag,
    releaseBaseURL: baseURL,
    sumsText,
    signature,
    certificate,
  });
  await Promise.all([
    writePrivateFileAtomically(sumsPath, sumsText),
    writePrivateFileAtomically(signaturePath, signature),
    writePrivateFileAtomically(certificatePath, certificate),
  ]);
  return manifest;
}

export async function fetchDesktopSSHSignedReleaseJSONAsset(args: Readonly<{
  manifest: DesktopSSHVerifiedReleaseManifest;
  asset_name: string;
  signature_name: string;
  certificate_name: string;
  fetchPolicy?: DesktopSSHReleaseFetchPolicy;
}>): Promise<DesktopSSHSignedReleaseJSONAsset> {
  const expectedSHA256 = args.manifest.sha256_by_asset_name.get(args.asset_name);
  if (!expectedSHA256) {
    throw new Error(`SHA256SUMS did not include ${args.asset_name}.`);
  }
  const [jsonBuffer, signature, certificate] = await Promise.all([
    downloadBuffer(buildDesktopSSHReleaseAssetURL(
      args.manifest.release_base_url,
      args.manifest.release_tag,
      args.asset_name,
    ), args.fetchPolicy),
    downloadBuffer(buildDesktopSSHReleaseAssetURL(
      args.manifest.release_base_url,
      args.manifest.release_tag,
      args.signature_name,
    ), args.fetchPolicy),
    downloadBuffer(buildDesktopSSHReleaseAssetURL(
      args.manifest.release_base_url,
      args.manifest.release_tag,
      args.certificate_name,
    ), args.fetchPolicy),
  ]);
  const actualSHA256 = createHash('sha256').update(jsonBuffer).digest('hex');
  if (actualSHA256 !== expectedSHA256.toLowerCase()) {
    throw new Error(`Release asset checksum mismatch for ${args.asset_name}.`);
  }
  const jsonText = jsonBuffer.toString('utf8');
  verifyDesktopSSHReleaseManifestSignature({
    releaseTag: args.manifest.release_tag,
    sumsText: jsonText,
    signature,
    certificate,
  });
  return {
    json_text: jsonText,
    signature: signature.toString('base64'),
    certificate: certificate.toString('utf8'),
  };
}

export async function ensureDesktopSSHReleaseArchive(
  args: EnsureDesktopSSHReleaseArchiveArgs,
): Promise<DesktopSSHResolvedReleaseAsset> {
  const releaseTag = canonicalDesktopSSHReleaseTag(args.manifest.release_tag);
  const packageName = compact(args.packageName)
    || desktopSSHReleasePackageName(args.platform, args.packageKind ?? 'runtime');
  const cacheDir = path.join(
    args.cacheRoot,
    args.manifest.source_cache_key,
    releaseTag,
    args.platform.platform_id,
  );
  const archivePath = path.join(cacheDir, packageName);

  await fs.mkdir(cacheDir, { recursive: true });

  const sha256 = args.manifest.sha256_by_asset_name.get(packageName);
  if (!sha256) {
    throw new Error(`SHA256SUMS did not include ${packageName}.`);
  }

  try {
    await verifyDesktopSSHReleaseAsset(archivePath, sha256);
  } catch {
    await downloadURLToPath(
      buildDesktopSSHReleaseAssetURL(args.manifest.release_base_url, releaseTag, packageName),
      archivePath,
      args.fetchPolicy,
    );
    await verifyDesktopSSHReleaseAsset(archivePath, sha256);
  }

  return {
    release_tag: releaseTag,
    release_base_url: args.manifest.release_base_url,
    source_cache_key: args.manifest.source_cache_key,
    platform: args.platform,
    archive_path: archivePath,
    sha256,
  };
}

export async function ensureDesktopSSHReleaseAsset(
  args: EnsureDesktopSSHReleaseAssetArgs,
): Promise<DesktopSSHResolvedReleaseAsset> {
  const manifest = await ensureDesktopSSHVerifiedReleaseManifest({
    releaseTag: args.releaseTag,
    releaseBaseURL: args.releaseBaseURL,
    cacheRoot: args.cacheRoot,
    fetchPolicy: args.fetchPolicy,
  });
  return ensureDesktopSSHReleaseArchive({
    manifest,
    platform: args.platform,
    cacheRoot: args.cacheRoot,
    fetchPolicy: args.fetchPolicy,
  });
}
