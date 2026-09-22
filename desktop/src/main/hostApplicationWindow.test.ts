import { EventEmitter } from 'node:events';
import type { BrowserWindow, IpcMainEvent, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { resolveDesktopWindowChromeSnapshot } from '../shared/windowChromePlatform';
import { attachHostApplicationWindow } from './hostApplicationWindow';
import { HOST_APPLICATION_WINDOW_ACTION_CHANNEL as actionChannel, HOST_APPLICATION_WINDOW_STATE_CHANNEL as stateChannel } from '../shared/hostApplicationWindowIPC';

function fixture() {
  const url = 'http://127.0.0.1:18181/pf/owned/_redeven_host_app/';
  const state = { maximized:false, minimized:false, fullscreen:false };
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isMaximized: () => state.maximized, isMinimized: () => state.minimized, isFullScreen: () => state.fullscreen,
    close: vi.fn(), minimize: vi.fn(() => { state.minimized = true; }), maximize: vi.fn(() => { state.maximized = true; }),
    unmaximize: vi.fn(() => { state.maximized = false; }), setFullScreen: vi.fn((value: boolean) => { state.fullscreen = value; }),
  });
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame:{url}, getURL: () => contents.mainFrame.url, send: vi.fn() });
  attachHostApplicationWindow(win as unknown as BrowserWindow, contents as unknown as WebContents, url);
  const send = (action: unknown, override: Record<string, unknown> = {}) => contents.emit('ipc-message', {sender:contents, senderFrame:contents.mainFrame, ...override} as unknown as IpcMainEvent, actionChannel, action);
  return {win, contents, state, send};
}

describe('native host application window controls', () => {
  it('controls only the attached window and publishes its authoritative state', () => {
    const v = fixture();
    v.send('maximize');
    expect(v.win.maximize).toHaveBeenCalledOnce();
    expect(v.contents.send).toHaveBeenLastCalledWith(stateChannel, {maximized:true, minimized:false, chrome:resolveDesktopWindowChromeSnapshot()});
    v.send('unmaximize'); v.send('minimize');
    expect(v.contents.send).toHaveBeenLastCalledWith(stateChannel, {maximized:false, minimized:true, chrome:resolveDesktopWindowChromeSnapshot()});
    v.state.minimized = false; v.win.emit('restore');
    expect(v.contents.send).toHaveBeenLastCalledWith(stateChannel, {maximized:false, minimized:false, chrome:resolveDesktopWindowChromeSnapshot()});
    v.send('close'); expect(v.win.close).toHaveBeenCalledOnce();
  });

  it('updates the titlebar safe area from native fullscreen state', () => {
    const v = fixture();
    v.state.fullscreen = true; v.win.emit('enter-full-screen');
    expect(v.contents.send).toHaveBeenLastCalledWith(stateChannel, {maximized:true, minimized:false,
      chrome:resolveDesktopWindowChromeSnapshot(process.platform, {fullScreen:true})});
  });

  it('rejects child frames, other contents, other routes, and unknown actions', () => {
    const v = fixture();
    v.send('close', {senderFrame:{url:v.contents.mainFrame.url}});
    v.send('close', {sender:{}});
    v.send('close', {senderFrame:null});
    v.send({action:'close'});
    v.send('execute');
    for (const url of ['http://evil.test/pf/owned/_redeven_host_app/', 'http://127.0.0.1:18181/pf/other/_redeven_host_app/', 'http://127.0.0.1:18181/pf/owned/index.html']) {
      v.contents.mainFrame.url = url; v.send('close');
    }
    expect(v.win.close).not.toHaveBeenCalled();
    expect(v.contents.send).not.toHaveBeenCalled();
  });

  it('releases native subscriptions with the target view', () => {
    const v = fixture(); v.contents.emit('destroyed');
    v.win.emit('maximize'); v.send('close');
    expect(v.contents.send).not.toHaveBeenCalled();
    expect(v.win.close).not.toHaveBeenCalled();
  });
});
