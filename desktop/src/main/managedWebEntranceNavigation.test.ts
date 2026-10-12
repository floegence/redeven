import {describe,expect,it} from 'vitest';
import {ManagedWebEntranceNavigation,redactManagedEntranceAddress,applyManagedWebEntrance} from './managedWebEntranceNavigation';
describe('managed entrance navigation',()=>{
 it('handles one declared document chain and preserves application logins',()=>{
  const navigation=new ManagedWebEntranceNavigation({service_id:'mws-example',launch_generation:'container:example:launch'});
  expect(navigation.observe('script',401)).toBe(false);
  expect(navigation.observe('mainFrame',302)).toBe(false);
  expect(navigation.observe('mainFrame',401)).toBe(true);
  expect(navigation.observe('mainFrame',401)).toBe(false);
  navigation.begin(navigation.context);
  expect(navigation.observe('mainFrame',200)).toBe(false);
  expect(navigation.observe('mainFrame',403)).toBe(false);
  expect(new ManagedWebEntranceNavigation().observe('mainFrame',401)).toBe(false);
 });
 it('keeps bootstrap credentials out of the address display',()=>{
  const address=redactManagedEntranceAddress('http://127.0.0.1:3000/page?token=private&tab=one');
  expect(address).not.toContain('private');expect(address).toContain('tab=one');
 });
});

describe('managed entrance protected handoff', () => {
 const request = {url:'http://127.0.0.1:4000/pf/demo/',forward_id:'demo',target_url:'http://127.0.0.1:3080/',access_mode:'unified_proxy' as const,presentation:'browser' as const,managed_entrance:{service_id:'mws-demo',launch_generation:'old'}};
 const response = {state:'ready',app_path:'/dashboard?token=private#panel',forward:{forward_id:'demo',target_url:request.target_url},managed_entrance:{service_id:'mws-demo',launch_generation:'new'}};
 it('preserves deep links in the authorized local route', () => {
  expect(applyManagedWebEntrance(request,response).url).toBe('http://127.0.0.1:4000/pf/demo/dashboard?token=private#panel');
  expect(applyManagedWebEntrance({...request,url:'http://pf-demo.localhost:4000/'},response).url).toBe('http://pf-demo.localhost:4000/dashboard?token=private#panel');
 });
 it('retains remote E2EE bootstrap identity and ticket', () => {
  const init = {v:2,code_space_id:'demo',floe_app:'com.floegence.redeven.portforward',app_path:'/',ticket:'protected-ticket'};
  const remote = {...request,url:`https://env.example/_redeven_boot/#redeven=${Buffer.from(JSON.stringify(init)).toString('base64url')}`};
  const result=applyManagedWebEntrance(remote,response);
  const decoded=JSON.parse(Buffer.from(new URL(result.url).hash.slice(9),'base64url').toString('utf8'));
  expect(decoded).toEqual({...init,app_path:response.app_path});
 });
 it('rejects foreign service, Forward, target, path and bootstrap identity', () => {
  for (const invalid of [
   {...response,forward:{...response.forward,forward_id:'other'}},
   {...response,forward:{...response.forward,target_url:'http://127.0.0.1:3081/'}},
   {...response,managed_entrance:{...response.managed_entrance,service_id:'other'}},
   ...['//evil.invalid/','https://evil.invalid/','/%5cevil','/%2f%2fevil'].map(app_path=>({...response,app_path})),
  ]) expect(()=>applyManagedWebEntrance(request,invalid)).toThrow();
  expect(()=>applyManagedWebEntrance({...request,url:'http://127.0.0.1:4000/pf/other/'},response)).toThrow();
 });
});
