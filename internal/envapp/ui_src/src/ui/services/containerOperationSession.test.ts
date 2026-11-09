// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContainerOperationSession } from './containerOperationSession';
import type { ContainerOperation, ContainerPreflight } from './containerResourcesApi';
const api = vi.hoisted(() => ({ create: vi.fn(), subscribe: vi.fn(), get: vi.fn(), byRequest: vi.fn(), list: vi.fn() }));
vi.mock('./containerResourcesApi', async original => ({...await original<object>(), createContainerOperation: api.create, subscribeContainerOperation: api.subscribe, getContainerOperation: api.get, getContainerOperationByRequestID: api.byRequest, listContainerOperations: api.list}));
const operation = {operation_id: 'one', request_id: 'request-one', resource_kind: 'container_service', resource_identity: 'docker', state: 'running'} as ContainerOperation;
const cleanups: (() => void)[] = [];
function session() {
  const [environment, setEnvironment] = createSignal('one');
  const value = createRoot(dispose => {cleanups.push(dispose); return createContainerOperationSession({env_id: environment});});
  return {value, setEnvironment};
}
afterEach(() => {for (const cleanup of cleanups.splice(0)) cleanup(); vi.resetAllMocks();});
describe('container background operations', () => {
  it('accepts and completes work after the submitting view unsubscribes', async () => {
    const {value} = session();
    let accept!: (value: ContainerOperation) => void;
    api.create.mockReturnValue(new Promise(resolve => {accept = resolve;}));
    let publish!: (value: ContainerOperation) => void, finish!: () => void;
    let signal!: AbortSignal;
    api.subscribe.mockImplementation((_id, callback, observedSignal) => {publish = callback; signal = observedSignal; return new Promise<void>(resolve => {finish = resolve;});});
    const listener = vi.fn(); const remove = value.subscribe(listener);
    const admitted = value.submit({} as ContainerPreflight, {}, 'request-one'); remove(); accept(operation);
    await admitted; expect(signal.aborted).toBe(false);
    const task = value.track(operation);
    publish({...operation, state: 'succeeded'}); finish(); await task;
    expect(value.operations()[0].state).toBe('succeeded'); expect(value.revision()).toBe(1);
    expect(listener).not.toHaveBeenCalled(); expect(api.create).toHaveBeenCalledTimes(1); expect(api.subscribe).toHaveBeenCalledTimes(1);
  });
  it('recovers ambiguous admission with no view and no mutation replay', async () => {
    vi.useFakeTimers(); const {value} = session();
    api.create.mockRejectedValue(new Error('response lost'));
    api.byRequest.mockResolvedValue({...operation, state: 'succeeded'});
    await expect(value.submit({} as ContainerPreflight, {}, 'request-one')).rejects.toThrow('response lost');
    expect(value.admissions()[0].state).toBe('uncertain');
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.byRequest).toHaveBeenCalledExactlyOnceWith('request-one');
    expect(api.create).toHaveBeenCalledOnce(); expect(value.admissions()).toEqual([]);
    expect(value.operations()[0].state).toBe('succeeded'); vi.useRealTimers();
  });
  it('keeps simultaneous operations on separate streams', async () => {
    const {value} = session(); const completions: (() => void)[] = [];
    api.subscribe.mockImplementation((id, callback) => new Promise<void>(resolve => {completions.push(() => {callback({...operation, operation_id: id, state: 'succeeded'}); resolve();});}));
    const first = value.track(operation), second = value.track({...operation, operation_id: 'two'});
    completions.forEach(finish => finish()); await Promise.all([first, second]);
    expect(value.operations()).toHaveLength(2); expect(value.operations().every(item => item.state === 'succeeded')).toBe(true);
  });
  it('reconciles exact operation state after a disconnected stream without resubmitting', async () => {
    const {value} = session(); api.subscribe.mockRejectedValue(new Error('Disconnected')); api.get.mockResolvedValue({...operation, state: 'failed'});
    expect((await value.track(operation)).state).toBe('failed'); expect(api.get).toHaveBeenCalledExactlyOnceWith('one'); expect(api.create).not.toHaveBeenCalled();
  });
  it('fences delayed acceptance after the environment changes', async () => {
    const {value, setEnvironment} = session(); let accept!: (value: ContainerOperation) => void;
    api.create.mockReturnValue(new Promise(resolve => {accept = resolve;}));
    const admitted = value.submit({} as ContainerPreflight, {}, 'request-one'); const rejected = expect(admitted).rejects.toMatchObject({name: 'AbortError'});
    setEnvironment('two'); accept(operation); await rejected;
    expect(value.operations()).toEqual([]); expect(api.subscribe).not.toHaveBeenCalled();
  });
});
