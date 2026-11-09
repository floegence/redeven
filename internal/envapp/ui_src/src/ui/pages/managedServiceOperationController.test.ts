// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManagedServiceOperationController, type ManagedOperation } from './managedServiceOperationController';
const api = vi.hoisted(() => ({ events: vi.fn(), fetch: vi.fn() }));
vi.mock('../services/sessionHTTP', () => ({ readSessionEvents: api.events, isSessionEventAuthorizationError: (error: {status?: number}) => [401, 403, 423].includes(error?.status ?? 0) }));
vi.mock('../services/localApi', () => ({ fetchLocalApiJSON: api.fetch }));
const running: ManagedOperation = { operation_id: 'operation', service_id: 'service', action: 'uninstall', state: 'running', stage: 'stopping', progress_current: 1, progress_total: 3 };
const complete = {...running, state: 'succeeded', stage: 'completed', progress_current: 3};
const controllers: ReturnType<typeof createManagedServiceOperationController>[] = [];
function controller() { const value = createManagedServiceOperationController({streamFailedMessage: () => 'Observation unavailable',}); controllers.push(value); return value; }
afterEach(() => { controllers.forEach(item => item.dispose()); controllers.length = 0; vi.restoreAllMocks(); vi.resetAllMocks(); vi.useRealTimers(); });

describe('session service operation observation', () => {
  it('reconciles terminal state after stream loss using only the exact read route', async () => {
    api.events.mockImplementation(async function* () { yield {data: JSON.stringify(running)}; });
    api.fetch.mockResolvedValue(complete);
    const value = controller();
    expect(await value.track(running)).toEqual({...complete, observation_error: undefined});
    expect(api.fetch).toHaveBeenCalledExactlyOnceWith('/_redeven_proxy/api/managed-web-service-operations/operation', expect.objectContaining({method: 'GET'}));
  });
  it('retains running state across disconnects and prevents duplicate execution', async () => {
    vi.useFakeTimers();
    api.events.mockImplementation(async function* () { yield {data: JSON.stringify(running)}; });
    api.fetch.mockResolvedValueOnce(running).mockResolvedValueOnce(complete);
    const value = controller(); const task = value.track(running);
    await vi.advanceTimersByTimeAsync(0);
    value.clear(running.operation_id);
    expect(value.operationForService('service')?.state).toBe('running');
    expect(value.operationForService('service')?.observation_error).toBe('Observation unavailable');
    expect(() => value.begin('service', 'stop')).toThrow('already active');
    await vi.advanceTimersByTimeAsync(1000);
    expect((await task).state).toBe('succeeded');
    expect(api.fetch.mock.calls.every(([,init]) => init.method === 'GET')).toBe(true);
  });
  it('retains a pending submission when its presentation closes', () => {
    const value=controller(); const pending=value.begin('service','uninstall'); value.clear(pending.operation_id);
    expect(value.operationForService('service')?.state).toBe('submitting'); expect(() => value.begin('service','stop')).toThrow('already active');
  });
  it('shares one stream and hydrates replacement views after they unsubscribe', async () => {
    let finish!: (value: unknown) => void;
    api.events.mockImplementation(async function* () { await new Promise(resolve => {finish = resolve;}); yield {data: JSON.stringify(complete)}; });
    const value = controller(); const first = vi.fn(); const remove = value.subscribe({streamFailedMessage: () => '', onOperationUpdated: first});
    const task = value.track(running); remove();
    const second = vi.fn(); value.subscribe({streamFailedMessage: () => '', onOperationUpdated: second});
    expect(second).toHaveBeenCalledWith(running);
    expect(value.track({...running, stage: 'environment_check'})).toBe(task);
    finish(undefined); await task;
    expect(api.events).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenLastCalledWith({...complete, observation_error: undefined});
  });
  it('rejects foreign snapshots and never regresses terminal state', async () => {
    api.events.mockImplementation(async function* () { yield {data: JSON.stringify({...complete, service_id: 'other'})}; });
    api.fetch.mockResolvedValue(complete);
    const value = controller(); await value.track(running);
    expect(value.operationForService('other')).toBeNull();
    await value.track(running);
    expect(value.operationForService('service')?.state).toBe('succeeded');
  });
  it.each([403,404])('stops forbidden or missing observation (%s) without inventing an execution failure', async status => {
    api.events.mockImplementation(async function* () { yield* []; throw new Error('Disconnected'); });
    api.fetch.mockRejectedValue({status});
    const value = controller(); await expect(value.track(running)).rejects.toEqual({status}); value.clear(running.operation_id);
    expect(value.operationForService('service')).toMatchObject({state: 'running', observation_error: 'Observation unavailable'});
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });
  it('retires observation at the session boundary without cancelling the server operation', async () => {
    let finish!: (value: unknown) => void;
    api.events.mockImplementation(async function* () { await new Promise(resolve => {finish = resolve;}); yield {data: JSON.stringify(complete)}; });
    const value = controller(); const task = value.track(running); const rejected = expect(task).rejects.toMatchObject({name: 'AbortError'});
    value.dispose(); finish(undefined); await rejected;
    expect(value.operations()).toEqual([]); expect(api.fetch).not.toHaveBeenCalled();
  });
});
