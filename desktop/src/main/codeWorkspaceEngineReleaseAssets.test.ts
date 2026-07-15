import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CODE_WORKSPACE_ENGINE_CATALOG_LATEST_URL,
  ensureCodeWorkspaceEngineArchive,
  resolveLatestCodeWorkspaceEngineReleaseAsset,
  type CodeWorkspaceEnginePlatform,
} from './codeWorkspaceEngineReleaseAssets';

const tempDirs: string[] = [];

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(
    typeof body === 'string' || body instanceof ArrayBuffer ? body : JSON.stringify(body),
    {
      status: 200,
      ...init,
    },
  );
}

function platform(): CodeWorkspaceEnginePlatform {
  return {
    os: 'linux',
    arch: 'amd64',
    libc: 'glibc',
    platform_id: 'linux-amd64-glibc',
  };
}

function catalog(version = '4.109.1') {
  const archiveSHA = version === '4.109.1'
    ? '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
    : 'a'.repeat(64);
  return {
    schema_version: 1,
    engine: 'code-server',
    generated_at: '2026-05-25T09:00:00Z',
    source: {
      kind: 'github_release',
      repo: 'coder/code-server',
      release_tag: `v${version}`,
      release_url: `https://github.com/coder/code-server/releases/tag/v${version}`,
    },
    latest: {
      version,
      release_tag: `v${version}`,
    },
    platforms: {
      'linux-amd64-glibc': {
        os: 'linux',
        arch: 'amd64',
        libc: 'glibc',
        platform_id: 'linux-amd64-glibc',
        asset_name: `code-server-${version}-linux-amd64.tar.gz`,
        download_url: `https://browser-editor-package.example.test/code-server/v${version}/code-server-${version}-linux-amd64.tar.gz`,
        sha256: archiveSHA,
        size_bytes: 3,
        compression: 'tar.gz',
        root_dir_hint: `code-server-${version}-linux-amd64`,
      },
    },
    mirror_complete: true,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === CODE_WORKSPACE_ENGINE_CATALOG_LATEST_URL) {
      return response(catalog());
    }
    return response(new Uint8Array([1, 2, 3]).buffer);
  }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('code workspace engine release assets', () => {
  it('resolves the latest Browser Editor package from the Redeven catalog for the target platform', async () => {
    const asset = await resolveLatestCodeWorkspaceEngineReleaseAsset(platform());

    expect(asset).toEqual(expect.objectContaining({
      version: '4.109.1',
      release_tag: 'v4.109.1',
      asset_name: 'code-server-4.109.1-linux-amd64.tar.gz',
      root_dir_hint: 'code-server-4.109.1-linux-amd64',
      download_url: 'https://browser-editor-package.example.test/code-server/v4.109.1/code-server-4.109.1-linux-amd64.tar.gz',
      sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
      size_bytes: 3,
    }));
  });

  it('does not request the GitHub latest release API during package resolution', async () => {
    await resolveLatestCodeWorkspaceEngineReleaseAsset(platform());

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(CODE_WORKSPACE_ENGINE_CATALOG_LATEST_URL, expect.anything());
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('https://api.github.com/repos/coder/code-server/releases/latest');
  });

  it('explains catalog lookup failures without exposing GitHub rate-limit guidance', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === CODE_WORKSPACE_ENGINE_CATALOG_LATEST_URL) {
        return response({ success: false, error: { code: 'BROWSER_EDITOR_CATALOG_UNAVAILABLE', message: 'Browser Editor catalog is not deployed.' } }, {
          status: 503,
          headers: {
            'content-type': 'application/json',
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await expect(resolveLatestCodeWorkspaceEngineReleaseAsset(platform())).rejects.toThrow(
      'Redeven Browser Editor catalog lookup failed with HTTP 503: Browser Editor catalog is not deployed.',
    );
  });

  it('rejects incomplete catalogs before downloading a package', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === CODE_WORKSPACE_ENGINE_CATALOG_LATEST_URL) {
        return response({ ...catalog(), mirror_complete: false });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await expect(resolveLatestCodeWorkspaceEngineReleaseAsset(platform())).rejects.toThrow(
      'Redeven Browser Editor catalog is not fully mirrored yet.',
    );
  });

  it('fails when the catalog does not include the target platform', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === CODE_WORKSPACE_ENGINE_CATALOG_LATEST_URL) {
        return response({ ...catalog(), platforms: {} });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await expect(resolveLatestCodeWorkspaceEngineReleaseAsset(platform())).rejects.toThrow(
      'Redeven Browser Editor catalog does not include linux/amd64.',
    );
  });

  it('uses a cached archive when a non-empty package already exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-code-workspace-asset-'));
    tempDirs.push(dir);
    const archivePath = path.join(dir, 'code-server.tar.gz');
    await fs.writeFile(archivePath, Buffer.from([9, 8, 7]));
    const fetchMock = vi.mocked(fetch);

    const progress = vi.fn();
    const out = await ensureCodeWorkspaceEngineArchive({
      version: '4.109.1',
      release_tag: 'v4.109.1',
      release_url: 'https://github.com/coder/code-server/releases/tag/v4.109.1',
      asset_name: 'code-server-4.109.1-linux-amd64.tar.gz',
      download_url: 'https://browser-editor-package.example.test/code-server/v4.109.1/code-server-4.109.1-linux-amd64.tar.gz',
      sha256: '06df4f7e1394f1c57cc6583fba4d8060a5a66f4f4771c14aeff6b9af8a28c9b3',
      size_bytes: 3,
      platform: platform(),
      root_dir_hint: 'code-server-4.109.1-linux-amd64',
    }, archivePath, { onProgress: progress });

    expect(out.from_cache).toBe(true);
    expect(out.size_bytes).toBe(3);
    expect(fetchMock).not.toHaveBeenCalledWith('https://browser-editor-package.example.test/code-server/v4.109.1/code-server-4.109.1-linux-amd64.tar.gz', expect.anything());
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'download',
      state: 'completed',
      completed_bytes: 3,
      total_bytes: 3,
      from_cache: true,
    }));
  });

  it('streams download progress and removes a partial file when cancelled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-code-workspace-asset-'));
    tempDirs.push(dir);
    const archivePath = path.join(dir, 'code-server.tar.gz');
    const controller = new AbortController();
    const progress: Array<Readonly<{ phase: string; state: string; completed_bytes?: number }>> = [];

    await expect(ensureCodeWorkspaceEngineArchive({
      version: '4.109.1',
      release_tag: 'v4.109.1',
      release_url: 'https://github.com/coder/code-server/releases/tag/v4.109.1',
      asset_name: 'code-server-4.109.1-linux-amd64.tar.gz',
      download_url: 'https://browser-editor-package.example.test/code-server/v4.109.1/code-server-4.109.1-linux-amd64.tar.gz',
      sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
      size_bytes: 3,
      platform: platform(),
      root_dir_hint: 'code-server-4.109.1-linux-amd64',
    }, archivePath, {
      signal: controller.signal,
      onProgress: (item) => {
        progress.push(item);
        if (item.phase === 'download' && Number(item.completed_bytes) > 0) controller.abort();
      },
    })).rejects.toThrow('Browser Editor setup was canceled while downloading the package.');

    expect(progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'download', state: 'running', completed_bytes: 0 }),
      expect.objectContaining({ phase: 'download', state: 'running', completed_bytes: 3 }),
    ]));
    await expect(fs.stat(archivePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(dir)).filter((name) => name.endsWith('.download.tmp'))).toEqual([]);
  });

  it('rejects a downloaded archive when it does not match the catalog checksum', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-code-workspace-asset-'));
    tempDirs.push(dir);
    const archivePath = path.join(dir, 'code-server.tar.gz');

    await expect(ensureCodeWorkspaceEngineArchive({
      version: '4.109.1',
      release_tag: 'v4.109.1',
      release_url: 'https://github.com/coder/code-server/releases/tag/v4.109.1',
      asset_name: 'code-server-4.109.1-linux-amd64.tar.gz',
      download_url: 'https://browser-editor-package.example.test/code-server/v4.109.1/code-server-4.109.1-linux-amd64.tar.gz',
      sha256: 'b'.repeat(64),
      size_bytes: 3,
      platform: platform(),
      root_dir_hint: 'code-server-4.109.1-linux-amd64',
    }, archivePath)).rejects.toThrow('Downloaded Browser Editor package checksum did not match the Redeven catalog.');
  });
});
