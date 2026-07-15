import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ensureCodeWorkspaceEngineArchive,
  resolveLatestCodeWorkspaceEngineReleaseAsset,
  type CodeWorkspaceEngineFetchPolicy,
  type CodeWorkspaceEnginePlatform,
  type CodeWorkspaceEngineReleaseAsset,
} from './codeWorkspaceEngineReleaseAssets';

export type CodeWorkspaceEngineArtifactManifest = Readonly<{
  schema_version: 1;
  engine: 'code-server';
  version: string;
  source: Readonly<{
    kind: 'github_release';
    release_url: string;
    asset_name: string;
  }>;
  platform: Readonly<{
    os: string;
    arch: string;
    libc?: string;
    platform_id: string;
    supported: true;
  }>;
  archive: Readonly<{
    sha256: string;
    size_bytes: number;
    compression: 'tar.gz';
  }>;
  layout: Readonly<{
    binary_relpath: string;
    root_dir_hint: string;
  }>;
}>;

export type CodeWorkspaceEnginePackageCacheEntry = Readonly<{
  asset: CodeWorkspaceEngineReleaseAsset;
  manifest: CodeWorkspaceEngineArtifactManifest;
  archive_path: string;
  from_cache: boolean;
}>;

const inFlightEntries = new Map<string, Promise<CodeWorkspaceEnginePackageCacheEntry>>();

function compact(value: unknown): string {
  return String(value ?? '').trim();
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

export function codeWorkspaceEnginePackageCacheRoot(userDataPath: string): string {
  return path.join(userDataPath, 'code-workspace-engine-cache');
}

function platformCacheKey(platform: CodeWorkspaceEnginePlatform): string {
  return compact(platform.platform_id).replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || `${platform.os}-${platform.arch}`;
}

async function prunePlatformCacheToLatest(cacheRoot: string, platformKey: string, latestVersion: string): Promise<void> {
  const platformDir = path.join(cacheRoot, platformKey);
  const entries = await fs.readdir(platformDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory()) {
      if (entry.name.endsWith('.download.tmp')) {
        await fs.rm(path.join(platformDir, entry.name), { force: true });
      }
      return;
    }
    if (entry.name !== latestVersion) {
      await fs.rm(path.join(platformDir, entry.name), { recursive: true, force: true });
    }
  }));
}

function buildManifest(args: Readonly<{
  asset: CodeWorkspaceEngineReleaseAsset;
  sha256: string;
  sizeBytes: number;
}>): CodeWorkspaceEngineArtifactManifest {
  return {
    schema_version: 1,
    engine: 'code-server',
    version: args.asset.version,
    source: {
      kind: 'github_release',
      release_url: args.asset.release_url,
      asset_name: args.asset.asset_name,
    },
    platform: {
      os: args.asset.platform.os,
      arch: args.asset.platform.arch,
      ...(args.asset.platform.libc ? { libc: args.asset.platform.libc } : {}),
      platform_id: args.asset.platform.platform_id,
      supported: true,
    },
    archive: {
      sha256: args.sha256,
      size_bytes: args.sizeBytes,
      compression: 'tar.gz',
    },
    layout: {
      binary_relpath: 'bin/code-server',
      root_dir_hint: args.asset.root_dir_hint,
    },
  };
}

export async function prepareCodeWorkspaceEnginePackage(args: Readonly<{
  cacheRoot: string;
  platform: CodeWorkspaceEnginePlatform;
  fetchPolicy?: CodeWorkspaceEngineFetchPolicy;
}>): Promise<CodeWorkspaceEnginePackageCacheEntry> {
  args.fetchPolicy?.onProgress?.({ phase: 'lookup', state: 'running' });
  const asset = await resolveLatestCodeWorkspaceEngineReleaseAsset(args.platform, args.fetchPolicy);
  args.fetchPolicy?.onProgress?.({ phase: 'lookup', state: 'completed' });
  const platformKey = platformCacheKey(args.platform);
  const cacheDir = path.join(args.cacheRoot, platformKey, asset.version);
  const archivePath = path.join(cacheDir, asset.asset_name);
  const key = `${platformKey}:${asset.version}:${asset.asset_name}`;
  return onceInFlight(inFlightEntries, key, async () => {
    await fs.mkdir(cacheDir, { recursive: true });
    await prunePlatformCacheToLatest(args.cacheRoot, platformKey, asset.version);
    const archive = await ensureCodeWorkspaceEngineArchive(asset, archivePath, args.fetchPolicy);
    return {
      asset,
      archive_path: archive.archive_path,
      from_cache: archive.from_cache,
      manifest: buildManifest({
        asset,
        sha256: asset.sha256 || archive.sha256,
        sizeBytes: asset.size_bytes || archive.size_bytes,
      }),
    };
  });
}
