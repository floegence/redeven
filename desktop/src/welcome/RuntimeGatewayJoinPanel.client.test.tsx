import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { RuntimeGatewayJoinPanel } from './RuntimeGatewayJoinPanel';
import { createDesktopI18n } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';
import type { GatewayJoinPreview, GatewayMembershipStatus } from '../shared/gatewayJoin';
import type { DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve,40));
const i18n = createDesktopI18n('en-US');
const preview: GatewayJoinPreview = { preview_id:'a'.repeat(43),purpose:'join',gateway_id:'gateway',gateway_name:'Office Gateway',target_runtime_id:'runtime',expires_at_unix_ms:1900000600000 };
function button(label: string) {
 const found = [...document.querySelectorAll('button')].reverse().find(el => controlText(el) === label && !el.closest('[hidden], [aria-hidden="true"]'));
 if (!found) throw new Error(`Missing button: ${label}`); return found;
}
function addressTab(label: string) {
 const found = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(el => el.textContent?.trim() === label);
 if (!found) throw new Error(`Missing address tab: ${label}`); return found;
}
function activeAddressPanel() { return document.querySelector<HTMLElement>('[role="tabpanel"]:not([aria-hidden="true"])'); }
function status(value: GatewayMembershipStatus): DesktopLauncherActionResult { return {ok:true,outcome:'gateway_membership_updated',gateway_membership:value}; }
function verified(value=preview): DesktopLauncherActionResult { return {ok:true,outcome:'gateway_membership_updated',gateway_preview:value}; }
function mount(perform: ReturnType<typeof vi.fn>, gateways: readonly DesktopGatewaySource[] = [], initialAddress = "https://gateway.internal:7443") {
 vi.stubGlobal('redevenDesktopLauncher',{performAction:perform});
 const root=document.createElement('div');document.body.append(root);
 const [snapshot,setSnapshot]=createSignal({target:'ssh:chosen' as DesktopCloudRuntimeLinkTargetID,gateways,address:initialAddress,code:'123456789ABCDEFGHJKMNPQRSTV'});
 dispose=render(()=><RuntimeGatewayJoinPanel targetID={snapshot().target} targetLabel="Build Runtime" gateways={snapshot().gateways} address={snapshot().address} code={snapshot().code} i18n={i18n}/>,root);
 const trigger=button(i18n.t('gatewayJoin.title'));trigger.focus();trigger.click();return {trigger,
  setTarget:(target:DesktopCloudRuntimeLinkTargetID)=>setSnapshot(current=>({...current,target})),
  setGateways:(gateways:readonly DesktopGatewaySource[])=>setSnapshot(current=>({...current,gateways})),
  refreshSnapshot:()=>setSnapshot(current=>({...current,gateways:structuredClone(current.gateways)})),
  setInvitation:(address:string,code:string)=>setSnapshot(current=>({...current,address,code})),
 };
}
function edit(index:number,value:string){const input=[...document.querySelectorAll<HTMLInputElement>('input:not([type="radio"])')][index]!;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
function pickerTrigger(picker: Element) { return picker.querySelector<HTMLElement>('[data-floe-dropdown-trigger]')!; }
async function pickerOptions(picker: Element) {
 const trigger=pickerTrigger(picker); trigger.click(); await settle();
 const menu=document.getElementById(trigger.getAttribute('aria-controls')!)!;
 const labels=[...menu.querySelectorAll('[role="menuitem"]')].map(item=>item.textContent?.trim());
 trigger.click(); await settle(); return labels;
}
async function choosePicker(picker: Element,label: string) {
 const trigger=pickerTrigger(picker); trigger.click(); await settle();
 const menu=document.getElementById(trigger.getAttribute('aria-controls')!)!;
 const option=[...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item=>item.textContent?.includes(label));
 if(!option)throw new Error('Missing Gateway option: '+label);option.click();await settle();
}
async function chooseSavedGateway(id:string) {
 const picker=document.querySelector('[data-gateway-picker]')!;
 await choosePicker(picker,id==='saved-1'?'Gateway-gzcom':'Office Gateway');
}
beforeEach(()=>{vi.stubGlobal('CSS',{escape:(v:string)=>v});HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{dispose?.();document.body.replaceChildren();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});

describe('Runtime Gateway address and code interaction',()=>{
 it('pauses status polling while the user restores SSH authentication',async()=>{
  vi.useFakeTimers();
  const perform=vi.fn(async request=>request.operation==='preview'
   ? {ok:false,gateway_error_code:'SSH_AUTHENTICATION_REQUIRED'} : status({joined:false,phase:'not_joined'}));
  mount(perform);await vi.advanceTimersByTimeAsync(50);
  button(i18n.t('gatewayJoin.verify')).click();await vi.advanceTimersByTimeAsync(50);
  const password=document.querySelector<HTMLInputElement>('input[type="password"]')!;
  password.value='partially typed';password.dispatchEvent(new Event('input',{bubbles:true}));
  await vi.advanceTimersByTimeAsync(10000);
  expect(perform).toHaveBeenCalledTimes(2);
  expect(password.value).toBe('partially typed');
  expect(document.activeElement).toBe(password);
  expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(true);
 });
 it('retains typed input, DOM identity and focus across fresh parent snapshots and polling',async()=>{
  vi.useFakeTimers();const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  const {refreshSnapshot}=mount(perform);await vi.advanceTimersByTimeAsync(50);
  edit(0,'https://draft.example:7443');edit(1,'draft-code');
  const inputs=[...document.querySelectorAll<HTMLInputElement>('input')];inputs[1]!.focus();
  for(let index=0;index<3;index++){refreshSnapshot();await vi.advanceTimersByTimeAsync(3100);}
  expect(document.querySelector('input')).toBe(inputs[0]);
  expect(inputs.map(input=>input.value)).toEqual(['https://draft.example:7443','draft-code']);
  expect(document.activeElement).toBe(inputs[1]);
 });
 it('retains verified consent across fresh snapshots without issuing another preview',async()=>{
  vi.useFakeTimers();const perform=vi.fn().mockImplementation(async request=>request.operation==='preview'?verified({...preview,existing_environment_id:'existing'}):status({joined:false,phase:'not_joined'}));
  const {refreshSnapshot}=mount(perform);await vi.advanceTimersByTimeAsync(50);
  button(i18n.t('gatewayJoin.verify')).click();await vi.advanceTimersByTimeAsync(50);
  const option=button(i18n.t('gatewayJoin.confirmEnable'));option.focus();
  refreshSnapshot();await vi.advanceTimersByTimeAsync(3100);
  expect(button(i18n.t('gatewayJoin.confirmEnable'))).toBe(option);expect(document.querySelector('input[type="radio"]')).toBeNull();
  expect(document.activeElement).toBe(option);expect(button(i18n.t('gatewayJoin.confirmEnable')).disabled).toBe(false);
  expect(perform.mock.calls.filter(([request])=>request.operation==='preview')).toHaveLength(1);
 });
 it('preserves the active invitation when parent invitation seeds change',async()=>{
  const perform=vi.fn().mockImplementation(async request=>request.operation==='preview'?verified():status({joined:false,phase:'not_joined'}));
  const {setInvitation}=mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();
  setInvitation('https://new.example:7443','regenerated-code');await settle();
  expect([...document.querySelectorAll<HTMLInputElement>('input')].map(input=>input.value)).toEqual(['https://gateway.internal:7443','123456789ABCDEFGHJKMNPQRSTV']);
  expect(document.querySelector('.redeven-gateway-join-summary')).not.toBeNull();expect(button(i18n.t('gatewayJoin.confirmEnable')).disabled).toBe(false);
 });
 it('does not restore a consumed invitation code when the inventory refreshes',async()=>{
  const perform=vi.fn().mockImplementation(async request=>request.operation==='preview'?verified():status({joined:request.operation!=='status',phase:request.operation==='status'?'not_joined':'joined'}));
  const {refreshSnapshot}=mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();button(i18n.t('gatewayJoin.confirmEnable')).click();await settle();
  refreshSnapshot();await settle();button(i18n.t('gatewayJoin.title')).click();await settle();
  expect(document.querySelectorAll<HTMLInputElement>('input')[1]?.value).toBe('');
 });
 it('discards delayed status and preview responses when the target changes',async()=>{
  let completeStatus!:(value:DesktopLauncherActionResult)=>void,completePreview!:(value:DesktopLauncherActionResult)=>void;
  const perform=vi.fn().mockImplementation(request=>{
   if(request.operation==='preview')return new Promise(resolve=>{completePreview=resolve;});
   if(request.runtime_target_id==='ssh:chosen')return new Promise(resolve=>{completeStatus=resolve;});
   return Promise.resolve(status({joined:false,phase:'not_joined'}));
  });
  const {setTarget}=mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();
  setTarget('ssh:other');await settle();completeStatus(status({joined:true,phase:'joined'}));completePreview(verified());await settle();
  expect(document.querySelector('.redeven-gateway-join-summary')).toBeNull();expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(false);
  expect(document.querySelector('[role="status"]')).toBeNull();
 });
 it('keeps verification pending through a parent refresh and accepts its current response',async()=>{
  let complete!:(value:DesktopLauncherActionResult)=>void;
  const perform=vi.fn().mockImplementation(request=>request.operation==='preview'?new Promise(resolve=>{complete=resolve;}):Promise.resolve(status({joined:false,phase:'not_joined'})));
  const {refreshSnapshot}=mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();
  refreshSnapshot();await settle();expect(button(i18n.t('gatewayJoin.verifying')).disabled).toBe(true);
  expect([...document.querySelectorAll<HTMLInputElement>('input')].every(input=>input.disabled)).toBe(true);
  complete(verified());await settle();expect(button(i18n.t('gatewayJoin.confirmEnable')).disabled).toBe(false);
 });
 it('retains the address but clears the code and consent on close and reopen',async()=>{
  const perform=vi.fn().mockImplementation(async request=>request.operation==='preview'?verified({...preview,existing_environment_id:'existing'}):status({joined:false,phase:'not_joined'}));
  const {trigger,refreshSnapshot}=mount(perform);await settle();edit(0,'https://draft.example:7443');
  button(i18n.t('gatewayJoin.verify')).click();await settle();button(i18n.t('gatewayJoin.confirmEnable')).focus();
  button(i18n.t('common.cancel')).click();await settle();refreshSnapshot();trigger.click();await settle();
  expect([...document.querySelectorAll<HTMLInputElement>('input')].map(input=>input.value)).toEqual(['https://draft.example:7443','']);
  expect(document.querySelector('input[type="radio"]')).toBeNull();expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(true);
 });
 it('only reads status on open and verifies before presenting explicit consent',async()=>{
  const perform=vi.fn().mockResolvedValue({ok:true}).mockResolvedValueOnce(status({joined:false,phase:'not_joined'})).mockResolvedValueOnce(verified()).mockResolvedValueOnce(status({joined:true,phase:'joined'}));
  const {trigger}=mount(perform);await settle();
  expect(perform).toHaveBeenCalledExactlyOnceWith({kind:'manage_runtime_gateway',connection_token:expect.any(Number),runtime_target_id:'ssh:chosen',operation:'status'});
  expect(document.querySelector('input[type="file"]')).toBeNull();expect(document.querySelector('input[type="radio"]')).toBeNull();
  expect(document.body.textContent).not.toContain(preview.gateway_name);
  button(i18n.t('gatewayJoin.verify')).click();await settle();
  expect(perform.mock.calls[1]?.[0]).toMatchObject({operation:'preview',purpose:'join',address:'https://gateway.internal:7443',code:'123456789ABCDEFGHJKMNPQRSTV'});
  expect(document.body.textContent).toContain(preview.gateway_name);
  expect(document.activeElement).toBe(button(i18n.t('gatewayJoin.confirmEnable')));
  button(i18n.t('gatewayJoin.confirmEnable')).click();await settle();
  expect(perform.mock.calls[2]?.[0]).toEqual({kind:'manage_runtime_gateway',connection_token:expect.any(Number),runtime_target_id:'ssh:chosen',operation:'join',preview_id:preview.preview_id});
  expect(document.querySelector('.redeven-gateway-join-summary')).toBeNull();expect(document.activeElement).toBe(trigger);
 });
 it('adds another Gateway without Cloud ownership choices and retains failed consent',async()=>{
  const perform=vi.fn().mockResolvedValue({ok:true}).mockResolvedValueOnce(status({joined:true,phase:'joined',memberships:[{joined:true,phase:'joined',gateway_id:'previous',member_id:'previous'}]})).mockResolvedValueOnce(verified({...preview,existing_environment_id:'existing'})).mockResolvedValueOnce({ok:false,gateway_error_code:'GATEWAY_UNREACHABLE'});
  mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();
  expect(document.querySelector('input[type="radio"]')).toBeNull();expect(button(i18n.t('gatewayJoin.confirmEnable')).disabled).toBe(false);
  expect(document.body.textContent).not.toContain(i18n.t('gatewayJoin.preserveHelp'));
  button(i18n.t('gatewayJoin.confirmEnable')).click();await settle();
  expect(perform.mock.calls.at(-1)?.[0]).toMatchObject({operation:'join',preview_id:preview.preview_id});
  expect(perform.mock.calls.at(-1)?.[0]).not.toHaveProperty('environment_choice');
  expect(document.querySelectorAll('input')[1]?.value).toBe('123456789ABCDEFGHJKMNPQRSTV');
 });
 it.each([0,1])('invalidates verification when input %s changes',async index=>{
  const perform=vi.fn().mockResolvedValue({ok:true}).mockResolvedValueOnce(status({joined:false,phase:'not_joined'})).mockResolvedValueOnce(verified());mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();edit(index,index===0?'https://other.example':'new-code');await settle();
  expect(document.body.textContent).not.toContain(preview.gateway_name);expect(button(i18n.t('gatewayJoin.verify'))).toBeDefined();
 });
 it('invalidates verification when the target changes',async()=>{
  const perform=vi.fn().mockResolvedValue({ok:true}).mockResolvedValueOnce(status({joined:false,phase:'not_joined'})).mockResolvedValueOnce(verified()).mockResolvedValue(status({joined:false,phase:'not_joined'}));const {setTarget}=mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();setTarget('ssh:other');await settle();expect(document.body.textContent).toContain(preview.gateway_name);expect(button(i18n.t('gatewayJoin.confirmEnable')).disabled).toBe(true);expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(false);
 });
 it.each([['GATEWAY_INVITATION_EXPIRED','expired'],['GATEWAY_INVITATION_USED','used'],['GATEWAY_UNREACHABLE','unreachable'],['GATEWAY_IDENTITY_FAILED','identityFailed'],['INVITATION_AUTHENTICATION_FAILED','invalid']] as const)('preserves input and explains %s',async(error,key)=>{
  const perform=vi.fn().mockResolvedValue({ok:true}).mockResolvedValueOnce(status({joined:false,phase:'not_joined'})).mockResolvedValue({ok:false,code:'cloud_link_failed',gateway_error_code:error});mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t(`gatewayJoin.${key}`));expect(document.querySelectorAll('input')[1]?.value).toBe('123456789ABCDEFGHJKMNPQRSTV');
 });

});

const localGateway: DesktopGatewaySource = {
 gateway_id:'local-gateway',display_name:'Office Gateway',local_enabled:true,connection_kind:'local_host',
 management_capability:'managed_local_host',capabilities:[],status:'online',trust_state:'paired',listener_running:true,
 created_at_ms:1,updated_at_ms:1,environments:[],member_endpoints:[{endpoint_id:'lan',address:'https://office.local:7443',scope:'lan',priority:0}],
};
describe('saved Gateway selection',()=>{
 it('uses a themed field trigger instead of a native saved Gateway select',async()=>{
  mount(vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'})),[localGateway],'');await settle();
  const picker=document.querySelector('[data-gateway-picker]')!;
  expect(picker.tagName).not.toBe('SELECT');
  const trigger=picker.querySelector('[data-floe-dropdown-trigger]');
  expect(trigger?.getAttribute('aria-label')).toBe(i18n.t('gatewayDiscovery.savedGateway'));
  expect(trigger?.getAttribute('data-floe-input-surface')).toBe('true');
 });
 it('shows the real local and SSH registrations even before publishing any endpoint',async()=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  mount(perform,['local_host','ssh_host'].map((connection_kind,index)=>({...localGateway,
   gateway_id:`saved-${index}`,display_name:index?'Gateway-gzcom':'Gateway-local',
   connection_kind:connection_kind as DesktopGatewaySource['connection_kind'],member_endpoints:[],
   listener_addresses:[':7443'],active_listener_addresses:['[::]:7443'],allowed_hosts:[],
   permissions:{access:true,manage_members:true,configure_cloud:true},
  })),'');await settle();
  const picker=document.querySelector<HTMLElement>('[data-gateway-picker]');
  expect(picker).not.toBeNull();
  expect(await pickerOptions(picker!)).toEqual(['Gateway-local · '+i18n.t('gatewayDiscovery.setupNeeded'),'Gateway-gzcom · '+i18n.t('gatewayDiscovery.setupNeeded')]);
  await chooseSavedGateway('saved-1');await settle();
  expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(true);
  expect(document.querySelector('[data-gateway-endpoint-draft]')).not.toBeNull();
  expect(perform.mock.calls.every(([request])=>request.operation==='status')).toBe(true);
 });

 it.each(['url','local_host','local_container','ssh_host','ssh_container'] as const)('offers a saved %s Gateway independently of live status',async connection_kind=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  const gateway={...localGateway,connection_kind,status:'unknown' as const,listener_running:false};
  const {setGateways}=mount(perform,[gateway],'');await settle();
  await chooseSavedGateway('local-gateway');await settle();
  const picker=document.querySelector<HTMLElement>('[data-gateway-picker]')!;
  const code=document.querySelector<HTMLInputElement>('input[autocomplete=off]:not([placeholder])')!;
  code.focus();setGateways([{...gateway,status:'offline'}]);await settle();
  expect(document.querySelector('[data-gateway-picker]')).toBe(picker);
  expect(picker.dataset.value).toBe('local-gateway');
  expect(document.activeElement).toBe(code);
  button(i18n.t('gatewayJoin.verify')).click();await settle();
  expect(perform.mock.calls.at(-1)?.[0]).toMatchObject({operation:'preview',address:'https://office.local:7443'});
 });
 it('offers a saved URL before its first catalog sync',async()=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  mount(perform,[{...localGateway,connection_kind:'url',status:'unknown',trust_state:undefined,member_endpoints:undefined,gateway_url:'https://saved.example:7443/'}],'');await settle();
  await chooseSavedGateway('local-gateway');await settle();
  expect(document.querySelector<HTMLElement>('[data-gateway-picker]')?.dataset.value).toBe('local-gateway');
 });
 it('retains verified consent through status refreshes and revokes it when the saved address is removed',async()=>{
  const perform=vi.fn().mockImplementation(async request=>request.operation==='preview'?verified():status({joined:false,phase:'not_joined'}));
  const {setGateways}=mount(perform,[localGateway],'');await settle();await chooseSavedGateway('local-gateway');
  button(i18n.t('gatewayJoin.verify')).click();await settle();
  setGateways([{...localGateway,status:'offline',listener_running:false}]);await settle();
  expect(button(i18n.t('gatewayJoin.confirmEnable')).disabled).toBe(false);
  expect(document.querySelector<HTMLElement>('[data-gateway-picker]')?.dataset.value).toBe('local-gateway');
  setGateways([]);await settle();
  expect(document.querySelector('.redeven-gateway-join-summary')).toBeNull();
  expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(true);
  expect(document.querySelector<HTMLInputElement>('input[placeholder]')?.value).toBe('');
 });
 it('defaults to saved selection when inventory arrives before address interaction',async()=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  const {setGateways}=mount(perform,[],'');await settle();
  setGateways([localGateway]);await settle();
  expect(addressTab(i18n.t('gatewayDiscovery.savedGateway')).getAttribute('aria-selected')).toBe('true');
  expect(activeAddressPanel()?.querySelector('[data-gateway-picker]')).not.toBeNull();
 });
 it('preserves the manual input node, caret and focus when inventory arrives',async()=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  const {setGateways}=mount(perform,[],'');await settle();
  const input=document.querySelector<HTMLInputElement>('input[placeholder]')!;
  input.focus();edit(0,'https://draft.example');input.setSelectionRange(12,12);
  setGateways([localGateway]);await settle();
  expect(addressTab(i18n.t('gatewayDiscovery.enterAddress')).getAttribute('aria-selected')).toBe('true');
  expect(activeAddressPanel()?.querySelector('input')).toBe(input);
  expect(input.value).toBe('https://draft.example');
  expect(input.selectionStart).toBe(12);expect(document.activeElement).toBe(input);
 });
 it('separates saved Gateway selection from manual entry and preserves each draft',async()=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  const {refreshSnapshot}=mount(perform,[localGateway],'');await settle();
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
  expect(addressTab(i18n.t('gatewayDiscovery.savedGateway')).getAttribute('aria-selected')).toBe('true');
  const picker=document.querySelector<HTMLElement>('[data-gateway-picker]');
  expect(pickerTrigger(picker!).textContent).toBe(i18n.t('gatewayDiscovery.chooseSavedGateway'));
  expect(await pickerOptions(picker!)).toEqual(['Office Gateway · office.local:7443']);
  expect(picker?.dataset.value).toBe('');
  expect(activeAddressPanel()?.querySelector('input')).toBeNull();
  expect(activeAddressPanel()?.querySelector('[data-gateway-picker]')).toBe(picker);
  addressTab(i18n.t('gatewayDiscovery.enterAddress')).click();await settle();
  const manualPanel=activeAddressPanel();
  const manualAddress=manualPanel?.querySelector<HTMLInputElement>('input');
  expect(manualAddress?.value).toBe('');
  manualAddress!.value='https://draft.example:7443';manualAddress!.dispatchEvent(new Event('input',{bubbles:true}));
  addressTab(i18n.t('gatewayDiscovery.savedGateway')).click();await settle();
  await chooseSavedGateway('local-gateway');await settle();
  expect(picker?.dataset.value).toBe('local-gateway');
  refreshSnapshot();await settle();
  expect(picker?.dataset.value).toBe('local-gateway');
  expect(activeAddressPanel()?.querySelector('input')).toBeNull();
  expect(document.querySelectorAll<HTMLInputElement>('[role="tabpanel"] input')[0]?.value).toBe('https://draft.example:7443');
  addressTab(i18n.t('gatewayDiscovery.enterAddress')).click();await settle();
  expect(activeAddressPanel()?.querySelector<HTMLInputElement>('input')?.value).toBe('https://draft.example:7443');
  expect(perform.mock.calls.every(call=>call[0].operation==='status')).toBe(true);
  addressTab(i18n.t('gatewayDiscovery.savedGateway')).click();await settle();
  await chooseSavedGateway('local-gateway');
  button(i18n.t('gatewayJoin.verify')).click();await settle();
  expect(perform.mock.calls.find(([request])=>request.operation==='preview')?.[0]).toMatchObject({address:'https://office.local:7443'});
  expect(perform.mock.calls.some(([request])=>request.operation==='join')).toBe(false);
 });
 it('invalidates verified consent when switching to a different address source',async()=>{
  const perform=vi.fn().mockImplementation(async request=>request.operation==='preview'?verified():status({joined:false,phase:'not_joined'}));
  mount(perform,[localGateway],'');await settle();await chooseSavedGateway('local-gateway');
  button(i18n.t('gatewayJoin.verify')).click();await settle();
  expect(document.querySelector('.redeven-gateway-join-summary')).not.toBeNull();
  addressTab(i18n.t('gatewayDiscovery.enterAddress')).click();await settle();
  expect(document.querySelector('.redeven-gateway-join-summary')).toBeNull();
  expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(true);
  expect(document.querySelector<HTMLInputElement>('[role="tabpanel"] input')?.value).toBe('');
 });
 it('distinguishes confirmed endpoints and reflects only the currently filled address',async()=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  const alternate={endpoint_id:'public',address:'https://office.example:7443',scope:'public' as const,priority:1};
  mount(perform,[{...localGateway,member_endpoints:[...localGateway.member_endpoints!,alternate]}],'');await settle();
  const picker=document.querySelector<HTMLElement>('[data-gateway-picker]');
  expect(await pickerOptions(picker!)).toHaveLength(1);
  await chooseSavedGateway('local-gateway');await settle();
  const addressPicker=document.querySelector<HTMLElement>('[data-gateway-address-picker]')!;
  expect(pickerTrigger(picker!).textContent).toContain('office.local:7443');
  expect(await pickerOptions(addressPicker)).toContain(alternate.address);
  await choosePicker(addressPicker,alternate.address);
  expect(picker?.dataset.value).toBe('local-gateway');
  expect(addressPicker.dataset.value).toBe(alternate.address);
  expect(activeAddressPanel()?.querySelector('input')).toBeNull();
  expect(perform.mock.calls.every(call=>call[0].operation==='status')).toBe(true);
 });
 it('selects a matching saved endpoint for an invitation address seed',async()=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  mount(perform,[localGateway],'https://office.local:7443');await settle();
  expect(addressTab(i18n.t('gatewayDiscovery.savedGateway')).getAttribute('aria-selected')).toBe('true');
  expect(document.querySelector<HTMLElement>('[data-gateway-picker]')?.dataset.value).toBe('local-gateway');
  expect(activeAddressPanel()?.querySelector('input')).toBeNull();
 });
 it('keeps registrations visible when Host restrictions reject their addresses',async()=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  mount(perform,[{...localGateway,allowed_hosts:['other.example']},{...localGateway,gateway_id:'disabled',local_enabled:false}],'');await settle();
  const picker=document.querySelector<HTMLElement>('[data-gateway-picker]')!;
  expect(await pickerOptions(picker)).toHaveLength(1);await chooseSavedGateway('local-gateway');await settle();
  expect(document.querySelector('[data-gateway-address-setup]')).not.toBeNull();
  expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(true);
 });
});

const unconfiguredGateway: DesktopGatewaySource = {...localGateway,member_endpoints:[],allowed_hosts:[],
 permissions:{access:true,manage_members:true,configure_cloud:true}};
function editEndpoint(value:string){const input=document.querySelector<HTMLInputElement>('[data-gateway-endpoint-draft]')!;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));return input;}
describe('saved Gateway address completion',()=>{
 it('saves through the endpoint API, creates an invitation and requires verification then consent',async()=>{
  const perform=vi.fn().mockImplementation(async request=>{
   if(request.kind==='update_gateway_endpoints')return {ok:true,gateway_endpoints:request.endpoints};
   if(request.kind==='invite_gateway_runtime')return {ok:true,gateway_invitation_code:{code:'generated-code',share_addresses:['https://office.example:7443']}};
   return request.operation==='preview'?verified():status({joined:request.operation==='join',phase:request.operation==='join'?'joined':'not_joined'});
  });
  const {refreshSnapshot}=mount(perform,[unconfiguredGateway],'');await settle();await chooseSavedGateway('local-gateway');await settle();
  const input=editEndpoint('https://office.example:7443/');input.focus();refreshSnapshot();await settle();
  expect(document.querySelector('[data-gateway-endpoint-draft]')).toBe(input);expect(document.activeElement).toBe(input);
  button(i18n.t('gatewayDiscovery.saveAddress')).click();await settle();refreshSnapshot();await settle();
  expect(document.querySelector('[data-gateway-selected-address]')?.textContent).toBe('https://office.example:7443');
  expect(perform.mock.calls.find(([request])=>request.kind==='update_gateway_endpoints')?.[0]).toMatchObject({gateway_id:'local-gateway',endpoints:[{address:'https://office.example:7443'}]});
  expect(perform.mock.calls.some(([request])=>request.kind==='invite_gateway_runtime')).toBe(false);
  button(i18n.t('gatewayMembers.createInvitation')).click();await settle();
  expect(document.querySelector<HTMLInputElement>('input[autocomplete=off]:not([placeholder])')?.value).toBe('generated-code');
  expect(perform.mock.calls.some(([request])=>request.operation==='preview'||request.operation==='join')).toBe(false);
  button(i18n.t('gatewayJoin.verify')).click();await settle();
  expect(perform.mock.calls.at(-1)?.[0]).toMatchObject({operation:'preview',address:'https://office.example:7443',code:'generated-code'});
  expect(perform.mock.calls.some(([request])=>request.operation==='join')).toBe(false);
  button(i18n.t('gatewayJoin.confirmEnable')).click();await settle();
  expect(perform.mock.calls.some(([request])=>request.operation==='join')).toBe(true);
 });
 it('does not resurrect a saved endpoint after catalog acknowledgement and later removal',async()=>{
  let endpoints: unknown;
  const perform=vi.fn().mockImplementation(async request=>{
   if(request.kind==='update_gateway_endpoints'){endpoints=request.endpoints;return {ok:true,gateway_endpoints:endpoints};}
   return status({joined:false,phase:'not_joined'});
  });
  const {setGateways}=mount(perform,[unconfiguredGateway],'');await settle();await chooseSavedGateway('local-gateway');await settle();
  editEndpoint('https://office.example');button(i18n.t('gatewayDiscovery.saveAddress')).click();await settle();
  setGateways([{...unconfiguredGateway,member_endpoints:endpoints as DesktopGatewaySource['member_endpoints']}]);await settle();
  expect(document.querySelector('[data-gateway-selected-address]')?.textContent).toBe('https://office.example');
  setGateways([unconfiguredGateway]);await settle();
  expect(document.querySelector('[data-gateway-endpoint-draft]')).not.toBeNull();
  expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(true);
 });
 it('rejects a delayed invitation after management permission is revoked',async()=>{
  let complete!:(value:unknown)=>void;
  const perform=vi.fn().mockImplementation(request=>request.kind==='invite_gateway_runtime'?new Promise(resolve=>{complete=resolve;}):Promise.resolve(status({joined:false,phase:'not_joined'})));
  const gateway={...localGateway,permissions:unconfiguredGateway.permissions};
  const {setGateways}=mount(perform,[gateway],'');await settle();await chooseSavedGateway('local-gateway');await settle();
  button(i18n.t('gatewayMembers.createInvitation')).click();await settle();
  setGateways([{...gateway,permissions:{access:true,manage_members:false,configure_cloud:false}}]);await settle();
  complete({ok:true,gateway_invitation_code:{code:'late-code',share_addresses:['https://office.local:7443']}});await settle();
  expect(document.querySelector<HTMLInputElement>('input[autocomplete=off]:not([placeholder])')?.value).not.toBe('late-code');
 });
 it.each(['https://localhost:7443','https://0.0.0.0:7443','http://office.example','https://office.example/path'])('blocks unusable remote address %s',async address=>{
  mount(vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'})),[unconfiguredGateway],'');await settle();await chooseSavedGateway('local-gateway');await settle();editEndpoint(address);await settle();
  expect(button(i18n.t('gatewayDiscovery.saveAddress')).disabled).toBe(true);
 });
 it('preserves the address draft and permits retry after a failed save',async()=>{
  const perform=vi.fn().mockImplementation(async request=>request.kind==='update_gateway_endpoints'?{ok:false}:status({joined:false,phase:'not_joined'}));
  mount(perform,[unconfiguredGateway],'');await settle();await chooseSavedGateway('local-gateway');await settle();editEndpoint('https://office.example');button(i18n.t('gatewayDiscovery.saveAddress')).click();await settle();
  expect(document.querySelector<HTMLInputElement>('[data-gateway-endpoint-draft]')?.value).toBe('https://office.example');
  expect(button(i18n.t('gatewayDiscovery.saveAddress')).disabled).toBe(false);expect(document.querySelector('[role=alert]')).not.toBeNull();
 });
 it('does not apply a late save after target authority changes',async()=>{
  let complete!:(value:unknown)=>void;
  const perform=vi.fn().mockImplementation(request=>request.kind==='update_gateway_endpoints'?new Promise(resolve=>{complete=resolve;}):Promise.resolve(status({joined:false,phase:'not_joined'})));
  const {setTarget}=mount(perform,[unconfiguredGateway],'');await settle();await chooseSavedGateway('local-gateway');await settle();editEndpoint('https://office.example');button(i18n.t('gatewayDiscovery.saveAddress')).click();await settle();
  setTarget('ssh:other');await settle();complete({ok:true,gateway_endpoints:[{endpoint_id:'new',address:'https://office.example',scope:'lan',priority:0}]});await settle();
  expect(document.querySelector('[data-gateway-selected-address]')).toBeNull();expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(true);
 });
 it.each(['url','local_host'] as const)('explains missing management authority for %s without hiding the Gateway',async connection_kind=>{
  mount(vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'})),[{...unconfiguredGateway,connection_kind,permissions:{access:true,manage_members:false,configure_cloud:false}}],'');await settle();await chooseSavedGateway('local-gateway');await settle();
  expect(document.body.textContent).toContain(i18n.t('gatewayDiscovery.cannotManage'));
  expect(document.querySelector('[data-gateway-endpoint-draft]')).toBeNull();
 });
});
