import {afterEach,describe,expect,it,vi} from 'vitest';
import {bindSessionHTTP} from './sessionHTTP';
import type {ManagedEntrancePreparationRequest} from '../../../../../../desktop/src/shared/desktopShellWebServiceWindowIPC';

afterEach(()=>vi.unstubAllGlobals());
describe('Desktop entrance preparation over the existing environment lifecycle',()=>{
 it('uses the bound transport and forwards explicit refresh',async()=>{
  let listener!: (request:ManagedEntrancePreparationRequest)=>Promise<unknown>;
  const release=vi.fn();
  vi.stubGlobal('window',{redevenDesktopShell:{onManagedEntranceRequest:(value:typeof listener)=>{listener=value;return release;}}});
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({ok:true,data:{state:'ready'}}),{headers:{'Content-Type':'application/json'}}));
  const dispose=bindSessionHTTP({fetch,events:async function*(){}});
  expect(await listener({request_id:'request',service_id:'mws-one',refresh:true})).toEqual({state:'ready'});
  expect(fetch.mock.calls[0][0]).toBe('/_redeven_proxy/api/managed-web-services/mws-one/open-session');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({request_id:'desktop-request',refresh:true});
  dispose();expect(release).toHaveBeenCalledOnce();
 });
 it('aborts cancelled and disposed observers without a new transport',async()=>{
  let listener!: (request:ManagedEntrancePreparationRequest)=>Promise<unknown>;
  vi.stubGlobal('window',{redevenDesktopShell:{onManagedEntranceRequest:(value:typeof listener)=>{listener=value;return ()=>{};}}});
  const signals:AbortSignal[]=[];
  const fetch=vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
   const signal=init!.signal!;signals.push(signal);signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  }));
  const dispose=bindSessionHTTP({fetch,events:async function*(){}});
  const first=listener({request_id:'first',service_id:'mws-one',refresh:true});
  const rejected=expect(first).rejects.toMatchObject({name:'AbortError'});
  await listener({request_id:'first',service_id:'mws-one',refresh:true,cancel:true});await rejected;
  const second=listener({request_id:'second',service_id:'mws-one',refresh:true});
  const disposed=expect(second).rejects.toMatchObject({name:'AbortError'});dispose();await disposed;
  expect(signals.every(signal=>signal.aborted)).toBe(true);expect(fetch).toHaveBeenCalledTimes(2);
 });
});
