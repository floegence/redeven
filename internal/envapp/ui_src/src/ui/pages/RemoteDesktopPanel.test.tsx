// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { controlText } from '../../testSupport/controlText';
import { RemoteDesktopPanel } from './RemoteDesktopPanel';
import { LocalApiError } from '../services/localApi';
import type { RemoteDesktopStatus } from '../services/remoteDesktopApi';

const state = vi.hoisted(() => ({
  label: 'server', hostname: 'server.example', local: true, full: true, desktop: true,
  status: vi.fn(), create: vi.fn(), open: vi.fn(), disconnect: vi.fn(), save: vi.fn(), permission: vi.fn(),
}));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ name: state.local ? 'Local Environment' : 'Research host', agent: { hostname: state.hostname }, permissions: { can_read: true, can_write: state.full, can_execute: state.full } }),
  env_id: () => 'env-fixture', localRuntime: () => state.local ? {} : null,
}) }));
vi.mock('../services/desktopSessionContext', () => ({ readDesktopSessionContextSnapshot: () => state.label ? { label: state.label } : null }));
vi.mock('../services/desktopShellBridge', () => ({ desktopShellWebServiceWindowOpenAvailable: () => state.desktop }));
vi.mock('../services/webServiceWindows', () => ({ resolveWebServiceOpenRoute: () => ({ kind: 'local_proxy', url: '/pf/one/' }), openWebServiceRoute: state.open }));
vi.mock('../services/remoteDesktopApi', async original => ({ ...await original<object>(), getRemoteDesktopStatus: state.status, createRemoteDesktop: state.create, disconnectRemoteDesktop: state.disconnect, setRemoteDesktopUnattended: state.save }));
vi.mock('../services/hostApplicationsApi', async original => ({ ...await original<object>(), requestHostApplicationPermission: state.permission }));

const ready: RemoteDesktopStatus = {
  capabilities: { backend: 'macos', state: 'ready', screen: true, input: true, audio: true, clipboard: true, unattended: true, displays: [{ id: 'one', name: 'Studio Display', width: 2560, height: 1440, scale: 1, primary: true }] },
  unattended: false, control_in_use: false, last_display_id: '',
};
let host: HTMLElement, dispose: (() => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks(); state.label = 'server'; state.hostname = 'server.example'; state.local = true; state.full = true; state.desktop = true;
  state.status.mockResolvedValue(structuredClone(ready));
  state.create.mockResolvedValue({ id: 'one', forward_id: 'pf-one', target_url: '/desktop' });
  state.open.mockResolvedValue(undefined); state.disconnect.mockResolvedValue(undefined); state.save.mockResolvedValue({ unattended: true });
  host = document.createElement('main'); document.body.append(host);
});
afterEach(() => { dispose?.(); host.remove(); vi.restoreAllMocks(); });
const button = (name: string) => [...host.querySelectorAll('button')].find(item => controlText(item) === name || item.getAttribute('aria-label') === name)!;
async function mount() { dispose = render(() => <RemoteDesktopPanel />, host); await vi.waitFor(() => expect(state.status).toHaveBeenCalled()); await vi.waitFor(() => expect(button('Connect to desktop')).toBeTruthy()); }

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
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, backend: 'wayland', state: 'authorization_required', displays: [] } });
  await mount(); expect(button('Connect to desktop').disabled).toBe(false);
  expect(host.textContent).toContain('Confirm screen sharing on the host');
});

it('keeps advanced settings out of the initial connection flow and avoids a single-display selector', async () => {
  await mount(); expect(host.querySelector('select')).toBeNull();
  const options = host.querySelector<HTMLDetailsElement>('.remote-desktop-options')!;
  expect(options.open).toBe(false); expect(options.textContent).toContain('Remember sharing approval');
  expect(host.textContent).not.toContain('Unattended reconnection'); expect(state.save).not.toHaveBeenCalled();
});

it('reports a blocked popup without creating a server session', async () => {
  state.desktop = false; vi.spyOn(window, 'open').mockReturnValue(null);
  await mount(); button('Connect to desktop').click();
  await vi.waitFor(() => expect(host.querySelector('[role=alert]')?.textContent).toContain('allow popups'));
  expect(state.create).not.toHaveBeenCalled();
});

it('releases a session when the viewer window cannot open and explains the failure', async () => {
  state.open.mockRejectedValue(new Error('fixture window failure'));
  await mount(); button('Connect to desktop').click();
  await vi.waitFor(() => expect(state.disconnect).toHaveBeenCalledWith('one'));
  expect(host.querySelector('[role=alert]')?.textContent).toContain('The desktop window could not open');
});

it('cleans up an unfinished connection if the panel is dismissed before creation returns', async () => {
  let complete!: (value: object) => void;
  state.create.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await mount(); button('Connect to desktop').click(); dispose?.(); dispose = undefined;
  complete({ id: 'one', forward_id: 'pf-one', target_url: '/desktop' });
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
