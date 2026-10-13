import { describe, expect, it } from 'vitest';
import { mixedEnvironmentFixture } from '../testSupport/mixedEnvironmentFixture';
import { runtimeGatewayAccessPresentation } from './runtimeGatewayAccessPresentation';
import type { DesktopEnvironmentEntry } from './desktopLauncherIPC';
import { runtimeGatewayAccessFixture } from '../testSupport/runtimeGatewayAccessFixture';
import { runtimeGatewayBackgroundProbeFixture } from '../testSupport/runtimeGatewayBackgroundProbeFixture';

function runtime(kind: 'local_environment' | 'ssh_environment' | 'wsl_environment' = 'ssh_environment') {
  const entry = mixedEnvironmentFixture({ linkKind: kind }).snapshot.environments.find(item => item.kind === kind)!;
  return { ...entry, runtime_service: { ...entry.runtime_service!, compatibility: 'compatible' as const, capabilities: {
    ...entry.runtime_service!.capabilities!, runtime_gateway: { supported: true, bind_method: 'runtime_control_v2' },
  } } };
}

describe('managed Runtime Gateway access', () => {
  it.each(['local', 'ssh', 'wsl', 'local_container', 'ssh_container'] as const)('retains the completed %s diagnosis through real background probes without restoring live control', async kind => {
    for (const state of ['ready', 'connection_required', 'stopped', 'control_missing', 'update_required', 'management_unavailable'] as const) {
      const f = await runtimeGatewayBackgroundProbeFixture(kind, state);
      const completed = runtimeGatewayAccessPresentation(f.snapshot().environments[0])!;
      const check = f.beginProbe();
      const environment = check.checking.environments[0];
      expect(environment.provider_runtime_link_target?.runtime_control_status.state).toBe('missing');
      expect(f.store.snapshot().managedRuntimePresenceByTargetID[environment.provider_runtime_link_target!.id]).toBeUndefined();
      expect(runtimeGatewayAccessPresentation(environment), `${kind}/${state}`).toEqual({ ...completed, revalidating: true });
      expect(runtimeGatewayAccessPresentation((await check.finish()).environments[0])).toEqual(completed);
    }
  });
  it.each(['local', 'ssh', 'wsl', 'local_container', 'ssh_container'] as const)('projects real %s snapshots through every preparation state', kind => {
    for (const [state, phase] of [['unknown', 'check_required'], ['stopped', 'not_started'], ['control_missing', 'control_missing'],
      ['ready', 'ready'], ['connection_required', 'connection_required'], ['update_required', 'update_required'], ['management_unavailable', 'management_unavailable']] as const) {
      expect(runtimeGatewayAccessPresentation(runtimeGatewayAccessFixture(kind, state).environment)?.phase, `${kind}/${state}`).toBe(phase);
    }
  });
  it.each(['local_environment', 'ssh_environment', 'wsl_environment'] as const)('keeps %s discoverable before its first probe', kind => {
    const entry = runtime(kind);
    expect(runtimeGatewayAccessPresentation({ ...entry, runtime_service: undefined,
      runtime_health: { ...entry.runtime_health, freshness: 'unknown' } })).toMatchObject({ phase: 'check_required' });
  });
  it.each(['local_environment', 'ssh_environment'] as const)('supports containers through their actual %s owner', kind => {
    const entry = runtime(kind);
    expect(runtimeGatewayAccessPresentation({ ...entry, managed_runtime_placement: {
      kind: 'container_process', container_engine: 'docker', container_id: 'example', container_ref: 'example', container_label: 'Example', bridge_strategy: 'exec_stream', runtime_root: '/runtime',
    } })).toMatchObject({ phase: 'ready' });
  });
  it('requires both a current control channel and the published Gateway bind method', () => {
    const entry = runtime();
    expect(runtimeGatewayAccessPresentation(entry)).toMatchObject({ phase: 'ready' });
    expect(runtimeGatewayAccessPresentation({ ...entry, provider_runtime_link_target: {
      ...entry.provider_runtime_link_target!, runtime_control_status: { state: 'missing', reason_code: 'not_reported', message: 'Missing' },
    } })).toMatchObject({ phase: 'control_missing', recovery: 'restart' });
    expect(runtimeGatewayAccessPresentation({ ...entry, runtime_service: { ...entry.runtime_service,
      capabilities: { ...entry.runtime_service.capabilities, runtime_gateway: { supported: true, bind_method: 'future' } },
    } })).toMatchObject({ phase: 'unsupported', recovery: 'update' });
  });
  it('offers explicit startup only for an observed stopped target', () => {
    const entry = runtime();
    expect(runtimeGatewayAccessPresentation({ ...entry, runtime_service: undefined,
      runtime_health: { ...entry.runtime_health, freshness: 'fresh', status: 'offline', offline_reason_code: 'not_started' },
      provider_runtime_link_target: { ...entry.provider_runtime_link_target!, runtime_running: false,
        runtime_control_status: { state: 'missing', reason_code: 'not_started', message: 'Stopped' } },
    })).toMatchObject({ phase: 'not_started', recovery: 'start' });
  });
  it('keeps unreachable management distinct from stopped Runtime and allows retry', () => {
    const entry = runtime();
    for (const reason_code of ['auth_required', 'container_engine_unavailable'] as const) {
      expect(runtimeGatewayAccessPresentation({ ...entry, provider_runtime_link_target: {
        ...entry.provider_runtime_link_target!, runtime_control_status: { state: 'missing', reason_code, message: 'Unavailable' },
      } })).toMatchObject({ phase: 'management_unavailable', recovery: 'refresh' });
    }
  });
  it.each(['ssh', 'wsl', 'local_container', 'ssh_container'] as const)('offers connection for an observed running %s without a Desktop bridge', kind => {
    const entry = runtimeGatewayAccessFixture(kind).environment;
    const pending = { ...entry, provider_runtime_link_target: { ...entry.provider_runtime_link_target!,
      runtime_control_status: { state: 'missing' as const, reason_code: 'forward_unavailable' as const, message: 'Connect the Desktop bridge' },
    } };
    expect(runtimeGatewayAccessPresentation(pending)).toMatchObject({ phase: 'connection_required' });
    expect(runtimeGatewayAccessPresentation({ ...pending, runtime_operations: { ...pending.runtime_operations,
      open: { ...pending.runtime_operations.open, availability: 'blocked' },
    } })).toMatchObject({ phase: 'management_unavailable' });
  });
  it('prioritizes required updates independently of operation state', () => {
    const entry = runtime();
    const outdated = { ...entry, runtime_operations: { ...entry.runtime_operations,
      update: { ...entry.runtime_operations.update, package_state: { state: 'outdated' as const, current_version: 'v1', target_version: 'v2' } },
    } };
    expect(runtimeGatewayAccessPresentation(outdated)).toMatchObject({ phase: 'update_required', recovery: 'update' });
  });
  it('never manufactures management from a route, window or presentation kind', () => {
    const entry = runtime();
    for (const kind of ['external_local_ui', 'provider_environment', 'gateway_environment'] as const) {
      expect(runtimeGatewayAccessPresentation({ ...entry, kind } as DesktopEnvironmentEntry)).toBeUndefined();
    }
    expect(runtimeGatewayAccessPresentation({ ...entry, managed_runtime_host_access: undefined })).toBeUndefined();
    expect(runtimeGatewayAccessPresentation({ ...entry, managed_runtime_placement: undefined })).toBeUndefined();
  });
});
