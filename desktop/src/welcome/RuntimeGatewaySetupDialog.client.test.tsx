import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { RuntimeGatewaySetupDialog } from './RuntimeGatewaySetupDialog';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopProviderRuntimeLinkTarget } from '../shared/providerRuntimeLinkTarget';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import { createDesktopI18n } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';
import { invitationFixture } from '../testSupport/gatewayMembershipFixture';

let dispose: (() => void) | undefined;
const i18n = createDesktopI18n('en-US');
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
function button(key: Parameters<typeof i18n.t>[0]) {
  const found = [...document.querySelectorAll('button')].find(element => controlText(element) === i18n.t(key));
  if (!found) throw new Error(`Missing button ${key}`);
  return found;
}
const target: DesktopProviderRuntimeLinkTarget = { id: 'ssh:created', kind: 'ssh_environment', environment_id: 'created', label: 'Created Runtime', runtime_key: 'created', runtime_url: 'http://localhost:12345',
  runtime_running: true, runtime_openable: true, runtime_control_status: { state: 'available' }, provider_connection_state: 'unlinked', provider_link_state: 'unbound',
  provider_origin_supported: false, can_connect_provider: false, can_disconnect_provider: false };
const environment = { id: 'created', label: 'Created Runtime' } as DesktopEnvironmentEntry;
const gateway = { gateway_id: 'local-registration', display_name: 'Office', local_enabled: true, permissions: { manage_members: true } } as DesktopGatewaySource;
beforeEach(() => { vi.stubGlobal('CSS', { escape: (value: string) => value }); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('starts the selected Runtime, issues an invitation from the selected Gateway, then requires local consent', async () => {
  const perform = vi.fn().mockResolvedValueOnce({ ok: true, gateway_membership: { joined: false, phase: 'not_joined' } })
    .mockResolvedValueOnce({ ok: true, gateway_invitation: invitationFixture })
    .mockResolvedValueOnce({ ok: true, gateway_membership: { joined: true, phase: 'joining' } });
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const [current, setCurrent] = createSignal<DesktopEnvironmentEntry | undefined>(environment);
  const start = vi.fn(async () => { setCurrent({ ...environment, provider_runtime_link_target: target }); return true; });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} gateways={[gateway]} i18n={i18n} start={start} close={() => setCurrent(undefined)} />, root);
  await settle();
  expect(perform).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  button('gatewayJoin.startAndContinue').click(); await settle();
  expect(start).toHaveBeenCalledExactlyOnceWith(environment);
  expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'manage_runtime_gateway', runtime_target_id: target.id, operation: 'status' });
  const selection = document.querySelector('select')!;
  selection.value = gateway.gateway_id; selection.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(); button('gatewayMembers.createInvitation').click(); await settle();
  expect(perform.mock.calls[1]?.[0]).toEqual({ kind: 'invite_gateway_runtime', gateway_id: gateway.gateway_id });
  expect(perform).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain(i18n.t('gatewayJoin.invitationReady'));
  expect(document.body.textContent).not.toContain(invitationFixture.gateway_id);
  button('gatewayJoin.approve').click(); await settle();
  expect(perform.mock.calls[2]?.[0]).toEqual({ kind: 'manage_runtime_gateway', runtime_target_id: target.id, operation: 'join', invitation: invitationFixture });
});

it('keeps the saved registration after startup failure and supports cancellation without enrollment', async () => {
  const perform = vi.fn(), start = vi.fn(async () => false);
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const [current, setCurrent] = createSignal<DesktopEnvironmentEntry | undefined>(environment);
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} gateways={[]} i18n={i18n} start={start} close={() => setCurrent(undefined)} />, root);
  await settle(); button('gatewayJoin.startAndContinue').click(); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayJoin.startFailed'));
  expect(current()).toBe(environment);
  button('gatewayJoin.notNow').click(); await settle();
  expect(current()).toBeUndefined(); expect(perform).not.toHaveBeenCalled();
});
