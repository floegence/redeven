import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';
import type { CodeWorkspaceEngineArtifactManifest } from './codeWorkspaceEnginePackageCache';
import {
  DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_ARCHIVE_LIMIT,
  uploadCodeWorkspaceEngineViaRuntimeControl,
} from './codeWorkspaceEngineTransfer';

type TestServer = Readonly<{
  origin: string;
  requests: readonly http.IncomingMessage[];
  close: () => Promise<void>;
}>;

const tempDirs: string[] = [];
const servers: TestServer[] = [];

function endpoint(baseURL: string): DesktopRuntimeControlEndpoint {
  return {
    protocol_version: 'redeven-runtime-control-v1',
    base_url: baseURL,
    token: 'runtime-control-token',
    desktop_owner_id: 'desktop-owner',
  };
}

function manifest(): CodeWorkspaceEngineArtifactManifest {
  return {
    schema_version: 1,
    engine: 'code-server',
    version: '4.126.0',
    source: {
      kind: 'github_release',
      release_url: 'https://github.com/coder/code-server/releases/tag/v4.126.0',
      asset_name: 'code-server-4.126.0-linux-arm64.tar.gz',
    },
    platform: {
      os: 'linux',
      arch: 'arm64',
      libc: 'glibc',
      platform_id: 'linux-arm64-glibc',
      supported: true,
    },
    archive: {
      sha256: 'a'.repeat(64),
      size_bytes: 3,
      compression: 'tar.gz',
    },
    layout: {
      binary_relpath: 'bin/code-server',
      root_dir_hint: 'code-server-4.126.0-linux-arm64',
    },
  };
}

async function startServer(): Promise<TestServer> {
  const requests: http.IncomingMessage[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true, data: {} }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server did not expose a TCP port');
  }
  const fixture: TestServer = {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  servers.push(fixture);
  return fixture;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('code workspace engine transfer', () => {
  it('allows Browser Editor packages up to the 2 GiB transfer cap', () => {
    expect(DEFAULT_CODE_WORKSPACE_ENGINE_UPLOAD_ARCHIVE_LIMIT).toBe(2 * 1024 * 1024 * 1024);
  });

  it('rejects packages above the configured cap before creating an import session', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-code-workspace-transfer-'));
    tempDirs.push(tempDir);
    const archivePath = path.join(tempDir, 'code-server.tar.gz');
    await fs.writeFile(archivePath, Buffer.from([1, 2, 3]));
    const server = await startServer();

    await expect(uploadCodeWorkspaceEngineViaRuntimeControl({
      endpoint: endpoint(server.origin),
      manifest: manifest(),
      archivePath,
      maxArchiveBytes: 2,
    })).rejects.toThrow('Workspace engine package is too large (3 bytes).');
    expect(server.requests).toHaveLength(0);
  });
});
