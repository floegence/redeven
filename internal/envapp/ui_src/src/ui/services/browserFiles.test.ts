import { afterEach, expect, it, vi } from 'vitest';
import { bindTestSessionHTTP } from '../../test/sessionHTTPFixture';
import { readBrowserFile } from './browserFiles';
import { browserResourceIdentity } from './browserResourceIdentity';

let release: (() => void) | undefined;
afterEach(() => { release?.(); vi.unstubAllGlobals(); });
const root = '/_redeven_proxy/api/browser/views/browser-view-test';

it('reads exact file bytes through the owning session without using local HTTP', async () => {
  const local = vi.fn(() => { throw new Error('Wrong identity'); });
  vi.stubGlobal('fetch', local);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new Uint8Array([0, 255, 3]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '3' } }));
  release = await bindTestSessionHTTP(fetch);
  const file = await readBrowserFile(root, 'resource', 'target&other=1', 'opaque#id', new AbortController().signal);
  expect(new Uint8Array(file.body)).toEqual(new Uint8Array([0, 255, 3]));
  expect(fetch.mock.calls[0]?.[0]).toBe(`${root}/resource?target=target%26other%3D1&id=opaque%23id`);
  expect(local).not.toHaveBeenCalled();
});

it('rejects oversized and truncated responses and cancels a read when its view closes', async () => {
  const abort = new AbortController(), cancel = vi.fn();
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('x', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }))
    .mockResolvedValueOnce(new Response('x', { headers: { 'Content-Length': '2' } }))
    .mockResolvedValueOnce(new Response(new ReadableStream({ pull() { abort.abort(); }, cancel })));
  release = await bindTestSessionHTTP(fetch);
  await expect(readBrowserFile(root, 'resource', 'tab', 'id', new AbortController().signal)).rejects.toThrow('unavailable');
  await expect(readBrowserFile(root, 'download', 'tab', 'id', new AbortController().signal)).rejects.toThrow('incomplete');
  await expect(readBrowserFile(root, 'resource', 'tab', 'id', abort.signal)).rejects.toThrow();
  expect(cancel).toHaveBeenCalledOnce();
});

it('admits only opaque references in the current browser document', () => {
  const base = 'http://localhost/_redeven_proxy/env/browser/#nonce';
  expect(browserResourceIdentity('?browser_target=tab&browser_resource=id', base)).toEqual({ target: 'tab', id: 'id' });
  for (const url of ['https://source.test/file', '/_redeven_proxy/api/secret?browser_target=tab&browser_resource=id', '?browser_target=tab&browser_resource=id&browser_target=other', '?browser_target=tab&browser_resource=id#fragment']) {
    expect(() => browserResourceIdentity(url, base)).toThrow('Invalid browser resource');
  }
});
