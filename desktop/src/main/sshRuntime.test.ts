import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildManagedSSHRemoteInstallScript,
  buildManagedSSHRuntimeReadyScript,
  buildManagedSSHStartScript,
  buildManagedSSHUploadedInstallScript,
  buildManagedSSHReportReadScript,
} from './sshRuntime';

function readSSHRuntimeSource(): string {
  return fs.readFileSync(path.join(__dirname, 'sshRuntime.ts'), 'utf8');
}

describe('sshRuntime', () => {
  it('builds remote install, upload-install, runtime-ready, and report scripts around the managed install root', () => {
    expect(buildManagedSSHRemoteInstallScript()).toContain('REDEVEN_INSTALL_MODE=upgrade');
    expect(buildManagedSSHStartScript()).toContain('--startup-report-file "$report_path"');
    expect(buildManagedSSHRuntimeReadyScript()).toContain('"$binary" version >/dev/null 2>&1');
    expect(buildManagedSSHUploadedInstallScript()).toContain('archive_path="$3"');
    expect(buildManagedSSHUploadedInstallScript()).toContain('uploaded Redeven archive did not contain redeven');
    expect(buildManagedSSHRemoteInstallScript()).toContain('install_root="${XDG_CACHE_HOME:-$HOME/.cache}/redeven-desktop/runtime"');
    expect(buildManagedSSHReportReadScript()).toContain('startup-report.json');
  });

  it('checks the SSH master socket, probes remote platform, and keeps auto fallback limited to local asset preparation failures', () => {
    const source = readSSHRuntimeSource();

    expect(source).toContain("'-O', 'check',");
    expect(source).toContain('async function probeRemotePlatform(');
    expect(source).toContain("return ['desktop_upload', 'remote_install'];");
    expect(source).toContain('class DesktopSSHUploadAssetPreparationError extends Error');
    expect(source).toContain("if (args.target.bootstrap_strategy === 'auto' && error instanceof DesktopSSHUploadAssetPreparationError)");
    expect(source).toMatch(/if \(strategy === 'desktop_upload' && args\.target\.bootstrap_strategy === 'auto'\) \{\s*break;/);
    expect(source).toContain('async function waitForForwardedLocalUI(');
    expect(source).toContain('const forwardedStartup = await waitForForwardedLocalUI(');
  });
});
