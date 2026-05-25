import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CODE_WORKSPACE_ENGINE_GITHUB_API_RELEASE_LATEST_URL = 'https://api.github.com/repos/coder/code-server/releases/latest';
export const CODE_WORKSPACE_ENGINE_PUBLIC_RELEASE_BASE_URL = 'https://github.com/coder/code-server/releases';
export const DEFAULT_CODE_WORKSPACE_ENGINE_FETCH_TIMEOUT_MS = 60_000;

export type CodeWorkspaceEnginePlatform = Readonly<{
  os: 'linux' | 'darwin';
  arch: 'amd64' | 'arm64';
  libc?: 'glibc' | 'unknown';
  platform_id: string;
}>;

export type CodeWorkspaceEngineReleaseAsset = Readonly<{
  version: string;
  release_tag: string;
  release_url: string;
  asset_name: string;
  download_url: string;
  platform: CodeWorkspaceEnginePlatform;
  root_dir_hint: string;
}>;

export type CodeWorkspaceEngineFetchPolicy = Readonly<{
  timeout_ms?: number;
  signal?: AbortSignal;
}>;

type GitHubReleaseAsset = Readonly<{
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
}>;

type GitHubRelease = Readonly<{
  tag_name?: unknown;
  html_url?: unknown;
  assets?: unknown;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeCodeServerVersion(tagName: string): string {
  const clean = compact(tagName);
  if (clean === '') {
    throw new Error('Latest code-server release did not include a tag name.');
  }
  return clean.startsWith('v') ? clean.slice(1) : clean;
}

function platformAssetSuffix(platform: CodeWorkspaceEnginePlatform): string {
  if (platform.os === 'darwin') {
    return platform.arch === 'arm64' ? 'macos-arm64' : 'macos-amd64';
  }
  return platform.arch === 'arm64' ? 'linux-arm64' : 'linux-amd64';
}

function platformRootDirHint(version: string, platform: CodeWorkspaceEnginePlatform): string {
  return `code-server-${version}-${platformAssetSuffix(platform)}`;
}

function expectedAssetName(version: string, platform: CodeWorkspaceEnginePlatform): string {
  return `${platformRootDirHint(version, platform)}.tar.gz`;
}

function normalizeFetchTimeout(fetchPolicy?: CodeWorkspaceEngineFetchPolicy): number {
  const value = Number(fetchPolicy?.timeout_ms ?? DEFAULT_CODE_WORKSPACE_ENGINE_FETCH_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_CODE_WORKSPACE_ENGINE_FETCH_TIMEOUT_MS;
}

function codeWorkspaceFetchCanceledError(): DOMException {
  return new DOMException('Browser Editor setup was canceled while downloading the package.', 'AbortError');
}

function throwIfCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw codeWorkspaceFetchCanceledError();
  }
}

async function responseErrorDetail(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text().catch(() => '');
  const trimmedBody = compact(body);
  if (trimmedBody === '') return '';
  if (contentType.includes('json')) {
    try {
      const parsed = JSON.parse(trimmedBody) as Record<string, unknown>;
      return compact(parsed.message) || trimmedBody;
    } catch {
      return trimmedBody;
    }
  }
  return trimmedBody;
}

async function githubReleaseLookupHTTPError(response: Response): Promise<Error> {
  const detail = await responseErrorDetail(response);
  const remaining = compact(response.headers.get('x-ratelimit-remaining'));
  const reset = compact(response.headers.get('x-ratelimit-reset'));
  const resetAt = reset ? Number(reset) * 1000 : 0;
  const resetHint = Number.isFinite(resetAt) && resetAt > 0 ? ` Resets at ${new Date(resetAt).toLocaleString()}.` : '';
  if (response.status === 403 && (remaining === '0' || /rate limit/i.test(detail))) {
    return new Error(`GitHub release lookup failed with HTTP 403: API rate limit exceeded.${resetHint}`);
  }
  return new Error(`GitHub release lookup failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`);
}

async function fetchJSON(sourceURL: string, fetchPolicy?: CodeWorkspaceEngineFetchPolicy): Promise<unknown> {
  throwIfCanceled(fetchPolicy?.signal);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, normalizeFetchTimeout(fetchPolicy));
  const abort = () => controller.abort();
  fetchPolicy?.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(sourceURL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Redeven-Desktop',
      },
    });
    if (!response.ok) {
      throw await githubReleaseLookupHTTPError(response);
    }
    throwIfCanceled(fetchPolicy?.signal);
    return response.json();
  } catch (error) {
    if (fetchPolicy?.signal?.aborted) {
      throw codeWorkspaceFetchCanceledError();
    }
    const candidate = error as Partial<Error> | undefined;
    if (timedOut || candidate?.name === 'AbortError') {
      throw new Error(`Timed out after ${normalizeFetchTimeout(fetchPolicy)}ms looking up the latest code-server release.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    fetchPolicy?.signal?.removeEventListener('abort', abort);
  }
}

async function downloadURLToPath(
  sourceURL: string,
  targetPath: string,
  fetchPolicy?: CodeWorkspaceEngineFetchPolicy,
): Promise<void> {
  throwIfCanceled(fetchPolicy?.signal);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, normalizeFetchTimeout(fetchPolicy));
  const abort = () => controller.abort();
  fetchPolicy?.signal?.addEventListener('abort', abort, { once: true });
  const tempPath = `${targetPath}.${process.pid}.download.tmp`;
  try {
    const response = await fetch(sourceURL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status} for ${sourceURL}.`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    throwIfCanceled(fetchPolicy?.signal);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(tempPath, data);
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    if (fetchPolicy?.signal?.aborted) {
      throw codeWorkspaceFetchCanceledError();
    }
    const candidate = error as Partial<Error> | undefined;
    if (timedOut || candidate?.name === 'AbortError') {
      throw new Error(`Timed out after ${normalizeFetchTimeout(fetchPolicy)}ms downloading ${sourceURL}.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    fetchPolicy?.signal?.removeEventListener('abort', abort);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function releaseAssets(release: GitHubRelease): readonly GitHubReleaseAsset[] {
  return Array.isArray(release.assets) ? release.assets as GitHubReleaseAsset[] : [];
}

export async function resolveLatestCodeWorkspaceEngineReleaseAsset(
  platform: CodeWorkspaceEnginePlatform,
  fetchPolicy?: CodeWorkspaceEngineFetchPolicy,
): Promise<CodeWorkspaceEngineReleaseAsset> {
  const release = await fetchJSON(CODE_WORKSPACE_ENGINE_GITHUB_API_RELEASE_LATEST_URL, fetchPolicy) as GitHubRelease;
  const releaseTag = compact(release.tag_name);
  const version = normalizeCodeServerVersion(releaseTag);
  const assetName = expectedAssetName(version, platform);
  const asset = releaseAssets(release).find((candidate) => compact(candidate.name) === assetName);
  if (!asset) {
    throw new Error(`Latest code-server release ${releaseTag} does not include ${assetName}.`);
  }
  const downloadURL = compact(asset.browser_download_url);
  if (downloadURL === '') {
    throw new Error(`Latest code-server release asset ${assetName} did not include a download URL.`);
  }
  const releaseURL = compact(release.html_url) || `${CODE_WORKSPACE_ENGINE_PUBLIC_RELEASE_BASE_URL}/tag/${encodeURIComponent(releaseTag)}`;
  return {
    version,
    release_tag: releaseTag,
    release_url: releaseURL,
    asset_name: assetName,
    download_url: downloadURL,
    platform,
    root_dir_hint: platformRootDirHint(version, platform),
  };
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(filePath));
  return hash.digest('hex');
}

export async function ensureCodeWorkspaceEngineArchive(
  asset: CodeWorkspaceEngineReleaseAsset,
  archivePath: string,
  fetchPolicy?: CodeWorkspaceEngineFetchPolicy,
): Promise<{ archive_path: string; sha256: string; size_bytes: number; from_cache: boolean }> {
  const existing = await fs.stat(archivePath).catch(() => null);
  const fromCache = Boolean(existing?.isFile() && existing.size > 0);
  if (!fromCache) {
    await downloadURLToPath(asset.download_url, archivePath, fetchPolicy);
  }
  const [sha256, stat] = await Promise.all([sha256File(archivePath), fs.stat(archivePath)]);
  return {
    archive_path: archivePath,
    sha256,
    size_bytes: stat.size,
    from_cache: fromCache,
  };
}
