import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopLauncherActionRequest, DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';
import { desktopCloudRuntimeLinkTargetKindFromID, desktopCloudRuntimeLinkTargetRuntimeKey, type DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import { RuntimeControlError } from './runtimeControlClient';
import { requireEnvironmentManagementAvailable } from './environmentAccessSettings';
import { EnvironmentManagementConnections } from './environmentManagementConnections';
import { DesktopSSHTransportAuthenticationError } from './sshTransportManager';

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
  it('binds transient authentication and cancellation to the originating Desktop window', async () => {
    let active = true;
    const release = vi.fn(async () => { active = false; });
    const retain = vi.fn(async () => ({ record: {}, release: vi.fn() }));
    const connect = vi.fn(async (_id: string, _owner: string, _signal: AbortSignal, password?: string) => {
      if (password !== ' temporary password ') throw new DesktopSSHTransportAuthenticationError('Authentication rejected');
      return { get active() { return active; }, record: {}, release, retain };
    });
    const manager = new EnvironmentManagementConnections(connect as never, 'gateway');
    const manage = vi.fn(async () => ({ ok: true }));
    const frame = {};
    const event = { sender: { id: 42, mainFrame: frame }, senderFrame: frame };
    const run = productionBoundary('performRuntimeGatewayDialogAction', {
      utilityWindowKindByWebContentsID: new Map([[42, 'launcher']]), watchEnvironmentManagementWindow: vi.fn(),
      gatewayManagementConnections: manager, desktopCloudRuntimeLinkTargetRuntimeKey,
      manageRuntimeGatewayFromLauncher: manage, RuntimeControlError, DesktopSSHTransportAuthenticationError,
      launcherActionFailure: () => ({ ok: false }), launcherActionSuccess: () => ({ ok: true }),
    }) as (event: object, request: object) => Promise<DesktopLauncherActionResult>;
    const request = { kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:chosen', connection_token: 10, operation: 'status' };
    expect(await run({ ...event, senderFrame: {} }, request)).toMatchObject({ ok: false });
    expect(connect).not.toHaveBeenCalled();
    expect(await run(event, request)).toMatchObject({ ok: false, gateway_error_code: 'SSH_AUTHENTICATION_REQUIRED' });
    expect(manage).not.toHaveBeenCalled();
    expect(await run(event, { ...request, ssh_password: ' temporary password ' })).toMatchObject({ ok: true });
    expect(await run(event, { ...request, operation: 'preview' })).toMatchObject({ ok: true });
    expect(await run(event, { ...request, operation: 'join' })).toMatchObject({ ok: true });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect.mock.calls[1]).toEqual(['chosen', 'gateway:42:10', expect.any(AbortSignal), ' temporary password ']);
    expect(release).not.toHaveBeenCalled();
    expect(await run(event, { kind: 'close_runtime_gateway', runtime_target_id: 'ssh:chosen', connection_token: 10 })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(await run(event, request)).toMatchObject({ ok: false, gateway_error_code: 'GATEWAY_CONNECTION_CLOSED' });
    expect(manage).toHaveBeenCalledTimes(3);
  });
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
    expect(acquire).toHaveBeenCalledExactlyOnceWith(ready, 'cloud-link', undefined, undefined);
  });
  it('passes a transient password to both the host inspection and bridge without saving it', async () => {
    const target = { id: 'chosen', label: 'Chosen', host_access: { kind: 'ssh_host' }, placement: { kind: 'host_process' }, ssh_password: 'old-password' };
    const ready = { runtime_key: target.id };
    const acquire = vi.fn(async () => ({ record: {}, release: vi.fn() }));
    const inspect = vi.fn(async (_target: unknown) => ({ runtime_target_available: true, runtime_control_status: { state: 'missing', reason_code: 'forward_unavailable' } }));
    const connect = productionBoundary('acquireEnvironmentManagementConnection', {
      loadDesktopPreferencesCached: async () => ({ saved_runtime_targets: [target] }),
      runtimePlacementBridgeRegistry: { get: () => null }, runtimeLifecycleTargetKey: () => 'chosen',
      runtimeLifecycleCoordinator: { active: () => null }, inspectRuntimePlacementTargetState: inspect,
      requireEnvironmentManagementAvailable, runtimePlacementReadyByTargetID: new Map([[target.id, ready]]),
      acquireRuntimePlacementBridgeForReadyRecord: acquire,
    }) as (id: string, owner: string, signal: undefined, password: string) => Promise<unknown>;
    await connect(target.id, 'gateway', undefined, ' temporary password ');
    expect(inspect.mock.calls[0]?.[0]).toMatchObject({ sshPassword: ' temporary password ' });
    expect(acquire).toHaveBeenCalledExactlyOnceWith(ready, 'gateway', undefined, ' temporary password ');
    expect(target.ssh_password).toBe('old-password');
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
