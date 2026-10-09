import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { RuntimeGatewayJoinPanel } from './RuntimeGatewayJoinPanel';
import { createDesktopI18n } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';
import type { GatewayJoinPreview, GatewayMembershipStatus } from '../shared/gatewayJoin';
import type { DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';
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
function mount(perform: ReturnType<typeof vi.fn>) {
 vi.stubGlobal('redevenDesktopLauncher',{performAction:perform});
 const root=document.createElement('div');document.body.append(root);
 const [target,setTarget]=createSignal<DesktopCloudRuntimeLinkTargetID>('ssh:chosen');
 dispose=render(()=><RuntimeGatewayJoinPanel targetID={target()} targetLabel="Build Runtime" address="https://gateway.internal:7443" code="123456789ABCDEFGHJKMNPQRSTV" i18n={i18n}/>,root);
 const trigger=button(i18n.t('gatewayJoin.title'));trigger.focus();trigger.click();return {trigger,setTarget};
}
function edit(index:number,value:string){const input=[...document.querySelectorAll<HTMLInputElement>('input:not([type="radio"])')][index]!;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
beforeEach(()=>{vi.stubGlobal('CSS',{escape:(v:string)=>v});HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{dispose?.();document.body.replaceChildren();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});

describe('Runtime Gateway address and code interaction',()=>{
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
  vi.useFakeTimers();const perform=vi.fn().mockImplementation(async request=>request.operation==='preview'?verified({...preview,purpose}):status({joined:true,phase:'joined'}));mount(perform);await vi.advanceTimersByTimeAsync(50);button(i18n.t(purpose==='replace'?'gatewayJoin.replace':'gatewayJoin.updateEndpoints')).click();edit(1,'new-code');await vi.advanceTimersByTimeAsync(3100);expect(document.querySelectorAll('input')[1]?.value).toBe('new-code');button(i18n.t('gatewayJoin.verify')).click();await vi.advanceTimersByTimeAsync(50);button(i18n.t('gatewayJoin.confirmEnable')).click();await vi.advanceTimersByTimeAsync(50);expect(perform.mock.calls.find(call=>call[0].operation===purpose)?.[0]).toMatchObject({operation:purpose,preview_id:preview.preview_id});
 });
 it('retains leave confirmation and recovers polling after a transient failure',async()=>{
  vi.useFakeTimers();const perform=vi.fn().mockResolvedValueOnce(status({joined:true,phase:'joined'})).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(status({joined:true,phase:'gateway_offline'}));mount(perform);await vi.advanceTimersByTimeAsync(50);button(i18n.t('gatewayMembers.leave')).click();await vi.advanceTimersByTimeAsync(3100);expect(document.body.textContent).toContain(i18n.t('gatewayJoin.failed'));await vi.advanceTimersByTimeAsync(3100);expect(button(i18n.t('gatewayMembers.confirmLeave')).disabled).toBe(false);expect(document.querySelector('[role="status"]')?.textContent).toContain(i18n.t('gatewayMembership.gateway_offline'));
 });
 it('ignores a delayed verification after close and reopen',async()=>{
  let complete!:(value:DesktopLauncherActionResult)=>void;const perform=vi.fn().mockResolvedValueOnce(status({joined:false,phase:'not_joined'})).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;})).mockResolvedValue(status({joined:false,phase:'not_joined'}));const {trigger}=mount(perform);await settle();button(i18n.t('gatewayJoin.verify')).click();await settle();button(i18n.t('common.cancel')).click();await settle();trigger.click();await settle();complete(verified());await settle();expect(document.body.textContent).not.toContain(preview.gateway_name);
 });
});
