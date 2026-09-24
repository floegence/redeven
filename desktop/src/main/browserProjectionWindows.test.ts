import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
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
  expect(windows.consume(parent, { url })).toMatchObject({ action: 'allow', overrideBrowserWindowOptions: { webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } } });
  expect(windows.consume(parent, { url })).toEqual({ action: 'deny' });
});
