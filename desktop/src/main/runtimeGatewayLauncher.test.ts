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
import { DesktopWelcomeRuntimeHealthStore } from './desktopWelcomeRuntimeHealth';
import { buildDesktopWelcomeSnapshot } from './desktopWelcomeState';
import { runtimeGatewayAccessFixture } from '../testSupport/runtimeGatewayAccessFixture';
import { runtimeGatewayAccessPresentation } from '../shared/runtimeGatewayAccessPresentation';
import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import { desktopRuntimeControlStatusMissing } from '../shared/desktopRuntimePresence';
import { RuntimePlacementBridgeRegistry, type RuntimePlacementBridgeRecord } from './runtimePlacementBridgeRegistry';
import type { RuntimePlacementBridgeTermination } from './runtimePlacementBridgeSession';

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
  it('reuses the exact Env App bridge without credentials and retains it after the app closes', async () => {
    const target = runtimeGatewayAccessFixture('ssh').inputs.preferences.saved_runtime_targets[0];
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    let finish!: (value: RuntimePlacementBridgeTermination) => void;
    const closed = new Promise<RuntimePlacementBridgeTermination>(resolve => { finish = resolve; });
    const disconnect = vi.fn(async () => { finish({ kind: 'closed' }); });
    const record = { runtime_key: target.id, environment_id: target.id, target_id: `ssh:${target.id}`,
      session: { placement_target_id: target.id, closed, disconnect } } as unknown as RuntimePlacementBridgeRecord;
    const app = await registry.acquire(target.id, 'env-app', async () => record);
    const inspect = vi.fn();
    const connect = productionBoundary('acquireEnvironmentManagementConnection', {
      loadDesktopPreferencesCached: async () => ({ saved_runtime_targets: [{ ...target, ssh_password: '', ssh_password_configured: false }] }),
      runtimePlacementBridgeRegistry: registry, inspectRuntimePlacementTargetState: inspect,
    });
    const manager = new EnvironmentManagementConnections(connect, 'gateway');
    const request = { environment_id: target.id, dialog_token: 11 };
    expect(await manager.use(42, request, async current => current)).toBe(record);
    await app.release();
    expect(disconnect).not.toHaveBeenCalled();
    expect(await manager.use(42, request, async current => current)).toBe(record);
    expect(inspect).not.toHaveBeenCalled();
    manager.close(42, request.dialog_token);
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    expect(registry.size).toBe(0);
  });

  it.each(['ssh', 'ssh_container'] as const)('explicitly inspects %s with available OpenSSH authentication before requiring a password', async kind => {
    const original = runtimeGatewayAccessFixture(kind).inputs.preferences.saved_runtime_targets[0];
    if (original.host_access.kind !== 'ssh_host') throw new Error('SSH fixture required');
    const target = { ...original, host_access: { ...original.host_access, ssh: { ...original.host_access.ssh, auth_mode: 'password' } } };
    const startup = { pid: 123, started_at_unix_ms: 1000, runtime_service: {} };
    const ready = new Map();
    const probe = vi.fn(async () => ({ status: 'ready', startup }));
    const release = vi.fn(async () => undefined);
    const resolver = vi.fn(() => ({ release }));
    const resolve = vi.fn(async () => ({ status: 'running', placement: target.placement }));
    const executor = { run: vi.fn(async () => ({ stdout: '' })), release };
    const inspect = productionBoundary('inspectRuntimePlacementTargetState', {
      runtimePlacementInspectionFromBridge: async () => null, runtimePlacementMaintenanceByTargetID: new Map(),
      runtimePlacementReadyByTargetID: ready, desktopRuntimeControlStatusMissing,
      sshDetailsFromRuntimePlacement: () => ({ runtime_root: '/runtime' }), sshDesktopSessionKey: () => target.id,
      probeManagedSSHRuntimeStatus: probe, desktopSSHTransportManager: {}, resolveSSHRuntimeReleaseTag: () => 'fixture',
      desktopRuntimePlacementStateRoot: () => '/runtime/state', runtimePlacementMaintenanceForRuntimeService: () => undefined,
      runtimeServiceAllowsOpenAttempt: () => true, providerRuntimeLinkTargetIDForRuntimeTarget: () => `ssh:${target.id}`,
      sshRuntimeReadyByKey: new Map(), clearSSHRuntimeReadyState: vi.fn(),
      runtimeContainerResolver: resolver, resolveRuntimeContainerPlacement: resolve, runtimeHostExecutor: () => executor,
      containerRuntimeProbeCommand: vi.fn(), parseManagedSSHRuntimeProbeResult: () => ({ status: 'ready', binary_path: '/runtime/redeven' }),
      containerRuntimeDaemonStatusCommand: vi.fn(), parseLaunchReport: () => ({ status: 'ready', startup }),
      clearRuntimePlacementTargetRecords: vi.fn(), runtimeControlReasonCodeForContainerResolution: (status: string) => status,
    });
    const input = { targetID: target.id, environmentID: target.id, label: target.label,
      hostAccess: target.host_access, placement: target.placement, allowUnsavedSSHAuthentication: true };
    expect(await inspect(input)).toMatchObject({ running: true, runtime_target_available: true });
    expect(ready.has(target.id)).toBe(true);
    if (kind === 'ssh') {
      expect(probe).toHaveBeenCalledWith(expect.objectContaining({ sshPassword: undefined, sshCredentialScope: target.id }));
      probe.mockResolvedValueOnce({ status: 'failed', message: 'Authentication rejected', failure: { code: 'ssh_authentication_failed' } } as never);
    } else {
      expect(resolver).toHaveBeenCalledWith(target.host_access, target.id, undefined, undefined);
      expect(release).toHaveBeenCalledTimes(2);
      resolve.mockResolvedValueOnce({ status: 'auth_required', message: 'Authentication rejected' } as never);
    }
    expect(await inspect(input)).toMatchObject({ runtime_control_status: { state: 'missing', reason_code: 'auth_required' } });
  });

  it('preserves omission of a saved password when acquiring a bridge over a reusable SSH transport', async () => {
    const target = runtimeGatewayAccessFixture('ssh').inputs.preferences.saved_runtime_targets[0];
    const start = vi.fn(async () => ({}));
    const acquire = productionBoundary('acquireRuntimePlacementBridgeForReadyRecord', {
      runtimePlacementBridgeRegistry: { acquire: (_id: string, _owner: string, create: (signal: AbortSignal) => unknown) => create(new AbortController().signal) },
      loadDesktopPreferencesCached: async () => ({}), savedRuntimePlacementSSHPassword: () => '',
      startRuntimePlacementBridgeSession: start, desktopSSHTransportManager: {},
      bridgeRecordFromSession: vi.fn(), DEFAULT_DESKTOP_SSH_RUNTIME_ROOT: '~/.redeven',
    });
    const ready = { runtime_key: target.id, environment_id: target.id, host_access: target.host_access, placement: target.placement };
    await acquire(ready, 'gateway:42:11');
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ ssh_password: undefined, ssh_credential_scope: target.id }));
    await acquire(ready, 'gateway:42:12', undefined, ' temporary password ');
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ ssh_password: ' temporary password ' }));
  });

  it.each(['unknown', 'failed', 'online'] as const)('does not grant management authority or invent stopped state from %s health alone', state => {
    const fixture = runtimeGatewayAccessFixture('ssh');
    const target = fixture.inputs.preferences.saved_runtime_targets[0];
    const health: DesktopRuntimeHealth = { status: state === 'online' ? 'online' : 'offline', source: 'ssh_runtime_probe',
      checked_at_unix_ms: state === 'unknown' ? 0 : Date.now(), freshness: state === 'online' ? 'fresh' : state,
      observed_runtime_control_status: state === 'failed' ? { state: 'missing', reason_code: 'auth_required', message: 'Previous diagnosis' } : { state: 'available' },
    };
    const entry = buildDesktopWelcomeSnapshot({ ...fixture.inputs, managedRuntimePresenceByTargetID: {},
      savedRuntimeTargetHealth: { [target.id]: health },
    }).environments.find(entry => entry.id === target.id)!;
    expect(entry.provider_runtime_link_target?.runtime_control_status).toMatchObject({ state: 'missing' });
    expect(entry.provider_runtime_link_target?.runtime_control_status).not.toMatchObject({ reason_code: 'not_started' });
    expect(entry.provider_runtime_link_target?.can_connect_cloud).toBe(false);
    if (state === 'failed') expect(entry.provider_runtime_link_target?.runtime_control_status).toMatchObject({ reason_code: 'unverified' });
  });
  it.each(['ssh', 'ssh_container'] as const)('uses the explicit %s startup password through readiness verification without saving it', async kind => {
    const target = runtimeGatewayAccessFixture(kind).inputs.preferences.saved_runtime_targets[0];
    const preferences = { saved_runtime_targets: [target] };
    const before = JSON.stringify(preferences);
    const savedPassword = vi.fn(() => 'saved-password');
    const prepareContainer = vi.fn(async () => ({ running: true, placement: target.placement }));
    const ensureSSH = vi.fn(async () => ({ startup: {} }));
    const ensureContainer = vi.fn(async () => ({ startup: {}, placement: target.placement }));
    const verify = vi.fn(async () => undefined);
    const context = {
      desktopRuntimeTargetID: () => target.id, runtimeLifecycleTargetKey: () => target.id,
      launcherOperations: { get: () => ({ action: 'start_environment_runtime', started_at_unix_ms: 1 }), finishCurrentAttempt: vi.fn() },
      _initializeRuntimeLifecycleOperation: vi.fn(), updateRuntimeLifecycleOperation: vi.fn(),
      runtimePackageProgressReporter: () => vi.fn(), runtimeLifecyclePhaseFromPlacement: vi.fn(), sshRuntimeLifecyclePhase: vi.fn(),
      loadDesktopPreferencesCached: async () => preferences, savedRuntimePlacementSSHPassword: savedPassword,
      sshDetailsFromRuntimePlacement: () => ({ bootstrap_strategy: 'desktop_upload' }), sshDesktopSessionKey: () => target.id,
      prepareRuntimeContainerForLifecycle: prepareContainer, ensureManagedSSHRuntimeReady: ensureSSH, ensureRuntimePlacementReady: ensureContainer,
      verifyManagedRuntimeLifecycleAccess: verify, desktopSSHTransportManager: {}, resolveSSHRuntimeReleaseTag: () => 'fixture',
      desktopRuntimePlacementStateRoot: () => '/runtime/state', compact: (value?: string) => value?.trim() ?? '',
      process: { env: {} }, desktopRuntimePackageCacheRoot: () => '/cache', PUBLIC_REDEVEN_RELEASE_BASE_URL: 'https://example.test/releases',
      providerRuntimeLinkTargetIDForRuntimeTarget: () => `ssh:${target.id}`,
      runtimePlacementReadyByTargetID: new Map(), sshRuntimeReadyByKey: new Map(), runtimeRestartWindows: new Map(),
      refreshWelcomeRuntimeHealthForEnvironment: vi.fn(async () => undefined), completeRuntimeLifecycleWorkflowProgress: vi.fn(),
      scheduleCurrentLauncherOperationRemoval: vi.fn(), retireSupersededEnvironmentOperations: vi.fn(),
      clearReinstallTargetRequiredForEnvironment: vi.fn(async () => undefined), resetLauncherIssueState: vi.fn(), broadcastDesktopWelcomeSnapshots: vi.fn(),
      launcherActionSuccess: (outcome: string) => ({ ok: true, outcome }), desktopFailureFromError: (error: unknown) => { throw error; },
    };
    const run = productionBoundary('executeDirectManagedEnvironmentLifecycle', context);
    expect(await run({ request: { kind: 'start_environment_runtime', ssh_password: ' temporary password ' },
      environment_id: target.id, label: target.label, host_access: target.host_access, placement: target.placement,
      operation: 'start', operation_key: 'startup', operation_owner: 'runtime_lifecycle', lifecycle_signal: new AbortController().signal,
    })).toEqual({ ok: true, outcome: 'started_environment_runtime' });
    if (kind === 'ssh') expect(ensureSSH).toHaveBeenCalledWith(expect.objectContaining({ sshPassword: ' temporary password ', sshCredentialScope: target.id }));
    else {
      expect(prepareContainer).toHaveBeenCalledWith(target.host_access, target.placement, target.id, expect.objectContaining({ sshPassword: ' temporary password ' }));
      expect(ensureContainer).toHaveBeenCalledWith(expect.objectContaining({ ssh_password: ' temporary password ', ssh_credential_scope: target.id }));
    }
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ sshPassword: ' temporary password ', environmentID: target.id }));
    expect(savedPassword).not.toHaveBeenCalled();
    expect(JSON.stringify(preferences)).toBe(before);
    expect(JSON.stringify(context.launcherOperations.finishCurrentAttempt.mock.calls)).not.toContain('temporary password');
  });
  it.each(['ssh', 'ssh_container'] as const)('preserves unsaved-password %s authentication through the production probe and snapshot', async kind => {
    const fixture = runtimeGatewayAccessFixture(kind);
    const original = fixture.inputs.preferences.saved_runtime_targets[0];
    if (original.host_access.kind !== 'ssh_host') throw new Error('SSH fixture required');
    const target = { ...original, ssh_password: '', ssh_password_configured: false,
      host_access: { ...original.host_access, ssh: { ...original.host_access.ssh, auth_mode: 'password' as const } } };
    const inspect = productionBoundary('inspectRuntimePlacementTargetState', {
      runtimePlacementInspectionFromBridge: async () => null, runtimePlacementMaintenanceByTargetID: new Map(),
      desktopRuntimeControlStatusMissing,
    });
    const health = productionBoundary('runtimeTargetHealthFromState', {
      runtimeTargetProbeSource: () => 'ssh_runtime_probe',
      runtimeTargetOfflineReasonCode: (state: { runtime_control_status: { reason_code: string } }) => state.runtime_control_status.reason_code,
      offlineRuntimeHealth: (source: string, offline_reason_code: string, offline_reason: string) => ({
        status: 'offline', checked_at_unix_ms: Date.now(), source, offline_reason_code, offline_reason,
      }),
    });
    const probe = productionBoundary('probeSavedRuntimeTargetHealth', {
      inspectSavedRuntimeTargetState: () => inspect({ targetID: target.id, environmentID: target.id,
        hostAccess: target.host_access, placement: target.placement }),
      runtimeTargetHealthFromState: health, runtimeTargetPresenceFromState: vi.fn(),
    });
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
    await store.refresh([{ key: target.id, environment_id: target.id, slot: 'runtime_target', auto_refresh_enabled: false,
      checking_health: { status: 'offline', checked_at_unix_ms: 0, source: 'ssh_runtime_probe' },
      probe: () => probe(target) as Promise<{ health: DesktopRuntimeHealth }>,
    }]);
    const snapshot = buildDesktopWelcomeSnapshot({ ...fixture.inputs, ...store.snapshot(),
      preferences: { ...fixture.inputs.preferences, saved_runtime_targets: [target] } });
    const entry = snapshot.environments.find(entry => entry.id === target.id)!;
    expect(store.snapshot().managedRuntimePresenceByTargetID).toEqual({});
    expect(entry.runtime_health.offline_reason_code).toBe('auth_required');
    expect(entry.provider_runtime_link_target?.runtime_control_status).toMatchObject({ state: 'missing', reason_code: 'auth_required' });
    expect(entry.provider_runtime_link_target?.can_connect_cloud).toBe(false);
    expect(runtimeGatewayAccessPresentation(entry)).toMatchObject({ phase: 'connection_required' });
  });
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
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ allowUnsavedSSHAuthentication: true }));
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
  it.each(['not_started', 'container_not_running'] as const)('reports authenticated %s before attempting enrollment again without its password', async reason => {
    const target = { id: 'chosen', label: 'Chosen', host_access: { kind: 'ssh_host' }, placement: { kind: 'host_process' } };
    const acquire = vi.fn();
    const connect = productionBoundary('acquireEnvironmentManagementConnection', {
      loadDesktopPreferencesCached: async () => ({ saved_runtime_targets: [target] }),
      runtimePlacementBridgeRegistry: { get: () => null }, runtimeLifecycleTargetKey: () => 'chosen',
      runtimeLifecycleCoordinator: { active: () => null }, RuntimeControlError,
      inspectRuntimePlacementTargetState: async () => ({ runtime_target_available: reason === 'not_started', running: false,
        runtime_control_status: { state: 'missing', reason_code: reason, message: 'Runtime is stopped.' } }),
      requireEnvironmentManagementAvailable, runtimePlacementReadyByTargetID: new Map(), acquireRuntimePlacementBridgeForReadyRecord: acquire,
    }) as (id: string, owner: string, signal?: AbortSignal, password?: string) => Promise<unknown>;
    await expect(connect(target.id, 'gateway:42:10', undefined, 'temporary password'))
      .rejects.toMatchObject({ code: 'runtime_not_started' });
    expect(acquire).not.toHaveBeenCalled();
    if (reason === 'not_started') await expect(connect(target.id, 'settings:42:10')).resolves.toBeNull();
    else await expect(connect(target.id, 'settings:42:10')).rejects.toMatchObject({ code: 'RUNTIME_CONTROL_UNREACHABLE' });
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
