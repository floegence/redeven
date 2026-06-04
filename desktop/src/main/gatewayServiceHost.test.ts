import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  gatewayReleasePackageName,
  gatewayReleasePackageURL,
  gatewayServiceBinaryPath,
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

  it('keeps Check Gateway deep probe read-only and bridge-free', () => {
    const source = readGatewayServiceHostSource();
    const probeStart = source.indexOf('function gatewayDeepProbeScript');
    const probeEnd = source.indexOf('function gatewayLegacyCleanupScript');
    const probeSource = source.slice(probeStart, probeEnd);

    expect(probeSource).toContain('service-status --state-root "$state_root"');
    expect(probeSource).toContain('legacy_local_catalog_present');
    expect(probeSource).toContain('legacy_runtime_pids');
    expect(probeSource).not.toContain('desktop-bridge');
    expect(probeSource).not.toContain('service-start');
    expect(probeSource).not.toContain('service-stop');
    expect(probeSource).not.toContain('kill "$pid"');
    expect(probeSource).not.toContain('rm -f');
  });

  it('limits legacy cleanup to the exact desktop-managed Gateway root', () => {
    const source = readGatewayServiceHostSource();
    const matcherStart = source.indexOf('function gatewayLegacyRuntimePIDAwkScript');
    const matcherEnd = source.indexOf('function gatewayDeepProbeScript');
    const cleanupStart = source.indexOf('function gatewayLegacyCleanupScript');
    const cleanupEnd = source.indexOf('function commandForPlacement');
    const matcherSource = source.slice(matcherStart, matcherEnd);
    const cleanupSource = source.slice(cleanupStart, cleanupEnd);

    expect(cleanupSource).toContain('gateway_id="${3:-}"');
    expect(cleanupSource).toContain('expected_profile_root="${runtime_root%/}/gateways/${gateway_id}"');
    expect(cleanupSource).toContain('expected_state_root="${expected_profile_root%/}/state"');
    expect(cleanupSource).toContain('Gateway legacy cleanup refused unexpected state root');
    expect(cleanupSource).toContain('gatewayLegacyRuntimePIDAwkScript()');
    expect(matcherSource).toContain('parts[i] == "--desktop-managed"');
    expect(matcherSource).toContain('parts[i] == "--state-root" && (parts[i + 1] == state || parts[i + 1] == profile)');
    expect(matcherSource).toContain('parts[i] == "--state-root=" state');
    expect(matcherSource).toContain('parts[i] == "--state-root=" profile');
    expect(matcherSource).not.toContain('index($0, "--desktop-managed")');
    expect(cleanupSource).toContain('rm -f "${profile_root%/}/catalog/local-environment.json"');
  });
});
