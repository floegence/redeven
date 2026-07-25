import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function source(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, relPath), 'utf8');
}

function functionBody(material: string, name: string, nextName: string): string {
  const start = material.indexOf(`async function ${name}`);
  const end = material.indexOf(`async function ${nextName}`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return material.slice(start, end);
}

describe('plugin state recovery wiring', () => {
  it('runs only the bundled digest-bound CLI recovery command', () => {
    const main = source('./main.ts');
    const body = functionBody(main, 'runPluginStateRecoveryCLI', 'recoverPluginStateFromLauncher');
    expect(body).toContain('const executable = bundledRuntimeExecutablePath();');
    expect(body).toContain("'plugin-state-recovery'");
    expect(body).toContain("'recover'");
    expect(body).toContain("'--expected-plan-sha256'");
    expect(body).toContain("'--confirm-retain-archive-and-reset-active-state'");
    expect(body).toContain('parsePluginStateRecoveryCLIReport(raw, expectedPlanSHA256, code)');
    expect(body).not.toContain('shell: true');
  });

  it('re-inspects stale plans and starts the runtime exactly once after recovery', () => {
    const main = source('./main.ts');
    const body = functionBody(main, 'recoverPluginStateFromLauncher', 'performDesktopLauncherAction');
    expect(body).toContain("error.code === 'recovery_plan_changed'");
    expect(body).toContain('resetLauncherIssueState();');
    expect(body.match(/startEnvironmentRuntimeFromLauncher\(/gu)).toHaveLength(2);
    expect(body.indexOf("error.code === 'recovery_plan_changed'")).toBeLessThan(body.indexOf('resetLauncherIssueState();'));
    expect(body.indexOf('resetLauncherIssueState();')).toBeLessThan(body.lastIndexOf('startEnvironmentRuntimeFromLauncher('));
  });

  it('keeps cancel mutation-free and rejects duplicate confirmations', () => {
    const app = source('../welcome/App.tsx');
    const cancelStart = app.indexOf('function cancelPluginStateRecovery()');
    const confirmStart = app.indexOf('async function confirmPluginStateRecovery()', cancelStart);
    const nextStart = app.indexOf('async function focusEnvironmentWindow(', confirmStart);
    expect(cancelStart).toBeGreaterThanOrEqual(0);
    expect(confirmStart).toBeGreaterThan(cancelStart);
    expect(nextStart).toBeGreaterThan(confirmStart);
    const cancel = app.slice(cancelStart, confirmStart);
    const confirm = app.slice(confirmStart, nextStart);
    expect(cancel).toContain('setPluginStateRecoveryDialog(null)');
    expect(cancel).not.toContain('performAction');
    expect(confirm).toContain('if (!state || pluginStateRecoverySubmitting())');
    expect(confirm).toContain('setPluginStateRecoverySubmitting(true)');
    expect(confirm.match(/props\.runtime\.launcher\.performAction\(/gu)).toHaveLength(1);
  });
});
