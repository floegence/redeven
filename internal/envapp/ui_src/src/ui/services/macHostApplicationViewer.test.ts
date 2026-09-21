import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: Record<string, unknown>) => { window: Window & typeof globalThis };
};
const shared = readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/connection.js'), 'utf8');
const source = shared + '\n' + readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/macos.js'), 'utf8');
const html = readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/viewer.html'), 'utf8').split('<script nonce=')[0].replace('{{.Style}}', '');
let dom: InstanceType<typeof JSDOM>;
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => { dom?.window.dispatchEvent(new dom.window.Event('beforeunload')); dom?.window.close(); vi.useRealTimers(); });

async function viewer(video = false, icon = '', initial?: Record<string, string>) {
  dom = new JSDOM(html, { url: 'http://localhost/pf/test/_redeven_host_app/', runScripts: 'dangerously', pretendToBeVisual: true });
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: 'running', password: 'private' }) });
  const drawImage = vi.fn();
  const bitmap = vi.fn().mockResolvedValue({ width: 640, height: 480, close: vi.fn() });
  const native = { request: vi.fn() };
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 1;
    onmessage?: (event: { data: unknown }) => void;
    onclose?: () => void;
    onopen?: () => Promise<void>;
    generation = 1; frameID = 0;
    send = vi.fn();
    close = vi.fn(() => { this.readyState = 3; });
    constructor(readonly url: URL, readonly protocols: string[]) { Socket.instances.push(this); }
    message(value: unknown) { const msg = value as {type: string; generation: number}; if (msg.type === 'window') this.generation = msg.generation; this.onmessage?.({ data: JSON.stringify(value) }); }
    frame(metadata: Record<string, unknown> = {}) {
      const header = new TextEncoder().encode(JSON.stringify({codec: 'jpeg', generation: this.generation, frame_id: ++this.frameID, transport: 'images', ...metadata}));
      const packet = new dom.window.Uint8Array(4 + header.length + 5);
      new dom.window.DataView(packet.buffer).setUint32(0, header.length); packet.set(header, 4);
      this.onmessage?.({data: packet.buffer});
    }
  }
  vi.spyOn(dom.window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const decoders: Decoder[] = [];
  class Decoder {
    static isConfigSupported = vi.fn().mockResolvedValue({supported: video});
    state = 'unconfigured';
    constructor(readonly callbacks: { output: (frame: unknown) => void; error: (error: Error) => void }) { decoders.push(this); }
    configure = vi.fn(() => { this.state = 'configured'; });
    decode = vi.fn(() => { this.callbacks.output({displayWidth: 1280, displayHeight: 960, close: vi.fn()}); });
    close() { this.state = 'closed'; }
  }
  Object.assign(dom.window, { TextDecoder, TextEncoder, VideoDecoder: video ? Decoder : undefined, EncodedVideoChunk: class { constructor(public value: unknown) {} }, fetch, WebSocket: Socket, createImageBitmap: bitmap, redevenHostApplicationWindow: native });
  const statisticsTicks: (() => void)[] = [];
  vi.spyOn(dom.window, 'setInterval').mockImplementation(((callback: () => void) => { statisticsTicks.push(callback); return 1; }) as typeof dom.window.setInterval);
  dom.window.eval(`const config = ${JSON.stringify({ base: '/pf/test', icon, initial, copy: { permissionRequired: 'Host permission is required', permissionHint: 'Allow screen recording and accessibility, then reconnect.', sessionUnavailable: 'The graphical session is unavailable', sessionHint: 'Unlock the Mac and sign in, then reconnect.', sessionFailed: 'Application sharing has stopped', reopenHint: 'Return to Host Applications and open the app again.', captureHint: 'Reconnect or choose another window.', controls: 'Application controls', "picture": "Picture quality", "pictureAuto": "Automatic", "pictureClarity": "Clarity first", "pictureSmooth": "Motion first", "pictureData": "Save data", "pictureHint": "Changes apply immediately. Still images sharpen automatically; the actual frame rate depends on motion and connection speed.", "pictureAdvanced": "Advanced", "picturePixels": "Actual resolution", "pictureResolution": "Resolution limit", "pictureFrameRate": "Frame rate limit", "pictureActualRate": "Actual frame rate", "pictureBandwidth": "Bandwidth", "pictureTransport": "Transport", "pictureVideo": "Hardware video", "pictureImages": "Image stream", operationFailed: 'The action could not be completed. Try again.', waiting: 'Waiting for the application window…', captureUnavailable: 'Window capture is unavailable.', windows: 'Windows', menu: 'Menu', closeWindow: 'Close window', quit: 'Quit application', quitTitle: 'Quit this application?', quitDescription: 'All application windows will close. You can cancel in a save dialog.', quitPending: 'Respond to any save dialog in the application.', quitFailed: 'Quit could not be confirmed.', cancel: 'Cancel', input: 'Input', retry: 'Retry', reconnect: 'Reconnect' } })};\n${source}`);
  await drain();
  const socket = () => Socket.instances.at(-1)!;
  const state = () => dom.window.document.body.dataset.state;
  const window = (generation = 1) => socket().message({ type: 'window', window: 'owned', generation, width: 640, height: 480 });
  const activate = async () => { window(); socket().frame(); await drain(); socket().send.mockClear(); };
  const retry = async () => { (dom.window.document.getElementById('retry') as HTMLButtonElement).click(); await drain(); };
  return { socket, state, window, activate, retry, fetch, bitmap, drawImage, native, decoders, statisticsTicks };
}

describe('macOS application viewer', () => {
  it.each([
    ['application_exited', 'applicationExited'],
    ['windows_closed', 'windowsClosed'],
    ['sharing_stopped', 'sharingStopped'],
    ['', 'ended'],
  ])('renders a refreshed terminal document immediately (%s)', async (end_reason, state) => {
    const v = await viewer(false, '', {state: 'ended', end_reason});
    expect(v.state()).toBe(state);
    expect(v.fetch).not.toHaveBeenCalled();
    expect(v.socket()).toBeUndefined();
    expect(v.native.request).not.toHaveBeenCalled();
    expect(dom.window.document.getElementById('connection')!.getAttribute('aria-busy')).toBe('false');
    expect((dom.window.document.getElementById('retry') as HTMLButtonElement).hidden).toBe(true);
    expect((dom.window.document.getElementById('dismiss') as HTMLButtonElement).hidden).toBe(false);
  });

  it('rejects an unknown successful status before opening a capture stream', async () => {
    const v = await viewer();
    v.socket().onclose?.(); await drain();
    v.fetch.mockResolvedValue({ok:true, json:async () => ({state:'unexpected',password:'private'})});
    await v.retry();
    expect(v.state()).toBe('disconnected');
    expect(v.socket().close).toHaveBeenCalled();
  });

  it('does not offer an ineffective close action in a directly opened browser tab', async () => {
    const v = await viewer();
    Object.assign(dom.window, { redevenHostApplicationWindow: undefined, opener: null });
    v.fetch.mockResolvedValue({ok:true, json:async () => ({state:'ended', end_reason:'windows_closed'})});
    v.socket().onclose?.(); await drain();
    expect(v.state()).toBe('windowsClosed');
    expect((dom.window.document.getElementById('dismiss') as HTMLButtonElement).hidden).toBe(true);
  });

  it.each([401, 403, 423])('keeps access denial distinct from session closure (%s)', async status => {
    const v = await viewer(); await v.activate();
    v.fetch.mockResolvedValue({ok:false,status});
    v.socket().onclose?.(); await drain();
    expect(v.state()).toBe('accessRequired');
    expect(v.native.request).not.toHaveBeenCalled();
    expect((dom.window.document.getElementById('retry') as HTMLButtonElement).hidden).toBe(false);
  });

  it('checks authoritative state before showing a transport error', async () => {
    const v = await viewer(); await v.activate();
    let resolve!: (value: unknown) => void;
    v.fetch.mockReturnValue(new Promise(done => { resolve = done; }));
    v.socket().onclose?.();
    expect(v.state()).toBe('checking');
    resolve({ok:true,json:async () => ({state:'ended',end_reason:'application_exited'})}); await drain();
    expect(v.state()).toBe('applicationExited');
    expect(v.native.request).toHaveBeenCalledWith('close');
  });

  it('bounds a stalled status reconciliation and ignores its late result', async () => {
    const v = await viewer(); await v.activate();
    let timeout!: () => void;
    vi.spyOn(dom.window, 'setTimeout').mockImplementation(((callback: () => void, delay: number) => {
      expect(delay).toBe(6000); timeout = callback; return 1;
    }) as typeof dom.window.setTimeout);
    let resolve!: (value: unknown) => void;
    v.fetch.mockReturnValue(new Promise(done => { resolve = done; }));
    v.socket().onclose?.();
    expect(v.state()).toBe('checking');
    timeout();
    expect(v.state()).toBe('disconnected');
    resolve({ok:true,json:async () => ({state:'ended'})}); await drain();
    expect(v.state()).toBe('disconnected');
    expect(v.native.request).not.toHaveBeenCalled();
  });

  it('discards unfinished composition when the displayed window changes', async () => {
    const v = await viewer(); await v.activate();
    const input = dom.window.document.querySelector('textarea')!;
    input.value = 'unfinished';
    input.dispatchEvent(new dom.window.CompositionEvent('compositionstart'));
    input.dispatchEvent(new dom.window.InputEvent('input', {isComposing: true}));
    v.window(2); v.socket().frame(); await drain();
    // The IME may commit its pending text after the replacement frame arrives.
    input.value = 'unfinished';
    input.dispatchEvent(new dom.window.CompositionEvent('compositionend'));
    expect(v.socket().send.mock.calls.map(c => JSON.parse(c[0])).filter(c => c.action === 'input')).toEqual([]);
    expect(input.value).toBe('');
  });

  it('does not deliver queued pointer coordinates to a replacement window', async () => {
    const v = await viewer(); await v.activate();
    let move!: FrameRequestCallback;
    vi.spyOn(dom.window, 'requestAnimationFrame').mockImplementation(callback => { move = callback; return 1; });
    dom.window.document.querySelector('canvas')!.dispatchEvent(new dom.window.MouseEvent('pointermove', {clientX: 20, clientY: 30}));
    v.window(2); v.socket().frame(); await drain();
    move(0);
    expect(v.socket().send.mock.calls.map(c => JSON.parse(c[0])).filter(c => c.action === 'input')).toEqual([]);
  });

  it('rejects stale native menu responses after a capture generation changes', async () => {
    const v = await viewer(); await v.activate();
    const menu = {type:'menu', generation:1, items:[{id:'old',title:'Old action',enabled:true,children:[]}]};
    v.socket().message(menu);
    v.window(2); v.socket().frame(); await drain();
    const panel = dom.window.document.querySelector<HTMLElement>('.mac-app-menu')!;
    expect(panel.hidden).toBe(true);
    v.socket().message(menu);
    expect(panel.hidden).toBe(true);
  });

  it('exposes every window through a separate counted picker and keeps it open during switching', async () => {
    const v = await viewer(); await v.activate();
    v.socket().message({type:'windows',windows:[{id:'owned',title:'Document A'},{id:'other',title:'Document B'}]});
    const toggle = dom.window.document.querySelector<HTMLButtonElement>('.mac-app-windows-toggle')!;
    expect(toggle).not.toBeNull();
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toContain('2');
    toggle.click();
    const panel = dom.window.document.querySelector<HTMLElement>('.mac-app-window-picker')!;
    expect(panel.hidden).toBe(false);
    const rows = panel.querySelectorAll<HTMLButtonElement>('button');
    expect([...rows].map(row => row.textContent)).toEqual(['Document A', 'Document B']);
    expect(rows[0].getAttribute('aria-pressed')).toBe('true');
    rows[1].click();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({action:'select',window:'other',generation:1});
    v.socket().message({type:'window',window:'other',generation:2,width:640,height:480});
    expect(panel.hidden).toBe(false);
    expect(rows[1].getAttribute('aria-busy')).toBe('true');
    v.socket().frame(); await drain();
    expect(rows[1].getAttribute('aria-pressed')).toBe('true');
    expect(rows[1].getAttribute('aria-busy')).toBe('false');
    expect(panel.hidden).toBe(false);
    rows[0].focus();
    v.socket().message({type:'windows',windows:[{id:'other',title:'Document B'},{id:'owned',title:'Renamed document'}]});
    expect(dom.window.document.activeElement?.textContent).toBe('Renamed document');
    v.socket().message({type:'windows',windows:[{id:'other',title:'Document B'}]});
    expect(toggle.textContent).toContain('1');
    expect(panel.querySelectorAll('button')).toHaveLength(1);
    expect(dom.window.document.activeElement).toBe(toggle);
  });

  it('keeps other application windows selectable when one capture source fails', async () => {
    const v = await viewer(); await v.activate();
    v.socket().message({type:'windows',windows:[{id:'owned',title:'Main'},{id:'other',title:'Other'}]});
    v.socket().message({type:'capture_error',generation:2,code:'CAPTURE_SOURCE_UNAVAILABLE'});
    expect(v.state()).toBe('captureUnavailable');
    expect(v.socket().close).not.toHaveBeenCalled();
    const controls = dom.window.document.querySelector<HTMLElement>('.mac-app-controls')!;
    expect(controls.hidden).toBe(false);
    controls.querySelector<HTMLButtonElement>('.mac-app-windows-toggle')!.click();
    const other = [...controls.querySelectorAll<HTMLButtonElement>('.mac-app-window-list button')].find(button => button.textContent === 'Other')!;
    expect(other.disabled).toBe(false);
    other.click();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({action:'select',window:'other',generation:2});
    v.socket().frame({generation:1}); await drain();
    expect(v.state()).toBe('captureUnavailable');
    v.window(3); v.socket().frame(); await drain();
    expect(v.state()).toBe('active');
  });

  it.each([['PERMISSION_REQUIRED','permissionRequired'],['GRAPHICAL_SESSION_REQUIRED','sessionUnavailable']])(
    'explains %s independently of network failure and preserves explicit recovery', async (code, state) => {
      const v = await viewer(); await v.activate();
      v.socket().message({type:'blocked',code,generation:2});
      expect(v.state()).toBe(state);
      expect(v.native.request).not.toHaveBeenCalled();
      expect(dom.window.document.getElementById('hint')!.textContent).toContain(code === 'PERMISSION_REQUIRED' ? 'screen recording' : 'Unlock the Mac');
      expect((dom.window.document.getElementById('retry') as HTMLButtonElement).hidden).toBe(false);
      await v.retry(); await v.activate(); expect(v.state()).toBe('active');
    });

  it('does not offer a futile reconnect for an explicitly failed sharing session', async () => {
    const v = await viewer(); await v.activate();
    v.fetch.mockResolvedValue({ok:true,json:async () => ({state:'failed',error_code:'native_helper_unavailable'})});
    v.socket().onclose?.(); await drain();
    expect(v.state()).toBe('sessionFailed');
    expect(dom.window.document.getElementById('hint')!.textContent).toContain('Return to Host Applications');
    expect((dom.window.document.getElementById('retry') as HTMLButtonElement).hidden).toBe(true);
    expect(v.native.request).not.toHaveBeenCalled();
  });

  it('keeps the stream and pixels after an operation fails and allows the next action', async () => {
    const v = await viewer(); await v.activate();
    for (const code of ['WINDOW_NOT_FOCUSED', 'INPUT_UNCONFIRMED', 'TARGET_NOT_READY']) {
      v.socket().message({ type: 'operation_error', action: 'input', code });
      expect(v.state()).toBe('active');
      expect(v.socket().close).not.toHaveBeenCalled();
      expect(dom.window.document.querySelector('.mac-app-feedback')?.textContent).toContain('The action could not be completed');
    }
    dom.window.document.querySelector('textarea')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({ action: 'input', key: 'ArrowLeft' });
    v.socket().message({ type: 'operation_complete' });
    expect((dom.window.document.querySelector('.mac-app-feedback') as HTMLElement).hidden).toBe(true);
  });

  it('waits through window replacement without closing or reconnecting the session', async () => {
    const v = await viewer(); await v.activate();
    v.socket().message({ type: 'waiting' });
    expect(v.state()).toBe('waiting');
    expect(v.socket().close).not.toHaveBeenCalled();
    expect(v.native.request).not.toHaveBeenCalled();
    v.window(2); v.socket().frame(); await drain();
    expect(v.state()).toBe('active');
    expect(v.fetch).toHaveBeenCalledOnce();
  });

  it('distinguishes capture recovery from a network disconnect', async () => {
    const v = await viewer(); await v.activate();
    v.socket().message({ type: 'capture_error', code: 'CAPTURE_FAILED' });
    expect(v.state()).toBe('captureUnavailable');
    expect(dom.window.document.getElementById('status')?.textContent).toBe('Window capture is unavailable.');
    await v.retry(); await v.activate();
    expect(v.state()).toBe('active');
  });

  it('waits for decoded pixels and authenticates without a URL credential', async () => {
    const v = await viewer();
    expect(v.socket().protocols).toEqual(['redeven-host-application-v1', 'private']);
    expect(String(v.socket().url)).not.toContain('private');
    v.window(); expect(v.state()).toBe('connecting');
    v.socket().frame(); await drain();
    expect(v.state()).toBe('active'); expect(v.drawImage).toHaveBeenCalledOnce();
  });

  it('drops stale decoded frames and reconnects the existing session with fresh credentials', async () => {
    const v = await viewer(); await v.activate();
    let resolve!: (value: unknown) => void;
    v.bitmap.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const old = v.socket(); old.frame();
    old.onclose?.(); await drain();
    expect(v.state()).toBe('disconnected'); expect(v.native.request).not.toHaveBeenCalled();
    v.fetch.mockResolvedValue({ ok: true, json: async () => ({ state: 'running', password: 'renewed' }) });
    await v.retry();
    expect(v.socket().protocols[1]).toBe('renewed');
    await v.activate(); expect(v.state()).toBe('active');
    expect(v.drawImage).toHaveBeenCalledTimes(2);
    resolve({ width: 640, height: 480, close: vi.fn() }); await drain();
    expect(v.drawImage).toHaveBeenCalledTimes(2);
    old.message({ type: 'ended' }); expect(v.native.request).not.toHaveBeenCalled();
    await v.activate(); expect(v.state()).toBe('active');
  });

  it('retains the viewer on permission loss and closes the physical window after confirmed termination', async () => {
    const v = await viewer(); await v.activate();
    v.socket().message({ type: 'blocked' }); expect(v.state()).toBe('permissionRequired');
    expect(v.native.request).not.toHaveBeenCalled();
    await v.retry(); await v.activate();
    v.fetch.mockResolvedValue({ ok: true, json: async () => ({ state: 'ended' }) });
    v.socket().onclose?.(); await drain();
    expect(v.native.request).toHaveBeenCalledWith('close');
  });

  it.each([404, 410])('does not infer application termination from HTTP %s', async status => {
    const v = await viewer(); await v.activate();
    v.fetch.mockResolvedValue({ ok: false, status });
    v.socket().onclose?.(); await drain();
    expect(v.state()).toBe('sessionMissing');
    expect(v.native.request).not.toHaveBeenCalled();
    await v.retry();
    expect(v.state()).toBe('sessionMissing');
    expect(v.native.request).not.toHaveBeenCalled();
  });

  it('exposes the native application menu while waiting for its first window', async () => {
    const v = await viewer();
    v.socket().message({type:'waiting',generation:3});
    const controls = dom.window.document.querySelector<HTMLElement>('.mac-app-controls')!;
    expect(controls.hidden).toBe(false);
    expect(controls.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!.disabled).toBe(true);
    const menu = controls.querySelector<HTMLButtonElement>('.mac-app-menu-toggle')!;
    menu.click();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toEqual({action:'menu',generation:3});
    v.socket().message({type:'menu',generation:3,items:[{id:'open-main',title:'Open main window',enabled:true,children:[]}]});
    dom.window.document.querySelector<HTMLButtonElement>('.mac-app-menu button')!.click();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toEqual({action:'menu_action',item:'open-main',generation:3});
    expect(dom.window.document.querySelector<HTMLElement>('#picture-settings')!.hidden).toBe(true);
    expect(dom.window.document.querySelector('textarea')!.disabled).toBe(true);
    v.window(4); v.socket().frame(); await drain();
    expect(v.state()).toBe('active');
  });

  it('keeps waiting beyond the connection deadline and starts capture when a window appears', async () => {
    vi.useFakeTimers();
    const v = await viewer();
    v.socket().message({ type: 'waiting' });
    await vi.advanceTimersByTimeAsync(90000);
    expect(v.state()).toBe('waiting');
    expect(v.socket().close).not.toHaveBeenCalled();
    expect((dom.window.document.getElementById('retry') as HTMLButtonElement).hidden).toBe(false);
    v.window(); v.socket().frame(); await drain();
    expect(v.state()).toBe('active');
    expect(v.fetch).toHaveBeenCalledOnce();
  });

  it('offers capture recovery if a discovered window never supplies pixels', async () => {
    vi.useFakeTimers();
    const v = await viewer();
    v.socket().message({ type: 'waiting' });
    await vi.advanceTimersByTimeAsync(60000);
    v.window();
    await vi.advanceTimersByTimeAsync(45000);
    expect(v.state()).toBe('captureUnavailable');
    expect(v.native.request).not.toHaveBeenCalled();
    expect(v.socket().close).not.toHaveBeenCalled();
    v.socket().frame(); await drain();
    expect(v.state()).toBe('active');
  });

  it('ignores a terminal status body received after a new connection starts', async () => {
    const v = await viewer(); await v.activate();
    let resolve!: (value: unknown) => void;
    v.fetch.mockResolvedValueOnce({ ok: true, json: () => new Promise(done => { resolve = done; }) });
    v.socket().onclose?.(); await drain();
    await v.retry(); await v.activate();
    resolve({ state: 'ended' }); await drain();
    expect(v.state()).toBe('active');
    expect(v.native.request).not.toHaveBeenCalled();
  });

  it('ignores a decode failure from the replaced connection and paints its successor', async () => {
    const v = await viewer(); await v.activate();
    let reject!: (error: Error) => void;
    v.bitmap.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    v.socket().frame(); v.socket().onclose?.(); await drain();
    await v.retry(); v.window(); v.socket().frame();
    reject(new Error('Old frame decode failed')); await drain();
    expect(v.state()).toBe('active');
    expect(v.drawImage).toHaveBeenCalledTimes(2);
  });

  it('binds input to the current window and commits composed text exactly once', async () => {
    const v = await viewer(); await v.activate();
    const input = dom.window.document.querySelector('textarea')!;
    input.value = '你好';
    input.dispatchEvent(new dom.window.InputEvent('input', { isComposing: true }));
    expect(v.socket().send).not.toHaveBeenCalled();
    input.dispatchEvent(new dom.window.CompositionEvent('compositionend'));
    input.dispatchEvent(new dom.window.InputEvent('input'));
    expect(v.socket().send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ window: 'owned', generation: 1, action: 'input', kind: 'text', text: '你好' }));
    v.window(2);
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a', metaKey: true }));
    expect(v.socket().send).toHaveBeenCalledTimes(1);
    expect(dom.window.document.querySelector('canvas')!.getAttribute('aria-busy')).toBe('true');
    v.socket().frame(); await drain();
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a', metaKey: true }));
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({ generation: 2, key: 'Meta+a' });
    v.socket().message({ type: 'error', code: 'STALE_WINDOW' });
    expect(v.state()).toBe('active');
  });

  it('renders literal system menu titles and routes only returned item IDs', async () => {
    const v = await viewer(); await v.activate();
    dom.window.document.querySelector<HTMLButtonElement>('.mac-app-menu-toggle')!.click();
    v.socket().message({ type: 'menu', generation:1, items: [{ id: 'system-item', title: '<b>Host action</b>', enabled: true, children: [] }] });
    const panel = dom.window.document.querySelector('.mac-app-menu')!;
    expect(dom.window.document.querySelector<HTMLElement>('.mac-app-popover')!.hidden).toBe(false);
    expect(panel.querySelector('b')).toBeNull();
    expect(panel.textContent).toBe('<b>Host action</b>');
    panel.querySelector('button')!.click();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({ action: 'menu_action', item: 'system-item' });
    expect((panel as HTMLElement).hidden).toBe(true);
  });
});

describe('macOS picture controls and stream delivery', () => {
  it('negotiates device pixels and applies quality changes without reopening the app', async () => {
    const v = await viewer(true);
    Object.defineProperty(dom.window, 'devicePixelRatio', {value: 2, configurable: true});
    await v.socket().onopen?.();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({action:'resume', mode:'auto', pixel_ratio:2, video:true, width:320, height:200});
    await v.activate();
    const picture = dom.window.document.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!;
    picture.click();
    const panel = dom.window.document.querySelector('#picture-settings')!;
    [...panel.querySelectorAll('button')].find(el=>el.textContent==='Motion first')!.click();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({action:'configure', mode:'smooth', pixel_ratio:2});
    const select = panel.querySelector<HTMLSelectElement>('select[aria-label="Frame rate limit"]')!;
    select.value='60';select.dispatchEvent(new dom.window.Event('change'));
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({action:'configure', frame_rate:60});
    expect(JSON.parse(dom.window.localStorage.getItem('redeven.mac-app.picture.v1')!)).toMatchObject({mode:'smooth',frame_rate:60});
    expect(v.fetch).toHaveBeenCalledOnce();
    expect(v.socket().close).not.toHaveBeenCalled();
    select.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    expect(dom.window.document.querySelector<HTMLElement>('.mac-app-popover')!.hidden).toBe(true);
    expect(dom.window.document.activeElement).toBe(picture);
  });
  it('acknowledges only decoded current frames and preserves video references across lossless refresh', async () => {
    const v = await viewer(true); await v.socket().onopen?.(); v.window(4);
    v.socket().frame({codec:'h264',key:true,description:'AU0AMw==',profile:'avc1.4D0033',timestamp:1,transport:'video'}); await drain();
    expect(v.state()).toBe('active');
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({action:'frame_ack',generation:4,frame_id:1});
    expect(dom.window.document.querySelector('output[aria-label="Actual resolution"]')?.textContent).toBe('1280 × 960');
    v.socket().frame({codec:'png'});await drain();
    v.socket().frame({codec:'h264',key:false,timestamp:2,transport:'video'});await drain();
    expect(v.drawImage).toHaveBeenCalledTimes(3);
    const before=v.socket().send.mock.calls.length;
    v.socket().frame({generation:3});await drain();
    expect(v.drawImage).toHaveBeenCalledTimes(3);
    expect(v.socket().send).toHaveBeenCalledTimes(before);
  });
  it('rejects malformed packets without acknowledging or painting them', async () => {
    const v = await viewer();v.window();
    v.socket().onmessage?.({data:new dom.window.ArrayBuffer(3)});await drain();
    expect(v.state()).toBe('failed');expect(v.drawImage).not.toHaveBeenCalled();
  });
});


describe('macOS picture recovery and measurement', () => {
  it('renegotiates image transport when a video decoder fails without restarting the app', async () => {
    const v = await viewer(true); await v.socket().onopen?.(); v.window();
    v.socket().frame({codec:'h264',key:true,description:'AU0AMw==',profile:'avc1.4D0033',timestamp:1,transport:'video'}); await drain();
    v.decoders[0].decode.mockImplementation(() => { v.decoders[0].callbacks.error(new Error('Decoder unavailable')); });
    v.socket().frame({codec:'h264',key:false,timestamp:2,transport:'video'}); await drain();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({action:'configure',video:false});
    expect(v.socket().close).not.toHaveBeenCalled();
    v.window(2); v.socket().frame(); await drain();
    expect(v.state()).toBe('active');
    expect(dom.window.document.querySelector('output[aria-label="Transport"]')?.textContent).toBe('Image stream');
    expect(v.fetch).toHaveBeenCalledOnce();
  });
  it('measures painted frames and received bytes then reports zero for an idle window', async () => {
    const v = await viewer(); await v.activate();
    v.statisticsTicks[0]();
    const rate = dom.window.document.querySelector('output[aria-label="Actual frame rate"]')!;
    expect(parseFloat(rate.textContent!)).toBeGreaterThan(0);
    v.statisticsTicks[0]();
    expect(rate.textContent).toBe('0.0 FPS');
    expect(dom.window.document.querySelector('output[aria-label="Bandwidth"]')?.textContent).toBe('0.00 Mb/s');
  });
});

it('renders only the supplied application icon in loading and error states', async () => {
  const v = await viewer(false, 'data:image/png;base64,AAAA');
  expect(dom.window.document.getElementById('fallback-icon')!.hasAttribute('hidden')).toBe(true);
  expect((dom.window.document.getElementById('icon') as HTMLImageElement).hidden).toBe(false);
  v.socket().onclose?.(); await drain();
  expect(v.state()).toBe('disconnected');
  expect(dom.window.document.getElementById('fallback-icon')!.hasAttribute('hidden')).toBe(true);
});
it('starts with collapsed toolbar popovers and collapses on outside input or disconnect', async () => {
  const v = await viewer(); await v.activate();
  const toggle = dom.window.document.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!;
  const drawer = dom.window.document.querySelector<HTMLElement>('.mac-app-popover')!;
  expect(toggle).not.toBeNull();
  expect(drawer.hidden).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  expect(drawer.hidden).toBe(false);
  expect(drawer.contains(dom.window.document.activeElement)).toBe(true);
  dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  expect(drawer.hidden).toBe(true);
  toggle.click();
  v.socket().onclose?.(); await drain();
  expect(drawer.hidden).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});

it('keeps controls open during WebKit button blur and closes for a concrete outside focus target', async () => {
 const v = await viewer(); await v.activate();
 const toggle = dom.window.document.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!;
 const drawer = dom.window.document.querySelector<HTMLElement>('.mac-app-popover')!;
 toggle.click();
 const mode = drawer.querySelector('button')!;
 mode.dispatchEvent(new dom.window.FocusEvent('focusout', {bubbles:true,relatedTarget:null}));
 expect(drawer.hidden).toBe(false);
 mode.dispatchEvent(new dom.window.FocusEvent('focusout', {bubbles:true,relatedTarget:dom.window.document.querySelector('textarea')}));
 expect(drawer.hidden).toBe(true);
});


describe('fixed application toolbar', () => {
  it('uses the supplied icon and names the application menu without repeating an untitled window', async () => {
    const v = await viewer(false, 'data:image/png;base64,AAAA'); await v.activate();
    const doc = dom.window.document;
    const menu = doc.querySelector<HTMLButtonElement>('.mac-app-menu-toggle')!;
    expect(menu.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(menu.getAttribute('aria-label')).toBe(`${doc.title} — Menu`);
    v.socket().message({type:'windows',windows:[{id:'owned',title:''}]});
    const toggle = doc.querySelector<HTMLButtonElement>('.mac-app-windows-toggle')!;
    expect(toggle.querySelector('.mac-app-toolbar-label')!.textContent).toBe('Windows');
    expect(toggle.querySelector<HTMLElement>('.mac-app-window-count')!.hidden).toBe(true);
    v.socket().message({type:'windows',windows:[{id:'owned',title:'Host document'},{id:'other',title:''}]});
    expect(toggle.querySelector('.mac-app-toolbar-label')!.textContent).toBe('Host document');
    expect(toggle.getAttribute('aria-label')).toBe('Windows · 2 — Host document');
    expect(toggle.querySelector<HTMLElement>('.mac-app-window-count')!.hidden).toBe(false);
  });

  it('navigates picture presets without changing quality or sending remote input until activation', async () => {
    const v = await viewer(); await v.activate();
    const doc = dom.window.document;
    doc.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!.click();
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>('.mac-app-picture-modes button')];
    const key = (value: string) => doc.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:value,bubbles:true}));
    expect(doc.activeElement).toBe(buttons[0]);
    key('ArrowRight'); expect(doc.activeElement).toBe(buttons[1]);
    key('ArrowDown'); expect(doc.activeElement).toBe(buttons[3]);
    expect(v.socket().send).not.toHaveBeenCalled();
    buttons[3].click();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({action:'configure',mode:'data'});
    key('Escape');
    expect(doc.activeElement).toBe(doc.querySelector('.mac-app-controls-toggle'));
  });

  it('offers window, picture, close and quit as direct toolbar actions', async () => {
    const v = await viewer(); await v.activate();
    const toolbar = dom.window.document.querySelector('[role="toolbar"]')!;
    expect(toolbar).not.toBeNull();
    for (const name of ['.mac-app-windows-toggle', '.mac-app-controls-toggle', '.mac-app-close', '.mac-app-quit']) {
      expect(toolbar.querySelector(name)).not.toBeNull();
    }
    expect(dom.window.document.querySelector('.mac-app-drawer')).toBeNull();
    toolbar.querySelector<HTMLButtonElement>('.mac-app-close')!.click();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toEqual({action:'close',window:'owned',generation:1});
  });

  it('confirms quit separately and keeps the viewer alive for native cancellation', async () => {
    const v = await viewer(); await v.activate();
    const doc = dom.window.document;
    const quit = doc.querySelector<HTMLButtonElement>('.mac-app-quit')!;
    expect(quit).not.toBeNull();
    quit.click();
    const panel = doc.querySelector<HTMLElement>('.mac-app-quit-confirmation')!;
    expect(panel.hidden).toBe(false);
    expect(v.socket().send).not.toHaveBeenCalled();
    const [cancel, confirm] = panel.querySelectorAll<HTMLButtonElement>('button');
    expect(doc.activeElement).toBe(cancel);
    cancel.click();
    expect(panel.hidden).toBe(true);
    expect(doc.activeElement).toBe(quit);
    quit.click(); confirm.click();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toEqual({action:'quit_application',window:'owned',generation:1});
    expect(v.native.request).not.toHaveBeenCalled();
    v.socket().message({type:'operation_complete',action:'quit_application'});
    expect(v.state()).toBe('active');
    expect(quit.disabled).toBe(false);
    expect(doc.querySelector('.mac-app-feedback')!.textContent).toContain('save dialog');
    expect(v.socket().close).not.toHaveBeenCalled();
  });

  it('never reopens a dismissed menu when its asynchronous response arrives', async () => {
    const v = await viewer(); await v.activate();
    const menu = dom.window.document.querySelector<HTMLButtonElement>('.mac-app-menu-toggle')!;
    expect(menu).not.toBeNull();
    menu.click();
    dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true}));
    v.socket().message({type:'menu',generation:1,items:[{id:'late',title:'Late action',enabled:true,children:[]}]});
    expect(dom.window.document.querySelector<HTMLElement>('.mac-app-menu')!.hidden).toBe(true);
  });
});


it('navigates toolbar and nested native menus with arrow keys and restores focus', async () => {
  const v = await viewer(); await v.activate();
  const doc = dom.window.document;
  const menu = doc.querySelector<HTMLButtonElement>('.mac-app-menu-toggle')!;
  const key = (value: string) => doc.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:value,bubbles:true}));
  menu.focus(); key('ArrowRight');
  expect(doc.activeElement).toBe(doc.querySelector('.mac-app-controls-toggle'));
  key('ArrowLeft'); key('ArrowDown');
  expect(JSON.parse(v.socket().send.mock.lastCall![0]).action).toBe('menu');
  v.socket().message({type:'menu',generation:1,items:[
    {id:'file',title:'File',enabled:true,children:[{id:'save',title:'Save',enabled:true,children:[]}]},
    {id:'disabled',title:'Unavailable',enabled:false,children:[]},
    {id:'help',title:'Help',enabled:true,children:[]},
  ]});
  expect(doc.activeElement?.textContent).toBe('File');
  key('ArrowDown'); expect(doc.activeElement?.textContent).toBe('Help');
  key('Home'); key('ArrowRight'); expect(doc.activeElement?.textContent).toBe('Save');
  key('Escape'); expect(doc.activeElement?.textContent).toBe('File');
  key('ArrowRight'); (doc.activeElement as HTMLButtonElement).click();
  expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({action:'menu_action',item:'save',generation:1});
  expect(doc.activeElement).toBe(menu);
  expect(v.socket().send.mock.calls.map(([raw]) => JSON.parse(raw)).some(value => value.action === 'input')).toBe(false);
});

it('keeps quit available without a window and never retries an unconfirmed quit', async () => {
  vi.useFakeTimers();
  const v = await viewer();
  v.socket().message({type:'waiting',generation:4});
  const doc = dom.window.document, quit = doc.querySelector<HTMLButtonElement>('.mac-app-quit')!;
  expect(doc.querySelector<HTMLButtonElement>('.mac-app-close')!.disabled).toBe(true);
  expect(quit.disabled).toBe(false);
  quit.click(); doc.querySelector<HTMLButtonElement>('.mac-app-confirm-quit')!.click();
  expect(JSON.parse(v.socket().send.mock.lastCall![0])).toEqual({action:'quit_application',generation:4});
  expect(quit.disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(6100);
  expect(quit.disabled).toBe(false);
  expect(doc.querySelector('.mac-app-feedback')!.textContent).toBe('Quit could not be confirmed.');
  expect(v.socket().send.mock.calls.filter(([raw]) => JSON.parse(raw).action === 'quit_application')).toHaveLength(1);
  expect(v.state()).toBe('waiting');
  expect(v.native.request).not.toHaveBeenCalled();
  v.fetch.mockResolvedValue({ok:true,json:async () => ({state:'ended',end_reason:'application_exited'})});
  v.socket().onclose?.(); await drain();
  expect(v.native.request).toHaveBeenCalledExactlyOnceWith('close');
});

it('sizes the host window to the content area and maps input below the toolbar', async () => {
  vi.useFakeTimers();
  const v = await viewer(); await v.activate();
  const canvas = dom.window.document.querySelector('canvas')!;
  vi.spyOn(canvas,'getBoundingClientRect').mockReturnValue({left:0,top:46,width:640,height:480,right:640,bottom:526,x:0,y:46,toJSON(){}});
  Object.assign(canvas,{setPointerCapture:vi.fn()});
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  await vi.advanceTimersByTimeAsync(180);
  expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({action:'configure',width:640,height:480});
  canvas.dispatchEvent(new dom.window.MouseEvent('pointerdown',{clientX:320,clientY:286}));
  expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({action:'input',kind:'down',x:0.5,y:0.5});
});

it('negotiates initial capture once and does not resize again for its first window', async () => {
  vi.useFakeTimers();
  const v = await viewer(true);
  const canvas = dom.window.document.querySelector('canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({width:800,height:550} as DOMRect);
  await v.socket().onopen?.();
  v.window(); v.socket().frame(); await drain();
  await vi.advanceTimersByTimeAsync(200);
  const requests = v.socket().send.mock.calls.map(([raw]) => JSON.parse(raw));
  expect(requests.filter(r => ['resume', 'configure', 'resize'].includes(r.action))).toEqual([
    expect.objectContaining({action:'resume',width:800,height:550,video:true}),
  ]);
});

it('coalesces viewport and density changes into one generation-independent configuration', async () => {
  vi.useFakeTimers();
  const v = await viewer(true); await v.socket().onopen?.(); await v.activate();
  const canvas = dom.window.document.querySelector('canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({width:900,height:600} as DOMRect);
  Object.defineProperty(dom.window, 'devicePixelRatio', {value:2,configurable:true});
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  v.window(2);
  await vi.advanceTimersByTimeAsync(180);
  const requests = v.socket().send.mock.calls.map(([raw]) => JSON.parse(raw));
  expect(requests).toEqual([expect.objectContaining({action:'configure',width:900,height:600,pixel_ratio:2})]);
  expect(requests[0].generation).toBeUndefined();
});
