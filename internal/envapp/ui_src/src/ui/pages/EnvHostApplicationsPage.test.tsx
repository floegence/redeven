// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvHostApplicationsPage } from './EnvHostApplicationsPage';

const state = vi.hoisted(() => ({ full: true, localMac: false, permission: vi.fn(), catalog: vi.fn(), sessions: vi.fn(), launch: vi.fn(), stop: vi.fn(), add: vi.fn(), open: vi.fn() }));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ permissions: { can_read: true, can_write: state.full, can_execute: state.full } }),
  env_id: () => 'host', localRuntime: () => ({}),
}) }));
vi.mock('../services/hostApplicationsApi', () => ({ listHostApplications: state.catalog, listHostApplicationSessions: state.sessions, launchHostApplication: state.launch, stopHostApplication: state.stop, addHostApplication: state.add, requestHostApplicationPermission: state.permission }));
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
  it('explains missing host components without suggesting an application can launch', async () => {
    state.catalog.mockResolvedValue({ availability: { supported: true, ready: false, requirements: ['Xpra X11 server', 'Xpra HTML5 v20 / v21'] }, applications: [app], sessions: [] });
    dispose = render(() => <EnvHostApplicationsPage />, host); await settle();
    expect(host.textContent).toContain('Needs attention: Xpra X11 server, Xpra HTML5 v20 / v21');
    expect(host.querySelector('a[href="https://github.com/Xpra-org/xpra/wiki/Download"]')).not.toBeNull();
    expect(button('Open in new window · Text Editor').disabled).toBe(true);
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
  expect(button('Open in new window · Text Editor').disabled).toBe(true);
  [...host.querySelectorAll('button')].find(button=>button.textContent==='Allow screen recording')!.click();await settle();
  expect(state.permission).toHaveBeenCalledWith('screen_recording');
});
