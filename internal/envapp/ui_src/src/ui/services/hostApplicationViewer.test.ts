import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: Record<string, unknown>) => { window: Window & typeof globalThis };
};
import { afterEach, describe, expect, it, vi } from 'vitest';

const shared = ['catalog.generated.js', 'remote-input.generated.js', 'remote-pointer.generated.js', 'appearance.js', 'connection.js'].map(file => readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer', file), 'utf8')).join('\n');
const source = shared + '\n' + readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/toolbar.js'), 'utf8') + '\n' + readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/viewer.js'), 'utf8');
const html = readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/viewer.html'), 'utf8').split('<script nonce=')[0].replace('{{.Style}}', '').replace('{{.Locale}}', 'en-US');
const copy = {videoDecoding:'Video decoding', videoAvailable:'Available', videoUnavailable:'Unavailable', httpsPerformanceHint:'Enable HTTPS', starting:'Starting', connecting:'Connecting', reconnecting:'Reconnecting', disconnected:'Disconnected', failed:'Failed', ended:'Ended', retry:'Retry', reconnect:'Reconnect', connectionHint:'Return to your application'};
let dom: InstanceType<typeof JSDOM>;
type DisplayState = {available:boolean; policy:string; density:number; width:number; height:number; limit:null | 'display' | 'density'};
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(() => { dom?.window.close(); });

async function viewer(deferredInitialization = false, native = false, lexicalClient = false, initial?: Record<string, string>, video?: { secure: boolean; encodings: string[] }, savedPicture?: string, pointerVersion = 1, connected = true) {
  dom = new JSDOM(html, { url:'http://localhost/pf/test/_redeven_host_app/', runScripts:'dangerously', pretendToBeVisual:true });
  const fetch = vi.fn().mockResolvedValue({ok:true, json:async () => ({state:'running', password:'private'})});
  dom.window.fetch = fetch;
  Object.assign(dom.window, {matchMedia: () => ({matches:false})});
  Object.defineProperty(dom.window, 'isSecureContext', {value:video?.secure ?? true});
  dom.window.requestAnimationFrame = cb => { cb(0); return 1; };
  let windowStateChanged: (state: { maximized: boolean; minimized: boolean }) => void = () => {};
  const nativeWindow = { request: vi.fn(), subscribe: vi.fn((listener: typeof windowStateChanged) => {
    windowStateChanged = listener;
    listener({ maximized: false, minimized: false });
    return vi.fn();
  }) };
  if (native) Object.assign(dom.window, { redevenHostApplicationWindow: nativeWindow });
  if (savedPicture) dom.window.localStorage.setItem('redeven.xpra-app.picture.v1', savedPicture);
  dom.window.eval(`const config = ${JSON.stringify({base:'/pf/test', copy, icon:'', initial})};\n${source}`);
  await drain();
  const frame = dom.window.document.querySelector('iframe')!;
  const doc = frame.contentDocument!;
  doc.open(); doc.write('<html><head></head><body></body></html>'); doc.close();
  const windows: Record<number, ReturnType<typeof appWindow>> = {};
  const painted = new Set<number>();
  const pointerTargets = new Map<number, {wid:number; window: ReturnType<typeof appWindow>}>();
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
    pointerTargets.set(id, {wid:id, window:win});
    return win;
  }
  const floePointer = {
    version: pointerVersion,
    targetForWindow: (win: {wid:number}) => painted.has(win.wid) ? pointerTargets.get(win.wid) ?? null : null,
    resolveTarget: (event: {target?: EventTarget | null}) => [...pointerTargets.values()].find(target => target.window.div.contains(event.target as Node)) ?? null,
    isTargetValid: (target: {wid:number; window: unknown} | null) => Boolean(target && painted.has(target.wid) && pointerTargets.get(target.wid)?.window === target.window),
    sendPointer: vi.fn().mockReturnValue(true),
    release: vi.fn(),
    onInvalidate: undefined as undefined | (() => void),
  };
  let displayState: DisplayState = {available:true, policy:'logical', density:1, width:1000, height:680, limit:null};
  let displayListener: (state: DisplayState) => void = () => {};
  const unsubscribeDisplay = vi.fn();
  const client = {
    supported_encodings: video?.encodings ?? ['webp'],
    floeInput: {version:1, target:null as {wid:number} | null,
      bindTarget(wid: number | null) { if (this.target?.wid !== wid) this.target = wid ? {wid} : null; return this.target; },
      commitText:vi.fn(), sendKey:vi.fn(), release:vi.fn(), clipboard:vi.fn(), paste:vi.fn(), onError:undefined as undefined | (() => void)},
    _get_desktop_size:() => [1000, 680], id_to_window:windows, connected, reconnect:true, reconnect_count:5,
    floePointer,
    _new_window:vi.fn(), do_send_damage_sequence:vi.fn((...args: [number, number, number, number, number, string]) => { painted.add(args[1]); }), send_configure_window:vi.fn(),
    set_display_density:vi.fn().mockReturnValue(true), scale:1,
    subscribe_display:vi.fn((listener: (state: DisplayState) => void) => {
      displayListener = listener;
      listener(displayState);
      return unsubscribeDisplay;
    }),
    send_control_refresh:vi.fn(), send:vi.fn(), send_close_window:vi.fn(), focused_wid:1, set_focus:vi.fn((win: {wid:number}) => { client.focused_wid = win.wid; }), close:vi.fn(), callback_close:() => {}, on_last_window:vi.fn(),
  };
  Object.assign(frame.contentWindow!, {floeXpraInput:{version:1,getClient:() => (frame.contentWindow as unknown as {client?:unknown}).client}});
  if (!deferredInitialization) {
    Object.assign(frame.contentWindow!, {client});
    if (lexicalClient) Object.assign(frame.contentWindow!, {floeXpraInput:{version:1,getClient:()=>client}});
  }
  frame.dispatchEvent(new dom.window.Event('load'));
  return {frame, doc, client, appWindow, fetch, nativeWindow, unsubscribeDisplay,
    displayChanged: (state: Partial<DisplayState>) => { displayState = {...displayState, ...state}; displayListener(displayState); },
    windowStateChanged: (state: { maximized: boolean; minimized: boolean }) => windowStateChanged(state), state:() => dom.window.document.body.dataset.state};
}

describe('host application viewer', () => {
  it('retains an established Xpra viewer for unknown termination reasons', async () => {
    const v = await viewer(false, true);
    v.appWindow(1); v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    v.fetch.mockResolvedValue({ok:true,json:async () => ({state:'ended',end_reason:'unknown'})});
    v.doc.dispatchEvent(new dom.window.Event('connection-lost')); await drain();
    expect(v.state()).toBe('ended');
    expect(v.nativeWindow.request).not.toHaveBeenCalled();
  });

  it('restores saved clarity after a slow handshake and ignores reselecting the active mode', async () => {
    const v = await viewer(false, false, false, undefined, undefined, 'clarity', 1, false);
    expect(v.client.set_display_density).not.toHaveBeenCalled();
    v.client.connected = true;
    v.client.supported_encodings = ['h264'];
    v.appWindow(1); v.client._new_window(1);
    v.doc.dispatchEvent(new dom.window.Event('connection-established'));
    expect(v.client.set_display_density).toHaveBeenCalledWith('native');
    expect(dom.window.document.querySelector('.host-app-video-status')?.getAttribute('data-app-copy')).toBe('videoAvailable');
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    dom.window.document.querySelector<HTMLButtonElement>('[data-picture-mode="clarity"]')!.click();
    expect(v.client.set_display_density).toHaveBeenCalledOnce();
    expect(v.client.send_control_refresh).toHaveBeenCalledOnce();
  });

  it('explains resolved display limits and clears them after resize without sending controls', async () => {
    const v = await viewer(false, false, false, undefined, undefined, 'clarity');
    const sent = v.client.send.mock.calls.length, refreshed = v.client.send_control_refresh.mock.calls.length;
    v.displayChanged({policy:'native', density:1, width:2200, height:1254, limit:'display'});
    const notice = dom.window.document.querySelector<HTMLElement>('.host-app-display-notice')!;
    expect(notice.hidden).toBe(false);
    expect(notice.querySelector('[data-app-copy="pictureDisplayLimitHint"]')).not.toBeNull();
    expect(dom.window.document.querySelector('.host-app-render-resolution')!.textContent).toBe('2,200 × 1,254');
    v.displayChanged({density:2, width:2560, height:1508, limit:null});
    expect(notice.hidden).toBe(true);
    expect(dom.window.document.querySelector('.host-app-render-resolution')!.textContent).toBe('2,560 × 1,508');
    expect(v.client.send).toHaveBeenCalledTimes(sent);
    expect(v.client.send_control_refresh).toHaveBeenCalledTimes(refreshed);
    expect(v.client.close).not.toHaveBeenCalled();
    v.client.callback_close();
    expect(v.unsubscribeDisplay).toHaveBeenCalledOnce();
    v.displayChanged({limit:'display'});
    expect(notice.hidden).toBe(true);
  });

  it('distinguishes density safety limits and preserves selection when copy changes', async () => {
    const v = await viewer(false, false, false, undefined, undefined, 'clarity');
    v.displayChanged({policy:'native', density:4, limit:'density'});
    expect(dom.window.document.querySelector('[data-app-copy="pictureDensityLimitHint"]')).not.toBeNull();
    const calls = v.client.send.mock.calls.length;
    dom.window.document.documentElement.lang = 'zh-CN'; await drain();
    expect(dom.window.document.querySelector('[data-picture-mode="clarity"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(v.client.send).toHaveBeenCalledTimes(calls);
  });

  it('keeps native input and local chrome outside the remote pixel touch policy', async () => {
    const v = await viewer();
    expect(v.doc.body.hasAttribute('data-floe-remote-pointer')).toBe(false);
    expect(v.doc.querySelector('.floe-remote-input')?.closest('[data-floe-remote-pointer]')).toBeNull();
  });

  it('restores clarity on attachment through the published display API without reconnecting', async () => {
    const v = await viewer(false, false, false, undefined, undefined, 'clarity');
    expect(v.client.set_display_density).toHaveBeenCalledWith('native');
    expect(v.client.send_control_refresh).toHaveBeenCalledTimes(1);
    expect(v.client.send_control_refresh).toHaveBeenCalledWith(100, {'refresh-now':true});
    v.doc.dispatchEvent(new dom.window.Event('connection-established'));
    expect(v.client.send_control_refresh).toHaveBeenCalledOnce();
    expect(v.client.close).not.toHaveBeenCalled();
  });

  it('explains how to upgrade retained application resources without closing the application', async () => {
    const v = await viewer();
    Object.defineProperty(dom.window, 'devicePixelRatio', {value:2});
    v.client.set_display_density.mockReturnValue(false);
    v.appWindow(1); v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    dom.window.document.querySelector<HTMLButtonElement>('[data-picture-mode="clarity"]')!.click();
    expect(dom.window.document.querySelector('[data-app-copy="pictureReopenHint"]')).not.toBeNull();
    expect(v.client.close).not.toHaveBeenCalled();
    expect(v.client.send_close_window).not.toHaveBeenCalled();
    dom.window.document.querySelector<HTMLButtonElement>('[data-picture-mode="auto"]')!.click();
    expect(dom.window.document.querySelector('[data-app-copy="pictureReopenHint"]')).toBeNull();
  });

  it('keeps dialog margins in logical pixels at native density', async () => {
    const v = await viewer();
    v.client.scale = 2;
    const dialog = v.appWindow(2, {'transient-for':1}, 'DIALOG');
    v.client._new_window(2);
    expect(dialog.w).toBe(950);
    expect(dialog.h).toBe(601);
    expect(dialog.x).toBeGreaterThanOrEqual(dialog.leftoffset + 24);
    expect(dialog.y).toBeGreaterThanOrEqual(dialog.topoffset + 24);
  });

  it.each([
    {secure:false, encodings:['webp'], available:false, guidance:true},
    {secure:true, encodings:['webp'], available:false, guidance:false},
    {secure:true, encodings:['webp', 'h264'], available:true, guidance:false},
  ])('reports negotiated decoding capability without promising video from HTTPS alone: %j', async sample => {
    const v = await viewer(false, false, false, undefined, sample);
    const status = dom.window.document.querySelector<HTMLElement>('.host-app-video-status')!;
    expect(status).not.toBeNull();
    expect(status.textContent).toBe(sample.available ? 'Available' : 'Unavailable');
    expect(dom.window.document.querySelector<HTMLElement>('.host-app-https-hint')!.hidden).toBe(!sample.guidance);
    expect(v.client.send).not.toHaveBeenCalled();
  });

  it.each(['.mac-app-controls', '.mac-app-toolbar', '.mac-app-toolbar-spacer', '.mac-app-toolbar-separator', '.host-app-identity'])(
    'dismisses toolbar popovers on %s input without acting on the application', async selector => {
      const v = await viewer(false, true);
      v.appWindow(1); v.client._new_window(1);
      v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
      const doc = dom.window.document;
      const popover = doc.querySelector<HTMLElement>('.mac-app-popover')!;
      for (const section of ['.mac-app-controls-toggle', '.mac-app-windows-toggle', '.mac-app-quit']) {
        const toggle = doc.querySelector<HTMLButtonElement>(section)!;
        toggle.click();
        expect(popover.hidden).toBe(false);
        const event = new dom.window.Event('pointerdown', {bubbles:true, cancelable:true});
        doc.querySelector(selector)!.dispatchEvent(event);
        expect(popover.hidden).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(event.defaultPrevented).toBe(false);
      }
      expect(v.client.send_close_window).not.toHaveBeenCalled();
      expect(v.client.close).not.toHaveBeenCalled();
    },
  );

  it('preserves active-trigger toggling and switches popovers on another trigger', async () => {
    const v = await viewer(false, true);
    v.appWindow(1); v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    const doc = dom.window.document;
    const picture = doc.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!;
    const windows = doc.querySelector<HTMLButtonElement>('.mac-app-windows-toggle')!;
    const popover = doc.querySelector<HTMLElement>('.mac-app-popover')!;
    picture.click();
    picture.querySelector('svg')!.dispatchEvent(new dom.window.Event('pointerdown', {bubbles:true}));
    picture.focus(); picture.click();
    expect(popover.hidden).toBe(true);
    picture.click();
    windows.dispatchEvent(new dom.window.Event('pointerdown', {bubbles:true}));
    expect(popover.hidden).toBe(true);
    windows.focus(); windows.click();
    expect(popover.hidden).toBe(false);
    expect(popover.dataset.section).toBe('windows');
    expect(picture.getAttribute('aria-expanded')).toBe('false');
    picture.focus();
    expect(popover.hidden).toBe(true);
  });

  it.each(['.mac-app-controls-toggle', '.mac-app-windows-toggle', '.mac-app-quit'])(
    'dismisses %s from inside Xpra without consuming application input', async selector => {
      const v = await viewer(false, true);
      const win = v.appWindow(1, {title:'Document'});
      v.doc.body.append(win.div);
      v.client._new_window(1);
      v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
      const toggle = dom.window.document.querySelector<HTMLButtonElement>(selector)!;
      const popover = dom.window.document.querySelector<HTMLElement>('.mac-app-popover')!;
      const input = vi.fn((event: Event) => event.stopPropagation());
      win.div.addEventListener('pointerdown', input);
      for (let index = 0; index < 2; index++) {
        toggle.click();
        expect(popover.hidden).toBe(false);
        const event = new dom.window.Event('pointerdown', {bubbles:true, cancelable:true});
        win.div.dispatchEvent(event);
        expect(popover.hidden).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(event.defaultPrevented).toBe(false);
        expect(input).toHaveBeenCalledTimes(index + 1);
        expect(dom.window.document.activeElement).not.toBe(toggle);
      }
      toggle.click();
      win.div.dispatchEvent(new dom.window.FocusEvent('focusin', {bubbles:true}));
      expect(popover.hidden).toBe(true);
      expect(v.client.send_close_window).not.toHaveBeenCalled();
      expect(v.client.close).not.toHaveBeenCalled();
    },
  );

  it('dismisses on outer content input even when the target stops bubbling', async () => {
    const v = await viewer();
    v.appWindow(1); v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    const doc = dom.window.document;
    doc.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!.click();
    doc.body.addEventListener('pointerdown', event => event.stopPropagation(), {once:true});
    doc.body.dispatchEvent(new dom.window.Event('pointerdown', {bubbles:true}));
    expect(doc.querySelector<HTMLElement>('.mac-app-popover')!.hidden).toBe(true);
  });

  it('waits for a window after a confirmed connection without a first-window deadline', async () => {
    const v = await viewer(false, true);
    v.doc.dispatchEvent(new dom.window.Event('connection-established'));
    expect(v.state()).toBe('waiting');
    expect(v.nativeWindow.request).not.toHaveBeenCalled();
    v.appWindow(1);
    v.client._new_window(1);
    expect(v.state()).toBe('connecting');
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    expect(v.state()).toBe('active');
  });
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
    expect(v.client.set_display_density).toHaveBeenLastCalledWith('native');
    expect(v.client.send_control_refresh).toHaveBeenLastCalledWith(100, {'refresh-now':true});
    button('[data-picture-mode="auto"]').click();
    expect(v.client.set_display_density).toHaveBeenLastCalledWith('logical');
    expect(v.client.send).toHaveBeenCalledWith(['quality', -1]);
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

  it('does not redirect close-all to a lone save dialog', async () => {
    const v = await viewer();
    v.appWindow(1, {modal:true, title:'Save changes'}, 'DIALOG');
    v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    dom.window.document.querySelector<HTMLButtonElement>('.mac-app-quit')!.click();
    dom.window.document.querySelector<HTMLButtonElement>('.mac-app-confirm-quit')!.click();
    expect(v.client.send_close_window).not.toHaveBeenCalled();
    expect(v.state()).toBe('active');
  });

  it('directs a failed session back to the application library instead of retrying it', async () => {
    const v = await viewer(false, true);
    v.appWindow(1); v.client._new_window(1);
    v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
    expect(v.state()).toBe('active');
    v.fetch.mockResolvedValue({ok:true,json:async () => ({state:'failed', error_code:'capture_failed'})});
    v.doc.dispatchEvent(new dom.window.Event('connection-lost')); await drain();
    expect(v.state()).toBe('sessionFailed');
    expect(dom.window.document.querySelector<HTMLButtonElement>('#retry')!.hidden).toBe(true);
    expect(v.nativeWindow.request).not.toHaveBeenCalledWith('close');
    expect(dom.window.document.querySelector<HTMLButtonElement>('#dismiss')!.hidden).toBe(false);
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

  it('uses the published client accessor independently of global client declarations', async () => {
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
    v.fetch.mockResolvedValue({ok:true, json:async () => ({state:'ended',end_reason:'application_exited'})});
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
    expect(v.state()).toBe('windowsClosed');
  });

  it('closes a browser popup after its active application ends', async () => {
    const v = await viewer();
    Object.assign(dom.window, {opener:{}});
    const close = vi.spyOn(dom.window, 'close').mockImplementation(() => {});
    try {
      v.appWindow(1); v.client._new_window(1);
      v.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
      v.fetch.mockResolvedValue({ok:true, json:async () => ({state:'ended',end_reason:'application_exited'})});
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

async function inputViewer(pointerVersion = 1) {
  const v = await viewer(false, false, false, undefined, undefined, undefined, pointerVersion);
  const win = v.appWindow(1); v.doc.body.append(win.div); v.client._new_window(1);
  const input = v.doc.querySelector<HTMLTextAreaElement>('textarea')!;
  const commit = (text: string) => {
    input.dispatchEvent(new dom.window.CompositionEvent('compositionstart'));
    input.value = text;
    input.dispatchEvent(new dom.window.InputEvent('input', {inputType:'insertCompositionText', data:text, isComposing:true}));
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Enter', isComposing:true}));
    input.dispatchEvent(new dom.window.CompositionEvent('compositionend', {data:text}));
    input.dispatchEvent(new dom.window.InputEvent('input', {inputType:'insertText', data:text}));
    input.dispatchEvent(new dom.window.KeyboardEvent('keyup', {key:'Enter'}));
  };
  return {...v, input, commit, paint: (wid = 1) => v.client.do_send_damage_sequence(1, wid, 100, 100, 10, '')};
}

it('gates composition by painted target and delivers repeated Unicode commits once each', async () => {
  const v = await inputViewer();
  v.commit('before frame'); expect(v.client.floeInput.commitText).not.toHaveBeenCalled();
  v.paint();
  const expected = '中文日本語한글🙂👩🏽‍💻e\u0301𠮷';
  v.commit(expected); v.commit(expected);
  expect(v.client.floeInput.commitText.mock.calls).toEqual([[expected, v.client.floeInput.target], [expected, v.client.floeInput.target]]);
  expect(v.client.floeInput.sendKey).not.toHaveBeenCalled();
});

it('cancels composition and gates the keyboard while another window awaits its first frame', async () => {
  const v = await inputViewer(); v.paint(); v.input.focus();
  v.input.dispatchEvent(new dom.window.CompositionEvent('compositionstart'));
  const second = v.appWindow(2); v.client._new_window(2); v.client.set_focus(second);
  expect(v.input.disabled).toBe(true);
  expect(dom.window.document.querySelector<HTMLButtonElement>('.mac-app-keyboard')!.disabled).toBe(true);
  v.paint(2);
  v.input.dispatchEvent(new dom.window.CompositionEvent('compositionend', {data:'old'}));
  v.input.dispatchEvent(new dom.window.InputEvent('input', {inputType:'insertFromComposition', data:'old'}));
  expect(v.client.floeInput.commitText).not.toHaveBeenCalled();
  v.commit('new');
  expect(v.client.floeInput.commitText).toHaveBeenCalledExactlyOnceWith('new', v.client.floeInput.target);
  expect(v.client.floeInput.target?.wid).toBe(2);
});

it('requires an explicit touch keyboard action and retains the editor across viewport changes', async () => {
  const v = await inputViewer(); v.paint();
  const target = v.doc.querySelector('div')!;
  const touch = () => Object.assign(new dom.window.Event('pointerdown', {bubbles:true}), {pointerType:'touch', clientX:100, clientY:120});
  target.dispatchEvent(touch());
  expect(v.doc.activeElement).not.toBe(v.input);
  const keyboard = dom.window.document.querySelector<HTMLButtonElement>('.mac-app-keyboard')!;
  keyboard.click();
  expect(v.doc.activeElement).toBe(v.input);
  expect(keyboard.getAttribute('aria-pressed')).toBe('true');
  v.frame.contentWindow!.dispatchEvent(new dom.window.Event('resize'));
  expect(v.doc.querySelector('textarea')).toBe(v.input);
  expect(v.client.close).not.toHaveBeenCalled();
  keyboard.click(); expect(v.doc.activeElement).not.toBe(v.input);
});

it('routes an Xpra touch drag to the shared pointer adapter as scroll', async () => {
  const v = await inputViewer(); v.paint();
  const target = v.doc.querySelector('div')!;
  const event = (type: string, x: number, y: number) => Object.assign(new dom.window.Event(type, {bubbles:true, cancelable:true}), {
    pointerType: 'touch', pointerId: 1, clientX: x, clientY: y, button: 0, detail: 1,
  });
  target.dispatchEvent(event('pointerdown', 320, 286));
  target.dispatchEvent(event('pointermove', 300, 206));
  await drain();
  target.dispatchEvent(event('pointerup', 300, 206));
  await drain();
  expect(v.client.floePointer.sendPointer.mock.calls.some(([command]) => command.kind === 'scroll' && command.dx === 20 && command.dy === 80)).toBe(true);
  expect(v.client.floePointer.sendPointer.mock.calls.some(([command]) => command.kind === 'down' || command.kind === 'up')).toBe(false);
});

it('binds editor focus and one button pair through explicit pointer activation', async () => {
  const v = await inputViewer(); v.paint();
  const target = v.doc.querySelector('div')!;
  target.dispatchEvent(Object.assign(new dom.window.Event('pointerdown', {bubbles:true, cancelable:true}), {pointerType:'mouse', button:0, clientX:40, clientY:40}));
  target.dispatchEvent(Object.assign(new dom.window.Event('pointerup', {bubbles:true}), {pointerType:'mouse'}));
  expect(v.doc.activeElement).toBe(v.input);
  expect(v.client.floePointer.sendPointer.mock.calls.map(([command])=>command.kind)).toEqual(['down','up']);
});

it('routes clipboard to the published adapter and never also submits its text', async () => {
  const v = await inputViewer(); v.paint();
  v.client.floeInput.clipboard.mockImplementation(() => true);
  v.client.floeInput.paste.mockImplementation(event => event.preventDefault());
  v.input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'v', code:'KeyV', ctrlKey:true}));
  const paste = new dom.window.Event('paste', {cancelable:true}); v.input.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(true);
  expect(v.client.floeInput.paste).toHaveBeenCalledExactlyOnceWith(paste, v.client.floeInput.target);
  expect(v.client.floeInput.sendKey).not.toHaveBeenCalled();
  expect(v.client.floeInput.commitText).not.toHaveBeenCalled();
});

it('releases held keys on toolbar focus and never replays text after input failure', async () => {
  const v = await inputViewer(); v.paint(); v.input.focus();
  v.input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Shift', code:'ShiftLeft', shiftKey:true}));
  dom.window.document.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!.focus();
  // JSDOM does not emit the browser's child-window blur when focus crosses an iframe.
  v.frame.contentWindow!.dispatchEvent(new dom.window.Event('blur'));
  expect(v.client.floeInput.release).toHaveBeenCalledWith(v.client.floeInput.target);
  v.client.floeInput.onError?.(); await drain();
  expect(v.state()).toBe('inputUnavailable');
  v.commit('late'); expect(v.client.floeInput.commitText).not.toHaveBeenCalled();
});

it('requires reopening an old input protocol without closing the host application', async () => {
  const v = await inputViewer(); v.client.floeInput.version = 0; v.paint();
  expect(v.state()).toBe('inputVersionUnsupported');
  expect(v.client.send_close_window).not.toHaveBeenCalled();
  expect((dom.window.document.getElementById('retry') as HTMLButtonElement).hidden).toBe(true);
});

it('requires reopening an old pointer protocol without closing the host application', async () => {
  const v = await inputViewer(0); v.paint();
  expect(v.state()).toBe('inputVersionUnsupported');
  expect(v.client.send_close_window).not.toHaveBeenCalled();
  expect((dom.window.document.getElementById('retry') as HTMLButtonElement).hidden).toBe(true);
});

it('cancels composition before an outer toolbar pointer triggers iframe blur', async () => {
  const v = await inputViewer(); v.paint(); v.input.focus();
  v.input.dispatchEvent(new dom.window.CompositionEvent('compositionstart'));
  v.input.value = 'pending';
  dom.window.document.querySelector('.mac-app-controls-toggle')!.dispatchEvent(new dom.window.Event('pointerdown', {bubbles:true}));
  v.input.dispatchEvent(new dom.window.CompositionEvent('compositionend', {data:'pending'}));
  expect(v.client.floeInput.commitText).not.toHaveBeenCalled();
});

it('updates the iframe editor label in place when the viewer locale changes', async () => {
  const v = await inputViewer(); v.paint();
  dom.window.document.documentElement.lang = 'zh-CN'; await drain();
  expect(v.input.getAttribute('aria-label')).toBe('应用键盘输入');
  expect(v.doc.querySelector('textarea')).toBe(v.input);
  expect(v.client.close).not.toHaveBeenCalled();
});
