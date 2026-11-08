import { expect, it, vi } from 'vitest';
import { resolveRunningSettingsTarget } from './runtimeSettingsTarget';
import type { RuntimeFlowerRequest } from '../shared/runtimeFlowerIPC';
it.each(['GET', 'PUT', 'POST'] as const)('rejects a stopped or replacement target before %s dispatch', async method => {
  const request: RuntimeFlowerRequest = { method, path: '/_redeven_proxy/api/settings', environment_id: 'env-a', expected_runtime_started_at_unix_ms: 10 };
  const running = vi.fn(async () => null as { record: { environment_id: string; startup: { started_at_unix_ms: number } } } | null);
  const dispatch = vi.fn();
  const send = async () => dispatch(await resolveRunningSettingsTarget(request, running));
  await expect(send()).rejects.toThrow('unavailable');
  running.mockResolvedValue({ record: { environment_id: 'env-b', startup: { started_at_unix_ms: 10 } } });
  await expect(send()).rejects.toThrow('unavailable');
  running.mockResolvedValue({ record: { environment_id: 'env-a', startup: { started_at_unix_ms: 11 } } });
  await expect(send()).rejects.toThrow('changed'); expect(dispatch).not.toHaveBeenCalled();
  running.mockResolvedValue({ record: { environment_id: 'env-a', startup: { started_at_unix_ms: 10 } } });
  await send(); expect(dispatch).toHaveBeenCalledTimes(1);
  expect(running).toHaveBeenLastCalledWith('env-a');
});

it('looks up the explicit running owner independently of the default selection', async () => {
  const a = { record: { environment_id: 'a', startup: { started_at_unix_ms: 10 } } };
  const b = { record: { environment_id: 'b', startup: { started_at_unix_ms: 20 } } };
  const records = new Map([['a', a], ['b', b]]);
  const lookup = vi.fn(async (id: string) => records.get(id) ?? null);
  expect(await resolveRunningSettingsTarget({ method: 'POST', path: '/_redeven_proxy/api/browser/installation', environment_id: 'a', expected_runtime_started_at_unix_ms: 10 }, lookup)).toBe(a);
  expect(lookup).toHaveBeenCalledWith('a');
  records.delete('a');
  await expect(resolveRunningSettingsTarget({ method: 'GET', path: '/_redeven_proxy/api/settings', environment_id: 'a' }, lookup)).rejects.toThrow('unavailable');
});
