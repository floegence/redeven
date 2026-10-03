// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { normalizeDesktopShellOpenWebServiceWindowRequest } from '../../../../../../desktop/src/shared/desktopShellWebServiceWindowIPC';
import { bindSessionHTTP } from '../services/sessionHTTP';
import { controlText } from '../../testSupport/controlText';
import { RemoteDesktopPanel } from './RemoteDesktopPanel';

vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ agent: { hostname: 'udesk24' }, permissions: { can_read: true, can_write: true, can_execute: true } }),
  env_id: () => 'local', localRuntime: () => ({}),
}) }));
let dispose: (() => void) | undefined, release: (() => void) | undefined;
afterEach(() => { dispose?.(); release?.(); delete window.redevenDesktopShell; document.body.replaceChildren(); });

// Exercise the API client, route builder, opener and real Desktop normalizer
// together: independently mocked openers hid the origin/path mismatch.
it.each([
  { target: 'http://127.0.0.1:40201', accepted: true },
  { target: 'http://127.0.0.1:40201/_redeven_desktop/', accepted: false },
])('launches only the registered service origin ($target)', async ({ target, accepted }) => {
  const calls: string[] = [];
  release = bindSessionHTTP({
    async fetch(url, init) {
      calls.push(`${init?.method} ${url}`);
      let data: unknown = {};
      if (url === '/_redeven_proxy/api/remote-desktop') data = {
        capabilities: { backend: 'wayland', state: 'authorization_required', screen: true, input: true, displays: [] },
        unattended: false, control_in_use: false, last_display_id: '',
      };
      if (url === '/_redeven_proxy/api/remote-desktop/sessions') data = { id: 'one', forward_id: 'fixture', target_url: target, mode: 'control' };
      return new Response(JSON.stringify({ ok: true, data }));
    },
    events() { throw new Error('Unexpected stream'); },
  });
  const opened = vi.fn();
  const bridge = vi.fn(async request => {
    const normalized = normalizeDesktopShellOpenWebServiceWindowRequest(request);
    if (!normalized) return { ok: false, message: 'Invalid Web Service window request.' };
    expect(normalized.url).toBe('https://localhost/pf/fixture/_redeven_desktop/');
    expect(normalized.presentation).toBe('desktop');
    expect(normalized.access_mode).toBe('unified_proxy');
    return { ok: true };
  });
  window.redevenDesktopShell = { openWebServiceWindow: bridge };
  dispose = render(() => <RemoteDesktopPanel onConnected={opened} />, document.body);
  const connect = () => [...document.querySelectorAll('button')].find(button => controlText(button) === 'Connect to desktop')!;
  await vi.waitFor(() => expect(connect()?.disabled).toBe(false));
  connect().click();
  await vi.waitFor(() => expect(bridge).toHaveBeenCalledOnce());
  if (accepted) {
    await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
    expect(calls).not.toContain('DELETE /_redeven_proxy/api/remote-desktop/sessions/one');
  } else {
    await vi.waitFor(() => expect(document.querySelector('[role=alert]')?.textContent).toContain('Invalid Web Service window request.'));
    expect(opened).not.toHaveBeenCalled();
    expect(calls).toContain('DELETE /_redeven_proxy/api/remote-desktop/sessions/one');
    expect(document.querySelector('.remote-desktop-guidance')).toBeNull();
  }
  expect(calls).toContain('POST /_redeven_proxy/api/forwards/fixture/touch');
});
