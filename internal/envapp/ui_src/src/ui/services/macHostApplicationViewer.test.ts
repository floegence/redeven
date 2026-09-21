import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: Record<string, unknown>) => { window: Window & typeof globalThis };
};
const source = readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/macos.js'), 'utf8');
const html = readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/viewer.html'), 'utf8').split('<script nonce=')[0].replace('{{.Style}}', '');
let dom: InstanceType<typeof JSDOM>;
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => { dom?.window.dispatchEvent(new dom.window.Event('beforeunload')); dom?.window.close(); });

async function viewer() {
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
    send = vi.fn();
    close = vi.fn(() => { this.readyState = 3; });
    constructor(readonly url: URL, readonly protocols: string[]) { Socket.instances.push(this); }
    message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
    frame() { this.onmessage?.({ data: new dom.window.Blob(['frame']) }); }
  }
  vi.spyOn(dom.window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  Object.assign(dom.window, { fetch, WebSocket: Socket, createImageBitmap: bitmap, redevenHostApplicationWindow: native });
  dom.window.eval(`const config = ${JSON.stringify({ base: '/pf/test', icon: '', copy: { operationFailed: 'The action could not be completed. Try again.', waiting: 'Waiting for the application window…', captureUnavailable: 'Window capture is unavailable.', windows: 'Windows', menu: 'Menu', closeWindow: 'Close window', input: 'Input', retry: 'Retry', reconnect: 'Reconnect' } })};\n${source}`);
  await drain();
  const socket = () => Socket.instances.at(-1)!;
  const state = () => dom.window.document.body.dataset.state;
  const window = (generation = 1) => socket().message({ type: 'window', window: 'owned', generation, width: 640, height: 480 });
  const activate = async () => { window(); socket().frame(); await drain(); };
  const retry = async () => { (dom.window.document.getElementById('retry') as HTMLButtonElement).click(); await drain(); };
  return { socket, state, window, activate, retry, fetch, bitmap, drawImage, native };
}

describe('macOS application viewer', () => {
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
    resolve({ width: 640, height: 480, close: vi.fn() }); await drain();
    expect(v.state()).toBe('reconnecting'); expect(v.drawImage).toHaveBeenCalledOnce();
    old.message({ type: 'ended' }); expect(v.native.request).not.toHaveBeenCalled();
    await v.activate(); expect(v.state()).toBe('active');
  });

  it('retains the viewer on permission loss and closes the physical window after confirmed termination', async () => {
    const v = await viewer(); await v.activate();
    v.socket().message({ type: 'blocked' }); expect(v.state()).toBe('disconnected');
    expect(v.native.request).not.toHaveBeenCalled();
    await v.retry(); await v.activate();
    v.fetch.mockResolvedValue({ ok: false, status: 410 });
    v.socket().onclose?.(); await drain();
    expect(v.native.request).toHaveBeenCalledWith('close');
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
    v.socket().message({ type: 'menu', items: [{ id: 'system-item', title: '<b>Host action</b>', enabled: true, children: [] }] });
    const panel = dom.window.document.querySelector('.mac-app-menu')!;
    expect(panel.querySelector('b')).toBeNull();
    expect(panel.textContent).toBe('<b>Host action</b>');
    panel.querySelector('button')!.click();
    expect(JSON.parse(v.socket().send.mock.lastCall![0])).toMatchObject({ action: 'menu_action', item: 'system-item' });
    expect((panel as HTMLElement).hidden).toBe(true);
  });
});
