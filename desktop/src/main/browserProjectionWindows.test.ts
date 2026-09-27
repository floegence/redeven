import { EventEmitter } from 'node:events';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { expect, it, vi } from 'vitest';
import { BrowserProjectionWindows } from './browserProjectionWindows';

it('reserves only the exact same-origin static document instance and consumes it once', () => {
  const contents = Object.assign(new EventEmitter(), { id: 1, getURL: () => 'http://localhost:24498/_redeven_proxy/env/' });
  const parent = { webContents: contents, isDestroyed: () => false } as unknown as BrowserWindow;
  const windows = new BrowserProjectionWindows(vi.fn());
  const nonce = 'b2b9b64c-b986-4ec2-bfab-de739c46a0fc';
  const url = `http://localhost:24498/_redeven_proxy/env/browser/?instance=${nonce}#${nonce}`;
  for (const invalid of [url.replace('localhost', 'source.test'), url.replace('?instance=', '?token='), url.replace(nonce, 'other'), url.replace('/browser/', '/browser/browser-view-forged/')]) {
    expect(windows.prepare(parent, invalid)).toBe(false);
  }
  expect(windows.consume(parent, { url })).toEqual({ action: 'deny' });
  expect(windows.prepare(parent, url)).toBe(true);
  expect(windows.consume(parent, { url })).toMatchObject({ action: 'allow', overrideBrowserWindowOptions: { show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } } });
  expect(windows.consume(parent, { url })).toEqual({ action: 'deny' });
});

it('authorizes only the reserved child document and assets without granting environment APIs', () => {
  const parentContents = Object.assign(new EventEmitter(), { id: 1, session: {}, getURL: () => 'http://localhost:24498/_redeven_proxy/env/' });
  const parent = { webContents: parentContents, isDestroyed: () => false } as unknown as BrowserWindow;
  const childContents = Object.assign(new EventEmitter(), { id: 2, setWindowOpenHandler: vi.fn() });
  const child = Object.assign(new EventEmitter(), { webContents: childContents, isDestroyed: () => false, close: vi.fn(), show: vi.fn() }) as unknown as BrowserWindow;
  const create = vi.fn((_options: BrowserWindowConstructorOptions) => child);
  const windows = new BrowserProjectionWindows(create);
  const nonce = 'b2b9b64c-b986-4ec2-bfab-de739c46a0fc';
  const url = `http://localhost:24498/_redeven_proxy/env/browser/?instance=${nonce}#${nonce}`;
  expect(windows.prepare(parent, url)).toBe(true);
  const response = windows.consume(parent, { url });
  if (response?.action !== 'allow') throw new Error('Reserved browser document denied');
  response.createWindow!({ webPreferences: { preload: '/owner/preload.js' } });
  expect(create.mock.calls[0]![0].webPreferences).toMatchObject({ session: parentContents.session, sandbox: true, contextIsolation: true, nodeIntegration: false });
  expect(create.mock.calls[0]![0].webPreferences?.preload).toBeUndefined();
  expect(windows.staticRequestOwner(2, { url: url.split('#')[0]!, method: 'GET' })).toBe(1);
  expect(windows.staticRequestOwner(2, { url: 'http://localhost:24498/_redeven_proxy/env/assets/browser.js', method: 'GET' })).toBe(1);
  for (const blocked of [url.replace(nonce, 'unreserved'), url.replace('localhost', 'source.test'), 'http://localhost:24498/_redeven_proxy/api/browser/environment', 'http://localhost:24498/_redeven_proxy/env/']) {
    expect(windows.staticRequestOwner(2, { url: blocked, method: 'GET' })).toBeUndefined();
  }
  expect(windows.staticRequestOwner(2, { url, method: 'POST' })).toBeUndefined();
  expect(windows.staticRequestOwner(3, { url, method: 'GET' })).toBeUndefined();
  child.emit('closed');
  expect(windows.staticRequestOwner(2, { url, method: 'GET' })).toBeUndefined();
});

it.each([false, true])('retires projection ownership after parent destruction with a previously closed child: %s', (childAlreadyClosed) => {
  const contents = Object.assign(new EventEmitter(), { id: 1, session: {}, getURL: () => 'http://localhost:24498/_redeven_proxy/env/' });
  let destroyed = false;
  const parent = {
    get webContents() {
      if (destroyed) throw new Error('Object has been destroyed');
      return contents;
    },
    isDestroyed: () => destroyed,
  } as unknown as BrowserWindow;
  const childContents = Object.assign(new EventEmitter(), { id: 2, setWindowOpenHandler: vi.fn() });
  const close = vi.fn();
  const child = Object.assign(new EventEmitter(), { webContents: childContents, isDestroyed: () => false, close }) as unknown as BrowserWindow;
  const windows = new BrowserProjectionWindows(() => child);
  const nonce = 'b2b9b64c-b986-4ec2-bfab-de739c46a0fc';
  const url = `http://localhost:24498/_redeven_proxy/env/browser/?instance=${nonce}#${nonce}`;
  expect(windows.prepare(parent, url)).toBe(true);
  const response = windows.consume(parent, { url });
  if (response?.action !== 'allow') throw new Error('Reserved browser document denied');
  response.createWindow!({});
  if (childAlreadyClosed) child.emit('closed');

  destroyed = true;
  expect(() => contents.emit('destroyed')).not.toThrow();
  expect(close).toHaveBeenCalledTimes(childAlreadyClosed ? 0 : 1);
  expect(contents.listenerCount('destroyed')).toBe(0);
  expect(contents.listenerCount('did-start-navigation')).toBe(0);
  expect(windows.staticRequestOwner(2, { url: url.split('#')[0]!, method: 'GET' })).toBeUndefined();
  contents.emit('destroyed');
  expect(close).toHaveBeenCalledTimes(childAlreadyClosed ? 0 : 1);
  expect(windows.prepare(parent, url)).toBe(false);
  expect(windows.consume(parent, { url })).toEqual({ action: 'deny' });
});
