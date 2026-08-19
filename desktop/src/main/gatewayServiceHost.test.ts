import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const packageMocks = vi.hoisted(() => ({
  prepareDesktopRuntimeUploadAsset: vi.fn(),
}));

vi.mock('./runtimePackageCache', async () => {
  const actual = await vi.importActual<typeof import('./runtimePackageCache')>('./runtimePackageCache');
  return {
    ...actual,
    prepareDesktopRuntimeUploadAsset: packageMocks.prepareDesktopRuntimeUploadAsset,
  };
});

import {
  gatewayReleasePackageName,
  gatewayReleasePackageURL,
  gatewayServiceBinaryPath,
  gatewaySupervisorEnrollmentInvocation,
  ensureManagedGatewayServiceReady,
  probeManagedGatewayServiceStatus,
  resolveGatewayHostPlatform,
} from './gatewayServiceHost';
import { DEFAULT_DESKTOP_SSH_RUNTIME_ROOT } from '../shared/desktopSSH';
import type { DesktopRuntimePlacement } from '../shared/desktopRuntimePlacement';
import type { DesktopBundle } from './desktopBundle';

function readGatewayServiceHostSource(): string {
  return fs.readFileSync(path.join(__dirname, 'gatewayServiceHost.ts'), 'utf8');
}

describe('gatewayServiceHost', () => {
  beforeEach(() => {
    packageMocks.prepareDesktopRuntimeUploadAsset.mockReset();
  });

  it('resolves Gateway service binaries into the independent Gateway managed slot', () => {
    expect(gatewayServiceBinaryPath({
      kind: 'host_process',
      runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
    } satisfies DesktopRuntimePlacement)).toBe(`${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateway/managed/bin/redeven-gateway`);

    expect(gatewayServiceBinaryPath({
      kind: 'host_process',
      runtime_root: '/opt/redeven/',
    } satisfies DesktopRuntimePlacement)).toBe('/opt/redeven/gateway/managed/bin/redeven-gateway');
  });

  it('uses the independent redeven-gateway release package name', () => {
    const platform = {
      goos: 'linux',
      goarch: 'amd64',
      platform_id: 'linux_amd64',
      release_package_name: 'redeven_linux_amd64.tar.gz',
      platform_label: 'linux/amd64',
    } as const;

    expect(gatewayReleasePackageName(platform)).toBe('redeven-gateway_linux_amd64.tar.gz');
    expect(gatewayReleasePackageURL('https://mirror.example/releases/', '1.2.3', platform)).toBe(
      'https://mirror.example/releases/download/v1.2.3/redeven-gateway_linux_amd64.tar.gz',
    );
  });

  it('supports published macOS Gateway packages only for the local host', () => {
    expect(resolveGatewayHostPlatform('local_host', 'Darwin', 'arm64')).toMatchObject({
      goos: 'darwin',
      goarch: 'arm64',
      platform_id: 'darwin_arm64',
    });
    expect(resolveGatewayHostPlatform('ssh_host', 'Darwin', 'arm64').platform_id).toBe('darwin_arm64');
    expect(resolveGatewayHostPlatform(undefined, 'Darwin', 'arm64').platform_id).toBe('darwin_arm64');
  });

  it('keeps Check Gateway deep probe read-only and bridge-free', () => {
    const source = readGatewayServiceHostSource();
    const probeStart = source.indexOf('function gatewayDeepProbeScript');
    const probeEnd = source.indexOf('function commandForPlacement');
    const probeSource = source.slice(probeStart, probeEnd);

    expect(probeSource).toContain('service-status --state-root "$state_root"');
    expect(probeSource).not.toContain('desktop-bridge');
    expect(probeSource).not.toContain('service-start');
    expect(probeSource).not.toContain('service-stop');
    expect(probeSource).not.toContain('kill "$pid"');
    expect(probeSource).not.toContain('rm -f');
  });

  it('never inspects or stops Runtime processes while installing Gateway', () => {
    const source = readGatewayServiceHostSource();
    expect(source).not.toContain('gatewayLegacyRuntimePIDAwkScript');
    expect(source).not.toContain('gatewayLegacyCleanupScript');
    expect(source).not.toContain('desktop-runtime-stop');
    expect(source).not.toContain('legacy_runtime_pids');
  });

  it('passes the one-time enrollment code only through stdin', () => {
    const invocation = gatewaySupervisorEnrollmentInvocation({
      kind: 'host_process',
      runtime_root: '/opt/redeven',
    }, {
      state_root: '/opt/redeven/gateways/gw_target/state',
      release_tag: 'v1.2.3',
      provider_origin: 'https://provider.example',
      environment_id: 'env_demo',
      enrollment_code: 'enrollment-secret',
    });

    expect(invocation.stdin_data.toString('utf8')).toBe('enrollment-secret\n');
    expect(invocation.argv.join(' ')).toContain('supervisor enroll');
    expect(invocation.argv).toContain('https://provider.example');
    expect(invocation.argv).toContain('env_demo');
    expect(invocation.argv.join(' ')).not.toContain('enrollment-secret');
  });

  it('fails closed before local startup when Desktop has no validated bundle', async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-gateway-probe-'));
    const stateRoot = path.join(runtimeRoot, 'gateways', 'gw_test', 'state');

    try {
      await expect(probeManagedGatewayServiceStatus({
        sshTransportManager: null as never,
        sshCredentialScope: 'gw_test',
        hostAccess: { kind: 'local_host' },
        placement: { kind: 'host_process', runtime_root: runtimeRoot },
        stateRoot,
        releaseTag: 'v0.0.0-dev',
        releaseBaseURL: '',
        assetCacheRoot: path.join(runtimeRoot, 'cache'),
        tempRoot: path.join(runtimeRoot, 'tmp'),
      })).rejects.toThrow('Repair or reinstall');
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('starts the local Gateway and Runtime from the validated Desktop bundle without preparing an upload asset', async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-local-bundle-start-'));
    const stateRoot = path.join(runtimeRoot, 'gateways', 'local', 'state');
    const binaryPath = path.join(runtimeRoot, 'bundle', 'redeven-gateway');
    const manifestPath = path.join(runtimeRoot, 'bundle', 'desktop-bundle-manifest.json');
    const invocationPath = path.join(runtimeRoot, 'service-start.args');
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(binaryPath, [
      '#!/bin/sh',
      'case "$1" in',
      '  service-status) echo \'{"status":"not_running"}\'; exit 1 ;;',
      `  service-start) printf '%s\\n' "$*" > ${JSON.stringify(invocationPath)}; echo '{"status":"running"}'; exit 0 ;;`,
      '  service-stop) echo \'{"status":"not_running"}\'; exit 0 ;;',
      '  *) exit 2 ;;',
      'esac',
      '',
    ].join('\n'), { mode: 0o755 });
    fs.writeFileSync(manifestPath, '{}\n');
    const bundle: DesktopBundle = {
      root: path.dirname(binaryPath),
      manifest_path: manifestPath,
      version: 'v1.2.3',
      commit: 'abc123',
      platform: 'darwin',
      architecture: 'arm64',
      gateway: { path: binaryPath, sha256: 'a'.repeat(64), size_bytes: 1, executable: true },
      runtime_suite: [{ path: path.join(path.dirname(binaryPath), 'redeven'), sha256: 'b'.repeat(64), size_bytes: 1, executable: true }],
    };

    try {
      await expect(ensureManagedGatewayServiceReady({
        sshTransportManager: null as never,
        sshCredentialScope: 'local',
        hostAccess: { kind: 'local_host' },
        placement: { kind: 'host_process', runtime_root: runtimeRoot },
        stateRoot,
        releaseTag: 'v1.2.3',
        releaseBaseURL: '',
        assetCacheRoot: path.join(runtimeRoot, 'cache'),
        tempRoot: path.join(runtimeRoot, 'tmp'),
        precompiledBundle: bundle,
        sourceRuntimeRoot: '/source/tree/that/must/not/be-used',
      })).resolves.toBe(binaryPath);

      expect(fs.readFileSync(invocationPath, 'utf8')).toContain(`--precompiled-runtime-manifest ${manifestPath}`);
      expect(packageMocks.prepareDesktopRuntimeUploadAsset).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});
