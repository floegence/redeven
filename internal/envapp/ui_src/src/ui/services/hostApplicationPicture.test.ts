import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: Record<string, unknown>) => { window: Window & typeof globalThis };
};
const source = readFileSync(resolve(process.cwd(), '../../codeapp/appserver/host_application_viewer/picture.js'), 'utf8');
type Picture = { mode: string; max_dimension: number; frame_rate: number };
let dom: InstanceType<typeof JSDOM>;
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => { dom?.window.dispatchEvent(new dom.window.Event('pagehide')); dom?.window.close(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fixture(kind: 'native' | 'browser' | 'orphan' = 'native') {
  dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/pf/test/_redeven_host_app/', runScripts: 'dangerously' });
  const w = dom.window;
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>();
  const request = vi.fn(), postMessage = vi.fn();
  const timers = new Map<number, () => void>();
  let timerID = 0;
  w.setTimeout = ((callback: () => void, delay: number) => { expect(delay).toBe(2000); const id = ++timerID; timers.set(id, callback); return id; }) as typeof w.setTimeout;
  w.clearTimeout = ((id?: number) => { if (id) timers.delete(id); }) as typeof w.clearTimeout;
  Object.assign(w, { fetch });
  if (kind === 'native') Object.assign(w, { redevenHostApplicationWindow: { request } });
  if (kind === 'browser') Object.assign(w, { opener: { closed: false, postMessage } });
  const first = deferred<unknown>(); fetch.mockReturnValueOnce(first.promise);
  w.eval(`const config={base:'/pf/test'}; const windowTransport={fetch:window.fetch}; const hostApplicationAppearance={copy:(element,key)=>element.textContent=key}; ${source}\nwindow.pictureAPI=hostApplicationPicture;`);
  const api = (w as unknown as { pictureAPI: { link: () => HTMLButtonElement; subscribe: (value: Partial<Picture>, changed: () => void) => void } }).pictureAPI;
  const picture: Partial<Picture> = {}, changed = vi.fn(); api.subscribe(picture, changed);
  const link = api.link(); w.document.body.append(link);
  await drain();
  const focus = () => w.dispatchEvent(new w.Event('focus'));
  const respond = (pending: ReturnType<typeof deferred<unknown>>, value: Picture) => pending.resolve({ ok: true, json: async () => ({ ok: true, data: value }) });
  return { w, api, fetch, request, postMessage, first, timers, picture, changed, link, focus, respond };
}

it('serializes focus refreshes into one polling chain and applies only confirmed values', async () => {
  const v = await fixture();
  for (let i = 0; i < 20; i++) v.focus();
  expect(v.fetch).toHaveBeenCalledOnce(); expect(v.timers.size).toBe(0);
  expect(v.fetch).toHaveBeenCalledWith('/pf/test/_redeven_host_app/picture', expect.objectContaining({ cache: 'no-store', signal: expect.any(v.w.AbortSignal) }));
  expect(v.picture).toEqual({ mode: 'auto', max_dimension: 0, frame_rate: 0 });
  v.respond(v.first, { mode: 'smooth', max_dimension: 1920, frame_rate: 60 }); await drain();
  expect(v.changed).toHaveBeenCalledOnce(); expect(v.timers.size).toBe(1);
  const second = deferred<unknown>(); v.fetch.mockReturnValueOnce(second.promise);
  for (let i = 0; i < 20; i++) v.focus();
  expect(v.fetch).toHaveBeenCalledTimes(2); expect(v.timers.size).toBe(0);
  v.respond(second, { mode: 'clarity', max_dimension: 3840, frame_rate: 30 }); await drain();
  expect(v.picture).toEqual({ mode: 'clarity', max_dimension: 3840, frame_rate: 30 });
  expect(v.changed).toHaveBeenCalledTimes(2); expect(v.timers.size).toBe(1);
  const third = deferred<unknown>(); v.fetch.mockReturnValueOnce(third.promise);
  const [id, callback] = [...v.timers][0]; v.timers.delete(id); callback(); await drain();
  expect(v.fetch).toHaveBeenCalledTimes(3);
  v.respond(third, { mode: 'clarity', max_dimension: 3840, frame_rate: 30 }); await drain();
  expect(v.changed).toHaveBeenCalledTimes(2); expect(v.timers.size).toBe(1);
  expect(v.fetch.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true);
  expect(v.w.localStorage.length).toBe(0);
});

it('aborts pending reads on retirement and cannot publish a late response or restart polling', async () => {
  const v = await fixture(); const signal = v.fetch.mock.calls[0][1].signal!;
  v.w.dispatchEvent(new v.w.Event('pagehide'));
  expect(signal.aborted).toBe(true);
  v.respond(v.first, { mode: 'data', max_dimension: 1600, frame_rate: 15 }); await drain();
  v.focus(); await drain();
  expect(v.changed).not.toHaveBeenCalled(); expect(v.timers.size).toBe(0);
  expect(v.fetch).toHaveBeenCalledOnce();
  expect(v.picture).toEqual({ mode: 'auto', max_dimension: 0, frame_rate: 0 });
});

it('preserves confirmed preferences through transport and invalid-data failures', async () => {
  const v = await fixture();
  v.respond(v.first, { mode: 'smooth', max_dimension: 1920, frame_rate: 60 }); await drain();
  for (const response of [
    Promise.reject(new Error('disconnected')),
    Promise.resolve({ ok: false }),
    Promise.resolve({ ok: true, json: async () => ({ ok: true, data: { mode: 'invalid', max_dimension: 1920, frame_rate: 60 } }) }),
    Promise.resolve({ ok: true, json: async () => ({ ok: true, data: { mode: 'clarity', max_dimension: -1, frame_rate: 60 } }) }),
  ]) {
    v.fetch.mockReturnValueOnce(response); v.focus(); await drain();
    expect(v.picture).toEqual({ mode: 'smooth', max_dimension: 1920, frame_rate: 60 });
    expect(v.timers.size).toBe(1);
  }
  expect(v.changed).toHaveBeenCalledOnce();
});

it.each(['native', 'browser', 'orphan'] as const)('routes only the canonical settings action for a %s viewer', async kind => {
  const v = await fixture(kind);
  expect(v.link.disabled).toBe(kind === 'orphan'); v.link.click();
  if (kind === 'native') expect(v.request).toHaveBeenCalledExactlyOnceWith('settings');
  else expect(v.request).not.toHaveBeenCalled();
  if (kind === 'browser') expect(v.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'redeven:host-application-settings' }, '*');
  else expect(v.postMessage).not.toHaveBeenCalled();
  expect(v.fetch).toHaveBeenCalledOnce(); expect(v.changed).not.toHaveBeenCalled();
});
