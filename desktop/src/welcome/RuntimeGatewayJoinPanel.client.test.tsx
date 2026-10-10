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
function status(value: GatewayMembershipStatus): DesktopLauncherActionResult { return {ok:true,outcome:'gateway_membership_updated',gateway_membership:value}; }
function verified(value=preview): DesktopLauncherActionResult { return {ok:true,outcome:'gateway_membership_updated',gateway_preview:value}; }
function mount(perform: ReturnType<typeof vi.fn>, gateways: readonly DesktopGatewaySource[] = [], initialAddress = "https://gateway.internal:7443") {
 vi.stubGlobal('redevenDesktopLauncher',{performAction:perform});
 const root=document.createElement('div');document.body.append(root);
 const [snapshot,setSnapshot]=createSignal({target:'ssh:chosen' as DesktopCloudRuntimeLinkTargetID,gateways,address:initialAddress,code:'123456789ABCDEFGHJKMNPQRSTV'});
 dispose=render(()=><RuntimeGatewayJoinPanel targetID={snapshot().target} targetLabel="Build Runtime" gateways={snapshot().gateways} address={snapshot().address} code={snapshot().code} i18n={i18n}/>,root);
 const trigger=button(i18n.t('gatewayJoin.title'));trigger.focus();trigger.click();return {trigger,
  setTarget:(target:DesktopCloudRuntimeLinkTargetID)=>setSnapshot(current=>({...current,target})),
  refreshSnapshot:()=>setSnapshot(current=>({...current,gateways:structuredClone(current.gateways)})),
  setInvitation:(address:string,code:string)=>setSnapshot(current=>({...current,address,code})),
 };
}
function edit(index:number,value:string){const input=[...document.querySelectorAll<HTMLInputElement>('input:not([type="radio"])')][index]!;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
beforeEach(()=>{vi.stubGlobal('CSS',{escape:(v:string)=>v});HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{dispose?.();document.body.replaceChildren();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});

describe('Runtime Gateway address and code interaction',()=>{
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
  const option=document.querySelector<HTMLInputElement>('input[type="radio"]')!;option.click();option.focus();
  refreshSnapshot();await vi.advanceTimersByTimeAsync(3100);
  expect(document.querySelector('input[type="radio"]')).toBe(option);expect(option.checked).toBe(true);
  expect(document.activeElement).toBe(option);expect(button(i18n.t('gatewayJoin.confirmEnable')).disabled).toBe(false);
  expect(perform.mock.calls.filter(([request])=>request.operation==='preview')).toHaveLength(1);
 });
 it('loads changed invitation seeds and requires verification again',async()=>{
  const perform=vi.fn().mockImplementation(async request=>request.operation==='preview'?verified():status({joined:false,phase:'not_joined'}));
  const {setInvitation}=mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();
  setInvitation('https://new.example:7443','regenerated-code');await settle();
  expect([...document.querySelectorAll<HTMLInputElement>('input')].map(input=>input.value)).toEqual(['https://new.example:7443','regenerated-code']);
  expect(document.querySelector('.redeven-gateway-join-summary')).toBeNull();expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(false);
 });
 it('does not restore a consumed invitation code when the inventory refreshes',async()=>{
  const perform=vi.fn().mockImplementation(async request=>request.operation==='preview'?verified():status({joined:request.operation!=='status',phase:request.operation==='status'?'not_joined':'joined'}));
  const {refreshSnapshot}=mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();button(i18n.t('gatewayJoin.confirmEnable')).click();await settle();
  refreshSnapshot();await settle();button(i18n.t('gatewayJoin.replace')).click();await settle();
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
  button(i18n.t('gatewayJoin.verify')).click();await settle();document.querySelector<HTMLInputElement>('input[type="radio"]')!.click();
  button(i18n.t('common.cancel')).click();await settle();refreshSnapshot();trigger.click();await settle();
  expect([...document.querySelectorAll<HTMLInputElement>('input')].map(input=>input.value)).toEqual(['https://draft.example:7443','']);
  expect(document.querySelector('input[type="radio"]')).toBeNull();expect(button(i18n.t('gatewayJoin.verify')).disabled).toBe(true);
 });
 it('only reads status on open and verifies before presenting explicit consent',async()=>{
  const perform=vi.fn().mockResolvedValueOnce(status({joined:false,phase:'not_joined'})).mockResolvedValueOnce(verified()).mockResolvedValueOnce(status({joined:true,phase:'joined'}));
  const {trigger}=mount(perform);await settle();
  expect(perform).toHaveBeenCalledExactlyOnceWith({kind:'manage_runtime_gateway',runtime_target_id:'ssh:chosen',operation:'status'});
  expect(document.querySelector('input[type="file"]')).toBeNull();expect(document.querySelector('input[type="radio"]')).toBeNull();
  expect(document.body.textContent).not.toContain(preview.gateway_name);
  button(i18n.t('gatewayJoin.verify')).click();await settle();
  expect(perform.mock.calls[1]?.[0]).toMatchObject({operation:'preview',purpose:'join',address:'https://gateway.internal:7443',code:'123456789ABCDEFGHJKMNPQRSTV'});
  expect(document.body.textContent).toContain(preview.gateway_name);
  expect(document.activeElement).toBe(button(i18n.t('gatewayJoin.confirmEnable')));
  button(i18n.t('gatewayJoin.confirmEnable')).click();await settle();
  expect(perform.mock.calls[2]?.[0]).toEqual({kind:'manage_runtime_gateway',runtime_target_id:'ssh:chosen',operation:'join',preview_id:preview.preview_id});
  button(i18n.t('common.cancel')).click();await settle();expect(document.activeElement).toBe(trigger);
 });
 it('shows Cloud choices only after verification and requires an explicit choice',async()=>{
  const perform=vi.fn().mockResolvedValueOnce(status({joined:false,phase:'not_joined',existing_environment_id:'existing'})).mockResolvedValueOnce(verified({...preview,existing_environment_id:'existing'})).mockResolvedValue({ok:false,code:'cloud_link_failed',gateway_error_code:'GATEWAY_UNREACHABLE'});
  mount(perform);await settle();expect(document.querySelector('input[type="radio"]')).toBeNull();
  button(i18n.t('gatewayJoin.verify')).click();await settle();
  const options=[...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  expect(options.every(option=>!option.checked)).toBe(true);expect(button(i18n.t('gatewayJoin.confirmEnable')).disabled).toBe(true);
  expect(document.activeElement).toBe(options[0]);expect(document.body.textContent).toContain(i18n.t('gatewayJoin.preserveHelp'));expect(document.body.textContent).toContain(i18n.t('gatewayJoin.newHelp'));
  options[0]!.click();button(i18n.t('gatewayJoin.confirmEnable')).click();await settle();
  expect(perform.mock.calls.at(-1)?.[0]).toMatchObject({operation:'join',environment_choice:'preserve'});expect(options[0]!.checked).toBe(true);expect(document.querySelectorAll('input')[1]?.value).toBe('123456789ABCDEFGHJKMNPQRSTV');
 });
 it.each([0,1])('invalidates verification when input %s changes',async index=>{
  const perform=vi.fn().mockResolvedValueOnce(status({joined:false,phase:'not_joined'})).mockResolvedValueOnce(verified());mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();edit(index,index===0?'https://other.example':'new-code');await settle();
  expect(document.body.textContent).not.toContain(preview.gateway_name);expect(button(i18n.t('gatewayJoin.verify'))).toBeDefined();
 });
 it('invalidates verification when the target changes',async()=>{
  const perform=vi.fn().mockResolvedValueOnce(status({joined:false,phase:'not_joined'})).mockResolvedValueOnce(verified()).mockResolvedValue(status({joined:false,phase:'not_joined'}));const {setTarget}=mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();setTarget('ssh:other');await settle();expect(document.body.textContent).not.toContain(preview.gateway_name);
 });
 it.each([['GATEWAY_INVITATION_EXPIRED','expired'],['GATEWAY_INVITATION_USED','used'],['GATEWAY_UNREACHABLE','unreachable'],['GATEWAY_IDENTITY_FAILED','identityFailed'],['INVITATION_AUTHENTICATION_FAILED','invalid']] as const)('preserves input and explains %s',async(error,key)=>{
  const perform=vi.fn().mockResolvedValueOnce(status({joined:false,phase:'not_joined'})).mockResolvedValue({ok:false,code:'cloud_link_failed',gateway_error_code:error});mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t(`gatewayJoin.${key}`));expect(document.querySelectorAll('input')[1]?.value).toBe('123456789ABCDEFGHJKMNPQRSTV');
 });
 it.each(['replace','update-endpoints'] as const)('preserves %s input across polling',async purpose=>{
  vi.useFakeTimers();const perform=vi.fn().mockImplementation(async request=>request.operation==='preview'?verified({...preview,purpose}):status({joined:true,phase:'joined'}));const {refreshSnapshot}=mount(perform);await vi.advanceTimersByTimeAsync(50);button(i18n.t(purpose==='replace'?'gatewayJoin.replace':'gatewayJoin.updateEndpoints')).click();edit(1,'new-code');refreshSnapshot();await vi.advanceTimersByTimeAsync(3100);expect(document.querySelectorAll('input')[1]?.value).toBe('new-code');button(i18n.t('gatewayJoin.verify')).click();await vi.advanceTimersByTimeAsync(50);button(i18n.t('gatewayJoin.confirmEnable')).click();await vi.advanceTimersByTimeAsync(50);expect(perform.mock.calls.find(call=>call[0].operation===purpose)?.[0]).toMatchObject({operation:purpose,preview_id:preview.preview_id});
 });
 it('retains leave confirmation and recovers polling after a transient failure',async()=>{
  vi.useFakeTimers();const perform=vi.fn().mockResolvedValueOnce(status({joined:true,phase:'joined'})).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(status({joined:true,phase:'gateway_offline'}));const {refreshSnapshot}=mount(perform);await vi.advanceTimersByTimeAsync(50);button(i18n.t('gatewayMembers.leave')).click();refreshSnapshot();await vi.advanceTimersByTimeAsync(3100);expect(document.body.textContent).toContain(i18n.t('gatewayJoin.failed'));await vi.advanceTimersByTimeAsync(3100);expect(button(i18n.t('gatewayMembers.confirmLeave')).disabled).toBe(false);expect(document.querySelector('[role="status"]')?.textContent).toContain(i18n.t('gatewayMembership.gateway_offline'));
 });
 it('ignores a delayed verification after close and reopen',async()=>{
  let complete!:(value:DesktopLauncherActionResult)=>void;const perform=vi.fn().mockResolvedValueOnce(status({joined:false,phase:'not_joined'})).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;})).mockResolvedValue(status({joined:false,phase:'not_joined'}));const {trigger}=mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();button(i18n.t('common.cancel')).click();await settle();trigger.click();await settle();complete(verified());await settle();expect(document.body.textContent).not.toContain(preview.gateway_name);
 });
});

const localGateway: DesktopGatewaySource = {
 gateway_id:'local-gateway',display_name:'Office Gateway',local_enabled:true,connection_kind:'local_host',
 management_capability:'managed_local_host',capabilities:[],status:'online',trust_state:'paired',listener_running:true,
 created_at_ms:1,updated_at_ms:1,environments:[],member_endpoints:[{endpoint_id:'lan',address:'https://office.local:7443',scope:'lan',priority:0}],
};
describe('local Gateway quick fill',()=>{
 it('offers known local addresses without replacing a draft or authorizing access',async()=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  mount(perform,[localGateway]);await settle();
  const inputs=document.querySelectorAll<HTMLInputElement>('input:not([type="radio"])');
  expect(inputs[0]?.value).toBe('https://gateway.internal:7443');
  const suggestion=document.querySelector<HTMLButtonElement>('[data-gateway-suggestion]');
  expect(suggestion?.textContent).toContain('Office Gateway');
  expect(suggestion?.getAttribute('aria-pressed')).toBe('false');
  expect(suggestion?.querySelector('[data-gateway-local-label]')).toBeTruthy();
  expect(suggestion?.textContent).not.toContain('https://office.local:7443');
  suggestion!.click();await settle();
  expect(inputs[0]?.value).toBe('https://office.local:7443');
  expect(suggestion?.getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(inputs[1]);
  expect(perform.mock.calls.every(call=>call[0].operation==='status')).toBe(true);
  edit(0,'https://other.example:7443');await settle();
  expect(suggestion?.getAttribute('aria-pressed')).toBe('false');
  expect(document.body.textContent?.split(i18n.t('gatewayJoin.codeHelp')).length).toBe(2);
 });
 it('invalidates a verified preview when a suggestion is selected',async()=>{
  const perform=vi.fn().mockResolvedValueOnce(status({joined:false,phase:'not_joined'})).mockResolvedValueOnce(verified());
  mount(perform,[localGateway]);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();
  document.querySelector<HTMLButtonElement>('[data-gateway-suggestion]')!.click();await settle();
  expect(document.querySelector('.redeven-gateway-join-summary')).toBeNull();
  expect(button(i18n.t('gatewayJoin.verify'))).toBeDefined();
 });
 it('distinguishes confirmed endpoints and reflects only the currently filled address',async()=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  const alternate={endpoint_id:'public',address:'https://office.example:7443',scope:'public' as const,priority:1};
  mount(perform,[{...localGateway,member_endpoints:[...localGateway.member_endpoints!,alternate]}]);await settle();
  const suggestions=[...document.querySelectorAll<HTMLButtonElement>('[data-gateway-suggestion]')];
  expect(suggestions).toHaveLength(2);
  expect(suggestions[0]?.textContent).toContain('office.local:7443');
  expect(suggestions[1]?.textContent).toContain('office.example:7443');
  suggestions[1]!.click();await settle();
  expect(document.querySelector<HTMLInputElement>('input')?.value).toBe(alternate.address);
  expect(suggestions.map(item=>item.getAttribute('aria-pressed'))).toEqual(['false','true']);
  expect(perform.mock.calls.every(call=>call[0].operation==='status')).toBe(true);
 });
 it('excludes offline, disabled and remote Gateways and loopback addresses for remote Runtimes',async()=>{
  const perform=vi.fn().mockResolvedValue(status({joined:false,phase:'not_joined'}));
  mount(perform,[{...localGateway,status:'offline'},{...localGateway,allowed_hosts:['other.example']},{...localGateway,local_enabled:false},{...localGateway,connection_kind:'ssh_host'},
   {...localGateway,member_endpoints:[{endpoint_id:'loopback',address:'https://127.0.0.1:7443',scope:'lan',priority:0}]}]);await settle();
  expect(document.querySelector('[data-gateway-suggestion]')).toBeNull();
 });
});
