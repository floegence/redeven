import { render } from 'solid-js/web';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { EnvSettingsPage } from '../../../src/ui/pages/EnvSettingsPage';
import { I18nProvider } from '../../../src/ui/i18n';
import { createRuntimeSettingsFixture } from './fixture';
import '../../../src/index.css';

render(() => {
  const fixture = createRuntimeSettingsFixture();
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = String(input);
    if (!url.startsWith('/_redeven_proxy/')) return originalFetch(input, init);
    try { return new Response(JSON.stringify({ ok: true, data: await fixture.request(url, init) }), { headers: { 'content-type': 'application/json' } }); }
    catch (error) { return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 400 }); }
  };
  return <FloeProvider><I18nProvider><div style={{ height: '100dvh' }}><EnvSettingsPage context={fixture.context} /></div></I18nProvider></FloeProvider>;
}, document.getElementById('root')!);
