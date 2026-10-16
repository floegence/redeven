// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { controlText } from '../../testSupport/controlText';
import { RemoteDesktopPanel } from './RemoteDesktopPanel';
import { WebServiceWindowOpenError } from '../services/webServiceWindows';
import { LocalApiError } from '../services/localApi';
import type { RemoteDesktopStatus } from '../services/remoteDesktopApi';

const state = vi.hoisted(() => ({
  ssh: false, label: 'server', hostname: 'server.example', local: true, full: true, desktop: true,
  status: vi.fn(), create: vi.fn(), open: vi.fn(), disconnect: vi.fn(), save: vi.fn(), forget: vi.fn(), permission: vi.fn(),
  deployment: vi.fn(), progress: vi.fn(),
}));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ name: state.local ? 'Local Environment' : 'Research host', agent: { hostname: state.hostname }, permissions: { can_read: true, can_write: state.full, can_execute: state.full } }),
  env_id: () => 'env-fixture', localRuntime: () => state.local ? {} : null,
}) }));
vi.mock('../services/desktopSessionContext', () => ({ readDesktopSessionContextSnapshot: () => state.label ? { label: state.label, target_kind: state.ssh ? 'ssh_environment' : 'local' } : null }));
vi.mock('../services/desktopShellBridge', () => ({ desktopShellWebServiceWindowOpenAvailable: () => state.desktop,
  remoteDesktopDeploymentInDesktopShell: state.deployment, onRemoteDesktopDeploymentProgress: state.progress,
}));
vi.mock('../services/webServiceWindows', async original => ({ ...await original<object>(), resolveWebServiceOpenRoute: () => ({ kind: 'local_proxy', url: '/pf/one/' }), openWebServiceRoute: state.open }));
vi.mock('../services/remoteDesktopApi', async original => ({ ...await original<object>(), getRemoteDesktopStatus: state.status, createRemoteDesktop: state.create, disconnectRemoteDesktop: state.disconnect, setRemoteDesktopUnattended: state.save, forgetRemoteDesktopAuthorization: state.forget }));
vi.mock('../services/hostApplicationsApi', async original => ({ ...await original<object>(), requestHostApplicationPermission: state.permission }));

const ready: RemoteDesktopStatus = {
  capabilities: { backend: 'macos', state: 'ready', screen: true, input: true, audio: true, clipboard: true, unattended: true, displays: [{ id: 'one', name: 'Studio Display', width: 2560, height: 1440, scale: 1, primary: true }] },
  unattended: false, control_in_use: false, last_display_id: '',
};
let host: HTMLElement, dispose: (() => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks(); state.ssh = false; state.label = 'server'; state.hostname = 'server.example'; state.local = true; state.full = true; state.desktop = true;
  state.status.mockResolvedValue(structuredClone(ready));
  state.create.mockResolvedValue({ id: 'one', forward_id: 'pf-one', target_url: 'http://127.0.0.1:40201' });
  state.open.mockResolvedValue(undefined); state.disconnect.mockResolvedValue(undefined); state.save.mockResolvedValue({ unattended: true });
  state.deployment.mockResolvedValue({ ok: true, available: false }); state.progress.mockReturnValue(() => {});
  host = document.createElement('main'); document.body.append(host);
});
afterEach(() => { dispose?.(); host.remove(); vi.restoreAllMocks(); });
const button = (name: string) => [...host.querySelectorAll('button')].find(item => controlText(item) === name || item.getAttribute('aria-label') === name)!;
async function mount() { dispose = render(() => <RemoteDesktopPanel />, host); await vi.waitFor(() => expect(state.status).toHaveBeenCalled()); await vi.waitFor(() => expect(host.querySelector('.remote-desktop-connect')).toBeTruthy()); }

it.each([
  { label: 'server', local: true, hostname: 'server.example', expected: 'server' },
  { label: '', local: true, hostname: 'server.example', expected: 'server.example' },
  { label: '', local: false, hostname: 'server.example', expected: 'Research host' },
  { label: '', local: true, hostname: '', expected: 'env-fixture' },
])('identifies the actual connection as $expected', async test => {
  Object.assign(state, test); await mount();
  expect(host.textContent).toContain(test.expected); expect(host.textContent).not.toContain('Local Environment');
  button('Connect to desktop').click();
  await vi.waitFor(() => expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ host_name: test.expected })));
});

it('keeps a failed connection visible after a successful status refresh', async () => {
  state.create.mockRejectedValue(new LocalApiError({ status: 503, code: 'DESKTOP_UNAVAILABLE', message: 'Remote desktop request failed' }));
  await mount(); button('Connect to desktop').click();
  await vi.waitFor(() => expect(host.querySelector('[role=alert]')?.textContent).toContain('Could not connect to the desktop'));
  button('Refresh').click(); await vi.waitFor(() => expect(state.status).toHaveBeenCalledTimes(3));
  expect(host.querySelector('[role=alert]')?.textContent).toContain('DESKTOP_UNAVAILABLE');
  expect(host.textContent).not.toContain('desktop operation');
});

it.each(['locked', 'session_unavailable', 'unsupported', 'unavailable', 'setup_required'])('does not offer a connection when the host is %s', async value => {
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, state: value } });
  await mount(); expect(button('Connect to desktop').disabled).toBe(true);
});

it('permits the connection that triggers Wayland system authorization', async () => {
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, backend: 'wayland', state: 'ready', authorization: 'needs_consent', displays: [] } });
  await mount(); expect(button('Connect to desktop').disabled).toBe(false);
  expect(host.textContent).toContain('Confirm screen sharing on the host');
});

it('keeps advanced settings out of the initial connection flow and avoids a single-display selector', async () => {
  await mount(); expect(host.querySelector('select')).toBeNull();
  const options = host.querySelector<HTMLDetailsElement>('.remote-desktop-options')!;
  expect(options.open).toBe(false); expect(host.textContent).not.toContain('Connect automatically after first approval');
  expect(host.textContent).not.toContain('Unattended reconnection'); expect(state.save).not.toHaveBeenCalled();
});

it('reports a blocked popup without creating a server session', async () => {
  state.desktop = false; vi.spyOn(window, 'open').mockReturnValue(null);
  await mount(); button('Connect to desktop').click();
  await vi.waitFor(() => expect(host.querySelector('[role=alert]')?.textContent).toContain('allow popups'));
  expect(state.create).not.toHaveBeenCalled();
});

it('releases a session when the viewer window cannot open and explains the failure', async () => {
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, backend: 'wayland', state: 'ready', authorization: 'needs_consent' } });
  state.open.mockRejectedValue(new WebServiceWindowOpenError('Invalid Web Service window request.'));
  await mount(); button('Connect to desktop').click();
  await vi.waitFor(() => expect(state.disconnect).toHaveBeenCalledWith('one'));
  expect(host.querySelector('[role=alert]')?.textContent).toContain('The desktop window could not open');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Invalid Web Service window request.');
  expect(host.querySelector('.remote-desktop-guidance')).toBeNull();
});

it('cleans up an unfinished connection if the panel is dismissed before creation returns', async () => {
  let complete!: (value: object) => void;
  state.create.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await mount(); button('Connect to desktop').click(); dispose?.(); dispose = undefined;
  complete({ id: 'one', forward_id: 'pf-one', target_url: 'http://127.0.0.1:40201' });
  await vi.waitFor(() => expect(state.disconnect).toHaveBeenCalledWith('one'));
  expect(state.open).not.toHaveBeenCalled();
});

it('cancels a pending connection and releases its late session without opening a viewer', async () => {
  let finish!: (value: object) => void;
  state.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); button('Connect to desktop').click();
  expect(host.querySelector('[role=status]')?.textContent).toContain('Connecting');
  button('Cancel').click();
  expect(button('Connect to desktop').disabled).toBe(false);
  finish({ id: 'late-one', forward_id: 'pf-one', target_url: 'http://127.0.0.1:40201' });
  await vi.waitFor(() => expect(state.disconnect).toHaveBeenCalledWith('late-one'));
  expect(state.open).not.toHaveBeenCalled();
});

it('does not let a canceled connection clear a newer connection in progress', async () => {
  let first!: (value: object) => void, second!: (value: object) => void;
  state.create.mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
  await mount(); button('Connect to desktop').click(); button('Cancel').click();
  button('Connect to desktop').click();
  first({ id: 'late-one', forward_id: 'pf-one', target_url: 'http://127.0.0.1:40201' });
  await vi.waitFor(() => expect(state.disconnect).toHaveBeenCalledWith('late-one'));
  expect(button('Cancel')).toBeTruthy(); expect(state.open).not.toHaveBeenCalled();
  second({ id: 'current', forward_id: 'pf-current', target_url: 'http://127.0.0.1:40201' });
  await vi.waitFor(() => expect(state.open).toHaveBeenCalledOnce());
});

it('keeps takeover confirmation in the panel and lets Escape return to connection options', async () => {
  state.status.mockResolvedValue({ ...ready, control_in_use: true });
  await mount(); button('Connect to desktop').click();
  expect(document.querySelector('[role=dialog]')).toBeNull();
  const step = host.querySelector<HTMLElement>('.remote-desktop-inline-step')!;
  step.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(host.querySelector('.remote-desktop-inline-step')).toBeNull();
  expect(state.create).not.toHaveBeenCalled();
});

it('requires full environment access in both view and control modes', async () => {
  state.full = false; await mount(); expect(button('Connect to desktop').disabled).toBe(true);
  expect(host.textContent).toContain('Read, write, and execute permissions');
});

it('preserves the chosen display across refreshes and replaces a removed display', async () => {
  const displays = [...ready.capabilities.displays, { ...ready.capabilities.displays[0], id: 'two', name: 'Second display', primary: false }];
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, displays }, last_display_id: 'two' });
  await mount();
  const select = host.querySelector('select')!; expect(select.value).toBe('two');
  select.value = 'one'; select.dispatchEvent(new Event('change', { bubbles: true }));
  button('Refresh').click(); await vi.waitFor(() => expect(state.status).toHaveBeenCalledTimes(2)); expect(select.value).toBe('one');
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, displays: [displays[1]] } });
  button('Refresh').click(); await vi.waitFor(() => expect(host.querySelector('select')).toBeNull());
  button('Connect to desktop').click(); await vi.waitFor(() => expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ display_id: 'two' })));
});

it('reports permission-setting failures and permits view-only access without input permission', async () => {
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, input: false } });
  state.permission.mockRejectedValue(new LocalApiError({ status: 503, code: 'HOST_APPLICATION_UNAVAILABLE', message: 'Permission request failed' }));
  await mount(); expect(button('Connect to desktop').disabled).toBe(true);
  button('Allow accessibility').click();
  await vi.waitFor(() => expect(host.querySelector('[role=alert]')?.textContent).toContain('Could not open the host’s permission settings'));
  const view = host.querySelector<HTMLInputElement>('[role=switch]')!; view.click();
  expect(button('Connect to desktop').disabled).toBe(false);
  button('Connect to desktop').click(); await vi.waitFor(() => expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'view' })));
});

it('requires an explicit takeover instead of replacing an existing controller', async () => {
  state.status.mockResolvedValue({ ...ready, control_in_use: true });
  await mount(); button('Connect to desktop').click(); expect(state.create).not.toHaveBeenCalled();
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => controlText(item) === 'Take control')!;
  expect(confirm).toBeTruthy(); confirm.click();
  await vi.waitFor(() => expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ takeover: true })));
});


it('exposes Wayland approval reuse before connecting and waits for the saved setting', async () => {
  let saved!: () => void;
  const wayland = { ...ready, capabilities: { ...ready.capabilities, backend: 'wayland', state: 'ready', authorization: 'needs_consent' } };
  state.status.mockResolvedValue(wayland);
  state.save.mockImplementation(() => new Promise<void>(resolve => { saved = resolve; }));
  await mount();
  const sharing = host.querySelector<HTMLInputElement>('.remote-desktop-sharing [role=switch]')!;
  expect(sharing).toBeTruthy(); expect(sharing.closest('details')).toBeNull();
  expect(sharing.checked).toBe(false); expect(state.save).not.toHaveBeenCalled();
  sharing.click();
  await vi.waitFor(() => expect(state.save).toHaveBeenCalledWith(true));
  expect(button('Connect to desktop').disabled).toBe(true);
  state.status.mockResolvedValue({ ...wayland, unattended: true }); saved();
  await vi.waitFor(() => expect(button('Connect to desktop').disabled).toBe(false));
  expect(host.querySelector('.remote-desktop-state')?.textContent).toContain('First connection needs host approval');
  expect(host.querySelector('.remote-desktop-guidance')).not.toBeNull();
  button('Connect to desktop').click();
  await vi.waitFor(() => expect(state.create).toHaveBeenCalledOnce());
});


it('only reports saved authorization from the native state and confirms forgetting it', async () => {
  const wayland = { ...ready, unattended: true, capabilities: { ...ready.capabilities, backend: 'wayland', authorization: 'saved' } };
  state.status.mockResolvedValue(wayland);
  await mount();
  expect(host.querySelector('.remote-desktop-state')?.textContent).toContain('Sharing approval saved');
  host.querySelector<HTMLDetailsElement>('.remote-desktop-options')!.open = true;
  button('Request approval again').click();
  expect(state.forget).not.toHaveBeenCalled();
  const confirm = [...document.querySelectorAll('button')].find(item => controlText(item) === 'Remove saved approval')!;
  state.forget.mockResolvedValue({ authorization: 'needs_consent' });
  state.status.mockResolvedValue({ ...wayland, capabilities: { ...wayland.capabilities, authorization: 'needs_consent' } });
  confirm.click();
  await vi.waitFor(() => expect(state.forget).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(host.querySelector('.remote-desktop-state')?.textContent).toContain('First connection needs host approval'));
});

it.each(['unknown', 'revoked', 'unsupported'] as const)('does not call %s approval saved', async authorization => {
  state.status.mockResolvedValue({ ...ready, unattended: true, capabilities: { ...ready.capabilities, backend: 'wayland', authorization, unattended: authorization !== 'unsupported' } });
  await mount();
  expect(host.querySelector('.remote-desktop-state')?.textContent).not.toContain('Sharing approval saved');
  expect(button('Connect to desktop').disabled).toBe(false);
});

it('requests a masked password only for a matching challenge and clears it after submission', async () => {
  state.ssh = true;
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'host_action_required' }, login_service: { state: 'not_installed', backend: 'linux-drm-kms' } });
  let finish!: (value: object) => void;
  state.deployment.mockImplementation(request => request.action === 'capabilities' ? Promise.resolve({ok:true,available:true}) : request.action === 'respond' ? Promise.resolve({ok:true}) : new Promise(resolve => { finish=resolve; }));
  await mount(); await vi.waitFor(() => expect(button('Connect to desktop')).toBeDefined()); button('Connect to desktop').click();
  expect(host.querySelector('input[type=password]')).toBeNull();
  expect(host.textContent).toContain('root system service'); expect(document.querySelector('[role=dialog]')).toBeNull();
  button('Authorize and continue').click();
  await vi.waitFor(() => expect(state.deployment.mock.calls.some(([r]) => r.action==='manage')).toBe(true));
  const current=state.deployment.mock.calls.find(([r])=>r.action==='manage')![0];
  const report=state.progress.mock.calls[0][0];
  report({operation_id:'stale',stage:'authorization_required',challenge_id:'old'});
  expect(host.querySelector('input[type=password]')).toBeNull();
  report({operation_id:current.operationId,stage:'authorization_required',challenge_id:'password',host:'host.example',ssh_user:'tang'});
  const password=host.querySelector<HTMLInputElement>('input[type=password]')!;
  password.value='ephemeral-fixture';password.dispatchEvent(new Event('input',{bubbles:true}));button('Authorize and continue').click();
  expect(host.querySelector('input[type=password]')).toBeNull();
  await vi.waitFor(()=>expect(state.deployment).toHaveBeenCalledWith({action:'respond',operationId:current.operationId,challengeId:'password',administratorPassword:'ephemeral-fixture'}));
  finish({ok:false,code:'authorization_failed'});
  await vi.waitFor(()=>expect(host.querySelector('[role=alert]')?.textContent).toContain('Administrator authorization was not accepted'));
  expect(host.querySelector('input[type=password]')).toBeNull();expect(state.permission).not.toHaveBeenCalled();expect(state.create).not.toHaveBeenCalled();
});

it('continues from authorized setup to the desktop in the same dialog flow', async () => {
  const setupNeeded = { ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'host_action_required' }, login_service: { state: 'not_installed', backend: 'linux-drm-kms' } };
  const installed: RemoteDesktopStatus = { ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'ready' }, login_service: { state: 'active', backend: 'linux-drm-kms' } };
  state.status.mockResolvedValueOnce(setupNeeded);
  let finishDeployment!: (value: object) => void, finishConnection!: (value: object) => void;
  state.ssh = true; state.deployment.mockImplementation(request => request.action === 'capabilities' ? Promise.resolve({ ok: true, available: true }) : new Promise(resolve => { finishDeployment = resolve; }));
  state.create.mockImplementation(() => new Promise(resolve => { finishConnection = resolve; }));
  await mount(); await vi.waitFor(() => expect(button('Connect to desktop')).toBeDefined());
  button('Connect to desktop').click();
  const flow = document.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!;
  button('Authorize and continue').click();
  expect(flow.querySelector('input[type=password]')).toBeNull();

  let finishStatus!: (value: RemoteDesktopStatus) => void;
  state.status.mockImplementation(() => new Promise(resolve => { finishStatus = resolve; }));
  finishDeployment({ ok: true });
  await vi.waitFor(() => expect(flow.querySelector('.remote-desktop-flow-transition[data-phase="connecting"]')?.textContent).toContain('Connecting to desktop'));
  expect(flow.querySelectorAll('.remote-desktop-flow-transition[data-phase="connecting"]')).toHaveLength(1);
  state.status.mockResolvedValue(installed);
  finishStatus(installed);
  await vi.waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  expect(document.querySelector('.remote-desktop-deployment-flow')).toBe(flow);
  expect(flow.querySelector('.remote-desktop-flow-transition[data-phase="connecting"]')?.textContent).toContain('Connecting to desktop');
  expect(flow.querySelector('input[type=password]')).toBeNull();
  finishConnection({ id: 'one', forward_id: 'pf-one', target_url: 'http://127.0.0.1:40201' });
  await vi.waitFor(() => expect(document.querySelector('.remote-desktop-deployment-flow')).toBeNull());
  expect(state.open).toHaveBeenCalledOnce();
});

it('does not connect automatically after a service-management action from advanced options', async () => {
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'ready' }, login_service: { state: 'active', backend: 'linux-drm-kms' } });
  state.ssh = true; state.deployment.mockImplementation(request => Promise.resolve(request.action === 'capabilities' ? { ok: true, available: true } : { ok: true }));
  await mount();
  host.querySelector<HTMLDetailsElement>('.remote-desktop-options')!.open = true;
  const update = [...host.querySelectorAll<HTMLButtonElement>('.remote-desktop-options button')].find(item => controlText(item) === 'Prepare remote desktop')!;
  update.click();
  const flow = document.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!;
  [...flow.querySelectorAll('button')].find(item => controlText(item) === 'Authorize and continue')!.click();
  await vi.waitFor(() => expect(state.deployment).toHaveBeenCalledWith(expect.objectContaining({ action: 'manage', operation: 'ensure' })));
  [...flow.querySelectorAll('button')].find(item => controlText(item) === 'Back to connection')!.click();
  await vi.waitFor(() => expect(document.querySelector('.remote-desktop-deployment-flow')).toBeNull());
  expect(state.create).not.toHaveBeenCalled();
});

it('keeps a failed post-setup connection recoverable without repeating authorization', async () => {
  const setupNeeded = { ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'host_action_required' }, login_service: { state: 'not_installed', backend: 'linux-drm-kms' } };
  const installed = { ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'ready' }, login_service: { state: 'active', backend: 'linux-drm-kms' } };
  state.status.mockResolvedValueOnce(setupNeeded).mockResolvedValue(installed);
  state.ssh = true; state.deployment.mockImplementation(request => Promise.resolve(request.action === 'capabilities' ? { ok: true, available: true } : { ok: true }));
  state.create.mockRejectedValueOnce(new LocalApiError({ status: 503, code: 'DESKTOP_UNAVAILABLE', message: 'Remote desktop request failed' }));
  await mount(); await vi.waitFor(() => expect(button('Connect to desktop')).toBeDefined());
  button('Connect to desktop').click();
  const flow = document.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!;
  [...flow.querySelectorAll('button')].find(item => controlText(item) === 'Authorize and continue')!.click();
  await vi.waitFor(() => expect(flow.querySelector('[role=alert]')?.textContent).toContain('Could not connect to the desktop'));
  expect(flow.textContent).toContain('DESKTOP_UNAVAILABLE');
  await vi.waitFor(() => expect([...flow.querySelectorAll('button')].find(item => controlText(item) === 'Connect to desktop')?.disabled).toBe(false));
  [...flow.querySelectorAll('button')].find(item => controlText(item) === 'Connect to desktop')!.click();
  await vi.waitFor(() => expect(state.create).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(document.querySelector('.remote-desktop-deployment-flow')).toBeNull());
  expect(state.deployment.mock.calls.filter(([request]) => request.action === 'manage')).toHaveLength(1);
});

it('does not let a canceled retry skip a newer authorization step', async () => {
  const installed: RemoteDesktopStatus = { ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'ready' }, login_service: { state: 'active', backend: 'linux-drm-kms' } };
  state.status.mockResolvedValueOnce({ ...installed, login_service: { state: 'not_installed', backend: 'linux-drm-kms' } }).mockResolvedValue(installed);
  state.ssh = true; state.deployment.mockImplementation(request => Promise.resolve(request.action === 'capabilities' ? { ok: true, available: true } : { ok: true }));
  state.create.mockRejectedValueOnce(new LocalApiError({ status: 503, code: 'DESKTOP_UNAVAILABLE', message: 'Remote desktop request failed' }));
  await mount(); await vi.waitFor(() => expect(button('Connect to desktop')).toBeDefined());
  button('Connect to desktop').click(); button('Authorize and continue').click();
  await vi.waitFor(() => expect(button('Connect to desktop')?.disabled).toBe(false));
  let finishStatus!: (value: RemoteDesktopStatus) => void;
  state.status.mockImplementation(() => new Promise(resolve => { finishStatus = resolve; }));
  button('Connect to desktop').click();
  button('Back to connection').click();
  host.querySelector<HTMLDetailsElement>('.remote-desktop-options')!.open = true;
  button('Prepare remote desktop').click();
  expect(host.querySelector('[data-phase=authorizing]')).not.toBeNull();
  state.status.mockResolvedValue(installed); finishStatus(installed);
  await vi.waitFor(() => expect(button('Authorize and continue')?.disabled).toBe(false));
  expect(state.create).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-phase=authorizing]')).not.toBeNull();
});

it('cancels post-setup status checking without opening the late desktop', async () => {
  state.status.mockResolvedValueOnce({ ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'setup_required' }, login_service: { state: 'not_installed', backend: 'linux-drm-kms' } });
  let finishStatus!: (value: RemoteDesktopStatus) => void;
  state.ssh = true; state.deployment.mockImplementation(request => Promise.resolve(request.action === 'capabilities' ? { ok: true, available: true } : { ok: true }));
  await mount(); button('Connect to desktop').click();
  state.status.mockImplementation(() => new Promise(resolve => { finishStatus = resolve; }));
  button('Authorize and continue').click();
  await vi.waitFor(() => expect(host.querySelector('[data-phase="connecting"]')).not.toBeNull());
  button('Cancel').click();
  expect(host.querySelector('.remote-desktop-deployment-flow')).toBeNull();
  finishStatus({ ...ready, login_service: { state: 'active', backend: 'linux-drm-kms' } });
  await vi.waitFor(() => expect(button('Connect to desktop').disabled).toBe(false));
  expect(state.create).not.toHaveBeenCalled();
});

it('retains successful preparation when a competing controller requires takeover', async () => {
  const installed = { ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms' }, login_service: { state: 'active', backend: 'linux-drm-kms' } };
  state.status.mockResolvedValueOnce({ ...installed, capabilities: { ...installed.capabilities, state: 'setup_required' }, login_service: { ...installed.login_service, state: 'not_installed' } }).mockResolvedValue(installed);
  state.ssh = true; state.deployment.mockImplementation(request => Promise.resolve(request.action === 'capabilities' ? { ok: true, available: true } : { ok: true }));
  state.create.mockRejectedValueOnce(new LocalApiError({ status: 409, code: 'DESKTOP_CONTROL_IN_USE', message: 'Control already in use' }));
  await mount(); button('Connect to desktop').click(); button('Authorize and continue').click();
  await vi.waitFor(() => expect(button('Take control')).toBeTruthy());
  expect(document.querySelector('[role=dialog]')).toBeNull();
  button('Take control').click();
  await vi.waitFor(() => expect(state.create).toHaveBeenLastCalledWith(expect.objectContaining({ takeover: true })));
  await vi.waitFor(() => expect(host.querySelector('.remote-desktop-deployment-flow')).toBeNull());
  expect(state.deployment.mock.calls.filter(([request]) => request.action === 'manage')).toHaveLength(1);
});

it('waits for cancellation rollback and explains its observed outcome', async () => {
  state.ssh=true;
  state.status.mockResolvedValue({ ...ready, login_service: { state: 'stopped', backend: 'linux-drm-kms' } });
  let finish!: (value: object) => void;
  state.deployment.mockImplementation(request => {
    if (request.action === 'capabilities') return Promise.resolve({ ok: true, available: true });
    if (request.action === 'cancel') { finish({ ok: false, code: 'canceled', rollback: 'complete' }); return Promise.resolve({ ok: true }); }
    return new Promise(resolve => { finish = resolve; });
  });
  await mount(); await vi.waitFor(() => expect(button('Connect to desktop')).toBeDefined());
  button('Connect to desktop').click();
  const flow = document.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!;
  [...flow.querySelectorAll('button')].find(item => controlText(item) === 'Authorize and continue')!.click();
  await vi.waitFor(() => expect(state.deployment).toHaveBeenCalledWith(expect.objectContaining({ action: 'manage', operation: 'ensure' })));
  [...flow.querySelectorAll('button')].find(item => controlText(item) === 'Cancel')!.click();
  await vi.waitFor(() => expect(flow.querySelector('[role=alert]')?.textContent).toContain('previous system state was restored'));
  expect(flow.textContent).toContain('Operation canceled');
  expect(document.querySelector('.remote-desktop-deployment-flow')).not.toBeNull();
});

it('explains a manager timeout without claiming that SSH disconnected and allows retry', async () => {
  state.ssh = true;
  state.status.mockResolvedValue({ ...ready, login_service: { state: 'stopped', backend: 'linux-drm-kms' } });
  state.deployment.mockImplementation(request => Promise.resolve(request.action === 'capabilities'
    ? { ok: true, available: true }
    : { ok: false, code: 'operation_timeout', rollback: 'unknown' }));
  await mount();
  button('Connect to desktop').click();
  button('Authorize and continue').click();
  await vi.waitFor(() => expect(host.querySelector('[role=alert]')?.textContent).toContain('operation timed out'));
  expect(host.textContent).toContain('Recheck the service state before retrying');
  expect(host.textContent).not.toContain('SSH connection was interrupted');
  expect(button('Authorize and continue').disabled).toBe(false);
  expect(button('Cancel').disabled).toBe(false);
  button('Cancel').click();
  expect(host.querySelector('.remote-desktop-deployment-flow')).toBeNull();
});

it('shows the actual unsupported graphics reason without an unusable connection button', async () => {
  state.ssh = true; state.deployment.mockResolvedValue({ ok: true, available: true });
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'unavailable', screen: false, input: false, reason: 'GPU_SCANOUT_UNSUPPORTED' }, login_service: { state: 'active', backend: 'linux-drm-kms' } });
  await mount(); expect(button('Connect to desktop').disabled).toBe(true);
  expect(host.textContent).toContain('graphics device cannot provide');
  expect(host.textContent).not.toContain('Unlock it locally');
  expect(host.textContent).not.toContain('Set up remote desktop');
});

it('refreshes an unavailable post-setup desktop in place without offering an impossible connection', async () => {
  const installed: RemoteDesktopStatus = { ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'unavailable', screen: false, input: false, reason: 'GPU_SCANOUT_UNSUPPORTED' }, login_service: { state: 'active', backend: 'linux-drm-kms' } };
  state.status.mockResolvedValueOnce({ ...installed, login_service: { state: 'not_installed', backend: 'linux-drm-kms' } }).mockResolvedValue(installed);
  state.ssh = true; state.deployment.mockImplementation(request => Promise.resolve(request.action === 'capabilities' ? { ok: true, available: true } : { ok: true }));
  await mount(); button('Connect to desktop').click(); button('Authorize and continue').click();
  await vi.waitFor(() => expect(host.querySelector('[data-phase=failed]')?.textContent).toContain('graphics device cannot provide'));
  const flow = host.querySelector('.remote-desktop-deployment-flow');
  expect(button('Connect to desktop')).toBeUndefined();
  button('Refresh').click();
  await vi.waitFor(() => expect(state.status).toHaveBeenCalledTimes(3));
  expect(host.querySelector('.remote-desktop-deployment-flow')).toBe(flow);
  expect(state.create).not.toHaveBeenCalled();
  state.status.mockResolvedValue({ ...installed, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms' } });
  button('Refresh').click();
  await vi.waitFor(() => expect(button('Connect to desktop')?.disabled).toBe(false));
  expect(state.create).not.toHaveBeenCalled();
  button('Connect to desktop').click();
  await vi.waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  expect(state.deployment.mock.calls.filter(([request]) => request.action === 'manage')).toHaveLength(1);
});

it('offers an explicit update for an incompatible service instead of installing again', async () => {
  state.ssh = true; state.deployment.mockResolvedValue({ ok: true, available: true });
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'unavailable', screen: false, input: false, reason: 'SERVICE_UPDATE_REQUIRED' }, login_service: { state: 'failed', backend: 'linux-drm-kms', reason: 'SERVICE_UPDATE_REQUIRED' } });
  await mount();
  await vi.waitFor(() => expect(button('Connect to desktop')).toBeDefined());
  expect(host.textContent).toContain('Update remote desktop in the Env App');
  host.querySelector<HTMLButtonElement>('.remote-desktop-connect')!.click();
  const flow = document.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!;
  expect(flow.textContent).toContain('Prepare remote desktop');
  expect(state.create).not.toHaveBeenCalled();
  [...flow.querySelectorAll('button')].find(item => controlText(item) === 'Authorize and continue')!.click();
  await vi.waitFor(() => expect(state.deployment).toHaveBeenCalledWith(expect.objectContaining({ action: 'manage', operation: 'ensure', confirmed: true })));
});

it('finishes the operation before refreshing status and allows the canceled result to close', async () => {
  state.ssh=true;
  state.status.mockResolvedValueOnce({ ...ready, login_service: { state: 'stopped', backend: 'linux-drm-kms' } });
  state.status.mockImplementation(() => new Promise(() => {}));
  state.deployment.mockImplementation(request => Promise.resolve(request.action === 'capabilities'
    ? { ok: true, available: true } : { ok: false, code: 'canceled', rollback: 'complete' }));
  await mount(); await vi.waitFor(() => expect(button('Connect to desktop')).toBeDefined());
  button('Connect to desktop').click();
  const flow = document.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!;
  [...flow.querySelectorAll('button')].find(item => controlText(item) === 'Authorize and continue')!.click();
  await vi.waitFor(() => expect(flow.querySelector('[role=alert]')?.textContent).toContain('Operation canceled'));
  expect(flow.querySelector('.remote-desktop-deployment-progress')).toBeNull();
  [...flow.querySelectorAll('button')].find(item => controlText(item) === 'Cancel')!.click();
  expect(state.deployment.mock.calls.filter(([request]) => request.action === 'cancel')).toHaveLength(0);
});

it('does not offer target-side consent or deployment on an unsupported SSH operating system', async () => {
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, screen: false, input: false }, login_service: { state: 'unsupported', backend: 'darwin' } });
  state.ssh = true; state.deployment.mockResolvedValue({ ok: true, available: true });
  await mount();
  await vi.waitFor(() => expect(state.deployment).toHaveBeenCalledWith({ action: 'capabilities' }));
  expect(button('Connect to desktop').disabled).toBe(true);
  expect(host.textContent).toContain('SSH is not supported on this operating system');
  expect(host.textContent).not.toContain('Allow screen recording');
  expect(host.textContent).not.toContain('Allow accessibility');
});

it('switches password identity by retiring the old operation and ignores its late challenge', async () => {
 state.ssh=true;
 state.status.mockResolvedValue({...ready,login_service:{state:'stopped',backend:'linux-drm-kms'}});
 let finish!: (value:object)=>void;
 state.deployment.mockImplementation(request=>request.action==='capabilities'?Promise.resolve({ok:true,available:true}):request.action==='cancel'?Promise.resolve({ok:true}):new Promise(resolve=>{finish=resolve;}));
 await mount();button('Connect to desktop').click();button('Authorize and continue').click();
 await vi.waitFor(()=>expect(state.deployment.mock.calls.some(([r])=>r.action==='manage')).toBe(true));
 const old=state.deployment.mock.calls.find(([r])=>r.action==='manage')![0];
 const report=state.progress.mock.calls[0][0];report({operation_id:old.operationId,stage:'authorization_required',challenge_id:'old-password'});
 const selector=host.querySelector<HTMLSelectElement>('.remote-desktop-credential select')!;selector.value='root';selector.dispatchEvent(new Event('change',{bubbles:true}));
 await vi.waitFor(()=>expect(state.deployment).toHaveBeenCalledWith({action:'cancel',operationId:old.operationId}));
 await vi.waitFor(()=>expect(button('Authorize and continue')).toBeDefined());
 report({operation_id:old.operationId,stage:'authorization_required',challenge_id:'late-password'});
 expect(host.querySelector('input[type=password]')).toBeNull();finish({ok:false,code:'canceled'});
 expect(host.textContent).not.toContain('Operation canceled');
 button('Authorize and continue').click();
 await vi.waitFor(()=>expect(state.deployment.mock.calls.filter(([r])=>r.action==='manage')).toHaveLength(2));
 const next=state.deployment.mock.calls.filter(([r])=>r.action==='manage')[1][0];expect(next.operationId).not.toBe(old.operationId);expect(next.administratorMethod).toBe('root');finish({ok:false,code:'canceled'});
});
it('allows dismissal while rollback is pending and rejects late interruption events', async () => {
 state.ssh=true;state.status.mockResolvedValue({...ready,login_service:{state:'stopped',backend:'linux-drm-kms'}});
 let finish!: (value:object)=>void;
 state.deployment.mockImplementation(request=>request.action==='capabilities'?Promise.resolve({ok:true,available:true}):request.action==='cancel'?Promise.resolve({ok:true}):new Promise(resolve=>{finish=resolve;}));
 await mount();button('Connect to desktop').click();button('Authorize and continue').click();
 await vi.waitFor(()=>expect(state.deployment.mock.calls.some(([r])=>r.action==='manage')).toBe(true));
 const old=state.deployment.mock.calls.find(([r])=>r.action==='manage')![0];button('Cancel').click();button('Cancel').click();
 expect(host.querySelector('.remote-desktop-deployment-flow')).toBeNull();
 state.progress.mock.calls[0][0]({operation_id:old.operationId,stage:'confirmation_required',challenge_id:'late',policy_digest:'a'.repeat(64)});
 expect(host.querySelector('.remote-desktop-deployment-flow')).toBeNull();finish({ok:false,code:'canceled',rollback:'complete'});
});

it.each(['ready', 'unavailable'] as const)('ensures an active SSH service for the current Runtime when admission is %s', async admission => {
  state.ssh = true;
  const installed: RemoteDesktopStatus = { ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: admission, screen: admission === 'ready', input: admission === 'ready' }, login_service: { state: 'active', backend: 'linux-drm-kms' } };
  state.status.mockResolvedValueOnce(installed).mockResolvedValue({ ...installed, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms' } });
  state.deployment.mockImplementation(request => Promise.resolve(request.action === 'capabilities' ? { ok: true, available: true } : { ok: true }));
  await mount();
  await vi.waitFor(() => expect(state.deployment).toHaveBeenCalledWith({ action: 'capabilities' }));
  expect(button('Connect to desktop').disabled).toBe(false);
  button('Connect to desktop').click();
  expect(state.create).not.toHaveBeenCalled();
  button('Authorize and continue').click();
  await vi.waitFor(() => expect(state.deployment).toHaveBeenCalledWith(expect.objectContaining({ action: 'manage', operation: 'ensure' })));
  await vi.waitFor(() => expect(state.create).toHaveBeenCalledOnce());
});

it.each(['complete', 'next_challenge', 'canceling'] as const)('ignores a late challenge rejection after %s', async transition => {
  state.ssh = true;
  state.status.mockResolvedValue({ ...ready, login_service: { state: 'active', backend: 'linux-drm-kms' } });
  let finish!: (value: object) => void, respond!: (value: object) => void;
  state.deployment.mockImplementation(request => {
    if (request.action === 'capabilities') return Promise.resolve({ ok: true, available: true });
    if (request.action === 'respond') return new Promise(resolve => { respond = resolve; });
    if (request.action === 'manage') return new Promise(resolve => { finish = resolve; });
    return Promise.resolve({ ok: true });
  });
  await mount();
  button('Prepare remote desktop').click();
  button('Authorize and continue').click();
  const current = state.deployment.mock.calls.find(([request]) => request.action === 'manage')![0];
  const report = state.progress.mock.calls[0][0];
  report({ operation_id: current.operationId, stage: 'authorization_required', challenge_id: 'password' });
  const password = host.querySelector<HTMLInputElement>('input[type=password]')!;
  password.value = 'ephemeral-fixture'; password.dispatchEvent(new Event('input', { bubbles: true }));
  button('Authorize and continue').click();
  if (transition === 'complete') {
    finish({ ok: true });
    await vi.waitFor(() => expect(host.querySelector('[data-phase=complete]')).toBeTruthy());
  } else if (transition === 'next_challenge') {
    report({ operation_id: current.operationId, stage: 'confirmation_required', challenge_id: 'interrupt', policy_digest: 'a'.repeat(64) });
  } else {
    button('Cancel').click();
  }
  respond({ ok: false, code: 'challenge_expired' });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(host.textContent).not.toContain('challenge_expired');
  expect(state.deployment.mock.calls.filter(([request]) => request.action === 'cancel')).toHaveLength(transition === 'canceling' ? 1 : 0);
  if (transition === 'complete') expect(host.querySelector('[data-phase=complete]')).toBeTruthy();
  if (transition === 'next_challenge') expect(host.textContent).toContain('Interrupt existing connections?');
  if (transition !== 'complete') finish({ ok: false, code: 'canceled', rollback: 'complete' });
});

it('does not open a viewer when cancellation races a committed preparation', async () => {
  state.ssh = true;
  state.status.mockResolvedValue({ ...ready, login_service: { state: 'active', backend: 'linux-drm-kms' } });
  let finish!: (value: object) => void;
  state.deployment.mockImplementation(request => request.action === 'capabilities'
    ? Promise.resolve({ ok: true, available: true }) : request.action === 'manage'
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true }));
  await mount(); button('Connect to desktop').click(); button('Authorize and continue').click();
  button('Cancel').click(); finish({ ok: true });
  await vi.waitFor(() => expect(host.querySelector('[data-phase=complete]')).toBeTruthy());
  expect(state.create).not.toHaveBeenCalled(); expect(state.open).not.toHaveBeenCalled();
  button('Back to connection').click(); expect(host.querySelector('.remote-desktop-connect')).toBeTruthy();
});
