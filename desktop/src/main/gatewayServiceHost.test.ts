import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  gatewayReleasePackageName,
  gatewayReleasePackageURL,
  gatewayServiceBinaryPath,
  gatewaySupervisorEnrollmentInvocation,
  resolveGatewayHostPlatform,
} from './gatewayServiceHost';
import { DEFAULT_DESKTOP_SSH_RUNTIME_ROOT } from '../shared/desktopSSH';
import type { DesktopRuntimePlacement } from '../shared/desktopRuntimePlacement';

function readGatewayServiceHostSource(): string {
  return fs.readFileSync(path.join(__dirname, 'gatewayServiceHost.ts'), 'utf8');
}

describe('gatewayServiceHost', () => {
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
});
