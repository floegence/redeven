import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyDesktopSSHReleaseManifestSignature } from './sshReleaseTrust';

export const PUBLIC_REDEVEN_RELEASE_BASE_URL = 'https://github.com/floegence/redeven/releases';
export const DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS = 30_000;

export type DesktopSSHRemotePlatform = Readonly<{
  goos: 'linux' | 'darwin';
  goarch: 'amd64' | 'arm64' | 'arm' | '386';
  platform_id: 'linux_amd64' | 'linux_arm64' | 'linux_arm' | 'linux_386' | 'darwin_amd64' | 'darwin_arm64';
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

type EnsureDesktopSSHReleaseArchiveArgs = Readonly<{
  manifest: DesktopSSHVerifiedReleaseManifest;
  platform: DesktopSSHRemotePlatform;
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

function parseRemoteUnameOS(rawOS: string): 'linux' | 'darwin' {
  const clean = compact(rawOS).toLowerCase();
  if (clean.startsWith('linux')) {
    return 'linux';
  }
  if (clean.startsWith('darwin')) {
    return 'darwin';
  }
  throw new Error(`Unsupported remote operating system for SSH bootstrap: ${rawOS}`);
}

function parseRemoteUnameArch(rawArch: string): 'amd64' | 'arm64' | 'arm' | '386' {
  const clean = compact(rawArch).toLowerCase();
  switch (clean) {
    case 'x86_64':
    case 'amd64':
      return 'amd64';
    case 'aarch64':
    case 'arm64':
      return 'arm64';
    case 'armv7l':
    case 'armv6l':
      return 'arm';
    case 'i386':
    case 'i686':
      return '386';
    default:
      throw new Error(`Unsupported remote architecture for SSH bootstrap: ${rawArch}`);
  }
}

export function resolveDesktopSSHRemotePlatform(rawOS: string, rawArch: string): DesktopSSHRemotePlatform {
  const goos = parseRemoteUnameOS(rawOS);
  const goarch = parseRemoteUnameArch(rawArch);
  const platformID = `${goos}_${goarch}` as DesktopSSHRemotePlatform['platform_id'];
  return {
    goos,
    goarch,
    platform_id: platformID,
    release_package_name: `redeven_${goos}_${goarch}.tar.gz`,
    platform_label: `${goos}/${goarch}`,
  };
}

export function buildDesktopSSHReleaseAssetURL(
  rawReleaseBaseURL: string,
  releaseTag: string,
  assetName: string,
): string {
  return `${releaseBaseURL(rawReleaseBaseURL)}/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`;
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
  await fs.writeFile(targetPath, data);
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
  const baseURL = releaseBaseURL(args.releaseBaseURL);
  verifyDesktopSSHReleaseManifestSignature({
    sumsText: args.sumsText,
    signature: args.signature,
    certificate: args.certificate,
  });
  return {
    release_tag: args.releaseTag,
    release_base_url: baseURL,
    source_cache_key: buildDesktopSSHReleaseSourceCacheKey(baseURL),
    sums_text: args.sumsText,
    sha256_by_asset_name: parseDesktopSSHReleaseSHA256Map(args.sumsText),
  };
}

export async function ensureDesktopSSHVerifiedReleaseManifest(
  args: EnsureDesktopSSHVerifiedReleaseManifestArgs,
): Promise<DesktopSSHVerifiedReleaseManifest> {
  const baseURL = releaseBaseURL(args.releaseBaseURL);
  const sourceCacheKey = buildDesktopSSHReleaseSourceCacheKey(baseURL);
  const cacheDir = path.join(args.cacheRoot, sourceCacheKey, args.releaseTag);
  const sumsPath = path.join(cacheDir, 'SHA256SUMS');
  const signaturePath = path.join(cacheDir, 'SHA256SUMS.sig');
  const certificatePath = path.join(cacheDir, 'SHA256SUMS.pem');

  await fs.mkdir(cacheDir, { recursive: true });

  const cachedSums = await readOptionalBuffer(sumsPath);
  const cachedSignature = await readOptionalBuffer(signaturePath);
  const cachedCertificate = await readOptionalBuffer(certificatePath);
  if (cachedSums && cachedSignature && cachedCertificate) {
    try {
      return verifyDesktopSSHReleaseManifest({
        releaseTag: args.releaseTag,
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
    downloadText(buildDesktopSSHReleaseAssetURL(baseURL, args.releaseTag, 'SHA256SUMS'), args.fetchPolicy),
    downloadBuffer(buildDesktopSSHReleaseAssetURL(baseURL, args.releaseTag, 'SHA256SUMS.sig'), args.fetchPolicy),
    downloadBuffer(buildDesktopSSHReleaseAssetURL(baseURL, args.releaseTag, 'SHA256SUMS.pem'), args.fetchPolicy),
  ]);
  const manifest = verifyDesktopSSHReleaseManifest({
    releaseTag: args.releaseTag,
    releaseBaseURL: baseURL,
    sumsText,
    signature,
    certificate,
  });
  await Promise.all([
    fs.writeFile(sumsPath, sumsText, 'utf8'),
    fs.writeFile(signaturePath, signature),
    fs.writeFile(certificatePath, certificate),
  ]);
  return manifest;
}

export async function ensureDesktopSSHReleaseArchive(
  args: EnsureDesktopSSHReleaseArchiveArgs,
): Promise<DesktopSSHResolvedReleaseAsset> {
  const cacheDir = path.join(
    args.cacheRoot,
    args.manifest.source_cache_key,
    args.manifest.release_tag,
    args.platform.platform_id,
  );
  const archivePath = path.join(cacheDir, args.platform.release_package_name);

  await fs.mkdir(cacheDir, { recursive: true });

  const sha256 = args.manifest.sha256_by_asset_name.get(args.platform.release_package_name);
  if (!sha256) {
    throw new Error(`SHA256SUMS did not include ${args.platform.release_package_name}.`);
  }

  try {
    await verifyDesktopSSHReleaseAsset(archivePath, sha256);
  } catch {
    await downloadURLToPath(
      buildDesktopSSHReleaseAssetURL(args.manifest.release_base_url, args.manifest.release_tag, args.platform.release_package_name),
      archivePath,
      args.fetchPolicy,
    );
    await verifyDesktopSSHReleaseAsset(archivePath, sha256);
  }

  return {
    release_tag: args.manifest.release_tag,
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
