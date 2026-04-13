import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MANAGED_SSH_RUNTIME_STAMP_FILENAME,
  buildManagedSSHRemoteInstallScript,
  buildManagedSSHRuntimeProbeScript,
  buildManagedSSHStartScript,
  buildManagedSSHUploadedInstallScript,
  buildManagedSSHReportReadScript,
  describeManagedSSHRuntimeProbeResult,
  parseManagedSSHRuntimeProbeResult,
} from './sshRuntime';

function readSSHRuntimeSource(): string {
  return fs.readFileSync(path.join(__dirname, 'sshRuntime.ts'), 'utf8');
}

describe('sshRuntime', () => {
  it('builds remote install, upload-install, runtime-probe, and report scripts around the managed install root', () => {
    expect(buildManagedSSHRemoteInstallScript()).toContain('REDEVEN_INSTALL_MODE=upgrade');
    expect(buildManagedSSHStartScript()).toContain('--state-root "$state_root"');
    expect(buildManagedSSHStartScript()).toContain('--startup-report-file "$report_path"');
    expect(buildManagedSSHRuntimeProbeScript()).toContain("printf 'status=%s\\n' \"$probe_status\"");
    expect(buildManagedSSHRuntimeProbeScript()).toContain(`stamp_path="${'${version_root}'}/${MANAGED_SSH_RUNTIME_STAMP_FILENAME}"`);
    expect(buildManagedSSHRuntimeProbeScript()).toContain('runtime_release_tag=$release_tag');
    expect(buildManagedSSHUploadedInstallScript()).toContain('archive_path="$3"');
    expect(buildManagedSSHUploadedInstallScript()).toContain('uploaded Redeven archive did not contain redeven');
    expect(buildManagedSSHUploadedInstallScript()).toContain('write_runtime_stamp "desktop_upload"');
    expect(buildManagedSSHRemoteInstallScript()).toContain('install_root="${XDG_CACHE_HOME:-$HOME/.cache}/redeven-desktop/runtime"');
    expect(buildManagedSSHRemoteInstallScript()).toContain('if ! runtime_is_compatible; then');
    expect(buildManagedSSHRemoteInstallScript()).toContain('write_runtime_stamp "remote_install"');
    expect(buildManagedSSHReportReadScript()).toContain('startup-report.json');
  });

  it('parses structured probe results and normalizes reported release tags', () => {
    expect(parseManagedSSHRuntimeProbeResult([
      'status=version_mismatch',
      'expected_release_tag=v1.2.3',
      'reported_release_tag=1.2.2',
      'binary_path=/tmp/redeven',
      'stamp_path=/tmp/desktop-runtime.stamp',
      'reason=managed runtime version does not match the requested Desktop release',
    ].join('\n'))).toEqual({
      status: 'version_mismatch',
      expected_release_tag: 'v1.2.3',
      reported_release_tag: 'v1.2.2',
      binary_path: '/tmp/redeven',
      stamp_path: '/tmp/desktop-runtime.stamp',
      reason: 'managed runtime version does not match the requested Desktop release',
    });
  });

  it('describes missing or incompatible managed runtimes for diagnostics', () => {
    expect(describeManagedSSHRuntimeProbeResult({
      status: 'stamp_missing',
      expected_release_tag: 'v1.2.3',
      reported_release_tag: 'v1.2.3',
      binary_path: '/opt/redeven/bin/redeven',
      stamp_path: '/opt/redeven/desktop-runtime.stamp',
      reason: 'managed runtime stamp is missing',
    })).toContain('Desktop stamp is missing');
    expect(describeManagedSSHRuntimeProbeResult({
      status: 'version_mismatch',
      expected_release_tag: 'v1.2.3',
      reported_release_tag: 'v1.2.2',
      binary_path: '/opt/redeven/bin/redeven',
      stamp_path: '/opt/redeven/desktop-runtime.stamp',
      reason: 'managed runtime version does not match the requested Desktop release',
    })).toContain('reports v1.2.2 instead of v1.2.3');
  });

  it('checks the SSH master socket, probes remote platform, and keeps auto fallback limited to local asset preparation failures', () => {
    const source = readSSHRuntimeSource();

    expect(source).toContain("'-O', 'check',");
    expect(source).toContain('async function probeRemoteRuntimeCompatibility(');
    expect(source).toContain('async function probeRemotePlatform(');
    expect(source).toContain('function resolveDesktopSSHReleaseFetchPolicy(');
    expect(source).toContain("return ['desktop_upload', 'remote_install'];");
    expect(source).toContain('class DesktopSSHUploadAssetPreparationError extends Error');
    expect(source).toContain('fetchPolicy: releaseFetchPolicy,');
    expect(source).toContain("if (args.target.bootstrap_strategy === 'auto' && error instanceof DesktopSSHUploadAssetPreparationError)");
    expect(source).toContain('const uploadProbe = await probeRemoteRuntimeCompatibility(args);');
    expect(source).toMatch(/if \(args\.target\.bootstrap_strategy === 'auto'\) \{\s*break;\s*\}\s*continue;/);
    expect(source).toContain('async function waitForForwardedLocalUI(');
    expect(source).toContain('const forwardedStartup = await waitForForwardedLocalUI(');
  });
});
