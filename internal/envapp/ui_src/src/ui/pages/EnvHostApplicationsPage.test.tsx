// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvHostApplicationsPage } from './EnvHostApplicationsPage';

const state = vi.hoisted(() => ({ full: true, running: vi.fn(), quit: vi.fn(), detach: vi.fn(), setupCancel: vi.fn(), setupUpload: vi.fn(), components: vi.fn(), setupStatus: vi.fn(), setupStart: vi.fn(), setupObserve: vi.fn(), preparation: vi.fn(), localMac: false, permission: vi.fn(), catalog: vi.fn(), sessions: vi.fn(), launch: vi.fn(), stop: vi.fn(), add: vi.fn(), open: vi.fn() }));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ permissions: { can_read: true, can_write: state.full, can_execute: state.full } }),
  env_id: () => 'host', localRuntime: () => ({}),
}) }));
vi.mock('../services/hostApplicationsApi', async importOriginal => ({ ...await importOriginal<object>(), cancelHostApplicationSetup: state.setupCancel, uploadHostApplicationSetup: state.setupUpload, getHostApplicationSetup: state.setupStatus, startHostApplicationSetup: state.setupStart, observeHostApplicationSetup: state.setupObserve, listHostApplications: state.catalog, listRunningHostApplications: state.running, quitHostApplication: state.quit, detachHostApplication: state.detach, listHostApplicationSessions: state.sessions, launchHostApplication: state.launch, stopHostApplication: state.stop, addHostApplication: state.add, requestHostApplicationPermission: state.permission }));
vi.mock('../services/desktopShellBridge', () => ({ desktopShellWebServiceWindowOpenAvailable: () => true }));
vi.mock('../services/desktopSessionContext', () => ({ readDesktopSessionContextSnapshot: () => state.localMac ? {target_kind: 'local_environment',target_route:'local_host'} : null }));
vi.mock('../services/webServiceWindows', () => ({ resolveWebServiceOpenRoute: () => ({ kind: 'local_proxy', url: '/pf/one/' }), openWebServiceRoute: state.open }));

const app = { id: 'editor.desktop', name: 'Text Editor', description: 'Edit documents', categories: ['Utility'], icon: '', custom: false };
const forward = { forward: { forward_id: 'one', target_url: 'http://127.0.0.1:40201' }, app_path: '/_redeven_host_app/', ephemeral: true };
let host: HTMLDivElement;
let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
function button(label: string) { return [...host.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === label)!; }
beforeEach(() => {
  vi.clearAllMocks(); state.full = true; state.localMac = false;
  state.catalog.mockResolvedValue({ availability: { supported: true, ready: true }, applications: [app], sessions: [] });
  state.sessions.mockResolvedValue([{ id: 'session', application: app, state: 'running', forward }]);
  state.launch.mockResolvedValue({ id: 'session', application: app, state: 'starting', forward });
  state.open.mockResolvedValue(undefined);
  state.running.mockResolvedValue([]); state.quit.mockResolvedValue(undefined); state.detach.mockResolvedValue(undefined);
  state.setupCancel.mockResolvedValue({ state: "cancelled", received_bytes: 0, expected_bytes: 100 });
  state.setupStatus.mockResolvedValue({ state: 'available', received_bytes: 0, expected_bytes: 100, can_cancel: false, package: { id: 'fixture', architecture: 'arm64', size_bytes: 100, installed_bytes: 200 } });
  state.setupStart.mockResolvedValue({ state: 'downloading', operation_id: 'install', received_bytes: 0, expected_bytes: 100, can_cancel: true });
  state.setupObserve.mockImplementation((_callback, signal: AbortSignal) => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve())));
  state.preparation.mockImplementation(async (request: { action: string }) => ({ ok: true, ...(request.action === 'create' ? { id: 'preparation-window' } : {}) }));
  Object.defineProperty(window, 'redevenDesktopShell', { configurable: true, value: { applicationPreparation: state.preparation } });
  host = document.createElement('div'); document.body.append(host);
});
afterEach(() => { dispose?.(); host.remove(); });

describe('host application interaction', () => {
  it('opens the authorized forward in a Desktop window and resumes a running session', async () => {
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    expect(state.catalog).toHaveBeenCalledTimes(1);
    button('Open in new window · Text Editor').click(); await settle();
    expect(state.launch).toHaveBeenCalledWith('editor.desktop', 'en-US', expect.objectContaining({ starting: 'Starting application…' }), 'stream');
    expect(state.open).toHaveBeenCalledWith(expect.anything(), 'one', 'http://127.0.0.1:40201', 'unified_proxy', '/_redeven_host_app/', true, expect.any(Function), expect.anything(), null, 'application');
    expect(host.textContent).toContain('Running applications');
    expect(state.catalog).toHaveBeenCalledTimes(1);
    expect(state.sessions).toHaveBeenCalledTimes(1);
    button('Resume · Text Editor').click(); await settle();
    expect(state.launch).toHaveBeenCalledTimes(2);
  });
  it('keeps application identity visible and exposes launch progress on the card', async () => {
    state.launch.mockReturnValue(new Promise(() => {}));
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    const launchButton = button('Open in new window · Text Editor');
    launchButton.click(); await settle();
    expect(launchButton.getAttribute('aria-busy')).toBe('true');
    expect(launchButton.textContent).toContain('Text Editor');
    expect(launchButton.textContent).toContain('Starting application…');
    expect(launchButton.querySelector('.host-app-launch-indicator')).not.toBeNull();
  });
  it('allows browsing with read permission and disables process control', async () => {
    state.full = false;
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    expect(host.textContent).toContain('Text Editor');
    expect(button('Open in new window · Text Editor').disabled).toBe(true);
    button('Open in new window · Text Editor').click();
    expect(state.launch).not.toHaveBeenCalled();
  });
  it('offers preparation while preserving the real application library', async () => {
    state.catalog.mockResolvedValue({ availability: { supported: true, ready: false, requirements: ['Xpra X11 server', 'Xpra HTML5 v20 / v21'] }, applications: [app], sessions: [] });
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    expect(host.textContent).toContain('Prepare host applications');
    expect(host.querySelector('a[href="https://github.com/Xpra-org/xpra/wiki/Download"]')).toBeNull();
    expect(button('Open in new window · Text Editor').disabled).toBe(false);
    expect(state.launch).not.toHaveBeenCalled();
  });
  it('explains unsupported hosts without inviting Linux application installation', async () => {
    state.catalog.mockResolvedValue({ availability: { supported: false, ready: false, reason: 'unsupported_platform' }, applications: [], sessions: [] });
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    expect(host.textContent).toContain('Supported host required');
    expect(host.textContent).not.toContain('No applications yet');
    expect(host.textContent).not.toContain('Installation guide');
  });
  it('filters applications without requesting another host inventory', async () => {
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search applications…"]')!;
    input.value = 'missing'; input.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(host.textContent).toContain('No matching applications');
    expect(state.catalog).toHaveBeenCalledTimes(1);
  });
  it('shows only host metadata on cards while retaining accessible launch actions', async () => {
    state.catalog.mockResolvedValue({ availability: { supported: true, ready: true }, applications: [{ ...app, description: '', categories: [] }], sessions: [] });
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    const tile = button('Open in new window · Text Editor');
    expect(tile.textContent).toBe('Text Editor');
    expect(tile.querySelector('p')).toBeNull();
    expect(host.textContent).not.toContain('Open in new window');
  });
  it('filters every host category, including unknown categories and a literal all category', async () => {
    state.catalog.mockResolvedValue({ availability: { supported: true, ready: true }, applications: [
      app,
      { ...app, id: 'lab.desktop', name: 'Host Lab', categories: ['X-Host-Laboratory', 'all'] },
      { ...app, id: 'custom:tool.desktop', name: 'Uncategorized Tool', categories: [] },
    ], sessions: [] });
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    const filter = host.querySelector<HTMLSelectElement>('select[aria-label="Application category"]')!;
    expect(filter).not.toBeNull();
    expect([...filter.options].map(option => option.value)).toEqual(['', 'all', 'Utility', 'X-Host-Laboratory']);
    filter.value = 'X-Host-Laboratory'; filter.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect([...host.querySelectorAll('.host-app-tile strong')].map(el => el.textContent)).toEqual(['Host Lab']);
    filter.value = 'all'; filter.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(host.querySelectorAll('.host-app-tile')).toHaveLength(1);
    filter.value = ''; filter.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(host.querySelectorAll('.host-app-tile')).toHaveLength(3);
    expect(state.catalog).toHaveBeenCalledTimes(1);
  });
});

it('opens local macOS applications without requiring capture permissions or creating a viewer', async () => {
  state.localMac = true;
  state.catalog.mockResolvedValue({availability:{backend:'macos',supported:true,ready:false,native_ready:true,reason:'macos_permissions'},applications:[app],sessions:[]});
  state.launch.mockResolvedValue({id:'native',application:app,state:'opened',mode:'native'});
  dispose=render(()=><EnvHostApplicationsPage />,host);await settle();
  expect(button('Open in new window · Text Editor').disabled).toBe(false);
  button('Open in new window · Text Editor').click();await settle();
  expect(state.launch).toHaveBeenCalledWith(app.id,'en-US',expect.anything(),'native');
  expect(state.open).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('Allow screen recording');
});
it('guides remote macOS authorization and prevents launching until the host is ready', async () => {
  state.catalog.mockResolvedValue({availability:{backend:'macos',supported:true,ready:false,native_ready:true,reason:'macos_permissions',permissions:{screen_recording:false,accessibility:false}},applications:[app],sessions:[]});
  dispose=render(()=><EnvHostApplicationsPage />,host);await settle();
  expect(host.textContent).toContain('Allow screen recording');
  expect(host.textContent).not.toContain('Install Xpra');
  expect(button('Open in new window · Text Editor').disabled).toBe(false);
  [...host.querySelectorAll('button')].find(button=>button.textContent==='Allow screen recording')!.click();await settle();
  expect(state.permission).toHaveBeenCalledWith('screen_recording');
});

function preparationButton() { return [...document.querySelectorAll('button')].find(el => el.textContent === 'Prepare and open')!; }
function requireSetup() { state.catalog.mockResolvedValue({ availability: { supported: true, ready: false }, applications: [app], sessions: [] }); }
function selectDownloadMethod(method: 'host' | 'desktop', root: ParentNode = document) {
 const radio = root.querySelector<HTMLInputElement>(`input[type="radio"][value="${method}"]`)!;
 radio.click();
}
async function selectAndPrepare(method: 'host' | 'desktop' = 'host') {
 dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
 button('Open in new window · Text Editor').click(); await settle();
 selectDownloadMethod(method, document.querySelector('[role=dialog]')!);
 preparationButton().click(); await settle();
}
it('reserves one physical window and continues there after verified preparation', async () => {
 requireSetup(); await selectAndPrepare();
 expect(state.launch).not.toHaveBeenCalled();
 expect(state.preparation).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', application_id: app.id }));
 state.catalog.mockResolvedValue({ availability: { supported: true, ready: true }, applications: [app], sessions: [] });
 state.setupObserve.mock.calls[0][0]({ state: 'ready', received_bytes: 100, expected_bytes: 100 }); await settle();
 expect(state.launch).toHaveBeenCalledTimes(1);
 expect(state.open.mock.calls[0].at(-1)).toBe('preparation-window');
});
it('does not launch after the reserved window is closed during preparation', async () => {
 requireSetup(); await selectAndPrepare();
 state.preparation.mockResolvedValue({ ok: false });
 state.catalog.mockResolvedValue({ availability: { supported: true, ready: true }, applications: [app], sessions: [] });
 state.setupObserve.mock.calls[0][0]({ state: 'ready', received_bytes: 100, expected_bytes: 100 }); await settle();
 expect(state.launch).not.toHaveBeenCalled();
});
it('stops a newly launched application if its reserved window closes before the launch response', async () => {
 requireSetup(); await selectAndPrepare();
 let resolveLaunch!: (value: unknown) => void;
 state.launch.mockImplementation(() => new Promise(resolve => { resolveLaunch = resolve; }));
 state.catalog.mockResolvedValue({ availability: { supported: true, ready: true }, applications: [app], sessions: [] });
 state.setupObserve.mock.calls[0][0]({ state: 'ready', received_bytes: 100, expected_bytes: 100 }); await settle();
 state.preparation.mockResolvedValue({ ok: false });
 resolveLaunch({ id: 'fresh-session', application: app, state: 'starting', forward }); await settle();
 expect(state.stop).toHaveBeenCalledWith('fresh-session');
 expect(state.open).not.toHaveBeenCalled();
});
it('continues when the start response is already ready without waiting for a second event', async () => {
 requireSetup();
 state.setupStart.mockImplementation(async () => {
  state.catalog.mockResolvedValue({ availability: { supported: true, ready: true }, applications: [app], sessions: [] });
  return { state: 'ready', received_bytes: 100, expected_bytes: 100 };
 });
 await selectAndPrepare();
 expect(state.launch).toHaveBeenCalledTimes(1);
});

it('continues an application selected while preparation is already running', async () => {
 requireSetup();
 state.setupStatus.mockResolvedValue({ state: 'downloading', operation_id: 'install', received_bytes: 20, expected_bytes: 100, can_cancel: true });
 dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
 button('Open in new window · Text Editor').click(); await settle();
 expect(state.preparation).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', application_id: app.id }));
 state.catalog.mockResolvedValue({ availability: { supported: true, ready: true }, applications: [app], sessions: [] });
 state.setupObserve.mock.calls[0][0]({ state: 'ready', received_bytes: 100, expected_bytes: 100 }); await settle();
 expect(state.launch).toHaveBeenCalledTimes(1);
 expect(state.setupStart).not.toHaveBeenCalled();
});
it('retires opening immediately on cancel even if preparation completes before cancellation responds', async () => {
 requireSetup(); await selectAndPrepare();
 state.setupCancel.mockReturnValue(new Promise(() => {}));
 [...host.querySelectorAll('button')].find(el => el.textContent === 'Cancel')!.click();
 state.catalog.mockResolvedValue({ availability: { supported: true, ready: true }, applications: [app], sessions: [] });
 state.setupObserve.mock.calls[0][0]({ state: 'ready', received_bytes: 100, expected_bytes: 100 }); await settle();
 expect(state.preparation).toHaveBeenCalledWith({ action: 'close', id: 'preparation-window' });
 expect(state.launch).not.toHaveBeenCalled();
});
it('reuses the exact admission after a lost start response and reconnects observation without restarting', async () => {
 requireSetup(); state.setupStart.mockRejectedValueOnce(new Error('Response lost'));
 let disconnect!: (reason: Error) => void;
 state.setupObserve.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { disconnect = reject; }));
 await selectAndPrepare();
 disconnect(new Error('Disconnected')); await settle();
 const requestID = state.setupStart.mock.calls[0][0];
 [...host.querySelectorAll('button')].find(el => el.textContent === 'Reconnect')!.click(); await settle();
 expect(state.setupStart).toHaveBeenCalledTimes(1);
 preparationButton().click(); await settle();
 expect(state.setupStart.mock.calls[1][0]).toBe(requestID);
});
it('downloads through Desktop only when selected and verifies on the host', async () => {
 requireSetup(); window.redevenDesktopShell!.applicationComponents = state.components;
 state.components.mockImplementation(async (request: { action: string }) => request.action === 'acquire' ? { ok: true, size: 180 } : { ok: true, data: new Uint8Array([1]) });
 state.setupStart.mockImplementation(async (_id: string, source: string) => source === 'upload'
  ? { state: 'receiving', operation_id: 'relay', received_bytes: 0, expected_bytes: 180, can_cancel: true }
  : { state: 'downloading', operation_id: 'install', received_bytes: 0, expected_bytes: 100, can_cancel: true });
 state.setupUpload.mockResolvedValue({ state: 'validating', operation_id: 'relay', received_bytes: 180, expected_bytes: 180, can_cancel: true });
 await selectAndPrepare('desktop');
 expect(state.components).toHaveBeenCalledWith({ action: 'acquire', architecture: 'arm64' });
 expect(state.setupStart).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'upload', 180);
 expect(state.setupUpload).toHaveBeenCalledWith('relay', expect.objectContaining({ size: 180, read: expect.any(Function) }), expect.any(AbortSignal));
 expect(state.launch).not.toHaveBeenCalled();
});
it('resumes the selected remote macOS app in its reserved window after actual authorization', async () => {
 state.catalog.mockResolvedValue({ availability: { backend: 'macos', supported: true, ready: false, native_ready: true, reason: 'macos_permissions', permissions: { screen_recording: false, accessibility: false } }, applications: [app], sessions: [] });
 dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
 button('Open in new window · Text Editor').click(); await settle();
 [...document.querySelectorAll('[role="dialog"] button')].find(el => el.textContent === 'Allow screen recording')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settle();
 expect(state.preparation).toHaveBeenCalledWith(expect.objectContaining({ action: 'create' }));
 expect(state.launch).not.toHaveBeenCalled();
 state.catalog.mockResolvedValue({ availability: { backend: 'macos', supported: true, ready: true, native_ready: true }, applications: [app], sessions: [] });
 window.dispatchEvent(new Event('focus')); await settle();
 expect(state.launch).toHaveBeenCalledTimes(1);
 expect(state.open.mock.calls[0].at(-1)).toBe('preparation-window');
});

it('cancels a relay admitted after cancellation without uploading or reopening the application', async () => {
 requireSetup(); window.redevenDesktopShell!.applicationComponents = state.components;
 state.components.mockResolvedValue({ ok: true, size: 180 });
 let receive!: (value: unknown) => void;
 state.setupStart.mockImplementation(async (_id: string, source: string) => source === 'upload' ? new Promise(resolve => { receive = resolve; }) : { state: 'downloading', operation_id: 'install', can_cancel: true });
 await selectAndPrepare('desktop');
 [...host.querySelectorAll('button')].find(el => el.textContent === 'Cancel')!.click(); await settle();
 receive({ state: 'receiving', operation_id: 'relay', received_bytes: 0, expected_bytes: 180, can_cancel: true }); await settle();
 expect(state.setupCancel).toHaveBeenCalledWith('relay');
 expect(state.setupUpload).not.toHaveBeenCalled();
 expect(state.launch).not.toHaveBeenCalled();
});
it('resumes an interrupted Desktop transfer into the same host operation', async () => {
 requireSetup(); window.redevenDesktopShell!.applicationComponents = state.components;
 state.components.mockResolvedValue({ ok: true, size: 180 });
 state.setupStatus.mockResolvedValue({ state: 'receiving', operation_id: 'existing-transfer', received_bytes: 50, expected_bytes: 180, can_cancel: true, package: { architecture: 'arm64', size_bytes: 100 } });
 state.setupUpload.mockResolvedValue({ state: 'validating', operation_id: 'existing-transfer', received_bytes: 180, expected_bytes: 180, can_cancel: true });
 dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
 selectDownloadMethod('desktop', host);
 [...host.querySelectorAll('button')].find(el => el.textContent === 'Continue preparation')!.click(); await settle();
 expect(state.setupStart).not.toHaveBeenCalled();
 expect(state.setupUpload).toHaveBeenCalledWith('existing-transfer', expect.objectContaining({ size: 180 }), expect.any(AbortSignal));
});
it('ignores a download failure from a different operation', async () => {
 requireSetup(); window.redevenDesktopShell!.applicationComponents = state.components;
 await selectAndPrepare();
 state.setupObserve.mock.calls[0][0]({ state: 'failed', operation_id: 'someone-else', error_code: 'download_failed', package: { architecture: 'arm64' } }); await settle();
 expect(state.components).not.toHaveBeenCalled();
});

it('refreshes the real application library after preparation without a pending application', async () => {
 state.catalog.mockResolvedValue({ availability: { supported: true, ready: false }, applications: [], sessions: [] });
 dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
 [...host.querySelectorAll('button')].find(el => el.textContent === 'Prepare')!.click(); await settle();
 state.catalog.mockResolvedValue({ availability: { supported: true, ready: true }, applications: [app], sessions: [] });
 state.setupObserve.mock.calls[0][0]({ state: 'ready', received_bytes: 100, expected_bytes: 100 }); await settle();
 expect(button('Open in new window · Text Editor')).toBeDefined();
 expect(host.textContent).not.toContain('Prepare host applications');
 expect(state.launch).not.toHaveBeenCalled();
});

it.each([true, false])('detaches sharing without quitting an existing or newly launched macOS application: %s', async existing => {
 const session = { id: 'shared', application: app, state: 'running', backend: 'macos', existing_application: existing, forward };
 state.catalog.mockResolvedValue({ availability: { backend: 'macos', supported: true, ready: true, native_ready: true }, applications: [app], sessions: [session], running: [{ application_id: app.id, instances: ['instance'] }] });
 state.sessions.mockResolvedValue([session]);
 dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
 const label = 'Stop sharing';
 button(`${label} · Text Editor`).click(); await settle();
 const dialog = document.querySelector('[role="dialog"]')!;
 expect(dialog.textContent).toContain('Stop sharing');
 expect(dialog.textContent).toContain('Its windows and unsaved work will remain open on the Mac.');
 const confirm = [...dialog.querySelectorAll('button')].find(el => el.textContent === label)!;
 confirm.click(); await settle();
 expect(state.detach).toHaveBeenCalledWith('shared');
 expect(state.stop).not.toHaveBeenCalled();
 expect(state.quit).not.toHaveBeenCalled();
});

it('shows both download paths and defaults to host download even inside Desktop', async () => {
 requireSetup(); window.redevenDesktopShell!.applicationComponents = state.components;
 dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
 const hostOption = host.querySelector<HTMLInputElement>('input[type=radio][value=host]');
 const desktopOption = host.querySelector<HTMLInputElement>('input[type=radio][value=desktop]');
 expect(hostOption).not.toBeNull(); expect(desktopOption).not.toBeNull();
 expect(hostOption!.checked).toBe(true);
 expect(hostOption!.closest('label')!.textContent).toContain('Host downloads');
 expect(desktopOption!.closest('label')!.textContent).toContain('Desktop downloads and uploads');
 [...host.querySelectorAll('button')].find(el => el.textContent === 'Prepare')!.click(); await settle();
 expect(state.setupStart).toHaveBeenCalledWith(expect.any(String), 'download', 0);
 expect(state.components).not.toHaveBeenCalled();
 state.setupObserve.mock.calls[0][0]({ state: 'failed', operation_id: 'install', error_code: 'download_failed', package: { architecture: 'arm64' } }); await settle();
 expect(state.components).not.toHaveBeenCalled();
 expect(host.textContent).toContain('The download could not finish');
});

it('keeps Desktop visible but unavailable in a browser and shares the selection with the setup dialog', async () => {
 requireSetup(); dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
 expect(host.querySelector<HTMLInputElement>('input[value=desktop]')!.disabled).toBe(true);
 expect(host.textContent).toContain('Open this environment in Redeven Desktop');
});
it('preserves an explicit Desktop choice when opening an application setup dialog', async () => {
 requireSetup(); window.redevenDesktopShell!.applicationComponents = state.components;
 dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
 selectDownloadMethod('desktop', host);
 button('Open in new window · Text Editor').click(); await settle();
 expect(document.querySelector<HTMLInputElement>('[role=dialog] input[value=desktop]')!.checked).toBe(true);
 expect(document.querySelector('[role=dialog]')!.textContent).not.toContain('Prepare host applications');
});
it('cancels Desktop acquisition before there is a host operation', async () => {
 requireSetup(); window.redevenDesktopShell!.applicationComponents = state.components;
 let finish!: (value: unknown) => void;
 state.components.mockImplementation((request: { action: string }) => request.action === 'acquire' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ok:true}));
 await selectAndPrepare('desktop');
 [...host.querySelectorAll('button')].find(el => el.textContent === 'Cancel')!.click(); await settle();
 finish({ok:true,size:180}); await settle();
 expect(state.setupStart).not.toHaveBeenCalled();
 expect(state.setupUpload).not.toHaveBeenCalled();
 expect(state.preparation).toHaveBeenCalledWith({action:'close',id:'preparation-window'});
 expect(host.textContent).toContain('Preparation cancelled');
});
it('reuses Desktop upload admission after its response is lost', async () => {
 requireSetup(); window.redevenDesktopShell!.applicationComponents = state.components;
 state.components.mockResolvedValue({ok:true,size:180});
 state.setupStart.mockRejectedValue(new Error('Response lost'));
 await selectAndPrepare('desktop');
 preparationButton().click(); await settle();
 expect(state.setupStart).toHaveBeenCalledTimes(2);
 expect(state.setupStart.mock.calls[1]).toEqual(state.setupStart.mock.calls[0]);
});

it('reserves an application selected during Desktop acquisition without reopening setup', async () => {
 requireSetup(); window.redevenDesktopShell!.applicationComponents = state.components;
 state.components.mockReturnValue(new Promise(() => {}));
 dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
 selectDownloadMethod('desktop',host);
 [...host.querySelectorAll('button')].find(el => el.textContent === 'Prepare')!.click(); await settle();
 button('Open in new window · Text Editor').click(); await settle();
 expect(state.preparation).toHaveBeenCalledWith(expect.objectContaining({action:'create',application_id:app.id}));
 expect(document.querySelector('[role=dialog]')).toBeNull();
 expect(state.setupStart).not.toHaveBeenCalled();
});


describe('macOS running application management', () => {
  const instance = { instances: ['process-generation'], application_id: app.id };
  function runningCatalog() {
    state.catalog.mockResolvedValue({ availability: { backend: 'macos', supported: true, ready: true, native_ready: true }, applications: [app], sessions: [], running: [instance] });
    state.running.mockResolvedValue([instance]);
    state.sessions.mockResolvedValue([]);
  }
  it('exposes quit for applications with no sharing session and keeps cancelled quits visible', async () => {
    runningCatalog();
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    expect(host.textContent).toContain('Running on this Mac');
    button('Quit application · Text Editor').click(); await settle();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Text Editor');
    expect(dialog.textContent).toContain('all of its windows');
    [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Quit application')!.click(); await settle();
    expect(state.quit).toHaveBeenCalledWith(app.id, instance.instances);
    expect(state.stop).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Open the application to respond to any save dialog.');
    expect(button('Quit application · Text Editor')).toBeDefined();
    state.running.mockResolvedValue([]);
    window.dispatchEvent(new Event('focus')); await settle();
    expect(button('Quit application · Text Editor')).toBeUndefined();
  });
  it('lists a local native launch from system inventory even without a viewer', async () => {
    state.localMac = true;
    state.catalog.mockResolvedValue({ availability: { backend: 'macos', supported: true, ready: false, native_ready: true }, applications: [app], sessions: [], running: [] });
    state.running.mockResolvedValue([instance]);
    state.launch.mockResolvedValue({ id: 'native', application: app, state: 'opened', mode: 'native' });
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    button('Open in new window · Text Editor').click(); await settle();
    expect(button('Quit application · Text Editor')).toBeDefined();
    expect(state.open).not.toHaveBeenCalled();
  });
  it('preserves keyboard focus during unchanged inventory refreshes', async () => {
    runningCatalog();
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    const quit = button('Quit application · Text Editor'); quit.focus();
    state.running.mockResolvedValue([{ ...instance, instances: [...instance.instances] }]);
    window.dispatchEvent(new Event('focus')); await settle();
    expect(document.activeElement).toBe(quit);
  });
  it('does not retarget an open confirmation after a process restarts', async () => {
    runningCatalog();
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    button('Quit application · Text Editor').click(); await settle();
    state.running.mockResolvedValue([{ ...instance, instances: ['replacement'] }]);
    window.dispatchEvent(new Event('focus')); await settle();
    state.quit.mockRejectedValue(new Error('Connection lost after dispatch'));
    const dialog = document.querySelector('[role="dialog"]')!;
    [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Quit application')!.click(); await settle();
    expect(state.quit).toHaveBeenCalledWith(app.id, instance.instances);
    expect(dialog.textContent).toContain('The quit request could not be confirmed.');
    expect(host.querySelector('.host-app-quit-notice')).toBeNull();
  });
  it('disables quit for read-only users', async () => {
    runningCatalog(); state.full = false;
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    expect(button('Quit application · Text Editor').disabled).toBe(true);
  });
});
