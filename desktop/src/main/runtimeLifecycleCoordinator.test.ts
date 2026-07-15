import { describe, expect, it } from 'vitest';

import {
  RuntimeLifecycleCoordinator,
  runtimeLifecycleFingerprint,
  runtimeLifecycleTargetKey,
} from './runtimeLifecycleCoordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('RuntimeLifecycleCoordinator', () => {
  it('keys local host runtimes by their resolved physical state root', () => {
    const key = runtimeLifecycleTargetKey(
      { kind: 'local_host' },
      { kind: 'host_process', runtime_root: './runtime-state' },
    );
    const normalizedKey = runtimeLifecycleTargetKey(
      { kind: 'local_host' },
      { kind: 'host_process', runtime_root: './nested/../runtime-state' },
    );
    expect(key).toContain('local_host');
    expect(key).toContain('runtime-state');
    expect(normalizedKey).toBe(key);
    expect(() => runtimeLifecycleTargetKey(
      { kind: 'local_host' },
      { kind: 'host_process', runtime_root: '' },
    )).toThrow('Runtime state root is required');
  });

  it('separates SSH and container runtime identities', () => {
    const hostAccess = {
      kind: 'ssh_host' as const,
      ssh: {
        ssh_destination: 'devbox',
        ssh_port: 22,
        auth_mode: 'key_agent' as const,
        connect_timeout_seconds: 10,
        runtime_root: '~/.redeven',
        bootstrap_strategy: 'upload' as const,
        release_base_url: 'https://example.test',
      },
    };
    const host = runtimeLifecycleTargetKey(hostAccess, {
      kind: 'host_process',
      runtime_root: '~/.redeven',
      runtime_state_root: 'remote_default',
    });
    const container = runtimeLifecycleTargetKey(hostAccess, {
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'container-id',
      container_ref: 'dev-container',
      container_label: 'Dev Container',
      runtime_root: '~/.redeven',
      runtime_state_root: 'remote_default',
      bridge_strategy: 'exec_stream',
    });
    const replacementContainer = runtimeLifecycleTargetKey(hostAccess, {
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'replacement-container-id',
      container_ref: 'dev-container',
      container_label: 'Dev Container',
      runtime_root: '~/.redeven',
      runtime_state_root: 'remote_default',
      bridge_strategy: 'exec_stream',
    });
    expect(host).not.toBe(container);
    expect(replacementContainer).not.toBe(container);
  });

  it('coalesces identical operations and rejects incompatible operations', async () => {
    const coordinator = new RuntimeLifecycleCoordinator();
    const gate = deferred<string>();
    const targetKey = 'runtime-a';
    const fingerprint = runtimeLifecycleFingerprint({ intent: 'start', version: 'v1' });
    const first = coordinator.run({
      target_key: targetKey,
      intent: 'start',
      fingerprint,
      operation_key: 'operation-a',
      execute: () => gate.promise,
    });
    const duplicate = coordinator.run({
      target_key: targetKey,
      intent: 'start',
      fingerprint,
      operation_key: 'operation-a',
      execute: async () => 'unexpected',
    });
    expect(duplicate).toBe(first);
    await expect(coordinator.run({
      target_key: targetKey,
      intent: 'stop',
      fingerprint: runtimeLifecycleFingerprint({ intent: 'stop' }),
      operation_key: 'operation-a',
      execute: async () => undefined,
    })).rejects.toMatchObject({
      code: 'runtime_lifecycle_in_progress',
      active_operation: { intent: 'start', operation_key: 'operation-a' },
    });
    gate.resolve('ready');
    await expect(first).resolves.toBe('ready');
    expect(coordinator.active(targetKey)).toBeNull();
  });

  it('canonicalizes nested request parameters before comparing fingerprints', () => {
    expect(runtimeLifecycleFingerprint({
      intent: 'start',
      placement: { runtime_root: '/opt/redeven', kind: 'host_process' },
      host_access: { ssh: { ssh_port: 22, ssh_destination: 'devbox' }, kind: 'ssh_host' },
    })).toBe(runtimeLifecycleFingerprint({
      host_access: { kind: 'ssh_host', ssh: { ssh_destination: 'devbox', ssh_port: 22 } },
      placement: { kind: 'host_process', runtime_root: '/opt/redeven' },
      intent: 'start',
    }));
  });

  it('waits for ready-producing mutations but never waits through stop', async () => {
    const coordinator = new RuntimeLifecycleCoordinator();
    const startGate = deferred<void>();
    const start = coordinator.run({
      target_key: 'runtime-a',
      intent: 'restart',
      fingerprint: 'restart-v1',
      operation_key: 'operation-a',
      execute: () => startGate.promise,
    });
    const waiting = coordinator.waitForReadyMutation('runtime-a');
    startGate.resolve();
    await start;
    await expect(waiting).resolves.toMatchObject({ intent: 'restart' });

    const stopGate = deferred<void>();
    const stop = coordinator.run({
      target_key: 'runtime-a',
      intent: 'stop',
      fingerprint: 'stop-v1',
      operation_key: 'operation-a',
      execute: () => stopGate.promise,
    });
    await expect(coordinator.waitForReadyMutation('runtime-a')).rejects.toMatchObject({
      name: 'RuntimeLifecycleInProgressError',
      message: expect.stringContaining('Runtime is stopping'),
    });
    stopGate.resolve();
    await stop;
  });

  it('releases ownership after failure without allowing stale settlement to clear a new operation', async () => {
    const coordinator = new RuntimeLifecycleCoordinator();
    const firstGate = deferred<void>();
    const first = coordinator.run({
      target_key: 'runtime-a',
      intent: 'start',
      fingerprint: 'start-v1',
      operation_key: 'operation-a',
      execute: () => firstGate.promise,
    });
    firstGate.reject(new Error('failed'));
    await expect(first).rejects.toThrow('failed');

    const secondGate = deferred<void>();
    const second = coordinator.run({
      target_key: 'runtime-a',
      intent: 'stop',
      fingerprint: 'stop-v1',
      operation_key: 'operation-a',
      execute: () => secondGate.promise,
    });
    expect(coordinator.active('runtime-a')).toMatchObject({ intent: 'stop' });
    await Promise.resolve();
    expect(coordinator.active('runtime-a')).toMatchObject({ intent: 'stop' });
    secondGate.resolve();
    await second;
    expect(coordinator.active('runtime-a')).toBeNull();
  });

  it('releases ownership only after canceled task cleanup settles', async () => {
    const coordinator = new RuntimeLifecycleCoordinator();
    const cleanupGate = deferred<void>();
    const task = coordinator.run({
      target_key: 'runtime-a',
      intent: 'start',
      fingerprint: 'start-v1',
      operation_key: 'operation-a',
      execute: async (signal) => {
        try {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        } finally {
          await cleanupGate.promise;
        }
      },
    });

    coordinator.cancelByOperationKey('operation-a', new DOMException('Canceled.', 'AbortError'));
    expect(coordinator.active('runtime-a')).toMatchObject({ intent: 'start' });
    await expect(coordinator.run({
      target_key: 'runtime-a',
      intent: 'stop',
      fingerprint: 'stop-v1',
      operation_key: 'operation-a',
      execute: async () => undefined,
    })).rejects.toMatchObject({ code: 'runtime_lifecycle_in_progress' });

    cleanupGate.resolve();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    expect(coordinator.active('runtime-a')).toBeNull();
  });
});
