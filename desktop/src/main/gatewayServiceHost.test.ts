import { describe, expect, it } from 'vitest';

import {
  gatewayReleasePackageName,
  gatewayReleasePackageURL,
  gatewayServiceBinaryPath,
} from './gatewayServiceHost';
import { DEFAULT_DESKTOP_SSH_RUNTIME_ROOT } from '../shared/desktopSSH';
import type { DesktopRuntimePlacement } from '../shared/desktopRuntimePlacement';

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
});
