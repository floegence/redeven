// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { controlText } from '../../testSupport/controlText';
import { RemoteDesktopPanel } from './RemoteDesktopPanel';
import { WebServiceWindowOpenError } from '../services/webServiceWindows';
import { LocalApiError } from '../services/localApi';
import type { RemoteDesktopStatus } from '../services/remoteDesktopApi';

const state = vi.hoisted(() => ({
  label: 'server', hostname: 'server.example', local: true, full: true, desktop: true,
  status: vi.fn(), create: vi.fn(), open: vi.fn(), disconnect: vi.fn(), save: vi.fn(), forget: vi.fn(), permission: vi.fn(),
  deployment: vi.fn(), progress: vi.fn(),
}));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ name: state.local ? 'Local Environment' : 'Research host', agent: { hostname: state.hostname }, permissions: { can_read: true, can_write: state.full, can_execute: state.full } }),
  env_id: () => 'env-fixture', localRuntime: () => state.local ? {} : null,
}) }));
vi.mock('../services/desktopSessionContext', () => ({ readDesktopSessionContextSnapshot: () => state.label ? { label: state.label } : null }));
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
  vi.resetAllMocks(); state.label = 'server'; state.hostname = 'server.example'; state.local = true; state.full = true; state.desktop = true;
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
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(item => controlText(item) === 'Take control')!;
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

it('confirms administrator scope in Env App and clears the credential before SSH begins', async () => {
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, backend: 'wayland', state: 'host_action_required' }, login_service: { state: 'not_installed', backend: 'linux-drm-kms' } });
  let finish!: (value: object) => void;
  state.deployment.mockImplementation(request => request.action === 'capabilities' ? Promise.resolve({ ok: true, available: true }) : new Promise(resolve => { finish = resolve; }));
  await mount(); await vi.waitFor(() => expect(button('Set up')).toBeDefined());
  expect(host.textContent).not.toContain('Confirm screen sharing on the host');
  button('Set up').click();
  const dialog = document.querySelector('[role=dialog]')!;
  expect(dialog.textContent).toContain('root system service');
  expect(dialog.textContent).toContain('opens no public port');
  expect(state.deployment.mock.calls.filter(([request]) => request.action === 'manage')).toHaveLength(0);
  const password = dialog.querySelector<HTMLInputElement>('input[type=password]')!;
  password.value = 'ephemeral-fixture'; password.dispatchEvent(new Event('input', { bubbles: true }));
  [...dialog.querySelectorAll('button')].find(item => controlText(item) === 'Authorize and continue')!.click();
  await vi.waitFor(() => expect(state.deployment).toHaveBeenCalledWith({ action: 'manage', operation: 'install', confirmed: true, administratorPassword: 'ephemeral-fixture' }));
  expect(password.value).toBe(''); expect(password.disabled).toBe(true);
  finish({ ok: false, code: 'authorization_failed' });
  await vi.waitFor(() => expect(dialog.querySelector('[role=alert]')?.textContent).toContain('Administrator authorization was not accepted'));
  expect(state.permission).not.toHaveBeenCalled();
  expect(state.create).not.toHaveBeenCalled();
});

it('waits for cancellation rollback and explains its observed outcome', async () => {
  state.status.mockResolvedValue({ ...ready, login_service: { state: 'stopped', backend: 'linux-drm-kms' } });
  let finish!: (value: object) => void;
  state.deployment.mockImplementation(request => {
    if (request.action === 'capabilities') return Promise.resolve({ ok: true, available: true });
    if (request.action === 'cancel') { finish({ ok: false, code: 'canceled', rollback: 'complete' }); return Promise.resolve({ ok: true }); }
    return new Promise(resolve => { finish = resolve; });
  });
  await mount(); await vi.waitFor(() => expect(button('Start')).toBeDefined());
  button('Start').click();
  const dialog = document.querySelector('[role=dialog]')!;
  [...dialog.querySelectorAll('button')].find(item => controlText(item) === 'Authorize and continue')!.click();
  await vi.waitFor(() => expect(state.deployment).toHaveBeenCalledWith(expect.objectContaining({ action: 'manage', operation: 'start' })));
  [...dialog.querySelectorAll('button')].find(item => controlText(item) === 'Cancel')!.click();
  await vi.waitFor(() => expect(dialog.querySelector('[role=alert]')?.textContent).toContain('previous system state was restored'));
  expect(dialog.textContent).toContain('Operation canceled');
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
});

it('shows the actual unsupported graphics reason without an unusable connection button', async () => {
  state.deployment.mockResolvedValue({ ok: true, available: true });
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, backend: 'linux-drm-kms', state: 'unavailable', screen: false, input: false, reason: 'GPU_SCANOUT_UNSUPPORTED' }, login_service: { state: 'active', backend: 'linux-drm-kms' } });
  await mount(); expect(button('Connect to desktop').disabled).toBe(true);
  expect(host.textContent).toContain('graphics device cannot provide');
  expect(host.textContent).not.toContain('Unlock it locally');
  expect(host.textContent).not.toContain('Set up remote desktop');
});

it('finishes the operation before refreshing status and allows the canceled result to close', async () => {
  state.status.mockResolvedValueOnce({ ...ready, login_service: { state: 'stopped', backend: 'linux-drm-kms' } });
  state.status.mockImplementation(() => new Promise(() => {}));
  state.deployment.mockImplementation(request => Promise.resolve(request.action === 'capabilities'
    ? { ok: true, available: true } : { ok: false, code: 'canceled', rollback: 'complete' }));
  await mount(); await vi.waitFor(() => expect(button('Start')).toBeDefined());
  button('Start').click();
  const dialog = document.querySelector('[role=dialog]')!;
  [...dialog.querySelectorAll('button')].find(item => controlText(item) === 'Authorize and continue')!.click();
  await vi.waitFor(() => expect(dialog.querySelector('[role=alert]')?.textContent).toContain('Operation canceled'));
  expect(dialog.querySelector('.remote-desktop-deployment-progress')).toBeNull();
  [...dialog.querySelectorAll('button')].find(item => controlText(item) === 'Cancel')!.click();
  expect(state.deployment.mock.calls.filter(([request]) => request.action === 'cancel')).toHaveLength(0);
});

it('does not offer target-side consent or deployment on an unsupported SSH operating system', async () => {
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, screen: false, input: false }, login_service: { state: 'unsupported', backend: 'darwin' } });
  state.deployment.mockResolvedValue({ ok: true, available: true });
  await mount();
  await vi.waitFor(() => expect(state.deployment).toHaveBeenCalledWith({ action: 'capabilities' }));
  expect(button('Connect to desktop').disabled).toBe(true);
  expect(host.textContent).toContain('SSH is not supported on this operating system');
  expect(host.textContent).not.toContain('Allow screen recording');
  expect(host.textContent).not.toContain('Allow accessibility');
});
