import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { describe, expect, it } from 'vitest';

import { gatewayServiceBinaryPath, probeManagedGatewayServiceStatus } from './gatewayServiceHost';
import type { DesktopSSHTransportManager } from './sshTransportManager';

describe('gatewayServiceHost', () => {
  it('offers first installation as Start when the actual local service directory is empty', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-gateway-probe-'));
    try {
      const probe = await probeManagedGatewayServiceStatus({
        hostAccess: { kind: 'local_host' }, placement: { kind: 'host_process', runtime_root: root },
        stateRoot: path.join(root, 'gateway-state'), releaseTag: 'v0.0.0-test', releaseBaseURL: '',
        assetCacheRoot: path.join(root, 'cache'), tempRoot: root,
        sshCredentialScope: 'probe-test', sshTransportManager: {} as DesktopSSHTransportManager,
      });
      expect(probe).toMatchObject({ status: 'not_running', package_status: 'missing_binary' });
      expect(fs.existsSync(path.join(root, 'gateway-state'))).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('keeps the standalone Gateway binary inside its own state root', () => {
    expect(gatewayServiceBinaryPath('/srv/redeven-gateway/state')).toBe(
      '/srv/redeven-gateway/state/managed/bin/redeven-gateway',
    );
  });

  it('does not install or start Gateway through a Runtime root', () => {
    const source = fs.readFileSync(path.join(__dirname, 'gatewayServiceHost.ts'), 'utf8');
    expect(source).not.toContain('/gateway/managed');
    expect(source).not.toContain('--enable-profile-write');
    expect(source).not.toContain('--runtime-root "$runtime_root"');
    expect(source).toContain('managed_root="${state_root%/}/managed"');
  });
});
