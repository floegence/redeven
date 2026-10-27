import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { GatewayMembersPanel } from './GatewayMembersDialog';
import { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';
import { catalogFixture, invitationFixture, memberFixture } from '../testSupport/gatewayMembershipFixture';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';

let dispose: (() => void) | undefined;
let showMembers: (() => void) | undefined;
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
  if (label === i18n.t('gatewayMembers.createInvitation') && !document.querySelector('[data-gateway-invite-others]:not([hidden])')) {
    document.querySelector<HTMLButtonElement>('[data-gateway-add-environment]')?.click();
    document.querySelector<HTMLButtonElement>('[aria-label="' + i18n.t('gatewayExperience.otherRuntime') + '"]')?.click();
  }
  const found = [...document.querySelectorAll('button')].find(el => controlText(el) === label && !el.closest('[hidden], [aria-hidden="true"]'));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function select(element: HTMLElement, value: 'allow' | 'inherit' | 'deny') {
  showMembers?.(); await settle(); element.click(); await settle();
  const menu = document.getElementById(element.getAttribute('aria-controls')!)!;
  const item = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === i18n.t('gatewayMembers.' + value as 'gatewayMembers.allow'));
  expect(item).toBeTruthy(); item!.click(); await settle();
}
function mount(perform: ReturnType<typeof vi.fn>, refresh = vi.fn(async () => {}), source = gateway, section: 'connection' | 'runtimes' = 'runtimes') {
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  const [current, setCurrent] = createSignal<DesktopGatewaySource | undefined>(source);
  const [enrolling, setEnrolling] = createSignal(false);
  showMembers = () => setEnrolling(false);
  dispose = render(() => <><GatewayMembersPanel gateway={current()} section={section} enrolling={enrolling()} onEnrollmentChange={setEnrolling} onEnroll={() => {}} i18n={i18n} refresh={refresh} />{section === 'runtimes' && <GatewayMembersPanel gateway={current()} section="policy" i18n={i18n} refresh={refresh} />}</>, root);
  return setCurrent;
}
beforeEach(() => { vi.stubGlobal('CSS', { escape: (v: string) => v }); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { showMembers = undefined; dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Gateway member management', () => {
  it.each([
    ['MEMBER_DENIED', 'gatewayMembers.memberDenied'],
    ['MEMBER_CAPACITY', 'gatewayMembers.memberCapacity'],
    ['FUTURE_GATEWAY_FAILURE', 'gatewayMembers.failed'],
  ] as const)('keeps %s technical while presenting a translated recovery message', async (code, key) => {
    mount(vi.fn().mockResolvedValue({ ok: true, outcome: 'gateway_members_updated', gateway_member_results: [{ member_id: memberFixture.member_id, error_code: code }] }));
    await settle();
    await select(document.querySelector<HTMLElement>('li [data-floe-dropdown-trigger]')!, 'allow');
    button(i18n.t('gatewayMembers.confirmSave')).click(); await settle();
    expect(document.querySelector('li [role="status"]')?.textContent).toBe(i18n.t(key));
    expect(document.querySelector('li details code')?.textContent).toBe(code);
    expect(document.querySelector('li details')?.hasAttribute('open')).toBe(false);
  });
  it.each(REDEVEN_SUPPORTED_LOCALES)('localizes policy actions, member failures, and invitation expiry in %s', async locale => {
    const localized = createDesktopI18n(locale);
    const perform = vi.fn(async (request: { kind: string }) => request.kind === 'invite_gateway_runtime'
      ? { ok: true, outcome: 'gateway_invitation_created', gateway_invitation_code: { ...invitationFixture, expires_at_unix_ms: Date.now() + 60_000 } }
      : { ok: true, outcome: 'gateway_members_updated', gateway_member_results: [{ member_id: memberFixture.member_id, error_code: 'MEMBER_VERSION_CONFLICT' }] });
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    const root = document.createElement('div'); document.body.append(root);
    const [enrolling, setEnrolling] = createSignal(false);
    dispose = render(() => <><GatewayMembersPanel gateway={gateway} section="runtimes" enrolling={enrolling()} onEnrollmentChange={setEnrolling} onEnroll={() => {}} i18n={localized} refresh={async () => {}} /><GatewayMembersPanel gateway={gateway} section="policy" i18n={localized} refresh={async () => {}} /></>, root);
    await settle();
    for (const key of ['hookMemberAdmission', 'hookSessionAccess', 'hookCloudPublication'] as const) {
      expect(document.body.textContent).toContain(localized.t(`gatewayMembers.${key}`));
    }
    const picker = document.querySelector<HTMLElement>('li [data-floe-dropdown-trigger]')!;
    picker.click(); await settle();
    const menu = document.getElementById(picker.getAttribute('aria-controls')!)!;
    const option = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === localized.t('gatewayMembers.allow'));
    expect(option).toBeTruthy(); option!.click(); await settle();
    button(localized.t('gatewayMembers.confirmSave')).click(); await settle();
    const result = document.querySelector('li [role="status"]')!;
    expect(result.textContent).toBe(localized.t('gatewayMembers.memberChanged'));
    expect(result.textContent).not.toContain('MEMBER_VERSION_CONFLICT');
    const diagnostic = document.querySelector('li details')!;
    expect(diagnostic.hasAttribute('open')).toBe(false);
    expect(diagnostic.querySelector('summary')?.textContent).toBe(localized.t('gatewayJoin.technicalDetails'));
    expect(diagnostic.querySelector('code')?.textContent).toBe('MEMBER_VERSION_CONFLICT');
    setEnrolling(true); await settle();
    document.querySelector<HTMLButtonElement>('[aria-label="' + localized.t('gatewayExperience.otherRuntime') + '"]')!.click(); await settle();
    button(localized.t('gatewayMembers.createInvitation')).click(); await settle();
    expect(document.querySelector('[role="timer"]')?.textContent).toBe(localized.tn('gatewayJoin.expiresIn', 1));
  });
  it('starts the shared enrollment task before invitation issuance or Runtime connection', async () => {
    const perform = vi.fn();
    const enroll = vi.fn();
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    const root = document.createElement('div'); document.body.append(root);
    const [enrolling, setEnrolling] = createSignal(false);
    dispose = render(() => <GatewayMembersPanel gateway={gateway} section="runtimes" enrolling={enrolling()} onEnrollmentChange={setEnrolling} i18n={i18n} refresh={async () => {}} onEnroll={enroll} />, root);
    await settle();
    const add = document.querySelector<HTMLButtonElement>('[data-gateway-add-environment]');
    expect(add).not.toBeNull();
    add!.click(); await settle();
    expect(enroll).not.toHaveBeenCalled();
    const owned = document.querySelector<HTMLButtonElement>('[aria-label="' + i18n.t('gatewayExperience.ownedRuntime') + '"]')!;
    const other = document.querySelector<HTMLButtonElement>('[aria-label="' + i18n.t('gatewayExperience.otherRuntime') + '"]')!;
    expect(document.activeElement).toBe(owned);
    other.click(); await settle();
    expect(document.activeElement?.textContent).toBe(i18n.t('gatewayMembers.invite'));
    button(i18n.t('gatewayJoin.back')).click(); await settle();
    expect(document.activeElement).toBe(other);
    button(i18n.t('gatewayJoin.back')).click(); await settle();
    expect(document.activeElement).toBe(add);
    add!.click(); await settle();
    owned.click();
    expect(enroll).toHaveBeenCalledExactlyOnceWith();
    expect(perform).not.toHaveBeenCalled();
    expect(document.querySelector('.redeven-gateway-join-layout')).toBeNull();
    expect(document.querySelector('[data-gateway-invite-others]')?.hasAttribute('hidden')).toBe(true);
  });
  it('shows an HTTPS host and port example on an empty access address', async () => {
    mount(vi.fn(), undefined, gateway, 'connection'); await settle();
    button(i18n.t('gatewayMembers.addAddress')).click(); await settle();
    const inputs=[...document.querySelectorAll<HTMLInputElement>('.redeven-gateway-endpoint input')];
    expect(inputs.at(-1)?.value).toBe('');
    expect(inputs.at(-1)?.placeholder).toBe('https://gateway.example.com:7443');
  });
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
    await select(document.querySelector<HTMLElement>('li [data-floe-dropdown-trigger]')!, 'allow');
    button(i18n.t('gatewayMembers.reevaluate')).click(); await settle();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'reevaluate_gateway_member', gateway_id: gateway.gateway_id,
      member_id: memberFixture.member_id, member_version: memberFixture.member_version });
    expect(document.querySelector('li [data-floe-dropdown-trigger]')?.textContent).toContain(i18n.t('gatewayMembers.allow'));
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
      { member_id: 'two', error_code: 'MEMBER_VERSION_CONFLICT' },
    ] });
    mount(perform, undefined, { ...gateway, environments: ['one', 'two', 'three'].map(member_id => ({ ...memberFixture, member_id, display_name: member_id })) }); await settle();
    for (const item of document.querySelectorAll<HTMLElement>('li [data-floe-dropdown-trigger]')) await select(item, 'allow');
    button(i18n.t('gatewayMembers.confirmSave')).click(); await settle();
    expect(document.body.textContent).toContain(i18n.t('gatewayMembers.memberChanged'));
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
    expect(document.querySelector<HTMLButtonElement>('[data-gateway-add-environment]')?.disabled).toBe(true);
    expect(button(i18n.t('gatewayMembers.remove')).disabled).toBe(true);
    expect(button(i18n.t('gatewayMembers.reevaluate')).disabled).toBe(true);
    expect([...document.querySelectorAll('[data-floe-dropdown-trigger]')].every(element => element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true')).toBe(true);
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
 const memberSelect=document.querySelector<HTMLElement>('li [data-floe-dropdown-trigger]')!;await select(memberSelect,'allow');
 await expect.poll(() => document.querySelector('[data-gateway-runtime-enrollment]')).toBeNull();
 const policyInput=document.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"]')!;policyInput.click();await settle();
 setGateway(structuredClone(gateway));await settle();
 expect(memberSelect.textContent).toContain(i18n.t('gatewayMembers.allow'));expect(button(i18n.t('gatewayMembers.confirmSave')).disabled).toBe(false);
 expect(document.body.textContent).toContain(i18n.t('gatewayMembers.affected'));
 document.querySelector<HTMLButtonElement>('[data-gateway-add-environment]')!.click();
 await expect.poll(() => document.querySelector('.redeven-gateway-invitation-card .font-mono')?.textContent?.replaceAll('-','')).toBe(invitationFixture.code);
 expect(perform).toHaveBeenCalledOnce();
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
