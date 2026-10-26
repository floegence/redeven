import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopSSHTransportManager } from './sshTransportManager';

const prepare = vi.hoisted(() => vi.fn());
vi.mock('./runtimePackageCache', async importOriginal => ({
  ...await importOriginal<typeof import('./runtimePackageCache')>(), prepareDesktopRuntimeUploadAsset: prepare,
}));
import { ensureManagedGatewayServiceReady, gatewayServiceBinaryPath } from './gatewayServiceHost';

describe('explicit Gateway installation identity', () => {
  it.each([
    ['v1.0.0', 'target-build', 'reported v1.0.0 instead of v2.0.0'],
    ['v2.0.0', 'wrong-build', 'reported commit wrong-build instead of target-build'],
  ])('rejects an archive reporting %s (%s) before replacing the existing installation', async (release, commit, message) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-gateway-install-'));
    const stateRoot = path.join(root, 'state');
    const binary = gatewayServiceBinaryPath(stateRoot);
    const stampPath = path.join(stateRoot, 'managed/managed-gateway.stamp');
    const original = '#!/bin/sh\ncase "$1" in\nversion) echo "redeven-gateway v1.0.0 (installed-build)" ;;\nservice-status|service-stop) echo \'{"status":"not_running"}\' ;;\n*) exit 2 ;;\nesac\n';
    const stamp = 'schema_version=3\ninstalled_by=redeven-desktop\nslot_release_tag=v1.0.0\nsource_commit=installed-build\n';
    try {
      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.writeFileSync(binary, original, { mode: 0o700 });
      fs.writeFileSync(stampPath, stamp);
      const archiveRoot = path.join(root, 'archive');
      fs.mkdirSync(archiveRoot);
      fs.writeFileSync(path.join(archiveRoot, 'redeven-gateway'), '#!/bin/sh\necho "redeven-gateway ' + release + ' (' + commit + ')"\n', { mode: 0o700 });
      prepare.mockResolvedValue({ archiveData: execFileSync('tar', ['-czf', '-', '-C', archiveRoot, 'redeven-gateway']), source: 'source_build' });
      await expect(ensureManagedGatewayServiceReady({
        hostAccess: { kind: 'local_host' }, placement: { kind: 'host_process', runtime_root: root },
        stateRoot, releaseTag: 'v2.0.0', targetCommit: 'target-build', forceUpdate: true, releaseBaseURL: '',
        assetCacheRoot: path.join(root, 'cache'), tempRoot: root, sshCredentialScope: 'archive-test',
        sshTransportManager: {} as DesktopSSHTransportManager,
      })).rejects.toMatchObject({ presentation: { diagnostics: expect.arrayContaining([
        expect.objectContaining({ channel: 'stderr', text: expect.stringContaining(message) }),
      ]) } });
      expect(fs.readFileSync(binary, 'utf8')).toBe(original);
      expect(fs.readFileSync(stampPath, 'utf8')).toBe(stamp);
      expect(fs.readdirSync(stateRoot)).toEqual(['managed']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
