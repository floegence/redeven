import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  prepareCodeWorkspaceEnginePackage,
} from './codeWorkspaceEnginePackageCache';
import {
  CODE_WORKSPACE_ENGINE_CATALOG_LATEST_URL,
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

function archiveBytes(version: string): Buffer {
  return Buffer.from(`archive-${version}`);
}

function archiveSHA(version: string): string {
  return createHash('sha256').update(archiveBytes(version)).digest('hex');
}

function catalog(version: string) {
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
        sha256: archiveSHA(version),
        size_bytes: archiveBytes(version).byteLength,
        compression: 'tar.gz',
        root_dir_hint: `code-server-${version}-linux-amd64`,
      },
    },
    mirror_complete: true,
  };
}

beforeEach(() => {
  latestVersion = '4.109.1';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === CODE_WORKSPACE_ENGINE_CATALOG_LATEST_URL) {
      return response(catalog(latestVersion));
    }
    return new Response(Uint8Array.from(archiveBytes(latestVersion)));
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
    const fetchMock = vi.mocked(fetch);

    const progress = vi.fn();
    const first = await prepareCodeWorkspaceEnginePackage({
      cacheRoot,
      platform: platform(),
      fetchPolicy: { onProgress: progress },
    });
    expect(first.manifest.version).toBe('4.109.1');
    expect(first.manifest.archive).toEqual({
      sha256: archiveSHA('4.109.1'),
      size_bytes: archiveBytes('4.109.1').byteLength,
      compression: 'tar.gz',
    });
    expect(fetchMock).toHaveBeenCalledWith(CODE_WORKSPACE_ENGINE_CATALOG_LATEST_URL, expect.anything());
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('https://api.github.com/repos/coder/code-server/releases/latest');
    expect(progress.mock.calls.map(([item]) => [item.phase, item.state])).toEqual(expect.arrayContaining([
      ['lookup', 'running'],
      ['lookup', 'completed'],
      ['download', 'completed'],
      ['package_validation', 'completed'],
    ]));

    latestVersion = '4.110.0';
    const second = await prepareCodeWorkspaceEnginePackage({ cacheRoot, platform: platform() });
    expect(second.manifest.version).toBe('4.110.0');
    expect(second.manifest.archive).toEqual({
      sha256: archiveSHA('4.110.0'),
      size_bytes: archiveBytes('4.110.0').byteLength,
      compression: 'tar.gz',
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('https://api.github.com/repos/coder/code-server/releases/latest');

    const platformDir = path.join(cacheRoot, 'linux-amd64-glibc');
    await expect(fs.stat(path.join(platformDir, '4.109.1'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(platformDir, '4.110.0'))).resolves.toEqual(expect.objectContaining({
      isDirectory: expect.any(Function),
    }));
  });
});
