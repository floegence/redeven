import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDesktopSSHReleaseAssetURL,
  buildDesktopSSHReleaseSourceCacheKey,
  desktopSSHReleasePackageName,
  ensureDesktopSSHReleaseArchive,
  ensureDesktopSSHVerifiedReleaseManifest,
  parseDesktopSSHReleaseSHA256,
  resolveDesktopSSHRemotePlatform,
  verifyDesktopSSHReleaseManifest,
  type DesktopSSHVerifiedReleaseManifest,
} from './sshReleaseAssets';

const RELEASE_FIXTURE_BASE_URL = 'https://github.com/floegence/redeven/releases';
const RELEASE_FIXTURE_TAG = 'v0.4.48';
const RELEASE_FIXTURE_SUMS = Buffer.from([
  'ODFkMjE1ZGE4YjA4OWE0M2I3NmM5NWMxMzFlNGIwMDI1NzhlYTg1M2RmODMxN2M4ODNiZWVjOWUwOTBjZTMxZCAgcmVkZXZlbl9kYXJ3aW5fYW1kNjQudGFy',
  'Lmd6CjNmM2U1ZmFmYjRiOTNkNDZhNDQ2NTU1YjczNWVmZGEyZTYyNjIyZDk2NjA3NzNlOWM4OTliYTQ1ZjAyMTQyNzMgIHJlZGV2ZW5fZGFyd2luX2FybTY0',
  'LnRhci5nego5Y2RlY2U5MzljMjNiMjkzMTc2ZTg0NmY3YzY4N2NjYzlhOGQ3ZjE1ZWFiMGUzZmRiZGU0ZjI1ZjRiYTRkYzUwICByZWRldmVuX2xpbnV4X2Ft',
  'ZDY0LnRhci5negoyZTcyNTE4Y2VjNmExNzM4NjQ1NzU0MTM3OGY3YzdmMWU2YjU3ZWEzODFiNzk5NGMxNjE1NWQyYWEzNjlhNzZmICByZWRldmVuX2xpbnV4',
  'X2FybTY0LnRhci5nego2Yzc4MTkyY2UwYzgyNjk1N2RhNWUxODJkZTEwZWViZDEyY2Y0ODUxZmY4YjFiYWUzNjZiN2Y2NjYyOTg5MzI2ICBSZWRldmVuLURl',
  'c2t0b3AtMC40LjQ4LWxpbnV4LWFybTY0LmRlYgoyODA5ZTU2MDc0YjM1YjRlNjIyYTRkZTAwOTMxMjc5YjU4NzgwOWFkMWZkOWM1ODYyYTUxY2E2Zjk3Nzcw',
  'ZmU3ICBSZWRldmVuLURlc2t0b3AtMC40LjQ4LWxpbnV4LWFybTY0LnJwbQpkNTRhYTg2NzkxMzZlZWVlNDFiY2U5ZDA5MmUwNDhiYzYxNzFiZjQyZGQzNzdm',
  'NjVmMDJjNjg2MGYzNzZhNTk2ICBSZWRldmVuLURlc2t0b3AtMC40LjQ4LWxpbnV4LXg2NC5kZWIKMGFhZjgyYTMyNjRhYjA0ZmQ1MDNhN2E0MTQwZGI5MjI4',
  'ZDg2NGZlMjgwMzg0MmI2NTk5YzRlNDk3Y2ZiYzE1ZiAgUmVkZXZlbi1EZXNrdG9wLTAuNC40OC1saW51eC14NjQucnBtCjE3ZTljNDE1ZGNlNjQyZGY2YmFl',
  'OGMwMDI3MmI1NjhlNTIwZjcwNDE2OTk3YTAxMWRiNzEzM2VkMTYyZjlmNWQgIFJlZGV2ZW4tRGVza3RvcC0wLjQuNDgtbWFjLWFybTY0LmRtZwo3N2RiYjJl',
  'MWJjMDI3YmY0N2VkZGE1MjkyZDE5ZTE1N2Y0MDBlNjExOTFiYmY0MjJjNzcwMzlhNTk3NWY4OTIxICBSZWRldmVuLURlc2t0b3AtMC40LjQ4LW1hYy14NjQu',
  'ZG1nCjUxZDRkOWJkZDRlNjU3ODk1YTczYmJkNGYwY2RmMjZiYTdiYmY2MWUwOGExOWM2Zjg2NWI0YTY1ZmM4MDNlODQgIGtub3dsZWRnZV9idW5kbGUubWFu',
  'aWZlc3QuanNvbgpkODY5MzAwMmQwNmIzYzNjZDhlNmI0NjcxNzdkODNkMDIyNWIwNTVjNTVhMTRjOGQ4ODJiZTI1ZDI4M2Y1Y2I1ICBrbm93bGVkZ2VfYnVu',
  'ZGxlLnNoYTI1Ngo=',
].join(''), 'base64').toString('utf8');
const RELEASE_FIXTURE_SIGNATURE = 'MEQCIG2e9XZsQhONf78Ug3sv4t43K9RNKzDUl2Cs4Km0lUElAiAdnFKd+nrOy7iunuNaT7Ac/3di2yoXvQ83xeG4kBsMKA==';
const RELEASE_FIXTURE_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIGtzCCBj6gAwIBAgIUFz9rozGvj3MIpdOMO23dAh0xDCMwCgYIKoZIzj0EAwMw
NzEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MR4wHAYDVQQDExVzaWdzdG9yZS1pbnRl
cm1lZGlhdGUwHhcNMjYwNDAzMTYzNTIyWhcNMjYwNDAzMTY0NTIyWjAAMFkwEwYH
KoZIzj0CAQYIKoZIzj0DAQcDQgAEh43slQIDslBkqDktbu4K20I3fgjQI+wSg08T
LMaitRuT1wZd5sQ9JY96Faex/7BcRWs0Fabw42iZgvnI/Y15SaOCBV0wggVZMA4G
A1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDAzAdBgNVHQ4EFgQU6vDv
ibe9k38Q/QOLeie9CttoxGAwHwYDVR0jBBgwFoAU39Ppz1YkEZb5qNjpKFWixi4Y
ZD8wYgYDVR0RAQH/BFgwVoZUaHR0cHM6Ly9naXRodWIuY29tL2Zsb2VnZW5jZS9y
ZWRldmVuLy5naXRodWIvd29ya2Zsb3dzL3JlbGVhc2UueW1sQHJlZnMvdGFncy92
MC40LjQ4MDkGCisGAQQBg78wAQEEK2h0dHBzOi8vdG9rZW4uYWN0aW9ucy5naXRo
dWJ1c2VyY29udGVudC5jb20wEgYKKwYBBAGDvzABAgQEcHVzaDA2BgorBgEEAYO/
MAEDBChhMmM0MmVlYjBmYTA2M2EzOTVjNTc1MWE0M2QxNWI1MTE1ZWI1MDU3MB0G
CisGAQQBg78wAQQED1JlbGVhc2UgUmVkZXZlbjAfBgorBgEEAYO/MAEFBBFmbG9l
Z2VuY2UvcmVkZXZlbjAfBgorBgEEAYO/MAEGBBFyZWZzL3RhZ3MvdjAuNC40ODA7
BgorBgEEAYO/MAEIBC0MK2h0dHBzOi8vdG9rZW4uYWN0aW9ucy5naXRodWJ1c2Vy
Y29udGVudC5jb20wZAYKKwYBBAGDvzABCQRWDFRodHRwczovL2dpdGh1Yi5jb20v
ZmxvZWdlbmNlL3JlZGV2ZW4vLmdpdGh1Yi93b3JrZmxvd3MvcmVsZWFzZS55bWxA
cmVmcy90YWdzL3YwLjQuNDgwOAYKKwYBBAGDvzABCgQqDChhMmM0MmVlYjBmYTA2
M2EzOTVjNTc1MWE0M2QxNWI1MTE1ZWI1MDU3MB0GCisGAQQBg78wAQsEDwwNZ2l0
aHViLWhvc3RlZDA0BgorBgEEAYO/MAEMBCYMJGh0dHBzOi8vZ2l0aHViLmNvbS9m
bG9lZ2VuY2UvcmVkZXZlbjA4BgorBgEEAYO/MAENBCoMKGEyYzQyZWViMGZhMDYz
YTM5NWM1NzUxYTQzZDE1YjUxMTVlYjUwNTcwIQYKKwYBBAGDvzABDgQTDBFyZWZz
L3RhZ3MvdjAuNC40ODAaBgorBgEEAYO/MAEPBAwMCjEwNzAwODQzMDEwLAYKKwYB
BAGDvzABEAQeDBxodHRwczovL2dpdGh1Yi5jb20vZmxvZWdlbmNlMBkGCisGAQQB
g78wAREECwwJMTg4MTAwMjY4MGQGCisGAQQBg78wARIEVgxUaHR0cHM6Ly9naXRo
dWIuY29tL2Zsb2VnZW5jZS9yZWRldmVuLy5naXRodWIvd29ya2Zsb3dzL3JlbGVh
c2UueW1sQHJlZnMvdGFncy92MC40LjQ4MDgGCisGAQQBg78wARMEKgwoYTJjNDJl
ZWIwZmEwNjNhMzk1YzU3NTFhNDNkMTViNTExNWViNTA1NzAUBgorBgEEAYO/MAEU
BAYMBHB1c2gwWAYKKwYBBAGDvzABFQRKDEhodHRwczovL2dpdGh1Yi5jb20vZmxv
ZWdlbmNlL3JlZGV2ZW4vYWN0aW9ucy9ydW5zLzIzOTUzMzk2NTMxL2F0dGVtcHRz
LzEwFgYKKwYBBAGDvzABFgQIDAZwdWJsaWMwgYkGCisGAQQB1nkCBAIEewR5AHcA
dQDdPTBqxscRMmMZHhyZZzcCokpeuN48rf+HinKALynujgAAAZ1UMwSNAAAEAwBG
MEQCIDIFqg7jXvLcnuUps8UkhAyUDw14qgtJK4o6azH9vHHEAiBOC+V8BiQtEF8c
ZTn+URxzdAZNkrgvcO+qmgYxUu3diTAKBggqhkjOPQQDAwNnADBkAjBhcprL/eBh
IROFaiKXcnnE2OTs+F2DgwQXKh1UWZKPAFl7fNk/DZIyllszHU1QvYECMDsEgDIT
XLZflw6Vyvaq6s9wA1SfAg3Pe0GWPdQFJ7wTiMblYX3r5PBIBNoiMiO9aQ==
-----END CERTIFICATE-----
`;

function fixtureManifest(baseURL: string): DesktopSSHVerifiedReleaseManifest {
  return verifyDesktopSSHReleaseManifest({
    releaseTag: RELEASE_FIXTURE_TAG,
    releaseBaseURL: baseURL,
    sumsText: RELEASE_FIXTURE_SUMS,
    signature: RELEASE_FIXTURE_SIGNATURE,
    certificate: RELEASE_FIXTURE_CERTIFICATE,
  });
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('sshReleaseAssets', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps remote uname values to supported release package names', () => {
    expect(resolveDesktopSSHRemotePlatform('Linux', 'x86_64')).toEqual({
      goos: 'linux',
      goarch: 'amd64',
      platform_id: 'linux_amd64',
      release_package_name: 'redeven_linux_amd64.tar.gz',
      platform_label: 'linux/amd64',
    });
    expect(resolveDesktopSSHRemotePlatform('Linux', 'arm64')).toEqual({
      goos: 'linux',
      goarch: 'arm64',
      platform_id: 'linux_arm64',
      release_package_name: 'redeven_linux_arm64.tar.gz',
      platform_label: 'linux/arm64',
    });
  });

  it.each([
    ['Darwin', 'arm64'],
    ['LinuxGNU', 'amd64'],
    ['Linux', 'armv7l'],
    ['Linux', 'armv6l'],
    ['Linux', 'i386'],
    ['Linux', 'i686'],
  ])('rejects unpublished SSH runtime target %s/%s', (rawOS, rawArch) => {
    expect(() => resolveDesktopSSHRemotePlatform(rawOS, rawArch)).toThrow('Unsupported remote');
  });

  it('builds release asset URLs and parses SHA256SUMS entries', () => {
    expect(buildDesktopSSHReleaseAssetURL(
      'https://mirror.example.invalid/releases',
      'v1.2.3',
      'redeven_linux_amd64.tar.gz',
    )).toBe('https://mirror.example.invalid/releases/download/v1.2.3/redeven_linux_amd64.tar.gz');
    expect(buildDesktopSSHReleaseAssetURL(
      'https://mirror.example.invalid/releases',
      'v0.0.0-dev.1',
      'redeven_linux_arm64.tar.gz',
    )).toBe('https://mirror.example.invalid/releases/download/v0.0.0-dev.1/redeven_linux_arm64.tar.gz');

    expect(parseDesktopSSHReleaseSHA256(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  redeven_linux_amd64.tar.gz\n',
      'redeven_linux_amd64.tar.gz',
    )).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(desktopSSHReleasePackageName({ goos: 'linux', goarch: 'amd64' }, 'gateway')).toBe(
      'redeven-gateway_linux_amd64.tar.gz',
    );
  });

  it('verifies a published Redeven release manifest before trusting any checksums', () => {
    const manifest = fixtureManifest(RELEASE_FIXTURE_BASE_URL);

    expect(manifest.release_tag).toBe(RELEASE_FIXTURE_TAG);
    expect(manifest.release_base_url).toBe(RELEASE_FIXTURE_BASE_URL);
    expect(manifest.source_cache_key).toBe(buildDesktopSSHReleaseSourceCacheKey(RELEASE_FIXTURE_BASE_URL));
      expect(manifest.sha256_by_asset_name.get('redeven_linux_amd64.tar.gz')).toBe(
        '9cdece939c23b293176e846f7c687ccc9a8d7f15eab0e3fdbde4f25f4ba4dc50',
      );
  });

  it('binds the release certificate identity to the exact selected canonical tag', () => {
    expect(() => verifyDesktopSSHReleaseManifest({
      releaseTag: 'v0.4.49',
      releaseBaseURL: RELEASE_FIXTURE_BASE_URL,
      sumsText: RELEASE_FIXTURE_SUMS,
      signature: RELEASE_FIXTURE_SIGNATURE,
      certificate: RELEASE_FIXTURE_CERTIFICATE,
    })).toThrow('certificate identity did not match the selected release tag v0.4.49');
  });

  it.each([
    '0.4.48',
    'v00.4.48',
    'v0.04.48',
    'v0.4.048',
    'v0.4.48-01',
    'v0.4.48-',
    'v0.4.48+build',
    ' v0.4.48',
    'v0.4.48 ',
  ])('rejects non-canonical release tag %j before trust or cache use', (releaseTag) => {
    expect(() => buildDesktopSSHReleaseAssetURL(
      RELEASE_FIXTURE_BASE_URL,
      releaseTag,
      'redeven_linux_amd64.tar.gz',
    )).toThrow('release tag must be canonical SemVer');
  });

  it('rejects tampered release manifests', () => {
    expect(() => verifyDesktopSSHReleaseManifest({
      releaseTag: RELEASE_FIXTURE_TAG,
      releaseBaseURL: RELEASE_FIXTURE_BASE_URL,
      sumsText: `${RELEASE_FIXTURE_SUMS}\n# tampered`,
      signature: RELEASE_FIXTURE_SIGNATURE,
      certificate: RELEASE_FIXTURE_CERTIFICATE,
    })).toThrow('Release manifest signature verification failed.');
  });

  it('downloads, verifies, and reuses a cached release manifest bundle', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-ssh-release-manifest-'));
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/SHA256SUMS')) {
        return new Response(RELEASE_FIXTURE_SUMS, { status: 200 });
      }
      if (url.endsWith('/SHA256SUMS.sig')) {
        return new Response(RELEASE_FIXTURE_SIGNATURE, { status: 200 });
      }
      return new Response(RELEASE_FIXTURE_CERTIFICATE, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const manifest = await ensureDesktopSSHVerifiedReleaseManifest({
        releaseTag: RELEASE_FIXTURE_TAG,
        releaseBaseURL: RELEASE_FIXTURE_BASE_URL,
        cacheRoot: root,
      });

      expect(manifest.sha256_by_asset_name.get('redeven_linux_arm64.tar.gz')).toBe(
        '2e72518cec6a17386457541378f7c7f1e6b57ea381b7994c16155d2aa369a76f',
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);

      fetchMock.mockClear();
      const cachedManifest = await ensureDesktopSSHVerifiedReleaseManifest({
        releaseTag: RELEASE_FIXTURE_TAG,
        releaseBaseURL: RELEASE_FIXTURE_BASE_URL,
        cacheRoot: root,
      });

      expect(cachedManifest.source_cache_key).toBe(manifest.source_cache_key);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('applies explicit timeouts to desktop-side release manifest downloads', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-ssh-release-timeout-'));
    const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('Missing fetch signal.'));
        return;
      }
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(ensureDesktopSSHVerifiedReleaseManifest({
        releaseTag: 'v1.2.3',
        releaseBaseURL: 'https://mirror.example.invalid/releases',
        cacheRoot: root,
        fetchPolicy: { timeout_ms: 5 },
      })).rejects.toThrow('Timed out after 5ms downloading https://mirror.example.invalid/releases/download/v1.2.3/');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('lets SSH startup cancellation interrupt release manifest downloads before the timeout', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-ssh-release-cancel-'));
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('Missing fetch signal.'));
        return;
      }
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const manifest = ensureDesktopSSHVerifiedReleaseManifest({
        releaseTag: 'v1.2.3',
        releaseBaseURL: 'https://mirror.example.invalid/releases',
        cacheRoot: root,
        fetchPolicy: {
          timeout_ms: 30_000,
          signal: controller.signal,
        },
      });
      controller.abort();
      await expect(manifest).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('downloads release archives into source-partitioned cache directories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-ssh-release-assets-'));
    try {
      const archive = Buffer.from('fake-tarball');
      const checksum = sha256(archive);
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        expect(url).toContain('/redeven_linux_amd64.tar.gz');
        return new Response(archive, { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      const platform = resolveDesktopSSHRemotePlatform('linux', 'x86_64');
      const manifestA: DesktopSSHVerifiedReleaseManifest = {
        release_tag: 'v1.2.3',
        release_base_url: 'https://mirror-a.example.invalid/releases',
        source_cache_key: buildDesktopSSHReleaseSourceCacheKey('https://mirror-a.example.invalid/releases'),
        sums_text: `${checksum}  ${platform.release_package_name}\n`,
        sha256_by_asset_name: new Map([[platform.release_package_name, checksum]]),
      };
      const manifestB: DesktopSSHVerifiedReleaseManifest = {
        release_tag: 'v1.2.3',
        release_base_url: 'https://mirror-b.example.invalid/releases',
        source_cache_key: buildDesktopSSHReleaseSourceCacheKey('https://mirror-b.example.invalid/releases'),
        sums_text: `${checksum}  ${platform.release_package_name}\n`,
        sha256_by_asset_name: new Map([[platform.release_package_name, checksum]]),
      };

      const assetA = await ensureDesktopSSHReleaseArchive({
        manifest: manifestA,
        platform,
        cacheRoot: root,
      });
      const assetB = await ensureDesktopSSHReleaseArchive({
        manifest: manifestB,
        platform,
        cacheRoot: root,
      });

      expect(path.basename(assetA.archive_path)).toBe('redeven_linux_amd64.tar.gz');
      expect(path.basename(assetB.archive_path)).toBe('redeven_linux_amd64.tar.gz');
      expect(assetA.source_cache_key).not.toBe(assetB.source_cache_key);
      expect(assetA.archive_path).not.toBe(assetB.archive_path);
      await expect(fs.readFile(assetA.archive_path)).resolves.toEqual(archive);
      await expect(fs.readFile(assetB.archive_path)).resolves.toEqual(archive);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('downloads Gateway release archives with the independent Gateway package name', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-gateway-release-assets-'));
    try {
      const archive = Buffer.from('gateway-tarball');
      const checksum = sha256(archive);
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        expect(url).toContain('/redeven-gateway_linux_amd64.tar.gz');
        return new Response(archive, { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      const platform = resolveDesktopSSHRemotePlatform('linux', 'x86_64');
      const gatewayPackageName = desktopSSHReleasePackageName(platform, 'gateway');
      const manifest: DesktopSSHVerifiedReleaseManifest = {
        release_tag: 'v1.2.3',
        release_base_url: 'https://mirror.example.invalid/releases',
        source_cache_key: buildDesktopSSHReleaseSourceCacheKey('https://mirror.example.invalid/releases'),
        sums_text: `${checksum}  ${gatewayPackageName}\n`,
        sha256_by_asset_name: new Map([[gatewayPackageName, checksum]]),
      };

      const asset = await ensureDesktopSSHReleaseArchive({
        manifest,
        platform,
        packageKind: 'gateway',
        cacheRoot: root,
      });

      expect(path.basename(asset.archive_path)).toBe('redeven-gateway_linux_amd64.tar.gz');
      expect(asset.archive_path).toContain('/linux_amd64/');
      await expect(fs.readFile(asset.archive_path)).resolves.toEqual(archive);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
