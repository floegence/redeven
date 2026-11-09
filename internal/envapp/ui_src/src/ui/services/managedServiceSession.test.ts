// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResourceCache } from '@floegence/floe-webapp-core/resource-cache';
import { createManagedServiceSession } from './managedServiceSession';
import type { EnvResourceCacheAccess } from './envResourceCache';
import type { ManagedInstallSubmission } from '../pages/EnvPortForwardsPage';
import type { ManagedOperation } from '../pages/managedServiceOperationController';
const api = vi.hoisted(() => ({fetch: vi.fn(), events: vi.fn()}));
vi.mock('./localApi', async original => ({...await original<object>(), fetchLocalApiJSON: api.fetch}));
vi.mock('./sessionHTTP', () => ({readSessionEvents: api.events, isSessionEventAuthorizationError: () => false}));
const cleanups: (() => void)[] = [];
const operation: ManagedOperation = {operation_id:'one',service_id:'service',action:'stop',state:'running',stage:'stopping',progress_current:1,progress_total:2};
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.resetAllMocks(); });
function session() {
  const cache = createResourceCache({storage:{get:async()=>null,set:async()=>{},remove:async()=>{},list:async()=>[]}});
  cleanups.push(() => cache.dispose());
  const owner = {cache, scope:'test',persistent:false};
  const [access, setAccess] = createSignal<EnvResourceCacheAccess>({phase:'ready',generation:1,owner});
  const value = createRoot(dispose=>{cleanups.push(dispose);return createManagedServiceSession({env_id:()=> 'environment',resourceCacheAccess:access},{streamFailedMessage:()=> 'Disconnected',});});
  return {value,access,setAccess,owner};
}
describe('managed service session ownership', () => {
  it('retains execution across connection generations belonging to the same owner', async () => {
    const {value,setAccess,owner} = session(); let complete!:()=>void; let signal!:AbortSignal;
    api.events.mockImplementation(async function* (_url, init) {signal=init.signal; await new Promise<void>(resolve=>{complete=resolve;});yield {data:JSON.stringify({...operation,state:'succeeded'})};});
    api.fetch.mockImplementation(async url => url.endsWith('/forwards') ? {forwards:[]} : {services:[]});
    const current=value.captureAuthority(); const task=value.operations.track(operation);
    setAccess({phase:'revalidating',generation:2,owner});
    expect(current()).toBe(true); expect(signal.aborted).toBe(false); expect(value.operations.operationForService('service')).toEqual(operation);
    setAccess({phase:'ready',generation:3,owner}); complete(); await task;
    expect(value.operations.operationForService('service')?.state).toBe('succeeded');
    expect(value.managedResource.data()).toEqual([]);
  });
  it('reconciles ambiguous admission by request ID and never repeats its POST', async () => {
    const {value} = session();
    api.fetch.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({...operation, request_id:'original'});
    const submission = value.operations.begin('service', 'stop');
    const accepted = await value.admit(submission, {request_id:'original', action:'stop'});
    expect(accepted.operation_id).toBe('one');
    expect(api.fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/_redeven_proxy/api/managed-web-services/service/operations', 'POST'],
      ['/_redeven_proxy/api/managed-web-service-operations/by-request/original', 'GET'],
    ]);
  });
  it('recovers a lost install receipt in the background without repeating creation', async () => {
    vi.useFakeTimers(); const {value} = session();
    const install = {...operation, action: 'install', request_id:'install-request', state:'succeeded'};
    api.fetch.mockImplementation(async url => url.includes('/install-requests/') ? {receipt:{service:{service_id:'service'},operation:install}} : url.endsWith('/forwards') ? {forwards:[]} : {services:[]});
    value.setInstallSubmissions([{requestID:'install-request',serviceID:'service',phase:'unknown'} as ManagedInstallSubmission]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(value.operations.operationForService('service')?.state).toBe('succeeded');
    expect(value.installSubmissions()[0].phase).toBe('accepted');
    expect(api.fetch.mock.calls.every(([,init]) => init.method === 'GET')).toBe(true);
    vi.useRealTimers();
  });
  it('retires data and observation on owner revocation without a cancel mutation', async () => {
    const {value,setAccess}=session();let complete!:()=>void;
    api.events.mockImplementation(async function* () {await new Promise<void>(resolve=>{complete=resolve;});yield {data:JSON.stringify({...operation,state:'succeeded'})};});
    const current=value.captureAuthority(); const task=value.operations.track(operation); const rejection=expect(task).rejects.toMatchObject({name:'AbortError'});
    setAccess({phase:'denied',generation:2}); complete(); await rejection;
    expect(current()).toBe(false);expect(value.operations.operations()).toEqual([]);expect(api.fetch).not.toHaveBeenCalled();
  });
});
