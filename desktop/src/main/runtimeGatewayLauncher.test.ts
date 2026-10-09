import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopLauncherActionRequest, DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';

// Execute the production action boundary without booting Electron's process owner.
function fixture() {
  const source = ts.createSourceFile('main.ts', fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8'), ts.ScriptTarget.ESNext, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'manageRuntimeGatewayFromLauncher');
  if (!declaration) throw new Error('Gateway launcher boundary is missing');
  const targets = new Set<string>();
  const versions = new Map([['ssh:runtime', 7]]);
  const recovery = { settled: vi.fn(async () => undefined), forget: vi.fn() };
  const release = vi.fn(async () => undefined);
  const manage = vi.fn(async () => ({ joined: false, phase: 'not_joined' }));
  const context = { explicitCloudLinkTargets: targets, cloudLinkIntentVersions: versions, cloudCredentialRecovery: recovery,
    resolveCloudRuntimeLinkTarget: vi.fn(async () => ({ record: { startup: { runtime_control: { token: 'private' } } }, bridge_lease: { release } })),
    loadDesktopPreferencesCached: vi.fn(async () => ({})), manageRuntimeGateway: manage, providerRuntimeTargetIsCurrent: () => true,
    launcherActionSuccess: (outcome: string) => ({ ok: true, outcome }), launcherActionFailure: () => ({ ok: false }) };
  const script = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = vm.runInNewContext(`${script}\nmanageRuntimeGatewayFromLauncher`, context) as (request: DesktopLauncherActionRequest) => Promise<DesktopLauncherActionResult>;
  return { run, targets, versions, recovery, release, manage };
}

describe('Runtime Gateway launcher ownership', () => {
  it.each([false, true])('reads status without acquiring or releasing a Cloud operation owner (already owned: %s)', async owned => {
    const f = fixture();
    if (owned) f.targets.add('ssh:runtime');
    expect((await f.run({ kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:runtime', operation: 'status' })).ok).toBe(true);
    expect(f.versions.get('ssh:runtime')).toBe(7);
    expect(f.targets.has('ssh:runtime')).toBe(owned);
    expect(f.recovery.settled).not.toHaveBeenCalled();
    expect(f.recovery.forget).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('fences recovery for an explicit membership mutation and releases its owner', async () => {
    const f = fixture();
    expect((await f.run({ kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:runtime', operation: 'leave' })).ok).toBe(true);
    expect(f.versions.get('ssh:runtime')).toBe(8);
    expect(f.recovery.settled).toHaveBeenCalledWith('ssh:runtime');
    expect(f.recovery.forget).toHaveBeenCalledWith('ssh:runtime');
    expect(f.targets.size).toBe(0);
    expect(f.release).toHaveBeenCalledOnce();
  });
});
