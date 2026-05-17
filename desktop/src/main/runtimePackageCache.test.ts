import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./sshReleaseTrust', () => ({
  verifyDesktopSSHReleaseManifestSignature: vi.fn(),
}));

import {
  legacyRuntimePackageCacheRoots,
  prepareDesktopRuntimeUploadAsset,
  pruneDesktopRuntimePackageCache,
  runtimePackageCacheRoot,
  runtimeReleaseFetchPolicy,
} from './runtimePackageCache';
import {
  buildDesktopSSHReleaseSourceCacheKey,
  resolveDesktopSSHRemotePlatform,
  type DesktopSSHRemotePlatform,
} from './sshReleaseAssets';

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function releaseSums(entries: ReadonlyMap<string, Buffer>): string {
  return [...entries.entries()]
    .map(([name, data]) => `${sha256(data)}  ${name}`)
    .join('\n');
}

function fetchURLCounts(fetchMock: ReturnType<typeof vi.fn>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const call of fetchMock.mock.calls) {
    const url = String(call[0]);
    counts.set(url, (counts.get(url) ?? 0) + 1);
  }
  return counts;
}

function archiveFetchCount(fetchMock: ReturnType<typeof vi.fn>, packageName: string): number {
  return [...fetchURLCounts(fetchMock).entries()]
    .filter(([url]) => url.endsWith(`/${packageName}`))
    .reduce((total, [, count]) => total + count, 0);
}

async function mkCacheRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-package-cache-'));
  return runtimePackageCacheRoot(root);
}

function installFetchMock(archives: ReadonlyMap<string, Buffer>): ReturnType<typeof vi.fn> {
  const sumsText = releaseSums(archives);
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/SHA256SUMS')) {
      return new Response(sumsText, { status: 200 });
    }
    if (url.endsWith('/SHA256SUMS.sig')) {
      return new Response('test-signature', { status: 200 });
    }
    if (url.endsWith('/SHA256SUMS.pem')) {
      return new Response('test-certificate', { status: 200 });
    }
    const name = path.basename(new URL(url).pathname);
    const archive = archives.get(name);
    if (archive) {
      return new Response(new Uint8Array(archive), { status: 200 });
    }
    return new Response('missing', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function preparePackage(args: Readonly<{
  cacheRoot: string;
  platform: DesktopSSHRemotePlatform;
  releaseBaseURL?: string;
}>): Promise<Awaited<ReturnType<typeof prepareDesktopRuntimeUploadAsset>>> {
  return prepareDesktopRuntimeUploadAsset({
    runtimeReleaseTag: 'v1.2.3',
    releaseBaseURL: args.releaseBaseURL ?? 'https://mirror.example.invalid/releases',
    assetCacheRoot: args.cacheRoot,
    platform: args.platform,
    fetchPolicy: runtimeReleaseFetchPolicy(45_000),
  });
}

describe('runtimePackageCache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('deduplicates concurrent release downloads for the same Desktop release and platform', async () => {
    const cacheRoot = await mkCacheRoot();
    const platform = resolveDesktopSSHRemotePlatform('linux', 'x86_64');
    const archive = Buffer.from('linux-amd64-runtime');
    const fetchMock = installFetchMock(new Map([[platform.release_package_name, archive]]));
    try {
      const results = await Promise.all([
        preparePackage({ cacheRoot, platform }),
        preparePackage({ cacheRoot, platform }),
        preparePackage({ cacheRoot, platform }),
      ]);

      expect(results.map((result) => result.archiveData.toString('utf8'))).toEqual([
        'linux-amd64-runtime',
        'linux-amd64-runtime',
        'linux-amd64-runtime',
      ]);
      expect(archiveFetchCount(fetchMock, platform.release_package_name)).toBe(1);
      expect(results.every((result) => result.source === 'release_cache')).toBe(true);

      fetchMock.mockClear();
      const cached = await preparePackage({ cacheRoot, platform });
      expect(cached.cacheEntry?.from_cache).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(path.dirname(cacheRoot), { recursive: true, force: true });
    }
  });

  it('keeps platform archives separate while sharing the verified manifest bundle', async () => {
    const cacheRoot = await mkCacheRoot();
    const amd64 = resolveDesktopSSHRemotePlatform('linux', 'x86_64');
    const arm64 = resolveDesktopSSHRemotePlatform('linux', 'aarch64');
    const fetchMock = installFetchMock(new Map([
      [amd64.release_package_name, Buffer.from('linux-amd64-runtime')],
      [arm64.release_package_name, Buffer.from('linux-arm64-runtime')],
    ]));
    try {
      const [amd64Asset, arm64Asset] = await Promise.all([
        preparePackage({ cacheRoot, platform: amd64 }),
        preparePackage({ cacheRoot, platform: arm64 }),
      ]);

      expect(amd64Asset.cacheEntry?.archive_path).toContain('/linux_amd64/');
      expect(arm64Asset.cacheEntry?.archive_path).toContain('/linux_arm64/');
      expect(archiveFetchCount(fetchMock, amd64.release_package_name)).toBe(1);
      expect(archiveFetchCount(fetchMock, arm64.release_package_name)).toBe(1);
      expect([...fetchURLCounts(fetchMock).keys()].filter((url) => url.endsWith('/SHA256SUMS'))).toHaveLength(1);
    } finally {
      await fs.rm(path.dirname(cacheRoot), { recursive: true, force: true });
    }
  });

  it('partitions package caches by release source', async () => {
    const cacheRoot = await mkCacheRoot();
    const platform = resolveDesktopSSHRemotePlatform('linux', 'x86_64');
    const fetchMock = installFetchMock(new Map([[platform.release_package_name, Buffer.from('linux-amd64-runtime')]]));
    try {
      const first = await preparePackage({
        cacheRoot,
        platform,
        releaseBaseURL: 'https://mirror-a.example.invalid/releases',
      });
      const second = await preparePackage({
        cacheRoot,
        platform,
        releaseBaseURL: 'https://mirror-b.example.invalid/releases',
      });

      expect(first.cacheEntry?.key.source_cache_key).toBe(buildDesktopSSHReleaseSourceCacheKey('https://mirror-a.example.invalid/releases'));
      expect(second.cacheEntry?.key.source_cache_key).toBe(buildDesktopSSHReleaseSourceCacheKey('https://mirror-b.example.invalid/releases'));
      expect(first.cacheEntry?.archive_path).not.toBe(second.cacheEntry?.archive_path);
      expect(archiveFetchCount(fetchMock, platform.release_package_name)).toBe(2);
    } finally {
      await fs.rm(path.dirname(cacheRoot), { recursive: true, force: true });
    }
  });

  it('redownloads a cached archive when checksum verification fails', async () => {
    const cacheRoot = await mkCacheRoot();
    const platform = resolveDesktopSSHRemotePlatform('linux', 'x86_64');
    const archive = Buffer.from('linux-amd64-runtime');
    const fetchMock = installFetchMock(new Map([[platform.release_package_name, archive]]));
    try {
      const first = await preparePackage({ cacheRoot, platform });
      expect(first.cacheEntry?.archive_path).toBeTruthy();
      await fs.writeFile(first.cacheEntry!.archive_path, 'corrupted');

      fetchMock.mockClear();
      const repaired = await preparePackage({ cacheRoot, platform });

      expect(repaired.archiveData).toEqual(archive);
      expect(repaired.cacheEntry?.from_cache).toBe(false);
      expect(archiveFetchCount(fetchMock, platform.release_package_name)).toBe(1);
    } finally {
      await fs.rm(path.dirname(cacheRoot), { recursive: true, force: true });
    }
  });

  it('prunes old release tags, temporary files, and legacy cache roots', async () => {
    const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-package-prune-'));
    const cacheRoot = runtimePackageCacheRoot(userDataRoot);
    const sourceRoot = path.join(cacheRoot, 'source-key');
    const currentArchive = path.join(sourceRoot, 'v1.2.3', 'linux_amd64', 'redeven_linux_amd64.tar.gz');
    const oldArchive = path.join(sourceRoot, 'v1.2.2', 'linux_amd64', 'redeven_linux_amd64.tar.gz');
    const tempArchive = path.join(sourceRoot, 'v1.2.3', 'linux_amd64', '.redeven_linux_amd64.tar.gz.1234.abcdef.tmp');
    const [oldSSHRoot, oldPlacementRoot] = legacyRuntimePackageCacheRoots(userDataRoot);
    try {
      await fs.mkdir(path.dirname(currentArchive), { recursive: true });
      await fs.mkdir(path.dirname(oldArchive), { recursive: true });
      await fs.mkdir(oldSSHRoot, { recursive: true });
      await fs.mkdir(oldPlacementRoot, { recursive: true });
      await Promise.all([
        fs.writeFile(currentArchive, 'current'),
        fs.writeFile(oldArchive, 'old'),
        fs.writeFile(tempArchive, 'tmp'),
        fs.writeFile(path.join(oldSSHRoot, 'old'), 'old'),
        fs.writeFile(path.join(oldPlacementRoot, 'old'), 'old'),
      ]);

      await pruneDesktopRuntimePackageCache({
        cacheRoot,
        activeReleaseTag: 'v1.2.3',
        legacyCacheRoots: [oldSSHRoot, oldPlacementRoot],
      });

      await expect(fs.readFile(currentArchive, 'utf8')).resolves.toBe('current');
      await expect(fs.stat(oldArchive)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(tempArchive)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(oldSSHRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(oldPlacementRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(userDataRoot, { recursive: true, force: true });
    }
  });

  it('can leave temporary files alone while pruning stale release tags during package preparation', async () => {
    const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-package-prune-'));
    const cacheRoot = runtimePackageCacheRoot(userDataRoot);
    const sourceRoot = path.join(cacheRoot, 'source-key');
    const oldArchive = path.join(sourceRoot, 'v1.2.2', 'linux_amd64', 'redeven_linux_amd64.tar.gz');
    const activeTempArchive = path.join(sourceRoot, 'v1.2.3', 'linux_amd64', '.redeven_linux_amd64.tar.gz.1234.abcdef.tmp');
    try {
      await fs.mkdir(path.dirname(oldArchive), { recursive: true });
      await fs.mkdir(path.dirname(activeTempArchive), { recursive: true });
      await Promise.all([
        fs.writeFile(oldArchive, 'old'),
        fs.writeFile(activeTempArchive, 'tmp'),
      ]);

      await pruneDesktopRuntimePackageCache({
        cacheRoot,
        activeReleaseTag: 'v1.2.3',
        includeTemporaryEntries: false,
      });

      await expect(fs.stat(oldArchive)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(activeTempArchive, 'utf8')).resolves.toBe('tmp');
    } finally {
      await fs.rm(userDataRoot, { recursive: true, force: true });
    }
  });
});
