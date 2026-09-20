import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: Record<string, unknown>) => { window: Window & typeof globalThis };
};
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/viewer.js'), 'utf8');
const html = readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/viewer.html'), 'utf8').split('<script nonce=')[0];
const copy = {starting:'Starting', connecting:'Connecting', reconnecting:'Reconnecting', disconnected:'Disconnected', failed:'Failed', ended:'Ended', retry:'Retry', reconnect:'Reconnect', connectionHint:'Return to your application'};
let dom: InstanceType<typeof JSDOM>;
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(() => { dom?.window.close(); });

async function viewer(deferredInitialization = false) {
  dom = new JSDOM(html, { url:'http://localhost/pf/test/_redeven_host_app/', runScripts:'outside-only', pretendToBeVisual:true });
  const fetch = vi.fn().mockResolvedValue({ok:true, json:async () => ({state:'running', password:'private'})});
  dom.window.fetch = fetch;
  dom.window.requestAnimationFrame = cb => { cb(0); return 1; };
  dom.window.eval(`const config = ${JSON.stringify({base:'/pf/test', copy, icon:''})};\n${source}`);
  await drain();
  const frame = dom.window.document.querySelector('iframe')!;
  const doc = frame.contentDocument!;
  doc.open(); doc.write('<html><head></head><body></body></html>'); doc.close();
  const windows: Record<number, ReturnType<typeof appWindow>> = {};
  function appWindow(id: number, metadata: Record<string, unknown> = {}, type = 'NORMAL') {
    const win = {
      wid:id, div:doc.createElement('div'), metadata, windowtype:[type], override_redirect:false, tray:false,
      has_windowtype:(types: string[]) => types.includes(type), screen_resized:vi.fn(),
      set_maximized:vi.fn(), set_minimized:vi.fn(), initiate_moveresize:vi.fn(),
      update_metadata:vi.fn(), handle_resized:vi.fn(), w:1096, h:856, x:100, y:100,
      leftoffset:1, rightoffset:1, topoffset:30, bottomoffset:1,
    };
    windows[id] = win;
    return win;
  }
  const client = {
    _get_desktop_size:() => [1000, 680], id_to_window:windows, connected:true, reconnect:true, reconnect_count:5,
    _new_window:vi.fn(), do_send_damage_sequence:vi.fn(), send_configure_window:vi.fn(),
    send_control_refresh:vi.fn(), close:vi.fn(), callback_close:() => {},
  };
  if (!deferredInitialization) Object.assign(frame.contentWindow!, {client});
  frame.dispatchEvent(new dom.window.Event('load'));
  return {frame, doc, client, appWindow, fetch, state:() => dom.window.document.body.dataset.state};
}

describe('host application viewer', () => {
  it('fits primary windows, preserves transient dialogs and reveals only painted content', async () => {
    const v = await viewer();
    const primary = v.appWindow(1);
    const dialog = v.appWindow(2, {'transient-for':1}, 'DIALOG');
    const popup = v.appWindow(3, {}, 'POPUP_MENU');
    v.client._new_window(1); v.client._new_window(2); v.client._new_window(3);
    expect(primary.update_metadata).toHaveBeenCalledWith({decorations:false, maximized:true});
    expect(dialog.update_metadata).not.toHaveBeenCalled();
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
    expect(dom.window.document.querySelector('button')!.hidden).toBe(false);
    oldDamage(2, 1, 100, 100, 10, '');
    expect(v.state()).toBe('disconnected');
    v.fetch.mockResolvedValue({ok:true, json:async () => ({state:'running', password:'renewed'})});
    dom.window.document.querySelector('button')!.click();
    await drain();
    expect(v.state()).toBe('reconnecting');
    expect(JSON.parse(dom.window.sessionStorage.getItem('/pf/test')!).password).toBe('renewed');
  });

  it('distinguishes an ended session from a recoverable disconnection', async () => {
    const v = await viewer();
    v.fetch.mockResolvedValue({ok:false, status:404});
    v.doc.dispatchEvent(new dom.window.Event('connection-lost'));
    await drain();
    expect(v.state()).toBe('ended');
    expect(dom.window.document.querySelector('button')!.hidden).toBe(true);
  });
});
