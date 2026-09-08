import { expect, it } from 'vitest';
import type { OnBeforeSendHeadersListenerDetails } from 'electron';
import { nativeCodeSpaceRequestIsOwned } from './codespaceNativeSession';
const origin = 'http://127.0.0.1:43210';
const owns = (changes: Record<string, unknown>) =>
  nativeCodeSpaceRequestIsOwned(
    {
      url: origin + '/file',
      resourceType: 'xhr',
      webContentsId: 7,
      referrer: '',
      requestHeaders: {},
      frame: { url: origin + '/', parent: null },
      ...changes,
    } as OnBeforeSendHeadersListenerDetails,
    origin,
    7,
  );
it('admits the owner and new inherited frames but never foreign frame ancestry', () => {
  expect(owns({})).toBe(true);
  expect(
    owns({ frame: { url: '', parent: { url: origin + '/', parent: null } } }),
  ).toBe(true);
  expect(
    owns({
      frame: {
        url: 'https://foreign.test',
        parent: { url: origin + '/', parent: null },
      },
    }),
  ).toBe(false);
  expect(
    owns({
      frame: {
        url: origin + '/',
        parent: { url: 'https://foreign.test', parent: null },
      },
    }),
  ).toBe(false);
  expect(owns({ webContentsId: 8 })).toBe(false);
  expect(owns({ url: 'http://localhost:43210/file' })).toBe(false);
});
it('requires browser-owned provenance for Worker and Service Worker requests', () => {
  expect(
    owns({
      frame: null,
      webContentsId: -1,
      requestHeaders: { 'Sec-Fetch-Site': 'same-origin' },
    }),
  ).toBe(true);
  expect(owns({ frame: null, webContentsId: -1, referrer: origin + '/' })).toBe(
    true,
  );
  expect(
    owns({
      frame: null,
      webContentsId: -1,
      requestHeaders: { Origin: 'https://foreign.test' },
    }),
  ).toBe(false);
  expect(
    owns({
      frame: null,
      webContentsId: -1,
      requestHeaders: { Origin: origin },
      resourceType: 'webSocket',
      url: origin.replace('http:', 'ws:') + '/socket',
    }),
  ).toBe(true);
  expect(owns({ frame: null, webContentsId: -1 })).toBe(false);
});
