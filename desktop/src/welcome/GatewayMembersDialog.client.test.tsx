import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { GatewayMembersPanel } from './GatewayMembersDialog';
import { createDesktopI18n } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';
import { catalogFixture, invitationFixture, memberFixture } from '../testSupport/gatewayMembershipFixture';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';

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
function mount(perform: ReturnType<typeof vi.fn>, refresh = vi.fn(async () => {}), source = gateway, section: 'connection' | 'runtimes' = 'runtimes') {
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  const [current, setCurrent] = createSignal<DesktopGatewaySource | undefined>(source);
  dispose = render(() => <GatewayMembersPanel gateway={current()} section={section} targets={[]} i18n={i18n} refresh={refresh} />, root);
  return setCurrent;
}
beforeEach(() => { vi.stubGlobal('CSS', { escape: (v: string) => v }); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Gateway member management', () => {
  it('labels the address, network and priority separately without compressing the address field', async () => {
    mount(vi.fn(), undefined, gateway, 'connection'); await settle();
    const endpoint = document.querySelector('.redeven-gateway-endpoint')!;
    expect(endpoint.querySelector('label')?.textContent).toContain(i18n.t('gatewayMembers.address'));
    expect(endpoint.querySelector('.redeven-gateway-endpoint__options')?.textContent).toContain(i18n.t('gatewayMembers.scope'));
    expect(endpoint.querySelector('input[type="number"]')?.closest('label')?.textContent).toContain(i18n.t('gatewayMembers.priority'));
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
    const perform = vi.fn().mockResolvedValue({ ok: true, outcome: 'gateway_invitation_created', gateway_invitation: invitationFixture });
    mount(perform, vi.fn(async () => { throw new Error('unavailable'); })); await settle();
    button(i18n.t('gatewayMembers.createInvitation')).click(); await settle();
    expect(button(i18n.t('gatewayMembers.download')).disabled).toBe(false);
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
    complete({ ok: true, outcome: 'gateway_invitation_created', gateway_invitation: invitationFixture }); await settle();
    expect([...document.querySelectorAll('button')].map(controlText)).not.toContain(i18n.t('gatewayMembers.download'));
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
