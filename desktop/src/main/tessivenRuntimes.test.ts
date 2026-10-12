import { expect, it, vi } from 'vitest';
import { TessivenRuntimes, withExecutionRuntimePath, type TessivenRuntimePath } from './tessivenRuntimes';
import type { HostMessage } from './tessivenHost';
const permissions = { read: true, write: true, execute: true, admin: true };
function fixture() {
  const path: TessivenRuntimePath = {
    target: {
      runtime_ref: 'gateway:exact',
      generation: '2',
      identity: 'runtime-verified',
      name: 'Production',
      source: 'gateway',
      location: 'current_device',
      observed_at: new Date().toISOString(),
      registered: true,
      online: true,
      connected: false,
      authenticated: false,
      actions: ['status', 'connect'],
    },
    connect: vi.fn(async () => ({ status: 'authentication_required' })),
    inspect: vi.fn(async () => ({ status: 'available' })),
  };
  const service = new TessivenRuntimes(async () => ({
    paths: [path],
    sources: [
      { source: 'gateway', location: 'current_device', state: 'available' },
    ],
  }));
  const message = (action: string): HostMessage => ({
    id: crypto.randomUUID(),
    kind: 'runtime',
    scope: {
      user_public_id: 'user_local',
      floe_app: 'com.floegence.redeven.agent',
    },
    permissions,
    request: {
      runtime_ref: 'gateway:exact',
      generation: '2',
      identity: 'runtime-verified',
      request_id: 'one-shot',
      action,
    },
  });
  return { service, path, message };
}
it('discovers without acquiring a session or starting a process', async () => {
  const { service, path, message } = fixture();
  expect(
    await service.execute(message('directory'), new AbortController().signal),
  ).toMatchObject({ targets: [{ connected: false, authenticated: false }] });
  expect(path.connect).not.toHaveBeenCalled();
});
it('requires current path generation and verified identity', async () => {
  const { service, path, message } = fixture();
  for (const delta of [{ generation: '1' }, { identity: 'replacement' }]) {
    await expect(
      service.execute(
        {
          ...message('connect'),
          request: { ...message('connect').request, ...delta },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'TESSIVEN_RESOURCE_CONFLICT' });
  }
  expect(path.connect).not.toHaveBeenCalled();
});
it('never converts Gateway access rights into lifecycle rights', async () => {
  const { service, message } = fixture();
  await expect(
    service.execute(message('stop'), new AbortController().signal),
  ).rejects.toMatchObject({ code: 'TESSIVEN_OPERATION_UNAVAILABLE' });
  await expect(
    service.execute(
      { ...message('connect'), permissions: { ...permissions, write: false } },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'TESSIVEN_PERMISSION_DENIED' });
});
it('does not replay a connection with an unknown outcome', async () => {
  const { service, path, message } = fixture();
  vi.mocked(path.connect).mockRejectedValue(new Error('unknown'));
  await expect(
    service.execute(message('connect'), new AbortController().signal),
  ).rejects.toThrow('unknown');
  expect(path.connect).toHaveBeenCalledTimes(1);
});
it('rejects ambiguous registered references without acquiring either path', async () => {
  const { path, message } = fixture();
  const service = new TessivenRuntimes(async () => ({
    paths: [path, { ...path }],
    sources: [],
  }));
  await expect(
    service.execute(message('connect'), new AbortController().signal),
  ).rejects.toMatchObject({ code: 'TESSIVEN_TARGET_UNAVAILABLE' });
  expect(path.connect).not.toHaveBeenCalled();
});

it('keeps the current-device local Runtime as one actionable owner path', async () => {
  const { path, message } = fixture();
  path.target.runtime_ref = 'local:local';
  path.target.source = 'desktop';
  path.target.actions.push('restart');
  path.lifecycle = vi.fn(async () => ({ runtime_ref: 'local:local', status: 'handoff_required' }));
  const service = new TessivenRuntimes(async () => ({
    paths: withExecutionRuntimePath(path, true), sources: [],
  }));
  const directory = await service.execute(message('directory'), new AbortController().signal);
  expect(directory).toMatchObject({ targets: [path.target] });
  expect((directory as { targets: unknown[] }).targets).toHaveLength(1);
  for (const action of ['status', 'restart']) {
    await service.execute({ ...message(action), request: { ...message(action).request, runtime_ref: 'local:local' } }, new AbortController().signal);
  }
  expect(path.inspect).toHaveBeenCalledOnce();
  expect(path.lifecycle).toHaveBeenCalledOnce();
});

it('retains a distinct execution alias for a connected remote owner', async () => {
  const { path, message } = fixture();
  path.target.runtime_ref = 'ssh:exact';
  path.target.source = 'desktop';
  path.inspect = vi.fn(async () => ({ runtime_ref: 'ssh:exact', status: 'connected' }));
  const service = new TessivenRuntimes(async () => ({
    paths: withExecutionRuntimePath(path, true), sources: [],
  }));
  const directory = await service.execute(message('directory'), new AbortController().signal);
  expect(directory).toMatchObject({ targets: [
    { runtime_ref: 'local:local', location: 'execution_machine', generation: '2', identity: 'runtime-verified' },
    { runtime_ref: 'ssh:exact', location: 'current_device', generation: '2', identity: 'runtime-verified' },
  ] });
  expect(await service.execute({ ...message('status'), request: { ...message('status').request, runtime_ref: 'local:local' } }, new AbortController().signal)).toEqual({ runtime_ref: 'local:local', status: 'connected' });
  expect(path.inspect).toHaveBeenCalledOnce();
  expect(withExecutionRuntimePath(path, false)).toEqual([path]);
});
