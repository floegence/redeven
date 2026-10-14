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

it.each(['ssh', 'wsl', 'local_container', 'ssh_container'] as const)('connects the running %s management bridge before exposing Gateway fields', async kind => {
  const selected = runtimeGatewayAccessFixture(kind, 'connection_required').environment;
  let complete!: (value: object) => void;
  const perform = vi.fn(() => new Promise(resolve => { complete = resolve; }));
  const refresh = vi.fn(async () => true), recover = vi.fn();
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={selected} i18n={i18n} refresh={refresh} recover={recover} edit={() => {}} close={() => {}} />, root);
  await settle();
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('0');
  expect(document.querySelectorAll('[data-floe-surface-part="step"]')).toHaveLength(3);
  expect(document.body.textContent).not.toContain(i18n.t('gatewayJoin.channelHelp'));
  expect(perform).not.toHaveBeenCalled(); expect(recover).not.toHaveBeenCalled();
  expect(document.querySelector('input')?.closest('[hidden]')).not.toBeNull();
  const connection = button('gatewayJoin.connectAndContinue');
  expect(connection.closest('.redeven-gateway-connect-stage')).not.toBeNull();
  expect(button('common.settings').closest('.redeven-gateway-connect-stage')).not.toBeNull();
  expect(document.querySelector('.redeven-gateway-join-actions')?.textContent?.trim()).toBe(i18n.t('common.cancel'));
  button('gatewayJoin.connectAndContinue').click(); await settle();
  expect(button('gatewayJoin.connecting').hasAttribute('disabled')).toBe(true);
  expect(button('gatewayJoin.connecting')).toBe(connection);
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('0');
  expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'manage_runtime_gateway', runtime_target_id: selected.provider_runtime_link_target!.id, operation: 'status' });
  complete({ ok: true, gateway_membership: { joined: false, phase: 'not_joined' } }); await settle();
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('1');
  expect(document.querySelector('input')?.closest('[hidden]')).toBeNull();
  expect(button('gatewayJoin.verify').closest('.redeven-gateway-join-scroll')).not.toBeNull();
  expect(document.activeElement).toBe(document.querySelector('input'));
  expect(recover).not.toHaveBeenCalled();
});

it('keeps connection failure in the first step with Retry and settings, then continues after success', async () => {
  const selected = runtimeGatewayAccessFixture('ssh', 'connection_required').environment;
  const perform = vi.fn().mockResolvedValueOnce({ ok: false, gateway_error_code: 'RUNTIME_CONTROL_UNREACHABLE' })
    .mockResolvedValueOnce({ ok: true, gateway_membership: { joined: false, phase: 'not_joined' } });
  const edit = vi.fn(); vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={selected} i18n={i18n} refresh={refresh} recover={vi.fn()} edit={edit} close={() => {}} />, root);
  await settle(); button('gatewayJoin.connectAndContinue').click(); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayJoin.connectFailed'));
  expect(document.querySelector('[role="alert"]')?.closest('.redeven-gateway-connect-stage')).not.toBeNull();
  expect(button('common.retry').closest('.redeven-gateway-connect-stage')).not.toBeNull();
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('0');
  expect(button('common.settings').hasAttribute('disabled')).toBe(false);
  button('common.retry').click(); await settle();
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('1');
  expect(perform.mock.calls.every(([request]) => request.operation === 'status')).toBe(true);
});

it('separates invitation entry from consent and preserves the draft when navigating back', async () => {
  const perform = vi.fn(async (request: { operation: string }) => request.operation === 'preview'
    ? { ok: true, gateway_preview: { preview_id: 'a'.repeat(43), purpose: 'join', gateway_id: 'office', gateway_name: 'Office', target_runtime_id: 'runtime', expires_at_unix_ms: Date.now() + 600000 } }
    : { ok: true, gateway_membership: { joined: false, phase: 'not_joined' } });
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={readyEnvironment} i18n={i18n} refresh={refresh} recover={vi.fn()} edit={() => {}} close={() => {}} />, root);
  await settle(); expect(perform).not.toHaveBeenCalled();
  button('gatewayJoin.connectAndContinue').click(); await settle();
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')];
  for (const [index, value] of ['https://office.example:7443', 'draft-code'].entries()) {
    inputs[index].value = value; inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
  }
  button('gatewayJoin.verify').click(); await settle();
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('2');
  expect(inputs[0].closest('[hidden]')).not.toBeNull();
  expect(document.activeElement?.tagName).toBe('H3');
  expect(document.activeElement?.textContent).toBe(i18n.t('gatewayJoin.confirmAccess'));
  expect(button('gatewayJoin.confirmEnable').closest('.redeven-gateway-join-scroll')).not.toBeNull();
  button('gatewayJoin.back').click(); await settle();
  expect(inputs[0].closest('[hidden]')).toBeNull();
  expect(inputs.map(input => input.value)).toEqual(['https://office.example:7443', 'draft-code']);
  inputs[1].value = 'new-code'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.querySelector('.redeven-gateway-join-summary')).toBeNull();
  expect(perform.mock.calls.some(([request]) => request.operation === 'join')).toBe(false);
});

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
  expect(button('gatewayJoin.startAndContinue').closest('.redeven-gateway-connect-stage')).not.toBeNull();
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
  button('gatewayJoin.connectAndContinue').click(); await settle();
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
  button('gatewayJoin.connectAndContinue').click(); await settle();
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')];
  for (const [index, value] of ['https://office.example:7443', 'draft-code'].entries()) {
    inputs[index].value = value; inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
  }
  button('gatewayJoin.verify').click(); await settle();
  setCurrent({ ...readyEnvironment, provider_runtime_link_target: { ...target, runtime_control_status: { state: 'missing', reason_code: 'auth_required', message: 'Credentials required' } } });
  await settle();
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('2');
  expect(button('gatewayJoin.confirmEnable').hasAttribute('disabled')).toBe(true);
  button('gatewayJoin.restoreConnection').click(); await settle();
  button('common.retry').click(); await settle();
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
  button('gatewayJoin.connectAndContinue').click(); await settle();
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
  expect(inputs.every(input => !input.disabled)).toBe(true);
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('2');
  expect(button('gatewayJoin.confirmEnable').hasAttribute('disabled')).toBe(true);
  button('gatewayJoin.restoreConnection').click(); await settle();
  button(operation === 'restart' ? 'environmentAction.restartRuntime' : 'environmentAction.updateRuntime').click(); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t('gatewayJoin.recoveryFailed'));
  expect(inputs.map(input => input.value)).toEqual(['https://office.example:7443', 'draft-code']);
  expect(document.body.textContent).toContain('Office');
  button(operation === 'restart' ? 'environmentAction.restartRuntime' : 'environmentAction.updateRuntime').click(); await settle();
  expect(document.querySelector('input')).toBe(inputs[0]);
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('1');
  button('gatewayJoin.verify').click(); await settle();
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


it.each(['preview', 'join', 'join_rejection'] as const)('invalidates replaced Runtime consent without swallowing a pending %s result', async operation => {
  const source = runtimeGatewayAccessFixture('ssh').environment;
  const [current, setCurrent] = createSignal(source);
  let complete!: (value: object) => void, reject!: (error: Error) => void;
  const requestedOperation = operation === 'join_rejection' ? 'join' : operation;
  const preview = { preview_id: 'a'.repeat(43), purpose: 'join', gateway_id: 'office', gateway_name: 'Office', target_runtime_id: 'runtime', expires_at_unix_ms: Date.now() + 300000 };
  const perform = vi.fn(async (request: { operation: string }) => request.operation === requestedOperation
    ? new Promise<object>((done, failed) => { complete = done; reject = failed; }) : request.operation === 'preview'
      ? { ok: true, gateway_preview: preview } : { ok: true, gateway_membership: { joined: false, phase: 'not_joined' } });
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} i18n={i18n} refresh={refresh} recover={vi.fn()} edit={() => {}} close={() => {}} />, root);
  await settle(); button('gatewayJoin.connectAndContinue').click(); await settle();
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')];
  for (const [index, value] of ['https://office.example', 'retained-code'].entries()) {
    inputs[index].value = value; inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
  }
  button('gatewayJoin.verify').click(); await settle();
  if (requestedOperation === 'join') { button('gatewayJoin.confirmEnable').click(); await settle(); }
  setCurrent({ ...source, runtime_started_at_unix_ms: source.runtime_started_at_unix_ms! + 1000 }); await settle();
  if (operation === 'join_rejection') reject(new Error('Connection closed after Runtime replacement'));
  else complete(operation === 'preview' ? { ok: true, gateway_preview: preview } : { ok: false, gateway_error_code: 'GATEWAY_MEMBERSHIP_CONFLICT' });
  await settle();
  expect(document.querySelector('.redeven-gateway-join-summary')).toBeNull();
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('1');
  expect(document.body.textContent).toContain(i18n.t(operation === 'join_rejection' ? 'gatewayJoin.failed' : 'gatewayJoin.changed'));
  expect(inputs.map(input => input.value)).toEqual(['https://office.example', 'retained-code']);
  expect(perform.mock.calls.filter(([request]) => request.operation === requestedOperation)).toHaveLength(1);
});

it('returns expired consent to invitation verification after explicit reconnection', async () => {
  const [current, setCurrent] = createSignal(readyEnvironment);
  const perform = vi.fn(async (request: { operation: string }) => request.operation === 'preview'
    ? { ok: true, gateway_preview: { preview_id: 'a'.repeat(43), purpose: 'join', gateway_id: 'office', gateway_name: 'Office', target_runtime_id: 'runtime', expires_at_unix_ms: Date.now() + 30000 } }
    : { ok: true, gateway_membership: { joined: false, phase: 'not_joined' } });
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} i18n={i18n} refresh={async () => { setCurrent(readyEnvironment); return true; }} recover={vi.fn()} edit={() => {}} close={() => {}} />, root);
  await settle(); button('gatewayJoin.connectAndContinue').click(); await settle();
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')];
  for (const [index, value] of ['https://office.example', 'retained-code'].entries()) {
    inputs[index].value = value; inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
  }
  button('gatewayJoin.verify').click(); await settle();
  setCurrent({ ...readyEnvironment, runtime_health: { ...readyEnvironment.runtime_health, status: 'offline', offline_reason_code: 'auth_required' } }); await settle();
  button('gatewayJoin.restoreConnection').click(); await settle();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60000);
  button('common.retry').click(); await settle();
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('1');
  expect(document.querySelector('.redeven-gateway-join-summary')).toBeNull();
  expect(document.body.textContent).toContain(i18n.t('gatewayJoin.expired'));
  expect(inputs[1].value).toBe('retained-code');
});

it('fences recovery completion when the same registration changes management coordinates', async () => {
  const [current, setCurrent] = createSignal(environment);
  let finish!: (value: boolean) => void;
  const recover = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const refresh = vi.fn(async () => true), perform = vi.fn();
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RuntimeGatewaySetupDialog environment={current()} i18n={i18n} refresh={refresh} recover={recover} edit={() => {}} close={() => {}} />, root);
  await settle(); button('gatewayJoin.startAndContinue').click(); await settle();
  setCurrent({ ...readyEnvironment, managed_runtime_placement: { kind: 'host_process', runtime_root: '/changed', bootstrap_strategy: 'auto', release_base_url: '' } }); await settle();
  refresh.mockClear(); finish(true); await settle();
  expect(refresh).not.toHaveBeenCalled(); expect(perform).not.toHaveBeenCalled();
  expect(document.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('0');
});
