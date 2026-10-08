import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
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
function mount(perform: ReturnType<typeof vi.fn>, suppliedInvitation = true) {
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewayJoinPanel targetID="ssh:chosen" invitation={suppliedInvitation ? invitationFixture : undefined} i18n={i18n} />, root);
  const trigger = button(i18n.t('gatewayJoin.title')); trigger.focus(); trigger.click(); return trigger;
}
beforeEach(() => { vi.stubGlobal('CSS', { escape: (v: string) => v }); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Runtime Gateway membership interaction', () => {
  it('rejects obsolete invitations and directs the user to request a new one', async () => {
    const perform = vi.fn().mockResolvedValue(result({ joined: false, phase: 'not_joined' }));
    mount(perform, false);
    await settle();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const obsolete = { ...invitationFixture, protocol_version: 'redeven-gateway-v4' };
    Object.defineProperty(input, 'files', { value: [{ size: 1000, text: async () => JSON.stringify(obsolete) }] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(i18n.t('gatewayJoin.invalid'));
    expect(i18n.t('gatewayJoin.invalid')).toContain('new invitation');
    expect(button(i18n.t('gatewayJoin.approve')).disabled).toBe(true);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it('keeps polling after a transient failure and preserves pending consent', async () => {
    vi.useFakeTimers();
    const perform = vi.fn().mockResolvedValueOnce(result({ joined: true, phase: 'joined' }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(result({ joined: true, phase: 'gateway_offline' }));
    mount(perform); await vi.advanceTimersByTimeAsync(50);
    button(i18n.t('gatewayMembers.leave')).click();
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.body.textContent).toContain(i18n.t('gatewayJoin.failed'));
    expect(document.querySelector('[role="status"]')?.textContent).toContain(i18n.t('gatewayMembership.joined'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(perform).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[role="status"]')?.textContent).toContain(i18n.t('gatewayMembership.gateway_offline'));
    expect(button(i18n.t('gatewayMembers.confirmLeave')).disabled).toBe(false);
    button(i18n.t('common.close')).click();
    await vi.advanceTimersByTimeAsync(6000);
    expect(perform).toHaveBeenCalledTimes(3);
  });

  it.each(['replace', 'updateEndpoints'] as const)('preserves an imported %s invitation across status polling', async operation => {
    vi.useFakeTimers();
    const perform = vi.fn().mockResolvedValue(result({ joined: true, phase: 'joined' }));
    mount(perform, false); await vi.advanceTimersByTimeAsync(50);
    button(i18n.t(`gatewayJoin.${operation}`)).click();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [{ size: 1000, text: async () => JSON.stringify(invitationFixture) }] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(3100);
    expect(perform).toHaveBeenCalledTimes(2);
    const confirm = button(i18n.t(operation === 'replace' ? 'gatewayJoin.confirmReplace' : 'gatewayJoin.updateEndpoints'));
    expect(confirm.disabled).toBe(false);
    confirm.click(); await vi.advanceTimersByTimeAsync(50);
    expect(perform.mock.calls.at(-1)?.[0]).toMatchObject({ operation: operation === 'replace' ? 'replace' : 'update-endpoints', invitation: invitationFixture });
  });
  it('preserves leave confirmation across status polling', async () => {
    vi.useFakeTimers();
    const perform = vi.fn().mockResolvedValue(result({ joined: true, phase: 'joined' }));
    mount(perform); await vi.advanceTimersByTimeAsync(50);
    button(i18n.t('gatewayMembers.leave')).click();
    await vi.advanceTimersByTimeAsync(3100);
    expect(button(i18n.t('gatewayMembers.confirmLeave')).disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayMembers.leaveImpact'));
  });
  it('only reads status on open and preserves consent input on failure and focus on close', async () => {
    const perform = vi.fn().mockResolvedValueOnce(result({ joined: false, phase: 'not_joined' }))
      .mockResolvedValueOnce({ ok: false, code: 'GATEWAY_UNAVAILABLE' })
      .mockResolvedValueOnce(result({ joined: true, phase: 'joined' }));
    const trigger = mount(perform); await settle();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:chosen', operation: 'status' });
    expect(document.body.textContent).toContain(i18n.t('gatewayJoin.invitationReady'));
    expect(document.body.textContent).toContain(invitationFixture.gateway_name);
    expect([...document.querySelectorAll('details')].every(detail => !detail.open)).toBe(true);
    expect(button(i18n.t('gatewayJoin.chooseFile'))).toBeDefined();
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
    expect(document.body.textContent).toContain(i18n.t('gatewayJoin.existingEnvironmentHelp'));
    expect(document.body.textContent).not.toContain('env_existing');
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
  it('opens from the environment actions menu without rendering an inline card control', async () => {
    const perform = vi.fn().mockResolvedValue(result({ joined: false, phase: 'not_joined' }));
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    const [request, setRequest] = createSignal(0);
    const root = document.createElement('div'); document.body.append(root);
    dispose = render(() => <RuntimeGatewayJoinPanel targetID="ssh:chosen" invitation={invitationFixture} i18n={i18n} hideTrigger openRequest={request()} />, root);
    await settle();
    expect(perform).not.toHaveBeenCalled();
    setRequest(1); await settle();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:chosen', operation: 'status' });
    expect([...document.querySelectorAll('button')].some(element => controlText(element) === i18n.t('gatewayJoin.title'))).toBe(false);
    expect(document.body.textContent).toContain(i18n.t('gatewayJoin.invitationReady'));
  });
});
