import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { describe, expect, it } from 'vitest';

import { ensureManagedGatewayServiceReady, GatewayServiceStartError, gatewayServiceBinaryPath, probeManagedGatewayServiceDeep, probeManagedGatewayServiceStatus } from './gatewayServiceHost';
import type { DesktopSSHTransportManager } from './sshTransportManager';

describe('gatewayServiceHost', () => {
  it.each([
    ['v0.0.0-dev', 'v0.0.0-dev'],
    ['v1.2.0', 'v1.3.0'],
    ['v1.4.0', 'v1.3.0'],
  ])('keeps a valid %s Gateway usable with Desktop targeting %s', async (installedRelease, targetRelease) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-gateway-compatible-'));
    const stateRoot = path.join(root, 'state');
    const binary = gatewayServiceBinaryPath(stateRoot);
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, `#!/bin/sh
case "$1" in
version) echo 'redeven-gateway ${installedRelease} (installed-build)' ;;
service-status|service-start) echo '{"status":"running","pid":123,"listen":"127.0.0.1:7443"}' ;;
*) exit 2 ;;
esac
`, { mode: 0o700 });
    const stamp = path.join(stateRoot, 'managed/managed-gateway.stamp');
    const stampText = 'schema_version=3\ninstalled_by=redeven-desktop\nslot_release_tag=' + installedRelease + '\nsource_commit=installed-build\n';
    fs.writeFileSync(stamp, stampText);
    const phases: string[] = [];
    const options = {
      hostAccess: { kind: 'local_host' as const }, placement: { kind: 'host_process' as const, runtime_root: root },
      stateRoot, releaseTag: targetRelease, targetCommit: 'desktop-build', releaseBaseURL: '',
      assetCacheRoot: path.join(root, 'cache'), tempRoot: root,
      sshCredentialScope: 'compatibility-test', sshTransportManager: {} as DesktopSSHTransportManager,
      onProgress: (progress: { phase: string }) => phases.push(progress.phase),
    };
    try {
      expect(await probeManagedGatewayServiceStatus(options)).toMatchObject({ status: 'running', package_status: 'ready', pid: 123 });
      expect(await probeManagedGatewayServiceDeep(options)).toMatchObject({
        package_status: 'ready', service_status: 'running', version: installedRelease, target_version: targetRelease,
        commit: 'installed-build', target_commit: 'desktop-build',
      });
      await expect(ensureManagedGatewayServiceReady(options)).resolves.toBe(binary);
      expect(phases).not.toContain('preparing_gateway_package');
      expect(phases).not.toContain('installing_gateway');
      expect(fs.readFileSync(stamp, 'utf8')).toBe(stampText);
      fs.writeFileSync(stamp, stampText.replace('source_commit=installed-build', 'source_commit=unexpected-build'));
      expect(await probeManagedGatewayServiceStatus(options)).toMatchObject({ status: 'needs_update', package_status: 'build_identity_mismatch' });
      fs.writeFileSync(stamp, stampText.replace('slot_release_tag=' + installedRelease, 'slot_release_tag=v9.9.9'));
      expect(await probeManagedGatewayServiceStatus(options)).toMatchObject({ status: 'needs_update', package_status: 'slot_version_mismatch' });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('preserves structured state failures across a real host command and allows recovery after repair', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-gateway-start-failure-'));
    const stateRoot = path.join(root, 'state');
    const binary = gatewayServiceBinaryPath(stateRoot);
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    const resultPath = path.join(stateRoot, 'fixture-result.json');
    const rejected = { status: 'error', error_code: 'gateway_state_unsupported',
      error_message: 'members.json: unsupported schema_version 4; expected 5', recovery: 'Recreate local configuration. Cloud authorizations are unchanged.' };
    fs.writeFileSync(resultPath, JSON.stringify(rejected));
    fs.writeFileSync(binary, `#!/bin/sh
case "$1" in
version) echo 'redeven-gateway v0.0.0-test (test)' ;;
service-status|service-start) cat "$(dirname "$0")/../../fixture-result.json"; exit 1 ;;
*) exit 2 ;;
esac
`, { mode: 0o700 });
    fs.writeFileSync(path.join(stateRoot, 'managed/managed-gateway.stamp'), 'schema_version=3\ninstalled_by=redeven-desktop\nslot_release_tag=v0.0.0-test\nsource_commit=test\n');
    const phases: string[] = [];
    const options = {
      hostAccess: { kind: 'local_host' as const }, placement: { kind: 'host_process' as const, runtime_root: root },
      stateRoot, releaseTag: 'v0.0.0-test', releaseBaseURL: '', assetCacheRoot: path.join(root, 'cache'), tempRoot: root,
      sshCredentialScope: 'start-test', sshTransportManager: {} as DesktopSSHTransportManager,
      onProgress: (progress: { phase: string }) => phases.push(progress.phase),
    };
    try {
      expect(await probeManagedGatewayServiceStatus(options)).toMatchObject({ status: 'needs_reinstall', error_code: rejected.error_code });
      await expect(ensureManagedGatewayServiceReady(options)).rejects.toMatchObject({
        name: 'GatewayServiceStartError', requiresStateRecovery: true, status: rejected,
      });
      expect(phases).not.toContain('gateway_ready');
      fs.writeFileSync(resultPath, JSON.stringify({ status: 'not_running' }));
      expect(await probeManagedGatewayServiceStatus(options)).toMatchObject({ status: 'not_running' });
      fs.writeFileSync(resultPath, JSON.stringify({ status: 'running', pid: 123, listen: '127.0.0.1:7443' }));
      await expect(ensureManagedGatewayServiceReady(options)).resolves.toBe(binary);
      expect(phases.at(-1)).toBe('gateway_ready');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('redacts credentials from a rejected startup result', () => {
    const error = new GatewayServiceStartError({ status: 'error', error_code: 'gateway_state_invalid', error_message: 'token=secret-value' });
    expect(error.message).not.toContain('secret-value');
  });

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
