import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildManagedSSHControlScript, buildManagedSSHReportReadScript } from './sshRuntime';

function readSSHRuntimeSource(): string {
  return fs.readFileSync(path.join(__dirname, 'sshRuntime.ts'), 'utf8');
}

describe('sshRuntime', () => {
  it('builds remote control and report scripts around the managed install root', () => {
    expect(buildManagedSSHControlScript()).toContain('REDEVEN_INSTALL_MODE=upgrade');
    expect(buildManagedSSHControlScript()).toContain('--startup-report-file "$report_path"');
    expect(buildManagedSSHControlScript()).toContain('install_root="${XDG_CACHE_HOME:-$HOME/.cache}/redeven-desktop/runtime"');
    expect(buildManagedSSHReportReadScript()).toContain('startup-report.json');
  });

  it('checks the SSH master socket before the destination args and polls forwarded Local UI readiness', () => {
    const source = readSSHRuntimeSource();

    expect(source).toContain("'-O', 'check',");
    expect(source).toContain('async function waitForForwardedLocalUI(');
    expect(source).toContain('const forwardedStartup = await waitForForwardedLocalUI(');
  });
});
