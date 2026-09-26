// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import type { Session } from '@floegence/flowersec-core';
import { bindTestSessionHTTP } from '../../test/sessionHTTPFixture';

const fixture = vi.hoisted(() => ({
  session: (() => undefined) as () => Session | undefined,
  theme: (() => ({ mode: 'light', preset: 'default' })) as () => { mode: string; preset: string },
  locale: (() => 'en-US') as () => string,
}));
vi.mock('@floegence/floe-webapp-protocol', () => ({ useProtocol: () => ({ session: () => fixture.session() }) }));
vi.mock('@floegence/floe-webapp-core', () => ({ useTheme: () => ({ resolvedTheme: () => fixture.theme().mode, shellPresetForMode: () => ({ name: fixture.theme().preset }) }) }));
vi.mock('@floegence/floe-webapp-core/ui', () => ({ Button: (props: { children: unknown }) => <button>{props.children as never}</button> }));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({ env_id: () => 'env_local' }) }));
vi.mock('../i18n', () => ({ useI18n: () => ({ locale: () => fixture.locale(), t: (key: string) => key }) }));
vi.mock('../services/browserSourceManagement', () => ({ browserSourceService: () => ({ management: { loadBrowserInstallation: async () => ({ enabled: true, state: 'installed' }) } }) }));
vi.mock('../widgets/FloeBrowserSurface', () => ({ FloeBrowserSurface: (props: { onInteraction?: () => void }) => <button data-browser-surface onClick={() => props.onInteraction?.()} /> }));
vi.mock('../widgets/BrowserWorkspaceNotice', () => ({ BrowserWorkspaceNotice: () => <div /> }));
vi.mock('../widgets/BrowserSourceDialog', () => ({ BrowserSourceDialog: () => <div /> }));
import { EnvBrowserPage } from './EnvBrowserPage';

let dispose: (() => void) | undefined;
let unbind: (() => void) | undefined;
afterEach(() => { dispose?.(); unbind?.(); document.body.replaceChildren(); });

it('keeps the view stable when shell settings refresh without a presentation change', async () => {
  const [theme, setTheme] = createSignal({ mode: 'light', preset: 'default' });
  const [locale, setLocale] = createSignal('en-US');
  fixture.theme = theme; fixture.locale = locale; fixture.session = () => (session);
  const session = {} as Session;
  let sequence = 0;
  const request = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => Response.json({ ok: true, data: init?.method === 'DELETE' ? null : {
    id: `browser-view-${++sequence}`, generation: 'generation', profile_id: 'browser-main', initial_target: 'confirmed-tab', protocol_version: 24, media_wire_version: 1,
  } }));
  unbind = await bindTestSessionHTTP(request);
  const root = document.createElement('div'); document.body.append(root);
  const interaction = vi.fn();
  dispose = render(() => <EnvBrowserPage onInteraction={interaction} onOpenWindow={async () => undefined} />, root);
  await vi.waitFor(() => expect(root.querySelector('[data-browser-surface]')).not.toBeNull());
  expect(root.querySelector('.redeven-browser-profile-bar')).toBeNull();
  expect(sequence).toBe(1);
  root.querySelector<HTMLButtonElement>('[data-browser-surface]')!.click();
  expect(interaction).toHaveBeenCalledOnce();
  setTheme({ mode: 'light', preset: 'default' });
  await Promise.resolve(); await Promise.resolve();
  expect(sequence).toBe(1);
  setLocale('zh-CN');
  await vi.waitFor(() => expect(sequence).toBe(2));
  expect(request.mock.calls.filter(([, init]) => init?.method === 'POST').map(([path, init]) => [String(path), JSON.parse(String(init?.body))])).toEqual([
    ['/_redeven_proxy/api/browser/workspace', { managed_profile_id: 'browser-main' }],
    ['/_redeven_proxy/api/browser/views', { targets: ['confirmed-tab'] }],
  ]);
});
