import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { RuntimeGatewaySetupDialog } from './RuntimeGatewaySetupDialog';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopCloudRuntimeLinkTarget } from '../shared/providerRuntimeLinkTarget';
import { createDesktopI18n } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';
import { invitationFixture } from '../testSupport/gatewayMembershipFixture';
import { mixedEnvironmentFixture } from '../testSupport/mixedEnvironmentFixture';
import { runtimeGatewayAccessFixture } from '../testSupport/runtimeGatewayAccessFixture';

let dispose: (() => void) | undefined;
const i18n = createDesktopI18n('en-US');
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
function button(key: Parameters<typeof i18n.t>[0]) {
  const found = [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].find(element => controlText(element) === i18n.t(key));
  if (!found) throw new Error(`Missing button ${key}`);
  return found;
}
const target: DesktopCloudRuntimeLinkTarget = { id: 'ssh:created', kind: 'ssh_environment', environment_id: 'created', label: 'Created Runtime', runtime_key: 'created', runtime_url: 'http://localhost:12345',
  runtime_running: true, runtime_openable: true, runtime_control_status: { state: 'available' }, provider_connection_state: 'unlinked', cloud_link_state: 'unbound',
  cloud_origin_supported: false, can_connect_cloud: false, can_disconnect_cloud: false };
const original = mixedEnvironmentFixture({ linkKind: 'ssh_environment' }).snapshot.environments.find(item => item.kind === 'ssh_environment')!;
const service = { ...original.runtime_service!, compatibility: 'compatible' as const, capabilities: { ...original.runtime_service!.capabilities!, runtime_gateway: { supported: true } } };
const environment: DesktopEnvironmentEntry = { ...original, id: 'created', label: 'Created Runtime', runtime_service: undefined,
  runtime_health: { ...original.runtime_health, status: 'offline', freshness: 'fresh', offline_reason_code: 'not_started' },
  provider_runtime_link_target: { ...target, runtime_running: false, runtime_control_status: { state: 'missing', reason_code: 'not_started', message: 'Stopped' } },
};
const readyEnvironment: DesktopEnvironmentEntry = { ...environment, runtime_service: service,
  runtime_health: { ...original.runtime_health, status: 'online' }, provider_runtime_link_target: target };
const refresh = async () => true;
beforeEach(() => { vi.stubGlobal('CSS', { escape: (value: string) => value }); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('explains unsupported Runtime versions and requires an explicit update', async () => {
  const source = runtimeGatewayAccessFixture('ssh_container').environment;
  const selected = { ...source, runtime_service: { ...source.runtime_service!, capabilities: {
    ...source.runtime_service!.capabilities!, runtime_gateway: { supported: false },
  } } };
  const recover = vi.fn(async () => false), refresh = vi.fn(async () => true);
  const perform = vi.fn(); vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={selected} i18n={i18n} refresh={refresh} recover={recover} edit={() => {}} close={() => {}} />, root);
  await settle();
  expect(document.body.textContent).toContain(i18n.t('gatewayJoin.unsupportedHelp'));
  expect(refresh).toHaveBeenCalledOnce(); expect(recover).not.toHaveBeenCalled(); expect(perform).not.toHaveBeenCalled();
  button('environmentAction.updateRuntime').click(); await settle();
  expect(recover).toHaveBeenCalledExactlyOnceWith(selected, 'update');
});

it('starts the selected Runtime, verifies an administrator code, then requires local consent', async () => {
  const perform = vi.fn().mockResolvedValueOnce({ ok: true, gateway_membership: { joined: false, phase: 'not_joined' } })
    .mockResolvedValueOnce({ ok: true, gateway_preview: { preview_id: 'a'.repeat(43), purpose: 'join', gateway_id: 'gateway', gateway_name: invitationFixture.gateway_name, target_runtime_id: 'runtime', expires_at_unix_ms: invitationFixture.expires_at_unix_ms } })
 .mockResolvedValueOnce({ ok: true, gateway_membership: { joined: true, phase: 'joining' } });
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const [current, setCurrent] = createSignal<DesktopEnvironmentEntry | undefined>(environment);
  const start = vi.fn(async () => { setCurrent(readyEnvironment); return true; });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} i18n={i18n} refresh={refresh} recover={start} edit={() => {}} close={() => setCurrent(undefined)} />, root);
  await settle();
  expect(perform).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  button('gatewayJoin.startAndContinue').click(); await settle();
  expect(start).toHaveBeenCalledExactlyOnceWith(environment, 'start');
  expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'manage_runtime_gateway', runtime_target_id: target.id, operation: 'status' });
  expect([...document.querySelectorAll('button')].some(element => controlText(element) === i18n.t('gatewayMembers.createInvitation'))).toBe(false);
  expect(document.querySelector('select')).toBeNull();
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')];
  for (const [index,value] of [invitationFixture.share_address,invitationFixture.code].entries()) { inputs[index]!.value=value; inputs[index]!.dispatchEvent(new Event('input',{bubbles:true})); }
  button('gatewayJoin.verify').click(); await settle();
  expect(document.body.textContent).toContain(i18n.t('gatewayJoin.verified'));
  expect(document.body.textContent).not.toContain(invitationFixture.gateway_id);
  button('gatewayJoin.confirmEnable').click(); await settle();
  expect(perform.mock.calls[2]?.[0]).toEqual({kind:'manage_runtime_gateway',runtime_target_id:target.id,operation:'join',preview_id:'a'.repeat(43)});

});

it('keeps the saved registration after startup failure and supports cancellation without enrollment', async () => {
  const perform = vi.fn(), start = vi.fn(async () => false);
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const [current, setCurrent] = createSignal<DesktopEnvironmentEntry | undefined>(environment);
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} i18n={i18n} refresh={refresh} recover={start} edit={() => {}} close={() => setCurrent(undefined)} />, root);
  await settle(); button('gatewayJoin.startAndContinue').click(); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayJoin.recoveryFailed'));
  expect(current()).toBe(environment);
  button('common.cancel').click(); await settle();
  expect(current()).toBeUndefined(); expect(perform).not.toHaveBeenCalled();
});

it('preserves enrollment input and focus when the selected environment snapshot refreshes', async () => {
  const perform = vi.fn().mockResolvedValue({ ok: true, gateway_membership: { joined: false, phase: 'not_joined' } });
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const [current, setCurrent] = createSignal<DesktopEnvironmentEntry | undefined>(readyEnvironment);
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} i18n={i18n} refresh={refresh} recover={async () => true} edit={() => {}} close={() => setCurrent(undefined)} />, root);
  await settle();
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')];
  for (const [index, value] of ['https://draft.example:7443', 'draft-code'].entries()) {
    inputs[index]!.value = value; inputs[index]!.dispatchEvent(new Event('input', { bubbles: true }));
  }
  inputs[1]!.focus();
  setCurrent(structuredClone(current())); await settle();
  expect(document.querySelector('input')).toBe(inputs[0]);
  expect(inputs.map(input => input.value)).toEqual(['https://draft.example:7443', 'draft-code']);
  expect(document.activeElement).toBe(inputs[1]); expect(perform).toHaveBeenCalledOnce();
  button('common.cancel').click(); await settle();
  setCurrent(readyEnvironment); await settle();
  expect([...document.querySelectorAll<HTMLInputElement>('input')].map(input => input.value)).toEqual(['', '']);
});

it.each(['local', 'ssh', 'wsl', 'local_container', 'ssh_container'] as const)('starts the exact %s target only after explicit approval', async kind => {
  const selected = runtimeGatewayAccessFixture(kind, 'stopped').environment;
  const [current, setCurrent] = createSignal<DesktopEnvironmentEntry | undefined>(selected);
  const refresh = vi.fn(async () => true), recover = vi.fn(async () => {
    setCurrent(runtimeGatewayAccessFixture(kind).environment);
    return true;
  });
  const perform = vi.fn(async () => ({ ok: true, gateway_membership: { joined: false, phase: 'not_joined' } }));
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} i18n={i18n} refresh={refresh} recover={recover} edit={() => {}} close={() => setCurrent(undefined)} />, root);
  await settle();
  expect(refresh).toHaveBeenCalledOnce(); expect(recover).not.toHaveBeenCalled(); expect(perform).not.toHaveBeenCalled();
  button('gatewayJoin.startAndContinue').click(); await settle();
  expect(recover).toHaveBeenCalledExactlyOnceWith(selected, 'start');
  expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'manage_runtime_gateway', runtime_target_id: selected.provider_runtime_link_target!.id, operation: 'status' });
});

it('keeps drafts and verified consent across a failed management retry', async () => {
  const [current, setCurrent] = createSignal<DesktopEnvironmentEntry | undefined>(readyEnvironment);
  const perform = vi.fn(async (request: { operation: string }) => request.operation === 'preview' ? { ok: true,
    gateway_preview: { preview_id: 'a'.repeat(43), purpose: 'join', gateway_id: 'office', gateway_name: 'Office', target_runtime_id: 'runtime', expires_at_unix_ms: Date.now() + 600000 },
  } : { ok: true, gateway_membership: { joined: false, phase: 'not_joined' } });
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const refresh = vi.fn().mockResolvedValueOnce(false).mockImplementationOnce(async () => { setCurrent(readyEnvironment); return true; });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} i18n={i18n} refresh={refresh} recover={vi.fn()} edit={() => {}} close={() => setCurrent(undefined)} />, root);
  await settle();
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')];
  for (const [index, value] of ['https://office.example:7443', 'draft-code'].entries()) {
    inputs[index].value = value; inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
  }
  button('gatewayJoin.verify').click(); await settle();
  setCurrent({ ...readyEnvironment, provider_runtime_link_target: { ...target, runtime_control_status: { state: 'missing', reason_code: 'auth_required', message: 'Credentials required' } } });
  await settle(); button('common.retry').click(); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayJoin.checkFailed'));
  expect(inputs.map(input => input.value)).toEqual(['https://office.example:7443', 'draft-code']);
  expect(document.body.textContent).toContain('Office');
  button('common.retry').click(); await settle();
  expect(button('gatewayJoin.confirmEnable')).toBeDefined();
  expect(perform.mock.calls.some(([request]) => request.operation === 'join')).toBe(false);
});

it.each(['restart', 'update'] as const)('retains the enrollment session across failed and successful %s recovery', async operation => {
  const preview = { preview_id: 'a'.repeat(43), purpose: 'join', gateway_id: 'office', gateway_name: 'Office', target_runtime_id: 'runtime', expires_at_unix_ms: Date.now() + 600000 };
  const perform = vi.fn(async (request: { operation: string }) => request.operation === 'preview'
    ? { ok: true, gateway_preview: preview } : { ok: true, gateway_membership: { joined: false, phase: 'not_joined' } });
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const [current, setCurrent] = createSignal<DesktopEnvironmentEntry | undefined>(readyEnvironment);
  const recover = vi.fn().mockResolvedValueOnce(false).mockImplementationOnce(async () => { setCurrent(structuredClone(readyEnvironment)); return true; });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} i18n={i18n} refresh={refresh} recover={recover} edit={() => {}} close={() => setCurrent(undefined)} />, root);
  await settle();
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')];
  for (const [index, value] of ['https://office.example:7443', 'draft-code'].entries()) {
    inputs[index].value = value; inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
  }
  button('gatewayJoin.verify').click(); await settle();
  const blocked = operation === 'restart' ? { ...readyEnvironment, provider_runtime_link_target: { ...target,
    runtime_control_status: { state: 'missing' as const, reason_code: 'not_reported' as const, message: 'Restart' } } }
    : { ...readyEnvironment, runtime_operations: { ...readyEnvironment.runtime_operations,
      update: { ...readyEnvironment.runtime_operations.update, reason_code: 'runtime_update_required' } } };
  setCurrent(blocked); await settle();
  expect(inputs.every(input => input.disabled)).toBe(true);
  button(operation === 'restart' ? 'environmentAction.restartRuntime' : 'environmentAction.updateRuntime').click(); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayJoin.recoveryFailed'));
  expect(inputs.map(input => input.value)).toEqual(['https://office.example:7443', 'draft-code']);
  expect(document.body.textContent).toContain('Office');
  button(operation === 'restart' ? 'environmentAction.restartRuntime' : 'environmentAction.updateRuntime').click(); await settle();
  expect(document.querySelector('input')).toBe(inputs[0]);
  expect(controlText(button('gatewayJoin.confirmEnable'))).toBe(i18n.t('gatewayJoin.confirmEnable'));
  expect(recover).toHaveBeenNthCalledWith(1, blocked, operation);
  expect(recover).toHaveBeenNthCalledWith(2, blocked, operation);
});

it('retains settings and cancellation while another lifecycle operation owns the Runtime', async () => {
  const edit = vi.fn(), recover = vi.fn(), refresh = vi.fn();
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={environment} i18n={i18n} operationBusy refresh={refresh} recover={recover} edit={edit} close={() => {}} />, root);
  await settle();
  expect(refresh).not.toHaveBeenCalled(); expect(recover).not.toHaveBeenCalled();
  button('common.settings').click(); await settle();
  expect(edit).toHaveBeenCalledExactlyOnceWith(environment);
  expect(button('common.cancel')).toBeDefined();
});

it('reports failed management checks with Retry and ignores a response after closure', async () => {
  let resolve: ((value: boolean) => void) | undefined;
  const refresh = vi.fn().mockResolvedValueOnce(false).mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
  const [current, setCurrent] = createSignal<DesktopEnvironmentEntry | undefined>({ ...readyEnvironment,
    provider_runtime_link_target: { ...target, runtime_control_status: { state: 'missing', reason_code: 'auth_required', message: 'Credentials' } } });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} i18n={i18n} refresh={refresh} recover={vi.fn()} edit={() => {}} close={() => setCurrent(undefined)} />, root);
  await settle();
  expect(document.body.textContent).toContain(i18n.t('gatewayJoin.credentialsHelp'));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayJoin.checkFailed'));
  button('common.retry').click(); await settle(); button('common.cancel').click(); await settle();
  resolve!(false); await settle();
  expect(current()).toBeUndefined(); expect(document.querySelector('[role="alert"]')).toBeNull();
});
