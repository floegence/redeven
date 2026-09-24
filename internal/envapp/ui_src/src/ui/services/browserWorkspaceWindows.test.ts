// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { bindTestSessionHTTP } from '../../test/sessionHTTPFixture';
import { browserDocumentURL } from './browserWindowProtocol';
import { openBrowserWorkspace } from './browserWorkspaceWindows';

let release: (() => void) | undefined;
afterEach(() => { release?.(); vi.unstubAllGlobals(); });

it('creates browser views through the active Session even when local HTTP has a different identity', async () => {
  const local = vi.fn(() => Promise.reject(new Error('Synthetic local-ui identity')));
  vi.stubGlobal('fetch', local);
  const view = { id: 'browser-view-fixture', initial_target: 'first', protocol_version: 22, media_wire_version: 1 };
  const session = vi.fn(async () => Response.json({ ok: true, data: view }));
  release = await bindTestSessionHTTP(session);
  await expect(openBrowserWorkspace({ managed_profile_id: 'browser-main' }, new AbortController().signal)).resolves.toEqual(view);
  expect(session).toHaveBeenCalledOnce();
  expect(local).not.toHaveBeenCalled();
});

it('replaces the document itself when selecting another source in the same window', () => {
  const view = { id: 'browser-view-fixture', initial_target: 'first', protocol_version: 22, media_wire_version: 1 };
  const first = new URL(browserDocumentURL(view, crypto.randomUUID()), location.origin);
  const next = new URL(browserDocumentURL(view, crypto.randomUUID()), location.origin);
  first.hash = ''; next.hash = '';
  expect(first.href).not.toBe(next.href);
  expect(first.pathname).toBe('/_redeven_proxy/env/browser/');
});
