import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { RuntimeGatewayJoinPanel } from './RuntimeGatewayJoinPanel';
import { createDesktopI18n } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';
import { invitationFixture } from '../testSupport/gatewayMembershipFixture';
import type { GatewayMembershipStatus } from '../shared/gatewayJoin';
import type { DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
const i18n = createDesktopI18n('en-US');
function button(label: string) {
  const found = [...document.querySelectorAll('button')].reverse().find(el => controlText(el) === label && !el.closest('[hidden], [aria-hidden="true"]'));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function result(gateway_membership: GatewayMembershipStatus): DesktopLauncherActionResult {
  return { ok: true, outcome: 'gateway_membership_updated', gateway_membership };
}
function mount(perform: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewayJoinPanel targetID="ssh:chosen" invitation={invitationFixture} i18n={i18n} />, root);
  const trigger = button(i18n.t('gatewayJoin.title')); trigger.focus(); trigger.click(); return trigger;
}
beforeEach(() => { vi.stubGlobal('CSS', { escape: (v: string) => v }); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Runtime Gateway membership interaction', () => {
  it('only reads status on open and preserves consent input on failure and focus on close', async () => {
    const perform = vi.fn().mockResolvedValueOnce(result({ joined: false, phase: 'not_joined' }))
      .mockResolvedValueOnce({ ok: false, code: 'GATEWAY_UNAVAILABLE' })
      .mockResolvedValueOnce(result({ joined: true, phase: 'joined' }));
    const trigger = mount(perform); await settle();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:chosen', operation: 'status' });
    expect(document.body.textContent).toContain(invitationFixture.gateway_id);
    button(i18n.t('gatewayJoin.approve')).click(); await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayJoin.failed'));
    expect(button(i18n.t('gatewayJoin.approve')).disabled).toBe(false);
    button(i18n.t('gatewayJoin.approve')).click(); await settle();
    expect(perform.mock.calls[2]?.[0]).toEqual({ kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:chosen', operation: 'join', invitation: invitationFixture });
    expect(document.querySelector('[role="status"]')?.textContent).toContain(i18n.t('gatewayMembership.joined'));
    button(i18n.t('common.close')).click(); await settle();
    expect(document.activeElement).toBe(trigger);
  });
  it('requires an ownership choice and retains it when conversion cannot start', async () => {
    const perform = vi.fn().mockResolvedValueOnce(result({ joined: false, phase: 'not_joined', existing_environment_id: 'env_existing', rejoin_required: true }))
      .mockResolvedValueOnce({ ok: false, code: 'GATEWAY_UNAVAILABLE' });
    mount(perform); await settle();
    expect(button(i18n.t('gatewayJoin.approve')).disabled).toBe(true);
    expect(document.body.textContent).toContain('env_existing');
    expect(document.body.textContent).toContain(i18n.t('gatewayJoin.rejoin'));
    const options = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    options[0]!.click(); await settle();
    expect(button(i18n.t('gatewayJoin.approve')).disabled).toBe(false);
    button(i18n.t('gatewayJoin.approve')).click(); await settle();
    expect(perform.mock.calls[1]?.[0]).toMatchObject({ operation: 'join', environment_choice: 'preserve' });
    expect(options[0]!.checked).toBe(true);
    expect(document.body.textContent).toContain(i18n.t('gatewayJoin.failed'));
  });
  it('requires explicit confirmation to leave and does not join or retry automatically', async () => {
    const perform = vi.fn().mockResolvedValueOnce(result({ joined: true, phase: 'gateway_offline' }))
      .mockResolvedValueOnce(result({ joined: true, phase: 'removal_pending' }));
    mount(perform); await settle();
    button(i18n.t('gatewayMembers.leave')).click(); await settle();
    expect(perform).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayMembers.leaveImpact'));
    button(i18n.t('gatewayMembers.confirmLeave')).click(); await settle();
    expect(perform.mock.calls[1]?.[0]).toMatchObject({ operation: 'leave' });
    expect(button(i18n.t('common.retry')).disabled).toBe(true);
  });
  it('ignores a delayed operation result after close and reopen', async () => {
    let complete!: (value: DesktopLauncherActionResult) => void;
    const perform = vi.fn().mockResolvedValueOnce(result({ joined: false, phase: 'not_joined' }))
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
      .mockResolvedValueOnce(result({ joined: false, phase: 'not_joined' }));
    const trigger = mount(perform); await settle();
    button(i18n.t('gatewayJoin.approve')).click(); await settle();
    button(i18n.t('common.close')).click(); await settle();
    trigger.click(); await settle();
    complete(result({ joined: true, phase: 'joined' })); await settle();
    expect(document.querySelector('[role="status"]')?.textContent).toContain(i18n.t('gatewayMembership.not_joined'));
    expect(button(i18n.t('gatewayJoin.approve')).disabled).toBe(false);
  });
});
