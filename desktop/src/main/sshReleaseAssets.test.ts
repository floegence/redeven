import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDesktopSSHReleaseAssetURL,
  buildDesktopSSHReleaseSourceCacheKey,
  ensureDesktopSSHReleaseArchive,
  ensureDesktopSSHVerifiedReleaseManifest,
  parseDesktopSSHReleaseSHA256,
  resolveDesktopSSHRemotePlatform,
  verifyDesktopSSHReleaseManifest,
  type DesktopSSHVerifiedReleaseManifest,
} from './sshReleaseAssets';

const RELEASE_FIXTURE_BASE_URL = 'https://github.com/floegence/redeven/releases';
const RELEASE_FIXTURE_TAG = 'v0.4.48';
const RELEASE_FIXTURE_SUMS = `81d215da8b089a43b76c95c131e4b002578ea853df8317c883beec9e090ce31d  redeven_darwin_amd64.tar.gz
3f3e5fafb4b93d46a446555b735efda2e62622d9660773e9c899ba45f0214273  redeven_darwin_arm64.tar.gz
9cdece939c23b293176e846f7c687ccc9a8d7f15eab0e3fdbde4f25f4ba4dc50  redeven_linux_amd64.tar.gz
2e72518cec6a17386457541378f7c7f1e6b57ea381b7994c16155d2aa369a76f  redeven_linux_arm64.tar.gz
6c78192ce0c826957da5e182de10eebd12cf4851ff8b1bae366b7f6662989326  Redeven-Desktop-0.4.48-linux-arm64.deb
2809e56074b35b4e622a4de00931279b587809ad1fd9c5862a51ca6f97770fe7  Redeven-Desktop-0.4.48-linux-arm64.rpm
d54aa8679136eeee41bce9d092e048bc6171bf42dd377f65f02c6860f376a596  Redeven-Desktop-0.4.48-linux-x64.deb
0aaf82a3264ab04fd503a7a4140db9228d864fe2803842b6599c4e497cfbc15f  Redeven-Desktop-0.4.48-linux-x64.rpm
17e9c415dce642df6bae8c00272b568e520f70416997a011db7133ed162f9f5d  Redeven-Desktop-0.4.48-mac-arm64.dmg
77dbb2e1bc027bf47edda5292d19e157f400e61191bbf422c77039a5975f8921  Redeven-Desktop-0.4.48-mac-x64.dmg
51d4d9bdd4e657895a73bbd4f0cdf26ba7bbf61e08a19c6f865b4a65fc803e84  knowledge_bundle.manifest.json
d8693002d06b3c3cd8e6b467177d83d0225b055c55a14c8d882be25d283f5cb5  knowledge_bundle.sha256
`;
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
    expect(resolveDesktopSSHRemotePlatform('Darwin', 'arm64')).toEqual({
      goos: 'darwin',
      goarch: 'arm64',
      platform_id: 'darwin_arm64',
      release_package_name: 'redeven_darwin_arm64.tar.gz',
      platform_label: 'darwin/arm64',
    });
  });

  it('builds release asset URLs and parses SHA256SUMS entries', () => {
    expect(buildDesktopSSHReleaseAssetURL(
      'https://mirror.example.invalid/releases',
      'v1.2.3',
      'redeven_linux_amd64.tar.gz',
    )).toBe('https://mirror.example.invalid/releases/download/v1.2.3/redeven_linux_amd64.tar.gz');

    expect(parseDesktopSSHReleaseSHA256(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  redeven_linux_amd64.tar.gz\n',
      'redeven_linux_amd64.tar.gz',
    )).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
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
});
