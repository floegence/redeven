// @vitest-environment jsdom
import {createRoot,createSignal} from 'solid-js';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createServiceTemplateMarket} from './serviceTemplateMarket';
const api=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../services/localApi',()=>({fetchLocalApiJSON:api.request}));
let dispose:()=>void;
afterEach(()=>{dispose?.();api.request.mockReset();});
describe('passive template market',()=>{
  it('loads cache first, retains it after failure, and refreshes without changing caller selection',async()=>{
    const items=[{template_id:'first'}];
    api.request.mockResolvedValueOnce({items,stale:true}).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({items:[...items,{template_id:'second'}],stale:false});
    let market!:ReturnType<typeof createServiceTemplateMarket>;
    const [selected]=createSignal('first');
    createRoot(d=>{dispose=d;market=createServiceTemplateMarket(()=>true,()=> 'one',()=>true);});
    await vi.waitFor(()=>expect(market.error()).toBe(true));
    expect(market.items()).toEqual(items);expect(market.stale()).toBe(true);
    expect(api.request.mock.calls.slice(0,2).map(([,o])=>o.method)).toEqual(['GET','POST']);
    await market.refresh();expect(market.items()).toHaveLength(2);expect(selected()).toBe('first');expect(market.error()).toBe(false);
  });
  it('fences delayed responses across environments and cancels on disposal',async()=>{
    let resolve!:(value:unknown)=>void;
    api.request.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValueOnce({items:[{template_id:'second-env'}],stale:true});
    let market!:ReturnType<typeof createServiceTemplateMarket>;
    const [identity,setIdentity]=createSignal('one');
    createRoot(d=>{dispose=d;market=createServiceTemplateMarket(()=>true,identity,()=>false);});
    await vi.waitFor(()=>expect(api.request).toHaveBeenCalledTimes(1));
    setIdentity('two');await vi.waitFor(()=>expect(market.items()).toHaveLength(1));
    resolve({items:[{template_id:'wrong-env'}],stale:false});await Promise.resolve();
    expect(market.items()[0].template_id).toBe('second-env');expect(api.request.mock.calls[0][1].signal.aborted).toBe(true);
    await market.refresh();expect(api.request).toHaveBeenCalledTimes(2);
  });
});
