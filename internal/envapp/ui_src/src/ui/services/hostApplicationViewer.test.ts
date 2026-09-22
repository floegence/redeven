import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: Record<string, unknown>) => { window: Window & typeof globalThis };
};
import { afterEach, describe, expect, it, vi } from 'vitest';

const shared = ['catalog.generated.js', 'appearance.js', 'connection.js'].map(file => readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer', file), 'utf8')).join('\n');
const source = shared + '\n' + readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/toolbar.js'), 'utf8') + '\n' + readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/viewer.js'), 'utf8');
const html = readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/viewer.html'), 'utf8').split('<script nonce=')[0].replace('{{.Style}}', '').replace('{{.Locale}}', 'en-US');
const copy = {starting:'Starting', connecting:'Connecting', reconnecting:'Reconnecting', disconnected:'Disconnected', failed:'Failed', ended:'Ended', retry:'Retry', reconnect:'Reconnect', connectionHint:'Return to your application'};
let dom: InstanceType<typeof JSDOM>;
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(() => { dom?.window.close(); });

async function viewer(deferredInitialization = false, native = false, lexicalClient = false, initial?: Record<string, string>) {
  dom = new JSDOM(html, { url:'http://localhost/pf/test/_redeven_host_app/', runScripts:'dangerously', pretendToBeVisual:true });
  const fetch = vi.fn().mockResolvedValue({ok:true, json:async () => ({state:'running', password:'private'})});
  dom.window.fetch = fetch;
  Object.assign(dom.window, {matchMedia: () => ({matches:false})});
  dom.window.requestAnimationFrame = cb => { cb(0); return 1; };
  let windowStateChanged: (state: { maximized: boolean; minimized: boolean }) => void = () => {};
  const nativeWindow = { request: vi.fn(), subscribe: vi.fn((listener: typeof windowStateChanged) => {
    windowStateChanged = listener;
    listener({ maximized: false, minimized: false });
    return vi.fn();
  }) };
  if (native) Object.assign(dom.window, { redevenHostApplicationWindow: nativeWindow });
  dom.window.eval(`const config = ${JSON.stringify({base:'/pf/test', copy, icon:'', initial})};\n${source}`);
  await drain();
  const frame = dom.window.document.querySelector('iframe')!;
  const doc = frame.contentDocument!;
  doc.open(); doc.write('<html><head></head><body></body></html>'); doc.close();
  const windows: Record<number, ReturnType<typeof appWindow>> = {};
  function appWindow(id: number, metadata: Record<string, unknown> = {}, type = 'NORMAL') {
    const metadataUpdated = vi.fn();
    const win = {
      wid:id, div:doc.createElement('div'), metadata, windowtype:[type], override_redirect:false, tray:false,
      has_windowtype:(types: string[]) => types.includes(type), screen_resized:vi.fn(),
      set_maximized:vi.fn(), set_minimized:vi.fn(), initiate_moveresize:vi.fn(), move_resize:vi.fn(),
      metadataUpdated, update_metadata:metadataUpdated, destroy:vi.fn(), handle_resized:vi.fn(), w:1096, h:856, x:100, y:100,
      leftoffset:1, rightoffset:1, topoffset:30, bottomoffset:1,
    };
    windows[id] = win;
    return win;
  }
  const client = {
    _get_desktop_size:() => [1000, 680], id_to_window:windows, connected:true, reconnect:true, reconnect_count:5,
    _new_window:vi.fn(), do_send_damage_sequence:vi.fn(), send_configure_window:vi.fn(),
    send_control_refresh:vi.fn(), send:vi.fn(), send_close_window:vi.fn(), focused_wid:1, set_focus:vi.fn((win: {wid:number}) => { client.focused_wid = win.wid; }), close:vi.fn(), callback_close:() => {}, on_last_window:vi.fn(),
  };
  if (!deferredInitialization) {
    Object.assign(frame.contentWindow!, {client});
    if (lexicalClient) {
      const declaration = doc.createElement('script');
      declaration.textContent = 'let client = window.client; delete window.client;';
      doc.head.append(declaration);
    }
  }
  frame.dispatchEvent(new dom.window.Event('load'));
  return {frame, doc, client, appWindow, fetch, nativeWindow, windowStateChanged: (state: { maximized: boolean; minimized: boolean }) => windowStateChanged(state), state:() => dom.window.document.body.dataset.state};
}

describe('host application viewer', () => {
  it('keeps application controls visible and routes them through the current Xpra session', async () => {
    const v = await viewer(false, true);
    const first = v.appWindow(1, {title:'Document one'}), second = v.appWindow(2, {title:'Document two'});
    v.client._new_window(1); v.client._new_window(2);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    const button = (selector: string) => dom.window.document.querySelector<HTMLButtonElement>(selector)!;
    expect(button('.mac-app-windows-toggle')).not.toBeNull();
    button('.mac-app-windows-toggle').click();
    const entries = dom.window.document.querySelectorAll<HTMLButtonElement>('.mac-app-window-list button');
    expect(entries).toHaveLength(2);
    entries[1].click();
    expect(v.client.focused_wid).toBe(second.wid);
    button('.mac-app-controls-toggle').click();
    button('[data-picture-mode="clarity"]').click();
    expect(v.client.send).toHaveBeenCalledWith(['quality', 95]);
    expect(v.client.close).not.toHaveBeenCalled();
    button('.mac-app-close').click();
    expect(v.client.send_close_window).toHaveBeenLastCalledWith(second);
    v.client.send_close_window.mockClear();
    button('.mac-app-quit').click();
    expect(v.client.send_close_window).not.toHaveBeenCalled();
    button('.mac-app-confirm-quit').click();
    expect(v.client.send_close_window.mock.calls.map(([win]) => win)).toEqual([first, second]);
    expect(v.nativeWindow.request).not.toHaveBeenCalledWith('close');
  });

  it('keeps modal dialogs open during quit and rejects stale picker actions after disconnection', async () => {
    const v = await viewer();
    const main = v.appWindow(1, {title:'Document'});
    const dialog = v.appWindow(2, {'transient-for':1, modal:true, title:'Save changes'}, 'DIALOG');
    v.client._new_window(1); v.client._new_window(2);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    const doc = dom.window.document;
    doc.querySelector<HTMLButtonElement>('.mac-app-windows-toggle')!.click();
    const previousChoice = doc.querySelector<HTMLButtonElement>('.mac-app-window-list button')!;
    doc.querySelector<HTMLButtonElement>('.mac-app-quit')!.click();
    doc.querySelector<HTMLButtonElement>('.mac-app-confirm-quit')!.click();
    expect(v.client.send_close_window).toHaveBeenCalledOnce();
    expect(v.client.send_close_window).toHaveBeenCalledWith(main);
    expect(v.client.send_close_window).not.toHaveBeenCalledWith(dialog);
    expect(v.state()).toBe('active');
    v.doc.dispatchEvent(new dom.window.Event('connection-lost')); await drain();
    previousChoice.click();
    expect(v.client.focused_wid).toBe(1);
    expect([...doc.querySelectorAll<HTMLButtonElement>('.mac-app-toolbar button')].every(button => button.disabled)).toBe(true);
  });

  it('renders a refreshed ended session without starting Xpra or requesting credentials', async () => {
    const v = await viewer(false, true, false, {state:'ended'});
    expect(v.state()).toBe('ended');
    expect(v.fetch).not.toHaveBeenCalled();
    expect(v.frame.getAttribute('src')).toBeNull();
    expect(v.nativeWindow.request).not.toHaveBeenCalled();
    dom.window.dispatchEvent(new dom.window.Event('offline'));
    expect(v.state()).toBe('ended');
    dom.window.document.querySelector<HTMLButtonElement>('#dismiss')!.click();
    expect(v.nativeWindow.request).toHaveBeenCalledWith('close');
  });

  it('reveals an application that opens only a dialog window', async () => {
    const v = await viewer();
    const dialog = v.appWindow(1, {modal:true}, 'DIALOG');
    v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    expect(v.state()).toBe('active');
    expect(dialog.metadataUpdated).not.toHaveBeenCalled();
  });

  it('directs a failed session back to the application library instead of retrying it', async () => {
    const v = await viewer();
    v.fetch.mockResolvedValue({ok:true,json:async () => ({state:'failed'})});
    v.doc.dispatchEvent(new dom.window.Event('connection-lost')); await drain();
    expect(v.state()).toBe('sessionFailed');
    expect(dom.window.document.querySelector<HTMLButtonElement>('#retry')!.hidden).toBe(true);
  });

  it('fits primary windows, preserves transient dialogs and reveals only painted content', async () => {
    const v = await viewer();
    const primary = v.appWindow(1);
    const dialog = v.appWindow(2, {'transient-for':1}, 'DIALOG');
    const popup = v.appWindow(3, {}, 'POPUP_MENU');
    v.client._new_window(1); v.client._new_window(2); v.client._new_window(3);
    expect(primary.metadataUpdated).toHaveBeenCalledWith({decorations:false});
    expect(dialog.metadataUpdated).not.toHaveBeenCalled();
    expect(dialog.w).toBe(974);
    expect(dialog.h).toBe(625);
    expect(dialog.y + dialog.h).toBeLessThan(680);
    expect(popup.update_metadata).not.toHaveBeenCalled();
    expect(v.state()).toBe('connecting');
    v.client.do_send_damage_sequence(1, 1, 100, 100, -1, 'decode failed');
    expect(v.state()).toBe('connecting');
    v.client.do_send_damage_sequence(2, 1, 100, 100, 10, '');
    expect(v.state()).toBe('active');
    expect(v.frame.getAttribute('aria-hidden')).toBe('false');
  });

  it('connects to an HTML5 client declared as a lexical global', async () => {
    const v = await viewer(false, false, true);
    v.appWindow(1); v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    expect(v.state()).toBe('active');
  });

  it('waits for asynchronous client initialization on cached document reloads', async () => {
    const v = await viewer(true);
    expect(v.state()).toBe('connecting');
    Object.assign(v.frame.contentWindow!, {client:v.client});
    v.doc.dispatchEvent(new dom.window.Event('connection-established'));
    v.appWindow(1); v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    expect(v.state()).toBe('active');
  });

  it('reconnects with fresh credentials and ignores events from the previous connection', async () => {
    const v = await viewer();
    v.appWindow(1); v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    const oldDamage = v.client.do_send_damage_sequence;
    v.doc.dispatchEvent(new dom.window.Event('connection-lost'));
    await drain();
    expect(v.state()).toBe('disconnected');
    expect(v.client.close).toHaveBeenCalled();
    expect(v.frame.getAttribute('aria-hidden')).toBe('true');
    expect(dom.window.document.querySelector<HTMLButtonElement>('#retry')!.hidden).toBe(false);
    oldDamage(2, 1, 100, 100, 10, '');
    expect(v.state()).toBe('disconnected');
    v.fetch.mockResolvedValue({ok:true, json:async () => ({state:'running', password:'renewed'})});
    dom.window.document.querySelector<HTMLButtonElement>('#retry')!.click();
    await drain();
    expect(v.state()).toBe('reconnecting');
    expect(JSON.parse(dom.window.sessionStorage.getItem('/pf/test')!).password).toBe('renewed');
  });

  it('distinguishes an ended session from a recoverable disconnection', async () => {
    const v = await viewer();
    v.fetch.mockResolvedValue({ok:true, json:async () => ({state:'ended'})});
    v.doc.dispatchEvent(new dom.window.Event('connection-lost'));
    await drain();
    expect(v.state()).toBe('ended');
    expect(dom.window.document.querySelector<HTMLButtonElement>('#retry')!.hidden).toBe(true);
  });

  it.each([404, 410])('retains the viewer when its status route returns HTTP %s', async status => {
    const v = await viewer(false, true);
    v.appWindow(1); v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    v.fetch.mockResolvedValue({ok:false, status});
    v.doc.dispatchEvent(new dom.window.Event('connection-lost')); await drain();
    expect(v.state()).toBe('sessionMissing');
    expect(v.nativeWindow.request).not.toHaveBeenCalled();
    dom.window.document.querySelector<HTMLButtonElement>('#retry')!.click(); await drain();
    expect(v.state()).toBe('sessionMissing');
  });

  it('closes the native viewer only after the active application session has ended', async () => {
    const v = await viewer(false, true);
    v.appWindow(1); v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    v.fetch.mockResolvedValue({ok:true, json:async () => ({state:'ended'})});
    v.doc.dispatchEvent(new dom.window.Event('connection-lost'));
    await drain();
    expect(v.nativeWindow.request).toHaveBeenCalledWith('close');
  });

  it('closes after the last Xpra window is destroyed without racing server shutdown', async () => {
    const v = await viewer(false, true);
    v.appWindow(1); v.appWindow(2); v.client._new_window(1); v.client._new_window(2);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    delete v.client.id_to_window[1]; v.client.on_last_window(); await drain();
    expect(v.nativeWindow.request).not.toHaveBeenCalledWith('close');
    delete v.client.id_to_window[2]; v.client.on_last_window(); await drain();
    expect(v.nativeWindow.request).toHaveBeenCalledWith('close');
    expect(v.state()).toBe('ended');
  });

  it('closes a browser popup after its active application ends', async () => {
    const v = await viewer();
    const close = vi.spyOn(dom.window, 'close').mockImplementation(() => {});
    try {
      v.appWindow(1); v.client._new_window(1);
      v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
      v.fetch.mockResolvedValue({ok:true, json:async () => ({state:'ended'})});
      v.doc.dispatchEvent(new dom.window.Event('connection-lost')); await drain();
      expect(close).toHaveBeenCalledOnce();
    } finally { close.mockRestore(); }
  });

  it('keeps native windows open during network loss or an application confirmation dialog', async () => {
    const v = await viewer(false, true);
    v.appWindow(1); v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    const dialog = v.appWindow(2, {'transient-for':1}, 'DIALOG'); v.client._new_window(2);
    dialog.set_minimized(true);
    expect(v.nativeWindow.request).not.toHaveBeenCalled();
    v.fetch.mockRejectedValue(new Error('offline'));
    v.doc.dispatchEvent(new dom.window.Event('connection-lost'));
    await drain();
    expect(v.nativeWindow.request).not.toHaveBeenCalledWith('close');
    expect(v.state()).toBe('disconnected');
  });

  it('ignores window control events from a disconnected client', async () => {
    const v = await viewer(false, true);
    const primary = v.appWindow(1); v.client._new_window(1);
    v.doc.dispatchEvent(new dom.window.Event('connection-lost')); await drain();
    primary.set_maximized(true); primary.set_minimized(true);
    expect(v.nativeWindow.request).not.toHaveBeenCalled();
  });

  it('maps application controls to native window state without treating acknowledgements as new actions', async () => {
    const v = await viewer(false, true);
    const primary = v.appWindow(1); v.client._new_window(1);
    expect(v.client.send_configure_window).toHaveBeenCalledWith(primary, {maximized:false, iconified:false}, false);
    primary.set_maximized(true);
    expect(v.nativeWindow.request).toHaveBeenLastCalledWith('maximize');
    v.windowStateChanged({maximized:true, minimized:false});
    v.nativeWindow.request.mockClear();
    primary.set_maximized(true);
    expect(v.nativeWindow.request).not.toHaveBeenCalled();
    primary.set_maximized(false);
    expect(v.nativeWindow.request).toHaveBeenLastCalledWith('unmaximize');
    primary.set_minimized(true);
    expect(v.nativeWindow.request).toHaveBeenLastCalledWith('minimize');
    v.windowStateChanged({maximized:false, minimized:true});
    v.nativeWindow.request.mockClear();
    primary.set_minimized(true);
    expect(v.nativeWindow.request).not.toHaveBeenCalled();
    v.windowStateChanged({maximized:false, minimized:false});
    expect(v.client.send_configure_window).toHaveBeenLastCalledWith(primary, {maximized:false, iconified:false}, false);
  });
});
