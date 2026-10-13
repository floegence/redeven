import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {render} from 'solid-js/web';
import {RuntimeCloudConnections} from './RuntimeCloudConnections';
import {createDesktopI18n} from '../shared/i18n';
import {controlText} from '../testSupport/controlText';
const i18n=createDesktopI18n('en-US');
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
let dispose:(()=>void)|undefined;
const id='A'.repeat(43);
const cloud={association_revision:1,enabled:true,approval_state:'revoked' as const,reason_code:'AUTHORIZATION_REVOKED',connection_state:'authorization_required',route:{kind:'gateway' as const,member_id:'missing'},route_revision:3,next_attempt_at_unix_ms:Date.now()+30000};
const operation={operation_id:id,expected_route_revision:3,association_revision:1,selection:{kind:'direct' as const},state:'awaiting_confirmation' as const,expires_at_unix_ms:Date.now()+60000};
function button(key:Parameters<typeof i18n.t>[0]) {const found=[...document.querySelectorAll('button')].find(b=>controlText(b)===i18n.t(key));if(!found)throw new Error(key);return found;}
function mount(perform:ReturnType<typeof vi.fn>,enabled=true) {
 vi.stubGlobal('redevenDesktopLauncher',{performAction:perform});
 const changed=vi.fn(),browser=vi.fn(),root=document.createElement('div');document.body.append(root);
 dispose=render(()=><RuntimeCloudConnections targetID="ssh:runtime" binding={{state:'linked',remote_enabled:enabled,cloud_origin:'https://cloud.example',cloud:{...cloud,enabled}}} memberships={[]} i18n={i18n} onChanged={changed} openInBrowser={browser}/>,root);
 return {changed,browser};
}
beforeEach(()=>{const entries=new Map<string,string>();Object.defineProperty(window,"localStorage",{configurable:true,value:{getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>entries.set(k,v),removeItem:(k:string)=>entries.delete(k)}});vi.stubGlobal('CSS',{escape:(v:string)=>v});HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{dispose?.();document.body.replaceChildren();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('keeps recoverable exits for revoked approval and a missing Gateway without inferring authorization',async()=>{
 const perform=vi.fn().mockResolvedValue({ok:true}),f=mount(perform);await settle();
 expect(document.body.textContent).toContain(i18n.t('cloudRoute.revoked'));
 expect(document.body.textContent).toContain(i18n.t('cloudRoute.gatewayUnavailable'));
 button('cloudRoute.manageApproval').click();expect(f.browser).toHaveBeenCalledWith('https://cloud.example');
 button('cloudRoute.cancelIntent').click();await settle();
 expect(perform).toHaveBeenCalledWith({kind:'disconnect_cloud_runtime',runtime_target_id:'ssh:runtime'});
});
it('can resume explicit intent after disconnect',async()=>{
 const perform=vi.fn().mockResolvedValue({ok:true});mount(perform,false);await settle();
 expect(button('cloudRoute.retry').disabled).toBe(false);button('cloudRoute.retry').click();await settle();
 expect(perform).toHaveBeenCalledWith({kind:'manage_runtime_cloud',runtime_target_id:'ssh:runtime',operation:'retry',expected_association_revision:1});
});
it('queries the original unknown result, confirms once, and never displays a committed cancellation as undone',async()=>{
 window.localStorage.setItem('redeven-cloud-route:ssh:runtime:1',id);
 const perform=vi.fn().mockImplementation(async request=>request.operation==='query'?{ok:true,cloud_route_operation:operation}:request.operation==='commit'?{ok:false,message:'lost response'}:{ok:true,cloud_route_operation:{...operation,state:'committed',committed_route_revision:4}});
 const f=mount(perform);await settle();button('cloudRoute.pendingOperation').click();await settle();
 expect(document.querySelector('select')?.disabled).toBe(true);
 button('cloudRoute.query').click();await settle();button('cloudRoute.confirm').click();await settle();
 expect(document.body.textContent).toContain('lost response');
 button('common.cancel').click();await settle();
 expect(perform.mock.calls.map(([r])=>[r.operation,r.operation_id])).toEqual([['query',id],['commit',id],['cancel',id]]);
 expect(window.localStorage.getItem('redeven-cloud-route:ssh:runtime:1')).toBeNull();expect(f.changed).toHaveBeenCalledOnce();
});
it('does not start a new operation when local storage is corrupt',async()=>{
 window.localStorage.setItem('redeven-cloud-route:ssh:runtime:1','corrupt');const perform=vi.fn();mount(perform);await settle();
 button('cloudRoute.change').click();await settle();expect(button('cloudRoute.verify').disabled).toBe(true);expect(perform).not.toHaveBeenCalled();
 button('cloudRoute.reviewCurrent').click();await settle();expect(button('cloudRoute.verify').disabled).toBe(false);
});
