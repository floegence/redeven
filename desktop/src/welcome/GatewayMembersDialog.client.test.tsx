import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { GatewayMembersPanel } from './GatewayMembersDialog';
import { createDesktopI18n } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';
import { catalogFixture, invitationFixture, memberFixture } from '../testSupport/gatewayMembershipFixture';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';
import type { DesktopCloudRuntimeLinkTarget } from '../shared/providerRuntimeLinkTarget';

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
const i18n = createDesktopI18n('en-US');
const gateway: DesktopGatewaySource = {
  gateway_id: 'gateway_fixture', display_name: 'Gateway', local_enabled: true, connection_kind: 'local_host',
  management_capability: 'access_only', capabilities: ['member_access', 'member_manage', 'cloud_configure'],
  status: 'online', trust_state: 'paired', created_at_ms: 1, updated_at_ms: 1,
  listener_address: catalogFixture.gateway.listener_address,
  permissions: catalogFixture.gateway.permissions, policy: catalogFixture.policy, member_endpoints: catalogFixture.gateway.member_endpoints, environments: [memberFixture],
};
function button(label: string) {
  const found = [...document.querySelectorAll('button')].find(el => controlText(el) === label && !el.closest('[hidden], [aria-hidden="true"]'));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function select(element: HTMLSelectElement, value: string) {
  element.value = value; element.dispatchEvent(new Event('change', { bubbles: true }));
}
function mount(perform: ReturnType<typeof vi.fn>, refresh = vi.fn(async () => {}), source = gateway, section: 'connection' | 'runtimes' = 'runtimes', targets: readonly DesktopCloudRuntimeLinkTarget[] = []) {
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  const [current, setCurrent] = createSignal<DesktopGatewaySource | undefined>(source);
  dispose = render(() => <GatewayMembersPanel gateway={current()} section={section} targets={targets} i18n={i18n} refresh={refresh} />, root);
  return setCurrent;
}
beforeEach(() => { vi.stubGlobal('CSS', { escape: (v: string) => v }); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('retains nested invitation consent on expiry but blocks submission until a fresh invitation is verified', async () => {
  vi.useFakeTimers();
  const delivery = { ...invitationFixture, expires_at_unix_ms: Date.now() + 1500 };
  const perform = vi.fn().mockImplementation(async request => request.kind === 'invite_gateway_runtime'
    ? { ok: true, gateway_invitation_code: delivery }
    : request.operation === 'preview'
      ? { ok: true, gateway_preview: { preview_id: 'preview', purpose: 'join', gateway_id: gateway.gateway_id, gateway_name: 'Office Gateway', target_runtime_id: 'runtime', expires_at_unix_ms: Date.now() + 60000 } }
      : { ok: true, gateway_membership: { joined: false, phase: 'not_joined' } });
  const target: DesktopCloudRuntimeLinkTarget = { id: 'ssh:runtime', kind: 'ssh_environment', environment_id: 'runtime', label: 'Runtime', runtime_key: 'runtime', runtime_url: 'https://runtime', runtime_running: true, runtime_openable: true, runtime_control_status: { state: 'available' }, provider_connection_state: 'unlinked', cloud_link_state: 'unbound', cloud_origin_supported: true, can_connect_cloud: true, can_disconnect_cloud: false };
  mount(perform, undefined, gateway, 'runtimes', [target]);
  await vi.advanceTimersByTimeAsync(40);
  button(i18n.t('gatewayMembers.createInvitation')).click();
  await vi.advanceTimersByTimeAsync(40);
  select(document.querySelectorAll<HTMLSelectElement>('.redeven-gateway-invitation-card select')[1]!, target.id);
  button(i18n.t('gatewayJoin.title')).click();
  await vi.advanceTimersByTimeAsync(40);
  button(i18n.t('gatewayJoin.verify')).click();
  await vi.advanceTimersByTimeAsync(40);
  const dialog = document.querySelector('[role="dialog"]');
  const consent = button(i18n.t('gatewayJoin.confirmEnable'));
  expect(consent.disabled).toBe(false);
  await vi.advanceTimersByTimeAsync(2000);
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  expect(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')[1]?.value).toBe(delivery.code);
  expect(consent.disabled).toBe(true);
  const count = perform.mock.calls.length; consent.click();
  expect(perform).toHaveBeenCalledTimes(count);
  expect(button(i18n.t('common.cancel')).disabled).toBe(false);
});

describe('Gateway member management', () => {
  it('keeps the connection editor focused on reachable addresses', async () => {
    mount(vi.fn(), undefined, gateway, 'connection'); await settle();
    const endpoint = document.querySelector('.redeven-gateway-endpoint')!;
    expect(endpoint.querySelector('label')?.textContent).toContain(i18n.t('gatewayMembers.address'));
    expect(endpoint.querySelector('.redeven-gateway-endpoint__options')).toBeNull();
    expect(endpoint.querySelector('input[type="number"]')).toBeNull();
    expect(endpoint.querySelector('select')).toBeNull();
    expect(document.querySelector('.redeven-gateway-endpoint')).toBeTruthy();
    expect([...document.querySelectorAll('details')].every(detail => detail.classList.contains('redeven-gateway-disclosure'))).toBe(true);
  });

  it('requires a saved reachable address before creating an invitation', async () => {
    const perform = vi.fn();
    mount(perform, undefined, { ...gateway, member_endpoints: [] }); await settle();
    expect(button(i18n.t('gatewayMembers.createInvitation')).disabled).toBe(true);
    expect(perform).not.toHaveBeenCalled();
  });
  it('preserves Gateway transport metadata while saving only the configured addresses', async () => {
    const perform = vi.fn().mockResolvedValue({ ok: true, outcome: 'gateway_endpoints_updated' });
    mount(perform, undefined, gateway, 'connection'); await settle();
    const address = document.querySelector<HTMLInputElement>('.redeven-gateway-endpoint input')!;
    address.value = 'https://gateway.example:7443';
    address.dispatchEvent(new Event('input', { bubbles: true }));
    button(i18n.t('gatewayNetwork.save')).click(); await settle();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'update_gateway_network_settings', gateway_id: gateway.gateway_id,
      settings: {listen_addresses:[gateway.listener_address],allowed_hosts:[],endpoints: [{ ...catalogFixture.gateway.member_endpoints[0]!, address: 'https://gateway.example:7443' }]} });
  });
  it('cancels an address-removal animation when the edited Gateway changes', async () => {
    const setGateway = mount(vi.fn(), undefined, gateway, 'connection'); await settle();
    document.querySelector<HTMLButtonElement>(`.redeven-gateway-endpoint-shell button[aria-label="${i18n.t('gatewayMembers.removeAddress')}"]`)!.click();
    const replacement = { ...catalogFixture.gateway.member_endpoints[0]!, endpoint_id: 'replacement_endpoint' };
    setGateway({ ...gateway, gateway_id: 'replacement_gateway', member_endpoints: [replacement] }); await settle();
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(document.querySelector('[data-endpoint-id="replacement_endpoint"]')).toBeTruthy();
    expect(document.querySelector('.redeven-gateway-endpoint-shell--removing')).toBeNull();
  });
  it('reevaluates the selected member without applying an unsaved policy edit', async () => {
    const perform = vi.fn().mockResolvedValue({ ok: true, outcome: 'gateway_members_updated' });
    mount(perform); await settle();
    select(document.querySelector<HTMLSelectElement>('li select')!, 'allow');
    button(i18n.t('gatewayMembers.reevaluate')).click(); await settle();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'reevaluate_gateway_member', gateway_id: gateway.gateway_id,
      member_id: memberFixture.member_id, member_version: memberFixture.member_version });
    expect(document.querySelector<HTMLSelectElement>('li select')!.value).toBe('allow');
  });
  it('keeps an issued invitation when the following refresh fails', async () => {
    const perform = vi.fn().mockResolvedValue({ ok: true, outcome: 'gateway_invitation_created', gateway_invitation_code: invitationFixture });
    mount(perform, vi.fn(async () => { throw new Error('unavailable'); })); await settle();
    button(i18n.t('gatewayMembers.createInvitation')).click(); await settle();
    expect(button(i18n.t('gatewayJoin.copyCode')).disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayMembers.refreshFailed'));
    expect(document.body.textContent).toContain(memberFixture.display_name);
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'invite_gateway_runtime', gateway_id: gateway.gateway_id });
  });
  it('keeps failed and missing batch results retryable, without resubmitting successful members', async () => {
    const perform = vi.fn().mockResolvedValue({ ok: true, outcome: 'gateway_members_updated', gateway_member_results: [
      { member_id: 'one', member: { ...memberFixture, member_id: 'one', cloud_permission: 'allow' } },
      { member_id: 'two', error_code: 'MEMBER_CONFLICT' },
    ] });
    mount(perform, undefined, { ...gateway, environments: ['one', 'two', 'three'].map(member_id => ({ ...memberFixture, member_id, display_name: member_id })) }); await settle();
    for (const item of document.querySelectorAll<HTMLSelectElement>('li select')) select(item, 'allow');
    button(i18n.t('gatewayMembers.confirmSave')).click(); await settle();
    expect(document.body.textContent).toContain('MEMBER_CONFLICT');
    expect(document.body.textContent).toContain(i18n.t('gatewayMembers.saved'));
    button(i18n.t('gatewayMembers.confirmSave')).click(); await settle();
    expect(perform.mock.calls[1]?.[0].items.map((item: { member_id: string }) => item.member_id)).toEqual(['two', 'three']);
  });
  it('previews only inherited members affected by a default change and requires confirmation', async () => {
    const perform = vi.fn().mockResolvedValue({ ok: true, outcome: 'gateway_members_updated' });
    mount(perform, undefined, { ...gateway, environments: [memberFixture, { ...memberFixture, member_id: 'override', display_name: 'Override', cloud_permission: 'deny' }] }); await settle();
    const checkbox = document.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"]')!;
    checkbox.click(); await settle();
    const preview = [...document.querySelectorAll('p')].find(p => p.textContent?.startsWith(i18n.t('gatewayMembers.affected')));
    expect(preview?.textContent).toContain(memberFixture.display_name);
    expect(preview?.textContent).not.toContain('Override');
    button(i18n.t('common.save')).click(); await settle();
    expect(perform).not.toHaveBeenCalled();
    button(i18n.t('gatewayMembers.confirmSave')).click(); await settle();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'update_gateway_policy', gateway_id: gateway.gateway_id, policy: { ...catalogFixture.policy, default_cloud_allowed: true } });
  });
  it('does not restore an old invitation into a closed and reopened dialog', async () => {
    let complete!: (result: DesktopLauncherActionResult) => void;
    const perform = vi.fn(() => new Promise(resolve => { complete = resolve; }));
    const setGateway = mount(perform); await settle();
    button(i18n.t('gatewayMembers.createInvitation')).click(); await settle();
    setGateway(undefined); await settle();
    setGateway(gateway); await settle();
    complete({ ok: true, outcome: 'gateway_invitation_created', gateway_invitation_code: invitationFixture }); await settle();
    expect([...document.querySelectorAll('button')].map(controlText)).not.toContain(i18n.t('gatewayJoin.copyCode'));
  });
  it('disables member and Cloud mutations for access-only pairing', async () => {
    const perform = vi.fn();
    mount(perform, undefined, { ...gateway, permissions: { access: true, manage_members: false, configure_cloud: false } }); await settle();
    expect(button(i18n.t('gatewayMembers.createInvitation')).disabled).toBe(true);
    expect(button(i18n.t('gatewayMembers.remove')).disabled).toBe(true);
    expect(button(i18n.t('gatewayMembers.reevaluate')).disabled).toBe(true);
    expect([...document.querySelectorAll('select')].every(select => select.disabled)).toBe(true);
    expect([...document.querySelectorAll('input')].filter(input => input.type !== 'hidden').every(input => input.disabled)).toBe(true);
    expect(perform).not.toHaveBeenCalled();
  });
});

describe('Gateway network configuration',()=>{
 it('separates binding from connection addresses and starts Host restrictions collapsed',async()=>{
  const perform=vi.fn().mockResolvedValue({ok:true,outcome:'gateway_members_updated'});
  mount(perform,undefined,gateway,'connection');await settle();
  const advanced=document.querySelector<HTMLDetailsElement>('[data-gateway-network-advanced]');
  expect(advanced).toBeTruthy();expect(advanced!.open).toBe(false);
  expect(document.getElementById('gateway-listen-addresses')).toBeTruthy();
  expect(document.getElementById('gateway-allowed-hosts')).toBeTruthy();
  const binding=document.getElementById('gateway-listen-addresses') as HTMLInputElement;
  binding.value='0.0.0.0:7555';binding.dispatchEvent(new Event('input',{bubbles:true}));
  button(i18n.t('gatewayNetwork.save')).click();await settle();
  expect(perform).toHaveBeenCalledExactlyOnceWith({kind:'update_gateway_network_settings',gateway_id:gateway.gateway_id,
   settings:{listen_addresses:['0.0.0.0:7555'],allowed_hosts:[],endpoints:gateway.member_endpoints}});
 });
 it('keeps drafts and shows a useful validation error for invalid listener addresses',async()=>{
  const perform=vi.fn();mount(perform,undefined,gateway,'connection');await settle();
  const binding=document.getElementById('gateway-listen-addresses') as HTMLInputElement;
  binding.value='https://bad.example:7443';binding.dispatchEvent(new Event('input',{bubbles:true}));
  button(i18n.t('gatewayNetwork.save')).click();await settle();
  expect(perform).not.toHaveBeenCalled();expect(binding.value).toBe('https://bad.example:7443');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayNetwork.invalidListen'));
  expect(document.activeElement).toBe(binding);
  expect(binding.getAttribute('aria-invalid')).toBe('true');
 });
});

it('opens advanced settings and focuses an invalid Host restriction',async()=>{
 const perform=vi.fn();mount(perform,undefined,gateway,'connection');await settle();
 const hosts=document.getElementById('gateway-allowed-hosts') as HTMLInputElement;
 hosts.value='*.example';hosts.dispatchEvent(new Event('input',{bubbles:true}));
 button(i18n.t('gatewayNetwork.save')).click();await settle();
 expect(perform).not.toHaveBeenCalled();
 expect(document.querySelector<HTMLDetailsElement>('[data-gateway-network-advanced]')?.open).toBe(true);
 expect(document.activeElement).toBe(hosts);
});

it('refreshes clean network fields from the authoritative catalog while preserving a typed draft',async()=>{
 const setGateway=mount(vi.fn(),undefined,gateway,'connection');await settle();
 const endpoint={...gateway.member_endpoints![0]!,address:'https://changed.example:7443'};
 setGateway({...gateway,member_endpoints:[endpoint],listener_addresses:['127.0.0.1:7555'],allowed_hosts:['changed.example']});await settle();
 const address=document.querySelector<HTMLInputElement>('.redeven-gateway-endpoint input')!;
 expect(address.value).toBe(endpoint.address);
 expect((document.getElementById('gateway-allowed-hosts') as HTMLInputElement).value).toBe('changed.example');
 address.value='https://draft.example:7443';address.dispatchEvent(new Event('input',{bubbles:true}));
 setGateway({...gateway,member_endpoints:[{...endpoint,address:'https://newer.example:7443'}]});await settle();
 expect(address.value).toBe('https://draft.example:7443');
});
it('disables invitation issuance when another settings tab removes all confirmed endpoints',async()=>{
 const setGateway=mount(vi.fn());await settle();
 setGateway({...gateway,member_endpoints:[]});await settle();
 expect(button(i18n.t('gatewayMembers.createInvitation')).disabled).toBe(true);
 expect(document.body.textContent).toContain(i18n.t('gatewayMembers.noConnectionAddresses'));
});

it('preserves invitation delivery and member drafts across fresh Gateway snapshots',async()=>{
 const perform=vi.fn().mockResolvedValue({ok:true,outcome:'gateway_invitation_created',gateway_invitation_code:invitationFixture});
 const setGateway=mount(perform);await settle();button(i18n.t('gatewayMembers.createInvitation')).click();await settle();
 const memberSelect=document.querySelector<HTMLSelectElement>('li select')!;select(memberSelect,'allow');
 const policyInput=document.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"]')!;policyInput.click();await settle();
 setGateway(structuredClone(gateway));await settle();
 expect(document.querySelector('.redeven-gateway-invitation-card .font-mono')?.textContent?.replaceAll('-','')).toBe(invitationFixture.code);
 expect(memberSelect.value).toBe('allow');expect(button(i18n.t('gatewayMembers.confirmSave')).disabled).toBe(false);
 expect(document.body.textContent).toContain(i18n.t('gatewayMembers.affected'));expect(perform).toHaveBeenCalledOnce();
});

it('preserves listener and Host drafts, disclosure and focus across fresh Gateway snapshots',async()=>{
 const setGateway=mount(vi.fn(),undefined,gateway,'connection');await settle();
 const binding=document.getElementById('gateway-listen-addresses') as HTMLInputElement;
 const hosts=document.getElementById('gateway-allowed-hosts') as HTMLInputElement;
 const advanced=document.querySelector<HTMLDetailsElement>('[data-gateway-network-advanced]')!;advanced.open=true;
 for(const [input,value] of [[binding,'0.0.0.0:7555'],[hosts,'draft.example']] as const){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
 hosts.focus();setGateway(structuredClone(gateway));await settle();
 expect(binding.value).toBe('0.0.0.0:7555');expect(hosts.value).toBe('draft.example');expect(advanced.open).toBe(true);expect(document.activeElement).toBe(hosts);
});

it('retains delivered invitation content but revokes copy consent across permission loss and return', async () => {
 const perform=vi.fn().mockResolvedValue({ok:true,outcome:'gateway_invitation_created',gateway_invitation_code:invitationFixture});
 const setGateway=mount(perform);await settle();button(i18n.t('gatewayMembers.createInvitation')).click();await settle();
 const copy=button(i18n.t('gatewayJoin.copyCode'));expect(copy.disabled).toBe(false);
 setGateway({...gateway,permissions:{access:true,manage_members:false,configure_cloud:false}});await settle();
 expect(button(i18n.t('gatewayJoin.copyCode'))).toBe(copy);expect(copy.disabled).toBe(true);
 setGateway({...gateway});await settle();expect(copy.disabled).toBe(true);
 button(i18n.t('gatewayMembers.createInvitation')).click();await settle();expect(copy.disabled).toBe(false);
});
