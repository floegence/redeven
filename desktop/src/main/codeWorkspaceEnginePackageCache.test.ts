import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  prepareCodeWorkspaceEnginePackage,
} from './codeWorkspaceEnginePackageCache';
import {
  CODE_WORKSPACE_ENGINE_GITHUB_API_RELEASE_LATEST_URL,
  type CodeWorkspaceEnginePlatform,
} from './codeWorkspaceEngineReleaseAssets';

const tempDirs: string[] = [];
let latestVersion = '4.109.1';

function platform(): CodeWorkspaceEnginePlatform {
  return {
    os: 'linux',
    arch: 'amd64',
    libc: 'glibc',
    platform_id: 'linux-amd64-glibc',
  };
}

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(
    typeof body === 'string' || body instanceof ArrayBuffer ? body : JSON.stringify(body),
    {
      status: 200,
      ...init,
    },
  );
}

beforeEach(() => {
  latestVersion = '4.109.1';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === CODE_WORKSPACE_ENGINE_GITHUB_API_RELEASE_LATEST_URL) {
      return response({
        tag_name: `v${latestVersion}`,
        html_url: `https://github.com/coder/code-server/releases/tag/v${latestVersion}`,
        assets: [
          {
            name: `code-server-${latestVersion}-linux-amd64.tar.gz`,
            browser_download_url: `https://downloads.example.test/code-server-${latestVersion}-linux-amd64.tar.gz`,
          },
        ],
      });
    }
    return response(Buffer.from(`archive-${latestVersion}`).buffer);
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

describe('code workspace engine package cache', () => {
  it('keeps only the latest package for each platform cache', async () => {
    const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-code-workspace-cache-'));
    tempDirs.push(cacheRoot);

    const first = await prepareCodeWorkspaceEnginePackage({ cacheRoot, platform: platform() });
    expect(first.manifest.version).toBe('4.109.1');

    latestVersion = '4.110.0';
    const second = await prepareCodeWorkspaceEnginePackage({ cacheRoot, platform: platform() });
    expect(second.manifest.version).toBe('4.110.0');

    const platformDir = path.join(cacheRoot, 'linux-amd64-glibc');
    await expect(fs.stat(path.join(platformDir, '4.109.1'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(platformDir, '4.110.0'))).resolves.toEqual(expect.objectContaining({
      isDirectory: expect.any(Function),
    }));
  });
});
