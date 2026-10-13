import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopLauncherActionRequest, DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';
import { desktopCloudRuntimeLinkTargetKindFromID, desktopCloudRuntimeLinkTargetRuntimeKey, type DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import { RuntimeControlError } from './runtimeControlClient';
import { requireEnvironmentManagementAvailable } from './environmentAccessSettings';

function productionBoundary(name: string, context: object) {
  const source = ts.createSourceFile('main.ts', fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8'), ts.ScriptTarget.ESNext, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error(`Launcher boundary is missing: ${name}`);
  const script = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(`${script}\n${name}`, context);
}

// Execute the production action boundary without booting Electron's process owner.
function fixture() {
  const targets = new Set<string>();
  const versions = new Map([['ssh:runtime', 7]]);
  const release = vi.fn(async () => undefined);
  const manage = vi.fn(async () => ({ joined: false, phase: 'not_joined' }));
  const context = { explicitCloudLinkTargets: targets, cloudLinkIntentVersions: versions,
    resolveCloudRuntimeLinkTarget: vi.fn(async () => ({ record: { startup: { runtime_control: { token: 'private' } } }, bridge_lease: { release } })),
    loadDesktopPreferencesCached: vi.fn(async () => ({})), manageRuntimeGateway: manage, providerRuntimeTargetIsCurrent: () => true,
    RuntimeControlError,
    launcherActionSuccess: (outcome: string) => ({ ok: true, outcome }), launcherActionFailure: () => ({ ok: false }) };
  const run = productionBoundary('manageRuntimeGatewayFromLauncher', context) as (request: DesktopLauncherActionRequest) => Promise<DesktopLauncherActionResult>;
  return { run, targets, versions, release, manage, resolve: context.resolveCloudRuntimeLinkTarget };
}

describe('Runtime Gateway launcher ownership', () => {
  it.each(['ssh_host', 'wsl_host', 'local_host'] as const)('acquires the %s bridge after an observed running target without opening an Env App', async hostKind => {
    const target = { id: 'chosen', label: 'Chosen', host_access: { kind: hostKind }, placement: { kind: 'host_process' } };
    const inspection = { runtime_target_available: true, runtime_control_status: { state: 'missing', reason_code: 'forward_unavailable' }, running: true };
    const ready = { runtime_key: target.id };
    const acquire = vi.fn(async () => ({ record: { target_id: 'ssh:chosen' }, release: vi.fn() }));
    const inspect = vi.fn(async () => inspection);
    const connect = productionBoundary('acquireEnvironmentManagementConnection', {
      loadDesktopPreferencesCached: async () => ({ saved_runtime_targets: [target] }),
      runtimePlacementBridgeRegistry: { get: () => null }, runtimeLifecycleTargetKey: () => 'chosen',
      runtimeLifecycleCoordinator: { active: () => null }, inspectRuntimePlacementTargetState: inspect,
      requireEnvironmentManagementAvailable, runtimePlacementReadyByTargetID: new Map([[target.id, ready]]),
      acquireRuntimePlacementBridgeForReadyRecord: acquire,
    }) as (id: string, owner: string) => Promise<unknown>;
    await connect(target.id, 'cloud-link');
    expect(inspect).toHaveBeenCalledOnce();
    expect(acquire).toHaveBeenCalledExactlyOnceWith(ready, 'cloud-link', undefined);
  });
  it.each([
    ['local:container', 'local_host'], ['ssh:runtime', 'ssh_host'], ['ssh:container', 'ssh_host'], ['wsl:runtime', 'wsl_host'],
  ] as const)('resolves and validates the actual %s bridge lease', async (id, hostKind) => {
    const release = vi.fn(async () => undefined);
    const record = { target_id: id, label: 'Selected Runtime', session: { host_access: { kind: hostKind } } };
    const acquire = vi.fn(async () => ({ record, release }));
    const local = vi.fn();
    const resolve = productionBoundary('resolveCloudRuntimeLinkTarget', {
      desktopCloudRuntimeLinkTargetKindFromID, desktopCloudRuntimeLinkTargetRuntimeKey,
      desktopPlatformCapabilities: { native_host_runtime: true }, acquireEnvironmentManagementConnection: acquire,
      verifyCurrentLocalEnvironmentRuntimeRecord: local, attachLocalEnvironmentRuntime: local,
    }) as (preferences: object, id: DesktopCloudRuntimeLinkTargetID) => Promise<unknown>;
    const preferences = { local_environment: { id: 'native-local' } };
    expect(await resolve(preferences, id)).toMatchObject({ id, record });
    expect(acquire).toHaveBeenCalledExactlyOnceWith(id.slice(id.indexOf(':') + 1), 'cloud-link');
    expect(local).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
    record.target_id = 'ssh:another' as typeof id;
    expect(await resolve(preferences, id)).toBeNull(); expect(release).toHaveBeenCalledOnce();
    record.target_id = id; record.session.host_access.kind = (hostKind === 'ssh_host' ? 'local_host' : 'ssh_host') as typeof hostKind;
    expect(await resolve(preferences, id)).toBeNull(); expect(release).toHaveBeenCalledTimes(2);
  });
  it.each(['local:runtime', 'ssh:runtime', 'wsl:runtime', 'local:container', 'ssh:container'] as const)('resolves only the selected %s management owner', async runtime_target_id => {
    const f = fixture();
    expect((await f.run({ kind: 'manage_runtime_gateway', runtime_target_id, operation: 'status' })).ok).toBe(true);
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith({}, runtime_target_id);
    expect(f.manage).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce();
  });
  it.each([
    [new Error('Connection ended'), 'GATEWAY_UNREACHABLE'],
    [new RuntimeControlError('GATEWAY_INVITATION_EXPIRED', 'Invitation expired'), 'GATEWAY_INVITATION_EXPIRED'],
  ])('releases its management lease and preserves the error boundary when enrollment fails: %s', async (error, code) => {
    const f = fixture();
    f.manage.mockRejectedValueOnce(error);
    expect(await f.run({ kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:runtime', operation: 'status' })).toMatchObject({ ok: false, gateway_error_code: code });
    expect(f.release).toHaveBeenCalledOnce();
  });
  it.each(['join','retry','update-endpoints','leave'] as const)('preserves independent Cloud intent during %s', async operation => {
   const f=fixture();f.targets.add('ssh:runtime');
   expect((await f.run({kind:'manage_runtime_gateway',runtime_target_id:'ssh:runtime',operation, ...(['join','update-endpoints'].includes(operation)?{preview_id:'a'.repeat(43)}:{gateway_id:'gateway'})})).ok).toBe(true);
   expect(f.versions.get('ssh:runtime')).toBe(7);expect(f.targets.has('ssh:runtime')).toBe(true);
  });
  it.each([false, true])('reads status without acquiring or releasing a Cloud operation owner (already owned: %s)', async owned => {
    const f = fixture();
    if (owned) f.targets.add('ssh:runtime');
    expect((await f.run({ kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:runtime', operation: 'status' })).ok).toBe(true);
    expect(f.versions.get('ssh:runtime')).toBe(7);
    expect(f.targets.has('ssh:runtime')).toBe(owned);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('serializes an acknowledged route interruption and releases its operation owner', async () => {
    const f = fixture();
    expect((await f.run({ kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:runtime', operation: 'leave', route_impact_acknowledged:true })).ok).toBe(true);
    expect(f.versions.get('ssh:runtime')).toBe(8);
    expect(f.targets.size).toBe(0);
    expect(f.release).toHaveBeenCalledOnce();
  });
});
