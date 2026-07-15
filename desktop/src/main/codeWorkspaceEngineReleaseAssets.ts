import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CODE_WORKSPACE_ENGINE_CATALOG_LATEST_URL = 'https://version.agent.redeven.com/v1/browser-editor/code-server/latest.json';
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
  sha256: string;
  size_bytes: number;
  platform: CodeWorkspaceEnginePlatform;
  root_dir_hint: string;
}>;

export type CodeWorkspaceEngineFetchPolicy = Readonly<{
  timeout_ms?: number;
  signal?: AbortSignal;
  onProgress?: (progress: CodeWorkspaceEngineArchiveProgress) => void;
}>;

export type CodeWorkspaceEngineArchiveProgress = Readonly<{
  phase: 'lookup' | 'download' | 'package_validation';
  state: 'running' | 'completed';
  completed_bytes?: number;
  total_bytes?: number;
  from_cache?: boolean;
}>;

type CodeWorkspaceEngineCatalogPlatform = Readonly<{
  os?: unknown;
  arch?: unknown;
  libc?: unknown;
  platform_id?: unknown;
  asset_name?: unknown;
  download_url?: unknown;
  sha256?: unknown;
  size_bytes?: unknown;
  compression?: unknown;
  root_dir_hint?: unknown;
}>;

type CodeWorkspaceEngineCatalog = Readonly<{
  schema_version?: unknown;
  engine?: unknown;
  source?: unknown;
  latest?: unknown;
  platforms?: unknown;
  mirror_complete?: unknown;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function positiveInteger(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0;
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
      const parsedError = catalogRecord(parsed.error);
      return compact(parsed.message) || compact(parsedError.message) || trimmedBody;
    } catch {
      return trimmedBody;
    }
  }
  return trimmedBody;
}

async function catalogLookupHTTPError(response: Response): Promise<Error> {
  const detail = await responseErrorDetail(response);
  return new Error(`Redeven Browser Editor catalog lookup failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`);
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
        Accept: 'application/json',
        'User-Agent': 'Redeven-Desktop',
      },
    });
    if (!response.ok) {
      throw await catalogLookupHTTPError(response);
    }
    throwIfCanceled(fetchPolicy?.signal);
    return response.json();
  } catch (error) {
    if (fetchPolicy?.signal?.aborted) {
      throw codeWorkspaceFetchCanceledError();
    }
    const candidate = error as Partial<Error> | undefined;
    if (timedOut || candidate?.name === 'AbortError') {
      throw new Error(`Timed out after ${normalizeFetchTimeout(fetchPolicy)}ms checking the latest Browser Editor.`);
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
  expectedBytes: number,
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
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const handle = await fs.open(tempPath, 'w', 0o600);
    let completedBytes = 0;
    let lastReportedAt = 0;
    try {
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error(`Download response did not include a body for ${sourceURL}.`);
      }
      for (;;) {
        throwIfCanceled(fetchPolicy?.signal);
        const part = await reader.read();
        if (part.done) break;
        if (!part.value || part.value.byteLength <= 0) continue;
        await handle.write(part.value);
        completedBytes += part.value.byteLength;
        const now = Date.now();
        if (now - lastReportedAt >= 250) {
          fetchPolicy?.onProgress?.({
            phase: 'download',
            state: 'running',
            completed_bytes: completedBytes,
            total_bytes: expectedBytes,
          });
          lastReportedAt = now;
        }
      }
    } finally {
      await handle.close();
    }
    throwIfCanceled(fetchPolicy?.signal);
    fetchPolicy?.onProgress?.({
      phase: 'download',
      state: 'completed',
      completed_bytes: completedBytes,
      total_bytes: expectedBytes,
    });
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

function catalogRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function platformCatalogKeys(platform: CodeWorkspaceEnginePlatform): readonly string[] {
  if (platform.os === 'linux') {
    return [
      compact(platform.platform_id),
      `${platform.os}-${platform.arch}-${platform.libc || 'glibc'}`,
      `${platform.os}-${platform.arch}-glibc`,
    ].filter(Boolean);
  }
  return [
    compact(platform.platform_id),
    `${platform.os}-${platform.arch}`,
  ].filter(Boolean);
}

function catalogPlatformFor(
  catalog: CodeWorkspaceEngineCatalog,
  platform: CodeWorkspaceEnginePlatform,
): CodeWorkspaceEngineCatalogPlatform {
  const platforms = catalogRecord(catalog.platforms);
  for (const key of platformCatalogKeys(platform)) {
    const entry = platforms[key];
    if (entry && typeof entry === 'object') {
      return entry as CodeWorkspaceEngineCatalogPlatform;
    }
  }
  throw new Error(`Redeven Browser Editor catalog does not include ${platform.os}/${platform.arch}.`);
}

function validateCatalog(catalog: CodeWorkspaceEngineCatalog): void {
  if (catalog.schema_version !== 1) {
    throw new Error('Redeven Browser Editor catalog has an unsupported schema version.');
  }
  if (compact(catalog.engine) !== 'code-server') {
    throw new Error('Redeven Browser Editor catalog has an unsupported engine.');
  }
  if (catalog.mirror_complete !== true) {
    throw new Error('Redeven Browser Editor catalog is not fully mirrored yet.');
  }
}

export async function resolveLatestCodeWorkspaceEngineReleaseAsset(
  platform: CodeWorkspaceEnginePlatform,
  fetchPolicy?: CodeWorkspaceEngineFetchPolicy,
): Promise<CodeWorkspaceEngineReleaseAsset> {
  const catalog = await fetchJSON(CODE_WORKSPACE_ENGINE_CATALOG_LATEST_URL, fetchPolicy) as CodeWorkspaceEngineCatalog;
  validateCatalog(catalog);
  const latest = catalogRecord(catalog.latest);
  const releaseTag = compact(latest.release_tag);
  const version = compact(latest.version) || (releaseTag.startsWith('v') ? releaseTag.slice(1) : releaseTag);
  if (releaseTag === '' || version === '') {
    throw new Error('Redeven Browser Editor catalog is missing the latest version.');
  }
  const entry = catalogPlatformFor(catalog, platform);
  const assetName = compact(entry.asset_name);
  const downloadURL = compact(entry.download_url);
  const rootDirHint = compact(entry.root_dir_hint);
  const sha256 = compact(entry.sha256);
  const sizeBytes = positiveInteger(entry.size_bytes);
  if (assetName === '' || downloadURL === '' || rootDirHint === '' || sha256 === '' || sizeBytes <= 0) {
    throw new Error('Redeven Browser Editor catalog has an incomplete platform package entry.');
  }
  return {
    version,
    release_tag: releaseTag,
    release_url: compact(catalogRecord(catalog.source).release_url),
    asset_name: assetName,
    download_url: downloadURL,
    sha256,
    size_bytes: sizeBytes,
    platform,
    root_dir_hint: rootDirHint,
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
    fetchPolicy?.onProgress?.({
      phase: 'download',
      state: 'running',
      completed_bytes: 0,
      total_bytes: asset.size_bytes,
    });
    await downloadURLToPath(asset.download_url, archivePath, asset.size_bytes, fetchPolicy);
  } else {
    fetchPolicy?.onProgress?.({
      phase: 'download',
      state: 'completed',
      completed_bytes: existing?.size ?? asset.size_bytes,
      total_bytes: asset.size_bytes,
      from_cache: true,
    });
  }
  fetchPolicy?.onProgress?.({
    phase: 'package_validation',
    state: 'running',
    total_bytes: asset.size_bytes,
    from_cache: fromCache,
  });
  const [sha256, stat] = await Promise.all([sha256File(archivePath), fs.stat(archivePath)]);
  if (asset.sha256 && sha256 !== asset.sha256) {
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
    throw new Error('Downloaded Browser Editor package checksum did not match the Redeven catalog.');
  }
  if (asset.size_bytes > 0 && stat.size !== asset.size_bytes) {
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
    throw new Error('Downloaded Browser Editor package size did not match the Redeven catalog.');
  }
  fetchPolicy?.onProgress?.({
    phase: 'package_validation',
    state: 'completed',
    completed_bytes: stat.size,
    total_bytes: asset.size_bytes,
    from_cache: fromCache,
  });
  return {
    archive_path: archivePath,
    sha256,
    size_bytes: stat.size,
    from_cache: fromCache,
  };
}
