import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { RuntimeGatewayConnectionsDialog } from './RuntimeGatewayConnectionsDialog';
import { createDesktopI18n } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';
const i18n=createDesktopI18n('en-US');
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
let dispose:(()=>void)|undefined;
const one={joined:true,phase:'joined',gateway_id:'one',gateway_name:'Office',member_id:'member-one',route_selected:false,endpoints:[{address:'https://office.internal:7443',endpoint_id:'lan',scope:'lan',priority:0}]};
const two={...one,gateway_id:'two',gateway_name:'Lab',member_id:'member-two',route_selected:true};
function button(label:string){const found=[...document.querySelectorAll('button')].find(el=>controlText(el)===label);if(!found)throw new Error(label);return found;}
function mount(members:unknown[],mode:'leave'|'publish'='leave',existing?:string,gatewayID?:string){
 const perform=vi.fn().mockImplementation(async request=> request.operation==='status'?{ok:true,gateway_membership:{joined:true,phase:'joined',memberships:members,existing_environment_id:existing}}:{ok:true,gateway_membership:{joined:false,phase:'not_joined'}});
 vi.stubGlobal('redevenDesktopLauncher',{performAction:perform});
 const close=vi.fn(),changed=vi.fn(),root=document.createElement('div');document.body.append(root);
 const [open,setOpen]=createSignal<'leave'|'publish'|undefined>(mode);
 const [snapshot,setSnapshot]=createSignal({targetID:'ssh:runtime' as const});
 const [available,setAvailable]=createSignal(true);
 const [authority,setAuthority]=createSignal('original');
 dispose=render(()=><RuntimeGatewayConnectionsDialog targetID={snapshot().targetID} gatewayID={gatewayID} available={available()} authorityKey={authority()} i18n={i18n} mode={open()} onClose={()=>{close();setOpen(undefined);}} onChanged={changed}/>,root);
 return {perform,close,changed,setAvailable,setAuthority,refresh:()=>setSnapshot({targetID:'ssh:runtime'})};
}
beforeEach(()=>{vi.stubGlobal('CSS',{escape:(value:string)=>value});HTMLElement.prototype.scrollIntoView=vi.fn();});
it('revokes consent without losing selection and ignores a late revoked completion',async()=>{
 const f=mount([one,two]);await settle();const select=document.querySelector<HTMLSelectElement>('select')!;select.value='two';select.dispatchEvent(new Event('change',{bubbles:true}));
 let complete!:(result:unknown)=>void;f.perform.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 button(i18n.t('gatewayConnections.unpair')).click();f.setAvailable(false);await settle();
 expect(select.value).toBe('two');expect(button(i18n.t('common.cancel')).disabled).toBe(false);
 complete({ok:true,gateway_membership:{joined:false,phase:'not_joined'}});await settle();
 expect(f.close).not.toHaveBeenCalled();expect(f.changed).not.toHaveBeenCalled();
 f.setAvailable(true);await settle();expect(button(i18n.t('gatewayConnections.unpair')).disabled).toBe(true);
 button(i18n.t('interactionContinuity.revalidate')).click();await settle();
 expect(select.value).toBe('two');expect(button(i18n.t('gatewayConnections.unpair')).disabled).toBe(false);
});
afterEach(()=>{dispose?.();document.body.replaceChildren();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('requires an explicit Gateway target and warns only for the selected Cloud owner',async()=>{
 const f=mount([one,two]);await settle();
 const select=document.querySelector<HTMLSelectElement>('select')!;
 expect(select.value).toBe('');expect(button(i18n.t('gatewayConnections.unpair')).disabled).toBe(true);
 select.value='one';select.dispatchEvent(new Event('change',{bubbles:true}));await settle();
 expect(document.body.textContent).not.toContain(i18n.t('gatewayConnections.cloudImpact'));
 select.value='two';select.dispatchEvent(new Event('change',{bubbles:true}));await settle();
 expect(document.body.textContent).toContain(i18n.t('gatewayConnections.cloudImpact'));
 f.refresh();await settle();expect(select.value).toBe('two');expect(f.perform).toHaveBeenCalledOnce();
 button(i18n.t('gatewayConnections.unpair')).click();await settle();
 expect(f.perform.mock.calls.at(-1)?.[0]).toEqual({kind:'manage_runtime_gateway',runtime_target_id:'ssh:runtime',operation:'leave',gateway_id:'two',route_impact_acknowledged:true});
 expect(f.changed).toHaveBeenCalledOnce();expect(f.close).toHaveBeenCalledOnce();
});
it('confirms a single pairing directly without a selector or Cloud migration choice',async()=>{
 const f=mount([one]);await settle();expect(document.querySelector('select')).toBeNull();expect(document.querySelector('input[type="radio"]')).toBeNull();
 button(i18n.t('gatewayConnections.unpair')).click();await settle();
 expect(f.perform.mock.calls.at(-1)?.[0]).toMatchObject({gateway_id:'one',route_impact_acknowledged:false});
});
it.each(['leave','publish'] as const)('retains the %s confirmation during the closing transition',async mode=>{
 const f=mount([one],mode);await settle();
 const dialog=document.querySelector('[role="dialog"]')!;
 const label=i18n.t(mode==='leave'?'gatewayConnections.unpair':'gatewayConnections.publish');
 button(label).click();await settle();
 expect(f.close).toHaveBeenCalledOnce();
 expect(dialog.textContent).toContain('Office');
 expect(dialog.textContent).toContain(i18n.t(mode==='leave'?'gatewayConnections.unpairImpact':'gatewayConnections.publishHelp'));
 expect(dialog.textContent).toContain(i18n.t(mode==='leave'?'gatewayConnections.unpairTitle':'gatewayConnections.publishTitle'));
});
it('confirms the already selected Gateway without asking the user to choose again',async()=>{
 const f=mount([one,two],'leave',undefined,'two');await settle();
 expect(document.querySelector('select')).toBeNull();
 expect(document.body.textContent).toContain('Lab');
 expect(document.body.textContent).toContain(i18n.t('gatewayConnections.cloudImpact'));
 f.refresh();await settle();expect(f.perform).toHaveBeenCalledOnce();
 button(i18n.t('gatewayConnections.unpair')).click();await settle();
 expect(f.perform.mock.calls.at(-1)?.[0]).toMatchObject({gateway_id:'two',route_impact_acknowledged:true});
});
it('does not substitute another Gateway when the selected pairing has disappeared',async()=>{
 const f=mount([one],'leave',undefined,'two');await settle();
 expect(document.querySelector('select')).toBeNull();
 expect(button(i18n.t('gatewayConnections.unpair')).disabled).toBe(true);
 expect(f.perform).toHaveBeenCalledOnce();
});
it('keeps failed unpair consent and does not report completion',async()=>{
 const f=mount([one]);await settle();f.perform.mockResolvedValueOnce({ok:false,gateway_error_code:'GATEWAY_ROUTE_IMPACT_REQUIRED'});
 button(i18n.t('gatewayConnections.unpair')).click();await settle();
 expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayConnections.cloudChanged'));expect(f.close).not.toHaveBeenCalled();expect(f.changed).not.toHaveBeenCalled();
});
it('directs an existing association to route changes instead of creating another environment',async()=>{
 const f=mount([one],'publish','existing');await settle();
 expect(button(i18n.t('gatewayConnections.publish')).disabled).toBe(true);
 expect(document.querySelector('input[type="radio"]')).toBeNull();
 expect(document.body.textContent).toContain(i18n.t('gatewayConnections.useRouteChange'));
 expect(f.perform).toHaveBeenCalledOnce();
});

it('requires revalidation after membership identity changes without replacing the selected member',async()=>{
 const f=mount([one,two],'leave',undefined,'two');await settle();
 const dialog=document.querySelector('[role="dialog"]');
 f.setAuthority('replacement-member');await settle();
 expect(document.querySelector('[role="dialog"]')).toBe(dialog);
 expect(document.body.textContent).toContain('Lab');
 expect(button(i18n.t('gatewayConnections.unpair')).disabled).toBe(true);
 button(i18n.t('gatewayConnections.unpair')).click();expect(f.perform).toHaveBeenCalledOnce();
 button(i18n.t('interactionContinuity.revalidate')).click();await settle();
 expect(button(i18n.t('gatewayConnections.unpair')).disabled).toBe(false);
});
