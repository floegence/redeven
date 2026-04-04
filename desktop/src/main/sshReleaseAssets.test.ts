import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDesktopSSHReleaseAssetURL,
  ensureDesktopSSHReleaseAsset,
  parseDesktopSSHReleaseSHA256,
  resolveDesktopSSHRemotePlatform,
} from './sshReleaseAssets';

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

  it('downloads and verifies a release asset into the local cache', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-ssh-release-assets-'));
    try {
      const archive = Buffer.from('fake-tarball');
      const checksum = '746e8948ec0a7b6e150cc34446bad2bd0d0e2e3f0bd8f03f0edef7467a38e3b6';
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/SHA256SUMS')) {
          return new Response(`${checksum}  redeven_linux_amd64.tar.gz\n`, { status: 200 });
        }
        return new Response(archive, { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const asset = await ensureDesktopSSHReleaseAsset({
        releaseTag: 'v1.2.3',
        releaseBaseURL: 'https://mirror.example.invalid/releases',
        platform: resolveDesktopSSHRemotePlatform('linux', 'x86_64'),
        cacheRoot: root,
      });

      expect(asset.release_base_url).toBe('https://mirror.example.invalid/releases');
      expect(path.basename(asset.archive_path)).toBe('redeven_linux_amd64.tar.gz');
      await expect(fs.readFile(asset.archive_path)).resolves.toEqual(archive);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
