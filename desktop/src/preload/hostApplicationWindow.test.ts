// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDesktopWindowChromeSnapshot } from '../shared/windowChromePlatform';
import { HOST_APPLICATION_WINDOW_ACTION_CHANNEL as actionChannel, HOST_APPLICATION_WINDOW_STATE_CHANNEL as stateChannel } from '../shared/hostApplicationWindowIPC';
const mocks = vi.hoisted(() => ({expose:vi.fn(), send:vi.fn(), on:vi.fn(), remove:vi.fn()}));
vi.mock('electron', () => ({contextBridge:{exposeInMainWorld:mocks.expose}, ipcRenderer:{send:mocks.send, on:mocks.on, removeListener:mocks.remove}}));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubGlobal('process', {...process, isMainFrame:true}); history.replaceState(null, '', '/pf/owned/_redeven_host_app/'); });
afterEach(() => vi.unstubAllGlobals());

describe('host application presentation preload', () => {
  it('exposes a bounded control surface and sanitized native state', async () => {
    await import('./hostApplicationWindow');
    expect(mocks.expose).toHaveBeenCalledOnce();
    expect(mocks.expose.mock.calls[0][0]).toBe('redevenHostApplicationWindow');
    const api = mocks.expose.mock.calls[0][1];
    expect(Object.keys(api).sort()).toEqual(['request', 'subscribe']);
    mocks.send.mockClear(); api.request('execute'); expect(mocks.send).not.toHaveBeenCalled();
    api.request('close'); expect(mocks.send).toHaveBeenLastCalledWith(actionChannel, 'close');
    const listener = vi.fn(); const dispose = api.subscribe(listener);
    expect(mocks.send).toHaveBeenLastCalledWith(actionChannel, 'state');
    const receive = mocks.on.mock.calls.at(-1)![1];
    receive({}, {maximized:'true', minimized:false}); expect(listener).not.toHaveBeenCalled();
    receive({}, {maximized:true, minimized:false, secret:'not a presentation field'});
    expect(listener).toHaveBeenLastCalledWith({maximized:true, minimized:false});
    dispose(); expect(mocks.remove).toHaveBeenCalledWith(stateChannel, receive);
  });
  it('reserves native controls without exposing a shell or a chrome mutation API', async () => {
    await import('./hostApplicationWindow');
    expect(document.documentElement.dataset.redevenHostApplicationChrome).toBe('true');
    const receive = mocks.on.mock.calls[0][1];
    receive({}, {maximized:true, minimized:false, chrome:resolveDesktopWindowChromeSnapshot('darwin', {fullScreen:true})});
    expect(document.documentElement.style.getPropertyValue('--redeven-desktop-titlebar-start-inset')).toBe('16px');
    receive({}, {maximized:false, minimized:false, chrome:resolveDesktopWindowChromeSnapshot('win32')});
    expect(document.documentElement.style.getPropertyValue('--redeven-desktop-titlebar-end-inset')).toBe('144px');
  });
  it('does not expose controls to the Xpra document or any child frame', async () => {
    history.replaceState(null, '', '/pf/owned/index.html');
    await import('./hostApplicationWindow'); expect(mocks.expose).not.toHaveBeenCalled();
    vi.resetModules(); history.replaceState(null, '', '/pf/owned/_redeven_host_app/');
    vi.stubGlobal('process', {...process, isMainFrame:false});
    await import('./hostApplicationWindow'); expect(mocks.expose).not.toHaveBeenCalled();
  });
});
