import { describe, expect, it } from 'vitest';
import { buildLocalEnvironmentDesktopTarget, buildManagedLocalRuntimeDesktopTarget } from './desktopTarget';
import { runtimeLifecycleTargetKey } from './runtimeLifecycleCoordinator';
import { RuntimeSessionHandoff, runtimeSessionMatchesTarget } from './runtimeSessionHandoff';
import { testProviderBoundLocalEnvironment } from '../testSupport/desktopTestHelpers';

describe('managed Runtime session lifecycle', () => {
  it('matches the physical Local Runtime even when Cloud binding changes the window key', () => {
    const environment = testProviderBoundLocalEnvironment('https://redeven.test', 'env_demo');
    const target = buildLocalEnvironmentDesktopTarget(environment, { route: 'local_host' });
    expect(target.session_key).not.toBe(buildManagedLocalRuntimeDesktopTarget(environment.id, environment.label).session_key);
    const key = runtimeLifecycleTargetKey({ kind: 'local_host' }, { kind: 'host_process', runtime_root: '/tmp/redeven-local' });
    expect(runtimeSessionMatchesTarget({ runtime_target_key: key }, key)).toBe(true);
    expect(runtimeSessionMatchesTarget({ runtime_target_key: key }, runtimeLifecycleTargetKey(
      { kind: 'local_host' }, { kind: 'host_process', runtime_root: '/tmp/redeven-other' },
    ))).toBe(false);
  });

  it('isolates Local, SSH, WSL, and container windows by Runtime target', () => {
    const local = runtimeLifecycleTargetKey({ kind: 'local_host' }, { kind: 'host_process', runtime_root: '/tmp/runtime' });
    const container = runtimeLifecycleTargetKey({ kind: 'local_host' }, {
      kind: 'container_process', runtime_root: '/tmp/runtime', container_engine: 'docker', container_id: 'one',
      container_ref: 'one', container_label: 'one', bridge_strategy: 'exec_stream',
    });
    const wsl = runtimeLifecycleTargetKey({ kind: 'wsl_host', distribution_name: 'Ubuntu', linux_user: 'dev' },
      { kind: 'host_process', runtime_root: '/tmp/runtime' });
    const ssh = runtimeLifecycleTargetKey({ kind: 'ssh_host', ssh: {
      ssh_destination: 'devbox', ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10,
    } }, { kind: 'host_process', runtime_root: '/tmp/runtime' });
    expect(new Set([local, container, wsl, ssh]).size).toBe(4);
    expect([container, wsl, ssh].every(key => !runtimeSessionMatchesTarget({ runtime_target_key: local }, key))).toBe(true);
  });
});

describe('RuntimeSessionHandoff', () => {
  const state = { v: 1 as const, json: '{"draft":"unsent"}', files: [] };

  it('transfers state only between the source and an acknowledged new document', async () => {
    const handoff = new RuntimeSessionHandoff('old');
    const prepared = handoff.prepare(() => undefined, new AbortController().signal);
    expect(handoff.submit('new', handoff.ticket, state)).toBe(false);
    expect(handoff.submit('old', 'wrong', state)).toBe(false);
    expect(handoff.submit('old', handoff.ticket, state)).toBe(true);
    await prepared;
    expect(() => handoff.bind('old')).toThrow();
    handoff.bind('new');
    expect(handoff.read('old')).toBeNull();
    expect(handoff.read('new')).toEqual({ ticket: handoff.ticket, state });
    expect(handoff.restored('new', 'wrong')).toBe(false);
    expect(handoff.ready('new')).toBe(false);
    expect(handoff.restored('new', handoff.ticket)).toBe(true);
    expect(handoff.ready('new')).toBe(true);
    handoff.dispose();
    expect(handoff.read('new')).toBeNull();
  });

  it('fails preparation before Runtime mutation for invalid state or cancellation', async () => {
    const invalid = new RuntimeSessionHandoff('old');
    const waiting = invalid.prepare(() => undefined, new AbortController().signal);
    expect(invalid.submit('old', invalid.ticket, { v: 1, json: 'ok', files: [{ id: 'a', bytes: 'not bytes' }] })).toBe(false);
    await expect(waiting).rejects.toThrow('could not be transferred');

    const canceled = new RuntimeSessionHandoff('old');
    const controller = new AbortController();
    const pending = canceled.prepare(() => undefined, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('canceled');
    expect(canceled.read('old')).toBeNull();
  });
});
