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
import { DesktopOperationFailureError } from './desktopOperationFailure';

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
  sourceRuntimeRoot?: string;
}>): Promise<Awaited<ReturnType<typeof prepareDesktopRuntimeUploadAsset>>> {
  return prepareDesktopRuntimeUploadAsset({
    runtimeReleaseTag: 'v1.2.3',
    releaseBaseURL: args.releaseBaseURL ?? 'https://mirror.example.invalid/releases',
    assetCacheRoot: args.cacheRoot,
    sourceRuntimeRoot: args.sourceRuntimeRoot,
    platform: args.platform,
    fetchPolicy: runtimeReleaseFetchPolicy(45_000),
  });
}

async function createSourceRuntimeFixture(): Promise<Readonly<{
  root: string;
  cacheRoot: string;
  buildLogPath: string;
  originalDistPath: string;
  originalBundlePath: string;
  originalDesktopReleasePath: string;
}>> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-source-runtime-fixture-'));
  const root = path.join(tempRoot, 'redeven');
  const buildLogPath = path.join(tempRoot, 'build-assets.log');
  const originalDistPath = path.join(root, 'internal', 'envapp', 'ui', 'dist', 'env', 'index.html');
  const originalBundlePath = path.join(root, 'desktop', '.bundle', 'linux-arm64', 'redeven');
  const originalDesktopReleasePath = path.join(
    root,
    'desktop',
    'release',
    'mac-arm64',
    'Redeven Desktop.app',
    'Contents',
    'Resources',
    'app.asar',
  );

  await Promise.all([
    fs.mkdir(path.join(root, 'scripts'), { recursive: true }),
    fs.mkdir(path.join(root, 'cmd', 'redeven'), { recursive: true }),
    fs.mkdir(path.dirname(originalDistPath), { recursive: true }),
    fs.mkdir(path.dirname(originalBundlePath), { recursive: true }),
    fs.mkdir(path.dirname(originalDesktopReleasePath), { recursive: true }),
  ]);
  await fs.writeFile(originalDistPath, 'original checkout dist');
  await fs.writeFile(originalBundlePath, 'original bundled runtime');
  await fs.writeFile(originalDesktopReleasePath, 'original desktop release package');
  await fs.writeFile(path.join(root, 'go.mod'), [
    'module example.invalid/redeven-source-runtime-fixture',
    '',
    'go 1.24.0',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(root, 'cmd', 'redeven', 'main.go'), [
    'package main',
    '',
    'func main() {}',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(root, 'scripts', 'build_assets.sh'), [
    '#!/usr/bin/env sh',
    'set -eu',
    `printf 'assets:%s\\n' "$PWD" >> ${JSON.stringify(buildLogPath)}`,
    `if [ -e "$PWD/internal/envapp/ui/dist/env/index.html" ]; then printf 'copied:envapp-dist\\n' >> ${JSON.stringify(buildLogPath)}; fi`,
    `if [ -e "$PWD/desktop/.bundle/linux-arm64/redeven" ]; then printf 'copied:desktop-bundle\\n' >> ${JSON.stringify(buildLogPath)}; fi`,
    `if [ -e "$PWD/desktop/release/mac-arm64/Redeven Desktop.app/Contents/Resources/app.asar" ]; then printf 'copied:desktop-release\\n' >> ${JSON.stringify(buildLogPath)}; fi`,
  ].join('\n'), { mode: 0o755 });

  return {
    root,
    cacheRoot: runtimePackageCacheRoot(tempRoot),
    buildLogPath,
    originalDistPath,
    originalBundlePath,
    originalDesktopReleasePath,
  };
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

  it('builds a source runtime package once per Desktop process and reuses it for the same platform', async () => {
    const fixture = await createSourceRuntimeFixture();
    const platform = resolveDesktopSSHRemotePlatform('linux', 'x86_64');
    try {
      const first = await preparePackage({
        cacheRoot: fixture.cacheRoot,
        platform,
        sourceRuntimeRoot: fixture.root,
      });
      const cached = await preparePackage({
        cacheRoot: fixture.cacheRoot,
        platform,
        sourceRuntimeRoot: fixture.root,
      });

      expect(first.source).toBe('source_build');
      expect(cached.source).toBe('source_build_cache');
      expect(cached.archiveData).toEqual(first.archiveData);
      const buildLog = await fs.readFile(fixture.buildLogPath, 'utf8');
      expect(buildLog).toMatch(/^assets:/u);
      expect(buildLog).not.toContain(fixture.root);
      expect(buildLog).not.toContain('copied:envapp-dist');
      expect(buildLog).not.toContain('copied:desktop-bundle');
      expect(buildLog).not.toContain('copied:desktop-release');
      await expect(fs.readFile(fixture.originalDistPath, 'utf8')).resolves.toBe('original checkout dist');
      await expect(fs.readFile(fixture.originalBundlePath, 'utf8')).resolves.toBe('original bundled runtime');
      await expect(fs.readFile(fixture.originalDesktopReleasePath, 'utf8')).resolves.toBe('original desktop release package');
    } finally {
      await fs.rm(path.dirname(fixture.root), { recursive: true, force: true });
    }
  }, 15_000);

  it('deduplicates concurrent source runtime builds for the same platform', async () => {
    const fixture = await createSourceRuntimeFixture();
    const platform = resolveDesktopSSHRemotePlatform('linux', 'x86_64');
    try {
      const results = await Promise.all([
        preparePackage({ cacheRoot: fixture.cacheRoot, platform, sourceRuntimeRoot: fixture.root }),
        preparePackage({ cacheRoot: fixture.cacheRoot, platform, sourceRuntimeRoot: fixture.root }),
        preparePackage({ cacheRoot: fixture.cacheRoot, platform, sourceRuntimeRoot: fixture.root }),
      ]);

      expect(results.map((result) => result.source)).toEqual([
        'source_build',
        'source_build',
        'source_build',
      ]);
      expect(results[1].archiveData).toEqual(results[0].archiveData);
      expect(results[2].archiveData).toEqual(results[0].archiveData);
      const buildLog = await fs.readFile(fixture.buildLogPath, 'utf8');
      expect(buildLog.trim().split('\n')).toHaveLength(1);
      expect(buildLog).not.toContain(fixture.root);
    } finally {
      await fs.rm(path.dirname(fixture.root), { recursive: true, force: true });
    }
  }, 15_000);

  it('keeps source runtime packages separate by target platform', async () => {
    const fixture = await createSourceRuntimeFixture();
    const amd64 = resolveDesktopSSHRemotePlatform('linux', 'x86_64');
    const arm64 = resolveDesktopSSHRemotePlatform('linux', 'aarch64');
    try {
      const [amd64Asset, arm64Asset] = await Promise.all([
        preparePackage({ cacheRoot: fixture.cacheRoot, platform: amd64, sourceRuntimeRoot: fixture.root }),
        preparePackage({ cacheRoot: fixture.cacheRoot, platform: arm64, sourceRuntimeRoot: fixture.root }),
      ]);

      expect(amd64Asset.source).toBe('source_build');
      expect(arm64Asset.source).toBe('source_build');
      expect(arm64Asset.archiveData).not.toEqual(amd64Asset.archiveData);
      const buildLog = await fs.readFile(fixture.buildLogPath, 'utf8');
      expect(buildLog.trim().split('\n')).toHaveLength(2);
      expect(buildLog).not.toContain(fixture.root);
    } finally {
      await fs.rm(path.dirname(fixture.root), { recursive: true, force: true });
    }
  }, 15_000);

  it('keeps source runtime build failures concise with raw output in diagnostics', async () => {
    const fixture = await createSourceRuntimeFixture();
    const platform = resolveDesktopSSHRemotePlatform('linux', 'x86_64');
    await fs.writeFile(path.join(fixture.root, 'cmd', 'redeven', 'main.go'), [
      'package main',
      '',
      'func main() {',
      '',
    ].join('\n'));
    try {
      const error = await preparePackage({
        cacheRoot: fixture.cacheRoot,
        platform,
        sourceRuntimeRoot: fixture.root,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DesktopOperationFailureError);
      expect((error as DesktopOperationFailureError).presentation.summary).toBe(
        'Desktop could not prepare the linux/amd64 Redeven runtime package.',
      );
      expect((error as DesktopOperationFailureError).runtime_lifecycle_step_id).toBe('preparing_runtime_package');
      expect((error as DesktopOperationFailureError).presentation.diagnostics?.[0]?.text).toContain('go failed');
    } finally {
      await fs.rm(path.dirname(fixture.root), { recursive: true, force: true });
    }
  }, 15_000);

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
