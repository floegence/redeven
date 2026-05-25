import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CODE_WORKSPACE_ENGINE_GITHUB_API_RELEASE_LATEST_URL,
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

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === CODE_WORKSPACE_ENGINE_GITHUB_API_RELEASE_LATEST_URL) {
      return response({
        tag_name: 'v4.109.1',
        html_url: 'https://github.com/coder/code-server/releases/tag/v4.109.1',
        assets: [
          {
            name: 'code-server-4.109.1-linux-amd64.tar.gz',
            browser_download_url: 'https://downloads.example.test/code-server-4.109.1-linux-amd64.tar.gz',
          },
        ],
      });
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
  it('resolves the latest code-server release asset for the target platform', async () => {
    const asset = await resolveLatestCodeWorkspaceEngineReleaseAsset(platform());

    expect(asset).toEqual(expect.objectContaining({
      version: '4.109.1',
      release_tag: 'v4.109.1',
      asset_name: 'code-server-4.109.1-linux-amd64.tar.gz',
      root_dir_hint: 'code-server-4.109.1-linux-amd64',
      download_url: 'https://downloads.example.test/code-server-4.109.1-linux-amd64.tar.gz',
    }));
  });

  it('explains GitHub API rate-limit failures during latest release lookup', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === CODE_WORKSPACE_ENGINE_GITHUB_API_RELEASE_LATEST_URL) {
        return response({ message: 'API rate limit exceeded' }, {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await expect(resolveLatestCodeWorkspaceEngineReleaseAsset(platform())).rejects.toThrow(
      'GitHub release lookup failed with HTTP 403: API rate limit exceeded.',
    );
  });

  it('uses a cached archive when a non-empty package already exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-code-workspace-asset-'));
    tempDirs.push(dir);
    const archivePath = path.join(dir, 'code-server.tar.gz');
    await fs.writeFile(archivePath, Buffer.from([9, 8, 7]));
    const fetchMock = vi.mocked(fetch);

    const out = await ensureCodeWorkspaceEngineArchive({
      version: '4.109.1',
      release_tag: 'v4.109.1',
      release_url: 'https://github.com/coder/code-server/releases/tag/v4.109.1',
      asset_name: 'code-server-4.109.1-linux-amd64.tar.gz',
      download_url: 'https://downloads.example.test/code-server-4.109.1-linux-amd64.tar.gz',
      platform: platform(),
      root_dir_hint: 'code-server-4.109.1-linux-amd64',
    }, archivePath);

    expect(out.from_cache).toBe(true);
    expect(out.size_bytes).toBe(3);
    expect(fetchMock).not.toHaveBeenCalledWith('https://downloads.example.test/code-server-4.109.1-linux-amd64.tar.gz', expect.anything());
  });
});
